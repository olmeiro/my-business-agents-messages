import { AsyncLocalStorage } from 'node:async_hooks';

// Holds the current request id so any log line deep in the call stack (agent, tools)
// can include it without passing it through every function.
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

export function currentRequestId() {
  return requestContext.getStore()?.requestId;
}

type Level = 'INFO' | 'WARN' | 'ERROR';

// One line per event, logfmt style: readable in the terminal and easy to grep or parse.
//   2026-11-24T23:15:02.120Z INFO  [3f9a1c2e] llm ms=812 toolCalls=get_weather inputTokens=420
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
  const s = value instanceof Error ? value.message : typeof value === 'string' ? value : JSON.stringify(value);
  return /[\s"=]/.test(s) ? JSON.stringify(s) : s; // quote values with spaces so the line stays parseable
}

export const msSince = (start: number) => Math.round(performance.now() - start);
