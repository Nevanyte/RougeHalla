# P-BARRIER-OBS-1: checked native barrier observations

Private implementation packet for a Codex specialist, from a fresh isolated branch/worktree at the pushed checkpoint
containing this packet. The lead reserves Observation18 for the combined barrier/Wish publication candidate. Current
main remains Observation17 until complete admission. Policy interface contract13 is unchanged; update observation
pins only. No live-profile activation, protocol implementation or automatic merge is authorized by this packet.

## Chosen projection

- Add `SelfView.barrier: f64` and `barrier_ring_step: u8`; add `ActorView.barrier_frac: f64` and
  `barrier_ring_step: u8`; add `PublicPlayer.barrier: f64`. The float barrier is the widened source-f32 value.
- Owner HP/maxHP also become widened source-f32 values, matching actual source selfView and human transport precision.
  Preserve privileged PublicPlayer's existing raw HP/maxHP semantics; do not claim full source parity for that diagnostic.
- Player actor HP and barrier use frounded HP/maxHP/barrier and the actual source hpBarFractions positive guards plus
  combined denominator, then twentieths: zero unless share>0; otherwise max(1, js_round(share*20))/20. This explicitly
  replaces current actor hundredths. NPC HP uses the same source twentieths with barrier0; NPC barrier/ring remain0.
- Human ring step uses widened f32 barrier and ORIGINAL native f64 maxHP, as the actual human schema/renderer does:
  shared barrierStrength with0.3 normalization, then its eight-step positive-sliver rounding. Do not fround maxHP for
  this computation, infer a timer or implement grant/decay/cap rules in views. Independent shares can sum to105%.
- Reuse the same checked numeric helper. HP/maxHP must be finite and cast to finite f32; their finite negative/zero
  inputs retain source guards rather than a new gameplay invariant. Barrier additionally must be nonnegative. Preserve
  negative-zero bits, allow underflow and check the cast RESULT (not an artificial <=f32::MAX input limit).

## Fallible delivery and privacy

Add unit `OfferError::UnrepresentablePublicVitals`, with no private actor or number. Crate-private observe_with returns
Result and checks owner fields on owner construction, remote fields INSIDE successful visibility branches and NPC fields
inside their selected-row branch. Never preflight hidden actors. ItemObserver::prepare_with_seen_rewards_where propagates
the result BEFORE reward/actor-reference staging/commit. Reusable output is unspecified on Err and may be consumed only
on success; do not clone buffers for transactional output or substitute zero/null/sentinel observations.

Provide try_observe/try_observe_into/try_observe_into_cached through disposable ItemObservers. Existing infallible APIs
remain explicitly trusted wrappers using expect. Action-producing/live/headless delivery uses persistent checked observers.
Publisher::frames/frames_in MUST use checked projection and return the existing unsupported ViewFrames on refusal,
without partial FX/important output or panic. Prepared Room already propagates OfferError and commits only after enqueue;
verify that path and unchanged carry on failure. Existing queued commands still use normal delivery validation; this
does not introduce a session-poisoning or retroactive command-revocation rule. FxProjector needs no redesign here.

Add try_public_snapshot; privileged all-row output checks its included rows. Keep its infallible trusted wrapper.
Add OutcomeDigest::try_tick and use checked APIs for arbitrary-checkpoint diagnostics; ordinary declared benchmarks may
retain documented trusted wrappers. Parity vision comparison uses checked observation and reports a comparison error.

## Scope and composition

Own observe.rs, necessary module exports, item_view.rs OfferError/prepare propagation, necessary Rust struct-literal
consumers, focused tests, headless digest/checked diagnostic consumers and only the checked-projection refusal seam in
rh-server wire.rs. No Wish OwnerView or SeenEvent/temporal projection changes in this packet; no G6 producer/state/
checkpoint/content/schedule files, old source goldens, codecs/C#/Unity, dependencies/Cargo.lock or shared statuses.
The lead will hand over observe.rs/wire.rs before a subsequent Wish/codec worker edits them; report a clean commit.

This changes publication, not gameplay. No world-state/format/content revision is assigned here. G6 separately reserves
candidate checkpoint25/replay19/new content. The lead will reconcile one complete identity/transport union before main
admission. Protocol11 cannot be claimed to carry these fields; the checked candidate remains isolated until its complete
transport is admitted. Preserve old runtime evidence.

## Proof and finish line

Use the source anchors in BARRIER_PUBLICATION_RESEARCH.md. Post Rust owns P-BARRIER-VIEW-WITNESS-1 and its actual-source
corpus; do not edit/copy expected values or race its WIP. Implement meaningful threshold, signed-zero, sliver, overfull,
maxHP-decrease, reset/absence, NPC-zero and malformed-domain controls. Add a consumer of its immutable corpus once
delivered; absent/unverified source parity stays explicitly pending, never conditionally skipped into a green claim.

Paired hidden unrepresentable vitals must produce equal successful observations/frames; visible/owner invalid values
must refuse safely, leave committed handles/baselines/carry unchanged, and recover on a subsequent valid preparation.
Different valid private G6 deadlines with identical current public facts must be equal at that instant once available.
Run focused affected observation/ItemObserver/policy/headless/publish tests, warmed no-allocation checks and strict
affected Clippy in both feature modes plus formatting. Do not repeat unchanged map campaigns. Native casts/heals stay
in G6; its actual grant/decay/absorb-to-zero publication joins the final integration proof.

Deliver exact base/head/files, commands/results and remaining source/transport/G6 proof needs. Success is the complete
checked native candidate with its honest pending composition gates. Stop/hold on hidden-state refusal side channels,
unchecked live paths, silent value repair, weakened restore rules, source-derived expected changes or unsupported parity.
