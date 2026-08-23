import { describe, it, expect } from 'vitest';
import { computeFreshness, humanizeAge, formatMoment, SOURCE_ATTRIBUTION } from './freshness.js';

const NOW = new Date('2026-03-12T18:00:00Z');
const minutesAgo = (m: number): Date => new Date(NOW.getTime() - m * 60_000);

describe('computeFreshness', () => {
  it('nunca dice «tiempo real»: siempre habla de confirmación', () => {
    const fresh = computeFreshness({ snapshotAt: minutesAgo(4), now: NOW });
    expect(fresh.confirmedLabel).toBe('Confirmado hace 4 min');
    expect(fresh.confirmedLabel.toLowerCase()).not.toContain('tiempo real');
  });

  it('clasifica la antigüedad del volcado', () => {
    expect(computeFreshness({ snapshotAt: minutesAgo(7), now: NOW }).level).toBe('fresco');
    expect(computeFreshness({ snapshotAt: minutesAgo(90), now: NOW }).level).toBe('reciente');
    expect(computeFreshness({ snapshotAt: minutesAgo(300), now: NOW }).level).toBe('antiguo');
    expect(computeFreshness({ snapshotAt: minutesAgo(60 * 30), now: NOW }).level).toBe('obsoleto');
  });

  it('avisa explícitamente cuando el dato es viejo', () => {
    expect(computeFreshness({ snapshotAt: minutesAgo(10), now: NOW }).warning).toBeUndefined();
    expect(computeFreshness({ snapshotAt: minutesAgo(300), now: NOW }).warning).toBeDefined();
    expect(computeFreshness({ snapshotAt: minutesAgo(60 * 30), now: NOW }).warning).toContain(
      '24 horas',
    );
  });

  it('añade «sin cambios desde» cuando hay histórico propio', () => {
    const result = computeFreshness({
      snapshotAt: minutesAgo(5),
      valueSince: new Date('2026-03-11T17:40:00Z'),
      now: NOW,
    });
    expect(result.unchangedLabel).toContain('Sin cambios desde ayer');
  });

  it('ignora un «sin cambios» incoherente (más reciente que el propio volcado)', () => {
    const result = computeFreshness({
      snapshotAt: minutesAgo(120),
      valueSince: minutesAgo(5),
      now: NOW,
    });
    expect(result.unchangedLabel).toBeUndefined();
  });

  it('no produce antigüedades negativas si el reloj va adelantado', () => {
    const result = computeFreshness({ snapshotAt: new Date(NOW.getTime() + 60_000), now: NOW });
    expect(result.ageMinutes).toBe(0);
  });
});

describe('humanizeAge', () => {
  it('usa minutos, horas y días con singular y plural correctos', () => {
    expect(humanizeAge(0)).toBe('hace menos de 1 min');
    expect(humanizeAge(1)).toBe('hace 1 min');
    expect(humanizeAge(7)).toBe('hace 7 min');
    expect(humanizeAge(60)).toBe('hace 1 h');
    expect(humanizeAge(180)).toBe('hace 3 h');
    expect(humanizeAge(60 * 24)).toBe('hace 1 día');
    expect(humanizeAge(60 * 24 * 3)).toBe('hace 3 días');
  });
});

describe('formatMoment', () => {
  it('distingue hoy, ayer y fechas anteriores', () => {
    const now = new Date(2026, 2, 12, 18, 0);
    expect(formatMoment(new Date(2026, 2, 12, 9, 5), now)).toBe('hoy a las 09:05');
    expect(formatMoment(new Date(2026, 2, 11, 18, 40), now)).toBe('ayer a las 18:40');
    expect(formatMoment(new Date(2026, 2, 3, 7, 0), now)).toBe('el 03/03 a las 07:00');
  });
});

describe('atribución obligatoria', () => {
  it('cita la fuente y aclara que no hay aval del Ministerio', () => {
    expect(SOURCE_ATTRIBUTION).toContain('Ministerio para la Transición Ecológica');
    expect(SOURCE_ATTRIBUTION).toContain('no está avalado');
  });
});
