// No llaman a las APIs reales: fetch está simulado (mock) con respuestas fijas.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
const groqBodies: any[] = [];

const fakeReport = {
  city: 'Madrid',
  country: 'España',
  temperatureC: 21,
  condition: 'despejado',
  feeling: 'templado',
  umbrellaNeeded: false,
  recommendation: 'Disfruta el paseo',
};

function fakeGroqReply({
  messages,
  response_format,
}: {
  messages: { role: string; content: string }[];
  response_format?: unknown;
}) {
  if (response_format) return { role: 'assistant', content: JSON.stringify(fakeReport) };
  const last = messages.at(-1)!;
  if (last.role === 'user' && last.content.includes('tiempo')) {
    return {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Madrid"}' },
        },
      ],
    };
  }
  return { role: 'assistant', content: last.role === 'tool' ? 'En Madrid hace 21 °C.' : 'ok' };
}

// El mock va ANTES de importar el agente: el SDK de Groq guarda su referencia a fetch
// al crear el modelo y no vería un cambio posterior.
mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('geocoding-api')) {
    return json({
      results: [{ name: 'Madrid', country: 'España', latitude: 40.4, longitude: -3.7 }],
    });
  }
  if (url.includes('api.open-meteo.com')) {
    return json({ current: { temperature_2m: 21 }, current_units: { temperature_2m: '°C' } });
  }
  const body = JSON.parse(String(init?.body));
  groqBodies.push(body);
  return json({
    id: 'x',
    object: 'chat.completion',
    model: 'test',
    choices: [{ index: 0, message: fakeGroqReply(body), finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  });
});

delete process.env.LLM_PROVIDER;
process.env.GROQ_API_KEY ??= 'test-key'; // ChatGroq exige una clave al crearse (aunque sea falsa)
const { runAgent, MAX_HISTORY_MESSAGES } = await import('../src/agent.ts');
const { weatherReport } = await import('../src/report.ts');
const { loadChatPrompt } = await import('../src/prompts.ts');

const userContents = () =>
  groqBodies
    .at(-1)
    .messages.filter((m: any) => m.role === 'user')
    .map((m: any) => m.content);

test('el agente usa get_weather, le pasa el resultado al modelo y suma los tokens de las 2 llamadas', async () => {
  const { reply, usage } = await runAgent('¿Qué tiempo hace en Madrid?', 'weather-thread');

  assert.equal(reply, 'En Madrid hace 21 °C.');
  assert.deepEqual(usage, { inputTokens: 200, outputTokens: 40 }); // 2 llamadas × (100 entrada + 20 salida)
  const toolMsg = groqBodies.at(-1).messages.at(-1);
  assert.equal(toolMsg.role, 'tool');
  assert.equal(toolMsg.tool_call_id, 'c1');
  assert.match(toolMsg.content, /"temperature_2m":21/);

  const system = groqBodies.at(-1).messages[0];
  assert.equal(system.role, 'system');
  assert.match(system.content, /Eres Nimbo/);
  assert.match(system.content, new RegExp(`Hoy es .*${new Date().getFullYear()}`));
  assert.doesNotMatch(system.content, /{{/, 'no deben quedar variables sin reemplazar');
});

test('loadChatPrompt falla si el prompt usa una variable que el código no envía', () => {
  // whatsapp-agent.md también usa {{today}}.
  assert.throws(() => loadChatPrompt('whatsapp-agent.md', ['assistant_name']), /today/);
});

test('el mismo threadId recuerda los mensajes anteriores; otro threadId no', async () => {
  await runAgent('Me llamo Ana', 'thread-a');
  const { usage } = await runAgent('¿Cómo me llamo?', 'thread-a');
  assert.deepEqual(userContents(), ['Me llamo Ana', '¿Cómo me llamo?']);
  assert.deepEqual(
    usage,
    { inputTokens: 100, outputTokens: 20 },
    'los tokens cuentan solo este mensaje, no los anteriores',
  );

  await runAgent('¿Cómo me llamo?', 'thread-b');
  assert.deepEqual(userContents(), ['¿Cómo me llamo?']);
});

test('en una conversación larga, al modelo solo le llegan los últimos mensajes', async () => {
  for (let i = 1; i <= 15; i++) await runAgent(`mensaje ${i}`, 'thread-largo'); // 30 mensajes guardados

  const sent = groqBodies.at(-1).messages.filter((m: any) => m.role !== 'system');
  assert.ok(sent.length <= MAX_HISTORY_MESSAGES, `llegaron ${sent.length} mensajes`);
  assert.equal(sent[0].role, 'user');
  assert.equal(sent.at(-1).content, 'mensaje 15');
});

test('weatherReport envía response_format json_schema y devuelve el informe validado', async () => {
  const result = await weatherReport('Madrid');

  assert.deepEqual(result, { report: fakeReport, usage: { inputTokens: 100, outputTokens: 20 } });
  const { response_format } = groqBodies.at(-1);
  assert.equal(response_format.type, 'json_schema');
  assert.deepEqual(
    response_format.json_schema.schema.required.sort(),
    Object.keys(fakeReport).sort(),
  );
});
