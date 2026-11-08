# ADR0022: checked barrier and complete Wish publication

Status: accepted for PRIVATE implementation; validation and live admission pending. Main is still protocol11 /
Observation17. This decision reserves protocol12 / Observation18 for one composed publication contract. Policy
interface13 stays unchanged. Native checkpoint25/replay19 are the existing private G6 reservation and will include
required pending Wish event timestamps before final admission; no private candidate format is a released compatibility
promise. Gameplay content identity is reconciled by the lead after G6/Frost composition.

## Barrier views

Follow [P-BARRIER-OBS-1](../coordination/P-BARRIER-OBS-1.md): source-f32 owner HP/maxHP/barrier, source twentieth player
and NPC HP/barrier shares, explicit NPC barrier0 and an eight-step human ring derived from source-f32 barrier plus
original f64 maxHP. Owner and actor ring steps are delivered facts. Checked conversion runs only on included rows after
visibility; typed OfferError refuses unrepresentable public vitals before bindings/baselines commit. Hidden invalid
vitals do not affect another viewer's delivery. Private expiry/decay fields never become public. Global restore limits
and unrelated owner float codec behaviour are unchanged.

## Wishes and temporal truth

All five existing ordinary player Wishes use the current PublicCommand::Cast path. Clients send slot/point/optional
delivered actor reference/time/order byte, never an ability, rank, cost or outcome. Unity implements no eligibility,
collision, blink, root, cooldown or damage rule. Q/E cast slots remain source parsed no-ops; ordinary keys remain Q swap,
E potion and R Wish. Existing corrected local movement prediction is the sole gameplay exception.

Owner publication adds canonical Rust stock display facts to the existing safe OwnerView: effective recharge duration,
current charges and optional next-charge deadline, alongside ability/ready_at/full_at/max_charges and optional cast
ability/start/landing deadlines. These facts come from existing authoritative helpers/config/time. They disclose no
target, cursor, previous/refund clock, action rank or lag. An optional snapshot self record binds them to the same sample
as move_seq; Off/self absence/full reset explicitly clears it.

Raw CastStarted, CastLanded and CastEnded receive required f64 event_time AT THEIR ACTUAL PRODUCER. A between-step
cancel is queued before the next clock advance, so projection-time stamping is wrong. Sim server_time is not guaranteed
to equal tick*50 on every restorable diagnostic state. Copy producer time through sealed per-step projection, carry and
wire. Pending events are serialized/hashed: require finite0<=event_time<=world.server_time on restore, no serde defaults,
and checkpoint/hash/continue proof of a real between-step cancellation. Preserve every occurrence and order; no private
cast IDs, synthetic Started for instant effects, synthetic Ended after a success, or caster/ability/tick deduplication.

## Permitted lifecycle information

Source human WishFx and legacy bot perceive differ. Human landing art is spatial and can appear without a visible
caster; perceive drops a known hidden caster's whole cue and also retains some hidden-target coordinates. The union
preserves legitimate HUMAN visible art and fixes that coordinate disclosure; it does not claim old perceive equivalence.

- Started and Ended remain caster-scoped, with required visible/own caster identity. Started's target and target-derived
  anchor disappear when the unit target is hidden; arbitrary point anchors independently need point visibility.
  Ended contains no coordinates. Source reasons are0 Fizzle,1 Interrupted,2 Cancelled.
- Projected Landed has OPTIONAL caster and target identities, independently visible/mapped. A permitted spatial landing
  survives hidden caster redaction or a missing caster reference. No hidden actor position is used as a fallback.
- A visible Freeze/Trial unit target permits its impact even if the caster is hidden. Hidden unit targets suppress
  identity AND target-derived coordinates even when the ground tile can be seen. No redaction-reason flags are sent.
- Swarm/Last Stand may deliver an anonymous visible point effect. With no permitted point and hidden caster, drop it;
  a visible caster may still deliver nonspatial termination metadata to clear a telegraph.
- Blaze's source art draws BOTH endpoints and their connecting streak, and disappears when either endpoint cannot be
  seen. Publish the pair only when both are permitted, or for the owner's authoritative blink. Otherwise publish no
  pair. Do not invent a one-ended flash, substitute the visible endpoint into a hidden one or reconstruct a line.
- Own movement/effect points are permitted; ownership never exempts hidden unit targets. A disappeared/invalid target
  follows the real Fizzle/Ended producer; no fabricated landing uses cached targets.

Freeze point/identity decisions at the cue's completed step using existing sight/ward/Hidden rules, before catch-up
carry. Required between-step timestamps remain their earlier emission time. Extend the bounded sealed projection/report
seam for point permissions; do not mark raw CastLanded Everyone or query the final catch-up world. Actor reference
mapping treats both Landed identities as optional without discarding permitted anonymous geometry. This is a named
spatial-effect fact, not permission for a roster, hidden periodic positions, future trajectory or other raw event kinds.

## Protocol12 allocation

Existing tags/bits stay fixed; v11 fixtures remain immutable. The following reservations are exclusive:

| Channel | New allocation |
|---|---|
| Client command |16 Cast |
| Fx |6 CastStarted,7 CastLanded,8 CastEnded |
| Full snapshot head |17 Wish owner,18 owner barrier/ring pair,19 server-time override |
| Delta snapshot head |21 Wish owner,22 owner barrier/ring pair,23 server-time override |
| Full actor mask |9 barrier-share/ring pair |
| Delta actor mask |12 barrier-share/ring pair |

Owner barrier is f32 plus ring u8. Actor barrier is integer percent derived from twentieth steps, plus ring u8. Ring is
0..8 and bar percent0..100; independently rounded shares may total105%. Preserve negative-zero owner bits. Full defaults
are absent Wish/zero barrier/zero ring. Delta groups transmit changes to zero/None; new actors/full/resync/session/pool
resets restore those defaults. Wish Full bit denotes Some; its Delta group has an explicit optional-record tag to clear.
No new reliable collection key or item binding is needed.

Wish record fields: ability u8; ready_at f64; optional full_at f64; max_charges u8; recharge_ms f64; charges u8; optional
next_charge_at f64; optional cast {ability u8, started_at f64, lands_at f64}. Use canonical closed ability codes0..4.
Reject unknown fields/flags, nonfinite/negative clock or duration values, out-of-range counts, count>max and malformed
cast ordering. Do not duplicate cooldown/gameplay formulas in a decoder. Actual zero-duration/stock edge semantics must
be witnessed from the authoritative helper, not inferred. Source reason mapping is the closed table above.

Every Wish Fx carries its original f64 event_time. Started has required caster, ability, duration, optional target and
anchor. Landed has optional caster/target/anchor and optional paired blink destination. Ended has required caster,
ability and reason. Reuse checked public position quantization and observer references. A destination requires an
anchor, and the producer enforces the spatial rules above; codecs never reconstruct missing coordinates.

Snapshot source time is explicit logically. For ordinary frames it defaults to f64(tick)*50 with no added payload;
the reserved server-time override bit carries an absolute f64 when its bits differ from that default. This is a
PER-FRAME global field independent of self and delta baselines: absence means current tick*50, never an inherited old
clock. Reject nonfinite/negative times. Clients use accepted source time for clock alignment/interpolation and Wish
deadlines, keeping tick for snapshot ordering/baselines. Default-clock Attack/Release timestamps must remain unchanged;
offset-clock tests must agree with the actual server clock. Existing old owner float fields keep their wire bit rules.

## Admission

Three codecs, strict full/delta chains, source witnesses, per-step privacy/catch-up tests, between-step restore/hash,
stock/sequence/clock/client controls and actual all-five R-to-server proof are required. Full Wish mode becomes supported
only after all facts/input/cues encode; an explicit server configuration selects it. Existing NPC domain gates remain.
The five strict source-born NPC-signature cases, broader fair-view/brain, quest/trade flows and full browser/release gates
remain required separate work. Source-only partials are not a live or full-port completion claim.
