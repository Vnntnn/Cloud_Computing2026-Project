# syntax=docker/dockerfile:1
# Build context is the REPO ROOT:
#   docker build -f packages/db/Dockerfile --platform linux/amd64 -t eventide/db-bootstrap .
#
# NOT a compiled binary (unlike the services) — `scripts/bootstrap.ts` shells out
# to `bunx drizzle-kit migrate`, which needs the drizzle-kit CLI, the config
# files and the migration SQL present at runtime. Runs as a one-shot Kubernetes
# Job against RDS: creates the 3 service databases + owner roles, then migrates
# event_db / registration_db (auth_db is better-auth's CLI — SYSTEM-DESIGN §4.2).

FROM oven/bun:1
WORKDIR /app

# devDependencies are needed at runtime here (drizzle-kit) — do NOT use --production.
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN bun install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY packages/db ./packages/db

ENV NODE_ENV=production
WORKDIR /app/packages/db
USER bun
ENTRYPOINT ["bun", "scripts/bootstrap.ts"]
