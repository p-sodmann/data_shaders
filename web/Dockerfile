# MARS display: static build served by Caddy, which also proxies /prom to Prometheus so the
# browser stays same-origin (ADR-0004). Build context is web/:
#   docker build -t mars web
FROM node:22-alpine AS build
WORKDIR /app
# The build needs no browsers; Playwright is only for `npm run smoke`.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
# Where Caddy looks for config documents. Mount a directory here; empty is fine.
RUN mkdir -p /config
EXPOSE 8080
