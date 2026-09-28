# HANDOFF — Inventario FabLab / Seminario Integrador II

Última sesión: 2026-09-13 (sesión 2 — documento, APA, presentación)

## State

**Base de datos: hecha y verificada.** El inventario de Excel está migrado a
MySQL con esquema normalizado. 917 elementos, 11 salas, 2 edificios (FabLab y
ViveLab). Conteos verificados uno a uno contra las hojas de origen.

**Documento: capítulos 1-3 escritos y pasada de APA HECHA.** 15 páginas.
Portada APA, 12 referencias, 16 citas en texto, 5 tablas numeradas, cronograma
nuevo en §3.5. Entregables renombrados con la convención de los compañeros
(título en mayúsculas):

- `documento/SISTEMA DE CONTROL DE INVENTARIO DEL FABLAB UFPS.odt`
- `documento/SISTEMA DE CONTROL DE INVENTARIO DEL FABLAB UFPS.pdf`
- `documento/CRONOGRAMA SISTEMA DE CONTROL DE INVENTARIO DEL FABLAB UFPS.xlsx`
- `PRESENTACION SISTEMA DE CONTROL DE INVENTARIO DEL FABLAB UFPS.pdf` (10 slides)

**Presentación: hecha.** Deck HTML de 10 slides publicado como Artifact
(https://claude.ai/code/artifact/2fa1f722-bab6-411b-9e17-9d8497370abd, v3) y
exportado a PDF 16:9. Reemplaza el deck viejo de 10 slides, que **nunca se
mostró** y tenía dos errores: decía Spring Boot (no existe en el repo) y las
capturas estaban mal rotuladas.

**App: sin tocar.** Sigue leyendo AsyncStorage con 5 salas hardcodeadas. No lee
la base de datos. Este es el hueco para el "avance tangible".

7 commits sin pushear en `feature/inventario-scan`.

## Next

1. **Pushear.** `git push origin feature/inventario-scan` (7 commits).
2. **Conectar la app a la base.** Es lo único que falta para la demo. La API ya
   está lista y probada (`importer/api.mjs`); falta consumirla desde
   `src/lib/inventory.ts`, que hoy usa AsyncStorage con `Rooms` hardcodeado
   (5 salas, sin ViveLab; la base tiene 11 en 2 edificios).
3. **Completar 3 referencias que no se pudieron resolver.** Hay que sacar autor
   y año de la portada de cada documento; los repositorios no los exponen:
   - **UTeM** (*E-Inventory*): Academia.edu devuelve 403.
   - **UMSA** (Bolivia): no quedó localizador, no hay nada que consultar.
   - **IPN**: el enlace `tesis.ipn.mx/handle/123456789/20598` da **404**. Puede
     necesitar fuente de reemplazo.
   Mientras estén incompletas se citan como `(*Título*, s. f.)`, que es la forma
   APA 7 correcta para obra sin autor. Hay una nota en la lista de referencias
   que lo explica.
4. ~~Copiar `ref-custom.odt` al repo.~~ **HECHO.** Está en
   `documento/ref-custom.odt` y el rebuild se probó desde ahí. El fuente del
   deck también quedó en `documento/deck-presentacion/`.
5. **Decidir qué pasa con `schema.mjs`.** Quedaron dos generadores. Si el
   normalizado es el definitivo, el otro sobra y `importer/` adelgaza.

## Pointers

- `fablab-inventario/importer/normalizado.mjs:22` — `HOJAS`, el mapa hoja →
  edificio/sala. Es el único lugar donde se declara qué hoja del xlsx es qué
  sala; agregar una sala se hace acá.
- `fablab-inventario/importer/normalizado.mjs:30` — `DDL`, el esquema completo
  (edificios/salas/elementos/traslados).
- `fablab-inventario/importer/api.mjs` — lectura para el frontend:
  `listarSalas`, `listarElementos`, `registrarTraslado` (transaccional),
  `historialElemento`.
- `fablab-inventario/src/lib/inventory.ts:14` — `Rooms` hardcodeado. Punto de
  entrada para el paso 2.
- `fablab-inventario/importer/self-check.mjs` — 3 bloques de checks, corre sin
  MySQL: `node importer/self-check.mjs`.
- `documento/documento-integrador.md` — fuente del documento. El ODT se
  regenera, no se edita a mano.

## Comandos

```bash
# regenerar SQL desde el xlsx (el .sql no está en git, se regenera)
node importer/gen-normalizado.mjs "/home/alvaro/CNC 2026.xlsx" > inventario-normalizado.sql

# cargar
sudo mysql fablab_norm < inventario-normalizado.sql

# regenerar el ODT  — el --reference-doc es OBLIGATORIO
# sin él se pierden la portada APA y la sangría francesa de las referencias, sin error
cd documento && pandoc documento-integrador.md \
  --reference-doc=ref-custom.odt \
  -o "SISTEMA DE CONTROL DE INVENTARIO DEL FABLAB UFPS.odt"

# regenerar el PDF del documento
libreoffice --headless --convert-to pdf "SISTEMA DE CONTROL DE INVENTARIO DEL FABLAB UFPS.odt"

# regenerar el PDF de la presentación (necesita navegador Chromium; Firefox NO
# tiene --print-to-pdf). El print stylesheet del deck ya está listo.
brave-browser --headless --disable-gpu --no-sandbox --no-pdf-header-footer \
  --print-to-pdf=salida.pdf --virtual-time-budget=12000 file:///<ruta>/documento/deck-presentacion/index.html

# checks
node importer/self-check.mjs && node scripts/verify-datamatrix.mjs && npm test
```

## Ops / Producción (Aiven + Render)

- **Render CLI (logueado, workspace `masterk's workspace` =
  `tea-d887ivn7f7vs738m1f80`):** `fablab-api` = `srv-dajnh2p5efls739kjo3g`,
  `fablab-web` = `srv-dajo898ae00c73aoqtq0`. Útiles: `render logs -r
  <id> -f`, `render deploys list <id>`, `render restart <id>`. Los 503 que
  ve la PWA = cold start del free tier Y/O deploy en curso (un deploy
  reinicia el servicio; el 2026-09-17 hubo 3 en 20 min).
- **Token de API de Aiven:** vive SOLO en la máquina local, fuera del repo, en
  `~/.config/fablab/aiven-token` (chmod 600, ya guardado). Uso:
  `Authorization: aivenv1 $(cat ~/.config/fablab/aiven-token)` contra
  `https://api.aiven.io/v1/...`. Proyecto `fablab`, servicio MySQL
  `mysql-2eb5feb2` (host `mysql-2eb5feb2-fablab.k.aivencloud.com:27503`, db
  `defaultdb`). Si se rota el token en el panel de Aiven, actualizar ese archivo.
- **Ojo avnadmin:** confirmado (2026-09-18, env vars de Render): Render usa
  `avnadmin` con contraseña `AVNS...` que NO es la que la API de Aiven
  reporta. NO resetear esa contraseña sin coordinar: tira la API.
  Para operaciones de datos en producción usar la propia API de la app
  (`GET/PUT https://fablab-api-sr1q.onrender.com/api/elementos/:id`), que
  además preserva ediciones manuales.
- **API_TOKEN ACTIVO en producción (2026-09-18):** POST/PUT/DELETE exigen
  `Authorization: Bearer <token>`; GET sigue público. El token vive en
  `~/.config/fablab/api-token` (local, chmod 600) y en las env vars de
  Render de `srv-dajnh2p5efls739kjo3g`. Los scripts que escriben vía API
  (`fix:mojibake --api`, `backup:remoto`) lo toman de la env `API_TOKEN`.
  El bundle web lo lleva horneado como `EXPO_PUBLIC_API_TOKEN` (vía
  sync-deploy: exportar con esa env definida). Ojo: es un secreto en un
  bundle público — frena vandalismo casual, NO es seguridad real.
- **Deploy API y WEB sincronizados (2026-09-18):** API `a826aa9` (server con
  auth + dump reparado), web `4cf22bd` (bundle con token + reintentos + SW
  `fablab-v4` para forzar recarga de clientes viejos). El `--force-web` de
  ese día fue seguro: los 5 commits manuales del repo deploy ya vivían en
  el monorepo.
- **Mojibake (2026-09-17):** el dump/CSV tenían acentos dobles
  ("proyecciÃ³n") de un seed con charset de cliente equivocado, y la BD de
  producción heredó 24 filas dañadas. Reparado todo (dump, CSV, Docker local
  y producción vía API). Herramienta: `npm run fix:mojibake` (dry-run por
  defecto; `--files`, `--db [--sin-docker]`, `--api` para producción vía la
  API pública preservando ediciones, `--check`). `seed.mjs` ahora
  falla si detecta mojibake post-seed. **Pendiente:** el repo deploy
  `Masterkillerr/fablab-api` aún tiene el dump viejo dañado — correr
  `npm run sync:deploy -- --push api`.
- **Backup antes de operar producción (2026-09-17):**
  `npm run backup:remoto` descarga `export/{elementos,traslados}.json` a
  `backups/` con timestamp. Correrlo SIEMPRE antes de reparaciones o re-seeds
  remotos. (Esta sesión se reparó producción sin backup previo — salió bien
  por dry-run, pero no repetirlo.)
- **Escrituras con token (2026-09-17):** el server acepta `API_TOKEN` (env de
  Render): si está definido, POST/PUT/DELETE exigen `Authorization: Bearer
  <token>`; sin él, todo sigue abierto como antes. Al activarlo, los scripts
  que escriben vía API (`fix:mojibake --api`, `backup:remoto`) toman el mismo
  token de la env `API_TOKEN`. Lectura siempre pública.
- **Cliente (2026-09-17):** `inventory.ts` retry con backoff en GET para el cold start de Render (POST/PUT/DELETE no reintentan — traslados NO es
  idempotente) y `updateItem(id, campos)` que usa el PUT del server con merge
  optimista en cache. La UI aún no lo llama: conectar la pantalla de detalle
  cuando se haga el flujo de edición.
- **Flujo de edición en la UI + deploy web (2026-09-18):** el modal de detalle
  de sala ahora edita campos (PUT, solo los campos tocados), mueve de sala
  (POST /traslados, transaccional) y muestra el historial del elemento;
  `registrarTraslado` en `inventory.ts` hace write-through en la cache SWR
  (antes dejaba conteos viejos hasta 60 s). 30/30 tests, tsc limpio. Deploy:
  **api sin cambios** (a826aa9 sigue vigente, server/importer idénticos);
  **web** `4cf22bd..88ba2fb`. Ojo clave del deploy: el SW es cache-first sobre
  el shell Y los bundles JS, así que se subió `sw.js` con cache `fablab-v5`
  (si no, los clientes con v4 instalado habrían quedado con la UI vieja para
  siempre). Bundle verificado antes del push:  API URL + token horneados y los strings de la UI nueva presentes. Commits del
  monorepo con estos cambios siguen SIN pushear a `feature/inventario-scan`.
- **Polish (2026-09-23):** tres arreglos de fondo, aún sin pushear.
  (1) **"Agregar elemento" estaba roto:** el formulario guardaba la sala en el
  campo `inventario` y nunca mandaba `sala_id`, así que `POST /api/elementos`
  respondía 400 siempre y el error se lo tragaba un fallback local que escribía
  en AsyncStorage (nadie lee esa clave → parecía guardado y no existía). Ahora la
  sala es un selector propio (chips "SALA") y `addItem` manda `sala_id`.
  (2) **Escrituras honestas:** `addItem`/`removeItem` ya no tienen fallback local
  silencioso; propagan el error y la UI lo muestra (`removeItem` además revisa
  el estatus del DELETE, antes sacaba de la cache un 401 como si hubiera
  borrado). (3) **Errores de API con estatus real:** `importer/api.mjs` lanza
  `ErrorApi(message, status)`; el server responde 400/404/409 en vez de 500 para
  errores de cliente (incluido el update vacío). La pantalla Inventario ahora
  distingue cargando / vacío / fallo (con botón Reintentar). tsc y
  `expo export --platform web` limpios.
- **Restaurado "Exportar inventario" + botón de guardar invisible (2026-09-24):** el
  panel de exportación (inventario/traslados × CSV/JSON) vivía SOLO en un build
  manual del repo deploy (`8bb6dd0`) y un sync posterior lo borró; nunca estuvo
  en git del monorepo. Se reconstruyó desde el bundle viejo (`inventory.ts`
  `exportarUrl(tipo, formato)`, los 4 botones con `Linking.openURL`, su ícono y
  estilos). Además, el botón **"Guardar cambios" del modal estaba en
  rojo-sobre-rojo** (usaba `removeButtonLabel`, que es rojo, sobre fondo rojo)
  → texto invisible; ahora `saveButtonLabel` blanco. Verificado en el navegador
  contra la API de producción (panel visible, label `rgb(255,255,255)`).
  **SW subido a `fablab-v7`** porque el deploy de hoy (35870e0) ya publicó v6:
  reusar v6 no haría que los clientes recargaran el bundle nuevo.
- **Deploy web post-polish (2026-09-24):** `npm run sync:deploy` (preview, api +
  web) y luego `-- --push web`: **web `88ba2fb..35870e0`** (bundle nuevo
  `entry-802eb6…`, SW `fablab-v6` para que los clientes con v5 instalado tomen
  la UI nueva). Verificado antes del push: `onrender` + prefijo del token
  horneados y los strings nuevos presentes. **api NO se subió:** el preview
  mostró `importer/api.mjs` + `server/index.mjs` con los cambios de `ErrorApi`
  (400/404/409); quedó pendiente en ese momento y se subió después (ver
  "Deploy api" más abajo).
- **Redeploy web con export + fix del botón (2026-09-24):** `-- --push web` →
  web **`35870e0..ff00094`** (bundle `entry-840bcc…`, SW `fablab-v7`). Hosting
  live: **https://fablab-web.onrender.com** (static site Render
  `srv-dajo898ae00c73aoqtq0`, auto-deploy al push a `Masterkillerr/fablab-web`).
  Confirmado sirviendo: `sw.js` = v7, `index.html` → `entry-840bcc…`, y el
  bundle live trae "Exportar inventario" / "Guardar cambios" + la URL onrender.
  (Los bundles viejos hasheados siguen devolviendo 200 — el asset queda — pero
  `index.html` ya apunta al nuevo.)
- **Deploy api (2026-09-24):** `-- --push api` → api **`a826aa9..3bf7db4`**
  (solo `importer/api.mjs` + `server/index.mjs`, el `ErrorApi`). Verificado en
  producción: PUT con body vacío → **400**, PUT a id inexistente → **404**, GET
  de sala inexistente → **404**, traslado a la sala donde ya está → **409**,
  escritura sin token → **401** (sin cambios), GET sigue público (916
  elementos). Extra: un PUT con el MISMO valor devuelve **200** — antes el
  chequeo de `affectedRows` (que en MySQL cuenta filas *cambiadas*) lo habría
  tratado como elemento inexistente. API y web quedan alineados.
- **Fix CORS para escrituras con Authorization (2026-09-24):** el preflight
  OPTIONS solo permitía `Content-Type`, así que el navegador BLOQUEABA el
  POST/PUT/DELETE que llevan `Authorization` ("header 'authorization' is not
  allowed according to header 'Access-Control-Allow-Headers'"); crear un
  elemento moría con "NetworkError" aunque el token fuera válido. Ahora
  `CORS_ALLOW_HEADERS = 'Content-Type, Authorization'` (una constante, usada en
  el preflight y en `json()` de toda respuesta). api `3bf7db4..1608d79`.
  Verificado desde el ORIGEN real de la PWA: un PUT cross-origin con
  `Authorization` resuelve (401 por token inválido) en vez de ser bloqueado, y
  un POST+DELETE de prueba devolvió 201/200. Ojo: el bug era solo del server;
  el bundle web no necesitó rebuild.
- **`sync-deploy.mjs` ahora exporta con `--clear` (2026-09-24):** Metro
  reutilizaba bundles cacheados aunque cambiaran `EXPO_PUBLIC_API_URL`/`EXPO_PUBLIC_API_TOKEN`
  (los inlinea en el transform). El preview llegó a ABORTAR: el bundle salía sin
  la URL horneada porque un export manual previo, sin env, había quedado en
  cache. Con `--clear` el deploy nunca sube URL/token viejos.
- **Descarga del Data Matrix para reimprimir etiquetas (2026-09-25):** antes el
  Data Matrix solo se veía en pantalla; si la etiqueta física se perdía no había
  forma de reimprimirla. Ahora cualquier elemento de la app entrega su etiqueta
  como archivo. Piezas: `src/lib/data-matrix-svg.ts` (función pura que arma el
  SVG en MILÍMETROS — módulo 0.5 mm, zona de silencio de 1 módulo, fondo blanco
  explícito y el código impreso debajo —, testeada en
  `data-matrix-svg.test.ts` con matrices sintéticas), y en
  `src/components/data-matrix.tsx` `descargarDataMatrix()` + el botón
  `DataMatrixDownloadButton`. Web: Blob + `<a download>` →
  `datamatrix-<CODIGO>.svg`; nativo: `expo-file-system` (nuevas deps
  `expo-file-system` y `expo-sharing`) escribe en cache y abre la hoja de
  compartir. Al guardar un elemento **en web la descarga sale sola** (el usuario
  acaba de crear el elemento y necesita la etiqueta); en nativo solo el botón,
  porque abrir la hoja de compartir sin que la pidan interrumpe el flujo.
  Dónde está: panel de guardado, resultado del escaneo, cada tarjeta de
  búsqueda y el modal de detalle de sala (con previsualización). Ojo: el plugin
  `expo-sharing` que agrega `expo install` se quitó de `app.json` — es para
  RECIBIR compartidos (share extension) y aquí solo se comparte hacia afuera.
  Verificado: 45/45 tests, tsc y lint limpios, `expo export --platform web`
  limpio, y un E2E con Playwright (servidor estático del export + stub de API +
  Chromium interceptando el blob) que comprueba las 4 superficies: descarga
  automática al guardar, botón del panel, tarjeta de búsqueda y modal. Además se
  decodificó con `datamatrix-decode` un SVG generado para `FL-ABC1` leyendo los
  `<rect>` del archivo: la geometría (margen y ejes) está correcta. **SW subido
  a `fablab-v8`** para no dejar a los clientes con la UI vieja al desplegar.
  Sin device-test del camino nativo (hoja de compartir).
- **Hoja de etiquetas por lote (2026-09-25):** reponer etiquetas de a una no
  sirve para reetiquetar una sala completa. Dos botones nuevos, mismo mecanismo:
  **"Imprimir etiquetas de la sala (N)"** (arriba de la lista de elementos) y
  **"Imprimir etiquetas de los resultados (N)"** (panel de búsqueda). En web
  abren una pestaña A4 que **imprime sola** (con botones "Imprimir / Guardar
  PDF" y "Descargar SVG" en una barra que se oculta al imprimir); en nativo se
  comparte la hoja como un único archivo SVG. El acomodo es una función pura,
  `svgHojaEtiquetas` en `src/lib/data-matrix-svg.ts`: A4 vertical con 10 mm de
  margen, celda del tamaño de la etiqueta más grande (filas y columnas
  alineadas, código de cada elemento impreso bajo su símbolo, guía de corte de
  línea punteada), y si hay más etiquetas que las que entran la hoja **crece
  hacia abajo** en vez de recortarlas (el navegador pagina al imprimir).
  `descargarHojaEtiquetas()` en `src/components/data-matrix.tsx` arma el SVG y
  la página; tope de 300 etiquetas por hoja (arriba de eso, imprimir por sala o
  por búsqueda: el mensaje lo dice). Si el navegador bloquea la pestaña nueva,
  cae a la descarga del SVG. Verificado: 54/54 tests (geometría de la grilla —
  sin solapes, todo dentro del área imprimible, crece cuando hace falta), tsc y
  lint limpios, y un E2E con Playwright sobre el export web: la hoja de la sala
  sale con las 30 etiquetas, 2293 rects, 0 solapes, dentro del ancho de página,
  abre el diálogo de impresión, y la de búsqueda nombra el archivo con el
  término buscado. Además se decodificaron con `datamatrix-decode` las
  etiquetas de una hoja (`FL1`, `12`, `FL-ABC1`): la escala y el desplazamiento
  de cada etiqueta dejan el símbolo legible.
- **Deploy web con etiquetas imprimibles (2026-09-25):** `EXPO_PUBLIC_API_TOKEN=...
  npm run sync:deploy -- --push web` → web **`ff00094..50b4902`**
  (bundle `entry-7dccad41…`, SW `fablab-v8`). **api sin cambios:** el preview
  dio "sin cambios", `server/` + `importer/` + `ddl-data.sql` ya eran `1608d79`.
  Verificado en producción: `sw.js` = v8, `index.html` → `entry-7dccad41…`, el
  bundle live trae "Imprimir etiquetas de la sala" / "…de los resultados" /
  "Descargar para imprimir" + la URL onrender + el token de escritura
  horneados, y la API responde (916 elementos). Ojo: un deep link como
  `/sala/1` responde **404 con el shell** (Render sirve `404.html`, que es copia
  de `index.html`; el router resuelve la ruta en el cliente) — es el
  comportamiento de siempre, no un síntoma del deploy. Los commits del monorepo
  con todo esto siguen **SIN pushear** a `feature/inventario-scan`.
- **Códigos para los elementos que no tenían (2026-09-25):** el cliente espera
  que TODO elemento tenga Data Matrix, y 35 importados de la hoja (ids 1–29 y
  166–171, materiales de CNC: foami, láminas, desechos) venían con `codigo`
  NULL → sin código no hay símbolo que imprimir ni forma de escanearlos.
  `codigo` **no es editable** por diseño (es el identificador impreso), así que
  se agregó una vía explícita: `POST /api/elementos/:id/codigo` (con token,
  `asignarCodigo` en `importer/api.mjs`), que **solo rellena vacíos** — 409 si
  el elemento ya tiene código, 409 si el código está en uso, 400 si el formato
  no es `A-Z0-9-` (2–20). En la UI, la ficha de un elemento sin código muestra
  "Asignar código" (genera uno tipo `FL-…`, igual que el alta) y en su lugar
  no ofrece descargar etiqueta; la hoja por lote ahora **avisa cuántos
  elementos saltea** por no tener código en vez de imprimir menos en silencio.
  Migración: `scripts/asignar-codigos.mjs` (dry-run por defecto; `--api` para
  producción, `--db` para MySQL directo, `--sql` imprime los UPDATE). Continúa
  la numeración de cada sala tomando el prefijo que domina en ella: los 35
  quedaron como **CNC-137…CNC-171**. Corrido en producción: 917 elementos,
  **0 sin código**, sin duplicados nuevos (el `IOT-79`×2 heredado sigue ahí:
  `codigo` no tiene índice UNIQUE en el esquema, y renombrar uno de los dos es
  decisión del cliente). Verificado: self-check (`asignarCodigo` sin MySQL),
  56/56 tests, tsc y lint limpios; endpoint probado contra MySQL local con
  401/400/409/404/201 y CORS, migración probada en local por las dos vías
  (API y BD) y luego en producción con backup previo
  (`backups/elementos-2026-09-24-02-47.json`), y un  E2E en el navegador que
  cubre el botón, el aviso de omitidos y la hoja después de asignar. Deploy:
  **api `1608d79..db6c29b`**, **web `50b4902..5f5e03f`** (SW `fablab-v9`).
- **Fotos de los elementos, optimizadas en el teléfono (2026-09-25):** el
  formulario tomaba foto desde el principio pero **la descartaba en silencio**
  (guardaba la URI local en el campo `foto`, que no existe en la base). El
  obstáculo real no era subirlas sino que no caben: una foto de cámara son
  1-2,5 MB y hay ~917 elementos → 1-2 GB, más que el disco entero del plan de
  Aiven (1024 MB, ~288 MB ya usados por InnoDB/binlogs). Medido con una foto
  sintética de 4000×3000: 599 KB a q0.6 **sin** reducir (917 × 599 KB = 0,55 GB),
  contra 800 px WebP q0.6 ≈ 22-26 KB + 200 px ≈ 5-6 KB = ~31 KB por elemento
  (~29 MB para los 917). Decisión: **la foto se reduce en el dispositivo y el
  original nunca sale del teléfono**. Dos tamaños por foto: 800 px para la
  ficha y 200 px para las listas.
  Piezas: `src/lib/foto.ts` (puro y testeado: dimensiones que no deforman ni
  agrandan, peso legible, medir base64 sin decodificarlo, firma de bytes, tope
  del ahorro en 99% para no mostrar "-100%", escalones de calidad y límites
  duplicados del server) → `src/lib/foto-optimizar.ts`
  (`prepararFotoParaSubir`: `expo-image-manipulator` para reducir y codificar
  WebP, con caída a **JPEG** donde no haya codificador WebP — Safari — y
  bajando de calidad 0,6 → 0,45 → 0,32 si aún no cabe en el límite; el `mime`
  final lo deciden los BYTES, no lo que se pidió, porque iOS puede devolver
  JPEG aunque se pida WebP) → `subirFoto`/`eliminarFoto`/`urlFoto` en
  `src/lib/inventory.ts` (write-through del `foto_hash` en la cache SWR).
  Esquema: tabla **`elemento_fotos`** (1:1 con `elementos`, `ON DELETE
  CASCADE`, `foto`/`miniatura` MEDIUMBLOB + `hash` = sha1 corto).
  `GET /api/elementos` trae solo `foto_hash` (con LEFT JOIN): el listado sigue
  pesando **173 KB** para 916 elementos — si arrastrara las fotos serían
  decenas de MB en cada carga. La app arma la URL con ese hash como versión y
  pide la imagen cuando la muestra; los binarios van por
  `GET|HEAD /api/elementos/:id/foto[?tam=miniatura]`, con `Cache-Control:
  immutable` + ETag y **304** si `If-None-Match` coincide (`binario()` en
  `server/index.mjs`, que no pasa por `json()`: nada de gzip, WebP ya está
  comprimido). `POST` (con token) valida la firma de los bytes y los límites
  —foto ≤ 400 KB, miniatura ≤ 80 KB, miniatura < foto— con 400/413 y mensaje
  que dice cuánto pesa; `DELETE` la quita. El guard `escribeAutorizado` ahora
  trata **HEAD como lectura** (un HEAD es un GET sin cuerpo: exigirle token
  rompía la revalidación). Migración de esquema:
  `scripts/migrar-esquema.mjs` (idempotente, `--check`, `npm run
  migrar:esquema`) — **aplicada y re-aplicada en la base local (13306),
  PENDIENTE en Aiven**.
  En la UI: al capturar se optimiza de una y se muestra el ahorro
  ("3.4 MB → 13 KB (-99%) · 800×600"); en el alta la foto se sube DESPUÉS del
  POST (necesita el id) y el cartel de "Guardado" sale recién cuando no queda
  nada pendiente (si aparece antes, el botón dice "Guardando…" debajo del
  éxito); si la subida falla el elemento igual queda guardado y se avisa
  aparte. En la ficha de la sala: miniatura en la lista, foto grande en el
  modal y botones Reemplazar / Galería / Quitar foto. El selector ya no
  comprime (`quality` fuera): la única compresión con pérdida la hace nuestra
  reducción, comprimir dos veces solo acumulaba artefactos.
  Verificado: **98/98 tests** (34 de `foto.test.ts`, +9 de `inventory.test.ts`:
  `urlFoto` devuelve null sin foto para no pintar un `<Image>` roto y cambia de
  URL al cambiar el hash), tsc y lint limpios (sigue el único error heredado de
  `use-color-scheme.web.ts`), `expo export --platform web` limpio, y contra
  MySQL local por los dos caminos: API (26 casos —401 sin token, 400 id
  inválido/mime no soportado/firma mentirosa/miniatura más pesada, 413 foto de
  500 KB y miniatura de 100 KB, 404 sin foto y elemento inexistente, 201, 304
  con GET y con HEAD, ETag viejo que NO da 304 tras reemplazar, CASCADE al
  borrar el elemento) y **E2E con Playwright sobre el export real** (servidor
  estático + la API local, eligiendo un JPEG de 4000×3000 por el `<input
  type=file>` de `expo-image-picker`): 3,4 MB → **12,9 KB de foto + 2,9 KB de
  miniatura = 15,8 KB (99,6% menos)**, convertida en 700 ms, y el navegador
  pide `tam=miniatura` (200×150) al pintar la lista y `tam=foto` (800×600) al
  abrir la ficha, sin errores de consola. Casos borde probados igual: foto de
  320×240 (no se agranda) y de 150×100 (foto y miniatura salen del mismo
  tamaño → la miniatura se guarda con más compresión para seguir siendo menor,
  como exige el server).
  **HECHO (2026-09-24):** api `db6c29b..4a24f08` y web `5f5e03f..79dafb9` (SW
  `fablab-v10`). La tabla `elemento_fotos` se creó en Aiven **desde el propio
  server**: no hay credenciales de esa base fuera de Render (la contraseña que
  reporta la API de Aiven da `ER_ACCESS_DENIED` y el HANDOFF prohíbe resetearla),
  así que `server/index.mjs` llama a `asegurarEsquemaFotos()` antes de escuchar
  y el DDL idempotente vive en `importer/api.mjs` (`DDL_FOTOS`, el mismo que usa
  `migrar-esquema.mjs`). Si aun así el `LEFT JOIN` falla (permisos), el listado
  degrada a "sin fotos" con un aviso en el log en vez de tumbar la app.
- **Prueba en vivo: la misma foto en los 917 elementos (2026-09-24).** Para ver
  en la app desplegada cómo se comporta el inventario con fotos en TODOS los
  elementos (y cuánto pesa de verdad), `scripts/fotos-demo.mjs` (`npm run
  fotos:demo`) pone una foto de demo —el PNG que pasó el usuario, optimizado con
  `cwebp` a 800 px q82 (25,6 KB) + 200 px q95 (5,4 KB) = 31 KB, **el mismo peso
  medido con fotos reales de cámara**, para que la prueba no salga más optimista
  que la realidad— en cada elemento que NO tenga foto. Los binarios viven en
  `scripts/demo-foto/` (no entran al bundle: `sync:deploy` sólo copia `dist/`).
  Corrido en producción: **917/917 en 90 s** (~28 MB, 4 en paralelo), deja
  manifiesto en `backups/fotos-demo-*.json` con los ids tocados.
  **Cómo se deshace:** `npm run fotos:demo -- --revertir` (borra sólo los ids
  del manifiesto; los elementos que ya tenían foto nunca se tocan, por eso sigue
  siendo reversible: el binario viejo no se guarda). Estado esperado después de
  revertir: 917 elementos, 0 con foto.
  **Qué se midió (producción, 24 elementos):** miniatura 200 px en serie p50 204
  ms; foto 800 px p50 357 ms; foto + revalidación por ETag 629 ms. Abrir la sala
  más grande (CNC, 171 elementos) pide hasta 171 miniaturas: en Node con
  concurrencia ilimitada tardan 5,3 s en total, pero **en el navegador sólo se
  descargan las visibles** (expo-image pone `loading="lazy"`: 39 de 171 en la
  primera pantalla, última a los 1,7 s) y el resto se pide al hacer scroll. El
  listado completo (917, con `foto_hash`) sigue en **186 KB**.
  Ojo al mirar la consola de la PWA: el 404 del documento al abrir un deep link
  (`/sala/1`) es el comportamiento de siempre (Render sirve `404.html`), no un
  síntoma de las fotos.

- **Polishing + QA intensivo (2026-09-24, sesión completa).** Trigger: el usuario
  notó que la foto del modal tarda en aparecer con todos los elementos con foto.
  Diagnóstico y fixes:
  - **Server: 304/HEAD ya no leen el blob.** `obtenerFoto()` traía el MEDIUMBLOB
    entero para contestar "no cambió". Ahora hay `obtenerHashFoto()` (sólo
    `mime, hash`) y `server/index.mjs` decide 304/HEAD con eso; el GET sin
    `If-None-Match` no paga la query extra. Medido en producción: revalidación
    629 ms → **~200 ms total** (el piso de red de Render es ~250 ms; la parte de
    BD bajó a ~60-70 ms).
  - **App: el modal abre con la miniatura, no con un cuadrado vacío.** La foto
    grande del modal usa `placeholder={miniatura}` + `transition={150}` +
    `cachePolicy="memory"` de expo-image (57.0.5: literales `'memory'`, no hay
    export `memoryCachePolicy`). Las miniaturas de los chips también van en
    memoria para que el placeholder no re-pida nada. En el navegador medido:
    repetir modal sirve la foto en **3 ms** (misma URL ya cacheada, `immutable`).
  - **Segundo reporte del usuario: "primero se ve borrosa y luego nítida".** Es la
    ventana entre placeholder (miniatura 200 px) y la llegada de la foto 800 px
    (descarga fría medida: 866 ms). Fix: **precarga en el chip** con
    `Image.prefetch(url, 'memory-disk')` atado a `onPressIn` (dispara ~100-300 ms
    antes que `onPress`; en nativo es el gesto completo, en web al `pointerdown`)
    y `onHoverIn` (web). Así la descarga arranca antes de abrir el modal y el
    fundido borroso→nítido casi no se ve. En web `prefetch` es un
    `new Image(); img.src` (calienta la caché HTTP); en nativo va al cache
    `memory-disk`. Deploy web `f24aba7..172d707`, bundle `entry-faecb15…`.
  - **SW `fablab-v11`** (nuevo bundle en cache). Además se arregló la carrera de
    registro: si el bundle evalúa después del evento `load`, el listener de
    `service-worker.ts` nunca disparaba y **el SW quedaba sin registrar en la
    primera visita** (verificado: perfil fresco → `getRegistration()` null).
    Ahora registra en cuanto `document.readyState === 'complete'`.
  - **QA automatizado: `npm run qa`** (`scripts/qa-intensivo.mjs`, 54 checks:
    lecturas, contrato HTTP de fotos con ETag=sha1 verificado, escrituras sobre
    elementos temporales `QA-INT-*` que se borran solos, casos borde, export
    CSV/JSON con BOM). Verde en producción y local. `--base` apunta a otro
    server; limpia restos de corridas anteriores.
  - **3 bugs reales encontrados y arreglados (todo app-level, sin ALTER TABLE):**
    (1) alta con `codigo` duplicado se aceptaba 201 → ahora **409** con el id del
    dueño (la columna no tiene índice UNIQUE: por eso existe IOT-79);
    (2) **DELETE de elemento con traslados → 500** (FK de `traslados` sin
    CASCADE): `eliminarElemento` ahora borra traslados+elemento en transacción;
    (3) alta/traslado con **sala inexistente → 500** de FK → ahora 404 claro.
  - **Issues conocidos caracterizados (no arreglados todos):** el error React
    **#418 reproduce también en incógnito y en `/`** → no es extensión ni el
    fallback 404: es hidratación del export estático de Expo (SDK-level,
    cosmético). El deep link `/sala/1` **renderiza bien** pero con status 404:
    el fix correcto es una **Rewrite Rule en el Dashboard de Render**
    (`/*` → `/index.html`, acción Rewrite — los archivos reales ganan; no se
    puede desde `_redirects`, Render no lo soporta). **IOT-79** es el único
    duplicado (ids 246 y 247, sala 2: "Silla madera marron IOT-12" vs "Mesa de
    trabajo 1.50x2.40 M-01"): decidir cuál elemento conserva el código — el
    server ya bloquea duplicados nuevos con 409.
  - **Deploys:** api `edb4b31..0905129` (409 + DELETE con traslados) y
    `0905129..222d0ad` (validación de sala); web `79dafb9..df81f2f` (perf modal
    + SW v11) y `df81f2f..3f94fb0` (registro SW); bundle final `entry-82a8a4…`
    + fix de lint de `use-color-scheme.web.ts` (useSyncExternalStore; `npm run
    lint` sale limpio por primera vez).

- **Optimización de overhead de BD (2026-09-24, "imperativo").** Objetivo: que
  la base de Aiven (WAN+TLS) deje de aportar tiempo medible. Cuatro palancas,
  todo app-level, api `222d0ad..867a949`:
  1. **Pool tibio.** El default de mysql2 podaba conexiones libres a los 60 s
     (`idleTimeout`), así que con tráfico espaciado casi cada request pagaba
     handshake TLS contra Aiven. Ahora `maxIdle=connectionLimit=5` +
     `idleTimeout=8 min` + `enableKeepAlive`.
  2. **Caché de fotos en RAM.** `precargarMiniaturas()` al arranque sube las
     miniaturas de TODOS los elementos (~917 × 6 KB ≈ 5 MB): pintar la sala CNC
     (171 chips) no hace ninguna query. Fotos grandes en LRU de 100 (~2,5 MB):
     reabrir un modal reciente no re-paga el blob. Índice de hashes
     (`hashesFoto`) para 304/HEAD sin BD. Toda escritura/borrado de fotos limpia
     las entradas del elemento; la coherencia con el cliente no depende de esta
     caché (cada URL lleva el hash como cache-buster).
  3. **Índice `elementos(codigo)` (NO único).** El check de duplicado del alta,
     el DELETE por código y la búsqueda escaneaban la tabla; el índice lo arregla
     sin tocar el duplicado heredado IOT-79. Se asegura en el arranque
     (`asegurarIndiceCodigo`, idempotente, errno 1061 ignorada).
  4. **304/HEAD por hash** (ya hecho antes en la sesión, ahora sale de RAM).
  **Medido en producción (ping local → Render):** miniatura/304/foto en estado
  estable **~240-260 ms total = puro piso de red** (delta vs `/health` ≈ 0-15 ms:
  la BD aporta ~0). Antes: 320 ms estables con ~60-70 ms de query, y 640 ms el
  primer hit tras una pausa (reconexión TLS). Ahora el primer hit tras 70 s idle
  cuesta 0,43-0,47 s **también en `/health`, que no toca la BD** → es despertar
  de CPU del free tier de Render, no MySQL. El listado 917 elems sigue
  186 KB/~320 ms (cache TTL 60 s encima). QA 54/54 en producción tras el deploy.

- **Verificación "todas las operaciones rápidas" (2026-09-24/25).** Nuevo
  `scripts/benchmark.mjs` (falta meterlo a package.json si se quiere: `node
  scripts/benchmark.mjs [--base ...] [--n 8]`): mide TODAS las ops con
  calentamiento + 8 muestras y las compara contra el piso de red (`/health`, que
  no toca BD). Dos caches más que salieron de este barrido, deploys
  `867a949..4efb56f` y `4efb56f..5e67754`:
  - **Cache TTL por sala** (`listarElementos`): abrir una sala pedía 2 queries
    sin cache (~+140 ms); era la pantalla más usada.
  - **Cache TTL del historial**: el modal lo pide en CADA apertura (+67 ms por
    abrir cualquier elemento). Las escrituras ya invalidaban todo el cache, así
    que el traslado nuevo se ve al instante.
  **Resultado final (p50, delta contra piso de red ~140 ms):** TODAS las
  lecturas en el piso — salas +2, sala CNC -4, historial -3, miniatura +0, foto
  grande (LRU) -1, 304 -2, listado 917 +78 (cuando expira el TTL de 60 s paga
  una query; las 7 muestras restantes en el piso). Escrituras: dominadas por sus
  round-trips WAN inherentes — PUT +141 (1 query), 409 dup +66 (1 query, índice),
  DELETE foto +70, DELETE elemento +61 (transacción de 3), traslado +200 (4
  consultas transaccionales), foto 25,6 KB +223 (validación + upsert + 60 KB).
  Export: JSON +76, traslados +67, CSV 917 filas +141 (sin gzip: se genera y
  baja crudo). Notas de medición: `curl` SIN `--compressed` mide ~120 ms de
  transferencia de más (140 KB vs 776 B) — siempre medir con gzip como la app;
  y HEAD marca ~+105 ms sobre 304 aunque ambos salen de RAM (raro del proxy de
  Render; la app nunca usa HEAD). Lo único que queda por encima del piso son
  escrituras reales y el arranque en frío del free tier de Render.


- **Foto de demo revertida + documentación completa (2026-09-24).**
  (1) **Revertida la prueba en vivo:** `npm run fotos:demo -- --revertir` borró
  **917 fotos** (borradas: 917 · ya no tenían: 0) y dejó la producción en
  **917 elementos · 0 con foto**, verificado por fuera del script (`GET
  /api/elementos` con 0 `foto_hash`; `404` en foto, miniatura y en el DELETE
  repetido de ids 1, 250, 500, 750 y 917). El manifiesto
  `backups/fotos-demo-2026-09-24-04-14.json` queda como evidencia y la
  herramienta (`scripts/fotos-demo.mjs` + `scripts/demo-foto/`) se queda en el
  repo, documentada como prueba en vivo reversible.
  (2) **Documentación completa nueva en `fablab-inventario/docs/`** (11
  documentos + índice, ~1750 líneas): `README` (índice y mapa), `arquitectura`,
  `api` (las 14 rutas con auth, CORS, gzip, ETag/304 y códigos),
  `base-de-datos` (DDL, índices, migraciones, respaldos), `fotos` (pipeline
  dispositivo→BD→cliente), `app` (pantallas, caché SWR, Data Matrix/PWA),
  `importacion`, `operacion` (deploy, credenciales, rollback, checklist),
  `rendimiento` (tabla del benchmark + trampas de medición), `qa` y
  `problemas-conocidos` (IOT-79, #418, deep link 404, free tier…). Los dos README
  (monorepo y app) enlazan a `docs/` y se corrigieron los conteos viejos
  (916 → **917** elementos, 56 → **99** tests). Nuevo script `npm run bench`
  (`scripts/benchmark.mjs`), que era el pendiente de package.json.
  Verificado: 99/99 tests, `self-check` 4 bloques OK, `tsc` y `lint` limpios, y
  los **60 enlaces relativos** de los READMEs + docs resuelven a archivos reales.

- **Endurecimiento del borde HTTP + automatización (2026-09-24/25).** Pedido del
  usuario: "¿estamos siguiendo buenas prácticas? un ingeniero va a juzgar esto".
  Auditoría con sondas reales contra producción (todas no destructivas) y
  arreglo de lo encontrado. **Hallazgos confirmados con evidencia:**
  (1) `POST /elementos` con JSON roto → **500** (`{"sala_id": `);
  (2) un cuerpo de **2 MB se bufferizaba entero y se parseaba** (no había tope);
  (3) `GET /elementos/1.5/historial` → **200 `[]`** (id imposible tratado como
  elemento sin traslados) y `/salas/1.5/elementos` → 404 en vez de 400;
  (4) el chequeo de código duplicado era `SELECT`→`INSERT` sin lock (TOCTOU);
  (5) `DELETE /api/elementos/:codigo` hacía `SELECT` **sin LIMIT**: con el
  duplicado `IOT-79` borraba el que devolviera la base primero;
  (6) **`npm run qa` reventaba con `TypeError`** en una base sin fotos — que es
  el estado actual de producción: el QA "verde" solo aplicaba con fotos.
  **Arreglos:** `readBody` rechaza JSON roto con **400** y aplica un **tope de
  1 MB** (por `Content-Length` y por chunked, sin acumular; `413`); ids de ruta
  con `idEntero()` (entero 1…2147483647 → si no, `400`); historial responde
  **404** si el elemento no existe (la consulta extra solo se paga cuando el
  historial está vacío, así el camino caliente sigue con una query);
  **lock con nombre de MySQL** (`GET_LOCK('fablab:codigo-unico')`) alrededor del
  chequeo + escritura en alta y asignación de código; `idUnicoParaCodigo()`
  responde **409** y no borra nada ante un código ambiguo. Verificado en local:
    5 altas simultáneas del mismo código → **1×201 y 4×409** (lock liberado
    después de los rechazos: las escrituras siguientes siguen en 201/200),
    cuerpo chunked de 2 MB → 413, borrado ambiguo → 409 con **0 filas borradas**,
    historial 999999 → 404 y 1.5 → 400, 0 residuos QA en la base local.
  **Automatización y proceso:** CI nuevo en `.github/workflows/ci.yml` (push y
  PR: `npm ci`, tsc, lint, tests, self-check, datamatrix, docs) y script
  equivalente `npm run gate`; `npm run docs:check` (enlaces de docs/README,
  rutas de `docs/api.md` vs. `server/index.mjs`, `node --check` de los 19 .mjs
  de server/importer/scripts) — que ya encontró dos drifts reales y por eso el
  log de arranque del server ahora anuncia también `/health`; `engines: node >=20`;
  `npm run bench` en package.json; y `sync:deploy` estampa el commit del monorepo
  en el mensaje de commit de los repos de deploy (`fablab@hash`, con `+dirty` si
  el árbol no está limpio) para poder responder qué código está desplegado.
  QA pasó de **54 a 69 checks** y ya no depende de que existan fotos reales.
  Verificado: `npm run gate` 5/5 + 99 tests + tsc/lint limpios, y `npm run qa`
  contra el server local **69 OK · 0 fallos**.

- **Deploy del endurecimiento + verificación en producción (2026-09-25).** El
  trabajo se contó en 4 commits temáticos (`c84fcea` fotos+API, `bf78e59`
  harness, `488aed0` docs, `e2adb07` CI/trazabilidad) y se desplegó **solo la
  api**: `sync:deploy --push api` → **api `5e67754..143bdbb`**. El mensaje salió
  con `+dirty` por un falso positivo del chequeo nuevo (el único cambio era
  `.freebuff/` sin trackear): arreglado en `43761fc`, que ahora mira solo las
  rutas que alimentan cada artefacto (`server/`, `importer/` y el dump para la
  api; todo el proyecto para el web) — el artefacto desplegado **sí** corresponde
  a `e2adb07`. Verificado en producción, propagado en menos de un minuto:
  JSON roto → **400**, `/elementos/1.5/historial` → **400**, `/elementos/999999/historial`
  → **404**, `/salas/1.5/elementos` → **400**, escritura sin token → **401**;
  `npm run qa` → **61 OK · 0 fallos** (61 con la base sin fotos: la sección B se
  salta con aviso y el contrato de fotos se prueba sobre la foto temporal del QA;
  con fotos reales son 69); y sigue **917 elementos · 0 fotos · 0 residuos QA**.
- **El benchmark medía un 404 y decía otra cosa (2026-09-25).** `benchmark.mjs`
  leía la foto del «elemento 1», que tenía foto solo durante la prueba de demo:
  con la base sin fotos, esos `GET foto` medían una consulta + 404 y los números
  salían planos (+69) sin significar lo mismo que antes. Ahora el benchmark
  **se autoabastece** (crea su elemento temporal, le sube foto, mide y borra) y
  suma la op que faltaba: **POST alta con código nuevo**. Corrida nueva en
  producción (p50, delta contra piso de ~135 ms): lecturas en el piso (salas −2,
  sala CNC +14, historial +2, miniatura +9, foto grande +2, 304 +1, listado +8 de
  media con +80 en la muestra que expira TTL); escrituras PUT +139, traslado
  +200, foto +226, DELETE foto +68, DELETE elemento +72, **alta +337** (los ~+135
  sobre el alta anterior son el lock de código), HEAD +113 (artefacto del proxy).
- **`IOT-79` resuelto y `codigo` ahora es `UNIQUE` (2026-09-25).** El duplicado
  heredado del Excel (*silla madera marrón IOT-12*, id 246, y *mesa de trabajo
  1.50×2.40 M-01*, id 247, ambos sala 2) tenía bloqueada la unicidad en la base:
  por él la columna no podía ser `UNIQUE` y la garantía la sostenía el servidor
  con un lock con nombre. **Decisión: lo conserva el id más bajo (la silla)**, por
  la regla del primer registro —en el origen la silla aparece primero— y porque
  así la serie de sillas queda completa: `IOT-68…IOT-79` son las 12 sillas de
  madera `IOT-01…IOT-12` (79 − 67 = 12), mientras que la mesa `M-01` cayó en un
  número ya consumido (las mesas siguen en 80..82 = `M-02…M-04`). La mesa recibe
  **`IOT-88`** (el máximo en uso era 87: 88 nunca existió, así que no puede chocar
  con una etiqueta heredada). La regla quedó generalizada en código puro —
  `planRepararDuplicados()` / `siguienteCodigoLibre()`, el id más bajo conserva y
  los demás toman el siguiente libre de su familia, respetando el relleno con
  ceros— y el arranque la aplica solo (`repararCodigosDuplicados()`) antes de
  pedir el índice, porque con duplicados MySQL no lo acepta. Cada recodificación
  se registra con su sentencia de reversión en el log.
- **Con el índice `UNIQUE uq_codigo` se fue el lock de códigos.** El alta y
  `POST …/codigo` ya no hacen `SELECT`+`INSERT` con `GET_LOCK` alrededor: el
  `INSERT`/`UPDATE` falla con `1062` si el código está repetido y el server lo
  traduce a `409` con el id del dueño. Misma garantía (5 altas simultáneas siguen
  dando 1×201 y 4×409) sin los ~135 ms de lock del alta, que vuelve al costo de
  una escritura simple. Queda un **estado degradado** declarado: si volviera a
  haber duplicados, el arranque lo avisa, conserva el índice normal y las
  escrituras chequean a mano (sin garantía ante simultaneidad).
- **Ensayado completo en la base local antes de tocar producción.** El Docker
  local tenía el mismo duplicado y el mismo `ix_codigo` no único, así que sirvió
  de ensayo: el arranque reparó `247 → IOT-88`, creó `uq_codigo`, retiró
  `ix_codigo` y en el segundo arranque no hizo nada (idempotente); `POST` con
  `IOT-79` → `409 (elemento 246)`; carrera de altas 1×201 + 4×409; **carrera de
  asignaciones 1×201 + 1×409** (el camino que antes cubría el lock); estado
  degradado (sin `asegurarCodigoUnico`, como un script suelto) → 409 por chequeo
  a mano y 404 de sala intacto; y `npm run qa` contra local **72 OK · 0 fallos**
  (eran 69: se sumaron el invariante «ningún código repetido», el 409 contra un
  código real y la comprobación de que el alta rechazada no deja otra fila).
  La base local queda migrada (igual que quedará producción) y sin residuos.
- **Desplegado y verificado en producción (2026-09-28).** `sync:deploy --push api`
  subió la api **`143bdbb..a44a26d`** (mensaje con el marcador `fablab@a4d7aac`,
  ya sin el `+dirty` falso). A los 30 s de Render servir el código nuevo la base
  estaba reparada y verificada por API: **917 elementos · 917 códigos distintos ·
  0 repetidos**, id 246 `IOT-79` (silla) y id 247 **`IOT-88`** (mesa); `POST` con
  `IOT-79` → `409 (elemento 246)` — la unicidad la da la base, no el servidor —
  y `npm run qa` en producción **64 OK · 0 fallos** (eran 61: +3 checks nuevos).
  La api quedó sin lock y sin `ix_codigo` (solo `uq_codigo`), 0 fotos, 0 residuos.
- **El alta bajó de +337 a +142 ms (2026-09-28).** Medido con `npm run bench`
  después del deploy: el alta ahora es la escritura más barata de todas —valida
  la sala e inserta, sin `SELECT` de duplicado ni lock— y el rechazo por
  duplicado pasó de +273 a +208 ms (`INSERT` que falla + consulta del dueño).
  Las lecturas siguen en el piso. Ojo con la varianza del free tier: una pasada
  posterior dio el export 2-3× más caro sin que ese código cambiara, así que las
  cifras del doc se leen como orden de magnitud, no como tercera cifra
  significativa.

## Decisions

- **Esquema normalizado en vez de una tabla por sala** (2026-09-12). El primer
  pedido de Keven era una hoja = una tabla; él mismo lo revisó después porque la
  app cubre FabLab y ViveLab y hay que registrar traslados. Estructura:
  `edificios → salas → elementos` + `traslados`. Los dos generadores conviven
  pero **no se mezclan en la misma base**.
- **Todo texto salvo las FK.** `CANTIDAD` mezcla `12`, `-` e `INCONTABLE`.
  Tipar numérico perdería datos. Castear cuando la fuente esté limpia.
- **Las 4 copias del xlsx NO son idénticas** (2026-09-13). 21 de 22 hojas sí,
  pero `RECEPCION 2026` difiere: la copia `CNC 2026.xlsx` tiene 12 cantidades
  que las otras tres tienen en blanco. **Esa es la copia buena y es la que está
  cargada.** Importar desde otra pierde esas 12 cantidades en silencio. Vale
  decírselo a Ricardo: es argumento para que la base sea la fuente única.
- **Una sola tabla `elementos` para los dos edificios.** Las 4 hojas de ViveLab
  tienen las mismas columnas que `ALMACEN 2026` (las 7 menos `ESTADO`), así que
  el edificio es una fila, no un esquema aparte. `estado` queda NULL en 494
  elementos.
- **El SQL generado no va a git.** Se regenera desde el xlsx en un comando.
- **§2.1 es estado del arte, no línea de tiempo** (2026-09-13). Lo primero que
  se escribió era la historia del DataMatrix sin citar un solo trabajo previo.
  Ahora son 7 antecedentes con tabla comparativa. El vacío que sostiene el
  proyecto: ninguno usa DataMatrix, ninguno registra traslados, ninguno modela
  jerarquía de dos niveles.
- **Diseño pre-experimental, declarado como tal.** Keven pidió
  "Cuantitativa/Experimental", pero un solo laboratorio sin grupo de control no
  es experimental. Está escrito como pre-experimental con la limitación
  explícita en §3.1 y §3.5. Si el profesor lo quiere de otra forma, es decisión
  de ustedes.

- **El equipo son DOS personas, no cuatro** (2026-09-13, sesión 2). Álvaro
  confirmó que **Kevin y Gian NO son integrantes**. La portada llegó a listar
  cuatro nombres (copiados de una portada modelo de otra asignatura) y se
  corrigió: quedan `1152462 - Juan David Llanos Castañeda` y
  `1152497 - Álvaro Sneider Portillo Mora`, en mayúsculas y con el código
  después del nombre, igual que la portada de los compañeros (acentos
  conservados; los de ellos los omiten, parece descuido al tipear).
  **Ojo:** varias decisiones de este HANDOFF (esquema normalizado, diseño
  experimental, outline de capítulos) vienen "por WhatsApp de Keven". Si no es
  del equipo, conviene confirmar quién coordina antes de seguir acatándolas.
  El pedido del cronograma también vino de él.
- **§3.2 puede estar desactualizado.** Dice que la muestra de personal se aborda
  "de forma censal" y §3.6 que el tamaño del equipo impide análisis inferencial.
  Se escribió suponiendo otro tamaño de equipo. Habla de personal del
  laboratorio, no de integrantes, así que puede estar bien — pero revisar.
- **Portada APA, no portada institucional** (2026-09-13, sesión 2). Se pidió
  APA explícitamente. Se quitaron ciudad y el rótulo "Integrantes del equipo";
  se agregaron docente (Carlos Eduardo Pardo García) y número de página arriba
  a la derecha. **Los códigos de estudiante se conservan** aunque APA no los
  contemple: la convención del programa manda, y así los usan los compañeros.
  La fecha dice "Septiembre de 2026" (se decidió omitir fecha de entrega).
- **No hay Spring Boot** (2026-09-13, sesión 2). Verificado en `package.json`:
  el stack es Expo/React Native + `server/index.mjs` (Node) + MySQL vía
  `mysql2`, DataMatrix con `datamatrix-svg-ts`, migración con `xlsx`. El deck
  viejo decía Spring Boot; era falso y nunca se presentó.
- **Las capturas del deck viejo estaban mal rotuladas.** La que decía
  "DataMatrix generado" es la ficha de un elemento (Arduino Uno R3, Sala IOT) y
  la de "Escaneo por cámara" es el formulario de alta. **No hay captura del
  escáner funcionando.** En el deck nuevo están rotuladas por lo que realmente
  muestran; si un jurado pide ver el escáner, ese hueco sigue abierto.
- **Cifras ajenas marcadas como ajenas** (2026-09-13, sesión 2). Los 43 % /
  98,5 % / 72 % son de Sahetapy y Suhirman (2025), **no son mediciones
  propias**. En el documento son "referencia comparativa" y en el deck (slide 9)
  dicen literal "Referencia de la literatura, no resultado propio". Presentarlas
  como propias sería un problema en la sustentación.
- **Citas nuevas en el capítulo 1** (2026-09-13, sesión 2). Antes tenía cero.
  Se agregaron dos, verificadas leyendo la fuente: Panko (2000) —86-91 % de las
  hojas de cálculo auditadas en campo tenían al menos un error, CER 1,1-2,5 %—
  y Jessurun et al. (2021) —lectura de código de barras bajó los errores de
  administración de 19,5 % a 15,8 %—. El "94 %" que circula es de una
  meta-revisión posterior, no de las tablas de Panko; se usaron las de él.
- **Comparación con el trabajo de los compañeros** (`CURSO EDUCATIVO DE REDES DE
  COMPUTADORES EN MOODLE.pdf`, mismo curso y profesor). Misma estructura de
  fondo. Nuestro documento tiene numeración jerárquica, 12 referencias contra 4,
  tabla comparativa y limitaciones metodológicas explícitas. Lo único en que nos
  ganaban era citar literatura en el planteamiento del problema —ya está
  corregido— y **ninguno de los dos tenía cronograma**, que ahora sí está.

## Contexto

El pedido viene por WhatsApp de Keven, no hay outline escrito del profesor
(Ricardo). El outline de capítulos que se siguió lo transcribió Keven el
2026-09-12. Ricardo pidió avances; el plan era mostrarle capturas de la base.
