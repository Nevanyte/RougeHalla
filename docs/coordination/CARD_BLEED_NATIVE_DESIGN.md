# Card bleed native design — pending dispatch

**Status: planned, not dispatched; numerical admission decision still pending.** This is the single current native design
for P-CARD-BLEED-FEEDBACK-1. It incorporates the static representation and capacity review in
[CARD_BLEED_REPORT_REVIEW.md](CARD_BLEED_REPORT_REVIEW.md); that review remains historical reasoning/evidence, not a
second implementation plan or an admission record. The older per-status/E0 memory model below is superseded. Three
DeepSeek numeric/restore probes run separately on the assigned private probe branch; their results, Root's arithmetic
admission choice, and final cross-worktree/Claude lease recheck remain prerequisites to native dispatch. The probes do
not implement report/index types and do not measure their sizes or allocations. All Rust/tests/probes are DeepSeek's
work. Root owns dispatch, identity/version decisions, leases and integration. No source recapture or native implementation
is authorized by this design alone.

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

Two outputs are planned, subject to Root approval:

1. Server-only `Event::CardBleedHit { victim, by: Option<PlayerId>, amount }`, once per trusted raw pair at flush in source
   insertion order. Exhaustive event visibility/classification remains `ServerOnly`; `observe::to_seen` returns none.
   This is a trusted source comparison diagnostic, never public `Event::Hit`.
2. At a Card marker, `FxProjector` emits existing `SeenEvent::Hit { victim, by: redacted_source, amount, passive: false }`
   for entitled positive public buckets in existing stable key order. Existing ItemObserver/public-ID preparation and Hit
   wire mapping remain the identity authority. The payload conveys bounded victim/source/amount feedback only; it adds
   no Card/DoT/drip, weapon, ability or signature identity and promises no legacy drip animation or Unity equivalence.

Codec shape is unchanged; reuse of `Hit` still changes observation/policy knowledge semantics and requires Root's
contract/version decision. No Unity/network/client change is in this worker's scope.

## Trusted report, cadence and scheduled producers

World owns one serde/hashed `CardBleedReport { since: Option<f64>, rows: ordered Vec<CardBleedBucket { victim, by, amount }> }`.
`None` means the source WeakMap has no report; `Some(now)` with empty rows remains meaningful after a periodic flush.
Capacity is derived, never serialized/hashed. World contains no viewer, sight mask, position history, contribution tape,
projector identity or session state. The trusted report retains source insertion order and does each original sequential
binary64 `+= amount` in landed order.

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
one producer segment and one sealed/derived report segment. Each row stores raw victim/by identity and `ExactSum`; there
is a small segment/range reference in `Op`, not an inline `ExactSum` in the shared operation enum. Reserve the segment
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

Merge exact integer limbs into the public `ExactSum` bucket without an intermediate f64 round. Exact addition is
associative and commutative, so it matches the original per-contribution exact public fold and rounds once at the
CardFlush. Trusted World remains the separate source-ordered f64 fold. `ExactSum` currently has no merge method; add a
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

For conservative 64-bit planning, price exact Card row at 320 B (including metadata; `ExactSum` limbs alone are 272 B),
trusted row at 24 B, public bucket at 320 B and Event/SeenEvent at 256 B. These are estimates, not measured Rust sizes.
Two exact sidecars cost `640K`. One populated raw flush in the two event buffers plus its two-byte wish mask and trusted
rows costs `538Q`. Eight viewers' public buckets plus one populated SeenEvent vector costs `4608B`. Define the
preallocated AVL index budget envelope `I(N) = 0` for N=0, otherwise `8*next_power_of_two(2*N) + 8*N`. Then:

`N_new = 640K + 538Q + 4608B + I(K) + I(Q) + 8*I(B)`

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
| Pristine player-only 8 | 0/0 | 64 / 64 / 72 | 24,064 | 431,232 / 0.4113 |
| Pristine Full8, R=204 | 0/0 | 3,392 / 3,392 / 3,816 | 953,856 | 22,533,760 / 21.4899 |
| Pristine training8 | 0/0 | 1,392 / 1,392 / 1,566 | 450,176 | 9,306,080 / 8.8750 |
| Restore A0=256, R=204, U0=4096, Q0=100 | 4096/100 | 11,504 / 11,604 / 16,526 | 5,961,120 | 95,718,440 / 91.2842 |
| Same restore, U0=1, Q0=100 | 1/100 | 7,409 / 7,509 / 8,336 | 3,012,144 | 50,206,034 / 47.8802 |

The static Full8 estimate replaces the former 44.60 MiB estimate because the revised representation stores one exact
pair per segment and prices one populated flush, while retaining empty markers. It is not a measured allocation or
speedup and excludes fixed legacy reservations, existing status/tag allocations, vector headers and allocator rounding.
DeepSeek must print actual sizes and measure first/repeated windows, high multiplicity on a few pairs, many unique pairs,
clone/restore/rebind and real unchanged producer path after native implementation. Hemorrhage formats/allocates
`bleed:{tick}` tags and other source/status paths already allocate; report reservation cannot imply whole-combat zero
allocation. Separate new report/projector allocations from inherited producer allocations.

## Numeric and regional restore probes — admission pending

Static review found accepted-shape arithmetic risks, not runtime receipts: one `1e307` Dot can overflow `value*50` before
division; 4096 distinct sourceless `1e306` Dot rows produce finite individual `5e304` contributions but their
source-order same-pair sum reaches Infinity at prefix 3596. Finite HP does not cap those player-reported landed rows.
Current C-DET forbids nonfinite World floats; public ExactSum refusal cannot repair authoritative overflow. Do not clamp,
reorder the trusted fold, cap safe rows by arbitrary tag count/magnitude, install tagged nonfinite state, or silently
change source outcomes. **Numerical admission decision remains pending actual probes and Root review.**

The separately assigned DeepSeek private session at `/Users/nevinmckinnon/.codex/tools/roguehalla-backend-20261109/card-bleed-design-probe/repo`, branch `codex/deepseek-card-design-probes`, base `36564c33`, owns only these three evidence probes and
`docs/evidence/card-bleed-native-probes/**`; it does not implement production report/index types or measure their
allocations:

1. Normal training baseline and actual checkpoint roundtrip with one sourceless `1e307` Dot (`ability=None`, unique tag,
   valid times/source/payload), then one actual ordinary 50 ms step. Preserve restore acceptance/refusal, landed row
   amount/finiteness, HP/status, events and layout result.
2. Same real checkpoint path with 4096 unique sourceless `1e306` Dot tags; capture actual rows/bits and source-order
   ordinary binary64 fold/first nonfinite prefix. Print accessible existing type sizes; do not use ExactSum as the
   trusted diagnostic.
3. Normal Sim/real Hemorrhage grant/validated physical attack earns a real `bleed:{tick}` Dot on a live regional NPC.
   Checkpoint must restore before hit and preserve the live status after hit; capture actual current restore acceptance or
   the expected `unsupported mob status domain` refusal from `systems/mob_checkpoint.rs`. No raw `on_hit`, installed Dot,
   player-only target, dead/expired workaround or validator weakening. This probes the narrow genuine source Card Dot
   checkpoint admission need while preserving existing Blaze/generic-player domains.

Root chooses the smallest justified arithmetic admission treatment and allocates any exact NPC restore predicate hunk
after these receipts. Existing accepted generic restore shapes and all safe rows remain in scope; no numeric policy or
corrected expected outcome is invented here. Actual report/index size and allocation measurements are later native
implementation gates, not results of these probes.

## Planned identities, ownership and write leases

All identities below are **proposals only; Root must revalidate/reserve against the final union/Claude cut at dispatch**:
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
required. The regional NPC checkpoint predicate is a separately leased hunk only if probe 3 reaches its real refusal.
An unexpected exhaustive Event consumer returns its exact hunk to Root; no implicit expansion.

Protected/read-only: all source fixtures/capture tools/evidence, cards and status gameplay outside the exact hooks,
existing trusted f64 order, actor/wire/client paths, public observation schema beyond the reserved contract version,
protocol/golden codecs, Claude networking/Unity leases, Cargo.lock and shared status. Root rechecks exact source/worktree
pins and Claude's current cut; no whole-file copies or shared status edits. Source-only release does not activate native
or public behavior.

## Acceptance and dispatch gate

Before implementation Root must have the three probe receipts, choose arithmetic admission treatment, approve output and
privacy contract, capacity calculation and numerical bounds, exact identities/leases, and allocate an isolated clean Rust
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
