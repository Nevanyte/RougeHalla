# Protocol 6 integration review

Reviewed the current uncommitted root implementation on 2026-11-05, read-only with respect to repository source. Native mob/card/potion leaf changes were not merged into this reviewed snapshot.

**Disposition: accepted for this bounded transport slice. No concrete blocking defect found.** This is not full playable-MVP or native loot admission acceptance.

## Reviewed invariants

- `crates/rh-server/src/room.rs:1046`: reliable State and Events capacity is checked as one batch in `Outbox::push_tick_with_state`; collection baselines and prepared item offers commit only after acceptance. Encode/refusal paths discard the guards. A refused batch accepts no snapshot or FX either.
- `room.rs:535`, `rh-sim/src/item_view.rs:152`: reconnect invalidates old bindings and reliable collection baselines while preserving the monotonic pickup handle cursor. Live input resolves through the seat observer, whose `PublicCommand::resolve` calls the ordinary validator before `Sim::submit`. Missing/expired/unseen pickups become ordinary budgeted misses. Retired offers retain the existing bounded grace.
- `rh-protocol/src/state.rs`, `rh-server/src/wire_state.rs`: live pickup rows carry observer handles, not world container identifiers. Field projection carries no runtime field ID or private source record and consumes the core's already-redacted observation. Keys, order, handles, row counts, finite geometry, body labels and complete frame sizes are checked. Field multiplicity is preserved.
- `RoguehallaNet/Net/Session.cs:311`, `Net/Collections.cs`, `Protocol/State.cs`, JS probe: entire frames decode before collection replacement. Missing keys retain previous values; explicit empty values clear them. Reliable replacements follow socket order independently of snapshot ticks; Welcome clears the previous observer epoch and pending inputs.
- Rust/C#/JS full and delta paths carry effects and displacement, including clears. `Net/SnapshotBuffer.cs:135` prevents interpolation across a displacement sequence change. Local motion already applies accepted authoritative positions immediately, so it does not need a separate displacement smoothing reset.

## Evidence considered

Inspected protocol, server, C# and JS changes plus focused regression source and v6 vector coverage. Existing coordinator logs report server library 83 passed, C# 220 passed, and JS 3,802 checks over 21 server vectors, 61 malformed cases and 9 chains. Protocol test log ends successfully. No duplicate builds, workspace gates, stress or mutation campaign were launched. Browser log was still empty when inspected; no browser completion claim is made here.

## Known integration requirement

Before admitting native loot-bearing live matches, enforce a conservative setup bound covering persistent crates + maximum bodies + all weapon units that can become ground pickups, within the 512 visible-prop bound (and associated applicable State limits). Currently `room.rs:995` fails closed when the observer cannot represent its rows; that is a defensive fallback, not source admission. Check the combined native loot setup before live admission, with a focused boundary/refusal check. This was explicitly pending before review and is not reported as an unexpected defect in the current no-loot live fixtures.

Reward-chest/build keys 4/5 currently send explicit empty replacements and potion counts remain zero. Their real observer producers and Choose/Use commands are still pending native integration; this review does not certify those gameplay paths.
