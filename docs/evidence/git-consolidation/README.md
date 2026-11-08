# November 8 Git consolidation

The owner requested consolidation of loose branches and uncommitted work into `optimization_port`, while explicitly
keeping active agents running. This checkpoint integrates reviewed native Rust, transport, Unity net/prediction and
verification work. It does not claim completion of every packet or the original full port. Current state and worker
ownership are in [MIGRATION](../../MIGRATION.md) and [PROJECT_COORDINATION](../../PROJECT_COORDINATION.md).

## Preservation and disposition

Before mutation, the lead saved the common Git directory (93,803,701 bytes), a full-ref bundle (57,227,763 bytes),
ref inventory, staged/unstaged binary patches, untracked archives and SHA manifests. These remain in the private
`return-cleanup-2026-11-08/backup` tool archive. The renamed primary repository had left worktree metadata pointing at
old paths: `git worktree repair` checked/repaired 100 registered links. No source reset or force deletion was used.

Forty-six clean merged historical worktrees were removed after rechecking HEAD, status, ancestry and process cwd.
Their branch refs remain. A process-owned `server-perf` tree was kept. Only the known old missing `RougeHalla-kimi`
registry entry was pruned after dry-run inspection. The [disposition/restore map](historical-worktree-dispositions.json)
contains the individual revisions; `$PRIMARY` is the main repository path when restoring a tree. Active worktrees and
their WIP are preserved. Historic pre-port TypeScript/hosting/quests/render branches are not wholesale merged into the
Rust migration; production legacy `packages/**` is unchanged by this consolidation. The unclear `codex/mob-progression`
branch37b097db is an exact legacy-tree/patch duplicate of squash0151776d already in the branch ancestry; it has no unique
Rust code or tests to select.

Stable dirty histories were preserved as reviewable recovery commits:

| Recovery ref | Commit | Admission |
|---|---|---|
| `codex/recovery/player-lifecycle-20261108` | `2ddb7fc9` | Selected unique 17 source-fixture/harness files retained; obsolete base-player runtime/validator not substituted for current native code |
| `codex/recovery/infra-remediation-20261108` | `ff4a46d0` | Four files exact-current and account API patch already present |
| `codex/recovery/mob-catalog-20261108` | `b149d12d` | Exact source tools/fixtures/docs; current native catalog/tests are a strict superset |
| `codex/recovery/placement-durability-20261108` | `8df4a57d` | All 18 files exact or patch-present; lockfile exact |

Reviewed patch-equivalent histories, including `claude/infra-hardening` (`9351dd63`, infrastructure trees identical to
the already integrated `e4e57178`), received explicit ancestry merges using the ours strategy. Those merge commits
record a reviewed disposition, not a claim that their obsolete full trees were applied. The competing Cursor card
runtime likewise retains its history after the wider native runtime was chosen; its unique training repair was
integrated as `66bce557`. The [owner artifact archive](../../agent-prompts/README.md) retains exact prompt/PDF bytes;
originals remain available to active agents and are only locally excluded along with redundant `context_copy/`.

## Native and transport reconciliation

The admitted union includes completed card/bot prefixes through `f87727dd`, native faction/consumable/arena/training/
quest/trader siblings, bot planning `8d85b9f9`, bot fill `127f6f7f`, Kimi readiness/presentation inventory, networking
prefixes and same-frame input scheduling. [ADR0021](../../adr/0021-protocol11-union.md) binds protocol11,
checkpoint24/replay18/observation17/policy13/content `801a76cde4cfd305`. All admission still goes through validate +
submit; no Unity rules or simulation I/O were added.

Coordinator repairs include incompatible tags/readiness/delta tracking, valid RewardCard0–79 bounds, negative planning
deadline rejection, card modifier/checkpoint consistency, native training, prediction reconciliation and frame polling.
`1234a73f` prevents unsupported native Trophy rows or prerequisite refusal text from poisoning an ordinary reliable
publication; [its regression](../native-reward-transport-compatibility/README.md) retains native/headless choices and
pre-stage privacy. Trusted modifier validation facts were grouped without changing serialization or identity.

`570dee45` completes the reviewed measured-RTT prefix: only a one-shot reply to a currently outstanding server Ping is
exempt from the user-frame bucket. Unknown/malformed/duplicate/evicted responses remain charged. The deterministic
65-second 60Hz stream fails the old order at59seconds and passes the repair. Resume resets the estimator and ignores
the old connection. The scope is command-time Attack/Release clamping; source held-attack behavior is preserved.

`326744c3` fixes delayed TCP FIN draining, protected latency-report cleanup, portable Playwright loading and the
requirement that both endpoints be loopback before allowing local self-signed TLS. The later diagnostics/evidence chain
through `af284c5a` is integrated with those fixes retained. Root also constrained the reusable local Caddy fixture to
IPv4/IPv6 loopback, disabled redirects/admin and checked the adapted configuration in a network-none container. Four
saved reports remain PASS and the known missing-presentation report remains FAIL. These are old-candidate evidence
checks, not new final-union latency measurements or cloud authorization.

The [capture metadata receipt](source-metadata-refresh.json) binds a read-only source/protected/harness-chain refresh
without changing expected gameplay payloads. The derived ability tape no longer catches and silently discards arbitrary
failed cases: exactly58 admitted cases must execute; five named pending full-source prerequisites stay explicit and
strict mode remains incomplete. The remaining strict packet/source acceptance is still required.

## Verification scope

| Check | Result and limit |
|---|---|
| Consolidated Rust native unit batch | 397 passed; 191 unchanged map-generator unit tests filtered; one existing manual ignore |
| Native integration prefix/rest and docs | 31 +134 +3 passed in completed disjoint targets; failed intermediate hash controls repaired and rerun |
| Remaining workspace, all features with isolated PG | 836 passed, two existing ignores across117 verdict binaries |
| Distinct Rust tests in those disjoint batches | **1,401 passed**; this is not a count inflated by later reruns |
| Subsequent affected native checks | Real four-seat reward publication2/2; server library124/124; native reward11/11 plus mixed-row control; checkpoint6/6; admitted58-case hash-tape consumer passed |
| Subsequent policy/headless integration | 125 passed across34 completed verdict groups after the Knowledge repair; no ignores |
| Subsequent RTT/server integration | Library125/125, reward2/2, rewind4/4, real transport7/7; 138 passed at the repaired union |
| Strict lint/format/parity | Both workspace Clippy feature modes with `-D warnings` and fmt passed; affected RTT all-feature lint/fmt passed;109 scenarios +300 paths MATCH,13 separate capture-only |
| C# / JS | 329 C# tests and synchronized net sources passed; JS16,656 golden checks (36 server vectors,96 malformed,11 chains), plus64 focused assertions |
| Actual Unity Editor | Pinned6000.0.85f2 WebGL-target import/compile passed; this is not a fresh full Web player or art/performance proof |
| Actual Chromium WSS | Fresh rebuilt union binary passes15/15 on protocol11 after reward/RTT/Knowledge integration, with zero page errors |
| Latency / inventory / staging renderer | 12 harness +4 trace tests,10 inventory tests,5 local renderer tests, saved-evidence checker and Caddy adaptation passed |

[Local check receipts](local-check-receipts.json) hash the retained private artifacts. Earlier full CI records remain
historical; the consolidated pushed revision needs its own CI. Failed intermediate attempts are kept in the private
archive and are not counted as successful gates. The legacy source/capture expectations were not weakened to pass.

## Explicit holds

The Knowledge/fair-view prefix through `fdea457b` is admitted after independent57-test/three-mutant/canonical-capture
review. Its source/tool hashes match and prior fixtures remain unchanged; the stale decide-stream descriptions and
fresh-checkout capture mountpoint were corrected at integration. The docs-only `47ffd063` observation proposal is
retained without approving leaves. Bot learning is integrated in `3619280f` with the independently reviewed exclusive
PostgreSQL session lease, default-Off mode, sticky detected-loss behavior, bounded shutdown and source order. The
[learning evidence](../stage2-bots-5/README.md) records246 actual-union test passes and limits; both strict Clippy modes
and formatting pass. New fair observation leaves require a concrete approved design and unused version. The active
bot-fill/tournament continuations and source-fixture consumers stay isolated until reviewed. The art lane has separate
browser/performance work underway. Primary/remote organization must preserve these branch refs and never reset WIP.

Full public Wish/Trophy/quest/trade/fact transports, native strict remainders, full bot brain, browser/account flows,
durable cloud/provider/regional operation and comparable full-game performance remain unfinished. The old Calgary
staging run was removed; this cleanup makes no production or AWS resource changes and does not enlarge CAD20 total.

The6b CLI/JSON prefix is admitted through `2b9212c1` with real timer wiring and propagated telemetry write/flush errors
(`cc2cbb69`). Thirteen focused tournament/CLI tests pass on the union, including a root-added flush-only sink failure.
Its further telemetry continuation remains active and separate; no full brain or outcome parity is claimed. The7b fill/configuration continuation with the [exact Unicode trim repair](../../coordination/BOT_TRIM_REPAIR.md) is
integrated in `43abe070`. A clean isolated target passes384 affected server/policy tests (two existing manual ignores),
both strict workspace Clippy modes, formatting and a fresh15-check WSS proof at protocol11/content801a76cde4cfd305.
Root preserves exclusive learning activation and skips profile-name lookup when effective fill is disabled. The source
trim set is checked over every Unicode scalar; canonical captures and old-helper mutant pass independently. Numeric
parser scope and startup-snapshot limitations remain explicit in the [fill evidence](../stage2-bots-7-repair/README.md).

## GitHub and CI follow-through

The first clean checkpoint was pushed as7d71bcc1, then the learning union as53bbead3. Thirty-one reviewed PR heads are
accounted for: four GitHub auto-merges and27 explicitly closed stacked PRs with immutable integration receipts. GitHub
refuses retargeting a head already wholly included in optimization_port; those closures are not falsely called new PR
merges. Branch refs remain for descendants. [The disposition receipt](github-dispositions.json) records individual PRs.

Twenty-one obsolete performance runs were checked against integrated HEAD ancestry:18 cancellations were confirmed,
and three had already completed (one success, two failures). Active worker runs were preserved. This frees capacity for
the current union rather than using obsolete branch numbers as its performance evidence.

Initial pushed CI passes C#, card-runtime source, legacy recapture, hosting and latency-report checks. Rust failed the
admission TTL integration scenario because its two clients could start a match; one leaving then closed the room. Closure
marks unused reservations expired, but the next retry correctly returns409 session_ended before idempotent replay. A
private forced-active HTTP witness proves that sequence. The fixture-only repair36a3222b uses a three-player threshold
for that scenario and explicit Lobby/HTTP assertions, preserving production error precedence and sleep durations. All24
control tests pass in both default/all-feature modes. Corrected CI remains separately tracked; the failed run is retained.

The last stable historical placement lockfile edit was byte-identical to the current lock. It was committed to recovery
ref `codex/recovery/historical-placement-lock-20261108` at610caa42, ancestry-accounted by an explicit ours merge, and its
now-clean unused worktree removed without force. The restore map contains it;46 historical trees were removed overall.

The P-NET fixture consumers33a79df1 are integrated in084246c3: three tests reproduce all300 paths and723 walk samples
using actual current Rust simulation inputs, with unchanged goldens. Production codec checks remain separate.

The reviewed art prefix throughc6fe0b18 is integrated in8cf840e9. It fixes visibility refresh ownership, stale pooled
voices, card79 invalidation and empty post-Welcome membership without adding gameplay authority. Asset/notice provenance
passes independent review. The lane reports11 EditMode tests and19 required browser outcomes (including separate preview
and settings, not19 distinct gameplay mechanics). Final c6 build/browser/profile evidence remains revision-scoped;
the physical60Hz display does not certify144Hz. This is functional source admission, not full-port/performance completion.

## Cumulative CI timeout and preserved coverage

Run42466924111 atb01fc9e2 completed the full default workspace with **1,520 tests passed, three existing ignores,
159 verdict groups**, including the previously locally excluded map suite. PostgreSQL server/placement, parity,
headless smoke and JS vectors also passed. The job reached its cumulative40-minute limit during a later terrain
feature check; it was not a failing workspace test. C# and card-runtime source jobs completed successfully.

The workflow now runs the full pure simulation suite in parallel with the remaining workspace/backend/source checks,
using `trusted-status-probes` to preserve the former workspace feature union (including required-feature privacy/
allocation targets). Both jobs keep a60-minute bound. CI debug symbols are disabled to reduce repeated feature-build
size/time; optimization levels, assertions, overflow checks and test selections are unchanged. No tests were filtered
away. YAML and the partition/feature selection are checked locally; the final pushed workflow needs its own result.
