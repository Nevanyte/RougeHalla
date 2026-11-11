# hosting: local rules

AWS staging recipes and edge tooling. Overview: [README.md](README.md). Decisions: ADR 0004 (GameLift, provisional),
ADR 0020 (temporary single-host staging), ORDER_OF_OPERATIONS D3/D4.

- `technical-demo/`: one CloudFormation stack in `ca-west-1`, a single EC2 host with Postgres 16 and Caddy set up by
  `bootstrap.py`, a deterministic `bundle.py`, 12-hour absolute expiry, an 8 Mbit/s egress cap and one room.
- `staging-mvp/`, `placement/`, `infra/{edge,fleet}`, `glbridge/` (Go GameLift bridge, never run against managed GameLift).

## Invariants

- Every change here needs the owner's approval; agents edit and validate locally (template validation, lint, offline
  tests in `tools/staging-full-runtime`). Deploys, and `aws` commands that create, change or delete resources, are the
  owner's.
- The budget is CAD 20 in total for test hosting; the limits above are deliberate and change only with a packet that says so.
- Domains: the Rust stack uses the practice domain **`play.rougehalla.com`**. **`play.roguehalla.com`** is the live legacy
  game on Cloudflare; the tooling refuses production writes, and nothing here touches it.
- `rh-server` listens on the host; Caddy terminates TLS and proxies WSS. The control API stays on loopback.
- No secrets in templates, scripts or bundles. GitHub OIDC is used only by `hosting-fleet-deploy.yml` (manual, never run).

## Routing

All work here: `implementer-sonnet`. A hosting decision (e.g. D3's always-on host) is an ADR first, written with the owner.
