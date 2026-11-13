# P-DRESS-MARSH-1: Plague marsh rings as decoration ground variants round bog terrain

- **Serves:** owner decision 2026-11-12 (MIGRATION "Marsh slow 0% water 0% mud 30% bog": water and mud are looks only,
  not sim terrain; supersedes the cancelled `P-TERRAIN-MARSH-1`); ADR 0028 (Plague's bog tree and marsh)
- **Implementer tier:** implementer-sonnet (single crate: `rh-mapdress`)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework, after `P-DRESS-ANCHOR-1` is merged (it adds the rule-file `landmark`
  block and the per-band ground plane this packet must coexist with)
- **D-rules touched:** D1 n/a (DEV-021) · no sim, wire or content-hash change

## 1. ID and outcome
Round every bog tile of the Plague zone (`GameMapData.terrain == 5`, `TileClass::Bog`, `lib.rs:88-92`), `rh_mapdress`
lays two ground looks as ground variants (the `Dressing.ground_variants` plane): **water** on floor tiles within
`waterReach` tiles of a bog tile (next to each pool), then **mud** on floor tiles beyond that and within `mudReach`.
Nothing moves or slows: no terrain code, no wire change. Grass stays the plain ground outside `mudReach`. The rule is
"ring around terrain" instead of "ring around a feature": a new optional rule list in the rule file, for any zone,
anchored on a terrain class.

## 2. Dependencies
- `P-DRESS-ANCHOR-1` merged (schema and `Grid`/ground code it changes).
- Open question for the owner before the oracle is written, flag in the hand-off if unanswered: **precedence on the one
  ground plane** where a Plague tile is both in a landmark band (the bog tree's core/near/mid variants) and in a marsh
  ring. This brief assumes marsh wins within `mudReach` of bog (a pool reads as a pool even beside the tree) and the band
  variant shows elsewhere; the oracle must pin whichever the owner states.

## 3. Relevant paths
- `crates/rh-mapdress/src/lib.rs`: `class_of` (:84-96, terrain 5 = `Bog`), `rings` ground loop (:385-393).
- `crates/rh-sim/src/mapgen/landmarks/signature/mod.rs:121` (`bog: 5`, `bog_d2`: the bog tree's two bands of bog floor,
  about 90 tiles) and `crates/rh-sim/src/terrain.rs:56-72` (codes). Plague's styler also lays bog pools; on signature
  seeds 1-8 the whole map holds 290-460 bog tiles (measured).

## 4. New paths
- none expected (a `terrainRings` list in `rules/zones.json`, an engine stage, tests)

## 5. Exclusive write scope
- `crates/rh-mapdress/src/**`, `crates/rh-mapdress/rules/zones.json`, non-oracle tests under `crates/rh-mapdress/tests/**`

## 6. Contracts and references
- DEV-021; the ground-variant byte meanings are the art packets' (names only here).

## 7. Behaviour to preserve
- Every `P-DRESS-ANCHOR-1` oracle test and every existing test unchanged; maps with no bog tile are dressed exactly as
  before (pin golden hashes as `P-DRESS-ANCHOR-1` does); keep-clear and the tall corridor unaffected (ground only).

## 8. Acceptance checks (the oracle author writes the tests; proposed)
- For every floor tile of the zone: Chebyshev (or Euclidean, choose once and say) distance to the nearest bog tile is
  computed independently in the test; variant `water` iff within `waterReach`, `mud` iff beyond that and within
  `mudReach`, else the zone's other rule (band ring or 0). Bog tiles themselves keep their variant 0 or the band's.
- Water is adjacent to bog on every seed that has bog; mud never touches a bog tile without a water tile between
  (reach order). Wall, low and other-zone tiles stay 0. Byte-identical reruns.
- Option off (maps from `common::cases()`): bog is present there too (the Plague styler), so the marsh rule changes
  those maps by design: the oracle author states whether the option-off golden hashes of `P-DRESS-ANCHOR-1` are
  regenerated (owner approval) or the rule is gated on `map.anchors` being non-empty (preferred: keeps them frozen).

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-DRESS-MARSH-1`

## 9. Validation commands
- as `P-DRESS-ANCHOR-1` section 9

## 10. Risk and suggested model tier
Sonnet. The distance field is a small multi-source flood over the plane (integer, ordered); the risk is the ground
precedence above and the variant numbering shared with the band rings (pick ids that do not collide: band rings use the
rule file's `groundVariant`; reserve two more per zone).

## 11. Known traps
- Do not add a terrain code or touch `rh-sim`; the sim treats these tiles as plain floor.
- Bog on non-Plague tiles (the bog tree sits in Plague; the Plague styler's pools are Plague): restrict by the rule's
  zone as every other rule does.

## Notes from previous attempts
