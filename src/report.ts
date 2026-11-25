import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import * as z from 'zod';
import { chatModel, sumUsage, type Usage } from './model.ts';
import { getWeather } from './weather.ts';
import { log, msSince } from './log.ts';

// The JSON shape the model must return. Sent to the API as response_format: json_schema,
// and the reply is validated against it (an invalid reply throws instead of reaching the client).
export const WeatherReport = z.object({
  city: z.string(),
  country: z.string(),
  temperatureC: z.number(),
  condition: z.string().describe('Estado del cielo en español, traducido del weather_code WMO (ej. "lluvia ligera")'),
  feeling: z.enum(['frío', 'fresco', 'templado', 'caluroso']),
  umbrellaNeeded: z.boolean(),
  recommendation: z.string().describe('Un consejo breve para salir a la calle'),
});
export type WeatherReport = z.infer<typeof WeatherReport>;

const structuredModel = chatModel.withStructuredOutput(WeatherReport, {
  name: 'weather_report',
  method: 'jsonSchema',
  includeRaw: true, // keep the raw AIMessage to read token usage
});

// No graph here on purpose: we fetch the weather directly, so the model only has to format it.
export async function weatherReport(city: string): Promise<{ report: WeatherReport; usage: Usage } | { error: string }> {
  let start = performance.now();
  const weather = await getWeather(city);
  log('INFO', 'open-meteo', { city, ms: msSince(start), found: !weather.error });
  if (weather.error) return { error: weather.error };

  start = performance.now();
  const { parsed, raw } = await structuredModel.invoke([
    new SystemMessage('Convierte los datos meteorológicos en un informe para una persona que va a salir. Escribe todos los textos en español.'),
    new HumanMessage(JSON.stringify(weather)),
  ]);
  const usage = sumUsage([raw]);
  log('INFO', 'llm structured output', { ms: msSince(start), ...usage });
  return { report: parsed, usage };
}
