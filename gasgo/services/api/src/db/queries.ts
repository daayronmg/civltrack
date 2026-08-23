/**
 * Consultas geoespaciales de GASGO.
 * Toda la interpolación va por parámetros de `postgres` (no hay SQL construido a mano).
 */

import type { FuelCode, StationSummary, StationDetail, PriceHistory } from '@gasgo/core';
import type { Sql } from './client.js';

export interface NearbyParams {
  lat: number;
  lon: number;
  radiusMeters: number;
  fuel: FuelCode;
  limit: number;
  /** Incluir estaciones de venta restringida (cooperativas/flotas). */
  includeRestricted?: boolean;
  /** Filtrar por rótulo (marca). */
  brands?: string[];
  /** `true` para ordenar por precio; si no, por distancia. */
  orderBy?: 'precio' | 'distancia';
}

interface NearbyRow {
  id: string;
  source_station_id: string;
  brand: string;
  address: string;
  municipality: string;
  province: string;
  lat: number;
  lon: number;
  schedule: string | null;
  sale_type: string | null;
  distance_meters: number;
  price: number | null;
  source_snapshot_at: Date | null;
  value_since: Date | null;
}

function toSummary(row: NearbyRow, fuel: FuelCode): StationSummary {
  return {
    id: row.id,
    sourceStationId: row.source_station_id,
    brand: row.brand,
    address: row.address,
    municipality: row.municipality,
    province: row.province,
    lat: row.lat,
    lon: row.lon,
    schedule: row.schedule,
    publicSale: row.sale_type !== 'R',
    distanceMeters: Math.round(row.distance_meters),
    price:
      row.price !== null && row.source_snapshot_at
        ? {
            fuel,
            price: Number(row.price),
            snapshotAt: row.source_snapshot_at.toISOString(),
            valueSince: row.value_since ? row.value_since.toISOString() : null,
          }
        : null,
  };
}

/**
 * Estaciones dentro de un radio que venden el combustible pedido.
 * Usa el índice GIST sobre `geog` (ST_DWithin) — no recorre España entera.
 */
export async function findNearbyStations(
  sql: Sql,
  params: NearbyParams,
): Promise<StationSummary[]> {
  const { lat, lon, radiusMeters, fuel, limit } = params;
  const includeRestricted = params.includeRestricted ?? false;
  const brands = params.brands ?? [];
  const orderByPrice = params.orderBy === 'precio';

  const rows = await sql<NearbyRow[]>`
    SELECT
      s.id,
      s.source_station_id,
      s.brand,
      s.address,
      s.municipality,
      s.province,
      s.lat,
      s.lon,
      s.schedule,
      s.sale_type,
      ST_Distance(s.geog, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography) AS distance_meters,
      p.price,
      p.source_snapshot_at,
      p.value_since
    FROM stations s
    JOIN station_prices p ON p.station_id = s.id AND p.fuel = ${fuel}
    WHERE s.active
      AND ST_DWithin(s.geog, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, ${radiusMeters})
      ${includeRestricted ? sql`` : sql`AND (s.sale_type IS NULL OR s.sale_type <> 'R')`}
      ${brands.length > 0 ? sql`AND s.brand = ANY(${brands})` : sql``}
    ORDER BY ${orderByPrice ? sql`p.price ASC, distance_meters ASC` : sql`distance_meters ASC`}
    LIMIT ${limit}
  `;

  return rows.map((row) => toSummary(row, fuel));
}

/** Estaciones dentro de un rectángulo del mapa (para el viewport, con tope de resultados). */
export async function findStationsInBox(
  sql: Sql,
  params: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
    fuel: FuelCode;
    limit: number;
    includeRestricted?: boolean;
  },
): Promise<StationSummary[]> {
  const centreLat = (params.minLat + params.maxLat) / 2;
  const centreLon = (params.minLon + params.maxLon) / 2;

  const rows = await sql<NearbyRow[]>`
    SELECT
      s.id, s.source_station_id, s.brand, s.address, s.municipality, s.province,
      s.lat, s.lon, s.schedule, s.sale_type,
      ST_Distance(s.geog, ST_SetSRID(ST_MakePoint(${centreLon}, ${centreLat}), 4326)::geography) AS distance_meters,
      p.price, p.source_snapshot_at, p.value_since
    FROM stations s
    JOIN station_prices p ON p.station_id = s.id AND p.fuel = ${params.fuel}
    WHERE s.active
      AND s.geog && ST_MakeEnvelope(${params.minLon}, ${params.minLat}, ${params.maxLon}, ${params.maxLat}, 4326)::geography
      ${params.includeRestricted ? sql`` : sql`AND (s.sale_type IS NULL OR s.sale_type <> 'R')`}
    ORDER BY p.price ASC
    LIMIT ${params.limit}
  `;
  return rows.map((row) => toSummary(row, params.fuel));
}

/**
 * Estaciones próximas a una ruta. La ruta llega como polilínea simplificada;
 * PostGIS calcula la distancia real al trazado con el índice espacial.
 */
export async function findStationsAlongRoute(
  sql: Sql,
  params: {
    polyline: Array<{ lat: number; lon: number }>;
    corridorMeters: number;
    fuel: FuelCode;
    limit: number;
    includeRestricted?: boolean;
  },
): Promise<Array<StationSummary & { alongRouteMeters: number }>> {
  const wkt = `LINESTRING(${params.polyline.map((p) => `${p.lon} ${p.lat}`).join(',')})`;

  const rows = await sql<Array<NearbyRow & { along_route_meters: number }>>`
    WITH route AS (
      SELECT ST_GeogFromText(${wkt}) AS g,
             ST_SetSRID(ST_GeomFromText(${wkt}), 4326) AS geom
    )
    SELECT
      s.id, s.source_station_id, s.brand, s.address, s.municipality, s.province,
      s.lat, s.lon, s.schedule, s.sale_type,
      ST_Distance(s.geog, route.g) AS distance_meters,
      ST_LineLocatePoint(route.geom, ST_SetSRID(ST_MakePoint(s.lon, s.lat), 4326))
        * ST_Length(route.g) AS along_route_meters,
      p.price, p.source_snapshot_at, p.value_since
    FROM stations s
    JOIN station_prices p ON p.station_id = s.id AND p.fuel = ${params.fuel}
    CROSS JOIN route
    WHERE s.active
      AND ST_DWithin(s.geog, route.g, ${params.corridorMeters})
      ${params.includeRestricted ? sql`` : sql`AND (s.sale_type IS NULL OR s.sale_type <> 'R')`}
    ORDER BY p.price ASC
    LIMIT ${params.limit}
  `;

  return rows.map((row) => ({
    ...toSummary(row, params.fuel),
    alongRouteMeters: Math.round(row.along_route_meters),
  }));
}

interface DetailRow {
  id: string;
  source_station_id: string;
  brand: string;
  address: string;
  postal_code: string | null;
  locality: string | null;
  municipality: string;
  province: string;
  lat: number;
  lon: number;
  schedule: string | null;
  sale_type: string | null;
  active: boolean;
}

export async function getStationDetail(
  sql: Sql,
  stationId: string,
  origin?: { lat: number; lon: number },
): Promise<StationDetail | null> {
  const [station] = await sql<DetailRow[]>`
    SELECT id, source_station_id, brand, address, postal_code, locality, municipality,
           province, lat, lon, schedule, sale_type, active
    FROM stations WHERE id = ${stationId}
  `;
  if (!station) return null;

  const prices = await sql<
    Array<{ fuel: string; price: number; source_snapshot_at: Date; value_since: Date }>
  >`
    SELECT fuel, price, source_snapshot_at, value_since
    FROM station_prices WHERE station_id = ${stationId}
    ORDER BY fuel
  `;

  const distanceMeters = origin
    ? (
        await sql<Array<{ d: number }>>`
          SELECT ST_Distance(geog, ST_SetSRID(ST_MakePoint(${origin.lon}, ${origin.lat}), 4326)::geography) AS d
          FROM stations WHERE id = ${stationId}
        `
      )[0]!.d
    : null;

  return {
    id: station.id,
    sourceStationId: station.source_station_id,
    brand: station.brand,
    address: station.address,
    postalCode: station.postal_code,
    locality: station.locality,
    municipality: station.municipality,
    province: station.province,
    lat: station.lat,
    lon: station.lon,
    schedule: station.schedule,
    publicSale: station.sale_type !== 'R',
    distanceMeters: distanceMeters === null ? null : Math.round(distanceMeters),
    prices: prices.map((p) => ({
      fuel: p.fuel as FuelCode,
      price: Number(p.price),
      snapshotAt: p.source_snapshot_at.toISOString(),
      valueSince: p.value_since.toISOString(),
    })),
  };
}

/**
 * Histórico real de una estación y combustible.
 * Los valores de «hace 24 h / 7 d / 30 d» son el último precio conocido ANTES de ese momento;
 * si GASGO todavía no existía entonces, se devuelve `null` (no se inventa nada).
 */
export async function getPriceHistory(
  sql: Sql,
  stationId: string,
  fuel: FuelCode,
  days = 30,
): Promise<PriceHistory> {
  const points = await sql<Array<{ source_snapshot_at: Date; price: number }>>`
    SELECT source_snapshot_at, price
    FROM price_history
    WHERE station_id = ${stationId} AND fuel = ${fuel}
      AND source_snapshot_at >= now() - (${days} || ' days')::interval
    ORDER BY source_snapshot_at ASC
  `;

  const [current] = await sql<Array<{ price: number }>>`
    SELECT price FROM station_prices WHERE station_id = ${stationId} AND fuel = ${fuel}
  `;

  const priceAt = async (interval: string): Promise<number | null> => {
    const [row] = await sql<Array<{ price: number }>>`
      SELECT price FROM price_history
      WHERE station_id = ${stationId} AND fuel = ${fuel}
        AND source_snapshot_at <= now() - ${interval}::interval
      ORDER BY source_snapshot_at DESC
      LIMIT 1
    `;
    return row ? Number(row.price) : null;
  };

  const [firstRow] = await sql<Array<{ first_at: Date | null }>>`
    SELECT min(source_snapshot_at) AS first_at FROM price_history
    WHERE station_id = ${stationId} AND fuel = ${fuel}
  `;

  return {
    fuel,
    current: current ? Number(current.price) : null,
    ago24h: await priceAt('24 hours'),
    ago7d: await priceAt('7 days'),
    ago30d: await priceAt('30 days'),
    points: points.map((p) => ({ at: p.source_snapshot_at.toISOString(), price: Number(p.price) })),
    historySince: firstRow?.first_at ? firstRow.first_at.toISOString() : null,
  };
}

export interface SourceStatus {
  lastSnapshotAt: Date | null;
  lastIngestedAt: Date | null;
  stationCount: number;
  attribution: string;
  licence: string;
  url: string;
  name: string;
}

export async function getSourceStatus(sql: Sql, sourceId: string): Promise<SourceStatus> {
  const [source] = await sql<
    Array<{ name: string; url: string; attribution: string; licence: string }>
  >`SELECT name, url, attribution, licence FROM data_sources WHERE id = ${sourceId}`;

  const [run] = await sql<Array<{ source_snapshot_at: Date | null; finished_at: Date | null }>>`
    SELECT source_snapshot_at, finished_at FROM ingestion_runs
    WHERE source_id = ${sourceId} AND status = 'ok'
    ORDER BY source_snapshot_at DESC NULLS LAST
    LIMIT 1
  `;

  const [count] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM stations WHERE source_id = ${sourceId} AND active
  `;

  return {
    lastSnapshotAt: run?.source_snapshot_at ?? null,
    lastIngestedAt: run?.finished_at ?? null,
    stationCount: count?.n ?? 0,
    attribution: source?.attribution ?? '',
    licence: source?.licence ?? '',
    url: source?.url ?? '',
    name: source?.name ?? '',
  };
}
