# syntax=docker/dockerfile:1
# Build context is the REPO ROOT:
#   docker build -f apps/web/Dockerfile -t eventide/web .
#
# Static SPA served by nginx from inside the cluster, behind the same
# ingress-nginx as the API — one origin, no CORS, no mixed content, and no
# CloudFront (denied in the lab — docs/lab-probe-2026-09-07.txt). SYSTEM-DESIGN
# §5.5 wants a single origin anyway.

FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/auth/package.json apps/auth/
COPY apps/event/package.json apps/event/
COPY apps/registration/package.json apps/registration/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile
COPY packages ./packages
COPY apps/auth ./apps/auth
COPY apps/event ./apps/event
COPY apps/registration ./apps/registration
COPY apps/web ./apps/web
# vite build only — `tsc --noEmit` is CI's job (turbo check-types), and it needs
# the whole workspace's type graph which isn't worth reconstructing in the image.
RUN cd apps/web && bunx --bun vite build

# nginx-unprivileged: runs as uid 101, listens on 8080 — fits a locked-down pod.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
