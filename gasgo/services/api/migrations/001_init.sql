-- GASGO — esquema inicial.
-- Requiere PostgreSQL 14+ con PostGIS 3.x.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Fuentes de datos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_sources (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  url           text NOT NULL,
  attribution   text NOT NULL,
  licence       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO data_sources (id, name, url, attribution, licence)
VALUES (
  'miteco_eess_terrestres',
  'MITECO — Precios de carburantes en estaciones terrestres',
  'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/',
  'Fuente: Ministerio para la Transición Ecológica y el Reto Demográfico. Precios comunicados por las propias estaciones de servicio. GASGO no está avalado por el Ministerio.',
  'Reutilización conforme a la Ley 37/2007 y al aviso legal del portal de datos abiertos: citar la fuente, indicar la fecha de última actualización y no desnaturalizar la información.'
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Ejecuciones de ingesta: trazabilidad completa de cada volcado
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_runs (
  id                  bigserial PRIMARY KEY,
  source_id           text NOT NULL REFERENCES data_sources(id),
  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  -- `Fecha` del volcado oficial. UNIQUE por fuente: no reprocesamos el mismo volcado dos veces.
  source_snapshot_at  timestamptz,
  status              text NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running','ok','failed','skipped')),
  http_status         integer,
  stations_seen       integer NOT NULL DEFAULT 0,
  stations_upserted   integer NOT NULL DEFAULT 0,
  stations_deactivated integer NOT NULL DEFAULT 0,
  prices_accepted     integer NOT NULL DEFAULT 0,
  prices_changed      integer NOT NULL DEFAULT 0,
  prices_rejected     integer NOT NULL DEFAULT 0,
  prices_suspicious   integer NOT NULL DEFAULT 0,
  unknown_columns     text[] NOT NULL DEFAULT '{}',
  problems            text[] NOT NULL DEFAULT '{}',
  error               text,
  duration_ms         integer
);

CREATE UNIQUE INDEX IF NOT EXISTS ingestion_runs_snapshot_uidx
  ON ingestion_runs (source_id, source_snapshot_at)
  WHERE source_snapshot_at IS NOT NULL AND status = 'ok';

CREATE INDEX IF NOT EXISTS ingestion_runs_started_idx ON ingestion_runs (started_at DESC);

-- ---------------------------------------------------------------------------
-- Estaciones de servicio
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id          text NOT NULL REFERENCES data_sources(id),
  source_station_id  text NOT NULL,
  brand              text NOT NULL,
  address            text NOT NULL DEFAULT '',
  postal_code        text,
  locality           text,
  municipality       text NOT NULL DEFAULT '',
  municipality_id    text,
  province           text NOT NULL DEFAULT '',
  province_id        text,
  region_id          text,
  schedule           text,
  -- 'P' venta al público, 'R' restringida (cooperativas, flotas).
  sale_type          text,
  road_side          text,
  lat                double precision NOT NULL,
  lon                double precision NOT NULL,
  geog               geography(Point, 4326) GENERATED ALWAYS AS
                       (ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) STORED,
  active             boolean NOT NULL DEFAULT true,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stations_source_uidx UNIQUE (source_id, source_station_id),
  CONSTRAINT stations_lat_range CHECK (lat BETWEEN -90 AND 90),
  CONSTRAINT stations_lon_range CHECK (lon BETWEEN -180 AND 180)
);

CREATE INDEX IF NOT EXISTS stations_geog_idx ON stations USING GIST (geog);
CREATE INDEX IF NOT EXISTS stations_active_idx ON stations (active) WHERE active;
CREATE INDEX IF NOT EXISTS stations_municipality_idx ON stations (municipality_id);
CREATE INDEX IF NOT EXISTS stations_brand_idx ON stations (brand);

-- ---------------------------------------------------------------------------
-- Precios vigentes: una fila por estación y combustible. Es la tabla caliente.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS station_prices (
  station_id          uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  fuel                text NOT NULL,
  price               numeric(7,3) NOT NULL CHECK (price > 0),
  -- Marca de tiempo del volcado oficial que confirmó este precio.
  source_snapshot_at  timestamptz NOT NULL,
  -- Desde cuándo este valor no cambia (histórico propio de GASGO).
  value_since         timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (station_id, fuel)
);

CREATE INDEX IF NOT EXISTS station_prices_fuel_price_idx ON station_prices (fuel, price);

-- ---------------------------------------------------------------------------
-- Histórico: solo se inserta una fila cuando el precio CAMBIA.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_history (
  id                  bigserial PRIMARY KEY,
  station_id          uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  fuel                text NOT NULL,
  price               numeric(7,3) NOT NULL CHECK (price > 0),
  source_snapshot_at  timestamptz NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  ingestion_run_id    bigint REFERENCES ingestion_runs(id),
  CONSTRAINT price_history_uidx UNIQUE (station_id, fuel, source_snapshot_at)
);

CREATE INDEX IF NOT EXISTS price_history_lookup_idx
  ON price_history (station_id, fuel, source_snapshot_at DESC);

-- ---------------------------------------------------------------------------
-- Anomalías: todo precio no publicado queda registrado con su motivo.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_anomalies (
  id                  bigserial PRIMARY KEY,
  station_id          uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  fuel                text NOT NULL,
  previous_price      numeric(7,3),
  new_price           numeric(7,3),
  status              text NOT NULL CHECK (status IN ('sospechoso','rechazado')),
  reasons             text[] NOT NULL DEFAULT '{}',
  detail              text NOT NULL,
  source_id           text NOT NULL REFERENCES data_sources(id),
  source_snapshot_at  timestamptz NOT NULL,
  detected_at         timestamptz NOT NULL DEFAULT now(),
  ingestion_run_id    bigint REFERENCES ingestion_runs(id)
);

CREATE INDEX IF NOT EXISTS price_anomalies_detected_idx ON price_anomalies (detected_at DESC);
CREATE INDEX IF NOT EXISTS price_anomalies_station_idx ON price_anomalies (station_id, fuel);

-- ---------------------------------------------------------------------------
-- Dispositivos: identidad anónima. Sin correo, sin nombre, sin cuenta.
-- Solo un token aleatorio generado en el móvil y guardado aquí en forma de hash.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash        text NOT NULL UNIQUE,
  platform          text CHECK (platform IN ('ios','android','unknown')),
  push_token        text,
  push_consent      boolean NOT NULL DEFAULT false,
  app_version       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now()
);

-- Perfil de vehículo. Dato del usuario, no dato personal identificativo.
CREATE TABLE IF NOT EXISTS vehicles (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id              uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  label                  text,
  fuel                   text NOT NULL,
  consumption_per_100km  numeric(5,2) NOT NULL CHECK (consumption_per_100km > 0 AND consumption_per_100km < 100),
  tank_capacity_liters   numeric(6,2) NOT NULL CHECK (tank_capacity_liters > 0 AND tank_capacity_liters <= 1000),
  typical_refuel_liters  numeric(6,2) CHECK (typical_refuel_liters > 0 AND typical_refuel_liters <= 1000),
  is_default             boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicles_device_idx ON vehicles (device_id);

-- Favoritos
CREATE TABLE IF NOT EXISTS favorites (
  device_id   uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  station_id  uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, station_id)
);

-- Alertas de precio.
-- Guardamos un punto elegido por el usuario, no su historial de ubicaciones (RGPD).
CREATE TABLE IF NOT EXISTS price_alerts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id         uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  fuel              text NOT NULL,
  threshold_price   numeric(7,3) NOT NULL CHECK (threshold_price > 0),
  radius_meters     integer NOT NULL CHECK (radius_meters BETWEEN 500 AND 100000),
  lat               double precision NOT NULL,
  lon               double precision NOT NULL,
  geog              geography(Point, 4326) GENERATED ALWAYS AS
                      (ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) STORED,
  label             text,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_triggered_at timestamptz,
  last_notified_price numeric(7,3)
);

CREATE INDEX IF NOT EXISTS price_alerts_active_idx ON price_alerts (fuel) WHERE active;
CREATE INDEX IF NOT EXISTS price_alerts_geog_idx ON price_alerts USING GIST (geog);
CREATE INDEX IF NOT EXISTS price_alerts_device_idx ON price_alerts (device_id);

-- Entregas de alerta: evita avisar dos veces de lo mismo.
CREATE TABLE IF NOT EXISTS alert_deliveries (
  id           bigserial PRIMARY KEY,
  alert_id     uuid NOT NULL REFERENCES price_alerts(id) ON DELETE CASCADE,
  station_id   uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  price        numeric(7,3) NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  push_status  text
);

CREATE INDEX IF NOT EXISTS alert_deliveries_alert_idx ON alert_deliveries (alert_id, delivered_at DESC);
