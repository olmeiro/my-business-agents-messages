// ============================================================================
// log.ts — Un logger mínimo para ver qué pasa dentro del servidor en cada petición.
//
// Cada línea se ve así:
//   2026-11-24T23:15:02.120Z INFO  [3f9a1c2e] llm ms=812 toolCalls=get_weather inputTokens=420
//   └── fecha y hora ───────┘ nivel └─ id ──┘ evento └── datos en formato clave=valor ──┘
//
// El id entre corchetes identifica la petición: todas las líneas de una misma
// petición llevan el mismo id, aunque lleguen varias peticiones a la vez.
// ============================================================================

import { AsyncLocalStorage } from 'node:async_hooks';

// AsyncLocalStorage es como una "mochila" que acompaña a cada petición.
// El servidor guarda ahí el id de la petición y cualquier función que se ejecute
// después (el agente, la herramienta...) puede leerlo sin recibirlo como parámetro.
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

// Devuelve el id de la petición actual (o undefined si no estamos dentro de una petición).
export function currentRequestId() {
  return requestContext.getStore()?.requestId;
}

// Niveles de log: INFO = todo normal, WARN = algo raro pero controlado, ERROR = algo falló.
type Level = 'INFO' | 'WARN' | 'ERROR';

// Escribe una línea de log. Ejemplo de uso:
//   log('INFO', 'tool get_weather', { city: 'Bogotá', ms: 1349 })
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  const kv = Object.entries(fields)
    .filter(([, v]) => v !== undefined) // los campos vacíos no se muestran
    .map(([k, v]) => ` ${k}=${format(v)}`)
    .join('');
  const line = `${new Date().toISOString()} ${level.padEnd(5)} [${currentRequestId() ?? '-'}] ${msg}${kv}`;
  // Los errores van a la salida de errores (stderr); el resto, a la salida normal (stdout).
  if (level === 'ERROR') console.error(line);
  else console.log(line);
}

// Convierte un valor a texto para el log.
function format(value: unknown): string {
  const s = value instanceof Error ? value.message : typeof value === 'string' ? value : JSON.stringify(value);
  // Si el texto tiene espacios, comillas o "=", lo ponemos entre comillas para que la línea no se confunda.
  return /[\s"=]/.test(s) ? JSON.stringify(s) : s;
}

// Milisegundos transcurridos desde `start` (que se obtiene con performance.now()).
export const msSince = (start: number) => Math.round(performance.now() - start);
