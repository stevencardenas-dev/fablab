#!/bin/sh
# Respaldo de la base: deja docker/respaldos/fablab-AAAA-MM-DD-HHMM.sql.gz
# y borra los de más de 30 días. Para programarlo (cron, todos los días 02:00):
#   0 2 * * * cd /ruta/a/fablab-inventario && sh docker/respaldo.sh
# Restaurar:
#   gunzip -c docker/respaldos/<archivo>.sql.gz | docker compose -f docker/compose.yml --env-file docker/.env exec -T mysql sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" fablab'
set -eu
cd "$(dirname "$0")/.."
mkdir -p docker/respaldos
archivo="docker/respaldos/fablab-$(date +%Y-%m-%d-%H%M).sql.gz"
docker compose -f docker/compose.yml --env-file docker/.env exec -T mysql \
  sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -u root --single-transaction --no-tablespaces fablab' | gzip > "$archivo"
find docker/respaldos -name 'fablab-*.sql.gz' -mtime +30 -delete
echo "respaldo: $archivo"
