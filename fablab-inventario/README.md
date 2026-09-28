# FabLab UFPS — App móvil

Aplicación Expo/React Native del inventario del FabLab UFPS. Lee de la base de datos MySQL a través de la API REST.

## Documentación

La documentación completa del sistema (arquitectura, API, base de datos, fotos,
operación, rendimiento, pruebas y problemas conocidos) vive en **[`docs/`](docs/README.md)**.
Este README es el arranque rápido.

Antes de commitear: **`npm run gate`** (tipos, lint, tests, self-check, Data
Matrix y verificación de docs/scripts). El mismo gate corre en cada push vía
GitHub Actions.

## Desarrollo

```bash
npm install
npx expo start
```

Presiona `a` (Android), `i` (iOS) o `w` (web). En móvil real: escanear el QR con Expo Go.

## Estructura

- `src/app/` — pantallas (file-based routing de expo-router): `index.tsx` (Inicio: escanear/agregar/buscar), `explore.tsx` (Inventario por sala).
- `src/components/` — componentes UI compartidos. `_unused/` contiene sobrantes del template de Expo.
- `src/lib/inventory.ts` — lectura desde API REST (reemplaza AsyncStorage), generación de código único.
- `src/hooks/`, `src/constants/` — tema y utilidades.

## Backend

```bash
# API Server (Node.js + mysql2)
cd server && PORT=3001 node index.mjs

# MySQL (Docker)
cd .. && docker compose up -d
```

Ver [`README-SERVER.md`](../README-SERVER.md) para el arranque y [`docs/api.md`](docs/api.md)
para el contrato completo de las rutas.

## Base de datos

MySQL 8 con esquema normalizado: `edificios → salas → elementos` + `traslados`
+ `elemento_fotos` (fotos de los elementos, 1:1).
Datos: 917 elementos, 11 salas, 2 edificios (FabLab + ViveLab).
Detalle del esquema, índices y migraciones en [`docs/base-de-datos.md`](docs/base-de-datos.md).

Generador SQL desde Excel: `importer/gen-normalizado.mjs "archivo.xlsx"`

Cambios de esquema posteriores al dump (idempotentes, no borran datos):

```bash
npm run migrar:esquema -- --check   # solo informa qué falta
npm run migrar:esquema              # lo aplica
```

## Fotos de los elementos

La foto se **reduce en el teléfono antes de subirla** (`src/lib/foto-optimizar.ts`,
`expo-image-manipulator`): 800 px WebP q0.6 para la ficha y 200 px para las listas.
El original de la cámara nunca se sube ni se guarda. Medido con una foto real de
4000×3000 (3,4 MB): **13 KB de foto + 3 KB de miniatura = 16 KB, 99% menos**.
El inventario completo con foto son ~30 MB, contra ~2 GB si se guardara el original
(el plan de la base da 1 GB de disco).

- `elemento_fotos` (1:1 con `elementos`, `ON DELETE CASCADE`) guarda `foto`
  (MEDIUMBLOB), `miniatura` (MEDIUMBLOB) y `hash` (sha1 corto).
- `GET /api/elementos` **no** arrastra binarios: trae solo `foto_hash`. La app arma
  la URL (`src/lib/inventory.ts` `urlFoto`) y pide la imagen solo cuando la muestra.
- `GET|HEAD /api/elementos/:id/foto[?tam=miniatura]` responde `immutable` con ETag
  (y 304 si `If-None-Match` coincide); la URL lleva `?v=<hash>`, así que al reemplazar
  la foto cambia la URL y ninguna caché (ni la del navegador ni la del service worker)
  sirve la vieja.
- `POST /api/elementos/:id/foto` acepta WebP/JPEG ya reducidos y valida la firma de los
  bytes: foto ≤ 400 KB, miniatura ≤ 80 KB y miniatura < foto (413/400 si no).
- `DELETE /api/elementos/:id/foto` la quita.

Más detalle (contrato HTTP, cachés en RAM, prueba en vivo `npm run fotos:demo`)
en [`docs/fotos.md`](docs/fotos.md).
