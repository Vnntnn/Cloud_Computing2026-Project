# Load testing

Week 4 autoscaling demo. See `docs/TODO.md` §5 and `docs/SYSTEM-DESIGN.md` §10.

## Prerequisites

- `brew install k6`
- Cluster up (`make up`) with the app deployed (`make deploy`) and the HPA applied
  (`infra/k8s/event-hpa.yaml` — `make deploy` applies the whole `infra/k8s/` dir).
- `metrics-server` running (installed by Terraform, `20-platform/addons.tf`).
  Verify: `kubectl -n eventide top pods -l app=event` returns numbers, and
  `kubectl -n eventide get hpa event` shows a real `cpu: N%/60%`, not `<unknown>`.

## Run

```sh
# EKS
NLB=$(terraform -chdir=infra/terraform/20-platform output -raw nlb_dns_name)
make load BASE_URL="http://$NLB"

# k3d parity
make load BASE_URL=http://localhost:8080
```

Beside it, in two panes:

```sh
kubectl -n eventide get hpa event -w
kubectl -n eventide get pods -l app=event -w
```

## What to capture for the report

- `kubectl get hpa -w` output showing `REPLICAS` go 2 → 8 and back to 2.
- `kubectl get pods -w` showing pods created then terminated.
- The k6 end-of-run summary (`http_req_failed` near 0, p95 latency).
- If `enable_container_insights = true` applied cleanly: the Container Insights
  CPU/pod-count graphs for the run window. If not, `kubectl top pods` snapshots
  at peak load are the fallback evidence.

## Tuning

`event` returns `[]` and costs almost nothing per request. If replicas don't
move:

- raise the VU `target`s in `k6/events.js`, or
- lower the CPU `request` in `infra/k8s/event.yaml` (same load becomes a higher
  % of a smaller request), or
- run the node group as `t3.medium` (`-var node_instance_type=t3.medium`) only
  if you also need more pod headroom — not required to reach 8.
