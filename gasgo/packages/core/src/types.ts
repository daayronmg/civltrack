/** Tipos del contrato entre la API de GASGO y la app móvil. */

import type { FuelCode } from './fuels.js';

export type ValidationStatusPublic = 'aceptado' | 'sospechoso';

export interface StationPrice {
  fuel: FuelCode;
  /** Precio oficial, tal cual lo publica la fuente. */
  price: number;
  /** Marca de tiempo del volcado oficial del que procede (ISO 8601). */
  snapshotAt: string;
  /** Desde cuándo este valor no cambia, según el histórico de GASGO (ISO 8601). */
  valueSince: string | null;
}

export interface StationSummary {
  id: string;
  sourceStationId: string;
  brand: string;
  address: string;
  municipality: string;
  province: string;
  lat: number;
  lon: number;
  schedule: string | null;
  /** `false` cuando la venta es restringida (cooperativas, flotas). */
  publicSale: boolean;
  /** Distancia en línea recta desde el punto consultado, en metros. */
  distanceMeters: number;
  /** Precio del combustible consultado. */
  price: StationPrice | null;
}

export interface StationDetail extends Omit<StationSummary, 'distanceMeters' | 'price'> {
  distanceMeters: number | null;
  prices: StationPrice[];
  postalCode: string | null;
  locality: string | null;
}

export interface PriceHistoryPoint {
  /** Fecha del volcado (ISO 8601). */
  at: string;
  price: number;
}

export interface PriceHistory {
  fuel: FuelCode;
  current: number | null;
  /** Precios de referencia; `null` si GASGO todavía no tenía datos en ese momento. */
  ago24h: number | null;
  ago7d: number | null;
  ago30d: number | null;
  points: PriceHistoryPoint[];
  /** Desde cuándo tenemos histórico propio para esta estación (ISO 8601). */
  historySince: string | null;
}

export interface SourceMeta {
  source: string;
  sourceUrl: string;
  attribution: string;
  licence: string;
  /** Último volcado oficial ingerido (ISO 8601), o `null` si aún no hay datos. */
  lastSnapshotAt: string | null;
  /** Cuándo lo ingerimos (ISO 8601). */
  lastIngestedAt: string | null;
  stationCount: number;
  /** `false` si la base de datos está vacía: la app debe decirlo, no inventar. */
  hasData: boolean;
}

export interface AlertRule {
  id: string;
  fuel: FuelCode;
  /** Se avisa cuando el precio baja de este valor. */
  thresholdPrice: number;
  /** Radio de búsqueda en metros alrededor del punto de la alerta. */
  radiusMeters: number;
  lat: number;
  lon: number;
  label: string | null;
  active: boolean;
  createdAt: string;
  lastTriggeredAt: string | null;
}
