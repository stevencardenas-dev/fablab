# Sitio web de la PWA. Se compila DENTRO de la imagen, con el token de
# docker/.env y la API en /api del mismo dominio (nginx la reenvía).
# Construir desde fablab-inventario/ (lo hace docker compose).
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG API_TOKEN
ENV EXPO_PUBLIC_API_URL=/api \
    NODE_OPTIONS=--max-old-space-size=3072
RUN test -n "$API_TOKEN" \
 && EXPO_PUBLIC_API_TOKEN="$API_TOKEN" npx expo export --platform web --clear \
 && cp dist/index.html dist/404.html

FROM nginx:1.27-alpine
COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 80
