import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { api } from '../lib/api';
import { deviceToken } from '../lib/storage';

/**
 * Identidad anónima del dispositivo.
 * Se registra la primera vez que hace falta (crear una alerta, guardar un favorito).
 * Navegar por el mapa NO requiere identificarse.
 */
export function useDevice() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void deviceToken.get().then((stored) => {
      if (!cancelled) {
        setToken(stored);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Devuelve el token, registrando el dispositivo si aún no existía. */
  const ensureToken = useCallback(async (): Promise<string> => {
    const existing = await deviceToken.get();
    if (existing) {
      setToken(existing);
      return existing;
    }

    const platform: 'ios' | 'android' | 'unknown' =
      Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'unknown';
    const { token: fresh } = await api.registerDevice(
      platform,
      Constants.expoConfig?.version ?? undefined,
    );
    await deviceToken.set(fresh);
    setToken(fresh);
    return fresh;
  }, []);

  const forget = useCallback(async (): Promise<void> => {
    const current = await deviceToken.get();
    if (current) {
      try {
        await api.deleteDevice(current);
      } catch {
        // Aunque el servidor falle, borramos el token local.
      }
    }
    await deviceToken.clear();
    setToken(null);
  }, []);

  return { token, loading, ensureToken, forget };
}
