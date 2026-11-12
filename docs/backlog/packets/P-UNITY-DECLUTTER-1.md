# P-UNITY-DECLUTTER-1: one mark per camp (its buff) and a marker for elites; no zone shapes on camps, no per-mob role marks

- **Serves:** owner direction 2026-11-12 (chat): "the minimap is quite visually crowded. Since the map already has the
  colour highlights there isn't really a need to have the type icon (red triangle for fire etc). ... I like it when the
  only logo above a camp is the buff they give. ... it looks like each mob has a different logo on each individual
  enemy. Just keep the single buff indicator on the mob. ... reduce visual clutter while keeping it information dense
  (such as buff type and specific markers for elites)"
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1: this is the owner's direction and differs from legacy on purpose (DEV-022 drafted with the
  owner's words) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
The first real screenshots show a crowded minimap and a mark on every mob. Two rules from the owner replace what is
drawn today:

**Maps (minimap and Tab map).** A camp is drawn as ONE glyph: the icon of the buff its kills pay, in the stat's
colour. The zone shape (triangle for Fire, diamond for Sentenced, clover for Plague, star for Frost, ring for Holy) is
no longer drawn for camps: the map's zone tint already says which zone a camp is in, and those shapes then mean
"player of that faction" only. An elite camp carries one distinct elite marker (the gold crown/star already used for
elites; on the Tab map the existing "AUG" tag stays beside it). A cleared camp keeps its state and its timer (owner
asked for camp timers on both maps): the buff icon dimmed with the respawn seconds (or the chest seconds while its
chest stands). The "someone has fought here" ring is dropped from the minimap and kept, subtle, on the Tab map only.
Ward marks stay (small). Nothing else is added.

**World.** Above a camp there is one badge: the buff (the existing plaque). Individual mobs carry no role mark of any
kind (no circled role glyph, no rim): the per-mob role badge is removed for every role. Elites keep their marker
(the star and gold name). Mob names stay as legacy shows them (dim while idle); the hp bar stays.

When this lands a pure function decides, per camp and surface, the single glyph, its colour, the elite marker, the
dimming and the timer text, with tests; the map layer and the overhead presenter draw exactly that.

## 2. Dependencies
- P-UNITY-HUD-VISUAL-FIX-1 merged (it restricted the role badge to three roles and its oracle pins that: this packet's
  oracle replaces those role-badge cases; say which test methods were replaced)

## 3. Relevant legacy paths
- For reference only (this packet departs from them on purpose): `packages/client/src/ui/mapPainter.ts:503-516,
  584-629` (zone-shape camp markers, cleared cross, engaged ring), `packages/client/src/ui/mobRole.ts:20-26` (role marks).
- Kept from legacy: the cleared state, respawn clock text and rounding (P-UNITY-HUD-CAMPS-1 brief), chest seconds
  (P-UNITY-HUD-CAMPS-3), stat icon order and colours (P-UNITY-HUD-CAMPS-2: `CampBadges.Keys`, `IconRgb`).

## 4. New paths
- none required: extend `client-unity/RoguehallaNet/Net/Ui/CampMarks.cs` / `CampBadges.cs` (the marker's kind becomes
  "buff icon"; a camp row without a delivered reward falls back to a neutral dot)

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/CampMarks.cs`, `CampBadges.cs`, their tests' non-oracle neighbours, synced copies
- `client-unity/UnityProject/Assets/Scripts/UI/TacticalMapMarks.cs`, `TacticalMapController.cs` (camp layer, legend
  entry for camps)
- `client-unity/UnityProject/Assets/Scripts/Presentation/ShowcaseIdentityOwner.cs`, `OverheadIndicators.cs` (remove the
  per-mob role badge and its backplate)
- EditMode tests for the camp layer and the overhead presenter

## 6. Contracts and references
- C-OBS: the buff comes from the camp row's delivered reward; nothing is inferred. No game rule in Unity.
- Existing oracles that pin what this packet changes are replaced by this packet's oracle, not edited by the
  implementer: `CampMarksTests` cases pinning the zone-shape marker and the engaged ring on the minimap;
  `HudVisualFixEditModeTests` role-badge cases; any EditMode case pinning the camp marker glyph.

## 7. Behaviour to preserve
- Respawn clocks, chest seconds and the one-badge rule; reward amounts and "AUG" on the Tab map; ward marks; "HUNT" /
  "ENEMY" chips; player contacts with their faction shapes; zone labels at zone centres; the route and quest marks.
- The world buff plaque above a living, visible camp; elite star and gold name; mob names and hp bars.
- No allocation per frame.

## 8. Acceptance checks
- Unit tests on the model: a living camp with a reward gives one marker whose glyph is the reward's icon key and
  colour, with no zone-shape marker; an elite camp adds exactly one elite marker; a cleared camp gives the dimmed icon
  and its clock (or chest seconds); a camp with no delivered reward gives a neutral dot; the minimap has no engaged
  ring, the Tab map has it; the count of glyphs per camp on the minimap is at most 2 (buff, elite) plus a ward mark.
- EditMode: the tactical map draws no zone-shape glyph for camps; a mob of every role (swarm, skirmisher, caster,
  brute, plain) has no role badge object; an elite mob still has its star.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-DECLUTTER-1` passes; new screenshots (the coordinator re-captures).

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/CampGlyphsTests.cs` (model: 10 methods, 13 cases)
- `client-unity/UnityProject/Assets/Tests/Editor/DeclutterEditModeTests.cs` (+ its `.meta`) (map drawing and role badge, 18 cases)
- Replaced (deleted in the `stub:` commit, superseded by `NoMobCarriesARoleBadgeOrItsBackplate`):
  `HudVisualFixEditModeTests.OnlyTheRolesLegacyMarksGetARoleBadge` (7 cases). No `CampMarksTests` or `TacticalMapEditModeTests` case
  pins the zone shape or the ring (they test counts, clocks, badges), so none was replaced; they must stay green.

## Model signatures (stubbed in the `stub:` commit, `CampMarks.cs`)
- `CampMarks.Glyphs(MapCamp[] camps, IReadOnlyList<CampView> rows, double serverNowMs, bool active, CampSurface surface, List<CampGlyphRow> into)`
  fills one `CampGlyphRow` per camp for Minimap/TabMap (none for World, none on a row-count mismatch or null).
- `CampGlyphRow { Index, WorldX, WorldY, Zone, IconKey (null = neutral dot), IconRgb, AmountText (Tab only), Elite, EliteText ("Aug", Tab
  only), Dim (cleared), Clock (bare seconds, cleared and RespawnAt>0 and active, else null), Engaged (state 1 and Tab only) }`;
  `CampMarks.NeutralRgb = 0xb4c9dc`. Clock rounding as `Markers`. Rows are produced while inactive too (no clock then).
- The map layer stops calling `CampMarks.Markers` and `CampBadges.Rewards` (still tested and kept; `WorldLabels`, `Wards`,
  `Rewards` for the World surface stay in use). Keep `CampMarkerCount` = camp rows, `RewardBadgeCount` and `BadgesDrawn` = rows with a
  real icon (not dots, not elite) so `TacticalMapEditModeTests` stays green.

## Test-visible accessors (stubbed on `TacticalMapMarks`)
`CampShapesDrawn` (must be 0), `EngagedRingsDrawn` (mesh pass; Tab only), `EliteMarkersDrawn` (mesh pass; one per drawn elite camp),
`CampBuffGlyphsDrawn` and `CampDimGlyphsDrawn` (set in `Present`'s `RefreshBadgeIcons`: icon Images plus neutral dots, and the dimmed
subset; the stub counts icons only and never dims). Counts exclude camps under a contact (`ContactNear`).

## Drawing the implementer changes
- `TacticalMapMarks.DrawCamps` (zone-shape glyph, cross, engaged ring, elite diamond), `DrawBadges` (plate under the stat Image, elite
  square on Tab), `RefreshBadgeIcons` (the stat Image, now also dimmed and the neutral dot), `RefreshCampClocks` (clock from the glyph
  row; keep the chest one-badge rule `ChestBadges.Replaces`), `RefreshBadgeTexts` (amount and "Aug"), `Present` (the Markers/Rewards calls).
- `ShowcaseIdentityOwner`: delete `_roleBack`/`_roleGlyph`, their `CreatePart`, `Set`, `Place`, `HideAll` lines and `roleMark`. The tests
  require the child objects "Mob role badge glyph" and "Mob role badge backplate" to not exist at all.
- Elite marker today: `DrawCamps` draws a gold (0xffd54f) `MapGlyph.Diamond` via `Marker(...)` at `p + (0, size + 3)`, size `6f * s`, on both
  maps; on the Tab map `DrawBadges` also draws a `ChestTone` square for `EliteIconKey` and `RefreshBadgeTexts` writes `EliteText`
  ("Aug") beside it. Reuse that diamond as the single elite marker (anchored to the glyph, not the removed zone shape).

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`,
  `client-unity/UnityProject/Tools/editmode.sh`

## 10. Risk and suggested model tier
Sonnet. Small: it removes drawing and changes one glyph choice.

## 11. Known traps
- The Tab map's legend ("MAP KEY") lists the faction shapes as "Players": keep that line and add one for camps ("Camp
  buff" with a sample stat icon, "Elite" with the crown).
- A stat icon at minimap size must stay readable: reuse the size the reward badge used; do not shrink it to fit a ring.

## Notes from previous attempts
