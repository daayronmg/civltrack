/**
 * Cómo GASGO habla de la antigüedad de un precio.
 *
 * REGLA: nunca se dice «en tiempo real». La fuente oficial publica volcados; cada precio
 * lleva la marca de tiempo del volcado (`snapshotAt`) y, opcionalmente, desde cuándo ese
 * valor no cambia según nuestro histórico (`valueSince`).
 *
 * Este es el único sitio del proyecto donde se redacta ese mensaje.
 */

export interface FreshnessInput {
  /** `Fecha` del volcado oficial del que procede el precio. */
  snapshotAt: Date;
  /** Primer instante en que vimos este mismo valor sin cambios (histórico de GASGO). */
  valueSince?: Date | null;
  /** Momento de referencia; por defecto, ahora. */
  now?: Date;
}

export type FreshnessLevel = 'fresco' | 'reciente' | 'antiguo' | 'obsoleto';

export interface Freshness {
  level: FreshnessLevel;
  ageMinutes: number;
  /** «Confirmado hace 7 min» */
  confirmedLabel: string;
  /** «Sin cambios desde el 12/03 a las 18:40», si hay histórico. */
  unchangedLabel?: string;
  /** Aviso explícito cuando el dato es viejo. */
  warning?: string;
}

/** Umbrales, en minutos. */
const FRESH_MAX = 30;
const RECENT_MAX = 120;
const OLD_MAX = 24 * 60;

export function computeFreshness(input: FreshnessInput): Freshness {
  const now = input.now ?? new Date();
  const ageMs = Math.max(0, now.getTime() - input.snapshotAt.getTime());
  const ageMinutes = Math.floor(ageMs / 60000);

  const level: FreshnessLevel =
    ageMinutes <= FRESH_MAX
      ? 'fresco'
      : ageMinutes <= RECENT_MAX
        ? 'reciente'
        : ageMinutes <= OLD_MAX
          ? 'antiguo'
          : 'obsoleto';

  const result: Freshness = {
    level,
    ageMinutes,
    confirmedLabel: `Confirmado ${humanizeAge(ageMinutes)}`,
  };

  if (input.valueSince) {
    const changeAgeMinutes = Math.floor(
      Math.max(0, now.getTime() - input.valueSince.getTime()) / 60000,
    );
    result.unchangedLabel = `Sin cambios desde ${formatMoment(input.valueSince, now)}`;
    if (changeAgeMinutes < ageMinutes) {
      // No puede ser: el valor no puede llevar sin cambiar menos que la antigüedad del volcado.
      result.unchangedLabel = undefined;
    }
  }

  if (level === 'antiguo') {
    result.warning = 'La fuente oficial no ha publicado datos nuevos en las últimas horas.';
  } else if (level === 'obsoleto') {
    result.warning =
      'Dato de hace más de 24 horas. Puede no coincidir con el precio actual del surtidor.';
  }

  return result;
}

/** «hace 7 min», «hace 3 h», «hace 2 días». Nunca «ahora mismo» salvo < 1 min. */
export function humanizeAge(minutes: number): string {
  if (minutes < 1) return 'hace menos de 1 min';
  if (minutes === 1) return 'hace 1 min';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return 'hace 1 h';
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}

function two(n: number): string {
  return n.toString().padStart(2, '0');
}

/** «hoy a las 18:40», «ayer a las 07:05», «el 12/03 a las 18:40». */
export function formatMoment(moment: Date, now: Date): string {
  const time = `${two(moment.getHours())}:${two(moment.getMinutes())}`;
  const sameDay = moment.toDateString() === now.toDateString();
  if (sameDay) return `hoy a las ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (moment.toDateString() === yesterday.toDateString()) return `ayer a las ${time}`;

  return `el ${two(moment.getDate())}/${two(moment.getMonth() + 1)} a las ${time}`;
}

/**
 * Texto de atribución obligatorio por las condiciones de reutilización (Ley 37/2007).
 * Debe mostrarse allí donde se muestren precios.
 */
export const SOURCE_ATTRIBUTION =
  'Fuente: Ministerio para la Transición Ecológica y el Reto Demográfico. Precios comunicados por las propias estaciones de servicio. GASGO no está avalado por el Ministerio.';
