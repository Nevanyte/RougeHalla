# Card bleed native design — pending dispatch

**Status: dispatched to an isolated DeepSeek worker. Root approves the output/privacy contract, B3 typed amounts, provisional capacity plan, identities and narrow leases at the recorded cuts below; recheck the current cut when assigning the worker.** This is the single current native design for P-CARD-BLEED-FEEDBACK-1. It incorporates the static representation and capacity review in [CARD_BLEED_REPORT_REVIEW.md](CARD_BLEED_REPORT_REVIEW.md), which remains historical reasoning rather than a competing plan. The older per-status/E0 memory model is superseded. The three DeepSeek numeric/restore probes and Sol review are linked below; they do not implement report/index types or measure their sizes/allocations. All Rust/tests/probes belong to DeepSeek. Root owns dispatch, identity/version decisions, leases and integration. No source recapture or native implementation is authorized by this design alone.

## Frozen source and contract

Released source: integration `570fe186`, independently reviewed transfer
`c76f8e46eebebd91a25c8cd7e4f1dd88ba4f4538`; `parity/card-bleed-feedback/source.json`, format
`rh-card-bleed-source/2`, 7 cases/390 ordinary steps/410,111 bytes, SHA-256
`6b36256739bd473bc70ebd160a8632a26470ab8e4190f873026bd714e53d36ed`. Controls: 3,191 bytes, SHA-256
`248a3be77749e9f966a9fff3ad6f7ba44ea4db4d3eddba3e0c9be9a71578fcd9`; preparation manifest SHA-256
`9869a390c4f5a3ad939254d94e0ef44571397b653f3c10ec6e9d171d3bd29d8e`. Source, capture tools and released evidence
remain immutable. Independent release review: `docs/evidence/card-bleed-source-review/corrected/README.md`.

The corrected source distinguishes retained `landedSnapshot` from fresh `processedLanded` using the actual
pre-dispatch active/nonvoided producer guard. In `run-ended-before-periodic-window`, tick 7/350 ms processes the fifth
fresh hit and flushes five cumulative hits totaling `1.1180044891585073`; already-ended tick 8/400 ms retains one raw
scratch row but processes zero. Native tests must run actual scheduled producers and never replay/install snapshot rows
as damage. Source inputs explicitly declare loadout, placement, HP and the raid-start boundary.

The seven cases witness ordered repeated/distinct pairs, first-use 500 ms cadence/empty intervals, natural early run-end,
teleport retention, explicit `startRaid` reset, reached Fire burn/backlash exclusion, and a no-card control. They do not
cover all ability-tagged variants, anonymous source pairs, arbitrary IDs, a voided-active scenario, or a separately
invoked empty `runEnded` hook. No extra capture or broad source campaign is requested.

Legacy `cardHooks.ts` stores ordered raw victim/source totals and publishes a global raw aggregate. Historical viewer
audiences do not exist in that source. Native settled-tick entitlement/redaction is a deliberate ADR0013 privacy
extension, not source parity. Preserve the trusted global aggregate separately from public per-viewer projection.

Root approves these two outputs under the recorded isolated-lane reservation:

1. Server-only `Event::CardBleedHit { victim, by: Option<PlayerId>, amount: CardBleedAmount }`, once per trusted raw pair at flush in source
   insertion order. Exhaustive event visibility/classification remains `ServerOnly`; `observe::to_seen` returns none.
   This is a trusted source comparison diagnostic, never public `Event::Hit`.
2. At a Card marker, `FxProjector` emits existing `SeenEvent::Hit { victim, by: redacted_source, amount, passive: false }`
   for entitled positive public buckets in existing stable key order. Existing ItemObserver/public-ID preparation and Hit
   wire mapping remain the identity authority. The payload conveys bounded victim/source/amount feedback only; it adds
   no Card/DoT/drip, weapon, ability or signature identity and promises no legacy drip animation or Unity equivalence.

Codec shape is unchanged; reuse of `Hit` changes observation/policy knowledge semantics under the Root-approved
OBS/policy reservation below. No Unity/network/client change is in this worker's scope.

## Trusted report, cadence and scheduled producers

World owns one serde/hashed `CardBleedReport { since: Option<f64>, rows: ordered Vec<CardBleedBucket { victim, by, amount: CardBleedAmount }> }`. `CardBleedAmount` is the closed B3 enum `Finite(nonnegative finite f64, preserving bits including -0) | PositiveInfinity | NotANumber`; tagged variants carry no IEEE nonfinite float. `None` means the source WeakMap has no report; `Some(now)` with empty rows remains meaningful after a periodic flush. Capacity is derived, never serialized/hashed. World contains no viewer, sight mask, position history, contribution tape, projector identity or session state. The trusted report retains source insertion order and emulates the source sequential binary64 `+=` in landed order: finite additions retain ordinary f64 rounding, finite overflow becomes `PositiveInfinity`, and NaN is absorbing. Do not reorder or exact-sum trusted additions.

At the existing `cards::after_damage` schedule point, consume only that step's actual `s.landed`, in its existing order.
Eligible rows satisfy `dot == true && ability == None && sig == None`; do not add passive/weapon predicates the source
does not use. First hit creates the report with `since = now`. Repeated raw `(victim, by)` rows add to the trusted
ordered pair. Preserve unrelated streak/Wish/stillness/splash behavior and existing source order.

At the source periodic check after existing stillness, when `report exists && now - since >= DOT_FX_MS (500)`, record a
CardFlush at the current event index even if rows are empty; emit nonempty raw CardBleedHit rows in trusted insertion
order; clear rows while retaining capacity and set `since = now`. Do not create a report or marker if none exists.
Replace only the pending `RUN_ENDED` link `cardHooks.flushBleeds` at its exact schedule position. Do not call a flush
helper directly in tests. At the existing GateAlways `cardHooks.resetAll` raid-start link, clear the trusted report to
`None` and record a CardReset. The legacy signature Reset is GateSignatures and is insufficient in the released core
profile. Teleport retains the Card report and Card projector state; it neither flushes nor resets them.

The one-populated-segment/flush bound follows from source/native ordering: `step.ts` returns before active work for a
voided arena; otherwise an active pass clears landed once, runs one ledger pass, one systems pass including
`cardHooks.afterDamage`, then settles. If the active tick ends the run, its already-real periodic contribution pass is
retained and runEnded comes later. A populated periodic flush clears its rows before the later runEnded marker; if the
periodic check does not populate/flush, runEnded may be the populated flush. Rust `cards::after_damage` resolves
Overkill splashes into `w.deferred` for the next tick, not a second current landed pass. Ended/voided steps must never
revisit retained `s.landed`. Thus at most one contribution segment with rows and one populated flush output envelope
exist per ordinary step, while up to two CardFlush markers and one CardReset marker must still be represented and
validated. A future producer after a Card boundary requires a new reviewed bound.

## Exact derived sidecar and settled projection

Do not emit/store a per-status Card `Op` for every landed hit. Keep two private, preallocated exact Card row sidecars:
one producer segment and one sealed/derived report segment. Each row stores raw victim/by identity, `ExactSum` finite limbs, and local derived flags for source-invalid B3 amounts and checked ExactSum accumulation failure. Keep `PositiveInfinity`/`NotANumber` as the trusted B3 tags; derived invalid source input maps to the viewer error `InvalidAmount`, while checked limb/carry failure is a distinct typed `Overflow`. There is a small segment/range reference in `Op`, not an inline `ExactSum` in the shared operation enum. Both derived classifications remain local through settlement and are not global report/projector errors. Reserve the segment
marker at the first eligible contribution's actual operation position, append distinct raw pairs in first occurrence
order, and merge repeated hits to the pair's exact sum. Finalize the range at the next CardFlush/CardReset boundary or
report end. The marker can refer to a sidecar finalized later in the same step because the report is not externally
complete until sealing. Preserve empty flush/reset markers and exact event indices; never infer/move a marker from hidden
raw insertion order. Same-segment coalescing may cross legacy-only markers because Card has no output before its own
marker and other domains do not clear it; never coalesce across Card boundaries.

At sealing, freeze existing settled viewer membership and player/NPC sight for the completed tick. For each exact raw
pair use the established `sees(viewer, victim) || by == Some(viewer)` entitlement predicate and the same settled sight
to redact `by` **before** forming a public key. Same raw pair contributions in that completed tick have identical
eligibility and redaction; this is why exact pair coalescing is safe within a segment. It does not permit coalescing
across ticks, where sight/entitlement may change. Distinct hidden sources may merge into the same anonymous
`(victim, Card)` bucket; named and anonymous buckets can coexist.

Merge finite exact integer limbs into the public `ExactSum` bucket without an intermediate f64 round; preserve both source-invalid and checked accumulation/carry classifications locally beside the finite limbs. At settlement, resolve viewer entitlement and redact the source before inspecting/composing classifications. An unentitled invalid/overflowing pair cannot affect that viewer. An eligible nonfinite source amount fails that viewer closed with existing typed `InvalidAmount`; an eligible checked exact accumulation/merge/rounding overflow uses typed `Overflow`. Clear staged output on either error. Never emit a partial prefix, clamp, omit the bad bucket, or serialize/send IEEE NaN/Infinity. Trusted World remains the separate source-ordered f64-equivalent tagged fold. `ExactSum` currently has no merge method; add a
crate-private checked carry merge and test merge partitions/permutations, carries, subnormal/normal transitions,
halfway ties, signed zero/zero, max finite, limb overflow and rounded overflow independently. Do not round a segment or
tick to f64, change source order, or use derived totals to update World.

At CardFlush, process ordinary events up to the marker, omit all server-only raw CardBleedHit rows from every raw or
stateless observer path, then emit positive Card public buckets as `Hit(passive:false)` in stable existing public-key
order. Clear Card buckets/index only. CardReset clears only Card; legacy Signature/Ability/Instant flushes and Reset keep
their existing domains and do not accidentally clear Card. Preserve entitlement despite later source/victim removal; do
not re-check sight at flush. Final ItemObserver preparation remains the identity authority. Feed complete reports for
every ordinary, empty and terminal step independent of policy publication cadence. No raw global total may leak through
`to_seen`, stateless observation, event filtering, or fallback publication.

Clone/checkpoint preserves only trusted World time/ordered rows. A derived report gets fresh instance identity and stays
incomplete until a complete step. Fresh attach/reconnect starts after current tick with empty Card buckets; Q0 historical
trusted totals confer no historical entitlement. Duplicates are idempotent, gaps/backwards/foreign/invalid/bounds failure
clear or disable public entitlement through the existing typed error path until rebind. Never clear trusted gameplay
rows because one projector/viewer fails, and never publish a partial prefix or retry raw totals.

## Capacity model (replaces the earlier E0/per-status estimate)

The old `C = E0 + 41*P*V` Card operation bound, two-populated-flush event multiplier, and resulting 44.60 MiB Full8
estimate are obsolete. E0 remains useful to numeric/status admission probes, but is not the Card report row cardinality.
The new bound coalesces same-segment hits by the full raw landed pair `(victim, Option<by>)`.

Live unqualified Card DoT sources are players: Hemorrhage is a player card on-hit producer, has a 2000 ms status and
uses `bleed:{tick}` (at most 40 live tick keys/source-victim); Festering requires a player's build/card and reuses one
`festering` key. Both remain separate hit predicates in source; only their raw pair count matters to the new sidecar.
Ability DoT has an ability tag and signature DoT has a signature tag. This is a finite live-source premise, not a claim
about arbitrary restored statuses. Players can be removed but their raw IDs remain meaningful to pending rows.

For cold constructor/clone/restore preparation define:

- `P = max(8, current player count)` for private producer preparation only; public viewers remain independently bounded
  by the existing eight-seat limit.
- `A0 = all current restored fighters`, including extra actors/dummies/companions.
- `R = checked sum of actual potential regional camp spots for the arena/config`.
- `E0 = count of eligible initial no-ability Dot status rows plus eligible deferred Dot entries`; stale rows may remain
  in this count as a safe overestimate for inventory.
- `U0 = distinct eligible initial status/deferred landed raw pairs`, deduplicated by full `(victim, by)`; include `None`,
  validate provenance, and do not require IDs to be current actors. `U0 <= E0` because every distinct pair has at least
  one counted row. E0 remains relevant to numeric/status probes, not a Card report row capacity.
- `Q0 = existing trusted Card report raw-pair row count`, separately inventoried and validated. It contributes no fresh
  projector entitlement.

For arbitrary accepted restore use `V = A0 + 14*P + 2*R + 150`, covering current actors, future joins/dummies, two
regional generations, lifetime practice births and companion churn. Never price generic accepted restore as a pristine
room or tighten old restore admission to enforce a small capacity. Use only proven pristine specializations when their
prerequisites hold: player-only 8 has `V=8`; Full8/no dummies has `V=2*P + 2*R = 424` at seed1 `R=204`; pristine
training8 with no earned corpses has `V=3*P+150=174`. Extra restored actors always stay in A0. The inclusive first
500 ms window is at most 11 fixed 50 ms passes; future live source growth is bounded by `P*V` distinct new raw pairs.

Use one capacity set:

| Domain | Capacity |
|---|---|
| Derived exact raw-pair rows per step, in each of producer and sealed sidecars | `K = U0 + P*V` |
| Trusted pending ordered pairs/raw rows in one populated flush | `Q = Q0 + U0 + P*V` |
| Card public buckets for one viewer and one populated public flush | `B = 2*U0 + (P+1)*V` |
| Card markers/segments | One populated segment, up to two CardFlush and one CardReset markers; retain empty markers |

The public bound allows each initial generic pair to be named and anonymous over different ticks; fresh projectors never
inherit Q0. `U0` can be large under accepted state, so this is sparse proportional preparation, not a new universal small
cap. No H-squared history matrix, clamp, row truncation, warm-growth shortcut or arbitrary new restore count limit.
Use checked add/multiply/next-power-of-two and fallible reserve; an unsupported public representation fails closed,
while trusted simulation aggregation remains lossless.

For 64-bit planning only, price a derived Card row at 328 B (272 B ExactSum limbs plus metadata and an 8 B allowance for local invalid-input/checked-overflow classification), a trusted row at 32 B (tagged amount allowance), a public bucket at 320 B and Event/SeenEvent at 256 B. These are planning allowances, not measured Rust sizes or guarantees that the implementation fits the budget. The event envelope is intentionally generous, but typed Event/SeenEvent sizes still need measurement. Two exact sidecars cost `656K`. One populated raw flush in the two event buffers plus its two-byte wish mask and trusted rows costs `546Q`. Eight viewers' public buckets plus one populated SeenEvent vector costs `4608B`. Define the preallocated AVL index budget envelope `I(N) = 0` for N=0, otherwise `8*next_power_of_two(2*N) + 8*N`. Then:

`N_new = 656K + 546Q + 4608B + I(K) + I(Q) + 8*I(B)`

Use separate deterministic indexes for the trusted World pair vector, current exact report segment, and each viewer's
Card public bucket vector. Recommended index is a preallocated arena AVL tree; each node has two `usize` child indices
and bounded height, maps ordinal directly to its stable insertion-ordered row, and uses full `(u32 victim, Option<u32> by)`
keys. Rotations alter links only, never row order; reset length/root while retaining capacity. The segment range start is
the index's row offset. The I(N) term is an index **budget envelope**, not the physical table layout: `next_power_of_two(2N)
>= 2N`, so I(N) covers the proposed 24-byte AVL node estimate. Actual node/type size, height bounds, stack/depth,
checked growth and allocation remain implementation gates. Avoid per-entry heap nodes, resizing HashMaps, cloned heap
keys, packed 65-bit keys, or aliasing `None` to a PlayerId. A separate Card public Vec/index avoids stale links when
legacy sort/retain operations move other-domain rows.

Static formula evaluation only (MiB uses 1,048,576 bytes):

| Profile | U0/Q0 | K / Q / B | Index bytes | N_new bytes / MiB |
|---|---:|---:|---:|---:|
| Pristine player-only 8 | 0/0 | 64 / 64 / 72 | 24,064 | 432,768 / 0.4127 |
| Pristine Full8, R=204 | 0/0 | 3,392 / 3,392 / 3,816 | 953,856 | 22,615,168 / 21.5675 |
| Pristine training8 | 0/0 | 1,392 / 1,392 / 1,566 | 450,176 | 9,339,488 / 8.9068 |
| Restore A0=256, R=204, U0=4096, Q0=100 | 4096/100 | 11,504 / 11,604 / 16,526 | 5,961,120 | 95,995,336 / 91.5483 |
| Same restore, U0=1, Q0=100 | 1/100 | 7,409 / 7,509 / 8,336 | 3,012,144 | 50,384,650 / 48.0505 |

These provisional static Full8 numbers replace the former 44.60 MiB estimate because the revised representation stores one exact pair per segment, prices one populated flush and includes planning allowances for tagged trusted amounts and local invalid-input/checked-overflow classifications while retaining empty markers. They are not measured allocations or speedups. Actual Rust field sizes, Vec/index allocations and allocator overhead must be measured after implementation; these estimates exclude fixed legacy reservations, existing status/tag allocations, vector headers and allocator rounding.
DeepSeek must print actual sizes and measure first/repeated windows, high multiplicity on a few pairs, many unique pairs,
clone/restore/rebind and real unchanged producer path after native implementation. Hemorrhage formats/allocates
`bleed:{tick}` tags and other source/status paths already allocate; report reservation cannot imply whole-combat zero
allocation. Separate new report/projector allocations from inherited producer allocations.

## Numeric and regional restore evidence and decisions

The [DeepSeek probes](../evidence/card-bleed-native-probes/README.md), evidence integrated at `97b70395`, and Sol's [independent numeric review](../evidence/card-bleed-probe-review/numeric-options.md) establish three reached paths: one accepted generic status yields an eligible +Infinity; 4096 finite eligible rows form one actual pair whose ordinary ordered fold overflows at prefix 3596; and a real Attack/Release earns a regional NPC Card bleed before checkpoint reading rejects it with `unsupported mob status domain`. The probe code was restored; these probes did not implement report/index types or measure their sizes/allocations.

Root approved B3 for trusted Card reporting: `CardBleedAmount = Finite(nonnegative finite f64, preserving source-observable bits including -0) | PositiveInfinity | NotANumber`. This narrowly represents the reached landed multiplication and ordered Card aggregation outcomes without storing IEEE nonfinite floats. Preserve first insertion/order and every ordinary finite sequential `+=`; finite overflow transitions to PositiveInfinity, NaN is absorbing. Do not clamp, reorder, change producer arithmetic, add a generic restore magnitude threshold, or send special numbers over the wire. `CardBleedHit` remains a server-only typed diagnostic. This does not establish safe arithmetic outside Card reporting or change generic accepted statuses.

For public projection, keep each derived raw-pair source-invalid and checked-ExactSum-overflow classification local until settled eligibility and source redaction are known. An unentitled invalid/overflowing pair must not poison a viewer. An eligible nonfinite source amount uses existing typed `InvalidAmount`; an eligible checked exact accumulation/merge/rounding overflow uses `Overflow`. Both fail that viewer closed without partial output. No IEEE NaN/Infinity is serialized as a float, emitted publicly, or converted to JSON null. B3 is approved. The plan, identities and narrow leases are approved at the recorded cuts below; production dispatch still requires a clean worker assignment and fresh cut check.

The three probes are complete; their receipts and Sol's review are linked above. They do not measure proposed report/index sizes or warmed allocations. Those remain later native implementation gates. The separate narrow NPC checkpoint repair is proposed in [P-NPC-BLEED-RESTORE-1](../backlog/packets/P-NPC-BLEED-RESTORE-1.md); its exact predicate must be checked against actual producer fields and checkpoint clock/history semantics before dispatch.
## Planned identities, ownership and write leases

Root reserves the following identities at integration `ecaba4e0` / primary `3eea4656`; revalidate the current cut at dispatch and union:
checkpoint 29→30 for serialized/hash state, replay 23→24, OBS 21→22 and policy 15→16 for changed knowledge semantics
under ADR0013, plus a new content visitor marker such as `card-bleed-feedback/1`. Existing protocol14 codec shape stays
unchanged. A new World leaf changes hashes even when absent; metadata-only pin edits are insufficient. Root authorizes
any native hash tape re-record only after all 63 admitted ability source cases run on final native code, retaining every
source comparison and genuine mismatch. Never rewrite source fixtures, drop cases or pre-authorize golden updates.

DeepSeek's eventual native lease, after Root dispatch, is limited to the new mechanic/test/evidence files and exact
hunks needed for the stated behavior: `systems/card_bleed_feedback.rs`; one new report/test module; registration in
`systems/mod.rs`; World leaf/default/preparation in `state.rs`/`sim.rs`/checkpoint validation; scheduled producer at
`cards/after_damage.rs`; GateAlways reset at `cards/runtime.rs`; existing run-ended pending link; server-only Event and
raw observation exclusion; `fx_report.rs`, `fx_projector/mod.rs`, private scratch capacities and exact checked merge;
real hash/restore/allocation tests; narrow content/version assertions and focused schedule classification only where
required. The regional NPC checkpoint predicate is a separate packet and lease. Independently review its actual producer shape, retained timing and actor-history semantics before dispatch.
An unexpected exhaustive Event consumer returns its exact hunk to Root; no implicit expansion.

Protected/read-only: all source fixtures/capture tools/evidence, cards and status gameplay outside the exact hooks,
existing trusted f64 order, actor/wire/client paths, public observation schema beyond the reserved contract version,
protocol/golden codecs, Claude networking/Unity leases, Cargo.lock and shared status. Root rechecks exact source/worktree
pins and Claude's current cut; no whole-file copies or shared status edits. Source-only release does not activate native
or public behavior.

## Acceptance and dispatch gate

Before implementation Root must recheck the current source/shared-file cut and assign the approved plan to an isolated clean Rust
branch/private target with pinned offline toolchain. Then DeepSeek must:

1. Replay all seven immutable source inputs via real scheduled producers and ordinary fixed 50 ms steps, comparing
   trusted source pair/order/f64/cadence/reset/run-end behavior and the `/2` fresh-vs-retained distinction.
2. Reach exact raw-pair grouping and marker boundaries; prove the one-segment/one-populated-flush premise, both empty
   and populated periodic/runEnded markers, voided/Ended scratch retention, signatures-off CardReset, teleport retention,
   and `payLater` adjacency. Keep Card flush/reset isolated from legacy domains.
3. Compare settled entitled projections, redaction-before-grouping, anonymous merges/permutations, hidden-history privacy,
   visible→hidden departure/removal, viewer's own `by`, IDs>8/NPC victims, cross-domain markers, source/subject removal,
   and ensure no raw/stateless/public path leaks aggregate totals or grants handles.
4. Cover exact merge partitions/permutations, checked carries/rounded overflow, cold World/scratch/index preparation and
   clone/restore/rebind, fresh entitlement after attach, duplicate/gap/backward/foreign/failure behavior, no partial
   publication, actual sizes and warmed allocations. Observation cadence must not alter World hashes/gameplay.
5. Run affected card/status/report/projector/schedule, checkpoint/hash/content/replay/version tests, all 63 admitted source
   ability cases, allocation witnesses, strict scoped lint/fmt, and preserve first failures plus exact final receipts.
   Root runs joint decoder/publish/headless compatibility once for the admitted union.

All proof remains bounded to the frozen source cases and explicitly listed controls. It does not claim 181-independent
cardinality cap, arbitrary ability variants, historical viewer audiences in source, full client animation parity, or
native admission before Root's final review. Root alone integrates, authorizes derived pins and updates shared records.

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
