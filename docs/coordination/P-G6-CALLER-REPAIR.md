# P-G6-CALLER-REPAIR: prove the real heal callers and feature build

Lead repair assignment for the original G6 worker on its existing isolated branch/worktree at `b50871d1`.
Keep the independent Frost worker running. No primary/managed/other-worker edits. G6 remains private and its publication
gate stays held; this repairs required native evidence, not a new scope reduction or live activation.

## Findings to resolve

The grant/expiry code appears source-faithful, but schedule/unit/helper calls do not establish actual caller timing.
The discarded real lifesteal mismatch (source17.97 versus native0) has a concrete harness problem: capture installs
`createGameWorld(...,{signatures})` and records the true flag in input.signatures, while input.config retains constant
signatures:false and native sim_for reads only that config. Do not infer a combat bug from that unmatched profile, or
turn Full factions on with the existing mobs-enabled map and remove the unsupported NPC gate.

Use a genuine player-only/no-mobs world in the already admitted full-player faction domain. Explicitly record and bind
the actual module/config profile. Grant Second Skin and lifesteal cards normally or use the existing real faction
producer, then land attacks through normal input validation. Compare damage, lifesteal/heal, barrier grant/deadline and
the SAME-TICK post-ledger decay with actual source. Record any declared initial placement/wounded setup; never install
expected post-hit HP, lifesteal or barrier output. Preserve all ten existing source corpus bytes and old source values.

Also prove a real caller AFTER the buffs slot (such as the actually installed potion/terrain path), with no decay on
that grant tick and decay next tick. Use the real installed module and command, not a direct between-tick heal helper.
Cover actual anti-heal status application, scaling both HP gain and barrier, not just supplied healTaken. If no shipped
ordinary action produces that status, a labelled trusted setup through the REAL generic status-application API is
acceptable; do not fabricate a new card/ability or claim it is an ordinary actor producer.

## Write scope and controls

Add a separate source caller tool/corpus under `tools/heal-barrier-callers/**` and `parity/heal-barrier-callers/**`, plus
dedicated native consumer/tests and evidence. Do not rewrite old capture tools/goldens merely to change their self hashes.
Necessary G6 test-module wiring and exact fixture-profile binding are in scope. Production gameplay changes require
an actual diagnosed mismatch and lead review; do not hide it with injected outcomes or changed expected values.

The lead explicitly authorizes the disclosed one-line StatView addition in
`crates/rh-parity/src/bin/status_probe/boundary_v3.rs`, using the existing folded heal_barrier source matching runtime,
and its focused all-feature gate. Do not broadly default unrelated fields or change the fold. Correct the stale heal.rs
module header claiming the newly implemented producer is pending. Shared statuses/Cargo.lock remain read-only.

Pinned actual-source byte check, dependency/tool/image/source hashes and compiled semantic mutants remain required.
The new caller consumer must detect missing lifesteal grant, missing anti-heal scaling and wrong before/after-slot
timing by actual output mismatches; a schedule-table assertion or compile error alone is not a caller mutant kill.
Restore controls. Run focused old+new G6 cases, strict predecessor format/refusal tests, relevant warmed allocation and
both affected strict lint modes; demonstrate `rh-parity --test schedule --all-features` now compiles/passes. Do not
repeat unchanged full map/workspace campaigns. Retain all failed attempts with truthful labels.

Deliver a clean reviewable continuation from b50871d1 with exact base/head, files, profile/corpus/tool hashes, commands/
results and remaining publication/composition limits in the existing deepseek-rust report. Success is the complete real
caller evidence and repaired feature build; failure/hold is an unresolved caller divergence, mismatched module profile,
synthetic installed outcome, broadened NPC admission or modified old expected source bytes.
