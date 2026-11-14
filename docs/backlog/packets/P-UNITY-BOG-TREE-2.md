# P-UNITY-BOG-TREE-2: the bog tree reads as a tree (a visible trunk under a lifted, sunlit crown)

- **Serves:** owner decision 4 (2026-11-10: "a giant bog tree near the outer edge" of Plague); owner preference
  2026-11-13 (chat): "Bog can even be a light and more cheery bog, thinking a sunny bog in Florida or New Orleans area"
- **Implementer tier:** implementer-sonnet (Unity presentation)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework (the five landmark arts, the seams packet and the look tools merged)
- **D-rules touched:** D1 n/a (presentation; DEV-020) · no wire change · no game rule in Unity

## 1. ID and outcome
Seen in the running Web client and the corrected renders (2026-11-13): the bog tree's crown is a mid-dark green mass
lying on the ground in the ground's own hue, and it covers 92.7% of the trunk's top third, so the landmark reads as
mossy boulders. Two changes, the first structural and reusable, the second art:

1. **A landmark's fade set may be wider than its cover.** Today one set (`Landmark.SetCover`, `Landmark.cs:71`) is
   both "the tiles under the roof" and "the tiles on which an actor fades the roof" (`Fades`, `:79`). A crown lifted
   off the ground overlaps, on screen, tiles north of its cover, and an actor standing there would be hidden without
   the crown fading. When this lands an art may hand over a second set, the fade set (`Landmark.SetFadeTiles` or the
   name the oracle author picks); `Fades` reads it when present and the cover otherwise, so the cave, church, hall
   and volcano are unchanged. `RoofCovers` keeps meaning the cover.
2. **The bog tree is a bald cypress.** A buttressed grey-brown trunk standing clearly taller than the wall blocks,
   visible from the south below the crown for at least 40% of its height; a feathery light-green crown lifted above
   the trunk (drawn higher on screen, not on the ground), with gaps the sky-lit ground shows through and grey-green
   Spanish moss hanging at its rim; the stumps are cypress knees. The crown's fade set is every tile it overlaps on
   screen. Brightness and hue separate the parts: against Plague grass (L 0.183, hue 92 in the Web client) the trunk
   differs by hue (grey-brown, not green) and the crown's lit masses are at least 2.5:1 brighter.

## 2. Dependencies
P-UNITY-LANDMARK-4, P-UNITY-LANDMARK-SEAMS-1, P-UNITY-LANDMARK-ROOF-RETURN-1, P-UNITY-LOOK-TOOLS-1 merged.

## 3. Relevant legacy paths
none (DEV-020: the landmarks are new)

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/View/Regions/Landmarks/Landmark.cs` (the fade set only)
- `Landmarks/BogTreeLandmark.cs`
- `docs/unity/DIALS.md` (rows for the tree's looks-only numbers) and `Assets/Editor/Look/scenes.txt` if a scene is added
- not `LandmarkView.cs`, not `ArenaView.cs`, not the other arts, not shaders, not any existing test

## 7. Behaviour to preserve
- What the structure tests pin (`BogTreeLandmarkEditModeTests`): the trunk group and stumps come from delivered
  tiles, the object names (`TrunkName`, `StumpName`), disposal leaves nothing behind, the roof rule (local player
  20%, another visible actor 50%, nobody opaque).
- No art outside the anchor's footprint padding the framework allows; nothing per frame.
- The crown hides only actors on its fade set, and fades for them (C-OBS is not involved: only drawn actors count).

## 8. Acceptance checks
- EditMode (red today): with a fade set handed over, an actor on a fade tile outside the cover fades the roof, and
  `RoofCovers` is still the cover; without one, behaviour is today's (guard, on the cave).
- EditMode (red today): on the approved bog tree drawing the crown sprite's bottom edge is above the trunk sprite's
  vertical midpoint by the margin the oracle author states, the crown texture has transparent gaps (a stated share
  of its bounding box), and every tile the crown's screen rectangle overlaps is in the fade set.
- Engine-free or EditMode colour check on the painted textures: the trunk's mean hue is outside the green band and
  the crown's lit colour is at least 2.5:1 against the measured grass colour.
- The look check (`docs/unity/LOOK_CHECK.md`): `bog-wide` and `bog-close` before and after, attached to the hand-off.
  The owner sees it only from a Web round (`docs/unity/WEB_ROUND.md`).
- `scripts/gate.sh --quick --oracle packet/P-UNITY-BOG-TREE-2` passes.

## 9. Validation commands
- `bash client-unity/UnityProject/Tools/editmode.sh`
- `client-unity/UnityProject/Tools/look-capture.sh bog-wide bog-close --out <dir>`

## 10. Risk and suggested model tier
Sonnet. Numbers are a floor: the renders decide whether it reads as a tree.

## 11. Known traps
- The editor render of Plague is darker than the Web client (grass 40,75,37 against 104,132,77): compare with a Web
  screenshot before judging brightness.
- Lifting the crown without widening the fade set hides actors north of the tree: the first change exists for this.
- Sprite order: the crown sorts above actors on its fade set and below the HUD's world marks, as the roofs do.

## Notes from previous attempts
