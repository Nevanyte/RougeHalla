# P-MAPGEN-SIG-FIRE-2: Fire's craters are arranged by band from the volcano by construction; streams stay two tiles wide

- **Serves:** owner direction 2026-11-12 (core rule G4: distance bands from the landmark choose the obstacle family
  and size); reviewer-opus notes on P-MAPGEN-SIG-FIRE-1 (2026-11-12: one REAL, one MINOR)
- **Implementer tier:** implementer-opus (rh-sim mapgen: the Fire styler in signature mode)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1: option off byte-identical (G8) · D2 n/a · no sim tick, wire or content-hash change

## 1. ID and outcome
P-MAPGEN-SIG-FIRE-1 placed the volcano and removed the lava river in signature mode, but the Fire styler only shrinks
or drops a crater that would touch the volcano's core band (`style_scorch/craters.rs:148-178`). The band test passes
by measurement on the pinned seeds (near-band mean 132 tiles against 117 mid/far; seed 16 keeps 8 craters, exactly
the test's floor), not by design: any later change to masks or attempts can break it, and the zone does not yet read
as "arranged around the volcano". When this lands, in signature mode the styler chooses each crater's size from its
band: the largest of its radius options in the near band, middle in mid, smallest in far, and the far band's pens
are thinned by a fixed rule (never below the camp-count floor the certifier needs), so G4 and the crater-count floor
hold by construction. Also (MINOR, same files): a stream that bends across a diagonal keeps two tiles of width (the
side cell is recomputed from each path tile's heading, `landmarks/signature/volcano.rs:256`).

## 2. Dependencies
- P-MAPGEN-SIG-FIRE-1 merged. May run beside P-MAPGEN-SIG-FROST-1 (disjoint files: `style_scorch/`, `volcano.rs`).

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/style_scorch/craters.rs`, `style_scorch/mod.rs`,
  `crates/rh-sim/src/mapgen/landmarks/signature/volcano.rs`; `docs/adr/0028-signature-landmarks.md`

## 7. Behaviour to preserve
- Option off: the crater path draws and decides exactly as today (pinned styler tests, the option-off identity case).
- Option on: every seed 1-16 still has its volcano, 2 or 3 streams ending in pools, lava within budget, the bog tree
  and the church; every map certifies with zero failures.

## 8. Acceptance checks
- Oracle, seeds 1-32 (a wider range than FIRE-1): for every map, every near-band crater is at least as large as
  every far-band crater of the same radius-option set; the near-band mean exceeds the far-band mean by at least 15
  percent; no crater tile in the core band; the crater count is at least the option-off count minus two on every
  seed, with no seed exactly at a floor it reaches only by luck (report the distribution).
- Oracle: every stream's lava is at least two tiles wide along its whole path, bends included.
- Report attempts per seed over seeds 1-32 and the worst attempt index.
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-FIRE-2` passes (the coordinator runs the full gate).

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-MAPGEN-SIG-FIRE-2`

## 10. Risk and suggested model tier
Opus. The crater shrink loop re-runs the route-stretch check at each size: choosing the size from the band first
should make it cheaper, not dearer.

## 11. Known traps
- Craters are pens centred on camps: they cannot move. Size and presence are the only levers.
- A larger near-band pen takes floor from streams' aprons: the pen still claims no floor near a stream or pool.

## Notes from previous attempts
