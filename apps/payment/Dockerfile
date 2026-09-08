# syntax=docker/dockerfile:1
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/payment/package.json apps/payment/
RUN bun install --frozen-lockfile
COPY packages ./packages
COPY apps/payment ./apps/payment
ENV NODE_ENV=production
RUN cd apps/payment && bun build --compile --minify-whitespace --minify-syntax --target bun --outfile /app/server src/index.ts

FROM gcr.io/distroless/base-debian12:nonroot
WORKDIR /app
COPY --from=build /app/server ./server
ENV NODE_ENV=production
USER nonroot
EXPOSE 3000
CMD ["./server"]
