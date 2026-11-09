# Sentenced NPC -> Holy human native source consumer

Base private uniondd1b19d158a2360313a908c6900a4f004f3622d1. Only cfg(test) systems/sentenced/group_source_tests.rs and this new evidence change. Production, source tools/corpora, headers/content/tapes, status and Cargo.lock remain unchanged. No unexpected native/source discrepancy was observed and no engine fix was made.

The existing real adapter now consumes corrected source-seam-a-holy.json's two cases: Sentenced camp20 sword NPC mob3i and camp17 bow NPC mob36 own a singleton fighter:p1 Mark on the Holy human. Exact native actor birth provenance, regional kind, typed faction/weapon/camp and source direction are asserted. NPC target/group/tier/hits/progress are actual runtime fields, and the Holy human has groupNone/tier0/hits0/progress0. Its shared combat focus may still be nonempty; that is not fabricated Mark ownership. Ordinary queued attacks wake real AI and produce the Mark/pulse state. No outcome is installed.

The orthogonal optional Holy-NPC recipient corpus is also consumed through the same adapter: real Holy sword/wand NPCs are targets of Sentenced player-owned camp Marks while those Holy NPCs own no Mark. This does not substitute recipient-side evidence for corrected seamA.

The existing scenario constructor/script replay, source positions/hp/loadouts, actor birth labels and runtime ledger/event collection are reused. Player setup remains trusted source-declared setup; there is no new pickup/account acquisition claim. Source base36 NPC birth serials map through retained ActorOrigin, and native zero-based regional camp IDs map to source one-based camp labels. Role checks name actual captured Sword/Bow/Wand, without changing catalog facts or computing substitute formulas. No duplicate engine or new restore bypass is introduced; the existing closed-profile constructor/continuation scope remains exactly as documented in group_source_tests.rs.

Every source sparse snapshot and complete intervening Mark pulse/landed event tape is compared by the old adapter. Object keys, array length/order, identities, typed codes, status and flags remain strict. Discrete groupSize/tier/hits/swaps/camp values now require exact nonnegative integer comparison, without converting u64 through f64. Two rejection tests cover adjacent integers above2^53 and a fractional count inside the continuous tolerance. Source-rounded continuous coordinates/HP/progress/raw amounts retain the existing1e-6 absolute tolerance; time and entity-counter identity remain exact. No metadata-only assertion is used as a replacement for native replay.

Final focused run passes8/8: original6 cases/16snapshots, supplement2/15, correctedA2/6 and optional Holy recipients2/6, plus constructor/training and precision checks. That is12 source cases and43 snapshots; the four newly consumed cases add400 actual native steps. This is sparse-state plus complete selected tapes, not whole-world hash equality, full event equivalence or a new Full-profile restore proof.

A single bounded compiled consumer-output mutant forces NPC projected tier0 while leaving the engine and sources unchanged. The exact correctedA test executes and fails at mob3i signature/tier (0 versus source3), exit101 after successful compilation. Exact control bytes are restored and all8 focused tests pass. This is a consumer-sensitivity negative, not a new source/kernel producer mutant; no category is inflated. Control/mutant/log hashes are in checks.json.

Strict `cargo clippy -p rh-sim --lib --tests -- -D warnings` and workspace formatting pass. No source capture, broad map/workspace campaign, gameplay edit, identity bump, public/headless/codec/UI/browser/Editor/cloud gate ran. All four input corpora remain exact base bytes with their established hashes, recorded in checks.json. No expected values or source pins were changed.

Reproduce using final-env.sh and an isolated target:

```sh
cargo test -p rh-sim systems::sentenced::group_source_tests:: --lib -- --test-threads=1
cargo clippy -p rh-sim --lib --tests -- -D warnings
cargo fmt --all --check
```

Still open: Return/leash source transition, actual source swap and multi-owner tier-four/deferred-order distinctions, and broader native/public/Full/restore acceptance. The completed two directions and their component facts do not close those independent domains. Root owns the final coordinated identities and admission.
