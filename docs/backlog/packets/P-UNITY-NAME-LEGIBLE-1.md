# P-UNITY-NAME-LEGIBLE-1: names read on snow and paving; an elite's name clears its camp badge; the hub card holds its text

- **Serves:** owner direction 2026-11-12 (less clutter on mobs while keeping the information readable); screenshot
  round 6 (2026-11-12, local `cdc119ec`), the one defect that has survived three fix packets
- **Implementer tier:** implementer-sonnet (Unity presentation)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (presentation) · no wire change

## 1. ID and outcome
Round 6 of the running Web client (shots under the session scratchpad, `shots6/`): mob names are now at full
strength and one per camp pack, and on dark ground (Fire basalt, Sentenced flagstone) they read well (shots 01, 12 to
14). On pale ground they still do not: "Frost Wisp" on snow (05, 06), "Acolyte" on Holy paving (08), "Ice Golem"
(02, 03, 09) are a pale face with a pale outline over a pale floor. Three packets fixed alpha, anchoring and pack
membership; none changed the colours, and their oracle accepted "face OR outline contrasts with the floor", which a
thin dark outline satisfies on paper while the word stays unreadable.

When this lands:
1. **A name's colours follow the ground under it.** Over a pale floor (Frost snow and ice, Holy paving and light
   tiles) a mob name is drawn with a dark face and a light outline; over a dark floor, the light face and dark
   outline it has today. The choice is made from the luminance of the zone floor (and terrain) at the name's anchor,
   re-evaluated when the pack moves across a zone edge, with a little hysteresis so it does not flicker on a border.
   The rule the oracle pins: the FACE colour against the floor colour is at least 4.5:1 on every zone floor and on
   ice and healing light; the outline against the face at least 3:1. The same rule applies to fighter names, the
   local fighter's name, and the "RESPAWN" and ward labels' text where they have no plate. Elite names keep their
   gold on dark floors and take a dark gold-brown with a light outline on pale floors.
2. **An elite's name is not covered by its camp's badge or by pack members' bars** (shots 09, 10): the elite's name
   and the camp badge are laid out so their rectangles do not intersect (the badge steps above the name, or the
   name steps above the badge: one rule, stated), and the name draws above mob health bars.
3. **The local fighter's name is not hidden behind mob health bars** when a pack is on top of the fighter (shot 06:
   the green name is under two bars): names draw above bars in sort order.
4. **The hub lobby card holds its text** in the "unavailable" state at 1024x768 and 1920x1080 (the last line
   "Current players unavailable." still sits below the card's bottom edge; P-UNITY-HUD-VISUAL-FIX-4's auto-size
   between 11 and 15 did not fix nine lines in a 150-high card): the card's height follows its text, staying clear
   of the tiles.

## 2. Dependencies
none. Runs beside P-UNITY-HUD-BUILD-3 (that packet owns `UI/MatchHud*.cs`; this one `Presentation/**` and the hub card).

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/Presentation/{OverheadIndicators.cs,OverheadExtras.cs,SpriteActorPresenter*.cs,CampRespawnLabels.cs}`
  and the script that draws the camp badge in the world (the oracle author names it)
- a small pure rule in `client-unity/RoguehallaNet/Net/Ui/` (floor luminance to name palette; contrast) with the
  synced copy
- `client-unity/UnityProject/Assets/Scripts/UI/HubLobbyActivityView.cs`

## 7. Behaviour to preserve
- One name per camp pack; hover or lock moves it; elites and quest givers keep their own names; fighter names stack
  at most three lines; world names hidden while the Tab map is open (P-UNITY-NAME-GROUP-2 and FIX-4 oracles stay
  green except the cases this packet names as replaced).
- The camp badge is one buff icon; no per-mob role marks; the hub card stays clear of the tiles at the four window
  sizes.

## 8. Acceptance checks
- Unit: the palette rule: for each of the five zone floor colours, ice and healing light, the chosen face against
  the floor is at least 4.5:1 and the outline against the face at least 3:1; a floor at the threshold does not
  flip-flop (hysteresis).
- EditMode: a mob name drawn over Frost snow and over Holy paving has a face whose rendered colour against the
  floor texture's average colour AND against its brightest decile is at least 4.5:1 (sample the real floor
  textures or tiles the client uses, not a theme constant); over Fire and Sentenced floors likewise; the local
  fighter's name likewise; an elite's name rectangle does not intersect its camp's badge rectangle or any pack
  member's health bar; names sort above bars; the hub card's text rectangle is inside the card in the
  "unavailable" state at 1024x768, 1280x720, 1920x1080 and 960x720 and the card intersects no tile.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-NAME-LEGIBLE-1` passes.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-NAME-LEGIBLE-1`

## 10. Risk and suggested model tier
Sonnet. The earlier oracles measured theme colours; the floor a player sees is a texture with highlights. The oracle
author samples what is drawn.

## 11. Known traps
- World text is not reached by `MatchHud.ApplyTextScale`: measure from the drawn mesh.
- An older test pins a lone idle mob's name at half alpha inside `OverheadIndicators.Update` while the presenter
  raises it afterwards (`HudVisualFixEditModeTests.cs:130`): the oracle author decides whether this packet replaces
  that test so the strength is set in one place, and says so.
- An EditMode run modifies `Assets/Resources/Showcase/NunitoRegular.asset`: `git checkout --` it, never commit it.
- Hand-off includes `git diff --stat packet/P-UNITY-NAME-LEGIBLE-1`.

## Notes from previous attempts
Three earlier packets (P-UNITY-NAME-GROUP-1, -GROUP-2, P-UNITY-HUD-VISUAL-FIX-4) each passed their tests and each
left names unreadable on snow in the running client.
