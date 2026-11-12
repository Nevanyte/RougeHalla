# P-MAPGEN-SIG-FROST-2: a Frost map whose main lake is not at the cave's mouth is discarded

- **Serves:** owner decision 4 (2026-11-10: "Frost frozen lake with an enterable frozen cave at the back with the elite
  camp inside", mouth facing the lake); core rule G5 (failing maps are discarded, not patched); reviewer-opus note 1 on
  P-MAPGEN-SIG-FROST-1 (2026-11-12, REAL)
- **Implementer tier:** implementer-opus (rh-sim mapgen: the end-of-attempt signature check)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework after P-MAPGEN-SIG-FROST-1 lands
- **D-rules touched:** D1: option off byte-identical (G8); no legacy counterpart (DEV-020) · D2 n/a · no sim tick,
  wire or content-hash change
- **Write scope:** `crates/rh-sim/src/mapgen/landmarks/signature/{mod.rs,cave.rs}`,
  `docs/adr/0028-signature-landmarks.md` (section 5)

## 1. ID and outcome
P-MAPGEN-SIG-FROST-1 seeds the main lake within 8 floor steps of the cave's mouth, but when the far elite camp sits
in a narrow strip of Frost along the map edge the styler's clearance rules leave no room there and the lake grows where
it does today: on seeds 17 and 18 of 1-32 it is about 100 floor steps from the mouth. FROST-1's brief said not to
refuse those attempts; the owner's description of the landmark says the mouth faces the lake, and G5 says a map that
fails a rule is discarded. When this lands, the end-of-attempt signature check (`SignatureContext::intact`, reported as
`Refusal::SignatureDiscarded`) also requires: if the Frost zone has any ice body the cave does not own, the largest one
lies within `lake_reach + 2` (10) floor steps of the cave's mouth. A Frost zone with no ice outside the cave is kept
(the styler may legitimately place none). The generator then tries the next attempt, as for any other discard.

## 2. Dependencies
- P-MAPGEN-SIG-FROST-1 merged.

## 5. Exclusive write scope
- `crates/rh-sim/src/mapgen/landmarks/signature/mod.rs` (the check, called from `SignatureContext::intact`; the
  threshold derived from `Definition::lake_reach` or a new `Definition` field, never a new `const`: a new `const` in
  `rh-sim/src` needs a `tests/content.rs` row, outside this scope); `landmarks/signature/cave.rs` only if a helper
  belongs there; `docs/adr/0028-signature-landmarks.md` (decision 6's discard list, decision 11, the measurements, and
  the Consequences bullet that says seeds 17 and 18 are not refused).
- Confirmed against the code (oracle author, 2026-11-12): the end-of-attempt check is
  `crates/rh-sim/src/mapgen/pipeline/mod.rs:649-651` (`placed_any && (!self.signature.intact(&map) ||
  !certifies(&map))` -> `Refusal::SignatureDiscarded`), after `SignatureContext::finish` (`:622-624`) has written the
  anchors, so `intact` already sees the Frost anchor's `entrance` (the mouth) and the finished `feature_grid`,
  `region_grid` and `terrain`. No change to `pipeline/`, `style_rime/` or `cave.rs` is needed. The FROST-1 brief's
  `style_rime/**` allowance is withdrawn: the styler must not change (every unchanged seed's map is pinned).
- Not `tests/`, not `style_rime/`, not `pipeline/`.

## 7. Behaviour to preserve
- Option off: byte-identical. Option on: every seed 1-32 still certifies within the attempt limit with all five
  anchors; seeds whose lake is already at the mouth land on the same attempt and produce the same map as before.

## 8. Acceptance checks
- Oracle, seeds 1-32 (FROST-1 asserted 1-16): on every finished map with unowned Frost ice, the largest unowned ice
  body is within 10 floor steps of the mouth; seeds 17 and 18 certify on a later attempt than before; every other
  seed's map hash is unchanged from FROST-1's.
- Report attempts per seed and the worst attempt index (limit 16; worst today 2), and the time per certified map.
- First measure whether seeds 17 and 18 took the no-forecourt mouth fallback: if every far-lake case is a fallback
  case, say so (a cheaper Landmarks-phase refusal may then be equivalent; the end-of-attempt check stays the rule).
- `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-FROST-2` passes (the coordinator runs the full gate).

## The exact rule (oracle author, 2026-11-12)
- **Where:** inside `SignatureContext::intact` (`landmarks/signature/mod.rs:402`), i.e. the end-of-attempt check; a
  failing map is refused `Refusal::SignatureDiscarded` and the pipeline tries the next attempt (G5). Not in the
  Landmarks phase and not in the styler (measurement 3: nothing at the Landmarks phase predicts the far lake).
- **What counts:** the Frost zone is the finished map's `region_grid == Zone::Frost.code()`; its ice is floor
  (`TILE_FLOOR`) with `terrain == Definition::ice` (6). **Owned ice** is ice whose `feature_grid` id is the `Cave`
  feature's (the cave's interior ice); every other Frost ice tile is unowned (the styler's meres and any other ice).
  The largest body is the largest 4-connected set of unowned Frost ice (on a size tie, the first in row order, as
  the oracle).
- **Threshold:** the fewest 4-connected steps over floor (`TILE_FLOOR`, any zone, owned or not) from any mouth tile
  (the Frost anchor's `entrance`, step 0) to any tile of that body is at most `lake_reach + 2` = **10**. No path at
  all fails.
- **Kept:** a map whose Frost zone has no unowned ice (none on seeds 1-64, so this branch is not exercised by maps).
- **Only discards:** nothing else changes; a seed whose map meets the rule lands on the same attempt with the same map.

## Measurements (oracle author, 2026-11-12)
Option on, `decor: false`, the generator as merged at FROST-1, seeds 1-64; debug test build without debug info, macOS
arm64; a throwaway probe and a throwaway local patch of the rule, both reverted.
1. **Lake distance today.** On 61 of 64 seeds the largest unowned Frost ice body is 3 floor steps from the mouth
   (seed 25: 5). Three seeds exceed 10: **17** (98 steps, 231 tiles), **18** (102, 350), **34** (20, 283). Nothing
   lies between: the threshold 10 has 5 steps of slack above the farthest kept lake and 10 below the nearest far one.
2. **Attempts, today -> under the rule** (seeds not listed: 0 -> 0). Seeds 1-32: 8: 2 -> 2; 9: 2 -> 2; 11: 1 -> 1;
   16: 1 -> 1; **17: 0 -> 1**; **18: 0 -> 3** (attempt 1 refused `Repair(RadiusPost)`, attempt 2 `Signature`);
   32: 1 -> 1. Seeds 33-64: 33, 35, 36, 37, 39, 44, 52, 57, 62, 63: 1 -> 1; **34: 0 -> 1**; 42, 48, 58: 2 -> 2;
   51: 7 -> 7. Worst attempt index: seeds 1-32 today 2 (seeds 8 and 9), under the rule **3 (seed 18)**; seeds 1-64
   today and under the rule **7 (seed 51, unchanged)**, against the limit 16. **No seed in 1-64 exhausts its
   attempts**, so no fallback threshold is needed. Each moved seed lands on the next attempt that gives a map at all,
   and that map's lake is 3 steps from the mouth.
3. **The no-forecourt fallback.** Every cave placed on seeds 1-64 (every attempt that reached the Frost slot) found
   its mouth on the first pass, with the forecourt (`cave.rs:59`): the fallback never ran. So the far-lake cases
   (17, 18, 34) are not fallback cases, and a Landmarks-phase refusal of the fallback would catch none of them; the
   end-of-attempt check is the rule. (Their mouths open on the y axis, but so do those of 23, 28, 41, 46, 49 and 50,
   whose lakes are at the mouth: no Landmarks-phase predictor found.)
4. **Map hashes** (this packet's own golden values, generated by running today's generator attempt by attempt; the
   oracle pins them): seeds 1-32 other than 17 and 18 keep (attempt, hash); 17 lands on attempt 1, `78c08b44` (today
   attempt 0, `ba901b81`); 18 on attempt 3, `2d258d08` (today attempt 0, `66b30ea9`); 34 on attempt 1, `7826ac63`
   (today attempt 0, `e87ef160`). Those later maps are what today's generator already makes at those attempts.
5. **Time.** 550-1100 ms per certified map on seeds 1-16, attempt 0 (one process); under the rule seed 17 costs
   1.75 s and 18 2.2 s (one and three extra attempts). The probe ran in two parallel halves, so its 0.9-3.6 s figures on
   seeds 27-64 include contention. The rule itself is one flood fill and one BFS over the 160x160 grid per finished map.
6. **With the rule applied locally** (throwaway patch in `intact`): the new oracle and its ignored 33-64 report pass;
   `mapgen_signature_core.rs` (8 cases), `mapgen_signature_fire.rs` (11), `mapgen_signature_fire_bands.rs` (5) and
   `mapgen_signature_frost.rs` (7) all pass.

## Other oracles whose seeds move
- `mapgen_signature_fire.rs`: seeds 1-16 (and `note2_...`, seeds 6-10, attempts 0-3): no seed changes attempt.
- `mapgen_signature_fire_bands.rs`, seeds 1-32: **17 and 18** change map, so its pooled statistics move
  (`near_band_craters_are_larger_than_far_band_ones`, `no_crater_in_the_core_and_the_crater_count_holds`,
  `streams_are_two_tiles_wide_on_the_maps`); measured green under the rule. Re-run and report the near/far means
  (ADR 0028 quotes 136 against 90). `streams_are_two_tiles_wide_at_the_landmarks_phase` (seeds 1-100, Landmarks phase
  only) cannot see an end-of-attempt check.
- `mapgen_signature_frost.rs`: seeds 1-16 unchanged; its ignored `report_attempts_seeds_1_to_32` will print 17 at
  attempt 1 and 18 at 3. `mapgen_signature_core.rs`: seeds 1-16, unchanged. `rh-server` `map_pool/tests.rs`: seeds
  1-2, unchanged.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/mapgen_signature_frost_lake.rs` (new target; seeds 1-32 option on, generated once per binary,
  attempt by attempt; the definitions are at the top of the file):
  - fail on an assertion today: `the_largest_lake_is_at_the_mouth_on_every_seed` (`largest Frost ice body farther
    than 10 floor steps from the cave's mouth: ["seed 17 (attempt 0): 231 ice tiles Some(98) floor steps from the
    mouth", "seed 18 (attempt 0): 350 ice tiles Some(102) floor steps from the mouth"]`);
    `seeds_17_and_18_land_on_the_next_attempt_with_the_lake_at_the_mouth` (`seed 17: (attempt, map hash)`, left
    `(0, "ba901b81")`, right `(1, "78c08b44")`).
  - pass today and must keep passing: `seeds_with_the_lake_at_the_mouth_keep_their_maps` (30 seeds' attempt and map
    hash), `option_off_maps_are_todays` (G8, seeds 1-8, map hash and JSON digest),
    `every_seed_still_places_all_four_landmarks`, `the_worst_attempt_stays_within_the_measured_margin` (at most
    3 + 2 = 5 over seeds 1-32).
  - `report_seeds_33_to_64` (`#[ignore]`, run with `--ignored --nocapture`): every seed 33-64 certifies and meets the
    rule; fails today on seed 34.
- This brief.
- No stub: the rule needs no new signature (the implementer edits `intact`'s body and may add private helpers).

## 10. Risk and suggested model tier
Opus. A discard changes which attempt a seed lands on, so the Fire oracles' statistics (volcano count at the
Landmarks phase, crater-count floor, near/far ratio) are re-run and reported.

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --test mapgen_signature_frost_lake` (and
  `-- --ignored --nocapture report_seeds_33_to_64`), `--test mapgen_signature_frost`, `--test mapgen_signature_fire`,
  `--test mapgen_signature_fire_bands`, `--test mapgen_signature_core`, `--test content`, `--lib mapgen::`;
  `scripts/gate.sh --quick --oracle packet/P-MAPGEN-SIG-FROST-2`.

## What the oracle does not prove
- The "no unowned ice: keep the map" branch: no seed in 1-64 lacks a lake, so only the code and review cover it.
- The size-tie order of the largest body: no measured seed has two largest bodies of equal size.
- Anything beyond seed 64, or that a seed can never exhaust its 16 attempts under the rule.
- That the lake is in front of the mouth in a shape sense (only the walked distance to its nearest tile).

## 11. Known traps
- "Floor steps" are walked steps over floor, as FROST-1's oracle measures them, not straight-line distance. The walk
  crosses any floor (ice, other zones, owned tiles), not only Frost or unowned floor, and starts on the mouth tiles.
- The cave's own interior ice is owned and never counts as the lake. Ownership is the finished map's `feature_grid`
  (renumbered by records), so find the cave by kind, not by the id it had in the Landmarks phase.
- The largest body, not the nearest: on seeds 17 and 18 smaller ice may lie nearer the mouth while the mere is far.
- `intact` stays a pure predicate of the finished map: it draws nothing and changes nothing (G6, G8). With the option
  off `placed_any` is false and `intact` is not called; keep it so.
- Do not touch the styler to "fix" seeds 17 and 18: every other seed's map is pinned and must not move.
- A new `const` in `rh-sim/src` fails `tests/content.rs` (unregistered); use `Definition`.
- `Refusal::SignatureDiscarded`'s doc comment (`pipeline/mod.rs:82-83`) lists the discard reasons and is outside the
  write scope: name the new reason in `intact`'s doc and the ADR, and propose the one-line doc edit in the hand-off.

## Notes from previous attempts
