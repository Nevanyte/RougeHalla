# hosting/infra/fleet: prepared infrastructure (never applied)

CloudFormation for the staging GameLift container fleet. **Nothing here has been applied; do not apply it without the owner's approval** (docs/hosting/COST.md:
CAD 20 TOTAL cap, sandbox account 961470857356). Why CloudFormation and what was verified: docs/hosting/DEPLOYMENT.md sections 1 and 2.

| File | What |
|---|---|
| `fleet.cfn.yaml` | us-west-2 stack: ECR repository (immutable tags), container group definition (`glbridge` + `rh-server --max-rooms 1`), container fleet (`FullProtection`, target tracking on `PercentAvailableGameSessions`, protected auto-rollback deployment configuration, `MaxInstances` capped at 1), log group, alarm topic, 7 alarms, the fleet role. `RemoteLocation=ca-central-1` adds the second location |
| `budget.cfn.yaml` | us-east-1 stack: cost budget, e-mail notifications, a budget action that attaches a deny-create policy to the operator role (not a stop for running instances) |
| `iam/deployer-policy.json` | prepared operator policy for the stacks, GameLift, ECR, alarms/logs/SNS (prefix `rougehalla-infra-*`, two Regions) |
| `validate.sh` | `cfn-lint` 1.59.0 and `parliament` 1.6.4 in a pinned `python:3.12.8-slim`; needs Docker, no AWS |

Teardown by tag/prefix and its check: `hosting/scripts/teardown.sh`, `hosting/scripts/verify-no-billable.sh` (both `--dry-run`, both refuse without `--yes` and an explicit
`AWS_PROFILE`). Every resource carries `Project=rougehalla-infra`, `Experiment`, `TeardownBy`, `Owner`.

## Review fixes and remaining deployment gates

The manual workflow checks sandbox account `961470857356` after OIDC, before either CloudFormation path. Local destructive
scripts pin that account (environment overrides cannot change it), require `--yes` and a named profile, and default to
no execution. Fleet deletion/rollout additionally require exact Project/Experiment tags and an account/region-bound ARN.
Teardown selects known stack, group, alarm, role, topic and policy identities; it does not delete neighboring experiment
prefixes or the shared budget-action role. Read/list failures abort instead of reporting successful cleanup.

Rollout copies the current version's complete game-server input definition, strips output-only fields, and changes only
ImageUri. It specifies SourceVersionNumber; ContainerName, PortConfiguration and ServerSdkVersion remain present, as
required by [UpdateContainerGroupDefinition](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_UpdateContainerGroupDefinition.html)
and [GameServerContainerDefinitionInput](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_GameServerContainerDefinitionInput.html).

IAM role lifecycle, managed-policy attachment, and PassRole have separate conditions. `iam:PolicyARN` belongs on attach/detach;
PassRole is limited to `gamelift.amazonaws.com` ([IAM context keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_iam-condition-keys.html)).
Budget creation/deletion use `budgets:ModifyBudget` ([Budgets authorization](https://docs.aws.amazon.com/service-authorization/latest/reference/list_budgets.html)).
GameLift changes are scoped to sandbox container resources bearing the Project tag; creates require that request tag
([GameLift authorization](https://docs.aws.amazon.com/service-authorization/latest/reference/list_gamelift.html)).
The log group starts `gamelift-`, matching the [AWS managed fleet policy](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/GameLiftContainerFleetPolicy.html).

This is a prepared operator policy, not a claim of a deployed least-privilege role. AWS authorization has **not** been
exercised. In particular, verify create-time tagging with CloudFormation, the OIDC role's repository/environment trust and
protected reviewers, service-linked-role bootstrap, and the separately approved budget-action role/policy bootstrap before
deployment. SNS Unsubscribe requires a wildcard resource and remains restricted by Region; inventory permissions are
read-only. Do not broaden permissions automatically to make a deployment pass.

All actual AWS deployment/rollback, public DNS/TLS, workload/capacity, and cost experiments remain NOT RUN. The CAD 20 cap
is TOTAL, and a price/overlap/teardown plan plus region and certificate decisions are still prerequisites for any spend.
The wildcard certificate reader policy is unattached and the fleet has no certificate-sync support container; this review
does not authorize attaching the reader or exposing its private key to game processes. Production `play.roguehalla.com`
remains outside this work; DNS helpers accept only the practice `rougehalla.com` domain.

Local guards: `bash hosting/scripts/test-aws-scripts.sh`; `node --test hosting/scripts/ownership.test.mjs hosting/infra/fleet/iam/policy.test.mjs`.
These use stubs and a deliberately narrow policy evaluator, not an AWS policy simulator. `validate.sh` additionally uses
pinned cfn-lint/parliament; ca-central-1's two missing resource-type diagnostics are a local schema limitation, not live
region proof.

Coordinator implementation decision: retain the staging `AlarmTopic` without `KmsMasterKeyId` for this prepared, ephemeral
experiment carrying only non-sensitive operational metric values, alarm names and resource identifiers. Existing deployment
gates remain in force. Production/session/profile/auth data, admission credentials, player data, private keys and game
payloads must not use this unmodified topic. This does not claim SNS encrypts the topic
by default. Revisit the exception before production use or any sensitive payload; adding SSE later also requires checking
the CloudWatch publisher's KMS permissions, not merely adding a key name. See
[`AWS::SNS::Topic.KmsMasterKeyId`](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-sns-topic.html#cfn-sns-topic-kmsmasterkeyid).
