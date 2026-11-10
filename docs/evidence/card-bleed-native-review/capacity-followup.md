# Card capacity repair — independent pre-seal delta review

Disposition: **HOLD pending the bounded evidence corrections below and final seal**. The inspected production
capacity repair addresses the reported legacy-limit/owned-buffer/index issues; no additional mechanic or arithmetic
failure was identified in this delta. This is still a moving worktree, not native admission. Preserve `final-review.md`
and earlier review notes unchanged. All Rust/test/probe authoring remains DeepSeek-owned. This reviewer ran no Rust,
tests, probes, source capture, process interference or worker contact; only read code/actual receipts and wrote this
NEW review under Root's integration checkout.

Native worktree: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-card-bleed-feedback`,
HEAD/base `03ec330be74d695ee6034def69c1cb5df72e7b34` plus uncommitted candidate. Review on2026-11-10. Existing
source/private-B3/public-comparator mechanics were already reviewed and were not rerun or expanded here.

## Repaired code boundary

- `fx_report.rs:24-37,162-164` now separately counts actual non-Card events against legacy512 and actual raw
  CardBleedHit events against the cold `card_event_limit`. Empty markers consume no raw-row allowance. The boundary
  helper is the SAME function called by `finish_fx_report`, not a test-only substitute. Existing event/marker offsets
  remain actual event indices; raw Card events remain omitted by public conversion.
- `card_bleed_feedback.rs:653-671` independently inventories serialized pending Card events as T0 and computes checked
  Q+T0. This is separate from Q0 report rows and U0 status/deferred pairs. Constructor/Clone/restore call the same
  cold preparation, and prepare_card reserves sealed report events/wish_points for512+Q+T0 plus K exact rows
  (`625-649,675-693`). It stores that raw Card envelope before the next ordinary step appends pending events.
- `fx_projector/mod.rs:13-27,82-121` reserves the projector-owned Events vector for legacy FX_OUTPUT_EVENTS_MAX+B
  on attach/rebind, with checked addition and fallible reserve. A failed production output preparation is stored as
  bounds_unsupported and fails feed closed. The cfg(test) transparent Card observer is also cold-reserved. This no
  longer relies on the old fixed output capacity for a larger accepted Card bound. CardBuckets separately reserves
  its B rows and index. Q0/T0 are NOT copied into those public buckets or otherwise granted historical entitlement.
- `capacity_from` checks actual K/Q/B u32 ordinal representability before row/index preparation (`560-604`);
  CardBleedReport/segment prepare reject oversized row reservations first (`252-262,415-420`), and PairIndex::reserve
  checks the node-link domain before allocation (`index.rs:76-83`). u32::MAX is the reserved absent-node link, so
  at most u32::MAX nodes with indices0..u32::MAX-1 are representable. The pure/control tests refuse oversized checked
  products and direct reserve calls without attempting billion-row allocation (`tests.rs:1864-1902`). These are actual
  representation limits, not new arbitrary small gameplay caps or a tightened generic status magnitude policy.

The previous trusted/source arithmetic and viewer-local entitlement-before-classification remain the reviewed
contract. This delta does not grant permission to refresh source or public observations from raw Q0/T0 totals.
Caller-owned `step_into(out)` storage remains separately prepared by its caller; no whole-combat/no-allocator claim.

## Concrete remaining bounded corrections

### 1. Pending history needs the actual over-limit/fresh-session witness

The REPORT600 test is real and meaningful: `restored_historical_card_baseline` starts with an ordinary regional Full8
constructor, sets up600 unique historical trusted pairs with retained actual actor provenance, then performs actual
strict Sim restore. The next ordinary step emits all600 raw rows, and a fresh attached viewer's real feed must be
Advanced with zero Events and zero Card observer output (`tests.rs:1714-1817`). This is explicitly an accepted-state
setup/control, not600 ordinary earned source contributions or installed source expected outcomes.

The separate `serialized_pending_card_history_extends_the_prepared_boundary` at the inspected cut uses only THREE
pending raw events, asserts Q+T0 and actual Clone/restore/step, and never attaches/feeds a viewer (`1820-1861`). Three
rows do not exceed legacy512 or the small prepared Q (about65). Therefore this does not yet prove that accepting T0
actually keeps a larger pending history bounded without fresh entitlement; even a missing runtime T0 allowance can
remain invisible when three rows fit Q.

Root already sent the minimal correction: pending count must exceed BOTH512 and Q, pass actual Clone and accepted
restore, be appended by the ordinary step, and feed a fresh viewer successfully with zero Card output. Keep explicit
Q+T0/cold capacities and the distinct REPORT600 case. No source recapture, producer replay installation or heavy-suite
repeat is needed for this test-only witness correction. Its focused command/result must bind the final test bytes.

### 2. Non-overlapping measured capacity ledger, not planning-plus-already-priced buffers

The generic Full8 capacity test now exercises the real constructor with A0=212/R=204/P=8, computes V882,
K=Q7056/B7938, and prints/asserts actual owned-buffer capacity bounds (`tests.rs:920-1006`). This is a substantive
improvement over the old64-row-only sizing evidence. The type-size test includes actual Event/SeenEvent layouts;
the final evidence must preserve its actual printed output/command/exit rather than only a summary table.

However, the inspected README161-168 calls9,308,952 bytes “exact internal buffers”, then adds it to the
N_new46,991,264 planning expression as the “honest footprint”. The domains overlap: N_new already prices K/Q/B
buffers. Its internal sum also omits the producer segment's separate AVL K*28, counts only one viewer, and includes
the cfg(test) transparent observer. It is not a measured live-process footprint or a non-overlapping live-container
ledger. Do not relabel that sum as exact memory, and do not substitute21.5675 MiB.

Root already sent the correction: inventory every actual owned live container once using its actual reserved
capacity/type size; include the producer index, account for the declared viewer count, separate cfg(test) observer,
caller output and inherited/base allocations, and present the planning allowance separately. A conservative budget
is fine if labelled as such; plan+already-priced internals is not actual measurement. No independent allocator size
or new smaller pristine-Full8 predicate is inferred here.

### 3. Public owned output beyond the old constant needs the scoped growth witness

The real existing dhat control is still the player-only K/Q64 setup: first and second unseen raw pairs,20 repeated
steps, and rows/segment/index fill to prepared64. It does not populate projector Events/Card observer beyond the old
FX_OUTPUT_EVENTS_MAX (1504). REPORT600 exercises larger raw sealed copying but deliberately has NO public Card rows.
Thus code now reserves the right public buffer, but the previously requested owned-output-growth measurement has
not yet been produced by those tests.

Root sent ONE isolated component witness: actually feed/flush enough entitled Card buckets to cross the old output
constant, confirm prepared capacity and zero scoped growth allocations (including the transparent test observer as
appropriate). Transparent synthetic component setup is honest here; it must not be called ordinary gameplay/source
reach or whole-combat zero allocation. This is a finite closure of the existing capacity request, not another source
campaign. Keep external caller buffers and inherited allocations separate in the assertion/receipt.

## Actual receipts read and scope of reuse

- `receipts/card-history-envelope-RED.log` fails the real REPORT600 test at the intended assertion:
  Err(UnsupportedBounds) versus Ok(Advanced). The separate GREEN records1 pass/0 failure. Those demonstrate a real
  repaired boundary, not compilation/import failures counted as semantic red.
- `/tmp/cardlogs/ability-63-source-prefinal.log` actually runs the unchanged frozen_full_source_all_63_cases,
  reports zero named prerequisites,1/0 in16.24s and literal EXIT0. This is the required post-capacity SOURCE gate.
  Root's827422b5 authorization then permits only the existing derived-native recorder/tape and content golden pin.
  The recorder receipt passes1/0; recorded tape SHA256 is
  `17fc8309e839fdc411686ec455fc5178ccb1e2a88b303896fe77eaa054457393`. It is not source expected data.
- `/tmp/cardlogs/rhsim-final.log:946` has a completed LIBRARY result881 pass/0 fail/15 ignored in765.79s.
  At inspection the same command's integration targets were still in progress (hash coverage tail), so this is not
  an aggregate completed cargo-command exit. Preserve that distinction and the prior raw failures.
- Current actual `receipts/card-alloc-GREEN.log` records construct98/clone66/restore1022/rebind6 blocks, first/new
  second raw pair0,20 repeated steps0, beyond-prepared growth2, and one ignored allocation test run passing in1.66s.
  The measured prepared K/Q/index64 model is explicit. That is useful scoped evidence, not generic Full8 public
  growth evidence or a full-process/no-allocation claim.
- The current full run begins with WIP unused node_size import/pending_card_rows warnings. Final strict default and
  all-feature receipts must bind the eventual mechanical cfg/unused-helper cleanup and final code, not stale earlier
  lint logs. A cfg/test/helper annotation or the above test-only witness changes do not justify rerunning a13-minute
  library/source/tape campaign absent a semantic production delta. Root has already directed bounded final gates.

## Inspected moving-file SHA256 bindings

These identify this pre-seal inspection, not later author repairs. Final admission still needs exact sealed scope,
finite code/evidence delta review and the completed required gates. No private World/checkpoint/state-hash transcript or its digest is
written into this evidence.

| Relative native path | SHA256 |
|---|---|
| `crates/rh-sim/src/systems/card_bleed_feedback.rs` | `4ee368b91499828638e54c731d05576717e1583ac676671dade7387bb832e4ba` |
| `crates/rh-sim/src/systems/card_bleed_feedback/tests.rs` | `5d329c324664724569457b13f31876b0bdeb9ef8c9cd34d60bf205e76c165fb0` |
| `crates/rh-sim/src/systems/card_bleed_feedback/index.rs` | `9bdf89e2f531b7f90d98f0c496760f75fcfc17987ce6f4fecac97eb5e0ae5644` |
| `crates/rh-sim/src/fx_report.rs` | `6d56e2f40f8ec468d1b72734b5b6014449b94f7026cf558fd8e944b5715bae0e` |
| `crates/rh-sim/src/fx_projector/mod.rs` | `d29c9cbdd4f197eaa768245f67201d979ef0a270ca71a6c2f60dcdb80e937ff7` |
| `crates/rh-sim/src/fx_projector/card.rs` | `b2e2bf8e836b2fa45b60c19f84982fbc18d18c07df3c665b475902e6259eec99` |
| `docs/evidence/card-bleed-native/README.md` | `ac9c60e75ab7fc582aaa6e5eb89e854204ea28e02dd0238b54013d9662852952` |
