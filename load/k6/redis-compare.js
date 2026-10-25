// Redis on vs off, run from INSIDE the cluster (a WAN round trip would hide a few ms).
// Two independent caches, measured separately with a constant arrival rate so both runs get the same RPS:
//   detail  = anonymous GET /api/events/:slug          -> event cache (apps/event/src/libs/event-cache.ts)
//   session = GET /api/regis/tickets/mine + cookie     -> auth-guard session cache (miss = HTTP to auth + DB)
//   control = GET /api/events (list)                   -> reads Postgres directly, Redis plays no part
// Usage: kubectl run k6 -i --rm --restart=Never --image=grafana/k6 --env=... -- run -e CASE=detail - < redis-compare.js
import http from "k6/http";
import { Counter } from "k6/metrics";

const CASE = __ENV.CASE || "detail";
const RATE = Number(__ENV.RATE || 150);
const SLUG = __ENV.EVENT_SLUG;
const COOKIE = __ENV.COOKIE;
const EVENT = __ENV.EVENT_URL || "http://event";
const REGIS = __ENV.REGIS_URL || "http://registration";

const status = new Counter("status_by_code");

export const options = {
  scenarios: {
    [CASE]: {
      executor: "constant-arrival-rate",
      rate: RATE, timeUnit: "1s", duration: __ENV.DURATION || "90s",
      preAllocatedVUs: 100, maxVUs: 400,
    },
  },
  // empty thresholds only make k6 print the per-code counts (so a 429 from the rate limiter is not mistaken for a cache effect)
  thresholds: Object.fromEntries(
    [200, 401, 404, 429, 500, 502, 503, 504].map((c) => [`status_by_code{code:${c}}`, ["count>=0"]]),
  ),
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

const targets = {
  detail: () => http.get(`${EVENT}/api/events/${SLUG}`, { tags: { case: "detail" } }),
  session: () => http.get(`${REGIS}/api/regis/tickets/mine`, { headers: { cookie: COOKIE }, tags: { case: "session" } }),
  control: () => http.get(`${EVENT}/api/events`, { tags: { case: "control" } }),
};

export default function () {
  const res = targets[CASE]();
  status.add(1, { code: String(res.status) });
}
