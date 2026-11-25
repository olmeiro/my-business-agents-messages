// ============================================================================
// server.ts — El servidor HTTP: la "puerta de entrada" de la API.
//
// Recibe las peticiones, valida los datos que llegan, llama al agente o al
// informe y devuelve la respuesta en JSON. Usa node:http, el servidor que ya
// trae Node, sin frameworks como Express.
//
// Rutas:
//   POST /chat          → conversación con el agente (agent.ts)
//   POST /report        → informe del clima en JSON estructurado (report.ts)
//   GET  /docs          → documentación interactiva (Swagger)
//   GET  /openapi.json  → el contrato de la API que usa Swagger
// ============================================================================

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runAgent } from './agent.ts'; // si falta la API key del proveedor, el servidor no arranca
import { weatherReport } from './report.ts';
import { currentRequestId, log, msSince, requestContext } from './log.ts';

const PORT = Number(process.env.PORT ?? 3000);
const MAX_BODY_BYTES = 10_000; // tamaño máximo del body: evita que nos manden datos enormes
const OPENAPI_SPEC = readFileSync(new URL('../openapi.json', import.meta.url), 'utf8');
// Página de Swagger: un HTML que carga Swagger UI y le dice dónde está nuestro contrato.
// shortcut: (atajo) Swagger UI se descarga de un CDN, así que /docs necesita internet.
// Para usarlo sin conexión, instala swagger-ui-dist y sírvelo desde aquí.
const SWAGGER_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Weather Agent - API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head>
<body><div id="swagger"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger' });</script>
</body></html>`;

// Esta función se ejecuta con CADA petición que llega.
createServer((req, res) => {
  // Le damos un id corto a la petición y se lo devolvemos al cliente en un header,
  // para poder buscar sus líneas en el log si algo sale mal.
  const requestId = randomUUID().slice(0, 8);
  res.setHeader('X-Request-Id', requestId);

  // Todo lo que pase dentro de run() (el agente, la herramienta...) verá este id en sus logs.
  requestContext.run({ requestId }, async () => {
    const start = performance.now();
    log('INFO', '→ request', { method: req.method, url: req.url });
    try {
      await route(req, res);
    } catch (err) {
      // Red de seguridad: si hay un error que nadie esperaba, el servidor no se cae
      // y el cliente recibe una respuesta en vez de quedarse esperando.
      log('ERROR', 'unhandled error', { error: err });
      console.error(err); // muestra el detalle completo (stack) para poder depurar
      if (!res.headersSent) send(res, 500, { error: 'Error interno', requestId });
    }
    log('INFO', '← response', { status: res.statusCode, ms: msSince(start) });
  });
}).listen(PORT, () => {
  log('INFO', 'server started', { chat: `http://localhost:${PORT}/chat`, docs: `http://localhost:${PORT}/docs`, provider: process.env.LLM_PROVIDER ?? 'groq' });
});

// Decide qué hacer según el método (GET/POST) y la URL de la petición.
async function route(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'GET' && req.url === '/openapi.json') {
    return res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(OPENAPI_SPEC);
  }
  if (req.method === 'GET' && req.url === '/docs') {
    return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(SWAGGER_HTML);
  }
  if (req.method === 'POST' && req.url === '/report') return handleReport(req, res);
  if (req.method === 'POST' && req.url === '/chat') return handleChat(req, res);
  send(res, 404, { error: 'Usa POST /chat o POST /report (docs en GET /docs)' });
}

// POST /chat → { message, threadId? }
async function handleChat(req: IncomingMessage, res: ServerResponse) {
  // 1. Leer el body. Si no viene threadId, creamos uno nuevo (= conversación nueva).
  let message: unknown, threadId: unknown;
  try {
    ({ message, threadId = randomUUID() } = (await readJson(req)) as { message?: unknown; threadId?: unknown });
  } catch {
    return send(res, 400, { error: 'Body JSON inválido' });
  }
  // 2. Validar. Nunca hay que confiar en lo que manda el cliente: comprobamos tipos y formato.
  if (typeof message !== 'string' || !message.trim()) {
    return send(res, 400, { error: 'El campo "message" (string) es obligatorio' });
  }
  if (typeof threadId !== 'string' || !/^[\w-]{1,100}$/.test(threadId)) {
    return send(res, 400, { error: '"threadId" debe ser un string de hasta 100 caracteres (letras, números, - o _)' });
  }

  // 3. Llamar al agente y responder. Devolvemos el threadId para que el cliente
  //    lo mande en el siguiente mensaje y así continúe la conversación.
  try {
    const { reply, usage } = await runAgent(message, threadId);
    send(res, 200, { reply, threadId, usage });
  } catch (err) {
    sendModelError(res, err);
  }
}

// POST /report → { city }
async function handleReport(req: IncomingMessage, res: ServerResponse) {
  let city: unknown;
  try {
    ({ city } = (await readJson(req)) as { city?: unknown });
  } catch {
    return send(res, 400, { error: 'Body JSON inválido' });
  }
  if (typeof city !== 'string' || !city.trim() || city.length > 100) {
    return send(res, 400, { error: 'El campo "city" (string, máx. 100 caracteres) es obligatorio' });
  }

  try {
    const result = await weatherReport(city);
    send(res, 'error' in result ? 404 : 200, result); // 404 si la ciudad no existe
  } catch (err) {
    sendModelError(res, err);
  }
}

// Qué hacer cuando falla la llamada al modelo (clave inválida, proveedor caído, etc.).
// El detalle completo va al log; el cliente solo recibe un mensaje seguro + el requestId,
// para no exponer información interna.
function sendModelError(res: ServerResponse, err: unknown) {
  // Los SDKs de Groq y OpenAI ponen el código HTTP del proveedor en err.status.
  const upstreamStatus = (err as { status?: number }).status;
  // Una pista para quien lee el log. Groq responde 401 si la clave es inválida; NVIDIA, 403.
  const hint = upstreamStatus === 401 || upstreamStatus === 403 ? 'revisa la API key del proveedor en .env'
    : upstreamStatus === 429 ? 'límite de peticiones del proveedor' : undefined;
  log('ERROR', 'model call failed', { upstreamStatus, hint, error: err });
  console.error(err);

  const requestId = currentRequestId();
  // 429 = "demasiadas peticiones": se lo decimos tal cual al cliente para que reintente luego.
  if (upstreamStatus === 429) return send(res, 429, { error: 'El proveedor del modelo está limitando las peticiones, inténtalo en un momento', requestId });
  // 502 = "el servidor del que dependemos falló".
  send(res, 502, { error: 'Error al consultar el modelo', requestId });
}

// Lee el body de la petición y lo convierte de JSON a objeto.
async function readJson(req: IncomingMessage): Promise<unknown> {
  // El body llega en trozos (chunks). Juntamos todos los bytes y los convertimos a texto
  // al final: si convirtiéramos trozo a trozo, una letra como "á" podría quedar partida.
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Envía una respuesta JSON. Los errores del cliente (4xx) también se registran en el log.
function send(res: ServerResponse, status: number, data: { error?: string } | object) {
  if (status >= 400 && status < 500 && 'error' in data) log('WARN', 'client error', { status, error: data.error });
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(data));
}
