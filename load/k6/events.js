// Week 4 autoscaling load test (TODO.md §5, SYSTEM-DESIGN.md §10).
//
// Drives `GET /api/events` on `event` hard enough that its CPU crosses the 60%
// HPA target and replicas climb 2 -> 8, then backs off so scale-down is visible
// too. Run it beside two watch panes:
//
//   kubectl -n eventide get hpa event -w
//   kubectl -n eventide get pods -l app=event -w
//
// Usage:
//   BASE_URL=http://<nlb-dns> k6 run load/k6/events.js
//   BASE_URL=http://localhost:8080 k6 run load/k6/events.js      # k3d parity
//
// `make load BASE_URL=...` wraps this.
//
// Tuning: `event` is a hello-world returning `[]`, so it is cheap per request.
// If replicas don't move, raise the VU targets or drop the event CPU `request`
// in infra/k8s/event.yaml (a smaller request = the same load is a higher %).

import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";

export const options = {
  scenarios: {
    scale_up_then_down: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 50 },   // ramp in
        { duration: "3m", target: 50 },   // hold — replicas should be climbing
        { duration: "1m", target: 120 },  // push to the ceiling
        { duration: "3m", target: 120 },  // hold at max — expect 8 replicas
        { duration: "1m", target: 0 },    // drop — watch scale-down (60s window)
        { duration: "3m", target: 0 },    // idle — replicas settle back to 2
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    // The app should stay healthy the whole time — if it doesn't, the demo
    // story is "it fell over", not "it scaled".
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "max"],
};

export default function () {
  const res = http.get(`${BASE_URL}/api/events`);
  check(res, {
    "status is 200": (r) => r.status === 200,
    "body is a JSON array": (r) => r.body.charAt(0) === "[",
  });
  sleep(0.5);
}
