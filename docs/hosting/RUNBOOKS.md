# Runbooks for the hosted staging fleet (P-OPS-5)

Written 2026-11-05. **Staging only**, sandbox account `961470857356`; production `play.roguehalla.com` is not covered and must not be touched with these
commands. No procedure here has been run against AWS; commands marked UNVERIFIED come from memory of the CLI reference and must be read with `--dry-run` /
`aws <service> <command> help` first. Every script named here refuses to run without `--yes` and an explicit `AWS_PROFILE` and has a `--dry-run`.
Context: [SCALING.md](SCALING.md), [DEPLOYMENT.md](DEPLOYMENT.md), [OBSERVABILITY.md](OBSERVABILITY.md), [CONTROL_API.md](CONTROL_API.md), [COST.md](COST.md).

Where a command talks to `127.0.0.1:<control>` it is the **loopback control listener of one container group**; managed container fleets give no shell on the
instance (UNVERIFIED how to reach one), so these calls are for the local fleet and for self-hosted runs. On GameLift the same effect comes from the bridge, which
turns `OnProcessTerminate` into `POST /control/drain`.

## 1. Drain a host (or one group)

When: a deployment, a scale-in, a suspected bad instance, a build you want out.

- **One group, local/self-hosted:** `curl -s -X POST 127.0.0.1:$CONTROL/control/drain -H 'content-type: application/json' -d '{"v":1}'`. State goes `draining`, new `session`/`admit`
  calls answer `409 draining`, a new Hello is refused `ServerDraining`, **the running match continues**, the group exits when its room closes (an unclaimed room closes at
  once). Check: `curl -s 127.0.0.1:$CONTROL/control/rooms` shows `"draining":true`; `/control/health` is 503 `draining`. (Proven locally: [DEPLOYMENT.md](DEPLOYMENT.md) section 5.)
- **On GameLift:** there is no documented per-instance drain call for managed container fleets (UNVERIFIED). The two supported levers are lowering capacity
  (`aws gamelift update-fleet-capacity --fleet-id F --location L --desired-instances N --min-size 0 --max-size M`; with `FullProtection` GameLift will not pick an `ACTIVE`
  session's instance, but whether it prefers the emptiest instance is UNVERIFIED) and a deployment (`rollout.sh`). Both end in `OnProcessTerminate`, which drains.
- A match that outlives the bridge's `--drain-deadline` (4 m 30 s) or GameLift's 5-minute window is **aborted without a Result** (CONTROL_API 6.5). If you need a long match
  to finish, do not force the issue: wait.
- Never `kill -9` a group with a running match: that is the one path that loses the match and any result not yet durable ([SCALING.md](SCALING.md) section 4).

## 2. Roll back a bad build

Triggers: `ServerProcessAbnormalTerminations` or `unhealthy-server-processes` alarm after a deployment, a failing canary session, GameLift deployment `IMPAIRED`.

1. **Stop the spread.** `aws gamelift describe-fleet-deployment --fleet-id F` (status). If `ROLLBACK_IN_PROGRESS`/`ROLLBACK_COMPLETE` GameLift is already doing it (`ImpairmentStrategy: ROLLBACK`).
   If it is `COMPLETE` or you must override: continue at 2.
2. **Point the fleet back:** `hosting/scripts/rollout.sh --region R --experiment E --fleet-id F --image-tag <previous RH_BUILD> --yes` (creates a new version from the previous image; the previous
   *version ARN* is also printed by every rollout as `rollback target`, and `aws gamelift update-container-fleet --fleet-id F --game-server-container-group-definition-name <ARN>` with the same
   deployment configuration does it by hand).
3. A rollback is a deployment: instances are replaced and, with `WITH_PROTECTION`, groups with active matches finish first. New placements go to the fleet as it is; if the bad build must take
   **no** new sessions immediately, set the queue destination away from the fleet (placement work package; not in this document) or `update-fleet-capacity --desired-instances 0` only if nobody is playing.
4. Keep the bad image and version (post-mortem). Results the bad build wrote stay valid for the ledger; `matches.build` says which build wrote each.
5. Local rehearsal: `node hosting/scripts/fleet-local/fleet.mjs rollback-canary` and `rollback-mid` (build B unhealthy at the canary, or at the second replacement).

## 3. A stuck session

Symptoms: a game session `ACTIVE` for far longer than a match, `idle-instances-billing` quiet because a session is "active", `ActivatingGameSessions` stuck, a room `lobby` or `active` with every player `left`/`away`.

1. Look at what the room thinks: control API `GET /control/rooms` (phase, `rev`, each player's `status`/`reason`) and the container log (`glbridge` JSON events, `rh-server` `[room]` lines).
   Which state is it in?
   - `lobby` with `admitted` players who never joined: nothing to do, admits expire after `admitTtlMs` (60 s) and an unclaimed room closes at 30 s.
   - `active`, humans `seated`: it is a running match; a match has no time limit in the slice (no sudden death yet), so "long" is not "stuck". Ask the players.
   - `active` with every human `left`: the room closes at its next wake (`abandoned`); if it does not, the room task is wedged: go to step 2.
   - `ending`/Activating never completes: the bridge failed `ActivateGameSession`: it aborts, calls `ProcessEnding` and exits non-zero (CONTROL_API 6.2); GameLift replaces the group.
2. Ask the room to end gracefully, then by force: `POST /control/end {"v":1,"gameSessionId":"...","mode":"graceful"}` then `"mode":"abort"` (abort closes now, seats and leases are freed,
   **no Result is invented**, `endReason: ended_by_bridge`). On GameLift the operator-side equivalent is `aws gamelift terminate-game-session --game-session-id ID --termination-mode TRIGGER_ON_PROCESS_TERMINATE`
   (UNVERIFIED: the command and mode names were not read today) which fires `OnProcessTerminate` and so the drain path in section 1.
3. If the process does not exit within the deadline, GameLift ends it; `ServerProcessAbnormalTerminations` will count it. Record the game session id and the log lines.
4. Never edit the database to close a match. A match with no Result simply has none.

## 4. Database outage, and what the result spool does and does not save

What exists: `rh-server --result-spool <dir> --database-url ...` writes each resolved result to an fsynced local record **before** the first database attempt, retries until committed,
refused, or the per-result deadline (`--result-retry-secs`, default 900 s), and on start replays leftover records through the same fenced path ([ADR 0006 addendum](../adr/0006-persistence.md),
`crates/rh-server/src/spool.rs`). Boundary: the spool survives a **process** restart on the **same host and volume**; it does **not** survive host loss; a result lost between emission and the first
fsync (milliseconds) is not recovered; a match cut by process death has no result and none is invented. The simulation never waits for the database.

**What that means on a container fleet today (read this before relying on it):**

- One game session per process means the container group ends with the match. Unless `--result-spool` points at storage that **outlives the container** (a host-mounted volume or off-host store:
  whether GameLift container fleets can mount one is UNVERIFIED), the spool dies with the container: the effective guarantee is the **in-process retry only**.
- **Defect for a reviewer to look at first:** after a room closes, `glbridge` calls `ProcessEnding` and exits, and its deferred `proc.stop(5 * time.Second)` sends `rh-server` SIGTERM and then SIGKILL after 5 s
  (`hosting/glbridge/main.go`, `supervisor.go`). `rh-server` itself waits up to `--drain-write-wait-secs` (default 20 s; it was a fixed 150 s before the drain budget was bounded, `main.rs`) for result writes before exiting. So a database outage at match end loses the retry window at 5 s after the
  room closes, not 20 s, and with an ephemeral spool the record goes with the container. Proposed fix (not made here, `glbridge` is outside this work package): after `finish`, before `ProcessEnding`,
  poll `/control/health` until `results.spoolPending == 0` and in-flight writes are done (a pending-writes figure is needed in the metrics, [OBSERVABILITY.md](OBSERVABILITY.md) section 4), bounded by
  the result retry deadline and GameLift's termination time.
- No managed-database failover has been exercised, and a local PostgreSQL restart is not evidence about Aurora.

Procedure:
1. Detect: `results.failed`, `results.spoolPending` or `results.deadLettered` rising in `/control/health`; `[results]` log lines; the account API answering 5xx.
2. Stop making it worse: keep matches running (never abort to "protect" results); stop **new** placements if the outage will outlast the matches in flight (placement runbook / queue destination).
3. Restore the database; the in-process retries commit what they can, within the deadline. A record the deadline expired for is dead-lettered (section 5), not retried.
4. After recovery verify with the reconciliation query from ADR 0006 (matches versus results versus currency) before declaring the incident closed.

## 5. Dead-letter replay

`<spool dir>/dead/<match>-<profile>.rec` plus `.reason` are records that were permanently refused (a newer lease owner exists, no lease), unreadable, or out of time. They are operator-owned and
**never retried by the server**. `results.deadLettered` / `spoolDead` count them.

1. Read the `.reason`. `refused: newer owner` / `NoLease` means a fenced newer owner exists: replay will be refused again and **must not be forced** (no blind reacquire of ownership).
2. If the cause was transient (`out of time` during an outage, a corrupt-then-repaired file is not replayable) and the lease situation allows it: **stop** the server, move the `.rec` back into `<spool dir>` (not `dead/`),
   start the server; it replays through the same fenced path with the original owner/build/content hash. It is refused again if a newer owner exists.
3. Check `results.recovered` and `spoolDead`. Keep the `.reason` of anything that stays dead for the ledger review. On a container fleet the spool is usually gone with the container (section 4), so a
   replay is only possible for a self-hosted process or a persistent volume.

## 6. Scaling emergency

- **Runaway cost or capacity:** `aws gamelift stop-fleet-actions --fleet-id F --actions AUTO_SCALING` (suspends every policy; capacity stays as is), then `update-fleet-capacity --desired-instances 0 --min-size 0 --max-size 0`
  only when nobody is playing, or run section 7. `MaxInstances` is 1 per location in the staging template, so a runaway needs a human to have raised it.
- **At cap, players refused:** the `instances-at-cap` alarm. Raising the cap changes the cost plan ([COST.md](COST.md)); it is an owner decision, not an on-call one.
- **Guardrail breach (CPU, memory, tick lateness, join delay):** the alarms notify; the veto/avoid logic exists only in the local fleet manager ([SCALING.md](SCALING.md) section 2). In the cloud the response is manual: more
  warm capacity (if under the cap) or fewer groups per instance (`GroupsPerInstance` is a deployment: instances are replaced).

## 7. Teardown (the only thing that stops the billing)

A budget alert is **not** a stop: it lags by hours and only notifies (the budget *action* in `budget.cfn.yaml` merely denies creating more). Run these from the owner's machine; each needs `--yes`, a named `AWS_PROFILE`
(static keys are refused) and verifies the account is `961470857356` before any change:

```bash
export AWS_PROFILE=<sandbox profile>
hosting/scripts/teardown.sh --experiment stg1 --dry-run                 # read the calls first
hosting/scripts/teardown.sh --experiment stg1 --yes                     # stacks first, then a sweep by name prefix/description
hosting/scripts/verify-no-billable.sh --experiment stg1 --yes           # exit 0 = nothing billable remains in us-west-2, ca-central-1, us-east-1 and IAM
```

Order inside `teardown.sh`: delete the CloudFormation stacks (fleet stack in each Region, budget stack in us-east-1); then per Region and by name prefix/description: stop auto scaling, set capacity to 0 (per location),
delete the container fleet and wait until it is gone, delete container group definitions, ECR repositories (`--force`), alarms, log groups, SNS topics; then the budget, the fleet and budget-action roles and the
deny policy. `verify-no-billable.sh` lists, by tag and by type, every kind of resource the IaC and rollout can create (tagged resources, stacks, **any** container fleet, group definitions, ECR repositories, alarms, dashboards, log groups,
SNS topics, tagged EC2 instances, the budget, `rougehalla-infra-*` roles and policies) and fails if anything remains. Then look at Cost Explorer a day later: billing lags, the check does not replace it.
Both scripts are tested against a stub `aws` (`hosting/scripts/test-aws-scripts.sh`); neither has touched a real account.
