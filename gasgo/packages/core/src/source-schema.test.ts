import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseSourceResponse,
  parseSourceDate,
  parseSourceCoordinate,
  parseStationRecord,
  madridOffsetMinutes,
  SourceContractError,
} from './source-schema.js';
import { FUELS, fuelFromSourceColumn } from './fuels.js';

/**
 * El fixture reproduce la ESTRUCTURA de la fuente oficial (claves con tildes, espacios y
 * coma decimal). Sus precios son inventados a propósito y nunca salen de los tests.
 */
const fixturePath = fileURLToPath(
  new URL('../test-fixtures/estructura-fuente-oficial.json', import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

describe('parseSourceResponse', () => {
  const snapshot = parseSourceResponse(fixture);

  it('lee la marca de tiempo oficial del volcado', () => {
    // 12/03/2026 18:40:11 hora peninsular (invierno, UTC+1) = 17:40:11 UTC.
    expect(snapshot.snapshotAt.toISOString()).toBe('2026-03-12T17:40:11.000Z');
  });

  it('descarta los registros sin coordenadas y explica el motivo', () => {
    expect(snapshot.stations).toHaveLength(2);
    expect(snapshot.problems.join(' ')).toContain('999003');
  });

  it('registra las columnas de precio desconocidas en vez de tragárselas', () => {
    expect(snapshot.unknownPriceColumns).toContain('Precio Combustible Inventado Del Futuro');
  });

  it('FIDELIDAD DE PRECIOS: cada precio parseado es exactamente el de la fuente', () => {
    const raw = fixture.ListaEESSPrecio[0];
    const parsed = snapshot.stations.find((s) => s.sourceStationId === '999001')!;

    for (const fuel of FUELS) {
      const rawValue = raw[fuel.sourceColumn];
      if (rawValue === undefined || String(rawValue).trim() === '') {
        expect(parsed.prices[fuel.code]).toBeUndefined();
        continue;
      }
      // El número parseado, reescrito con coma, debe coincidir carácter a carácter.
      const backToSource = parsed.prices[fuel.code]!.toFixed(3).replace('.', ',');
      expect(backToSource).toBe(String(rawValue));
    }
  });

  it('un producto que la estación no vende es ausencia, no precio 0', () => {
    const parsed = snapshot.stations.find((s) => s.sourceStationId === '999001')!;
    expect(parsed.prices.GLP).toBeUndefined();
    expect(Object.values(parsed.prices).every((p) => p > 0)).toBe(true);
  });

  it('conserva los metadatos de la estación', () => {
    const parsed = snapshot.stations.find((s) => s.sourceStationId === '999001')!;
    expect(parsed.brand).toBe('MARCA DE PRUEBA');
    expect(parsed.lat).toBeCloseTo(40.416775, 6);
    expect(parsed.lon).toBeCloseTo(-3.70379, 6);
    expect(parsed.saleType).toBe('P');
    expect(parsed.postalCode).toBe('28001');
    expect(parsed.schedule).toBe('L-D: 24H');
  });

  it('marca la venta restringida (Tipo Venta = R)', () => {
    const restringida = snapshot.stations.find((s) => s.sourceStationId === '999002')!;
    expect(restringida.saleType).toBe('R');
  });

  it('los campos vacíos se convierten en null, no en cadena vacía', () => {
    const segunda = snapshot.stations.find((s) => s.sourceStationId === '999002')!;
    expect(segunda.locality).toBeNull();
  });
});

describe('parseSourceResponse — contrato roto', () => {
  it('falla si no viene el array de estaciones', () => {
    expect(() => parseSourceResponse({ Fecha: '12/03/2026 18:40:11' })).toThrow(SourceContractError);
  });

  it('falla si no se puede leer la fecha oficial', () => {
    expect(() => parseSourceResponse({ Fecha: 'ayer', ListaEESSPrecio: [] })).toThrow(
      SourceContractError,
    );
  });

  it('falla si faltan claves obligatorias en los registros', () => {
    expect(() =>
      parseSourceResponse({
        Fecha: '12/03/2026 18:40:11',
        ListaEESSPrecio: [{ IDEESS: '1', Latitud: '40,0' }],
      }),
    ).toThrow(/Faltan claves obligatorias/);
  });

  it('no acepta una respuesta que no sea un objeto', () => {
    expect(() => parseSourceResponse('<html>error</html>')).toThrow(SourceContractError);
  });
});

describe('fechas y horario de verano peninsular', () => {
  it('aplica UTC+1 en invierno y UTC+2 en verano', () => {
    expect(madridOffsetMinutes(2026, 1, 15)).toBe(60);
    expect(madridOffsetMinutes(2026, 7, 15)).toBe(120);
  });

  it('interpreta la fecha oficial en hora peninsular', () => {
    expect(parseSourceDate('15/07/2026 10:00:00')!.toISOString()).toBe('2026-07-15T08:00:00.000Z');
    expect(parseSourceDate('15/01/2026 10:00:00')!.toISOString()).toBe('2026-01-15T09:00:00.000Z');
  });

  it('acepta la fecha sin segundos y rechaza formatos ajenos', () => {
    expect(parseSourceDate('15/01/2026 10:00')).not.toBeNull();
    expect(parseSourceDate('2026-01-15T10:00:00Z')).toBeNull();
    expect(parseSourceDate('')).toBeNull();
  });
});

describe('coordenadas', () => {
  it('lee la coma decimal y rechaza lo que no es coordenada', () => {
    expect(parseSourceCoordinate('40,416775')).toBeCloseTo(40.416775, 6);
    expect(parseSourceCoordinate('-3,703790')).toBeCloseTo(-3.70379, 6);
    expect(parseSourceCoordinate('')).toBeNull();
    expect(parseSourceCoordinate('N/D')).toBeNull();
  });

  it('descarta coordenadas fuera del rango terrestre', () => {
    const problems: string[] = [];
    const parsed = parseStationRecord(
      { IDEESS: '1', Latitud: '400,0', 'Longitud (WGS84)': '-3,7' },
      problems,
    );
    expect(parsed).toBeNull();
    expect(problems[0]).toContain('fuera de rango');
  });
});

describe('catálogo de combustibles', () => {
  it('cada combustible tiene una columna oficial única', () => {
    const columns = FUELS.map((f) => f.sourceColumn);
    expect(new Set(columns).size).toBe(columns.length);
  });

  it('todas las columnas empiezan por «Precio » para que el parser las detecte', () => {
    expect(FUELS.every((f) => f.sourceColumn.startsWith('Precio '))).toBe(true);
  });

  it('la traducción columna → combustible es exacta y sensible a tildes', () => {
    expect(fuelFromSourceColumn('Precio Gasoleo A')!.code).toBe('GOA');
    expect(fuelFromSourceColumn('Precio Gases licuados del petróleo')!.code).toBe('GLP');
    expect(fuelFromSourceColumn('Precio Gases licuados del petroleo')).toBeUndefined();
  });
});
