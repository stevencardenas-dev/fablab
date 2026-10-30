# Sitio web de la PWA. Se compila DENTRO de la imagen con la API en /api del
# mismo dominio (nginx la reenvía). Sin token: la app inicia sesión.
# Construir desde fablab-inventario/ (lo hace docker compose).
FROM node:20-bookworm-slim AS build
ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="fablab-web" \
      org.opencontainers.image.version="$APP_VERSION"
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Sitekey PÚBLICO del captcha Turnstile (build-arg opcional, vacío = sin captcha).
# El secreto NUNCA va aquí: vive en docker/.env y solo lo usa la API.
ARG EXPO_PUBLIC_TURNSTILE_SITEKEY=
ENV EXPO_PUBLIC_API_URL=/api \
    EXPO_PUBLIC_TURNSTILE_SITEKEY=$EXPO_PUBLIC_TURNSTILE_SITEKEY \
    NODE_OPTIONS=--max-old-space-size=3072
RUN npx expo export --platform web --clear \
 && cp dist/index.html dist/404.html

FROM nginx:1.27-alpine
COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 80
