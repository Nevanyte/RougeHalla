# AWS hosting readiness checks

Read-only local audit on 2026-11-08, checkout `b7788161` (`codex/input-latency`). No AWS API mutation, Docker build, or cloud deployment was performed. The shared worktree also contained in-progress Unity/input-latency changes; this evidence file is the only file changed by this audit.

## Local hosting checks

| Check | Result |
|---|---|
| `bash hosting/scripts/test-aws-scripts.sh` | PASS: 33 checks, 0 failures. Stubbed script guards, call ordering, account pinning, rollback gates, and dry-run behavior passed. |
| `node --test hosting/scripts/ownership.test.mjs hosting/infra/fleet/iam/policy.test.mjs` | PASS: 6 tests, 0 failures. |
| `hosting/scripts/teardown.sh --experiment stg1 --dry-run` | PASS (exit 0). Printed the prospective commands only; no AWS CLI was present or called. |
| `hosting/scripts/verify-no-billable.sh --experiment stg1 --dry-run` | PASS (exit 0). Printed read/list checks only; no AWS CLI was present or called. |
| `hosting/infra/fleet/validate.sh` | PASS: cfn-lint 1.59.0 and Parliament passed. `us-west-2` fleet and `us-east-1` budget templates lint clean. `ca-central-1` reports only the two documented missing GameLift container resource types in the local regional schema snapshot. |
| Docker availability | Docker Engine 29.2.1 responds. No image build or container smoke was run. |

The AWS CLI is not on `PATH`, but the approved bundled CLI is available at `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/aws-cli/aws` (AWS CLI 2.39.5). The only configured profile name is `rougehalla-staging`; credential values and profile contents were not read. Its STS check failed with an unclassified CLI error; raw diagnostics were suppressed. AWS Core was subsequently restored: read-only STS succeeded for account `961470857356` under the provided assumed `AccountFullAccessRole` context. `cfn-lint` and Parliament are not installed on the host; `fleet/validate.sh` ran its pinned tools in Docker.

## Local bridge verification

`hosting/scripts/e2e-bridge.sh` **PASS** on 2026-11-08: the real Go bridge built with the scripted fake GameLift SDK drove the real `rh-server` and integration client through the session lifecycle. The saved final log reports **1 passed, 0 failed**, in 17.53 seconds (an earlier run took 20.80 seconds). The script completed its pinned Go 1.25.14 container build and Cargo test using Rust 1.97.0, `CARGO_BUILD_JOBS=1`, `CARGO_INCREMENTAL=0`, and `CARGO_TARGET_DIR=/Users/nevinmckinnon/Documents/Projects/RogueHalla-input-latency/target`. The non-secret output is preserved at [`bridge-e2e.log`](bridge-e2e.log). This was local fake-SDK verification; it made no AWS calls and does not establish managed GameLift behavior. No source or `Cargo.lock` changes were made by this check.

Remaining local hosting checks, if desired, are the Go vet/race suite and the image-level fakesdk smoke. The hosting README documents:

```bash
hosting/scripts/e2e-bridge.sh
cd hosting/glbridge
docker run --rm -v "$PWD":/src -w /src golang:1.25.14-bookworm sh -c 'gofmt -l . && go vet ./... && go test -race -count=1 ./...'
```

For the image-level fakesdk smoke, build `rh-match:fakesdk-arm64` using the commands in [`hosting/README.md`](../../../hosting/README.md), then run `hosting/scripts/docker-smoke.sh rh-match:fakesdk-arm64`. These checks do not contact AWS.

## Cloud boundary and remaining gates

- [`crates/rh-placement/README.md`](../../../crates/rh-placement/README.md) states that the placement crate has no production HTTP handler, AWS/GameLift control-plane adapter, or DNS adapter. `hosting/glbridge` integrates the GameLift Server SDK lifecycle only; fake-SDK tests do not prove managed GameLift placement, DNS publication, or fleet behavior.
- The previous Calgary single-host playable MVP was removed and its infrastructure/DNS cleanup was independently verified. The current migration record says the staging cap remains CAD 20 total and posted billing is unverified; no zero-bill claim is established. The Free-plan credit does not enlarge the cap.
- Prepared GameLift CloudFormation/IAM files remain unapplied. Their cost plan is a separate experiment: stage 1 estimates a CAD 10.09 worst case and stage 2 CAD 16.60, conditional on remaining allowance and explicit review. Budget alerts are not a hard stop.
- **The two account IDs refer to separate staging work.** The current AWS Core connection verified account `961470857356`, the prepared GameLift sandbox pinned by `hosting/scripts/lib/guard.sh`, its IAM policy, and the fleet workflow. The historical Calgary MVP was separately run and cleaned in `048226733033`, as recorded in its non-secret ownership/cleanup manifests and `hosting/staging-mvp/staging.py`. The CAD 20 cap is shared across the staging work; no conclusion about total remaining allowance follows from inspecting only the GameLift account.
- The prior staging MVP used practice-domain DNS and did not authorize production changes or a Paid-plan upgrade. Prepared GameLift docs additionally leave public TLS/DNS, fleet protection/scale-in, canary/rollback, remote-region behavior, and real capacity unverified.

Safe next cloud reads are STS caller identity, Cost Explorer actual spend, Service Quotas, and resource `list`/`describe` calls. The dry-runs above are local command previews only, not live cleanup verification. In the verified GameLift account, organization SCP denies currently block the requested resource inventory calls.

## Scoped AWS read-only preflight

Performed after AWS Core reauthentication on 2026-11-08. STS verified account `961470857356`. EC2 requests used the known Calgary run tag (`RoguehallaRun=20261106t090412z-18737d`); the queue lookup named `rh-placement-queue`; GameLift calls targeted the documented home region `us-west-2`. CloudFormation and GameLift list APIs do not support the requested name filter in these calls, so any returned data would have been reduced to Roguehalla stack/fleet/definition names before surfacing. Those calls were denied and returned no inventory. No unrelated resource details or credential material were surfaced.

| API | Region | Result |
|---|---|---|
| `STS.GetCallerIdentity` | `us-east-1` | **Success**, account `961470857356`. |
| `CloudFormation.ListStacks` (corrected call without unsupported name-prefix parameter) | `ca-west-1` | **Failed**, `InvalidClientTokenId`; no stack inventory. |
| `CloudFormation.ListStacks` | `us-west-2`, `ca-central-1` | **Failed**, `AccessDenied` from an explicit organization service control policy deny; no stack inventory. |
| `EC2.DescribeInstances`, `DescribeAddresses`, `DescribeVolumes` | `ca-west-1` | **Failed**, `AuthFailure`; no EC2 resource inventory. |
| Same EC2 describe APIs | `us-west-2`, `ca-central-1` | **Failed**, `UnauthorizedOperation` from an explicit organization service control policy deny. |
| `GameLift.ListContainerFleets`, `ListContainerGroupDefinitions`, `DescribeGameSessionQueues` for `rh-placement-queue` | `us-west-2` | **Failed**, `AccessDeniedException` from explicit organization service control policy denies. |
| `CostExplorer.GetCostAndUsage` (`UnblendedCost`, 2026-11-01 through 2026-11-08; exclusive end 2026-11-09) | `us-east-1` | **Success**, MTD actual reported as **USD 0.00** for account `961470857356`. No billing settings were changed. |

Thus AWS call execution was verified only for STS and Cost Explorer; the inventory APIs did not provide resource state. The USD 0.00 response is limited to this account and reporting window, can lag, and says nothing about the historical Calgary account or total CAD 20 allowance. No claim that the account has no billable resources is supported.

### Minimal smoke options to review (no deployment performed)

1. **No-spend next step:** request org-level read permission for the exact inventory calls above (or an approved role without the explicit SCP denies), then repeat the scoped preflight and confirm posted costs in both staging accounts. Resolve `InvalidClientTokenId` for `ca-west-1` separately. This keeps the existing cap untouched.
2. **Bounded GameLift smoke after inventory and remaining-budget confirmation:** use the existing stage-1 plan in `docs/hosting/COST.md` only after reconciling actual account spend and obtaining the required explicit approval. It is one `c6g.large` in `us-west-2`, a four-hour hard stop plus a 24-hour teardown allowance, and a documented CAD 10.09 worst case; prepare/build, create one canary session, verify lifecycle/protection/rollback, then tear down and verify. Do not add the remote region or queue/TLS/DNS work in that first smoke. The current USD 0.00 CE reading alone is not sufficient to authorize it.
