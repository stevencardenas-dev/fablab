# Operación y despliegue

## Entornos

| Entorno | App | API | Base |
|---|---|---|---|
| **Local** | `npx expo start` (web en `localhost:8081`, o la IP del PC para el teléfono) | `node server/index.mjs` → `:3001` | MySQL en Docker (`fablab-mysql`) |
| **Producción** | `https://fablab-web.onrender.com` (PWA) | `https://fablab-api-sr1q.onrender.com` (Render free) | MySQL 8 en Aiven (plan 1 GB, db `defaultdb`) |

Nadie corre un servidor propio en producción: Render consume los **repos de
deploy**, que se generan desde el monorepo con `sync:deploy`.

## Credenciales y accesos

| Qué | Dónde vive | Notas |
|---|---|---|
| Token de escritura de la API | `~/.config/fablab/api-token` (chmod 600) y env `API_TOKEN` en Render | `Authorization: Bearer <token>` en POST/PUT/DELETE |
| Token de la API de Aiven | `~/.config/fablab/aiven-token` | `Authorization: aivenv1 …` contra `api.aiven.io/v1` (proyecto `fablab`, servicio `mysql-2eb5feb2`) |
| Servicios de Render | CLI local (`render logs -r <id> -f`) | `fablab-api` = `srv-dajnh2p5efls739kjo3g`, `fablab-web` = `srv-dajo898ae00c73aoqtq0` |

**Nunca** al repo: los tokens viven solo en la máquina. Si se rota el de Aiven,
actualizar el archivo.

> **No resetear la contraseña de `avnadmin`.** La contraseña que reporta la API
> de Aiven **no** es la que usa Render (`AVNS…`): resetearla tira la API. Por eso
> los cambios de datos o de esquema en producción se hacen **por la API de la
> app** (o por el propio server al arrancar), no por conexión directa a la base.

## Desplegar

```bash
# Vista previa: clona/actualiza los repos de deploy en ~/.cache/fablab-deploy
npm run sync:deploy

# Subir (commit + push en los repos espejo)
EXPO_PUBLIC_API_TOKEN=$(cat ~/.config/fablab/api-token) \
  npm run sync:deploy -- --push api,web
```

`--push api` / `--push web` permiten subir solo uno. Render tarda **1-3 min** en
propagar; se verifica con sondas (abajo).

### Qué copia cada destino

| Destino | Origen | Contenido |
|---|---|---|
| `Masterkillerr/fablab-api` (privado) | `server/`, `importer/`, `ddl-data.sql` → `data/` | El server arranca con su propio `package.json` mínimo (mysql2 + xlsx) |
| `Masterkillerr/fablab-web` (público) | `dist/` recién exportado | Sitio estático + `404.html` |

### Reglas de seguridad del script (no las saltes)

1. **El build web se hace siempre ahí y con `EXPO_PUBLIC_API_URL` horneada.**
   Sin esa variable el PWA se llama a sí mismo y no carga datos. El script
   **verifica** que el string `onrender` quedó en algún bundle: si no, aborta.
   `EXPO_PUBLIC_API_TOKEN` (si está en el entorno) se hornea en la misma pasada.
2. **Si el repo de deploy tiene commits manuales posteriores al último sync, el
   sync de web ABORTA** (`--force-web` los pisa, úsalos solo si ya los portaste
   al monorepo). Esos commits viven solo ahí y se perderían.
3. **El monorepo es la fuente de verdad.** Editar directo en un repo de deploy es
   temporal: el próximo sync lo borra.

**Trazabilidad:** cada commit del script lleva el commit del monorepo del que
salió el artefacto — `Sync desde monorepo (2026-09-24 23:50 · fablab@abc1234)` —,
con `+dirty` si había cambios sin commitear (o sea: el deploy **no** es
reproducible desde ese hash). Sin esto no había forma de responder "¿qué código
está en producción?" mirando el repo de deploy.

Detalles que ya causaron bugs y por eso están en el script:

- `npx expo export --platform web --clear` es **obligatorio**: Metro cachea los
  `EXPO_PUBLIC_*` y sin `--clear` un export anterior puede subir URL/token
  **viejos** sin avisar.
- `404.html` se regenera como copia de `index.html` (fallback SPA para deep links).

## Después de desplegar: verificación

```bash
# 1. La API responde y la base está viva
curl -s https://fablab-api-sr1q.onrender.com/health
curl -s --compressed https://fablab-api-sr1q.onrender.com/api/salas | head -c 300

# 2. El web sirve el SW y el bundle nuevos
curl -s https://fablab-web.onrender.com/sw.js | grep CACHE_NAME
curl -s https://fablab-web.onrender.com/index.html | grep -o 'entry-[a-z0-9]*\.js'

# 3. El bundle trae lo que se desplegó (URL de API, strings nuevos)
curl -s https://fablab-web.onrender.com/_expo/static/js/web/<entry>.js | grep -c onrender
```

- Si cambió el bundle, **sube `CACHE_NAME` en `public/sw.js`** (`fablab-v12` hoy):
  el SW es cache-first sobre el shell y los bundles, y sin cambiar el nombre los
  clientes con el SW viejo seguirían con la UI vieja.
- Render propaga en 1-3 min; los `502/503` durante el arranque son normales (la
  app reintenta solo los GET).
- Suite mínima antes/depués: `npm test`, `npx tsc --noEmit`, `npm run lint`,
  `node importer/self-check.mjs` y `npm run qa` (contra producción).

## Comportamiento del free tier

- **La API duerme** tras ~15 min sin tráfico. Para evitarlo, el server se hace
  **ping a sí mismo cada 10 min** (`RENDER_EXTERNAL_URL` la inyecta Render) contra
  **`/api/salas`**, no `/health`: así la consulta también mantiene despierta la
  base de Aiven (que se apaga por inactividad). El repo de deploy tiene además un
  watchdog horario por GitHub Actions.
- El primer hit tras un rato idle cuesta ~0,43-0,47 s **incluso en `/health`**
  (que no toca la BD): es el despertar de CPU del plan free, no MySQL. El
  cliente lo tapa reintentando los GET y sirviendo caché por detrás.
- El plan de Aiven es 1 GB: por eso la foto se reduce en el dispositivo (ver
  [`fotos.md`](fotos.md)).

## Al arrancar el server

`server/index.mjs`, antes de aceptar tráfico:

1. `asegurarEsquemaFotos()` — crea `elemento_fotos` si falta (idempotente).
   Sin esto, el `LEFT JOIN` del listado tumbaba la app entera en Aiven.
2. `repararCodigosDuplicados()` — recodifica los `codigo` repetidos y registra
   cada cambio con su sentencia de reversión. Sin duplicados no hace nada.
3. `asegurarCodigoUnico()` — crea `uq_codigo` (UNIQUE) y retira `ix_codigo`;
   ignora errno 1061 si ya estaba. Si quedaran duplicados devuelve `'duplicados'`
   y el arranque lo avisa en vez de dejar la base sin índice.
4. `precargarMiniaturas()` — sube las miniaturas a RAM (~5 MB).

Los pasos 2 y 3 van en ese orden: con duplicados vivos, MySQL no acepta el
índice `UNIQUE`.

Si algo de esto falla, se registra y el server sigue: el listado degrada a "sin
fotos" en vez de caerse. La vía manual para revisar el esquema es
`npm run migrar:esquema -- --check` (ver [`base-de-datos.md`](base-de-datos.md)).

## Rollback

- **App/API**: el código vive en el monorepo. Para volver atrás, revierte el
  commit en el monorepo y vuelve a correr `sync:deploy -- --push …`; los repos de
  deploy son artefactos, no el lugar para arreglar nada.
- **Base**: no hay rollback automático. Antes de cualquier escritura masiva,
  `npm run backup:remoto` deja un JSON con estado completo en `backups/`, y las
  pruebas en vivo dejan su propio manifiesto de reversión.
- **Render**: el dashboard guarda el historial de deploys de cada servicio
  (permite redeployar uno anterior sin tocar git).

## Checklist

**Antes de tocar producción**

1. `npm run backup:remoto` (y leer el manifiesto si la operación toca datos).
2. Probar el cambio contra el server local (`--base http://127.0.0.1:3101/api`).
3. Correr el gate completo (`npm run gate`: tipos, lint, 120 tests, self-check,
   Data Matrix, impresión de la hoja de etiquetas y verificación de docs y
   scripts) y `npm run qa -- --base …`.
   El mismo gate corre solo en cada push vía GitHub Actions
   (`.github/workflows/ci.yml`).
4. Tener el `API_TOKEN` a mano (o fallar los POST/PUT/DELETE con 401, que es el
   síntoma esperado si falta).

**Al desplegar**

5. `npm run sync:deploy` (preview) y revisar qué archivos van.
6. `--push api`, `--push web`, o ambos; el web **siempre** con el token en el
   entorno.
7. Subir `CACHE_NAME` del SW si cambió el bundle.
8. Verificar con las sondas de arriba y `npm run qa`.
9. Dejar constancia en `specs/HANDOFF.md` (fecha, commits, qué se verificó).

## Lo que NO se hace

- Reimportar `seed` sobre producción (borra traslados y fotos).
- Resetear la contraseña de `avnadmin`.
- Copiar tokens o dumps con datos sensibles al repo.
- Editar directo en los repos de deploy (el sync lo pisa).
- Usar `sudo` para las tareas del proyecto: no hace falta.

## Pendiente de infraestructura

- **Deep links con 404** (`/sala/1` renderiza bien pero devuelve `404`): el fix
  correcto es una **Rewrite Rule en el Dashboard de Render** (`/*` → `/index.html`,
  acción *Rewrite*; los archivos reales siguen ganando). El `public/_redirects`
  del repo no lo aplica Render (ver
  [`problemas-conocidos.md`](problemas-conocidos.md)).
