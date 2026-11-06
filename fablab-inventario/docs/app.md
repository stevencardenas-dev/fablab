# App (Expo / React Native / web)

Una sola base de código para Android, iOS y web. En web se exporta como sitio
estático y se instala como PWA (`https://fablab-web.onrender.com`).

- Entrada: `expo-router/entry` (`main` en `package.json`).
- Rutas por archivos (`src/app/`), con `typedRoutes` y `reactCompiler` activos
  (`app.json` → `expo.experiments`).
- Versión de referencia de las APIs: Expo SDK **57** (`docs.expo.dev/versions/v57.0.0`).

## Pantallas

| Ruta | Archivo | Qué hace |
|---|---|---|
| `/` | `src/app/(tabs)/index.tsx` | **Inicio**: cuenta con sesión y «Salir», toggle de tema, totales (elementos y salas), búsqueda siempre visible y tres fichas (Escanear, Agregar, Exportar) que abren su panel debajo |
| `/explore` | `src/app/(tabs)/explore.tsx` | **Inventario**: lista de salas con edificio y conteo; estados cargando / vacío / fallo con botón Reintentar |
| `/sala/[nombre]` | `src/app/sala/[nombre].tsx` | **Sala**: chips con miniatura de cada elemento y modal de detalle |
| layout raíz | `src/app/_layout.tsx` | Tema, splash animado, registro del service worker y `prewarmCache()` |

### Inicio (`index.tsx`)

- **Disposición**: desde 1000 px la barra de búsqueda pone el campo, el botón
  Buscar y «Limpiar» en la misma fila (el campo llena el ancho y los botones
  miden lo que su texto), las tres fichas van en fila y el formulario de alta
  pone los campos de a dos por fila; debajo de 1000 px todo se apila y los
  botones ocupan el ancho, que es lo que alcanza el pulgar. Cada ficha es un
  solo botón (icono, título, pista y chevron) con el borde del acento al pasar
  el cursor o mientras su panel está abierto.
- **Buscar**: búsqueda viva: busca sola 250 ms después de la última tecla, y
  también con el botón o con Enter. Trae «Limpiar» para vaciar, avisa
  «Buscando…» mientras resuelve y con el campo vacío no busca, en vez de decir
  "sin resultados" de algo que nadie escribió. Cada resultado ofrece **Ver
  ficha** (abre la ficha de ese elemento en su sala) y su etiqueta descargable.
  La barra vive fuera de los paneles: la consulta y sus resultados no se pierden
  al abrir Escanear, Agregar o Exportar.
- **Escanear**: `Scanner` (expo-camera) lee **solo Data Matrix**
  (`barcodeTypes: ['datamatrix']`). Al leer se apaga la cámara y se busca el
  código: **si existe, su sala se abre con la ficha ya desplegada** (mismo camino
  que **Ver ficha**) y al volver el panel ya está en la cámara para la siguiente
  etiqueta; si el código no existe se avisa en un recuadro acentuado con la
  tarjeta (código, sala, estado, serial, cantidad, observaciones, **Ver ficha** y
  la etiqueta) y queda «Escanear otro» para volver a la cámara. Mientras resuelve
  se muestra «Buscando el elemento…», y si la consulta falla (sin red) se explica
  el fallo en vez de afirmar que el código no existe.
- **Agregar**: formulario con los campos del inventario —de a dos por fila
  desde 1000 px— y **selector de sala**, ambos requeridos y rotulados
  «(obligatorio)» (chips; sin sala el server responde 400 y nada se guarda),
  generación automática de código (`generateCodigo()` → `FL-…`) y foto opcional.
  - La foto se **optimiza al capturarla** y se muestra el ahorro
    (`"3.4 MB → 13 KB (-99%) · 1200×900"`).
  - La foto se sube **después** del alta (necesita el `id`); el cartel de
    "Guardado" sale recién cuando no queda nada pendiente. Si la subida falla, el
    elemento igual quedó guardado y se avisa aparte.
  - En web, al guardar se **descarga sola** la etiqueta Data Matrix (el usuario
    acaba de crear el elemento y necesita imprimirla); en nativo solo el botón.
  - Un código duplicado devuelve **409** y el mensaje dice qué elemento lo tiene.
- **Buscar**: búsqueda multi-palabra sobre **todos los campos**, normalizando
  acentos y espacios; puntúa coincidencia exacta (100) > empieza con (50) >
  contiene (10) y ordena por relevancia. Cada resultado trae su etiqueta
  descargable y el botón "Imprimir etiquetas de los resultados (N)".
- **Exportar**: 4 botones (inventario/traslados × CSV/JSON). En web la descarga
  la hace la app y confirma «Listo: \<archivo\>» en el panel; en nativo abre la
  URL de export con `Linking.openURL`. El CSV viene con BOM y se abre directo en
  Excel.
- **Importar** (solo web): los botones de exportación incluyen "Importar inventario",
  que abre el selector de archivos del navegador (`.csv`, `.xlsx`, `.xls`, `.ods`);
  cada hoja del libro se trata como una sala y solo se crean los códigos nuevos, el
  resto se reporta. Requiere red (y servidor) y muestra el resumen legible o el error.

### Sala (`sala/[nombre].tsx`)

- Lista de chips: miniatura (`?tam=miniatura&v=<hash>`) + código + detalle.
- Llega desde la búsqueda de Inicio con `?elemento=<id>` (el botón «Ver ficha»):
  abre esa ficha una sola vez, para que al volver a la sala no se repita sola.
- **Filtro**: con más de 8 elementos aparece «Filtrar por nombre, código o
  serial», con la misma regla que la búsqueda de Inicio pero solo sobre los
  elementos de esta sala; el resumen pasa a "N de M elementos", hay «Limpiar» y
  un aviso acentuado cuando nada coincide.
- **Modal de detalle** con la foto grande (`?tam=foto`), botones para
  reemplazar/elegir/quitar foto, edición de campos (PUT solo de los tocados),
  traslado a otra sala (POST `/traslados`, con nota) e historial de movimientos.
- Elementos **sin código** muestran "Asignar código" (genera `FL-…`); en su lugar
  no ofrecen descargar etiqueta.
- Botón "Imprimir etiquetas de la sala (N)" para reetiquetar una sala completa.

## Datos: `src/lib/inventory.ts`

Es el único punto de contacto con la API desde la app.

- **Base de la API**: `EXPO_PUBLIC_API_URL` si está definida; si no, en web deriva
  del host actual (`192.168.0.2:8083` → `192.168.0.2:3001/api`) y en nativo cae a
  `http://localhost:3001/api`. El build desplegado **siempre** lleva la URL
  horneada (lo verifica `sync:deploy`).
- **Reintentos con backoff** (1 s, 2.5 s) **solo para GET** cuando la respuesta
  es `502/503/504` — el free tier de Render duerme y al despertar devuelve eso.
  Los POST/PUT/DELETE **no** reintentan: un traslado no es idempotente y un
  reintento duplicaría filas.
- **Caché stale-while-revalidate** en dos niveles: memoria y `AsyncStorage`
  (`fablab.cache.elementos.all`, `fablab.cache.salas`), frescura de **60 s**,
  deduplicación de peticiones en vuelo (`inflightAll`). Primera carga: red.
  Siguientes: instantáneo de memoria mientras refresca por detrás; sin red,
  devuelve lo último conocido. `prewarmCache()` calienta todo al abrir la app.
- **Write-through en cada escritura**: alta, edición, traslado (ajusta también
  los conteos de las dos salas), código y foto actualizan la caché local sin
  re-descargar todo el inventario.
- **Sin fallback local en escrituras**: si el server rechaza, la app muestra el
  error. Un elemento que solo existiera en `AsyncStorage` sería una ilusión de
  guardado (nada lo lee).
- **Sesión**: sin sesión la app solo muestra la pantalla de entrada
  (`src/components/pantalla-entrada.tsx`); `src/lib/sesion.ts` guarda el token de
  sesión (12 h) y `authHeaders()` lo manda como `Authorization: Bearer` en **todas**
  las peticiones. Un `401` cierra la sesión y vuelve a la entrada; *Salir* (arriba
  en Inicio) también vacía la caché del inventario guardada en el dispositivo.
  Las fotos y las descargas llevan `?sesion=` en el enlace.
- `EXPO_PUBLIC_API_TOKEN` ya **no** se usa en producción (quedaba legible en el
  bundle público); solo sirve para desarrollo local con el server en modo abierto.
- `urlFoto(elemento, tam)` devuelve `null` si el elemento no tiene foto — así la
  UI no pinta un `<Image>` roto.

## Data Matrix y etiquetas

- `src/lib/data-matrix-svg.ts` (**puro y testeado**) arma el SVG **en
  milímetros**: módulo de 0,5 mm, zona de silencio de 1 módulo, fondo blanco
  explícito y el código impreso debajo del símbolo. El texto es de 2 mm con
  `textLength` (ancho declarado, no el que tenga la fuente del sistema) y la
  **celda de la hoja se mide con el texto y con el símbolo**, el que sea más
  ancho: un `FL-…` de 15 caracteres pide ~18 mm, el doble que su símbolo, y con
  una celda de 9 mm el código se salía de la etiqueta, pisaba la celda vecina y
  podía caer fuera del margen de la impresora (lo encontró
  `npm run verify:impresion`). `planHojaEtiquetas()` decide
  la grilla (margen de 10 mm, celdas del tamaño de la etiqueta más grande, guía
  de corte punteada) contra el **papel elegido** —Carta 215,9 × 279,4, A4
  210 × 297, Oficio 215,9 × 330,2, medidas de norma para que el driver reconozca
  la hoja— y reparte las etiquetas en páginas: entran
  `columnas × filasPorPagina`, que en Carta son 16 × 18 y en A4 16 × 19 para
  códigos de 14 módulos. Tope: 300 etiquetas por hoja.
  - `paginasHojaEtiquetas()` devuelve **un SVG por página**, cada uno del tamaño
    del papel menos 1 mm (holgura que evita que el redondeo del navegador meta
    una página en blanco). Es lo que se imprime: un bloque que cabe en la hoja
    no se parte, así que la paginación cae **entre** etiquetas y no por encima
    de una.
  - `svgHojaEtiquetas()` devuelve la hoja **de una pieza** (crece hacia abajo):
    es el archivo para un visor o una cortadora.
- `src/lib/hoja-imprimible.ts` (**puro y testeado**) arma la pestaña de
  impresión: embebe las páginas de los tres papeles y una barra con
  "Imprimir / Guardar PDF", el **selector de papel** (por defecto **Carta**), el
  resumen de etiquetas y páginas, "Descargar SVG (una pieza)" y el recordatorio
  de imprimir al 100 %. Vive aparte del componente porque es una función pura de
  cadenas: así el archivo que se imprime se prueba sin montar la app. El default
  es Carta porque una hoja de Carta **entra en A4** (4 mm de margen de sobra),
  mientras que al revés se perdería la última fila: A4 es 17,6 mm más alto.
- `src/components/data-matrix.tsx` conecta eso con el sistema de archivos:
  - Web: `Blob` + `<a download>` → `datamatrix-<CODIGO>.svg`; las hojas abren la
    pestaña que **se imprime sola**, ya paginada y con el papel elegible ahí
    mismo (la app no puede saber qué papel tiene cargada la impresora). Si el
    navegador bloquea la pestaña, cae a descargar el SVG.
  - Nativo: `expo-file-system` escribe en cache y `expo-sharing` abre la hoja de
    compartir (un archivo SVG único para las hojas por lote).
  - La hoja por lote **avisa cuántos elementos saltea** por no tener código, en
    vez de imprimir menos en silencio.
- `scripts/verify-datamatrix.mjs` valida la estructura con un decodificador
  independiente (`datamatrix-decode`); su limitación (solo modo ASCII, no
  C40/EDIFACT) está documentada en [`qa.md`](qa.md).

## PWA y service worker

- `public/manifest.json`: nombre "FabLab UFPS", `display: standalone`, tema
  `#C8102E`, íconos, categorías.
- `public/sw.js`: cache-first para el **shell** (`/`, `/index.html`) y para los
  bundles que el navegador pida; **network-first para `/api/`** (si no hay red
  devuelve `503`, y la caché SWR de la app responde con lo último conocido).
- **Versión de caché**: `CACHE_NAME = 'fablab-v31'`. Al desplegar un bundle
  nuevo hay que **subir el número**, o los clientes con el SW viejo quedan con la
  UI vieja para siempre (el `activate` borra las cachés de nombres distintos).
- `src/components/service-worker.ts` registra el SW y ya no se pierde la primera
  visita: si el bundle se evalúa **después** del evento `load`, registra igual
  (chequea `document.readyState === 'complete'` en vez de esperar solo el evento).

## Tema y detalles de UI

- `src/hooks/use-theme.ts` (contexto de modo claro/oscuro) y
  `use-color-scheme.web.ts` con `useSyncExternalStore` (antes rompía el lint).
- `_layout.tsx` aplica el esquema a nivel nativo (`Appearance.setColorScheme`)
  para que el chrome del sistema acompañe; en web es no-op seguro.
- Componentes compartidos: `themed-text`, `themed-view`, `data-matrix`,
  `scanner`, `animated-icon` (splash), `app-tabs`, `external-link`,
  `ui/collapsible`. `_unused/` guarda sobrantes del template de Expo.

## Variables de entorno de la app

| Variable | Para qué |
|---|---|
| `EXPO_PUBLIC_API_URL` | URL de la API (horneada en el build). **Obligatoria** en el export web |
| `EXPO_PUBLIC_API_TOKEN` | Solo desarrollo local. **No definir en el build de producción**: quedaría en el bundle público |
| `EXPO_PUBLIC_TURNSTILE_SITEKEY` | (Opcional) Sitekey pública de Cloudflare Turnstile; se hornea en el bundle web (`EXPO_PUBLIC_*`). Vacío = login sin captcha en la app |

`eas.json` define los perfiles de build: `development` (dev client),
`preview` (APK interno con la URL de producción), `production`
(app-bundle / Release).

## Desarrollo

```bash
npm install
npx expo start                # a / i / w; QR para Expo Go
EXPO_PUBLIC_API_URL=http://192.168.0.2:3001/api npx expo start   # teléfono real
npx expo export --platform web --clear    # build estático para la PWA
npm test && npx tsc --noEmit && npm run lint
```

Desde un teléfono en la misma red, usa la **IP de tu PC** (no `localhost`) tanto
en `EXPO_PUBLIC_API_URL` como en la URL del server.
