import { parseSourceResponse, type SourceSnapshot } from '@gasgo/core';
import { config } from '../config.js';

export interface FetchResult {
  snapshot: SourceSnapshot;
  httpStatus: number;
  url: string;
  bytes: number;
  elapsedMs: number;
}

export class SourceUnavailableError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'SourceUnavailableError';
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOnce(url: string): Promise<FetchResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.source.timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        // Sin esta cabecera el servicio del Ministerio devuelve XML.
        Accept: 'application/json',
        'User-Agent': config.source.userAgent,
        'Accept-Encoding': 'gzip, deflate',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new SourceUnavailableError(
        `La fuente oficial respondió ${response.status} ${response.statusText}`,
        response.status,
      );
    }

    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new SourceUnavailableError(
        `La fuente devolvió algo que no es JSON (¿página de error?). Primeros 200 caracteres: ${text.slice(0, 200)}`,
        response.status,
      );
    }

    return {
      snapshot: parseSourceResponse(payload),
      httpStatus: response.status,
      url,
      bytes: text.length,
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Descarga el volcado nacional con reintentos y espejo.
 * Si todo falla, lanza: la ingesta se marca como fallida y GASGO conserva los precios
 * anteriores. Nunca se vacía la base de datos por un fallo de red.
 */
export async function fetchOfficialSnapshot(
  log: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<FetchResult> {
  const urls = [config.source.url, config.source.mirrorUrl];
  let lastError: unknown;

  for (const url of urls) {
    for (let attempt = 1; attempt <= config.source.retries; attempt += 1) {
      try {
        log.info(`Descargando volcado oficial (intento ${attempt}) desde ${url}`);
        return await fetchOnce(url);
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        log.warn(`Fallo en el intento ${attempt} contra ${url}: ${message}`);
        if (attempt < config.source.retries) {
          await sleep(2 ** attempt * 1000);
        }
      }
    }
    log.warn(`Agotados los intentos contra ${url}; probando el siguiente origen.`);
  }

  throw lastError instanceof Error
    ? lastError
    : new SourceUnavailableError('No se pudo obtener el volcado oficial.');
}
