# Importación y utilidades de datos

El inventario nace de un Excel (`CNC 2026.xlsx`) con una hoja por sala. Este
documento cubre cómo se convierte a MySQL y las herramientas que lo mantienen
sano. **Ojo: la base de producción ya no es el Excel** — tiene 35 códigos
asignados y ediciones hechas por la app; reimportar pisa todo eso.

## Los dos generadores

Hay dos importadores y **no se mezclan en la misma base**:

| | `importer/schema.mjs` (vía `cli.mjs`) | `importer/normalizado.mjs` (vía `gen-normalizado.mjs`) |
|---|---|---|
| Forma | una hoja = una tabla | `edificios → salas → elementos` + `traslados` |
| Hojas | las que pases por `--hojas` | las 11 de `HOJAS` (FabLab + ViveLab) |
| Traslados | no | sí (historias de movimiento) |
| Escribe en MySQL | sí | no: imprime SQL |

**El vigente es el normalizado.** El primero fue el pedido inicial ("una hoja =
una tabla"), revisado después porque la app cubre dos edificios y hay que
registrar traslados entre salas.

### Mapa hoja → edificio/sala

`importer/normalizado.mjs:HOJAS` es el **único** lugar donde se declara qué hoja
del Excel es qué sala. Agregar una sala es agregar una línea ahí:

| Hoja del xlsx | Edificio | Sala |
|---|---|---|
| `CNC 2026` | FabLab | CNC |
| `IOT 2026` | FabLab | IoT |
| `RV-DRONES 2026` | FabLab | RV y Drones |
| `IMPRESION 3D 2026` | FabLab | Impresion 3D |
| `COWORKING 2026` | FabLab | Coworking |
| `RECEPCION 2026` | FabLab | Recepcion |
| `ALMACEN 2026` | FabLab | Almacen |
| `VIVE LAB- LAB IMAGEN AULA (305)` | ViveLab | Lab Imagen (305) |
| `VIVE LAB-BODEGA ` *(espacio final)* | ViveLab | Bodega |
| `VIVE LAB-AULA 303` | ViveLab | Aula 303 |
| `VIVE LAB-AULA 304` | ViveLab | Aula 304 |

Las 7 hojas `* 2026` comparten el encabezado canónico
(`CODIGO, DETALLE, SERIAL, INVENTARIO, ESTADO, OBSERVACIONES, CANTIDAD`);
`ALMACEN 2026` y las 4 de ViveLab traen las mismas menos `ESTADO`, que queda
`NULL`. Los encabezados se normalizan con alias (`NOMBRE`→`detalle`,
`N_INVENTARIO`→`inventario`, `OBSERVACION`→`observaciones`).

## Cargar el inventario

### Un paso (recomendado, Docker)

```bash
npm run seed -- "CNC 2026.xlsx"                 # hojas de HOJAS presentes
npm run seed -- "CNC 2026.xlsx" --hojas "CNC 2026,ALMACEN 2026"
npm run seed -- "CNC 2026.xlsx" --listar        # hojas del archivo, sin importar
npm run seed -- "CNC 2026.xlsx" --sql-only      # imprime el SQL, no toca la base
npm run seed -- "CNC 2026.xlsx" --sin-docker    # MySQL local por TCP
```

`scripts/seed.mjs` genera el SQL y lo carga en el contenedor `fablab-mysql` con
`--default-character-set=utf8mb4` (sin eso los acentos salen mojibake). Variables:
`MYSQL_CONTAINER` (default `fablab-mysql`), `MYSQL_HOST`, `MYSQL_PORT` (default
`13306`), `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`.

> **La importación SIEMPRE vacía la base** (`DROP TABLE` en el DDL): una
> reimportación pisa cualquier edición hecha a mano.

### Dos pasos (SQL a la vista)

```bash
node importer/gen-normalizado.mjs "CNC 2026.xlsx" > /tmp/inventario.sql
docker exec -i fablab-mysql mysql --default-character-set=utf8mb4 -u root -pfablab fablab < /tmp/inventario.sql
```

El SQL generado no es la fuente de verdad y no se versiona: se regenera en un
comando. El dump que sí viaja al repo de deploy es `ddl-data.sql`.

### Importador legacy

```bash
node importer/cli.mjs --listar "CNC 2026.xlsx"
MYSQL_DATABASE=fablab node importer/cli.mjs --archivo "CNC 2026.xlsx" --hojas "CNC 2026,IOT 2026"
node importer/cli.mjs --archivo "CNC 2026.xlsx" --sql-only > /tmp/legacy.sql
```

## Utilidades

### `npm run asignar:codigos` — códigos para elementos sin código

```bash
npm run asignar:codigos                  # dry-run contra la BD local
npm run asignar:codigos -- --api         # dry-run contra producción (GET público)
npm run asignar:codigos -- --api --escribir   # escribe en producción vía API (token)
npm run asignar:codigos -- --db --escribir    # escribe directo en la BD local
npm run asignar:codigos -- --sql         # imprime los UPDATE para correrlos a mano
```

Continúa la numeración que ya usa cada sala tomando el prefijo dominante
(`CNC-01…CNC-136` → `CNC-137…`), en vez de inventar una familia nueva: el personal
sigue reconociendo el código y la etiqueta coincide con el Excel. **Solo rellena
vacíos** (el server responde 409 si el elemento ya tiene código). Corrido en
producción el 2026-09-24: 35 elementos → `CNC-137…CNC-171`, 0 sin código.
Antes de escribir en producción: `npm run backup:remoto`.

### `npm run fix:mojibake` — acentos dobles

```bash
npm run fix:mojibake                    # dry-run: reporta sin escribir
npm run fix:mojibake -- --files         # repara ddl-data.sql + data-elementos.csv
npm run fix:mojibake -- --db            # repara la BD (Docker local)
npm run fix:mojibake -- --api           # repara producción vía la API (preserva ediciones)
npm run fix:mojibake -- --check         # estado de los tres frentes; exit 1 si hay mojibake
```

Origen: el dump/CSV se generó cargando el SQL con un cliente `mysql` sin
`--default-character-set=utf8mb4`, y cada acentuado quedó como sus bytes UTF-8
leídos como Latin-1 (`proyecciÃ³n`). No hace un roundtrip ciego: reemplaza una
lista cerrada de tokens y **aborta** si quedan `Ã`/`Â` sueltos, para no
corromper más. `seed.mjs` hoy falla si detecta mojibake después de cargar.
Tras reparar la BD, conviene regenerar dump/CSV desde ella (`mysqldump`) para que
fuente y artefactos coincidan.

### `node importer/self-check.mjs` — validaciones sin MySQL

5 bloques que corren sin base de datos: DDL/DML del normalizado, la capa de API
(con `validarFoto`, `validarAsignacion`… funciones puras) y los códigos. Se corre
en cada sesión de trabajo; ver [`qa.md`](qa.md).

### `npm run verify:datamatrix` — estructura de los símbolos

Verifica con un decodificador independiente que los Data Matrix generados son
estructuralmente válidos (matriz, zona de silencio, patrón de temporización).
Su limitación (no decodifica modo C40) está explicada en [`qa.md`](qa.md).

## Cuándo usar qué

| Quiero… | Herramienta | ¿Toca producción? |
|---|---|---|
| Cargar el inventario desde cero en local | `npm run seed -- "xlsx"` | No (Docker) |
| Ver el SQL que se generaría | `gen-normalizado.mjs`, `--sql-only` | No |
| Editar un elemento | La app (o `PUT /api/elementos/:id`) | Sí, con token |
| Asignar códigos a los que no tienen | `asignar:codigos` (`--api`) | Con `--escribir` |
| Reparar acentos | `fix:mojibake` (`--api`) | Con flags explícitos |
| Respaldar antes de tocar nada | `npm run backup:remoto` | No (solo lee) |

## Trampas conocidas

- **Las 4 copias del xlsx no son idénticas.** 21 de 22 hojas sí, pero
  `RECEPCION 2026` cambia: solo `CNC 2026.xlsx` tiene 12 cantidades que las otras
  dejaron en blanco. Esa es la copia buena y la que está cargada; importar desde
  otra pierde esas 12 cantidades **en silencio**.
- **`RECEPCION 2026` y las de ViveLab sin `ESTADO`** dejan 494 filas con NULL.
- **Volver a importar borra** los traslados registrados y las fotos (las tablas
  se recrean). Nunca reimportar sobre producción.
