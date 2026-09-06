# syntax=docker/dockerfile:1
# Build context is the REPO ROOT:
#   docker build -f apps/registration/Dockerfile --platform linux/amd64 -t eventide/registration .
# Compiled Bun binary on glibc distroless (SYSTEM-DESIGN §12.1).

FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/registration/package.json apps/registration/
RUN bun install --frozen-lockfile

COPY packages ./packages
COPY apps/registration ./apps/registration

ENV NODE_ENV=production
RUN cd apps/registration && bun build \
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
