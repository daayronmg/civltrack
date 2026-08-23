import { useCallback, useEffect, useState } from 'react';
import { preferences } from '../lib/storage';
import type { FuelCode, VehicleProfile } from '../lib/types';
import { DEFAULT_VEHICLE } from '@gasgo/core';

/**
 * Preferencias del usuario (combustible, radio y vehículo).
 * Se guardan en el dispositivo; no se envían a ningún servidor salvo cuando hacen falta
 * para calcular una recomendación (y entonces viajan como parámetros, no como perfil).
 */
export function usePreferences() {
  const [fuel, setFuelState] = useState<FuelCode>('G95E5');
  const [radius, setRadiusState] = useState(5_000);
  const [vehicle, setVehicleState] = useState<VehicleProfile>(DEFAULT_VEHICLE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [storedFuel, storedRadius, storedVehicle] = await Promise.all([
        preferences.getFuel(),
        preferences.getRadius(),
        preferences.getVehicle(),
      ]);
      if (cancelled) return;
      setFuelState(storedFuel);
      setRadiusState(storedRadius);
      if (storedVehicle) setVehicleState(storedVehicle);
      else setVehicleState({ ...DEFAULT_VEHICLE, fuel: storedFuel });
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setFuel = useCallback(async (next: FuelCode) => {
    setFuelState(next);
    await preferences.setFuel(next);
  }, []);

  const setRadius = useCallback(async (next: number) => {
    setRadiusState(next);
    await preferences.setRadius(next);
  }, []);

  const setVehicle = useCallback(async (next: VehicleProfile) => {
    setVehicleState(next);
    await preferences.setVehicle(next);
    // El combustible del vehículo manda: es el que se busca en el mapa.
    setFuelState(next.fuel);
    await preferences.setFuel(next.fuel);
  }, []);

  return { fuel, setFuel, radius, setRadius, vehicle, setVehicle, loaded };
}
