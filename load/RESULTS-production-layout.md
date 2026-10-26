# Load test results — production layout, 2026-10-26

Measured on the layout merged to `main` in PR #15/#16: dedicated VPC with edge / egress / data tiers, **ElastiCache** (1 node,
`cache.t3.micro`, TLS + AUTH), **RDS Proxy** in front of RDS `db.t3.micro`, **ALB + WAF** (block mode), EKS 1.33 on 3 × `t3.medium`
(2 edge + 1 egress). `event`, `auth` and `registration` ran 2 replicas each. The database held one admin user and one public event
(`load/seed.sh`). The previous layout's numbers are in [RESULTS.md](RESULTS.md); read section 4 before comparing the two.

Scripts are the ones in this directory: `k6/redis-compare.js` (from a pod inside the cluster, on the egress tier, 200 req/s constant
arrival rate, 90 s per case) and `k6/all.js` (from a laptop through `https://eventide.creasy.club`, 30 VUs per endpoint, 3 min).
The WAF's per-IP rate rule was raised to 1,000,000 per 5 min for the run (`TF_VAR_waf_rate_limit`); the in-cluster runs do not pass
through the ALB or the WAF at all.

**How Redis was switched off.** Redis is no longer a pod, so it cannot be scaled to zero. For `auth`, `event` and `registration`
the container's `REDIS_URL` was overridden to `redis://127.0.0.1:6379` (connection refused, no code change):
`kubectl set env deployment/auth deployment/event deployment/registration REDIS_URL=…`, wait for the rollouts, run, then
`REDIS_URL-` to remove the override (22 s back to normal, verified with a write to ElastiCache). `payment` was left alone: changing it
outside `scripts/release.sh` would sidestep the payment release gate. Every "off" run therefore started on **fresh pods**.

## 1. How long things take

| What | Time |
|---|---|
| `make down` of the previous (old-layout) platform | 12 min 21 s (21 resources, all 14 verification lists `gone`) |
| `make deploy` from main, whole | **32 min 45 s** (0 preflight 2 s · 1 state 13 s · 3 permanent layer 23 s · 4 DNS + certificate 20 s · 5 image mirrors 1 min 12 s · **6 platform 24 min 38 s** · 7 application 5 min 48 s · 8 smoke test 8 s) |
| of which the platform apply, by resource | EKS control plane 10 min 31 s · RDS instance 5 min 4 s · **RDS Proxy 5 min 18 s** (it waits for the database) · ElastiCache 4 min 34 s · ALB 2 min 27 s · NAT gateway 1 min 29 s · node groups ~1 min 30 s · interface endpoints 35-54 s. The critical path is EKS, then RDS, then the proxy |
| of which the application step (5 min 48 s) | setup (Terraform outputs, kubeconfig, ECR login) 1 min 46 s · 7 image builds + pushes 1 min 49 s (cached layers) · Helm install with the migrate hook and the rollouts 2 min 13 s |
| Redis off: set the override and finish the three rollouts | 1 min 39 s |
| Redis back on | 22 s |
| `make down` of this layout | **not completed**: the lab ended the session 4 min 48 s in (13:07Z). The WAF, the ALB and ElastiCache were already gone; the rest was left for the next `make down`, which recovers the saved state by itself. The old layout's full teardown took 12 min 21 s, so budget at least that |

The delegation step took 20 s because the zone and certificate already existed (no reset happened for them). A real reset adds the
Cloudflare change and the wait for the certificate.

## 2. Redis on vs off (inside the cluster, 200 req/s, 90 s per case)

| Case | Redis | p50 | p95 | p99 | max | failed | achieved | dropped iterations |
|---|---|---|---|---|---|---|---|---|
| event detail `GET /api/events/:slug` | on | 2.4 ms | 4.9 ms | 18 ms | 73 ms | 0% | 200/s | 0 |
| event detail | **off** | 7.3 ms | **10.1 s** | **11.7 s** | 12.0 s | **6.4%** | 140/s | 5,422 |
| session `GET /api/regis/tickets/mine` | on | 9.0 ms | 141 ms | 1.16 s | 1.85 s | 0% | 199/s | 125 |
| session | **off** | 10.3 s | 11.8 s | 12.0 s | 12.1 s | **100%** | 34/s | 14,328 |
| control `GET /api/events` (Postgres only) | on | 6.7 ms | 13 ms | 96 ms | 322 ms | 0% | 200/s | 0 |
| control | off | 6.9 ms | 12 ms | 97 ms | 400 ms | 0% | 200/s | 0 |

CPU was sampled once per run with `kubectl top` (event detail: on 40m and 46m, off 88m and 7m per pod; session on: registration 150m and 183m): one sample, so it is not used for any conclusion below.

What the numbers say:

- **The control did not move** (p50 6.7 → 6.9 ms, p95 13 → 12 ms). So the differences below are Redis, not the cluster or the day.
- **With Redis, the event detail is about 3x faster at the median** once both have settled (2.4 ms against 7.3 ms, the latter being the Postgres path).
- **Without Redis the damage is not slowness, it is an outage window.** Detail: for the first ~33 s requests waited 10-12 s for their
  timeout (no request completed in the first ~11 s and all 400 VUs were busy), then the services fell through to Postgres and ran at
  200/s with 1-3 busy VUs. That window is what the p95/p99 of 10-12 s and the 6.4% failures are; after it the median is 7 ms.
- **The session path never recovered**: all 400 VUs stayed busy for the whole 90 s, 100% failed. The errors in the k6 log are `EOF` and
  `connection refused` against the `registration` Service, i.e. the `registration` pods were crash-looping or gone, not rate-limited.
  This matches an earlier finding (registration gives up its Redis connection and exits). It is an inference from the error pattern:
  the pods were replaced when Redis was switched back on, so their logs were not read.
- Cost of the cache hit itself: on this layout it is not free. Event detail p50 is 2.4 ms against 0.76 ms in the earlier pod-Redis run:
  a TLS connection to ElastiCache instead of a plaintext hop to a pod. Still 3x cheaper than Postgres.

## 3. All services through the public host (ALB + WAF)

87,725 requests in 3 min (480 req/s), **0 failed**, all 114,492 checks passed, all 24 thresholds passed.
Overall: avg 311 ms, median 274 ms, p95 376 ms, p99 1.28 s, max 8.98 s. The ~270-300 ms floor is the laptop-to-us-east-1 round trip,
as before.

| Endpoint | p95 |
|---|---|
| `/api/auth/health` · `/api/events/health` · `/api/regis/health` · `/api/payment/health` | 284 · 288 · 296 · 285 ms |
| `GET /api/events` (list) | 313 ms |
| `GET /api/events/:slug` (detail) | 300 ms |
| `GET /api/regis/tickets/mine` (session cookie) | 373 ms |
| `GET /api/regis/events/:id/availability` | 395 ms |
| `/` (web, Bun server with the per-URL head) | 543 ms |
| `/api/events/og/site` (renders a 1200x630 JPEG) | **1.4 s**, the heaviest and closest to its 1.5 s threshold |

No endpoint was blocked by the WAF at this rate (raised for the run). At the default 10,000 requests per 5 min per IP a single-source
run like this one would hit the limit after about 20 s (480 req/s x 20 s, arithmetic, not measured).

## 4. Read this before comparing with the previous layout

- **Not like for like.** The earlier "Redis off" scaled the Redis pod to zero while the app pods kept running (their clients were already
  connected); this time the pods started with an unreachable Redis. The earlier detail run therefore showed no failures and no stall, this one shows
  a ~33 s stall. Both are real failure modes; the second is what a restart during a Redis outage does.
- **One run per condition**, not repeated: there was not enough lab session left. Differences of a few percent are noise; the on/off gaps
  above are far larger than that, and the control agrees with itself.
- **Unexplained:** the session path with Redis *on* had a worse tail than before (p99 1.16 s, max 1.85 s, 125 dropped iterations, against p99
  213 ms). During that run RDS Proxy turned 11 client connections into 5 database connections, no session was pinned, RDS CPU was 15-18%
  and a query through the proxy averaged 1.5-5.7 ms, so the database was not the limit. A single stall of about 2 s early in the run
  (more VUs than `maxVUs` 400 would cover) fits; the cause was not found. It needs a repeat.
- **Not measured:** HPA scale-out (`k6/events.js`), the `payment` path, anything that writes, and a repeat of the all-services run to get
  per-endpoint percentiles beyond p95.
