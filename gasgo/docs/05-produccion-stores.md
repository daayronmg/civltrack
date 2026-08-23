# FASE 12 — Puesta en producción y publicación

## 1. Backend

### Requisitos
- Node.js 22, PostgreSQL 16 con PostGIS 3.x.
- Salida a Internet hacia `sedeaplicaciones.minetur.gob.es` (y su espejo).

### Despliegue con Docker

```bash
cp services/api/.env.example services/api/.env      # y rellénalo
export POSTGRES_PASSWORD='...'                       # nunca en el repositorio
docker compose -f infra/docker-compose.yml up -d --build
```

Levanta tres servicios: base de datos con PostGIS, API y proceso de ingesta (que migra al
arrancar y luego ingiere cada 30 minutos). Como alternativa al contenedor de ingesta,
`infra/crontab.example` hace lo mismo con cron.

### Primer arranque — **orden obligatorio**

```bash
npm run migrate       -w @gasgo/api   # 1) esquema
npm run verify:source -w @gasgo/api   # 2) ¿la fuente oficial cumple el contrato?
npm run ingest        -w @gasgo/api   # 3) primer volcado real
```

Si el paso 2 falla, **no se ingiere**: la API responde `hasData: false` y la app dice que no hay
datos. Es lo correcto: preferimos una pantalla honesta a un precio inventado.

### Delante de la API
- TLS (Caddy, nginx o el balanceador del proveedor). La API escucha en `127.0.0.1:3000`.
- `trustProxy` ya está activado para que el rate limiting vea la IP real del cliente.
- Escalado horizontal: la API no tiene estado. La ingesta debe correr en **una sola instancia**.

### Vigilancia
| Señal | Dónde | Qué significa |
|---|---|---|
| `ingestion_runs.status = 'failed'` repetido | BD | La fuente oficial no responde o cambió |
| `unknown_columns` no vacío | BD | El Ministerio publica un producto nuevo: añadirlo a `fuels.ts` |
| `price_anomalies` disparándose | BD | Cambio de formato en origen o incidencia real de precios |
| `lastSnapshotAt` con más de 3 h | `/v1/meta/source` | La ingesta está parada |

## 2. Aplicación móvil

### Configuración previa
1. Crear el proyecto de EAS y poner su `projectId` en `app.json` (`extra.eas.projectId`).
2. Poner la URL pública de la API en `eas.json` (`EXPO_PUBLIC_API_URL`).
3. **Android:** crear una clave de Google Maps SDK for Android, restringirla por huella SHA-1 y
   nombre de paquete, y pasarla como variable de entorno `GOOGLE_MAPS_ANDROID_API_KEY` en EAS.
   Esta clave es de cliente y va restringida; ninguna otra credencial vive en la app.
   **iOS no necesita clave:** usa MapKit.

### Compilación y envío

```bash
cd apps/mobile
eas build   --platform ios     --profile production
eas build   --platform android --profile production
eas submit  --platform ios
eas submit  --platform android
```

### Checklist de App Store

- [ ] Política de privacidad publicada en una URL accesible.
- [ ] *App Privacy*: ubicación (precisa y aproximada) → «Funcionalidad de la app», **no
      vinculada a la identidad**, **sin seguimiento**.
- [ ] Justificar el uso de la ubicación en las notas para revisión, con capturas.
- [ ] Capturas de 6,7" y 6,1".
- [ ] Texto de la ficha: dejar claro que los precios son **oficiales del Ministerio** y que
      **no son en tiempo real**; así se evita el rechazo por afirmaciones engañosas.
- [ ] Cuenta de prueba: no hace falta, la app no tiene registro (indicarlo).

### Checklist de Google Play

- [ ] *Data safety*: ubicación aproximada y precisa, recogida y **no compartida**, no vinculada
      a la identidad, cifrada en tránsito, con opción de eliminación (existe el endpoint).
- [ ] `POST_NOTIFICATIONS` justificado (alertas creadas por el propio usuario).
- [ ] Declaración de que no se usan identificadores publicitarios.
- [ ] `targetSdkVersion` al día según la política vigente de Play.

### Legal en ambas tiendas

- Mostrar la atribución al Ministerio (ya está en la app y en la API).
- Indicar de forma visible que **GASGO no está avalado por el Ministerio**.
- No usar el escudo, el logotipo ni la imagen institucional en iconos ni capturas.

## 3. Antes de la primera versión pública

Estas cosas **no están hechas** y son bloqueantes; ver `docs/06-estado-implementacion.md`:

1. Ejecutar `verify:source` contra la API real y revisar el resultado.
2. Contrastar a mano 20 gasolineras contra el geoportal oficial.
3. Política de privacidad y términos de uso redactados.
4. Instancia propia (o proveedor de pago) de geocodificación y rutas: OSRM y Nominatim públicos
   no admiten uso en producción.
5. Monitorización y alertas de la ingesta.
