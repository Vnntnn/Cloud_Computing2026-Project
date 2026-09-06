.PHONY: dev db bootstrap up deploy down k3d help

TF_PLATFORM := terraform -chdir=infra/terraform/20-platform

help: ## list targets
	@grep -hE '^[a-z-]+:.*##' $(MAKEFILE_LIST) | sed 's/:.*## /\t/' | sort

# --- inner loop (local) ---------------------------------------------------
db: ## start the local Postgres container
	docker compose up -d db

bootstrap: db ## create the 3 service DBs + roles, run drizzle migrations
	@printf 'waiting for postgres'; \
	until docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; do printf '.'; sleep 1; done; \
	echo
	bun run --filter @eventide/db db:bootstrap

dev: bootstrap ## postgres + the 3 services in watch mode
	bun run dev

# --- AWS: session lifecycle --------------------------------------------
up: ## apply 20-platform (EKS + RDS + NLB + ingress-nginx), point kubectl at it
	$(TF_PLATFORM) init -input=false
	$(TF_PLATFORM) apply -auto-approve
	aws eks update-kubeconfig --region us-east-1 --name eventide
	kubectl get nodes

deploy: ## build+push the app image(s), apply infra/k8s, roll out
	bash scripts/deploy.sh

db-bootstrap: ## create the 3 RDS databases + roles + run migrations (one-shot Job)
	bash scripts/db-bootstrap.sh

down: ## destroy 20-platform and verify nothing survived — run at EVERY session end
	bash scripts/teardown.sh

# --- not implemented yet — see docs/TODO.md ---------------------------
k3d: ## (week 1 Day 4) local k3d cluster with the same manifests
	@echo "'$@' is not implemented yet — see docs/TODO.md" && exit 1
