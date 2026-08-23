# FASE 4 — Modelo de datos

PostgreSQL 16 + PostGIS 3.4. El esquema completo está en
`services/api/migrations/001_init.sql` y se aplica con `npm run migrate -w @gasgo/api`.

## Por qué PostGIS

España tiene unas 12.000 estaciones. Con esos volúmenes, un índice GIST sobre
`geography(Point,4326)` responde a «¿qué hay en 5 km?» en microsegundos y, sobre todo, permite
la consulta que de verdad es difícil: **«¿qué gasolineras están a menos de X metros de esta
polilínea de ruta?»** (`ST_DWithin` contra un `LINESTRING`), que es el corazón de GASGO ROUTE.
Sin PostGIS habría que traer candidatas por caja envolvente y filtrarlas en memoria.

## Tablas

### `data_sources`
Catálogo de fuentes con su **atribución y licencia**. Cada precio y cada anomalía apuntan aquí:
siempre se puede responder «¿de dónde salió este número?».

### `stations`
Una fila por estación. Clave natural `(source_id, source_station_id)` — el `IDEESS` oficial —, lo
que hace la ingesta idempotente.

- `geog` es una **columna generada** a partir de `lat`/`lon`: no puede desincronizarse.
- `active` en vez de borrado: una estación que desaparece del volcado se desactiva y conserva
  su histórico.
- `sale_type` distingue la venta al público (`P`) de la restringida (`R`).

### `station_prices` — precios vigentes
Una fila por `(estación, combustible)`. Es la tabla que se consulta en caliente.

| Campo | Significado |
|---|---|
| `price` | `numeric(7,3)`, el precio oficial sin transformar |
| `source_snapshot_at` | Marca de tiempo del volcado oficial que lo confirmó |
| `value_since` | Desde cuándo ese valor no cambia, según nuestro histórico |

`numeric(7,3)` y no `float`: los precios de carburante tienen tres decimales exactos y un
binario flotante los redondearía. La restricción `CHECK (price > 0)` es la última barrera contra
un precio imposible.

### `price_history` — histórico
**Solo se inserta cuando el precio cambia.** Un volcado que repite el mismo precio no genera
fila. Así el histórico de 30 días de 12.000 estaciones × 5 combustibles se mantiene pequeño y
las consultas de «hace 24 h / 7 d / 30 d» siguen siendo rápidas.

`UNIQUE (station_id, fuel, source_snapshot_at)` garantiza que reprocesar un volcado no duplica.

### `price_anomalies` — sistema antierrores
Todo precio **no publicado** deja rastro: precio anterior, precio nuevo, estado
(`sospechoso`/`rechazado`), motivos, explicación, fuente, fecha del volcado y ejecución de
ingesta. Es la tabla que responde a «¿por qué GASGO no me muestra ese precio?».

### `ingestion_runs` — trazabilidad
Una fila por ejecución con contadores (estaciones vistas, precios cambiados, rechazados,
sospechosos), columnas de producto desconocidas, problemas y duración. El índice único parcial
sobre `(source_id, source_snapshot_at) WHERE status='ok'` impide procesar dos veces el mismo
volcado.

### `devices`, `vehicles`, `favorites`, `price_alerts`, `alert_deliveries`
Datos del usuario. El dispositivo es **anónimo**: solo un hash SHA-256 de un token aleatorio.
No hay correo, ni nombre, ni identificador publicitario. Ver `docs/04-privacidad-rgpd.md`.

## Índices

| Índice | Para qué |
|---|---|
| `stations_geog_idx` (GIST) | Proximidad y corredores de ruta |
| `stations_active_idx` (parcial) | Descartar estaciones inactivas sin leerlas |
| `station_prices_fuel_price_idx` | Rankings «más barata» por combustible |
| `price_history_lookup_idx` | Serie temporal de una estación y combustible |
| `price_alerts_geog_idx` (GIST) | Evaluar todas las alertas tras cada ingesta |

## Consulta típica

```sql
SELECT s.id, s.brand, p.price,
       ST_Distance(s.geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distancia
FROM stations s
JOIN station_prices p ON p.station_id = s.id AND p.fuel = $3
WHERE s.active
  AND ST_DWithin(s.geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $4)
  AND (s.sale_type IS NULL OR s.sale_type <> 'R')
ORDER BY distancia
LIMIT $5;
```

## Retención

- `price_history`: se conserva. Es lo que permite el histórico de 30 días y la evolución.
- `price_anomalies`: se conserva; es el registro de auditoría del antierrores.
- `devices` sin actividad: `last_seen_at` permite purgar los inactivos (por ejemplo, a los
  12 meses) y con ellos, en cascada, sus alertas y favoritos.
