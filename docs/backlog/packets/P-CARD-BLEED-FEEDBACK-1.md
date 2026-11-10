# P-CARD-BLEED-FEEDBACK-1: grouped card DoT hit feedback

## Outcome and dispatch status

Implement source-equivalent trusted card DoT aggregation/cadence/run-end behavior plus a separately admitted native
settled-tick Card projection. Damage/status production already exists. All Rust, readers and tests belong to DeepSeek;
Sol/Luna owns immutable source/design/independent review; Root owns dispatch, identity/version decisions, leases and
integration; Claude retains networking/Unity ownership.

**Dispatched to an isolated DeepSeek worker. Root approves B3, output/privacy, provisional capacity, identities and narrow leases at the recorded cuts below.** The single current design is [CARD_BLEED_NATIVE_DESIGN.md](../../coordination/CARD_BLEED_NATIVE_DESIGN.md). It replaces the earlier per-status/E0 capacities and 44.60 MiB estimate with exact raw-pair sidecars, sparse U0/Q0 preparation, bounded arena AVL indexes, one populated flush and explicit tagged-amount planning allowances. `CARD_BLEED_REPORT_REVIEW.md` is historical reasoning, not a competing plan. Root must recheck the active Claude/worktree cut and assign a clean worker branch; actual layout/allocation measurements are native acceptance gates. Numeric evidence is linked in the design; those probes do not implement report/index types or measure their layout/allocations.

## Released source dependency

- Corrected source transfer `c76f8e46eebebd91a25c8cd7e4f1dd88ba4f4538`; integration source seal `570fe186`.
- `parity/card-bleed-feedback/source.json`, `rh-card-bleed-source/2`, 7 cases/390 ordinary steps/410,111 bytes,
  SHA-256 `6b36256739bd473bc70ebd160a8632a26470ab8e4190f873026bd714e53d36ed`.
- `parity/card-bleed-feedback/controls.json`, 3,191 bytes, SHA-256
  `248a3be77749e9f966a9fff3ad6f7ba44ea4db4d3eddba3e0c9be9a71578fcd9`.
- Preparation manifest SHA-256 `9869a390c4f5a3ad939254d94e0ef44571397b653f3c10ec6e9d171d3bd29d8e`; source/tools/evidence stay
  immutable. Independent release: `docs/evidence/card-bleed-source-review/corrected/README.md`.

Source `/2` separates `landedSnapshot` from `processedLanded` using actual pre-dispatch active/nonvoided producer
eligibility. Tick 7/350 ms is the real ending active pass: five cumulative fresh hits flush `1.1180044891585073`. The
already-ended tick 8/400 ms retains scratch 1 but processes 0. Consumer must drive actual inputs/producers, never install
or replay retained snapshots. Inputs explicitly declare loadout/placement/HP and `startRaid` setup. Source witnesses
ordered pair grouping, first-use 500 ms/empty intervals, early run-end, teleport retention, raid reset, reached Fire
burn/backlash exclusion and no-card control. It does not establish all ability variants, anonymous pairs, arbitrary IDs,
voided-active behavior or a separately invoked empty run-end hook. No recapture or optional capture campaign is needed.

## Trusted and public output contract

Legacy `cardHooks.ts` maintains a global insertion-ordered raw aggregate and has no historical viewer audiences. Native
settled-tick entitlement/redaction is a deliberate ADR0013 privacy extension; it is not source parity.

- World stores only trusted `CardBleedReport { since: Option<f64>, rows: ordered Vec<victim/by/CardBleedAmount> }`. B3 is `Finite(nonnegative finite f64 preserving bits including -0) | PositiveInfinity | NotANumber`, a tagged finite serialization of the source-observable sequential binary64 pair fold. Preserve first insertion, row order, finite sequential-addition rounding and overflow/NaN classification. No viewer/history/visibility state is stored or
  hashed into this leaf; capacity is derived and excluded from serialization/hash.
- At the actual source flush, emit server-only raw `Event::CardBleedHit { victim, by: Option<PlayerId>, amount: CardBleedAmount }` in
  trusted row order for source comparison. It must remain `ServerOnly` in exhaustive visibility/classification and be
  absent from `observe::to_seen`, stateless/raw observation and public event filtering.
- `FxProjector` emits existing `SeenEvent::Hit { victim, by: redacted_source, amount, passive:false }` for positive
  entitled Card buckets at the Card marker. Use existing ItemObserver/public-ID authority. No new SeenEvent/wire shape,
  protocol codec, client or generated-code work; no Card/DoT/drip/weapon/ability/signature identity or legacy visual
  equivalence is promised. Reuse of Hit changes observation/policy knowledge semantics under the reserved version
  approval.
- Per completed tick, use `sees(viewer,victim) || by == viewer`, redact unseen source before grouping, and merge
  anonymous pairs. Entitlement remains from settled tick if actors later disappear; do not re-check at flush. ExactSum
  public totals remain separate from trusted source f64.

## Producer schedule and reset behavior

At existing `cards::after_damage`, scan only actual current `s.landed` in landed order. Eligibility is exactly
`dot && ability == None && sig == None`; do not invent extra passive/weapon filters. First eligible hit initializes
`since=now`; trusted matching raw pair adds in source order. At the source periodic point after stillness, if an existing
report has aged 500 ms, record CardFlush at the exact current event index even for empty rows, emit nonempty trusted rows,
clear rows retaining capacity and set `since=now`. No report means no flush marker/state creation.

Replace only the pending runEnded `cardHooks.flushBleeds` link at its exact schedule position. At the existing GateAlways
`cardHooks.resetAll` raid-start hook, reset World report to `None` and record CardReset. Legacy Reset is GateSignatures in
the released core profile and cannot substitute. CardReset clears Card only; legacy resets/flushes retain existing domain
behavior. Teleport retains Card rows/entitlement. No helper-direct test path.

The source has one active producer/landed pass. `updateActive` returns before active work for voided arenas; otherwise it
clears landed, runs the ledger once, systems once (including Card afterDamage), then settles. An ending active tick's real
pass is retained before runEnded. `cards::after_damage`'s Overkill splashes enter `w.deferred` for next tick, not another
landed pass. Therefore at most one row-containing Card segment and one populated flush envelope exist per ordinary
step. Preserve up to two CardFlush and one CardReset markers even when empty. A periodic populated flush makes the later
runEnded flush empty; otherwise runEnded may populate it. Ended/voided steps must never re-read retained scratch.

## Exact pair sidecars, capacity and allocation model

Do not emit one derived Card Op per status/contribution. Use separate preallocated exact producer and sealed-report
sidecars, each with at most one row per actual raw `(victim, Option<by>)` in the current segment. A row stores raw key and
ExactSum plus per-raw-pair local classifications for source-invalid B3 inputs and checked ExactSum accumulation/carry failure. B3 remains exactly `Finite`, `PositiveInfinity`, or `NotANumber`; the derived source-invalid result maps to typed `InvalidAmount`, while checked limb/carry failure is a separate typed `Overflow`. Reserve a small range/segment Op at the true first contribution position, append distinct pairs in first occurrence order and exact-merge finite repeats. Keep both derived classifications local until settled viewer eligibility and redaction. Finalize at CardFlush/CardReset/report end. Keep marker event index/order and
empty marker behavior; never group across Card markers/ticks or move a marker based on hidden insertion order. An inline
ExactSum in the shared Op is prohibited. Existing ExactSum needs a crate-private checked integer-limb merge (no
intermediate rounding); tests must prove equivalence to direct exact additions and carry/round failure behavior.

Same raw pair in one sealed tick has identical settled entitlement/redaction, so coalescing preserves public rows. Resolve eligibility and redact source before handling either classification. Unentitled invalid/overflowing pairs cannot affect that viewer; an eligible nonfinite source amount fails closed with existing `InvalidAmount`, while eligible checked exact accumulation/merge/rounding overflow uses `Overflow`. Neither publishes a partial prefix. Different hidden raw sources can merge only after redaction to a shared anonymous key. Keep the trusted tagged source-order fold and derived exact public sums fully distinct.

Live unqualified Card DoT keys are player producers: Hemorrhage's `bleed:{tick}` lasts 2000 ms (at most 40 tick keys per
source/victim) and Festering uses a reusable `festering` key, requiring a player's card/build. Ability/signature Dot has
its own tag. This does not restrict accepted restored generic Dot shapes. Cold constructor/clone/restore preparation must
inventory actual sparse state:

- `P = max(8,current player count)` for private prep; public viewer limit remains eight.
- `A0 = all current restored fighters`; `R = checked sum of actual possible arena camp spots`.
- `E0 = count of eligible initial no-ability Dot status rows plus eligible deferred Dot entries`; stale rows may remain
  as a safe overestimate. `U0 = distinct eligible initial status/deferred landed raw pairs` keyed by full `(victim,by)`,
  including `None`, after provenance validation. `U0 <= E0`; E0 remains relevant to numeric/status probes, not as a Card
  report row capacity.
- `Q0 = existing trusted report row count`, separately validated. Historical Q0 grants no fresh projector entitlement.

For arbitrary accepted restored state use `V=A0+14P+2R+150`, covering restored actors, future joins/dummies, regional
respawns, lifetime practice births and companion churn. Do not tighten accepted restore shapes to force small capacity.
Use pristine specializations only with proven prerequisites: player-only8 V=8; Full8/no dummies V=2P+2R=424 at R204;
pristine training8 without earned corpses V=3P+150=174. Future live source growth is bounded by PV (at most 11 passes
in the inclusive first 500 ms). The prepared capacities are:

| Domain | Capacity |
|---|---|
| Derived exact raw-pair rows per step in each producer/sealed sidecar | `K = U0 + P*V` |
| Trusted pending raw pairs/rows in one populated flush | `Q = Q0 + U0 + P*V` |
| Card public buckets for one viewer / populated flush | `B = 2*U0 + (P+1)*V` |
| Segment/markers | One populated segment; at most two CardFlush and one CardReset; preserve empty markers |

No H-squared history matrix, row clamp/truncation, small universal cap, warm growth or silently dropped trusted rows.
Unsupported public representation fails closed without capping trusted gameplay.

Use distinct preallocated deterministic indexes for trusted World rows, the current exact segment and each viewer's public
buckets. Recommended index is an arena AVL with two `usize` child indices, bounded height and full key comparison; node
ordinal maps directly to stable row ordinal. Rotations only change index links, not row order; clear root/length but retain
capacity. The segment's row-range start is its row offset. Avoid hot heap nodes/resizing HashMaps, packed 65-bit keys or
aliasing `None` with a PlayerId. Clear public index whenever Card buckets are cleared/sorted; a separate Card Vec/index
avoids stale indexes from legacy mixed-domain reorder operations.

For 64-bit planning, price each derived row at 328 B (272 B ExactSum limbs plus metadata and an 8 B allowance for local invalid-input/checked-overflow classification), trusted row at 32 B (tagged amount allowance), public bucket at 320 B, and Event/SeenEvent at 256 B. These are planning allowances, not measured Rust type sizes or guarantees that the implementation fits the budget. The event envelope is intentionally generous, but typed Event/SeenEvent sizes still need measurement. Define `I(0)=0`; otherwise `I(N)=8*next_power_of_two(2*N)+8*N` bytes. It is an index budget envelope that covers the proposed 24-byte AVL node estimate (`I(N)>=24N`), not a physical table layout. Actual Rust sizes, AVL height/depth, checked/fallible capacity growth and allocations remain later implementation gates. With two exact sidecars, one populated flush envelope and eight public viewers:

`N_new = 656K + 546Q + 4608B + I(K) + I(Q) + 8*I(B)`

| Profile | U0/Q0 | K/Q/B | Index bytes | Static bytes / MiB |
|---|---:|---:|---:|---:|
| Player-only8 | 0/0 | 64/64/72 | 24,064 | 432,768 / 0.4127 |
| Full8/R204 | 0/0 | 3,392/3,392/3,816 | 953,856 | 22,615,168 / 21.5675 |
| Training8 | 0/0 | 1,392/1,392/1,566 | 450,176 | 9,339,488 / 8.9068 |
| A0=256/R204/U0=4096/Q0=100 | 4096/100 | 11,504/11,604/16,526 | 5,961,120 | 95,995,336 / 91.5483 |
| Same restore, U0=1/Q0=100 | 1/100 | 7,409/7,509/8,336 | 3,012,144 | 50,384,650 / 48.0505 |

These are static formula evaluations using provisional planning allowances. The updated Full8 figure replaces the old 44.60 MiB estimate because the revised model coalesces rows by segment pair, prices one populated flush and includes allowances for tagged amounts and local invalid-input/checked-overflow classifications while retaining empty markers. The calculation is not a measured type size, allocation or speedup, and does not guarantee the eventual implementation fits the estimate. Excluded are fixed legacy reservations, status/tag allocations, vector headers and allocator rounding. Actual field sizes and allocations remain implementation gates. DeepSeek measures report/projector and unchanged source producer separately after the
native types exist; Hemorrhage's formatted Arc tag is an inherited allocation, so there is no whole-combat zero-allocation
claim.

## Numeric and regional restore evidence

The three reached DeepSeek probes are integrated at `97b70395` and independently reviewed in [numeric-options.md](../../evidence/card-bleed-probe-review/numeric-options.md). One accepted generic status yields an eligible +Infinity, 4096 finite eligible rows in one actual pair overflow their ordinary source-order fold at prefix 3596, and a real Attack/Release earns a regional NPC bleed before checkpoint reading rejects it. Probe receipts are evidence, not report/index implementation or layout measurements. Root approved B3: finite nonnegative values preserve their bits (including -0); tagged PositiveInfinity and NotANumber complete the narrow landed/Card aggregate algebra without IEEE nonfinite serialized floats. Preserve source-order sequential addition and do not clamp/reorder/change producer arithmetic. Per-raw-pair source-invalid and checked-ExactSum-overflow classifications stay local until settled eligibility and redaction. Eligible nonfinite source amounts cause typed `InvalidAmount`; eligible checked exact accumulation/merge/rounding overflow causes `Overflow`. Both fail closed without partial output. No special numbers cross public/wire boundaries. The independent NPC restore change is packeted separately in [P-NPC-BLEED-RESTORE-1](P-NPC-BLEED-RESTORE-1.md).

The three probes are complete; their receipts and Sol's independent review are linked above. They do not measure proposed Card report/index type sizes or warmed allocations. Those remain later implementation gates. The narrow NPC checkpoint repair is proposed separately in [P-NPC-BLEED-RESTORE-1](P-NPC-BLEED-RESTORE-1.md).
## Identity, ownership and protected work

Proposals only; Root revalidates/reserves against final integration and Claude cuts: checkpoint 29→30, replay 23→24,
OBS 21→22, policy 15→16, and a new content visitor marker such as `card-bleed-feedback/1`. The World leaf changes hash
even when absent; metadata-only updates are insufficient. Root authorizes a native tape re-record only after the final
native consumer runs all 63 admitted ability source cases, preserving source comparisons and genuine failures. Protocol14
codec shape stays unchanged; existing Rust/C#/JS decoder and publish/header checks remain required.

After Root dispatch only, DeepSeek's native lease is limited to the new mechanic/test/evidence files and exact related
hunks: `systems/mod.rs`; World/default/cold preparation in `state.rs`/`sim.rs`/checkpoint validation; actual producer in
`cards/after_damage.rs`; GateAlways reset in `cards/runtime.rs`; exact pending run-ended schedule link; server-only Event
and raw observation exclusion; `fx_report.rs`, `fx_projector/mod.rs`, private scratch/index capacities and checked
ExactSum merge; new focused source/privacy/schedule/hash/restore/allocation tests; narrow content/version assertions.
The regional NPC checkpoint predicate is a separate packet and lease. Independently review its actual producer shape, retained timing and actor-history semantics before dispatch. Any
additional exhaustive Event consumer must be returned to Root for an exact hunk lease, not assumed in scope.

All source/tools/corpus/evidence, unrelated card/status rules, existing trusted f64 order, actor/wire/client paths beyond
reserved contract versions, Claude networking/Unity leases, protocol fixtures, Cargo.lock, shared status and primary
checkout remain protected. Root alone integrates, reserves identities, authorizes golden updates and edits shared status.
No source-only release authorizes native implementation or public activation.

## Acceptance after dispatch

After Root dispatch, DeepSeek must:

1. Replay all seven immutable source cases with actual producers/ordinary 50 ms steps; compare trusted rows/order/f64,
   cadence, natural run-end/reset, and `/2` processed-vs-retained facts.
2. Reach exact pair coalescing and test the one-segment/one-populated-flush premise; both empty/populated periodic and
   runEnded markers; voided/Ended scratch retention; signatures-off reset; teleport retention; deferred adjacency; and
   Card/legacy reset isolation.
3. Prove settled entitlement, exact redaction-before-grouping, anonymous merges/permutations, hidden-history privacy,
   source/victim departure, viewer-owned `by`, player/NPC IDs>8, and no raw/stateless leak or identity grant.
4. Prove checked ExactSum merge/carry/round behavior, cold/rebind/clone/restore preparation, fresh post-attach entitlement,
   duplicate/gap/backward/foreign/error fail-closed behavior, no partial output, actual type sizes and warmed allocations.
   Observation cadence must not alter trusted World hashes/gameplay.
5. Run focused affected card/status/report/projector/schedule, checkpoint/hash/content/replay/version, all 63 admitted
   source ability cases, allocation witnesses, scoped lint/fmt; preserve raw failures/commands/runtime/exit receipts.
   Root coordinates the joint decoder/publish/headless gate once on the admitted union.

No native admission, universal memory cap, historical viewer audience in legacy source, all-ability coverage, full client
animation parity, speedup or zero-allocation claim follows until Root reviews final code/evidence. Root alone integrates and
updates shared status.

## Root dispatch reservations and final output guards (2026-11-10)

The independent dispatch-readiness review resolves the remaining design questions. At integration `ecaba4e0` and clean Claude primary `3eea4656`, Root reserves checkpoint30/replay24/OBS22/policy16 plus the `card-bleed-feedback/1` content marker for this isolated Card packet. Protocol14 codec shape remains unchanged. Recheck the exact current cut before the eventual worker assignment and union; this reservation does not authorize edits in Claude's checkout. Production remains not dispatched until Root assigns its clean worker branch. Do not require preimplementation allocation measurements: measured layout/allocation are native acceptance gates.

Strict B3 intake applies to both trusted World report rows and serialized `World.pending_events` CardBleedHit values. Reject negative/nonfinite Finite payloads, unknown/ambiguous tags, duplicate discriminants/fields, missing/extra payloads, and payloads attached to special tags. Preserve allowed finite signed zero. Enforce actual retained actor provenance, unique complete raw pairs and report clock/state invariants. Exercise both real decode/restore paths; validating only the main report is insufficient. No IEEE special float or null alias may enter either stored path.

After viewer eligibility/redaction and exact public f64 rounding, but before staging any Card SeenEvent, check whether the actual existing `amount as f32` conversion is finite. If it is not, fail that viewer closed with typed Overflow and clear staged output under the existing failure policy. Keep the original f64 amount unchanged when the cast is finite, including values that round to finite f32 max. Do not clamp, use an arbitrary f64 cutoff, round the exact sum early, or change the shared wire adapter/codec. Require focused cast-boundary/overflow, hidden-unentitled and no-partial-prefix controls. This is the Card-only representation guard needed by the existing Hit wire field.

Root additionally leases only these raw Event match arms: `rh-parity/src/canon.rs::canon` explicitly omits CardBleedHit with a bounded-scenario comment; the dedicated Card source consumer must compare the typed event directly and never use that omission. `rh-headless/src/digest.rs::OutcomeDigest::event` folds a new discriminator, victim, optional source and canonical B3 tag plus finite bits into its existing trusted/private diagnostic. Never decode special tags to f64 or expose this digest through policy/client observations. Other unexpected consumers still require an exact scope decision.

The primary's lower observe.rs changes and cfg(test) fighter_churn_tests registration in systems/mod.rs remain protected; only the previously assigned upper raw-event omission/OBS constant and separate new module registration are allowed. Whole-file replacement is prohibited. The pending NPC predicate repair is a separate packet and carries no Card state/version work.

## Active Root implementation lease

Root dispatches this packet on `codex/deepseek-card-bleed-feedback` in `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-card-bleed-feedback`, from exact integration `31a5df0b` plus this documentation transfer. Fresh primary check at clean `edc60c50` confirms the same29/23/21/15/14 identities and only the previously recorded lower observe.rs and fighter_churn_tests registration differences in examined shared paths. The approved isolated reservations30/24/22/16, unchanged wire14 and new content marker apply. No permission mode expansion, primary checkout edit, merge, push or deployment is allocated.

All implementation/test Rust is DeepSeek-owned. In addition to the exact existing hunks above, new helper/test files may live only under `systems/card_bleed_feedback.rs` and `systems/card_bleed_feedback/**`, `fx_report/card.rs` and `fx_report/card/**`, `fx_projector/card.rs` and `fx_projector/card/**`; use only needed files. Module declarations in their existing parents are allocated. The existing state/sim/scratch/events/hash/checkpoint/replay/schedule/content and approved upper observe/report/projector/ExactSum/card hook hunks are limited to this mechanic. Policy lib.rs may change only its reserved contract constant and exact corresponding assertion. Focused existing hash/checkpoint/replay/content/schedule/allocation/version tests may receive only Card-specific assertions or identity updates. Sanitized evidence belongs in NEW `docs/evidence/card-bleed-native/**`. The two additional raw Event arms are allocated exactly as described above; report other concrete exhaustive consumers before editing them.

All source fixtures, source tools and expected source outputs remain immutable. Content and native ability-tape golden updates are NOT preauthorized: first run the actual full63 ability source comparisons and preserve genuine mismatches, then report the exact newly derived identity/tape need to Root. Never turn a recorder into a source oracle or drop cases. Root authorizes the derived recorder/pin step separately after those results. Record exact commands/cwd/flags/exits and first failures as work happens. Keep complete private checkpoints/state transcripts outside Git.

The independent NPC bleed restore worker owns mob_checkpoint.rs and its focused tests. Do not duplicate or bypass its repair. Card implementation may proceed in parallel; Root will transfer an admitted NPC fix before combined NPC/checkpoint acceptance if needed. Quest and bot strategy worktrees and all Claude scopes remain protected. Use the pinned offline toolchain and a worktree-local target; a metadata-write refusal is a handoff for Root sealing, not a reason to expand permissions.
