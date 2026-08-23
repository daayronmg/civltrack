/**
 * Ingesta de la fuente oficial. Pensado para cron:
 *   *\/30 * * * *  cd /srv/gasgo && npm run ingest -w @gasgo/api
 */
import { runIngestion } from '../ingest/run-ingestion.js';
import { runAlerts } from '../ingest/evaluate-alerts.js';
import { sql, closeDb } from '../db/client.js';

const log = {
  info: (msg: string) => console.log(`[ingest] ${msg}`),
  warn: (msg: string) => console.warn(`[ingest] ⚠ ${msg}`),
  error: (msg: string) => console.error(`[ingest] ✖ ${msg}`),
};

try {
  const summary = await runIngestion(sql, log);
  if (summary.status === 'ok') {
    await runAlerts(sql, log);
  }
  process.exitCode = summary.status === 'failed' ? 1 : 0;
} catch (error) {
  log.error(String(error));
  process.exitCode = 1;
} finally {
  await closeDb();
}
