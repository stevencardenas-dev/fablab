# Problemas conocidos

Lo que está abierto, lo que muerde y lo que se decidió no arreglar (con el
motivo). Nada de esto bloquea el uso normal de la app.

## Endurecimiento aplicado (2026-09-24)

Ocho cosas que un revisor habría marcado y ya están cerradas, cada una con su
check automatizado. Se listan acá para que se vea **qué se arregló**, no solo
qué queda abierto:

| Antes | Ahora | Dónde se prueba |
|---|---|---|
| Cuerpo con JSON roto → `500` | `400` "JSON inválido" | `npm run qa` |
| Cuerpo sin tope (2 MB se bufferizaban enteros en RAM) | tope de 1 MB → `413`, sin acumular | `npm run qa` + prueba chunked |
| `GET /elementos/1.5/historial` → `200 []`; ids fuera de rango llegaban a la base | ids solo enteros (`1`…`2147483647`), resto `400` | `npm run qa` · `self-check` |
| Dos altas simultáneas del mismo código → ambas `201` (TOCTOU) | primer intento: lock con nombre; hoy la base: `UNIQUE uq_codigo` (una `201`, el resto `409`) | `npm run qa` (5 en paralelo) |
| `DELETE` por código duplicado borraba uno al azar | `409` y no borra nada | `self-check` (función pura) |
| Historial de un elemento inexistente → `200 []` | `404` | `npm run qa` |
| `npm run qa` reventaba con `TypeError` en una base sin fotos | el contrato de fotos se prueba sobre la foto temporal del QA | `npm run qa` |
| Sin CI: los tests dependían de que alguien se acordara | `.github/workflows/ci.yml` + `npm run gate` | GitHub Actions |

Lo que **no** cambia con esto: el token de escritura sigue viajando en el bundle
web (ver más abajo).

## `IOT-79`: resuelto el 2026-09-25

No era un bug del software sino un dato: el Excel original escribió `IOT-79` dos
veces (una *silla de madera marrón* y una *mesa de trabajo 1.50×2.40 M-01*, ids
246 y 247 de la sala 2). Impacto mientras estuvo: el listado devolvía dos filas
con el mismo `codigo`, buscar o escanear ese código mostraba las dos fichas y
ningún índice `UNIQUE` podía crearse, así que la unicidad la sostenía el servidor
con un lock.

**La decisión: lo conserva el id más bajo**, la silla (246). El criterio es la
regla del primer registro —en el inventario original la silla aparece primero— y
el hecho de que la serie de sillas quede completa: `IOT-68…IOT-79` son las 12
sillas de madera `IOT-01…IOT-12` (`79 − 67 = 12`), mientras que la mesa `M-01`
entró en un número ya consumido (las mesas siguen en `80…82`, que son `M-02…M-04`).
La mesa recibió **`IOT-88`**, el siguiente libre de la familia: `IOT-87` era el
máximo en uso, así que `88` nunca existió y no puede chocar con una etiqueta
heredada.

| | Antes | Después |
|---|---|---|
| id 246 · Silla madera marrón IOT-12 | `IOT-79` | `IOT-79` |
| id 247 · Mesa de trabajo 1.50×2.40 M-01 | `IOT-79` | `IOT-88` |

Lo aplica el arranque (`repararCodigosDuplicados`, ver
[`base-de-datos.md`](base-de-datos.md)) con la regla general *el id más bajo
conserva el código*, que sirve para cualquier duplicado futuro. **Reversión:**
`UPDATE elementos SET codigo='IOT-79' WHERE id=247` — y antes hay que quitar
`uq_codigo`, porque el índice no acepta el duplicado de vuelta. El arranque
imprime esa sentencia al reparar.

## Bugs abiertos

### Error #418 de React en la PWA

`Minified React error #418` (texto de hidratación distinto entre servidor y
cliente) aparece en consola al cargar el export estático de Expo.

- Se reprodujo **en incógnito** y también en `/`, así que no es una extensión ni
  el fallback `404.html`.
- Es de nivel **SDK (export estático de Expo)**, cosmético: la app funciona.
- No se arregla desde este repo sin dejar de usar el export estático.

### Deep links con estatus 404

Abrir `https://fablab-web.onrender.com/sala/1` **renderiza bien** pero la
respuesta HTTP es `404` (Render sirve `404.html`, que es copia de `index.html`,
y el router resuelve la ruta en el cliente).

- `public/_redirects` existe con `/*  /index.html  200`, pero **Render no lo
  aplica** en sitios estáticos.
- Fix correcto: **Rewrite Rule en el Dashboard de Render** (`/*` → `/index.html`,
  acción *Rewrite*; los archivos reales siguen ganando).
- Impacto: cosmético para un usuario, pero molesto para enlaces compartidos y
  para herramientas que miran el estatus.

## Trampas del entorno

### La API duerme (free tier de Render)

Tras ~15 min sin tráfico el servicio se apaga; el primer hit cuesta
**0,43-0,47 s incluso en `/health`** (es despertar de CPU, no MySQL). El server
se hace ping cada 10 min a `/api/salas` (mantiene vivos también a Aiven) y la app
reintenta los GET con backoff. Ver [`operacion.md`](operacion.md).

### Medir con `curl` sin `--compressed`

Mide ~120 ms de transferencia de más en el listado (140 KB vs. 776 B comprimidos).
Comprueba también con `HEAD`, que marca ~+105 ms sobre el `304` por un artefacto
del proxy — **la app nunca usa HEAD**. Detalles en
[`rendimiento.md`](rendimiento.md).

### El puerto del Docker no coincide con el default del código

`docker-compose.yml` publica `3306:3306`, pero `conexionDesdeEnv()` usa `13306`
por default. Con el compose tal cual: `MYSQL_PORT=3306`, o cambia el mapeo a
`"13306:3306"`. Síntoma: `ECONNREFUSED 13306`.

### Sin credenciales de Aiven fuera de Render

La contraseña de `avnadmin` que reporta la API de Aiven **no** es la que usa
Render (`ER_ACCESS_DENIED`), y el HANDOFF prohíbe resetearla (tira la API). Por
eso:

- los cambios de esquema se hacen con el **server al arrancar**
  (`asegurarEsquemaFotos`, `repararCodigosDuplicados`, `asegurarCodigoUnico`) o
  por la API;
- `npm run migrar:esquema` sirve para local, no para producción;
- cualquier operación de datos en producción pasa por la API pública.

### GitHub apaga los cron de un repo inactivo

GitHub desactiva los workflows programados —`keep-alive` y `db-watchdog` de los
repos de deploy— tras **60 días sin actividad en el repositorio**; los propios
runs programados no cuentan como actividad. Son el respaldo externo del ping que
el server se hace a sí mismo, así que el síntoma sería un fallo que nadie ve. La
mitigación es un pinger externo (UptimeRobot, cron-job.org…, contra
`/api/salas`) y el secreto `ALERTA_WEBHOOK` para que el fallo llegue por
Discord/Slack/correo. Ver *Traspaso al FabLab* en [`operacion.md`](operacion.md).

### Subir el número de caché del SW al desplegar

El service worker es cache-first sobre el shell y los bundles. Si despliegas un
bundle nuevo y **no** subes `CACHE_NAME` en `public/sw.js` (`fablab-v12` hoy),
los clientes con el SW viejo quedan con la UI vieja para siempre.

### El token de escritura viaja en el bundle web

`EXPO_PUBLIC_API_TOKEN` se inlinea en el JS público de la PWA: cualquiera puede
leerlo y escribir. Es un **freno al vandalismo casual, no seguridad real**.
Rotarlo exige volver a exportar y desplegar la web (el token nuevo debe estar
también en las env vars de Render).

### Metro cachea los `EXPO_PUBLIC_*`

Un export sin `--clear` puede reutilizar un bundle con URL/token viejos. Ya está
forzado en `sync:deploy`; si exportas a mano, usa `--clear`.

## Limitaciones conocidas

- **Sin pruebas en dispositivo del camino nativo**: escanear un Data Matrix
  impreso con la cámara y abrir la hoja de compartir (`expo-sharing`) solo se
  validaron de forma indirecta (decodificando los SVG generados). El escáner en
  web y el lector en Expo Go funcionan, pero no hay prueba automatizada.
- **La restauración de respaldos no es un comando**: `backup:remoto` guarda un
  JSON lógico (`/api/export/*`), no un `mysqldump`. Restaurar requiere reconstruir
  los INSERT o tener credenciales de la base.
- **La API es pública de lectura y sin límite de tasa**: cualquiera con la URL
  puede leer el inventario y gastar cuota del plan free. Es una decisión
  consciente (la app es interna), no un descuido.
- **`cantidad` es texto libre** (`12`, `-`, `INCONTABLE`): cualquier reporte
  numérico tiene que filtrar valores no numéricos primero.
- **`estado` es NULL en ~494 elementos** (hojas sin esa columna): la UI muestra
  vacío, no un valor por defecto.
- **`GET /api/salas/:id/elementos` no devuelve `foto_hash`** (no hace el JOIN).
  La app no la usa —carga todo con `/api/elementos`— pero un consumidor externo
  que quiera fotos debe usar esa ruta principal.

## Deuda reconocida (no urgente)

- **`use-color-scheme.web.ts`** ya no rompe el lint (`useSyncExternalStore`), pero
  sigue siendo un caso especial solo-web del hook.
- **`importer/schema.mjs`** (importador legacy "una hoja = una tabla") convive con
  el normalizado. Si nadie lo usa, sobra y `importer/` adelgaza. **No mezclar los
  dos en la misma base**.
- **`src/components/_unused/`** conserva componentes del template de Expo
  (excluidos de Jest).
- **Caché de la demo de fotos**: con la misma imagen en los 917 elementos todas
  las URLs comparten hash, así que el navegador sirve una sola entrada de caché y
  enmascara el beneficio real del prefetch por elemento. Con fotos reales (hash
  único por elemento) el efecto se verá como se midió.
