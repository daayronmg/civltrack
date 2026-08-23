import postgres from 'postgres';
import { madridOffsetMinutes } from '@gasgo/core';
import { migrate } from '../src/db/migrate.js';

/**
 * Los tests corren contra un PostgreSQL con PostGIS REAL, no contra un doble.
 * Las consultas geoespaciales son el corazón de GASGO: probarlas con un mock no probaría nada.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://gasgo:gasgo@127.0.0.1:5432/gasgo_test';

export function createTestSql() {
  return postgres(TEST_DATABASE_URL, {
    max: 4,
    onnotice: () => {},
    types: {
      numeric: {
        to: 1700,
        from: [1700],
        serialize: (value: number | string) => String(value),
        parse: (value: string) => Number(value),
      },
    },
  });
}

export type TestSql = ReturnType<typeof createTestSql>;

export async function setupDatabase(sql: TestSql): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;
  await migrate(sql as never, () => {});
}

/** Deja la base limpia entre tests, conservando el catálogo de fuentes. */
export async function truncateAll(sql: TestSql): Promise<void> {
  await sql`
    TRUNCATE alert_deliveries, price_alerts, favorites, vehicles, devices,
             price_anomalies, price_history, station_prices, stations, ingestion_runs
    RESTART IDENTITY CASCADE
  `;
}

/**
 * Construye una respuesta con la MISMA ESTRUCTURA que publica el Ministerio.
 * Los valores son de laboratorio y nunca salen de los tests: sirven para comprobar que
 * el flujo ingesta → validación → API conserva los datos sin alterarlos.
 */
export function buildSourcePayload(options: {
  fecha: string;
  stations: Array<{
    id: string;
    rotulo: string;
    lat: string;
    lon: string;
    municipio?: string;
    provincia?: string;
    tipoVenta?: string;
    precios: Record<string, string>;
  }>;
}): Record<string, unknown> {
  return {
    Fecha: options.fecha,
    ListaEESSPrecio: options.stations.map((station) => ({
      IDEESS: station.id,
      'Rótulo': station.rotulo,
      'Dirección': `CALLE ${station.id}`,
      'C.P.': '28001',
      Localidad: station.municipio ?? 'LOCALIDAD',
      Municipio: station.municipio ?? 'MUNICIPIO',
      Provincia: station.provincia ?? 'PROVINCIA',
      Horario: 'L-D: 24H',
      Latitud: station.lat,
      'Longitud (WGS84)': station.lon,
      Margen: 'D',
      'Remisión': 'dm',
      'Tipo Venta': station.tipoVenta ?? 'P',
      IDMunicipio: '1',
      IDProvincia: '28',
      IDCCAA: '13',
      ...station.precios,
    })),
    Nota: 'Estructura de prueba',
    ResultadoConsulta: 'OK',
  };
}

/**
 * Formatea una fecha en el formato de la fuente oficial («dd/MM/yyyy HH:mm:ss», hora
 * peninsular). Se usa en los tests que dependen de ventanas temporales (histórico de 24 h,
 * 7 días…), para que sigan siendo válidos con el paso del tiempo.
 */
export function fechaOficial(date: Date): string {
  const utc = date.getTime();
  // Aproximación en dos pasos: calculamos el desplazamiento con la fecha UTC y lo aplicamos.
  const probe = new Date(utc);
  const offset = madridOffsetMinutes(
    probe.getUTCFullYear(),
    probe.getUTCMonth() + 1,
    probe.getUTCDate(),
  );
  const local = new Date(utc + offset * 60_000);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(local.getUTCDate())}/${two(local.getUTCMonth() + 1)}/${local.getUTCFullYear()} ${two(local.getUTCHours())}:${two(local.getUTCMinutes())}:${two(local.getUTCSeconds())}`;
}

export function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3_600_000);
}
