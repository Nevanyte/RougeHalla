# Cost, the CAD 20 cap, and the cloud experiment plan (P-OPS-4, P-HOST-5)

**Cloud experiment status: NOT RUN. It needs owner approval and AWS credentials (none on this machine).** Nothing in this
document has spent money, and nothing here authorises spending: the packet's cap is **CAD 20 TOTAL** across both agents (not monthly, not USD),
sandbox account `961470857356` only, and an Administrator role is not spending authority
([P-CLAUDE-INFRA-1 known traps](../backlog/packets/P-CLAUDE-INFRA-1.md)). Written 2026-11-05. Related: [SCALING.md](SCALING.md),
[DEPLOYMENT.md](DEPLOYMENT.md), [RUNBOOKS.md](RUNBOOKS.md) section 7.

## 1. What can and cannot protect the cap

- A **budget alert is not a stop.** AWS Budgets refreshes up to 3 times a day and notifies after the money is spent; its actions can apply an IAM policy/SCP or
  stop EC2/RDS instances, and there is **no GameLift fleet-stop action** (read 2026-11-05, AWS Budgets docs `budgets-controls`, `budgets-managing-costs`). `budget.cfn.yaml`
  therefore adds notifications at 25/50/80 % and a forecast alert, and one action that attaches a deny-create policy to the operator role at 100 % actual: it stops
  *new* spend, not running instances.
- The controls that actually bound spend: (1) `MaxInstances` is **1 per location** and the template refuses a larger value; (2) a **hard time limit** on the experiment
  with the exact teardown and verification commands (section 6); (3) the worst case below is priced with a 24-hour teardown delay and a 7 % currency buffer.
- Remaining allowance: **not known to this work package** (the packet says Codex had created no Stage 2 billable resources at handoff; the owner must confirm current usage
  in Cost Explorer before approving). The plan is only valid if the confirmed remaining allowance is at least the worst-case figure for the stage being approved.

## 2. Prices read on 2026-11-05 (AWS price-list bulk JSON `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<Offer>/current/index.json`; GameLift published 2026-10-13)

GameLift managed fleets are billed at GameLift's **own** per-instance-hour rate (row `ConsumeLinuxGameLiftInstance`, On-Demand), per instance-second with a 1-minute minimum
per instance (GameLift FAQ). Traffic between game servers and players is included at no extra charge on generation 6+ instance types (pricing page; the `c5`/`c5a` rows predate that).
No separate container-fleet fee is listed. Whether a price row means the type is **available for container fleets** in that Region is UNVERIFIED until the first create call.

| Instance (.large) | arch | us-west-2 USD/h | ca-central-1 USD/h |
|---|---|---|---|
| c6g | arm64 | 0.088 | 0.097 |
| c7g | arm64 | 0.094 | 0.102 |
| c8g | arm64 | 0.103 | 0.112 |
| c9g | arm64 | 0.11118 | no price row |
| m6g / m7g | arm64 | 0.099 / 0.105 | 0.110 / 0.117 |
| c5 | x86 | 0.109 | 0.118 |
| c5a | x86 | 0.099 | 0.108 |
| c6i | x86 | 0.109 | 0.119 |
| c7i | x86 | 0.114 | 0.125 |

The template allows only `c6g c7g c5 c5a c6i`; the worst case below uses the dearest of them in each Region (0.109 and 0.119).

| Other item | Price (read 2026-11-05) | Note |
|---|---|---|
| ECR private storage | $0.10 per GB-month (both Regions) | same-Region pulls by EC2/Lambda/Fargate are free; GameLift-fleet pulls are not named (UNVERIFIED), the plan carries a $1 allowance. Cross-Region $0.09/GB |
| CloudWatch standard alarm | $0.10 per alarm metric-month (10 free) | the metric-math alarm has 2 metrics; 9 alarm metrics in total |
| CloudWatch Logs | ingestion $0.50/GB us-west-2, $0.55/GB ca-central-1; storage $0.03 / $0.033 per GB-month (5 GB ingestion free) | the log group keeps 3 days; whether fleet logs bill as "vended" or custom is UNVERIFIED |
| CloudWatch custom metric / dashboard | $0.30 per metric-month / $3.00 per dashboard-month | none created |
| AWS Budgets | $0; action-enabled budgets free for the first 62 budget-days then $0.10 per day | one budget with one action |
| SNS e-mail, CloudFormation (AWS::* types) | free at this volume | |
| Public IPv4 | $0.005 per address-hour on EC2; whether GameLift fleet instances are billed it separately: UNVERIFIED | carried as an allowance |
| FX | USD to CAD **1.3961** (Bank of Canada Valet `FXUSDCAD`, 2026-11-04); a card can add about 2.5 % (1.4310); the cap uses **1.50** | |

## 3. Worst case (arithmetic: `node hosting/scripts/worst-case-cost.mjs`)

Assumptions, all of them chosen to over-state: every instance runs at the dearest allowed type for the **4 h hard limit plus a 24 h teardown delay** (28 h); 1 instance per
location; a full month of 1 GB of ECR, of all 9 alarm metrics and 0.5 GB of logs; a $1 transfer allowance; an IPv4 charge per instance-hour; and a 25 % buffer for items nobody listed.

| Scenario | Instances | ECR | CloudWatch | Transfer | IPv4 | +25 % | Total USD | **Total CAD at 1.50** | Margin to CAD 20 |
|---|---|---|---|---|---|---|---|---|---|
| Stage 1: us-west-2 only | 3.05 | 0.10 | 1.19 | 1.00 | 0.14 | 1.37 | 6.85 | **10.28** | 9.72 |
| Stages 1+2: us-west-2 + ca-central-1 remote location | 6.38 | 0.10 | 1.19 | 1.00 | 0.28 | 2.24 | 11.19 | **16.79** | 3.21 |

Expected if everything goes to plan (3 h of `c6g.large` in us-west-2): about **USD 0.68, CAD 1.03** at the buffer rate.

Reading it: **Stage 1 fits with a CAD 9.72 margin (49 %).** Stages 1+2 fit with a CAD 3.21 margin (16 %), which is thin once any other spend (Codex's, or Cost Explorer lag) is
counted: stage 2 therefore needs its own explicit approval and a confirmed remaining allowance of at least CAD 17. The worst case does **not** cover: someone raising `MaxInstances` outside the template
(it refuses), a GameLift price change, an unlisted service, or a teardown that fails silently for longer than 24 h (the 25 % buffer is not a day of two more instances).

## 4. The cloud experiment (NOT RUN: needs owner approval and AWS credentials, none on this machine)

Hard limits: **wall-clock 4 h from the first `create-stack` to `verify-no-billable.sh` passing**; abort and tear down at 3 h whatever has not finished. Region us-west-2, one `c6g.large` (arm64, matches the
`linux/arm64` image). Experiment id `stg1`, teardown date written into every tag.

Pass/fail table (all **NOT RUN**), each step with its evidence and its stop condition:

| # | Step | Evidence | Stop if |
|---|---|---|---|
| 0 | Owner approves stage 1 in writing, confirms remaining allowance >= CAD 10.28, supplies a named sandbox profile | Cost Explorer screenshot/number | not confirmed |
| 1 | `hosting/infra/fleet/validate.sh`, `hosting/scripts/test-aws-scripts.sh`, `teardown.sh --dry-run`, `verify-no-billable.sh --dry-run` (no AWS) | exit 0, call lists read | any fails |
| 2 | Apply the Dockerfile `RH_BUILD` change ([DEPLOYMENT.md](DEPLOYMENT.md) 3.1); build `linux/arm64` image locally with `--build-arg RH_BUILD=<id>` | image id, `docker run` smoke | fails |
| 3 | Create `budget.cfn.yaml` (us-east-1), then `fleet.cfn.yaml` repository only (`DesiredInstances=0` first), `docker push` the tag | stack events, `ecr describe-images` | any create fails |
| 4 | Set `DesiredInstances=1`; record time to `ACTIVE` and to `ProcessReady` of the first group (**cold start**) | CloudFormation events, `describe-fleet-events` | fleet not ACTIVE in 30 min |
| 5 | One game session: `create-game-session`, `create-player-session --player-id <callsign>`, join with `fleet_client` from this Mac over plain WS to the instance IP:port; check `AcceptPlayerSession`, `/control/rooms` via logs | client `welcome`, bridge log lines | refused: stop and read logs |
| 6 | Fill all `GroupsPerInstance` sessions; observe `PercentAvailableGameSessions` fall and the scale-out refused by `MaxSize 1` (the cap works); the `instances-at-cap` alarm fires | CloudWatch graph/alarm state | scale-out beyond 1 instance (then tear down at once) |
| 7 | Protection: with an active session, `update-fleet-capacity --desired-instances 0`; the session must survive until it ends (the key UNVERIFIED claim) | session still `ACTIVE`, instance count | the session is killed: record and tear down |
| 8 | Rollout: `rollout.sh` to build B with an active session; deployment must wait for it (`WITH_PROTECTION`), then `COMPLETE` | `describe-fleet-deployment` statuses | impaired: let `ROLLBACK` run, record |
| 9 | Rollback: `rollout.sh` to a tag whose container exits at start; expect `IMPAIRED` then `ROLLBACK_COMPLETE` | statuses, alarm | no rollback in 20 min: manual rollback, record |
| 10 | Teardown: `teardown.sh --experiment stg1 --yes`, then `verify-no-billable.sh --experiment stg1 --yes` | exit 0 and the transcript | not clean in 30 min: repeat, then owner |

Not covered by this plan and so still pending after it: browser TLS (wildcard certificate, DNS, practice domain), regional placement and latency across ca-central-1, managed database failover,
full-game density, and the 200-match scenario. Stage 2 (adds `RemoteLocation=ca-central-1`, one more instance) only after stage 1 passed, a fresh approval and the margin check in section 3.

## 5. Actual cost record (to be filled by whoever runs it)

| Item | Expected | Actual | Source |
|---|---|---|---|
| GameLift instance-hours | | | Cost Explorer, service GameLift |
| ECR, CloudWatch, other | | | |
| Teardown verified | | | `verify-no-billable.sh` transcript path |

## 6. Commands, exactly

```bash
export AWS_PROFILE=<sandbox profile>      # named profile only; static keys are refused; the account must be 961470857356
hosting/infra/fleet/validate.sh && hosting/scripts/test-aws-scripts.sh && node hosting/scripts/worst-case-cost.mjs
hosting/scripts/teardown.sh --experiment stg1 --dry-run
hosting/scripts/verify-no-billable.sh --experiment stg1 --dry-run
# ... the experiment (section 4) ...
hosting/scripts/teardown.sh --experiment stg1 --yes
hosting/scripts/verify-no-billable.sh --experiment stg1 --yes             # must exit 0
```

## 7. What the owner should decide before this runs

Whether the remaining allowance covers CAD 10.28 (stage 1) or CAD 16.79 (stages 1+2) *on top of what is already spent*; which profile to use; whether the `RH_BUILD` Dockerfile change is accepted;
and whether to accept the unverified assumptions (instance type availability for container fleets, protection under scale-in, image reaching a remote location).

## 8. After teardown

`verify-no-billable.sh` proves resources are gone; billing lags by hours. Open Cost Explorer filtered to GameLift, ECR, CloudWatch for the experiment day **the next day** and record the figure in section 5.
