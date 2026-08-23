/**
 * Tipos del dominio en la app.
 *
 * Se reexportan desde @gasgo/core: son EXACTAMENTE los mismos que usa el backend.
 * Así, el motor de ahorro que ejecuta el móvil y el que ejecuta el servidor no pueden
 * divergir: es el mismo código.
 */
export type {
  FuelCode,
  FuelDefinition,
  StationSummary,
  StationDetail,
  StationPrice,
  PriceHistory,
  SourceMeta,
  AlertRule,
  VehicleProfile,
  CandidateEvaluation,
  Freshness,
  LatLng,
} from '@gasgo/core';
