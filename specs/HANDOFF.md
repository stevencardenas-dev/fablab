# HANDOFF — Inventario FabLab / Seminario Integrador II

Última sesión: 2026-09-13 (sesión 2 — documento, APA, presentación)

## State

**Base de datos: hecha y verificada.** El inventario de Excel está migrado a
MySQL con esquema normalizado. 916 elementos, 11 salas, 2 edificios (FabLab y
ViveLab). Conteos verificados uno a uno contra las hojas de origen.

**Documento: capítulos 1-3 escritos y pasada de APA HECHA.** 15 páginas.
Portada APA, 12 referencias, 16 citas en texto, 5 tablas numeradas, cronograma
nuevo en §3.5. Entregables renombrados con la convención de los compañeros
(título en mayúsculas):

- `documento/SISTEMA DE CONTROL DE INVENTARIO DEL FABLAB UFPS.odt`
- `documento/SISTEMA DE CONTROL DE INVENTARIO DEL FABLAB UFPS.pdf`
- `documento/CRONOGRAMA SISTEMA DE CONTROL DE INVENTARIO DEL FABLAB UFPS.xlsx`
- `PRESENTACION SISTEMA DE CONTROL DE INVENTARIO DEL FABLAB UFPS.pdf` (10 slides)

**Presentación: hecha.** Deck HTML de 10 slides publicado como Artifact
(https://claude.ai/code/artifact/2fa1f722-bab6-411b-9e17-9d8497370abd, v3) y
exportado a PDF 16:9. Reemplaza el deck viejo de 10 slides, que **nunca se
mostró** y tenía dos errores: decía Spring Boot (no existe en el repo) y las
capturas estaban mal rotuladas.

**App: sin tocar.** Sigue leyendo AsyncStorage con 5 salas hardcodeadas. No lee
la base de datos. Este es el hueco para el "avance tangible".

7 commits sin pushear en `feature/inventario-scan`.

## Next

1. **Pushear.** `git push origin feature/inventario-scan` (7 commits).
2. **Conectar la app a la base.** Es lo único que falta para la demo. La API ya
   está lista y probada (`importer/api.mjs`); falta consumirla desde
   `src/lib/inventory.ts`, que hoy usa AsyncStorage con `Rooms` hardcodeado
   (5 salas, sin ViveLab; la base tiene 11 en 2 edificios).
3. **Completar 3 referencias que no se pudieron resolver.** Hay que sacar autor
   y año de la portada de cada documento; los repositorios no los exponen:
   - **UTeM** (*E-Inventory*): Academia.edu devuelve 403.
   - **UMSA** (Bolivia): no quedó localizador, no hay nada que consultar.
   - **IPN**: el enlace `tesis.ipn.mx/handle/123456789/20598` da **404**. Puede
     necesitar fuente de reemplazo.
   Mientras estén incompletas se citan como `(*Título*, s. f.)`, que es la forma
   APA 7 correcta para obra sin autor. Hay una nota en la lista de referencias
   que lo explica.
4. ~~Copiar `ref-custom.odt` al repo.~~ **HECHO.** Está en
   `documento/ref-custom.odt` y el rebuild se probó desde ahí. El fuente del
   deck también quedó en `documento/deck-presentacion/`.
5. **Decidir qué pasa con `schema.mjs`.** Quedaron dos generadores. Si el
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

# regenerar el ODT  — el --reference-doc es OBLIGATORIO
# sin él se pierden la portada APA y la sangría francesa de las referencias, sin error
cd documento && pandoc documento-integrador.md \
  --reference-doc=ref-custom.odt \
  -o "SISTEMA DE CONTROL DE INVENTARIO DEL FABLAB UFPS.odt"

# regenerar el PDF del documento
libreoffice --headless --convert-to pdf "SISTEMA DE CONTROL DE INVENTARIO DEL FABLAB UFPS.odt"

# regenerar el PDF de la presentación (necesita navegador Chromium; Firefox NO
# tiene --print-to-pdf). El print stylesheet del deck ya está listo.
brave-browser --headless --disable-gpu --no-sandbox --no-pdf-header-footer \
  --print-to-pdf=salida.pdf --virtual-time-budget=12000 file:///<ruta>/documento/deck-presentacion/index.html

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

- **El equipo son DOS personas, no cuatro** (2026-09-13, sesión 2). Álvaro
  confirmó que **Kevin y Gian NO son integrantes**. La portada llegó a listar
  cuatro nombres (copiados de una portada modelo de otra asignatura) y se
  corrigió: quedan `1152462 - Juan David Llanos Castañeda` y
  `1152497 - Álvaro Sneider Portillo Mora`, en mayúsculas y con el código
  después del nombre, igual que la portada de los compañeros (acentos
  conservados; los de ellos los omiten, parece descuido al tipear).
  **Ojo:** varias decisiones de este HANDOFF (esquema normalizado, diseño
  experimental, outline de capítulos) vienen "por WhatsApp de Keven". Si no es
  del equipo, conviene confirmar quién coordina antes de seguir acatándolas.
  El pedido del cronograma también vino de él.
- **§3.2 puede estar desactualizado.** Dice que la muestra de personal se aborda
  "de forma censal" y §3.6 que el tamaño del equipo impide análisis inferencial.
  Se escribió suponiendo otro tamaño de equipo. Habla de personal del
  laboratorio, no de integrantes, así que puede estar bien — pero revisar.
- **Portada APA, no portada institucional** (2026-09-13, sesión 2). Se pidió
  APA explícitamente. Se quitaron ciudad y el rótulo "Integrantes del equipo";
  se agregaron docente (Carlos Eduardo Pardo García) y número de página arriba
  a la derecha. **Los códigos de estudiante se conservan** aunque APA no los
  contemple: la convención del programa manda, y así los usan los compañeros.
  La fecha dice "Septiembre de 2026" (se decidió omitir fecha de entrega).
- **No hay Spring Boot** (2026-09-13, sesión 2). Verificado en `package.json`:
  el stack es Expo/React Native + `server/index.mjs` (Node) + MySQL vía
  `mysql2`, DataMatrix con `datamatrix-svg-ts`, migración con `xlsx`. El deck
  viejo decía Spring Boot; era falso y nunca se presentó.
- **Las capturas del deck viejo estaban mal rotuladas.** La que decía
  "DataMatrix generado" es la ficha de un elemento (Arduino Uno R3, Sala IOT) y
  la de "Escaneo por cámara" es el formulario de alta. **No hay captura del
  escáner funcionando.** En el deck nuevo están rotuladas por lo que realmente
  muestran; si un jurado pide ver el escáner, ese hueco sigue abierto.
- **Cifras ajenas marcadas como ajenas** (2026-09-13, sesión 2). Los 43 % /
  98,5 % / 72 % son de Sahetapy y Suhirman (2025), **no son mediciones
  propias**. En el documento son "referencia comparativa" y en el deck (slide 9)
  dicen literal "Referencia de la literatura, no resultado propio". Presentarlas
  como propias sería un problema en la sustentación.
- **Citas nuevas en el capítulo 1** (2026-09-13, sesión 2). Antes tenía cero.
  Se agregaron dos, verificadas leyendo la fuente: Panko (2000) —86-91 % de las
  hojas de cálculo auditadas en campo tenían al menos un error, CER 1,1-2,5 %—
  y Jessurun et al. (2021) —lectura de código de barras bajó los errores de
  administración de 19,5 % a 15,8 %—. El "94 %" que circula es de una
  meta-revisión posterior, no de las tablas de Panko; se usaron las de él.
- **Comparación con el trabajo de los compañeros** (`CURSO EDUCATIVO DE REDES DE
  COMPUTADORES EN MOODLE.pdf`, mismo curso y profesor). Misma estructura de
  fondo. Nuestro documento tiene numeración jerárquica, 12 referencias contra 4,
  tabla comparativa y limitaciones metodológicas explícitas. Lo único en que nos
  ganaban era citar literatura en el planteamiento del problema —ya está
  corregido— y **ninguno de los dos tenía cronograma**, que ahora sí está.

## Contexto

El pedido viene por WhatsApp de Keven, no hay outline escrito del profesor
(Ricardo). El outline de capítulos que se siguió lo transcribió Keven el
2026-09-12. Ricardo pidió avances; el plan era mostrarle capturas de la base.
