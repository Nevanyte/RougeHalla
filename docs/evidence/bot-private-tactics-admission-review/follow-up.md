# Private Tactics — repaired candidate follow-up

2026-11-10. **RELEASE exact clean seal `cdf5b70f32be41ffa4bf5b8f3d0a83c5ab457aa0`**, parent `f252b8697cbff3afcee71711cf33db40c411399a`, for the approved finite complete private Tactics layer. This closes all three initial HOLD groups in README.md and preserves that historical inspected cut/receipt pins and Root's wip-findings.md. No Rust/tests/captures were run or authored by the reviewer; no worker/Claude contact occurred. Actual sealed source/code/receipt reads support this disposition, not README alone.

## Group 1: checked mutable apply and nonadvance — PASS

`source_tests.rs:550` introduces one CaseRunner.apply_checked boundary. It calls `source_decode::decode_declaration_checked` (around2693) on the supplied raw declaration using the actual suite/config, then resets transcript/sets environment/executes only after typed intake succeeds. The helper uses the existing strict typed declaration decoder rather than an injection-only validation path. Normal replay at837, changed-input execution, reached-prefix replay and the malformed operation controls all use this same apply boundary. The old direct predecoded execute_native path is gone.

`private_tactics_tests.rs:288–437` now reaches a real runner through two ordinary operations, injects each coherent malformed declaration through apply_checked, requires its typed Err and compares before/after, then executes the COMPLETE unchanged remaining raw operations on that same runner and compares against uninterrupted native execution. A separate partial replay at649 onward does the same. The chosen swap-player-cooldown history is meaningful: its first act earns a swap and three draws; later acts cross the cooldown with no-swap, another swap/fourth draw, then no-swap. Thus retained private timer/RNG/provider behavior is exercised after rejection, rather than taking trivial snapshots of an unrelated pure decoder.

The snapshot is enriched with actual full Memory and ordered trace, reached Percept/environment, actual decide ordinal, path counters and owned budget left. It is not a literal dump of all opaque Fight/Orb/Reflex/Retreat/World timers/cache entries; those are checked behaviorally through the reached remaining history, the alternative Root authorized. Its next-decide-value fingerprint is independently reconstructed from seed/count, not a direct inspection of the owned RNG; actual draws always advance the traced ordinal and append to the compared shared transcript, and later real draws/outputs are compared in continuation. We do not treat that reconstructed value as an independent full-state proof. The per-case config negative still properly rejects before a runner exists.

Actual repair log reports8 reached malformed-operation controls plus1 config rejection, a resumed exact transcript, all17 existing reader controls and no failures. No expected state was installed to make continuation agree.

## Group 2: all specialized tagged boundaries — PASS

`source_trace.rs` now checks ordered key sequences before specialized field comparisons for act/check result roots, Intent objects, callback/RNG event objects, paths.walk result objects and root Memory sections. Derived point paths require the ordered x,y tagged point even while allowing approved coordinate differences. Nested carried objects continue through ordered comparison. Seven new comparator/permutation controls cover those formerly skipped boundaries; the prior nested Memory/self-argument controls remain. They mutate only entry order with all values preserved and exercise the actual replay/comparator path after a green baseline.

The sole main-corpus key-set exclusion remains plain untagged drawCounts. The old compatibility corpora are separately documented as canonical sorted-key plain JSON, so their five CompareCtx instances use ordered=false for that plain serialization; array/Map/Set order, values, identities and all other channels are still checked. This is not an exemption for raw tagged dynamic objects in the154/720 source witness. The distinction is necessary and explicit rather than confusing serde envelope order with carried MethodValue insertion order.

## Group 3: computed spot versus direct endpoint — PASS

`source_tests.rs:281` derives coliseum_spot only when the expected actual coliseum move target differs bitwise from the declared Hold endpoint. Direct declared paths.walk targets therefore remain exact, just like output moves. The source World branch uses one computed slot when this derived destination exists; the rule does not grant a general geometry epsilon to declared goals/route waypoints.

`private_tactics_coliseum_walk_target_controls` tests the actual three counterexamples from the initial review: world-arrive-24.001-0 op2, world-arrive-120.001-800 op2, world-arrive-100-799 op2. Each valid baseline is green; a 1e-9 callback target change is rejected at callbacks.args[1]. The same tiny change in the genuine hold-crowded-spot-stale computed target stays green within the already approved 2e-6 leaf. No input rounding, fixture retuning, discrete/timer/status tolerance or new numeric field allowance was added.

## Exact scope and preserved implementation

Independently verified 39 changed files: 13 new tactic Rust files, 24 new evidence files and exactly 2 existing hunks (`mod tactics;`, Strategy types visibility). All 13 source-inventory byte/SHA/line entries match actual files and sealed Git blobs; no target path or symlink appears in the seal. Worktree is clean and HEAD exact. Main Tactics, Fight, Kite, World and types hashes remain identical to the initial inspected production cut; repair changes are test-support decoder/replay/comparator/controls and evidence. The original public Fight/Orb/Reflex APIs, source/tools/expectations, World/Sim, protocol/observation, Unity/network, dependencies/lock/status are untouched.

Root's explicit private full-tier Reflex design variance remains accepted for this finite layer because the admitted TierId-only preparer cannot express resolved witness overrides. This is a real source-shaped private class with actual Memory-derived stimuli/feints and old Reflex overlap; no fake/no-reflex or ID alias bypass was found. It grants no blanket future duplicate-engine authority.

The real admitted Memory/Knowledge/path/RNG dependencies and complete classes remain as assessed in the initial review. Typed EmptyWorldRoute occurs at the actual World missing-last-waypoint boundary with preserved pre-error callbacks/state and Undefined result; it does not pre-reject/skip the exceptional source row. Normal fight-empty-path remains separate. Source-private closure state is continuation-bound; unwitnessed source cross-products remain explicit finite limits.

## Actual final receipts

All receipts below are recorded author executions read from the exact sealed evidence, not reviewer reruns. Environment: pinned Rust 1.97.0; locked/offline/jobs1; incremental0; debuginfo0; worktree-local target. Command/cwd/exit provenance is in final-gate-exit-codes.txt and the raw receipt headers.

| Gate / receipt | Actual result |
| --- | --- |
| `cargo test -p rh-policy --lib --offline --locked -j 1 private_tactics -- --nocapture` / repair-private-tactics.log |18PASS/0FAIL,6.00s; main 154/720 parity+recreate, all new controls and compatibility |
| separate compat/source/reader/envelope/decode filters / repair-focused.log |5compat,5source, individual controls/smokes green; overlaps are not added as independent case coverage |
| full rh-policy library / repair-full-regression.log |238PASS/0FAIL,234.41s |
| strict default library/tests Clippy / repair-clippy-default.log |exit0,6.56s |
| strict all-feature library/tests Clippy / repair-clippy-all.log |exit0,0.07s |
| fmt check / repair-fmt.log |exit0 |

Actual main totals remain 154cases/720operations (Tactics118/462, Reflex21/163, Orb8/66, Retreat2/18, Fight3/6, World2/5),9 goals / 4 statuses. Old compatibility remains5 tests exercising timings 90+6 rows; Orb 6 cases/20 rows; direct Fight 1 row; sequential Fight 16 cases/47 rows and real path/draw/stat channels; Reflex 49 cases/68 rows/67 checks with rederived Memory. Corpus totals/outputs are not bypassed by a subset or expected-answer installation.

Whole-commit `git diff --check cdf5b70f^ cdf5b70f` exits2 for a trailing blank at EOF in source_memory_encoder.rs and three raw receipts; it is not claimed green. Root treats this as nonmaterial whitespace, and immutable receipts remain unchanged. The required cargo fmt receipt passes independently.

Original first failures/greens remain. The zero-selection focused filters are now honestly labelled noncoverage in focused-regressions-NOTE.md; the actual full library run supplies the broader recorded coverage. Updated inventory/receipt identities replace the stale pre-repair file table. No further heavy unchanged Memory/source/fullworkspace campaign was necessary for this independent read-only review.

## Sealed byte bindings

| Path below `.../temporal_percept/tactics/` | Bytes | SHA-256 |
| --- | ---: | --- |
| source_tests.rs |38999|`fe04aab922ac15a30ef8d7133e58cf8d50e8b64336c038f247525b8918d56435`|
| source_trace.rs |56524|`d2f5cd80929c73a9be6864e6c67857a76835e68fd7a7ddc1e7d5acd6d70e4a93`|
| source_decode.rs |102379|`20bb5654b5e51ed51d40e2251c412f8da632381cf8cc8e6eef277dc018af7ab7`|
| private_tactics_tests.rs |46786|`75cb5d45516ac27aedbab76c295e9dafc9cafca7ae543026a51f850cf2a78159`|
| compat_tests.rs |74818|`40770fd93c7ee7381074121f90d330277c3855fd781524933e52f7c454c20ca8`|

Final receipt SHA-256: private18 `24be54448a729b55dacb197144ee77132facf5c40dc73532927e1aa00fe336ca`; full238 `4e3c894ff098d5e20b9e153b1d0d0fa07b40e82cf23ae211994d70e5e7607472`; focused `423173113fb164ca50a7d3bcde1c553b3db4e0378732ae2cf8b0d77cf2b09157`; default lint `803f49081c16ac5434ca905fbea83a7f857c6ea60ae5c91b9dcca30c95843361`; all-feature lint `1a742e48955a6ec2179ce0ba951f60971e015ff9bb5b6766895c9ef9fc55aa56`; fmt `cdcfb6053a3cce52901e653bf210c57659ebd7f2bab7c6f2faaa7160a7c8580a`; inventory `0a157e017e3d9552050b2404ddf0127de2f4551aca7047129e86af4587e350b7`.

Source remains exactly the admitted candidate: source 11656923 bytes/SHA256 `5d27d1b4522d386d4ede5f3064a28660dedff43e32a24ade264f4512e30fcfa8`; coverage 1069183 bytes/`b43c64fea6c6da17faaccf578a1e4d6614c96e352f5f951fefafcca95ae68f77`; manifest 37387 bytes/`9f76406016d0ebc498b0a3a3ec7cad677fc43ecd40b530a963a57a7f3d6eb957`.

**Final disposition: RELEASE cdf5b70f for finite complete private Tactics/component consumption.** No remaining concrete admission blocker in this packet. It does not activate Brain, public HumanBot, accepted-frame composition, live/headless driver, protocol/Unity or deployment. Root alone integrates and grants downstream scopes.
