import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';
import type { LatLng } from '../lib/types';

export type LocationStatus =
  | 'pidiendo'
  | 'concedido'
  | 'denegado'
  | 'servicios_desactivados'
  | 'error';

/**
 * Ubicación del usuario.
 *
 * RGPD: se pide permiso «mientras se usa la app», se utiliza en memoria para consultar
 * gasolineras cercanas y NO se persiste en ningún sitio, ni local ni remoto.
 * El backend recibe unas coordenadas en la consulta, no un identificador de usuario.
 */
export function useLocation(autoRequest = true) {
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [status, setStatus] = useState<LocationStatus>('pidiendo');
  const [accuracy, setAccuracy] = useState<number | null>(null);

  const request = useCallback(async (): Promise<LatLng | null> => {
    try {
      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) {
        setStatus('servicios_desactivados');
        return null;
      }

      const { status: permission } = await Location.requestForegroundPermissionsAsync();
      if (permission !== Location.PermissionStatus.GRANTED) {
        setStatus('denegado');
        return null;
      }

      // `Balanced` es suficiente para buscar gasolineras y gasta mucha menos batería.
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const value: LatLng = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      };
      setCoords(value);
      setAccuracy(position.coords.accuracy ?? null);
      setStatus('concedido');
      return value;
    } catch {
      setStatus('error');
      return null;
    }
  }, []);

  useEffect(() => {
    if (autoRequest) void request();
  }, [autoRequest, request]);

  return { coords, status, accuracy, request };
}
