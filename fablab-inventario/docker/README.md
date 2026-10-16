# Despliegue con Docker — Inventario FabLab UFPS

Tres contenedores: **MySQL 8.4** (datos), **API** (Node 20) y **web** (nginx: sirve
la app y reenvía `/api` a la API). Solo se publica **un puerto** (web). MySQL y la
API no son alcanzables desde fuera de la red de Docker.

```
navegador ──► web (nginx, puerto WEB_PORT) ──/api──► api (Node) ──► mysql
```

## Requisitos del servidor

- Linux con Docker Engine y el plugin `docker compose` (v2).
- Unos 4 GB de RAM libres **durante la construcción** (compilar la web es lo que más
  consume); en funcionamiento basta con ~1 GB.
- Salida a internet durante la construcción (descarga paquetes de npm y del CDN de SheetJS).
- Un dominio y HTTPS: esta pila sirve HTTP; el certificado va en el proxy inverso de
  la universidad, delante del puerto `WEB_PORT`.

## Instalación

Desde la carpeta `fablab-inventario/`:

```bash
cp docker/.env.example docker/.env
```

Editar `docker/.env` y poner valores largos y aleatorios (por ejemplo `openssl rand -hex 24`)
en `MYSQL_ROOT_PASSWORD`, `MYSQL_APP_PASSWORD` y `API_TOKEN`. Ese archivo no se versiona.

```bash
docker compose -f docker/compose.yml --env-file docker/.env up -d --build
```

La primera vez la base se crea con el inventario de `docker/init/01-inventario.sql`
(1 450 elementos, 13 salas, 2 edificios). Eso solo ocurre con el volumen vacío.

## Comprobación

```bash
docker compose -f docker/compose.yml --env-file docker/.env ps
```

```bash
curl -s http://localhost:8080/health
```

```bash
curl -s http://localhost:8080/api/salas
```

Deben verse los tres servicios en marcha, `/health` responder y `/api/salas` devolver 13 salas.
Abrir `http://<servidor>:8080` en el navegador muestra la app.

## Operación

| Tarea | Comando |
|---|---|
| Ver estado | `docker compose -f docker/compose.yml --env-file docker/.env ps` |
| Ver registros de la API | `docker compose -f docker/compose.yml --env-file docker/.env logs -f api` |
| Detener (conserva datos) | `docker compose -f docker/compose.yml --env-file docker/.env down` |
| Actualizar tras cambios | `git pull` y luego el mismo `up -d --build` |
| Respaldo | `sh docker/respaldo.sh` (deja `docker/respaldos/*.sql.gz`, conserva 30 días) |

**`down -v` borra la base de datos** (volumen `fablab-stack_mysql_data`). No usarlo en producción.

Respaldo diario (cron del servidor):

```
0 2 * * * cd /ruta/a/fablab-inventario && sh docker/respaldo.sh
```

La restauración está documentada al inicio de `docker/respaldo.sh`.

## Seguridad: lo que hay que saber

- **El token de escritura viaja dentro de la app web.** Quien abra la página puede leerlo
  y modificar el inventario. Mitigación hasta que exista inicio de sesión: publicar la
  app solo en la red del campus (o VPN).
- **Cambiar `API_TOKEN`** exige reconstruir la web (`up -d --build`), porque el token se
  compila dentro del bundle.
- La API limita las escrituras por IP (120 por minuto, `LIMITE_ESCRITURAS_MIN`) y registra cada cambio en la tabla `auditoria` (ver `docs/auditoria.md`). Lecturas sin límite: si se publica en internet, limitarlas en el proxy.
- Dependencias: la API no tiene vulnerabilidades conocidas (`npm audit`); la app web
  conserva 46 avisos en la cadena de Expo, pendientes de una actualización de Expo.
