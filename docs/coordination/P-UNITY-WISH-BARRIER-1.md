# P-UNITY-WISH-BARRIER-1: delivered Wish and barrier presentation

Lead assignment to the existing art chat. Use the immutable, committed client interface at
`abd1ccfe6edc90df16c64283af09c913bddbd81d` on `codex/wish-barrier-net12`; this is a private protocol12 candidate,
not admitted main or a completed server transport. Follow [ADR0022](../adr/0022-barrier-wish-publication.md).

## Checkout and ownership

Preserve the old art branch, its source evidence and unadmitted audio work. Confirm the existing isolated art Editor
is idle, then create a fresh branch from the named checkpoint in the same art checkout, or use a new isolated checkout
if necessary. Reuse the existing Editor safely; never launch a competing Editor against the same project. Read the
Unity UI/uGUI and CLI skills and inspect the actual hierarchy before targeted UI edits. Retain Unity6000.0.85f2.

Own `UnityProject/Assets/Scripts/UI/MatchHud.cs`, `View/ArenaView.cs`, `Presentation/SpriteActorPresenter.cs`, necessary
new presentation helpers, their meta files, dedicated Editor tests and packet evidence. Networking retains all shared
Protocol/Net/session/prediction/input code and synchronized library copies. MatchClient.cs lifecycle/subscription lines
are released by networking at the named checkpoint: old-session unbind in Join, subscriptions after Hud.Bind, Leave,
OnDestroy and a reset-forwarder beside PresentFx. Change only subscription/clear/leave/destroy forwarding. Do not alter
R/Q/E, input order, steering, target picking or focus-loss semantics.
No shared status/Cargo.lock, native/server/codec, new asset acquisition, cloud or deployment edits.

Explicit narrow audio release: the admitted `Presentation/ShowcaseSoundscape.cs` may expose ResetTransientCues,
clearing its pending FX count and stopping its existing SFX voices. Call it from the lifecycle forwarder; keep the
session/listeners bound so later same-wake new-epoch cues survive. No DetachSession/reinitialization workaround, music/
ambience change, new sounds or unadmitted research branch. Test stale-clear/new-cue preservation and listener lifetime.

## Delivered facts and behavior

- `Session.Me.Wish` is an owned nullable value record: Ability, ReadyAt, FullAt?, MaxCharges, RechargeMs, Charges,
  NextChargeAt?, Cast? (Ability, StartedAt, LandsAt). Show R, the delivered ability, charges/max and authoritative
  opening/recharge/cast timestamps. Presentation progress against the accepted server clock is allowed; do not derive
  card/cooldown/eligibility rules or gate input from guessed availability. Clear stale facts on None, new session and
  missing owner. Retain Q swap/E potion behavior and readable1.50 text layout.
- Owner barrier is the delivered float; actor `BarrierPct` and `BarrierRingStep` are delivered facts. Show barrier text,
  distinct health/barrier segments and the0..8 ring. Do not calculate gameplay grants, decay, caps, maxHP or resistance.
  Independently quantized actor shares can total105%; preserve the facts rather than silently dropping barrier. NPC
  barrier is explicitly zero. Clear/reinitialize every new visual on pooling, death, eviction, owner absence and reuse.
- Confirmed `WireFx` includes WishStarted6/WishLanded7/WishEnded8 with EventTime, Duration, Ability, Reason,
  optional Caster/Target, HasAnchor/HasDestination and coordinate pairs. Copy required scalar/value fields into owned,
  bounded cues immediately: decoded packets/snapshots are recycled. Preserve event order and multiplicity; two Blaze
  landings by one actor at one time must not be collapsed. Do not invent a cast ID.
- Use confirmed events for five distinguishable readable cues with existing pooled sprite/shape assets. No new physics,
  gameplay, predicted blink/target/root, lights or expensive render pipeline changes. Low tiers and Reduced Motion keep
  essential shape/timing distinctions. Late delivery ages a cue from actual EventTime; it does not restart the full
  telegraph. Same-wake start/end/cancel must terminate correctly without a stale full-duration cue.
- Optional caster landings with permitted coordinates are legitimate anonymous world effects. Do not look up a hidden
  actor or reconstruct redacted target coordinates. Blaze geometry requires both delivered endpoints; metadata-only
  visible-caster termination may clear a cue without creating a fake point/line. No one-sided/fallback Blaze line.
  Latest delivered membership still controls actor-bound visuals, independently of interpolation and optional audio.
- `Session.ServerTimeMs`, TimelineEpoch and TimelineReset are the accepted presentation clock surface. On TimelineReset
  clear pending FX, active transient effects and local real-time animation/cue timers, including the existing64-entry
  Arena pending queue and actor hit/block/attack timers. Clear any old queued audio cue using the existing admitted
  audio surface only if one exists; do not introduce the unadmitted audio branch. Unsubscribe/rebind on session switch,
  Leave and destroy. Do not clear canonical collections/membership or send Stop/reset a steering goal on a clock cut.

## Checks and finish line

Meaningful tests must exercise actual HUD/presenter ownership, not only a formatting helper: Some→None/zero and new
session clears; stock/opening/cast transitions; retained borrowed-packet mutation does not change copied cues;105% shares;
ring0/1/8, pooled reuse/NPC zero/death/hidden actor; anonymous permitted landing, paired-only Blaze, same-wake terminal
ordering/two identical-time landings; expired delivery and TimelineReset clearing/subscription teardown. Exercise the
real lifecycle binding, preserving movement and canonical snapshot state. Reuse existing tests where they cover this.

Recompile the isolated project with the pinned Editor and run one focused EditMode batch including the existing42
tests. Inspect actual HUD at1.50 scale and representative normal/reduced-motion/low-tier cues. Record exact source,
Editor version, files, commands, assertions and screenshots with their true scope. No repeated Web rebuild/profile
campaign now: the lead will compose native/server/client first and coordinate one final all-five normal-R-to-server
browser proof, readability and performance batch. Source/Editor success is not Web or end-to-end acceptance.

Deliver clean reviewable commits and exact base/head/report. Success is functional delivered-fact presentation and
transient lifecycle tests within the assigned scope. Failure/hold is copied game rules, hidden identity/coordinate
fallback, borrowed-message retention, input/prediction changes, unbounded cues, stale epoch effects or a failing real
Editor check. Stop only the dependent interface if it differs; report the exact mismatch while continuing disjoint work.
