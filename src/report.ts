import { HumanMessage } from '@langchain/core/messages';
import * as z from 'zod';
import { chatModel, sumUsage, type Usage } from './model.ts';
import { loadChatPrompt } from './prompts.ts';
import { getWeather } from './weather.ts';
import { log, msSince } from './log.ts';

// .describe() le explica al modelo qué poner en ese campo.
export const WeatherReport = z.object({
  city: z.string(),
  country: z.string(),
  temperatureC: z.number(),
  condition: z
    .string()
    .describe('Estado del cielo en español, traducido del weather_code WMO (ej. "lluvia ligera")'),
  feeling: z.enum(['frío', 'fresco', 'templado', 'caluroso']),
  umbrellaNeeded: z.boolean(),
  recommendation: z.string().describe('Un consejo breve para salir a la calle'),
});
export type WeatherReport = z.infer<typeof WeatherReport>;

// Envía el esquema como response_format json_schema y valida la respuesta con zod:
// si el modelo no lo cumple, lanza un error en vez de devolver datos incorrectos.
const structuredModel = chatModel.withStructuredOutput(WeatherReport, {
  name: 'weather_report',
  method: 'jsonSchema',
  includeRaw: true, // la respuesta cruda es la que trae los tokens
});

const promptAndModel = loadChatPrompt('weather-report.md', []).pipe(structuredModel);

// Sin grafo a propósito: consultamos el clima nosotros y el modelo solo le da forma.
export async function weatherReport(
  city: string,
): Promise<{ report: WeatherReport; usage: Usage } | { error: string }> {
  let start = performance.now();
  const weather = await getWeather(city);
  log('INFO', 'open-meteo', { city, ms: msSince(start), found: !weather.error });
  if (weather.error) return { error: weather.error };

  start = performance.now();
  const { parsed, raw } = await promptAndModel.invoke({
    messages: [new HumanMessage(JSON.stringify(weather))],
  });
  const usage = sumUsage([raw]);
  log('INFO', 'llm structured output', { ms: msSince(start), ...usage });
  return { report: parsed, usage };
}
