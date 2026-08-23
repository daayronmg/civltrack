import { formatPrice, getFuel, type FuelCode } from '@gasgo/core';
import type { Sql } from '../db/client.js';
import { config } from '../config.js';

/**
 * Motor de alertas.
 *
 * Se ejecuta después de cada ingesta: busca, para cada alerta activa, la estación más barata
 * dentro de su radio cuyo precio esté por debajo del umbral. Solo notifica precios que han
 * pasado la validación (los sospechosos nunca llegan a `station_prices`).
 */

export interface AlertMatch {
  alertId: string;
  deviceId: string;
  pushToken: string | null;
  fuel: FuelCode;
  thresholdPrice: number;
  price: number;
  stationId: string;
  stationBrand: string;
  distanceMeters: number;
}

export interface AlertRunSummary {
  evaluated: number;
  matched: number;
  notified: number;
  failed: number;
}

export async function findTriggeredAlerts(sql: Sql): Promise<AlertMatch[]> {
  return sql<AlertMatch[]>`
    SELECT DISTINCT ON (a.id)
      a.id                AS "alertId",
      a.device_id         AS "deviceId",
      d.push_token        AS "pushToken",
      a.fuel              AS fuel,
      a.threshold_price   AS "thresholdPrice",
      p.price             AS price,
      s.id                AS "stationId",
      s.brand             AS "stationBrand",
      ST_Distance(s.geog, a.geog)::int AS "distanceMeters"
    FROM price_alerts a
    JOIN devices d ON d.id = a.device_id
    JOIN stations s ON s.active AND ST_DWithin(s.geog, a.geog, a.radius_meters)
    JOIN station_prices p ON p.station_id = s.id AND p.fuel = a.fuel
    WHERE a.active
      AND d.push_consent
      AND d.push_token IS NOT NULL
      AND p.price < a.threshold_price
      -- No repetir el aviso mientras el precio no mejore, ni antes del periodo de espera.
      AND (
        a.last_triggered_at IS NULL
        OR a.last_triggered_at < now() - (${config.alerts.cooldownMinutes} || ' minutes')::interval
        OR a.last_notified_price IS NULL
        OR p.price < a.last_notified_price
      )
    ORDER BY a.id, p.price ASC, "distanceMeters" ASC
  `;
}

export interface PushSender {
  send: (messages: ExpoPushMessage[]) => Promise<{ ok: number; failed: number }>;
}

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound?: 'default';
  priority?: 'high' | 'normal';
}

/** Envío real a través del servicio de Expo (APNs/FCM por debajo). */
export const expoPushSender: PushSender = {
  async send(messages) {
    if (messages.length === 0) return { ok: 0, failed: 0 };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (config.push.expoAccessToken) {
      headers.Authorization = `Bearer ${config.push.expoAccessToken}`;
    }

    let ok = 0;
    let failed = 0;

    // Expo acepta lotes de 100 mensajes.
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      try {
        const response = await fetch(config.push.expoUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(batch),
        });
        if (!response.ok) {
          failed += batch.length;
          continue;
        }
        const payload = (await response.json()) as { data?: Array<{ status: string }> };
        for (const item of payload.data ?? []) {
          if (item.status === 'ok') ok += 1;
          else failed += 1;
        }
      } catch {
        failed += batch.length;
      }
    }
    return { ok, failed };
  },
};

export function buildAlertMessage(match: AlertMatch): ExpoPushMessage {
  const fuel = getFuel(match.fuel);
  const unit = fuel.unit === 'eur_kg' ? '€/kg' : '€/L';
  const km = (match.distanceMeters / 1000).toFixed(1).replace('.', ',');

  return {
    to: match.pushToken!,
    title: '🔔 GASGO · Ha bajado el precio',
    body: `${fuel.label} a ${formatPrice(match.price)} ${unit} en ${match.stationBrand} · ${km} km`,
    data: {
      type: 'alerta_precio',
      alertId: match.alertId,
      stationId: match.stationId,
      fuel: match.fuel,
      price: match.price,
    },
    sound: 'default',
    priority: 'high',
  };
}

export async function runAlerts(
  sql: Sql,
  log: { info: (msg: string) => void },
  sender: PushSender = expoPushSender,
): Promise<AlertRunSummary> {
  const countRows = await sql<Array<{ total: number }>>`
    SELECT count(*)::int AS total FROM price_alerts WHERE active
  `;
  const total = countRows[0]?.total ?? 0;

  const matches = await findTriggeredAlerts(sql);
  if (matches.length === 0) {
    log.info(`Alertas: ${total} activas, ninguna cumplida.`);
    return { evaluated: total, matched: 0, notified: 0, failed: 0 };
  }

  const messages = matches.map(buildAlertMessage);
  const { ok, failed } = config.push.enabled
    ? await sender.send(messages)
    : { ok: 0, failed: 0 };

  for (const match of matches) {
    await sql`
      UPDATE price_alerts
      SET last_triggered_at = now(), last_notified_price = ${match.price}
      WHERE id = ${match.alertId}
    `;
    await sql`
      INSERT INTO alert_deliveries (alert_id, station_id, price, push_status)
      VALUES (${match.alertId}, ${match.stationId}, ${match.price}, ${config.push.enabled ? 'enviado' : 'push_desactivado'})
    `;
  }

  log.info(`Alertas: ${total} activas, ${matches.length} cumplidas, ${ok} enviadas, ${failed} fallidas.`);
  return { evaluated: total, matched: matches.length, notified: ok, failed };
}
