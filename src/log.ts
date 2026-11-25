import { AsyncLocalStorage } from 'node:async_hooks';

// Guarda el id de la petición actual para que los logs del agente y las herramientas
// lo incluyan sin tener que pasarlo como parámetro por todas las funciones.
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

export function currentRequestId() {
  return requestContext.getStore()?.requestId;
}

type Level = 'INFO' | 'WARN' | 'ERROR';

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  const kv = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}=${format(v)}`)
    .join('');
  const line = `${new Date().toISOString()} ${level.padEnd(5)} [${currentRequestId() ?? '-'}] ${msg}${kv}`;
  if (level === 'ERROR') console.error(line);
  else console.log(line);
}

function format(value: unknown): string {
  const s =
    value instanceof Error
      ? value.message
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);
  // Entre comillas si tiene espacios, para que la línea siga siendo clave=valor.
  return /[\s"=]/.test(s) ? JSON.stringify(s) : s;
}

export const msSince = (start: number) => Math.round(performance.now() - start);
