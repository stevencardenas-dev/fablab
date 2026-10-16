# Despliegue en el servidor de la universidad

Hoy el sistema corre en servicios externos (Render para la web y la API, Aiven para
la base). Para la universidad se empaquetó en **contenedores Docker**, de modo que
el área de sistemas lo instale en un servidor propio sin depender de esos servicios.
Los comandos exactos están en [`docker/README.md`](../docker/README.md); este
documento explica qué es, por qué está armado así y qué queda a cargo de quién.

## Qué es Docker (en una línea)

Una **imagen** empaqueta un programa con todo lo que necesita para correr (sistema
base, Node, librerías, código); un **contenedor** es esa imagen en marcha. *Docker
Compose* arranca varios contenedores juntos a partir de un archivo,
`docker/compose.yml`. El resultado corre igual en cualquier servidor con Docker.

## Arquitectura

```
navegador ──► web (nginx, único puerto publicado) ──/api──► api (Node 20) ──► mysql (8.4)
```

| Contenedor | Imagen | Rol | Publicado |
|---|---|---|---|
| `web` | `docker/web/Dockerfile` (compila la app y la sirve con nginx) | sirve la app y reenvía `/api` | sí, `WEB_PORT` |
| `api` | `docker/api/Dockerfile` (Node 20, usuario sin privilegios) | reglas, validaciones, auditoría | no |
| `mysql` | `mysql:8.4` oficial | datos, en el volumen `fablab-stack_mysql_data` | no |

Decisiones y motivo:

- **Un solo puerto.** La app llama a `/api` en su mismo dominio y nginx lo reenvía.
  Funciona con el dominio que asigne la universidad sin recompilar, y la API y la
  base no son alcanzables desde fuera de Docker.
- **La web se compila dentro de la imagen** con el `API_TOKEN` de `docker/.env`. Así
  el paquete no lleva ningún secreto: cada instalación pone el suyo.
- **La base arranca con el inventario vigente** (`docker/init/01-inventario.sql`:
  1 450 elementos, 13 salas), igual a producción al 2026-10-15. No incluye el
  historial de traslados.
- **La API usa un usuario de base propio**, no `root`.

## Qué necesita el servidor

- Linux con Docker Engine y `docker compose` v2.
- ~4 GB de RAM libres para construir; ~1 GB en funcionamiento.
- Salida a internet al construir (paquetes de npm y del CDN de SheetJS).
- Un dominio y HTTPS en el proxy inverso de la universidad, apuntando a `WEB_PORT`.

## Responsabilidades

| Tema | Lo cubre |
|---|---|
| Sistema operativo, firewall, certificado HTTPS, acceso de red | Área de sistemas |
| Programar el respaldo diario (`docker/respaldo.sh`) y guardar copias fuera del servidor | Área de sistemas |
| Validación de datos, límite de escrituras, CORS, auditoría | La aplicación (ya implementado) |
| Quién puede escribir (inicio de sesión, roles) | Pendiente, ver Seguridad |

## Respaldo y restauración (probado)

`sh docker/respaldo.sh` genera un `mysqldump` comprimido en `docker/respaldos/` y
borra los de más de 30 días. La restauración se probó el **2026-10-15**: un respaldo
cargado en una base vacía devolvió 2 edificios, 13 salas y 1 450 elementos, con el
mismo `CHECKSUM TABLE` de `elementos` que la base original (`1913494598`). El comando
de restauración está al inicio de `docker/respaldo.sh`.

## Actualizaciones

Docker no se actualiza solo. Después de un cambio en el código, alguien con acceso
al servidor corre `git pull` y el mismo `docker compose … up -d --build`: se
reconstruye lo que cambió y el volumen de la base no se toca. Automatizarlo
(GitHub Actions o un vigilante de imágenes) es una decisión del área de sistemas.

## Seguridad

Hecho:

- La API valida todo lo que recibe: tamaño (1 MB, 4 MB en importación), JSON, ids;
  las consultas SQL van parametrizadas.
- Escrituras: token obligatorio, **límite por IP y minuto** (`429`) y **auditoría** de
  cada cambio ([`auditoria.md`](auditoria.md)).
- CORS: solo el mismo dominio en este despliegue.
- Dependencias de la API: **0 vulnerabilidades conocidas** (`npm audit`, 2026-10-15).
- Sin secretos en el repositorio ni en el paquete.

Pendiente (y por qué):

- **El token de escritura viaja dentro de la app web**: quien abre la página puede
  leerlo. Mitigación hasta tener inicio de sesión: publicar la app solo en la red
  del campus o por VPN.
- **La app web conserva 46 avisos** de dependencias, todos en la cadena de
  compilación de Expo; corregirlos exige una actualización mayor de Expo.
- **Sin HTTPS propio**: lo pone el proxy de la universidad.

## Verificación hecha (2026-10-15, desde volumen vacío)

| Comprobación | Resultado |
|---|---|
| `/health` | 200 |
| `/api/salas` | 13 salas, 1 450 elementos |
| Escritura sin token / con token | 401 / aceptada |
| Deep link `/sala/1` | 200 |
| API alcanzable desde fuera | no |
| Bundle | llama a `/api` relativo y lleva el token del `.env` |
| Respaldo y restauración | idénticos (ver arriba) |
