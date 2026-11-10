# Card bleed native dispatch design

Design review2026-11-10; **native implementation is not dispatched**. Static follow-up binds backend
`04987499972be06a39b21c4bf741b92390d135f9`. DeepSeek owns all Rust/tests. Root must approve the preparation calculations,
the specific numeric/restore probe decision below, and exact identity/file leases against the then-current integration/Claude cuts.
This design author ran no tests and edited no source/evidence. It replaces neither the released source oracle nor the
existing temporal projection architecture.

## Source and output decisions

Released source: integration `570fe186`, independently reviewed transfer `c76f8e46eebebd91a25c8cd7e4f1dd88ba4f4538`;
`parity/card-bleed-feedback/source.json`, `rh-card-bleed-source/2`,410111 bytes, SHA-256
`6b36256739bd473bc70ebd160a8632a26470ab8e4190f873026bd714e53d36ed`. Controls3191 bytes SHA
`248a3be77749e9f966a9fff3ad6f7ba44ea4db4d3eddba3e0c9be9a71578fcd9`; preparation manifest SHA
`9869a390c4f5a3ad939254d94e0ef44571397b653f3c10ec6e9d171d3bd29d8e`. Source/evidence/tools stay immutable.
The source review is `docs/evidence/card-bleed-source-review/corrected/README.md` after Root transfers its receipt.

Seven finite actual-source cases establish trusted ordered totals, first-use500ms cadence, natural early run-end,
teleport retention, explicit startRaid reset, Fire burn/backlash exclusion and no-card control. They do not cover all
ability variants, sourceless actors or native privacy. Tick7/350ms has the fifth cumulative fresh hit and1.1180044891585073
flush; tick8/400ms has retained scratch1 but processedLanded0. Native consumer must drive actual inputs/producer passes,
not replay raw retained scratch as new damage. Inputs explicitly declare loadout/position/HP and lifecycle setup.

Adopt Root's preferred two outputs:

1. New **server-only raw** `Event::CardBleedHit { victim, by: Option<PlayerId>, amount }`, emitted per trusted pair in
   source insertion order, at the true source flush. It has no invented signature/ability/weapon/passive discriminator.
   Both exhaustive Event visibility/class return ServerOnly; observe::to_seen returns None. This is the trusted parity
   diagnostic, never a public ordinary Event::Hit. No new SeenEvent variant or wire variant.
2. FxProjector emits existing `SeenEvent::Hit { victim, by: redacted_source, amount: entitled_sum, passive:false }` at
   the Card marker. Existing observation/public-ID preparation and existing Hit wire mapping deliver bounded damage
   feedback: victim, permitted source and amount. It intentionally conveys **no Card/DoT/drip identity, weapon, ability
   or signature**, so no legacy drip animation or Unity presentation equivalence is promised. Source passive is absent
   and existing boolean defaultfalse is the public contract; passive must never become a Card flag.

This is an explicit semantic extension of existing Hit feedback, requiring Root's approval. Existing protocol14 codecs
can encode it without shape change; preserving codec shape does not exempt observation/policy semantic versioning.
No client/generated-code changes are assigned to the Rust worker in this packet.

## Authoritative state and exact producer phases

New mechanic module `systems/card_bleed_feedback.rs` owns a serde/hashed `CardBleedReport` with `since: Option<f64>`
and insertion-ordered `Vec<CardBleedBucket { victim, by, amount }>`. World has one field, initialized with sinceNone and
empty rows. Keeping the Vec outside an optional allocation permits cold reservation before first use; None represents
the source WeakMap's absent report. Some(time) with no rows remains meaningful after an empty periodic flush. Capacity
is not serialized/hashed. No viewer, sight mask, position history, contribution tape or session identity enters World.

At the existing cards::after_damage row, scan actual current `s.landed` in its existing order. Eligible means dottrue,
abilityNone, sigNone, independent of passive/weapon assumptions. First eligible hit sets since=now; later hits add to
the matching victim/by row using source ordered binary64 addition, preserving first insertion. Emit one derived Card
Contribution operation for each eligible landed row, not the rounded trusted pair total. Do not reorder or coalesce
contributions before the per-viewer exact accumulator. Unrelated card streak/Wish/stillness/splash behavior stays exact.

Place periodic flush **after existing stillness**, at the source report check point; current resolve_splashes ordering
must be traced to the unchanged source payLater boundary before choosing the final adjacent call. The new call may not
move existing card work. If report exists and now-since>=DOT_FX_MS(500), push CardFlush at current event index **even for
empty rows**, then emit raw CardBleedHit rows, clear rows without losing capacity and set since=now. No report means no
flush marker/state creation. At most one periodic call plus one run-end call per ordinary step; run-end after periodic
usually has no rows but retains its source boundary.

Replace only pending `RUN_ENDED` link `cardHooks.flushBleeds` at its present chain position with the mechanic hook.
It flushes the real report before later corpse/zombie removal links. Do not invoke the helper directly in parity tests.
At existing `cardHooks.resetAll` raid-start link, clear rows and set sinceNone, and emit **CardReset** at that position.
This hook is GateAlways. Existing signatures::raid_started emits legacy Reset under GateSignatures and is absent in
the released core card profile; relying on it would miss resets when signatures are off.

Teleport clears existing card fight/deferred/status queues according to their own hooks but neither flushes nor resets
the Card report or viewer Card buckets. Repeated Lobby/Ended steps remain complete empty derived reports and never
re-read stale last-active landed scratch. Card code reads only the actual scheduled afterDamage pass.

## Derived report and per-viewer projection

Extend existing `fx_report::Op` with CardContribution(victim/by/amount), CardFlush(event_index), CardReset(event_index).
Alternatively reuse a structurally identical private contribution carrier, but keep Card an explicit domain, not a
fake AbilityId/SignatureKind. Extend BucketKind::Card and reuse ExactSum. Card operations are recorded before later
phase markers and event-index offsets are rebased in finish_fx_report just like existing markers.

finish_fx_report freezes entitlement after the completed simulation tick against existing player/NPC settled sight.
For each Card contribution use the same established predicate: sees(victim) OR by==viewer. Redact source using this
same settled tick **before** forming the key. Group on public victim/redacted-source/Card; merge all unseen sources
into the single anonymous victim/Card bucket. Named and anonymous buckets for one victim may coexist. Amounts use
ExactSum(nonnegative binary64), rounded once; public-key order and exact addition make hidden source order/count
irrelevant. Never change trusted source insertion/addition to imitate public ExactSum.

At CardFlush, process the ordinary event segment to that fixed index, omit all server-only raw Card rows, then emit
positive Card buckets as Hit(passivefalse) in existing stable public-key order and clear only Card buckets. Existing
Signature/Ability/Instant flushes affect only their domains. CardReset clears only Card; legacy Reset continues its
existing legacy-domain behavior, not an incidental clear of every future domain. Gap/rebind/failure clears all session
entitlement as before. Marker placement cannot be derived from first eligible/raw pair, which would leak hidden order.
Validate marker order/range and at most2 CardFlush/1 CardReset per ordinary step before copying; no underflow on rebasing.

Raw CardBleedHit must be omitted from every stateless/raw observation path and from ordinary event filtering inside
FxProjector. Merely adding a Card marker while leaving raw rows publicly converted would leak or double-send totals.
Final ItemObserver preparation remaps the entitled Hit through existing identity authority; no new actor/action handle
is granted. Entitlement survives later disappearance/removal; flush does not re-check current visibility. Feed every
ordinary/empty/terminal step regardless of policy cadence/publication. Existing adapters already have that contract;
verify compatibility rather than add a second delivery path.

## Bounds: live production and accepted restore are different domains

Do not reuse the old fixed512 report events,16 signature contributions or eight-player-only bucket proof for Card/NPC
feedback. Live sources of unqualified card DoT are players: cards/on_hit.rs rejects nonplayers; Festering in
systems/signatures.rs explicitly applies only for a player's build. Joins stop at active phase, so at mostP=8 relevant
live player source identities exist, including removed sources retained in statuses. Mob ID values are not seat indices.

Hemorrhage's only live DoT row is2000ms; key is kind/source/`bleed:{tick}`, so repeated hits in one tick merge and at
most40 live tick keys per source/victim can tick. Festering uses one reusable source/victim `festering` key. Thus a
conservative new-live status-contribution envelope is41*P per simultaneous victim. Card count, Fists of Fury, returned
Eye-for-an-Eye and attack rate increase amounts/applications, not distinct same-tick keys. Status max10000ms and arbitrary
tags admitted by restore do **not** justify treating every restored row as one of those41 keys.

Derive victim domains from actual arena/config, not a universal mob count. Let R be the checked sum of potential map
camp spot counts (spawn_camp zips actual spots/roster). Regional respawn delay180000ms exceeds the500ms window; a
conservative retained-window allowance is two R generations. Corpse retention1500ms provides additional safety, not a
reason to prune report rows on departure. Training has no map camps, at most2 dummies per initial player and a
match-lifetime150 practice births (12 simultaneously,300ms spawn gap); Clear can remove victims before flush, so12 alone
is insufficient. Plague companion death revives the same ID; deletion follows owner removal/run-end. Normal owners
cannot rejoin active; training produces no harvest corpses. Quest givers reject statuses/damage and are not card victims.
Audit dummies-enabled nontraining profiles too. A conservative proposed envelope covering these producers is
`V_window = 4*P + 2*R + TRAIN_MAX_MOBS_SPAWNED`; keep training/normal specializations if useful, without lowering safety.

The generic restored domain is larger: currently valid Dot status keys/sources, actor counts and deferred entries need not match live
Hemorrhage/Festering shapes. Never tighten old restore admission just to make a small budget true. During cold
constructor/clone/restore preparation compute E0 = number of existing eligible no-ability Dot status rows plus existing
eligible deferred Dot entries, and Q0 = existing trusted Card pair rows. Their actual retained source/victim identities
may be absent from current actors but must be valid retained provenance. These initial rows cannot create unbounded new
generic keys through live producers; add them to, rather than replace them with, the new-live growth envelope.

For a pristine ordinary world use the live envelope above, specialized to its actual enabled modes. For an arbitrary
accepted restore use P=max(MAX_PLAYERS,current player count), A0=actual current fighter count, and the universal
`V_window=A0+14*P+2*R+150`, whose command/lifecycle proof and costs are completed below. P is a private simulation budget;
it does not widen the existing eight-viewer publication bound. Retained historical IDs are sparse E0/Q0 facts, not new
current viewers. Checked preparation bounds:

| New domain | Conservative envelope |
|---|---|
| Card contributions in one step |`E0 + 41*P*V_window` (overcounts window victims deliberately).|
| Trusted pending pairs / raw rows in one flush |`Q0 + E0 + P*V_window`.|
| Per-viewer Card buckets |`2*E0 + (P+1)*V_window`; an initial generic pair can appear both named and anonymous over its window. Fresh projectors do not acquire Q0 historical entitlement.|
| New marker count |At most2 CardFlush plus1 CardReset; separate from legacy marker limits.|
| New event/output reservation |Conservatively2 times the trusted-pair/public-bucket bounds for two flush markers, plus the unchanged non-Card domain budget.|

Use checked usize arithmetic/reservation failure, no wrap/saturating-to-small allocation. Validate existing report IDs,
rows and amounts before using lengths as reservation advice. Do not allocate an H-squared table from all historical
actor IDs. Existing initial statuses can instead be counted sparsely; no matrix of viewers belongs in World. A new
budget struct belongs only to derived scratch/projection/projector preparation, never gameplay state/hash.

The completed static audit and numerical planning estimates below replace the earlier generic request to audit these
terms. DeepSeek must still check prepared sizes/arithmetic on the dispatched code and measure real allocation behavior;
those native results have not been run by this design author. If a later producer changes the listed premises, extend
sparse cold preparation or add its term; do not silently truncate or exclude accepted restore shapes. Synthetic bench
seats remain explicitly unsupported public viewers, independently of their trusted simulation behavior.

Private aggregate storage must remain lossless if the public report refuses a representation. Extend common bounded
checks by domain: preserve the old non-Card event/contribution limits, add independently derived Card limits, and flag
report unsupported before copying. FxProjector must clear/disable through its existing typed error path on overflow,
invalid amounts/markers or unsupported preparation; never publish a partial prefix, retry raw totals, or silently drop
selected Card rows. Trusted simulation accumulation does not use a public capacity as a gameplay cap.

## Warm allocation and numeric requirements

Reserve new World rows, scratch Card ops, sealed report ops/events/mob sight, per-viewer Card buckets and output vectors
at cold construction, clone and restore. Rebind retains/re-prepares capacity, then clears entitlement; it must not
reconstruct it from private rows. Existing map/training growth envelope should cover later births without new report
allocations. Per-step loops use retained Vec storage, stable insertion search, clear/retain and in-place sorting; do not
mem::take/discard spare capacity on flush/reset. Public ExactSum is already stack/inline fixed-limb storage.

Actual Hemorrhage status production currently allocates format!("bleed:{tick}") and Arc for a new tag; other spawn/status
work also has inherited allocations. Therefore do not advertise whole-combat zero allocation merely from adding report
reservation. Measure the new report/projector steady path and the real unchanged producer path separately, with source/
action-equivalent baseline. Existing cards_no_alloc.rs tests do not prove every Hemorrhage/tag/churn case allocation-free.
Required measurement includes first nonempty window after preparation, repeated flushes, maximum admitted producer
load, original/clone/restore and detach/rebind. No broad status/tag optimization is leased; report a measured inherited
blocker to Root before claiming the stronger whole-step invariant or widening scope.

Trusted totals preserve source sequential binary64 operations; public sums use ExactSum and finite rounded output.
Each stored amount must be positive finite and since finite in0..=server_time; None requires no rows; victim/by keys
must be unique, order preserved and IDs known through retained provenance (not current membership). byNone remains
representable for the generic restored domain even though finite source cases name players. Do not require a contributor
still own a card/live seat or the victim still exist when validating a pending aggregate.

**Numeric result:** a universal finite-sum proof is false for the structurally admitted generic status domain. Concrete
one-row intermediate and4096-row aggregate counterexamples, exact code paths and the three-probe handoff are below.
Public ExactSum failure does not repair authoritative overflow. Root must decide the narrowly justified arithmetic
admission treatment after the actual restore/step receipts; no clamping, changed source sum order, arbitrary row/magnitude
cap or tagged nonfinite state is authorized by this design. Existing C-DET layout explicitly forbids nonfinite World floats.

## Restore, session and identity

Checkpoint/clone preserve only trusted report time/ordered rows. Derived report gets a fresh instance token and remains
incomplete until next completed step; existing projectors reject foreign identity. Fresh attach/reconnect binds after
current tick with empty Card buckets, including attachment on a flush tick. The next private flush may include Q0 old
totals but a fresh viewer sees only contributions earned after attach. Gaps discard all old entitlement and process only
the current complete report; duplicates are idempotent, backward/foreign/error disable until rebind. No sight history
is recovered from source IDs or trusted totals. Never clear trusted World report because one viewer disconnects/fails.

Root-approved planned identities, **revalidate/reserve only at dispatch**:

- checkpoint29→30: required serialized World member/leaf shape, no serde default that silently reads old state as empty.
- replay23→24: state-hash layout changes even when sinceNone, and new report mechanics/public semantics; old replays
  cannot be accepted against new expected hashes.
- OBS21→22 and policy15→16: ADR0013 explicitly versions public knowledge semantics as well as shape. New entitled Hit
  rows are a behavioral contract change despite reuse of SeenEvent/codec fields.
- New content visitor marker, e.g. `card-bleed-feedback/1`, binding first-use cadence/ordered trusted aggregate and the
  deliberate settled Card projection rule; existing DOT_FX_MS remains its already registered500ms rule. Root chooses
  exact marker placement/length-byte fold without changing card catalog rows. No protocol bump for unchanged codec.

Known pins/consumers: checkpoint.rs and replay.rs format constants; observe.rs observation constant; rh-policy/lib.rs
policy constant; native tests/checkpoint.rs and tests/replay.rs hardcoded format assertions; fighter.rs format comment;
systems/sentenced/npc_tests.rs checkpoint assertion; reward_chests/trophy_observer_tests.rs OBS assertion;
tests/content.rs GOLDEN_CONTENT_HASH and new-const registration/explanation; parity/abilities/hash-tape.json checkpoint/
observation/contentHash metadata **and63 native folds/ticks**. Search the exact prepared union for additional old values.
No edit to actual legacy source or captured expected source outputs.

The new World leaf changes the generic serde hash even for absent report, so metadata-only pinning is insufficient.
Execute all63 existing admitted source cases through the final native consumer first, retain genuine source comparisons,
then obtain Root's explicit authorization for the existing native recorder and exact derived tape diff. Never regenerate
the legacy oracle or discard failing cases. New hash-coverage witness must create a real partially accumulated report,
exercise every new optional/row/order/length leaf, or explain only a genuine coupled invariant with a refusal test.

Existing protocol golden-vector Rust/C#/JS decoders and header negotiation must still pass unchanged codec shape.
OBS/policy compatibility refusal tests must reject old contracts. Existing WireFx::Hit cannot identify a drip, and native
large finite amounts still cross its existing f32 encoding boundary; validate supported feedback amounts through existing
encode rules instead of promising arbitrary-f64 wire parity. Any Welcome/version-generated fixture or client-advertised
compatibility refresh belongs to a **later joint Root/Claude integration lease**, not this native mechanic dispatch.

## Exact proposed Rust/test leases

All leases below require Root's allocation after the two proof obligations and Claude overlap recheck. No whole-file
replacement is authorized. At read-only primary `c99e69f0524c386dee1de4dd34ac65fc4847ae93`, selected state/schedule/
events/report/projector paths match4151b3af. observe.rs differs only in lower observe_with/tiles implementation; preserve
it exactly and touch only the raw-event exclusion and separately reserved version line. Never copy Claude's branch.

| File | Narrow semantic hunk |
|---|---|
| NEW `systems/card_bleed_feedback.rs`, adjacent new tests/submodules |Trusted type/aggregate/flush/reset, validation/preparation helpers, raw-source reader/tests/privacy controls.|
| `systems/mod.rs` |Module registration only.|
| `state.rs` |World report field and default initialization only.|
| `cards/after_damage.rs` |Source-phase aggregate/periodic call without moving existing work.|
| `cards/runtime.rs` |Card report reset/CardReset at existing reset_all raid hook; no reset_fight change.|
| `schedule.rs` |Replace pending runEnded card flush with ported hook at same link position/classification; retain names/order/gates.|
| `events.rs` |Server-only CardBleedHit variant and exhaustive visibility/class only.|
| `observe.rs` |Raw Card omission in to_seen; OBS version constant if separately reserved. No lower observe_with/tiles edits.|
| `fx_report.rs` |Card ops, rebasing, domain count/marker validation and prepared limits/capacities.|
| `fx_projector/mod.rs` + new tests |Card bucket/feed/flush/reset/Hit output and prepared bounds; reuse exact.rs unchanged.|
| `scratch.rs` |Prepared derived budget/storage; retain existing prefixes/capacities.|
| `sim.rs`, `checkpoint.rs` |Cold constructor/clone/restore preparation calls; check_world report validation; reserved checkpoint version only. No general lifecycle redesign.|
| `content.rs` |One approved marker visitor call; no unrelated fold/row changes.|
| `replay.rs`, `rh-policy/src/lib.rs` |Separately reserved replay/policy constants only.|
| Native version assertions listed above |Exact allocated literal/comment updates only, not weakened assertions.|
| `tests/hash_coverage.rs`, NEW card report checkpoint/allocation tests |Real producer-derived new leaf/restore/warm evidence.|
| `tests/content.rs`, `parity/abilities/hash-tape.json` |Root-controlled exact identities/derived re-record after actual source cases; no advance blanket permission.|
| `rh-parity/tests/schedule.rs` if actual literal classification table requires it |Only former pending card flush classification, preserving actual source sequence.|
| NEW `docs/evidence/card-bleed-feedback/**` |Exact commands/base/seals/failures/passes/byte pins, honest limits.|

If compilation finds another exhaustive raw Event consumer, return its exact necessary hunk to Root for allocation;
do not broaden to server/wire/client work. Source files/captures, protocol codecs/golden files, Cargo.lock, shared statuses,
Brain/bots/Unity and unrelated cleanup stay out of scope. Root alone integrates identities and shared records.

## Finite acceptance and dispatch readiness

Before dispatch: Root reviews output contract, checked capacity calculation/memory estimate, finite-total proof or exact
counterexample decision, new World/report validation and final leases/identity reservation. Released source preparation
need not be repeated. No native work is authorized by this document.

After dispatch, DeepSeek must retain real source-consumer red/green receipts; compare the seven frozen source inputs
through normal scheduled producers (including /2 processed-vs-snapshot distinction), trusted exact grouping/time/order/
passive defaults and real run-end/reset. Separate privacy controls cover hidden earlier damage then later reveal, source
redaction/anonymous permutations, visible→hidden departure, player/NPC IDs>8, byself entitlement, periodic+run-end and
cross-domain markers, signatures-off reset, teleport retention, empty steps, gap/duplicate/restore/reconnect. Observation
schedules cannot affect trusted hashes/gameplay. Raw/stateless public paths must never expose Card totals.

Run focused card/report/projector, schedule, existing affected status/cards, checkpoint/hash/content/replay/version
checks and warmed allocation tests on sealed code, strict scoped lint/fmt. Root runs the joint decoder/publish/headless
compatibility gates once for the admitted union. No workspace sweep merely to repeat unchanged source evidence. Independent
review requires exact code/source/identity pins and real terminal results; no native privacy or full-client claim follows
from raw-source equality alone.

## Completed predispatch calculation,2026-11-10

This follow-up is read-only inspection at `04987499972be06a39b21c4bf741b92390d135f9`, plus disposable Python binary64
arithmetic and JSON inventory. It is not a Rust execution receipt. The exact source of each growth term is listed so
the implementer can prepare sufficient storage without imposing a new small game/restore limit.

### Command and lifecycle growth proof

| Accepted operation/domain | Growth and retained-window consequence |
|---|---|
| `Sim::add_player`→join_body |Only Lobby, fewer than8 current players; add/remove churn can grow roster/history without bound before raid, but no active card pass runs then. After a restored larger player list, live join still refuses. Use P=max(8,current player count), not roster/history length.|
| `mark_dropped` |Holds identity; releases inputs/trigger. Adds no actor/status source.|
| `remove_player` / `abandon_player` |Removes the existing player; owned companion cleanup may remove victims with pending totals. Neither permits a replacement join in Active/Planning. Abandon also voids the active run, preventing further active producer work. Preserve pending pair IDs through provenance.|
| `Sim::reset_active`, new/try_new, clone, checkpoint restore |Cold new-instance boundaries. They allocate/rebuild World/scratch/projection and renew instance identity. Recompute E0/Q0/A0/P and capacities here, before first active step; old public entitlement never transfers. `reset_active` constructs a new Sim, not an in-place hot resurrection. `synthetic` is bench-only and can exceed8; private budgets use its actual P, public reports explicitly refuse unsupported viewer count.|
| Normal lobby→raid hook |Runs inside ordinary step, not a hidden cold boundary. Future player joins, spawnTraining dummies and regional initial births must already be covered by preparation. CardReset clears the earlier domain, without allocating report storage.|
| Regional initial/respawn births |R is actual sum of map camp spots. spawn_camp zips spots/rolled roster. A camp becomes eligible only after last death+180000ms; after a respawn it cannot respawn again in500ms. Include two R generations conservatively, including a restored immediately-due camp and old retained victims. Teleport resets/repositions mobs, not a new unrestricted birth loop.|
| `Train::Camp` |Runs in the hot input phase via validate+submit. It checks global last_camp_at gap300ms, at most12 alive practice mobs, and lifetime practice.spawned+size<=150; size<=3. Spawn updates spawned and last_camp_at. Do not treat these input-time births as a cold reserve opportunity.|
| `Train::Clear` |Removes practice mobs/chests/projectiles and caller card state but **does not reset practice.spawned or last_camp_at**. Arbitrary Clear/Camp alternation cannot defeat the150 lifetime bound or300ms gap. Removed IDs can remain report victims, so current12 is not a window bound. The lifetime150 term is valid and intentionally conservative.|
| `Train::Card` / `Train::Stat` / `Train::Chest` |Changes current player build/farm or nonfighter reward objects, not player identity. Hemorrhage's unique source/victim/tick key and Festering's fixed key remain. Counts/multipliers affect amount, not the cardinality proof. Training stat magnitude requires the separate numeric probes, not a capacity cap.|
| Training revival (`training::settle`) |Revives the same player ID after the ledger; it does not run the input phase again. Does not create a new player source or reset practice birth counter. Owned companion may already have been removed by the owner-down hook.|
| Owned zombies |raise_or_grow reuses existing zombie ID, reviving dead companions. Owner-down/removal and run-end can remove it. All accepted ConsumeCorpse actions occur before the one damage/settle pass; corpse auto-harvest also cannot interleave owner death and new input processing. Thus at most one new companion ID per owner per active tick, even if a restored training state contains corpse markers and permits later consume/revive cycles. Use11P births for an inclusive first500ms window, not pristine training's zero-corpse assumption.|
| Direct admin/private producer calls |The public administrative API above does not offer arbitrary mob spawning or raw status installation. Private helper calls in source witnesses/tests are declared seams, not extra production hot commands. A future admin spawn/restart API must either be an explicitly cold session boundary or extend this envelope before admission.|

The first report window includes creation tick and the tick500ms later, at most11 fixed50ms active passes. Later
periodic windows contain at most10;11 is safe for both. Voided/Ended phases produce no new Card contribution. A restored
overdue report flushes on its first actual active pass; arbitrary old rows are Q0, not additional unbounded new births.

Let A0 include **all** current restored fighters, even extra training dummies/practice actors/companions that are larger
than pristine production. Existing training validation checks individual shapes/counters but does not establish that
all current actor counts equal pristine150/2P limits; generic accepted state cannot be priced as a pristine room.
Likewise check_world does not establish a universal eight-player count for every structurally accepted restore.
Existing bodies are A0; future joins<=P, initial future dummies<=2P, new regional generations<=2R, new practice births<=150,
and companion churn<=11P. Their sum is the universal V=A0+14P+2R+150. Extra retained source identities do not add a
dense history term: each initial generic status/deferred edge is already E0, and existing report rows are Q0.

E0 counts every current no-ability Dot status row (including stale rows, as a harmless overestimate) plus eligible
deferred Dot entries. Native status.damage can append at most one ledger entry per such status per pass. New generic
arbitrary tags are not created by any accepted command: on_hit rejects Dot/signature/ability hits as weapon hits;
returned Eye-for-an-Eye hits still use a player's same-tick Hemorrhage key. Only live Hemorrhage/Festering growth remains.
Existing deferred Dot entries are consumed once and cannot reproduce themselves through those hooks. Status refresh/
expiry cannot increase the number of distinct keys beyond E0 plus the41PV live envelope. Cold clone/restore recomputes
the sparse inventory from actual rows, preserving existing admission instead of inventing an E0 ceiling.

### Numerical memory estimates

The real admitted160×160 seed1 export `tools/ability-fixtures/seed1-input.json` has50 camps/204 spots. Normal source
fixture first-frame204 regional actors independently agrees. For conservative new-storage planning on64-bit targets,
price Op at64 bytes, trusted pair at24 bytes, public Bucket at320 bytes (ExactSum alone is272), Event/SeenEvent at256
bytes each. These are conservative field-layout estimates, **not measured size_of results or allocation receipts**.
They intentionally allow padding and the existing largest enum payload; the three-probe handoff asks DeepSeek to print
actual sizes before final reservations. New Card rows contain no string heap allocation. Existing source/status/Event
string allocations and existing base report capacities are excluded from this incremental table.

For C=E0+41PV, Q=Q0+E0+PV and B=2E0+(P+1)V, two Op vectors cost128C, trusted rows24Q, two raw-event buffers at two
flushes cost1024Q, report wish-point masks add4Q, and eight viewers' Bucket+two-flush SeenEvent vectors cost6656B.
Thus conservative incremental reservation price is **128C+1052Q+6656B bytes**, plus a few vector/marker headers and
allocator rounding. This is deliberate full-envelope reservation, not a prediction of normal occupancy.

| Prepared profile | P | V | E0 / Q0 | C / Q / B | New planning bytes (MiB) |
|---|---:|---:|---:|---|---:|
| Pristine player-only8, no dummies/zombies/regionals |8|8|0 /0|2624 /64 /72|882432 (0.84)|
| Pristine Full8, seed1 R204, no dummies; two-generation/companion allowance |8|424|0 /0|139072 /3392 /3816|46768896 (44.60)|
| Pristine training8,2P dummies, lifetime150 practice births; no earned corpses |8|174|0 /0|57072 /1392 /1566|19192896 (18.30)|
| Larger generic restore: A0=256,R204,E0=4096,Q0=100 |8|926|4096 /100|307824 /11604 /16526|161605936 (154.12)|

The pristine rows use proven pristine specializations; the generic restore uses A0+14P+2R+150. Larger accepted E0/A0/Q0
costs grow by the stated formulas; there is no finite universal MiB cap in current restore admission. For example,
restored named generic source rows can be arbitrarily many unique tags while remaining structurally valid. This is a
resource-cost fact, not permission to reject safe large state by an arbitrary row cap. Root can choose a documented
resource admission policy separately, or accept dynamic sparse preparation and its memory costs. Existing8-viewer
publication refusal remains unchanged; trusted reports/private gameplay cannot be silently truncated to save these bytes.

The44.6MiB conservative Full envelope is large enough to warrant measuring actual type sizes and considering a reviewed
sparser report representation later. This packet does not claim that a dense fixed reservation is optimal. Do not lower
it merely because normal fixtures use fewer statuses; prove any sharper edge bound or use explicit fail-closed public
resource preparation without limiting authoritative aggregation. No resizing may hide inside a warm Train input phase.

### Concrete arithmetic counterexamples and choices

Structural player status admission is status_runtime::validate: no count cap, unique kind/source/key, finite value,
finite times, started_at in0..=now and until<=now+Dot.max_ms(10000). StatusSource{id:None,owner_id:None,name:...} is valid
and source provenance checks accept the empty identities. Full ability validation skips rows whose ability isNone.
Use ordinary training with abilities/factions/hazards/regen off, one healthy player and PvP rulesfalse; no unusual HP or
modifier fields are needed. Sourceless entries also bypass source-specific PvP caps if that switch were on.

1. One generic Dot value1e307: status/dot.rs computes `value * dt_ms / 1000` in that order. `1e307*50` overflows before
   division, though1e307 and the intended scaled result are finite. Default shares produce raw true damage; the ordinary
   player ledger can expose a nonfinite eligible landed amount. No report implementation is needed to observe this.
2.4096 unique generic Dot tags, value1e306 each: every `(value*50)/1000` equals finite5e304. They enter the same victim/
   byNone pair. With no barrier, player landed_share is1 even for overkill; unlike the NPC branch, it does not multiply
   each row by HP-applied/total. Thus a finite victim HP does **not** bound the trusted reported amount. Ordered addition
   first becomes+Infinity at contribution3596;4096 rows represent about2.048e308. Disposable Python binary64 evaluation
   confirmed these arithmetic points; actual native restore/step assertions are delegated below.

These are concrete accepted-shape candidates, not a claim that native execution has already passed. Current ledger
itself may already produce nonfinite transient values before Card persistence; the new World accumulator would make
that latent arithmetic hole persistent. A projector error protects public output but cannot repair World/checkpoint
safety. C-DET's layout check forbids nonfinite World floats, so tagged Infinity/NaN is not an authorized workaround.

Smallest justified decision after probe receipts:

- Keep source-required trusted sums as ordered binary64 addition, including each finite low bit. Do not replace them
  with ExactSum; that deliberately different summation belongs only to redacted public buckets.
- If probes confirm admission, allocate a **separate narrow numeric-admission repair** for unsafe generic status/deferred
  state. The necessary predicate must check actual arithmetic range/ordered group-sum safety, not a fixed tag count or
  arbitrary small magnitude. Reject only demonstrably unsafe restored arithmetic with a typed malformed-state reason;
  retain arbitrarily many safe rows and every ordinary producer result. Also account for shares/status settlement
  products and subsequent steps, rather than presenting a single value threshold as a full solution.
- If preserving the entire old generic domain is mandatory, Root needs an explicit new canonical nonfinite/overflow
  representation and C-DET/restore contract decision, not a silent Card-local change. Such a representation must preserve
  exact source arithmetic, restore/hash bits and server-only raw diagnostics while public nonfinite output fails closed.
  It is broader than the current leases and is not recommended as an incidental report mechanic change.
- Finite incoming rows plus finite existing Card amount can still overflow. New report validation must couple its own
  permitted amounts to the chosen range proof, or an authoritative checked-add failure must have an explicitly approved
  simulation error contract. Panic, clamp, drop, early private flush and saturating sum all change required behavior.

No universal numeric safety claim is made from ordinary source fixtures. The immediate next action is the bounded
three-probe task below; its receipts select a concrete small repair rather than guessing a new game limit.

### Exact three-probe DeepSeek handoff; no production repair

Root allocates a disposable test branch/worktree on this exact backend base (or records a changed base), one new
cfg(test) probe module/registration and raw evidence directory. Source/canonical fixtures and production functions stay
unchanged. Use the existing pinned offline Rust target discipline. This design author writes no Rust. Probe failures,
including an unexpected restore refusal, are results to preserve rather than reasons to weaken validators.

**Probe1: one sourceless high Dot.** Start through normal Sim constructor/add_player/ordinary first step (or the existing
reset_active facade, which constructs that same baseline) with trainingtrue, abilitiesOff, factionOff, hazardsOff,
regenfalse, pvp_rulesfalse, no dummies/quests, healthy Fire player on a valid practice-arena spawn. Obtain a real baseline
checkpoint; assert it restores before mutation. Into only that checkpoint's player's core.statuses put initializedtrue,
castNone and a Dot instance: source{id:None,name:"numeric-probe",owner_id:None}, abilityNone, unique text tag, started_at
equal checkpoint server_time, until=that time+1000, value1e307, reveal_fromNone,takenNone, Payload::default(); refresh
effects via existing source helper when constructing the diagnostic candidate. All unrelated fields remain exact.
Serialize/restore through the actual public checkpoint reader, assert and print whether accepted and exact error if not.
On acceptance call exactly one ordinary50ms step, inspect actual trusted `s.landed` diagnostic for dottrue/noability/
nosig/victim/byNone; report all amounts and finiteness, HP/status, returned events and check_layout/checkpoint result.
Expected arithmetic risk is multiply-before-divide overflow, not a fabricated pending report.

**Probe2: finite individuals, overflowing ordered pair.** Same baseline and actual checkpoint roundtrip, but4096 Dot
instances with tags `numeric-probe:0` through`:4095`, value1e306 and otherwise identical source/times/default payload.
Validate distinct keys using existing status validator, then use the actual full restore reader. On acceptance step once
and read actual eligible landed rows; assert4096 reached if source filters do not legitimately change that count, assert
each amount finite and capture its exact bits, then compute the source-order diagnostic fold from0 using ordinary+
(not ExactSum). Record first nonfinite prefix, final sum and actual call output; preserve any earlier mismatch/refusal.
No Card report implementation is added. Also print existing size_of Op/Event/SeenEvent/LandedHit and available ExactSum/
Bucket in their owning test scope, or report inaccessible types and use the field-layout estimates honestly; no public
API export merely for size measurement.

**Probe3: earned Hemorrhage on regional NPC, then restore.** Use normal Sim::try_new, validated seed1 arena export,
real add_player and ordinary raid-start step with Pve/ordinary admitted factions; choose a live regional target using
retained actor provenance/type and legal geometry. Grant real Hemorrhage through the existing cards::grant producer
(or an already admitted submitted reward-choice/training grant where compatible); declare loadout/placement setup
explicitly and do not install any Dot/status/pending report. Assert baseline checkpoint restore **after card/setup but
before hit** succeeds. Queue a real legal physical Attack and Release through validate+Sim::submit, step the normal
schedule until cards::on_hit creates an actual no-ability `bleed:{tick}` Dot on that regional actor. Inspect source/key/
duration/amount provenance and the real landed hit; checkpoint immediately while the status is present, before expiry.
Run actual restore and preserve the exact refusal, expected currently `unsupported mob status domain` from
systems/mob_checkpoint.rs:410–419, which allows only Full Blaze Dot. Do not call raw on_hit, install an expected status,
use only a player target or kill/expire the NPC to avoid the failing state. If baseline refuses, repair the probe's
ordinary declared profile first while preserving that earlier failure; do not relabel it as the intended regression.

Probe3 determines the narrow extra lease: accept **genuine source-produced Card Dot shapes on regional NPCs** in the
existing mob status checkpoint predicate, with Hemorrhage/Festering provenance/duration/key/amount validation and real
producer green/malformed negatives. It must preserve all already accepted Blaze/generic-player cases. The current
predicate is a pre-existing restore incompatibility reached by this mechanic, not evidence that no Card report state
should survive restore. Root must allocate that exact hunk and any shared status validation helper after the red receipt.

After these three receipts, return to Root with actual acceptance/amount/refusal facts and the selected small admission
repair. Numeric probes may prove that the card report design cannot yet be safely dispatched without that repair; they
must not silently become a production fix, source-oracle rewrite or broad validator refactor.
