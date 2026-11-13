# Hand-off: P-LAND-SENTENCED-1 (Sentenced lanes, signature mode)

Written 2026-11-13 by the land-generation session, for the coordinator. **Uncommitted on purpose**, like the
requirements addenda. **This is a merge request for `agent/fable/P-LAND-SENTENCED-1-fix` @ `ca598cf01`** (the lanes
and the fix for the review's two notes, stacked): gate green, reviewed LAND, and the owner has approved the picture of
the built lanes (section 6). The branches are local, in the worktree `RH-landgen`; nothing is pushed.

```
PACKET:          P-LAND-SENTENCED-1 — not in ORDER_OF_OPERATIONS: serves the owner's land-generation decisions of
                 2026-11-13 ("Option 1: churchyard plus lanes"; LAND_GENERATION_REQUIREMENTS and addenda 1, 2);
                 ADR 0028 G1/G3/G5/G7/G8; LANDMARK_GENERATION_SPEC section 3 (lane split)
BRANCH:          agent/opus/P-LAND-SENTENCED-1 @ c7f75cada, from packet/P-LAND-SENTENCED-1 @ e3645e85f, base 1032e5bdf;
                 then agent/fable/P-LAND-SENTENCED-1-fix @ ca598cf01 on top of it (the review's two notes; section 6).
                 Worktree /Users/nevinmckinnon/Documents/Projects/RH-landgen. Local only, nothing pushed.
GATE:            PASS (full, --oracle packet/P-LAND-SENTENCED-1) on both commits, attempt 1/2 each [skipped: Postgres
                 suites, no DATABASE_URL]: c7f75cada (implementer) and ca598cf01 (the fix, the tip to merge).
CHANGED:         crates/rh-sim/src/mapgen/style_gallows/{lanes.rs (new), shape.rs, rows.rs, mod.rs, README.md};
                 crates/rh-sim/tests/content.rs (one NON_GAMEPLAY row);
                 crates/rh-mapdress/tests/{anchor.rs, marsh.rs} (golden constants only, in the separate commit c7f75cada);
                 docs/backlog/packets/P-LAND-SENTENCED-1-fix.md (new, the fix's brief)
D-RULES:         D1: loose proof is the oracle (lanes have no legacy counterpart). Option off is byte-identical:
                 the style_gallows legacy capture, option_off_maps_are_todays, the g8_* tests and the rh-mapdress
                 OFF_GOLDEN are green and unchanged. D2 n/a. No sim tick, wire, save, state-hash or content-hash change.
                 D5/D6/D9 untouched.
DEVIATIONS:      proposed DEV-030 (unsigned; a new row in DEV-028's form, "Inside DEV-020", as reviewer-opus advises,
                 not an amendment of the signed DEV-020; DEV-029 is Frost Wall's): with pipeline::Options::signature,
                 Sentenced fence rows are straight lanes parallel to the church's door axis on the lines
                 |d| mod 8 == 4, gated on one grid ((along - 8) mod 12 < 3, counted from the door line), kept 2 tiles
                 clear of the church and graveyard box, with no jogs and no min_run; legacy rows (centroid axis,
                 Viterbi lines, 3-tile jogs, alternating 2/8 phases) stay for option off.
SHARED RECORDS:  proposed edits: docs/DEVIATIONS.md (the row above); docs/backlog/README.md (a row for the packet; the
                 brief arrives with the merge); docs/MIGRATION.md checkpoint (the merge, and the goldens below).
LEGACY DOUBTS:   none (legacy has no church)
NOT ESTABLISHED: Lanes are measured on seeds 1-32 without decor (seeds 1-8 with decor), on today's small church.
                 Nothing is measured on the 29-tile church of SCALE-2, with a churchyard fence, or with `entrance`
                 moved to a churchyard gate (the gate phase 8 is re-measured then). Route quality against today's rows
                 is not compared beyond "every map certifies clean". The gate ran on base 1032e5bdf, 40 commits behind
                 the integration head; none of those commits touches crates/rh-sim/src/mapgen or crates/rh-mapdress.
RISKS:           In signature mode the style_gallows Plan holds two orientations (plan.axis/s_lo/t_lo/rows are the
                 lanes'; base_rows and square stay in today's orientation). validate_plan works each out from the
                 zone's features; a future reader of Plan must do the same (now doc comments on Plan and Square).
                 A signature church whose door is not three open tiles in one run stops generation with
                 pipeline::Error::Style(Feature): it cannot happen on today's church (reviewer's trace; a 400-seed
                 sweep), and it WILL happen on every signature map if SCALE-2 grows the Church feature's box to the
                 whole blueprint (section 6, the request).
```

## 1. What the rule is, as built

Signature mode only (the zone holds a `Church` feature); option off takes today's path unchanged.

- The spine runs through the middle entrance tile along the door axis. `along` counts from the door line, positive out
  of the door; `d` is the distance across from the spine.
- Fence stands only on lines with `|d| mod 8 == 4`. No jogs. Each lane line is one straight row.
- Cross-lane bands, the tiles with `(along - 8).rem_euclid(12) < 3`, never hold fence, so every gap lines up across the
  zone and no stretch is longer than 9.
- No styler fence within Chebyshev 2 of the yard box (bounding box of the church footprint and its `Graveyard` features).
- The gallows square, guard houses, route repair, detours and `min_piece` (6) are as today. `Dials::min_run` (10) is not
  applied to lanes: the brief measured it at about 0.05 of the kept median, which would have left a margin of 0.08.
- Tunables: `pub const LANES` in `style_gallows/lanes.rs`, outside `Definition` and `Dials`, so the content hash does
  not move. One `NON_GAMEPLAY` row (your answer to request 5.5).
- Neither path draws from any random stream.

## 2. What I verified myself, apart from the implementer's report

- The two oracle files are unchanged since `packet/P-LAND-SENTENCED-1`; the 8 changed files are all in the write scope;
  the worktree is clean.
- The full gate log (`RH-landgen/.agent-runs/gate/20261113T133507-agent-opus-P-LAND-SENTENCED-1-full.log`) ran all 16
  steps: 241 `test result: ok`, none failed, EditMode 906 of 906 (the count on that base).
- Re-ran on the branch: the oracle (10 pass, 2 ignored), the report, the sheet dump and all of `rh-mapdress`. The sheet
  dump is byte for byte the implementer's (16 maps, seeds 1-8, option on and off).
- `git merge-tree feature/unity-rework agent/fable/P-LAND-SENTENCED-1-fix` merges cleanly at `c04411dad`. Both sides
  add rows to the `NON_GAMEPLAY` table in `crates/rh-sim/tests/content.rs` (your Frost Wall rows, my `LANES` row).
- On the fix @ `ca598cf01`: the full gate log
  (`RH-landgen/.agent-runs/gate/20261113T143328-agent-fable-P-LAND-SENTENCED-1-fix-full.log`) ends `GATE PASS (full)`
  with 241 `test result: ok`, none failed, EditMode 906 of 906; all seven `mapgen_signature_*.rs` files and the oracle
  pass; the eight-seed sheet dump is byte for byte that of `c7f75cada`. The gate's Unity step rewrites
  `client-unity/UnityProject/Assets/Resources/Showcase/NunitoRegular.asset` in the worktree; I restored it both times
  and the worktree is clean.

## 3. Figures (seeds 1-32, option on, no decor)

| | value |
|---|---|
| Fence share of free ground, option on over option off (min / median / max) | 0.58 / 0.73 / 0.85 (test: median at least 0.6, every seed at least 0.3) |
| Lane fence tiles (min / median / max); option off 277 / 329 / 418 | 189 / 239.5 / 280 |
| Worst attempt index (seeds 4, 6, 12, 17, 19, 22, 24, 25, 31 land on attempt 1) | 1 |
| Door axis equals the fence axis | 32 of 32 seeds |
| Lane fence on the smaller side of the spine over the larger side | 0.21 / 0.61 / 0.98 |
| Refusals before the accepted attempt | 3 Prefix, 1 Repair(RadiusPost), 5 SignatureDiscarded |

The owner accepted "at most about 80% of today's fence, probably nearer 70% once built" (addendum 2, decision 1).
Built, it is 73%.

## 4. Your pins (request 5.4, option b)

**None of `crates/rh-sim/tests/mapgen_signature_*.rs` moved.** All seven files pass on the branch (aprons 2, core 8,
fire 11, fire_bands 5, frost 7, frost_lake 5, reserve 11), so there is nothing for you to re-pin there. The brief had
named two `mapgen_signature_frost_lake.rs` pin tests as likely to move; they no longer exist on this base.

## 5. `rh-mapdress` goldens (my lane; re-pinned in `c7f75cada`, which you can drop and redo at merge)

Decoration is seeded from the whole map's hash, so every zone's value moves on an option-on map when one zone's fence
does. `OFF_GOLDEN` did not move.

`tests/anchor.rs` `NO_ANCHOR_GOLDEN`, seeds 1-4:

| seed | was | now |
|---|---|---|
| 1 | `0x2380_2146_b564_8178` | `0xd20c_c01b_a69a_204a` |
| 2 | `0x20cd_44ab_7b5f_3f8d` | `0x22b0_0e8b_c9de_4713` |
| 3 | `0x59f2_51c8_e9f0_6d1b` | `0xa6d9_07d7_1ba6_062c` |
| 4 | `0x28eb_45a8_12d4_105c` | `0x795b_39bd_d94e_1243` |

`tests/marsh.rs` `SIG_GOLDEN`, was → now:

| seed | Fire | Sentenced | Frost | Holy |
|---|---|---|---|---|
| 1 | `1082e88bfd5b169a` → `5bfbc29c780e7b12` | `f2b70c47aa24b552` → `b25128cd1ee7149d` | `d96801ea4fe9c31c` → `2a8391e9b8a2f7ea` | `210d226d82b730a9` → `d8ff4d8ceabcb623` |
| 2 | `7b5be10e054c950f` → `4efcf425d4203642` | `3d43e0e1a7000228` → `5da8ee29238891df` | `686f6ea4c10e7707` → `9c2fc68d07d633ae` | `0edd5958dfc8beca` → `84a17612e03ac325` |
| 3 | `84071c9a816931ae` → `e71a2290fbd5808f` | `decce96a3dc70342` → `6d1ec25f74e8ce18` | `e2a0dcfe12826b06` → `0e65d77daac9be59` | `2e96c0549f8ea4c2` → `7c7904eb445d9c5f` |
| 4 | `b5edcd3810b81377` → `9d9e5080028510a3` | `79d0feaa3fb78af0` → `0262d63a684cd37d` | `d18450a951f82bd5` → `28f62a65c4f31077` | `d3fb32e11832525e` → `bbbbf49610da2ce2` |

Any landmark packet you merge before this one moves these again; the values above then need taking afresh from the
failing assertions on the merged tree.

## 6. Review and owner approval

- **Review of `agent/opus/P-LAND-SENTENCED-1` @ `c7f75cada`: LAND WITH NOTES** (`reviewer-opus`, 2026-11-13). Its
  findings: the rule is implemented by construction; the `rows.rs` `flush` refactor is equivalent line by line for
  option off; no stream is drawn on either path; `LANES` outside the content hash is honest; nothing reads `Plan`
  outside `style_gallows` apart from the plan carried through `style_zones/mod.rs`. Two notes, both MINOR and
  fragility only ("neither is wrong today"):
  1. The door was derived without checking that it is one run of three tiles, and a church whose door could not be
     found fell back to today's rows silently.
  2. `Plan`'s two orientations and `Square::s` (an offset from a grid origin the plan no longer carries in signature
     mode) needed doc comments, as did the fact that `validate_plan` reads the door again at props time.
  It did not check: seeds beyond 32, decor beyond seeds 1-8, how the Unity client draws a `FenceRow` whose axis is now
  the door axis, or the `Church` box SCALE-2 will produce.
- **`P-LAND-SENTENCED-1-fix`: both notes applied** on `agent/fable/P-LAND-SENTENCED-1-fix` @ `ca598cf01`, one commit
  stacked on `c7f75cada` (made by this session under CLAUDE.md "a fix of a few lines it may make itself, through the
  same gate"; brief `docs/backlog/packets/P-LAND-SENTENCED-1-fix.md` on the branch). `lanes::frame` now returns
  `Ok(None)` without a `Church` and `Err(Error::Feature)` for a `Church` whose door-side wall line does not leave
  exactly three open tiles in one run. No map moves: the eight-seed dump is byte for byte what it was, the oracle
  passes 10 of 10, and the goldens need no further re-pin. A sweep with the option on, every attempt of every seed
  (1-400 without decor, 709 attempts; 1-64 with decor, 101 attempts), met no generator error. Merge the fix branch,
  not `c7f75cada`.
- **Re-read of the fix @ `ca598cf01`: LAND** (`reviewer-opus`, by reading only, and conditional on the full gate
  below). Option off is exactly as before; on today's church the strict door cannot fire on any path (traced through
  `Site::floor`/`wall`, `style_protect` and `repair_connectivity`); the doc comments are true; the hard error is the
  right trade against the silent fallback. Three optional wording nits, comments only, left for you to fold in at
  merge so that the gated commit stays the tip:
  - `style_gallows/mod.rs:190` says "the plan is refused as `Error::Feature`"; "the styler stops with
    `Error::Feature`" is clearer, since a styler error is not a refused attempt.
  - `style_gallows/mod.rs:35-37`: `Square::s` is the start of the square's window; the 3x3 sits at `s` plus an
    `offsets_s` entry.
  - `style_gallows/shape.rs:147-148` still describes `Some`/`None` without the `Err` case.
- **Full gate on `ca598cf01`: PASS** (`--oracle packet/P-LAND-SENTENCED-1`; Postgres suites skipped), so the
  re-read's condition is met.
- **Owner: approved.** The picture of the built lanes on seeds 1-8 (generator output, not a script; the eight
  option-on maps of `c7f75cada`, which the fix leaves byte for byte the same) was sent in this session's chat with the
  question "Do you approve the built lanes picture I sent, or what should change?". The owner answered **"Approve
  lanes"** (2026-11-13). That is the approval this lane's rule asks for before a merge request. It was given in this
  session's chat, not yours; if you take owner decisions from your chat only, ask the owner there.

### A request that follows from note 1 (for SCALE-2, not for this merge)

A styler `Err` reaches the caller as `pipeline::Error::Style`: the generation call fails, the next attempt is not
tried. So the strict door is an assertion that our two lanes agree on what a church's door is. If SCALE-2 makes the
`Church` feature's box the whole 29x29 blueprint, the door-side edge becomes the graveyard's last row (29 open tiles)
and **every signature map stops with `pipeline::Error::Style(Feature)` in `style_gallows`**. Before the fix the spine
would have landed on the right column only because the blueprint is symmetric. Two ways out, yours to choose:

- **(a)** the `Church` feature keeps covering the church building only (blueprint rows 0 to 16), with the door on its
  edge, and the graveyard stays separate `Graveyard` features, as today; or
- **(b)** stylers are given the zone's anchor (`ZoneAnchor.entrance`, `front`) through `style_runtime`'s `BaseContext`
  (a shared file), and the lanes read the door from it instead of deriving it. I would take (b) in a follow-up packet
  once you say the anchor's shape is settled; it also covers `entrance` moving to a churchyard gate (L2a).
- **Churchyard (L2a):** still for the owner to confirm in your chat. Until SCALE-2, an option-on Sentenced map has lanes
  and no churchyard fence, which is what the picture shows.

## 7. Commits on the branch, after the oracle

```
ca598cf01 P-LAND-SENTENCED-1-fix: the lanes accept the church's door only as three open tiles in one run; Plan's two orientations and Square::s documented; brief
c7f75cada P-LAND-SENTENCED-1 re-pin: rh-mapdress NO_ANCHOR_GOLDEN (seeds 1-4) and SIG_GOLDEN (seeds 1-4 x Fire/Sentenced/Frost/Holy)
00b0337bf P-LAND-SENTENCED-1: validate_plan: the lanes axis is checked only on a plan with rows
346a26994 P-LAND-SENTENCED-1: style_gallows README: the signature-mode lanes
4bc7eb498 P-LAND-SENTENCED-1: NON_GAMEPLAY row for the LANES tunables; rustfmt
c599dad97 P-LAND-SENTENCED-1: Sentenced lanes in signature mode (rows on the door-axis lattice, one gate grid from the door, apron round the yard box)
```

`git diff --stat packet/P-LAND-SENTENCED-1..agent/opus/P-LAND-SENTENCED-1`: 8 files, 365 insertions, 61 deletions
(`lanes.rs` 248 new lines). The fix on top (`c7f75cada..ca598cf01`): 5 files, 127 insertions, 12 deletions, of which
81 lines are its brief.
