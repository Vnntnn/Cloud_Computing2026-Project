# syntax=docker/dockerfile:1
# Build context is the REPO ROOT. Build for the EKS node arch:
#   docker build -f apps/event/Dockerfile --platform linux/amd64 -t eventide/event .
#
# Compiled to a single Bun binary (SYSTEM-DESIGN §12.1): 2-3x lower runtime
# memory than running the source, which matters for pod density on t3.medium.
# glibc build image -> glibc distroless runtime (NOT alpine/musl).

FROM oven/bun:1 AS build
WORKDIR /app

# Cached install keyed on the workspace manifests only.
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/event/package.json apps/event/
RUN bun install --frozen-lockfile

COPY packages ./packages
COPY apps/event ./apps/event

ENV NODE_ENV=production
# --minify-whitespace/--minify-syntax only (full --minify mangles names).
RUN cd apps/event && bun build \
      --compile \
      --minify-whitespace \
      --minify-syntax \
      --target bun \
      --outfile /app/server \
      src/index.ts

FROM gcr.io/distroless/base-debian12:nonroot
WORKDIR /app
COPY --from=build /app/server ./server
ENV NODE_ENV=production
USER nonroot
EXPOSE 3000
CMD ["./server"]
