import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runAgent } from './agent.ts'; // throws at startup if the provider's API key is missing

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

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/openapi.json') {
    return res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(OPENAPI_SPEC);
  }
  if (req.method === 'GET' && req.url === '/docs') {
    return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(SWAGGER_HTML);
  }
  if (req.method !== 'POST' || req.url !== '/chat') return send(res, 404, { error: 'Usa POST /chat (docs en GET /docs)' });

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
    console.error(err);
    send(res, 502, { error: 'Error al consultar el modelo' });
  }
}).listen(PORT, () => console.log(`Agente escuchando en http://localhost:${PORT}/chat · Swagger: http://localhost:${PORT}/docs`));

async function readJson(req: IncomingMessage): Promise<unknown> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) throw new Error('Body too large');
  }
  return JSON.parse(body);
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(data));
}
