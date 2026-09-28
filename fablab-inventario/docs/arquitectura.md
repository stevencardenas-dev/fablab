# Arquitectura

## En una frase

Una app **Expo/React Native** (móvil y web instalable) que lee y escribe el
inventario del FabLab a través de una **API REST en Node** que habla con un
**MySQL 8** administrado; las fotos se reducen **en el dispositivo** antes de
subir y la base guarda solo la versión reducida.

## Diagrama

```
┌──────────────────────────────┐
│  App Expo (react-native-web) │   Pantallas: Inicio · Inventario · Sala
│  src/app, src/lib            │   Caché SWR (memoria + AsyncStorage)
└───────────┬──────────────────┘
            │ HTTP/JSON  (GET público; POST/PUT/DELETE con Bearer)
            │ WebP/JPEG en base64 (POST foto)
┌───────────▼──────────────────┐
│  API REST — Node (sin deps    │   server/index.mjs: 14 rutas, CORS, gzip,
│  de framework), mysql2        │   ETag/304, keep-alive del free tier
│  Pool tibio + cachés en RAM   │   importer/api.mjs: SQL, validaciones,
└───────────┬──────────────────┘   caché de fotos, ErrorApi(estatus)
            │ MySQL sobre TLS (WAN)
┌───────────▼──────────────────┐
│  MySQL 8 — Aiven (1 GB)       │   edificios → salas → elementos
│  db `defaultdb`               │   traslados · elemento_fotos (BLOBs)
└──────────────────────────────┘
```

En local el diagrama es el mismo con MySQL en Docker: la app apunta a
`http://localhost:3001/api` y el server a `localhost:13306`.

## Componentes

| Componente | Dónde vive | Responsabilidad |
|---|---|---|
| **App** | `src/` | UI, escáner Data Matrix, formularios, caché cliente, generación/descarga de etiquetas, PWA |
| **Servidor HTTP** | `server/index.mjs` | Rutas, CORS, compresión, ETag/304, autenticación de escrituras, keep-alive, asegura esquema al arrancar |
| **Capa de datos** | `importer/api.mjs` | SQL, transacciones, validaciones (`validarFoto`, `validarAsignacion`), cachés en RAM, `ErrorApi` con estatus |
| **Conexión** | `importer/importar.mjs` | `conexionDesdeEnv()` (variables `MYSQL_*`, TLS opcional) |
| **Importer** | `importer/normalizado.mjs`, `schema.mjs`, `cli.mjs`, `gen-normalizado.mjs` | Convertir el xlsx del FabLab en DDL+DML MySQL |
| **Herramientas** | `scripts/` | `seed`, `migrar:esquema`, `asignar:codigos`, `fix:mojibake`, `backup:remoto`, `qa`, `benchmark`, `fotos:demo`, `sync:deploy` |
| **PWA** | `public/manifest.json`, `public/sw.js` | Instalación en pantalla de inicio y caché del shell |

## Flujos principales

### 1. Leer el inventario (el camino más caliente)

```
Sala/Inicio pide datos
   → getAllItems()  ── caché fresca (<60 s)? ──► devuelve de memoria
                     └─ si no ─► GET /api/elementos ─► caché TTL 60 s del server
                                  (o una query al LEFT JOIN si expiró)
                     └─ sin red ─► AsyncStorage (último conocido) y la red
                                   refresca por detrás (stale-while-revalidate)
```

Una sola petición trae los 917 elementos **sin binarios** (solo `foto_hash`),
comprimida con gzip (>1 KB) a ~20 KB. Antes eran 1 + N peticiones, una por sala.

### 2. Escribir (alta, edición, traslado, código, foto)

```
UI → POST/PUT/DELETE con Authorization: Bearer <token>
   → server valida token (si API_TOKEN está definido)
   → ErrorApi(estatus) → 400/404/409 reales en vez de 500
   → invalidarCache() en el server (todo el caché TTL)
   → el cliente hace write-through en su caché (sin re-descargar 917)
```

Las escrituras **no tienen fallback local**: un elemento que solo existiera en
el teléfono sería invisible para la app (todo se lee de la API). Si falla, se ve
el error.

### 3. Foto de un elemento

```
cámara/galería → prepararFotoParaSubir()  (800 px WebP q0.6 + 200 px, ~31 KB)
   → POST /api/elementos/:id/foto (base64)
   → validarFoto(): firma de bytes, límites, hash sha1(16)
   → UPSERT en elemento_fotos, se limpia la caché del elemento
   → la app recibe el hash y lo guarda en su caché
   → las próximas cargas piden ?tam=miniatura&v=<hash> (immutable + ETag)
```

Detalle completo en [`fotos.md`](fotos.md).

### 4. Cargar el inventario desde el Excel

```
xlsx → gen-normalizado.mjs (o npm run seed) → SQL → MySQL
                                        └─ reimportar VACÍA la base (DROP TABLE)
```

Detalle en [`importacion.md`](importacion.md).

## Stack y versiones

| Capa | Tecnología | Versión (package.json) |
|---|---|---|
| App | Expo SDK | `~57.0.22` |
| | React / React Native | `19.2.3` / `0.86.3` |
| | expo-router (file-based) | `~57.0.21` |
| | expo-camera (lector Data Matrix) | `~57.0.5` |
| | expo-image / expo-image-manipulator | `~57.0.5` / `~57.0.19` |
| | datamatrix-svg-ts (+ `datamatrix-decode` en dev) | `^1.0.2` |
| | react-native-web (PWA) | `~0.21.0` |
| API | Node.js (solo módulos nativos + `mysql2`) | 20+ |
| BD | MySQL 8 (Aiven en producción, Docker en local) | — |
| Importer | `xlsx` | `^0.18.5` |
| Pruebas | Jest + jest-expo, ESLint (expo) , TypeScript | 29.7 / 9 / 6.0 |

No hay framework de servidor (Express, Fastify…): `node:http` + un router de
`parts` sobre la URL. Menos dependencias que actualizar y el servidor arranca en
milisegundos.

## Decisiones de diseño

Cada decisión con su motivo (y el costo que se aceptó):

- **Un solo inventario para los dos edificios** (`FabLab` y `ViveLab`) con la
  misma tabla `elementos`. Las hojas de ViveLab traen las mismas columnas menos
  `ESTADO`, así que el edificio es una fila, no un esquema aparte.
- **Todo texto salvo las claves.** `CANTIDAD` mezcla `12`, `-` e `INCONTABLE` en
  la hoja original; tipar numérico perdería datos. Castear cuando la fuente esté
  limpia.
- **La foto se reduce en el teléfono, el original nunca sale de él.** Una foto de
  cámara son 1-2,5 MB × 917 elementos = 1-2 GB, más que el disco del plan (1 GB,
  con ~288 MB ya usados). Reducida: ~31 KB por elemento (~29 MB en total).
- **Los binarios viven aparte** (`elemento_fotos`) y el listado solo lleva
  `foto_hash`. Si las fotos viajaran en `GET /api/elementos`, cada carga de la
  app serían decenas de MB.
- **URL versionada por hash.** Cada imagen se pide como
  `…/foto?tam=miniatura&v=<hash>`: al reemplazar la foto cambia la URL, y
  ninguna caché (navegador, service worker, RAM del server) sirve la vieja.
  El ETag es el mismo hash, así que la revalidación es exacta.
- **Escrituras protegidas con token opcional.** Si `API_TOKEN` está definido, las
  escrituras exigen `Authorization: Bearer`; la lectura sigue pública. Es un
  freno al vandalismo casual, **no** seguridad real en la web (el token viaja en
  un bundle público; ver [`problemas-conocidos.md`](problemas-conocidos.md)).
- **Código no editable.** `codigo` es el identificador impreso en la etiqueta
  Data Matrix: sobrescribirlo invalidaría etiquetas pegadas. Por eso existe
  `POST /api/elementos/:id/codigo`, que **solo rellena vacíos**.
- **El servidor asegura su propio esquema al arrancar** (tabla de fotos e índice
  de `codigo`). En Aiven no hay credenciales de la base fuera de Render, así que
  el deploy tiene que arreglar su base solo; ambas operaciones son idempotentes.
- **Borrar un elemento borra también sus traslados** (transacción). La FK
  heredada no tiene `ON DELETE CASCADE`, y un DELETE con historial reventaba con
  500. La foto sí cae por CASCADE.

## Dónde vive la verdad

- **Fuente de verdad**: este monorepo (`git@github.com:stevencardenas-dev/fablab.git`,
  rama `feature/inventario-scan`).
- **Artefactos de despliegue**: dos repos espejo que se regeneran con
  `npm run sync:deploy` → `Masterkillerr/fablab-api` (privado, lo consume Render)
  y `Masterkillerr/fablab-web` (público, hosting estático). Editar algo ahí
  directamente es temporal: el próximo sync lo pisa. Ver
  [`operacion.md`](operacion.md).
- **Datos de producción**: MySQL de Aiven (`defaultdb`) escrito por la API. El
  Excel de origen es un punto de partida histórico, **no** la verdad actual: la
  base ya tiene 35 códigos asignados y ediciones hechas por la app.
