import { runAlerts } from '../ingest/evaluate-alerts.js';
import { sql, closeDb } from '../db/client.js';

try {
  await runAlerts(sql, { info: (msg) => console.log(`[alertas] ${msg}`) });
} finally {
  await closeDb();
}
