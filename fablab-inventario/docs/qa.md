# Pruebas y QA

Cinco niveles, de lo más rápido a lo más caro. Ninguno necesita tocar producción
salvo el QA y el benchmark (que también aceptan un server local).

| Nivel | Comando | Qué cubre | Estado |
|---|---|---|---|
| Unitarias | `npm test` | Lógica pura y cliente (`inventory`, `foto`, `data-matrix-svg`, `hoja-imprimible`) | **117/117** |
| Sin base | `node importer/self-check.mjs` | DDL/DML, capa de API, códigos, ids | **OK** (5 bloques) |
| Tipos/lint | `npx tsc --noEmit` · `npm run lint` | TypeScript y ESLint | limpios |
| Simbología | `npm run verify:datamatrix` | Los Data Matrix son decodificables | OK (con limitación) |
| Impresión | `npm run verify:impresion` | Imprime la hoja con Chrome y mide el PDF: páginas, papel y que nada quede cortado | 12/12 (~30 s) |
| Integración | `npm run qa` | **61-72 checks** contra la API real (el número depende de los datos) | verde en producción y en local |
| Rendimiento | `npm run bench` | Todas las operaciones, vs. piso de red | ver [`rendimiento.md`](rendimiento.md) |
| Doc y scripts | `npm run docs:check` | Enlaces, rutas documentadas vs. server, sintaxis de los `.mjs`, tipos versionados | 6/6 |

## Unitarias (`npm test`)

Jest con `jest-expo`, 4 suites:

- **`src/lib/inventory.test.ts`** — cliente de la API: `urlFoto` (null sin foto,
  cambio de URL al cambiar el hash), retry con backoff solo en GET,
  `getAllItems` con caché, búsqueda por relevancia y normalización de acentos,
  `addItem`/`updateItem`/`removeItem` con write-through y sin fallback silencioso.
- **`src/lib/foto.test.ts`** — pipeline de fotos puro: dimensiones que no
  deforman ni agrandan, peso desde base64, firma de bytes (WebP/JPEG), escalones
  de calidad, topes de límites, ahorro topado en 99%, `revisarPayload`.
- **`src/lib/data-matrix-svg.test.ts`** — geometría de la etiqueta y de la hoja:
  grilla contra el papel pedido (16 × 18 en Carta, 16 × 19 en A4, 16 × 21 en
  Oficio para códigos de 14 módulos), paginado sin perder ni repetir etiquetas,
  cada página del tamaño de su papel y **cada etiqueta entera dentro del área
  imprimible** (la guía de corte es lo más externo: si entra, entra el código),
  hoja de una pieza que crece hacia abajo, mezcla de matrices de distinto tamaño
  sin solapes, y que la celda se ensancha con el **texto** cuando el código es
  más ancho que el símbolo (un `FL-…` de 15 caracteres pide ~18 mm).
- **`src/lib/hoja-imprimible.test.ts`** — la pestaña que se imprime: una sección
  por papel, una caja por página, un SVG por caja con la medida del papel, sin
  declaración XML embebida, selector con Carta por defecto y arranque en el
  papel que entra también en A4 si la impresora tiene otra hoja cargada.

## `self-check` (sin MySQL)

```bash
node importer/self-check.mjs
# self-check OK · self-check normalizado OK · self-check api OK · self-check codigos OK
```

Corre las funciones **puras** para no necesitar base: `validarFoto`,
`validarAsignacion`, `normalizarCodigo` y la generación de SQL. Es el chequeo
rápido antes de cada commit.

## `verify:datamatrix`

```bash
npm run verify:datamatrix
```

Genera símbolos y los decodifica con `datamatrix-decode`, un decodificador
independiente. **Limitación conocida:** ese paquete solo implementa modo ASCII
(no C40/EDIFACT), y `datamatrix-svg-ts` elige el modo más eficiente: un código
real (`FL-…`, ~14 caracteres) cae en C40 y este decodificador no lo lee. Por eso
el script valida cadenas cortas (estructura, zona de silencio, patrón de
temporización) y de un código real solo afirma que el patrón se **codifica** sin
lanzar. **No prueba que una cámara lea una etiqueta impresa**: eso exige prueba
en dispositivo con `expo-camera`.

## `npm run verify:impresion` (la hoja impresa de verdad)

El paginado y el tamaño de papel los decide el navegador al imprimir, así que no
se pueden dar por buenos leyendo el código. Este chequeo **imprime**: arma la
hoja con el código de verdad, la manda a PDF con Chrome headless por el mismo
camino que la app (`@page` + saltos de página) y mide el PDF.

```bash
npm run verify:impresion                    # imprime Carta, A4 y Oficio
npm run verify:impresion -- --exigir        # en CI: falla si no hay navegador
npm run verify:impresion -- --guardar /tmp/hoja   # deja HTML y PDF para mirarlos
```

Qué comprueba, por papel (130 etiquetas con grilla de 6 columnas: más de una
página en los tres, que es el caso donde el corte aparecería):

1. **Páginas exactas**: el PDF tiene las que dice el plan. Un bloque de una hoja
   que se pasara de alto dejaría una página de más.
2. **Tamaño de hoja**: cada página mide el papel pedido (612 × 792 pts para
   Carta, 594,96 × 841,92 para A4, 612 × 936 para Oficio). Si el `@page` no se
   aplicara, el PDF saldría con el papel por defecto del navegador.
3. **Tinta en el borde**: en ninguna página hay píxel oscuro a menos de 9 mm del
   borde. Esto es lo que revela una etiqueta cortada, y es lo que **no** detecta
   contar códigos por página: con la hoja vieja (un solo SVG de 291,5 mm en un
   papel de 279,4 mm) el texto de la etiqueta rebanada quedaba entero en la
   primera página y el conteo daba bien; la medición de tinta daba **9.488 px
   pegados al borde inferior** (margen 0,0 mm) y el símbolo de la fila 19 partido
   entre las dos hojas.

El PDF se lee sin dependencias (`scripts/pdf.mjs`: `/MediaBox` por página y caja
de tinta recorriendo el stream de contenido), así que lo único externo que hace
falta es un navegador. Tarda ~30 s porque imprime tres hojas con Chrome; para el
bucle rápido de desarrollo está `npm test`.

También **encontró un bug real el primer día**: el código impreso bajo el símbolo
podía ser más ancho que la etiqueta (un `FL-…` de 15 caracteres mide ~18 mm con
fuente de 2 mm), se salía de la celda, pisaba la vecina y en A4 quedaba tinta a
**5,5 mm** del borde. Ahora la celda se mide con el texto (`anchoTextoModulos()`)
además del símbolo, y el texto se dibuja con `textLength` para que su caja no
dependa de la fuente del sistema.

### Comprobarlo a mano (con las herramientas del sistema)

El lector propio se validó contra una medición independiente: `pdftoppm` para
rasterizar y PIL para la caja de tinta, sobre los mismos PDF. Coinciden dentro de
0,5 mm (el lector propio cuenta el origen del texto, PIL los píxeles de las
letras) y **los dos marcan la hoja vieja como cortada**, así que el chequeo no
pasa por vacío:

| PDF | lector propio (página 1 / 2) | PIL |
|---|---|---|
| hoja paginada | inf **13,4** / 259,9 mm → OK | inf **13,5** / 259,9 mm → OK |
| hoja vieja (una pieza) | inf **−1,1** → FALLA | inf **0,0** → FALLA |

```bash
pdftoppm -r 150 -png hoja.pdf pagina && python3 - <<'PY'
from PIL import Image; im = Image.open('pagina-1.png').convert('L'); w, h = im.size; px = im.load()
print(min(x for y in range(h) for x in range(w) if px[x, y] < 128) / (150/25.4), 'mm de margen izquierdo')
PY
```

## CI

El monorepo tiene un workflow (`.github/workflows/ci.yml`) que corre en cada
push y PR: `npm ci`, `tsc`, `lint`, `npm test`, `self-check`,
`verify:datamatrix`, `verify:impresion -- --exigir` y `docs:check`. Es el gate que
antes dependía de que alguien se acordara; **no** necesita base de datos ni toca
producción.

La impresión es el único chequeo que necesita algo de fuera: un navegador. Los
runners de Ubuntu traen Google Chrome preinstalado y el script también busca
Chromium, Brave o Edge (`CHROME_BIN` o `--chrome <ruta>` para forzarlo), así que
en CI corre de verdad; `--exigir` hace que **falle** si no encuentra ninguno, en
vez de dar por bueno un chequeo que no corrió.

## `npm run qa` (integrativo, 61-72 checks)

```bash
npm run qa                                        # producción
npm run qa -- --base http://127.0.0.1:3101/api     # server local
```

`scripts/qa-intensivo.mjs` recorre cuatro grupos y escribe todo lo que crea con
el prefijo `QA-INT-<sello>`, que **borra al final**; si una corrida anterior quedó
cortada, primero barre esos restos.

- **A. Lecturas públicas** — `/health`, salas, inventario completo, elementos de
  una sala, historial, gzip (`Content-Encoding`), CORS y errores de cliente
  (`/salas/abc/elementos` → 400, `/salas/1.5/elementos` → 400,
  `/elementos/1.5/historial` → 400, historial de un id inexistente → 404).
  Incluye el **invariante del inventario**: ningún `codigo` repetido (es lo que
  `uq_codigo` garantiza y lo que el arranque repara si un dato heredado lo rompe).
- **B. Contrato HTTP de las fotos** — ETag igual al `sha1` de los bytes, `304`
  con `If-None-Match`, `HEAD`, `immutable`, tamaños, y los errores (`400` id
  inválido o no entero, `413` foto/miniatura pasada de peso, `404` sin foto).
  **Ya no exige que existan fotos reales**: si la base no tiene ninguna, el
  contrato completo se prueba sobre la foto temporal del elemento QA (antes el
  script reventaba con `TypeError` en una base sin fotos — que es el estado
  normal hoy).
- **C. Escrituras** (sobre un elemento temporal) — alta, código duplicado
  (`409`), edición (`PUT`), `PUT` vacío (`400`), id inexistente (`404`),
  traslado (`201` y `409` si ya está en esa sala), sala inexistente (`404`),
  asignación de código, subida/borrado de foto, `401` sin token y borrado final.
- **C · endurecimiento** — JSON roto → `400` (no `500`), cuerpo de 2 MB → `413`
  (tope 1 MB), **5 altas simultáneas con el mismo código → 1×201 y 4×409**
  (lo garantiza el índice `UNIQUE uq_codigo`, no el servidor), **alta con un
  código real ya existente → `409` nombrando al dueño y sin dejar otra fila**,
  ids no enteros → `400` en alta, `PUT` y traslado.
- **D. Export** — `elementos.csv` (BOM y cabeceras), `elementos.json`,
  `traslados.csv|json`.

El token sale de `API_TOKEN` o de `~/.config/fablab/api-token`.

**¿Por qué el conteo cambia?** El contrato de fotos de la sección B solo corre
si la base tiene alguna foto real (y entonces corre **dos veces**: sobre la foto
real y sobre la temporal del QA); en la sección C corre siempre, sobre la foto
temporal. Por eso la misma suite da una cuenta distinta según la base: **64** en
producción (sin ninguna foto real, medido el 2026-09-28) y **72** en local (tiene
una). Las dos son verde; lo que no cambia es que no haya fallos.

**Qué NO cubre**: la UI en sí (eso se valida en el navegador a mano o con
Playwright en sesiones puntuales), el camino nativo (hoja de compartir, cámara
real) y los issues de infraestructura listados en
[`problemas-conocidos.md`](problemas-conocidos.md).

## `npm run bench`

Ver [`rendimiento.md`](rendimiento.md) para la metodología y las trampas. En
corto: calentamiento + N muestras por operación, con el delta contra `/health`
como referencia, sobre un elemento temporal que se limpia solo.

## `npm run fotos:demo` (prueba en vivo)

Pone la misma foto en todos los elementos para ver el comportamiento real de la
PWA y medir latencias; deja manifiesto y se revierte con `--revertir`. Detalles
en [`fotos.md`](fotos.md).

## Rutina recomendada

**Antes de cada commit** (es lo que corre el CI, y `npm run gate` lo agrupa)

```bash
npm run gate    # tipos + lint + tests + self-check + datamatrix + impresión + docs:check
```

**Antes de cada deploy**: lo anterior + `npm run qa -- --base <local>` contra el
server local (`PORT=3101 node server/index.mjs`).

**Después de cada deploy**: `npm run qa` contra producción y las sondas de
[`operacion.md`](operacion.md) (SW, bundle, `/health`).

## Deuda de pruebas declarada

- **Sin pruebas en dispositivo**: leer un Data Matrix impreso con la cámara y
  abrir la hoja de compartir en iOS/Android solo se probaron de forma indirecta.
- **Sin pasar papel por una impresora**: lo automático llega hasta el PDF de
  Chrome con la tinta medida en el borde (sección de arriba), que es lo que el
  navegador decide; falta la prueba con impresora y escáner físicos, que es la
  única que puede decir si el código impreso se lee con la cámara a esa densidad
  (0,5 mm por módulo).
- **Error #418 de React** (hidratación del export estático): se reprodujo en
  incógnito y en `/`; es cosmético y de nivel SDK, no de nuestra app.
- **El deep link devuelve 404** aunque renderiza: falta la Rewrite Rule en Render
  (no es algo que una prueba pueda arreglar).
- **Carrera de asignación de código** (`POST …/codigo` en paralelo): solo se
  puede ejercitar donde haya elementos **sin** código, y hoy no queda ninguno.
  La cubre el mismo mecanismo que la carrera de altas —el `1062` de
  `uq_codigo` traducido a `409`—, que sí corre en cada pasada; se probó a mano
  en la base local (1×201 y 1×409) antes de aceptar el cambio.
