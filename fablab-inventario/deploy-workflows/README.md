# deploy-workflows

Workflows de GitHub Actions que corren en el **repo de deploy de la API**
(`Masterkillerr/fablab-api`), no en este monorepo: son los que mantienen
despiertos el servicio de Render y la base de Aiven, y los que avisan cuando algo
se cae.

- `keep-alive.yml` — ping a `/api/salas` cada 10 min (respaldo externo del ping
  que el server se hace a sí mismo cada 10 min).
- `db-watchdog.yml` — cada hora comprueba la API y, si Aiven apagó la base, la
  enciende por su API (`AIVEN_TOKEN`); los dos avisan por `ALERTA_WEBHOOK`.

`sync:deploy --push api` los copia a `.github/workflows/` del repo de deploy, así
que **se editan acá** y se despliegan con el sync. El secreto `ALERTA_WEBHOOK`
(Discord/Slack/Google Chat) se configura en el repo de deploy y no viaja acá.
