# Eventide deployment and architecture diagrams

- [`../architecture/aws/`](../architecture/aws/README.md) — the AWS infrastructure diagram, **as built** (PNG, SVG and the
  editable draw.io source), next to the target architecture it was measured against. This is the one to use for where
  everything runs: VPC tiers, NAT, endpoints, ALB + WAF, RDS Proxy, ElastiCache, alarms.

These browser-ready diagrams are generated from the repository's Makefile, deployment scripts and
system-design documentation.

- [`learner-lab-deployment-steps.html`](learner-lab-deployment-steps.html) — the start-to-teardown AWS Academy
  session flow. It predates the production layout: `make deploy` now does the whole start (mirror, DNS, certificate,
  platform, application) in one command, and the teardown proof lists NAT gateways, endpoints, ElastiCache, RDS
  proxies, WAF ACLs and alarms.
- [`eventide-system-design.html`](eventide-system-design.html) — the logical service and
  data ownership boundaries.

The operational source of truth remains the scripts and Make targets. In particular, always
finish an AWS session with `make down` and confirm that the teardown verification lists are
empty.
