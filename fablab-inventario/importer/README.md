# Importador xlsx -> MySQL

Pasa el inventario de FabLab de xlsx a una base MySQL. El DDL se deriva de la
estructura de cada hoja y el DML de su contenido, como se pidio: una hoja = una sala = una tabla.

## Uso

```bash
# 1. ver que hojas trae el archivo (nombre, filas, columnas)
node importer/cli.mjs --listar "CNC 2026.xlsx"

# 2. importar las hojas elegidas (vacia la base actual primero)
MYSQL_DATABASE=fablab node importer/cli.mjs --archivo "CNC 2026.xlsx" \
  --hojas "CNC 2026,IOT 2026,RV-DRONES 2026"

# sin --hojas importa todas las hojas con datos
# --sql-only imprime el SQL y no toca la base
node importer/cli.mjs --archivo "CNC 2026.xlsx" --sql-only > inventario.sql
```

## Conexion

Por variables de entorno: `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`,
`MYSQL_DATABASE` (default `fablab`), `MYSQL_SOCKET`.

En este equipo MariaDB pide socket y root:

```bash
sudo env MYSQL_SOCKET=/run/mysqld/mysqld.sock MYSQL_DATABASE=fablab \
  node importer/cli.mjs --archivo "CNC 2026.xlsx"
```

## Dos esquemas

Hay dos generadores. Deciden cosas distintas y **no se mezclan en la misma base**:

| | `schema.mjs` (via `cli.mjs`) | `normalizado.mjs` (via `gen-normalizado.mjs`) |
|---|---|---|
| Forma | una hoja = una tabla | `edificios -> salas -> elementos` + `traslados` |
| Hojas | las que se pasen por `--hojas` | las 11 de `HOJAS` (FabLab 2026 + ViveLab) |
| Traslados | no | si |
| Escribe en MySQL | si | no, solo imprime SQL |

El normalizado es el que pidio Keven despues de revisar el primero: la app
cubre FabLab y ViveLab y hay que registrar traslados entre salas.

```bash
node importer/gen-normalizado.mjs "CNC 2026.xlsx" > inventario-normalizado.sql
mysql fablab < inventario-normalizado.sql
```

Las 6 hojas `* 2026` de FabLab comparten 7 columnas; `ALMACEN 2026` y las 4
`VIVE LAB-*` traen las mismas menos `ESTADO`, que queda NULL. Por eso un solo
`elementos` cubre los dos edificios.

## Lectura para el frontend

`importer/api.mjs` trabaja sobre el **esquema normalizado**:

- `listarSalas()` -> salas con su edificio y conteo de elementos.
- `listarElementos(sala)` -> elementos de una sala (id o nombre).
- `registrarTraslado({ elementoId, salaNuevaId, nota })` -> inserta el traslado
  y mueve el elemento en una transaccion (las dos cosas o ninguna).
- `historialElemento(id)` -> traslados del elemento, con nombres de sala.

Nombre de sala repetido en dos edificios: `listarElementos` exige el id.

## Notas

- **Vacia la base en cada importacion**, como se especifico: borra todas las
  tablas del schema antes de cargar. No hay historial; una reimportacion pisa
  cualquier edicion hecha a mano.
- Todas las columnas son texto. `CANTIDAD` mezcla `12`, `-` e `INCONTABLE`,
  asi que tipar numerico perderia datos.
- Las 7 hojas `* 2026` comparten encabezado (CODIGO, DETALLE, SERIAL,
  INVENTARIO, ESTADO, OBSERVACIONES, CANTIDAD) y coinciden con `InventoryItem`
  de `src/lib/inventory.ts`.

```bash
node importer/self-check.mjs   # valida DDL/DML sin tocar MySQL
```
