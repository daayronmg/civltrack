import type { FastifyInstance } from 'fastify';
import type { Sql } from '../db/client.js';
import { config } from '../config.js';
import { generateDeviceToken, hashToken, requireDevice } from '../lib/auth.js';
import {
  deviceRegisterSchema,
  pushTokenSchema,
  vehicleSchema,
  alertSchema,
} from './schemas.js';

export async function registerDeviceRoutes(app: FastifyInstance, sql: Sql): Promise<void> {
  const auth = requireDevice(sql);

  /**
   * Alta anónima de dispositivo. Devuelve el token UNA sola vez; el servidor guarda su hash.
   * No se pide correo, ni nombre, ni identificador de publicidad.
   */
  app.post('/v1/devices', {
    config: { rateLimit: { max: config.api.deviceRegistrationsPerHour, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const parsed = deviceRegisterSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'parametros_invalidos', detalle: parsed.error.flatten() });
    }

    const token = generateDeviceToken();
    const [device] = await sql<Array<{ id: string; created_at: Date }>>`
      INSERT INTO devices (token_hash, platform, app_version)
      VALUES (${hashToken(token)}, ${parsed.data.platform}, ${parsed.data.appVersion ?? null})
      RETURNING id, created_at
    `;

    return reply.code(201).send({
      deviceId: device!.id,
      // Guárdalo en el llavero seguro del móvil: no se puede recuperar después.
      token,
      createdAt: device!.created_at.toISOString(),
    });
  });

  /** Consentimiento y token de notificaciones push. Revocable en cualquier momento. */
  app.put('/v1/devices/me/push', { preHandler: auth }, async (request, reply) => {
    const parsed = pushTokenSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'parametros_invalidos', detalle: parsed.error.flatten() });
    }
    const { pushToken, consent } = parsed.data;

    await sql`
      UPDATE devices
      SET push_token = ${consent ? pushToken : null}, push_consent = ${consent}
      WHERE id = ${request.device!.id}
    `;
    return reply.send({ ok: true, pushConsent: consent });
  });

  /** Borrado total de los datos del dispositivo (art. 17 RGPD, derecho de supresión). */
  app.delete('/v1/devices/me', { preHandler: auth }, async (request, reply) => {
    await sql`DELETE FROM devices WHERE id = ${request.device!.id}`;
    return reply.send({ ok: true, mensaje: 'Dispositivo y todos sus datos eliminados.' });
  });

  /** Exportación de los datos del dispositivo (art. 20 RGPD, portabilidad). */
  app.get('/v1/devices/me/export', { preHandler: auth }, async (request, reply) => {
    const deviceId = request.device!.id;
    const [device] = await sql`
      SELECT id, platform, push_consent, app_version, created_at, last_seen_at
      FROM devices WHERE id = ${deviceId}
    `;
    const vehicles = await sql`SELECT * FROM vehicles WHERE device_id = ${deviceId}`;
    const alerts = await sql`SELECT * FROM price_alerts WHERE device_id = ${deviceId}`;
    const favorites = await sql`SELECT station_id, created_at FROM favorites WHERE device_id = ${deviceId}`;

    return reply.send({ device, vehicles, alerts, favorites });
  });

  // ---------------------------------------------------------------- vehículos
  app.get('/v1/vehicles', { preHandler: auth }, async (request, reply) => {
    const vehicles = await sql`
      SELECT id, label, fuel, consumption_per_100km, tank_capacity_liters,
             typical_refuel_liters, is_default
      FROM vehicles WHERE device_id = ${request.device!.id} ORDER BY created_at
    `;
    return reply.send({ vehicles });
  });

  app.post('/v1/vehicles', { preHandler: auth }, async (request, reply) => {
    const parsed = vehicleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'parametros_invalidos', detalle: parsed.error.flatten() });
    }
    const body = request.body as { label?: string };
    const v = parsed.data;

    const [vehicle] = await sql`
      INSERT INTO vehicles (device_id, label, fuel, consumption_per_100km,
                            tank_capacity_liters, typical_refuel_liters, is_default)
      VALUES (${request.device!.id}, ${body.label ?? null}, ${v.fuel}, ${v.consumptionPer100Km},
              ${v.tankCapacityLiters}, ${v.typicalRefuelLiters ?? null},
              NOT EXISTS (SELECT 1 FROM vehicles WHERE device_id = ${request.device!.id}))
      RETURNING *
    `;
    return reply.code(201).send({ vehicle });
  });

  app.put<{ Params: { id: string } }>('/v1/vehicles/:id', { preHandler: auth }, async (request, reply) => {
    const parsed = vehicleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'parametros_invalidos', detalle: parsed.error.flatten() });
    }
    const v = parsed.data;
    const [vehicle] = await sql`
      UPDATE vehicles SET
        fuel = ${v.fuel},
        consumption_per_100km = ${v.consumptionPer100Km},
        tank_capacity_liters = ${v.tankCapacityLiters},
        typical_refuel_liters = ${v.typicalRefuelLiters ?? null},
        updated_at = now()
      WHERE id = ${request.params.id} AND device_id = ${request.device!.id}
      RETURNING *
    `;
    if (!vehicle) return reply.code(404).send({ error: 'vehiculo_no_encontrado' });
    return reply.send({ vehicle });
  });

  app.delete<{ Params: { id: string } }>('/v1/vehicles/:id', { preHandler: auth }, async (request, reply) => {
    const deleted = await sql`
      DELETE FROM vehicles WHERE id = ${request.params.id} AND device_id = ${request.device!.id}
      RETURNING id
    `;
    if (deleted.length === 0) return reply.code(404).send({ error: 'vehiculo_no_encontrado' });
    return reply.send({ ok: true });
  });

  // --------------------------------------------------------------- favoritos
  app.get('/v1/favorites', { preHandler: auth }, async (request, reply) => {
    const favorites = await sql`
      SELECT s.id, s.brand, s.address, s.municipality, s.province, s.lat, s.lon, f.created_at
      FROM favorites f
      JOIN stations s ON s.id = f.station_id
      WHERE f.device_id = ${request.device!.id}
      ORDER BY f.created_at DESC
    `;
    return reply.send({ favorites });
  });

  app.put<{ Params: { stationId: string } }>(
    '/v1/favorites/:stationId',
    { preHandler: auth },
    async (request, reply) => {
      const [station] = await sql`SELECT id FROM stations WHERE id = ${request.params.stationId}`;
      if (!station) return reply.code(404).send({ error: 'estacion_no_encontrada' });

      await sql`
        INSERT INTO favorites (device_id, station_id)
        VALUES (${request.device!.id}, ${request.params.stationId})
        ON CONFLICT DO NOTHING
      `;
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { stationId: string } }>(
    '/v1/favorites/:stationId',
    { preHandler: auth },
    async (request, reply) => {
      await sql`
        DELETE FROM favorites
        WHERE device_id = ${request.device!.id} AND station_id = ${request.params.stationId}
      `;
      return reply.send({ ok: true });
    },
  );

  // ----------------------------------------------------------------- alertas
  app.get('/v1/alerts', { preHandler: auth }, async (request, reply) => {
    const alerts = await sql`
      SELECT id, fuel, threshold_price, radius_meters, lat, lon, label, active,
             created_at, last_triggered_at
      FROM price_alerts WHERE device_id = ${request.device!.id}
      ORDER BY created_at DESC
    `;
    return reply.send({ alerts });
  });

  app.post('/v1/alerts', { preHandler: auth }, async (request, reply) => {
    const parsed = alertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'parametros_invalidos', detalle: parsed.error.flatten() });
    }
    const a = parsed.data;

    const countRows = await sql<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM price_alerts WHERE device_id = ${request.device!.id}
    `;
    if ((countRows[0]?.count ?? 0) >= 20) {
      return reply.code(409).send({ error: 'limite_alertas', mensaje: 'Máximo 20 alertas por dispositivo.' });
    }

    const [alert] = await sql`
      INSERT INTO price_alerts (device_id, fuel, threshold_price, radius_meters, lat, lon, label)
      VALUES (${request.device!.id}, ${a.fuel}, ${a.thresholdPrice}, ${a.radiusMeters},
              ${a.lat}, ${a.lon}, ${a.label ?? null})
      RETURNING id, fuel, threshold_price, radius_meters, lat, lon, label, active, created_at
    `;
    return reply.code(201).send({ alert });
  });

  app.patch<{ Params: { id: string } }>('/v1/alerts/:id', { preHandler: auth }, async (request, reply) => {
    const body = request.body as { active?: boolean };
    if (typeof body?.active !== 'boolean') {
      return reply.code(400).send({ error: 'parametros_invalidos' });
    }
    const [alert] = await sql`
      UPDATE price_alerts SET active = ${body.active}
      WHERE id = ${request.params.id} AND device_id = ${request.device!.id}
      RETURNING id, active
    `;
    if (!alert) return reply.code(404).send({ error: 'alerta_no_encontrada' });
    return reply.send({ alert });
  });

  app.delete<{ Params: { id: string } }>('/v1/alerts/:id', { preHandler: auth }, async (request, reply) => {
    const deleted = await sql`
      DELETE FROM price_alerts WHERE id = ${request.params.id} AND device_id = ${request.device!.id}
      RETURNING id
    `;
    if (deleted.length === 0) return reply.code(404).send({ error: 'alerta_no_encontrada' });
    return reply.send({ ok: true });
  });
}
