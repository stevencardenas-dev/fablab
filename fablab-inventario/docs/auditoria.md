# Bitácora de auditoría

Desde 2026-10-15 cada escritura que cambia el inventario deja una fila en la tabla
`auditoria`. La fila se escribe **en la misma transacción** que el cambio: si el
cambio se revierte (error, 404, código duplicado), su registro también desaparece,
así que la bitácora no puede contar algo que no pasó.

## Qué se registra

| `accion` | Cuándo | `antes` | `despues` |
|---|---|---|---|
| `alta` | `POST /api/elementos` | — | sala y campos del elemento nuevo |
| `edicion` | `PUT /api/elementos/:id` | solo los campos que **cambiaron** | sus valores nuevos |
| `baja` | `DELETE /api/elementos/:codigo` | la fila completa | — |
| `traslado` | `POST /api/traslados` | `sala_id` anterior | `sala_id` nuevo y nota |
| `codigo` | `POST /api/elementos/:id/codigo` | código anterior (vacío) | código asignado |
| `foto_subir` | `POST /api/elementos/:id/foto` | hash de la foto anterior, si había | hash, tipo y tamaño (nunca los bytes) |
| `foto_borrar` | `DELETE /api/elementos/:id/foto` | — | — |
| `importar` | `POST /api/import/elementos` | — | cuántas filas entraron y cuántas se omitieron |

Una edición que manda los mismos valores que ya había no deja fila. La `baja`
guarda el elemento entero, así que lo borrado sigue siendo consultable.

## Estructura

| Columna | Tipo | Contenido |
|---|---|---|
| `id` | INT | autoincremental |
| `fecha` | DATETIME(3) | momento del cambio (milisegundos) |
| `accion`, `entidad` | VARCHAR | ver la tabla de arriba; `entidad` es `elemento`, `foto` o `importacion` |
| `entidad_id` | INT | id del elemento |
| `codigo` | VARCHAR(64) | código del elemento en ese momento (sobrevive a la baja) |
| `antes`, `despues` | JSON | valores |
| `origen` | VARCHAR | `api` |
| `actor` | VARCHAR | **vacío por ahora** (ver Límites) |

La tabla se crea sola al arrancar el server (`asegurarAuditoria` en
`importer/api.mjs`), con índices por fecha y por elemento.

## Consultas útiles

Historia completa de un elemento:

```sql
SELECT fecha, accion, antes, despues FROM auditoria WHERE codigo = 'CNC-137' ORDER BY id;
```

Todo lo que cambió en un día:

```sql
SELECT fecha, accion, codigo, antes, despues FROM auditoria WHERE DATE(fecha) = '2026-10-20' ORDER BY id;
```

Qué se borró y cómo era:

```sql
SELECT fecha, codigo, antes FROM auditoria WHERE accion = 'baja' ORDER BY id DESC;
```

## Límites

- **No registra quién.** La escritura usa un token compartido, así que el server no
  sabe qué persona hizo el cambio. La columna `actor` ya existe y queda vacía hasta
  que haya inicio de sesión (cuenta institucional o token por persona). Decisión del
  2026-10-09: registrar qué y cuándo ahora, el quién después.
- **No hay pantalla ni ruta para leerla**: se consulta con SQL. Agregar una ruta es
  una decisión aparte (quién puede ver la bitácora).
- Los cambios hechos directo en la base, fuera de la API, no quedan registrados.

## Prueba

`npm run verify:auditoria` levanta el server contra MySQL local y comprueba con la
base que alta, edición, traslado y baja dejan exactamente una fila correcta, y que
una edición sin cambios, un 404 y un código duplicado no dejan ninguna. Resultado
del 2026-10-15: 7 de 7.
