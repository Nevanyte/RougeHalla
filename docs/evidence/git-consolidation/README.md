# November 8 Git consolidation

The owner requested consolidation of loose branches and uncommitted work into `optimization_port`, while explicitly
keeping active agents running. This checkpoint integrates reviewed native Rust, transport, Unity net/prediction and
verification work. It does not claim completion of every packet or the original full port. Current state and worker
ownership are in [MIGRATION](../../MIGRATION.md) and [PROJECT_COORDINATION](../../PROJECT_COORDINATION.md).

## Preservation and disposition

Before mutation, the lead saved the common Git directory (93,803,701 bytes), a full-ref bundle (57,227,763 bytes),
ref inventory, staged/unstaged binary patches, untracked archives and SHA manifests. These remain in the private
`return-cleanup-2026-11-08/backup` tool archive. The renamed primary repository had left worktree metadata pointing at
old paths: `git worktree repair` restored 100 known links. No source reset or force deletion was used.

Forty-five clean merged historical worktrees were removed after rechecking HEAD, status, ancestry and process cwd.
Their branch refs remain. A process-owned `server-perf` tree was kept. Only the known old missing `RougeHalla-kimi`
registry entry was pruned after dry-run inspection. The [disposition/restore map](historical-worktree-dispositions.json)
contains the individual revisions; `$PRIMARY` is the main repository path when restoring a tree. Active worktrees and
their WIP are preserved. Historic pre-port TypeScript/hosting/quests/render branches are not wholesale merged into the
Rust migration; production legacy `packages/**` is unchanged by this consolidation.

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
| Subsequent RTT/server integration | Library125/125, reward2/2, rewind4/4, real transport7/7; 138 passed at the repaired union |
| Strict lint/format/parity | Both workspace Clippy feature modes with `-D warnings` and fmt passed; affected RTT all-feature lint/fmt passed;109 scenarios +300 paths MATCH,13 separate capture-only |
| C# / JS | 329 C# tests and synchronized net sources passed; JS16,656 golden checks (36 server vectors,96 malformed,11 chains), plus64 focused assertions |
| Actual Unity Editor | Pinned6000.0.85f2 WebGL-target import/compile passed; this is not a fresh full Web player or art/performance proof |
| Actual Chromium WSS | 15/15 passed on protocol11; reward compatibility/RTT changes separately covered by focused integration tests |
| Latency / inventory / staging renderer | 12 harness +4 trace tests,10 inventory tests,5 local renderer tests, saved-evidence checker and Caddy adaptation passed |

[Local check receipts](local-check-receipts.json) hash the retained private artifacts. Earlier full CI records remain
historical; the consolidated pushed revision needs its own CI. Failed intermediate attempts are kept in the private
archive and are not counted as successful gates. The legacy source/capture expectations were not weakened to pass.

## Explicit holds

The Knowledge/fair-view prefix through `fdea457b` is admitted after independent57-test/three-mutant/canonical-capture
review. Its source/tool hashes match and prior fixtures remain unchanged; the stale decide-stream descriptions and
fresh-checkout capture mountpoint were corrected at integration. The docs-only `47ffd063` observation proposal is
retained without approving leaves. Bot learning remains held for lease, safe shutdown and source-order repairs. New fair observation leaves require a concrete approved design and unused version. The active
bot-fill/tournament continuations and source-fixture consumers stay isolated until reviewed. The art lane has separate
browser/performance work underway. Primary/remote organization must preserve these branch refs and never reset WIP.

Full public Wish/Trophy/quest/trade/fact transports, native strict remainders, full bot brain, browser/account flows,
durable cloud/provider/regional operation and comparable full-game performance remain unfinished. The old Calgary
staging run was removed; this cleanup makes no production or AWS resource changes and does not enlarge CAD20 total.
