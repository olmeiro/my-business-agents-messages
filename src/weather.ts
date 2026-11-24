import { tool } from '@langchain/core/tools';
import * as z from 'zod';

// Open-Meteo: free, no API key needed.
export const weatherTool = tool(async ({ city }) => JSON.stringify(await getWeather(city)), {
  name: 'get_weather',
  description: 'Obtiene el clima actual de una ciudad',
  schema: z.object({ city: z.string().min(1).describe('Nombre de la ciudad, p. ej. Madrid') }),
});

type GeoResponse = { results?: { name: string; country: string; latitude: number; longitude: number }[] };
type ForecastResponse = { current: Record<string, number | string>; current_units: Record<string, string> };

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
