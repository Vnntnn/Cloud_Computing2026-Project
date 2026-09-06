.PHONY: dev db bootstrap k3d deploy teardown

# --- inner loop -------------------------------------------------------------
db: ## start the local Postgres container
	docker compose up -d db

bootstrap: db ## create the 3 service DBs + roles, run drizzle migrations
	@printf 'waiting for postgres'; \
	until docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; do printf '.'; sleep 1; done; \
	echo
	bun run --filter @eventide/db db:bootstrap

dev: bootstrap ## postgres + the 3 services in watch mode
	bun run dev

# --- not implemented yet — see docs/TODO.md --------------------------------
k3d deploy teardown:
	@echo "'$@' is not implemented yet — see docs/TODO.md" && exit 1
