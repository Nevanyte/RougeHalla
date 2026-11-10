# Card bleed feedback — source timing and native privacy design review

**Revise the design boundary before native dispatch.** Legacy card feedback does not preserve original-contribution
audiences. P-CARD-BLEED-FEEDBACK-1 currently combines genuine source aggregation rules with an ADR0013-style native
privacy requirement and describes both as source preservation. Keep source aggregate/cadence parity and the deliberate
public privacy correction separate. Source fixture preparation can proceed independently; do not dispatch the proposed
accumulator/event scope as though existing Event::Hit already implements the required temporal projection.

Read-only inspection at integration `3e3a5fc3799c2c25f943b27310540cf15508d1b7`; no build, capture, test, packet,
production or shared-status edit was performed. This new review document is the only write for this audit. Source/native
files inspected include cardHooks, World.emit, FxChannel, RaidRoom/headlessRoom, fxCodec, perception/FrameRing/BotVision,
client FxView, native fx_report/FxProjector/observe/events/signature and ability report producers, CONTRACTS and ADR0013.

## Source truth

1. `packages/server/src/sim/cardHooks.ts:270–287` stores only `since` and an insertion-ordered Map of
   `{victim,by,amount}` per string pair. There is no hit timestamp, viewer set, victim/source visibility, location or
   per-contribution provenance in BleedReport. `afterDamage:311–317` folds eligible landed card DoT by binary64 addition.
2. `flushBleeds:281–287` emits `{kind:"hit",id:victim,by,amount,weapon:null}` at the later flush, clears rows and resets
   since to current serverTime. It does not set passive, signature or ability. Creation starts the clock on first eligible
   landed hit; periodic threshold is `now-since>=500`. The object remains after empty flushes. runEnded chains a flush;
   raidStarted reset deletes the report; teleport resets other card fight/deferred state and does not flush/delete it.
3. `sim/world.ts:1050–1052` merely pushes the SimEvent. `rooms/FxChannel.ts:60–72` packs all supplied FX at the batch's
   current time with roster/projectile bookkeeping; it has no viewer or sight predicate. `RaidRoom.ts:715–759` collects
   all emitted FX then broadcasts one batch to clients and hands it to bots. `tournament/headlessRoom.ts:154–197` follows
   the same aggregate channel path. Thus there is no server-held card contribution audience, including at flush time.
4. `shared/fxCodec.ts:130–145,173–179,250–265` preserves event order, quantizes amount, and gives decoded events the
   flush batch's `t`; it transmits no original contribution times. Card rows have zero weapon/signature/crit/passive flags.
5. Legitimate bot observation is applied later: `brain/perception.ts:447–470` gates a hit on victim visibility in the
   batch frame and masks source against that frame. `frames.ts:419–442` applies its render-window point gate and masks
   source again against drawn identities. `vision.ts:65–79` further filters event points against retained sight. These
   stages can discard/redact the whole already-aggregated row; none can recover or filter original contributions.
   Client `FxView.ts:539–566` similarly treats weapon-null/no-signature/no-ability as a DoT drip and uses a visible victim
   position at rendering. The raw global broadcast itself is broader than legitimate observed/rendered feedback.

Consequently a victim becoming visible only near flush can expose a total containing earlier hidden damage; an attacker
becoming visible only near flush can be named on a row containing earlier unseen source contributions. The exact
observer output still depends on flush-frame and later window/vision filtering. Do not describe this as source
hit-time eligibility, or simplify it into server recipient filtering that FxChannel does not perform.

## Existing native contract deliberately changes that behavior

[ADR0013](../../adr/0013-temporal-damage-projection.md) explicitly documents a reproduced source delayed-history leak
and accepts a **bounded player-only Plague** correction, later extended to Fire/other admitted producers. It preserves
trusted private totals/timing while projecting only contributions eligible in each original **settled simulation tick**.
It redacts unseen sources before grouping, merges anonymous sources, uses public-key order and exact nonnegative sums,
and retains entitlement across later departure. CONTRACTS records this correction at lines241–245 and722–724.

That is a native privacy policy, not a claim that source had these semantics. C-OBS is an existing invariant; the exact
Card producer extension, capacities and output classification still require explicit coordinator design admission.
"Original hit visibility" should mean the existing settled report predicate for the contribution tick, not an invented
within-step historical visibility snapshot. No large matrix of viewer history belongs in authoritative World.

Native `fx_report.rs:52–56,171–233` already carries ordered operations, freezes player/NPC visibility after the completed
step and seals copied events. `FxProjector::feed:203–238` projects each Contribution using those settled permissions.
However it constructs a bucket only when `h.sig` or `h.ability` is present: ordinary card `dot=true/sig=None/ability=None`
is currently skipped. BucketKind is Signature or Ability, and marker selection/clear behavior is domain-specific.
Simply adding card contributions to the report will produce no public card feedback.

Generic `Event::Hit` is `IfSeenOrBy` (`events.rs:255`), and `observe::to_seen:314–325` masks its source against the
event/report tick. The projector also sends ordinary event segments through that same filter. Emitting a delayed plain
Hit at flush therefore filters its entire private aggregate at flush time and bypasses contribution entitlement.
Adding a CardFlush marker without suppressing the corresponding trusted raw rows would double-publish or leak them.

## Smallest native extension consistent with the existing architecture

Keep two distinct forms of state and evidence:

- **Authoritative trusted report:** only source-required first-use/cadence state and insertion-ordered `(victim,by,amount)`
  aggregate rows. Reuse existing card-owned deterministic state if appropriate; otherwise add a small card report struct
  in the mechanic module and one World field. No audience bits, viewer IDs, historical position or per-hit visibility
  logs. Preserve source ordered binary64 totals, first-hit clock, periodic/run-end marker ordering, teleport retention and
  raid-start reset. This alone needs checkpoint/hash coverage and coordinator identity handling.
- **Derived report and per-viewer entitlement:** emit actual landed card Contribution operations and a distinct card
  flush operation at the source phase, then extend FxProjector with a Card bucket domain. Use existing settled `sees`
  masks, redaction-before-keying, anonymous merge, public-key sorting and ExactSum. Keep contribution entitlement in
  each viewer's existing projector bucket storage. Card flush clears only Card buckets; signature/ability flushes must
  not clear Card. Existing global Reset is emitted by `signatures::raid_started` and should clear Card there too;
  do not introduce/reuse a global reset on teleport, which must retain the card window.

The smallest explicit trusted event representation is a **server-only card report event** carrying victim/optional
source/amount, with no new public SeenEvent variant required if permitted projected feedback maps to the existing Hit
shape. This distinguishes raw aggregate rows from ordinary physical Hits and prevents stateless preview delivery.
An alternative internal operation can carry trusted totals and ordering without emitting raw Event rows, but then raw
event parity/diagnostics and exact event-marker ordering need a deliberate contract; it is not a free drop-in change.
Reusing plain Event::Hit without a classification/omission mechanism is unsafe. Do not invent an ability/signature ID
as a Card sentinel or repurpose passive to mean DoT.

Source passive is absent/false; source card drip classification is weapon-null with no signature/ability. Native
SeenEvent::Hit does not retain weapon and its wire has only amount/source/passive. Therefore payload field similarity
does not prove full client presentation equivalence. Existing public Hit may suffice for bounded feedback, but root/Claude
must accept that output contract separately before any wire/Unity work. This review proposes no protocol or client edit.

## Minimum file leases to review at dispatch

The existing packet lease omits the derived-report/public projector files needed by the above privacy extension. A
concrete dispatch should name only the necessary files after source freeze and coordinator identity decision:

- New card feedback mechanic/tests; its module declaration; narrow `cards/after_damage.rs` source-phase call;
  narrow run-end hook and source-equivalent raid-start reset links at existing schedule positions.
- `state.rs` and relevant constructors plus actual hash/checkpoint implementation and coverage/refusal tests for the
  trusted report field. Inspect existing derives/custom walkers before deciding whether those implementations need edits;
  merely testing a new field does not insert it into a custom state hash.
- `fx_report.rs` for Card flush operation, domain classification and audited bounds, and `fx_projector/mod.rs`/tests for
  card entitlement/flush/reset handling. Reuse settled report visibility; add no visibility fields to World.
- If raw events are represented explicitly, `events.rs` for server-only card report plus exhaustive visibility/class
  arms; `observe.rs` only for omission in its exhaustive conversion and privacy tests. No public Observation structure
  change is inherently necessary. Raw event consumers/exhaustive matches discovered by compilation require their own
  narrow reviewed scope rather than a blanket workspace lease.
- New source/native evidence and corpus paths. Shared identity/status files stay coordinator-owned; networking/Unity
  files remain Claude-owned and parked. Reconcile state/schedule leases before Rust dispatch.

## Invariants, capacities and lifecycle gates

**Bounds must follow actual card producers.** Existing report limits assume eight viewers,16 delayed signature rows plus
bounded ability rows and512 raw events; these are not proved card capacities. Card DoT victims include mobs, status
rows may have departed/optional owners, and several card/status sources can land in one tick. Audit actual simultaneous
actor/status/source counts and pair domain before choosing capacities. Keep anonymous source merging and viewer mask
indexing independent of raw IDs. Preflight unsupported report/output/bucket sizes with explicit fail-closed projection;
do not truncate, silently drop trusted gameplay, or allocate every tick. Separate warmed authoritative/report/projector
allocation checks should cover the newly admitted domain. Positive finite amounts and ExactSum errors/overflow retain
the established typed refusal behavior. Report-marker offsets and event counts must remain consistent after insertion.

**Restore/reconnect must not replay hidden history.** Checkpoint only trusted aggregate/cadence; restore/clone gets a
fresh incomplete report identity and zero public entitlement. A fresh projector attaching mid-window receives only later
eligible contributions, even if the later trusted flush contains earlier totals. Existing attach/rebind/duplicate/gap/
foreign/backward/failure behavior must apply to Card without affecting other domains. Deliver an already eligible
contribution even if its victim/source disappears before flush; source identity is redacted at contribution time.
Check source card window survives teleport; raid reset clears the card window at its source point. Current native
`signatures::teleported` clears trusted signature buckets without emitting the global report Reset; this audit does not
claim or modify that other domain's teleport behavior. Periodic+terminal same-tick flush, empty windows and departure
must not duplicate.

**Two independent assertions:** actual unchanged-source ordinary steps establish trusted raw grouping, addition/order,
first-use clock, periodic/run-end/teleport/reset rules and passive defaults. Native privacy tests establish intentionally
different public outputs under visible-at-hit/hidden-at-flush and hidden-at-hit/visible-at-flush histories, mixed eligible
contributions, anonymous-source count/order controls and all session schedules. Do not demand public source-row equality
where the accepted privacy correction intentionally differs. Do not use a source broadcast payload as proof of permitted
native recipient information. One bounded actual-source timing witness plus finite native differential privacy controls
can settle this design without a broad gameplay/client campaign.

## Review outcome and evidence pins

Source capture preparation is **released** within its new files; native dispatch remains **pending explicit Card temporal
projection/output/bounds design and reconciled leases**. No source run, leak reproduction or native test outcome is
claimed by this static audit.

| Inspected file | SHA-256 |
|---|---|
| `packages/server/src/sim/cardHooks.ts` | `46905d00f5841c216dca43d31a8e97f7d27ef2b826b92406a6110334b50081c1` |
| `packages/server/src/rooms/FxChannel.ts` | `14dcbc44ae20f8e882846bb9231a842e2369d4c7a6c0d2c15e659a76c85e8776` |
| `packages/server/src/rooms/RaidRoom.ts` | `af86018c9e97f06edac65412fa890ddf3502993e8f0b4e09e93afcc07aed7aa3` |
| `crates/rh-sim/src/fx_report.rs` | `f9ebc3b5dca009c5e7994ec38072f965ebf18e91ea33d372f5d816b99036b7c1` |
| `crates/rh-sim/src/fx_projector/mod.rs` | `18da62e70a4675700e693e08197142e3e742dd8e4813d428c13005826aadf6f3` |
