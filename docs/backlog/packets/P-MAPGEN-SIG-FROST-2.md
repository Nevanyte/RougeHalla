# P-MAPGEN-SIG-FROST-2: a Frost map whose main lake is not at the cave's mouth is discarded

- **Serves:** owner decision 4 (2026-11-10: "Frost frozen lake with an enterable frozen cave at the back with the elite
  camp inside", mouth facing the lake); core rule G5 (failing maps are discarded, not patched); reviewer-opus note 1 on
  P-MAPGEN-SIG-FROST-1 (2026-11-12, REAL)
- **Implementer tier:** implementer-opus (rh-sim mapgen: the end-of-attempt signature check)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework after P-MAPGEN-SIG-FROST-1 lands
- **D-rules touched:** D1: option off byte-identical (G8) · D2 n/a · no sim tick, wire or content-hash change

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
- `crates/rh-sim/src/mapgen/landmarks/signature/{mod.rs,cave.rs}`, `crates/rh-sim/src/mapgen/style_rime/**` only if the
  measure needs a helper already there; `docs/adr/0028-signature-landmarks.md`

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

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-MAPGEN-SIG-FROST-2`

## 10. Risk and suggested model tier
Opus. A discard changes which attempt a seed lands on, so the Fire oracles' statistics (volcano count at the
Landmarks phase, crater-count floor, near/far ratio) are re-run and reported.

## 11. Known traps
- "Floor steps" are walked steps over floor, as FROST-1's oracle measures them, not straight-line distance.
- The cave's own interior ice is owned and never counts as the lake.

## Notes from previous attempts
