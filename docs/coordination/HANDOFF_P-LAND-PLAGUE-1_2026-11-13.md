# Hand-off: the Plague land-generation stack (P-LAND-PLAGUE-1, -fix, -fix-2, -fix-3)

One merge request for four stacked packets. Written by the land-generation session.

```
PACKET:          P-LAND-PLAGUE-1 (+ P-LAND-PLAGUE-1-fix, -fix-2, -fix-3) — not in ORDER_OF_OPERATIONS: serves the
                 owner's land-generation decisions (LAND_GENERATION_REQUIREMENTS section 3 "Plague" and addenda 1, 2;
                 owner decisions of 2026-11-13 quoted below); ADR 0028 G1, G4, G5, G8, G10
BRANCH:          agent/fable/P-LAND-PLAGUE-1-fix-3 @ 8474950fb (code and tests), this hand-off on top; 15 commits on
                 feature/unity-rework @ 42ce9a72f. Worktree /Users/nevinmckinnon/Documents/Projects/RH-landgen-2.
GATE:            PASS (full, --oracle packet/P-LAND-PLAGUE-1-fix-3) on 8474950fb [skipped: Postgres suites, no DATABASE_URL]: 263 test
                 binaries ok, none failed; EditMode 1257 of 1257; mapgen_land_plague 26 passed. Earlier full gates on the
                 old base passed for -1 (fe50d4009), -fix (d8472fa22) and -fix-2 (f461bb885).
CHANGED:         crates/rh-sim/src/mapgen/style_warren/{pools.rs (new), walk.rs (new), walk_tests.rs (new), shape.rs,
                 planning.rs, mod.rs, README.md}; crates/rh-sim/src/mapgen/pipeline/{plague_pools.rs (new),
                 plague_pools_tests.rs (new), mod.rs}; the BogPool kind in mapdata/{model.rs, validate.rs},
                 mapgen/certify/{rules.rs, features.rs, diagnostics.rs}, mapgen/map_hash/mod.rs (one commit of its own);
                 crates/rh-sim/tests/{mapgen_land_plague.rs (new), content.rs (one NON_GAMEPLAY row; one row's text)};
                 crates/rh-mapdress/tests/{anchor.rs, marsh.rs} (golden constants, one re-pin commit); four briefs
D-RULES:         D1: option off byte-identical (the Warren legacy capture, option_off_maps_are_todays, the g8 guards and
                 rh-mapdress OFF_GOLDEN are green and unmoved); the option-on rule is new, with no legacy counterpart.
                 D2 n/a. No sim tick, wire, save, state-hash or content-hash change.
DEVIATIONS:      proposed new row (next free: DEV-034), in DEV-028's form: "Inside DEV-020. With the generator's
                 signature option on (off by default), the Plague styler lays no crescent beside a barrow. Its bog is
                 free pools of two to four overlapping rough discs (about 5, 8 or 12 across), each a BogPool feature
                 with a two-tile ring of plain floor, pools merged or at least 8 tiles apart, never lengthening a
                 Plague spawn's walk to the coliseum by more than 2 steps; the bog tree's own marsh counts as the zone's
                 bog. Barrows keep their rock, tunnel and siting rule; fewer fit (at least 55% of option off) and they
                 lose the wet fork (Plague's home advantage moves to the pools). Option off: legacy crescents, maps
                 byte-identical." Evidence: mapgen_land_plague. Reversible (flag).
SHARED RECORDS:  proposed edits: docs/DEVIATIONS.md (the row above); docs/backlog/README.md (rows for the four packets);
                 docs/MIGRATION.md checkpoint; ADR 0028 G5 may name Refusal::SignaturePools (one line).
LEGACY DOUBTS:   none
NOT ESTABLISHED: seeds beyond 96; the amounts once the church box lands (it changes which attempts are accepted, so
                 every Plague map moves again; the tests are properties over seeds, not pins); give_way has never fired
                 on a served map (it has unit tests, and a body it drops now discards the attempt); Postgres suites.
RISKS:           the pools' own share may drift between the 0.35 floor and today's 0.51 without a red test; the
                 styler commit is about 870 added lines (over the 450-line guideline: my reviewer judged it not
                 usefully cuttable, and that the implementer should have stopped and reported).
```

## Owner decisions this stack rests on (land-generation session's chat; quote these to the owner if you confirm them)
- 2026-11-13, afternoon, "Yes to all" to four questions; the two on Plague: the crescents become free pools and
  barrows keep their rock, tunnel, placement rule and number (the wet fork is lost); "large near the tree, small far"
  holds as a tendency.
- 2026-11-13, night, "Yes to both" to: "Count the tree's marsh as bog, with a floor of 80% of today's for marsh plus
  pools together and 35% for pools alone. Lower the barrow floor to 55%, since the zone is a fifth smaller." (and the
  Sentenced floors, which are P-MAPGEN-SIG-SCALE-2-fix).
- The owner has seen two 8-seed pictures of real generator output: pools on the small tree, and pools on the blueprint
  tree. The owner did not answer "approve" on a picture in words; the amounts were accepted after the second picture,
  and the owner then wrote "Please wrap up changes push and merge them" (2026-11-13, late night).

## The stack (all on 42ce9a72f)
| Packet | Branch tips | What |
|---|---|---|
| P-LAND-PLAGUE-1 | packet 93a012b24, agent 9c4028995 (kind dd4c054d3) | free pools by band from the tree; the BogPool kind as its own commit under your four conditions |
| P-LAND-PLAGUE-1-fix | packet 7472b930f, agent a8e85c1f9 | the spawn-walk guarantee by construction (walk.rs); wide_* tests on seeds 33-96 |
| P-LAND-PLAGUE-1-fix-2 | packet 638681d2b, agent 19592a87e | end-of-attempt check (pipeline/plague_pools.rs, Refusal::SignaturePools); a dry BogPool discards; unit tests for walk.rs |
| P-LAND-PLAGUE-1-fix-3 | packet 832619cfa, agent 8474950fb | the amounts at the owner's floors; the rh-mapdress re-pin |

## Reviews (reviewer-opus, by reading; shas are from before the replay onto the tree, same content)
- P-LAND-PLAGUE-1: LAND WITH NOTES. The kind commit meets your four conditions (appended after Cave; its own commit;
  LavaPool's pattern; nothing else in the six files); option off cannot move; determinism clean; notes 1 and 2
  (wording) done in the fix's stub; note 3 led to the fix.
- P-LAND-PLAGUE-1-fix: LAND WITH NOTES. walk.rs measures the oracle's walk; give_way terminates with the guarantee
  restored; notes became fix-2.
- P-LAND-PLAGUE-1-fix-2: LAND, no notes. The check equals the oracle's walk; it cannot run with the option off.
- Not re-reviewed after the replay onto the tree: one conflict in pipeline/mod.rs with P-MAPGEN-STYLE-REFUSE-1 (both
  added a Refusal variant and a test seam; both kept).

## Measurements on the blueprint tree (seeds 1-96 unless said)
- mapgen_land_plague: 26 tests pass (14 on seeds 1-32, 9 wide on 33-96, 2 on 1-96, 1 new amount test).
- Hard guarantees on 1-96: no pool lengthens a Plague spawn's walk past 2; rings, apron, spacing, certify hold; the
  end-of-attempt check agrees with the oracle's walk and refuses no attempt.
- Amounts, median map: pool bog 113.5 tiles (341 with the option off), the tree's marsh 213; pools' share ratio 0.44
  (0.51 on seeds 1-32); barrows 725 of 1198 (228 of 397 on seeds 1-32); free ground 3592.5 against 4446.
- Pools: 206 on 96 maps; one near-band pool in 32 maps (the box fills the near band).
- Worst accepted attempt index on seeds 1-32: 2 (the cave and tree bounds hold).

## rh-mapdress goldens (commit 8474950fb; yours to drop and redo at merge; OFF_GOLDEN did not move)
```
NO_ANCHOR_GOLDEN (seeds 1-4), was -> now
  0x0796_bc2a_20f7_4619 -> 0x5086_6ec6_79aa_a2b5
  0x5d1c_4f2d_b7e9_cc30 -> 0xace1_f5b9_69de_8b6a
  0xfac8_6967_db0a_4749 -> 0x138c_ea40_6f06_f3f2
  0xb58e_d01b_c819_9d17 -> 0x4f81_cc79_d5eb_1506
OFF_GOLDEN unchanged: True
SIG_GOLDEN (seeds 1-4 x Fire, Sentenced, Frost, Holy), was -> now
  0x40fe7f46d14ae639 -> 0x1bde57ac648f2bba
  0x06836f1b33ea09a4 -> 0x82e070cfd3e33ed2
  0xd1e43fa54369b2fa -> 0x24a38f2e006bb92f
  0xca2c469dac4c833f -> 0xe6621cd743cffd14
  0x4be4022169892c2a -> 0x9b3e318861fa107a
  0x0984dd44d9da2686 -> 0x221ae8dc30ab0ae9
  0x57904a658131762f -> 0x21c1c15f5d96da9f
  0x8efc14bcb4e2c163 -> 0x367892e6c184689d
  0x0d25c89570865eeb -> 0x6f7fc324b0ef4012
  0xbdec3327d5362a1d -> 0x93c3a93ef525a002
  0x83bbc9a78e4337b4 -> 0x4af7e5b929ec7a9e
  0x8ab128b83b58c4ae -> 0x4b2c5eadfda937f8
  0x3a9ecf02aac579f7 -> 0xa62f28c5f46fbfc8
  0xdda4654465a22303 -> 0x76e18f7caa0082da
  0x58834e22fcc87815 -> 0xfb66fa1d335e9b52
  0x16f5d83bd7ea0a2b -> 0xab4583d5232733b4
```

## Minor points left on purpose (owner: no fix packets for small notes)
- give_way drops the last-laid body touching any spawn's band, not necessarily the one that breaks the failing walk;
  it can only lose bog on an attempt that is then discarded.
- The size-by-band tests are close to vacuous on the larger tree (the tree's marsh is the bog near the tree).
- The ceiling of 1.5 on marsh plus pools is this lane's guard, not an owner figure.
- The architecture review (docs/coordination/LANDMARK_ARCHITECTURE_REVIEW_2026-11-13.md, finding 4) moves
  pipeline/plague_pools.rs beside the styler as a registered guarantee; that is a later packet, not this one.
