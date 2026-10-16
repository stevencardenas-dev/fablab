# Base de datos

MySQL 8, esquema relacional normalizado. En producción: **Aiven** (plan free
1 GB, db `defaultdb`, prosa con TLS). En local: **Docker**
(`docker compose up -d` en la raíz del monorepo, contenedor `fablab-mysql`).

## Modelo

```
edificios ──1:N──► salas ──1:N──► elementos ──1:1──► elemento_fotos
                                     │
                                     └──1:N──► traslados ──► salas (origen/destino)
```

| Tabla | Filas hoy | Para qué |
|---|---|---|
| `edificios` | 2 (`FabLab`, `ViveLab`) | Agrupar salas por edificio |
| `salas` | 13 | Cada hoja 2026 del Excel es una sala (Estudio TV y Papeleria desde 2026-10-09) |
| `elementos` | **1 450** | El inventario (una fila por elemento/fila de la hoja) |
| `traslados` | variable | Historial de movimientos entre salas |
| `elemento_fotos` | 0 (ver [`fotos.md`](fotos.md)) | Foto 800 px + miniatura 200 px por elemento |
| `auditoria` | crece con cada escritura | Bitácora de cambios (ver [`auditoria.md`](auditoria.md)) |

## DDL

La definición completa vive en `importer/normalizado.mjs` (constante `DDL`) y se
usa **solo al crear la base desde cero** (borra las tablas antes: una
reimportación pisa cualquier edición hecha a mano).

```sql
CREATE TABLE `edificios` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `nombre` VARCHAR(64) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `salas` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `edificio_id` INT NOT NULL,
  `nombre` VARCHAR(64) NOT NULL,
  UNIQUE KEY `uq_sala` (`edificio_id`, `nombre`),
  FOREIGN KEY (`edificio_id`) REFERENCES `edificios`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `elementos` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `sala_id` INT NOT NULL,
  `codigo` VARCHAR(64) NULL,
  `detalle` VARCHAR(255) NULL,
  `serial` VARCHAR(64) NULL,
  `inventario` VARCHAR(64) NULL,
  `estado` VARCHAR(64) NULL,
  `observaciones` VARCHAR(255) NULL,
  `cantidad` VARCHAR(64) NULL,
  KEY `ix_sala` (`sala_id`),
  FOREIGN KEY (`sala_id`) REFERENCES `salas`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `traslados` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `elemento_id` INT NOT NULL,
  `sala_anterior_id` INT NULL,
  `sala_nueva_id` INT NOT NULL,
  `fecha` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `nota` VARCHAR(255) NULL,
  FOREIGN KEY (`elemento_id`) REFERENCES `elementos`(`id`),
  FOREIGN KEY (`sala_anterior_id`) REFERENCES `salas`(`id`),
  FOREIGN KEY (`sala_nueva_id`) REFERENCES `salas`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`elemento_fotos` (misma definición que `DDL_FOTOS` en `importer/api.mjs`, que es
la que el servidor aplica al arrancar):

```sql
CREATE TABLE IF NOT EXISTS `elemento_fotos` (
  `elemento_id` INT NOT NULL PRIMARY KEY,
  `mime` VARCHAR(32) NOT NULL,
  `ancho` SMALLINT UNSIGNED NULL,
  `alto` SMALLINT UNSIGNED NULL,
  `bytes` INT UNSIGNED NOT NULL,
  `hash` CHAR(16) NOT NULL,
  `foto` MEDIUMBLOB NOT NULL,
  `miniatura` MEDIUMBLOB NOT NULL,
  `actualizado` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`elemento_id`) REFERENCES `elementos`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Índices

| Índice | Dónde | Notas |
|---|---|---|
| `ix_sala` | `elementos(sala_id)` | Viene del DDL |
| `uq_sala` | `salas(edificio_id, nombre)` | El nombre de sala es único **por edificio**, no global |
| `PRIMARY KEY` | `elemento_fotos(elemento_id)` | Relación 1:1 |
| `uq_codigo` | `elementos(codigo)` | **UNIQUE**, lo crea `asegurarCodigoUnico()` al arrancar el server (idempotente) |

`uq_codigo` es `UNIQUE`: un código, un elemento. Costó llegar ahí porque la base
traía un duplicado heredado (`IOT-79` repetido, ver
[`problemas-conocidos.md`](problemas-conocidos.md)) y con él MySQL no acepta el
índice. Hoy el arranque repara ese tipo de dato **primero** y crea el índice
después, así que la unicidad la garantiza la base: un `INSERT`/`UPDATE` que
repita un código falla con `ER_DUP_ENTRY` (errno `1062`) y el server lo traduce a
`409` con el id del dueño.

Antes esto se sostenía con un lock con nombre (`GET_LOCK('fablab:codigo-unico')`):
el servidor hacía `SELECT` y después `INSERT`, y sin serializar había ventana de
carrera (dos altas simultáneas del mismo código pasaban las dos). El índice
UNIQUE cierra esa ventana **sin lock y sin round-trips extra**. `ix_codigo` —el
índice normal anterior— se retira al crear el UNIQUE: un único sirve las mismas
búsquedas, tener los dos era pagar dos índices por lo mismo.

**Estado degradado.** Si quedaran duplicados, MySQL rechaza el UNIQUE (errno
`1062`), el arranque lo avisa en el log y se conserva el índice normal: las
escrituras vuelven al chequeo a mano, que protege contra duplicados existentes
pero no tiene garantía ante escrituras simultáneas. Es el único caso en que el
servidor no delega la unicidad en la base.

El **borrado por código** sigue siendo explícito: si hubiera más de un elemento
con ese código, `DELETE /api/elementos/:codigo` responde `409` y no borra nada
(antes hacía `SELECT` sin `LIMIT` y borraba el que devolviera la base primero).
Con `uq_codigo` el caso es imposible, pero el guardián se queda: borrar por
código es destructivo y una base degradada sigue existiendo.

### Tipos y por qué

- **Todo texto salvo las claves.** La columna `CANTIDAD` del Excel mezcla `12`,
  `-` e `INCONTABLE`; tipar numérico perdería datos. Castear cuando la fuente
  esté limpia.
- **`codigo` NULL permitido.** 35 filas vinieron sin N° de inventario; hoy todas
  ya tienen código (asignados con `npm run asignar:codigos`, `CNC-137…CNC-171`),
  pero la columna sigue aceptando NULL.
- **`estado` NULL en ~494 filas**: las hojas `ALMACEN 2026` y `VIVE LAB-*` no
  traen esa columna.
- **`elemento_fotos` en tabla aparte** para que `GET /api/elementos` (917 filas)
  nunca arrastre binarios; y con `ON DELETE CASCADE`, así borrar el elemento
  limpia la foto solo.

## Migraciones (sin borrar datos)

El DDL de arriba solo corre al crear la base desde cero. Para una base viva hay
dos vías **idempotentes** — se pueden correr las veces que sea necesario:

1. **Automática, al arrancar el server** (`server/index.mjs`):
   - `asegurarEsquemaFotos()` crea `elemento_fotos` si falta
     (errno `1146` en el `LEFT JOIN` del listado también está contemplado: el
     inventario degrada a "sin fotos" con un aviso en el log en vez de caerse).
   - `repararCodigosDuplicados()` repara los `codigo` repetidos que queden (ver
     abajo). Va **antes** del índice: con duplicados, MySQL no deja crearlo.
   - `asegurarCodigoUnico()` crea `uq_codigo` (ignora `ER_DUP_KEYNAME`, errno
     `1061`, si ya estaba) y retira `ix_codigo`. Con duplicados vivos devuelve
     `'duplicados'`: se conserva el índice normal y el arranque lo avisa.
   - Es la única forma de tocar la base de Aiven: no hay credenciales de esa base
     fuera de Render (ver [`operacion.md`](operacion.md)).
2. **Manual** (`npm run migrar:esquema` → `scripts/migrar-esquema.mjs`):
   - `--check` solo informa qué falta (exit 1 si falta algo);
   - sin `--check` aplica lo que falte y resume el estado (incluye la misma
     reparación de duplicados y el índice UNIQUE);
   - comparte DDL y funciones con el server (`DDL_FOTOS`,
     `repararCodigosDuplicados`, `asegurarCodigoUnico` en `importer/api.mjs`),
     así que no hay dos definiciones que se separen.

### Reparación de códigos duplicados (la única migración de datos)

Existe por un caso concreto: el Excel original escribió `IOT-79` dos veces (una
silla y una mesa, ids 246 y 247). La regla es la del primer registro —**el id más
bajo conserva el código**— porque es el orden en que aparecen en el origen y es
la única que se puede aplicar sin criterio humano en un arranque; los demás
reciben el siguiente código libre de su propia familia (`IOT-79` → el primero
libre a partir de 80 → `IOT-88`, respetando el relleno con ceros de familias como
`VL-303-05`). Cada recodificación se registra con su sentencia de reversión:

```
[datos] código duplicado reparado: elemento 247 · IOT-79 → IOT-88
[datos]   reversión: UPDATE elementos SET codigo='IOT-79' WHERE id=247
```

Es idempotente: sin duplicados devuelve `[]` y no toca nada. La decisión es pura
(`planRepararDuplicados`, `siguienteCodigoLibre` en `importer/api.mjs`) y el
`self-check` la cubre sin base, con el caso real incluido.

## Conexión

`conexionDesdeEnv()` (`importer/importar.mjs`) arma la configuración desde el
entorno, con estos defaults:

| Variable | Default | Notas |
|---|---|---|
| `MYSQL_HOST` | `localhost` | En producción: host de Aiven |
| `MYSQL_PORT` | `13306` | Ver la trampa del Docker de abajo |
| `MYSQL_USER` | `root` | |
| `MYSQL_PASSWORD` | `fablab` | |
| `MYSQL_DATABASE` | `fablab` | En Aiven es `defaultdb` |
| `MYSQL_SOCKET` | — | Alternativa a host/puerto (MariaDB local) |
| `MYSQL_SSL` | — | `1` activa TLS (bases administradas); `MYSQL_SSL_STRICT=1` valida el certificado |

> **Trampa:** `docker-compose.yml` publica MySQL en `3306:3306`, pero el default
> del código es `13306`. Con el compose tal cual, corre con
> `MYSQL_PORT=3306` o cambia el mapeo a `"13306:3306"`. Si la conexión falla con
> "ECONNREFUSED 13306" es esto.

### Docker local

```bash
docker compose up -d                 # contenedor fablab-mysql
npm run seed -- "CNC 2026.xlsx"      # carga el inventario real (utf8mb4)
MYSQL_PORT=3306 node server/index.mjs
```

## Respaldos y restauración

- **Antes de cualquier operación en producción: `npm run backup:remoto`**
  (`scripts/backup-remoto.mjs`). Descarga
  `/api/export/elementos.json` y `/api/export/traslados.json` a `backups/` con
  fecha y hora. El JSON preserva los campos tal como la API los ve.
- **Restaurar** no es un comando único: ese JSON es un volcado lógico, no un
  `mysqldump`. Para reinsertar hay que respetar el esquema (o regenerar el dump
  completo con `mysqldump` si se tienen credenciales de la base).
- **En el despliegue con Docker sí hay `mysqldump`:** `sh docker/respaldo.sh` deja
  `docker/respaldos/fablab-*.sql.gz` (30 días). La restauración se probó el
  2026-10-15: el respaldo cargado en una base vacía dio los mismos 2 edificios,
  13 salas y 1 450 elementos, con el mismo `CHECKSUM TABLE` de `elementos`
  (ver [`docker/README.md`](../docker/README.md)).
- **Manifiestos de reversión**: las pruebas en vivo dejan su plan exacto en
  `backups/` (p. ej. `fotos-demo-*.json`), para poder deshacer solo lo que se
  tocó (ver [`fotos.md`](fotos.md)).
- **Nunca** resetear la contraseña de `avnadmin` ni copiar tokens al repo.

## Carga inicial desde el Excel

El detalle está en [`importacion.md`](importacion.md). En corto:
`gen-normalizado.mjs` (o `npm run seed`) genera el SQL desde el xlsx, que no
vive en git porque se regenera en un comando.

## Qué se guarda hoy (2026-10-15)

- **1 450 elementos, 13 salas, 2 edificios**, todos con código y sin duplicados.
- La base es **1:1 con el último libro** de los stakeholders (hojas 2026, VIVE LAB,
  Estudio TV y Papelería). La reconciliación (2026-10-09) borró 35 elementos que
  ya no estaban en el libro, agregó 485, completó 187 nombres vacíos y movió 1;
  se hace y se verifica con `scripts/reconciliar-archivos.mjs` (dry-run por defecto).
- Quedan **14 códigos distintos** entre la base y el libro (CNC-166…171, IOT-88,
  ALM-1…9): no se cambian hasta revisar las etiquetas impresas.
- 52 elementos sin nombre, porque el libro también los trae vacíos.
- Las hojas viejas (`SALA (…)`, `AREA DE RECEPCION…`, `ALMACEN`, `INGRESOS`, de
  2024) no se cargan: el inventario vigente son las hojas 2026.
