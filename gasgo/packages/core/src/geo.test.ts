import { describe, it, expect } from 'vitest';
import {
  haversineKm,
  haversineMeters,
  boundingBox,
  distanceToPolyline,
  polylineLengthMeters,
  simplifyPolyline,
  decodePolyline,
  formatDistance,
} from './geo.js';

// Referencias reales: coordenadas de ciudades españolas y distancias ortodrómicas conocidas.
const MADRID = { lat: 40.4168, lon: -3.7038 };
const MALAGA = { lat: 36.7213, lon: -4.4214 };
const BARCELONA = { lat: 41.3874, lon: 2.1686 };

describe('haversine', () => {
  it('calcula Madrid–Málaga en línea recta (≈ 416 km)', () => {
    const km = haversineKm(MADRID, MALAGA);
    expect(km).toBeGreaterThan(413);
    expect(km).toBeLessThan(419);
  });

  it('calcula Madrid–Barcelona (≈ 505 km)', () => {
    const km = haversineKm(MADRID, BARCELONA);
    expect(km).toBeGreaterThan(500);
    expect(km).toBeLessThan(510);
  });

  it('es cero para el mismo punto y simétrica', () => {
    expect(haversineMeters(MADRID, MADRID)).toBe(0);
    expect(haversineMeters(MADRID, MALAGA)).toBeCloseTo(haversineMeters(MALAGA, MADRID), 6);
  });

  it('un grado de latitud son ~111 km', () => {
    const km = haversineKm({ lat: 40, lon: -3 }, { lat: 41, lon: -3 });
    expect(km).toBeGreaterThan(110.5);
    expect(km).toBeLessThan(111.5);
  });
});

describe('boundingBox', () => {
  it('contiene todos los puntos dentro del radio', () => {
    const box = boundingBox(MADRID, 5000);
    const inside = { lat: 40.44, lon: -3.72 }; // < 5 km de Madrid centro
    expect(haversineMeters(MADRID, inside)).toBeLessThan(5000);
    expect(inside.lat).toBeGreaterThanOrEqual(box.minLat);
    expect(inside.lat).toBeLessThanOrEqual(box.maxLat);
    expect(inside.lon).toBeGreaterThanOrEqual(box.minLon);
    expect(inside.lon).toBeLessThanOrEqual(box.maxLon);
  });

  it('crece con el radio y no se sale del rango de coordenadas', () => {
    const small = boundingBox(MADRID, 1000);
    const big = boundingBox(MADRID, 50000);
    expect(big.maxLat - big.minLat).toBeGreaterThan(small.maxLat - small.minLat);
    const polar = boundingBox({ lat: 89.9, lon: 0 }, 100000);
    expect(polar.maxLat).toBeLessThanOrEqual(90);
    expect(polar.minLon).toBeGreaterThanOrEqual(-180);
  });
});

describe('distanceToPolyline', () => {
  const route = [MADRID, { lat: 39.0, lon: -3.9 }, MALAGA];

  it('devuelve ~0 para un punto sobre la ruta', () => {
    const hit = distanceToPolyline(route[1]!, route);
    expect(hit).not.toBeNull();
    expect(hit!.distanceMeters).toBeLessThan(1);
  });

  it('mide la separación perpendicular de un punto fuera de la ruta', () => {
    // Punto desplazado ~0,05° de longitud respecto a un vértice de la ruta (≈ 4,3 km).
    const off = { lat: 39.0, lon: -3.85 };
    const hit = distanceToPolyline(off, route)!;
    expect(hit.distanceMeters).toBeGreaterThan(1000);
    expect(hit.distanceMeters).toBeLessThan(6000);
  });

  it('devuelve null si la polilínea está vacía', () => {
    expect(distanceToPolyline(MADRID, [])).toBeNull();
  });

  it('la distancia acumulada crece a lo largo de la ruta', () => {
    const start = distanceToPolyline(MADRID, route)!;
    const end = distanceToPolyline(MALAGA, route)!;
    expect(end.alongRouteMeters).toBeGreaterThan(start.alongRouteMeters);
    expect(end.alongRouteMeters).toBeLessThanOrEqual(polylineLengthMeters(route) + 1);
  });
});

describe('simplifyPolyline', () => {
  it('mantiene los extremos y reduce vértices redundantes', () => {
    const dense = Array.from({ length: 100 }, (_, i) => ({
      lat: 40 + i * 0.01,
      lon: -3,
    }));
    const simplified = simplifyPolyline(dense, 150);
    expect(simplified[0]).toEqual(dense[0]);
    expect(simplified.at(-1)).toEqual(dense.at(-1));
    expect(simplified.length).toBeLessThan(dense.length);
  });

  it('conserva un vértice que se desvía más que la tolerancia', () => {
    const withSpike = [
      { lat: 40, lon: -3 },
      { lat: 40.5, lon: -2.5 }, // muy fuera de la recta
      { lat: 41, lon: -3 },
    ];
    expect(simplifyPolyline(withSpike, 150).length).toBe(3);
  });
});

describe('decodePolyline', () => {
  it('decodifica el ejemplo canónico de Google', () => {
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(points).toHaveLength(3);
    expect(points[0]!.lat).toBeCloseTo(38.5, 5);
    expect(points[0]!.lon).toBeCloseTo(-120.2, 5);
    expect(points[2]!.lat).toBeCloseTo(43.252, 5);
    expect(points[2]!.lon).toBeCloseTo(-126.453, 5);
  });
});

describe('formatDistance', () => {
  it('usa metros, un decimal con coma, y kilómetros enteros', () => {
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(1200)).toBe('1,2 km');
    expect(formatDistance(23400)).toBe('23 km');
    expect(formatDistance(-1)).toBe('—');
  });
});
