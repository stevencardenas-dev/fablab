# scripts/

Herramientas de línea de comandos. Las que escriben en una base son **dry-run por
defecto** y piden una opción explícita para aplicar. Antes de tocar producción:
`npm run backup:remoto`.

## Verificación

| Script | npm | Qué comprueba |
|---|---|---|
| `verify-import.mjs` | `verify:import` | importación CSV/Excel contra MySQL real (33 casos) |
| `verify-auditoria.mjs` | `verify:auditoria` | que cada escritura deje su fila en `auditoria` |
| `verify-datamatrix.mjs` | `verify:datamatrix` | que los Data Matrix generados se decodifiquen bien |
| `verificar-impresion.mjs` | `verify:impresion` | la hoja de etiquetas impresa de verdad (Carta/A4/Oficio) |
| `verificar-docs.mjs` | `docs:check` | enlaces de la documentación y rutas de `docs/api.md` |
| `qa-intensivo.mjs` | `qa` | la API en vivo, con registros temporales que se borran solos |
| `benchmark.mjs` | `bench` | tiempos de cada operación frente al piso de red |

## Datos

| Script | npm | Qué hace |
|---|---|---|
| `seed.mjs` | `seed` | carga el inventario de un Excel en el MySQL local |
| `reconciliar-archivos.mjs` | — | deja la base 1:1 con un libro de inventario (`--aplicar`) |
| `asignar-codigos.mjs` | `asignar:codigos` | da código a los elementos que no tienen |
| `migrar-esquema.mjs` | `migrar:esquema` | aplica cambios de esquema sin borrar datos |
| `fix-mojibake.mjs` | `fix:mojibake` | repara texto con doble codificación ("proyecciÃ³n") |
| `fotos-demo.mjs` | `fotos:demo` | prueba de carga con la misma foto en todos (reversible) |
| `backup-remoto.mjs` | `backup:remoto` | respaldo JSON de producción vía la API |

## Despliegue

| Script | npm | Qué hace |
|---|---|---|
| `sync-deploy.mjs` | `sync:deploy` | copia el monorepo a los repos de deploy de Render (`--push api,web`) |

## Auxiliares

- `cargador-ts.mjs`, `resolutor-alias.mjs`: permiten que los scripts importen código
  TypeScript de `src/` con el alias `@/`.
- `pdf.mjs`: lector mínimo de PDF que usa `verificar-impresion.mjs`.
- `demo-foto/`: imágenes de la prueba `fotos:demo`.
- `reset-project.js`: de la plantilla de Expo. **No usar:** reemplaza `src/app` por
  una app vacía.
