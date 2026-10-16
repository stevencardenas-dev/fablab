# server/

La API REST del inventario: un solo archivo, `index.mjs`, sobre `node:http` sin
framework. Recibe las peticiones de la app y deja la lógica de datos a
[`../importer/api.mjs`](../importer/api.mjs).

## Qué hace

- **Rutas** (14): lectura del inventario, salas, historial, fotos, exportación;
  alta, edición, traslado, baja, asignación de código, fotos e importación.
  Contrato completo: [`../docs/api.md`](../docs/api.md).
- **Protección:** token en las escrituras (`API_TOKEN`), límite de escrituras por IP
  (`LIMITE_ESCRITURAS_MIN`), CORS configurable (`CORS_ORIGIN`), tope de tamaño del
  cuerpo e ids validados.
- **Al arrancar** asegura el esquema (fotos, auditoría, salas nuevas, unicidad de
  `codigo`) y precarga las miniaturas en memoria. Ver
  [`../docs/operacion.md`](../docs/operacion.md#al-arrancar-el-server).

## Correr

```bash
node server/index.mjs
```

Escucha en `PORT` (3001 por defecto) y se conecta a MySQL con las variables
`MYSQL_*` (ver [`../docs/base-de-datos.md`](../docs/base-de-datos.md#conexión)).
