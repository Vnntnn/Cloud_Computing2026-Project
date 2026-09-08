# Repository Guidelines

## Project Structure & Module Organization

Eventide is a Bun/Turborepo monorepo. Applications live in `apps/`: `auth`, `event`,
`registration`, and `payment` are Elysia services; `web` is a Vite/React SPA. Shared environment, model,
and JWT helpers belong in `packages/shared`; Drizzle schemas and database tooling belong in
`packages/db`. Keep service features under
`apps/<service>/src/modules/<feature>/`. Tests are stored in each workspace's `test/`
directory or beside shared code as `*.test.ts`.

Infrastructure is split between `infra/terraform/{00-bootstrap,10-foundation,20-platform}`
and the Helm chart at `infra/helm/eventide`. Operational scripts live in
`scripts/`; design decisions and progress are documented in `docs/`.

## Build, Test, and Development Commands

- `bun install`: install all workspace dependencies.
- `make dev`: start Postgres, create/migrate the four databases, and run all apps in watch mode.
- `make seed`: load local demo users, events, and registrations.
- `bun run build`: build workspaces through Turborepo.
- `bun run lint`: run Biome checks across the repository.
- `bun run check-types`: run TypeScript validation without emitting files.
- `bun run test`: execute Bun test suites.
- `make k3d` / `make k3d-down`: manage the local Kubernetes parity environment.

For AWS sessions, use `make up`, `make db-bootstrap`, `make deploy`, and always finish with
`make down` so billable EKS, RDS, and NLB resources are destroyed.

## Coding Style & Naming Conventions

Biome is authoritative: two-space indentation, 100-character lines, single quotes, and
semicolons only when required. Run `bun run format` before committing. Use TypeScript ESM,
`camelCase` for functions and variables, `PascalCase` for React components/types, and
kebab-case for infrastructure filenames. Preserve Elysia method chains and define request
models with Elysia `t`/TypeBox. Liveness endpoints must not query the database.

## Testing Guidelines

Use Bun's test runner and name files `*.test.ts`. Add focused tests for service routes,
database boundaries, shared utilities, and S3 signing behavior. There is no numeric coverage
gate; new behavior should include regression coverage. Run lint, type checks, tests, and the
relevant local or k3d flow before opening a PR.

## Commit & Pull Request Guidelines

History follows Conventional Commit-style subjects such as `feat(auth): ...`,
`docs(todo): ...`, and `chore: ...`. Keep commits scoped and imperative. PRs should explain
the change and trade-offs, list verification commands, link the relevant issue or TODO, and
include screenshots for UI changes or deployment evidence for infrastructure changes.

## Security & Configuration

Never commit AWS session credentials, OAuth secrets, `.env` files, or `*.auto.tfvars`.
Applications consume secrets through environment variables. Review `CLAUDE.md` and
`docs/PROJECT-KNOWLEDGE-BASE.md` before changing architecture or lab-specific infrastructure.
