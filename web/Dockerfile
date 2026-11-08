# MARS display: static build served by Caddy, which also proxies /prom to Prometheus so the
# browser stays same-origin (ADR-0004). Build context is web/:
#   docker build -t mars web
# The build output is the same on every architecture, so it runs on the build machine's own
# platform: a multi-arch build (scripts/build-images.sh) only emulates the Caddy stage, and
# esbuild, a Go binary, crashes under QEMU's x86_64 emulation on arm64 hosts.
FROM --platform=$BUILDPLATFORM node:26.13.0-alpine AS build
WORKDIR /app
# The build needs no browsers; Playwright is only for `npm run smoke`.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY mars-entrypoint.sh /usr/bin/mars-entrypoint
COPY --from=build /app/dist /srv
# Where Caddy looks for config documents. Mount a directory here; empty is fine. auth.caddy is
# the basic-auth snippet the entrypoint writes (empty unless MARS_BASIC_AUTH is set).
RUN mkdir -p /config && touch /etc/caddy/auth.caddy
EXPOSE 8080
# Setting ENTRYPOINT drops the base image's CMD, so it is repeated here.
ENTRYPOINT ["/usr/bin/mars-entrypoint"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
