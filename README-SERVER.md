# FabLab API Server

Servidor ligero que expone los datos de la base de datos MySQL como API REST.
Es el puente entre la app Expo (React Native) y la base de datos.

> El contrato completo (todas las rutas, autenticación, CORS, gzip, ETag/304 y
> códigos de estado) está en
> [`fablab-inventario/docs/api.md`](fablab-inventario/docs/api.md). Aquí van el
> arranque y lo mínimo para consumirla.

## Requisitos

- Docker (para MySQL) — o MySQL local ya corriendo
- Node.js 20+ (para el servidor)

## Setup rápido

```bash
# 1. Verificar que MySQL (Docker) está corriendo
cd fablab
docker ps  # deberia ver fablab-mysql en puerto 13306

# 2. Los datos ya estan cargados en la base. Si no:
cd fablab/fablab-inventario
node importer/gen-normalizado.mjs "/home/alvaro/CNC 2026(1).xlsx" > /tmp/inventario.sql
docker exec -i fablab-mysql mysql -u root -pfablab fablab < /tmp/inventario.sql

# 3. Correr el servidor
cd fablab/fablab-inventario
PORT=3001 node server/index.mjs

# 4. Correr la app
cd fablab/fablab-inventario
npx expo start
```

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/salas` | Todas las salas con edificio + conteo de elementos |
| GET | `/api/salas/:id/elementos` | Elementos de una sala (por id numérico) |
| GET | `/api/elementos/:id/historial` | Historial de traslados de un elemento |
| POST | `/api/traslados` | Registrar traslado (transaccional) |
| GET·HEAD | `/api/elementos/:id/foto[?tam=miniatura]` | Foto o miniatura (ETag/304, immutable) |
| POST | `/api/elementos/:id/foto` | Subir foto ya reducida (≤ 400 KB; miniatura ≤ 80 KB) |
| DELETE | `/api/elementos/:id/foto` | Quitar la foto |
| POST | `/api/elementos` · PUT `/api/elementos/:id` | Alta · edición de campos |
| POST | `/api/elementos/:id/codigo` | Asignar código a un elemento sin código |
| GET | `/api/export/{elementos,traslados}.{csv,json}` | Exportar |
| DELETE | `/api/elementos/:codigo` | Eliminar elemento |

La **lectura es pública**; si el server corre con `API_TOKEN`, `POST/PUT/DELETE`
exigen `Authorization: Bearer <token>` (401 si falta). Al arrancar, el server
asegura la tabla `elemento_fotos` y el índice de `codigo`, y precarga las
miniaturas en RAM.

## Variables de entorno del servidor

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `3001` | Puerto del servidor |
| `HOST` | `0.0.0.0` | Interfaz de escucha |
| `MYSQL_HOST` | `localhost` | Host de MySQL |
| `MYSQL_PORT` | `13306` | Puerto del Docker |
| `MYSQL_USER` | `root` | Usuario |
| `MYSQL_PASSWORD` | `fablab` | Contraseña |
| `MYSQL_DATABASE` | `fablab` | Base de datos |
| `MYSQL_SOCKET` | — | Socket de MySQL (opcional) |

## Configurar la app para usar la API

La app lee `EXPO_PUBLIC_API_URL` para saber dónde está el servidor.
Por defecto: `http://localhost:3001/api`.

Para Expo, las variables con prefijo `EXPO_PUBLIC_` se incluyen en el bundle:
```bash
EXPO_PUBLIC_API_URL=http://localhost:3001/api npx expo start
```

Reemplaza `localhost` por la IP de tu máquina (`192.168.x.x`) cuando conectes desde un dispositivo físico o simulador remoto.
