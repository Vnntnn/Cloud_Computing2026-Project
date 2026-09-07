# Week 1 close-out runbook

Two things are left in Week 1 (`docs/TODO.md` §2):

1. `make db-bootstrap` runs clean against RDS — blocked only on pushing the
   `db-bootstrap` image to ECR (the image is now ~89 MB, down from 185 MB).
2. **`GATE`** — full `destroy` → rebuild from zero, end to end.

Everything needed is already written (Helm chart, `deploy.sh`, `seed.ts`,
`teardown.sh`). This is one focused lab session, ~60–75 min including the two
`make up`s.

> **Never start a `make up` after hour 3 of the session** — session creds expire
> mid-apply and leave a half-built billable stack.

---

## 0. Prep (before starting the lab)

- [ ] `bash scripts/check-lab.sh` after the lab starts — role suffixes change on
      every reset. If it flags new denials, stop and reconcile before applying.
- [ ] Decide the ECR push path:
  - **off-VPN** — simplest, just disconnect the VPN for `make deploy` /
    `db-bootstrap.sh`; or
  - **on-VPN** — the slimmed image (`oven/bun:1-slim`, focused deps) should get
    through now; if a blob PUT still hangs, lower OrbStack's MTU or go off-VPN.

## 1. Start the lab

```sh
# Learner Lab UI: Start Lab. Note the credit remaining.
# Copy the AWS CLI credentials block into ~/.aws/credentials.
aws sts get-caller-identity          # ASIA… ARN, account 735838417080
```

## 2. Bring the platform up  (~18 min — start it, then do something else)

```sh
make up          # terraform apply 20-platform + kubeconfig + get nodes
kubectl get nodes                    # expect: 2 Ready
```

## 3. Databases

```sh
bash scripts/db-bootstrap.sh         # build+push db-bootstrap, Secret from rds-master, run the Job
kubectl -n eventide logs job/db-bootstrap   # "bootstrap complete"
```

## 4. Deploy the app

```sh
make deploy                          # build+push 3 images -> helm upgrade -f values.aws.yaml
NLB=$(terraform -chdir=infra/terraform/20-platform output -raw nlb_dns_name)
curl -s "http://$NLB/health/live"     # {"status":"ok","service":"event"}
curl -s "http://$NLB/api/auth/jwks"   # EdDSA key
bash scripts/seed.sh                  # in-cluster (RDS is private): 4 organisers + 15 events
curl -s "http://$NLB/api/events" | jq length   # 15
```

### Quick app check (proves the whole topology)

```sh
TOK=$(curl -s -X POST "http://$NLB/api/auth/sign-in/email" -H 'content-type: application/json' \
  -d '{"email":"nadia@eventide.test","password":"seed-password-123"}' -D - -o /dev/null \
  | awk 'tolower($1)=="set-auth-token:"{print $2}' | tr -d '\r')
JWT=$(curl -s "http://$NLB/api/auth/token" -H "Authorization: Bearer $TOK" | jq -r .token)
EID=$(curl -s "http://$NLB/api/events" | jq -r '.[0].id')
curl -s -X POST "http://$NLB/api/registrations" -H "Authorization: Bearer $JWT" \
  -H 'content-type: application/json' -d "{\"eventId\":\"$EID\"}"     # a ticket
```

### The cross-DB boundary GATE (§4, a demo moment)

```sh
# distroless has no shell — run a one-off pod with the db-bootstrap image:
kubectl -n eventide run boundary --restart=Never --rm --attach \
  --image="$REG/eventide/db-bootstrap:$TAG" \
  --overrides='{"spec":{"securityContext":{"runAsNonRoot":true,"runAsUser":1000}}}' \
  --env="RG=$(aws secretsmanager get-secret-value --secret-id eventide/rds-master --query SecretString --output text \
        | jq -r '"postgres://event_svc:\(.EVENT_SVC_PASSWORD)@\(.host):\(.port)/registration_db?sslmode=require"')" \
  --command -- bun -e 'import p from "postgres"; try{await p(process.env.RG,{max:1})`select 1`;console.log("REACHABLE (BAD)")}catch(e){console.log(e.message)}'
#   → permission denied for database "registration_db"
```

## 5. **The GATE — rebuild from zero**

```sh
time make down                       # teardown.sh: destroy + verify EKS/RDS/ELB/EC2/TG empty
# read the verification output — every check must be empty

time make up                         # from nothing
bash scripts/db-bootstrap.sh
make deploy
bash scripts/seed.sh
# re-run the quick app check above — same results
```

Record both `time`s in `docs/TODO.md` §2 Day 4 (previous rebuild-from-zero was
~20 min).

## 6. Session end — non-negotiable

```sh
make down
# read the sweep — empty everywhere. 10-foundation (ECR/S3/Secrets) stays.
# Learner Lab UI: check credit. ~$1.50 for this session is expected; more means
# something survived — find it now.
```

---

## Notes

- **Deploy path:** `deploy.sh` reads `eventide/rds-master` with the lab session
  creds and `kubectl create secret`s `eventide-{auth,event,registration}`, then
  `helm upgrade` (`eso.enabled=false`). If a pod is `CreateContainerConfigError`
  on a Secret key: `deploy.sh` didn't run this session, or the creds it used are
  stale — re-run `bash scripts/deploy.sh`.
- **ESO is not used on EKS** (SYSTEM-DESIGN §5.2.1) — it would need a static-cred
  `secretRef` that expires per session, no gain over `deploy.sh`. The chart
  templates stay behind `eso.enabled` for a non-lab env.
- `scripts/lab-creds.sh` is **not needed** — `deploy.sh` handles every credential
  the cluster needs (the `AWS_*` keys in `eventide-event` for S3 presigning).
- `iam:AttachRolePolicy` is **denied** (confirmed 2026-09-07). If a future lab
  reset changes that, `event` could drop the static S3 creds for node-role IMDS —
  a nice-to-have, not required.
