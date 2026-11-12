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
- `client-unity/RoguehallaNet.Tests/NamePackTests.cs` (23 unit cases; 21 fail on the stub, 2 pass as guards: the constant and the name/bar layout)
- `client-unity/UnityProject/Assets/Tests/Editor/NamePackEditModeTests.cs` and its `.meta` (10 EditMode cases; 7 fail, 3 pass as guards)
- Existing and unchanged: `NameMergeTests.cs`, `HudVisualFix2EditModeTests.cs` (they keep passing).

## API (stubbed in commit `stub:`; the implementer fills it)
`NameMerge.DecidePacks(NameMergeItem[] items, int count, float packDistance, bool[] shown, int[] scratch)` returns the shown count.
`NameMergeItem.Always` (new): engaged or locked mob. `Decide` and its tests are untouched. `scratch` (at least `count` ints, caller
owned, contents free) is the union-find parent array; no allocation in the helper.
- Only non-elite, non-`Always` items with a non-empty `Text` pack. Every other item is shown and neither joins, links nor suppresses a pack
  (so an elite, or an engaged mob, in the middle of a line does not chain its neighbours).
- Same `Text` and Euclidean distance strictly less than `packDistance` links two items; links chain. Width is ignored.
- One item per pack is shown: the lowest `Id` (independent of input order). This is also the answer to the "no jumping" trap: a stable
  rule on ids, no previous-survivor memory needed.
- `NameMerge.PackDistancePx = 128f` (legacy px, 4 tiles of 32; a TUNING value, pinned by a test). Names are anchored in Unity world units
  (1 unit = 1 tile, `ArenaView.Scale = 1/32`), so the presenter passes `NameMerge.PackDistancePx * ArenaView.Scale` (= 4). The world
  y is squashed by `ArenaView.GroundSquash` (.78), so vertical pack reach on screen is slightly shorter; accepted.
- Presenter: `MergeMobNames` fills `Always = f.M.Engaged || f.Locked` (`LockDisplay` is the local lock; `PresentIndicators(..., locked)` already
  reaches `IndFacts.Locked`), keeps `Elite`, calls `DecidePacks` instead of `Decide`, with reused `int[]` scratch sized like `_mergeShown`.
  `NameMergeItem.Width` stays filled (harmless).

## Names over hp bars: finding
Not a layout defect. `OverheadStack.Build` puts the name bottom at y 45.2 px and the bar top at 35.2 px (bar y 31.2 + h 4): a 10 px gap above
the bar for every actor kind, and `OverheadIndicators.Update` and the presenter share one base (`BarY - U(33.2)`), so it holds for every
head height. Measured in EditMode for one hurt Magma Brute (world units): name y -13.05..-12.77, bar y -13.50..-13.38, a 0.32 gap, no overlap.
In `fire-1920x1080-dpr1-match.png` the "Penitent" names sit over the mob ABOVE them: each is the name of the mob below (32 px above its own
bar) lying on the neighbour's body, a column of mobs 70 px apart. It disappears when the pack shows one name above its topmost mob,
which is why this packet needs no change to `OverheadIndicators` anchors. Pinned (both pass today, guards): `NamePackTests.TheNameIsNeverBelowItsOwnHpBarForAnyActorKind`
and `NamePackEditModeTests.AHurtMobsNameSitsAboveItsOwnBarAndNeverOverlapsIt`. Drawing the pack's one name above the TOPMOST member
(rather than above the lowest-id member, which may be the bottom of the column) is a presentation choice left to the implementer; no
test pins which member carries it, only that exactly one name is active and that it is the lowest id's (tests read `NameShown(id)`),
so the lowest-id mob's own name object is the one kept. Do not move it.

## Exact files the implementer changes
- `client-unity/RoguehallaNet/Net/Ui/NameMerge.cs` (body of `DecidePacks`) and its synced copy via `bash client-unity/sync-net.sh`
- `client-unity/UnityProject/Assets/Scripts/Presentation/SpriteActorPresenter.cs` (`MergeMobNames`, scratch buffer)
- Also add a `DEVIATIONS.md` row (DEV-024 is cited above: owner signs).

## 10. Risk and suggested model tier
Sonnet. Small. The pack distance is a tuning value: start at about four tiles (128 world units) and say so.

## 11. Known traps
- Grouping must not allocate per frame (reuse buffers; a union-find over at most the visible mobs).
- A pack splitting or merging as mobs move must not make the name jump every frame: keep the previous survivor while
  it is still in the pack.

## Notes from previous attempts
