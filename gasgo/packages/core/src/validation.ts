/**
 * SISTEMA ANTIERRORES de GASGO.
 *
 * La fuente oficial publica lo que las estaciones comunican. A veces se comunica mal:
 * un decimal desplazado (1,489 → 0,149), un precio de prueba, un cero, o un salto imposible.
 * GASGO no muestra un precio sospechoso como si fuera bueno: lo marca, lo registra y
 * mantiene visible el último precio válido conocido.
 *
 * Este módulo NO corrige precios. Solo decide si un valor se acepta, se retiene o se descarta.
 */

import { getFuel, type FuelCode } from './fuels.js';

export type ValidationStatus =
  /** Aceptado: se publica a los usuarios. */
  | 'aceptado'
  /** Sospechoso: se guarda en el histórico pero NO se publica; se mantiene el anterior válido. */
  | 'sospechoso'
  /** Rechazado: imposible (negativo, cero, no numérico, fuera de rango absoluto). */
  | 'rechazado';

export type AnomalyReason =
  | 'no_numerico'
  | 'no_positivo'
  | 'fuera_de_rango_absoluto'
  | 'salto_relativo_extremo'
  | 'posible_error_decimal'
  | 'desviacion_extrema_vs_mediana';

export interface ValidationInput {
  fuel: FuelCode;
  /** Precio nuevo publicado por la fuente. */
  newPrice: number | null;
  /** Último precio aceptado que teníamos de esa estación y producto. */
  previousPrice?: number | null;
  /** Mediana nacional del producto en el volcado actual, si se conoce. */
  nationalMedian?: number | null;
}

export interface ValidationResult {
  status: ValidationStatus;
  reasons: AnomalyReason[];
  /** Explicación legible, para el registro de anomalías y para soporte. */
  detail: string;
  /** Variación relativa respecto al precio anterior, si había. */
  relativeChange?: number;
}

/** Un cambio de más de este porcentaje entre dos volcados es sospechoso. */
export const MAX_RELATIVE_JUMP = 0.25; // 25 %
/**
 * Desviación máxima admitida respecto a la mediana nacional del producto.
 * La horquilla real entre la gasolinera más barata y la más cara de España se mueve
 * en torno al ±20 %; un ±35 % ya no es competencia, es un dato mal comunicado.
 */
export const MAX_MEDIAN_DEVIATION = 0.35;

/**
 * Detecta el error de decimal desplazado: el precio nuevo es ~10× o ~1/10 del anterior.
 * Es el fallo más frecuente y el que pide explícitamente el requisito (1,489 → 0,149).
 */
function looksLikeDecimalShift(newPrice: number, previousPrice: number): boolean {
  const ratio = newPrice / previousPrice;
  const near = (value: number, target: number, tolerance = 0.15): boolean =>
    Math.abs(value - target) / target <= tolerance;
  return near(ratio, 10) || near(ratio, 0.1) || near(ratio, 100) || near(ratio, 0.01);
}

export function validatePrice(input: ValidationInput): ValidationResult {
  const reasons: AnomalyReason[] = [];
  const details: string[] = [];
  const { newPrice, previousPrice, nationalMedian } = input;
  const fuel = getFuel(input.fuel);

  if (newPrice === null || newPrice === undefined || !Number.isFinite(newPrice)) {
    return {
      status: 'rechazado',
      reasons: ['no_numerico'],
      detail: 'El valor recibido no es un número finito.',
    };
  }

  if (newPrice <= 0) {
    return {
      status: 'rechazado',
      reasons: ['no_positivo'],
      detail: `Precio no positivo (${newPrice}).`,
    };
  }

  let relativeChange: number | undefined;

  // El diagnóstico de decimal desplazado va primero: si además cae fuera de rango,
  // queremos registrar la causa concreta, no solo «fuera de rango».
  if (typeof previousPrice === 'number' && previousPrice > 0) {
    relativeChange = (newPrice - previousPrice) / previousPrice;

    if (looksLikeDecimalShift(newPrice, previousPrice)) {
      reasons.push('posible_error_decimal');
      details.push(`Posible decimal desplazado: ${previousPrice} → ${newPrice}.`);
    } else if (Math.abs(relativeChange) > MAX_RELATIVE_JUMP) {
      reasons.push('salto_relativo_extremo');
      details.push(
        `Salto del ${(relativeChange * 100).toFixed(1)} % respecto al precio anterior (${previousPrice} → ${newPrice}).`,
      );
    }
  }

  const { min, max } = fuel.plausibleRange;
  if (newPrice < min || newPrice > max) {
    reasons.push('fuera_de_rango_absoluto');
    details.push(
      `Precio ${newPrice} fuera del rango plausible de ${fuel.label} (${min}–${max}).`,
    );
  }

  if (typeof nationalMedian === 'number' && nationalMedian > 0) {
    const deviation = Math.abs(newPrice - nationalMedian) / nationalMedian;
    if (deviation > MAX_MEDIAN_DEVIATION) {
      reasons.push('desviacion_extrema_vs_mediana');
      details.push(
        `Desviación del ${(deviation * 100).toFixed(1)} % respecto a la mediana nacional (${nationalMedian}).`,
      );
    }
  }

  const hardReasons: AnomalyReason[] = ['no_numerico', 'no_positivo', 'fuera_de_rango_absoluto'];
  const status: ValidationStatus = reasons.some((r) => hardReasons.includes(r))
    ? 'rechazado'
    : reasons.length > 0
      ? 'sospechoso'
      : 'aceptado';

  if (status !== 'aceptado') {
    details.push(
      status === 'rechazado'
        ? 'No se publica.'
        : 'No se publica; se mantiene el último precio válido conocido.',
    );
  }

  return {
    status,
    reasons,
    detail: status === 'aceptado' ? 'Dentro de los márgenes esperados.' : details.join(' '),
    relativeChange,
  };
}

/** Mediana de una lista de precios. Devuelve `null` si no hay datos. */
export function median(values: readonly number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 0 ? (clean[mid - 1]! + clean[mid]!) / 2 : clean[mid]!;
}

/**
 * Convierte el texto de precio de la fuente oficial ("1,489", "", "0") a número.
 * Cadena vacía = la estación no vende ese producto → `null`, nunca 0.
 */
export function parseSourcePrice(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === '') return null;
  const normalised = text.replace(/\s/g, '').replace(',', '.');
  const value = Number(normalised);
  if (!Number.isFinite(value)) return null;
  return value;
}
