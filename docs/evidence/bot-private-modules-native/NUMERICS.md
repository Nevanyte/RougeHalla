# Numeric comparison policy — exact first, no tolerance

**No numeric tolerance was applied, requested or needed.** The frozen replay compares every field exactly from the first
run: binary64 bit equality for all finite numbers (`-0` distinct), tag identity for `NaN`/`+Infinity`/`-Infinity`,
ordered arrays/objects/instances/maps/sets, and `Undefined` vs `null` vs absent as distinct source values.

## What is compared exactly

- All declared source inputs are converted atomically and unrounded: full `TierParams`/`PersonaParams` overrides,
  raw binary64 plan `spawns`/`pick`/`boon`, f64 rank (`floor`, non-finite → 1, then clamp), raw build counts, all
  clocks (`now`/`viewT`/`serverTime`/`event.t`/`expiresAt`/`lifeMs`/read/settle/lastCall boundaries).
- All results/contexts/callbacks/hunter diagnostics are exact: costs/scores (`-Infinity` sentinel included), chosen
  option/target indexes, utility, goal data, status/why strings, intent priority/timing, draw counts, Memory snapshots,
  path stats, hunter stalls/walk cache (including cached `len:null`), ordered callback transcripts (runs of rng draws
  include exact values), and list-identity (`returnedInputList`) where source exposes it.
- Continuous leaves are compared exactly too, with no whitelist: source path distances are the admitted
  `RoomPathService`'s distances and matched bit-for-bit in every `paths.walk` callback; source `Math.hypot` is used
  through the admitted `rh_sim::mapgen::certify::source_hypot` leaf wherever the source calls `Math.hypot`; blink
  landing uses the admitted fixed-distance leaf under the validated (300, 64) profile with real collision/open maps and
  the real gate flag. The admitted strategy `2e-6` path-distance precedent is **not** imported and was never needed.

## Field-aware non-finite policy

Only the two source-sanitized learned-bias surfaces may carry non-finite values (`cfg.learned.entries[i][1]` and
`declaration.env.learned[i][1]`): the source `biasOf` applies `Number.isFinite(b) ? b : 0` at exactly that field. The
native reader keeps the raw values and the shared planning transition applies the same sanitize + `LEARN.weight *
clamp(b, -LEARN.cap, LEARN.cap)`. Every other declared number (clocks, geometry, config numbers, finite event fields) is
rejected before any Memory/module/RNG/path mutation. Explicit tagged `-Infinity` values remain legal where the source
has a `-Infinity` sentinel (e.g. unusable card score); normal finite numbers never become a sentinel.

## NaN representation note

The corpus codec (`rh-method-value/1`) represents `NaN` as a single tagged value and cannot preserve NaN payloads;
the comparator therefore treats NaN-vs-NaN as the codec's representational identity (not a tolerance). Every finite
number, `-0`, `+Infinity` and `-Infinity` remains bit/tag exact. This is recorded for the admission reviewer; it does
not relax any decision-producing value.

## Clocks and ordering

Memory observation times are nondecreasing per cfg; hunter `now` and `serverTime` are independently nondecreasing
(and deliberately distinct: the walk cache/stall watch read `now`, chest expiry reads `serverTime`). The replay never
replaces one with the other and never derives one from tick arithmetic. Source schedule uses the private event `t`
(not the current percept `now`); the shared planner's schedule tables are indexed by `tier.id` while every other consumed
tier value (`reaction.mu`, `softmaxT`, `lapseP`, …) comes from the declared full `TierParams`.
