import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { parseSourceResponse } from '@gasgo/core';
import { buildApp } from '../src/app.js';
import { runIngestion } from '../src/ingest/run-ingestion.js';
import { runAlerts, buildAlertMessage, type ExpoPushMessage } from '../src/ingest/evaluate-alerts.js';
import { createTestSql, setupDatabase, truncateAll, buildSourcePayload, type TestSql } from './helpers.js';

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const CENTRO = { lat: 40.4168, lon: -3.7038 };

let sql: TestSql;
let app: FastifyInstance;

beforeAll(async () => {
  sql = createTestSql();
  await setupDatabase(sql);
  app = await buildApp(sql as never);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await sql.end({ timeout: 5 });
});

beforeEach(async () => {
  await truncateAll(sql);
});

/** Registra un dispositivo anónimo y devuelve su token. */
async function registrarDispositivo(): Promise<{ token: string; deviceId: string }> {
  const res = await app.inject({ method: 'POST', url: '/v1/devices', payload: { platform: 'ios' } });
  const body = res.json();
  return { token: body.token, deviceId: body.deviceId };
}

async function seedDiesel(precio: string) {
  await runIngestion(sql as never, silent, {
    snapshotOverride: parseSourceResponse(
      buildSourcePayload({
        fecha: '12/03/2026 18:40:11',
        stations: [
          {
            id: '1001',
            rotulo: 'ESTACIÓN ALERTA',
            lat: '40,425800',
            lon: '-3,703790',
            precios: { 'Precio Gasoleo A': precio },
          },
        ],
      }),
    ),
  });
}

/** Emisor de push falso: comprueba QUÉ se enviaría, sin llamar a Expo. */
function fakeSender() {
  const sent: ExpoPushMessage[] = [];
  return {
    sent,
    sender: {
      async send(messages: ExpoPushMessage[]) {
        sent.push(...messages);
        return { ok: messages.length, failed: 0 };
      },
    },
  };
}

async function crearAlerta(token: string, thresholdPrice: number, radiusMeters = 10_000) {
  return app.inject({
    method: 'POST',
    url: '/v1/alerts',
    headers: { authorization: `Bearer ${token}` },
    payload: { fuel: 'GOA', thresholdPrice, radiusMeters, lat: CENTRO.lat, lon: CENTRO.lon },
  });
}

async function activarPush(token: string, pushToken = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]') {
  return app.inject({
    method: 'PUT',
    url: '/v1/devices/me/push',
    headers: { authorization: `Bearer ${token}` },
    payload: { pushToken, consent: true },
  });
}

describe('alertas: disparo', () => {
  it('avisa cuando el precio baja del umbral', async () => {
    const { token } = await registrarDispositivo();
    await activarPush(token);
    await crearAlerta(token, 1.4);
    await seedDiesel('1,389');

    const { sent, sender } = fakeSender();
    const summary = await runAlerts(sql as never, silent, sender);

    expect(summary.matched).toBe(1);
    expect(summary.notified).toBe(1);
    expect(sent[0]!.body).toContain('1,389');
    expect(sent[0]!.body).toContain('ESTACIÓN ALERTA');
    expect(sent[0]!.data.type).toBe('alerta_precio');
  });

  it('no avisa si el precio no baja del umbral', async () => {
    const { token } = await registrarDispositivo();
    await activarPush(token);
    await crearAlerta(token, 1.3);
    await seedDiesel('1,389');

    const { sender } = fakeSender();
    expect((await runAlerts(sql as never, silent, sender)).matched).toBe(0);
  });

  it('no avisa fuera del radio de la alerta', async () => {
    const { token } = await registrarDispositivo();
    await activarPush(token);
    await crearAlerta(token, 1.5, 500); // la estación está a ~1 km
    await seedDiesel('1,389');

    const { sender } = fakeSender();
    expect((await runAlerts(sql as never, silent, sender)).matched).toBe(0);
  });

  it('sin consentimiento de notificaciones no se envía nada (RGPD)', async () => {
    const { token } = await registrarDispositivo();
    await crearAlerta(token, 1.5);
    await seedDiesel('1,389');

    const { sender } = fakeSender();
    expect((await runAlerts(sql as never, silent, sender)).matched).toBe(0);
  });

  it('no repite el aviso si el precio no ha mejorado', async () => {
    const { token } = await registrarDispositivo();
    await activarPush(token);
    await crearAlerta(token, 1.5);
    await seedDiesel('1,389');

    const { sender } = fakeSender();
    expect((await runAlerts(sql as never, silent, sender)).matched).toBe(1);
    expect((await runAlerts(sql as never, silent, sender)).matched).toBe(0);
  });

  it('sí vuelve a avisar si el precio baja todavía más', async () => {
    const { token } = await registrarDispositivo();
    await activarPush(token);
    await crearAlerta(token, 1.5);
    await seedDiesel('1,389');

    const { sender } = fakeSender();
    await runAlerts(sql as never, silent, sender);

    await runIngestion(sql as never, silent, {
      snapshotOverride: parseSourceResponse(
        buildSourcePayload({
          fecha: '12/03/2026 19:10:11',
          stations: [
            {
              id: '1001',
              rotulo: 'ESTACIÓN ALERTA',
              lat: '40,425800',
              lon: '-3,703790',
              precios: { 'Precio Gasoleo A': '1,349' },
            },
          ],
        }),
      ),
    });

    expect((await runAlerts(sql as never, silent, sender)).matched).toBe(1);
  });

  it('una alerta desactivada no dispara', async () => {
    const { token } = await registrarDispositivo();
    await activarPush(token);
    const alerta = (await crearAlerta(token, 1.5)).json().alert;
    await app.inject({
      method: 'PATCH',
      url: `/v1/alerts/${alerta.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { active: false },
    });
    await seedDiesel('1,389');

    const { sender } = fakeSender();
    expect((await runAlerts(sql as never, silent, sender)).matched).toBe(0);
  });

  it('nunca notifica un precio marcado como anomalía', async () => {
    const { token } = await registrarDispositivo();
    await activarPush(token);
    await crearAlerta(token, 1.4);
    await seedDiesel('1,389');

    const { sender } = fakeSender();
    await runAlerts(sql as never, silent, sender);

    // Un volcado con un precio absurdamente bajo: el antierrores lo rechaza.
    await runIngestion(sql as never, silent, {
      snapshotOverride: parseSourceResponse(
        buildSourcePayload({
          fecha: '12/03/2026 20:10:11',
          stations: [
            {
              id: '1001',
              rotulo: 'ESTACIÓN ALERTA',
              lat: '40,425800',
              lon: '-3,703790',
              precios: { 'Precio Gasoleo A': '0,138' },
            },
          ],
        }),
      ),
    });

    const { sent, sender: sender2 } = fakeSender();
    await runAlerts(sql as never, silent, sender2);
    expect(sent.some((m) => m.body.includes('0,138'))).toBe(false);
  });

  it('registra la entrega para poder auditarla', async () => {
    const { token } = await registrarDispositivo();
    await activarPush(token);
    await crearAlerta(token, 1.5);
    await seedDiesel('1,389');

    const { sender } = fakeSender();
    await runAlerts(sql as never, silent, sender);

    const entregas = await sql<Array<{ price: number; push_status: string }>>`
      SELECT price, push_status FROM alert_deliveries
    `;
    expect(entregas).toHaveLength(1);
    expect(Number(entregas[0]!.price)).toBe(1.389);
  });
});

describe('mensaje de la alerta', () => {
  it('usa la unidad correcta según el combustible', () => {
    const base = {
      alertId: 'a',
      deviceId: 'd',
      pushToken: 'ExponentPushToken[x]',
      thresholdPrice: 1.4,
      price: 1.389,
      stationId: 's',
      stationBrand: 'MARCA',
      distanceMeters: 4200,
    };
    expect(buildAlertMessage({ ...base, fuel: 'GOA' }).body).toContain('€/L');
    expect(buildAlertMessage({ ...base, fuel: 'GNC' }).body).toContain('€/kg');
    expect(buildAlertMessage({ ...base, fuel: 'GOA' }).body).toContain('4,2 km');
  });
});
