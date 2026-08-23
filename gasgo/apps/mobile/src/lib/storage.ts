/**
 * Almacenamiento local.
 *
 * - El token del dispositivo va al llavero seguro del sistema (Keychain en iOS,
 *   Keystore en Android) mediante expo-secure-store.
 * - Las preferencias (combustible, radio, vehículo) van a AsyncStorage: no son secretas.
 * - La ubicación del usuario NO se persiste nunca. Se usa en memoria y se descarta.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { FuelCode, VehicleProfile } from './types';

const TOKEN_KEY = 'gasgo.device.token';
const KEYS = {
  fuel: 'gasgo.pref.fuel',
  radius: 'gasgo.pref.radius',
  vehicle: 'gasgo.pref.vehicle',
  consent: 'gasgo.pref.pushConsent',
  onboarded: 'gasgo.pref.onboarded',
} as const;

export const deviceToken = {
  async get(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  async set(token: string): Promise<void> {
    await SecureStore.setItemAsync(TOKEN_KEY, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Una preferencia que no se puede guardar no debe romper la app.
  }
}

export const preferences = {
  getFuel: () => readJson<FuelCode>(KEYS.fuel, 'G95E5'),
  setFuel: (fuel: FuelCode) => writeJson(KEYS.fuel, fuel),

  getRadius: () => readJson<number>(KEYS.radius, 5_000),
  setRadius: (meters: number) => writeJson(KEYS.radius, meters),

  getVehicle: () =>
    readJson<VehicleProfile | null>(KEYS.vehicle, null),
  setVehicle: (vehicle: VehicleProfile) => writeJson(KEYS.vehicle, vehicle),

  getPushConsent: () => readJson<boolean>(KEYS.consent, false),
  setPushConsent: (consent: boolean) => writeJson(KEYS.consent, consent),

  isOnboarded: () => readJson<boolean>(KEYS.onboarded, false),
  setOnboarded: () => writeJson(KEYS.onboarded, true),

  async clearAll(): Promise<void> {
    await AsyncStorage.removeMany(Object.values(KEYS));
  },
};
