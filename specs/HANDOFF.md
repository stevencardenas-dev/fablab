# HANDOFF — Inventario FabLab / Seminario Integrador II

Última sesión: 2026-09-13 (sesión 2 — documento, APA, presentación)

## State

**Base de datos: hecha y verificada.** El inventario de Excel está migrado a
MySQL con esquema normalizado. 916 elementos, 11 salas, 2 edificios (FabLab y
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
  (`backups/elementos-2026-09-24-02-47.json`), y un E2E en el navegador que
  cubre el botón, el aviso de omitidos y la hoja después de asignar. Deploy:
  **api `1608d79..db6c29b`**, **web `50b4902..5f5e03f`** (SW `fablab-v9`).


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
