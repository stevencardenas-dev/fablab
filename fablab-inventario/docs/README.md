# Documentación — Sistema de Inventario FabLab UFPS

Documentación técnica del sistema completo: app móvil/PWA, API REST, base de
datos MySQL, pipeline de fotos, importación desde Excel, despliegue y pruebas.

> Estado del documento: **2026-09-24**. Datos de producción verificados ese día:
> **917 elementos · 11 salas · 2 edificios · 0 fotos** (la foto de prueba en vivo
> se revirtió; ver [`fotos.md`](fotos.md)). API desplegada:
> `https://fablab-api-sr1q.onrender.com` · web: `https://fablab-web.onrender.com`.

## Por dónde empezar

| Si quieres… | Lee |
|---|---|
| Entender qué es el sistema y cómo encajan sus piezas | [`arquitectura.md`](arquitectura.md) |
| Consumir la API desde otro programa | [`api.md`](api.md) |
| Entender/tocar la base de datos | [`base-de-datos.md`](base-de-datos.md) |
| Trabajar en las fotos de los elementos | [`fotos.md`](fotos.md) |
| Trabajar en la app (pantallas, caché, etiquetas, PWA) | [`app.md`](app.md) |
| Recargar/actualizar el inventario desde el Excel | [`importacion.md`](importacion.md) |
| Desplegar o tocar producción | [`operacion.md`](operacion.md) |
| Saber por qué responde rápido (o medirlo) | [`rendimiento.md`](rendimiento.md) |
| Correr las pruebas antes de dar algo por bueno | [`qa.md`](qa.md) |
| Conocer lo que aún está abierto o puede morderte | [`problemas-conocidos.md`](problemas-conocidos.md) |

## Los documentos

- **[arquitectura.md](arquitectura.md)** — componentes del monorepo, flujo de
  datos, stack y versiones, decisiones de diseño con su motivo.
- **[api.md](api.md)** — contrato completo de las 14 rutas HTTP: autenticación,
  CORS, gzip, ETag, códigos de estado, ejemplos `curl` y errores.
- **[base-de-datos.md](base-de-datos.md)** — modelo normalizado
  (`edificios → salas → elementos` + `traslados` + `elemento_fotos`), DDL,
  índices, migraciones idempotentes, conexión local/Aiven y respaldos.
- **[fotos.md](fotos.md)** — por qué la foto se reduce en el teléfono, límites
  del servidor, hash/ETag, cachés en RAM y cómo se ve en la UI.
- **[app.md](app.md)** — pantallas (Inicio, Inventario, Sala), caché
  stale-while-revalidate, búsqueda, Data Matrix/etiquetas, PWA y service worker.
- **[importacion.md](importacion.md)** — xlsx → MySQL: los dos generadores,
  `seed`, asignación de códigos, reparación de mojibake y `self-check`.
- **[operacion.md](operacion.md)** — entornos, credenciales, `sync:deploy`,
  Render + Aiven, keep-alive, verificación post-deploy y rollback.
- **[rendimiento.md](rendimiento.md)** — optimizaciones implementadas y la tabla
  de mediciones en producción, con las trampas de medición.
- **[qa.md](qa.md)** — qué cubre cada prueba (`npm test`, `self-check`, `qa`,
  `benchmark`, `verify:datamatrix`) y cómo apuntarlas a un servidor local.
- **[problemas-conocidos.md](problemas-conocidos.md)** — issues abiertos
  (`IOT-79`, error #418, deep link 404…) y trampas del entorno.

## Mapa del repositorio

```
fablab/                              # monorepo (specs/HANDOFF.md = bitácora de sesiones)
├── README.md                        # vista general + deploy
├── README-SERVER.md                 # arranque rápido del servidor
├── docker-compose.yml               # MySQL 8 local
├── documento/                       # documento académico (ODT/PDF)
└── fablab-inventario/               # app + API + BD
    ├── src/                         # app Expo (React Native + web)
    │   ├── app/                     #   pantallas (expo-router)
    │   ├── components/              #   UI, escáner, Data Matrix
    │   ├── lib/                     #   inventario, fotos, SVG de etiquetas
    │   └── hooks/ · constants/      #   tema
    ├── server/index.mjs             # API HTTP (wrappea importer/api.mjs)
    ├── importer/                    # xlsx → MySQL y consultas a la BD
    ├── scripts/                     # seed, QA, benchmark, deploy, backups
    ├── public/                      # PWA: manifest, sw.js
    ├── docs/                        # ← esta documentación
    └── backups/                     # snapshots y manifiestos de reversión
```

## Convenciones de esta documentación

- Todo en **español**, igual que el código y los mensajes de la app.
- Las rutas y comandos se citan **como se ejecutan** desde
  `fablab-inventario/` salvo que se diga lo contrario.
- Cuando un dato viene de una medición se indica **dónde y cuándo** se midió;
  cuando es una decisión de diseño se explica **por qué**.
- Lo que **no** está resuelto vive en
  [`problemas-conocidos.md`](problemas-conocidos.md), no escondido en el texto.
