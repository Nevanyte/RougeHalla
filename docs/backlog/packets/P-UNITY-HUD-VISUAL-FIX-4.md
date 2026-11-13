# P-UNITY-HUD-VISUAL-FIX-4: mob names read on pale ground and stay one per camp pack; terrain chip and Hunt card stop overlapping; small leftovers

- **Serves:** owner direction 2026-11-12 (less clutter on mobs while keeping the information); owner decision 7
  (2026-11-10: the HUD presents the same information as legacy); screenshot round 5 (2026-11-12, `7ba766aa`)
- **Implementer tier:** implementer-sonnet (Unity presentation and UI; pure rules in `RoguehallaNet`)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (presentation; DEV-024 amended in the hand-off) · no wire change

## 1. ID and outcome
Seen in the running Web client at `7ba766aa` (shots under the session scratchpad, `shots5/`):
1. **Mob names are still nearly invisible on pale ground** (shots 23, 24, and 16 on mid-grey paving). A lone idle
   mob keeps the legacy half alpha (P-UNITY-NAME-GROUP-2 pinned full alpha for packs of two or more only), and the
   face colour is pale. When this lands every mob name (lone, pack, idle or engaged) passes the same legibility
   rule as the pack name: alpha at least 0.85 and the face-or-outline contrast rule against every zone's floor.
2. **A pack splits into several names when its members spread** (shots 06, 07, 24: kiting archers more than 128 px
   apart each get a name). A pack should be the camp's mobs of one name, not a distance chain: if the actor row
   carries the mob's camp (or home) index, group by camp and name; if it does not, say so and widen the chain to the
   camp's leash radius from the delivered camp rows. One name per camp pack, anchored on the members that are drawn.
3. **A pack's name is drawn on top of the local fighter's name when the pack surrounds the fighter** (shot 18):
   pack names join the same stacking rule as fighter names (the fighter's own name keeps its place; the pack name
   steps above it).
4. **The terrain chip overlaps the Hunt card** (shot 12): "BURNING" is a full-width bar drawn over the card's title
   line. The chip is a pill sized to its text in its own row under the GAINED plate; the Hunt card (and anything
   else in that column) starts below the chip row when a chip is shown.
5. **The Hunt card is much larger than its content** (shots 11, 12: about 400 x 160 for one line): its height
   follows its text and rows.
6. Leftovers: the defeat card shows a stale "Join rejected: closed" pill (shots 08, 21); the hub lobby card's last
   line sits on or below the card's bottom edge (hub shots at 1920x1080 and 1024x768); world name labels show through
   behind the Tab map's panels (shot 27): hide world name labels while the Tab map is open.

## 2. Dependencies
none (P-UNITY-NAME-GROUP-2 and P-UNITY-HUD-VISUAL-FIX-3 merged)

## 3. Diagnosis (oracle author, from the code; paths under `client-unity/UnityProject/Assets/Scripts/` unless noted)
1. **Mob name legibility.** A lone idle full-health non-elite mob's name alpha is set to `.5` at `Presentation/OverheadIndicators.cs:199` (legacy
   MobView IDLE_LABEL_ALPHA); the face is `theme.TextSecondary` (`:198`), pale on pale ground. Packs of two or more and singled mobs are raised
   to 1 by `NameFullAlpha` (`OverheadIndicators.cs:135`, called from `Presentation/SpriteActorPresenter.cs:217`), so only a LONE mob (a pack the
   client sees as one member: the others beyond the 128 px chain, or out of vision) stays at .5. `NameFullAlpha` multiplies by `_textFade`
   (`:135`, `:154`): the carrier is the lowest id, so a pack whose lowest id stands at the edge of vision draws its one name at that member's
   vision-fade alpha. Shot 23 is read as one of these two (the still cannot tell which; a faded ghost sprite stands above the name). The name
   sits "far above": `NameMerge.PackNames` anchors an unsingled pack at (centre of its extent, highest member's name y), and the name is drawn
   above that member's bar (`SpriteActorPresenter.cs:210-218`, `MoveName` `:218`), so a pack spread north-south puts it over its highest member.
   The oracle pins alpha at least .85 and the contrast rule for lone, engaged and hurt mobs on the five floors.
2. **Pack membership.** The actor row does NOT carry a camp or home index: `WireActor` (`client-unity/RoguehallaNet/Protocol/Messages.cs:723`) has
   Id, X, Y, Facing, Bounty, Faction, HpPct, Status, Weapon, Kind, DisplaceSeq, MobTypeCode, Sig, Effects, Barrier*, Archetype, Flags, Offhand,
   BuildMarks and the mark plate; `Sig` is the mob signature, not the camp. The delivered camps are the map's `MapCamp[]`
   (`Protocol/MapBlob.cs:7`: X, Y, **R = legacy CampDef.r, the CLEARING radius**, Zone) index-aligned with `Session.Collections.Camps` rows
   (`Net/Collections.cs:19`: `MobType`, `Elite`, Alive, State...). The legacy leash is `min(camp.radius, MOB_LEASH_CAP)` where `camp.radius` is
   the TERRITORY radius (`packages/shared/src/map.ts:136`, `mobs.ts:247`), measured from the mob's home spot; the territory radius is not delivered.
   So the pinned fallback, no wire change: a mob belongs to the camp whose normal `MobType` equals its type, whose centre is within
   `R + 768 px` (`NameMerge.CampReachPx`, 24 tiles, legacy `MOB_LEASH_CAP`, `packages/shared/src/constants.ts:541`), nearest centre wins; an
   elite type or no such camp: no camp (the 128 px chain applies among camp-less mobs only). Limits (flag): a mob kited toward another camp of
   the same type changes camp when it crosses the midpoint; the leash bound is an upper bound, not the territory. Idle packs (the common case)
   stand on spots inside `R` and are exact. No wire brief is written: the fallback is good enough for names; a camp index on the actor row
   would remove the heuristic and can be proposed later.
3. **Terrain chip and Hunt card.** `UI/MatchHud.Terrain.cs:16` `TerrainWidth = 294`, and `:58` sizes every chip `TerrainWidth x 18` at
   `(0, n * 18)` of the row, so a chip is a full-width bar; the row is placed at `PlateTop + _vitalsPanel.sizeDelta.y + 4` (`:139`) = 10 + 148 + 4 =
   162 with the live plate. `UI/SentencedHuntPanel.cs:18` fixes the card at `Top = 156` (HUD units, `:36`), which is 2 units INSIDE the plate's
   bottom (158) and 6 above the chip row's top: nothing tells the card about the row. Nothing else lives in that column under the plate (the
   quest button and class panel are bottom-left; `TopLeft` boxes in `MatchHud*.cs` are only the plate and the row).
4. **Card height (item 5).** `SentencedHuntPanel.cs:39` gives the status text a fixed 76 unit box and `:50` puts rival rows at `RowsTop = 102`;
   `:118` sizes the card `102 + 12 + 4` = 118 with no rows however short the text (a one-line "No rival in sight" leaves ~82 units empty).
5. **Defeat card's stale pill.** The pill is the top banner pill `_bannerPill` ("ConnectionBanner", `UI/MatchHud.Legacy.cs:90`). Its visibility is
   `SyncTopCentre` (`MatchHud.Legacy.cs:119`): forced on whenever `_session.State` is Rejected, Failed or Reconnecting; its text is
   `MatchHud.cs:267` `"Join rejected: " + RejectReason`. After a match the server's `Reject` ("closed") leaves the session Rejected with
   `LastResult` set, so the pill stays over the results card. (The launch screen's own status line is `MatchHud.Accounts.cs:247`, not this.)
6. **Hub card overflow.** `UI/HubLobbyActivityView.cs:37` the body is 15 unit text in the card's .02-.98 box; the unavailable state (`Compose`,
   `:152-158`) is nine lines, rendering 208.7 units tall in a box 181 to 194 units tall at every window size (measured by the oracle).
7. **Tab map and world names.** `TacticalMapController.SetOpen` (`UI/TacticalMapController.cs:365`) sets `_mapOpen` and shows the panel;
   `ReleaseTransient` (`:647`) closes it; the actor presenters never learn. Seam added by the stub: `Presentation/WorldLabelVisibility.Hidden`
   (static): the controller sets it from its open state in `SetOpen` and `ReleaseTransient`; the presenters hide every actor name while it is true
   (`SpriteActorPresenter.MergeMobNames` / `OverheadIndicators`).

## 5. Exclusive write scope (corrected to the real files)
World labels (implementer A):
- `client-unity/RoguehallaNet/Net/Ui/NameMerge.cs` (`PackNames` camp rule, `CampOfMob` body) and the synced copy (`bash client-unity/sync-net.sh`)
- `UnityProject/Assets/Scripts/Presentation/SpriteActorPresenter.cs` (`SetCamps` body, camp per mob into `NameMergeItem.Camp`, honour
  `WorldLabelVisibility.Hidden`, add the pack names to the `NameStack.Separate` pass with the local fighter's name fixed in place),
  `Presentation/OverheadIndicators.cs` (alpha, and colour if the contrast rule needs it), `Presentation/WorldLabelVisibility.cs` only if its shape must change
- `client-unity/RoguehallaNet/Net/Ui/NameStack.cs` only if the stacking rule itself must change (the oracle needs none)
- `docs/DEVIATIONS.md` DEV-024 (one sentence: a pack is the camp's mobs of one name)
- NOT in scope, flag to the coordinator: one line in `View/ArenaView.cs` after the presenter is built and whenever the map or camp rows change:
  `_actors.SetCamps(session.Map.Camps, session.Collections.Camps)` (`ArenaView.cs` was owned by P-UNITY-HUD-VISUAL-FIX-3). The oracle reaches
  `SetCamps` directly, so it does not prove the wiring.

HUD layout (implementer B):
- `UnityProject/Assets/Scripts/UI/{MatchHud.Terrain.cs,SentencedHuntPanel.cs,HubLobbyActivityView.cs,TacticalMapController.cs}` and
  `UI/MatchHud.Legacy.cs` (`SyncTopCentre`: no banner pill while `LastResult != null`), `UI/MatchHud.cs` only if the pill text needs it

Size: about 250 changed lines in all; one Sonnet can take both halves. The halves share no file and have separate oracle files, so two may run side
by side (A: `Presentation/**`, `NameMerge.cs`; B: `UI/**`). `WorldLabelVisibility.cs` is stubbed, A reads it and B writes it.

## 7. Behaviour to preserve
- One name per pack; hover or lock moves it onto that member; elites and quest givers keep their own names; mobs of
  different names never merge; fighter names stack at most three lines (P-UNITY-NAME-GROUP-2's oracle stays green
  except the cases this packet names as replaced).
- Terrain chip colours and the home-ground note (P-UNITY-HUD-VISUAL-FIX-3); the Hunt card's legacy wording; the
  GAINED plate; the hub card clear of the tiles at 1280x720, 1920x1080, 1024x768 and 960x720.

## 8. Acceptance checks
- Unit: `PackNames` with members of one camp and one name farther apart than the old chain distance: one name; two
  camps of the same mob name near each other: two names; a member with no camp information falls back to the chain.
- EditMode: a lone idle mob's name alpha at least 0.85 and the contrast rule on the five zone floors; a pack name
  whose rectangle would intersect the local fighter's name is lifted clear of it; with a terrain chip shown the Hunt
  card's top is below the chip's bottom and the chip is no wider than its text plus padding; the Hunt card's height
  is within one row of its content's height; the defeat card shows no join-status pill; the hub card's text
  rectangle is inside the card at the four window sizes; world name labels are inactive while the Tab map is open.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-VISUAL-FIX-4` passes.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/NamePackFix4Tests.cs` (13 unit cases: 10 fail on the stub; 3 pass as guards: the chain for camp-less mobs, the 768 px constant, the no-camp answers)
- `client-unity/UnityProject/Assets/Tests/Editor/NamePackFix4EditModeTests.cs` and its `.meta` (world labels: lone idle alpha, spread camp pack, hovered
  spread pack, two near camps, pack name on the fighter's name, and the presenter's Tab-map case fail on the stub; the rest are guards)
- `client-unity/UnityProject/Assets/Tests/Editor/HudVisualFix4EditModeTests.cs` and its `.meta` (HUD: chip pill, Hunt card below chip, Hunt card height, defeat pill,
  hub card text at four windows, Tab map sets `WorldLabelVisibility`)
- Stubbed in the `stub:` commit: `NameMergeItem.Camp`, `NameMerge.CampReachPx`, `NameMerge.CampOfMob` (returns -1), `SpriteActorPresenter.SetCamps` (no-op),
  `Presentation/WorldLabelVisibility.cs` (+ `.meta`), the synced `NameMerge.cs`.

## API
- `NameMergeItem.Camp` (int, 0 unknown else camp index + 1): `PackNames` packs same-Text items of one Camp however far apart, never with another Camp or
  Camp 0; Camp 0 items chain by distance among themselves (rules in its doc comment).
- `NameMerge.CampOfMob(MapCamp[] camps, IReadOnlyList<CampView> rows, MobTypeId type, double x, double y)`: nearest same-type camp centre within `R + CampReachPx`.
- `SpriteActorPresenter.SetCamps(MapCamp[], IReadOnlyList<CampView>)`, `WorldLabelVisibility.Hidden`.
- HUD behaviour the oracle calls only through `MatchHud.ShowTerrain` and `SentencedHuntPanel.Refresh`: the chip row and the card place each other from inside
  those calls (`MatchHud` has a `_huntPanel` field the test sets). With no chip the card starts below the plate (top at or under the plate's bottom).

## Existing cases this packet replaces
None. P-UNITY-NAME-GROUP-2's `NamePackGroup2Tests` / `NamePackGroup2EditModeTests` and FIX-3's `HudVisualFix3EditModeTests`,
`HubLobbyPanelPlacementEditModeTests`, `HubLobbyPanelNarrowWindowEditModeTests` stay green as they are (their packs have no camp rows; the Hunt
test measures the text box inside the card, which a shorter card must still contain). EditMode baseline on the stub: 776 run, 755 pass, 21 fail (all in the
three new EditMode classes); `dotnet test`: 1678 run, 1668 pass, 10 fail (all in `NamePackFix4Tests`).

## What the oracle decides that the brief left open (flag)
- The contrast rule is NameGroup-2's reading (face against its own outline at least 3:1, face or outline against the floor at least 3:1, on the five zone floors).
- "Within one row" of content is 27 units (one rival row) of empty space under the lowest of the status text and the last rival row; rows start within 14 units
  under the status text. The pill is at most 24 units wider than its text (and no narrower than it). The chip is measured at scale 1 and 1.5 with the scale applied
  BEFORE the chip is built (a scale change after the chip exists needs a MatchHud relayout this oracle does not drive).
- The Hunt card is also required to start below the plate when no chip shows (it is 2 units inside it today).
- World-name hiding covers actor names only (mobs and fighters); camp respawn and ward labels are not covered.
- A pack's anchor is unchanged (centre of the extent, highest member): a very spread camp pack's name floats over the middle of its extent.

## 10. Risk and suggested model tier
Sonnet. Item 2 depends on what the wire delivers per mob: the oracle author establishes it first and cuts a wire
packet if camp membership is not delivered and the leash fallback is not good enough.

## 11. Known traps
- World text is not reached by `MatchHud.ApplyTextScale`: measure from the drawn mesh.
- An EditMode run modifies `Assets/Resources/Showcase/NunitoRegular.asset`: `git checkout --` it, never commit it.
- Hand-off includes `git diff --stat packet/P-UNITY-HUD-VISUAL-FIX-4`.

## Notes from previous attempts
