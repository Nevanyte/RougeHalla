# Card report representation and tactics handoff review

Read-only design review2026-11-10 at integration `b03374083929c3dac3edc4d8e71436962dac6416`.
Only this document is written. No Rust, native/numeric/allocation probe, production function, client, networking,
source fixture, shared record or leased design file is changed. All native code/tests/probes remain DeepSeek's work.
Root consolidates one dispatch design after the already requested numeric/restore receipts; this review is not an
admission decision. Claude's clean `26551343772416cd983491cdda0e1b2f28098be9` remains separate.

**Recommendation:** retain the exact trusted source-order World fold, but replace per-status Card report operations
with exact raw-pair accumulators in a separate derived sidecar, partitioned at Card flush/reset boundaries. Merge those
accumulators into the existing exact public sums only after the original settled eligibility/redaction. Do not round
a tick or segment to f64. This is sound for the existing settled projector semantics and materially lowers preparation
cost. With the one-producer-pass/one-populated-flush proof below, a conservative proposed Full8/R204 incremental budget
is **22,533,760 bytes /21.49MiB**, including explicit new indexes, versus the draft's44.60MiB. This is static planning,
not a measured Rust layout, occupancy, RSS, allocation or performance result. No further representation optimization is
proposed here.

The inspected draft is43554 bytes, SHA256`14c1e69c968dd3dd4af8990e2bcc8e6c351ff23cf56377cdaa6711e03ebb28c0`.
Relevant code identities: fx_report.rs`f9ebc3b5dca009c5e7994ec38072f965ebf18e91ea33d372f5d816b99036b7c1`,
fx_projector/mod.rs`18da62e70a4675700e693e08197142e3e742dd8e4813d428c13005826aadf6f3`,
exact.rs`21d66a3e07476dcf5487d003b79cb0fc4d0449844e07de98a4ff81b4397a516a`.

## Why exact pair coalescing preserves entitlement and amounts

`finish_fx_report` freezes viewer membership plus player/NPC sight after the completed tick. Current projector
Contribution processing admits a contribution iff `sees(viewer,victim) || by==Some(viewer)`, then redacts `by` according
to the same report's settled sight. Consequently every eligible Card hit with the same raw `(victim,by)` in that
completed tick has the same entitlement and the same redacted public key for a given viewer. This remains true if a
victim/source was removed before settlement: the final report predicate is still the predicate for every contribution.
No position, card ownership, current actor existence or earlier visibility is substituted for that rule.

For one segment, let X be the multiset of its finite nonnegative binary64 landed amounts for a raw pair. Its derived
row stores the integer sum of X in units of2^-1074. Eligible public buckets merge that integer, rather than a rounded
`sum(X)` f64. Exact integer addition is associative/commutative, so the public result equals adding every original
eligible amount and rounding once at the eventual CardFlush. Distinct unseen sources that redact to None still merge
into the same anonymous victim/Card bucket; named and anonymous buckets may coexist. Public output retains the
existing sorted public-key order, independent of hidden raw insertion order or status count.

This proof does **not** justify grouping across ticks: eligibility/redaction can change, attachment/gap boundaries can
intervene, and the tick is the unit of the original settled entitlement. It also does not justify grouping across
CardFlush/CardReset within a tick. Split there before later contributions are added. Legacy Signature/Ability/Instant
markers do not clear Card; a legacy Reset must remain a reset of its existing domains, not accidentally acquire Card.
World's trusted report still performs each original `+= h.amount` in landed order and preserves first raw-pair insertion
order. Neither the exact sidecar nor the lookup changes trusted f64 operations or raw flush ordering.

## Incremental representation and marker order

Keep Card exact rows in separate preallocated producer and sealed-report vectors. A row contains raw victim/by and an
ExactSum, plus only necessary indexing metadata. **Do not put ExactSum inline in shared `Op`:** its272-byte limb array
would enlarge every legacy Contribution/marker element and defeat the intended bound. Keep a small Card segment/range
reference in Op, with an empty or small sidecar segment descriptor.

Reserve the segment Op at the first eligible contribution's current position; append distinct raw-pair rows in first
occurrence order and update already-present rows in place. Finalize its range at the next Card boundary/end. It may
reference a sidecar finalized later in the same step because the report becomes externally complete only at seal.
Moving same-segment Card additions before an intervening legacy-only marker changes no Card output: Card has no public
emission before its own marker, its eligibility is fixed, and other domains do not clear it. A Card boundary always
closes the prior segment. Do not move the Card marker itself, derive its index from the first/raw pair, omit an empty
marker, or reconstruct it from trusted output events.

The present schedule runs `cardHooks.afterDamage` once in `hooks:systems`, after the one landed ledger pass and before
nontraining `settle`. Source cardHooks.afterDamage loops landed once, then stillness, then the periodic bleed flush.
Native cards/after_damage.rs likewise ends with stillness and resolve_splashes; those splashes are deferred to the next
tick, not another landed-report pass. Final settle then fires runEnded, whose Card flush position must stay between
existing dropDeferred and later corpse/zombie removal hooks. `guard:voided` returns before active work; Ended steps
only drain inputs. Normal raid reset occurs before future active contributions, never as a second Card damage pass.

Therefore the proposed producer has **at most one contribution segment containing rows per ordinary step**. It can
still emit up to2 CardFlush and1 CardReset markers. If periodic flush is populated, its rows are cleared and the later
runEnded flush is empty; if periodic is absent, runEnded may be the populated flush. Retain both markers and their
exact event indices/order. There are no new contributions between them. This justifies reserving one populated Card
raw/public output envelope per step, rather than multiplying the same pair/bucket capacity by two.

DeepSeek must lock this premise with schedule/marker tests on the dispatched union, including first-use periodic,
periodic+runEnded, early run-end, signatures-off reset, teleport, voided/Ended scratch retention, and source payLater
adjacency. The new Card producer must never revisit retained s.landed on a step where that source pass did not run.
A future producer after a Card boundary requires a new reviewed bound; it cannot silently reuse the one-segment budget.
Report validation still checks up to2/1 markers, monotone in-range event offsets, the segment's placement/range, complete
coverage of its rows, valid sums and rebasing before copying. No underflow or partial report publication.

## One capacity model for dispatch

Retain the draft's audited actor/lifecycle premises, but consolidate its internal contradiction: the earlier
`4P+2R+150` paragraph is obsolete and is not a second valid universal formula. For arbitrary accepted restores use
`V=A0+14P+2R+150`, with `P=max(8,current player count)` as private preparation only. Use the proven pristine mode
specializations only where their prerequisites hold: Full8/no dummies usesV=2P+2R=424 atR204; player-only8 usesV=8;
pristine training8 without earned corpses usesV=3P+150=174. Restored extra actors always belong in A0. Public viewers
remain independently bounded at8.

At cold new/clone/restore preparation deduplicate actual eligible initial Dot/deferred rows by the **actual landed raw
pair** `(victim,by)`. Call the count U0, with U0<=the draft's per-status E0. Status/deferred raw by provenance is preserved
through the ledger (`LandedHit.by=e.by`); validate provenance before inventorying it. Count None explicitly, do not map
historical IDs to seat indices, and do not require the source/victim still be current actors. Existing trusted pending
rows are Q0 and do not grant any fresh viewer historical entitlement.

Use the following single set of new capacities:

| Domain | Prepared capacity |
|---|---|
| Derived exact raw-pair rows in a step, each of producer/sealed sidecars |K=U0+P*V. One actual contribution segment, not41 rows per pair. |
| Trusted pending ordered pairs and raw rows in one populated flush |Q=Q0+U0+P*V. |
| Card public buckets per viewer and Card rows in one populated public flush |B=2U0+(P+1)*V. A restored raw pair can be named and anonymous over different ticks; anonymous sources coalesce. |
| Small Card Op/range/marker metadata |One populated segment reference plus<=2 CardFlush and<=1 CardReset. Preserve empty markers. |

E0 is still relevant to existing status/ledger work and the numeric probes; it is no longer the Card report storage
cardinality. Many accepted tags for one raw pair now cost one exact Card row per step. U0 can still be arbitrarily
large in accepted restore input, so this is sparse proportional preparation, not a new universal small resource cap.
Do not clamp U0, tighten existing shape admission, drop historical pairs or allocate an H-squared history matrix. Cold
unique inventory may sort/deduplicate temporary raw keys without sorting the canonical World rows. New live generic
keys remain limited to player Hemorrhage/Festering pairs under the draft's producer proof; a new producer must extend it.

For comparable64-bit planning retain the draft's conservative estimates: exact Card row320 bytes including metadata,
trusted row24, public bucket320, Event/SeenEvent256. ExactSum's actual array is34*8=272 bytes. Rust layout/allocator
rounding remain DeepSeek probe obligations. Two exact sidecars cost640K; one populated raw flush in two event buffers
costs512Q, its two-byte wish mask adds2Q, and trusted rows add24Q. Eight viewers' buckets plus one populated SeenEvent
vector cost8*(320+256)B=4608B. Fixed legacy reservations and existing status/tag allocations remain excluded, exactly as
in the draft. Small segment/marker/vector headers and allocator rounding are additional fixed/layout terms.

## Deterministic indexed hot path

A linear `find` per landed entry would replace a memory problem with `landedCount*pairCount` work. Use separate derived,
preallocated lookup indexes for the trusted World pair vector, the current exact report segment, and each viewer's Card
public bucket vector. Their lifetime/reset domains differ. The trusted index points into unchanged insertion-ordered
World rows and rebuilds cold after restore/clone; it is not serialized/hashed. The segment index clears at a Card boundary.
The public index keys the **redacted** key, after eligibility; it never consults a raw global alias table.

Use a preallocated **arena AVL index** for the stronger worst-case requirement: each node has two usize child indices
and a bounded height, with node ordinal mapping directly to the corresponding stable insertion-ordered row. A segment
uses its row-range start as the mapping offset. Compare the complete `(u32 victim,Option<u32> by)` key in the row. Rotations
change only index links, never canonical/public row order. Lookup/insertion is O(log N), including colliding or specially
chosen restored IDs; no per-node heap allocation is required. A bounded stack/trail or validated recursive depth follows
from the AVL invariant and addressable N. Reset clears node length/root while retaining its prepared capacity. DeepSeek
must test adversarial sorted/reverse/duplicate keys, rotations, height/depth limits and stale-index reset boundaries.

Fixed deterministic open addressing alone would leave a worst-case landedCount*pairCount path when restored keys
collide, despite acceptable normal occupancy; it is not the recommended guaranteed lookup. Nor should the65-bit raw
key be packed into64 bits or None aliased to a valid PlayerId. A tree arena avoids both assumptions. Estimated node
layout with two64-bit children plus height/padding is24 bytes, so an index needs24N bytes; actual Rust size still requires
the probe. No extra row-index word is needed while node ordinal and row insertion ordinal stay aligned.

To retain the conservative reviewed planning allowance, define `M=next_power_of_two(2*N)` with checked arithmetic and
`I(N)=8*M+8*N` bytes (I(0)=0). This is an **index budget envelope**, not the chosen tree's physical table layout: because
M>=2N, I(N)>=24N and covers the proposed arena nodes. If actual node layout is larger, DeepSeek must revise the estimate
before claiming the bound. Sorting Card public buckets happens only when that domain is then cleared, so clear its index
too. Prefer a separate private Card bucket Vec/index; this avoids stale indexes when existing legacy sort/retain
operations move mixed-domain rows. Rebind must cold-prepare for the new Sim before clearing entitlement. Gap, absent
viewer, foreign instance, backwards, invalid report and failure clear/disable Card alongside existing domains. No
per-entry allocated tree node, resizing HashMap, cloned heap key or hot Vec growth is implied by this design.

The recommended comparable incremental estimate is thus:

`N_new = 640K + 538Q + 4608B + I(K) + I(Q) + 8*I(B)`

| Profile | U0/Q0 | K/Q/B | Index bytes | Proposed bytes /MiB |
|---|---:|---|---:|---:|
| Pristine player-only8 |0/0|64/64/72|24064|431232 /0.41|
| Pristine Full8/R204 |0/0|3392/3392/3816|953856|22533760 /21.49|
| Pristine training8 |0/0|1392/1392/1566|450176|9306080 /8.87|
| Generic restore A0=256,R204,4096 distinct initial pairs |4096/100|11504/11604/16526|5961120|95718440 /91.28|
| Same4096 initial rows all on one raw pair |1/100|7409/7509/8336|3012144|50206034 /47.88|

These are formula evaluations, not new runtime probes. Grouping alone, while retaining the draft's two-populated-flush
output multiplier, would price Full8 at29.70MiB **before indexes**. The21.49MiB recommendation also relies on the explicitly
audited one-populated-flush schedule proof; it is not a claim that ExactSum alone saves the whole difference. Larger
accepted U0/Q0/A0 still grow proportionally. Check every multiply/add/next-power-of-two and fallible reserve without
saturating to a small capacity. A public report representation failure must clear/disable publication through its typed
error path while trusted accumulation stays lossless; no public capacity becomes a gameplay damage cap. Unexpected
trusted-bound exhaustion is a failed preparation proof to report, not permission to truncate or silently declare the
warm allocation invariant passed.

## ExactSum merge and native gates

Current ExactSum.add accepts finite nonnegative values and has34 integer limbs; rounded performs nearest/ties-even and
can reject a non-finite rounded result. It has no merge API today. Add a crate-private integer limb merge using checked
carry propagation, with no `rounded()`/f64 conversion between the two accumulators. Keep both raw and public sums in the
same unit2^-1074. Expose the existing exact module only crate-internally if needed; no public API or broad move is required.
A small stack copy before merging provides all-or-error destination semantics without heap allocation. Alternatively a
partial destination on error is safe only if the whole derived report/projector is immediately failed/cleared and cannot
be read; current fail clears output and disables the projector. Do not map carry overflow to invalid input or retain a
partially published prefix.

There is ample but finite carry headroom, not an unlimited-precision promise. A finite input's highest integer bit is2097;
34 limbs hold2176 bits. With checked64-bit per-step contribution-count bounds, an inclusive11-pass500ms window has fewer
than2^68 addends, so its sum's top extent is below2166 bits, within the buffer. This uses the existing accepted clock bound
`0..=u32::MAX*TICK_MS`, exact50ms advancement and the source flush cadence; revalidate those premises on the native cut.
Keep merge overflow checks regardless. Rounded overflow can happen far earlier even when limbs fit. The pending numeric
probes remain essential: one Dot can overflow multiply-before-divide and finite individual hits can overflow the trusted
ordered pair. Coalescing does not solve either authoritative C-DET problem and does not choose an admission policy.

DeepSeek's exact merge tests should compare direct adds versus several integer merge partitions, permutations, carry
chains, subnormal/normal transition, half-way ties, zero/signedzero and largest finite values; cover both limb overflow
and rounded overflow distinctly. Report/projector tests must show same final public bits for reversed hidden raw/status
order, changed hidden-source counts, named↔anonymous changes across ticks, sources/victims removed before flush,
sourceNone restored rows, duplicate/gap/foreign/rebind, Card/legacy reset isolation, periodic+empty terminal markers,
signatures-off reset and unknown/invalid report markers. Trusted source fixtures must still match their sequential f64
folds and raw insertion order independently of public exact output.

Measure, in DeepSeek-owned probes after Stage1, actual type sizes and new report/index warm allocations for first
nonempty window, repeated flush, high admitted multiplicity on a few pairs, many unique pairs, clone/restore and
rebind. Separate inherited status tag/Arc allocations from new report storage; no whole-combat zero-allocation claim
follows from prepared vectors. Complete the existing numeric/earned-NPC restore probes and obtain Root's admission
choice before one consolidated native packet is dispatched. Consolidation should replace the old per-status
contribution instruction and obsolete E0/V/formula paragraphs, preserve identity/shared-file leases against Claude's
current cut, and keep the released source oracle unchanged.

## Frozen tactics finite adequacy and the emptyPath contract

Tactics source commit`54ff01a2` is a reasonable **finite method-level handoff candidate**, conditional on Root's independent
reproduction/review and numeric whitelist approval. Manifest SHA256 remains
`9f76406016d0ebc498b0a3a3ec7cad677fc43ecd40b530a963a57a7f3d6eb957`; source SHA256
`5d27d1b4522d386d4ede5f3064a28660dedff43e32a24ade264f4512e30fcfa8`. It has154 cases/720 operations,
all9 goals/all4 statuses, real Memory/Knowledge/default Tactics dependencies,16 reached assertions,17 raw negatives,
17 semantic KILLs, comment NONKILL, restored exact cases and separate fresh pinned byte checks. The repaired Orb first
positive launched readyAt distinguishes Infinity from zero initialization; Retreat's48 arrival now holds its threat set
constant and distinguishes retained-above48 from replan-at48. These are substantive retained-state witnesses.

The ledger's unisolated remembered-chaser disjunct, remembered-goal/visible-mate cross-product, fine Reflex fallback
combinations and alternate short test route are honest finite limits, not a concrete reason to reopen optional
cross-products before native implementation. Existing immutable Fight/Orb/Reflex overlaps still must replay against the
new complete private source-shaped native classes, using real Memory and admitted Reflex. A future source/native
mismatch, a reader that loses consumed facts, a stub for an unisolated branch, or omission of any whole case is a blocker;
case counts/V8 ranges alone cannot discharge it. This is the source author's semantic assessment, not the independent
review required for admission; Luna's separate reproduction must remain a separate receipt.

`loot-path-empty` is the one explicit throwing **test-service** boundary. Its observe declares self(1000,760), box(1600,760),
now100000; the action declares radius-denial0 with emptyPathtrue. Source executes the one knowledge decide draw
0.6270739405881613 (Knowledge setup already consumed70 separate draws), then world loot creates/updates its real slot.
It calls paths.los(full self,full container)→false, then paths.path(same args)→[]. It attempts next.x on an undefined
waypoint and throws TypeError `Cannot read properties of undefined (reading 'x')`. No paths.walk, Reflex check or emitted
intent/status follows. Recorded result is Undefined, all lifetime stats remain0, decide count1, other action lanes0;
Memory/path-service snapshots and both stats aliases are retained. From unchanged source, the slot has begun and lastNow
was updated, and Tactics' one-time knowledge choice has occurred; those private closure details are **source-code
inferences**, not invented diagnostics or a proven post-error continuation (the frozen case ends there).

In contrast `fight-empty-path` accepts exactly the same descriptor shape. Fight draws knowledge and engagement
(0.6270739405881613,0.002735721180215478), calls paths.path→[], normalizes the empty route to no path, caches the failed
plan/increments its noPath state, and returns running/“looking for a way to the target”, no intents, attackingfalse.
It is a valid behavioral case, not an error or a descriptor to blanket-skip. `loot-path-null` separately calls losfalse,
pathnull, walknull and returns failed/“unreachable”. Production RoomPathService normalizes findPath's zero-length result
to null in trip and returns `trip()?.path ?? null`; it does not expose a non-null empty route in this trajectory.

**Recommend a typed error at the actual private World tactic boundary**, for example a private
`Result<TacticsOutput,ServiceContractError::EmptyWorldRoute>`. Accept the declared empty vector for method fixtures,
execute the same pre-error source callbacks/RNG/Memory/slot progress, then return the typed error exactly where nextStep
finds no waypoint. Propagate it through private Tactics before Reflex arbitration; do not synthesize a failed GoalStatus,
fall back to null, roll back already executed state, pre-reject the whole case, or panic. The normal production adapter
can additionally guarantee `None | nonempty route`; its guarantee does not erase the method boundary case. Fight keeps
its source-defined empty-route handling and therefore must not inherit an unconditional shared-service rejection.

The new private native fixture reader must consume the frozen thrown row, verify its Undefined result plus exact
name/message, and explicitly normalize **only that named source boundary** to the typed native error. Compare the full
pre-error callback sequence/arguments/results, actual Memory, stats/aliases, draw counts and pathStats after the error.
Keep every successful case's ordinary exact output comparison. This is an explicit cross-language exception-carrier
mapping, not a hidden skip, ignored assertion, tolerance or change to the source fixture. DeepSeek should also test that
its typed error does not run Reflex or mutate an unrelated domain; no new expected source continuation is invented.

Upfront unsupported-descriptor rejection is a less faithful fallback only if Root finds a concrete interface obstacle:
it cannot reproduce the source's consumed draw/path calls/slot progress and must be reported as intentionally nonparity,
source-only coverage with a named omitted native error trajectory. There is no such obstacle apparent in a new private
module returning Result. Root should approve the local typed error mapping before DeepSeek's reader/handoff, rather than
accepting an automatic blanket skip or introducing a native panic. Source/capture files remain frozen.

Root subsequently accepted the sidecar/index/one-populated-flush direction subject to DeepSeek gates, the local typed EmptyWorldRoute mapping, and the narrowly enumerated geometry whitelist with exact comparison first. Root owns the separate source ADMISSION.md and consolidated packet; this document remains the author assessment, not Luna’s independent reproduction.
