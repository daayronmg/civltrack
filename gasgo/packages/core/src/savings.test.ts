import { describe, it, expect } from 'vitest';
import {
  computeBestOption,
  evaluateCandidate,
  litersToRefuel,
  savingsBetween,
  fullTankCost,
  formatEuros,
  formatPrice,
  ROAD_DETOUR_FACTOR,
  type VehicleProfile,
} from './savings.js';

const COCHE: VehicleProfile = {
  fuel: 'G95E5',
  consumptionPer100Km: 7,
  tankCapacityLiters: 55,
  typicalRefuelLiters: 40,
};

describe('litersToRefuel', () => {
  it('usa los litros habituales del perfil', () => {
    expect(litersToRefuel(COCHE)).toBe(40);
  });

  it('nunca supera la capacidad del depósito', () => {
    expect(litersToRefuel(COCHE, 200)).toBe(55);
  });

  it('sin litros habituales asume el 80 % del depósito', () => {
    expect(litersToRefuel({ ...COCHE, typicalRefuelLiters: undefined })).toBe(44);
  });

  it('el parámetro explícito manda sobre el perfil', () => {
    expect(litersToRefuel(COCHE, 20)).toBe(20);
  });
});

describe('evaluateCandidate', () => {
  it('suma el combustible quemado en el desvío al coste total', () => {
    const evaluation = evaluateCandidate(
      { stationId: 'A', price: 1.5, straightLineMeters: 10_000 },
      COCHE,
    );
    // 10 km en recta → 13 km de conducción estimados → 26 km ida y vuelta.
    expect(evaluation.detourMeters).toBeCloseTo(10_000 * ROAD_DETOUR_FACTOR * 2, 5);
    // 26 km × 7 L/100 km = 1,82 L quemados × 1,50 € = 2,73 €
    expect(evaluation.detourCost).toBeCloseTo(2.73, 2);
    expect(evaluation.fuelCost).toBeCloseTo(60, 2);
    expect(evaluation.totalCost).toBeCloseTo(62.73, 2);
    expect(evaluation.drivingIsEstimated).toBe(true);
  });

  it('usa la distancia real de conducción cuando se conoce', () => {
    const evaluation = evaluateCandidate(
      { stationId: 'A', price: 1.5, straightLineMeters: 10_000, drivingMeters: 11_000 },
      COCHE,
    );
    expect(evaluation.drivingMeters).toBe(11_000);
    expect(evaluation.drivingIsEstimated).toBe(false);
    expect(evaluation.detourMeters).toBe(22_000);
  });

  it('el precio efectivo por litro incluye el desvío y es mayor que el de surtidor', () => {
    const evaluation = evaluateCandidate(
      { stationId: 'A', price: 1.449, straightLineMeters: 15_000 },
      COCHE,
    );
    expect(evaluation.effectivePricePerLiter).toBeGreaterThan(1.449);
  });

  it('sin desvío, el precio efectivo es el de surtidor', () => {
    const evaluation = evaluateCandidate(
      { stationId: 'A', price: 1.449, straightLineMeters: 0 },
      COCHE,
    );
    expect(evaluation.effectivePricePerLiter).toBeCloseTo(1.449, 3);
    expect(evaluation.detourCost).toBe(0);
  });
});

describe('computeBestOption — el caso del enunciado', () => {
  // Gasolinera A: 1,449 €/L a 15 km. Gasolinera B: 1,469 €/L a 1 km.
  const A = { stationId: 'A', price: 1.449, straightLineMeters: 15_000 };
  const B = { stationId: 'B', price: 1.469, straightLineMeters: 1_000 };

  it('recomienda B aunque A sea más barata en surtidor', () => {
    const result = computeBestOption([A, B], COCHE)!;
    expect(result.best.stationId).toBe('B');
    expect(result.cheapestByPrice.stationId).toBe('A');
    expect(result.cheapestIsNotBest).toBe(true);
  });

  it('la referencia es la estación más cercana', () => {
    const result = computeBestOption([A, B], COCHE)!;
    expect(result.baseline.stationId).toBe('B');
  });

  it('el ahorro nunca es negativo', () => {
    const result = computeBestOption([A, B], COCHE)!;
    expect(result.savingsVsBaseline).toBeGreaterThanOrEqual(0);
  });

  it('ir a A en lugar de B sale más caro: el ahorro es negativo', () => {
    const result = computeBestOption([A, B], COCHE)!;
    const evalA = result.ranking.find((r) => r.stationId === 'A')!;
    const evalB = result.ranking.find((r) => r.stationId === 'B')!;
    expect(savingsBetween(evalA, evalB)).toBeLessThan(0);
  });

  it('con una diferencia de precio grande sí compensa desplazarse', () => {
    const barataLejos = { stationId: 'A', price: 1.299, straightLineMeters: 15_000 };
    const result = computeBestOption([barataLejos, B], COCHE)!;
    expect(result.best.stationId).toBe('A');
    expect(result.savingsVsBaseline).toBeGreaterThan(0);
    // 40 L × 0,17 €/L = 6,80 € brutos, menos ~3,55 € de combustible quemado en 39 km
    // de desvío, más los 0,27 € que también cuesta llegar a la de referencia ≈ 3,5 €.
    expect(result.savingsVsBaseline).toBeGreaterThan(3);
    expect(result.savingsVsBaseline).toBeLessThan(4.5);
  });

  it('un consumo mayor penaliza más el desvío', () => {
    const barataLejos = { stationId: 'A', price: 1.35, straightLineMeters: 20_000 };
    const eficiente = computeBestOption([barataLejos, B], { ...COCHE, consumptionPer100Km: 4 })!;
    const camion = computeBestOption([barataLejos, B], { ...COCHE, consumptionPer100Km: 30 })!;
    expect(eficiente.best.stationId).toBe('A');
    expect(camion.best.stationId).toBe('B');
  });

  it('repostar más litros hace que compense desviarse más', () => {
    const barataLejos = { stationId: 'A', price: 1.40, straightLineMeters: 12_000 };
    const pocosLitros = computeBestOption([barataLejos, B], COCHE, { liters: 5 })!;
    const depositoLleno = computeBestOption([barataLejos, B], COCHE, { liters: 55 })!;
    expect(pocosLitros.best.stationId).toBe('B');
    expect(depositoLleno.best.stationId).toBe('A');
  });

  it('el ranking va ordenado por coste total ascendente', () => {
    const result = computeBestOption(
      [A, B, { stationId: 'C', price: 1.379, straightLineMeters: 4_000 }],
      COCHE,
    )!;
    const costs = result.ranking.map((r) => r.totalCost);
    expect([...costs].sort((x, y) => x - y)).toEqual(costs);
    expect(result.ranking[0]!.stationId).toBe(result.best.stationId);
  });

  it('sin candidatas devuelve null: sin datos no se recomienda nada', () => {
    expect(computeBestOption([], COCHE)).toBeNull();
  });

  it('en modo ruta se usa el desvío indicado, no la distancia al origen', () => {
    const enRuta = evaluateCandidate(
      { stationId: 'A', price: 1.4, straightLineMeters: 80_000, detourMeters: 1_400 },
      COCHE,
      { mode: 'en_ruta' },
    );
    expect(enRuta.detourMeters).toBe(1_400);
    expect(enRuta.detourCost).toBeLessThan(0.2);
  });
});

describe('formato español', () => {
  it('usa coma decimal', () => {
    expect(formatEuros(3.8)).toBe('3,80 €');
    expect(formatPrice(1.489)).toBe('1,489');
    expect(fullTankCost(1.5, COCHE)).toBe(82.5);
  });
});
