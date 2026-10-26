# Load test results — 2026-10-25

> **Measured on the previous layout** (an in-cluster Redis pod, an NLB, public subnets, no WAF). The same tests on the
> production layout (ElastiCache with TLS + AUTH, RDS Proxy, ALB + WAF, private tiers) were run on 2026-10-26: see
> [RESULTS-production-layout.md](RESULTS-production-layout.md), which also says why the two are not like for like.

Cluster: EKS, `t3.medium` nodes, public host `https://eventide.creasy.club`. Only **one node was Ready** during the
Redis comparison and the all-services run (the second went `NotReady` after the lab session restarted), so the absolute
numbers are lower-bound; each comparison used the same topology. `event`, `auth` and `registration` were pinned at 2 replicas.

Scripts: `load/seed.sh` (one admin + one public event), `load/k6/redis-compare.js`, `load/k6/all.js`, `load/k6/events.js` (HPA demo).

## 1. Redis on vs off (from inside the cluster, 200 req/s constant arrival rate, 90 s)

Redis sits on two read paths only: the event detail cache and the auth-guard session cache. The list endpoint reads Postgres
directly and is the control.

| Path | Redis | p50 | p95 | p99 | failed | CPU (mid-run) |
|---|---|---|---|---|---|---|
| event detail `GET /api/events/:slug` | on | 0.76 ms | 2.3 ms | 7.9 ms | 0% | event ~50m |
| event detail | off | 2.75 ms | 6.6 ms | 33 ms | 0% | event ~165m |
| session `GET /api/regis/tickets/mine` | on | 3.1 ms | 38 ms | 213 ms | 0% | registration ~195m |
| session | off | 2.0 ms | 105 ms | 492 ms | **91.1%** (503) | auth ~157m, registration ~120m |
| control `GET /api/events` (Postgres) | on / off | 2.3 / 2.4 ms | 7.1 / 12 ms | 66 / 52 ms | 0% | event ~140m |

The database held one event, so the detail gain is a floor.

**Why the session path fails without Redis.** Every request misses the cache and goes to `auth` `get-session`. `auth` answers
`429` (Better Auth rate limit; `apps/auth` sets none, so the default applies — the exact default was not verified) and the
guard turns that into `503 AUTH_UNAVAILABLE`. Reproduced in two runs (91.8% and 91.1%).

## 2. Findings about Redis failure handling

- With Redis gone, the first requests stall 5–23 s before falling through (the client queues commands first).
- After a short outage the clients reconnect on their own. After the ~9 min outage of the second run they did **not**:
  Redis held 0 keys, `registration` logged `ERR_REDIS_CONNECTION_CLOSED` / `Max reconnection attempts reached`, and every
  authenticated request returned 503 until the pods were restarted (`kubectl rollout restart`). The probes do not check
  Redis, so nothing restarted them.
- `registration` itself went into `CrashLoopBackOff` while Redis was down (seat feed gave up).
- Not changed in this branch; options are a Redis check the liveness probe can use, or a larger reconnect budget.

## 3. All services through the public host (laptop → NLB, 30 VUs per endpoint, 3 min, ~515 req/s total)

93,173 requests, 0 failed, all checks passed. The ~260 ms floor is the laptop-to-us-east-1 round trip.

| Endpoint | avg | p95 | p99 | failed |
|---|---|---|---|---|
| web `/` | 259 ms | 275 ms | 323 ms | 0% |
| auth health | 262 ms | 279 ms | 315 ms | 0% |
| event health | 264 ms | 290 ms | 353 ms | 0% |
| registration health | 266 ms | 285 ms | 342 ms | 0% |
| payment health | 263 ms | 279 ms | 306 ms | 0% |
| events list | 265 ms | 278 ms | 435 ms | 0% |
| event detail | 264 ms | 285 ms | 398 ms | 0% |
| availability | 278 ms | 310 ms | 728 ms | 0% |
| my tickets (session) | 274 ms | 307 ms | 556 ms | 0% |
| OG image `/og/site` | 370 ms | 550 ms | 668 ms | 0% |

An earlier run of the same script, taken while `registration`'s Redis client was dead, failed 79% on my tickets (7404 of
9372) and 7.98% overall; it is the same failure as in section 2.

## 4. HPA

`events.js` (GET `/api/events`, ramp to 200 VUs from the laptop): `event` went 2 → 3 → 8 ready within ~3 minutes, p95 287 ms,
0% failed. Scale-down was not captured. Needs `NODE_INSTANCE_TYPE=t3.medium` and two healthy nodes.
