# GASGO

> **Encuentra dónde repostar más barato.**
> Aplicación móvil nativa (iOS y Android) que usa los precios **oficiales** de las gasolineras
> españolas publicados por el Ministerio para la Transición Ecológica y el Reto Demográfico.

---

## La regla que manda sobre todas las demás

**GASGO no inventa precios.** No hay datos de demostración, ni precios de ejemplo, ni
gasolineras ficticias en ninguna parte del producto. Si la ingesta de la fuente oficial no se ha
ejecutado, la API responde `hasData: false` y la app dice, literalmente, que todavía no hay datos
oficiales.

Y no exagera la frescura: el Ministerio publica **volcados**, no un flujo en tiempo real. GASGO
dice «Confirmado hace 7 min» (antigüedad del volcado) y «Sin cambios desde ayer a las 18:40»
(según su propio histórico). La expresión «precio en tiempo real» no existe en la interfaz, y
hay un test que lo comprueba.

## Qué hay aquí

```
gasgo/
├── docs/                  Investigación de la fuente, arquitectura, modelo de datos,
│                          privacidad, producción y estado real de lo implementado
├── packages/core/         @gasgo/core — dominio compartido por el backend y la app:
│                          combustibles, geometría, motor de ahorro, antierrores, frescura
├── services/api/          Ingesta + validación + PostgreSQL/PostGIS + API pública
├── apps/mobile/           App Expo / React Native (iOS + Android)
└── infra/                 Docker Compose, Dockerfile y cron de ejemplo
```

El detalle está en:

| Documento | Contenido |
|---|---|
| [`docs/01-fuentes-oficiales.md`](docs/01-fuentes-oficiales.md) | De dónde salen los precios, cada cuánto, qué campos hay, qué limitaciones y qué dice la licencia |
| [`docs/02-arquitectura.md`](docs/02-arquitectura.md) | Arquitectura y por qué React Native + Expo en vez de Flutter |
| [`docs/03-modelo-datos.md`](docs/03-modelo-datos.md) | Esquema, índices y decisiones (por qué `numeric(7,3)` y no `float`) |
| [`docs/04-privacidad-rgpd.md`](docs/04-privacidad-rgpd.md) | Qué datos se recogen, cuáles no, y los derechos implementados |
| [`docs/05-produccion-stores.md`](docs/05-produccion-stores.md) | Despliegue y checklist de App Store y Google Play |
| [`docs/06-estado-implementacion.md`](docs/06-estado-implementacion.md) | **Qué está hecho, qué no y qué no se ha podido probar** |

## Puesta en marcha

### Backend

```bash
npm install

# 1. Base de datos (PostgreSQL 16 + PostGIS 3)
createdb gasgo && psql gasgo -c 'CREATE EXTENSION postgis'
cp services/api/.env.example services/api/.env   # ajusta DATABASE_URL
npm run migrate -w @gasgo/api

# 2. ¿La fuente oficial cumple lo que esperamos? (necesita Internet)
npm run verify:source -w @gasgo/api

# 3. Primer volcado real
npm run ingest -w @gasgo/api

# 4. API
npm run dev -w @gasgo/api
```

O con Docker: `docker compose -f infra/docker-compose.yml up -d --build`.

### App móvil

```bash
cd apps/mobile
npx expo start           # desarrollo
npx expo prebuild        # proyectos nativos iOS/Android
eas build --platform ios --profile production
```

Ajusta `EXPO_PUBLIC_API_URL` en `eas.json` para apuntar a tu API.

## Tests

```bash
npm test                 # 151 tests
npm test -w @gasgo/core  #  80 — dominio: geometría, ahorro, antierrores, parser oficial
npm test -w @gasgo/api   #  71 — integración contra PostgreSQL + PostGIS de verdad
```

Los de integración levantan un esquema real y prueban ingesta, consultas geoespaciales,
alertas, seguridad y **fidelidad de precios de extremo a extremo**: el número que la app pinta
en pantalla se compara carácter a carácter con el texto que publica la fuente.

## Cómo decide GASGO cuál es la «mejor opción»

No es la más barata a secas. Es la que minimiza el coste total:

```
coste total = litros × precio  +  (km de desvío × consumo/100) × precio
```

Con el ejemplo del enunciado: gasolinera A a 1,449 €/L y 15 km, gasolinera B a 1,469 €/L y 1 km.
Repostando 40 L con un coche de 7 L/100 km, ir a A quema unos 2,7 L extra: sale **más caro** que
B pese al precio menor. GASGO recomienda B, y lo dice con el ahorro estimado en euros.

Ese cálculo vive en `packages/core/src/savings.ts` y lo ejecutan **el servidor y el móvil con el
mismo código**, así que no pueden dar resultados distintos.

## Fuente de los datos

Ministerio para la Transición Ecológica y el Reto Demográfico — Precios de carburantes en
estaciones terrestres (Sistema de Información de Precios de Productos Petrolíferos).
Reutilización conforme a la Ley 37/2007: se cita la fuente, se muestra siempre la fecha de la
última actualización y no se altera la información.

**GASGO no está avalado por el Ministerio.**
