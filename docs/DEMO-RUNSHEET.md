# Demo runsheet

Live-demo script for the final presentation (Week 4, ~2 Oct 2026). Companion to
`SYSTEM-DESIGN.md` §14 (the sequence) and `TODO.md` §5 (rehearsal GATEs).

> **The rule:** after Rehearsal 2 passes clean, stop changing things. Every edit
> after that point trades a known-good demo for an unverified one.

---

## The evening before

- [ ] Learner Lab credit checked — need headroom for a full rebuild + the demo
      (~$1.50). If it's tight, do the rehearsal earlier in the day.
- [ ] `git status` clean, on the branch that has everything.
- [ ] `scripts/check-lab.sh` — role suffixes / permissions unchanged since last
      session. Re-probe if the lab was reset.
- [ ] Google OAuth client still has both redirect URIs registered
      (`http://localhost:3000/...` and the deployed one).
- [ ] Slides export to PDF and live on a second device — not dependent on the
      laptop running the demo.
- [ ] Terminal: font size up, `kubectl` context set, two extra panes ready.
- [ ] **Fallback rehearsed:** `kubectl port-forward svc/auth 3000:3000` — Google
      accepts `localhost`, and it's still the real cluster. Use if DNS/TLS
      misbehave.

## Pre-flight (start ~25 min before presenting)

- [ ] Lab → Start Lab. Copy credentials into `~/.aws/credentials`.
- [ ] `make up` — EKS + RDS + NLB + ingress-nginx. ~18 min. **Start it, then set
      up slides / talk through the intro.** Never start this after session
      hour 3.
- [ ] `aws eks update-kubeconfig --region us-east-1 --name eventide`
- [ ] `kubectl get nodes` → 2 Ready.
- [ ] `make db-bootstrap` — 3 databases + roles + migrations.
- [ ] Refresh in-cluster credentials Secret if the `AttachRolePolicy` route
      wasn't taken (`scripts/lab-creds.sh`).
- [ ] `make deploy` (all 3 services) → `kubectl -n eventide get pods` all Ready,
      HPA shows `cpu: N%/60%` (not `<unknown>` — means metrics-server is live).
- [ ] Run the seed. Confirm the SPA loads events and login works, end to end,
      **once**, before the room is watching.
- [ ] Leave `kubectl -n eventide get hpa event -w` running in a pane.

---

## Live sequence (~12–15 min)

### 1. Apply from nothing — *if* time and budget allow a fresh apply

If pre-flight already built it, instead show `terraform state list` and the
`make up` log scrollback, and talk through the three-layer split by lifetime.
Either way the point is: **the cluster is 100% code, rebuilt from zero ~20
times.**

### 2. The database boundary is enforced, not described

```sh
kubectl -n eventide exec -it deploy/event -- sh
# inside: connect as the event owner role, then:
psql "$DATABASE_URL" -c '\l'                      # can see event_db
psql "${DATABASE_URL/event_db/registration_db}" -c 'select 1'
#   → FATAL: permission denied for database "registration_db"
```

Say: *no cross-service foreign keys are possible — the engine refuses.*

### 3. Use the app

- Log in with Google.
- Create an event.
- Upload a cover image — **note the network tab: the PUT goes to
  `s3.amazonaws.com`, not to our API.** Bytes never enter the cluster.
- Register a ticket. Show capacity decrementing.
- (Optional) open a second browser, book until capacity hits zero, show the
  rejection — capacity enforced by `registration` counting its own rows.

### 4. Secrets are external, not baked in

```sh
# no secret material in the image or the rendered manifests
helm -n eventide get manifest eventide | grep -i -A2 'kind: Secret'   # → nothing
# the k8s Secret is populated by deploy.sh from Secrets Manager
kubectl -n eventide get secret eventide-auth -o jsonpath='{.data.DATABASE_URL}' | base64 -d
aws secretsmanager get-secret-value --secret-id eventide/rds-master --query SecretString --output text | jq 'keys'
```

Optional live rotation: change one value in `eventide/rds-master`, re-run
`SERVICES=<svc> bash scripts/deploy.sh` — the new pod picks up the new k8s Secret,
the other two services are untouched. (No ESO — SYSTEM-DESIGN §5.2.1. Rehearse
which value actually round-trips cleanly before doing this live.)

### 5. Scale under load

Two panes already visible:

```sh
kubectl -n eventide get hpa event -w
kubectl -n eventide get pods -l app=event -w
```

Third pane:

```sh
NLB=$(terraform -chdir=infra/terraform/20-platform output -raw nlb_dns_name)
make load BASE_URL="http://$NLB"
```

Talk through the k6 stages while replicas climb **2 → 8**, then drop the load
and show them settle back to 2. If Container Insights is on, switch to its
CPU / pod-count graph for the same window.

### 6. Destroy it, on purpose

```sh
make down
```

Read the verification sweep aloud — EKS, RDS, ELBv2, classic ELB, running EC2,
target groups all empty. `10-foundation` (ECR/S3/Secrets) intact by design.

*Closing line:* the real argument for tearing down every session isn't the
money — it's that the infrastructure has now been rebuilt from zero ~20 times,
so we know it works.

---

## Post-demo

- [ ] Confirm `make down` verification was actually empty (don't trust the
      adrenaline — re-read it).
- [ ] Check credit remaining. ~$1.50 for the session is expected; more means
      something survived — find it now.
- [ ] Screenshot everything worth putting in the report appendix while it's
      fresh.

---

## Rehearsal checklist (do this twice — `TODO.md` §5)

- [ ] **Rehearsal 1:** `make down` → `make up` from zero → full sequence above,
      **timed**. Note every stumble.
- [ ] Fix whatever broke.
- [ ] **Rehearsal 2:** same again, clean, timed. Should land inside 15 min.
- [ ] Freeze. No more changes.

### Known failure points to watch in rehearsal

| Symptom | Cause | Fix |
|---|---|---|
| HPA `targets: <unknown>/60%` | metrics-server not ready / TLS SAN | wait 60s; check `helm_release.metrics_server` applied |
| Pods `Pending` at ~8 replicas | VPC CNI pod-IP ceiling | that's the limit — don't scale past 8; or `t3.medium` |
| `make up` half-built | session creds expired mid-apply | never start after hour 3; re-`apply` to finish |
| OAuth redirect mismatch | deployed URL not in Google client | port-forward fallback over `localhost` |
| Image upload fails | bucket CORS | check `10-foundation` S3 CORS rule allows the SPA origin |
| pod `CreateContainerConfigError` on a Secret key | `deploy.sh` didn't run / `eventide/rds-master` stale | re-run `bash scripts/deploy.sh` with fresh lab creds |
