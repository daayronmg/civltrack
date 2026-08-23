/**
 * Geocodificación y cálculo de ruta.
 *
 * Se usan servicios abiertos (Nominatim + OSRM) sin clave de API. Estos servicios aportan
 * SOLO la geometría del trayecto: los precios vienen siempre de nuestro backend, es decir,
 * de la fuente oficial del Ministerio.
 *
 * Nota operativa: las instancias públicas de Nominatim y OSRM tienen políticas de uso
 * estrictas (1 petición/segundo, User-Agent identificable) y no ofrecen garantía de
 * servicio. Para producción hay que alojar la propia instancia o contratar un proveedor;
 * queda anotado en docs/06-estado-implementacion.md.
 */

import type { LatLng } from './types';

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OSRM = 'https://router.project-osrm.org';
const USER_AGENT = 'GASGO/1.0 (app de precios de carburante)';

export interface GeocodeResult extends LatLng {
  label: string;
}

export async function geocode(query: string): Promise<GeocodeResult | null> {
  const url = `${NOMINATIM}/search?format=json&limit=1&countrycodes=es&q=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (!response.ok) return null;

    const results = (await response.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    const first = results[0];
    if (!first) return null;

    return {
      lat: Number(first.lat),
      lon: Number(first.lon),
      label: first.display_name,
    };
  } catch {
    return null;
  }
}

export interface Route {
  polyline: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
}

export async function routeBetween(from: LatLng, to: LatLng): Promise<Route | null> {
  const url = `${OSRM}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=simplified&geometries=geojson`;
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      code: string;
      routes?: Array<{
        distance: number;
        duration: number;
        geometry: { coordinates: Array<[number, number]> };
      }>;
    };

    const route = payload.routes?.[0];
    if (payload.code !== 'Ok' || !route) return null;

    return {
      // GeoJSON viene como [lon, lat].
      polyline: route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
      distanceMeters: route.distance,
      durationSeconds: route.duration,
    };
  } catch {
    return null;
  }
}
