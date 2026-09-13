# HANDOFF — Inventario FabLab / Seminario Integrador II

Última sesión: 2026-09-13

## State

**Base de datos: hecha y verificada.** El inventario de Excel está migrado a
MySQL con esquema normalizado. 916 elementos, 11 salas, 2 edificios (FabLab y
ViveLab). Conteos verificados uno a uno contra las hojas de origen.

**Documento: capítulos 1-3 escritos**, en un solo archivo, exportado a ODT.
Falta la pasada de APA.

**App: sin tocar.** Sigue leyendo AsyncStorage con 5 salas hardcodeadas. No lee
la base de datos. Este es el hueco para el "avance tangible".

7 commits sin pushear en `feature/inventario-scan`.

## Next

1. **Pushear.** `git push origin feature/inventario-scan` (7 commits).
2. **Conectar la app a la base.** Es lo único que falta para la demo. La API ya
   está lista y probada (`importer/api.mjs`); falta consumirla desde
   `src/lib/inventory.ts`, que hoy usa AsyncStorage con `Rooms` hardcodeado
   (5 salas, sin ViveLab; la base tiene 11 en 2 edificios).
3. **Pasada de APA al documento.** Detalle en la nota al final de
   `documento/documento-integrador.md`:
   - faltan autor y año en varios antecedentes (sacarlos de la portada de cada
     documento original);
   - falta fuente citable para §2.2.3 (Codd) y §2.2.4 (React Native/Expo);
   - las cifras de §2.4.1 (3 mm / 20 mm, 50 % / 30 %) salen de documentación de
     fabricantes de equipos de marcaje, no de fuente académica. Respaldar con la
     norma antes de entregar.
4. **Decidir qué pasa con `schema.mjs`.** Quedaron dos generadores. Si el
   normalizado es el definitivo, el otro sobra y `importer/` adelgaza.

## Pointers

- `fablab-inventario/importer/normalizado.mjs:22` — `HOJAS`, el mapa hoja →
  edificio/sala. Es el único lugar donde se declara qué hoja del xlsx es qué
  sala; agregar una sala se hace acá.
- `fablab-inventario/importer/normalizado.mjs:30` — `DDL`, el esquema completo
  (edificios/salas/elementos/traslados).
- `fablab-inventario/importer/api.mjs` — lectura para el frontend:
  `listarSalas`, `listarElementos`, `registrarTraslado` (transaccional),
  `historialElemento`.
- `fablab-inventario/src/lib/inventory.ts:14` — `Rooms` hardcodeado. Punto de
  entrada para el paso 2.
- `fablab-inventario/importer/self-check.mjs` — 3 bloques de checks, corre sin
  MySQL: `node importer/self-check.mjs`.
- `documento/documento-integrador.md` — fuente del documento. El ODT se
  regenera, no se edita a mano.

## Comandos

```bash
# regenerar SQL desde el xlsx (el .sql no está en git, se regenera)
node importer/gen-normalizado.mjs "/home/alvaro/CNC 2026.xlsx" > inventario-normalizado.sql

# cargar
sudo mysql fablab_norm < inventario-normalizado.sql

# regenerar el ODT
cd documento && pandoc documento-integrador.md -o documento-integrador.odt --toc --toc-depth=2 -V lang=es

# checks
node importer/self-check.mjs && node scripts/verify-datamatrix.mjs && npm test
```

## Decisions

- **Esquema normalizado en vez de una tabla por sala** (2026-09-12). El primer
  pedido de Keven era una hoja = una tabla; él mismo lo revisó después porque la
  app cubre FabLab y ViveLab y hay que registrar traslados. Estructura:
  `edificios → salas → elementos` + `traslados`. Los dos generadores conviven
  pero **no se mezclan en la misma base**.
- **Todo texto salvo las FK.** `CANTIDAD` mezcla `12`, `-` e `INCONTABLE`.
  Tipar numérico perdería datos. Castear cuando la fuente esté limpia.
- **Las 4 copias del xlsx NO son idénticas** (2026-09-13). 21 de 22 hojas sí,
  pero `RECEPCION 2026` difiere: la copia `CNC 2026.xlsx` tiene 12 cantidades
  que las otras tres tienen en blanco. **Esa es la copia buena y es la que está
  cargada.** Importar desde otra pierde esas 12 cantidades en silencio. Vale
  decírselo a Ricardo: es argumento para que la base sea la fuente única.
- **Una sola tabla `elementos` para los dos edificios.** Las 4 hojas de ViveLab
  tienen las mismas columnas que `ALMACEN 2026` (las 7 menos `ESTADO`), así que
  el edificio es una fila, no un esquema aparte. `estado` queda NULL en 494
  elementos.
- **El SQL generado no va a git.** Se regenera desde el xlsx en un comando.
- **§2.1 es estado del arte, no línea de tiempo** (2026-09-13). Lo primero que
  se escribió era la historia del DataMatrix sin citar un solo trabajo previo.
  Ahora son 7 antecedentes con tabla comparativa. El vacío que sostiene el
  proyecto: ninguno usa DataMatrix, ninguno registra traslados, ninguno modela
  jerarquía de dos niveles.
- **Diseño pre-experimental, declarado como tal.** Keven pidió
  "Cuantitativa/Experimental", pero un solo laboratorio sin grupo de control no
  es experimental. Está escrito como pre-experimental con la limitación
  explícita en §3.1 y §3.5. Si el profesor lo quiere de otra forma, es decisión
  de ustedes.

## Contexto

El pedido viene por WhatsApp de Keven, no hay outline escrito del profesor
(Ricardo). El outline de capítulos que se siguió lo transcribió Keven el
2026-09-12. Ricardo pidió avances; el plan era mostrarle capturas de la base.
