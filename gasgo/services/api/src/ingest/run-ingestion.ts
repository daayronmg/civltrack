import {
  validatePrice,
  median,
  isFuelCode,
  type FuelCode,
  type ParsedStation,
  type SourceSnapshot,
} from '@gasgo/core';
import type { Sql } from '../db/client.js';
import { config, SOURCE_ID } from '../config.js';
import { fetchOfficialSnapshot } from './fetch-source.js';

export interface IngestionLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface IngestionSummary {
  runId: number;
  status: 'ok' | 'failed' | 'skipped';
  snapshotAt: Date | null;
  stationsSeen: number;
  stationsUpserted: number;
  stationsDeactivated: number;
  pricesAccepted: number;
  pricesChanged: number;
  pricesSuspicious: number;
  pricesRejected: number;
  unknownColumns: string[];
  durationMs: number;
  error?: string;
}

interface ExistingPrice {
  station_id: string;
  fuel: string;
  price: number;
  value_since: Date;
}

/** Medianas nacionales del volcado, por combustible: base del control de desviación. */
function nationalMedians(stations: readonly ParsedStation[]): Map<FuelCode, number> {
  const buckets = new Map<FuelCode, number[]>();
  for (const station of stations) {
    for (const [fuel, price] of Object.entries(station.prices)) {
      if (!isFuelCode(fuel) || typeof price !== 'number') continue;
      const list = buckets.get(fuel) ?? [];
      list.push(price);
      buckets.set(fuel, list);
    }
  }
  const medians = new Map<FuelCode, number>();
  for (const [fuel, values] of buckets) {
    const value = median(values);
    if (value !== null) medians.set(fuel, value);
  }
  return medians;
}

/**
 * Ejecuta una ingesta completa: descarga → parseo → validación → persistencia.
 *
 * Garantías:
 * - Idempotente: reejecutar el mismo volcado no duplica histórico ni altera `value_since`.
 * - Conservadora: si algo falla, los precios anteriores siguen publicados.
 * - Trazable: cada ejecución deja una fila en `ingestion_runs` y cada precio no publicado
 *   deja una fila en `price_anomalies`.
 */
export async function runIngestion(
  sql: Sql,
  log: IngestionLogger,
  options: { snapshotOverride?: SourceSnapshot } = {},
): Promise<IngestionSummary> {
  const started = Date.now();

  const [run] = await sql<{ id: number }[]>`
    INSERT INTO ingestion_runs (source_id, status) VALUES (${SOURCE_ID}, 'running') RETURNING id
  `;
  const runId = run!.id;

  const summary: IngestionSummary = {
    runId,
    status: 'failed',
    snapshotAt: null,
    stationsSeen: 0,
    stationsUpserted: 0,
    stationsDeactivated: 0,
    pricesAccepted: 0,
    pricesChanged: 0,
    pricesSuspicious: 0,
    pricesRejected: 0,
    unknownColumns: [],
    durationMs: 0,
  };

  try {
    let snapshot: SourceSnapshot;
    let httpStatus: number | null = null;

    if (options.snapshotOverride) {
      snapshot = options.snapshotOverride;
    } else {
      const fetched = await fetchOfficialSnapshot(log);
      snapshot = fetched.snapshot;
      httpStatus = fetched.httpStatus;
      log.info(
        `Volcado de ${snapshot.snapshotAt.toISOString()}: ${snapshot.stations.length} estaciones, ${(fetched.bytes / 1e6).toFixed(1)} MB en ${fetched.elapsedMs} ms`,
      );
    }

    summary.snapshotAt = snapshot.snapshotAt;
    summary.stationsSeen = snapshot.stations.length;
    summary.unknownColumns = snapshot.unknownPriceColumns;

    if (snapshot.unknownPriceColumns.length > 0) {
      log.warn(
        `La fuente publica productos que GASGO no conoce todavía: ${snapshot.unknownPriceColumns.join(', ')}. Añádelos a packages/core/src/fuels.ts.`,
      );
    }

    // ¿Ya procesamos este volcado exacto? Entonces no hay nada nuevo que hacer.
    const [already] = await sql<{ id: number }[]>`
      SELECT id FROM ingestion_runs
      WHERE source_id = ${SOURCE_ID}
        AND source_snapshot_at = ${snapshot.snapshotAt}
        AND status = 'ok'
      LIMIT 1
    `;
    if (already) {
      log.info(`El volcado ${snapshot.snapshotAt.toISOString()} ya estaba ingerido (run ${already.id}).`);
      summary.status = 'skipped';
      summary.durationMs = Date.now() - started;
      await sql`
        UPDATE ingestion_runs
        SET status = 'skipped', finished_at = now(), source_snapshot_at = ${snapshot.snapshotAt},
            stations_seen = ${summary.stationsSeen}, duration_ms = ${summary.durationMs},
            http_status = ${httpStatus}
        WHERE id = ${runId}
      `;
      return summary;
    }

    if (snapshot.stations.length === 0) {
      throw new Error('El volcado oficial no contiene estaciones utilizables. No se publica nada.');
    }

    const medians = nationalMedians(snapshot.stations);

    // 1) Estaciones (upsert idempotente por (source, IDEESS)).
    const stationIdBySource = new Map<string, string>();
    const CHUNK = 500;

    for (let i = 0; i < snapshot.stations.length; i += CHUNK) {
      const chunk = snapshot.stations.slice(i, i + CHUNK);
      const rows = chunk.map((s) => ({
        source_id: SOURCE_ID,
        source_station_id: s.sourceStationId,
        brand: s.brand,
        address: s.address,
        postal_code: s.postalCode,
        locality: s.locality,
        municipality: s.municipality,
        municipality_id: s.municipalityId,
        province: s.province,
        province_id: s.provinceId,
        region_id: s.regionId,
        schedule: s.schedule,
        sale_type: s.saleType,
        road_side: s.roadSide,
        lat: s.lat,
        lon: s.lon,
      }));

      const upserted = await sql<{ id: string; source_station_id: string }[]>`
        INSERT INTO stations ${sql(rows)}
        ON CONFLICT (source_id, source_station_id) DO UPDATE SET
          brand = EXCLUDED.brand,
          address = EXCLUDED.address,
          postal_code = EXCLUDED.postal_code,
          locality = EXCLUDED.locality,
          municipality = EXCLUDED.municipality,
          municipality_id = EXCLUDED.municipality_id,
          province = EXCLUDED.province,
          province_id = EXCLUDED.province_id,
          region_id = EXCLUDED.region_id,
          schedule = EXCLUDED.schedule,
          sale_type = EXCLUDED.sale_type,
          road_side = EXCLUDED.road_side,
          lat = EXCLUDED.lat,
          lon = EXCLUDED.lon,
          active = true,
          last_seen_at = now()
        RETURNING id, source_station_id
      `;
      for (const row of upserted) stationIdBySource.set(row.source_station_id, row.id);
      summary.stationsUpserted += upserted.length;
    }

    // 2) Estaciones que ya no aparecen: se desactivan, nunca se borran (preserva histórico).
    const presentIds = [...stationIdBySource.values()];
    const deactivated = await sql<{ id: string }[]>`
      UPDATE stations SET active = false
      WHERE source_id = ${SOURCE_ID} AND active = true AND id <> ALL(${presentIds}::uuid[])
      RETURNING id
    `;
    summary.stationsDeactivated = deactivated.length;

    // 3) Precios vigentes conocidos, para comparar y detectar anomalías.
    const existingRows = await sql<ExistingPrice[]>`
      SELECT station_id, fuel, price, value_since FROM station_prices
    `;
    const existing = new Map<string, ExistingPrice>();
    for (const row of existingRows) existing.set(`${row.station_id}|${row.fuel}`, row);

    // 4) Validación y persistencia.
    type PriceRow = {
      station_id: string;
      fuel: string;
      price: number;
      source_snapshot_at: Date;
      value_since: Date;
    };
    const acceptedRows: PriceRow[] = [];
    const historyRows: Array<Omit<PriceRow, 'value_since'> & { ingestion_run_id: number }> = [];
    const anomalyRows: Array<Record<string, unknown>> = [];

    for (const station of snapshot.stations) {
      const stationId = stationIdBySource.get(station.sourceStationId);
      if (!stationId) continue;

      for (const [fuelKey, price] of Object.entries(station.prices)) {
        if (!isFuelCode(fuelKey) || typeof price !== 'number') continue;
        const fuel = fuelKey;
        const previous = existing.get(`${stationId}|${fuel}`);

        const verdict = validatePrice({
          fuel,
          newPrice: price,
          previousPrice: previous?.price ?? null,
          nationalMedian: medians.get(fuel) ?? null,
        });

        if (verdict.status !== 'aceptado') {
          if (verdict.status === 'sospechoso') summary.pricesSuspicious += 1;
          else summary.pricesRejected += 1;

          anomalyRows.push({
            station_id: stationId,
            fuel,
            previous_price: previous?.price ?? null,
            new_price: price,
            status: verdict.status,
            reasons: verdict.reasons,
            detail: verdict.detail,
            source_id: SOURCE_ID,
            source_snapshot_at: snapshot.snapshotAt,
            ingestion_run_id: runId,
          });
          // El precio anterior sigue publicado: no tocamos station_prices.
          continue;
        }

        summary.pricesAccepted += 1;
        const changed = !previous || Number(previous.price) !== price;
        if (changed) {
          summary.pricesChanged += 1;
          historyRows.push({
            station_id: stationId,
            fuel,
            price,
            source_snapshot_at: snapshot.snapshotAt,
            ingestion_run_id: runId,
          });
        }

        acceptedRows.push({
          station_id: stationId,
          fuel,
          price,
          source_snapshot_at: snapshot.snapshotAt,
          // Si el valor no ha cambiado conservamos desde cuándo lo vimos por primera vez.
          value_since: changed ? snapshot.snapshotAt : previous!.value_since,
        });
      }
    }

    for (let i = 0; i < acceptedRows.length; i += CHUNK) {
      const chunk = acceptedRows.slice(i, i + CHUNK);
      await sql`
        INSERT INTO station_prices ${sql(chunk)}
        ON CONFLICT (station_id, fuel) DO UPDATE SET
          price = EXCLUDED.price,
          source_snapshot_at = EXCLUDED.source_snapshot_at,
          value_since = EXCLUDED.value_since,
          updated_at = now()
      `;
    }

    for (let i = 0; i < historyRows.length; i += CHUNK) {
      const chunk = historyRows.slice(i, i + CHUNK);
      await sql`
        INSERT INTO price_history ${sql(chunk)}
        ON CONFLICT (station_id, fuel, source_snapshot_at) DO NOTHING
      `;
    }

    for (let i = 0; i < anomalyRows.length; i += CHUNK) {
      const chunk = anomalyRows.slice(i, i + CHUNK);
      await sql`INSERT INTO price_anomalies ${sql(chunk as never)}`;
    }

    summary.status = 'ok';
    summary.durationMs = Date.now() - started;

    await sql`
      UPDATE ingestion_runs SET
        status = 'ok',
        finished_at = now(),
        source_snapshot_at = ${snapshot.snapshotAt},
        http_status = ${httpStatus},
        stations_seen = ${summary.stationsSeen},
        stations_upserted = ${summary.stationsUpserted},
        stations_deactivated = ${summary.stationsDeactivated},
        prices_accepted = ${summary.pricesAccepted},
        prices_changed = ${summary.pricesChanged},
        prices_rejected = ${summary.pricesRejected},
        prices_suspicious = ${summary.pricesSuspicious},
        unknown_columns = ${snapshot.unknownPriceColumns},
        problems = ${snapshot.problems.slice(0, 200)},
        duration_ms = ${summary.durationMs}
      WHERE id = ${runId}
    `;

    log.info(
      `Ingesta OK: ${summary.stationsUpserted} estaciones, ${summary.pricesChanged} precios cambiados, ` +
        `${summary.pricesSuspicious} sospechosos, ${summary.pricesRejected} rechazados (${summary.durationMs} ms)`,
    );
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summary.status = 'failed';
    summary.error = message;
    summary.durationMs = Date.now() - started;
    log.error(`Ingesta fallida: ${message}`);
    await sql`
      UPDATE ingestion_runs
      SET status = 'failed', finished_at = now(), error = ${message}, duration_ms = ${summary.durationMs}
      WHERE id = ${runId}
    `;
    return summary;
  }
}

export { config };
