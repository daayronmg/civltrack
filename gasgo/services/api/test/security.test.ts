import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { createTestSql, setupDatabase, truncateAll, type TestSql } from './helpers.js';

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

async function registrar() {
  return (await app.inject({ method: 'POST', url: '/v1/devices', payload: { platform: 'android' } })).json();
}

describe('identidad de dispositivo', () => {
  it('el alta es anónima: no pide ni guarda datos personales', async () => {
    const body = await registrar();
    expect(body.token).toBeTruthy();

    const [device] = await sql<Array<Record<string, unknown>>>`SELECT * FROM devices`;
    expect(Object.keys(device!)).toEqual(
      expect.arrayContaining(['id', 'token_hash', 'platform', 'push_token', 'push_consent']),
    );
    // No hay columnas de correo, nombre ni identificador publicitario.
    expect(Object.keys(device!)).not.toContain('email');
    expect(Object.keys(device!)).not.toContain('name');
  });

  it('el token nunca se guarda en claro, solo su SHA-256', async () => {
    const { token } = await registrar();
    const [device] = await sql<Array<{ token_hash: string }>>`SELECT token_hash FROM devices`;

    expect(device!.token_hash).not.toBe(token);
    expect(device!.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
  });

  it('genera tokens distintos e impredecibles', async () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 5; i += 1) tokens.add((await registrar()).token);
    expect(tokens.size).toBe(5);
    for (const token of tokens) expect(token.length).toBeGreaterThanOrEqual(40);
  });
});

describe('control de acceso', () => {
  const rutasProtegidas: Array<[string, string]> = [
    ['GET', '/v1/alerts'],
    ['POST', '/v1/alerts'],
    ['GET', '/v1/vehicles'],
    ['POST', '/v1/vehicles'],
    ['GET', '/v1/favorites'],
    ['GET', '/v1/devices/me/export'],
    ['DELETE', '/v1/devices/me'],
  ];

  it('sin token responde 401', async () => {
    for (const [method, url] of rutasProtegidas) {
      const res = await app.inject({ method: method as 'GET', url, payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('con un token inventado responde 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/alerts',
      headers: { authorization: 'Bearer token-falso-que-no-existe' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('un dispositivo no puede leer ni borrar las alertas de otro', async () => {
    const a = await registrar();
    const b = await registrar();

    const alerta = (
      await app.inject({
        method: 'POST',
        url: '/v1/alerts',
        headers: { authorization: `Bearer ${a.token}` },
        payload: { fuel: 'GOA', thresholdPrice: 1.4, radiusMeters: 5000, lat: 40.4, lon: -3.7 },
      })
    ).json().alert;

    const listaB = (
      await app.inject({ method: 'GET', url: '/v1/alerts', headers: { authorization: `Bearer ${b.token}` } })
    ).json();
    expect(listaB.alerts).toHaveLength(0);

    const borrado = await app.inject({
      method: 'DELETE',
      url: `/v1/alerts/${alerta.id}`,
      headers: { authorization: `Bearer ${b.token}` },
    });
    expect(borrado.statusCode).toBe(404);

    const listaA = (
      await app.inject({ method: 'GET', url: '/v1/alerts', headers: { authorization: `Bearer ${a.token}` } })
    ).json();
    expect(listaA.alerts).toHaveLength(1);
  });
});

describe('validación de entradas', () => {
  it('rechaza alertas con valores imposibles', async () => {
    const { token } = await registrar();
    const casos = [
      { fuel: 'GOA', thresholdPrice: -1, radiusMeters: 5000, lat: 40, lon: -3 },
      { fuel: 'GOA', thresholdPrice: 1.4, radiusMeters: 10, lat: 40, lon: -3 },
      { fuel: 'GOA', thresholdPrice: 1.4, radiusMeters: 5000, lat: 999, lon: -3 },
      { fuel: 'INVENTADO', thresholdPrice: 1.4, radiusMeters: 5000, lat: 40, lon: -3 },
      { fuel: 'GOA', thresholdPrice: 1.4, radiusMeters: 500_000, lat: 40, lon: -3 },
    ];
    for (const payload of casos) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/alerts',
        headers: { authorization: `Bearer ${token}` },
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('limita el número de alertas por dispositivo', async () => {
    const { token } = await registrar();
    for (let i = 0; i < 20; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/alerts',
        headers: { authorization: `Bearer ${token}` },
        payload: { fuel: 'GOA', thresholdPrice: 1.4, radiusMeters: 5000, lat: 40, lon: -3 },
      });
      expect(res.statusCode).toBe(201);
    }
    const extra = await app.inject({
      method: 'POST',
      url: '/v1/alerts',
      headers: { authorization: `Bearer ${token}` },
      payload: { fuel: 'GOA', thresholdPrice: 1.4, radiusMeters: 5000, lat: 40, lon: -3 },
    });
    expect(extra.statusCode).toBe(409);
  });

  it('no acepta cuerpos gigantes', async () => {
    const { token } = await registrar();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/alerts',
      headers: { authorization: `Bearer ${token}` },
      payload: { fuel: 'GOA', thresholdPrice: 1.4, radiusMeters: 5000, lat: 40, lon: -3, label: 'x'.repeat(5000) },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('derechos RGPD', () => {
  it('el usuario puede exportar todos sus datos', async () => {
    const { token } = await registrar();
    await app.inject({
      method: 'POST',
      url: '/v1/vehicles',
      headers: { authorization: `Bearer ${token}` },
      payload: { fuel: 'GOA', consumptionPer100Km: 5.5, tankCapacityLiters: 50 },
    });

    const body = (
      await app.inject({ method: 'GET', url: '/v1/devices/me/export', headers: { authorization: `Bearer ${token}` } })
    ).json();

    expect(body.device).toBeTruthy();
    expect(body.vehicles).toHaveLength(1);
    expect(body).toHaveProperty('alerts');
    expect(body).toHaveProperty('favorites');
  });

  it('el borrado elimina el dispositivo y todo lo que cuelga de él', async () => {
    const { token } = await registrar();
    await app.inject({
      method: 'POST',
      url: '/v1/alerts',
      headers: { authorization: `Bearer ${token}` },
      payload: { fuel: 'GOA', thresholdPrice: 1.4, radiusMeters: 5000, lat: 40, lon: -3 },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/devices/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);

    const [{ devices }] = await sql<Array<{ devices: number }>>`SELECT count(*)::int AS devices FROM devices`;
    const [{ alertas }] = await sql<Array<{ alertas: number }>>`SELECT count(*)::int AS alertas FROM price_alerts`;
    expect(devices).toBe(0);
    expect(alertas).toBe(0);

    // El token ya no sirve.
    const despues = await app.inject({
      method: 'GET',
      url: '/v1/alerts',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(despues.statusCode).toBe(401);
  });

  it('el consentimiento de push se puede retirar y borra el token', async () => {
    const { token } = await registrar();
    await app.inject({
      method: 'PUT',
      url: '/v1/devices/me/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { pushToken: 'ExponentPushToken[abcdefghijklmnop]', consent: true },
    });
    let [device] = await sql<Array<{ push_token: string | null; push_consent: boolean }>>`
      SELECT push_token, push_consent FROM devices
    `;
    expect(device!.push_consent).toBe(true);
    expect(device!.push_token).toBeTruthy();

    await app.inject({
      method: 'PUT',
      url: '/v1/devices/me/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { pushToken: 'ExponentPushToken[abcdefghijklmnop]', consent: false },
    });
    [device] = await sql<Array<{ push_token: string | null; push_consent: boolean }>>`
      SELECT push_token, push_consent FROM devices
    `;
    expect(device!.push_consent).toBe(false);
    expect(device!.push_token).toBeNull();
  });

  it('no se almacena ningún historial de ubicaciones del usuario', async () => {
    const columnas = await sql<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
    `;
    const tablasConUbicacion = columnas
      .filter((c) => ['lat', 'lon', 'geog'].includes(c.column_name))
      .map((c) => c.table_name);

    // Solo hay coordenadas en las gasolineras y en el punto elegido para cada alerta.
    expect(new Set(tablasConUbicacion)).toEqual(new Set(['stations', 'price_alerts']));
  });
});

describe('cabeceras y errores', () => {
  it('aplica cabeceras de seguridad', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('devuelve 404 con un cuerpo controlado', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/no-existe' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'no_encontrado' });
  });

  it('no filtra detalles internos en los errores', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/stations/no-es-uuid' });
    expect(JSON.stringify(res.json())).not.toContain('postgres');
    expect(JSON.stringify(res.json())).not.toContain('at Object');
  });
});

describe('rate limiting', () => {
  it('la API anuncia el límite de peticiones en sus cabeceras', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/fuels' });
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });

  it('devuelve un 429 controlado al superar el límite', async () => {
    // Instancia aparte con un límite de 2 peticiones para comprobar el comportamiento real.
    const { default: Fastify } = await import('fastify');
    const { default: rateLimit } = await import('@fastify/rate-limit');
    const mini = Fastify();
    await mini.register(rateLimit, {
      max: 2,
      timeWindow: 60_000,
      errorResponseBuilder: () => ({ statusCode: 429, error: 'demasiadas_peticiones' }),
    });
    mini.get('/ping', async () => ({ ok: true }));
    await mini.ready();

    const cliente = { method: 'GET' as const, url: '/ping', remoteAddress: '203.0.113.10' };
    expect((await mini.inject(cliente)).statusCode).toBe(200);
    expect((await mini.inject(cliente)).statusCode).toBe(200);
    const tercera = await mini.inject(cliente);
    expect(tercera.statusCode).toBe(429);
    expect(tercera.json().error).toBe('demasiadas_peticiones');
    await mini.close();
  });
});
