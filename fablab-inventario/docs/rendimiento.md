# Rendimiento

Objetivo práctico: que la app se sienta instantánea y que la base de Aiven
(WAN + TLS) **no aporte tiempo medible** en las lecturas. Todo lo de abajo está
medido contra producción el **2026-09-24/25**.

## Las palancas

### 1. Pool de conexiones tibio (`importer/api.mjs`)

El default de `mysql2` cerraba las conexiones libres a los 60 s, así que con
tráfico espaciado **casi cada request pagaba handshake TLS completo** contra
Aiven (~1-2 s en el peor caso). Ahora:

```js
connectionLimit: 5, maxIdle: 5, idleTimeout: 8 * 60 * 1000,
enableKeepAlive: true, keepAliveInitialDelay: 10_000,
```

5 conexiones vivas todo el tiempo (a Aiven le da igual: 5 idle no consumen plan)
y `keepAlive` para que NAT/firewall no suelte el socket.

### 2. Cachés TTL en el server (`importer/api.mjs`)

`CACHE_TTL_MS = 60_000`, con llaves `elementos:all`, `salas`,
`elementos:sala:<id>` y `historial:<id>`. **Toda escritura llama a
`invalidarCache()`**, así que lo que se ve siempre está fresco; el TTL solo evita
repetir la misma query cuando la pantalla la pide dos veces seguidas.

- `listarElementos` (por sala): era la pantalla más usada y cada apertura pedía
  2 queries sin caché (~+140 ms). `history` se pedía en **cada** apertura de
  modal (+67 ms).

### 3. Caché de fotos en RAM (`importer/api.mjs`)

- `hashesFoto`: `id → {mime, hash}`, lo que necesitan los `304`/`HEAD`.
- LRU `blobFoto` de 100 entradas (~2,5 MB): reabrir un modal reciente no re-paga
  el blob.
- `precargarMiniaturas()` al arrancar: ~917 × 6 KB ≈ **5 MB** en RAM; pintar la
  sala CNC (171 chips) no hace ninguna query.
- Toda escritura/borrado de foto limpia las entradas de ese elemento. La
  coherencia con el cliente no depende de esta caché: cada URL lleva el hash
  como cache-buster.

### 4. Índice `elementos(codigo)`

Sin índice, el chequeo de duplicado del alta, el DELETE por código y la búsqueda
recorrían los 917 elementos. Hoy es `uq_codigo`, **UNIQUE**: sirve las mismas
búsquedas y además deja que la garantía de unicidad la dé la base (un `INSERT`
repetido falla con `1062` → `409`). Se crea al arrancar, una vez reparados los
duplicados heredados (ver [`base-de-datos.md`](base-de-datos.md)).

### 5. `304`/`HEAD` sin leer el blob

Antes, contestar "no cambió" traía el MEDIUMBLOB completo (p50 **629 ms**).
`obtenerHashFoto()` consulta solo `mime, hash`, y con la caché ni eso.

### 6. gzip > 1 KB y ETag/immutable

El JSON del inventario (917 filas, ~173 KB) baja a ~20 KB comprimido. Las
imágenes van sin gzip (ya están comprimidas) con `immutable` + ETag: el
navegador no revalida lo que no cambió.

### 7. Caché en el cliente

SWR en memoria + `AsyncStorage` con frescura de 60 s: reabrir la app muestra
datos al instante y refresca por detrás; sin red, devuelve lo último conocido.
`prewarmCache()` calienta al abrir. Reintentos de GET con backoff para el cold
start.

### 8. UI

Miniatura como placeholder del modal, `cachePolicy="memory"`, `transition={150}`
y **prefetch en `onPressIn`/`onHoverIn`** del chip; `loading="lazy"` en los chips
(solo se descargan los visibles). Reabrir el mismo modal sirve la foto en **3 ms**.

## Mediciones (producción, 2026-09-25)

`npm run bench` (`scripts/benchmark.mjs`): 1 hit de calentamiento + 8 muestras
por operación (4 en las escrituras caras), y **delta contra el piso de red**
medido con `/health` (que no toca la BD, ~135 ms). Ese delta es lo que la app
realmente añade.

El benchmark **se autoabastece**: crea su propio elemento temporal, le sube una
foto y mide contra eso, borrándolo al final. Antes apuntaba a elementos fijos
(«el elemento 1»), que tenían foto solo durante la prueba de demo: con la base
sin fotos, esas «lecturas de foto» medían en realidad una consulta + `404`, y los
números no eran comparables entre corridas.

### Lecturas

| Operación | Delta p50 vs `/health` |
|---|---|
| `GET /api/salas` | −2 ms |
| `GET /api/salas/7/elementos` (sala CNC, 171) | +14 ms |
| `GET /api/elementos/:id/historial` | +2 ms |
| `GET …/foto?tam=miniatura` (RAM) | +9 ms |
| `GET …/foto` (foto grande, en LRU) | +2 ms |
| `GET …/foto` con `If-None-Match` (304) | +1 ms |
| `HEAD …/foto` | +113 ms (artefacto del proxy: la app nunca usa HEAD) |
| `GET /api/elementos` (917) | +8 ms de media; +80 ms en la muestra que expira el TTL de 60 s |

Los valores negativos o de un dígito son ruido de red: **todas las lecturas
están en el piso**. El listado promedia así porque solo una de cada N muestras
paga la consulta; en la app, la caché SWR del cliente tapa esa ventana.

### Escrituras (round-trips WAN inherentes)

| Operación | Delta p50 |
|---|---|
| `PUT /api/elementos/:id` (1 query) | +139 ms |
| `POST /api/elementos` con código duplicado (409: lock + 2 consultas) | +273 ms |
| `POST /api/elementos` con código nuevo (la ruta real del alta) | +337 ms |

Las dos filas de `POST /api/elementos` son de la corrida **con lock**
(2026-09-25, previa al índice UNIQUE); se conservan como registro de esa etapa.
| `POST /api/traslados` (4 consultas transaccionales) | +200 ms |
| `POST …/foto` (25,6 KB: validación + upsert de 60 KB) | +226 ms |
| `DELETE /api/elementos/:id/foto` | +68 ms |
| `DELETE /api/elementos/:codigo` (transacción de 3) | +72 ms |
| `GET /api/export/elementos.json` | +76 ms |
| `GET /api/export/traslados.csv` | +69 ms |
| `GET /api/export/elementos.csv` (917 filas, sin gzip) | +82 ms |

El **alta** volvió al costo de una escritura simple: valida la sala, inserta y,
si el código está repetido, traduce el `1062` de la base a `409` con el id del
dueño. Los **+337 ms** que midió la corrida de más abajo incluían el lock de
código que hizo falta mientras existió el duplicado heredado `IOT-79` (ver
[`problemas-conocidos.md`](problemas-conocidos.md)); con `uq_codigo` ese lock ya
no existe y la garantía es la misma (5 altas simultáneas siguen dando `1×201` y
`4×409`, verificado por `npm run qa`).

Lo único por encima del piso son las escrituras reales (cada una paga sus
consultas) y el arranque en frío del free tier.

### Antes vs. después (lo que se ganó)

| Medición | Antes | Después |
|---|---|---|
| Inventario completo (11 salas en serie) | ~30 s | 1 petición, ~300 ms |
| Abrir una sala | 2 queries (~+140 ms) | caché TTL / piso |
| Abrir el modal (historial) | +67 ms | +2 ms |
| Revalidar una foto (ETag) | 629 ms | +1 ms (hash en RAM) |
| Miniatura de un elemento | +204 ms (query) | +9 ms (precargada en RAM) |
| Primer hit tras 70 s idle | 0,6 s+ con query | 0,43-0,47 s **en `/health` también** (CPU del free tier) |
| Alta de un elemento | ~+200 ms | +337 ms con el lock de códigos; **el lock ya no existe** (índice UNIQUE) |

## Cómo medir sin engañarte

Tres trampas que ya causaron conclusiones falsas:

1. **Mide con gzip como la app.** `curl` sin `--compressed` mide ~120 ms de más
   en el listado (140 KB transferidos vs. 776 B comprimidos).
2. **`HEAD` no es representativo.** Marca ~+105 ms sobre el `304` aunque ambos
   salgan de RAM: es un artefacto del proxy de Render. **La app nunca usa HEAD**,
   así que no persigas ese número.
3. **Distingue cold start de base de datos.** El primer hit tras un rato idle
   cuesta lo mismo en `/health` (sin BD) que en cualquier ruta: es el despertar
   de CPU del free tier, no MySQL. Compara siempre contra `/health`.

```bash
npm run bench                             # producción (N=8)
npm run bench -- --n 20                   # más muestras
npm run bench -- --base http://127.0.0.1:3101/api   # server local
```

El benchmark usa un elemento temporal `QA-BENCH-PERF` y lo borra al final; si una
corrida se corta, la siguiente limpia el resto.

## Lo que todavía cuesta

- **Cold start del free tier** (0,4-0,5 s): no se arregla desde el código, solo
  con un plan pago o el keep-alive (que ya está) para que duerma lo menos posible.
- **Escrituras**: ~60-220 ms sobre el piso, inherentes a los round-trips a Aiven.
  Si algún día molestan, el siguiente paso sería agrupar (batch) o mover la base
  a una región más cercana.
- **Primera carga del listado con TTL expirado**: +78 ms una vez por minuto.
- **La unicidad de `codigo` ya no cuesta round-trips.** Mientras existió el
  duplicado heredado `IOT-79` la sostenía un lock con nombre (`GET_LOCK`),
  medido en **+135 ms** por alta. Resuelto el dato, el índice `UNIQUE uq_codigo`
  hace el trabajo: mismo resultado, sin lock y sin consultas extra.
- **El historial solo hace una consulta extra cuando está vacío**: si el
  elemento existe y no tiene traslados, paga un `SELECT` de existencia para
  poder responder `404` cuando el id no existe. Con traslados, una sola query.
