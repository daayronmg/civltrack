import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { parseSourceResponse } from '@gasgo/core';
import { runIngestion } from '../src/ingest/run-ingestion.js';
import { createTestSql, setupDatabase, truncateAll, buildSourcePayload, type TestSql } from './helpers.js';

const silent = { info: () => {}, warn: () => {}, error: () => {} };

let sql: TestSql;

beforeAll(async () => {
  sql = createTestSql();
  await setupDatabase(sql);
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

beforeEach(async () => {
  await truncateAll(sql);
});

/** Ingiere un payload con la estructura oficial, sin tocar la red. */
async function ingest(payload: Record<string, unknown>) {
  return runIngestion(sql as never, silent, { snapshotOverride: parseSourceResponse(payload) });
}

const MADRID_LAT = '40,416775';
const MADRID_LON = '-3,703790';

describe('ingesta: primer volcado', () => {
  it('guarda estaciones y precios exactamente como los publica la fuente', async () => {
    const summary = await ingest(
      buildSourcePayload({
        fecha: '12/03/2026 18:40:11',
        stations: [
          {
            id: '1001',
            rotulo: 'MARCA A',
            lat: MADRID_LAT,
            lon: MADRID_LON,
            precios: { 'Precio Gasolina 95 E5': '1,489', 'Precio Gasoleo A': '1,399' },
          },
        ],
      }),
    );

    expect(summary.status).toBe('ok');
    expect(summary.stationsUpserted).toBe(1);
    expect(summary.pricesAccepted).toBe(2);
    expect(summary.pricesChanged).toBe(2);

    const prices = await sql`SELECT fuel, price FROM station_prices ORDER BY fuel`;
    expect(prices).toHaveLength(2);
    // FIDELIDAD: el número almacenado devuelve el mismo texto que publicó la fuente.
    expect(Number(prices[0]!.price).toFixed(3).replace('.', ',')).toBe('1,489');
    expect(Number(prices[1]!.price).toFixed(3).replace('.', ',')).toBe('1,399');
  });

  it('guarda la marca de tiempo oficial del volcado, no la hora de ingesta', async () => {
    await ingest(
      buildSourcePayload({
        fecha: '12/03/2026 18:40:11',
        stations: [
          { id: '1001', rotulo: 'A', lat: MADRID_LAT, lon: MADRID_LON, precios: { 'Precio Gasoleo A': '1,399' } },
        ],
      }),
    );
    const [price] = await sql<Array<{ source_snapshot_at: Date }>>`
      SELECT source_snapshot_at FROM station_prices
    `;
    expect(price!.source_snapshot_at.toISOString()).toBe('2026-03-12T17:40:11.000Z');
  });

  it('calcula la geometría PostGIS a partir de las coordenadas oficiales', async () => {
    await ingest(
      buildSourcePayload({
        fecha: '12/03/2026 18:40:11',
        stations: [
          { id: '1001', rotulo: 'A', lat: MADRID_LAT, lon: MADRID_LON, precios: { 'Precio Gasoleo A': '1,399' } },
        ],
      }),
    );
    const [row] = await sql<Array<{ lat: number; lon: number; has_geog: boolean }>>`
      SELECT lat, lon, geog IS NOT NULL AS has_geog FROM stations
    `;
    expect(row!.has_geog).toBe(true);
    expect(row!.lat).toBeCloseTo(40.416775, 6);
    expect(row!.lon).toBeCloseTo(-3.70379, 6);
  });
});

describe('ingesta: idempotencia y cambios', () => {
  const primerVolcado = buildSourcePayload({
    fecha: '12/03/2026 10:00:00',
    stations: [
      { id: '1001', rotulo: 'A', lat: MADRID_LAT, lon: MADRID_LON, precios: { 'Precio Gasoleo A': '1,399' } },
    ],
  });

  it('reejecutar el mismo volcado no duplica nada', async () => {
    await ingest(primerVolcado);
    const segunda = await ingest(primerVolcado);

    expect(segunda.status).toBe('skipped');
    const [{ n }] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM price_history`;
    expect(n).toBe(1);
  });

  it('un volcado nuevo con el mismo precio no crea histórico ni mueve «value_since»', async () => {
    await ingest(primerVolcado);
    const [antes] = await sql<Array<{ value_since: Date }>>`SELECT value_since FROM station_prices`;

    const summary = await ingest(
      buildSourcePayload({
        fecha: '12/03/2026 11:00:00',
        stations: [
          { id: '1001', rotulo: 'A', lat: MADRID_LAT, lon: MADRID_LON, precios: { 'Precio Gasoleo A': '1,399' } },
        ],
      }),
    );

    expect(summary.pricesChanged).toBe(0);
    const [despues] = await sql<Array<{ value_since: Date; source_snapshot_at: Date }>>`
      SELECT value_since, source_snapshot_at FROM station_prices
    `;
    // El valor sigue siendo el mismo desde el primer volcado…
    expect(despues!.value_since.toISOString()).toBe(antes!.value_since.toISOString());
    // …pero la confirmación es la del volcado nuevo.
    expect(despues!.source_snapshot_at.toISOString()).toBe('2026-03-12T10:00:00.000Z');
    const [{ n }] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM price_history`;
    expect(n).toBe(1);
  });

  it('un cambio de precio crea histórico y actualiza «value_since»', async () => {
    await ingest(primerVolcado);
    const summary = await ingest(
      buildSourcePayload({
        fecha: '12/03/2026 12:00:00',
        stations: [
          { id: '1001', rotulo: 'A', lat: MADRID_LAT, lon: MADRID_LON, precios: { 'Precio Gasoleo A': '1,429' } },
        ],
      }),
    );

    expect(summary.pricesChanged).toBe(1);
    const history = await sql`SELECT price FROM price_history ORDER BY source_snapshot_at`;
    expect(history.map((r) => Number(r.price))).toEqual([1.399, 1.429]);

    const [current] = await sql<Array<{ price: number; value_since: Date }>>`
      SELECT price, value_since FROM station_prices
    `;
    expect(Number(current!.price)).toBe(1.429);
    expect(current!.value_since.toISOString()).toBe('2026-03-12T11:00:00.000Z');
  });

  it('una estación que desaparece del volcado se desactiva, no se borra', async () => {
    await ingest(primerVolcado);
    const summary = await ingest(
      buildSourcePayload({
        fecha: '12/03/2026 13:00:00',
        stations: [
          { id: '2002', rotulo: 'B', lat: '40,5', lon: '-3,7', precios: { 'Precio Gasoleo A': '1,359' } },
        ],
      }),
    );

    expect(summary.stationsDeactivated).toBe(1);
    const stations = await sql<Array<{ source_station_id: string; active: boolean }>>`
      SELECT source_station_id, active FROM stations ORDER BY source_station_id
    `;
    expect(stations).toHaveLength(2);
    expect(stations.find((s) => s.source_station_id === '1001')!.active).toBe(false);
    // El histórico de la estación desactivada sigue ahí.
    const [{ n }] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM price_history`;
    expect(n).toBe(2);
  });

  it('una estación que reaparece se reactiva', async () => {
    await ingest(primerVolcado);
    await ingest(
      buildSourcePayload({
        fecha: '12/03/2026 13:00:00',
        stations: [{ id: '2002', rotulo: 'B', lat: '40,5', lon: '-3,7', precios: { 'Precio Gasoleo A': '1,359' } }],
      }),
    );
    await ingest(
      buildSourcePayload({
        fecha: '12/03/2026 14:00:00',
        stations: [
          { id: '1001', rotulo: 'A', lat: MADRID_LAT, lon: MADRID_LON, precios: { 'Precio Gasoleo A': '1,399' } },
        ],
      }),
    );
    const [row] = await sql<Array<{ active: boolean }>>`
      SELECT active FROM stations WHERE source_station_id = '1001'
    `;
    expect(row!.active).toBe(true);
  });
});

describe('ingesta: sistema antierrores', () => {
  it('NO publica el decimal desplazado del enunciado y conserva el precio anterior', async () => {
    await ingest(
      buildSourcePayload({
        fecha: '12/03/2026 10:00:00',
        stations: [
          { id: '1001', rotulo: 'A', lat: MADRID_LAT, lon: MADRID_LON, precios: { 'Precio Gasolina 95 E5': '1,489' } },
        ],
      }),
    );

    const summary = await ingest(
      buildSourcePayload({
        fecha: '12/03/2026 11:00:00',
        stations: [
          { id: '1001', rotulo: 'A', lat: MADRID_LAT, lon: MADRID_LON, precios: { 'Precio Gasolina 95 E5': '0,149' } },
        ],
      }),
    );

    expect(summary.pricesRejected).toBe(1);
    expect(summary.pricesAccepted).toBe(0);

    // El precio publicado sigue siendo el válido.
    const [price] = await sql<Array<{ price: number }>>`SELECT price FROM station_prices`;
    expect(Number(price!.price)).toBe(1.489);
  });

  it('registra la anomalía con precio anterior, nuevo, motivo, fuente y fecha', async () => {
    await ingest(
      buildSourcePayload({
        fecha: '12/03/2026 10:00:00',
        stations: [
          { id: '1001', rotulo: 'A', lat: MADRID_LAT, lon: MADRID_LON, precios: { 'Precio Gasolina 95 E5': '1,489' } },
        ],
      }),
    );
    await ingest(
      buildSourcePayload({
        fecha: '12/03/2026 11:00:00',
        stations: [
          { id: '1001', rotulo: 'A', lat: MADRID_LAT, lon: MADRID_LON, precios: { 'Precio Gasolina 95 E5': '0,149' } },
        ],
      }),
    );

    const [anomaly] = await sql<
      Array<{
        previous_price: number;
        new_price: number;
        status: string;
        reasons: string[];
        detail: string;
        source_id: string;
        source_snapshot_at: Date;
      }>
    >`SELECT * FROM price_anomalies`;

    expect(Number(anomaly!.previous_price)).toBe(1.489);
    expect(Number(anomaly!.new_price)).toBe(0.149);
    expect(anomaly!.status).toBe('rechazado');
    expect(anomaly!.reasons).toContain('posible_error_decimal');
    expect(anomaly!.detail.length).toBeGreaterThan(10);
    expect(anomaly!.source_id).toBe('miteco_eess_terrestres');
    expect(anomaly!.source_snapshot_at.toISOString()).toBe('2026-03-12T10:00:00.000Z');
  });

  it('marca como sospechoso un salto grande pero plausible, sin publicarlo', async () => {
    await ingest(
      buildSourcePayload({
        fecha: '12/03/2026 10:00:00',
        stations: [
          { id: '1001', rotulo: 'A', lat: MADRID_LAT, lon: MADRID_LON, precios: { 'Precio Gasoleo A': '1,400' } },
        ],
      }),
    );
    const summary = await ingest(
      buildSourcePayload({
        fecha: '12/03/2026 11:00:00',
        stations: [
          { id: '1001', rotulo: 'A', lat: MADRID_LAT, lon: MADRID_LON, precios: { 'Precio Gasoleo A': '1,900' } },
        ],
      }),
    );

    expect(summary.pricesSuspicious).toBe(1);
    const [price] = await sql<Array<{ price: number }>>`SELECT price FROM station_prices`;
    expect(Number(price!.price)).toBe(1.4);
    const [anomaly] = await sql<Array<{ status: string }>>`SELECT status FROM price_anomalies`;
    expect(anomaly!.status).toBe('sospechoso');
  });

  it('un producto que la estación deja de vender no se convierte en precio 0', async () => {
    await ingest(
      buildSourcePayload({
        fecha: '12/03/2026 10:00:00',
        stations: [
          {
            id: '1001',
            rotulo: 'A',
            lat: MADRID_LAT,
            lon: MADRID_LON,
            precios: { 'Precio Gasoleo A': '1,399', 'Precio Gases licuados del petróleo': '' },
          },
        ],
      }),
    );
    const prices = await sql<Array<{ fuel: string }>>`SELECT fuel FROM station_prices`;
    expect(prices.map((p) => p.fuel)).toEqual(['GOA']);
  });
});

describe('ingesta: trazabilidad', () => {
  it('cada ejecución deja registro con contadores y columnas desconocidas', async () => {
    const payload = buildSourcePayload({
      fecha: '12/03/2026 10:00:00',
      stations: [
        { id: '1001', rotulo: 'A', lat: MADRID_LAT, lon: MADRID_LON, precios: { 'Precio Gasoleo A': '1,399' } },
      ],
    });
    (payload.ListaEESSPrecio as Array<Record<string, unknown>>)[0]!['Precio Combustible Nuevo'] = '2,100';

    const summary = await ingest(payload);
    expect(summary.unknownColumns).toContain('Precio Combustible Nuevo');

    const [run] = await sql<
      Array<{ status: string; stations_seen: number; unknown_columns: string[]; duration_ms: number }>
    >`SELECT status, stations_seen, unknown_columns, duration_ms FROM ingestion_runs ORDER BY id DESC LIMIT 1`;

    expect(run!.status).toBe('ok');
    expect(run!.stations_seen).toBe(1);
    expect(run!.unknown_columns).toContain('Precio Combustible Nuevo');
    expect(run!.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('un volcado sin estaciones utilizables falla y no borra los precios anteriores', async () => {
    await ingest(
      buildSourcePayload({
        fecha: '12/03/2026 10:00:00',
        stations: [
          { id: '1001', rotulo: 'A', lat: MADRID_LAT, lon: MADRID_LON, precios: { 'Precio Gasoleo A': '1,399' } },
        ],
      }),
    );

    const summary = await ingest(buildSourcePayload({ fecha: '12/03/2026 11:00:00', stations: [] }));
    expect(summary.status).toBe('failed');

    const [price] = await sql<Array<{ price: number }>>`SELECT price FROM station_prices`;
    expect(Number(price!.price)).toBe(1.399);

    const [run] = await sql<Array<{ status: string; error: string }>>`
      SELECT status, error FROM ingestion_runs ORDER BY id DESC LIMIT 1
    `;
    expect(run!.status).toBe('failed');
    expect(run!.error).toContain('No se publica');
  });
});
