// Whole-system load test through the public host: every service, one tagged scenario per endpoint.
// Unlike events.js (HPA demo on one endpoint) this shows which service degrades first.
//   BASE_URL=https://host EVENT_SLUG=<slug> EVENT_ID=<uuid> COOKIE='name=value' k6 run load/k6/all.js
// Reads only: nothing here enrolls, pays or resets (those send real mail / touch Stripe).
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:8080";
const SLUG = __ENV.EVENT_SLUG;
const ID = __ENV.EVENT_ID;
const COOKIE = __ENV.COOKIE;
const VUS = Number(__ENV.VUS || 30); // per endpoint
const DURATION = __ENV.DURATION || "3m";

const codes = new Counter("status_by_code");

const endpoints = {
  web: { path: "/" },
  auth_health: { path: "/api/auth/health" },
  event_health: { path: "/api/events/health" },
  regis_health: { path: "/api/regis/health" },
  payment_health: { path: "/api/payment/health" },
  events_list: { path: "/api/events", json: "items" },
  event_detail: { path: `/api/events/${SLUG}`, json: "id" },
  availability: { path: `/api/regis/events/${ID}/availability`, array: true },
  my_tickets: { path: "/api/regis/tickets/mine", cookie: true },
  og_site: { path: "/api/events/og/site" },
};

export const options = {
  scenarios: Object.fromEntries(
    Object.keys(endpoints).map((name) => [
      name,
      { executor: "constant-vus", vus: VUS, duration: DURATION, exec: "hit", env: { ENDPOINT: name }, tags: { endpoint: name } },
    ]),
  ),
  thresholds: Object.fromEntries(
    Object.keys(endpoints).flatMap((name) => [
      [`http_req_failed{endpoint:${name}}`, ["rate<0.02"]],
      [`http_req_duration{endpoint:${name}}`, ["p(95)<1500"]],
    ]),
  ),
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "max"],
};

export function hit() {
  const e = endpoints[__ENV.ENDPOINT];
  const res = http.get(`${BASE}${e.path}`, { headers: e.cookie ? { cookie: COOKIE } : {} });
  codes.add(1, { endpoint: __ENV.ENDPOINT, code: String(res.status) });
  check(res, {
    "status 200": (r) => r.status === 200,
    ...(e.json ? { [`body has ${e.json}`]: (r) => r.status !== 200 || e.json in r.json() } : {}),
    ...(e.array ? { "body is an array": (r) => r.status !== 200 || Array.isArray(r.json()) } : {}),
  });
  sleep(0.3);
}
