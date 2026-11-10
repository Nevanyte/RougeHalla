# Complete private Tactics — independent initial admission review

2026-11-10, inspected through10:06UTC. **HOLD the unsealed candidate based on `f252b8697cbff3afcee71711cf33db40c411399a`** in `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-tactics`. This freezes the inspected code/receipt findings while DeepSeek repairs; it is not admission of a later moving file or an exact final commit. Root has accepted and relayed the three bounded HOLD groups below. Root's earlier `wip-findings.md` remains untouched. Reviewer ran no Rust/source tests and contacted no worker/Claude; all implementation/tests remain DeepSeek-authored.

## 1. Real checked apply and meaningful nonadvance

`source_tests.rs:710–723` normal replay resets transcript/environment then calls `runner.execute` directly on predecoded operations; `execute_native` at496 does the same. In contrast, `private_tactics_tests.rs:269–283` calls only `decode_corpus` on a separate raw clone while its fresh probe is never passed to intake. The partial-history test repeats this at496–498, between two independent calls to execute_native. The decode function cannot mutate the held runner, so these snapshots structurally pass even if normal dispatch later mutates before validation. They do not establish the advertised same-entrypoint rejection.

Required repair: one checked decode/apply boundary used by normal replay and the malformed injection on the actual reached runner. Validate the supplied declaration/input before transcript reset, environment replacement, Memory/path/retained-state/RNG mutation; return the intended typed Err rather than panic or merely rejecting another guard. Mutate the same source operation data that ordinary replay consumes, call that same apply boundary, compare before/after, then execute the complete unchanged remaining history and compare its actual transcript with uninterrupted execution. Preserve all154/720 cases/methods; do not replace full validation with an injection-only validator branch.

Current `NativeSnapshot` (`source_tests.rs:474–491`) also records only aggregate suite stats, draw count, path counters, callback count and a boolean “has percept,” plus Memory. Repair snapshots must meaningfully cover the real nested tactic/orb/reflex/retreat/world retained state, actual callback transcript (not only length), path budget/cache/frame state and reached Percept/environment as relevant. Aggregate counters cannot catch changed timers/cache/coordinates or a same-length callback mutation. A direct actual-state encoding/equality and the real continued history are sufficient; no extra source capture or unrelated all-branches matrix is requested.

## 2. Tagged order still bypassed by specialized comparators

The generic `compare_node`/`compare_value` now preserves Obj entry order. Specialized schema paths still iterate expected fields and search actual fields by key, bypassing that order check:

- `source_trace.rs:1008–1095`: outer Intent and tolerated to-point;
- `:1139` onward: act/check result objects;
- `:1261–1313`: each tagged callback/RNG event object;
- `:1384–1421`: paths.walk result object;
- `:1462` onward: root tagged Memory section object.

The tolerant plain-point helper likewise reads x/y by name, without preserving their tagged object order. These are genuine carried MethodValue objects, not serde plain JSON envelopes. Author README says the sole main-corpus exclusion is plain `drawCounts`; the current implementation has more exclusions. Existing permutation controls only reorder nested Memory.self and a callback argument, so they do not catch these boundaries.

Required repair: check carried key sequence/shape at each specialized tagged-object boundary before the existing exact/approved-leaf-tolerant value comparison. Keep plain fixed-schema drawCounts key-set semantics explicitly separate. Add bounded actual comparator/replay permutation controls that keep values identical but reorder representative result/Intent, callback event/result and root Memory/derived-point entries; prove the genuine tagged paths fail and the plain envelope reorder still passes. No source expectation edit, blanket order exclusion or tolerance expansion.

## 3. Geometry whitelist reaches direct declared Hold endpoints

`source_tests.rs:262–264` derives coliseum_spot from any expected why “to the coliseum spot.” `source_trace.rs:1345–1352` consequently tolerates paths.walk argument1 for that whole operation. NUMERICS.md allows this only for an ACTUAL computed pickHoldSpot point; declared endpoints remain bit-exact.

Read-only corpus inspection identifies three already captured counterexamples: `world-arrive-24.001-0` op2, `world-arrive-120.001-800` op2 and `world-arrive-100-799` op2. Each emits that why and calls paths.walk to exactly its declared Hold.at, respectively `(1024.001,760)`, `(1120.001,760)` and `(1100,760)`. The output-Intent comparator has a declared_equal exclusion, but callback argument comparison does not. Tiny corruption of these declared callback coordinates can therefore be accepted inside2e-6, contrary to the approved contract.

Required repair: bind tolerance to actual computed-slot ancestry/source derivation and exclude direct declared endpoints in callbacks as well as outputs. Add a tiny-delta direct-endpoint control through the real callback comparator that must fail; retain a genuine computed geometry positive where approved. Direct endpoints/route waypoints/status/flags/collision boolean/order/RNG/timers stay exact. No new source capture or broad float campaign.

## Useful partial implementation/source evidence retained

The new implementation is the full private layer, not a public Goal/PlayerRef substitute: Tactics owns its shared Fight/Orb/Reflex/Retreat and World state, draws one sudden-death knowledge choice, dispatches all9 goals, handles flee partial resets/leave, world-before-reflex arbitration and lifetime stats. Full Fight/World/Orb/Retreat/Reflex branches are present; no stub/no-reflex or hidden World/Sim input was found in the reviewed production files. Inputs preserve actual source strings, object-shaped route targets and direct-versus-remembered identities. Actual route reconstruction retains the final caller Foe/Container object where the source does so, rather than replacing it with a point.

Real admitted Memory folds observe/noteSent/recordChoice. Actual admitted Knowledge is constructed from the declared seed+3; its known70-draw setup is recorded by an independently seeded probe, while the real unchanged constructor receives its own identically seeded stream. This is a pinned admitted-constructor dependency, not a newly observed instrumented constructor stream. Actual per-case decision draws and real Memory/Knowledge/path callbacks compute returns from inputs; expected outputs are compared afterward, not installed as state. Initial Memory/stats, setup, every captured operation result/Memory/stats/callback/draw/pathStats channel and exact totals are exercised, subject to the comparator/intake defects above.

The typed empty-route boundary is placed at World.nextStep's actual absent last waypoint (`world.rs:506–530`) after the recorded path effects and before Reflex arbitration. It maps the admitted exceptional source TypeError/Undefined to EmptyWorldRoute rather than a panic, skipped case or failed GoalStatus. Normal fight-empty-path remains a separate successful no-path case.

**Root explicitly accepts the full-tier private Reflexes design variance for this finite layer.** Existing `bots::reflex::Reflexes` preparation selects TierParams::by_id from TierId, so it cannot express the resolved witness overrides. Candidate's private Reflexes is real source-derived behavior with actual Memory stimuli/feints and existing68-row/67-check overlap, not a false/no-reflex shortcut. Existing public component is unchanged. This does not grant future blanket duplicate-engine authority.

Frozen main totals remain154 cases/720 methods: Tactics118/462, Reflex21/163, Orb8/66, Retreat2/18, Fight3/6, World2/5;9 goals/4statuses. Direct private state absent from the source's diagnostics is continuation-bound, not a fabricated source getter. The finite source's unisolated branches remain limits; no new coverage is claimed from labels or compile success.

## Actual receipts, identity and scope

Read actual recorded logs, not just README. Private filter16PASS/0FAIL6.59s (5compat+11other/source), separate compat5PASS, source filter5PASS, reader17labels and envelope154/720. Nocapture16PASS14.20s prints main154/720 parity and recreate, compatibility counts and controls. These are valid positive partial evidence; the nonadvance/order claims require the repairs above.

Compatibility tests actually replay the new private implementations with real dependencies: own timings90+6rows; Orb6cases/20rows; direct Fight1row; sequential Fight/Tactics16cases/47rows with full actual path traces/draws/stats; Reflex49cases/68rows/67checks with re-derived Memory. Expectations/corpora remain unchanged. The earlier “hash only” overlap was not accepted and is not used as proof.

Recorded full library236PASS/0FAIL246.84s; strict default/all-feature library/tests Clippy terminate exit0 (0.16/0.19s); fmt records exit0. Some “focused” filters (`bots::paths::`, `bots::knowledge::`, `bots::mob_hunt::`) selected ZERO tests and are not regression proof; the full library receipt includes the actual tests. Do not invent counts for those empty selections. Environment receipts identify Rust1.97.0, locked/offline/jobs1, incremental0/debuginfo0 and worktree-local target. First intake/Module dispatch failures and real source callback/route identity mismatches remain honestly recorded in first-failures.md.

Only existing-file hunks are `+mod tactics;` and Strategy types visibility. New source/evidence stays within the packet. No public/live/World/Sim/protocol/Unity/network/dependency/lock/status change was found. No target/cache may be in a future seal; Root already notified the author. The current unsealed source inventory is stale for source_decode/source_tests/source_trace, so it cannot bind final code receipts by itself. Refresh final bytes/lines/hashes and actual focused post-repair command exits; do not call old receipts exact-final proof. No heavy unchanged Memory rerun is required solely for these harness repairs.

## Inspected-cut pins (not a final seal)

Measured at10:06:12UTC on2026-11-10, HEAD stillf252b869 with uncommitted candidate. Files below identify the inspected HOLD cut even if the author changes them later.

| Path below `crates/rh-policy/src/bots/temporal_percept/` | Bytes | SHA-256 |
| --- | ---: | --- |
| tactics.rs |10587|`6a35ab1de5fb1192e2aeb909af309e70b5d07bf9ad15ed6bd30d1cb0ab33e178`|
| tactics/fight.rs |34271|`0ae967703a6dd2e45d1180dd5dbc20e29c75b25c9cf665fcaa37eadf9558a5da`|
| tactics/kite.rs |24199|`bdc0f2c8e3e3f909f80bfd4f7dfeb8067f218ec5b390c06217661adf266015dd`|
| tactics/world.rs |24500|`3d6e3f3921922a4d6faa34d2bd656e63126ab499865474a70505f214ade62014`|
| tactics/types.rs |24559|`b2b01a2e818970dd883aede6fc0450bf1232c1353a3a02cdcce70361131b30be`|
| tactics/source_tests.rs |35660|`88be881261d5e21a9c292b0bd15ff241e3a062e064eeb3abc8e988622c7e95f4`|
| tactics/private_tactics_tests.rs |25742|`fa86e22b7fa4ba395482c3782af252b635d2a35b02c63839c09a1f112205294a`|
| tactics/source_trace.rs |55666|`85f656ac09064636866497d612039d5b11acfe04b678b5f246d93b5d5d35888f`|
| tactics/source_decode.rs |102739|`e78eeb5cfdaee3b2375a2a2aac593eda60f2d92afe187a4b66947068db3a8dbf`|
| tactics/source_strict.rs |91831|`e2129702c4da9882f2efaf14e77263787bafc99f59e4291eee3e0aa4481f4e81`|
| tactics/compat_tests.rs |74001|`1b290934843bed177f9475a4f663f236c099216f70e932d1284ed2fadafc9da0`|

Actual receipt SHA-256 at this cut: tactics-tests-final `dc38932c5d45f35ab497890a73846df229b0c14d8258656e44c664f94063185b`; nocapture `f021b8eb5fbe6ad98e6de4e87b500aa330c8564b66541d40cb110ea6a39404ed`; full library `5cbb2e801349ebd5e546932d2811543c98d2835356a55038cbbde328d3ae7cbf`; default lint `a315ebfadf5ff62c9ac6149b10c39f885d7e357c12f5d044128f2ba0dacdc4ed`; all-feature lint `9b46935ed9cd03fb6afe7c975ce8f1508fd487c3519c8fe967f9f678d42aab74`; fmt `7a418823969f07eaa7d905d46ef5957f81965170afae0fc3ca1beab7223c1d35`; source inventory `3dbfae916663112ecce7fae050afaa8f9497724a837b43283132cc6f3e33cec5`.

Immutable source SHA-256 remains `5d27d1b4522d386d4ede5f3064a28660dedff43e32a24ade264f4512e30fcfa8` (11656923bytes), coverage `b43c64fea6c6da17faaccf578a1e4d6614c96e352f5f951fefafcca95ae68f77` (1069183bytes), manifest `9f76406016d0ebc498b0a3a3ec7cad677fc43ecd40b530a963a57a7f3d6eb957` (37387bytes), matching released source admission. Neither source nor old compatibility expectations may be retuned to fix these holds.

**Disposition: HOLD the three concrete groups above.** After their bounded repair, inspect the exact new seal and refreshed source/private/compat/control/fmt/default/all-lint receipts, retaining prior greens/failures honestly. No source recapture or full workspace/hash campaign is requested. Full Brain still waits for actual Tactics native admission; this review grants no live or public activation.
