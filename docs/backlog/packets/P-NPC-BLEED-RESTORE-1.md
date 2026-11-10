# P-NPC-BLEED-RESTORE-1: accept earned Hemorrhage bleed on regional NPC restore

## Outcome and dispatch status

**Root dispatched, 2026-11-10.** Narrowly extend regional mob checkpoint validation to accept the existing Hemorrhage status that the real Card producer earns on an NPC. This is a checkpoint-reader compatibility repair only. It does not change combat, status shape, tick arithmetic, Card report behavior, numeric admission, or the public privacy contract. All Rust and tests belong to DeepSeek within the exact lease below; Root owns dispatch and compatibility/content decisions.

The motivating reached path is documented by the three native probes integrated at `97b70395` and reviewed in [card-bleed numeric options](../../evidence/card-bleed-probe-review/numeric-options.md): a normal Sim grants Hemorrhage, accepts validated Attack/Release input through `validate` + `Sim::submit`, earns a live regional NPC bleed, then the checkpoint reader returns `unsupported mob status domain`.

Root assigns the existing Card Design Probes worker on `codex/deepseek-npc-bleed-restore`, at the isolated private probe checkout, starting from exact `3568294d` (production base `36564c33`, plus probe evidence) and the documentation transfer. The approved compatibility decision preserves all current identities for this predicate-only acceptance repair, subject to independent verification of the stated no-state/no-step-change condition. Implementation includes checking the actual produced status/clock/provenance shape; this is work to perform within the lease, not a further permission gate. Report only a concrete required scope expansion. Claude primary was clean at `3af092cb`, with zero diff in the proposed validator/producer paths relative to `4151b3af`.

## Source and current reader boundary

The unchanged legacy source witness `parity/card-runtime/source.json::onhit-bleed-physical` covers the earned physical Hemorrhage path over 93 ordinary steps, but targets a player Combatant. It does not prove an NPC checkpoint reader path. The native probe supplies the NPC producer witness; neither source artifact nor probe authorizes fabricated or directly installed status rows.

In `crates/rh-sim/src/systems/mob_checkpoint.rs`, the regional reader currently rejects `statuses.cast` and any player-only kind, and permits `Dot` only when Full abilities are enabled and `abilities::checkpoint::blaze_dot(w, s)` accepts it. Generic `status_runtime::validate` and known-actor provenance checks run afterward. Preserve the existing Blaze predicate, generic validation, and known-actor check.

The real producer in `crates/rh-sim/src/cards/on_hit.rs` submits a Dot apply request with `ability: None`, a text tag formatted as `bleed:{tick}`, the Hemorrhage row's 2000 ms duration, `StatusApply.value: None`, a producer-computed `AddValue`, and physical-only shares `(1, 0, 0)` with other payload fields defaulted. `status_runtime::mutation` materializes a `StatusInstance` and computes its persisted `value` from that `AddValue`; the final probe observed a finite stored value. Do not mistake the absent apply-request base value for an absent stored scalar. The restore rule must be tied to the actual persisted producer shape, not to arbitrary generic Dots.

## Narrow admission rule

Add one narrow predicate beside the current Blaze exception. It should accept only a status whose immutable fields match the actual Hemorrhage producer output, after inspecting a real probe-produced checkpoint/status and the current checkpoint time domain. At minimum the candidate is `Dot`, `ability == None`, canonical text tag `bleed:{tick}`, a finite producer-derived persisted `StatusInstance.value`, physical-only shares, default remaining payload fields, and a retained known player source with the producer's owner semantics. Keep generic status/time validation and known-actor validation authoritative. Do not introduce a new magnitude cap or compare against an invented expected scalar; the existing generic validator remains responsible for finiteness.

Before freezing exact field comparisons, compare the accepted status's start/end/remaining times and tag tick against the producer and checkpoint clock. Enforce source-proven relationships only. Do not assume that a tag tick equals an independently represented clock field unless the producer establishes that invariant. Do not add a current-expiry condition beyond the existing generic validator, or require the source to be currently present, alive, standing, or still to own Hemorrhage. Preserve whatever retained-status timing and departed-actor history the existing generic validation/provenance rules permit.

Do not admit arbitrary `Dot` values, generic sourceless NPC Dots, other tags, other payloads/shares, player-only kinds, unknown actors, or statuses whose source shape is not the real Card producer. Do not broaden a generic status validator, add a magnitude/count cap, alter the Hemorrhage producer, or couple checkpoint admission to Card report storage/projection. The Card numeric B3 decision is separate.

## Required regression and controls

Use an ordinary source-produced trajectory and real checkpoint APIs:

1. Construct the normal Sim and prove its baseline checkpoint round-trips.
2. Grant Hemorrhage through the ordinary setup path. Submit validated physical Attack and Release actions through `validate` and `Sim::submit`, step at ordinary 50 ms cadence, and verify the surviving regional NPC has the actual producer-earned status. Do not call `on_hit`, hand-install a `StatusApply`, or seed a checkpoint with an expected answer.
3. Checkpoint and restore after the hit. Continue original, clone and restored simulations with the same remaining ordinary steps/inputs; compare the full relevant state, status history, hashes/checkpoints and events under existing native equality rules. Include a source-departure case if it can be reached through ordinary lifecycle actions, and verify restore uses retained known-actor history rather than current presence.
4. Keep negative controls that reach the status-domain predicate: generic NPC Dot, wrong/noncanonical tag, wrong ability, source kind/identity not established by producer, wrong shares or nondefault payload. Also show the existing Blaze exception still works and malformed generic times/values remain rejected by `status_runtime::validate`.

A negative control rejected earlier by generic validation does not count as proof of the narrow predicate. Preserve the actual before/after checkpoint and continuation comparisons. Do not claim broader NPC status parity than the tested producer shape.

## Compatibility and ownership

Root's compatibility decision is conditional: if the patch only broadens checkpoint acceptance to this already-produced valid state, with no stored shape, step, arithmetic or hash change, preserve versions/content. An independent reviewer must verify that condition against the exact diff and checkpoint/hash tests. Report any actual stored-state, hash, arithmetic, replay or accepted-domain semantic change beyond the explicitly approved additional acceptance of this already-produced valid NPC bleed to Root before dispatch. Do not infer that no version/content change is required from this packet alone.

This packet does not allocate any Card report/index, event, projector or source work. The exclusive implementation/evidence paths are `crates/rh-sim/src/systems/mob_checkpoint.rs` (only the narrow helper/predicate plus `cfg(test)` registration), new `crates/rh-sim/src/systems/mob_checkpoint/bleed_tests.rs`, and new `docs/evidence/npc-bleed-restore/**`. No production module registration elsewhere is needed. Existing Card feedback work, generic status validation, `cards/on_hit.rs`, shared status, versions/content tables, source fixtures/tools, Claude networking/Unity work and all other gameplay remain protected.

## Scoped validation and delivery

Run the new separately selectable actual trajectory, continuation and malformed-shape controls; the existing relevant Blaze and generic checkpoint overlap; the unchanged applicable card source consumer; format and strict scoped default/all-feature lint. Record exact commands, cwd, flags, toolchain query timing, exit codes, and first failures as execution happens. No source recapture, golden/tape recorder, all-serialized-leaf sweep or full-workspace run is required for this predicate-only repair. A real behavioral discrepancy requires a separately allocated repair. Deliver a clean code/evidence seal for independent review, preserving original/Clone/restore comparisons privately and publishing only sanitized facts.
