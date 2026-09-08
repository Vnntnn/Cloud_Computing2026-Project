# Eventide deployment and architecture diagrams

These browser-ready diagrams are generated from the repository's current Makefile,
Terraform, Helm, deployment scripts, and system-design documentation.

- [`learner-lab-deployment-steps.html`](learner-lab-deployment-steps.html) — the safe
  start-to-teardown AWS Academy session flow.
- [`aws-infrastructure-deployment.html`](aws-infrastructure-deployment.html) — where the
  platform and application artifacts run.
- [`eventide-system-design.html`](eventide-system-design.html) — the logical service and
  data ownership boundaries.

The operational source of truth remains the scripts and Make targets. In particular, always
finish an AWS session with `make down` and confirm that the teardown verification lists are
empty.
