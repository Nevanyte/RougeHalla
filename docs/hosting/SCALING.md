# Scaling and active-match protection (P-HOST-4)

Status: **designed, prepared as IaC (never applied), and proven locally with the real binaries; nothing has run on AWS.** Written
2026-11-05. Capacity numbers for the full game are **UNMEASURED** (the slice has no natural match end and the full game is not
built); this document fixes the mechanism, not a production size. Companion documents: [DEPLOYMENT.md](DEPLOYMENT.md) (rollout,
IaC), [OBSERVABILITY.md](OBSERVABILITY.md), [RUNBOOKS.md](RUNBOOKS.md), [COST.md](COST.md),
[GAMELIFT_VERIFIED.md](GAMELIFT_VERIFIED.md) (platform facts, section 3 is the one-process-one-session model).

## 1. The unit of capacity

One **container group** = one `glbridge` + one `rh-server --max-rooms 1 --require-admit` = **one game session** (GameLift: one
server process, one session; `ProcessEnding` ends both). A host (instance) holds N groups (`GameServerContainerGroupsPerInstance`).
The fleet's capacity in sessions is `instances x N`. Everything below speaks in groups/sessions; instances only appear where money
does.

## 2. Facts this design rests on (read 2026-11-05)

DG = `https://docs.aws.amazon.com/gameliftservers/latest/developerguide/`, API = `https://docs.aws.amazon.com/gameliftservers/latest/apireference/`.

| Fact | Source | Status |
|---|---|---|
| Sessions per instance = processes per container x groups per instance; capacity is adjusted per location and a fleet policy scales each location independently on its own metrics | DG containers-scaling, fleets-autoscaling-target | VERIFIED |
| The only target-tracking metric is `PercentAvailableGameSessions` (`PolicyType=TargetBased`, `TargetConfiguration.TargetValue`); one target-based policy plus any number of rule-based ones; the docs call target tracking less efficient with few instances and suggest a rule such as `IdleInstances < 2` for 5 minutes -> +1 | API PutScalingPolicy | VERIFIED |
| Rule-based metrics: `ActivatingGameSessions, ActiveGameSessions, ActiveInstances, AvailableGameSessions, AvailablePlayerSessions, CurrentPlayerSessions, IdleInstances, PercentAvailableGameSessions, PercentIdleInstances, QueueDepth, WaitTime, ConcurrentActivatableGameSessions`; `EvaluationPeriods` is in minutes (min 1) | API PutScalingPolicy | VERIFIED |
| Fleet min/max default to 0 and 1; auto scaling never leaves `[min, max]`, so **max is the cost cap**; `DesiredInstances` set by hand is reset at once when a target-based policy exists | DG fleets-capacity-limits, fleets-updating-capacity | VERIFIED |
| Scale to zero: `MinSize`/`MaxSize`/`DesiredInstances` may be 0; `ManagedCapacityConfiguration{ZeroCapacityStrategy=SCALE_TO_AND_FROM_ZERO, ScaleInAfterInactivityMinutes}` (not combinable with `MinSize`) scales in after N idle minutes and out on the first request, but **that first request does not wait for the instance** (placement may fall to other fleets/locations) | DG fleets_scale-to-from-zero, API UpdateFleetCapacity | VERIFIED |
| A new container fleet starts at 1 desired instance (and 1 per remote location) | DG containers-scaling | VERIFIED |
| `stop-fleet-actions` (`AUTO_SCALING`) suspends all scaling policies | API StopFleetActions | VERIFIED |
| Cooldown after a policy change starts once the last instance finished launching/terminating; its length is not stated | DG fleets-autoscaling-rule | UNVERIFIED (length) |
| `NewGameSessionProtectionPolicy` `FullProtection`: sessions in `ACTIVE` "can't be shut down" by scale-down or unhealthy-instance retirement; it applies only to sessions started after it is set; `UpdateGameSession ProtectionPolicy` is per session and works on container fleets | API CreateContainerFleet, UpdateContainerFleet, UpdateGameSession | VERIFIED |
| Maximum protection duration, behaviour on instance retirement/Spot interruption, and **whether scale-in prefers the emptiest instance** | none found in primary docs | UNVERIFIED (measure in staging) |
| `OnProcessTerminate` fires on scale-down, persistent ill health and Spot interruption (2-minute notice); GameLift then waits about 5 minutes for `ProcessEnding` | DG gamelift-sdk-server-api; Go SDK v5.6.0 source comment | VERIFIED (Spot-for-containers: UNVERIFIED) |
| CloudWatch namespace `AWS/GameLift`, 1-minute resolution; container metrics `ActiveGameServerContainerGroups, IdleGameServerContainerGroups, PendingGameServerContainerGroups, TerminatingGameServerContainerGroups, UnhealthyGameServerContainerGroupsReplaced, ContainerCPUUtilizationPerInstance, ContainerCPUReservation, ContainerMemoryReservation, ContainerMemoryUtilization, ContainerNetworkIn/Out`; dimensions `FleetId, Location, MetricGroups, ContainerGroupType, ...` | DG monitoring-cloudwatch | VERIFIED (exact dimensions per metric: UNVERIFIED) |

Consequence for the design: GameLift's own policies can only look at **GameLift** metrics. The guardrails the ADR asks for (CPU, memory,
tick overrun, join delay) cannot feed a GameLift policy; in the cloud they are CloudWatch **alarms** (notify a human, and are the gate
in [DEPLOYMENT.md](DEPLOYMENT.md)); the **decisions** they would drive (placement avoidance, scale-in veto, extra warm capacity) exist
today only in the local fleet manager (`hosting/scripts/fleet-local/policy.mjs`), where they are tested. Closing that gap in the cloud
needs a small controller (or the bridge publishing custom metrics); that is a proposal, not built (section 7).

## 3. Policy

Inputs: `active` (groups with a running session), `idle` (ready, no session), `starting`, `queued` (session requests waiting).
`t` = target available fraction. The local implementation is `policy.mjs` `decide()`; the cloud equivalent is the fleet's two policies.

1. **Scale from demand and available capacity.** Keep `idle / (idle + active) >= t` (target tracking on `PercentAvailableGameSessions`,
   initial `t` = 25 %). Locally: `idleWanted = max(queued, clamp(ceil(active * t/(1-t)), warmMin, warmMax))`. Queued demand is served even
   beyond the warm bound, never beyond the cap.
2. **Hard cap.** `idleWanted <= maxGroups - active`; in the cloud `MaxSize` per location (template: **1 instance**, the CAD 20 plan prices
   exactly that, [COST.md](COST.md)). Demand above the cap queues or is refused by placement; the `instances-at-cap` alarm says so.
3. **Bounded warm capacity.** At least `warmMin` and at most `warmMax` idle groups are kept ready (cloud: the rule-based
   `IdleInstances < 1 for 5 min -> +1` policy keeps one idle instance; with 4 groups per instance that is 4 idle sessions, so the warm
   pool is coarse by design). Warm capacity is the only intentional spend with no player: it is bounded by `MaxSize` and watched by the
   `idle-instances-billing` alarm (instances up, no active session for 60 min).
4. **Idle cleanup.** (a) An idle group is released only after `idleScaleInMs` idle (local 3 s; cloud: the 5-minute rule evaluation and the
   instance cooldown) and only down to the warm floor. (b) A room nobody joins closes by itself (`UNCLAIMED_TIMEOUT` 30 s; a draining
   room nobody joined closes at once, CONTROL_API 3.7) and the group then exits (one process, one session). (c) Optional
   `SCALE_TO_AND_FROM_ZERO` for an off-hours fleet: not used in staging, because the first request does not wait for the instance.
5. **Guardrails.** Any breach (a) vetoes scale-in, (b) adds one warm group, (c) removes the offending group from placement. Defaults in
   `policy.mjs`: step lateness p99 > 25 ms, any dropped simulation step, join delay p95 > 5 s, memory > 85 % of the stated limit. Cloud:
   alarms `container-cpu-high` (75 %), `container-memory-high` (80 %), `server-process-abnormal-termination`, `unhealthy-server-processes`,
   `low-available-sessions` (< 10 %); tick-deadline misses and join delay are **not** GameLift metrics (section 7).
6. **Active-match protection** (section 4).

Initial cloud values (all **starting guesses, unmeasured**): `GroupsPerInstance` 4, `GroupMemoryMiB` 256, `GroupVcpu` 0.4 (4 x 0.4 = 1.6 of a
`.large`'s 2 vCPU), memory 4 x (256 + 50 log router) = 1,224 MiB of the 3,768 MiB available ([GAMELIFT_VERIFIED.md](GAMELIFT_VERIFIED.md) 3.3).
Do not derive a production fleet from them.

## 4. Active-match protection: layers and exact boundaries

| Layer | What it guarantees | What it does **not** |
|---|---|---|
| Fleet `NewGameSessionProtectionPolicy: FullProtection` (template default) | an `ACTIVE` session is not chosen for scale-down or unhealthy-instance retirement | sessions started *before* the policy was set; any host loss (hardware, Spot, AZ event, an instance replaced after the 30-day AMI rule); max protection duration and scale-in victim choice are UNVERIFIED |
| Deployment `ProtectionStrategy: WITH_PROTECTION` | instances with active sessions wait for them (safe deployment) | no timeout is documented (UNVERIFIED): a never-ending match stalls the deployment, which is the safe failure |
| `OnProcessTerminate` -> bridge -> `POST /control/drain` | the server stops admitting and creating rooms; **a running match is never ended by a drain** (CONTROL_API 3.7); idle groups exit at once | the bridge aborts a room still open at `--drain-deadline` (4 m 30 s) or GameLift's termination time minus a margin, because GameLift ends the process 5 minutes after the callback: a match longer than that **is** cut when GameLift terminates a process despite protection (e.g. unhealthy) |
| Scale-in chooses only idle groups (local manager and the policy function) | proven locally: every scale-in decision named an idle group, matches kept running | this is the *local* manager; in the cloud the choice is GameLift's |
| Result handoff | a result resolved before the cut is on the durable path | a match cut by process death yields no result (C-PERSIST); see [RUNBOOKS.md](RUNBOOKS.md) section 4 for the 5 s stop grace |

State of the evidence: the protection layers are **configured, not exercised**; the local proof exercises the drain and idle-only
scale-in mechanics with real processes. The first cloud step that matters is "scale in with an active session" ([COST.md](COST.md) section 4, step 7).

## 5. Alarms to watch (all created by `hosting/infra/fleet/fleet.cfn.yaml`, all notification-only)

`instances-at-cap`, `low-available-sessions`, `server-process-abnormal-termination`, `unhealthy-server-processes`,
`container-cpu-high`, `container-memory-high`, `idle-instances-billing`. An alarm never changes capacity.

## 6. Local proof (no AWS), 2026-11-05

Real binaries: the fakesdk `glbridge` (plays GameLift for its group) supervising `rh-server --max-rooms 1 --require-admit`, a real
WebSocket client, a fake fleet manager. `hosting/scripts/fleet-local/build.sh` then
`node hosting/scripts/fleet-local/fleet.mjs lifecycle`; policy unit tests: `node --test hosting/scripts/fleet-local/policy.test.mjs`
(9 tests). Hardware Apple M5 Pro, macOS arm64, **native** (no emulation), processes not containers. Scenario `lifecycle`:

| Step | Observed (raw: `target/fleet-local/run-lifecycle/events.jsonl`, `summary.json`) |
|---|---|
| burst of 3 sessions on an empty fleet | 3 groups launched from the queue, each ready in about 0.24 s (process start, not a cold instance), plus warm groups; peak 5 groups (the cap) |
| warm floor raised, then lowered to zero while 3 matches run | the 2 idle groups were terminated (exit 0) about 1.4 s after the floor dropped; the 3 active groups stayed `active` and up |
| matches end by the player quitting (28 s) | all 3 closed, `ProcessEnding`, group exit 0; none aborted or dropped by the fleet |
| end state | 0 groups, `pgrep` finds no `glbridge`/`rh-server` of this run |

Boundaries of this proof, stated so nobody over-reads it: the slice has **no natural end** (no sudden death yet; an idle human among 7
bots did not end a match in more than 3 minutes), so matches end by the one human quitting after a fixed time, and what is proven is that
**the fleet never ends a match**, not that a match completes with a Result (that is covered by `tests/control.rs` and `bridge_e2e.rs`);
startup is a process start, not a GameLift instance cold start (minutes, UNMEASURED); `rssBytes` in `/control/health` is Linux-only, so
the proof reads RSS from `ps` (peak 14.7 MiB per `rh-server` with 8 fighters, slice build, native macOS; the Linux container figure is
not measured); step lateness p99 peaked at 5.1 ms with no dropped step on an otherwise idle 18-core machine, which says nothing about a
loaded 2-vCPU instance.

## 7. Not done / proposals

- **Controller for the guardrails in the cloud.** Either (a) the bridge scrapes `/control/health` every 15 s and prints
  CloudWatch Embedded Metric Format lines to stdout (container fleets capture stdout to CloudWatch Logs; a metric filter or EMF
  extraction turns them into metrics) so the alarms can use `stepLatenessP99Us`, `droppedSteps`, `joinDelayMs`; or (b) a small
  scheduled controller applies `policy.mjs`'s decisions through `UpdateFleetCapacity`. Neither is built; (a) needs no SDK in the bridge.
- **Server-side metrics** needed for (a) are listed in [OBSERVABILITY.md](OBSERVABILITY.md) section 4 (`build`, per-interval step-lateness
  maximum, admit-to-seat delay). `crates/rh-server/src/metrics.rs` is not edited here.
- **Density.** Rooms per instance for the full game, memory per group with a running 8-player match in a Linux container, and the
  `GroupsPerInstance` that fits are pending the load harness (`crates/rh-load`) and the finished game. The 200-match/1,600-player
  scenario is a harness parameter, not a fleet size.
- **Scale-in victim choice** and **protection under real scale-in** are UNVERIFIED until the staged experiment.
