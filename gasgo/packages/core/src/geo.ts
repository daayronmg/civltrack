/** Geometría esférica y utilidades de ruta. Sin dependencias. */

export interface LatLng {
  lat: number;
  lon: number;
}

export const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Distancia ortodrómica en metros (haversine). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function haversineKm(a: LatLng, b: LatLng): number {
  return haversineMeters(a, b) / 1000;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** Caja envolvente para un radio en metros; sirve de prefiltro barato antes del cálculo exacto. */
export function boundingBox(center: LatLng, radiusMeters: number): BoundingBox {
  const latDelta = toDeg(radiusMeters / EARTH_RADIUS_M);
  const cosLat = Math.cos(toRad(center.lat));
  // Cerca de los polos el meridiano se degenera; acotamos para no dividir por ~0.
  const lonDelta = toDeg(radiusMeters / (EARTH_RADIUS_M * Math.max(cosLat, 1e-6)));
  return {
    minLat: Math.max(-90, center.lat - latDelta),
    maxLat: Math.min(90, center.lat + latDelta),
    minLon: Math.max(-180, center.lon - lonDelta),
    maxLon: Math.min(180, center.lon + lonDelta),
  };
}

/**
 * Distancia de un punto al segmento a–b, en metros.
 * Proyección equirrectangular local: el error es despreciable para segmentos de ruta
 * (< 1 % en tramos de decenas de km a latitudes de España).
 */
export function distanceToSegmentMeters(point: LatLng, a: LatLng, b: LatLng): number {
  const latRef = toRad((a.lat + b.lat) / 2);
  const mx = EARTH_RADIUS_M * Math.cos(latRef);
  const my = EARTH_RADIUS_M;

  const px = toRad(point.lon) * mx;
  const py = toRad(point.lat) * my;
  const ax = toRad(a.lon) * mx;
  const ay = toRad(a.lat) * my;
  const bx = toRad(b.lon) * mx;
  const by = toRad(b.lat) * my;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export interface PolylineHit {
  /** Distancia perpendicular a la ruta, en metros. */
  distanceMeters: number;
  /** Índice del vértice donde empieza el segmento más cercano. */
  segmentIndex: number;
  /** Distancia recorrida a lo largo de la ruta hasta la proyección, en metros. */
  alongRouteMeters: number;
}

/** Punto más cercano de una polilínea a un punto dado. */
export function distanceToPolyline(point: LatLng, polyline: readonly LatLng[]): PolylineHit | null {
  if (polyline.length === 0) return null;
  if (polyline.length === 1) {
    const only = polyline[0]!;
    return { distanceMeters: haversineMeters(point, only), segmentIndex: 0, alongRouteMeters: 0 };
  }

  let best: PolylineHit = { distanceMeters: Infinity, segmentIndex: 0, alongRouteMeters: 0 };
  let travelled = 0;

  for (let i = 0; i < polyline.length - 1; i += 1) {
    const a = polyline[i]!;
    const b = polyline[i + 1]!;
    const segmentLength = haversineMeters(a, b);
    const d = distanceToSegmentMeters(point, a, b);
    if (d < best.distanceMeters) {
      // Aproximamos la posición dentro del segmento por la proporción de distancias.
      const dA = haversineMeters(point, a);
      const ratio = segmentLength === 0 ? 0 : Math.min(1, Math.max(0, Math.sqrt(Math.max(0, dA * dA - d * d)) / segmentLength));
      best = {
        distanceMeters: d,
        segmentIndex: i,
        alongRouteMeters: travelled + ratio * segmentLength,
      };
    }
    travelled += segmentLength;
  }
  return best;
}

/** Longitud total de una polilínea, en metros. */
export function polylineLengthMeters(polyline: readonly LatLng[]): number {
  let total = 0;
  for (let i = 0; i < polyline.length - 1; i += 1) {
    total += haversineMeters(polyline[i]!, polyline[i + 1]!);
  }
  return total;
}

/**
 * Simplifica una polilínea (Douglas–Peucker) para poder mandarla al backend sin
 * transmitir miles de vértices.
 */
export function simplifyPolyline(polyline: readonly LatLng[], toleranceMeters = 150): LatLng[] {
  if (polyline.length <= 2) return [...polyline];

  const keep = new Array<boolean>(polyline.length).fill(false);
  keep[0] = true;
  keep[polyline.length - 1] = true;

  const stack: Array<[number, number]> = [[0, polyline.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i += 1) {
      const d = distanceToSegmentMeters(polyline[i]!, polyline[start]!, polyline[end]!);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > toleranceMeters) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }
  return polyline.filter((_, i) => keep[i]);
}

/** Decodifica una polilínea codificada de Google (precisión 5 por defecto). */
export function decodePolyline(encoded: string, precision = 5): LatLng[] {
  const factor = 10 ** precision;
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / factor, lon: lon / factor });
  }
  return points;
}

/** Formatea una distancia para la interfaz: «850 m», «1,2 km», «23 km». */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  const km = meters / 1000;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}
