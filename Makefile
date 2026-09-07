.PHONY: dev db bootstrap seed seed-eks up deploy down k3d k3d-down load help

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

seed: ## demo seed LOCAL (4 organisers + 15 events + 5 attendees w/ tickets) — needs `make dev` up
	bun run --filter @eventide/db db:seed

seed-eks: ## demo seed the DEPLOYED cluster (in-cluster one-off pod — RDS is private)
	bash scripts/seed.sh

# --- AWS: session lifecycle --------------------------------------------
# NODE_INSTANCE_TYPE=t3.medium for the week-4 HPA-to-8 load test (t3.small's
# ~11-pod ceiling is too tight); default t3.small keeps EC2 cost down otherwise.
up: ## apply 20-platform (EKS + RDS + NLB + ingress-nginx), point kubectl at it
	$(TF_PLATFORM) init -input=false
	$(TF_PLATFORM) apply -auto-approve $(if $(NODE_INSTANCE_TYPE),-var node_instance_type=$(NODE_INSTANCE_TYPE))
	aws eks update-kubeconfig --region us-east-1 --name eventide
	kubectl get nodes

deploy: ## build+push the 3 images to ECR, helm upgrade the eventide chart, roll out
	bash scripts/deploy.sh

db-bootstrap: ## create the 3 RDS databases + roles + run migrations (one-shot Job)
	bash scripts/db-bootstrap.sh

load: ## k6 autoscaling load test vs /api/events — pass BASE_URL=http://<nlb-dns>
	BASE_URL="$(BASE_URL)" k6 run load/k6/events.js

down: ## destroy 20-platform and verify nothing survived — run at EVERY session end
	bash scripts/teardown.sh

# --- local parity: k3d running the same Helm chart as EKS ------------
k3d: ## local k3d cluster + ingress-nginx + the eventide chart (values-local)
	bash scripts/k3d-up.sh

k3d-down: ## delete the local k3d cluster + its registry
	bash scripts/k3d-down.sh
