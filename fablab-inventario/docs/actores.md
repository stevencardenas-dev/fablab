# Actores del sistema

Quién usa el inventario del FabLab UFPS y qué puede hacer cada uno. Es el mismo
ejercicio que hace §1.1 del documento integrador con el proceso actual, pero
respondido **contra el sistema que existe hoy**: cada capacidad de aquí apunta a
una ruta de [`api.md`](api.md) o a una pantalla de [`app.md`](app.md), y lo que
no existe se declara como hueco en vez de darse por hecho.

- **Fecha de este levantamiento:** 2026-09-27.
- **Fuentes:** §1.1 y §1.6 del documento integrador (proceso actual y alcances),
  `notes/05` y `notes/07` (cobertura declarada), y las dos fuentes de verdad del
  código: `server/index.mjs` + `importer/api.mjs` y `src/app/`.
- **Aviso que ordena todo lo que sigue:** el sistema **no tiene usuarios,
  contraseñas ni roles**. Los actores de abajo son roles *organizacionales*, no
  cuentas. Hoy todos escriben con **un solo token compartido**. Lo que eso
  implica está desarrollado en la última sección, no escondido.
- **Cada operación de estos actores** está contada como caso de uso, con su flujo
  principal y sus alternativos, en [`casos-de-uso.md`](casos-de-uso.md).

---

## 1. Responsable de inventario (personal del laboratorio)

**Funciones principales:**

- **Identificar:** escanear el Data Matrix pegado al elemento y ver al instante
  ficha, sala y estado. El escáner lee **solo** Data Matrix
  (`barcodeTypes: ['datamatrix']`); si el código no está en el inventario, la app
  lo dice en vez de fallar en silencio.
- **Registrar el alta:** dar de alta un elemento nuevo con su sala obligatoria
  (sin ella el server responde `400` y no guarda nada), con código generado
  (`FL-…`) o el que ya traiga el elemento, y foto opcional.
- **Corregir:** editar los campos editables del elemento. La app manda solo los
  campos que se tocaron, así que dos personas editando campos distintos no se
  pisan.
- **Mover de sala:** registrar el traslado con una nota opcional
  (`POST /api/traslados`, transaccional) y consultar el historial de movimientos
  del elemento.
- **Asignar código:** a los elementos que llegaron sin código
  (`POST /api/elementos/:id/codigo`), que es requisito para poder etiquetarlos.
- **Etiquetar:** generar el símbolo individual o la hoja de una sala completa y
  mandarla a imprimir.
- **Buscar:** búsqueda multi-palabra sobre todos los campos, normalizando
  acentos, para encontrar un elemento sin recorrer la sala.
- **Dar de baja:** eliminar un elemento (y con él su historial) por código.

Es el actor que cubre el ciclo completo y **el único que escribe**. Ahí está la
explicación de fondo de por qué el sistema hoy puede vivir sin login: una sola
persona, con un teléfono en la mano, hace todo el flujo.

> Dos capacidades de este actor están implementadas y **nadie las está usando**:
> la foto (en producción hay **0 fotos**, dato verificado el 2026-09-24) y el
> escaneo, del que no hay captura funcionando (sigue pendiente en la bitácora del
> monorepo, `specs/HANDOFF.md`).

---

## 2. Coordinación del laboratorio

Es quien hoy entrega el libro de inventario y responde por él ante la
universidad. En el sistema:

**Funciones principales:**

- **Consultar el inventario completo** sin depender de que alguien le mande un
  archivo: es la respuesta directa al hallazgo de las cuatro copias del Excel que
  no coincidían entre sí.
- **Exportar para trabajar fuera del sistema:** inventario o historial de
  traslados en CSV (con BOM, se abre directo en Excel) o JSON. No hay filtros
  parciales: el volcado es completo.
- **Recargar el inventario desde el Excel** cuando llegue una hoja nueva, con el
  arnés de importación (`seed`, `fix:mojibake` y `self-check`).
- **Reetiquetar una sala completa** después de reorganizarla.
- **Verificar los conteos** contra el origen antes de dar el inventario por
  bueno.

---

## 3. Equipo desarrollador / administrador técnico

El rol que sostiene el sistema en producción. No es un usuario de negocio, pero
sus acciones determinan lo que los demás pueden hacer, así que se documenta:

**Funciones principales:**

- **Desplegar** la API y la PWA, y **rotar el token de escritura** (que exige
  volver a exportar y desplegar la web, porque el token viaja dentro del bundle).
- **Administrar el esquema:** crear/ajustar tablas e índices al arrancar el
  server (`asegurarCodigoUnico()` y compañía), siempre de forma idempotente.
- **Respaldar** y verificar la base (manifiestos de reversión y `backup:remoto`).
- **Importar** la migración inicial desde los libros de Excel, con `self-check` y
  la QA como red.
- **Mantener el servicio despierto** y verificar el despliegue con sondas post
  deploy.

---

## 4. Usuario del laboratorio (docente, estudiante, monitor)

Quien usa el FabLab, no quien lo administra. Su relación con el sistema es de
**solo lectura**, que es lo correcto: nadie que venga a usar una impresora 3D
debería poder borrar una fila del inventario.

**Funciones principales:**

- **Consultar** el inventario por sala y buscar un elemento concreto.
- **Ver la ficha** del elemento con su ubicación real (que es justamente el dato
  que el Excel no sostenía).
- **Llegar sin instalar nada:** la app web se instala como PWA y también funciona
  en el navegador.

Esta lectura es **pública hoy**: no hay forma de restringirla, ni falta que hace
para el alcance declarado.

---

## 5. Sistema (actor no humano)

Igual que en los casos de uso formales, hay acciones que no las dispara una
persona sino una regla o un evento. En este sistema son cinco, y las cinco
existen en código:

- **Asignar el código único y rechazar el duplicado** (el `UNIQUE uq_codigo` que
  crea `asegurarCodigoUnico()` al arrancar: dos altas simultáneas del mismo
  código dejan una `201` y el resto `409`, en vez de dos filas gemelas).
- **Sellar la fecha del traslado** y conservar el historial:
  `traslados.fecha` es `DEFAULT CURRENT_TIMESTAMP`, la escribe el motor, no el
  usuario.
- **Generar el símbolo Data Matrix** (Data Matrix ECC200, módulo de 0,5 mm) y
  **paginarlo por papel**, que es geometría calculada, no una decisión de nadie.
- **Reducir la foto en el dispositivo** y **servirla con `ETag`/`304`**: el
  ahorro de la imagen y la revalidación de caché los hace el sistema en cada
  operación, sin que el usuario los pida.
- **Defender el borde HTTP:** id no entero → `400`, cuerpo mayor a 1 MB → `413`,
  JSON roto → `400`, sin bufferizar. Es el sistema diciendo que no, no una
  persona.

---

## Actores del negocio que NO usan el sistema

### Quien se lleva un equipo prestado (estudiante, docente de otra asignatura)

Participa en el proceso real —se lleva un multímetro, lo devuelve la semana
siguiente— pero **no es actor del sistema**: no tiene usuario ni inicia sesión.

- Lo que le concierne lo registra el responsable de inventario, y hoy **solo como
  texto libre**: el préstamo se escribe en `traslados.nota`
  (`{"nota":"préstamo a CNC"}`), que además queda sin autor. El historial dice
  *dónde* y *cuándo*, no *quién* ni *a quién*.
- Por eso no existe una tabla de préstamos ni un campo de responsable: el sistema
  registra el movimiento del *objeto*, no la relación con la *persona*.

### Quien imprime las etiquetas

El sistema genera el vector y la hoja lista para imprimir, pero **no imprime**
(§1.7 del documento integrador): de la impresora hacia afuera hay una persona
fuera del sistema. Ese tramo es también donde se pierde la garantía de que el
código impreso se lea: la legibilidad está verificada en el PDF, no en papel con
una cámara.

### Proveedor y mantenimiento

- **Proveedor:** el sistema no genera órdenes de compra; el reabastecimiento es
  una decisión humana que hoy se apoya, como mucho, en una consulta o una
  exportación a mano (`notes/05` lo declara como alcance: alertas, no compras).
- **Mantenimiento / baja por daño:** un equipo que se daña sale del inventario con
  un borrado físico (`DELETE /api/elementos/:codigo`), que se lleva el historial
  con él. No hay estado "de baja" ni traza de por qué desapareció: es el hueco
  más grande de este grupo de actores.

---

## Lo que falta para que estos roles sean de verdad

Ninguna de estas brechas es un olvido del documento: son el estado del sistema al
2026-09-27.

| Brecha | Qué implica | Dónde vive |
|---|---|---|
| Sin login ni roles | No se puede saber **quién** escribió qué, ni limitar quién borra | Ver el problema conocido del `EXPO_PUBLIC_API_TOKEN` en [`problemas-conocidos.md`](problemas-conocidos.md): el token es un freno al vandalismo casual, no seguridad |
| `traslados` sin columna de autor | El historial tiene fecha, origen y destino; **no autor** | `CREATE TABLE traslados` en [`base-de-datos.md`](base-de-datos.md) |
| Sin CRUD de salas ni edificios | Las salas nacen de la importación; no hay pantalla para crearlas | Solo `GET /api/salas` en [`api.md`](api.md) |
| Sin préstamos ni devoluciones | El préstamo es texto libre, no un flujo con responsable y vencimiento | `traslados.nota` |
| Sin entradas/salidas/consumo | Declarado como control de stock (`notes/07`); hoy el único movimiento posible es el traslado entre salas | No hay rutas de entradas ni salidas en la tabla de [`api.md`](api.md) |
| Sin alertas de reabastecimiento | Declarado en `notes/05` y en §1.7: no implementado | — |

Cerrar la primera fila (login con roles) es el quehacer técnico que convertiría
esta lista de roles de organización en una lista de permisos; las otras cinco son
flujo, no seguridad, y las cinco tienen su caso de uso esperado en EP-05 de
[`casos-de-uso.md`](casos-de-uso.md).

---

## Trazabilidad: actor → pantalla → ruta

Las pantallas y rutas contra las que se escribió lo de arriba. Si una ruta cambia
de nombre o desaparece, este documento queda desactualizado en esa fila.

| Actor | Pantalla | Ruta de la API |
|---|---|---|
| Responsable de inventario | Inicio · Sala | `POST /api/elementos`, `PUT /api/elementos/:id`, `POST /api/elementos/:id/codigo`, `POST /api/elementos/:id/foto`, `DELETE /api/elementos/:id/foto`, `DELETE /api/elementos/:codigo`, `POST /api/traslados`, `GET /api/elementos/:id/historial`, `GET /api/elementos/:id/foto` |
| Coordinación | Inicio (Exportar) · Sala | `GET /api/elementos`, `GET /api/salas`, `GET /api/salas/:id/elementos`, `GET /api/export/{elementos,traslados}.{csv,json}` |
| Equipo desarrollador | — (línea de comandos y Render) | `GET /health` |
| Usuario del laboratorio | Inventario · Sala | `GET /api/salas`, `GET /api/elementos`, `GET /api/salas/:id/elementos` |
| Sistema | — | Reglas transversales: `uq_codigo`, `traslados.fecha`, generación del Data Matrix, `ETag`, validaciones `400/409/413` |

## Verificación

- `npm run docs:check` comprueba que los enlaces relativos de este documento
  resuelven y que la tabla de rutas de [`api.md`](api.md) sigue coincidiendo con
  lo que `server/index.mjs` expone: si una ruta se cae, el gate lo dice antes de
  que este documento mienta.
- Los conteos citados (917 elementos, 11 salas, 2 edificios, 0 fotos) son de
  producción y están fechados: se vuelven a medir con `GET /api/salas` —que trae
  el conteo por sala— y `GET /api/elementos`. `npm run qa` ejercita esa API
  contra los datos que haya, sin fijar cifras.
