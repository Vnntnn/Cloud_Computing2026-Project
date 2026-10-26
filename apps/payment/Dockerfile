# syntax=docker/dockerfile:1
# Build context is the REPO ROOT:
#   docker build -f apps/payment/Dockerfile --platform linux/amd64 -t eventide/payment .
#
# Compiled to a single Bun binary on glibc distroless (SYSTEM-DESIGN §12.1):
# 2-3x lower runtime memory than running the source. glibc build image ->
# glibc distroless runtime (NOT alpine/musl).

FROM oven/bun:1 AS build
WORKDIR /app

# Install keyed on the workspace manifests only — every workspace's package.json,
# so the frozen lockfile resolves as-is. Identical across all images, so this
# layer is built once and shared.
COPY package.json bun.lock tsconfig.json ./
COPY apps/auth/package.json apps/auth/
COPY apps/event/package.json apps/event/
COPY apps/mail-worker/package.json apps/mail-worker/
COPY apps/payment/package.json apps/payment/
COPY apps/registration/package.json apps/registration/
COPY apps/web/package.json apps/web/
COPY packages/auth-guard/package.json packages/auth-guard/
COPY packages/db/package.json packages/db/
COPY packages/mail/package.json packages/mail/
COPY packages/storage/package.json packages/storage/
COPY packages/tickets/package.json packages/tickets/
RUN bun install --frozen-lockfile

COPY packages ./packages
COPY apps/payment ./apps/payment

ENV NODE_ENV=production
# --minify-whitespace/--minify-syntax only (full --minify mangles names).
RUN cd apps/payment && bun build --compile --minify-whitespace --minify-syntax --target bun \
      --outfile /app/server src/index.ts
# Second entrypoint: the read-only release check (scripts/release.sh runs it as a one-off pod with this pod's env and Secrets).
RUN cd apps/payment && bun build --compile --minify-whitespace --minify-syntax --target bun \
      --outfile /app/preflight scripts/preflight.ts

FROM gcr.io/distroless/base-debian12:nonroot
WORKDIR /app
COPY --from=build /app/server ./server
COPY --from=build /app/preflight ./preflight
ENV NODE_ENV=production
USER nonroot
EXPOSE 3000
CMD ["./server"]
