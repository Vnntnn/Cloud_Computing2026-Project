.PHONY: dev db bootstrap seed up deploy down k3d k3d-down load help

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

seed: ## demo seed (organisers via auth + ~15 events) — needs the services running
	bun run --filter @eventide/db db:seed

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

load: ## k6 autoscaling load test vs /api/events — pass BASE_URL=http://<nlb-dns>
	BASE_URL="$(BASE_URL)" k6 run load/k6/events.js

down: ## destroy 20-platform and verify nothing survived — run at EVERY session end
	bash scripts/teardown.sh

# --- local parity: k3d running the same infra/k8s manifests -----------
k3d: ## local k3d cluster + ingress-nginx + the same infra/k8s manifests
	bash scripts/k3d-up.sh

k3d-down: ## delete the local k3d cluster + its registry
	bash scripts/k3d-down.sh
