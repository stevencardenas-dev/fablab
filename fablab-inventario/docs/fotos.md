# Fotos de los elementos

**0 fotos guardadas** (verificado el 2026-10-15). La prueba en vivo que puso la
misma foto en los 917 elementos se revirtió; la herramienta queda en el repo
para repetirla. Todo lo de abajo está verificado con esa prueba y con fotos de
cámara reales.

## Por qué la foto se reduce en el teléfono

La foto cruda de una cámara moderna pesa 1-2,5 MB. Con 917 elementos eso serían
**1-2 GB**, más que el disco entero del plan de Aiven (1 GB, con ~288 MB ya
usados por InnoDB/binlogs). Además, subirlas todas no termina en una jornada de
trabajo con la red del campus.

Medido con la foto de prueba de `scripts/demo-foto` (calibrada con `cwebp` para
pesar lo mismo que una de cámara ya optimizada), más el original real de
4000×3000 (3,4 MB) como referencia:

| Resultado | Peso | Total 917 |
|---|---|---|
| Original de cámara | 3,4 MB | ~3,1 GB |
| Reducida sin redimensionar (q0.6) | 599 KB | ~0,55 GB |
| 800 px WebP q0.6 + 200 px (antes) | 49,5 KB | ~44 MB |
| **1200 px WebP q0.7 + 200 px (ahora)** | **81,0 KB** | **~73 MB** |
| Peor caso con el tope de 400 KB | 400 KB | ~358 MB |

Decisión: **la foto se reduce en el dispositivo y el original nunca sale de
él**. Dos salidas por foto: una de 1200 px para la ficha/modal y una de 200 px
para las listas (chips).

## Por qué se subió de 800 px q0.6 a 1200 px q0.7

La ficha muestra la foto a ~550 px CSS: en un monitor retina eso son ~1100 px
reales, así que una de 800 px se pintaba **estirada**, y q0.6 le sumaba bloques
en las zonas planas (paredes, mesas) y en el texto. El ajuste nuevo pesa 1,6×
(medido con la foto de prueba: 49,5 → 81,0 KB por elemento) y se ve nítido. A
igual resolución, bajar de 0.75 a 0.7 ahorra 6 % y de 0.7 a 0.6 ahorra otro 10 %
a cambio de volver a ver bloques, así que 0.7 es el punto que se sostiene sin
artefactos. El tope de 400 KB no cambió y la escalera (0.7 → 0.55 → 0.42) sigue
garantizando que ninguna foto lo pase.

La miniatura se queda en 200 px (solo subió la calidad): es la que más se
descarga —todas las listas la piden— y a 2,3× la tarjeta ya se veía nítida, así
que llevarla a 256 px costaba +50 % en cada lista sin ganancia a la vista.

Las fotos que ya están guardadas con los ajustes anteriores **no se pueden
recomprimir** (el original nunca se guarda): hay que volver a subirlas.

## Pipeline en la app

Dos módulos, a propósito:

- **`src/lib/foto.ts` — puro y testeado** (`foto.test.ts`), todo lo que se puede
  calcular sin cámara ni sistema de archivos:
  - `LADO_FOTO = 1200`, `LADO_MINIATURA = 200`, `CALIDAD_FOTO = 0.7`,
    `ESCALONES_CALIDAD = [0.7, 0.55, 0.42]`.
  - `LIMITE_FOTO_BYTES = 400 KB` y `LIMITE_MINIATURA_BYTES = 80 KB` — los mismos
    que valida el servidor, repetidos para avisar **antes** de gastar la subida.
  - `dimensionesReducidas()` no deforma ni agranda (una foto de 320×240 se queda
    como está).
  - `bytesDeBase64()` mide el peso real sin decodificar; `primerosBytes()` y
    `mimeDeBase64()` leen la **firma de los bytes** (`RIFF..WEBP` / `FFD8FF`)
    sin `atob`/`Buffer`, que en el teléfono no siempre existen.
  - `siguienteCalidad()` baja de escalón cuando aún no cabe; `pesoLegible()`,
    `ahorroPorcentaje()` (topado en 99% para no mostrar "-100%", que parece que
    la foto se perdió) y `revisarPayload()` (motivo listo para UI).
- **`src/lib/foto-optimizar.ts` — el puente** (`expo-image-manipulator`):
  - `prepararFotoParaSubir({ uri, ancho, alto, pesoOriginalBytes })` mide la
    imagen (si no vienen dimensiones, decodifica una vez), renderiza los dos
    tamaños y guarda.
  - Guarda **WebP** y cae a **JPEG** si el dispositivo no sabe codificarlo
    (`saveAsync` lanza error; la caída es explícita, no silenciosa — pasa en
    Safari). El `mime` final lo deciden **los bytes**, no lo que se pidió: iOS
    puede devolver JPEG aunque se pida WebP.
  - Si la foto no cabe en 400 KB, reintenta en 0.55 → 0.42; si aún así no
    cabe, lanza error en español.
  - La miniatura nunca puede pesar más que la foto (el server lo rechaza): si el
    original ya era diminuto y ambos tamaños coinciden, la miniatura se guarda
    con más compresión (0.3 → 0.25) para seguir siendo menor.
  - Devuelve además `pesoBytes`, `pesoMiniaturaBytes`, `ahorro` y `resumen`
    (`"3.4 MB → 13 KB (-99%)"`), que la UI muestra al capturar.

El selector de imagen ya no comprime (`quality` fuera): la única compresión con
pérdida es la de nuestra reducción; comprimir dos veces solo acumulaba
artefactos.

## Contrato con el servidor

`POST /api/elementos/:id/foto` (ver [`api.md`](api.md)):

- Cuerpo: `{ mime, foto, miniatura, ancho, alto }` con foto y miniatura en
  base64 (sin el prefijo `data:`, que igual se tolera).
- `validarFoto()` (`importer/api.mjs`) es **pura** (sin base, la cubre el
  `self-check`): valida el `mime`, la **firma de los bytes**, los límites
  (foto ≤ 400 KB → `413`; miniatura ≤ 80 KB → `413`; miniatura < foto → `400`),
  y calcula `hash = sha1(foto).slice(0, 16)`.
- `guardarFoto()` verifica que el elemento exista (`404`), hace upsert en
  `elemento_fotos`, limpia la caché en RAM del elemento e invalida el caché TTL.

### Almacenamiento

`elemento_fotos` (1:1 con `elementos`, `ON DELETE CASCADE`): `foto` y
`miniatura` en `MEDIUMBLOB`, `hash CHAR(16)`, `bytes`, `ancho`, `alto`, `mime` y
`actualizado`.

## Entrega y caché

- **El listado nunca arrastra binarios**: `GET /api/elementos` trae
  `foto_hash` (LEFT JOIN) y nada más. La app arma la URL:
  `…/elementos/<id>/foto?tam=miniatura&v=<hash>`.
- **`?v=<hash>` es cache-buster.** Al reemplazar la foto cambia el hash y la URL:
  ni el navegador ni el service worker sirven la vieja. El mismo hash es el
  `ETag`, así que la revalidación es exacta, no por fecha.
- `binario()` en `server/index.mjs` responde `Cache-Control: private,
  max-age=31536000, immutable` + `ETag`, y **no** comprime (WebP/JPEG ya están
  comprimidos).
- **`304`/`HEAD` sin leer el blob**: `obtenerHashFoto()` consulta solo
  `mime, hash`. Antes, contestar "no cambió" traía el MEDIUMBLOB completo (p50
  629 ms medidos); ahora la decisión sale de la RAM.
- **Caché en RAM del server** (`importer/api.mjs`):
  - `hashesFoto`: `id → {mime, hash}` (barato, lo usan 304/HEAD);
  - LRU `blobFoto` de 100 entradas para los bytes (~2,5 MB): reabrir un modal
    reciente no vuelve a leer la base;
  - `precargarMiniaturas()` al arrancar sube **todas** las miniaturas
    (~917 × 6 KB ≈ 5 MB): pintar la sala CNC (171 chips) no hace ni una query.
  - Cualquier escritura/borrado de foto limpia las entradas de ese elemento
    (`cacheFotoLimpiarElemento`) y el TTL del listado.

## En la UI

- **Chips de la sala**: `expo-image` con la miniatura, `loading="lazy"` (solo
  se descargan las visibles: 39 de 171 en la primera pantalla de la sala CNC).
- **Modal/ficha**: la foto de 1200 px con la **miniatura como placeholder**
  (`placeholder`, `placeholderContentFit`, `transition={150}`,
  `cachePolicy="memory"`) — así no aparece un cuadrado vacío mientras carga.
- **Precarga al tocar el chip**: `Image.prefetch(url, 'memory-disk')` en
  `onPressIn` y `onHoverIn`; en web el prefetch es un `new Image(); img.src`. La
  descarga arranca antes de abrir el modal y el paso borroso→nítido casi no se ve.
- Tras subir o quitar una foto, `inventory.ts` hace **write-through** del
  `foto_hash` en la caché SWR: la sala y el buscador la ven sin re-descargar el
  inventario.

## Cómo probarlas sin fotos reales

`npm run fotos:demo` (`scripts/fotos-demo.mjs`) pone **la misma foto** en todos
los elementos que no tengan, para ver en la app desplegada cómo se comporta:

```bash
npm run fotos:demo                          # estado actual (solo lee)
npm run fotos:demo -- --medir               # latencia real de miniatura/foto/304
npm run fotos:demo -- --escribir --limite 5 # prueba corta
npm run fotos:demo -- --revertir            # deshace (último manifiesto)
```

- Los binarios viven en `scripts/demo-foto/` (`foto.webp` 75.506 B + miniatura
  7.398 B = ~81 KB, calibrados con `cwebp` para pesar **lo mismo que una foto de
  cámara ya optimizada**: con una imagen más liviana la medición saldría
  mejor que la realidad). No entran al bundle: `sync:deploy` solo copia `dist/`.
- Es reversible por diseño: escribe un **manifiesto** en
  `backups/fotos-demo-<fecha>.json` **antes** de subir con los ids exactos;
  `--revertir` borra esos ids y nada más. Nunca toca elementos que ya tuvieran
  foto (el binario viejo no se guarda; pisarlo no se puede deshacer).
- Corrida completa en producción (2026-09-24): **917/917 en 90 s** (4 en
  paralelo, ~28 MB). Revertida el mismo día: borradas 917, estado final
  **917 elementos · 0 con foto**, verificado con los endpoints (`404` en foto y
  miniatura, `404` al repetir el DELETE).

### Mediciones que dejó la prueba (producción)

| Medición | Antes de las cachés | Hoy |
|---|---|---|
| Miniatura 200 px (en serie) | p50 204 ms | en el piso de red (~140-250 ms) |
| Foto 800 px fría | p50 357 ms | con LRU, reabrir un modal reciente: +0 |
| Foto + revalidación por ETag | 629 ms | ~200 ms, y desde RAM ~0 |
| Primera carga de la PWA tras idle | ~0,43-0,47 s | igual: es despertar de CPU de Render, no la BD |

> Medido con los ajustes anteriores (800 px + 200 px). Los binarios de hoy pesan
> 1,6× más, así que las transferencias suben en esa proporción (el piso de red y
> las cachés no cambian): falta re-medir con `npm run fotos:demo -- --medir`.

Detalle y trampas de medición en [`rendimiento.md`](rendimiento.md).

## Cosas que muerden

- **`413`**: la foto no se redujo (se subió el original) o el límite cambió y el
  cliente no. El mensaje del server dice cuánto pesa.
- **`400` "Los bytes no son una imagen X"**: se mandó un `mime` que no
  corresponde a los bytes (típico al forzar WebP en un dispositivo que devuelve
  JPEG). Se resuelve dejando que `mimeDeBase64()` decida.
- **`400` "La miniatura no puede pesar más que la foto"**: miniatura mal generada
  o reutilizada de otra foto.
- **Las fotos exigen sesión**: el `<img>` no puede mandar header, así que el enlace
  lleva `?sesion=` y el server responde con `Cache-Control: private`. Sin sesión,
  `401`.
- **La caché del navegador puede enmascarar mejoras**: con la misma imagen en los
  917 elementos, todas las URLs de la prueba compartían hash (una sola entrada de
  caché). El beneficio del prefetch por elemento se verá con fotos reales, que
  tienen hash único.
