import { z } from 'zod';
import { FUELS } from '@gasgo/core';
import { config } from '../config.js';

const fuelCodes = FUELS.map((f) => f.code) as [string, ...string[]];

export const fuelSchema = z.enum(fuelCodes);

export const coordinateSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

export const nearbyQuerySchema = coordinateSchema.extend({
  fuel: fuelSchema,
  radius: z.coerce.number().int().min(200).max(config.api.maxRadiusMeters).default(5_000),
  limit: z.coerce.number().int().min(1).max(config.api.maxStationsPerQuery).default(50),
  order: z.enum(['precio', 'distancia']).default('distancia'),
  incluirRestringidas: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .default(false),
  marcas: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [])),
});

export const boxQuerySchema = z.object({
  minLat: z.coerce.number().min(-90).max(90),
  maxLat: z.coerce.number().min(-90).max(90),
  minLon: z.coerce.number().min(-180).max(180),
  maxLon: z.coerce.number().min(-180).max(180),
  fuel: fuelSchema,
  limit: z.coerce.number().int().min(1).max(config.api.maxStationsPerQuery).default(120),
});

export const vehicleSchema = z.object({
  fuel: fuelSchema,
  consumptionPer100Km: z.number().positive().max(99),
  tankCapacityLiters: z.number().positive().max(1000),
  typicalRefuelLiters: z.number().positive().max(1000).optional(),
});

export const bestOptionBodySchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radius: z.number().int().min(200).max(config.api.maxRadiusMeters).default(10_000),
  vehicle: vehicleSchema,
  liters: z.number().positive().max(1000).optional(),
  limit: z.number().int().min(1).max(config.api.maxStationsPerQuery).default(60),
  incluirRestringidas: z.boolean().default(false),
});

export const routeBodySchema = z.object({
  /** Polilínea de la ruta. Se admite la codificada de Google o una lista de puntos. */
  polyline: z
    .array(z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }))
    .min(2)
    .max(2_000)
    .optional(),
  encodedPolyline: z.string().min(4).max(200_000).optional(),
  corridorMeters: z.number().int().min(200).max(20_000).default(3_000),
  vehicle: vehicleSchema,
  liters: z.number().positive().max(1000).optional(),
  limit: z.number().int().min(1).max(100).default(30),
});

export const historyQuerySchema = z.object({
  fuel: fuelSchema,
  days: z.coerce.number().int().min(1).max(90).default(30),
});

export const deviceRegisterSchema = z.object({
  platform: z.enum(['ios', 'android', 'unknown']).default('unknown'),
  appVersion: z.string().max(32).optional(),
});

export const pushTokenSchema = z.object({
  pushToken: z.string().min(10).max(256).nullable(),
  /** Consentimiento explícito para notificaciones (RGPD). */
  consent: z.boolean(),
});

export const alertSchema = z.object({
  fuel: fuelSchema,
  thresholdPrice: z.number().positive().max(20),
  radiusMeters: z.number().int().min(500).max(100_000),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  label: z.string().max(80).optional(),
});

export type NearbyQuery = z.infer<typeof nearbyQuerySchema>;
export type BestOptionBody = z.infer<typeof bestOptionBodySchema>;
export type RouteBody = z.infer<typeof routeBodySchema>;
export type AlertBody = z.infer<typeof alertSchema>;
