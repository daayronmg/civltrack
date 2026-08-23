# FASE 1 y 2 — Fuentes oficiales de precios de carburantes en España

> Documento de investigación. Todo lo que GASGO muestra al usuario procede de la fuente
> descrita aquí. **GASGO no genera, estima ni interpola precios.**

## 1. ¿De dónde salen los precios?

La única fuente oficial de precios de carburante por estación de servicio en España es el
**Ministerio para la Transición Ecológica y el Reto Demográfico (MITECO)**, a través del
sistema **SIPP** (Sistema de Información de Precios de Productos Petrolíferos), alimentado
por los propios titulares de las estaciones de servicio, que están **obligados por ley** a
comunicar sus precios y sus variaciones (obligación de remisión de información derivada del
Real Decreto-ley 6/2000 y normativa de desarrollo — «RISP», Remisión de Información sobre
Productos Petrolíferos).

Los datos de SIPP se publican por tres vías:

| Vía | URL | Uso en GASGO |
|---|---|---|
| **API REST oficial** (Estaciones Terrestres) | `https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/` | **Fuente primaria de ingesta** |
| Mismo servicio en el dominio de energía | `https://energia.serviciosmin.gob.es/ServiciosRestCarburantes/PreciosCarburantes/` | Espejo / *failover* |
| Geoportal de Gasolineras (visor web) | `https://geoportalgasolineras.es/` | Referencia visual para verificación manual |
| Catálogo de datos abiertos | `datos.gob.es`, dataset `e05068001` | Ficha del conjunto de datos, licencia |

La API es **pública, sin API key y sin registro**.

### Endpoints usados por GASGO

Base: `https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes`

| Endpoint | Descripción |
|---|---|
| `GET /EstacionesTerrestres/` | Todas las estaciones terrestres de España con todos sus precios actuales |
| `GET /EstacionesTerrestres/FiltroProvincia/{IDProvincia}` | Filtrado por provincia |
| `GET /EstacionesTerrestres/FiltroMunicipio/{IDMunicipio}` | Filtrado por municipio |
| `GET /EstacionesTerrestres/FiltroCCAAProducto/{IDCCAA}/{IDProducto}` | Filtrado por comunidad y producto |
| `GET /EstacionesTerrestresHist/{DD-MM-YYYY}` | **Histórico oficial** de un día concreto |
| `GET /Listados/Provincias/` | Catálogo de provincias |
| `GET /Listados/Municipios/` | Catálogo de municipios |
| `GET /Listados/ProductosPetroliferos/` | Catálogo oficial de productos (combustibles) |
| `GET /Listados/ComunidadesAutonomas/` | Catálogo de comunidades autónomas |

GASGO ingiere **el fichero nacional completo** (`/EstacionesTerrestres/`) desde el backend, y
**nunca** desde el móvil (ver `docs/02-arquitectura.md`).

> **Nota de formato:** el servicio negocia contenido. Un navegador recibe XML; con
> `Accept: application/json` devuelve JSON. El ingestor de GASGO envía siempre
> `Accept: application/json`.

## 2. ¿Cada cuánto se actualizan?

Esto es lo que más se malinterpreta, y es donde GASGO **no puede mentir**:

- La estación comunica el precio a SIPP **cuando lo cambia**. La normativa obliga a comunicar
  las variaciones; no existe un «tick» de mercado.
- El servicio del Ministerio republica el conjunto de datos de forma continua. La respuesta
  incluye un campo `Fecha` que es **la marca de tiempo del snapshot publicado**, no la hora en
  que cada gasolinera cambió su precio.
- La API **no expone una fecha de precio por estación ni por producto**. Solo una fecha global
  del volcado.

**Consecuencia de diseño (regla dura de GASGO):**

1. GASGO guarda, para cada precio, `source_snapshot_at` (el `Fecha` oficial del volcado del que
   procede) y `observed_at` (cuándo lo ingirió GASGO).
2. GASGO guarda además `value_since`: el instante del **primer** snapshot en el que ese precio
   exacto apareció sin haber cambiado desde entonces (lo calcula el propio histórico de GASGO).
3. La interfaz muestra literalmente:
   - «**Confirmado hace 7 min**» → basado en `source_snapshot_at`.
   - «**Sin cambios desde ayer 18:40**» → basado en `value_since`.
4. La interfaz **nunca** muestra «precio en tiempo real», ni «actualizado ahora mismo» si el
   snapshot es más antiguo. Si el último snapshot tiene más de 60 min, la app muestra un aviso
   explícito de dato potencialmente desactualizado.

Ver `packages/core/src/freshness.ts`, que es el único sitio donde se genera ese texto.

## 3. ¿Qué información da cada estación?

Claves exactas del JSON oficial (respetando espacios, tildes y puntos tal cual las devuelve el
servicio). Están declaradas en `packages/core/src/source-schema.ts` y verificadas en tiempo de
ingesta:

| Clave oficial | Contenido |
|---|---|
| `IDEESS` | Identificador único de la estación de servicio |
| `IDMunicipio`, `Municipio` | Municipio |
| `IDProvincia`, `Provincia` | Provincia |
| `IDCCAA` | Comunidad autónoma |
| `Localidad` | Localidad |
| `C.P.` | Código postal |
| `Dirección` | Dirección postal |
| `Latitud` | Latitud, WGS84, **coma decimal** |
| `Longitud (WGS84)` | Longitud, WGS84, **coma decimal** |
| `Rótulo` | Marca comercial (REPSOL, CEPSA, BP, ALCAMPO…) |
| `Horario` | Horario de apertura, texto libre |
| `Tipo Venta` | `P` (público) / `R` (restringido a cooperativas, flotas…) |
| `Margen` | Margen de la vía (`D`, `I`, `N`) |
| `Remisión` | Origen de la remisión (`dm`, `OM`…) |
| `% BioEtanol`, `% Éster metílico` | Porcentaje de biocomponente |
| `Precio Gasolina 95 E5`, `Precio Gasoleo A`, … | Precios por producto, **coma decimal**, cadena vacía si no se vende |

**Precios:** la API los da como cadena con coma decimal (`"1,489"`) y **vacío** cuando la
estación no vende ese producto. GASGO convierte a `numeric(6,3)` y trata la cadena vacía como
*ausencia de producto*, nunca como precio 0.

## 4. Identificación de cada gasolinera

`IDEESS` es la clave primaria natural y es estable en el tiempo. GASGO lo usa como
`source_station_id` con restricción `UNIQUE (source, source_station_id)`, lo que hace la ingesta
idempotente y evita duplicados aunque se reprocese el mismo fichero N veces.

Cuidado documentado: `IDEESS` identifica el **punto de suministro**; una estación que cierra y
reabre con otro titular puede recibir un ID distinto. GASGO detecta las estaciones ausentes del
último volcado y las marca `active = false` en vez de borrarlas (preserva el histórico).

## 5. Identificación de cada combustible

El catálogo oficial es `/Listados/ProductosPetroliferos/` (campos `IDProducto`,
`NombreProducto`). En el fichero de estaciones, cada producto aparece como una **columna**
llamada `Precio <NombreProducto>`.

GASGO mantiene el mapa columna-oficial → código interno en
`packages/core/src/fuels.ts` (p. ej. `Precio Gasolina 95 E5` → `G95E5`,
`Precio Gasoleo A` → `GOA`, `Precio Gases licuados del petróleo` → `GLP`,
`Precio Gas Natural Comprimido` → `GNC`). Si el Ministerio añade un producto nuevo, el ingestor
**registra la columna desconocida** en `ingestion_runs.unknown_columns` en lugar de descartarla
en silencio.

## 6. Fecha y hora del precio

- Campo `Fecha` de la raíz de la respuesta (`"dd/MM/yyyy HH:mm:ss"`), interpretado en zona
  `Europe/Madrid`.
- GASGO no inventa una hora por estación: ver la sección 2.

## 7. Limitaciones conocidas (y cómo las trata GASGO)

| Limitación | Tratamiento en GASGO |
|---|---|
| No hay timestamp por estación/producto | Se muestra frescura del snapshot + «sin cambios desde» calculado por GASGO |
| El precio depende de que la estación cumpla su obligación de comunicar | Aviso en ficha: el precio es el último comunicado a la Administración |
| Estaciones con `Tipo Venta = R` no son públicas | Se marcan y se **excluyen por defecto** de las recomendaciones |
| Sin paginación: la descarga nacional es un único JSON grande (~11–12k estaciones, decenas de MB) | Ingesta solo en el backend, con streaming y timeout amplio |
| El servicio puede caer o responder lento | Reintentos con backoff, `failover` al dominio espejo, y **nunca** se borran los precios previos ante un fallo |
| Errores tipográficos históricos en el listado de provincias (`IDPovincia`) | El parser acepta ambas grafías |
| Sin CORS ni rate limit documentados | Un solo consumidor (nuestro ingestor), con `User-Agent` identificable |
| No incluye estaciones marítimas ni puntos de recarga eléctrica | Fuera del alcance de la v1; documentado como no implementado |
| Descuentos de fidelización (tarjetas de marca) no están en la fuente | GASGO muestra el **precio oficial de surtidor** y lo dice explícitamente |

## 8. Condiciones legales de uso

- Los datos son **datos abiertos** publicados por MITECO y catalogados en `datos.gob.es`
  (dataset `e05068001`). La reutilización se rige por la **Ley 37/2007** de reutilización de la
  información del sector público y por el aviso legal del portal, que permite la reutilización
  comercial y no comercial con estas condiciones:
  1. **No desnaturalizar el sentido de la información.**
  2. **Citar la fuente.**
  3. **Mencionar la fecha de la última actualización.**
  4. No indicar que MITECO patrocina, avala o apoya la aplicación.
  5. No suprimir metadatos de fecha y fuente.

**Cómo cumple GASGO:**
- Atribución permanente y visible en la app (pantalla Perfil → «Fuente de datos», y pie de la
  ficha de cada estación): *«Fuente: Ministerio para la Transición Ecológica y el Reto
  Demográfico. Datos de precios comunicados por las estaciones de servicio. GASGO no está
  avalado por el Ministerio.»*
- Fecha de última actualización siempre visible (`source_snapshot_at`).
- El endpoint `GET /v1/meta/source` de la API devuelve la atribución, la licencia y la fecha del
  último volcado, para que cualquier cliente pueda mostrarla.
- Los precios no se modifican: se muestran exactamente como los publica la fuente. Los cálculos
  derivados (ahorro, coste del desvío) se presentan **siempre** etiquetados como estimación de
  GASGO, separados del dato oficial.

## 9. Verificación de esta investigación

⚠️ **Transparencia sobre cómo se hizo:** el entorno de desarrollo en el que se escribió este
código tiene la salida a Internet restringida por política de red (`403` del proxy de egreso
para `sedeaplicaciones.minetur.gob.es`, `datos.gob.es` y `energia.serviciosmin.gob.es`), por lo
que **no se pudo ejecutar una llamada real a la API oficial desde aquí**. La documentación
anterior procede de la documentación pública del servicio y de fuentes secundarias.

Por eso el proyecto incluye un verificador que **debe ejecutarse en la máquina/servidor real**
antes de dar por buena la ingesta:

```bash
npm run verify:source -w @gasgo/api
```

Ese script:
1. Llama a la API oficial de verdad.
2. Comprueba que existen todas las claves esperadas en `source-schema.ts`.
3. Lista las columnas de precio desconocidas (productos nuevos).
4. Muestra el `Fecha` del volcado y el número de estaciones.
5. Sale con código ≠ 0 si el contrato no se cumple.

Mientras ese comando no se ejecute con éxito, la base de datos de GASGO estará **vacía**: la app
mostrará el estado «sin datos de la fuente oficial», nunca precios inventados.

## Fuentes consultadas

- Servicio REST oficial — <https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/>
- Ayuda de operaciones del servicio — <https://sedeaplicaciones.minetur.gob.es/ServiciosRestCarburantes/PreciosCarburantes/help>
- Espejo en dominio de energía — <https://energia.serviciosmin.gob.es/ServiciosRestCarburantes/PreciosCarburantes/help>
- Dataset en datos.gob.es — <https://datos.gob.es/es/catalogo/e05068001-precio-de-carburantes-en-las-gasolineras-espanolas>
- MITECO, consultas de carburantes — <https://www.miteco.gob.es/es/energia/servicios/consultas-de-carburantes.html>
- MITECO, envío de información (RISP) — <https://www.miteco.gob.es/es/energia/hidrocarburos-nuevos-combustibles/risp/envio-informacion.html>
