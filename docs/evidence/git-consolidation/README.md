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
unreviewed tournament/quest continuations stay isolated. The bounded art repair is admitted through `55825c10`; later art
evidence work remains separate. Primary/remote organization must preserve these branch refs and never reset WIP.

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

The first clean checkpoint was pushed as7d71bcc1, then the learning union as53bbead3. The original32 reviewed PR
heads are accounted for: four GitHub auto-merges and28 explicit stacked closures after verified head ancestry. Three
later PRs (#62–#64) are closed after reviewed composition, with the tournament admission repair included. Their original
heads are not claimed as ancestors or new GitHub merges. The total is35 PR dispositions: four auto-merges and31 explicit
closures. Canonical API checks confirm the three unchanged original heads are closed/merged:false after pushfebf1f3f.
All branch refs remain. [The disposition receipt](github-dispositions.json) maps original heads to composed units and repairs.

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

The art prefix throughc6fe0b18 was integrated in8cf840e9. Its final handoff througha401a510 is now integrated in3bf64d42,
including the cosmetic hollow impact ring at runtimeebff286b. Independent review verifies the11 EditMode results,
all19 required browser outcomes (including preview/settings, not19 distinct gameplay mechanics), all nine profile
summaries against raw reports and all14 manifest file hashes on disk. A separate coordinator HTTP download reproduces
every file's length/hash and the74,029,313-byte total; this is served-byte verification, not a new browser/profile run.
Five proof-contract tests and syntax checks pass after merge. Asset/notice provenance remains reviewed. The exact art
artifact uses native basee90a38f6/protocol11/content801a76cde4cfd305; it is not a fresh final-union build. Actual144Hz
display/fullscreen proof, managed allocation throughput and full-game coverage remain open. See
[verification](../../art/VERIFICATION.md) and [performance](../../art/PERFORMANCE.md).

The subsequent bounded lighting/readability handoff through `55825c10` is integrated in `46ceebba`. Source reviews admit
the native notice formatter, cached distinct faction shapes/backed sigils and mutually exclusive High Accurate/lower
Disabled point-light presets. Active map budgets6/3/0 and the High-only local accent remain; private state and gameplay
authority are unchanged. Actual27-test Editor results and the affected diagnostic-state cleanup pass. Independent raw/
portable comparison verifies the19 browser outcomes, per-socket/Welcome census, real five-player Result and all three
High GPU summaries. Notice6/tick96 visibly reads "Already at full health"; this is not all-notice browser coverage.

All14 new distribution files independently match disk and HTTP hashes, totaling74,041,096bytes. The staged A/B changes
only secondary normals with byte-identical albedo; bounded rendered color-vision findings remain static and acknowledge
HUD occlusion and partial live factions. Three warmed native-eight-seat-config windows at Manual High/motion on/
actual2560×1440 pass the6.944ms diagnostic GPU p99 limit (5.848/5.795/5.813ms), with no disjoint samples or resource errors.
Observed actor rows max7 are not eight rendered players. Different old/new workloads do not prove an isolated cost
improvement. Six post-merge proof/census checks, script syntax and net-source synchronization pass. The manifest,
raw-report hashes, summaries and open gates are in [repair evidence](../../art/evidence/repair/summary.json).

The `ebff286b` artifact/nine-window evidence is preserved separately. New runtime `4f37e9f0` still uses native base
`e90a38f6`; no final-union artifact, physical144Hz, managed allocation throughput, full content or game-wide accessibility
acceptance follows. Accidental primary evidence-harness WIP was preserved with exact bytes/patches, verified against its
isolated copies, then removed/restored only after the writer stopped. Both private recovery receipts remain available;
no worker edits were discarded. Primary integration remains lead-owned.

## Cumulative CI timeout and preserved coverage

Run42466924111 atb01fc9e2 completed the full default workspace with **1,520 tests passed, three existing ignores,
159 verdict groups**, including the previously locally excluded map suite. PostgreSQL server/placement, parity,
headless smoke and JS vectors also passed. The job reached its cumulative40-minute limit during a later terrain
feature check; it was not a failing workspace test. C# and card-runtime source jobs completed successfully.

The workflow now runs the full pure simulation suite in parallel with the remaining workspace/backend/source checks,
using `trusted-status-probes` to preserve the former workspace feature union (including required-feature privacy/
allocation targets). Both jobs keep a60-minute bound. CI debug symbols are disabled to reduce repeated feature-build
size/time; optimization levels, assertions, overflow checks and test selections are unchanged. No tests were filtered
away. YAML and the partition/feature selection are checked locally. The completed
[run42471329922](https://github.com/Nevanyte/RougeHalla/actions/runs/42471329922) at48f4bb28 passes all four jobs: Rust,
simulation, C# and card-runtime source. Subsequent presentation/doc commits change none of those native/net/workflow
inputs. This full workflow result does not close strict unported mechanics or the final browser/cloud/performance gates.

After verifying the primary checkout was tracked-clean and every running Unity project used the isolated art tree, the
lead released optimization_port from the managed checkout and switched the primary project back to that branch with
ignored-file overwrite disabled. Original prompts remained present. The managed tree is a clean detached review snapshot,
and active worker checkouts were unchanged. Future writes use the primary branch checkout.

## Completed DeepSeek composition and corrective admission

The lane's `pending-compose-r2` candidate `b9f149c9` has actual base `455a202f`. Independent reviews split its four
units. A–C (`f0bd176a`, `cb2f6a67`, `f9124b48`) are integrated in `fdf65513`: explicit bot overrides retain source draws
and automatic-fill behavior; Committed refuses second-slot barter before potion/cooldown mutation; quest source traces
close run-end offers and recheck camp impossibility through actual producers. They do not complete public trade/quest
transport. Original source branches and recovery refs remain.

D initially passed lane tests but failed source review: false active-learning output, wall/game timing conflation,
uncapped delayed inputs, an extra application tick and incomplete rich damage tallies. The independently reviewed
`c9bdf0d8` repair is integrated with D in `8ce725db`. Learning defaults Off and unsupported On refuses; individual worker
durations feed gameMs separately from total wallMs; per-seat256 caps precede jitter draws; delivery resolves/submits
before every actual step, including non-decision steps. Unsupported advanced damage/first-hit values are typed missing
and remain unavailable in dependent reports. Full source manager seeds/jitter/observation delay, active learning,
recorder production and complete brain outcomes remain outside this admission. See [repair evidence](../tournament-admission-repair/README.md).

The root gate passes956 all-feature remaining-workspace tests across126 verdict groups with real private PostgreSQL,
two existing ignores (external glbridge session E2E and valgrind heap probe), plus20 disjoint simulation tests (traders5,
quests15). Bot-fill16 is included in956. Both strict workspace Clippy modes, formatting, rebuilt native15-check Chromium
WSS and parity report109 scenarios/300 paths MATCH (13 separate capture-only) pass. No unchanged map campaign was
repeated locally; current full simulation CI remains required. Identity stays protocol11/checkpoint24/replay18/
observation17/policy13/content801a76cde4cfd305. New CI gates cover the five affected source-capture tools.

All five pinned source commands independently reproduce bytes: addBot5 scenarios, trade6 cases, quest6 placements/
10 lifecycle cases, tournament and base telemetry plus11 matrix records. Initial primary checks hit existing ignored
workspace Vite caches on the read-only bind; a clean detached checkout with an empty ignored node_modules mountpoint
resolved that environment issue. Failure logs are retained and not counted as passing captures. Both temporary capture
worktrees were removed cleanly after checks; source goldens and owner caches were untouched. The private PG cluster was
stopped after the gate. [Receipts](local-check-receipts.json) pin the actual logs.

Camp-stock source follow-up `289a01e2` is integrated in `ecf9564c`: canonical count comparison/display, actual-HUD1/1
regression and maximum-stock1.50-text Editor layout evidence. It has no new browser build; served runtime4f37e9f0 is
unchanged. Proposal88dbc5cf is retained inae11f90e without activating its future cues. Later art source drafts/audio
research remain isolated. Post Rust is assigned the evidence-only fair-view witness; the G6 producer is authorized only
as a private native candidate, with new state/content identity and live publication/gating still held.

The native admission and packet checkpoint is pushed as `febf1f3f`. Full foundation CI run
[42483382269](https://github.com/Nevanyte/RougeHalla/actions/runs/42483382269) is pending: C# and card-runtime source
jobs pass; Rust and full simulation are still running at this receipt. G6 was delivered via the existing Rust lane
from immutable `febf1f3f` and its Running state verified; the evidence-only Post Rust lane is also running. The art
prop/signature source drafts passed read-only review but remain isolated and uncompiled; a source-only no-socket
action/direction selector is authorized, with build/browser/performance validation deferred to the next client batch.

## Corrected partial perception evidence

The source-witness branch `32ebb94f` plus reviewed test/claim/provenance repair `8d903b7c` is integrated in
`b0310e73`. Only new source corpora/tools, native controls and evidence are added; production, old goldens and all
current identities remain unchanged. Root reproduces the three corpora byte-exact, kills all three compiled semantic
source mutants and restores the control. Four focused all-feature native tests pass after integration. Strict affected
Clippy initially found a needless test borrow; the follow-up removes it, and final lint/format checks pass.
[Receipts](local-check-receipts.json) retain both the initial failure and final results.

This is admitted partial evidence, not approval for hidden-state aggregates or wider observations. Room lifecycle,
committed prepared binding/carry equality and legacy/native visibility-time equivalence remain unproved. The source
capture is now included in CI. The next Post Rust scope is source-only barrier-view arithmetic/schema/ring witnesses;
G6 producer/expiry remains the separate private Rust lane. The art source batch is subsequently admitted through
`f16bca0d` after compile and42 Editor passes. Root verifies all nine raw artifacts,31 source hashes and the entire
byte-identical tested Unity tree. The separate audio commit is excluded. See its [admission record](../../art/evidence/source-cues/ADMISSION.md);
no fresh Web build, visual result or performance claim follows.
