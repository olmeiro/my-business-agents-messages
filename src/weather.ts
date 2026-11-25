// Datos de Open-Meteo: gratis y sin API key.

import { tool } from '@langchain/core/tools';
import * as z from 'zod';
import { log, msSince } from './log.ts';

export const weatherTool = tool(
  async ({ city }) => {
    const start = performance.now();
    try {
      const result = await getWeather(city);
      log(result.error ? 'WARN' : 'INFO', 'tool get_weather', {
        city,
        ms: msSince(start),
        found: !result.error,
      });
      return JSON.stringify(result);
    } catch (err) {
      // ToolNode le pasa este error al modelo en silencio; sin este log no lo veríamos.
      log('WARN', 'tool get_weather failed, model will receive the error', {
        city,
        ms: msSince(start),
        error: err,
      });
      throw err;
    }
  },
  {
    // Nombre, descripción y esquema son lo único que el modelo ve de la herramienta.
    name: 'get_weather',
    description: 'Obtiene el clima actual de una ciudad',
    schema: z.object({ city: z.string().min(1).describe('Nombre de la ciudad, p. ej. Madrid') }),
  },
);

type GeoResponse = {
  results?: { name: string; country: string; latitude: number; longitude: number }[];
};
type ForecastResponse = {
  current: Record<string, number | string>;
  current_units: Record<string, string>;
};

export async function getWeather(city: string) {
  const geo = await getJson<GeoResponse>(
    `https://geocoding-api.open-meteo.com/v1/search?count=1&language=es&name=${encodeURIComponent(city)}`,
  );
  const place = geo.results?.[0];
  if (!place) return { error: `Ciudad no encontrada: ${city}` };

  const { current, current_units } = await getJson<ForecastResponse>(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code',
  );
  return { city: place.name, country: place.country, current, units: current_units };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return res.json() as Promise<T>;
}
