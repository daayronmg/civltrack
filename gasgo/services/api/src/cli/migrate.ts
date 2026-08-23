import { migrate } from '../db/migrate.js';
import { sql, closeDb } from '../db/client.js';

try {
  await migrate(sql);
} catch (error) {
  console.error('Migración fallida:', error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
