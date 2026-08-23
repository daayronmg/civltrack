import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Sql } from './client.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

/**
 * Migrador mínimo: aplica en orden los .sql de /migrations que aún no estén registrados.
 * Cada migración corre dentro de una transacción.
 */
export async function migrate(sql: Sql, log: (message: string) => void = console.log): Promise<string[]> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((row) => row.name),
  );

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const executed: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const contents = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    log(`▶ aplicando ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(contents);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    executed.push(file);
    log(`✔ ${file}`);
  }

  if (executed.length === 0) log('Sin migraciones pendientes.');
  return executed;
}
