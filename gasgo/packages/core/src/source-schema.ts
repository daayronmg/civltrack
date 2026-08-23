/**
 * Contrato con la fuente oficial (MITECO — Estaciones Terrestres).
 *
 * Las claves están escritas EXACTAMENTE como las publica el servicio, con sus espacios,
 * tildes y puntos. Este fichero es lo que se verifica contra la API real con
 * `npm run verify:source -w @gasgo/api` antes de dar por buena una ingesta.
 */

import { FUELS, fuelFromSourceColumn, type FuelCode } from './fuels.js';
import { parseSourcePrice } from './validation.js';

/** Claves de la raíz de la respuesta. */
export const ROOT_KEYS = {
  fecha: 'Fecha',
  stations: 'ListaEESSPrecio',
  note: 'Nota',
  result: 'ResultadoConsulta',
} as const;

/** Claves obligatorias de cada estación. Si falta alguna, la ingesta falla ruidosamente. */
export const REQUIRED_STATION_KEYS = [
  'IDEESS',
  'Rótulo',
  'Dirección',
  'Municipio',
  'Provincia',
  'Latitud',
  'Longitud (WGS84)',
] as const;

/** Claves opcionales que aprovechamos si vienen. */
export const OPTIONAL_STATION_KEYS = [
  'C.P.',
  'Localidad',
  'Horario',
  'Margen',
  'Remisión',
  'Tipo Venta',
  'IDMunicipio',
  'IDProvincia',
  'IDCCAA',
  '% BioEtanol',
  '% Éster metílico',
] as const;

export const PRICE_COLUMNS: readonly string[] = FUELS.map((f) => f.sourceColumn);

/** Registro tal cual llega de la fuente (todos los valores son cadenas). */
export type RawStationRecord = Record<string, unknown>;

export interface ParsedStation {
  sourceStationId: string;
  brand: string;
  address: string;
  postalCode: string | null;
  locality: string | null;
  municipality: string;
  municipalityId: string | null;
  province: string;
  provinceId: string | null;
  regionId: string | null;
  schedule: string | null;
  /** `P` = venta al público, `R` = restringida (cooperativas, flotas). */
  saleType: string | null;
  /** Margen de la vía: D / I / N. */
  roadSide: string | null;
  lat: number;
  lon: number;
  prices: Partial<Record<FuelCode, number>>;
  /** Columnas `Precio …` que no reconocemos: productos nuevos del Ministerio. */
  unknownPriceColumns: string[];
}

export class SourceContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceContractError';
  }
}

/** Coordenada oficial: cadena con coma decimal («40,416775»). */
export function parseSourceCoordinate(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === '') return null;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/**
 * `Fecha` oficial en formato «dd/MM/yyyy HH:mm:ss», hora peninsular española.
 * Se construye con desplazamiento explícito para no depender del huso del servidor.
 */
export function parseSourceDate(raw: unknown, timeZoneOffsetMinutes?: number): Date | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  const match = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!match) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = match;
  const offset = timeZoneOffsetMinutes ?? madridOffsetMinutes(Number(yyyy), Number(mm), Number(dd));
  const utcMs = Date.UTC(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(mi),
    Number(ss ?? '0'),
  );
  return new Date(utcMs - offset * 60_000);
}

/**
 * Desplazamiento de Europe/Madrid (peninsular) para una fecha: +60 min en invierno,
 * +120 en horario de verano (último domingo de marzo a último domingo de octubre, 01:00 UTC).
 */
export function madridOffsetMinutes(year: number, month: number, day: number): number {
  const lastSunday = (y: number, m: number): number => {
    const last = new Date(Date.UTC(y, m, 0)); // día 0 del mes siguiente = último del mes m
    return last.getUTCDate() - last.getUTCDay();
  };
  const dstStart = Date.UTC(year, 2, lastSunday(year, 3), 1);
  const dstEnd = Date.UTC(year, 9, lastSunday(year, 10), 1);
  const value = Date.UTC(year, month - 1, day, 12);
  return value >= dstStart && value < dstEnd ? 120 : 60;
}

/**
 * Convierte un registro oficial en una estación de GASGO.
 * Devuelve `null` si el registro no es utilizable (sin ID o sin coordenadas válidas),
 * y acumula el motivo en `problems` para que la ingesta lo registre.
 */
export function parseStationRecord(
  raw: RawStationRecord,
  problems: string[] = [],
): ParsedStation | null {
  const sourceStationId = String(raw['IDEESS'] ?? '').trim();
  if (sourceStationId === '') {
    problems.push('Registro sin IDEESS');
    return null;
  }

  const lat = parseSourceCoordinate(raw['Latitud']);
  const lon = parseSourceCoordinate(raw['Longitud (WGS84)'] ?? raw['Longitud']);
  if (lat === null || lon === null) {
    problems.push(`Estación ${sourceStationId} sin coordenadas válidas`);
    return null;
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    problems.push(`Estación ${sourceStationId} con coordenadas fuera de rango (${lat}, ${lon})`);
    return null;
  }

  const prices: Partial<Record<FuelCode, number>> = {};
  const unknownPriceColumns: string[] = [];

  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('Precio ')) continue;
    const fuel = fuelFromSourceColumn(key);
    if (!fuel) {
      // Producto nuevo del Ministerio: se registra, no se descarta en silencio.
      if (parseSourcePrice(value) !== null) unknownPriceColumns.push(key);
      continue;
    }
    const price = parseSourcePrice(value);
    if (price !== null) prices[fuel.code] = price;
  }

  const text = (key: string): string | null => {
    const value = raw[key];
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    return str === '' ? null : str;
  };

  return {
    sourceStationId,
    brand: text('Rótulo') ?? 'Sin rótulo',
    address: text('Dirección') ?? '',
    postalCode: text('C.P.'),
    locality: text('Localidad'),
    municipality: text('Municipio') ?? '',
    municipalityId: text('IDMunicipio'),
    province: text('Provincia') ?? '',
    provinceId: text('IDProvincia') ?? text('IDPovincia'),
    regionId: text('IDCCAA'),
    schedule: text('Horario'),
    saleType: text('Tipo Venta'),
    roadSide: text('Margen'),
    lat,
    lon,
    prices,
    unknownPriceColumns,
  };
}

export interface SourceSnapshot {
  snapshotAt: Date;
  stations: ParsedStation[];
  /** Columnas de precio no reconocidas en todo el volcado. */
  unknownPriceColumns: string[];
  /** Registros descartados con su motivo. */
  problems: string[];
  /** Campo `Nota` de la fuente, si lo trae. */
  note: string | null;
}

/**
 * Parsea la respuesta completa de `/EstacionesTerrestres/`.
 * Lanza `SourceContractError` si la respuesta no cumple el contrato documentado:
 * preferimos fallar y no actualizar, antes que publicar datos mal interpretados.
 */
export function parseSourceResponse(payload: unknown): SourceSnapshot {
  if (typeof payload !== 'object' || payload === null) {
    throw new SourceContractError('La respuesta de la fuente oficial no es un objeto JSON.');
  }
  const root = payload as Record<string, unknown>;

  const list = root[ROOT_KEYS.stations];
  if (!Array.isArray(list)) {
    throw new SourceContractError(
      `La respuesta no contiene el array «${ROOT_KEYS.stations}». Claves recibidas: ${Object.keys(root).join(', ')}`,
    );
  }

  const snapshotAt = parseSourceDate(root[ROOT_KEYS.fecha]);
  if (!snapshotAt) {
    throw new SourceContractError(
      `No se pudo interpretar el campo «${ROOT_KEYS.fecha}» (${String(root[ROOT_KEYS.fecha])}). Sin marca de tiempo oficial no se publica nada.`,
    );
  }

  const first = list[0] as RawStationRecord | undefined;
  if (first) {
    const missing = REQUIRED_STATION_KEYS.filter((key) => !(key in first));
    if (missing.length > 0) {
      throw new SourceContractError(
        `Faltan claves obligatorias en los registros de estación: ${missing.join(', ')}`,
      );
    }
  }

  const problems: string[] = [];
  const unknown = new Set<string>();
  const stations: ParsedStation[] = [];

  for (const record of list as RawStationRecord[]) {
    const parsed = parseStationRecord(record, problems);
    if (!parsed) continue;
    parsed.unknownPriceColumns.forEach((column) => unknown.add(column));
    stations.push(parsed);
  }

  return {
    snapshotAt,
    stations,
    unknownPriceColumns: [...unknown],
    problems,
    note: typeof root[ROOT_KEYS.note] === 'string' ? (root[ROOT_KEYS.note] as string) : null,
  };
}
