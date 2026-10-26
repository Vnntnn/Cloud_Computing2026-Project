# eventide — the app chart

One release, every workload of the v2 app:

| Workload | Kind | Image | Notes |
|---|---|---|---|
| `auth`, `event`, `registration`, `payment` | Deployment + Service + Ingress path | `eventide/<name>` | `/api/auth`, `/api/events`, `/api/regis`, `/api/payment`; probes on `/api/<prefix>/health` |
| `mail-worker` | Deployment only | `eventide/mail-worker` | SQS consumer, no HTTP, no probes |
| `redis` | Deployment + Service `:6379` | `redis:8-alpine` (public) | session cache for `@app/auth-guard`; no persistence |
| `web` | Deployment + Service + Ingress `/` | `eventide/web` | Bun server: serves `dist/` + injects per-URL `<head>` (Open Graph); needs `BETTER_AUTH_URL`, `EVENT_SERVICE_URL` |
| `files` | ExternalName Service + Ingress `/files/(.*)` | — | rewrites to `/<bucket>/$1` on S3 (EKS) or MinIO (k3d) |
| `db-migrate` | Job, `pre-install,pre-upgrade` hook | `eventide/db-bootstrap` | `drizzle-kit migrate` before pods roll |
| `payment` rollout | `strategy: Recreate`, grace 210 s | — | never two versions at once (refunds follow rules a release changes): `values.yaml` has the reason; `scripts/lib.test.sh` checks the rendered chart; steps in `docs/tickets.md` §10 |
| `event` HPA | HorizontalPodAutoscaler | — | AWS overlay only, 2 → 8 on 60 % CPU |

Not here: ingress-nginx and the NLB (cluster lifecycle — `20-platform/addons.tf`, `scripts/k3d-up.sh`).

## Values

- `values.yaml` — defaults. `values.local.yaml` — k3d (in-cluster registry, 1 replica, MinIO via `host.k3d.internal`). `values.aws.yaml` — EKS (ECR, 2 replicas, HPA, S3 path-style).
- Per deploy: `--set imageRegistry=… --set publicUrl=… --set files.bucket=… --set dbMigrate.image.tag=… --set services.<x>.image.tag=…` (`scripts/deploy.sh`, `scripts/k3d-up.sh`).
- `commonEnv` is rendered into every app pod (`REDIS_URL`, `AUTH_SERVICE_URL`, `BETTER_AUTH_URL`, `DB_POOL_MAX`); `commonSecretName` + `services.<x>.secretName` are `envFrom`'d. The chart never creates Secrets — the scripts do (ESO templates stay behind `eso.enabled` for a non-lab environment).

The release is recorded in the `eventide` namespace (`helm -n eventide ls`); every resource carries `namespace: eventide` explicitly.

## Render / lint

```sh
helm lint . -f values.yaml -f values.local.yaml
helm template t . -f values.yaml -f values.aws.yaml --set files.bucket=b | less
```
