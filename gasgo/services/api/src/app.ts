import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import type { Sql } from './db/client.js';
import { registerStationRoutes } from './routes/stations.js';
import { registerDeviceRoutes } from './routes/devices.js';

export async function buildApp(sql: Sql): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization'],
    },
    trustProxy: true,
    bodyLimit: 1_000_000,
    // Peticiones lentas de un cliente no deben ocupar un worker indefinidamente.
    requestTimeout: 30_000,
  });

  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(cors, {
    origin: config.api.corsOrigins.length > 0 ? config.api.corsOrigins : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  await app.register(rateLimit, {
    max: config.api.rateLimitMax,
    timeWindow: config.api.rateLimitWindowMs,
    // Con dispositivo identificado se limita por dispositivo; si no, por IP.
    keyGenerator: (request) => request.device?.id ?? request.ip ?? 'desconocido',
    // `statusCode` es obligatorio aquí: sin él, Fastify serializa la respuesta como un 500.
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'demasiadas_peticiones',
      mensaje: 'Has superado el límite de peticiones. Inténtalo de nuevo en un minuto.',
    }),
  });

  app.get('/health', async (_request, reply) => {
    try {
      await sql`SELECT 1`;
      return reply.send({ ok: true, env: config.env });
    } catch {
      return reply.code(503).send({ ok: false, error: 'base_de_datos_no_disponible' });
    }
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'Error no controlado');
    // Nunca devolvemos trazas ni detalles internos al cliente.
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    return reply.code(status).send({
      error: status === 500 ? 'error_interno' : (error.code ?? 'error'),
      mensaje: status === 500 ? 'Error interno del servidor.' : error.message,
    });
  });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'no_encontrado' }));

  await registerStationRoutes(app, sql);
  await registerDeviceRoutes(app, sql);

  return app;
}
