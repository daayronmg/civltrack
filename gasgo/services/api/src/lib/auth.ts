import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Sql } from '../db/client.js';

/**
 * Identidad anónima por dispositivo.
 *
 * El móvil genera un token aleatorio de 32 bytes, lo guarda en el llavero seguro del sistema
 * (Keychain / Keystore) y lo envía en `Authorization: Bearer`. El servidor solo almacena su
 * SHA-256: si la base de datos se filtrase, los tokens no serían reutilizables.
 *
 * No hay correo, ni contraseña, ni identificador publicitario. Es lo mínimo necesario para
 * que las alertas y los favoritos sigan al usuario, y nada más (minimización, art. 5.1.c RGPD).
 */

export function generateDeviceToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export interface DeviceIdentity {
  id: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    device?: DeviceIdentity;
  }
}

function extractBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim();
}

/** Requiere dispositivo registrado. Responde 401 si el token no es válido. */
export function requireDevice(sql: Sql) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = extractBearer(request);
    if (!token) {
      await reply.code(401).send({ error: 'device_token_requerido' });
      return;
    }

    const [device] = await sql<Array<{ id: string }>>`
      SELECT id FROM devices WHERE token_hash = ${hashToken(token)}
    `;
    if (!device) {
      await reply.code(401).send({ error: 'device_token_invalido' });
      return;
    }

    request.device = { id: device.id };
    // `last_seen_at` sirve para purgar dispositivos inactivos (retención de datos).
    await sql`UPDATE devices SET last_seen_at = now() WHERE id = ${device.id}`;
  };
}
