import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { formatPrice, parseSourceResponse } from '@gasgo/core';
import { buildApp } from '../src/app.js';
import { runIngestion } from '../src/ingest/run-ingestion.js';
import { createTestSql, setupDatabase, truncateAll, type TestSql } from './helpers.js';

/**
 * FIDELIDAD EXTREMO A EXTREMO.
 *
 * Comprueba lo que pide el encargo: que el precio que GASGO acaba MOSTRANDO al usuario es
 * exactamente el que publica la fuente oficial, sin redondeos ni transformaciones, a lo largo
 * de todo el recorrido:
 *
 *   texto de la fuente → parser → validación → PostgreSQL → API → formato de la interfaz
 *
 * `formatPrice` es la misma función que usa la app para pintar el precio en pantalla.
 */

const silent = { info: () => {}, warn: () => {}, error: () => {} };

let sql: TestSql;
let app: FastifyInstance;

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
 * Precios elegidos para pillar los errores clásicos: ceros a la derecha, valores que un
 * `float` redondea mal, tres decimales exactos y precios bajos legítimos (GLP).
 */
const CASOS: Array<{ columna: string; textoOficial: string }> = [
  { columna: 'Precio Gasolina 95 E5', textoOficial: '1,489' },
  { columna: 'Precio Gasolina 98 E5', textoOficial: '1,629' },
  { columna: 'Precio Gasoleo A', textoOficial: '1,399' },
  { columna: 'Precio Gasoleo Premium', textoOficial: '1,500' },
  { columna: 'Precio Gases licuados del petróleo', textoOficial: '0,899' },
  { columna: 'Precio Gas Natural Comprimido', textoOficial: '1,005' },
];

describe('fidelidad de precios de extremo a extremo', () => {
  it('el precio mostrado coincide carácter a carácter con el de la fuente', async () => {
    const registro: Record<string, unknown> = {
      IDEESS: '5001',
      'Rótulo': 'ESTACIÓN FIDELIDAD',
      'Dirección': 'CALLE DE LA PRUEBA 1',
      'C.P.': '28001',
      Localidad: 'LOCALIDAD',
      Municipio: 'MUNICIPIO',
      Provincia: 'PROVINCIA',
      Horario: 'L-D: 24H',
      Latitud: '40,416775',
      'Longitud (WGS84)': '-3,703790',
      'Tipo Venta': 'P',
    };
    for (const caso of CASOS) registro[caso.columna] = caso.textoOficial;

    const resumen = await runIngestion(sql as never, silent, {
      snapshotOverride: parseSourceResponse({
        Fecha: '12/03/2026 18:40:11',
        ListaEESSPrecio: [registro],
      }),
    });
    expect(resumen.status).toBe('ok');
    expect(resumen.pricesAccepted).toBe(CASOS.length);

    const [station] = await sql<Array<{ id: string }>>`
      SELECT id FROM stations WHERE source_station_id = '5001'
    `;

    const body = (await app.inject({ method: 'GET', url: `/v1/stations/${station!.id}` })).json();

    for (const caso of CASOS) {
      const enApi = body.station.prices.find(
        (p: { fuel: string }) =>
          p.fuel ===
          {
            'Precio Gasolina 95 E5': 'G95E5',
            'Precio Gasolina 98 E5': 'G98E5',
            'Precio Gasoleo A': 'GOA',
            'Precio Gasoleo Premium': 'GOA_PREMIUM',
            'Precio Gases licuados del petróleo': 'GLP',
            'Precio Gas Natural Comprimido': 'GNC',
          }[caso.columna],
      );

      expect(enApi, `falta ${caso.columna} en la respuesta de la API`).toBeTruthy();
      // Lo que pinta la app en pantalla, comparado con el texto original de la fuente.
      expect(formatPrice(enApi.price), caso.columna).toBe(caso.textoOficial);
    }
  });

  it('la marca de tiempo que muestra la app es la del volcado oficial, no la de ingesta', async () => {
    await runIngestion(sql as never, silent, {
      snapshotOverride: parseSourceResponse({
        Fecha: '12/03/2026 18:40:11',
        ListaEESSPrecio: [
          {
            IDEESS: '5002',
            'Rótulo': 'A',
            'Dirección': 'X',
            Municipio: 'M',
            Provincia: 'P',
            Latitud: '40,4',
            'Longitud (WGS84)': '-3,7',
            'Precio Gasoleo A': '1,399',
          },
        ],
      }),
    });

    const body = (
      await app.inject({ method: 'GET', url: '/v1/stations/nearby?lat=40.4&lon=-3.7&fuel=GOA&radius=5000' })
    ).json();

    const station = body.stations[0];
    expect(station.price.snapshotAt).toBe('2026-03-12T17:40:11.000Z');
    expect(body.snapshotAt).toBe('2026-03-12T17:40:11.000Z');
    // La antigüedad se cuenta desde el volcado oficial, no desde ahora.
    expect(station.freshness.ageMinutes).toBeGreaterThan(0);
  });

  it('un precio bloqueado por el antierrores nunca aparece en la API', async () => {
    const volcado = (precio: string, fecha: string) =>
      parseSourceResponse({
        Fecha: fecha,
        ListaEESSPrecio: [
          {
            IDEESS: '5003',
            'Rótulo': 'A',
            'Dirección': 'X',
            Municipio: 'M',
            Provincia: 'P',
            Latitud: '40,4',
            'Longitud (WGS84)': '-3,7',
            'Precio Gasolina 95 E5': precio,
          },
        ],
      });

    await runIngestion(sql as never, silent, { snapshotOverride: volcado('1,489', '12/03/2026 10:00:00') });
    await runIngestion(sql as never, silent, { snapshotOverride: volcado('0,149', '12/03/2026 11:00:00') });

    const body = (
      await app.inject({ method: 'GET', url: '/v1/stations/nearby?lat=40.4&lon=-3.7&fuel=G95E5&radius=5000' })
    ).json();

    expect(formatPrice(body.stations[0].price.price)).toBe('1,489');
    expect(JSON.stringify(body)).not.toContain('0.149');

    // Y queda registrado por qué no se publicó.
    const [anomalia] = await sql<Array<{ detail: string }>>`SELECT detail FROM price_anomalies`;
    expect(anomalia!.detail).toContain('decimal');
  });

  it('los tres decimales sobreviven a PostgreSQL sin errores de coma flotante', async () => {
    // 1,145 y 1,005 son casos clásicos de redondeo binario incorrecto.
    for (const [id, texto] of [
      ['5004', '1,145'],
      ['5005', '1,005'],
      ['5006', '2,225'],
    ] as const) {
      await runIngestion(sql as never, silent, {
        snapshotOverride: parseSourceResponse({
          Fecha: `12/03/2026 1${id.slice(-1)}:00:00`,
          ListaEESSPrecio: [
            {
              IDEESS: id,
              'Rótulo': 'A',
              'Dirección': 'X',
              Municipio: 'M',
              Provincia: 'P',
              Latitud: '40,4',
              'Longitud (WGS84)': '-3,7',
              'Precio Gasoleo A': texto,
            },
          ],
        }),
      });

      const [row] = await sql<Array<{ price: number }>>`
        SELECT p.price FROM station_prices p
        JOIN stations s ON s.id = p.station_id
        WHERE s.source_station_id = ${id}
      `;
      expect(formatPrice(Number(row!.price)), texto).toBe(texto);
    }
  });
});
