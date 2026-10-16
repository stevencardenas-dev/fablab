# API del inventario (server/ + importer/). Construir desde fablab-inventario/:
#   docker build -f docker/api/Dockerfile -t fablab-api .
FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001

WORKDIR /app

# Dependencias primero: esta capa se cachea mientras no cambie el lock
COPY docker/api/package.json docker/api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY importer ./importer
# Esquema y datos iniciales: el compose lo monta también en MySQL
COPY ddl-data.sql ./data/ddl-data.sql

# No correr como root
USER node

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
