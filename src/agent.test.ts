import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
const groqBodies: any[] = [];

// Fake Groq: asks for the weather tool when the user mentions "tiempo", otherwise answers with text.
function fakeGroqReply(messages: { role: string; content: string }[]) {
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
  return json({ id: 'x', object: 'chat.completion', model: 'test', choices: [{ index: 0, message: fakeGroqReply(body.messages), finish_reason: 'stop' }] });
});

process.env.GROQ_API_KEY ??= 'test-key'; // ChatGroq needs a key when the module loads
const { runAgent } = await import('./agent.ts');

const userContents = () => groqBodies.at(-1).messages.filter((m: any) => m.role === 'user').map((m: any) => m.content);

test('agent calls get_weather and feeds the result back to the model', async () => {
  const reply = await runAgent('¿Qué tiempo hace en Madrid?', 'weather-thread');

  assert.equal(reply, 'En Madrid hace 21 °C.');
  const toolMsg = groqBodies.at(-1).messages.at(-1);
  assert.equal(toolMsg.role, 'tool');
  assert.equal(toolMsg.tool_call_id, 'c1');
  assert.match(toolMsg.content, /"temperature_2m":21/);
});

test('same threadId remembers previous messages; another threadId does not', async () => {
  await runAgent('Me llamo Ana', 'thread-a');
  await runAgent('¿Cómo me llamo?', 'thread-a');
  assert.deepEqual(userContents(), ['Me llamo Ana', '¿Cómo me llamo?']);

  await runAgent('¿Cómo me llamo?', 'thread-b');
  assert.deepEqual(userContents(), ['¿Cómo me llamo?']);
});
