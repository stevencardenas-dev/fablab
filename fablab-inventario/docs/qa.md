# Pruebas y QA

Cinco niveles, de lo más rápido a lo más caro. Ninguno necesita tocar producción
salvo el QA y el benchmark (que también aceptan un server local).

| Nivel | Comando | Qué cubre | Estado |
|---|---|---|---|
| Unitarias | `npm test` | Lógica pura y cliente (`inventory`, `foto`, `data-matrix-svg`) | **99/99** |
| Sin base | `node importer/self-check.mjs` | DDL/DML, capa de API, códigos, ids | **OK** (5 bloques) |
| Tipos/lint | `npx tsc --noEmit` · `npm run lint` | TypeScript y ESLint | limpios |
| Simbología | `npm run verify:datamatrix` | Los Data Matrix son decodificables | OK (con limitación) |
| Integración | `npm run qa` | **61-72 checks** contra la API real (el número depende de los datos) | verde en producción y en local |
| Rendimiento | `npm run bench` | Todas las operaciones, vs. piso de red | ver [`rendimiento.md`](rendimiento.md) |
| Doc y scripts | `npm run docs:check` | Enlaces, rutas documentadas vs. server, sintaxis de los `.mjs`, tipos versionados | 6/6 |

## Unitarias (`npm test`)

Jest con `jest-expo`, 3 suites:

- **`src/lib/inventory.test.ts`** — cliente de la API: `urlFoto` (null sin foto,
  cambio de URL al cambiar el hash), retry con backoff solo en GET,
  `getAllItems` con caché, búsqueda por relevancia y normalización de acentos,
  `addItem`/`updateItem`/`removeItem` con write-through y sin fallback silencioso.
- **`src/lib/foto.test.ts`** — pipeline de fotos puro: dimensiones que no
  deforman ni agrandan, peso desde base64, firma de bytes (WebP/JPEG), escalones
  de calidad, topes de límites, ahorro topado en 99%, `revisarPayload`.
- **`src/lib/data-matrix-svg.test.ts`** — geometría de la etiqueta y de la hoja
  A4 (sin solapes, dentro del área imprimible, crece hacia abajo cuando hace
  falta).

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

## CI

El monorepo tiene un workflow (`.github/workflows/ci.yml`) que corre en cada
push y PR: `npm ci`, `tsc`, `lint`, `npm test`, `self-check`,
`verify:datamatrix` y `docs:check`. Es el gate que antes dependía de que alguien
se acordara; **no** necesita base de datos ni toca producción.

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
npm run gate    # tipos + lint + tests + self-check + datamatrix + docs:check
```

**Antes de cada deploy**: lo anterior + `npm run qa -- --base <local>` contra el
server local (`PORT=3101 node server/index.mjs`).

**Después de cada deploy**: `npm run qa` contra producción y las sondas de
[`operacion.md`](operacion.md) (SW, bundle, `/health`).

## Deuda de pruebas declarada

- **Sin pruebas en dispositivo**: leer un Data Matrix impreso con la cámara y
  abrir la hoja de compartir en iOS/Android solo se probaron de forma indirecta.
- **Error #418 de React** (hidratación del export estático): se reprodujo en
  incógnito y en `/`; es cosmético y de nivel SDK, no de nuestra app.
- **El deep link devuelve 404** aunque renderiza: falta la Rewrite Rule en Render
  (no es algo que una prueba pueda arreglar).
- **Carrera de asignación de código** (`POST …/codigo` en paralelo): solo se
  puede ejercitar donde haya elementos **sin** código, y hoy no queda ninguno.
  La cubre el mismo mecanismo que la carrera de altas —el `1062` de
  `uq_codigo` traducido a `409`—, que sí corre en cada pasada; se probó a mano
  en la base local (1×201 y 1×409) antes de aceptar el cambio.
