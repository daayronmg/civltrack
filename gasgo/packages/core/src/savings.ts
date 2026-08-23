/**
 * Motor de «mejor opción» de GASGO.
 *
 * Regla de negocio: el precio del surtidor NO es el coste real. Ir más lejos a repostar
 * quema combustible y cuesta tiempo. Este módulo compara el COSTE TOTAL de repostar en cada
 * estación candidata frente a lo que el usuario habría hecho por defecto (la estación más
 * cercana que vende su combustible) y devuelve el ahorro real estimado.
 *
 * Todo lo que sale de aquí es una ESTIMACIÓN de GASGO y así debe etiquetarse en la interfaz.
 * El único dato oficial es el precio; el resto son cálculos derivados.
 */

import type { FuelCode } from './fuels.js';

export interface VehicleProfile {
  /** Combustible que usa el vehículo. */
  fuel: FuelCode;
  /** Consumo medio en L/100 km (o kg/100 km para GNC/GNL/H₂). */
  consumptionPer100Km: number;
  /** Capacidad del depósito en litros (o kg). */
  tankCapacityLiters: number;
  /** Litros que suele repostar. Si no se indica, se asume el 80 % del depósito. */
  typicalRefuelLiters?: number;
}

export const DEFAULT_VEHICLE: VehicleProfile = {
  fuel: 'G95E5',
  consumptionPer100Km: 6.5,
  tankCapacityLiters: 50,
  typicalRefuelLiters: 40,
};

/** Velocidad media asumida para convertir el desvío en minutos. */
export const DEFAULT_DETOUR_SPEED_KMH = 45;

/**
 * Factor de sinuosidad: la distancia por carretera es mayor que la distancia en línea recta.
 * 1,3 es el valor que usamos cuando no tenemos una distancia de conducción real de un
 * proveedor de rutas. Se documenta en la interfaz como estimación.
 */
export const ROAD_DETOUR_FACTOR = 1.3;

export interface StationCandidate {
  stationId: string;
  /** Precio oficial del combustible en esa estación (€/L o €/kg). */
  price: number;
  /** Distancia en línea recta desde el origen, en metros. */
  straightLineMeters: number;
  /**
   * Distancia real de conducción en metros, si se conoce (proveedor de rutas).
   * Si falta, se estima con ROAD_DETOUR_FACTOR.
   */
  drivingMeters?: number;
  /** Duración de conducción en segundos, si se conoce. */
  drivingSeconds?: number;
  /**
   * Metros adicionales de desvío respecto al trayecto que el usuario ya iba a hacer.
   * Se usa en modo ruta; si falta, se deduce del modo de cálculo.
   */
  detourMeters?: number;
}

export interface SavingsOptions {
  /**
   * `viaje_dedicado`: el usuario sale a repostar y vuelve → el desvío cuenta ida y vuelta.
   * `en_ruta`: ya está conduciendo por esa ruta → solo cuenta el desvío respecto a la ruta.
   */
  mode?: 'viaje_dedicado' | 'en_ruta';
  /** Velocidad media para estimar minutos de desvío. */
  detourSpeedKmh?: number;
  /** Litros a repostar; si falta se deduce del perfil del vehículo. */
  liters?: number;
}

export interface CandidateEvaluation {
  stationId: string;
  price: number;
  liters: number;
  /** Distancia en línea recta al origen (m). */
  straightLineMeters: number;
  /** Distancia de conducción usada en el cálculo (m), real o estimada. */
  drivingMeters: number;
  /** `true` si `drivingMeters` es una estimación y no una distancia real de un router. */
  drivingIsEstimated: boolean;
  /** Metros extra recorridos por ir a esta estación (ya incluye ida y vuelta si procede). */
  detourMeters: number;
  /** Minutos extra estimados. */
  detourMinutes: number;
  /** Coste del combustible repostado: litros × precio. */
  fuelCost: number;
  /** Coste del combustible quemado en el desvío. */
  detourCost: number;
  /** fuelCost + detourCost. */
  totalCost: number;
  /** totalCost / litros: lo que realmente te cuesta el litro yendo ahí. */
  effectivePricePerLiter: number;
}

export interface BestOptionResult {
  /** Estación de referencia: la más cercana que vende el combustible (lo que harías por defecto). */
  baseline: CandidateEvaluation;
  /** Mejor opción por coste total. */
  best: CandidateEvaluation;
  /** Estación con el precio de surtidor más bajo (puede no ser la mejor opción). */
  cheapestByPrice: CandidateEvaluation;
  /** Ahorro estimado de `best` frente a `baseline`, en euros. Nunca negativo. */
  savingsVsBaseline: number;
  /** `true` si la más barata por precio NO es la mejor opción por coste total. */
  cheapestIsNotBest: boolean;
  /** Todas las candidatas, ordenadas por coste total ascendente. */
  ranking: CandidateEvaluation[];
}

export function litersToRefuel(vehicle: VehicleProfile, override?: number): number {
  const raw = override ?? vehicle.typicalRefuelLiters ?? vehicle.tankCapacityLiters * 0.8;
  const capped = Math.min(raw, vehicle.tankCapacityLiters);
  return Math.max(1, Math.round(capped * 100) / 100);
}

function drivingDistanceMeters(candidate: StationCandidate): { meters: number; estimated: boolean } {
  if (typeof candidate.drivingMeters === 'number' && candidate.drivingMeters >= 0) {
    return { meters: candidate.drivingMeters, estimated: false };
  }
  return { meters: candidate.straightLineMeters * ROAD_DETOUR_FACTOR, estimated: true };
}

export function evaluateCandidate(
  candidate: StationCandidate,
  vehicle: VehicleProfile,
  options: SavingsOptions = {},
): CandidateEvaluation {
  const mode = options.mode ?? 'viaje_dedicado';
  const speed = options.detourSpeedKmh ?? DEFAULT_DETOUR_SPEED_KMH;
  const liters = litersToRefuel(vehicle, options.liters);

  const { meters: drivingMeters, estimated } = drivingDistanceMeters(candidate);

  // Metros efectivamente extra por ir a esta estación.
  const detourMeters =
    typeof candidate.detourMeters === 'number'
      ? candidate.detourMeters
      : mode === 'viaje_dedicado'
        ? drivingMeters * 2 // ida y vuelta
        : drivingMeters * 2; // salir de la ruta y volver a ella

  const detourKm = detourMeters / 1000;
  const litersBurned = (detourKm * vehicle.consumptionPer100Km) / 100;

  const fuelCost = liters * candidate.price;
  // El combustible quemado en el desvío se valora al precio de la estación a la que vas:
  // es el que acabarás reponiendo. Aproximación documentada.
  const detourCost = litersBurned * candidate.price;
  const totalCost = fuelCost + detourCost;

  // Ida y vuelta en los dos modos: o vuelves a casa, o vuelves a la ruta.
  const detourMinutes =
    typeof candidate.drivingSeconds === 'number'
      ? (candidate.drivingSeconds / 60) * 2
      : (detourKm / speed) * 60;

  return {
    stationId: candidate.stationId,
    price: candidate.price,
    liters,
    straightLineMeters: candidate.straightLineMeters,
    drivingMeters,
    drivingIsEstimated: estimated,
    detourMeters,
    detourMinutes,
    fuelCost: round2(fuelCost),
    detourCost: round2(detourCost),
    totalCost: round2(totalCost),
    effectivePricePerLiter: round3(totalCost / liters),
  };
}

/**
 * Calcula la mejor opción del conjunto.
 * Devuelve `null` si no hay candidatas (sin datos oficiales no se recomienda nada).
 */
export function computeBestOption(
  candidates: readonly StationCandidate[],
  vehicle: VehicleProfile,
  options: SavingsOptions = {},
): BestOptionResult | null {
  if (candidates.length === 0) return null;

  const evaluations = candidates.map((c) => evaluateCandidate(c, vehicle, options));

  const baseline = evaluations.reduce((closest, current) =>
    current.straightLineMeters < closest.straightLineMeters ? current : closest,
  );
  const best = evaluations.reduce((cheapest, current) => {
    if (current.totalCost < cheapest.totalCost) return current;
    // Empate en coste: gana la más cercana.
    if (current.totalCost === cheapest.totalCost && current.detourMeters < cheapest.detourMeters) {
      return current;
    }
    return cheapest;
  });
  const cheapestByPrice = evaluations.reduce((cheapest, current) => {
    if (current.price < cheapest.price) return current;
    if (current.price === cheapest.price && current.totalCost < cheapest.totalCost) return current;
    return cheapest;
  });

  const ranking = [...evaluations].sort((a, b) => a.totalCost - b.totalCost);

  return {
    baseline,
    best,
    cheapestByPrice,
    savingsVsBaseline: round2(Math.max(0, baseline.totalCost - best.totalCost)),
    cheapestIsNotBest: cheapestByPrice.stationId !== best.stationId,
    ranking,
  };
}

/**
 * Ahorro de repostar en `candidate` en lugar de en `reference`, ya descontado el desvío.
 * Puede ser negativo: ir más lejos por un precio ligeramente menor puede salir caro.
 */
export function savingsBetween(
  candidate: CandidateEvaluation,
  reference: CandidateEvaluation,
): number {
  return round2(reference.totalCost - candidate.totalCost);
}

/** Coste de llenar el depósito entero a ese precio, sin contar desvíos. */
export function fullTankCost(price: number, vehicle: VehicleProfile): number {
  return round2(price * vehicle.tankCapacityLiters);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Formatea euros en convención española: «3,80 €». */
export function formatEuros(value: number, decimals = 2): string {
  return `${value.toFixed(decimals).replace('.', ',')} €`;
}

/** Formatea un precio de carburante con 3 decimales: «1,489». */
export function formatPrice(value: number): string {
  return value.toFixed(3).replace('.', ',');
}
