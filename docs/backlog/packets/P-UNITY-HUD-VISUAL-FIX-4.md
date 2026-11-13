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

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/{NameMerge.cs,NameStack.cs}` and the synced copy
- `client-unity/UnityProject/Assets/Scripts/Presentation/{SpriteActorPresenter*.cs,OverheadIndicators.cs}`
- `client-unity/UnityProject/Assets/Scripts/UI/{MatchHud.Terrain.cs,SentencedHuntPanel.cs,HubLobbyActivityView.cs,TacticalMapController.cs}`
  and the script that draws the defeat card's status pill (the oracle author names it)
- `docs/DEVIATIONS.md` DEV-024 (one sentence: a pack is the camp's mobs of one name)

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
- listed by the oracle author on `packet/P-UNITY-HUD-VISUAL-FIX-4`

## 10. Risk and suggested model tier
Sonnet. Item 2 depends on what the wire delivers per mob: the oracle author establishes it first and cuts a wire
packet if camp membership is not delivered and the leash fallback is not good enough.

## 11. Known traps
- World text is not reached by `MatchHud.ApplyTextScale`: measure from the drawn mesh.
- An EditMode run modifies `Assets/Resources/Showcase/NunitoRegular.asset`: `git checkout --` it, never commit it.
- Hand-off includes `git diff --stat packet/P-UNITY-HUD-VISUAL-FIX-4`.

## Notes from previous attempts
