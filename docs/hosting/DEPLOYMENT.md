# Staged deployment, health gates, rollback and the prepared infrastructure (P-HOST-5)

Status: **prepared and proven locally; never applied.** Written 2026-11-05. Nothing in this file has run against AWS (no AWS
credential exists on the development machine). Production `play.roguehalla.com`, `.github/workflows/deploy.yml` and
`deployment/cloudflare/**` are not touched and not referenced by anything here. See [SCALING.md](SCALING.md),
[RUNBOOKS.md](RUNBOOKS.md), [COST.md](COST.md), [OBSERVABILITY.md](OBSERVABILITY.md).

## 1. Facts this depends on (read 2026-11-05)

CFN = `https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/`, API/DG as in [SCALING.md](SCALING.md) section 2.

| Fact | Source | Status |
|---|---|---|
| A change to `GameServerContainerGroupDefinition`, `PerInstanceContainerGroupDefinition`, `GameServerContainerGroupsPerInstance`, `InstanceInboundPermissions`, `InstanceConnectionPortRange` or `LogConfiguration` starts a deployment that **replaces instances**; fleet status `UPDATING` then `ACTIVE`; one active deployment at a time (a second cancels the first) | API UpdateContainerFleet | VERIFIED |
| `DeploymentConfiguration`: `ProtectionStrategy` `WITH_PROTECTION` (delays interrupting protected active sessions until they end) or `IGNORE_PROTECTION`; `MinimumHealthyPercentage` 30 to 75; `ImpairmentStrategy` `ROLLBACK` (across all locations) or `MAINTAIN` (keeps a few impaired containers for debugging) | API DeploymentConfiguration | VERIFIED |
| Deployment statuses `IN_PROGRESS, IMPAIRED, COMPLETE, ROLLBACK_IN_PROGRESS, ROLLBACK_COMPLETE, CANCELLED, PENDING` (the page also prints a misspelt `ROLLBACK_IN_COMPLETE`; `rollout.sh` accepts both); `DescribeFleetDeployment` carries `RollbackGameServerBinaryArn` and per-location status | API FleetDeployment | VERIFIED |
| `UpdateContainerGroupDefinition` creates a new auto-incremented **version**; all versions are kept; a version is `COPYING` (GameLift copies the image into its own store), then `READY`, or `FAILED`; a fleet may reference the name (latest) or an ARN with `:N` | DG containers-howitworks | VERIFIED |
| `InstanceType`, `BillingType`, `FleetRoleArn` cannot change after creation; the AMI cannot be updated; AWS recommends replacing fleets every 30 days | API UpdateContainerFleet / CreateContainerFleet | VERIFIED |
| A deployment timeout for `WITH_PROTECTION`; whether an `IMPAIRED` deployment needs the group's `OnHealthCheck` to fail or a process to exit | not documented | UNVERIFIED |
| Fleet role: trust principal `gamelift.amazonaws.com`, managed policy `GameLiftContainerFleetPolicy`; no confused-deputy condition is documented | DG setting-up-role | VERIFIED (no condition: UNVERIFIED) |
| `AWS::GameLift::ContainerFleet` / `ContainerGroupDefinition` property names (template uses them) | CFN aws-resource-gamelift-containerfleet, -containergroupdefinition | VERIFIED; the resource types are **not available in ca-central-1 per cfn-lint 1.59.0's region data** (finding below) |
| Terraform: the `hashicorp/aws` provider (6.72.0, 2026-11-04) has **no** container fleet or container group definition resource (its gamelift resources: alias, build, fleet, game_server_group, game_session_queue, script); `hashicorp/awscc` 1.109.0 has `awscc_gamelift_container_fleet` and `awscc_gamelift_container_group_definition` (argument names UNVERIFIED, the registry page was unreadable) | provider repositories, 2026-11-05 | VERIFIED (awscc arguments UNVERIFIED) |
| Budget actions can apply an IAM policy/SCP or target EC2/RDS instances; there is no GameLift stop action; Budgets data refreshes up to 3 times a day; alerts are not hard stops | AWS Budgets docs (budgets-controls, budgets-managing-costs) | VERIFIED |

## 2. Infrastructure as code: CloudFormation, and why

`hosting/infra/fleet/`: `fleet.cfn.yaml` (ECR repository, container group definition, container fleet with `FullProtection`, target-tracking
and warm-capacity policies, protected auto-rollback deployment configuration, log group, SNS topic, seven alarms, the fleet role) and
`budget.cfn.yaml` (budget, e-mail notifications, a budget **action** that attaches a deny-create policy to the operator role),
`iam/deployer-policy.json` (prepared operator policy: stack, GameLift, ECR, alarms/logs/SNS limited to the `rougehalla-infra-*`
prefix and the two staging Regions, the fleet role limited to a single managed policy), `validate.sh`.

**Why CloudFormation, not Terraform.** The official `aws` Terraform provider cannot create a container fleet or container group
definition today (table above). CloudFormation can, and the `awscc` provider only wraps the same CloudFormation resources through the
Cloud Control API with unverified argument names. One tool that covers every resource, with `delete-stack` as the primary teardown, is
the smaller risk. The IaC is **prepared only, never applied**.

**Validation, no AWS** (`hosting/infra/fleet/validate.sh`, pinned `python:3.12.8-slim`, `cfn-lint==1.59.0`, `parliament==1.6.4`): both
templates lint clean for their Regions (`fleet.cfn.yaml` for `us-west-2`, `budget.cfn.yaml` for `us-east-1`), including warnings
(`--include-checks W`); the IAM JSON parses and passes parliament at severity LOW. The pinned-image run was done before the last template edit (`MaxInstances` capped at 1, comments); after it the Docker daemon stopped answering, so the final templates were re-linted with the same `cfn-lint==1.59.0` installed in a host virtualenv (Python 3.14): both clean. Lint proves schema validity, **not** that AWS accepts the
values (instance-type availability, vCPU/memory fit, port ranges, the fleet role's log permission): those fail only on a real create.

**Finding: no ContainerFleet resource type in ca-central-1.** cfn-lint 1.59.0 reports `E3006 Resource type 'AWS::GameLift::ContainerFleet'
does not exist in 'ca-central-1'` (same for the group definition). That is cfn-lint's snapshot of CloudFormation's per-Region registry, not a
call to AWS, so it is a strong hint, not proof. Consequence: `ca-central-1` is reached as a **remote location of the us-west-2 fleet**
(`RemoteLocation` parameter; the GameLift location table allows it, [GAMELIFT_VERIFIED.md](GAMELIFT_VERIFIED.md) section 9). A
ca-central-1 *home* fleet would be created with the CLI, with exact `Project=rougehalla-infra` and `Experiment` tags so `teardown.sh` can verify its ownership. Whether the
image reaches a remote location without a second ECR copy is UNVERIFIED.

Other things the template fixes deliberately: `MaxInstances` is capped at **1** per location (the CAD 20 plan is priced on it, [COST.md](COST.md));
`InstanceConnectionPortRange` and `InstanceInboundPermissions` are set by hand for TCP (default is UDP); only that range is opened to
`0.0.0.0/0`; ECR tags are immutable and `EmptyOnDelete` is on; the log group keeps 3 days; every resource carries `Project=rougehalla-infra`,
`Experiment`, `TeardownBy`, `Owner` so teardown and verification can find it.

## 3. Staged rollout

### 3.1 Image tagging with `RH_BUILD`

`RH_BUILD` is a **compile-time** variable (`rh_sim::replay::BUILD_ID`, replays and the `matches.build` column carry it). Today nothing sets it
for the image and the running server does not report it (OBSERVABILITY section 4). Policy:

1. One build per commit: `RH_BUILD=<12-char commit id>`, optionally `-<arch>`. The ECR tag **is** the `RH_BUILD` value (immutable repository, so a tag
   always names the same bytes; `latest` is refused by `rollout.sh`).
2. One image per architecture (`arm64` for Graviton, `amd64` for x86); the fleet's `InstanceType` decides, `ImageArchitecture` is a cross-check tag.
3. Proposed Dockerfile change (not made here: `hosting/Dockerfile` is outside this work package; apply it before the first push):

```diff
 FROM ${RUST_IMAGE} AS rust-build
 WORKDIR /src
 COPY Cargo.toml Cargo.lock ./
 COPY crates crates
+# Build identity (rh_sim::replay::BUILD_ID is read from RH_BUILD at compile time). Required: an empty id would hide the build.
+ARG RH_BUILD
+RUN test -n "${RH_BUILD}"
+ENV RH_BUILD=${RH_BUILD}
 ARG RH_FEATURES=postgres
```

   `docker buildx build --platform linux/arm64 --build-arg RH_BUILD=<id> -f hosting/Dockerfile -t <ecr>/rougehalla-infra/<exp>/rh-match:<id> --push .`
   (a `--push` is a cloud write and needs the owner's approval, [COST.md](COST.md)). The local proof builds two real binaries that differ only
   in `RH_BUILD` (`build.sh`; `strings` finds `fleet-build-A` / `fleet-build-B` in them), which is the same mechanism.

### 3.2 Stages and gates

| Stage | Action | Gate to continue | Rollback trigger |
|---|---|---|---|
| 0 Preflight | image tag exists in ECR; `validate.sh`; current group-definition version recorded (rollback target) | all true | stop, nothing changed |
| 1 New version | `update-container-group-definition` makes version N+1 with the new image | version `READY` (`COPYING` is normal, `FAILED` stops) | `FAILED` or not READY within 10 min: fleet untouched |
| 2 Canary | point the fleet at N+1 with `WITH_PROTECTION`, `MinimumHealthyPercentage 75`, `ImpairmentStrategy ROLLBACK`; GameLift replaces instances while protected sessions finish | first replacement instance's groups healthy (`PercentHealthyServerProcesses` 100, no `ServerProcessAbnormalTerminations`), then one real **canary session** (create session, reserve one player, join, `AcceptPlayerSession`) | deployment `IMPAIRED`/`ROLLBACK_*`, any rollout alarm in ALARM, or the canary session fails |
| 3 Rolling | GameLift continues, never below the minimum healthy percentage; draining groups keep their matches (`OnProcessTerminate` -> drain, section 4 of [SCALING.md](SCALING.md)) | deployment `COMPLETE`, then a 5-minute alarm window with every rollout alarm OK | any alarm in ALARM during the window |
| 4 Done | keep version N as the rollback target for the next release | | |

`hosting/scripts/rollout.sh --region R --experiment E --fleet-id F --image-tag <RH_BUILD> [--dry-run|--yes]` performs 0 to 4 with the gates as code
(exit 0 only for `COMPLETE` and no alarm; any other outcome points the fleet back at the remembered version). It has a `--dry-run` that prints the
calls, refuses without `--yes` and an explicit `AWS_PROFILE`, and refuses any account but the sandbox. It has **not** run against AWS; the
CLI flag spellings other than the `gamelift` command names are from memory (UNVERIFIED), which is why the dry run exists.

### 3.3 Rollback

- **Automatic:** `ImpairmentStrategy: ROLLBACK` returns the fleet to the previous deployment (`RollbackGameServerBinaryArn`) across locations.
- **Manual (an alarm, a bad canary, a bad behaviour GameLift cannot see):** `update-container-fleet --fleet-id F --game-server-container-group-definition-name
  <previous version ARN>` with the same deployment configuration. A rollback is itself a deployment: it replaces instances and, with
  `WITH_PROTECTION`, waits for active sessions. For a bad build **during** an incident, [RUNBOOKS.md](RUNBOOKS.md) section 2 has the order of actions.
- A rollback never deletes the bad version or its image (post-mortem), and the tag stays immutable.
- Rollback does **not** undo gameplay data: results already written by the bad build stay (their `matches.build` says which build wrote them).

### 3.4 What is never done

Production is never touched: every name carries `rougehalla-infra`, the scripts accept only the sandbox account and two staging Regions, the
workflows cannot be triggered automatically. No DNS, no Cloudflare, no `deploy.yml`.

## 4. Workflows

`.github/workflows/hosting-validate.yml` (manual dispatch plus relevant `optimization_port` pushes/PRs, no secrets): runs the template/IAM validation, probe/DNS/scaling/ownership regression checks and the
AWS-script tests (stub `aws`). `.github/workflows/hosting-fleet-deploy.yml` (manual `workflow_dispatch` only): `plan` (change set, nothing
executed) is the default; `deploy` needs the typed confirmation `I-HAVE-OWNER-APPROVAL`, a protected GitHub environment and an OIDC role
**variable** (`AWS_DEPLOY_ROLE_ARN`, not a secret); no secret is stored in any file. Teardown is deliberately not a workflow mode: it runs from the owner's
machine with `teardown.sh --yes` and a named profile. Neither workflow has run. The deployer policy in section 2 is the
permission set that role should have.

## 5. Local proof of replacement and rollback (no AWS), 2026-11-05

Hardware Apple M5 Pro, macOS arm64, **native**, groups are processes (not containers), the real `rh-server` (two builds, release profile), the real
fakesdk `glbridge`, the real `fleet_client`. Commands (from the repository root): `hosting/scripts/fleet-local/build.sh` then
`node hosting/scripts/fleet-local/fleet.mjs deploy|rollback-canary|rollback-mid|lifecycle`. Each exits non-zero on any failed check; raw output:
`target/fleet-local/<scenario>.out`, `run-<scenario>/{events.jsonl,summary.json,gN.log,gN.calls}`.

| Scenario | Command | Checks | Wall | What it showed |
|---|---|---|---|---|
| `deploy` (A to B) | `fleet.mjs deploy` | 17/17 | 122 s | fleet of 2 running matches (8 fighters each) + warm groups on build A; canary B group became ready, served a real session (join, seat, `Accept`) and exited; then each A group was replaced first (a B group ready) and drained, **active ones first**: each of the 2 draining groups answered `409 draining` to a new session and to an admit, refused a new player's Hello (`ServerDraining`), and its match stayed `active` and ran on until its player quit; the 2 idle A groups exited at once; 4 groups replaced, no A group left; a session placed afterwards ran on build B |
| `rollback-canary` | `fleet.mjs rollback-canary` | 10/10 | 120 s | build B is made unhealthy by an arena the server refuses (`--map /nonexistent`): `rh-server` exits non-zero before `ProcessReady`, so the canary group never becomes healthy; rollout stopped in 0.1 s, no old group was touched, the fleet targets A, no B group remains; the 2 matches running on A finished untouched; a session placed after ran on A |
| `rollback-mid` | `fleet.mjs rollback-mid` | 14/14 | 121 s | canary and the first replacement are healthy, one **active** A group was already draining (its match kept running), the second replacement is unhealthy: rollout stopped, the healthy B group removed, fleet back on A, both matches finished, a later session ran on A |
| `lifecycle` | `fleet.mjs lifecycle` | 10/10 | 69 s | scale-out from a queue of 3, scale-in of 2 idle groups while 3 matches ran (none touched), all matches ran to the player's quit ([SCALING.md](SCALING.md) section 6) |

Every scenario ends the same way and the run fails if it does not: the fleet is drained to zero groups; `pgrep -f` for this run's tag finds no `glbridge` or `rh-server`
(0 left in all four runs; also 0 `glbridge-fake|rh-server-` processes machine-wide afterwards); **every** session that started ran until its player quit with `ProcessEnding`
reported, the bridge exiting 0 and no `ended_by_bridge`/`crashed` reason (12 session records, 3 per run, in each `summary.json`; the canary session is separate); every scale-in decision named an idle group.
Peak 8 groups at once in `deploy` (surge: replacements start before the old group drains); RSS peak 14 to 15 MiB per `rh-server`; `droppedSteps` 0; step lateness p99 peak 2.7 to 5.1 ms.

`docker ps`: the local groups are native processes and start no container. The shared Docker daemon did not answer `docker ps` during these runs (it hung for more than 45 s, so the harness
recorded `n/a`), so "no container left" is **vacuous here, not verified**; re-run `docker ps` when the daemon answers. (`hosting/scripts/docker-smoke.sh` is the existing container smoke test; not re-run.)

What the local proof is **not**: it is not GameLift (placement, protection and deployment semantics are re-implemented by `fleet.mjs` from the
documented behaviour, so it proves *our* components behave as the fleet assumes, not that GameLift behaves as documented); instance cold start is
not modelled (a group starts in about 0.2 s); a match ends by the human quitting (the slice has no natural end), so "never interrupted" means *the
fleet never ended it*; no network, TLS or region effects; one machine.


Independent code review fixes and their deployment limits are recorded in
[the fleet README](../../hosting/infra/fleet/README.md#review-fixes-and-remaining-deployment-gates).
Local IAM/schema checks are not AWS authorization proof; deployment remains blocked pending the concrete cost, region,
OIDC trust, bootstrap permissions, and certificate decisions described there.
