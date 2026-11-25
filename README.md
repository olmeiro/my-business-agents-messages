# Weather Agent (LangGraph + Groq / NVIDIA)

API HTTP mínima en **Node.js + TypeScript** que expone un agente conversacional construido con **LangGraph**. El agente usa un modelo de **Groq** o de **NVIDIA** (Nemotron), según `LLM_PROVIDER`, y tiene una herramienta para consultar el **clima actual** de cualquier ciudad (vía [Open-Meteo](https://open-meteo.com/), gratis y sin API key). Recuerda la conversación por `threadId` y devuelve los tokens de entrada y salida de cada respuesta.

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

1. El nodo `llm` envía el historial al modelo con la herramienta `get_weather` enlazada: `ChatGroq` para Groq, o `ChatOpenAI` apuntando al endpoint compatible con OpenAI de NVIDIA.
2. Si el modelo pide la herramienta, `toolsCondition` dirige al nodo `tools` (`ToolNode`), que la ejecuta y devuelve el resultado al modelo.
3. Se repite hasta que el modelo responde con texto. `recursionLimit: 10` corta un bucle infinito de herramientas.
4. `MemorySaver` guarda los mensajes de cada `thread_id`, así el siguiente mensaje del mismo hilo continúa la conversación.
5. Los tokens se leen de `usage_metadata` de cada respuesta del modelo en el turno y se suman.

## Requisitos

- **Node.js ≥ 23.6**: ejecuta TypeScript de forma nativa y lee `.env` con `--env-file`.
- Una API key del proveedor que vayas a usar:
  - Groq: <https://console.groq.com/keys>
  - NVIDIA: <https://build.nvidia.com/nvidia/nemotron-3.5-super-vl-120b-a12b> (botón *Get API Key*)

## Puesta en marcha

> **Windows / PowerShell:** si `npm` muestra *"la ejecución de scripts está deshabilitada en este sistema"*, usa `npm.cmd` en lugar de `npm` en todos los comandos (`npm.cmd install`, `npm.cmd run dev`...). Para arreglarlo de forma permanente, ejecuta una vez `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (no necesita permisos de administrador).

```bash
npm install
```

Copia la plantilla de variables de entorno y pon tu API key en `.env`:

```bash
cp .env.template .env               # PowerShell: Copy-Item .env.template .env
```

| Variable         | Para qué                                               |
|------------------|--------------------------------------------------------|
| `LLM_PROVIDER`   | `nvidia` o `groq` (por defecto `groq`)                  |
| `NVIDIA_API_KEY` | Obligatoria si `LLM_PROVIDER=nvidia`                    |
| `GROQ_API_KEY`   | Obligatoria si `LLM_PROVIDER=groq`                      |
| `NVIDIA_REASONING_EFFORT` | Razonamiento de Nemotron: `none` (por defecto), `low` o `high` |
| `NVIDIA_MODEL`, `GROQ_MODEL`, `PORT` | Opcionales. Los valores por defecto están en [`.env.template`](.env.template) |

`.env` está en `.gitignore`, así que tus claves no se suben al repo.

## Configurar el modelo

Todos los parámetros del modelo están en [`src/model.ts`](src/model.ts), en la función `createChatModel()`. Cambia el valor y reinicia el servidor.

| Parámetro          | Dónde             | Qué hace |
|--------------------|-------------------|----------|
| `model`            | `.env` (`NVIDIA_MODEL` / `GROQ_MODEL`) | Qué modelo se usa |
| `temperature`      | `model.ts`        | 0 = respuestas siempre iguales; más alto = más variadas. NVIDIA recomienda 1 y Groq está en 0 |
| `maxTokens`        | `model.ts`        | Máximo de tokens que el modelo escribe por llamada (2048) |
| `reasoning_effort` | `.env` (`NVIDIA_REASONING_EFFORT`) | Si Nemotron "piensa" antes de responder. Va en `modelKwargs` |

`modelKwargs` es la forma de mandar a la API parámetros para los que LangChain no tiene opción propia: se envían tal cual. Así se pasa `reasoning_effort` a NVIDIA.

**¿Razonamiento sí o no?** Para tareas sencillas como esta, `none` da respuestas igual de buenas y es mucho más barato. Medido con el mismo prompt:

| Endpoint  | `none`  | `high`    |
|-----------|---------|-----------|
| `/report` | 87 tokens de salida | 1187 tokens de salida |
| `/chat`   | 74 tokens de salida | 341 tokens de salida  |

Usa `low` o `high` para problemas que requieren varios pasos de lógica: matemáticas, planificación o código.

```bash
npm run dev     # servidor con recarga automática en http://localhost:3000
npm start       # igual, sin recarga
```

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
{
  "reply": "En Bogotá hace 17.7 °C...",
  "threadId": "4939598e-8563-4df3-aa99-514dd9d2d1a1",
  "usage": { "inputTokens": 898, "outputTokens": 422 }
}
```

`usage` suma los tokens de **este turno**: si el agente usó la herramienta hubo 2 llamadas al modelo. Los tokens de entrada de cada llamada incluyen el historial, así que crecen a medida que avanza la conversación. Con NVIDIA, los de salida incluyen los tokens de razonamiento.

Errores: `400` (JSON inválido, falta `message`, `threadId` con formato incorrecto) y `502` (fallo al llamar al modelo). Formato: `{ "error": "..." }`.

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

### `POST /report`: salida estructurada (JSON)

Ejemplo de **structured output**: en lugar de texto libre, el modelo está obligado a devolver un JSON con una forma fija. La forma se define con `zod` en [`src/report.ts`](src/report.ts), y `withStructuredOutput(..., { method: 'jsonSchema' })` la envía a la API como `response_format: { type: "json_schema" }`. Además valida la respuesta: si el modelo devolviera algo que no cumple el esquema, la petición falla en vez de llegar mal al cliente.

```bash
curl -X POST http://localhost:3000/report -H "Content-Type: application/json" -d '{"city":"Bogotá"}'
```

```json
{
  "report": {
    "city": "Bogotá",
    "country": "Colombia",
    "temperatureC": 17.3,
    "condition": "Llovizna ligera",
    "feeling": "fresco",
    "umbrellaNeeded": true,
    "recommendation": "Lleva paraguas y una chaqueta ligera."
  },
  "usage": { "inputTokens": 159, "outputTokens": 892 }
}
```

Errores: `400` (falta `city`), `404` (ciudad no encontrada), `502` (fallo del modelo).

> En PowerShell 5.1, usa `-ContentType 'application/json; charset=utf-8'` para que los acentos (á, ñ) lleguen bien.

## Logs: qué pasa en cada petición

Cada petición recibe un id corto, que aparece en todas sus líneas de log y en el header `X-Request-Id` de la respuesta. Una pregunta por el clima se ve así en la terminal:

```
INFO  [aca4f8a4] → request method=POST url=/chat
INFO  [aca4f8a4] llm ms=38885 toolCalls=get_weather inputTokens=361 outputTokens=27
INFO  [aca4f8a4] tool get_weather city=Bogotá ms=1349 found=true
INFO  [aca4f8a4] llm ms=684 toolCalls=none inputTokens=531 outputTokens=44
INFO  [aca4f8a4] agent done threadId=af0c118b-... historyMessages=4 inputTokens=892 outputTokens=71
INFO  [aca4f8a4] ← response status=200 ms=40961
```

Se lee de arriba abajo:

1. El modelo pidió la herramienta `get_weather`.
2. La herramienta consultó Open-Meteo, que tardó 1.3 s.
3. El modelo redactó la respuesta.

`historyMessages` crece con cada mensaje del mismo `threadId`: es la memoria. Y `ms` muestra dónde se va el tiempo; en este ejemplo, casi todo en la primera llamada al modelo.

**Errores:**

- **Fallo del proveedor del modelo** (por ejemplo, una API key inválida): el log muestra una línea `ERROR` con el status del proveedor, una pista (`hint`) y el stack completo. El cliente solo recibe `{"error": "...", "requestId": "..."}`; con ese `requestId` se buscan los detalles en el log.
- **Petición mal formada:** aparece como `WARN client error`.

El logger está en [`src/log.ts`](src/log.ts). Usa `AsyncLocalStorage` de Node para que el id de la petición llegue a los logs del agente y de las herramientas sin pasarlo de función en función.

## Estructura

```
src/
  server.ts       Servidor HTTP (node:http): validación de entrada, /chat, /report, /docs, /openapi.json
  model.ts        Selección del modelo (Groq o NVIDIA) y conteo de tokens
  log.ts          Logger (una línea por evento) con el id de petición vía AsyncLocalStorage
  agent.ts        Grafo LangGraph: nodo llm + ToolNode y memoria (MemorySaver)
  report.ts       Salida estructurada: esquema zod + withStructuredOutput
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
