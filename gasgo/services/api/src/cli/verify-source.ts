/**
 * VERIFICADOR DE LA FUENTE OFICIAL.
 *
 * Ejecútalo en una máquina con salida a Internet ANTES de confiar en la ingesta:
 *
 *     npm run verify:source -w @gasgo/api
 *
 * Comprueba, contra la API real del Ministerio:
 *   1. Que responde y devuelve JSON.
 *   2. Que están todas las claves que GASGO espera.
 *   3. Que la fecha del volcado es interpretable.
 *   4. Qué columnas de precio hay que GASGO no conoce (productos nuevos).
 *   5. Que los precios parseados coinciden EXACTAMENTE con el texto original.
 *
 * Sale con código 1 si el contrato no se cumple: mejor no publicar que publicar mal.
 */

import {
  FUELS,
  REQUIRED_STATION_KEYS,
  ROOT_KEYS,
  fuelFromSourceColumn,
  parseSourceDate,
  parseSourcePrice,
  parseSourceResponse,
  computeFreshness,
} from '@gasgo/core';
import { config } from '../config.js';

const ok = (msg: string): void => console.log(`  ✔ ${msg}`);
const bad = (msg: string): void => console.error(`  ✖ ${msg}`);
const warn = (msg: string): void => console.warn(`  ⚠ ${msg}`);

let failures = 0;
const fail = (msg: string): void => {
  bad(msg);
  failures += 1;
};

console.log(`\nGASGO — verificación de la fuente oficial\n${'='.repeat(48)}`);
console.log(`Endpoint: ${config.source.url}\n`);

const started = Date.now();
let text: string;
let status: number;

try {
  const response = await fetch(config.source.url, {
    headers: { Accept: 'application/json', 'User-Agent': config.source.userAgent },
    signal: AbortSignal.timeout(config.source.timeoutMs),
  });
  status = response.status;
  text = await response.text();
} catch (error) {
  bad(`No se pudo contactar con la fuente oficial: ${error instanceof Error ? error.message : String(error)}`);
  console.error(
    '\nSin acceso a la API oficial NO hay datos. GASGO no publicará precios hasta que esta ' +
      'verificación pase. Revisa la conectividad de salida del servidor.\n',
  );
  process.exit(1);
}

console.log(`1) Respuesta HTTP`);
if (status === 200) ok(`HTTP ${status} en ${Date.now() - started} ms, ${(text.length / 1e6).toFixed(1)} MB`);
else fail(`HTTP ${status}`);

console.log(`\n2) Formato`);
let payload: Record<string, unknown>;
try {
  payload = JSON.parse(text) as Record<string, unknown>;
  ok('La respuesta es JSON válido');
} catch {
  fail(`La respuesta no es JSON. ¿Falta la cabecera Accept: application/json? Inicio: ${text.slice(0, 120)}`);
  process.exit(1);
}

console.log(`\n3) Claves de la raíz`);
for (const key of Object.values(ROOT_KEYS)) {
  if (key in payload) ok(`«${key}» presente`);
  else if (key === ROOT_KEYS.note || key === ROOT_KEYS.result) warn(`«${key}» ausente (opcional)`);
  else fail(`Falta «${key}»`);
}

const rawList = payload[ROOT_KEYS.stations];
if (!Array.isArray(rawList) || rawList.length === 0) {
  fail('El listado de estaciones está vacío o no es un array');
  process.exit(1);
}
ok(`${rawList.length} estaciones en el volcado`);

console.log(`\n4) Marca de tiempo del volcado`);
const snapshotAt = parseSourceDate(payload[ROOT_KEYS.fecha]);
if (!snapshotAt) {
  fail(`No se pudo interpretar «${ROOT_KEYS.fecha}» = ${String(payload[ROOT_KEYS.fecha])}`);
} else {
  const freshness = computeFreshness({ snapshotAt });
  ok(`${String(payload[ROOT_KEYS.fecha])} → ${snapshotAt.toISOString()} (${freshness.confirmedLabel})`);
  if (freshness.level === 'obsoleto') warn('El volcado publicado tiene más de 24 h.');
}

console.log(`\n5) Claves obligatorias de estación`);
const first = rawList[0] as Record<string, unknown>;
for (const key of REQUIRED_STATION_KEYS) {
  if (key in first) ok(`«${key}»`);
  else fail(`Falta «${key}» — hay que actualizar packages/core/src/source-schema.ts`);
}

console.log(`\n6) Columnas de precio`);
const priceColumns = new Set<string>();
for (const record of rawList as Array<Record<string, unknown>>) {
  for (const key of Object.keys(record)) if (key.startsWith('Precio ')) priceColumns.add(key);
}
const unknown = [...priceColumns].filter((c) => !fuelFromSourceColumn(c));
const missing = FUELS.filter((f) => !priceColumns.has(f.sourceColumn));

for (const column of [...priceColumns].sort()) {
  const fuel = fuelFromSourceColumn(column);
  if (fuel) ok(`«${column}» → ${fuel.code}`);
}
for (const column of unknown) {
  warn(`«${column}» NO está en el catálogo de GASGO: añádelo a packages/core/src/fuels.ts`);
}
for (const fuel of missing) {
  warn(`GASGO espera «${fuel.sourceColumn}» (${fuel.code}) y la fuente no lo publica en este volcado`);
}

console.log(`\n7) Fidelidad de los precios parseados`);
let checked = 0;
let mismatches = 0;
for (const record of (rawList as Array<Record<string, unknown>>).slice(0, 2000)) {
  for (const [key, value] of Object.entries(record)) {
    if (!key.startsWith('Precio ')) continue;
    const raw = String(value ?? '').trim();
    if (raw === '') continue;
    const parsed = parseSourcePrice(raw);
    if (parsed === null) {
      mismatches += 1;
      bad(`No se pudo parsear «${key}» = «${raw}» (estación ${String(record.IDEESS)})`);
      continue;
    }
    checked += 1;
    // Reconstruimos el texto original desde el número: debe coincidir carácter a carácter.
    const decimals = (raw.split(',')[1] ?? '').length;
    if (parsed.toFixed(decimals).replace('.', ',') !== raw) {
      mismatches += 1;
      bad(`Discrepancia: origen «${raw}» → parseado ${parsed} (estación ${String(record.IDEESS)})`);
    }
  }
}
if (mismatches === 0) ok(`${checked} precios comprobados, todos idénticos al origen`);
else fail(`${mismatches} discrepancias en ${checked} precios comprobados`);

console.log(`\n8) Parseo completo`);
try {
  const snapshot = parseSourceResponse(payload);
  ok(`${snapshot.stations.length} estaciones utilizables`);
  if (snapshot.problems.length > 0) {
    warn(`${snapshot.problems.length} registros descartados. Ejemplos: ${snapshot.problems.slice(0, 3).join(' | ')}`);
  }
  const withCoords = snapshot.stations.filter((s) => s.lat !== 0 && s.lon !== 0).length;
  ok(`${withCoords} estaciones con coordenadas utilizables`);
  const restricted = snapshot.stations.filter((s) => s.saleType === 'R').length;
  ok(`${restricted} estaciones de venta restringida (se excluyen por defecto)`);
} catch (error) {
  fail(`El parser rechazó la respuesta: ${error instanceof Error ? error.message : String(error)}`);
}

console.log(`\n${'='.repeat(48)}`);
if (failures === 0) {
  console.log('✅ La fuente oficial cumple el contrato esperado. La ingesta puede ejecutarse.\n');
  process.exit(0);
} else {
  console.error(`❌ ${failures} comprobaciones han fallado. NO ejecutes la ingesta hasta corregirlo.\n`);
  process.exit(1);
}
