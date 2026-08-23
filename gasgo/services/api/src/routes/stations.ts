import type { FastifyInstance } from 'fastify';
import {
  computeBestOption,
  computeFreshness,
  decodePolyline,
  simplifyPolyline,
  distanceToPolyline,
  polylineLengthMeters,
  FUELS,
  SOURCE_ATTRIBUTION,
  type FuelCode,
  type StationSummary,
} from '@gasgo/core';
import type { Sql } from '../db/client.js';
import {
  findNearbyStations,
  findStationsInBox,
  findStationsAlongRoute,
  getStationDetail,
  getPriceHistory,
  getSourceStatus,
} from '../db/queries.js';
import {
  nearbyQuerySchema,
  boxQuerySchema,
  bestOptionBodySchema,
  routeBodySchema,
  historyQuerySchema,
} from './schemas.js';
import { SnapshotCache } from '../lib/cache.js';
import { config, SOURCE_ID } from '../config.js';

const cache = new SnapshotCache(45_000);

/** Añade a cada estación el texto de frescura, calculado con el mismo código que la app. */
function withFreshness(stations: StationSummary[]): Array<StationSummary & { freshness?: unknown }> {
  const now = new Date();
  return stations.map((station) => {
    if (!station.price) return station;
    const freshness = computeFreshness({
      snapshotAt: new Date(station.price.snapshotAt),
      valueSince: station.price.valueSince ? new Date(station.price.valueSince) : null,
      now,
    });
    return { ...station, freshness };
  });
}

export async function registerStationRoutes(app: FastifyInstance, sql: Sql): Promise<void> {
  /** Estado de la fuente oficial. La app lo usa para saber si hay datos o no. */
  app.get('/v1/meta/source', async (_request, reply) => {
    const status = await getSourceStatus(sql, SOURCE_ID);
    const hasData = status.stationCount > 0 && status.lastSnapshotAt !== null;

    return reply.send({
      source: status.name,
      sourceUrl: status.url,
      attribution: status.attribution || SOURCE_ATTRIBUTION,
      licence: status.licence,
      lastSnapshotAt: status.lastSnapshotAt?.toISOString() ?? null,
      lastIngestedAt: status.lastIngestedAt?.toISOString() ?? null,
      stationCount: status.stationCount,
      hasData,
      freshness: status.lastSnapshotAt
        ? computeFreshness({ snapshotAt: status.lastSnapshotAt })
        : null,
      // Mensaje explícito para que la app nunca tenga que inventarse un estado.
      message: hasData
        ? null
        : 'Todavía no se ha ingerido ningún volcado de la fuente oficial. GASGO no muestra precios hasta que existan datos reales.',
    });
  });

  /** Catálogo de combustibles, con la columna oficial de la que sale cada uno. */
  app.get('/v1/fuels', async (_request, reply) =>
    reply.send({
      fuels: FUELS.map((f) => ({
        code: f.code,
        label: f.label,
        shortLabel: f.shortLabel,
        family: f.family,
        unit: f.unit,
        pumpLabel: f.pumpLabel ?? null,
        primary: f.primary,
        sourceColumn: f.sourceColumn,
      })),
    }),
  );

  /** Gasolineras cercanas. Es la consulta principal de la pantalla del mapa. */
  app.get('/v1/stations/nearby', async (request, reply) => {
    const parsed = nearbyQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'parametros_invalidos', detalle: parsed.error.flatten() });
    }
    const q = parsed.data;

    const status = await getSourceStatus(sql, SOURCE_ID);
    if (status.stationCount === 0) {
      return reply.code(503).send({
        error: 'sin_datos_oficiales',
        mensaje:
          'GASGO todavía no tiene datos de la fuente oficial. No se muestran precios inventados.',
      });
    }

    const key = `nearby:${q.lat.toFixed(4)}:${q.lon.toFixed(4)}:${q.radius}:${q.fuel}:${q.limit}:${q.order}:${q.incluirRestringidas}:${q.marcas.join('|')}`;
    const cached = cache.get<unknown>(key, status.lastSnapshotAt);
    if (cached) return reply.send(cached);

    const stations = await findNearbyStations(sql, {
      lat: q.lat,
      lon: q.lon,
      radiusMeters: q.radius,
      fuel: q.fuel as FuelCode,
      limit: q.limit,
      includeRestricted: q.incluirRestringidas,
      brands: q.marcas,
      orderBy: q.order,
    });

    const cheapest = stations.reduce<StationSummary | null>((best, current) => {
      if (!current.price) return best;
      if (!best?.price) return current;
      return current.price.price < best.price.price ? current : best;
    }, null);

    const payload = {
      query: { lat: q.lat, lon: q.lon, radius: q.radius, fuel: q.fuel, order: q.order },
      snapshotAt: status.lastSnapshotAt?.toISOString() ?? null,
      attribution: status.attribution,
      count: stations.length,
      cheapestStationId: cheapest?.id ?? null,
      stations: withFreshness(stations),
    };

    cache.set(key, status.lastSnapshotAt, payload);
    return reply.send(payload);
  });

  /** Estaciones dentro del rectángulo visible del mapa. */
  app.get('/v1/stations/box', async (request, reply) => {
    const parsed = boxQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'parametros_invalidos', detalle: parsed.error.flatten() });
    }
    const q = parsed.data;
    if (q.minLat >= q.maxLat || q.minLon >= q.maxLon) {
      return reply.code(400).send({ error: 'rectangulo_invalido' });
    }

    const status = await getSourceStatus(sql, SOURCE_ID);
    const key = `box:${q.minLat.toFixed(3)}:${q.maxLat.toFixed(3)}:${q.minLon.toFixed(3)}:${q.maxLon.toFixed(3)}:${q.fuel}:${q.limit}`;
    const cached = cache.get<unknown>(key, status.lastSnapshotAt);
    if (cached) return reply.send(cached);

    const stations = await findStationsInBox(sql, {
      minLat: q.minLat,
      maxLat: q.maxLat,
      minLon: q.minLon,
      maxLon: q.maxLon,
      fuel: q.fuel as FuelCode,
      limit: q.limit,
    });

    const payload = {
      snapshotAt: status.lastSnapshotAt?.toISOString() ?? null,
      attribution: status.attribution,
      count: stations.length,
      stations: withFreshness(stations),
    };
    cache.set(key, status.lastSnapshotAt, payload);
    return reply.send(payload);
  });

  /** Ficha completa de una estación. */
  app.get<{ Params: { id: string }; Querystring: { lat?: string; lon?: string } }>(
    '/v1/stations/:id',
    async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'id_invalido' });
      }

      const lat = request.query.lat !== undefined ? Number(request.query.lat) : undefined;
      const lon = request.query.lon !== undefined ? Number(request.query.lon) : undefined;
      const origin =
        lat !== undefined && lon !== undefined && Number.isFinite(lat) && Number.isFinite(lon)
          ? { lat, lon }
          : undefined;

      const station = await getStationDetail(sql, id, origin);
      if (!station) return reply.code(404).send({ error: 'estacion_no_encontrada' });

      const now = new Date();
      return reply.send({
        station: {
          ...station,
          prices: station.prices.map((price) => ({
            ...price,
            freshness: computeFreshness({
              snapshotAt: new Date(price.snapshotAt),
              valueSince: price.valueSince ? new Date(price.valueSince) : null,
              now,
            }),
          })),
        },
        attribution: SOURCE_ATTRIBUTION,
      });
    },
  );

  /** Histórico real de precios de una estación. */
  app.get<{ Params: { id: string } }>('/v1/stations/:id/history', async (request, reply) => {
    const parsed = historyQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'parametros_invalidos', detalle: parsed.error.flatten() });
    }

    const history = await getPriceHistory(
      sql,
      request.params.id,
      parsed.data.fuel as FuelCode,
      parsed.data.days,
    );

    return reply.send({
      history,
      // Sin histórico propio no se dibuja una evolución falsa: la app lo dice.
      mensaje:
        history.points.length === 0
          ? 'GASGO todavía no tiene histórico propio de esta estación y combustible.'
          : null,
      attribution: SOURCE_ATTRIBUTION,
    });
  });

  /**
   * MEJOR OPCIÓN: no la más barata a secas, sino la que minimiza el coste total
   * teniendo en cuenta el desvío, el consumo del vehículo y los litros a repostar.
   */
  app.post('/v1/best-option', async (request, reply) => {
    const parsed = bestOptionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'parametros_invalidos', detalle: parsed.error.flatten() });
    }
    const body = parsed.data;

    const status = await getSourceStatus(sql, SOURCE_ID);
    if (status.stationCount === 0) {
      return reply.code(503).send({ error: 'sin_datos_oficiales' });
    }

    const stations = await findNearbyStations(sql, {
      lat: body.lat,
      lon: body.lon,
      radiusMeters: body.radius,
      fuel: body.vehicle.fuel as FuelCode,
      limit: body.limit,
      includeRestricted: body.incluirRestringidas,
      orderBy: 'precio',
    });

    if (stations.length === 0) {
      return reply.send({
        result: null,
        mensaje: 'No hay gasolineras con ese combustible dentro del radio indicado.',
      });
    }

    const byId = new Map(stations.map((s) => [s.id, s]));
    const result = computeBestOption(
      stations
        .filter((s) => s.price)
        .map((s) => ({
          stationId: s.id,
          price: s.price!.price,
          straightLineMeters: s.distanceMeters,
        })),
      { ...body.vehicle, fuel: body.vehicle.fuel as FuelCode },
      { liters: body.liters, mode: 'viaje_dedicado' },
    );

    if (!result) {
      return reply.send({ result: null, mensaje: 'Sin precios disponibles para ese combustible.' });
    }

    const decorate = (evaluation: (typeof result)['best']) => ({
      ...evaluation,
      station: withFreshness([byId.get(evaluation.stationId)!])[0],
    });

    return reply.send({
      snapshotAt: status.lastSnapshotAt?.toISOString() ?? null,
      attribution: status.attribution,
      best: decorate(result.best),
      baseline: decorate(result.baseline),
      cheapestByPrice: decorate(result.cheapestByPrice),
      savingsVsBaseline: result.savingsVsBaseline,
      cheapestIsNotBest: result.cheapestIsNotBest,
      ranking: result.ranking.slice(0, 20).map(decorate),
      // Aviso obligatorio: el ahorro es un cálculo de GASGO, no un dato oficial.
      nota: 'El ahorro es una estimación de GASGO a partir del precio oficial, la distancia y el consumo declarado. El único dato oficial es el precio.',
    });
  });

  /** GASGO ROUTE: mejores gasolineras a lo largo de un trayecto. */
  app.post('/v1/route/stations', async (request, reply) => {
    const parsed = routeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'parametros_invalidos', detalle: parsed.error.flatten() });
    }
    const body = parsed.data;

    const rawPolyline = body.polyline ?? (body.encodedPolyline ? decodePolyline(body.encodedPolyline) : null);
    if (!rawPolyline || rawPolyline.length < 2) {
      return reply.code(400).send({ error: 'ruta_requerida', mensaje: 'Envía `polyline` o `encodedPolyline`.' });
    }

    const polyline = simplifyPolyline(rawPolyline, 250);
    const status = await getSourceStatus(sql, SOURCE_ID);
    if (status.stationCount === 0) return reply.code(503).send({ error: 'sin_datos_oficiales' });

    const stations = await findStationsAlongRoute(sql, {
      polyline,
      corridorMeters: body.corridorMeters,
      fuel: body.vehicle.fuel as FuelCode,
      limit: body.limit,
    });

    if (stations.length === 0) {
      return reply.send({
        stations: [],
        mensaje: 'No hay gasolineras con ese combustible en el corredor indicado.',
      });
    }

    // El desvío en ruta es salir y volver: 2 × la distancia perpendicular a la ruta.
    const candidates = stations
      .filter((s) => s.price)
      .map((s) => {
        const hit = distanceToPolyline({ lat: s.lat, lon: s.lon }, polyline);
        const perpendicular = hit?.distanceMeters ?? s.distanceMeters;
        return {
          stationId: s.id,
          price: s.price!.price,
          straightLineMeters: Math.round(perpendicular),
          detourMeters: Math.round(perpendicular * 2),
        };
      });

    const result = computeBestOption(
      candidates,
      { ...body.vehicle, fuel: body.vehicle.fuel as FuelCode },
      { liters: body.liters, mode: 'en_ruta' },
    );
    if (!result) return reply.send({ stations: [], mensaje: 'Sin precios disponibles.' });

    const byId = new Map(stations.map((s) => [s.id, s]));
    const now = new Date();

    const enriched = result.ranking.map((evaluation) => {
      const station = byId.get(evaluation.stationId)!;
      return {
        station: {
          ...station,
          freshness: station.price
            ? computeFreshness({
                snapshotAt: new Date(station.price.snapshotAt),
                valueSince: station.price.valueSince ? new Date(station.price.valueSince) : null,
                now,
              })
            : null,
        },
        /** Distancia perpendicular desde la ruta. */
        distanceFromRouteMeters: evaluation.straightLineMeters,
        /** Kilómetro de la ruta en el que queda la salida. */
        alongRouteMeters: station.alongRouteMeters,
        detourMinutes: Math.round(evaluation.detourMinutes),
        totalCost: evaluation.totalCost,
        effectivePricePerLiter: evaluation.effectivePricePerLiter,
        savingsVsBaseline: Math.round((result.baseline.totalCost - evaluation.totalCost) * 100) / 100,
      };
    });

    return reply.send({
      snapshotAt: status.lastSnapshotAt?.toISOString() ?? null,
      attribution: status.attribution,
      routeLengthMeters: Math.round(polylineLengthMeters(polyline)),
      best: enriched[0] ?? null,
      stations: enriched,
      nota: 'El desvío se calcula como distancia perpendicular a la ruta, ida y vuelta. Los minutos son una estimación.',
    });
  });
}
