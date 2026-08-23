import postgres from 'postgres';
import { config } from '../config.js';

/**
 * Cliente de PostgreSQL. `postgres` (porsager) usa consultas parametrizadas por defecto
 * en las plantillas etiquetadas: no hay concatenación de SQL con datos del usuario.
 */
export const sql = postgres(config.databaseUrl, {
  max: config.databasePoolMax,
  idle_timeout: 30,
  connect_timeout: 15,
  // Los precios son numeric(7,3): los leemos como número, no como cadena.
  types: {
    numeric: {
      to: 1700,
      from: [1700],
      serialize: (value: number | string) => String(value),
      parse: (value: string) => Number(value),
    },
  },
  onnotice: () => {},
});

export type Sql = typeof sql;

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
