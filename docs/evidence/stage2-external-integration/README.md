# External branch integration (2026-11-05)

Kimi PR24 and Claude PR25–27 target `optimization_port`. The coordinator reviewed each scope and integrated fixes before
merging the corresponding Claude branch. These checks cover the implemented game domain and local adapters; they do
not establish full-game parity, cloud availability, capacity, host-loss durability or release readiness.

| Source | Integration and findings | Verification |
|---|---|---|
| Kimi PR24, `3558f83af4e6f4796233fd906039233870509311` | Merged as `1d26fd61`. Bounded determinism inventory, strict comparator and native architecture workflow. | 25 comparator and 12 focused Rust tests; native Linux x86_64/aarch64 production, exact comparison and both foreign-replay directions passed at source (`42093826602`) and merge (`42101769249`). |
| Claude PR25, `1d9ccae348db826e5cbc0fa784ea26e176807d4b` | Merged as `904ad78d`. Fixed stable-account-ID authorization/read races and retry of bridge leave after definitive SDK refusal. | Real-PG 38 persistence plus 142 selected server checks; independent Go race tests. Rust/C# CI `42105176881` passed. |
| Claude PR26, `593f2d237595f4f288c715c7d957920ebfa55304` | Merged as `cbdf82cf`. Rejected unsafe PID0 and invalid/unbounded scenarios, corrected steady-state denominator, made failed startup clean its auth file, and validated the public start API before side effects. | Load harness 39 checks and strict Clippy; historical raw load measurements preserved with corrected interpretation. Rust/C# CI `42106334019` passed. |
| Claude PR27, `e4e57178dc899918780fc9c73ee5c2bf3f537a7c` | Merged as `5b1a7aae` with the five repairs listed below. No cloud deployment or DNS mutation was executed. | Final combined gate: 905 passed, 0 failed, 2 ignored, 0 filtered; formatting and both strict workspace Clippy modes passed. Parity: 97 compared/13 capture-only/300 paths all MATCH. |

PR27 repairs:

1. Placement ownership now binds complete request/config/attempt identity to an explicit ownership nonce. Ambiguous
   cancellation and canceled/failed reaping retain cleanup work. Foreign placements and accepted idempotent offers
   are protected. Original zone identity survives configuration changes. The ledger remains process-local and bounded.
2. Deployment/teardown require exact project/experiment tags and sandbox account identity. Inventory failures fail
   closed. Rollback retains the original container-group definition and source version. The manual OIDC workflow checks
   STS account identity before either CloudFormation path without an unsupported credentials-action input.
3. IAM action/resource/condition mappings were corrected against service authorization references. Regional linting
   reports the two missing Canadian container schemas as an explicit pending deployment gate, not a successful deploy.
4. DNS verification checks IPv6 when IPv4 has no answer; actual lookup failures remain failures.
5. Cancellation receipts must preserve both exact placement ID and ownership data before publishing or disarming cleanup.
   The 16-case receipt matrix exposed 12 failures before this repair and passes all 16 afterward.

The final workspace run intentionally ignored the heap measurement and manual bridge test. The latter was then run
explicitly: the real Go fake-SDK bridge, real Rust server and real WebSocket client passed the end-to-end test. This is
local lifecycle evidence, not a managed GameLift fleet test. The Node suite passed 40 checks and shell AWS-stub suite 33.
Pinned cfn-lint 1.59.0 accepted the west fleet/east budget templates; Parliament accepted the deployer policy with no
findings. The manual validation workflow now runs all five existing Node test files.

Current simulation content remains `a35c49ba5c73e88b`; checkpoint 14/replay 12/observation 11/policy 8/wire 5 are unchanged.
Same-volume result-spool process recovery is implemented; host-volume loss and managed database failover are unproved.
Placement has no durable ledger, authenticated HTTP boundary or real AWS/DNS adapter yet. One managed GameLift game
session uses one server process; host density can use multiple container groups. CAD 20 is the total staging ceiling.
No Stage 2 billable resources, certificates, DNS changes or production cutover were performed.
