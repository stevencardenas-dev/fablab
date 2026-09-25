# API REST

Servidor HTTP en Node puro (`server/index.mjs`) sobre la capa de datos de
`importer/api.mjs`. Sin framework: un router por segmentos de URL.

- **Producción**: `https://fablab-api-sr1q.onrender.com/api`
- **Local**: `http://localhost:3001/api` (o `http://<IP-de-tu-PC>:3001/api` desde
  un teléfono en la misma red)
- **Puerto/host**: `PORT` (default `3001`), `HOST` (default `0.0.0.0`)
- **Healthcheck**: `GET /health` (en la raíz, **no** bajo `/api`)

## Convenciones

| Tema | Comportamiento |
|---|---|
| Formato | JSON UTF-8 (`application/json; charset=utf-8`) |
| Compresión | Respuestas > 1 KB con `Accept-Encoding: gzip` → `Content-Encoding: gzip` + `Vary: Accept-Encoding` |
| CORS | `Access-Control-Allow-Origin: *`, métodos `GET, POST, PUT, DELETE, OPTIONS`, headers `Content-Type, Authorization`. Preflight `OPTIONS` → `204` |
| Lectura | Siempre pública (`GET` y `HEAD`) |
| Escritura | Si el server corre con `API_TOKEN`, `POST/PUT/DELETE` exigen `Authorization: Bearer <token>`; si falta → `401` con `WWW-Authenticate: Bearer` |
| Errores | `{"error": "<mensaje en español>"}`. `400` campo inválido/faltante, `404` inexistente, `409` conflicto, `413` demasiado grande, `503` bloqueo ocupado, `500` fallo real del server (se registra en el log) |
| Cuerpo | Máximo **1 MB** por petición. Más grande (por `Content-Length` o por chunked) → `413`, y se rechaza **sin** bufferizarlo entero en memoria |
| JSON | Un cuerpo que no parsea → `400` "JSON inválido" (antes llegaba como `500`) |
| Ids de ruta | Enteros positivos (`1`…`2147483647`). `1.5`, `abc`, `0` o un id fuera de rango → `400`, no un `404`/`200 []` engañoso |
| Caché HTTP | Las imágenes usan `ETag` + `Cache-Control: public, max-age=31536000, immutable`; el JSON no lleva caché HTTP (la maneja la app y el TTL del server) |

Ejemplo de escritura:

```bash
TOKEN=$(cat ~/.config/fablab/api-token)
curl -s -X POST https://fablab-api-sr1q.onrender.com/api/traslados \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"elementoId":1,"salaNuevaId":4,"nota":"préstamo a CNC"}'
```

## Rutas

| # | Método | Ruta | Qué hace |
|---|---|---|---|
| 1 | GET | `/health` | Estado del servicio (no toca la BD) |
| 2 | GET | `/api/salas` | Salas con edificio y conteo de elementos |
| 3 | GET | `/api/elementos` | **Todo** el inventario en una respuesta (sin binarios) |
| 4 | GET | `/api/salas/:id/elementos` | Elementos de una sala (por id numérico) |
| 5 | GET·HEAD | `/api/elementos/:id/foto[?tam=miniatura]` | Foto o miniatura del elemento (ETag/304) |
| 6 | POST | `/api/elementos/:id/foto` | Subir/reemplazar foto ya reducida |
| 7 | DELETE | `/api/elementos/:id/foto` | Quitar la foto |
| 8 | GET | `/api/elementos/:id/historial` | Historial de traslados del elemento |
| 9 | POST | `/api/traslados` | Registrar traslado (transaccional) |
| 10 | POST | `/api/elementos` | Alta de elemento |
| 11 | PUT | `/api/elementos/:id` | Editar campos editables |
| 12 | POST | `/api/elementos/:id/codigo` | Asignar código a un elemento **sin** código |
| 13 | GET | `/api/export/{elementos,traslados}.{csv,json}` | Exportar inventario o traslados |
| 14 | DELETE | `/api/elementos/:codigo` | Eliminar elemento (y su historial) |

---

### 1. `GET /health`

```json
{ "ok": true, "service": "fablab-api" }
```

No consulta la base: sirve como healthcheck de Render y como **piso de red** al
medir rendimiento (ver [`rendimiento.md`](rendimiento.md)). Que no toque la BD
es a propósito: un hipo de Aiven no debe reiniciar el servicio web. Para saber si
la base responde está `/api/salas` (y el ping keep-alive del propio server).

### 2. `GET /api/salas`

Salas ordenadas por edificio y nombre, con su conteo:

```json
[
  { "id": 7, "nombre": "CNC 2026", "edificio": "FabLab", "elementos": 171 },
  { "id": 2, "nombre": "IOT 2026", "edificio": "FabLab", "elementos": 143 }
]
```

`elementos` es el conteo actual (los traslados lo mueven). Caché TTL 60 s.

### 3. `GET /api/elementos`

El inventario completo en un solo arreglo, ordenado por `sala_id` e `id`:

```json
[
  {
    "id": 1, "sala_id": 7, "codigo": "CNC-137",
    "detalle": "FOAMI …", "serial": null, "inventario": "…",
    "estado": null, "observaciones": null, "cantidad": "3",
    "foto_hash": null
  }
]
```

- `foto_hash`: `null` si el elemento no tiene foto; si la tiene, es la versión
  con la que la app arma `…/foto?tam=miniatura&v=<hash>`.
- **No** arrastra binarios. Con 917 elementos son ~173 KB de JSON → ~20 KB con
  gzip. Si arrastrara las fotos serían decenas de MB por carga.
- `estado` es `null` en los ~494 elementos que vienen de hojas sin esa columna.
- Caché TTL 60 s en el server; toda escritura la invalida.

### 4. `GET /api/salas/:id/elementos`

Elementos de una sala concreta, por **id numérico** (la app no la usa: carga
todo con la ruta 3; existe para otros consumidores y para los scripts de QA).

- `400` si el id no es numérico (`/salas/abc/elementos`).
- `404` si la sala no existe.
- Devuelve las columnas del elemento **sin** `foto_hash`.
- Caché TTL por sala (`elementos:sala:<id>`).

### 5. `GET|HEAD /api/elementos/:id/foto[?tam=miniatura]`

Devuelve la imagen **tal cual se guardó** (WebP o JPEG, sin gzip) con:

```
Content-Type: image/webp
Content-Length: 25610
ETag: "1dbd184729bf496e"
Cache-Control: public, max-age=31536000, immutable
Access-Control-Expose-Headers: ETag
```

- `?tam=miniatura` sirve la versión de 200 px (para listas); sin el parámetro,
  la de 800 px (ficha/modal).
- Si `If-None-Match` incluye el ETag → **`304`** (sin cuerpo). El server resuelve
  el 304 con **solo el hash**, sin leer el blob de la base.
- `HEAD` responde metadatos sin cuerpo (mismo ETag): es un GET sin cuerpo y no
  exige token.
- `404` si el elemento no tiene foto (o no existe); `400` si el id no es numérico.
- `ETag` = sha1 corto (16 hex) de los bytes de la foto, y es también el `v=` de
  la URL: la coherencia la garantiza el cliente, no el servidor.

```bash
curl -sI "https://…/api/elementos/7/foto?tam=miniatura&v=1dbd184729bf496e"
curl -s -o mini.webp "https://…/api/elementos/7/foto?tam=miniatura"
```

### 6. `POST /api/elementos/:id/foto`

Alta o reemplazo (upsert) de la foto. Cuerpo **ya reducido en el dispositivo**:

```json
{ "mime": "image/webp", "foto": "<base64>", "miniatura": "<base64>", "ancho": 800, "alto": 600 }
```

Respuesta `201`:

```json
{ "guardada": true, "elemento_id": 7, "hash": "1dbd184729bf496e",
  "bytes": 25610, "miniatura_bytes": 5498, "mime": "image/webp" }
```

Validaciones (`validarFoto`, en `importer/api.mjs`), todas con mensaje que dice
cuánto pesa y cuál es el límite:

| Condición | Estatus |
|---|---|
| `mime` distinto de `image/webp`/`image/jpeg` | `400` |
| Los bytes no empiezan con la firma del formato (`RIFF..WEBP` / `FFD8FF`) | `400` |
| Foto > **400 KB** | `413` |
| Miniatura > **80 KB** | `413` |
| Miniatura ≥ foto | `400` |
| Elemento inexistente | `404` |
| El cuerpo entero pasa de 1 MB (tope de la petición) | `413` |

Los mismos límites están en `src/lib/foto.ts` para avisar antes de gastar la
subida. Detalle del pipeline en [`fotos.md`](fotos.md).

### 7. `DELETE /api/elementos/:id/foto`

`200` con `{ "borrada": true, "elemento_id": 7 }`; `404` si el elemento no tenía
foto. Limpia la caché en RAM de ese elemento.

### 8. `GET /api/elementos/:id/historial`

Traslados del elemento, con nombres de sala (no ids):

```json
[
  { "id": 12, "fecha": "2026-09-24T03:11:07.000Z", "nota": null,
    "sala_anterior": "CNC 2026", "sala_nueva": "ALMACEN 2026" }
]
```

`[ ]` si nunca se movió; `404` si **el elemento no existe** (antes respondía
`200 []`, así que un id mal tecleado parecía un elemento sin traslados). Caché
TTL por elemento (`historial:<id>`), invalidada por cualquier escritura.

### 9. `POST /api/traslados`

Mueve un elemento y registra el movimiento **en una transacción** (las dos cosas
o ninguna):

```json
{ "elementoId": 7, "salaNuevaId": 4, "nota": "préstamo" }   // nota opcional
```

`201` → `{ "id": 31, "salaAnteriorId": 7, "salaNuevaId": 4 }`

- `400` si falta `elementoId` o `salaNuevaId`.
- `404` si el elemento o la sala destino no existen (antes revienteaba con 500
  de FK).
- `409` si el elemento **ya está** en esa sala.
- No es idempotente: el cliente no reintenta POSTs.

### 10. `POST /api/elementos`

```json
{ "sala_id": 7, "codigo": "CNC-172", "detalle": "…", "serial": null,
  "inventario": null, "estado": "BUENO", "observaciones": null, "cantidad": "1" }
```

`201` → `{ "id": 918, …campos }`

- `400` si falta `sala_id` o `codigo`.
- `404` si la sala no existe.
- `409` si **`codigo` ya existe**: el mensaje incluye el id del dueño
  (`El código CNC-172 ya existe (elemento 42)`). La columna no tiene índice
  `UNIQUE` por el duplicado heredado `IOT-79`, así que la unicidad la verifica
  el server antes de insertar.

### 11. `PUT /api/elementos/:id`

Actualiza **solo** los campos editables presentes en el cuerpo:
`detalle, serial, inventario, estado, observaciones, cantidad`.
`codigo` y `sala_id` no se tocan (la etiqueta impresa manda; moverse es un
traslado).

`200` → `{ "updated": true, "elemento": { …fila completa } }`

- `400` si no mandas ningún campo editable.
- `404` si el id no existe. Un `PUT` con el mismo valor sigue devolviendo `200`
  (MySQL cuenta filas *cambiadas*; la existencia se decide con un SELECT).

### 12. `POST /api/elementos/:id/codigo`

Rellena el `codigo` de un elemento que vino del Excel sin él. Formato:
`^[A-Z0-9][A-Z0-9-]{1,19}$` (2-20 caracteres A-Z, 0-9, guiones); el server lo
normaliza a mayúsculas.

`201` → `{ "asignado": true, "elemento": { … } }`

- `400` formato inválido.
- `404` elemento inexistente.
- `409` si el elemento **ya tiene** código (no se sobrescribe la etiqueta) o si
  el código ya está en uso.
- `503` si otra asignación de códigos está en curso (el lock se toma con un
  timeout de 5 s).
- En bloque, la herramienta es `npm run asignar:codigos` (ver
  [`importacion.md`](importacion.md)).

### 13. `GET /api/export/{elementos,traslados}.{csv,json}`

Volcado completo para respaldo o análisis.

- **CSV**: `text/csv; charset=utf-8`, **con BOM** (Excel respeta los acentos) y
  `Content-Disposition: attachment; filename="elementos.csv"`.
  - `elementos.csv`: `id, codigo, detalle, serial, inventario, estado, observaciones, cantidad, sala, edificio`
  - `traslados.csv`: `id, fecha, codigo, detalle, sala_anterior, sala_nueva, nota`
- **JSON**: arreglo de filas con esas mismas columnas (sí se comprime con gzip).
- Un nombre distinto (`/api/export/inventario.csv`) → `404`.

```bash
curl -s --compressed "https://…/api/export/elementos.json" -o backup.json
```

### 14. `DELETE /api/elementos/:codigo`

Borra por **código** (no por id). Es transaccional: primero borra los traslados
del elemento y luego el elemento (la FK de `traslados` no tiene
`ON DELETE CASCADE`; sin esto el DELETE fallaba con 500). La foto cae por
CASCADE. `DELETE` es idempotente: repetirlo devuelve `404`.

`200` → `{ "deleted": true, "codigo": "CNC-172" }` · `404` si no existe.

> **`409` si el código es ambiguo.** `codigo` no es único en el esquema (existe
> el duplicado heredado `IOT-79`), y un `DELETE` por código con dos coincidencias
> borraba la que devolviera la base primero. Ahora responde `409` y **no borra
> nada**: el duplicado se resuelve primero.

---

## Endurecimiento del borde HTTP

Cinco arreglos de la sesión de QA (2026-09-24), todos con su check en
`npm run qa`:

| Antes | Ahora |
|---|---|
| Cuerpo con JSON roto → `500` | `400` "JSON inválido" (y no ensucia el log de errores del server) |
| Cuerpo sin límite (2 MB se bufferizaban enteros) | tope de 1 MB → `413`, sin acumular |
| `GET /elementos/1.5/historial` → `200 []` | `400` (id no entero) |
| Dos altas simultáneas del mismo código → ambas `201` | lock con nombre: una `201`, el resto `409` |
| `DELETE` de un código duplicado borraba uno al azar | `409`, sin borrar |

```bash
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" \
  "https://…/api/elementos/CNC-172"
```

---

## Cómo cambia el contrato

- La fuente de verdad es el código: `server/index.mjs` (rutas y estatus) e
  `importer/api.mjs` (datos y validaciones). Este documento las describe, no las
  reemplaza: si cambias una, cambia la otra.
- Los scripts `scripts/qa-intensivo.mjs` y `scripts/benchmark.mjs` **ejercitan
  esta tabla** en cada corrida: si agregas una ruta, agrégalas ahí también (ver
  [`qa.md`](qa.md)).
