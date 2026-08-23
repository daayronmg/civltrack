/**
 * Cliente de la API de GASGO.
 *
 * La app NUNCA llama a la fuente oficial: solo a nuestro backend, que es quien ingiere,
 * valida y sirve los datos. Aquí no hay ninguna clave secreta; el único credencial es el
 * token anónimo del dispositivo, generado en el servidor y guardado en el llavero seguro.
 */

import Constants from 'expo-constants';
import type {
  FuelCode,
  StationSummary,
  StationDetail,
  PriceHistory,
  SourceMeta,
  AlertRule,
  VehicleProfile,
} from './types';

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** `true` cuando el backend aún no tiene datos oficiales ingeridos. */
  get isSinDatos(): boolean {
    return this.code === 'sin_datos_oficiales';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError('No se puede conectar con GASGO. Comprueba tu conexión.', 0);
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    throw new ApiError(
      (payload.mensaje as string) ?? (payload.error as string) ?? 'Error inesperado',
      response.status,
      payload.error as string | undefined,
    );
  }

  return payload as T;
}

export interface NearbyResponse {
  snapshotAt: string | null;
  attribution: string;
  count: number;
  cheapestStationId: string | null;
  stations: StationSummary[];
}

export interface BestOptionResponse {
  snapshotAt: string | null;
  attribution: string;
  best: EvaluatedStation;
  baseline: EvaluatedStation;
  cheapestByPrice: EvaluatedStation;
  savingsVsBaseline: number;
  cheapestIsNotBest: boolean;
  ranking: EvaluatedStation[];
  nota: string;
}

export interface EvaluatedStation {
  stationId: string;
  price: number;
  liters: number;
  detourMeters: number;
  detourMinutes: number;
  fuelCost: number;
  detourCost: number;
  totalCost: number;
  effectivePricePerLiter: number;
  station: StationSummary;
}

export interface RouteStation {
  station: StationSummary & { alongRouteMeters: number };
  distanceFromRouteMeters: number;
  alongRouteMeters: number;
  detourMinutes: number;
  totalCost: number;
  effectivePricePerLiter: number;
  savingsVsBaseline: number;
}

export const api = {
  baseUrl: API_URL,

  meta: (signal?: AbortSignal) => request<SourceMeta & { message: string | null }>('/v1/meta/source', { signal }),

  nearby: (params: {
    lat: number;
    lon: number;
    fuel: FuelCode;
    radius: number;
    order?: 'precio' | 'distancia';
    limit?: number;
    signal?: AbortSignal;
  }) => {
    const query = new URLSearchParams({
      lat: String(params.lat),
      lon: String(params.lon),
      fuel: params.fuel,
      radius: String(params.radius),
      order: params.order ?? 'distancia',
      limit: String(params.limit ?? 60),
    });
    return request<NearbyResponse>(`/v1/stations/nearby?${query}`, { signal: params.signal });
  },

  station: (id: string, origin?: { lat: number; lon: number }) => {
    const query = origin ? `?lat=${origin.lat}&lon=${origin.lon}` : '';
    return request<{ station: StationDetail; attribution: string }>(`/v1/stations/${id}${query}`);
  },

  history: (id: string, fuel: FuelCode, days = 30) =>
    request<{ history: PriceHistory; mensaje: string | null }>(
      `/v1/stations/${id}/history?fuel=${fuel}&days=${days}`,
    ),

  bestOption: (body: {
    lat: number;
    lon: number;
    radius: number;
    vehicle: VehicleProfile;
    liters?: number;
  }) => request<BestOptionResponse>('/v1/best-option', { method: 'POST', body }),

  routeStations: (body: {
    polyline: Array<{ lat: number; lon: number }>;
    corridorMeters: number;
    vehicle: VehicleProfile;
    liters?: number;
  }) =>
    request<{ stations: RouteStation[]; best: RouteStation | null; routeLengthMeters: number; mensaje?: string }>(
      '/v1/route/stations',
      { method: 'POST', body },
    ),

  registerDevice: (platform: 'ios' | 'android' | 'unknown', appVersion?: string) =>
    request<{ deviceId: string; token: string }>('/v1/devices', {
      method: 'POST',
      body: { platform, appVersion },
    }),

  setPushToken: (token: string, pushToken: string | null, consent: boolean) =>
    request<{ ok: boolean }>('/v1/devices/me/push', {
      method: 'PUT',
      token,
      body: { pushToken, consent },
    }),

  deleteDevice: (token: string) => request<{ ok: boolean }>('/v1/devices/me', { method: 'DELETE', token }),

  exportData: (token: string) => request<Record<string, unknown>>('/v1/devices/me/export', { token }),

  alerts: (token: string) => request<{ alerts: AlertRule[] }>('/v1/alerts', { token }),

  createAlert: (
    token: string,
    body: { fuel: FuelCode; thresholdPrice: number; radiusMeters: number; lat: number; lon: number; label?: string },
  ) => request<{ alert: AlertRule }>('/v1/alerts', { method: 'POST', token, body }),

  toggleAlert: (token: string, id: string, active: boolean) =>
    request<{ alert: AlertRule }>(`/v1/alerts/${id}`, { method: 'PATCH', token, body: { active } }),

  deleteAlert: (token: string, id: string) =>
    request<{ ok: boolean }>(`/v1/alerts/${id}`, { method: 'DELETE', token }),

  favorites: (token: string) =>
    request<{ favorites: Array<{ id: string; brand: string; address: string; municipality: string; lat: number; lon: number }> }>(
      '/v1/favorites',
      { token },
    ),

  addFavorite: (token: string, stationId: string) =>
    request<{ ok: boolean }>(`/v1/favorites/${stationId}`, { method: 'PUT', token }),

  removeFavorite: (token: string, stationId: string) =>
    request<{ ok: boolean }>(`/v1/favorites/${stationId}`, { method: 'DELETE', token }),
};
