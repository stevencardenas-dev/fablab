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
            │ HTTP/JSON  (todo con Bearer de sesión, salvo /health y /api/login)
            │ WebP/JPEG en base64 (POST foto)
┌───────────▼──────────────────┐
│  API REST — Node (sin deps    │   server/index.mjs: 15 rutas, CORS, gzip,
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

Una sola petición trae todo el inventario (1 450 elementos al 2026-10-15) **sin binarios** (solo `foto_hash`),
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
cámara/galería → prepararFotoParaSubir()  (1200 px WebP q0.7 + 200 px, ~81 KB)
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
| BD | MySQL 8 (Aiven en producción hoy; MySQL 8.4 en el stack Docker para la universidad) | — |
| Despliegue | Docker Compose: MySQL + API + nginx (ver [`docker/README.md`](../docker/README.md)) | — |
| Importer | `xlsx` (CDN de SheetJS; npm se quedó en 0.18.5 con avisos sin corregir) | `0.20.3` |
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
- **Acceso con credencial.** Si `API_TOKEN`, `CUENTA_USUARIO`/`CUENTA_CLAVE_HASH`
  y `SESION_SECRETO` están configurados (lo habitual en producción o Docker),
  **todas** las rutas excepto `/health` y `POST /api/login` exigen una credencial.
  El proyecto expone una sola cuenta compartida (sesión de 12 h, HMAC firmada) y
  un token de herramientas para scripts. En modo del todo abierto (sin nada
  configurado) lecturas y escrituras son públicas. Ver
  [`operacion.md`](operacion.md#credenciales-y-accesos) y
  [`problemas-conocidos.md`](problemas-conocidos.md#resuelto-el-token-de-escritura-viajaba-en-el-bundle-web).
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
  rama `main`).
- **Artefactos de despliegue**: dos repos espejo que se regeneran con
  `npm run sync:deploy` → `Masterkillerr/fablab-api` (privado, lo consume Render)
  y `Masterkillerr/fablab-web` (público, hosting estático). Editar algo ahí
  directamente es temporal: el próximo sync lo pisa. Ver
  [`operacion.md`](operacion.md).
- **Datos de producción**: MySQL de Aiven (`defaultdb`) escrito por la API. El
  Excel de origen es un punto de partida histórico, **no** la verdad actual: la
  base ya tiene 35 códigos asignados y ediciones hechas por la app.

## Mapa del código (qué hace cada archivo)

### Rutas de la app (`src/app/`)
| Archivo | Rol |
|---|---|
| `src/app/_layout.tsx` | Tema, splash animado, registro del service worker, `prewarmCache()` |
| `src/app/+html.tsx` | Documento HTML completo del export web (meta, scripts) |
| `src/app/(tabs)/_layout.tsx` | Tabs (Inicio, Inventario) |
| `src/app/(tabs)/index.tsx` | **Inicio**: búsqueda viva, escaneo, alta y exportación |
| `src/app/(tabs)/explore.tsx` | **Inventario**: lista de salas por edificio, con estados |
| `src/app/sala/[nombre].tsx` | **Sala**: mosaico de chips, filtro, modal de detalle |

### Componentes (`src/components/`)
| Archivo | Rol |
|---|---|
| `src/components/animated-icon*.tsx` | Icono animado del splash |
| `src/components/app-tabs*.tsx` | Barra de pestañas (web + nativo) |
| `src/components/data-matrix.tsx` | Descarga de etiquetas y hojas de impresión (web/nativo) |
| `src/components/external-link.tsx` | Abrir enlaces externos |
| `src/components/pantalla-entrada.tsx` | Pantalla de entrada (inicio de sesión) + captcha |
| `src/components/scanner.tsx` | Lector Data Matrix por cámara (`expo-camera`) |
| `src/components/service-worker.ts` | Registro del SW (maneja `document.readyState`) |
| `src/components/themed-text.tsx`, `themed-view.tsx` | Texto/vista tematicados |
| `src/components/ui/collapsible.tsx` | Bloque colapsable reutilizable |
| `src/components/_unused/*` | Sobrantes del template de Expo (excluidos de Jest) |

### Hooks y constantes
| Archivo | Rol |
|---|---|
| `src/hooks/use-color-scheme*.ts` | Detectar modo claro/oscuro |
| `src/hooks/use-disposicion.ts` | Desborde por ancho (escritorio vs móvil) |
| `src/hooks/use-sesion.ts` | Estado de sesión del laboratorio |
| `src/hooks/use-theme.ts` | Contexto de modo light/dark |
| `src/constants/theme.ts` | Tokens de color, espaciado, tipografía |
| `src/global.css` | Estilos globales (web) |

### Librerías (`src/lib/`)
| Archivo | Rol |
|---|---|
| `src/lib/data-matrix-svg.ts` | Armado del SVG de la etiqueta Data Matrix (mm) y del plan de hoja |
| `src/lib/foto.ts` | Constantes y helpers de compresión de foto (LADO*, CALIDAD*) |
| `src/lib/foto-optimizar.ts` | Puente con `expo-image-manipulator` (redimensionar/comprimir) |
| `src/lib/hoja-imprimible.ts` | Pestaña HTML imprimible de etiquetas |
| `src/lib/inventory.ts` | Acceso a la API, caché SWR, write-through, búsquedas,deep links |
| `src/lib/mensajes.ts` | Mensajes de la app al usuario (fallback por estatus) |
| `src/lib/sesion.ts` | Token de sesión, `iniciarSesion`, `authHeaders`, `?sesion=` |

### Servidor, importer y scripts
| Archivo | Rol |
|---|---|
| `server/index.mjs` | Rutas, CORS, compresión, ETag, autenticación, esquema al arrancar |
| `server/sesion.mjs` | Hash scrypt, firma HMAC, verificación (puro, compartido) |
| `importer/api.mjs` | SQL, validaciones (`validarFoto`, `validarAsignacion`), cachés, `ErrorApi` |
| `importer/importar.mjs` | `conexionDesdeEnv()` + SQL de la importación |
| `importer/normalizado.mjs`, `schema.mjs`, `gen-normalizado.mjs`, `cli.mjs` | xlsx → SQL normalizado/legacy |
| `importer/self-check.mjs` | Validaciones sin base (corre en el gate) |
| `scripts/*` | seed, migrar-esquema, asignar-codigos, fix-mojibake, backup, qa, benchmark, fotos-demo, sync-deploy, verificar-docs, verificar-impresion, verify-* |
| `public/sw.js` | Service worker (cache-first shell, network-first `/api/`) |
| `public/manifest.json` | Manifest de la PWA |

Todo archivo de `src/` no listado es accesorio (temas, offline). Si agregas uno,
añádelo a esta tabla — `docs:check` valida enlaces pero **no** la cobertura.
