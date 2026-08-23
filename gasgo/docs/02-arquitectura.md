# FASE 3 — Arquitectura de GASGO

```
   ┌───────────────────────────────────────────┐
   │  FUENTE OFICIAL  (MITECO / SIPP)          │
   │  API REST Estaciones Terrestres           │
   └───────────────┬───────────────────────────┘
                   │  JSON nacional completo, Accept: application/json
                   ▼
   ┌───────────────────────────────────────────┐
   │  INGESTA  (services/api → src/ingest)     │
   │  · descarga con reintento + espejo        │
   │  · parseo estricto contra source-schema   │
   │  · normalización (coma decimal → numeric) │
   └───────────────┬───────────────────────────┘
                   ▼
   ┌───────────────────────────────────────────┐
   │  VALIDACIÓN  (@gasgo/core/validation)     │
   │  · rangos absolutos por producto          │
   │  · salto relativo vs precio anterior      │
   │  · desviación vs mediana nacional del día │
   │  → OK | SOSPECHOSO | RECHAZADO            │
   └───────────────┬───────────────────────────┘
                   ▼
   ┌───────────────────────────────────────────┐
   │  POSTGRESQL 16 + POSTGIS 3.4              │
   │  stations · prices_current · price_history│
   │  price_anomalies · ingestion_runs         │
   │  devices · vehicles · alerts · favorites  │
   └───────────────┬───────────────────────────┘
                   ▼
   ┌───────────────────────────────────────────┐
   │  API GASGO  (Fastify + zod)               │
   │  /v1/stations/nearby  /v1/best-option     │
   │  /v1/route/stations   /v1/alerts …        │
   │  rate limit · helmet · caché por snapshot │
   └───────────────┬───────────────────────────┘
                   ▼
   ┌───────────────────────────────────────────┐
   │  APP MÓVIL  (Expo / React Native, iOS+And)│
   └───────────────────────────────────────────┘
```

## Por qué React Native + Expo (y no Flutter)

Decisión razonada, no por costumbre:

| Criterio | React Native + Expo | Flutter |
|---|---|---|
| Mapas nativos con miles de marcadores | `react-native-maps` usa **MapKit** (iOS) y **Google Maps** (Android) nativos; clustering en JS | `google_maps_flutter` bueno, pero en iOS usa Google Maps (no MapKit) salvo plugins de terceros |
| Compartir lógica con el backend | **Total**: `@gasgo/core` (TypeScript) se usa igual en la API y en la app. El motor de ahorro es literalmente el mismo código en las dos partes → imposible que discrepen | Habría que duplicar la lógica en Dart y en TS y mantener dos implementaciones sincronizadas |
| Actualizaciones | EAS Update (OTA) permite corregir la app sin pasar por revisión de tienda | Sin OTA de primera parte |
| Builds iOS sin Mac | EAS Build compila en la nube | Requiere macOS o CI propio |
| Ecosistema de ubicación/push | `expo-location`, `expo-notifications`, `expo-task-manager` integrados | Equivalentes existen, más configuración nativa manual |

El factor decisivo es **el segundo**: en una app cuyo requisito nº 1 es «no mentir con los
precios», tener un único motor de cálculo compartido entre servidor y cliente elimina toda una
clase de errores. Flutter sería igual de válido para la UI; pierde en cohesión de dominio.

**No es una web disfrazada:** no hay WebView. La UI son componentes nativos, el mapa es
`MKMapView`/`GoogleMap` real, la ubicación es CoreLocation/FusedLocationProvider y las
notificaciones son APNs/FCM.

## Reparto de responsabilidades

- **El móvil nunca llama a la fuente oficial.** Un solo consumidor (nuestro ingestor) frente al
  Ministerio, y la app consulta solo nuestra API con respuestas pequeñas y geolocalizadas.
- **El móvil nunca descarga España entera.** `/v1/stations/nearby` devuelve como máximo las N
  estaciones del radio pedido, ya ordenadas y ya recortadas a los campos necesarios.
- **Cálculo de la mejor opción**: se calcula en el servidor (para la lista y el ranking) con el
  mismo `@gasgo/core` que el cliente usa para recalcular al vuelo cuando el usuario cambia
  litros o consumo sin volver a pedir red.

## Caché y rendimiento

| Capa | Estrategia |
|---|---|
| Ingesta | Solo escribe filas de precio cuando el valor **cambia** (histórico compacto) |
| Consulta geográfica | Índice GIST sobre `geography(Point,4326)` + `ST_DWithin` |
| API | Caché en memoria con clave `(consulta, snapshot_id)`; se invalida sola al entrar un volcado nuevo. Cabecera `ETag` + `Cache-Control: max-age` calculado hasta el próximo volcado esperado |
| App | `@tanstack/react-query` con `staleTime` ligado a la frescura del snapshot; render de marcadores con clustering (`supercluster`) y carga progresiva por *viewport* |

## Escalado

Sin estado en la API (los tokens de dispositivo se validan contra la BD) → escala horizontal
detrás de un balanceador. La ingesta es un proceso **separado** (`npm run ingest`) que corre por
cron, para que un volcado pesado nunca compita con el tráfico de usuarios. Las consultas
calientes tocan `prices_current` (una fila por estación+producto), no el histórico.
