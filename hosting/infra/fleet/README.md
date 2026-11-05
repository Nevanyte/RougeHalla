# hosting/infra/fleet: prepared infrastructure (never applied)

CloudFormation for the staging GameLift container fleet. **Nothing here has been applied; do not apply it without the owner's approval** (docs/hosting/COST.md:
CAD 20 TOTAL cap, sandbox account 961470857356). Why CloudFormation and what was verified: docs/hosting/DEPLOYMENT.md sections 1 and 2.

| File | What |
|---|---|
| `fleet.cfn.yaml` | us-west-2 stack: ECR repository (immutable tags), container group definition (`glbridge` + `rh-server --max-rooms 1`), container fleet (`FullProtection`, target tracking on `PercentAvailableGameSessions`, protected auto-rollback deployment configuration, `MaxInstances` capped at 1), log group, alarm topic, 7 alarms, the fleet role. `RemoteLocation=ca-central-1` adds the second location |
| `budget.cfn.yaml` | us-east-1 stack: cost budget, e-mail notifications, a budget action that attaches a deny-create policy to the operator role (not a stop for running instances) |
| `iam/deployer-policy.json` | least-privilege operator policy for the stacks, GameLift, ECR, alarms/logs/SNS (prefix `rougehalla-infra-*`, two Regions) |
| `validate.sh` | `cfn-lint` 1.59.0 and `parliament` 1.6.4 in a pinned `python:3.12.8-slim`; needs Docker, no AWS |

Teardown by tag/prefix and its check: `hosting/scripts/teardown.sh`, `hosting/scripts/verify-no-billable.sh` (both `--dry-run`, both refuse without `--yes` and an explicit
`AWS_PROFILE`). Every resource carries `Project=rougehalla-infra`, `Experiment`, `TeardownBy`, `Owner`.
