# Estado real de la implementación

Este documento existe porque el encargo lo pide explícitamente: **si algo no está implementado,
hay que decirlo.** Aquí está, sin adornos.

## ✅ Hecho y verificado en esta máquina

| Cosa | Cómo se verificó |
|---|---|
| Investigación de la fuente oficial | `docs/01-fuentes-oficiales.md` |
| Catálogo de combustibles ligado a las columnas oficiales | 80 tests de dominio |
| Motor de «mejor opción» (precio + desvío + consumo + litros) | Tests, incluido el caso del enunciado (A 1,449 a 15 km vs B 1,469 a 1 km → gana B) |
| Sistema antierrores (1,489 → 0,149 no se publica) | Tests de dominio y de integración |
| Esquema PostgreSQL + PostGIS | Migración aplicada sobre PostgreSQL 16.13 / PostGIS 3.4 reales |
| Ingesta idempotente, histórico solo ante cambios, desactivación de estaciones | 14 tests de integración contra la base real |
| API (proximidad, ficha, histórico, mejor opción, ruta, alertas, favoritos) | 25 tests de integración |
| Alertas y su motor de disparo | 10 tests |
| Seguridad y RGPD (tokens hasheados, aislamiento entre dispositivos, exportación y borrado) | 18 tests |
| App móvil: compila para iOS y Android | `expo export --platform ios --platform android` genera los *bundles* Hermes (4,4 MB iOS / 4,6 MB Android) |
| Proyectos nativos | `expo prebuild` genera Android e iOS con los permisos correctos |
| Tipado estricto de todo el monorepo | `tsc --noEmit` limpio en los tres paquetes |

**Total: 147 tests automáticos en verde.**

## ⚠️ Escrito pero NO ejecutado contra la fuente real

El entorno donde se desarrolló esto tiene la salida a Internet restringida por política de red:
el proxy devuelve `403` para `sedeaplicaciones.minetur.gob.es`, `energia.serviciosmin.gob.es` y
`datos.gob.es`. **No se ha podido hacer ni una sola llamada real a la API del Ministerio desde
aquí.**

Consecuencias, dichas claramente:

1. **No hay ni un precio real en la base de datos.** Los tests usan un fichero que reproduce la
   *estructura* documentada de la fuente (claves con tildes, coma decimal, campos vacíos), con
   valores de laboratorio que nunca salen de los tests. Está avisado en
   `packages/core/test-fixtures/README.md`.
2. **El contrato con la fuente está verificado contra la documentación, no contra la respuesta
   viva.** Los nombres de campo (`ListaEESSPrecio`, `IDEESS`, `Precio Gasolina 95 E5`,
   `Longitud (WGS84)`…) provienen de la documentación pública del servicio y de fuentes
   secundarias coincidentes.
3. Por eso existe `npm run verify:source -w @gasgo/api`: **hay que ejecutarlo en una máquina con
   Internet antes de dar por buena la ingesta.** Comprueba claves, fecha, columnas de producto
   desconocidas y que cada precio parseado coincide carácter a carácter con el texto original.

Mientras eso no ocurra, GASGO se comporta así: la API responde `hasData: false`, los endpoints
de precios devuelven `503 sin_datos_oficiales` y la app muestra «Sin datos oficiales todavía».
**En ningún momento se rellena la pantalla con precios inventados.**

## 🚧 No implementado (y por qué)

| Función | Estado | Nota |
|---|---|---|
| Agrupación de marcadores (*clustering*) | No implementado | La API ya limita los resultados por radio y tope, así que en uso normal hay decenas de marcadores, no miles. Si se añade una vista de España entera, hará falta: `supercluster` está en las dependencias |
| Histórico oficial anterior a la instalación | No implementado | La fuente ofrece `/EstacionesTerrestresHist/{fecha}`; se podría precargar el histórico. Hoy el histórico de GASGO empieza el día de la primera ingesta, y la app lo dice |
| Geocodificación y rutas propias | Usa Nominatim/OSRM públicos | Sus políticas de uso **no permiten** producción. Antes de publicar: instancia propia o proveedor contratado |
| Distancias de conducción reales para «mejor opción» | Estimadas | Se usa la distancia en línea recta × 1,3. El motor ya acepta `drivingMeters` reales si se conecta un router |
| Estaciones marítimas y puntos de recarga eléctrica | Fuera de alcance | La fuente los publica en otros servicios |
| Descuentos de tarjetas de fidelización | No | No están en la fuente oficial. La app avisa de que muestra el precio de surtidor |
| Tests de interfaz de la app | No | Hay tipado estricto y verificación de compilación, pero no hay tests de render ni E2E de la app |
| Registro fotográfico / capturas de tienda | No | Requiere ejecutar la app en un simulador con datos reales |

## 🔍 Cómo comprobar que GASGO no miente

```bash
# 1. Contrato con la fuente oficial (requiere Internet)
npm run verify:source -w @gasgo/api

# 2. Fidelidad de precios en todo el recorrido: fuente → parser → BD → API
npm test -w @gasgo/core     # incluye «FIDELIDAD DE PRECIOS»
npm test -w @gasgo/api      # incluye la comprobación extremo a extremo

# 3. Buscar afirmaciones de «tiempo real» en el código (no debe haber ninguna en la interfaz)
grep -rn "tiempo real" apps/mobile/src apps/mobile/app packages/core/src services/api/src
```

La regla dura del proyecto está concentrada en un único fichero,
`packages/core/src/freshness.ts`: es el único sitio donde se redacta la antigüedad de un precio,
y no sabe decir «en tiempo real».
