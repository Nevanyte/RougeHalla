# P-CARD-BLEED-FEEDBACK-1: grouped card DoT hit feedback

## ID and outcome

Implement the source `cardHooks.afterDamage` grouped feedback for card-owned DoT, including its 500 ms flush and final
run-end flush. Bleed damage/status application already exists; this packet ports only the missing feedback accumulator
and emission. The source event carries `weapon: null`; Rust's `Event::Hit` has compatible payload fields, but its delayed
observer-eligibility behavior is not yet proven compatible. Do not select an accumulator/event representation until Sol
has reviewed source and native temporal visibility semantics.

This packet is **planned, not dispatched**. Root must review the state identity and source-capture plan before assigning
implementation to DeepSeek. The proposed `state.rs` and `schedule.rs` leases may overlap Claude's active hitbox/crash
packet; root must reconcile those file scopes first. Do not reserve or edit these shared files until the leases are disjoint.

## Dependencies

- Existing card runtime and DoT landed-hit path (`LandedHit.dot`).
- `Event::Hit` / `SeenEvent::Hit` / `WireFx::Hit` have similar payload fields (optional source, no weapon, amount and
  passive bit), but this does not establish safe delayed publication or equivalent visibility timing.
- Source behavior must first be captured in a new immutable fixture corpus. Existing card-runtime fixtures do not establish
periodic flush, ordered grouping and run-end semantics as one bounded source witness.
- Delayed grouped feedback must preserve per-contribution visibility eligibility at the original hit time under C-OBS and
  temporal reporting rules, rather than re-evaluating attacker visibility when the 500 ms batch flushes. Sol must inspect
  source event delivery plus `FxProjector`, `fx_report`, actor-reference and publication ownership before the source/event
  shape is selected.
- Adding accumulated report state to `World` changes serialized and hashed simulation state. Root must decide required
  checkpoint/replay/content identity treatment before code implementation. `Cargo.lock` is out of scope.

## Relevant legacy paths (verified)

- `packages/server/src/sim/cardHooks.ts:270-334`: `BleedReport`, first-use `since`, pair grouping, `flushBleeds`, and
  periodic check in `afterDamage`.
- `packages/server/src/sim/cardHooks.ts:40-51`: `flushBleeds` is chained to `runEnded`.
- `packages/shared/src/signatures.ts:47,53`: `DOT_FX_MS = 500`; card DoT reports are emitted in chunks.
- `packages/server/src/sim/onHit.ts`: Hemorrhage creates card bleed status; damage itself is already implemented.
- Source capture inputs must use the actual Card Runtime runner and ordinary fixed-step world path; do not install an
  expected pending report or invoke `flushBleeds` directly as proof.

## Current Rust seam

- `crates/rh-sim/src/systems/signatures.rs:18-29`: `LandedHit` exposes `dot`, `ability`, `sig`, `victim`, optional `by`,
  and `amount`; `crates/rh-sim/src/cards/after_damage.rs` runs after the ledger and currently has no cross-tick DoT report.
- `crates/rh-sim/src/schedule.rs:1185-1187`: `cardHooks.afterDamage` is the existing card pass. Place periodic aggregation
  at the source-equivalent point after card hit classification, preserving order relative to stillness and other card work.
- `crates/rh-sim/src/schedule.rs:1692-1697`: the `cardHooks.flushBleeds` run-end link is explicitly pending.
- `crates/rh-sim/src/state.rs:836-840`: `World` is checkpointed and hashed evolving state. A cross-step accumulator cannot live only in
  `TickScratch`; restore/replay must preserve the next visible flush.
- `crates/rh-sim/src/events.rs:150-156,255,309-313`, `crates/rh-sim/src/observe.rs:314-325`,
  `crates/rh-protocol/src/lib.rs:656-661`, `crates/rh-server/src/wire.rs:1243-1264`: candidate `Hit` payload and current
  wire mapping. The event path uses visibility at projection time; Sol must establish how source preserves visibility for
  delayed emissions and whether native `fx_report` can preserve per-contribution eligibility. Verify passive mapping too.

## Source-capture ownership and privacy gate

Sol/Luna own TypeScript source inspection, new capture tool and corpus; DeepSeek Rust must not edit `packages/**`, source
tools, or the sealed fixture. Before selecting native storage/publication, Sol reviews:

- whether the legacy delayed FX records recipients/eligible observers when each DoT contribution lands or tests visibility
  only at flush time;
- whether eligibility is per hit contribution or per aggregated pair, including a viewer who sees the attacker only for
  part of the 500 ms interval;
- whether existing native `fx_report`/`FxProjector` can carry that timing without modifying `Event`, observation, or wire;
- source equivalence for source-hidden-at-hit/source-visible-at-flush and source-visible-at-hit/source-hidden-at-flush,
  using actual World steps and observer views.

If exact privacy requires an event/publication/decoder change, return the bounded required design to root and stop this
packet. Do not emit the aggregate through generic `Event::Hit` merely because its fields fit.

## New paths

- `tools/card-bleed-fixtures/**`: Sol/Luna-owned pinned actual-source capture tool/config and controls.
- `parity/card-bleed/source.json`: Sol/Luna-owned new, separately versioned corpus; leave existing
  `parity/card-runtime/**` byte-identical.
- `crates/rh-sim/src/systems/card_bleed_feedback.rs`: bounded report state and periodic/run-end emission logic.
- Focused native source-consumer tests in a new adjacent test module, plus its `#[cfg(test)]` declaration.
- `docs/evidence/card-bleed-feedback/`: raw source/native command receipts, source pins, corpus bytes/hash and explicit limits.

## Exclusive write scope

Sol/Luna source-capture scope:

- New `tools/card-bleed-fixtures/**`, `parity/card-bleed/source.json`, and the source/corpus review receipt only.
- No Rust implementation.

DeepSeek Rust scope, only after source privacy review and root dispatch:

- New `crates/rh-sim/src/systems/card_bleed_feedback.rs` and its focused test module.
- The required module declaration in `crates/rh-sim/src/systems/mod.rs`.
- Narrow connection to the existing card pass in `crates/rh-sim/src/cards/after_damage.rs`.
- `crates/rh-sim/src/state.rs` for deterministic serialized report state and its default construction.
- `crates/rh-sim/src/schedule.rs` only to replace the pending run-end link at its current position.
- `crates/rh-sim/tests/hash_coverage.rs` and only any checkpoint refusal/validation test required by a report-state invariant.
- New native test receipts in `docs/evidence/card-bleed-feedback/**`; do not rewrite Sol/Luna's source witness.

No edits to `packages/**`, existing parity corpora, `Cargo.lock`, protocol/decoder/client files, observation schemas, shared
status records, or unrelated card mechanics. If correct behavior requires changing `Event`, `SeenEvent`, `WireFx`, its
visibility, or public observation, stop and return the exact need for root/Claude coordination.

## Contracts and references

`C-TICK`, `C-DET`, `C-NUM`, `C-PARITY`, `C-OBS`, `C-RNG`; `docs/sweep/PACKAGES.md`; ADR 0007, 0009 and 0013; P-CARDS-1.
Preserve source order and deterministic numerics. No clock or entropy in `rh-sim`; use `World.server_time` and fixed 20 Hz
steps. Private aggregation data never appears in Observation, snapshots, events or public exports. Only the permitted
recipient-filtered FX can be published, with the source-time visibility eligibility preserved per contribution. Every
serialized leaf must affect the state hash and receive hash-coverage proof; validate any chosen invariant in `check_world`
with a refusal test. Preserve zero-allocation-per-step.

## Behaviour to preserve

- Report only `LandedHit` rows matching the legacy predicate: card-owned DoT (`dot === true`, no ability and no signature).
  Do not group faction/ability DoT into this card report.
- The first eligible hit initializes the report clock from current `server_time`. Group amount by ordered `(victim, source)`
  pair, adding later hits to the existing row without changing its insertion position. Preserve optional source semantics.
- At `now - since >= DOT_FX_MS` (500 ms), emit one hit feedback per pair in insertion order, clear rows, and set `since=now`.
  A report object with no rows produces no FX. No report is created when no eligible card DoT has landed.
- `runEnded` flushes all remaining rows in insertion order, then clears them and resets the report time as source does.
  Teleport does not flush or clear this report; source only clears the other pending block/deferred queues there.
- Preserve viewer eligibility from each contribution's original hit tick, victim/source visibility and source event order;
  never recompute an aggregate audience at the later flush without evidence that source does so. Preserve per-tick ordering
  at the source-equivalent `afterDamage` location. Existing hit wire representation is conditional on the privacy review;
  if it cannot carry correct eligibility, stop before wire/Unity changes.

## Acceptance checks

1. Freeze actual unchanged-source cases for: multiple hits for one pair, multiple ordered pairs, repeat pair without
   reordering, exact 500 ms and greater-than-500 ms boundaries, first-hit clock initialization, empty periodic flush,
   run-end flush before 500 ms, empty run-end, and non-card DoT/ability/signature exclusion. Include a normal control with
   no card DoT; ensure fixture reaches genuine card bleed damage.
2. The source semantic mutation replacing pair grouping with one row per hit must fail the captured result. A control with
   an altered threshold or skipped run-end flush must also fail. Keep the original corpus immutable and prove the new
   capture `--check` is byte-identical.
3. Native consumer drives the actual captured inputs through `validate` + `Sim::submit` and ordinary 50 ms steps, reaches
   periodic and run-end flushes through their normal producer/schedule, and compares exact ordered hit feedback including
   tick, victim, optional source, amount, recipient eligibility and passive semantics. Do not preinstall report state or
   call the flush helper directly.
4. Check teleports retain accumulated rows, report clear/reset behavior after flush, restore/checkpoint continuation
   across a partially accumulated interval, state-hash leaf coverage, malformed report-state refusal if applicable, and
   no observation/privacy leak. Keep source and native identity decision explicit in the handoff.
5. Focused `rh-sim` card source tests, checkpoint/hash coverage, schedule classification, strict Clippy and format pass on
   the exact base. Root separately runs integration and decides the state identity admission. Do not claim a wire/protocol
   change or client visual acceptance.

## Validation commands

Use the existing card-runtime capture tool patterns and add a focused source `--check` command in this packet. Rust:

```text
cargo test -p rh-sim --all-features --lib card_bleed_feedback -- --test-threads=1
cargo test -p rh-sim --all-features --test hash_coverage -- --test-threads=1
cargo test -p rh-sim --all-features --lib schedule -- --test-threads=1
cargo clippy -p rh-sim --all-targets --all-features -- -D warnings
cargo fmt --all -- --check
```

Do not run a workspace suite for the isolated packet unless root asks. Use an owned private Cargo target, jobs 1, offline
locked inputs, and retain both failed and passing command receipts. Root runs integration gates after admission.

## Risk and suggested model tier

Medium. The accumulator is bounded by actual actor/source pair count but becomes serialized authoritative state, which
changes deterministic state hashes and restore behavior. Review ordering, restore, sourceless credit and the passive bit
carefully. Use a strong Rust implementer plus independent source and state-hash review.

## Known traps

- Do not mistake missing card FX for missing bleed damage; the native damage/status path already exists.
- Source uses a JavaScript `Map`: preserve first-insertion order for grouped pairs, not sorted IDs or unordered hash iteration.
- Do not use `TickScratch` for cross-tick state. A checkpoint mid-interval must emit the same later FX as uninterrupted play.
- `Event::Hit` accepts optional source and weapon, but current projection may evaluate `r.sees` at the later event tick.
  Source-time observer eligibility and `fx_report` ownership are unresolved; Sol's review is a prerequisite. Verify passive
  flag, wire output and ordering against captured behavior. No wire change is assigned.
- `DOT_FX_MS` starts when the first card bleed report is created, not necessarily at raid start; a periodic flush resets
  the interval to the flush time.
- Do not flush on teleport or clear rows on a normal run-end path before the registered hook; the legacy report survives
  teleport and is flushed on `runEnded`.
- Adding `World` state changes checkpoint/hash identity. Root chooses and records compatibility handling; the worker must
  not preemptively edit version/status files.
- No ML, learned report behavior, datasets, bindings or inference services.
