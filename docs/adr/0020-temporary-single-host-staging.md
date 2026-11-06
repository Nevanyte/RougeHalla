# ADR0020: temporary single-host first playable in Calgary

**Status:** Accepted for the bounded first-playable scope; deployment validation **NOT RUN** when prepared2026-11-06.
This does not replace the provisional long-term [ADR0004](0004-hosting.md) or close managed placement/scaling gates.

## Context

The owner narrowed the first release to one complete Rust-authoritative match in the Unity browser, one AWS region,
valid TLS and the practice domain, under **CAD20 total**. After signing into a new AWS account, the owner explicitly
selected the **Calgary server (`ca-west-1`)**. The current managed GameLift location list does not include Calgary;
the new Free-plan account also returns `SubscriptionRequiredException` for GameLift reads in Oregon. Neither a plan
upgrade nor a larger hosting experiment follows implicitly from those failures.

The selected local match, browser loop and M5 Pro baseline are already proven. A full managed fleet/placement rollout
would add several service and TLS/key-distribution dependencies to this small first milestone. Native `rh-server`
already supports self-hosting, and the same Rust simulation/input/observation paths can run without a GameLift bridge.

## Decision

Use one disposable **EC2 `t4g.small` in Calgary** for this milestone, running the exact verified Linux arm64 Rust server
and a Caddy HTTPS/static/WSS proxy on the same host. Serve **`https://rougehalla.com`**, the accidentally purchased
practice domain. Production **`roguehalla.com` / `play.roguehalla.com` remain untouched**. No Unity game rules or new
simulation policy are introduced. The copied HTML wrapper defaults its backend to same-origin `/ws`; Wasm/data remain
the measured bytes. Ordinary visits keep the join menu.

The implementation is isolated in [hosting/staging-mvp](../../hosting/staging-mvp/README.md):

- One2vCPU/2GiB host, encrypted8GiB gp3 deleted on termination; standard CPU credits, one public IPv4 and only80/443
  ingress. No SSH, EC2 IAM role, NAT, load balancer, managed database, autoscaling, paid support or permanent keys.
- One private encrypted S3 release object, all public access blocked, scoped one-hour presigned GET and exact SHA256
  check. The instance downloads it before starting the server; no AWS credential is installed there. The capability URL
  is a NoEcho parameter and private local file, but remains available to operators who can read EC2 userdata until expiry.
- An absolute **4.5h** host expiry is fixed at preparation and installed before downloads; a persistent systemd timer
  powers off even after reboot, and EC2 terminates on OS shutdown. The Rust4h+drain bound remains independent. Public
  serving requires an8Mbit/s egress limiter, including after reboot. Cleanup still verifies/deletes the owned stack,
  volume, artifact bucket and marked practice DNS. These bounds reduce cost exposure; they are not an AWS billing stop.
- Use the existing in-memory profile/results mode for this disposable playtest. Durable progression, managed placement,
  large-scale hosting tests, other regions and production rollout remain deferred. Do not describe ephemeral results
  as durable progression or a successful EC2 browser test as managed GameLift proof.

## Consequences and validation

This is enough infrastructure for the owner’s playable cloud-match gate while avoiding an unrequested account-plan
upgrade and leaving the managed-fleet decision open. It has one host’s availability, a deliberately limited staging
download rate and no persistent game progression. The host cannot be kept alive beyond the reviewed run without a new
bounded plan. Before production or long-lived use, revisit hosting, auth/persistence, hard independent cost controls,
placement/scale/deploy protection, certificate lifecycle and all remaining broader backlog requirements.

Read-only Calgary checks on2026-11-06 show `t4g.small` offered/free-tier eligible within a5vCPU standard quota; official
Canonical Ubuntu24.04arm64 AMI is available. The new account reported an active Free plan with USD100 credits; those
credits **do not expand CAD20 authorization**. Cost Explorer is disabled, so posted spend is not certified by this ADR.
Exact release/source hashes, current price arithmetic, public TLS/browser evidence and complete cleanup must be recorded
by the coordinator before marking this staging deployment passed.

Sources: [GameLift locations](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-regions.html),
[AWS Free/Paid plan choices](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html),
[EC2 OS shutdown behavior](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_ChangingInstanceInitiatedShutdownBehavior.html).
