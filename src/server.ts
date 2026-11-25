import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runAgent } from './agent.ts'; // throws at startup if the provider's API key is missing
import { weatherReport } from './report.ts';
import { currentRequestId, log, msSince, requestContext } from './log.ts';

const PORT = Number(process.env.PORT ?? 3000);
const MAX_BODY_BYTES = 10_000;
const OPENAPI_SPEC = readFileSync(new URL('../openapi.json', import.meta.url), 'utf8');
// shortcut: Swagger UI loads from a CDN (needs internet); install swagger-ui-dist and serve it locally if you need offline docs.
const SWAGGER_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Weather Agent - API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head>
<body><div id="swagger"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger' });</script>
</body></html>`;

createServer((req, res) => {
  const requestId = randomUUID().slice(0, 8);
  res.setHeader('X-Request-Id', requestId); // lets the client match a response to its log lines

  // Everything inside run() — including the agent and tools — sees this requestId in its logs.
  requestContext.run({ requestId }, async () => {
    const start = performance.now();
    log('INFO', '→ request', { method: req.method, url: req.url });
    try {
      await route(req, res);
    } catch (err) {
      // Last safety net: an unexpected bug must not crash the server or leave the client hanging.
      log('ERROR', 'unhandled error', { error: err });
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: 'Error interno', requestId });
    }
    log('INFO', '← response', { status: res.statusCode, ms: msSince(start) });
  });
}).listen(PORT, () => {
  log('INFO', 'server started', { chat: `http://localhost:${PORT}/chat`, docs: `http://localhost:${PORT}/docs`, provider: process.env.LLM_PROVIDER ?? 'groq' });
});

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

async function handleChat(req: IncomingMessage, res: ServerResponse) {
  let message: unknown, threadId: unknown;
  try {
    ({ message, threadId = randomUUID() } = (await readJson(req)) as { message?: unknown; threadId?: unknown });
  } catch {
    return send(res, 400, { error: 'Body JSON inválido' });
  }
  if (typeof message !== 'string' || !message.trim()) {
    return send(res, 400, { error: 'El campo "message" (string) es obligatorio' });
  }
  if (typeof threadId !== 'string' || !/^[\w-]{1,100}$/.test(threadId)) {
    return send(res, 400, { error: '"threadId" debe ser un string de hasta 100 caracteres (letras, números, - o _)' });
  }

  try {
    // Return threadId so the client can send it back to continue the conversation.
    const { reply, usage } = await runAgent(message, threadId);
    send(res, 200, { reply, threadId, usage });
  } catch (err) {
    sendModelError(res, err);
  }
}

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
    send(res, 'error' in result ? 404 : 200, result);
  } catch (err) {
    sendModelError(res, err);
  }
}

// Full details go to the log; the client only gets a safe message plus the requestId to find them.
function sendModelError(res: ServerResponse, err: unknown) {
  const upstreamStatus = (err as { status?: number }).status; // set by the Groq/OpenAI SDKs on HTTP errors
  // Groq answers 401 to a bad key, NVIDIA answers 403.
  const hint = upstreamStatus === 401 || upstreamStatus === 403 ? 'revisa la API key del proveedor en .env'
    : upstreamStatus === 429 ? 'límite de peticiones del proveedor' : undefined;
  log('ERROR', 'model call failed', { upstreamStatus, hint, error: err });
  console.error(err);

  const requestId = currentRequestId();
  if (upstreamStatus === 429) return send(res, 429, { error: 'El proveedor del modelo está limitando las peticiones, inténtalo en un momento', requestId });
  send(res, 502, { error: 'Error al consultar el modelo', requestId });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  // Collect bytes and decode once: decoding per chunk can split a multi-byte char (á, ñ) in two.
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(res: ServerResponse, status: number, data: { error?: string } | object) {
  if (status >= 400 && status < 500 && 'error' in data) log('WARN', 'client error', { status, error: data.error });
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(data));
}
