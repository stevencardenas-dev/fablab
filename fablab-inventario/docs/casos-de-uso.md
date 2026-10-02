# Casos de uso

El inventario del FabLab contado como casos de uso: quién hace qué, con el flujo
principal y los alternativos, uno por operación del sistema.

**De dónde sale este archivo.** A diferencia del proyecto hermano (SINCOCO), aquí
**no existe un anexo oficial de casos de uso** ni un backlog de historias de
usuario: no hay un documento de requisitos que transcribir. Así que la fuente es
doble, y conviene saber cuál manda en cada fila:

- **Lo implementado se lee del código**, no de la intención: cada caso anota en
  **Estado** la ruta de [`api.md`](api.md) o el archivo de la app que lo sostiene,
  y `npm run docs:check` vigila que esas rutas sigan existiendo.
- **Lo declarado y no implementado** está en §1.6 y §1.7 del documento
  integrador, `notes/05` y `notes/07`, y vive en **EP-05**, marcado como tal en
  vez de mezclado con lo que sí funciona.

Los actores de estos casos están definidos en [`actores.md`](actores.md); los
flujos se apoyan en los códigos de estado reales de [`api.md`](api.md) (un `409`
de aquí es un caso de uso alternativo, no un detalle de implementación).

Los objetivos específicos del proyecto (OE-1 datos, OE-2 identificación, OE-3
trazabilidad) agrupan las épicas: las tres primeras épicas son los tres
objetivos, la cuarta es la consulta del usuario final y la quinta lo que falta.

---

## EP-01 · Datos e infraestructura (OE-1)

### CU-01 (Equipo desarrollador): Migrar el inventario desde los libros de Excel

- **Actor(es):** Equipo desarrollador
- **Estado:** implementado · `importer/` y `npm run migrar:esquema`, `seed`
- **Flujo principal (Migración inicial):** Dado que existen los libros del
  inventario, cuando el equipo normaliza la estructura (un edificio → salas →
  elementos, con la tabla `traslados`), y carga las filas contra el esquema, y
  verifica los conteos contra cada hoja de origen, entonces el inventario queda
  consultable en MySQL con una sola fuente de verdad.
- **Flujos alternativos:**
  - *Alt 1 (La copia no es la buena):* Dadas cuatro copias del mismo libro que no
    son idénticas —`RECEPCION 2026` difiere: la copia `CNC 2026.xlsx` tiene 12
    cantidades que las otras dejan en blanco—, cuando se importa desde otra
    copia, entonces se pierden esas cantidades **en silencio**; por eso la copia
    cargada es la buena y está documentado cuál es.
  - *Alt 2 (Mojibake):* Dado que el libro trae acentos mal codificados, cuando se
    carga, entonces `npm run fix:mojibake` los repara antes de dar el conteo por
    bueno.
  - *Alt 3 (Cantidades no numéricas):* Dado que `CANTIDAD` mezcla `12`, `-` e
    `INCONTABLE`, cuando se migra, entonces el campo se conserva como texto:
    tiparlo numérico perdería datos.

### CU-02 (Equipo desarrollador): Recargar el inventario desde una hoja nueva

- **Actor(es):** Equipo desarrollador
- **Estado:** implementado · `npm run seed`, `fix:mojibake`, `self-check`
- **Flujo principal (Recarga):** Dada una hoja nueva o corregida, cuando se
  ejecuta la importación y `self-check`, entonces la base refleja la hoja y los
  chequeos puros (validaciones, normalización de códigos, SQL generado) pasan sin
  necesidad de base.
- **Flujos alternativos:**
  - *Alt 1 (La recarga toca códigos ya impresos):* Dado que un elemento ya tiene
    su etiqueta pegada, cuando la hoja nueva trae otro código para él, entonces el
    cambio se detecta antes de imprimir nada: reetiquetar es una decisión, no un
    efecto colateral de la importación.

### CU-03 (Equipo desarrollador): Respaldar la base y verificar el despliegue

- **Actor(es):** Equipo desarrollador
- **Estado:** implementado · `npm run backup:remoto`, `npm run sync:deploy`, `GET /health`
- **Flujo principal (Respaldo y verificación):** Dado el sistema en producción,
  cuando se toma el respaldo y se despliega con el marcador del commit, entonces
  el despliegue se verifica con sondas (`/health`, la URL de la API, el bundle y
  el service worker) y queda un manifiesto de reversión.
- **Flujos alternativos:**
  - *Alt 1 (El servicio dormido del free tier):* Dado que la API en el plan
    gratuito se duerme, cuando algo la consulta, entonces el primer intento puede
    devolver `502/503/504`; la app reintenta con backoff solo los `GET` (1 s,
    2.5 s) y el despliegue incluye el keep-alive.
  - *Alt 2 (Bundle con URL o token viejos):* Dado que Metro cachea los
    `EXPO_PUBLIC_*`, cuando se exporta a mano sin `--clear`, entonces el bundle
    puede salir apuntando al entorno anterior; `sync:deploy` lo fuerza.

### CU-04 (Coordinación): Exportar el inventario y los traslados para análisis

- **Actor(es):** Coordinación del laboratorio
- **Estado:** implementado · `GET /api/export/{elementos,traslados}.{csv,json}`
- **Flujo principal (Exportación):** Dado el inventario cargado, cuando la
  coordinación descarga el volcado, entonces obtiene el inventario completo o el
  historial completo de traslados, en CSV (con BOM, abre directo en Excel) o
  JSON, listo para trabajar fuera del sistema.
- **Flujos alternativos:**
  - *Alt 1 (Nombre de archivo inexistente):* Dado que se pide
    `/api/export/inventario.csv`, cuando el nombre no es `elementos` ni
    `traslados`, entonces el server responde `404` en vez de un archivo vacío.

---

## EP-02 · Identificación y etiquetado (OE-2)

### CU-05 (Responsable de inventario): Identificar un elemento escaneando su Data Matrix

- **Actor(es):** Responsable de inventario
- **Estado:** implementado · escáner en Inicio (`src/app/(tabs)/index.tsx`) con `expo-camera`
- **Flujo principal (Escaneo):** Dado un elemento con su etiqueta pegada y el
  permiso de cámara concedido, cuando el responsable escanea el código, entonces
  la app busca el código en el inventario y muestra la ficha del elemento con su
  sala y su estado.
- **Flujos alternativos:**
  - *Alt 1 (Código desconocido):* Dado que el código leído no está en el
    inventario, cuando termina la lectura, entonces la app lo dice explícitamente
    en vez de fallar en silencio, y ofrece seguir escaneando.
  - *Alt 2 (Permiso de cámara denegado):* Dado que el usuario no autorizó la
    cámara, cuando intenta escanear, entonces la app pide el permiso con un
    mensaje propio.
  - *Alt 3 (Otro tipo de símbolo):* Dado un QR o un código de barras lineal,
    cuando se apunta la cámara, entonces no se lee: el escáner acepta **solo**
    Data Matrix (`barcodeTypes: ['datamatrix']`), que es lo que está pegado.

### CU-06 (Responsable de inventario): Registrar un elemento nuevo con su código

- **Actor(es):** Responsable de inventario
- **Estado:** implementado · `POST /api/elementos`, formulario "Agregar"
- **Flujo principal (Alta):** Dado que el elemento no está en el inventario,
  cuando el responsable completa los campos, elige la sala y confirma, entonces
  el sistema lo crea con su código, y en web descarga sola la etiqueta recién
  generada para poder imprimirla de inmediato.
- **Flujos alternativos:**
  - *Alt 1 (Sin sala):* Dado que no se eligió sala, cuando se confirma, entonces
    el server responde `400` y nada se guarda (el selector de sala es
    obligatorio en la app, no un adorno).
  - *Alt 2 (Código duplicado):* Dado que el código ya existe, cuando se confirma,
    entonces el server responde `409` con el id del elemento dueño
    (`El código CNC-172 ya existe (elemento 42)`) y el mensaje dice qué elemento
    lo tiene: es el dato necesario para resolverlo.
  - *Alt 3 (Sala inexistente):* Dado un `sala_id` que no existe, cuando se
    confirma, entonces responde `404` en vez de reventar con un `500` de clave
    foránea.
  - *Alt 4 (Falla la foto, no el alta):* Dado que la foto se sube **después** del
    alta (necesita el `id`), cuando esa subida falla, entonces el elemento igual
    quedó guardado y la app lo avisa aparte en vez de dar el alta por perdida.

### CU-07 (Responsable de inventario): Asignar código a un elemento que vino sin él

- **Actor(es):** Responsable de inventario
- **Estado:** implementado · `POST /api/elementos/:id/codigo` (y en bloque `npm run asignar:codigos`)
- **Flujo principal (Asignación):** Dado un elemento migrado del Excel sin código,
  cuando se le asigna uno (`FL-…` generado o el que corresponda), entonces queda
  identificable y ya puede etiquetarse.
- **Flujos alternativos:**
  - *Alt 1 (Ya tenía código):* Dado que el elemento ya tiene un código, cuando se
    intenta asignar otro, entonces el server responde `409`: **no se sobrescribe
    la etiqueta impresa**, que es el ancla física del inventario.
  - *Alt 2 (Código ya usado por otro):* Dado que el código pertenece a otro
    elemento, cuando se intenta, entonces responde `409` (lo decide el índice
    `UNIQUE uq_codigo`).
  - *Alt 3 (Formato inválido):* Dado un código que no cumple
    `^[A-Z0-9][A-Z0-9-]{1,19}$`, cuando se envía, entonces responde `400`; el
    server normaliza a mayúsculas.

### CU-08 (Responsable de inventario): Generar e imprimir la etiqueta de un elemento

- **Actor(es):** Responsable de inventario
- **Estado:** implementado · `src/lib/data-matrix-svg.ts` + `data-matrix.tsx`
- **Flujo principal (Etiqueta individual):** Dado un elemento con código, cuando
  se pide su etiqueta, entonces se genera un SVG en milímetros (módulo de 0,5 mm,
  zona de silencio de un módulo, código impreso debajo) que en web se descarga
  como `datamatrix-<CODIGO>.svg` y en el teléfono se manda por la hoja de
  compartir.
- **Flujos alternativos:**
  - *Alt 1 (Elemento sin código):* Dado un elemento sin código, cuando se abre su
    ficha, entonces no se ofrece etiqueta: se ofrece "Asignar código" (CU-07).
  - *Alt 2 (Código largo):* Dado un código de 15 caracteres (un `FL-…`), cuando
    se genera la etiqueta, entonces el lienzo se ensancha al ancho del **texto**,
    no solo al del símbolo, para que el código no se recorte ni se salga de la
    celda.

### CU-09 (Responsable / Coordinación): Imprimir las etiquetas de una sala completa

- **Actor(es):** Responsable de inventario, Coordinación del laboratorio
- **Estado:** implementado · `planHojaEtiquetas()`, `paginasHojaEtiquetas()`, `hoja-imprimible.ts`, `npm run verify:impresion`
- **Flujo principal (Reetiquetado de sala):** Dada una sala recién reorganizada o
  una tanda de elementos nuevos, cuando se pide la hoja de la sala, entonces se
  abre una pestaña que se imprime sola, con las etiquetas paginadas según el
  **papel elegido** (Carta por defecto, A4 u Oficio) y el recordatorio de imprimir
  al 100 %.
- **Flujos alternativos:**
  - *Alt 1 (Otro papel):* Dado que la impresora no tiene Carta cargada, cuando se
    cambia el selector de papel, entonces la grilla se recalcula y se repagina sin
    recargar la página. El default es Carta porque una hoja de Carta **entra en
    A4**, mientras que al revés se perdería la última fila.
  - *Alt 2 (Más etiquetas que una hoja):* Dado un lote que no cabe en una página,
    cuando se imprime, entonces se emiten **varias hojas de tamaño de papel** (un
    SVG por página): la paginación cae entre etiquetas y ninguna queda partida.
  - *Alt 3 (Elementos sin código):* Dado un lote con elementos sin código, cuando
    se arma la hoja, entonces la app **avisa cuántos saltea** en vez de imprimir
    menos en silencio.
  - *Alt 4 (El navegador bloquea la pestaña):* Dado un bloqueador de ventanas
    emergentes, cuando se pide la hoja, entonces se cae a descargar el SVG.

---

## EP-03 · Espacios y trazabilidad (OE-3)

### CU-10 (Responsable de inventario): Registrar el traslado de un elemento

- **Actor(es):** Responsable de inventario
- **Estado:** implementado · `POST /api/traslados`, modal de detalle en `sala/[nombre].tsx`
- **Flujo principal (Traslado):** Dado un elemento y una sala destino, cuando el
  responsable confirma el traslado con una nota opcional, entonces el sistema
  mueve el elemento y registra el movimiento **en una transacción** (las dos cosas
  o ninguna), con la fecha puesta por el motor.
- **Flujos alternativos:**
  - *Alt 1 (Ya está en esa sala):* Dado que el elemento ya está en la sala
    destino, cuando se confirma, entonces responde `409` y no se crea un traslado
    fantasma.
  - *Alt 2 (Elemento o sala inexistente):* Dado un id que no existe, cuando se
    confirma, entonces responde `404` (antes era un `500` de clave foránea).
  - *Alt 3 (Sin red):* Dado que un traslado **no es idempotente**, cuando la
    petición falla, entonces la app **no** lo reintenta sola (los `POST` no
    llevan backoff): un reintento duplicaría filas.

### CU-11 (Responsable / Coordinación): Consultar el historial de movimientos de un elemento

- **Actor(es):** Responsable de inventario, Coordinación del laboratorio
- **Estado:** implementado · `GET /api/elementos/:id/historial`
- **Flujo principal (Trazabilidad):** Dado un elemento, cuando se consulta su
  historial, entonces se ven sus traslados en orden, con **nombres de sala** (no
  ids) y la nota de cada movimiento: eso responde "dónde está y cómo llegó aquí".
- **Flujos alternativos:**
  - *Alt 1 (Nunca se movió):* Dado un elemento sin traslados, cuando se consulta,
    entonces la respuesta es `[]`, no un error.
  - *Alt 2 (Id mal tecleado):* Dado un id que no corresponde a ningún elemento,
    cuando se consulta, entonces responde `404` (antes respondía `200 []`, así que
    un id equivocado parecía un elemento sin movimientos).
  - *Alt 3 (Historial borrado con su elemento):* Dado un elemento dado de baja
    (CU-13), cuando se consulta su historial, entonces ya no existe: el borrado se
    llevó la traza. Es la limitación abierta más grande de este caso.

### CU-12 (Responsable de inventario): Corregir los datos de un elemento

- **Actor(es):** Responsable de inventario
- **Estado:** implementado · `PUT /api/elementos/:id`
- **Flujo principal (Corrección):** Dado un elemento con un dato mal cargado,
  cuando el responsable edita los campos tocados, entonces se actualizan solo
  esos campos (`detalle`, `serial`, `inventario`, `estado`, `observaciones`,
  `cantidad`) y la caché local se actualiza sin re-descargar los 917 elementos.
- **Flujos alternativos:**
  - *Alt 1 (Se intenta cambiar el código o la sala):* Dado que `codigo` y
    `sala_id` **no** son editables, cuando se intenta, entonces no se tocan: la
    etiqueta impresa manda y moverse es un traslado (CU-10).
  - *Alt 2 (Nada que cambiar):* Dado un cuerpo sin ningún campo editable, cuando
    se envía, entonces responde `400`. Un `PUT` que repite el mismo valor sigue
    devolviendo `200` (la existencia se decide con un `SELECT`, no con filas
    cambiadas).
  - *Alt 3 (Dos personas editando):* Dado que cada cliente manda solo sus campos
    tocados, cuando dos personas editan campos distintos, entonces no se pisan.

### CU-13 (Responsable de inventario): Dar de baja un elemento

- **Actor(es):** Responsable de inventario
- **Estado:** implementado · `DELETE /api/elementos/:codigo`
- **Flujo principal (Baja):** Dado un elemento que ya no debe estar en el
  inventario, cuando se elimina por su **código**, entonces el sistema borra
  primero sus traslados y luego el elemento, en una transacción; la foto cae por
  `ON DELETE CASCADE`.
- **Flujos alternativos:**
  - *Alt 1 (Código duplicado):* Dado un código que aparece en más de una fila,
    cuando se intenta borrar, entonces responde `409` y **no borra nada** (antes
    borraba uno al azar).
  - *Alt 2 (Repetir el borrado):* Dado un elemento ya borrado, cuando se repite,
    entonces responde `404`: el `DELETE` es idempotente.
  - *Alt 3 (Se dañó, no desapareció):* Dado un equipo dañado, cuando se da de
    baja, entonces sale del inventario **sin dejar constancia de por qué**: no hay
    estado "de baja" ni baja lógica. Es una brecha declarada en
    [`actores.md`](actores.md), no un comportamiento deseado.

### CU-14 (Responsable de inventario): Gestionar la foto del elemento

- **Actor(es):** Responsable de inventario
- **Estado:** implementado · `POST`/`DELETE /api/elementos/:id/foto`, `GET …/foto[?tam=]`
- **Flujo principal (Foto):** Dado un elemento, cuando el responsable captura una
  foto, entonces la app la **reduce en el dispositivo** (mostrando el ahorro, p.
  ej. `3.4 MB → 13 KB (-99%) · 800×600`) y sube la foto ya reducida con su
  miniatura; después se sirve con `ETag` y caché inmutable.
- **Flujos alternativos:**
  - *Alt 1 (Formato no permitido):* Dado un `mime` distinto de `image/webp` o
    `image/jpeg`, o unos bytes que no llevan la firma del formato, cuando se
    sube, entonces responde `400`.
  - *Alt 2 (Demasiado pesada):* Dada una foto de más de **400 KB** o una miniatura
    de más de **80 KB**, cuando se sube, entonces responde `413` con un mensaje
    que dice cuánto pesa y cuál es el límite; la miniatura no puede pesar más que
    la foto (`400`).
  - *Alt 3 (Quitar la foto):* Dado un elemento con foto, cuando se quita, entonces
    responde `200` y la caché en RAM de ese elemento se limpia; si no tenía foto,
    `404`.
  - *Alt 4 (Sin foto todavía):* Dado un elemento sin foto, cuando la UI pide la
    imagen, entonces recibe `null` y no pinta una imagen rota.

---

## EP-04 · Consulta del usuario del laboratorio

### CU-15 (Usuario del laboratorio): Consultar el inventario por sala

- **Actor(es):** Usuario del laboratorio (docente, estudiante, monitor)
- **Estado:** implementado · `GET /api/salas`, `GET /api/salas/:id/elementos`, pantalla Inventario
- **Flujo principal (Consulta por sala):** Dado el usuario en el FabLab, cuando
  abre la lista de salas, entonces ve cada sala con su edificio y cuántos
  elementos tiene, y al entrar ve el contenido de la sala.
- **Flujos alternativos:**
  - *Alt 1 (La API dormida o sin red):* Dada una respuesta `502/503/504`, cuando
    se carga la lista, entonces la app reintenta con backoff (1 s, 2.5 s) y, si no
    hay red, muestra lo último conocido desde caché.
  - *Alt 2 (Fallo con datos en pantalla):* Dado un fallo con lista vacía, cuando
    termina el intento, entonces se muestra el estado de fallo con botón
    **Reintentar**, no una pantalla en blanco.
  - *Alt 3 (Sala vacía):* Dada una sala sin elementos, cuando se entra, entonces
    se muestra el estado vacío, distinto del estado de error.

### CU-16 (Usuario del laboratorio): Buscar un elemento en todo el inventario

- **Actor(es):** Usuario del laboratorio, Responsable de inventario
- **Estado:** implementado · búsqueda en `src/lib/inventory.ts` (Inicio → Buscar)
- **Flujo principal (Búsqueda):** Dado un término de varias palabras, cuando el
  usuario busca, entonces se recorren todos los campos normalizando acentos y
  espacios, y los resultados se ordenan por relevancia (coincidencia exacta >
  empieza con > contiene).
- **Flujos alternativos:**
  - *Alt 1 (Con acentos o mayúsculas distintas):* Dado `impresion` contra
    `Impresión`, cuando se busca, entonces se encuentran igual: la comparación
    normaliza.
  - *Alt 2 (Varios resultados):* Dados varios resultados, cuando se listan,
    entonces cada uno trae su etiqueta descargable y un botón para imprimir las
    etiquetas de **todos** los resultados (CU-09).
  - *Alt 3 (Sin resultados):* Dado un término que no coincide con nada, cuando se
    busca, entonces se muestra el estado vacío, con el término visible.

### CU-17 (Usuario del laboratorio): Consultar la ficha de un elemento

- **Actor(es):** Usuario del laboratorio
- **Estado:** implementado · modal de detalle en `sala/[nombre].tsx`
- **Flujo principal (Ficha):** Dado un elemento en la lista de su sala, cuando se
  abre, entonces se ve su ficha con la foto grande, su código y su ubicación, que
  es justamente el dato que el Excel no sostenía.
- **Flujos alternativos:**
  - *Alt 1 (Elemento sin código):* Dado un elemento sin código, cuando se abre su
    ficha, entonces se ofrece "Asignar código" en lugar de una etiqueta.
  - *Alt 2 (Foto en caché vieja):* Dada una foto reemplazada, cuando se abre la
    ficha, entonces la URL lleva el hash (`?tam=miniatura&v=<hash>`): la miniatura
    se refresca en vez de mostrar la anterior.

### CU-18 (Usuario del laboratorio): Consultar sin conexión desde el celular

- **Actor(es):** Usuario del laboratorio, Responsable de inventario
- **Estado:** implementado · PWA (`public/sw.js`, `manifest.json`), caché SWR de la app
- **Flujo principal (Uso en campo):** Dado que la app ya se abrió una vez en el
  dispositivo, cuando se instala como PWA y se entra a una sala sin buena señal,
  entonces el shell se sirve desde caché y el inventario se responde con lo último
  conocido mientras se refresca por detrás (frescura de 60 s).
- **Flujos alternativos:**
  - *Alt 1 (Nunca se cargó):* Dado un dispositivo que nunca abrió la app, cuando
    se intenta sin red, entonces no hay nada cacheado que mostrar: el sistema
    **requiere conectividad** la primera vez (limitación declarada, §1.7).
  - *Alt 2 (Sin red, escritura):* Dado un alta o un traslado sin red, cuando se
    confirma, entonces el sistema muestra el error y **no** finge guardado: no hay
    cola local de escrituras.
  - *Alt 3 (Bundle nuevo desplegado):* Dado un despliegue con UI nueva, cuando los
    clientes vuelven, entonces hay que haber subido `CACHE_NAME` (`fablab-v12`) o
    el service worker sigue sirviendo la UI vieja para siempre.

---

## EP-05 · Declarados y no implementados

Estos casos **no existen en el sistema** al 2026-09-27. Se documentan porque están
declarados como alcance del proyecto, y porque un caso de uso que nadie implementó
es más peligroso sin escribir que escrito.

### CU-19 (Coordinación): Gestionar salas y edificios

- **Actor(es):** Coordinación del laboratorio
- **Estado:** **no implementado** · declarado en §1.6 ("gestión de espacios")
- **Flujo esperado (Gestión de espacios):** Dado un laboratorio que abre o
  reorganiza un espacio, cuando la coordinación crea la sala con su edificio,
  entonces el inventario la ofrece como destino de traslados.
- **Hoy:** las salas nacen de la importación; la API solo expone `GET /api/salas`
  y `GET /api/salas/:id/elementos`. No hay pantalla ni ruta para crear, renombrar
  o retirar una sala.

### CU-20 (Responsable de inventario): Registrar entradas, salidas y consumo de materiales

- **Actor(es):** Responsable de inventario
- **Estado:** **no implementado** · declarado en `notes/07` ("control de stock")
- **Flujo esperado (Movimientos):** Dada una compra o un consumo, cuando el
  responsable registra la entrada o la salida, entonces la existencia del material
  se actualiza y queda historial del movimiento.
- **Hoy:** el único movimiento posible es el **traslado entre salas** (CU-10). El
  campo `cantidad` es texto y no se descuenta por consumo; la reposición se apoya
  en consultar y exportar a mano.

### CU-21 (Coordinación): Alertar el reabastecimiento

- **Actor(es):** Coordinación del laboratorio
- **Estado:** **no implementado** · declarado en `notes/05` y §1.7
- **Flujo esperado (Alerta):** Dado un material con umbral definido, cuando su
  existencia cae por debajo, entonces el sistema genera la alerta.
- **Hoy:** no hay umbrales ni alertas. §1.7 ya lo acota bien: el sistema no genera
  órdenes de compra; la orden la emite una persona.

### CU-22 (Responsable de inventario): Registrar el préstamo y la devolución con responsable

- **Actor(es):** Responsable de inventario (a nombre de quien se lleva el equipo)
- **Estado:** **no implementado** · brecha descrita en [`actores.md`](actores.md)
- **Flujo esperado (Préstamo):** Dado que un docente o estudiante se lleva un
  equipo, cuando el responsable lo registra, entonces queda el movimiento **con
  destinatario, responsable y fecha esperada de devolución**; cuando vuelve, la
  devolución cierra el préstamo.
- **Hoy:** el préstamo es texto libre en `traslados.nota`
  (`{"nota":"préstamo a CNC"}`) y la tabla no tiene columna de autor: el historial
  dice *dónde* y *cuándo*, pero no *quién* ni *a quién*. Es la única traza que
  existe.

---

## Trazabilidad

| CU | Actor | Objetivo | Estado |
|---|---|---|---|
| CU-01 Migrar desde Excel | Equipo desarrollador | OE-1 | implementado |
| CU-02 Recargar desde una hoja nueva | Equipo desarrollador | OE-1 | implementado |
| CU-03 Respaldar y verificar el despliegue | Equipo desarrollador | OE-1 | implementado |
| CU-04 Exportar inventario y traslados | Coordinación | OE-1 | implementado |
| CU-05 Escanear e identificar | Responsable de inventario | OE-2 | implementado |
| CU-06 Registrar un elemento nuevo | Responsable de inventario | OE-2 | implementado |
| CU-07 Asignar código | Responsable de inventario | OE-2 | implementado |
| CU-08 Etiqueta de un elemento | Responsable de inventario | OE-2 | implementado |
| CU-09 Hoja de etiquetas de una sala | Responsable, Coordinación | OE-2 | implementado |
| CU-10 Registrar traslado | Responsable de inventario | OE-3 | implementado |
| CU-11 Consultar historial | Responsable, Coordinación | OE-3 | implementado |
| CU-12 Corregir datos del elemento | Responsable de inventario | OE-3 | implementado |
| CU-13 Dar de baja un elemento | Responsable de inventario | OE-3 | implementado |
| CU-14 Gestionar la foto | Responsable de inventario | OE-3 | implementado |
| CU-15 Consultar por sala | Usuario del laboratorio | — | implementado |
| CU-16 Buscar en el inventario | Usuario, Responsable | — | implementado |
| CU-17 Consultar la ficha | Usuario del laboratorio | — | implementado |
| CU-18 Consultar sin conexión | Usuario, Responsable | — | implementado |
| CU-19 Gestionar salas y edificios | Coordinación | OE-3 | **no implementado** |
| CU-20 Entradas, salidas y consumo | Responsable de inventario | OE-3 | **no implementado** |
| CU-21 Alertar reabastecimiento | Coordinación | — | **no implementado** |
| CU-22 Préstamo y devolución | Responsable de inventario | OE-3 | **no implementado** |

## Verificación

- `npm run docs:check` valida que los enlaces de este documento resuelven y que
  las rutas citadas siguen existiendo en `server/index.mjs`: si una ruta se cae,
  el gate lo dice antes de que el caso de uso mienta.
- Los flujos alternativos citan **códigos de estado reales** (`400`, `404`,
  `409`, `413`): `npm run qa` los ejercita contra la API (`61-72` checks) y
  `npm run gate` corre antes de cada push.
- Lo que este documento **no** puede verificar: que el papel impreso se lea con
  una cámara. La legibilidad del SVG está probada (`verify:datamatrix`,
  `verify:impresion`); la prueba en papel sigue pendiente, igual que la captura
  del escáner funcionando.
