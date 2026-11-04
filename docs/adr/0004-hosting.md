# ADR 0004: Hosting on AWS (provisional)

**Status:** Provisional: the staging experiment ([../hosting/STAGING_EXPERIMENT.md](../hosting/STAGING_EXPERIMENT.md))
has NOT been run (no valid AWS credentials were available in Stage 1). Evidence and citations:
[../hosting/GAMELIFT_EVALUATION.md](../hosting/GAMELIFT_EVALUATION.md).

**Decision (working default).**
1. Amazon GameLift Servers **managed container fleets** + **game session queues** first. ECS on EC2 is the fallback if the
   experiment fails on TLS/ports, home-Region support, or scale-in protection (we would then build placement, latency
   routing and protection ourselves).
2. The Rust process never links a GameLift SDK. A small **bridge** using the official Go Server SDK runs beside it in the
   container and drives it through the local control API (`--control 127.0.0.1:<port>`: `/control/health`,
   `/control/drain`; session start/admission endpoints are backlog P-HOST-1). The official "game server wrapper" is only a
   day-one spike: it has no player sessions and no certificate API.
3. **TLS/DNS:** container fleets do not issue certificates; plan for our own wildcard certificate (served by the Rust
   process through rustls, `--tls-cert/--tls-key`) and a DNS record per placement, or a TLS proxy layer if that fails.
4. **Packing:** several matches per process (one tokio task per room, `--max-rooms`) and one process per container group;
   the density is decided by measurement (MIGRATION "Benchmarks" gives the slice's tick cost, not the full game's).
5. **Scaling:** target tracking on available session capacity, with CPU, memory, tick-deadline misses and join delay as
   guardrails; full protection of active sessions on scale-in and deployment; idle-session close; warm capacity per
   Region. Spot only after interruption handling is measured.
6. **Regions:** latency-aware queue placement from client-reported pings plus manual override. Browsers cannot send UDP or
   ICMP, so pings are HTTPS round trips to our own per-Region endpoint (`GET /ping` on the game process,
   [../hosting/LATENCY_PROBES.md](../hosting/LATENCY_PROBES.md)). Western Canada: `ca-west-1` is not a GameLift location
   (per the evaluation); candidates are `ca-central-1` (remote location) and `us-west-2`; measure from Calgary/Vancouver.
7. **Sizing scenario:** 200 matches / 1,600 players is an ASSUMPTION for planning, not measured capacity and not a spending
   authorization. Nothing is provisioned in Stage 1.
