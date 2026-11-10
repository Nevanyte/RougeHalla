# Card native pre-seal independent review

Disposition: **HOLD, WIP; no native/public admission.** Read-only inspection on 2026-11-10 of
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-card-bleed-feedback`, HEAD/base
`03ec330be74d695ee6034def69c1cb5df72e7b34` plus uncommitted candidate changes. No reviewer Rust, execution of
Rust tests/probes/source captures, worker contact, or source/fixture edits. Earlier `wip-findings.md` and
`preseal-review.md` remain historical and unchanged. This document is an inspected-file snapshot, not a final
seal or attestation of later worker bytes.

## Concrete remaining hold: raw Card history still controls the legacy report bound

`fx_report.rs:133-136` checks total `events.len() <= FX_REPORT_EVENTS_MAX` (512), including the new server-only
`CardBleedHit`. Trusted `CardBleedReport::flush` emits one Event for every retained row
(`systems/card_bleed_feedback.rs:284-300`). `FxProjector::feed` rejects an unbounded report before viewer lookup,
settled eligibility or Card classification (`fx_projector/mod.rs:157-161`). Thus an accepted restored report with
513 distinct retained-provenance historical pairs, a due report clock, and no new Card contributions causes the
next ordinary flush to fail every freshly attached viewer with `UnsupportedBounds`. Those historical Q0 rows
must grant no new entitlement, yet here their private count affects the new viewer's success/error. This follows
from the accepted predicate and call path; it is not a reviewer-executed probe or an ordinary-source reach claim.

Root confirmed and approved the minimum repair within existing report/projector leases: retain the legacy
512 **non-Card** bound; separately account and bound raw Card rows using the cold-prepared envelope; reserve
owned report `events` and `wish_points` for legacy plus Card, while preserving actual marker indices. Reserve
projector owned output for legacy output allowance plus B at attach/rebind (and the transparent test observer as
needed). Use checked arithmetic and fallible cold reserve, retain empty markers, preserve typed fail-closed behavior
and the existing one-populated-flush envelope; do not remove all bounds, truncate trusted rows, or grow these owned
containers as the normal hot-path strategy. External caller-owned `step_into(out)` capacity is a separate caller
preparation obligation; no whole-combat zero-allocation claim follows.

Two concrete edge conditions belong to this same repair:

- Accepted `World.pending_events` can independently contain canonical retained-provenance raw Card events
  (`checkpoint.rs:416-430`; tests cover accepting this path). `sim.rs:504` appends them before scheduled work.
  Current Q0 counts only `card_bleed.rows`; initial U0 counts status/deferred pairs, not pending raw events.
  Inventory a separate checked cold pending-Card count (or an equivalent complete report treatment), so the
  repaired raw allowance cannot simply reject a previously accepted pending history. It must add no public
  entitlement or public bucket capacity. Ordinary restored pending non-Card events retain the existing legacy bound.
- `PairIndex` links/ordinals are u32 with `u32::MAX` reserved as `NO_NODE` (`index.rs:13-14,21-24`). Its present
  `reserve` checks allocator success only (`index.rs:78-81`); insertion later converts node count to u32, and callers
  cast row lengths (`card_bleed_feedback.rs:269,407`; `fx_projector/card.rs:95`). Check actual representability of
  indexed K/Q/B before cold reserve. A computed capacity beyond the node ordinal domain is an unsupported
  representation, not a reason to introduce an arbitrary small gameplay limit. An oversized reserve/arithmetic
  control can establish rejection without allocating billions of rows.

Mandatory bounded repair evidence: real accepted restore of >512 historical report rows with a due flush and no
new contribution, fresh attach/feed success with zero historical Card output; the accepted pending-Card counterpart;
preserved rejection of >512 non-Card legacy rows; actual cold capacities and allocation-free owned-buffer growth
beyond old fixed constants (raw report/wish masks and public output), not only filling a 64-row player-only model.
Keep the already-required source/comparison/strict-intake/privacy cases. No new source capture or broad campaign is
needed for this repair.

## Findings resolved in this inspected cut

- Source producer order/filter matches unchanged `packages/server/src/sim/cardHooks.ts:271-333`: actual landed
  `dot && ability == None && sig == None`, first eligible use clock, first insertion and ordinary sequential f64
  additions, periodic >=500 ms after stillness, and the actual run-ended hook. Trusted B3 retains finite bits,
  positive overflow and absorbing NaN; public exact arithmetic remains separate. Raid-start resets only Card;
  teleport retains the partial report. Schedule replacement is limited to the former pending Card flush link.
- Strict B3 `deserialize_any` accepts one-key Finite nonnegative finite payloads or bare special tag strings;
  payload-bearing special aliases and duplicate discriminants fail. Both World report rows and pending raw Event
  paths are tested through actual decode/restore, including canonical controls (`tests.rs:1502-1545`). World audit
  validates clock/provenance/full-pair uniqueness. No fixed clock grid remains (`card_bleed_feedback.rs:311-370`).
  The real producer-earned fractional-clock test restores and continues, including no historical output on fresh
  attach/clone/restore (`tests.rs:970-1155`).
- Both rows and AVL index reserve full Q at cold preparation, and both exact sidecars reserve K. This repairs the
  original first-new-pair allocation, independently of the remaining owned-event/output buffer gap above.
- Settled entitlement precedes each row's invalid/overflow classification and source redaction precedes grouping
  (`fx_projector/card.rs:80-124`). Checked exact merge/rounding errors and the actual f64-to-f32 cast failure are
  viewer-local typed errors; failure clears all staged output and disables the projector until rebind. Cast-finite
  amounts retain the original f64; there is no clamp or arbitrary cutoff (`card.rs:129-157`). Synthetic hidden,
  entitled, no-partial-prefix, boundary, lifecycle and cross-domain tests are present.
- The same raw pair now records a later invalid amount even after exact carry failure; the reverse ordering stays
  invalid. The tests explicitly label carry-failure state synthetic rather than claiming ordinary gameplay reach
  (`tests.rs:1547-1652`). Both local flags classify as InvalidAmount only after entitlement.
- Raw Card Event is server-only and omitted by stateless/public event conversion. The trusted headless digest uses
  a distinct discriminator, actors and B3 tag/finite bits; the old bounded scenario canonicalizer explicitly omits
  Card and points to the dedicated witness. These are the two approved raw Event consumers, not public evidence.
- The seven-case source harness performs normal construction, declared bootstrap setup/card grants and real
  validate/submit/ordinary steps. It never installs expected report totals, landed output or projected rows.
  `source_tests.rs:656-783` compares processed contributions and complete ordered trusted raw flush rows against
  the frozen source, including bits/tick/time/actors. All-seat public expected rows come from source contribution
  rows plus completed sight, not emitted output (`source_tests.rs:487-553`). The transparent Card observer records
  every actual emitted Card row; comparator checks complete per-viewer counts/order/identity/bits and rejects
  foreign viewers/non-Hit emissions (`554-624`). The wrong-valued extra-row control retains all expected rows and
  reaches this actual comparator (`629-653`). Privacy semantics are the deliberate native ADR0013 extension;
  the source fixture itself has no viewer audiences.

## Capacity and evidence limits

The generic accepted-state formula is used for non-player-only worlds; it does not silently claim the smaller
pristine Full8 estimate. The measured example reports A0=212, R=204, P=8, V=882, K=Q=7056 and B=7938. Its
**planning-allowance** expression is 46,991,264 bytes / about44.82 MiB, not21.5675 MiB and not a measured total heap
footprint. The reported 28-byte AVL node exceeds the earlier24-byte index allowance, which the README discloses.
The type-size test (`tests.rs:826-966`) prints Event/SeenEvent and other actual layouts; preserve its actual
no-capture receipt in the final evidence rather than describing a planning allowance as measured memory.

The actual allocator receipt `/tmp/cardlogs/card-alloc-GREEN.log` records construct96 / clone64 / restore1020 /
rebind3 blocks, first and second unseen pair0 blocks,20 repeated steps0, and beyond-prepared growth2 blocks. Its
prepared fill model is player-only Q/K64 (`tests.rs:1364-1432`), so it does not establish allocation freedom for
larger raw flush/report/public-output buffers. Inherited status-tag allocations are honestly excluded; no global
combat allocation claim is made.

## Actual receipts and identity gate

I directly inspected `/tmp/cardlogs/ability-63-source-final.log`: the log names this exact worktree's rh-sim build,
executes `abilities::source_tests::frozen_full_source_all_63_cases`, reports zero named prerequisites,1 passed /0
failed /15.85s, and literal `EXIT 0`. Existing ability source consumer/subtree are unchanged by git diff. README
records `cargo test -p rh-sim --lib frozen_full_source_all_63_cases -- --nocapture`, with offline/locked/j1 and
`CARGO_TARGET_DIR=target`. This is a real unchanged63-case SOURCE gate, not native tape equivalence. I reported
that fact to Root. Root subsequently authorized only the existing derived native recorder output and the one
content golden constant in documentation commit827422b5; their final bytes/gates are not admitted here.

Other inspected raw receipts preserve the initial fixed-grid and canonical-special-alias failures followed by
GREEN, plus the allocator RED/GREEN. `/tmp/cardlogs/rhsim-full-2.log` ends874 pass /1 failure /15 ignored,
728.87s, EXIT101, with the genuine old derived tape mismatch. `rhsim-full-3.log` at inspection had892 tests and
an actual tape failure but no terminal summary; it is not a completed green gate. Default/all-feature clippy raw
logs record exit0; README also claims25 Card tests,28 projector tests and rustfmt success, but those final
standalone raw command/terminal receipts and exact final code binding still need the author's seal/evidence.
Do not rewrite the first failures or infer a green full run from partial log progress.

Reserved identities in the inspected diff are checkpoint30/replay24/OBS22/policy16, protocol14 unchanged, with
`card-bleed-feedback/1` content visitor. The additional five existing paths are Root-granted identity-only hunks;
NPC restore is the separately admitted0be00f95 copy. Root owns integration with primary's protected lower observe
changes and fighter_churn_tests registration, final exact identity composition and later joint client/headless gate.

## Inspected WIP file bindings

No final native seal exists at this review. These are the exact read-only snapshot bindings; later repair/seal
requires a finite delta review. Frozen source410111B SHA256
`6b36256739bd473bc70ebd160a8632a26470ab8e4190f873026bd714e53d36ed` and controls3191B
`248a3be77749e9f966a9fff3ad6f7ba44ea4db4d3eddba3e0c9be9a71578fcd9` were independently recomputed and match
the released source; no recapture was run.

| File relative to native worktree | Bytes | SHA256 |
|---|---:|---|
| `crates/rh-sim/src/systems/card_bleed_feedback.rs` | 27863 | `246b2dcfb4193ddf3d618dcaceb49030097b8c519218bce104d44ad9cae39dff` |
| `crates/rh-sim/src/systems/card_bleed_feedback/tests.rs` | 63880 | `5adb659f0c37118503e4c58a5745c7076ad0b049a4df472408146b8e82df7ebd` |
| `crates/rh-sim/src/systems/card_bleed_feedback/source_tests.rs` | 38780 | `eba6f2874839c8f920c887381cc002dbe745fd70f57f016c7e5d48e2eb6795e3` |
| `crates/rh-sim/src/systems/card_bleed_feedback/index.rs` | 11704 | `a7320611407ea37578024a3359baa34ad13f9a3f9e8f041c1a0a4cf76f4a0179` |
| `crates/rh-sim/src/fx_projector/card.rs` | 29533 | `f14682e1ca265375de11941f4ee16c034a80d7f3edd50a09a51fcd9adc092a01` |
| `crates/rh-sim/src/fx_projector/mod.rs` | 15067 | `66cb42b8eaafe7da992ea12651ec4b6f391f3a106be904d0405bd70bb7a0da89` |
| `crates/rh-sim/src/fx_report.rs` | 10330 | `8563784d8b7340039988b4d4dd2a639c9abeefc76d8b0f78d4492cd4142de780` |
| `crates/rh-sim/src/checkpoint.rs` | 74426 | `567a9463e9de1ce7c1548bc948230ce9bbe8a319d2645b0a0bde85c0c234f02a` |
| `crates/rh-sim/src/events.rs` | 14169 | `7a432b9ba335a993052fcbd3b741a726d0d0546ea1eee38e34de10358e90e35b` |
| `crates/rh-sim/src/state.rs` | 52553 | `ec3ed9b734dd020f6f569cebd049045a34d331380a21f6315c21bd2ef1c3f5d0` |
| `crates/rh-sim/src/sim.rs` | 21126 | `eb769df56a1c0614fbf62eb9c4a7634c08bbe2c65ebf035c88d1033926c14094` |
| `docs/evidence/card-bleed-native/README.md` | 18065 | `e7867be98ea9697713e8f2d191a7a895743c790ae884035b2f2ffd6e0c831908` |
