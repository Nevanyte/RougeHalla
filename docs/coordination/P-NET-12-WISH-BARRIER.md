# P-NET-12-WISH-BARRIER: complete human Wish and barrier transport

Outcome: one private protocol12/Observation18 candidate carrying complete ordinary human Wish input/owner/cues and
the approved native barrier facts, with Rust/C#/JS agreement and usable R input. This is a full feature unit; temporary
phases are implementation order, not a smaller replacement goal. Follow [ADR0022](../adr/0022-barrier-wish-publication.md).
The lead owns integration, identities/content reconciliation and shared statuses/Cargo.lock.

## Dependencies and write leases

Start an isolated branch/worktree from the pushed checkpoint containing this packet. Preserve old refs/WIP and use an
own target. P-BARRIER-OBS-1 owns observe.rs/item_view.rs and the checked wire.rs seam until the lead delivers its clean
commit. G6 separately owns private heal/state/content work; Frost resistance owns frost.rs. Do not edit those workers.

Phase A may start NOW: rh-protocol codecs/structs/trackers/sample/fixture generator and new v12 fixtures; engine-independent
C# protocol/net state/input/session/clock/snapshot code and meaningful tests; synchronized library copies; JS decoder/
probe/vector checker. Use the exact field/tag/bit allocation in ADR0022. No native observation or server wire edits yet.

Phase B starts only after lead handover of the native observation commit: merge it into this isolated candidate, then
own necessary Wish OwnerView/event/producer/checkpoint/hash/report/observe/actor_refs changes and server wire/wire_state/
room/director/main adapters. Raw timestamp fields join reserved candidate checkpoint25/replay19; do not silently read
old formats or default missing times. Do not touch G6 heal/stat/content/schedule files or broaden admitted NPC domains.
Report any genuine new shared dependency before expanding scope. No change to other raw event kinds/public facts.

Separate G6 lease: checkpoint.rs, shared state.rs changes, hash-coverage tests, format constants and derived tapes
remain LOCKED until G6's clean handover and explicit lead release, even after the observation lease is released.
The lead may own that final schema/hash/tape composition instead. Never claim the pending timestamp restore/format
gate passes before it is actually integrated; continue the independent producer/report/codec scopes meanwhile.

Phase C: engine-independent session and Unity MatchClient R-input integration. The art lane will receive a separate
HUD/confirmed-cue/barrier-render packet once the public C# API is stable; do not concurrently edit its MatchHud,
ArenaView or SpriteActorPresenter. Coordinate exact exposed names/semantics with the lead. Final source/Editor/Web
composition remains this feature's required proof, not implied by isolated net tests.

## Preserve authority and complete behaviour

- Wire Cast slot0 Wish/1 Q/2 E, finite point x/y, optional nonzero delivered actor reference, optional finite f64 render
  time and optional u8 order seq. No client ability/rank/cost/outcome. Resolve through ItemObserver, validate, normal
  budgets, replay recording and Sim::submit. Stale/hidden/absent/other-observer NPC references follow normal targetless
  misses without raw-ID fallback, hidden cost differences or new discovery oracles. Q/E casts remain parsed no-ops.
- Keep native current cast prerequisites/effects/order. Reuse actual canonical stock/recharge helpers plus config/time
  for OwnerView display facts. Preserve opening lock, Blaze partial/full stocks, live clock cuts, teleport refund and
  training recharge. No cooldown/rank/card/target-rule copy in C#; no predicted blink/cast root or local eligibility.
- Follow the original f64 event-time and spatial privacy tables in ADR0022, including anonymous visible landings and
  paired-only Blaze geometry. Extend sealed per-step point permission/reporting narrowly; never final-world re-filter
  old carry, mark raw Landed Everyone, invent a cast ID or deduplicate same-tick occurrences.
- Full Wish profile/owner/start/landing refusals may be removed only once complete encoding works. Add explicit
  server opt-in selecting Mode::Full; preserve current defaults and admitted world prerequisites during candidate work.
- InputSender/Session expose Cast. R is edge-triggered and suppressed while typing/UI owns input, reconnecting,
  planning or dead. Send cursor ground point and only a currently picked delivered actor ref. Q swaps, E potions.
  Preserve Poll -> input -> FlushInput -> Present and current default-clock Attack/Release timestamps, including
  focus-loss releases. Cast time does not activate new rewind: native currently records bounded lag but does not rewind
  Wish effects. Apply existing connection render-time admission bounds without adding per-cast client rules.
- Cast can echo move_seq even on gameplay refusal. Implement bounded nonmovement-order acknowledgement bookkeeping
  so Move->Cast and Cast->Move/coalesced acknowledgements/byte wrap preserve the pending walk destination and Rust
  correction. Do not treat Cast as Move/Stop or change authoritative acknowledgement semantics. Exercise real Session
  Poll/Flush paths, not an unused helper.
- Use the per-frame source-time override semantics exactly; do not inherit a base snapshot time into a delta or replace
  actual producer time with tick*50. Keep frame ordering and source clock separate. Old float codec bit rules survive.

## Validation and finish line

Preserve all old source corpora and v11 fixtures. Add v12 canonical vectors from the existing Rust generator and prove
all three decoders/trackers. Cover every optional Cast combination, malformed slot/ref/flags/nonfinite point/time,
new owner/cast/barrier clear-to-zero/None groups, full/new actor/resync/resume/pool reset, unknown masks/truncation,
maximum encoded sizes and held-baseline/offer atomicity on failure. Source-copy checks must pass.
Explicitly reject anchor-only/destination-only Blaze, destinations on other abilities and a Landed record with no
caster or geometry. Exercise offset-clock Full -> default-clock Delta, including pooled reuse: no override means the
CURRENT frame's tick*50, not its base's clock.

Use existing genuine ability corpora plus a small additive actual-source control for R message production, queued Cast,
all-five ordinary50ms execution, owner schema/stock clocks and actual Fx pack/unpack/perceive. Add a labelled actual
WishFx method/graphics-recorder witness for the endpoint/hidden-caster matrix; distinguish source human/perceive and
the deliberate privacy correction. No fabricated source events or installed expected output state. Keep five strict
source-born NPC-signature cases pending; do not remove their gate or claim full P-ABIL parity.

Real Rust Room/socket tests must drive decoded Cast through delivered refs to submit and decoded owner/effects, with
all-five positives, refusal/profile/hidden target controls. Exercise same-wake start/end and real between-step cancel ->
checkpoint/restore/hash -> next-step delivery, plus true per-step coordinate redaction before carry and enqueue failure.
C# tests cover stock/cast reset, source clock override/default, movement/ack ordering and reconnect via actual Session.

Run focused affected Rust scopes, strict affected Clippy feature modes/fmt, net C#/JS/source-copy gates and existing
browser-probe WSS proof where useful. Coordinate the single final-union Unity R-to-server all-five proof with the lead/
art lane; no new cloud/deploy/spend or unrelated art/performance campaign. Any unrun final client/source gate remains
explicitly INCOMPLETE until executed. Do not replace the full feature with a merely encodable placeholder subset.

Deliver reviewable commits, immutable base/head, exact source/tool/corpus/protocol identities, files, real commands/
results and remaining composition proof. No primary/managed writes, optimization_port merges/pushes, shared statuses,
dependency changes, ML or account/security changes. Pause only the dependent file scope when awaiting its lease; keep
independent codec/session work moving. Stop/report concrete blockers rather than inventing architecture or expected data.
