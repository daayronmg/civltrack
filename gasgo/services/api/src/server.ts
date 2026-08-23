import { buildApp } from './app.js';
import { config } from './config.js';
import { sql, closeDb } from './db/client.js';

const app = await buildApp(sql);

const shutdown = async (signal: string): Promise<void> => {
  app.log.info(`Recibida señal ${signal}: cerrando.`);
  await app.close();
  await closeDb();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`GASGO API escuchando en ${config.host}:${config.port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
