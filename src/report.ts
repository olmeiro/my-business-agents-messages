// ============================================================================
// report.ts — Ejemplo de "salida estructurada" (structured output).
//
// Normalmente un modelo responde con texto libre. Con salida estructurada le
// exigimos un JSON con una forma exacta (campos, tipos y valores permitidos).
// Así el resultado se puede usar directamente desde código: guardarlo en una
// base de datos, pintarlo en una pantalla, etc.
// ============================================================================

import { HumanMessage } from '@langchain/core/messages';
import * as z from 'zod';
import { chatModel, sumUsage, type Usage } from './model.ts';
import { loadChatPrompt } from './prompts.ts';
import { getWeather } from './weather.ts';
import { log, msSince } from './log.ts';

// La forma del JSON que el modelo DEBE devolver, definida con zod.
// .describe() agrega una explicación que el modelo lee para saber qué poner en ese campo.
export const WeatherReport = z.object({
  city: z.string(),
  country: z.string(),
  temperatureC: z.number(),
  condition: z.string().describe('Estado del cielo en español, traducido del weather_code WMO (ej. "lluvia ligera")'),
  feeling: z.enum(['frío', 'fresco', 'templado', 'caluroso']), // solo puede ser uno de estos 4 valores
  umbrellaNeeded: z.boolean(),
  recommendation: z.string().describe('Un consejo breve para salir a la calle'),
});
// El tipo de TypeScript se deduce del esquema, así no lo escribimos dos veces.
export type WeatherReport = z.infer<typeof WeatherReport>;

// withStructuredOutput hace dos cosas:
//   1. Envía el esquema a la API (response_format: json_schema) para que el modelo lo respete.
//   2. Valida la respuesta con zod: si el modelo devuelve algo que no cumple el esquema,
//      lanza un error en vez de mandarle datos incorrectos al cliente.
const structuredModel = chatModel.withStructuredOutput(WeatherReport, {
  name: 'weather_report',
  method: 'jsonSchema',
  includeRaw: true, // devuelve también la respuesta "cruda", que es donde vienen los tokens
});

// Las instrucciones están en prompts/weather-report.md (este prompt no usa variables).
const promptAndModel = loadChatPrompt('weather-report.md', []).pipe(structuredModel);

// Aquí no usamos el grafo a propósito: nosotros mismos consultamos el clima,
// así que el modelo solo tiene que convertir esos datos en el informe.
export async function weatherReport(city: string): Promise<{ report: WeatherReport; usage: Usage } | { error: string }> {
  // Paso 1: consultar el clima real.
  let start = performance.now();
  const weather = await getWeather(city);
  log('INFO', 'open-meteo', { city, ms: msSince(start), found: !weather.error });
  if (weather.error) return { error: weather.error };

  // Paso 2: pedirle al modelo el informe en formato JSON.
  start = performance.now();
  const { parsed, raw } = await promptAndModel.invoke({ messages: [new HumanMessage(JSON.stringify(weather))] });
  const usage = sumUsage([raw]);
  log('INFO', 'llm structured output', { ms: msSince(start), ...usage });
  // `parsed` ya es un objeto validado con la forma de WeatherReport.
  return { report: parsed, usage };
}
