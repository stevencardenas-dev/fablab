# 🧰 Sistema de Inventario Fablab UFPS

Sistema de gestión y control de inventario para el FabLab de la Universidad Francisco de Paula Santander, mediante identificación automática con códigos DataMatrix.

**Seminario Integrador II** — UFPS

## Equipo

- Kevin Steven Marin Cardenas
- Juan David Llanos Castañeda
- Gian Karlo Abril Fierro
- Alvaro Sneider Portillo Mora

## Arquitectura

```
┌──────────────┐    HTTP/REST    ┌───────────────┐    MySQL    ┌────────────┐
│  App Expo    │ ◄──────────────► │  API Server   │ ◄─────────► │  MySQL 8   │
│  (React      │   localhost:    │  (Node,       │  localhost: │  Docker    │
│  Native)     │    3001/api)    │   mysql2)     │    13306    │            │
└──────────────┘                 └───────────────┘             └────────────┘
```

- **App** — Expo/React Native (expo-router, 3 pantallas: Inicio, Inventario, Sala)
- **API** — `server/index.mjs` — HTTP REST, envuelve `importer/api.mjs`
- **BD** — MySQL 8 en Docker, esquema normalizado (edificios → salas → elementos + traslados)

## Inicio rápido

### 1. Base de datos (Docker)

```bash
cd fablab
docker compose up -d
```

### 2. Cargar datos (si es necesario)

Un solo comando (contra el contenedor `fablab-mysql`, con utf8mb4 para que
los acentos no salgan mojibake):

```bash
cd fablab/fablab-inventario
npm run seed -- "CNC 2026.xlsx"                    # importa todas las hojas
npm run seed -- "CNC 2026.xlsx" --hojas "CNC 2026,ALMACEN 2026"
npm run seed -- "CNC 2026.xlsx" --listar           # ver hojas sin importar
```

O a mano (dos pasos):

```bash
cd fablab/fablab-inventario
node importer/gen-normalizado.mjs "/home/alvaro/CNC 2026(1).xlsx" > /tmp/inventario.sql
docker exec -i fablab-mysql mysql --default-character-set=utf8mb4 -u root -pfablab fablab < /tmp/inventario.sql
```

Más opciones en `fablab-inventario/importer/README.md`.

### 3. API Server

```bash
cd fablab/fablab-inventario
PORT=3001 node server/index.mjs
```

### 4. App

```bash
cd fablab/fablab-inventario
npx expo start
```

Presiona `a` (Android), `i` (iOS) o `w` (web). En móvil: escanear QR de Expo Go.

## URLs del demo

| | |
|---|---|
| App | `http://localhost:8083` |
| API | `http://localhost:3001/api` |
| MySQL | `localhost:13306` (usuario: `root`, contraseña: `fablab`, base: `fablab`) |

## Endpoints de la API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/salas` | Salas con edificio y conteo de elementos |
| GET | `/api/salas/:id/elementos` | Elementos de una sala |
| GET | `/api/elementos/:id/historial` | Historial de traslados |
| POST | `/api/elementos` | Agregar elemento |
| DELETE | `/api/elementos/:codigo` | Eliminar elemento |
| POST | `/api/traslados` | Registrar traslado (transaccional) |

## Estructura del proyecto

```
fablab/
├── README.md                    ← Este archivo
├── README-SERVER.md             ← Detalle del servidor
├── docker-compose.yml           ← MySQL (Docker)
├── documento/
│   ├── documento-integrador.md  ← Documento académico (3 capítulos)
│   └── documento-integrador.odt
└── fablab-inventario/           ← App + API + BD (todo en un repo)
    ├── src/
    │   ├── app/                  ← Pantallas (expo-router)
    │   │   ├── (tabs)/           ← Inicio (scan, add, search) + Inventario
    │   │   └── sala/[nombre].tsx ← Detalle de sala
    │   ├── components/           ← Scanner, DataMatrix, UI
    │   ├── lib/
    │   │   ├── inventory.ts      ← Conexión a API (reemplaza AsyncStorage)
    │   │   └── inventory.test.ts ← Tests
    │   └── constants/theme.ts
    ├── server/
    │   └── index.mjs            ← API REST
    ├── importer/
    │   ├── normalizado.mjs      ← Esquema normalizado (DDL + DML)
    │   ├── api.mjs               ← Consultas MySQL para el frontend
    │   ├── cli.mjs               ← CLI: xlsx → MySQL
    │   ├── gen-normalizado.mjs  ← Genera SQL desde xlsx
    │   ├── self-check.mjs       ← Validaciones sin MySQL
    │   └── README.md
    ├── public/                   ← PWA (manifest, sw.js, _redirects)
    ├── server/index.mjs
    ├── docker-compose.yml
    ├── app.json                  ← Config Expo + PWA
    ├── eas.json                  ← Build config
    └── package.json
```

## Funcionalidades de la app

- **Escanear** — Lee códigos DataMatrix con la cámara
- **Agregar** — Crea elementos con DataMatrix generado automáticamente, foto opcional, selección de sala
- **Buscar** — Búsqueda por nombre (case-insensitive, substring)
- **Inventario** — Lista de salas con conteo de elementos
- **Sala** — Elementos de una sala, detalles, eliminar con confirmación
- **PWA** — Instalable en pantalla de inicio del teléfono

## Base de datos

Esquema normalizado (4 tablas):

| Tabla | Columnas clave | Relaciones |
|---|---|---|
| `edificios` | id, nombre | — |
| `salas` | id, edificio_id, nombre | FK → edificios |
| `elementos` | id, sala_id, codigo, detalle, serial, inventario, estado, observaciones, cantidad | FK → salas |
| `traslados` | id, elemento_id, sala_anterior_id, sala_nueva_id, fecha, nota | FK → elementos + salas |

Datos cargados: **916 elementos**, **11 salas**, **2 edificios** (FabLab + ViveLab).

## Pruebas

```bash
cd fablab/fablab-inventario
npm test                        # 20/20 tests (Jest)
node importer/self-check.mjs    # Validaciones DDL/DML sin MySQL
node scripts/verify-datamatrix.mjs  # Verifica códigos DataMatrix
```

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `MYSQL_HOST` | `localhost` | Host MySQL |
| `MYSQL_PORT` | `3306` | Puerto |
| `MYSQL_USER` | `root` | Usuario |
| `MYSQL_PASSWORD` | `fablab` | Contraseña |
| `MYSQL_DATABASE` | `fablab` | Base de datos |
| `MYSQL_SOCKET` | — | Socket (alternativa) |
| `PORT` | `3001` | Puerto del API server |
| `EXPO_PUBLIC_API_URL` | `http://localhost:3001/api` | URL de la API para la app |

## Desarrollo

```bash
cd fablab/fablab-inventario
npm install
npx expo start
```

Presiona `a` (Android), `i` (iOS) o `w` (web). Para web con PWA: `npx expo start --web`.

## Push actual

```
git@github.com:stevencardenas-dev/fablab.git
  main → documento + DDL
  feature/inventario-scan → app conectada a MySQL + API + PWA
```
