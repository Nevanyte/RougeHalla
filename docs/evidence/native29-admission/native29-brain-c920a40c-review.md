# Native29 NPC brain role-bound identity review

Verdict: finite test-only correction PASS; final native29 admission/composition remains Root-owned.

Base `068faf69275956fa573d335baf52579072d488a2`; committed `c920a40cf038002c0d53d076b1992e71d5bd1cd4` on Root's `codex/native29-prerequisites` in protocol14-client-union/repo. Clean after commit. Exactly `crates/rh-sim/tests/hash_coverage.rs` changed: 71 additions, no removals. No production/schema/config/source-fixture/status/lockfile changes.

## Diagnosis and exact classification

The original optional-completeness wording did not distinguish a missing Some example from an actor-role-bound Option. Existing `mob_audit_states` already constructs admitted MobMode::Pve worlds on the source-backed map, consumes the fixture's real validated Target commands, and ordinarily advances through birth/wake/attack and camp clear. Both actual NPC states were already in the generic corpus. An additional PvE constructor would not solve the gap.

`crates/rh-sim/src/checkpoint.rs:285–291` requires `brain.is_some()` exactly for non-zombie Regional/Practice actors; removing the actual brain or assigning one to a Training dummy fails `actor brain capability mismatch`. `systems/mob_checkpoint.rs:376–400` separately requires the regional brain and validates clocks/target/threat/mode. The producer fields remain the actual Brain in `mob_runtime.rs:397–407`; no brain installed as earned state.

Only the exact `world.mobs.*.brain` VALIDATED row was added, documenting this presence/actor-class coupling. No subtree is skipped from hashing, no nested scalar exception was added, and every restore-valid edit must still change identity. Existing nested brain leaf auditing is unchanged. Root explicitly approved reusing the existing genuine PvE producer rather than adding a redundant constructor.

## Focused control

`native29_real_pve_brain_roundtrips_and_role_presence_is_validated` PASS (1 test,9 filtered):

- Both actual engaged and cleared states restore/clone hash-exact and contain object brains.
- Engaged state has an actual selected target, pending NPC weapon action, movement goal, and nonempty threat history.
- Removing an actual regional brain is refused with exact capability error.
- Assigning that brain to an actual Training dummy is refused with the same capability error. This assignment is a negative validation control, not a produced state.
- A clearly labelled counterfactual nested `moving` boolean flip is restore-valid and changes state hash; it is not presented as a produced decision.

## Sole full generic rerun

`cargo test --locked -p rh-sim --test hash_coverage every_serialized_leaf_of_a_match_changes_the_state_hash -- --exact --nocapture`: **1 PASS / 0 FAIL /9 filtered**, **315.69s**. All 39 scenario reports are retained. Aggregate: **123446 leaves;85214 hash-changing perturbations;0 unhashed**. Optional completeness: **71 patterns with actual Some values;57 exact restore-validated optional patterns**. All existing independent accepted-change requirements passed.

Original full generic red receipt `hash-roster-bounded-first.log` remains byte-identical at its original location:316.82s, every visited scenario0unhashed, final completeness failure only `world.mobs.*.brain`. No silent rerun-as-pass: this receipt is bound separately from the corrected run. Previous checkpoint6PASS/replay6PASS/seven prior hash cases were preserved, not rerun. Root's solo-roster probe correction and actual solo Training None/false/true worlds were left unchanged.

One-file rustfmt and git diff --check PASS. No workspace/content/golden/tape/Editor/capture/clippy checks or claims. Existing final-env, final-target, jobs1/incremental0/dev+test debug0; checks sequential. Raw logs and patch byte sizes/SHA256s, including original red, are sealed in `native29-brain-role-2026-11-09/manifest.json`.

All owned sessions completed; final-target lease RELEASED. No push/merge. Root owns subsequent final identity gate and release decisions.
