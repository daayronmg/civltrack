import { useQuery } from '@tanstack/react-query';
import { api, ApiError, type NearbyResponse } from '../lib/api';
import type { FuelCode, LatLng } from '../lib/types';

/**
 * Gasolineras cercanas.
 *
 * `staleTime` corto porque la fuente publica volcados nuevos con frecuencia; aun así, cada
 * respuesta trae su propia marca de tiempo y la interfaz muestra siempre lo antigua que es.
 */
export function useNearbyStations(params: {
  coords: LatLng | null;
  fuel: FuelCode;
  radius: number;
  order?: 'precio' | 'distancia';
  enabled?: boolean;
}) {
  const { coords, fuel, radius, order = 'distancia', enabled = true } = params;

  return useQuery<NearbyResponse, ApiError>({
    queryKey: ['nearby', coords?.lat.toFixed(4), coords?.lon.toFixed(4), fuel, radius, order],
    enabled: enabled && coords !== null,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: (failureCount, error) => {
      // No reintentamos cuando el backend dice explícitamente que no hay datos oficiales.
      if (error instanceof ApiError && (error.isSinDatos || error.status === 400)) return false;
      return failureCount < 2;
    },
    queryFn: ({ signal }) =>
      api.nearby({ lat: coords!.lat, lon: coords!.lon, fuel, radius, order, signal }),
  });
}

export function useSourceMeta() {
  return useQuery({
    queryKey: ['meta'],
    staleTime: 60_000,
    queryFn: ({ signal }) => api.meta(signal),
  });
}
