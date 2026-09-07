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
make seed AUTH_URL="http://$NLB"      # 4 organisers + 15 events
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
kubectl -n eventide exec -it deploy/event -- sh -lc '
  psql "${DATABASE_URL/event_db/registration_db}" -c "select 1"
'   # → FATAL: permission denied for database "registration_db"
```

## 5. **The GATE — rebuild from zero**

```sh
time make down                       # teardown.sh: destroy + verify EKS/RDS/ELB/EC2/TG empty
# read the verification output — every check must be empty

time make up                         # from nothing
bash scripts/db-bootstrap.sh
make deploy
make seed AUTH_URL="http://$(terraform -chdir=infra/terraform/20-platform output -raw nlb_dns_name)"
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

- `scripts/lab-creds.sh` (the per-session node-credential refresh in the TODO
  daily ritual) is **not needed** for the current deploy path — `deploy.sh`
  assembles the `eventide-<svc>` k8s Secrets directly from `eventide/rds-master`,
  and no app code calls the AWS SDK. It only comes back if the ESO path is
  adopted with node-role IMDS auth.
- If `check-lab.sh` shows `iam:AttachRolePolicy` is now permitted, that unlocks
  the ESO path (`docs/TODO.md` §3) — a separate task, not part of this close-out.
