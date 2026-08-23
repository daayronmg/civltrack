/**
 * Configuración del backend. Todo por variables de entorno.
 * Ninguna clave vive en el repositorio ni, mucho menos, en la app móvil.
 */

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Falta la variable de entorno obligatoria ${name}`);
  }
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} debe ser un entero`);
  return value;
}

export const SOURCE_ID = 'miteco_eess_terrestres';

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: integer('PORT', 3000),
  host: process.env.HOST ?? '0.0.0.0',
  logLevel: process.env.LOG_LEVEL ?? 'info',

  databaseUrl: required('DATABASE_URL', 'postgres://gasgo:gasgo@127.0.0.1:5432/gasgo'),
  databasePoolMax: integer('DATABASE_POOL_MAX', 10),

  source: {
    id: SOURCE_ID,
    /** Endpoint oficial. Se puede apuntar al espejo con GASGO_SOURCE_URL. */
    url:
      process.env.GASGO_SOURCE_URL ??
      'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/',
    /** Espejo del Ministerio, usado si el principal falla. */
    mirrorUrl:
      process.env.GASGO_SOURCE_MIRROR_URL ??
      'https://energia.serviciosmin.gob.es/ServiciosRestCarburantes/PreciosCarburantes/EstacionesTerrestres/',
    timeoutMs: integer('GASGO_SOURCE_TIMEOUT_MS', 120_000),
    retries: integer('GASGO_SOURCE_RETRIES', 3),
    /** Identificarnos ante la Administración es buena práctica y facilita el contacto. */
    userAgent:
      process.env.GASGO_USER_AGENT ??
      'GASGO/1.0 (aplicación de comparación de precios de carburante; contacto: soporte@gasgo.app)',
  },

  api: {
    /** Límite por IP y ventana. */
    rateLimitMax: integer('RATE_LIMIT_MAX', 120),
    rateLimitWindowMs: integer('RATE_LIMIT_WINDOW_MS', 60_000),
    corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
    /**
     * Altas de dispositivo por IP y hora. Ojo al bajarlo: muchos usuarios comparten IP
     * (CGNAT móvil, wifi pública), así que un valor muy bajo bloquea altas legítimas.
     */
    deviceRegistrationsPerHour: integer('DEVICE_REGISTRATIONS_PER_HOUR', 30),
    /** Máximo de estaciones que devuelve una consulta de proximidad. */
    maxStationsPerQuery: integer('MAX_STATIONS_PER_QUERY', 200),
    maxRadiusMeters: integer('MAX_RADIUS_METERS', 100_000),
  },

  push: {
    /** Endpoint de Expo Push. No requiere clave para envíos básicos. */
    expoUrl: process.env.EXPO_PUSH_URL ?? 'https://exp.host/--/api/v2/push/send',
    /** Token de acceso de Expo, si la cuenta lo exige. Solo en el servidor. */
    expoAccessToken: process.env.EXPO_ACCESS_TOKEN ?? null,
    enabled: process.env.PUSH_ENABLED !== 'false',
  },

  alerts: {
    /** No se vuelve a avisar de la misma alerta antes de este intervalo. */
    cooldownMinutes: integer('ALERT_COOLDOWN_MINUTES', 360),
  },
} as const;

export type Config = typeof config;
