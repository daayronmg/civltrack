import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { parseSourceResponse, haversineMeters } from '@gasgo/core';
import { buildApp } from '../src/app.js';
import { runIngestion } from '../src/ingest/run-ingestion.js';
import {
  createTestSql,
  setupDatabase,
  truncateAll,
  buildSourcePayload,
  fechaOficial,
  hoursAgo,
  type TestSql,
} from './helpers.js';

const silent = { info: () => {}, warn: () => {}, error: () => {} };

let sql: TestSql;
let app: FastifyInstance;

// Puerta del Sol, Madrid.
const CENTRO = { lat: 40.4168, lon: -3.7038 };

beforeAll(async () => {
  sql = createTestSql();
  await setupDatabase(sql);
  app = await buildApp(sql as never);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await sql.end({ timeout: 5 });
});

beforeEach(async () => {
  await truncateAll(sql);
});

/**
 * Escenario: tres gasolineras reales en distancias y precios distintos.
 * Los precios son de laboratorio; lo que se prueba es que la API devuelve EXACTAMENTE
 * lo que entró por la ingesta, sin alterarlo.
 */
async function seedEscenario(fecha = '12/03/2026 18:40:11') {
  const payload = buildSourcePayload({
    fecha,
    stations: [
      {
        // ~1 km al norte
        id: '1001',
        rotulo: 'CERCANA CARA',
        lat: '40,425800',
        lon: '-3,703790',
        precios: { 'Precio Gasolina 95 E5': '1,589', 'Precio Gasoleo A': '1,499' },
      },
      {
        // ~5 km al norte
        id: '1002',
        rotulo: 'LEJANA BARATA',
        lat: '40,461800',
        lon: '-3,703790',
        precios: { 'Precio Gasolina 95 E5': '1,459', 'Precio Gasoleo A': '1,389' },
      },
      {
        // ~2 km al este, venta restringida
        id: '1003',
        rotulo: 'COOPERATIVA',
        lat: '40,416775',
        lon: '-3,680000',
        tipoVenta: 'R',
        precios: { 'Precio Gasolina 95 E5': '1,399' },
      },
    ],
  });
  return runIngestion(sql as never, silent, { snapshotOverride: parseSourceResponse(payload) });
}

describe('GET /health', () => {
  it('responde ok con la base de datos disponible', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
});

describe('GET /v1/meta/source', () => {
  it('dice claramente que NO hay datos cuando la base está vacía', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/meta/source' });
    const body = res.json();
    expect(body.hasData).toBe(false);
    expect(body.stationCount).toBe(0);
    expect(body.message).toContain('no muestra precios');
  });

  it('devuelve atribución, licencia y fecha del volcado cuando hay datos', async () => {
    await seedEscenario();
    const body = (await app.inject({ method: 'GET', url: '/v1/meta/source' })).json();

    expect(body.hasData).toBe(true);
    expect(body.stationCount).toBe(3);
    expect(body.lastSnapshotAt).toBe('2026-03-12T17:40:11.000Z');
    expect(body.attribution).toContain('Ministerio para la Transición Ecológica');
    expect(body.licence).toContain('Ley 37/2007');
    expect(body.freshness.confirmedLabel).toMatch(/^Confirmado hace/);
    // Nunca se afirma que sea tiempo real.
    expect(JSON.stringify(body).toLowerCase()).not.toContain('tiempo real');
  });
});

describe('GET /v1/stations/nearby', () => {
  it('devuelve 503 explícito si no hay datos oficiales, no una lista vacía inventada', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/stations/nearby?lat=${CENTRO.lat}&lon=${CENTRO.lon}&fuel=G95E5&radius=5000`,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('sin_datos_oficiales');
  });

  it('FIDELIDAD: el precio que devuelve la API es el mismo que publicó la fuente', async () => {
    await seedEscenario();
    const body = (
      await app.inject({
        method: 'GET',
        url: `/v1/stations/nearby?lat=${CENTRO.lat}&lon=${CENTRO.lon}&fuel=G95E5&radius=10000`,
      })
    ).json();

    const cercana = body.stations.find((s: { brand: string }) => s.brand === 'CERCANA CARA');
    expect(cercana.price.price).toBe(1.589);
    expect(cercana.price.price.toFixed(3).replace('.', ',')).toBe('1,589');
    expect(cercana.price.snapshotAt).toBe('2026-03-12T17:40:11.000Z');
  });

  it('calcula la distancia real y ordena por cercanía', async () => {
    await seedEscenario();
    const body = (
      await app.inject({
        method: 'GET',
        url: `/v1/stations/nearby?lat=${CENTRO.lat}&lon=${CENTRO.lon}&fuel=G95E5&radius=10000`,
      })
    ).json();

    const distancias = body.stations.map((s: { distanceMeters: number }) => s.distanceMeters);
    expect([...distancias].sort((a: number, b: number) => a - b)).toEqual(distancias);

    // La distancia de PostGIS coincide con el haversine del cliente (±0,5 %).
    const cercana = body.stations[0];
    const esperada = haversineMeters(CENTRO, { lat: cercana.lat, lon: cercana.lon });
    expect(Math.abs(cercana.distanceMeters - esperada) / esperada).toBeLessThan(0.005);
  });

  it('respeta el radio: no devuelve gasolineras fuera de él', async () => {
    await seedEscenario();
    const body = (
      await app.inject({
        method: 'GET',
        url: `/v1/stations/nearby?lat=${CENTRO.lat}&lon=${CENTRO.lon}&fuel=G95E5&radius=2000`,
      })
    ).json();

    expect(body.stations.every((s: { distanceMeters: number }) => s.distanceMeters <= 2000)).toBe(true);
    expect(body.stations.map((s: { brand: string }) => s.brand)).not.toContain('LEJANA BARATA');
  });

  it('excluye por defecto las gasolineras de venta restringida', async () => {
    await seedEscenario();
    const sinRestringidas = (
      await app.inject({
        method: 'GET',
        url: `/v1/stations/nearby?lat=${CENTRO.lat}&lon=${CENTRO.lon}&fuel=G95E5&radius=10000`,
      })
    ).json();
    expect(sinRestringidas.stations.map((s: { brand: string }) => s.brand)).not.toContain('COOPERATIVA');

    const conRestringidas = (
      await app.inject({
        method: 'GET',
        url: `/v1/stations/nearby?lat=${CENTRO.lat}&lon=${CENTRO.lon}&fuel=G95E5&radius=10000&incluirRestringidas=true`,
      })
    ).json();
    expect(conRestringidas.stations.map((s: { brand: string }) => s.brand)).toContain('COOPERATIVA');
  });

  it('identifica la gasolinera más barata del radio', async () => {
    await seedEscenario();
    const body = (
      await app.inject({
        method: 'GET',
        url: `/v1/stations/nearby?lat=${CENTRO.lat}&lon=${CENTRO.lon}&fuel=G95E5&radius=10000`,
      })
    ).json();

    const barata = body.stations.find((s: { id: string }) => s.id === body.cheapestStationId);
    expect(barata.brand).toBe('LEJANA BARATA');
    expect(barata.price.price).toBe(1.459);
  });

  it('acompaña cada precio de su frescura, sin decir «tiempo real»', async () => {
    await seedEscenario();
    const body = (
      await app.inject({
        method: 'GET',
        url: `/v1/stations/nearby?lat=${CENTRO.lat}&lon=${CENTRO.lon}&fuel=G95E5&radius=10000`,
      })
    ).json();

    for (const station of body.stations) {
      expect(station.freshness.confirmedLabel).toMatch(/^Confirmado hace/);
      expect(station.freshness.level).toBeDefined();
    }
    expect(JSON.stringify(body).toLowerCase()).not.toContain('tiempo real');
  });

  it('filtra por combustible: solo devuelve quien lo vende', async () => {
    await seedEscenario();
    const glp = (
      await app.inject({
        method: 'GET',
        url: `/v1/stations/nearby?lat=${CENTRO.lat}&lon=${CENTRO.lon}&fuel=GLP&radius=10000`,
      })
    ).json();
    expect(glp.stations).toHaveLength(0);
  });

  it('rechaza parámetros inválidos', async () => {
    const casos = [
      `/v1/stations/nearby?lat=200&lon=0&fuel=G95E5`,
      `/v1/stations/nearby?lat=40&lon=-3&fuel=NO_EXISTE`,
      `/v1/stations/nearby?lat=40&lon=-3&fuel=G95E5&radius=999999999`,
      `/v1/stations/nearby?lon=-3&fuel=G95E5`,
    ];
    for (const url of casos) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(400);
    }
  });

  it('no se puede inyectar SQL por el parámetro de marcas', async () => {
    await seedEscenario();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/stations/nearby?lat=${CENTRO.lat}&lon=${CENTRO.lon}&fuel=G95E5&radius=10000&marcas=${encodeURIComponent("'; DROP TABLE stations; --")}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().stations).toHaveLength(0);
    const [{ n }] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM stations`;
    expect(n).toBe(3);
  });
});

describe('POST /v1/best-option', () => {
  it('recomienda la barata lejana si compensa el desvío', async () => {
    await seedEscenario();
    const body = (
      await app.inject({
        method: 'POST',
        url: '/v1/best-option',
        payload: {
          lat: CENTRO.lat,
          lon: CENTRO.lon,
          radius: 10_000,
          vehicle: { fuel: 'G95E5', consumptionPer100Km: 6, tankCapacityLiters: 55, typicalRefuelLiters: 45 },
        },
      })
    ).json();

    // 45 L × 0,13 €/L = 5,85 € brutos frente a ~1 € de desvío: compensa.
    expect(body.best.station.brand).toBe('LEJANA BARATA');
    expect(body.savingsVsBaseline).toBeGreaterThan(3);
    expect(body.nota).toContain('estimación');
  });

  it('recomienda la cercana si el desvío se come el ahorro', async () => {
    await seedEscenario();
    const body = (
      await app.inject({
        method: 'POST',
        url: '/v1/best-option',
        payload: {
          lat: CENTRO.lat,
          lon: CENTRO.lon,
          radius: 10_000,
          // Consumo de camión y solo 5 litros: el desvío no compensa.
          vehicle: { fuel: 'G95E5', consumptionPer100Km: 35, tankCapacityLiters: 300 },
          liters: 5,
        },
      })
    ).json();

    expect(body.best.station.brand).toBe('CERCANA CARA');
    expect(body.cheapestIsNotBest).toBe(true);
    expect(body.cheapestByPrice.station.brand).toBe('LEJANA BARATA');
  });

  it('el ahorro se calcula sobre la más cercana, que es lo que el usuario haría por defecto', async () => {
    await seedEscenario();
    const body = (
      await app.inject({
        method: 'POST',
        url: '/v1/best-option',
        payload: {
          lat: CENTRO.lat,
          lon: CENTRO.lon,
          radius: 10_000,
          vehicle: { fuel: 'G95E5', consumptionPer100Km: 6, tankCapacityLiters: 55 },
        },
      })
    ).json();
    expect(body.baseline.station.brand).toBe('CERCANA CARA');
    expect(body.savingsVsBaseline).toBeGreaterThanOrEqual(0);
  });

  it('rechaza un vehículo con datos imposibles', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/best-option',
      payload: {
        lat: CENTRO.lat,
        lon: CENTRO.lon,
        vehicle: { fuel: 'G95E5', consumptionPer100Km: -5, tankCapacityLiters: 55 },
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /v1/route/stations', () => {
  it('encuentra gasolineras en el corredor de la ruta y calcula el desvío', async () => {
    await seedEscenario();
    const body = (
      await app.inject({
        method: 'POST',
        url: '/v1/route/stations',
        payload: {
          // Ruta que sube por el mismo meridiano: pasa junto a las dos gasolineras públicas.
          polyline: [
            { lat: 40.4168, lon: -3.7038 },
            { lat: 40.4618, lon: -3.7038 },
          ],
          corridorMeters: 2_000,
          vehicle: { fuel: 'G95E5', consumptionPer100Km: 6, tankCapacityLiters: 55 },
        },
      })
    ).json();

    expect(body.stations.length).toBeGreaterThanOrEqual(2);
    expect(body.best.station.brand).toBe('LEJANA BARATA');
    // Están prácticamente sobre la ruta.
    expect(body.best.distanceFromRouteMeters).toBeLessThan(100);
    expect(body.routeLengthMeters).toBeGreaterThan(4_000);
  });

  it('un corredor estrecho deja fuera lo que está lejos de la ruta', async () => {
    await seedEscenario();
    const body = (
      await app.inject({
        method: 'POST',
        url: '/v1/route/stations',
        payload: {
          // Ruta hacia el este: la cooperativa queda cerca, las del norte no.
          polyline: [
            { lat: 40.4168, lon: -3.7038 },
            { lat: 40.4168, lon: -3.6 },
          ],
          corridorMeters: 500,
          vehicle: { fuel: 'G95E5', consumptionPer100Km: 6, tankCapacityLiters: 55 },
        },
      })
    ).json();

    expect(body.stations.map((s: { station: { brand: string } }) => s.station.brand)).not.toContain(
      'LEJANA BARATA',
    );
  });

  it('exige una ruta', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/route/stations',
      payload: { vehicle: { fuel: 'G95E5', consumptionPer100Km: 6, tankCapacityLiters: 55 } },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/stations/:id y su histórico', () => {
  it('devuelve la ficha con todos los precios y su frescura', async () => {
    await seedEscenario();
    const [station] = await sql<Array<{ id: string }>>`
      SELECT id FROM stations WHERE source_station_id = '1001'
    `;

    const body = (
      await app.inject({ method: 'GET', url: `/v1/stations/${station!.id}?lat=${CENTRO.lat}&lon=${CENTRO.lon}` })
    ).json();

    expect(body.station.brand).toBe('CERCANA CARA');
    expect(body.station.prices).toHaveLength(2);
    expect(body.station.distanceMeters).toBeGreaterThan(500);
    expect(body.attribution).toContain('Ministerio');
  });

  it('el histórico refleja los cambios reales y dice cuándo no hay datos', async () => {
    // Fechas relativas a hoy: el histórico se consulta con ventanas móviles (24 h, 7 d, 30 d).
    const primerVolcado = hoursAgo(3);
    const segundoVolcado = hoursAgo(1);
    await seedEscenario(fechaOficial(primerVolcado));
    const [station] = await sql<Array<{ id: string }>>`
      SELECT id FROM stations WHERE source_station_id = '1001'
    `;

    // Segundo volcado con un precio distinto.
    await runIngestion(sql as never, silent, {
      snapshotOverride: parseSourceResponse(
        buildSourcePayload({
          fecha: fechaOficial(segundoVolcado),
          stations: [
            {
              id: '1001',
              rotulo: 'CERCANA CARA',
              lat: '40,425800',
              lon: '-3,703790',
              precios: { 'Precio Gasolina 95 E5': '1,549', 'Precio Gasoleo A': '1,499' },
            },
          ],
        }),
      ),
    });

    const body = (
      await app.inject({ method: 'GET', url: `/v1/stations/${station!.id}/history?fuel=G95E5&days=30` })
    ).json();

    expect(body.history.points.map((p: { price: number }) => p.price)).toEqual([1.589, 1.549]);
    expect(body.history.current).toBe(1.549);
    // No inventamos el precio de hace 24 h si GASGO no existía entonces.
    expect(body.history.ago24h).toBeNull();
    expect(new Date(body.history.historySince).getTime()).toBeCloseTo(
      Math.floor(primerVolcado.getTime() / 1000) * 1000,
      -4,
    );
  });

  it('avisa cuando todavía no hay histórico propio', async () => {
    await seedEscenario();
    const [station] = await sql<Array<{ id: string }>>`
      SELECT id FROM stations WHERE source_station_id = '1001'
    `;
    const body = (
      await app.inject({ method: 'GET', url: `/v1/stations/${station!.id}/history?fuel=GLP` })
    ).json();
    expect(body.history.points).toHaveLength(0);
    expect(body.mensaje).toContain('todavía no tiene histórico');
  });

  it('404 para una estación inexistente y 400 para un id mal formado', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/v1/stations/11111111-1111-1111-1111-111111111111' })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/stations/no-es-un-uuid' })).statusCode).toBe(400);
  });
});

describe('GET /v1/fuels', () => {
  it('publica el catálogo con la columna oficial de cada combustible', async () => {
    const body = (await app.inject({ method: 'GET', url: '/v1/fuels' })).json();
    const g95 = body.fuels.find((f: { code: string }) => f.code === 'G95E5');
    expect(g95.sourceColumn).toBe('Precio Gasolina 95 E5');
    expect(g95.primary).toBe(true);
    expect(body.fuels.length).toBeGreaterThan(10);
  });
});
