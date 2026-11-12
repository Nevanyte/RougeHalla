# P-UNITY-NAME-GROUP-2: a pack's one name is readable and sits on the pack; in-world camp labels read on any ground

- **Serves:** owner direction 2026-11-12 (less clutter on mobs while keeping the information); screenshot round 4
  (2026-11-12, `1aff1d31`), defects 1, 2, 3, 5 and 9
- **Implementer tier:** implementer-sonnet (Unity presentation; pure rule in `RoguehallaNet`)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (presentation; DEV-024 amended in the hand-off) · no wire change

## 1. ID and outcome
P-UNITY-NAME-GROUP-1 merged same-name mobs into one name per pack (`NameMerge.DecidePacks`,
`SpriteActorPresenter.MergeMobNames`, `Always = engaged || locked || hovered`). In the running client:
1. the pack's one name is drawn at half alpha with no outline over whichever member won, often to the side of the
   pack: on pale ground (Holy paving, Frost snow) it is almost invisible (round 4 shots 01, 06, 16, 18);
2. as soon as the pack is engaged every member shows its own name again and four names overlap each other and the
   camp badge (shots 03, 09);
3. a hovered mob's own name appears far from the mob or not at all (shots 07, 19);
4. "RESPAWN 167s" and "YOUR WARD 107s" are white and cyan text with no backing: unreadable on snow, and the ward
   label overlaps the player's name (shots 12, 14);
5. two fighters standing together have their names drawn on top of each other (shots 03, 20).

When this lands: a pack shows exactly one name, always: centred over the pack (above its highest member's bar) when
no member is singled out, and over the hovered or locked member when one is (hover wins over lock). Being engaged
no longer splits a pack. The name is drawn with the outlined label style the fighter names use, at an alpha that
passes the contrast check on every zone's floor. In-world camp and ward labels get the same outline or a dark plate
and never overlap a fighter's name (they shift up one line). Fighter names that would overlap are stacked
vertically, nearest fighter lowest, never merged.

## 2. Dependencies
none (P-UNITY-NAME-GROUP-1 merged)

## 3. Diagnosis (oracle author, from the code; paths under `client-unity/UnityProject/Assets/Scripts/`)
- (a) Where the pack's name sits. `Presentation/SpriteActorPresenter.cs:172-195` (`MergeMobNames`) only HIDES members: `DecidePacks`
  keeps the lowest id and every other member's name object is deactivated (`HideName`, `OverheadIndicators.cs:127`). The survivor's name is
  never moved: `OverheadIndicators.cs:193` sets `_name.transform.localPosition` from the survivor's own layout, so the name is over the
  lowest-id mob, which can be the side or bottom of the pack. No pack anchor exists.
- (b) Alpha and outline. `OverheadIndicators.cs:189` draws an idle, full-health, non-engaged non-elite mob's name at alpha .5 (legacy
  MobView IDLE_LABEL_ALPHA, quoted in the comment at :188). The outline is NOT missing: the name uses the same dark-outlined shared
  material fighter names use (`OutlinedMaterial`, `OverheadIndicators.cs:~100`, `Text()` ~:117), at outline width .1. The legibility defect
  is the .5 alpha on a `TextSecondary` face over pale ground. The brief's "no outline" is wrong; the measured fix is alpha.
- (c) Hovered mob. `SpriteActorPresenter.cs:186` sets `Always = f.M.Engaged || f.Locked || f.Hovered`, so a hovered mob shows its own name
  in addition to the pack's. That name is at its own `BarY` stack position (above its own bar, `OverheadStack.cs` name y 45.2 px), which in a
  column of mobs 70 px apart is over the neighbour above (shot 19: "Zealot" at the head of the mob above the hovered one), still at alpha .5
  (the alpha rule does not look at hover), so it reads as "far above, faint". "Not at all" happens when a pack's own name is the faint one
  and the hovered one is hidden by nothing: the same faint .5. There is no hover inspector for mobs (shot 19 file name): out of scope.
- (d) "RESPAWN Ns" and "YOUR WARD Ns". `Presentation/CampRespawnLabels.cs` (NOT under `UI/`; no conflict with P-UNITY-HUD-VISUAL-FIX-3):
  respawn label `Get`/`NewLabel` :233-:237, placed at `WorldY + OffsetUnits(32)` (:154), face `#e5edf7`, outlined shared material, font 3.4;
  ward label `TextAt`/`DrawBeacons` :210-:226, placed at `WorldY + BeaconTextOffsetUnits(-48)` (:214), face `TextRgb` (cyan), bottom-aligned.
  Both are plain outlined text, no backing. The ward label sits at the player's name line when the player stands at the camp (shot 12/14).
  `ArenaView.cs:574` calls `_campLabels.Update(_visionSession, _markVisible)`; `:138` constructs it.
- (e) Fighter names that overlap. Nothing handles it: each fighter's name is placed from its own layout at `OverheadIndicators.cs:193`;
  `MergeMobNames` only deals with same-named mobs. Two fighters 20 px apart draw their names on the same spot (shots 03, 20).

## 5. Exclusive write scope (corrected to the real files)
- `client-unity/RoguehallaNet/Net/Ui/NameMerge.cs` (`PackNames` body), `client-unity/RoguehallaNet/Net/Ui/NameStack.cs` (`Separate` body), and the
  synced copy `UnityProject/Assets/RoguehallaNet/Net/Ui/` (run `bash client-unity/sync-net.sh`; the `NameStack.cs.meta` is already tracked)
- `client-unity/UnityProject/Assets/Scripts/Presentation/SpriteActorPresenter.cs` (`MergeMobNames`: call `PackNames`, set `Single` from hover/lock,
  move the carrier's name object to the anchor, then `NameStack.Separate` over the shown names), `OverheadIndicators.cs` (alpha, name placement hook),
  `OverheadExtras.cs` only if the elite star must follow a moved name
- `client-unity/UnityProject/Assets/Scripts/Presentation/CampRespawnLabels.cs`: plate under both labels and avoidance (`NameRectSource`)
- `docs/DEVIATIONS.md` DEV-024 (one sentence: engaged packs keep one name)
- NOT in scope, flag to the coordinator: one line in `View/ArenaView.cs` (`:138`, after constructing, set
  `_campLabels.NameRectSource = _actors.<a method listing the shown names' world rects>`); `ArenaView.cs` is owned by P-UNITY-HUD-VISUAL-FIX-3, so
  the coordinator adds that line when the two merge. Until it is added the avoidance cannot run in the game, only in the oracle.

## 6. Contracts and references
- Presentation only, no wire change. `DecidePacks` and its P-UNITY-NAME-GROUP-1 unit tests STAY (the presenter stops calling it; the implementer may
  leave it or remove it with its tests only if the coordinator agrees).

## 7. Behaviour to preserve
- One buff badge per camp, elite marker, no role badge or per-type emblem (P-UNITY-DECLUTTER-1's oracle stays green).
- Elite mobs and quest givers keep their own names; mobs of different names never merge; the chain distance
  (`PackDistancePx = 128`) and the rule that a member leaving at an end of the chain splits nothing.
- A fighter's own name, bar and build row are untouched except for the vertical stacking.

## 8. Acceptance checks
- Unit (RoguehallaNet.Tests): `DecidePacks` returns one shown name per pack with engaged members; with a hovered
  member the shown one is that member; hovered and locked both present: hovered; the anchor of an unsingled pack is
  the pack's horizontal centre and its highest member's top.
- Unit: the stacking rule: N labels with overlapping rectangles come out non-overlapping, order by distance, stable.
- EditMode: the pack name label uses the outlined style and alpha at least 0.85; contrast of name colour and outline
  against each of the five zone floor colours at least 3:1 (reuse the contrast helper from
  `RegionThemeEditModeTests`); the respawn and ward labels have an outline or plate and do not intersect the local
  fighter's name rectangle in a scene where they share a position.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-NAME-GROUP-2` passes.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/NamePackGroup2Tests.cs` (25 unit cases: 21 fail on the stub, 4 pass as guards: no-overlap and touching labels do not move, a label beside a stack does not move, a lone mob keeps its anchor)
- `client-unity/UnityProject/Assets/Tests/Editor/NamePackGroup2EditModeTests.cs` and its `.meta` (16 EditMode cases incl. test-case rows; 13 fail, 3 pass as guards: elite keeps its name, hover leaving, labels stay put when nothing is near)

## API (stubbed in commit `stub:`)
- `NameMergeItem.Single` (byte: 1 locked, 2 hovered) and `NameMerge.PackNames(items, count, packDistance, shown, scratch, anchorX, anchorY)`: exactly one
  shown name per pack; carrier = hovered, else locked, else lowest id; singled carrier anchors at its own anchor, an unsingled pack at (centre of the
  extent `(minX+maxX)/2`, largest Y); `Always` is ignored. Full rules in its doc comment.
- `NameStack.Separate(NameStackItem[] items, count, gap, float[] lift)`: labels placed by ascending (Dist, Id); first never moves; an overlapping label
  takes the lowest y at or above its own that clears every placed label; touching is not overlapping. Full rules in its doc comment.
- `CampRespawnLabels.Draw(List<CampWorldLabel>, List<CampWardRow>)` (test seam; `Update` shares the drawing) and `CampRespawnLabels.NameRectSource`
  (`Action<List<Rect>>`, world rects of drawn fighter names). The oracle contract for the plate: an active `SpriteRenderer` CHILD of the label object,
  covering all of the text, opacity at least .6, contrast of label face against the plate colour at least 4.5.

## Existing P-UNITY-NAME-GROUP-1 cases this packet replaces (they pass today and the new rule contradicts them: the implementer deletes them)
- `client-unity/UnityProject/Assets/Tests/Editor/NamePackEditModeTests.cs`: `AnEngagedMobShowsItsOwnNameEvenWithTheHighestId` (engaged no longer shows its own name)
  and `ALockedMobShowsItsOwnNameEvenWithTheHighestId` (a locked member now carries the name ALONE: its `ShownCount(1,2,3)==1` clause contradicts).
- `client-unity/UnityProject/Assets/Tests/Editor/NamePackHoverEditModeTests.cs`: `AHoveredPackMemberShowsItsNameAndLosesItWhenTheHoverLeaves` (it asserts the lowest id keeps
  its name while another member is hovered; now the hovered one carries the pack's only name). Their replacements are in `NamePackGroup2EditModeTests`.
- Unchanged and must stay green: all other `NamePackEditModeTests` (the lowest id's object carries an unsingled pack's name, so `NameShown(1)` still holds),
  all of `NamePackTests.cs` (it tests `DecidePacks`, which is left alone), `NameMergeTests.cs`, `HudVisualFix2EditModeTests.cs`.

## What the oracle decides that the brief left open (flag)
- "Contrast of name colour and outline against each zone's floor at least 3:1" cannot hold literally: a light face and a dark outline cannot both contrast
  3:1 with both Fire's dark floor and Frost's pale floor. Pinned: face (composited at its alpha over the floor) against its own outline at least 3:1, and face OR
  outline against the floor at least 3:1, on Fire, Sentenced, Plague, Frost, Holy (`RegionThemes.Get(zone).BaseSrgb`).
- Camp labels already have the shared outline, so "outline or plate" would pass today; the oracle requires the plate (backing independent of ground).
- Only packs of two or more are pinned at alpha >= .85; a lone idle mob's name stays a legacy .5 (not tested).
- The centre is the middle of the extent, not the mean. Name stacking order is by distance to the local fighter (spectators: all Dist equal, order by id).
- The avoidance test feeds the fighter's name rect through `NameRectSource`; it does not prove the ArenaView wiring.
- World TMP labels do not take `MatchHud.ApplyTextScale` (HUD canvases only, `MatchHud.cs:121-131`); sizes in the tests are measured from the drawn mesh.

## 10. Risk and suggested model tier
Sonnet. The earlier oracle pinned `Always` for engaged members: those cases are replaced, and the oracle author says
which (file and test name) in the brief.

## 11. Known traps
- Run-time text scale re-applies sizes after build (`MatchHud.ApplyTextScale`): measure after it, as
  P-UNITY-HUD-VISUAL-FIX-2 learned.
- An EditMode run modifies `Assets/Resources/Showcase/NunitoRegular.asset`: `git checkout --` it, never commit it.
- Hand-off includes `git diff --stat packet/P-UNITY-NAME-GROUP-2`.

## Notes from previous attempts
