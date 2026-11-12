# P-UNITY-NAME-GROUP-1: a pack of the same mob shows one name

- **Serves:** owner direction 2026-11-12 (reduce visual clutter on mobs while keeping markers for elites); third
  screenshot round (a pack of four Magma Brutes still shows a name on each)
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1: departs from legacy on purpose (DEV-024) · D2 n/a · D5/D6/D9 none

## Evidence
`/private/tmp/claude-501/-Users-nevinmckinnon-Documents-Projects-RogueHalla/a63755ad-8542-4ca6-a1cf-6f60fb5d1eb5/scratchpad/shots3/plague-1920x1080-dpr1-match.png`
(four Magma Brutes, four names, two of them side by side reading "Magma Brute Magma Brute") and
`fire-1920x1080-dpr1-match.png` (names over hp bars).

## 1. ID and outcome
P-UNITY-HUD-VISUAL-FIX-2 merges two same-text mob names only when their anchors are closer than the text is wide, so
names standing side by side all remain. The owner asked for less clutter on mobs. When this lands, non-elite mobs
with the same name that stand within a pack distance of each other (chained: A near B, B near C makes one pack) show
ONE name for the pack, drawn above the pack's topmost member (or centred over the pack), stable from frame to frame;
an elite always shows its own name; a mob that walks away from its pack gets its name back; a mob the player is
fighting or has locked keeps its name visible (so the target is always named). Names no longer overlap a mob's own
hp bar.

## 2. Dependencies
none (P-UNITY-HUD-VISUAL-FIX-2 is merged)

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/NameMerge.cs` (extend: a pack rule beside the overlap rule), its tests' neighbours,
  synced copy
- `client-unity/UnityProject/Assets/Scripts/Presentation/SpriteActorPresenter.cs` (`MergeMobNames`),
  `OverheadIndicators.cs` (name anchor against the bar)
- EditMode tests

## 6. Contracts and references
- Presentation only. Player names are never grouped. Only mobs the client was delivered are considered.
- The existing `NameMergeTests` (oracle of P-UNITY-HUD-VISUAL-FIX-2) keep passing: the overlap rule stays as the
  inner case of the pack rule.

## 8. Acceptance checks
- Unit tests on the helper: four same-name mobs within the pack distance give one shown name; the survivor is stable
  (lowest id) and is the same when the input order changes; a chain A-B-C with A and C farther apart than the pack
  distance is still one pack; two packs of the same name farther apart than the pack distance show two names; an
  elite in the pack shows its own name and does not suppress the pack's; a mob marked as engaged or locked always
  shows; different names never merge.
- EditMode: four adjacent same-type mobs show one active name object; the name's rect does not intersect the mob's
  hp bar.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-NAME-GROUP-1` passes; a fourth screenshot round (the coordinator).

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-NAME-GROUP-1`

## 10. Risk and suggested model tier
Sonnet. Small. The pack distance is a tuning value: start at about four tiles (128 world units) and say so.

## 11. Known traps
- Grouping must not allocate per frame (reuse buffers; a union-find over at most the visible mobs).
- A pack splitting or merging as mobs move must not make the name jump every frame: keep the previous survivor while
  it is still in the pack.

## Notes from previous attempts
