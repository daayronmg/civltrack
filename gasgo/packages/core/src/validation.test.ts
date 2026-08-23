import { describe, it, expect } from 'vitest';
import {
  validatePrice,
  parseSourcePrice,
  median,
  MAX_RELATIVE_JUMP,
} from './validation.js';

describe('parseSourcePrice — formato oficial', () => {
  it('convierte la coma decimal de la fuente', () => {
    expect(parseSourcePrice('1,489')).toBe(1.489);
    expect(parseSourcePrice('0,899')).toBe(0.899);
  });

  it('la cadena vacía significa «no vende ese producto», nunca 0', () => {
    expect(parseSourcePrice('')).toBeNull();
    expect(parseSourcePrice('   ')).toBeNull();
    expect(parseSourcePrice(null)).toBeNull();
    expect(parseSourcePrice(undefined)).toBeNull();
  });

  it('rechaza texto no numérico', () => {
    expect(parseSourcePrice('N/D')).toBeNull();
    expect(parseSourcePrice('-')).toBeNull();
  });

  it('no pierde precisión: tres decimales exactos', () => {
    expect(parseSourcePrice('1,459')).toBe(1.459);
    expect(parseSourcePrice('2,001')).toBe(2.001);
  });
});

describe('sistema antierrores', () => {
  it('acepta un precio normal sin histórico', () => {
    const result = validatePrice({ fuel: 'G95E5', newPrice: 1.489 });
    expect(result.status).toBe('aceptado');
  });

  it('detecta el decimal desplazado del enunciado: 1,489 → 0,149', () => {
    const result = validatePrice({ fuel: 'G95E5', newPrice: 0.149, previousPrice: 1.489 });
    // No se publica, y queda registrada la causa concreta, no un genérico «fuera de rango».
    expect(result.status).toBe('rechazado');
    expect(result.reasons).toContain('posible_error_decimal');
    expect(result.reasons).toContain('fuera_de_rango_absoluto');
  });

  it('un decimal desplazado que cae dentro del rango se marca como sospechoso', () => {
    // 0,089 → 0,899 en gasóleo B: ×10 exacto pero el valor resultante es plausible.
    const result = validatePrice({ fuel: 'GOB', newPrice: 0.899, previousPrice: 0.09 });
    expect(result.status).toBe('sospechoso');
    expect(result.reasons).toContain('posible_error_decimal');
  });

  it('detecta el decimal desplazado al alza: 1,489 → 14,89', () => {
    const result = validatePrice({ fuel: 'G95E5', newPrice: 14.89, previousPrice: 1.489 });
    // Fuera del rango absoluto de la gasolina: se rechaza directamente.
    expect(result.status).toBe('rechazado');
    expect(result.reasons).toContain('fuera_de_rango_absoluto');
  });

  it('rechaza precios no positivos', () => {
    expect(validatePrice({ fuel: 'GOA', newPrice: 0 }).status).toBe('rechazado');
    expect(validatePrice({ fuel: 'GOA', newPrice: -1.2 }).status).toBe('rechazado');
  });

  it('rechaza valores no numéricos', () => {
    expect(validatePrice({ fuel: 'GOA', newPrice: null }).status).toBe('rechazado');
    expect(validatePrice({ fuel: 'GOA', newPrice: Number.NaN }).status).toBe('rechazado');
  });

  it('marca como sospechoso un salto relativo mayor del límite', () => {
    const result = validatePrice({ fuel: 'GOA', newPrice: 1.9, previousPrice: 1.4 });
    expect(result.status).toBe('sospechoso');
    expect(result.reasons).toContain('salto_relativo_extremo');
    expect(result.relativeChange).toBeGreaterThan(MAX_RELATIVE_JUMP);
  });

  it('acepta una subida normal del día a día', () => {
    const result = validatePrice({ fuel: 'GOA', newPrice: 1.449, previousPrice: 1.429 });
    expect(result.status).toBe('aceptado');
    expect(result.relativeChange).toBeCloseTo(0.014, 3);
  });

  it('marca la desviación extrema frente a la mediana nacional', () => {
    const result = validatePrice({
      fuel: 'G95E5',
      newPrice: 0.75,
      nationalMedian: 1.55,
    });
    expect(result.status).toBe('sospechoso');
    expect(result.reasons).toContain('desviacion_extrema_vs_mediana');
  });

  it('una diferencia real entre gasolineras (±10 %) sí se acepta', () => {
    const result = validatePrice({ fuel: 'G95E5', newPrice: 1.39, nationalMedian: 1.55 });
    expect(result.status).toBe('aceptado');
  });

  it('cada combustible tiene su propio rango: el GLP es legítimamente barato', () => {
    expect(validatePrice({ fuel: 'GLP', newPrice: 0.849 }).status).toBe('aceptado');
    expect(validatePrice({ fuel: 'G95E5', newPrice: 0.35 }).status).toBe('rechazado');
  });

  it('siempre explica el motivo', () => {
    const result = validatePrice({ fuel: 'G95E5', newPrice: 0.149, previousPrice: 1.489 });
    expect(result.detail.length).toBeGreaterThan(10);
    expect(result.detail).toContain('0.149');
  });
});

describe('median', () => {
  it('calcula la mediana con lista par e impar', () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('ignora valores inválidos y devuelve null si no queda nada', () => {
    expect(median([0, -1, Number.NaN, 1.5])).toBe(1.5);
    expect(median([])).toBeNull();
    expect(median([0, -3])).toBeNull();
  });
});
