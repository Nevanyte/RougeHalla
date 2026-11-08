# Checked native barrier candidate

Private branch `codex/barrier-observation18`, immutable base
`d4d15a25cc628b2903d83e954d45c4a34e5e518d`, implementing P-BARRIER-OBS-1. This is the
native Observation18 slice of the lead's private ADR0022 union; policy interface13 stays unchanged.
No protocol, G6 gameplay/state, checkpoint/replay/content identity, schedule, dependency, old fixture,
shared status, main branch or live profile is changed.

## Implemented facts and failure boundary

Owner HP/maxHP/barrier are checked source-f32 values widened to f64. PublicPlayer adds the same
barrier while retaining its existing privileged raw HP/maxHP semantics. Player bar shares use the
source positive guards, max(maxHP,positive HP+positive barrier) denominator, twentieth rounding and
positive sliver. NPC HP uses frounded values and twentieths, with barrier/ring0. Human ring steps use
source-f32 barrier and ORIGINAL f64 maxHP, independently of the combined bar fractions.

The numeric domain requires finite HP/maxHP and finite cast results, plus nonnegative barrier.
Finite negative/zero HP/maxHP retain source guards. Signed zero and underflow survive; slightly
above f32::MAX values that round to finite max are admitted. There is no current-maxHP barrier cap
or sum<=100% restriction. Independently rounded shares may sum to105%.

Numeric checks occur only on owner construction and inside successful player/NPC visibility
branches. `OfferError::UnrepresentablePublicVitals` carries no private identity/value. ItemObserver
propagates refusal before reward/actor-reference staging and commit. Its reusable output remains
unspecified on Err and is never a substitute observation.

Checked APIs: `try_observe`, `try_observe_into`, `try_observe_into_cached`, `try_public_snapshot`.
Existing infallible APIs are documented trusted wrappers. Publisher preview frames now refuse
without panic, partial important/Fx output or consuming carry; prepared Room already propagates the
same error before outbox/collection/offer commit. Existing queued intent is not retroactively revoked.
FxProjector is unchanged. Policy direct/queued and async preparation, headless external observation,
checkpoint entry and checked step continue through persistent checked ItemObservers.

`OutcomeDigest::try_tick` rejects before modifying the private fingerprint and folds nonzero public
barrier; its old method is a documented trusted wrapper. Wirebench/parity-bench use the checked
fingerprint and exit with a diagnostic on refusal. Parity vision comparison reports a checked view
failure. Declared scalebench/default-generated match diagnostics retain trusted wrappers. Digest
values can change when newly public barrier or changed NPC HP shares differ; no old source payload
or derived tape was regenerated here.

## Validation

168 focused tests pass, none failed/ignored (commands/groups in checks.json): observation/privacy,
ItemObserver, actor-reference and projectile preparation; policy; headless checked failure/recovery,
async/direct refusal, digest atomicity, existing replay/item/status/projectile flows; wire, publish and
snapshot-delta checks. Existing timer/cast event behavior is unchanged.

The new warmed seeded-barrier test reports zero heap blocks over200 steps/observations for an owner
and visible player with persistent observers/reused buffers. Existing ordinary all-five Wish casts,
steady-step and status allocation gates pass. These are allocation checks, not new Wish implementation
or genuine G6 producer proof. NPC projection/zero behavior has a separate actual training-setup test.

Both affected strict Clippy modes (default and all-features, all-targets, locked), formatting and the
content registry's registration test pass. No map campaign/full workspace gate was run.

Three compiled native semantic mutations fail with exit101, then the restored8-test barrier control
passes: frounded ring maxHP (ring2 instead of1), omitting barrier from the combined denominator, and
whole-world numeric preflight (hidden bad vitals refuse). Raw private logs are beside the checkout;
checks.json records hashes. They are regression controls, not substitutes for independent source parity.

## Explicit pending gates

- Post Rust's immutable actual-source barrier corpus and its NEW dedicated consumer test/evidence.
  No worker WIP, copied expected data, conditional skip or source-parity completion claim exists here.
- G6 private deadline/decay state, actual grant/decay/absorb-to-zero publication, and paired valid-private-
  timer invariance. Current tests use declared numeric pre-state and the real preparation/restore path.
- Complete protocol12/Rust/C#/JS full/delta/pool/reset publication and Unity presentation, composed with
  the separately owned Wish/time contract. Protocol11 does NOT carry the new barrier fields. Existing
  v11 publisher tests certify refusal/atomicity only, not complete client barrier delivery.
- Lead integration review/identity reconciliation and final union proofs before main/live admission.

After this clean handoff the lead may release observe.rs/wire.rs production leases to the network
worker. Later source-consumer work is restricted to a new dedicated test/evidence file; no further
production edits are implied.
