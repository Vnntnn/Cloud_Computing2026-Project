# eventide Helm chart

The three microservices (`auth`, `event`, `registration`) as **one release**.
Replaces the raw `infra/k8s/*.yaml` manifests (SYSTEM-DESIGN §12).

> Deviation from SYSTEM-DESIGN §12 ("one chart, three releases"): this is one
> chart, **one** release that ranges over `.Values.services`. Still independent
> Deployments / Services / HPAs — but one `helm upgrade`, one revision history,
> no chance of the three drifting apart. Splitting into three releases later is
> just three `helm install`s against the same chart.

What the chart does **not** own: ingress-nginx, the NLB, the cluster itself —
those belong to `20-platform` (EKS) / `scripts/k3d-up.sh` (k3d).

## Layout

| File | |
|---|---|
| `values.yaml` | defaults — the three `services`, resources, probes, security context |
| `values.local.yaml` | k3d overlay — in-cluster registry, `publicUrl` = the k3d LB, no ESO, 1 replica |
| `values.aws.yaml` | EKS overlay — HPA on `event`, 2 replicas, `eso.enabled: false` (deploy.sh creates the Secrets — §5.2.1) |
| `templates/deployment.yaml` | ranges over `.Values.services`; per-service env via `tpl` |
| `templates/service.yaml` / `ingress.yaml` | ClusterIP + one shared Ingress (paths per service) |
| `templates/hpa.yaml` | rendered per service where `hpa.enabled` |
| `templates/externalsecrets.yaml` | `ClusterSecretStore` + one `ExternalSecret` per Secrets Manager secret, when `eso.enabled` |
| `templates/db-bootstrap-job.yaml` | the migration Job as a `post-install,post-upgrade` hook, when `dbBootstrap.enabled` |

## Cross-service wiring (injected, not in values)

- `auth.BETTER_AUTH_URL` = `publicUrl`
- `event` / `registration`: `AUTH_BASE_URL` = `publicUrl` (JWT iss/aud),
  `AUTH_JWKS_URL` = `http://auth.<ns>.svc.cluster.local/api/auth/jwks`
- `registration.EVENT_SERVICE_URL` = `http://event.<ns>.svc.cluster.local`

`DATABASE_URL` (+ `BETTER_AUTH_SECRET`, `GOOGLE_*`) come from the
`eventide-<svc>` Secret via `envFrom` — `scripts/deploy.sh` creates it from
Secrets Manager `eventide/rds-master` on EKS, `scripts/k3d-up.sh` from a local
file on k3d. The `eso.enabled` templates are an alternative for a non-lab env
(§5.2.1).

## Deploy

The namespace is **not** in the chart — create it first (`kubectl create ns
eventide` or `helm ... -n eventide --create-namespace`).

### k3d

```sh
for s in auth event registration; do
  docker build -f apps/$s/Dockerfile -t localhost:5111/eventide/$s:local .
  docker push localhost:5111/eventide/$s:local
done
# app secrets — point at the host compose Postgres
kubectl -n eventide create secret generic eventide-auth \
  --from-literal=DATABASE_URL=postgres://auth_svc:auth_svc@host.k3d.internal:5432/auth_db \
  --from-literal=BETTER_AUTH_SECRET=<same secret that created auth_db.jwks> --dry-run=client -o yaml | kubectl apply -f -
# ... eventide-event, eventide-registration likewise

helm upgrade --install eventide infra/helm/eventide \
  -f infra/helm/eventide/values.yaml -f infra/helm/eventide/values.local.yaml \
  --set services.auth.image.tag=local \
  --set services.event.image.tag=local \
  --set services.registration.image.tag=local --wait
```

Verified 2026-09-07: all three services up, reachable at `http://localhost:8080`
— sign-in → JWT → book a seeded event, dup → 409, `/me` enriched, 401 without a
token. The compiled Bun binary on distroless runs fine in-cluster.

### EKS

```sh
REG=$(terraform -chdir=infra/terraform/10-foundation output -raw ecr_registry)
helm upgrade --install eventide infra/helm/eventide \
  -f infra/helm/eventide/values.yaml -f infra/helm/eventide/values.aws.yaml \
  --set imageRegistry=$REG \
  --set publicUrl=https://<domain> --set ingress.host=<domain> \
  --set services.auth.image.tag=$TAG ... --wait
```

> **TODO:** `scripts/deploy.sh` and `scripts/k3d-up.sh` still apply the raw
> `infra/k8s/event.yaml`. Point them at this chart (and add the app-Secret
> creation step k3d now needs).
