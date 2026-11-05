# Observability for the hosted fleet (P-OPS-1, P-OPS-4)

Written 2026-11-05 from the code at `ae169ff2` (code wins over this file). It separates what the running processes **already expose**
from what is **proposed**. Nothing here ran on AWS. Related: [SCALING.md](SCALING.md), [RUNBOOKS.md](RUNBOOKS.md), [CONTROL_API.md](CONTROL_API.md).

In hosted mode a process serves exactly one room (`--max-rooms 1`), so every process-wide number below is also that room's number: a
separate per-room breakdown is not needed until a self-hosted multi-room process is run.

## 1. What exists today

| Surface | Where | Content | Audience |
|---|---|---|---|
| `GET /control/health` (loopback control listener; 200 only while `ready`, else 503) | `control.rs` `health`, `metrics.rs` | `v`, `state` (`starting`/`ready`/`draining`/`terminated`), `rooms`; `metrics`: `wakes`, `steps`, `droppedSteps`, `bytesOut`, `outboxPushes`, `stepUs{count,p50,p99,max}` (one simulation step), `publishUs{...}` (observe+encode+push for all humans), `latenessUs{...}` (microseconds between a step's grid slot and the wake that ran it), `rssBytes` (**Linux only**, `null` on macOS); `results`: `spooled`, `committed`, `recovered`, `refused`, `failed`, `deadLettered`, `spoolFull`, `spoolErrors`, `spoolPending`, `spoolDead`; `control`: `v`, `requireAdmit`, `maxRooms`, `admitTtlMs`. Histogram quantiles are bucket upper bounds (at most 25 % above the true value, never below); `max` is exact | the bridge (health callback), operators on the host, the local fleet manager |
| `GET /control/rooms` | `control.rs` | `state`, `draining`, `maxRooms`, per room `gameSessionId`, `roomId`, `phase` (`lobby`/`active`/`ended`/`closed`), `rev`, `endReason`, per player `status` (`admitted`/`seated`/`away`/`left`/`expired`), `reason`, `expiresInMs`, `graceRemainingMs`; closed rooms stay as tombstones | the bridge (events), RUNBOOKS stuck-session diagnosis |
| `GET /info` (public listener, `no-store`) | `director.rs` `info` | `protocol`, `contentHash`, `rooms`, `lobbies`, `maxRooms`, `players`, `state`, `resultsOk`, `resultsFailed`, `resultsRefused`, `closedRooms` (last 8). Pinned key set: do not add keys without the test that pins it | anyone; contains no secret |
| `GET /healthz`, `/readyz`, `/api/health`, `/ping` | `lib.rs`, `api.rs` | liveness (200 while ready or draining), readiness, account-API health, the latency probe | load balancer / browser probe |
| `rh-server` stderr | `eprintln!` | text lines `[server]`, `[director]`, `[room]`, `[results]` (`spooled match=...`, `committed match=...`, `DEAD-LETTERED match=...: reason`; match id and profile id only, never tokens or tickets) | container log (GameLift captures stdout/stderr) |
| `glbridge` stdout | `slog` JSON | one JSON object per event: `process ready`, `game session active`, `admit sent`, `terminate requested`, `drain deadline reached`, `rh-server exited while draining`, `exit` with `code` | container log |
| GameLift CloudWatch metrics | `AWS/GameLift`, 1 min | fleet, server-process, game-session, player-session and container metrics ([SCALING.md](SCALING.md) section 2) | alarms in `hosting/infra/fleet/fleet.cfn.yaml` |

### Tick deadline misses, precisely

There is no counter literally named "deadline misses". The two existing signals: `droppedSteps` (the pacer discarded steps beyond its catch-up
bound: the simulation fell behind for real, a **hard miss**) and the `latenessUs` histogram (how late each step started; a step later than one tick
period (50 ms at 20 Hz) is a **soft miss**, but the process only reports quantiles, not the count above a threshold). The fleet manager
uses `droppedSteps` delta > 0 and `latenessUs.p99` > 25 ms as the guardrail ([SCALING.md](SCALING.md) section 3).

## 2. Measured locally (2026-11-05, native macOS arm64, slice build, `target/fleet-local/run-*/events.jsonl`)

Over 5 concurrent `rh-server` processes with 3 running 8-fighter matches: `droppedSteps` 0, `latenessUs.p99` peak 5.1 ms, `steps` about 20 per second per room,
RSS 14.7 MiB peak per `rh-server` (`ps`, because `rssBytes` is Linux-only). Idle machine, not a loaded 2-vCPU instance: it demonstrates the signals work, not a capacity.

## 3. Alarms and what each one reads

`hosting/infra/fleet/fleet.cfn.yaml` creates seven CloudWatch alarms (notification-only): `instances-at-cap` (`ActiveInstances`), `low-available-sessions`
(`PercentAvailableGameSessions` < 10), `server-process-abnormal-termination`, `unhealthy-server-processes` (`PercentHealthyServerProcesses`), `container-cpu-high`,
`container-memory-high`, `idle-instances-billing` (metric math over `ActiveInstances` and `ActiveGameSessions`). All use GameLift's own metrics. Nothing in the
server's own histograms reaches CloudWatch yet (section 4).

## 4. Proposed (not built; the three server files are outside this work package)

1. **Expose the build.** Add `"build": rh_sim::replay::BUILD_ID` to `/control/health` (and, with its pinned-key test updated, to `/info`). Today nothing running reports which
   `RH_BUILD` it is, so a rollout cannot verify from the outside that the new build is the one serving. Needed by the canary gate in [DEPLOYMENT.md](DEPLOYMENT.md).
2. **Late-step counter.** In `metrics.rs`: `late_steps` (a `Counter`), incremented where `lateness_us` is recorded when the lateness exceeds one tick period, and
   `"lateSteps"` in `Metrics::json()`. Gives an exact "tick deadline miss" rate for an alarm (`delta(lateSteps)/delta(steps)`).
3. **Admit-to-seat delay.** A histogram `admitToSeatMs` in `/control/health` (`control.rs`/`director.rs`: the time from the admit being posted to the seat being taken).
   This is the server half of "join delay"; the placement-to-admit half is the bridge's polling cadence (up to 1 s, CONTROL_API section 4). The local fleet manager measures
   reserve-to-welcome from outside today.
4. **A metrics path to CloudWatch without an SDK in the game.** The bridge (Go, already the only cloud-facing code) reads `/control/health` every 15 s and prints
   [CloudWatch Embedded Metric Format](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html) JSON lines to stdout;
   container fleets already capture stdout. Dimension `FleetId` is not known inside the container (UNVERIFIED how to read it from the discovery endpoint), so a single
   `Experiment`-level dimension is the safe start. Cost: custom metrics $0.30 per metric-month after the free 10 ([COST.md](COST.md)).
5. **Structured server logs.** `eprintln!` text lines become JSON lines (`level`, `msg`, `match`, `room`) so the same log router can filter on them. Low value until a log consumer exists.
6. **Linux-only `rssBytes`:** fine in a Linux container; the macOS `null` is why the local proof reads RSS from `ps`.

## 5. Not covered

Distributed tracing, per-profile or per-match business metrics (results are in PostgreSQL, `matches.build` ties a result to a build), dashboards (a CloudWatch dashboard
is $3 per month and is not created), and any metric about the browser client.
