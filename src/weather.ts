// ============================================================================
// weather.ts — La herramienta del clima que usa el agente.
//
// Una "herramienta" (tool) es una función normal de código que el modelo puede
// pedir que se ejecute. El modelo solo ve su nombre, su descripción y sus
// parámetros; con eso decide cuándo usarla y con qué valores.
//
// Los datos vienen de Open-Meteo, que es gratis y no necesita API key.
// ============================================================================

import { tool } from '@langchain/core/tools';
import * as z from 'zod';
import { log, msSince } from './log.ts';

// tool(función, descripción) convierte una función en una herramienta para el modelo.
export const weatherTool = tool(async ({ city }) => {
  const start = performance.now();
  try {
    const result = await getWeather(city);
    log(result.error ? 'WARN' : 'INFO', 'tool get_weather', { city, ms: msSince(start), found: !result.error });
    // El modelo lee texto, así que le devolvemos el resultado como JSON en un string.
    return JSON.stringify(result);
  } catch (err) {
    // Si falla (por ejemplo, Open-Meteo no responde), el ToolNode le pasa el error al modelo
    // sin avisar a nadie. Por eso lo dejamos registrado en el log antes de relanzarlo.
    log('WARN', 'tool get_weather failed, model will receive the error', { city, ms: msSince(start), error: err });
    throw err;
  }
}, {
  // Esto es lo que el modelo ve de la herramienta:
  name: 'get_weather',
  description: 'Obtiene el clima actual de una ciudad',
  // Los parámetros se definen con zod. Además, zod valida lo que envía el modelo
  // (aquí: que city sea un texto no vacío).
  schema: z.object({ city: z.string().min(1).describe('Nombre de la ciudad, p. ej. Madrid') }),
});

// Forma de las respuestas de Open-Meteo (solo los campos que usamos).
type GeoResponse = { results?: { name: string; country: string; latitude: number; longitude: number }[] };
type ForecastResponse = { current: Record<string, number | string>; current_units: Record<string, string> };

// Consulta el clima actual de una ciudad en dos pasos.
export async function getWeather(city: string) {
  // Paso 1: buscar la ciudad para obtener sus coordenadas (latitud y longitud).
  const geo = await getJson<GeoResponse>(
    `https://geocoding-api.open-meteo.com/v1/search?count=1&language=es&name=${encodeURIComponent(city)}`,
  );
  const place = geo.results?.[0];
  if (!place) return { error: `Ciudad no encontrada: ${city}` };

  // Paso 2: pedir el clima actual en esas coordenadas.
  // weather_code es un número estándar (código WMO): 0 = despejado, 51 = llovizna, etc.
  const { current, current_units } = await getJson<ForecastResponse>(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code',
  );
  return { city: place.name, country: place.country, current, units: current_units };
}

// Hace un GET y devuelve el JSON. Si tarda más de 10 segundos, se cancela.
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return res.json() as Promise<T>;
}
