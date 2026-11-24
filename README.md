# Groq Weather Agent

API HTTP mínima en **Node.js + TypeScript** que expone un agente conversacional construido con **LangGraph**. El agente usa un modelo de **Groq** y tiene una herramienta para consultar el **clima actual** de cualquier ciudad (vía [Open-Meteo](https://open-meteo.com/), gratis y sin API key). Recuerda la conversación por `threadId`.

Sirve como referencia de cómo montar un agente con herramientas en LangGraph JS con el mínimo de piezas: sin framework web, sin paso de compilación.

## Cómo funciona

```
POST /chat ──► server.ts ──► grafo LangGraph (agent.ts)
                               │
                 START ──► [llm] ──¿pidió una herramienta?── no ──► END ──► respuesta
                             ▲            │ sí
                             │            ▼
                             └──────── [tools] ── get_weather ──► Open-Meteo
```

1. El nodo `llm` envía el historial a Groq (`ChatGroq`) con la herramienta `get_weather` enlazada.
2. Si el modelo pide la herramienta, `toolsCondition` dirige al nodo `tools` (`ToolNode`), que la ejecuta y devuelve el resultado al modelo.
3. Se repite hasta que el modelo responde con texto. `recursionLimit: 10` corta un bucle infinito de herramientas.
4. `MemorySaver` guarda los mensajes de cada `thread_id`, así el siguiente mensaje del mismo hilo continúa la conversación.

## Requisitos

- **Node.js ≥ 23.6**: ejecuta TypeScript de forma nativa y lee `.env` con `--env-file`.
- Una API key de Groq: <https://console.groq.com/keys>

## Puesta en marcha

```bash
npm install
```

Crea un archivo `.env` en la raíz:

```env
GROQ_API_KEY=gsk_...
# Opcionales:
# GROQ_MODEL=openai/gpt-oss-20b   # cualquier modelo de Groq con tool calling
# PORT=3000
```

```bash
npm run dev     # servidor con recarga automática en http://localhost:3000
npm start       # igual, sin recarga
```

> **Windows / PowerShell:** si aparece *"la ejecución de scripts está deshabilitada"*, usa `npm.cmd run dev` o ejecuta una vez `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Documentación (Swagger)

Con el servidor encendido:

- **Swagger UI:** <http://localhost:3000/docs>, para probar la API desde el navegador.
- **Spec OpenAPI:** <http://localhost:3000/openapi.json>, fuente en [`openapi.json`](openapi.json).

## API

### `POST /chat`

| Campo      | Tipo   | Obligatorio | Descripción                                                    |
|------------|--------|-------------|----------------------------------------------------------------|
| `message`  | string | sí          | Mensaje del usuario                                            |
| `threadId` | string | no          | Id de conversación. Si no se envía, se crea uno nuevo y se devuelve |

Respuesta `200`:

```json
{ "reply": "En Bogotá hace 18 °C...", "threadId": "4939598e-8563-4df3-aa99-514dd9d2d1a1" }
```

Errores: `400` (JSON inválido, falta `message`, `threadId` con formato incorrecto) y `502` (fallo al llamar a Groq). Formato: `{ "error": "..." }`.

### Ejemplo: conversación de dos turnos

```bash
curl -X POST http://localhost:3000/chat -H "Content-Type: application/json" \
  -d '{"message":"¿Qué tiempo hace en Medellín?"}'
# → {"reply":"...","threadId":"<id>"}

curl -X POST http://localhost:3000/chat -H "Content-Type: application/json" \
  -d '{"message":"¿Y comparado con Cartagena?","threadId":"<id>"}'
```

PowerShell:

```powershell
$r = Invoke-RestMethod -Method Post -Uri http://localhost:3000/chat -ContentType 'application/json' `
  -Body '{"message":"¿Qué tiempo hace en Medellín?"}'
Invoke-RestMethod -Method Post -Uri http://localhost:3000/chat -ContentType 'application/json' `
  -Body (@{ message = '¿Y comparado con Cartagena?'; threadId = $r.threadId } | ConvertTo-Json)
```

## Estructura

```
src/
  server.ts       Servidor HTTP (node:http): validación de entrada, /chat, /docs, /openapi.json
  agent.ts        Grafo LangGraph: nodo llm + ToolNode + memoria (MemorySaver)
  weather.ts      Herramienta get_weather (tool() + esquema zod) y cliente de Open-Meteo
  agent.test.ts   Tests con fetch simulado (no llaman a Groq ni a Open-Meteo)
openapi.json      Contrato de la API (lo sirve /openapi.json y lo usa Swagger UI)
```

### Agregar otra herramienta

1. Defínela con `tool()` y un esquema `zod`, como `weatherTool` en [`src/weather.ts`](src/weather.ts).
2. Añádela al array `tools` en [`src/agent.ts`](src/agent.ts). `bindTools` y `ToolNode` usan ese mismo array, así que no hace falta tocar nada más.

## Scripts

| Script              | Qué hace                                     |
|---------------------|----------------------------------------------|
| `npm run dev`       | Servidor con `--watch`                       |
| `npm start`         | Servidor                                     |
| `npm test`          | Tests (`node --test`)                        |
| `npm run typecheck` | Comprobación de tipos con `tsc` (no compila) |

## Limitaciones (a propósito, es una referencia)

- **La memoria vive en RAM:** se pierde al reiniciar, y `npm run dev` reinicia en cada cambio. Para persistirla, sustituye `MemorySaver` por un checkpointer de SQLite o Postgres.
- **El historial no se recorta:** una conversación muy larga puede superar el contexto del modelo.
- **Sin autenticación:** cualquiera que conozca un `threadId` puede leer o continuar esa conversación. Úsala solo en local.
- **Swagger UI se carga desde un CDN** (unpkg), así que `/docs` necesita internet.
- **El contrato `openapi.json` se mantiene a mano:** si cambias el endpoint, actualízalo también.
