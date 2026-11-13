# Land generation requirements, addendum 2: four owner decisions (lanes, bog pools) and one request (a feature kind for a bog pool)

Written 2026-11-13, afternoon, by the land-generation session. It adds to
[LAND_GENERATION_REQUIREMENTS.md](LAND_GENERATION_REQUIREMENTS.md) and
[addendum 1](LAND_GENERATION_REQUIREMENTS_ADDENDUM_1.md) and edits neither. **Uncommitted on purpose**, as they were:
the coordinator decides where it is recorded. Section 4 is the only part that asks you for work.

## 1. Your answers, received

Read from the MIGRATION checkpoint and `LANDMARK_GENERATION_SPEC.md` (update of 2026-11-13, midday):

- Request 5.4, option (b): my branches leave `crates/rh-sim/tests/mapgen_signature_*.rs` untouched and the hand-off
  lists every value that moves; you re-pin at merge. My gate is therefore red on those tests and only on those; the
  hand-off names each one.
- Request 5.5: the `NON_GAMEPLAY` row for my lane's constants is in my scope.
- L2a (the churchyard in the church's blueprint): you wait for the owner to confirm it in your chat. I have asked
  the owner to do that. The lanes packet does not depend on it (addendum 1, 5.6: until SCALE-2 an option-on Sentenced
  map has lanes and no churchyard fence).

## 2. Owner decisions in this session (chat, 2026-11-13, afternoon)

Four questions were put with the measurements and a recommendation each, worded so that "yes" accepts the
recommendation. The owner answered **"Yes to all"**. The questions as put:

1. **Sentenced fence amount.** "The lanes can hold at most about 80% of today's fence (median over 32 maps), and
   probably nearer 70% once built. The churchyard fence is the coordinator's and is not counted in that; by my
   arithmetic, not a measurement, a yard about 30 tiles across adds 80 to 100 tiles back, roughly a quarter of today's
   amount. Accept that, keeping rows 8 tiles apart?" Accepted. (The alternative offered was rows 7 apart: about 90%,
   every lane one tile narrower.)
2. **Church in the corner.** "Because the church stands at the zone's far corner, the lane lines are symmetric about
   its door axis but the fence is not: on the median map one side holds 15% of the other's fence, and on 8 of 32 maps
   one side has none. Leave the church's site rule as it is?" Accepted: nothing is asked of your site rule.
3. **Barrows and their bog.** "You accepted 'barrows unchanged', but all of today's bog is the crescent on each
   barrow's wet flank. Shall the crescents become the free pools, with barrows keeping their rock, tunnel, placement
   rule and number?" Accepted, with the cost stated: a barrow no longer offers legacy's three-way choice (dry side,
   wet side, tunnel); Plague's home advantage moves to the pools.
4. **Large pools near the tree.** "A 12-wide pool fits beside the tree on only 9 of 32 maps, because the tree stands
   at the zone's outer edge among camps. Shall 'large near the tree, small far' hold as a tendency instead of on
   every map?" Accepted as the tests are written: pools near the tree are never small, pools far from it are never
   large, near pools average at least twice the area of far ones. Re-measured when SCALE-3 enlarges the tree.

The figures in questions 1, 2 and 4 were measured before RESERVE-1 (`566841f4` and `b3a8fb51`). Section 5 gives them
again on the reserved sites.

## 3. Corrections to addendum 1, section 4 (the lanes rule as measured and tested)

- **Gate grid.** Cross lanes are the tiles with `along mod 12` in {8, 9, 10}, `along` counted from the door line (the
  line of the anchor's `entrance` tiles), positive out of the door. Addendum 1 did not give the phase; I had proposed
  3 and the measurement chose 8 because the rows keep more fence there (0.78 of option off after detours against
  0.67). The phase depends on where `entrance` is: if SCALE-2 moves `entrance` from the church door to the
  churchyard's main gate, the phase is re-measured.
- **Amount.** The test holds the median on/off ratio of the fence's share of free ground in [0.6, 1.2] and every seed
  at 0.3 or more, not "within about a fifth" (decision 1 above).
- **`docs/landmarks/blueprints/church.txt` line 6** says "The two enclosures the other lane builds start outside this
  box." Under Option 1 my lane builds no enclosure. If the owner confirms L2a, the churchyard fence is inside the box;
  if not, the Sentenced zone has no enclosure at all, only lanes, and I take that back to the owner.

## 4. Request: a feature kind that owns a free bog pool (decision 3)

Bog floor in a strict zone must be owned by a feature of the zone (`certify/features.rs:222` `feature-hazards`;
`pipeline/style_contract.rs:64-72`). Today the `Barrow` owns its crescent. A free pool needs an owner, and no existing
kind fits: `Barrow` and `Landmark` need wall pieces or template params, `Mere` is Frost's lake (its params count
ice), `Causeway` and `Bush` mean other things. The brief (`packet/P-LAND-PLAGUE-1`,
`docs/backlog/packets/P-LAND-PLAGUE-1.md` section 11, first trap) proposes:

- a signature kind, for example **`BogPool`**: no params, no wall, no LOW, terrain 0, job `Crossing`; one feature per
  pool (a pool is one 4-connected body of two to four overlapping discs, 21 to 565 tiles by the oracle's bounds);
- added as FIRE-1's stub added `LavaPool` (`aa22573a6`): `mapdata/model.rs`, `mapdata/validate.rs`,
  `certify/rules.rs` (`SIGNATURE_KINDS`), `certify/features.rs`, `certify/diagnostics.rs`, `map_hash/mod.rs`.

All six files are yours or shared. Tell me which you want:

- **(a)** you add the kind in a stub commit on the integration branch (or hand me the commit to cherry-pick onto
  `packet/P-LAND-PLAGUE-1`), and the implementer starts from it; or
- **(b)** you widen P-LAND-PLAGUE-1's write scope to those six files for the kind only, and `reviewer-opus` checks
  that nothing else in them moved.

Facts that bear on it: the certifier caps a map at 250 features (`R.features`) and `feature_grid` is `u8`; today's
option-on maps hold 77 to 95 features, and a Plague zone would gain about 4 to 10 pools. The kind exists only on
option-on maps, so option off stays byte-identical. Whether a new feature kind moves the map blob's format, the
checkpoint or any identity is yours to say; FIRE-1's `LavaPool` is the precedent I am relying on, not something I
checked. If a new kind is not wanted at all, name the existing kind a pool should be owned by; the oracle's test 9b
(`no_barrow_owns_bog`) forbids only `Barrow`.

**The Plague implementer does not start until you answer.**

## 5. Rebase onto the reserved sites

Both packet branches were rebased onto `1032e5bd` (after RESERVE-1 and its carry) and their reports re-run, seeds
1 to 32, option on. Both briefs carry the full before-and-after tables (section 12, last subsection of each).

**Sentenced** (`packet/P-LAND-SENTENCED-1` @ `e3645e85f`): the same three tests fail and the same seven pass.

| | before RESERVE-1 | on the reserved sites |
|---|---|---|
| Door axis equals today's fence-row axis | 15 of 32 seeds | 26 of 32 |
| Most fence the lanes can hold, as a share of option off (min / median / max) | 0.56 / 0.81 / 1.17 | 0.60 / 0.77 / 0.99 |
| The same after the detour rule | 0.53 / 0.78 / 1.12 | 0.59 / 0.76 / 0.93 |
| Lane fence on the smaller side of the spine over the larger side | 0.00 / 0.15 / 0.61 | 0.21 / 0.60 / 0.98 |
| Worst attempt index today | 3 | 1 |

Decision 1's figure moves from "about 80%" to about 77% at most; the test's bound (median at least 0.6) is
unchanged. Decision 2's premise is gone, to the good: with the church on the back edge of its site no seed has an
empty side.

**Plague** (`packet/P-LAND-PLAGUE-1` @ `cc1cb5ba6`): 8 tests fail today and 6 pass.

| | before RESERVE-1 | on the reserved sites |
|---|---|---|
| Styler bog share, option on over option off (min / median / max) | 0.57 / 0.96 / 1.55 | 0.27 / 0.74 / 1.43 |
| Plague barrows over seeds 1 to 32, option on (option off 397) | 372 (94%) | 312 (79%) |
| Seeds with room for a 12-across pool and its ring in the near band, barrows giving way | 9 of 32 | 25 of 32 |
| Pool capacity over the budget target, pools laid first (min / median) | 1.12 / 1.69 | 1.10 / 1.65 |
| Largest growth of a spawn's walk when bog is avoided | 3 steps (seed 25) | 2 steps |

- The budget test (bog share within a fifth of option off) passed before the reservation and **fails today at
  0.74**: fewer barrows carry fewer crescents. It is now one of the tests the pools must turn green.
- **I amended one bound in my oracle:** barrows at least 70% of option off over seeds 1 to 32, was 85%. The
  reservation alone takes them from 94% to 79%, so 85% could not pass whatever the pools do; 70% keeps the same
  allowance (about a tenth of today's barrows may give way to pools). The owner is told of this in chat. If you
  expected the reservation to keep the barrow count, 397 to 312 is the figure to look at.
- Large pools near the tree fit on 25 of 32 seeds only because the site round today's small tree is empty; SCALE-3's
  29-tile tree fills it. The size rule stays a rule on averages (decision 4).

## 6. Smaller notes

- **`rh-mapdress` goldens** (`tests/anchor.rs` `NO_ANCHOR_GOLDEN`, `tests/marsh.rs` `SIG_GOLDEN`): they are in my lane
  and move with each of my packets. Each of my branches re-pins them in one separate commit labelled as a re-pin,
  from the values the failing assertions print, so that you can drop it and redo it at merge. reviewer-opus's advice
  to replace `NO_ANCHOR_GOLDEN` with a direct comparison is open with the owner; I leave that test's form alone.
- **`crates/rh-sim/tests/content.rs` scans `src/` only** (`sources`, `:383`). `LANDMARK_GENERATION_SPEC.md` section 4
  says it rejects unregistered consts "including in test files"; both oracle authors found that it does not. No
  action needed; the oracles hold no `const` anyway.
- **Backlog rows.** `docs/backlog/README.md` has no rows for `P-LAND-SENTENCED-1` and `P-LAND-PLAGUE-1`; the briefs
  are on their packet branches and arrive with the merges. Proposed follow-ups, not briefed: `P-LAND-SENTENCED-2`
  (gallows square on the spine, guard houses by band), `P-LAND-SENTENCED-3` (lantern posts at lane gates,
  decoration), `P-LAND-PLAGUE-2` (water and mud decoration rings round each pool).
- **Branches** are local only (nothing pushed): `packet/P-LAND-SENTENCED-1` @ `e3645e85f` and, from it,
  `agent/opus/P-LAND-SENTENCED-1` (implementer-opus running since this afternoon) in worktree `RH-landgen`;
  `packet/P-LAND-PLAGUE-1` @ `cc1cb5ba6` in `RH-landgen-2`.

## 7. Not established

- The lanes and the pools are not implemented; every figure here is today's generator measured against the new
  rules, or a script's upper bound.
- Nothing is measured on a 29-tile church or tree (SCALE-2, SCALE-3), or with a churchyard fence.
- The owner has seen today's maps and a script preview of the lanes' upper bound on eight maps, not generator output.
