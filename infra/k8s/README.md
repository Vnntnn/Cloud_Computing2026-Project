# infra/k8s

Raw manifests for the app on EKS (and k3d). The single Helm chart with
`values-local` / `values-aws` replaces these in week 2; for now `kubectl apply`
is enough.

| File | What |
|---|---|
| `event.yaml` | `eventide` namespace + `event` Deployment / Service / Ingress. |
| `db-bootstrap.job.yaml` | one-shot Job — creates `auth_db`/`event_db`/`registration_db` + owner roles on RDS, runs migrations. `bash scripts/db-bootstrap.sh` (or `make db-bootstrap`). |

## Prerequisites

- `make up` — applies `20-platform` (EKS + RDS + NLB + **ingress-nginx**, all Terraform)
  and points `kubectl` at the cluster. ingress-nginx is `helm_release` in
  `20-platform/addons.tf` now, not a manual `helm install`.

## Build + push an image

```bash
REG=$(terraform -chdir=infra/terraform/10-foundation output -raw ecr_registry)
TAG=v1   # or: git rev-parse --short HEAD

aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "$REG"
docker build -f apps/event/Dockerfile --platform linux/amd64 -t "$REG/eventide/event:$TAG" .
docker push "$REG/eventide/event:$TAG"
```

Build context is the **repo root** (the Dockerfile copies workspace manifests).
`--platform linux/amd64` is required — the EKS nodes are x86, your Mac is arm64.

## Deploy

```bash
make deploy          # = scripts/deploy.sh: build → push → apply → set image → rollout
# or a specific tag / subset:
bash scripts/deploy.sh v1
SERVICES="event auth" bash scripts/deploy.sh
```

`event.yaml` ships `PLACEHOLDER_EVENT_IMAGE` on purpose — `scripts/deploy.sh` does
`kubectl set image` to pin the real tag, so the manifest never carries a stale
digest.

## GATE — reachable through the NLB

```bash
NLB=$(terraform -chdir=infra/terraform/20-platform output -raw nlb_dns_name)
curl -s "http://$NLB/health/live"      # {"status":"ok","service":"event"}
curl -s "http://$NLB/api/events"       # []
open "http://$NLB/swagger"
```

## Egress check (needed later for Google OAuth)

```bash
kubectl -n eventide run egress --rm -it --image=curlimages/curl --restart=Never -- \
  curl -sS -o /dev/null -w '%{http_code}\n' https://accounts.google.com
```

`200`/`302` means pods reach the internet through the IGW with no NAT gateway.
