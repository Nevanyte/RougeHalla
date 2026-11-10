# Card bleed report design consistency review

## Result

I found no concrete semantic or arithmetic defect in `docs/coordination/CARD_BLEED_REPORT_REVIEW.md` under its stated assumptions. Its exact-pair coalescing argument, one-populated-flush scheduling argument, and displayed capacity calculations are internally consistent with the inspected source and current schedule. This is a read-only design review, not an implementation, admission, benchmark, or allocation receipt. No Rust, source fixtures, shared records, or design drafts were changed.

The older `docs/coordination/CARD_BLEED_NATIVE_DESIGN.md` remains an earlier dispatch draft. The report review deliberately revises its per-status Card bound/representation and one-populated-flush allowance; the two documents are not competing admissions. Consolidate one current packet only after the three DeepSeek numeric/restore probes and Root’s decisions. Neither document establishes native admission. Type layouts, allocator behavior, warm allocation counts, RSS, and speedups remain unmeasured; the 21.49 MiB figure is a static planning estimate only.

## Semantic checks

- **Same raw pair within one settled tick:** The existing projector freezes the completed tick’s viewer membership and player/NPC sight in `finish_fx_report`. For a fixed viewer and victim, `sees(viewer, victim) || by == Some(viewer)` and the settled redaction of `by` do not vary among contributions with the same raw `(victim, by)` pair in that report. Thus exact-summing such contributions into one private derived row preserves that viewer’s eligibility and public key. The report correctly forbids grouping across ticks or across CardFlush/CardReset boundaries, where sight, gap, reset, or marker semantics can differ.
- **Trusted versus derived arithmetic:** The report keeps the source-order `f64 += amount` fold and raw trusted row order separate from the derived `ExactSum` path. Exact limb merging is mathematically equivalent to adding the original finite nonnegative binary64 contributions and rounding once at the eventual public flush, provided the proposed checked merge is implemented correctly. The derived result must not replace, reorder, round, or feed back into the trusted fold. Existing `ExactSum` has no merge API today, so the checked merge and failure behavior remain DeepSeek implementation/test gates.
- **Anonymous source coalescing:** Eligibility is applied before source redaction. Different unseen raw sources can then merge into the same anonymous `(victim, Card)` bucket, while a named bucket may coexist. This follows the current per-viewer projection contract; it is not a historical audience claim or a global source alias table.
- **Marker order:** Keeping CardFlush/CardReset as explicit markers and splitting segments at those boundaries preserves empty markers and public event position. The report’s “move contributions only within their same unflushed Card segment” condition is necessary and sufficient for its non-interference argument; it does not permit moving a flush or reset.

## Schedule and producer checks

The source `packages/server/src/sim/step.ts` increments every step, but `updateActive` returns immediately for a voided arena; otherwise it clears `combat.landed`, executes the damage ledger once, runs systems, and then settles. Source `cardHooks.afterDamage` scans landed once, performs card work/stillness, and runs the periodic bleed check. `flushBleeds` clears rows and resets its timestamp. If settle ends the run after this pass, the run-ended hook is later in the same step and can flush only rows not already consumed by the periodic flush. Therefore this schedule has at most one populated Card flush per ordinary step, although it can retain both periodic and run-ended markers. An active step that itself ends the run must still count as a real producer pass; an already-ended or voided step must not revisit retained `s.landed`.

The Rust schedule has one damage-ledger pass before the `cardHooks.afterDamage` system. `cards::after_damage` ends with `resolve_splashes`, which moves splash hits into `w.deferred` for the next tick’s ledger; it does not create a second landed pass in the current tick. The `RUN_ENDED` chain places the pending Card flush after `cardHooks.dropDeferred` and before later corpse/zombie-removal hooks. These facts support the report’s one-segment/one-populated-envelope premise **if** the dispatched Card producer is attached only at those declared points and does not add another post-boundary producer. Its requested schedule tests are appropriate gates, not already-passing evidence.

The source-specific live-key premise is also consistent with inspected producers: Hemorrhage is applied by the player card on-hit path and creates the tick-tagged `bleed:{tick}` Dot shape; Festering is applied only for a player with the card/build flag and uses the reusable `festering` shape. Ability DoT is separately tagged with `ability`, and signature DoT with `sig`, so neither belongs in the source predicate `dot && ability == undefined && sig == undefined`. This finite live-source bound does not cover arbitrary restored Dot shapes. `U0` therefore must be a cold inventory of the actual eligible status and deferred rows, deduplicated by the full landed raw `(victim, Option<by>)` pair, including `None`; `U0 <= E0` follows because each distinct pair must be represented by at least one counted eligible row. Do not infer historical IDs from seat ordinals or require those actors to remain live.

`Q0` is a separate count of existing trusted pending raw-pair rows. Including `Q0` in `Q` preserves restored/clone state but does not imply that a newly attached projector gains entitlement to those historical amounts. Keep trusted preparation lossless if any public report capacity/error path fails.

## Capacity arithmetic rechecked

For `I(N) = 0` when `N=0`, otherwise `8*next_power_of_two(2N) + 8N`, the index envelope is at least `24N` bytes because `next_power_of_two(2N) >= 2N`. That covers a proposed 24-byte arena AVL node per row on the assumed 64-bit plan, but only a Rust layout probe can verify the node’s actual size. Checked multiplication, addition, and power-of-two growth are required; no saturation or truncation follows from this envelope.

Using `N_new = 640K + 538Q + 4608B + I(K) + I(Q) + 8I(B)`, I independently evaluated the table:

| Profile | K / Q / B | Index bytes | Total bytes | MiB |
| --- | ---: | ---: | ---: | ---: |
| Player-only 8 | 64 / 64 / 72 | 24,064 | 431,232 | 0.4113 |
| Full 8, R=204 | 3,392 / 3,392 / 3,816 | 953,856 | 22,533,760 | 21.4899 |
| Training 8 | 1,392 / 1,392 / 1,566 | 450,176 | 9,306,080 | 8.8750 |
| Restore A0=256, R=204, U0=4096, Q0=100 | 11,504 / 11,604 / 16,526 | 5,961,120 | 95,718,440 | 91.2842 |
| Restore A0=256, R=204, U0=1, Q0=100 | 7,409 / 7,509 / 8,336 | 3,012,144 | 50,206,034 | 47.8802 |

The per-term byte arithmetic is coherent: two 320-byte exact sidecars yield `640K`; pending raw rows plus two 256-byte event-buffer allowances and two-byte wish mask yield `538Q`; eight viewers’ 320-byte public buckets plus a 256-byte `SeenEvent` allowance yield `4608B`. Fixed legacy reservations/status allocations and allocator rounding are explicitly excluded. The estimate presumes one populated raw/public output envelope per step and one index per indexed domain as described; it is not a universal memory cap because accepted `U0`, `Q0`, and restored actor inventories can grow proportionally.

## Remaining gates and limits

The review report should keep its claims conditional on the accepted restore shape and the exact provenance validation used to compute `U0`/`Q0`. The three numeric/restore probes remain necessary: finite Dot multiply-before-divide overflow, finite individual contributions overflowing the trusted ordered-pair fold, and a genuinely earned Hemorrhage status on a regional NPC surviving checkpoint/restore under the narrow status predicate. They decide arithmetic admission and NPC provenance; this calculation does not decide them. The NPC probe does not expand the live card source limit to arbitrary mob-authored contributions.

DeepSeek still needs to establish actual type sizes, AVL node size/height bounds, exact merge and carry/rounded-overflow behavior, cold preparation on constructor/clone/restore/rebind, and the warmed allocations of the new report/projector path. It also must verify schedule marker placement, retained scratch handling, and source sequential trusted totals separately from derived exact public totals. No speedup, zero-allocation claim, native parity, privacy admission, or client/wire claim follows from this review.
