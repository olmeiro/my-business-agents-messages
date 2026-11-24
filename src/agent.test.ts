import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
const groqBodies: any[] = [];

const fakeReport = { city: 'Madrid', country: 'España', temperatureC: 21, condition: 'despejado', feeling: 'templado', umbrellaNeeded: false, recommendation: 'Disfruta el paseo' };

// Fake Groq: JSON when asked for structured output; tool call when the user mentions "tiempo"; otherwise text.
function fakeGroqReply({ messages, response_format }: { messages: { role: string; content: string }[]; response_format?: unknown }) {
  if (response_format) return { role: 'assistant', content: JSON.stringify(fakeReport) };
  const last = messages.at(-1)!;
  if (last.role === 'user' && last.content.includes('tiempo')) {
    return { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Madrid"}' } }] };
  }
  return { role: 'assistant', content: last.role === 'tool' ? 'En Madrid hace 21 °C.' : 'ok' };
}

// Mock fetch BEFORE importing the agent: groq-sdk captures fetch when ChatGroq is constructed.
mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('geocoding-api')) {
    return json({ results: [{ name: 'Madrid', country: 'España', latitude: 40.4, longitude: -3.7 }] });
  }
  if (url.includes('api.open-meteo.com')) {
    return json({ current: { temperature_2m: 21 }, current_units: { temperature_2m: '°C' } });
  }
  const body = JSON.parse(String(init?.body));
  groqBodies.push(body);
  return json({ id: 'x', object: 'chat.completion', model: 'test', choices: [{ index: 0, message: fakeGroqReply(body), finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
});

delete process.env.LLM_PROVIDER; // tests mock the Groq path
process.env.GROQ_API_KEY ??= 'test-key'; // ChatGroq needs a key when the module loads
const { runAgent } = await import('./agent.ts');
const { weatherReport } = await import('./report.ts');

const userContents = () => groqBodies.at(-1).messages.filter((m: any) => m.role === 'user').map((m: any) => m.content);

test('agent calls get_weather, feeds the result back and sums usage of both model calls', async () => {
  const { reply, usage } = await runAgent('¿Qué tiempo hace en Madrid?', 'weather-thread');

  assert.equal(reply, 'En Madrid hace 21 °C.');
  assert.deepEqual(usage, { inputTokens: 200, outputTokens: 40 });
  const toolMsg = groqBodies.at(-1).messages.at(-1);
  assert.equal(toolMsg.role, 'tool');
  assert.equal(toolMsg.tool_call_id, 'c1');
  assert.match(toolMsg.content, /"temperature_2m":21/);
});

test('same threadId remembers previous messages; another threadId does not', async () => {
  await runAgent('Me llamo Ana', 'thread-a');
  const { usage } = await runAgent('¿Cómo me llamo?', 'thread-a');
  assert.deepEqual(userContents(), ['Me llamo Ana', '¿Cómo me llamo?']);
  assert.deepEqual(usage, { inputTokens: 100, outputTokens: 20 }, 'usage counts only this turn, not earlier ones');

  await runAgent('¿Cómo me llamo?', 'thread-b');
  assert.deepEqual(userContents(), ['¿Cómo me llamo?']);
});

test('weatherReport sends a json_schema response_format and returns the parsed report', async () => {
  const result = await weatherReport('Madrid');

  assert.deepEqual(result, { report: fakeReport, usage: { inputTokens: 100, outputTokens: 20 } });
  const { response_format } = groqBodies.at(-1);
  assert.equal(response_format.type, 'json_schema');
  assert.deepEqual(response_format.json_schema.schema.required.sort(), Object.keys(fakeReport).sort());
});
