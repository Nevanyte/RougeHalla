# P-UNITY-NAME-LEGIBLE-1: names read on snow and paving; an elite's name clears its camp badge; the hub card holds its text

- **Serves:** owner direction 2026-11-12 (less clutter on mobs while keeping the information readable); screenshot
  round 6 (2026-11-12, local `cdc119ec`), the one defect that has survived three fix packets
- **Implementer tier:** implementer-sonnet (Unity presentation; pure rule in `RoguehallaNet`)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (presentation) · no wire change

## 1. ID and outcome
Round 6 of the running Web client (shots under the session scratchpad, `shots6/`): mob names are now at full
strength and one per camp pack, and on dark ground (Fire basalt, Sentenced flagstone) they read well (shots 01, 12 to
14). On pale ground they still do not: "Frost Wisp" on snow (05, 06), "Acolyte" on Holy paving (08), "Ice Golem"
(02, 03, 09, 10) are a pale face over a pale floor. Three packets fixed alpha, anchoring and pack membership; none changed
the colours, and their oracle accepted "face OR outline contrasts with the floor" against a flat theme colour.

When this lands:
1. **A name's colours follow the ground under it.** Over a pale floor a mob name is drawn with a dark face and a light
   outline; over a dark floor, the light face and dark outline it has today. The choice is made from the luminance of
   the surface under the name's anchor (`SurfaceMap`), re-evaluated each frame, with hysteresis so a pack on a border
   does not flicker. The rule the oracle pins: the FACE colour against the floor at least 4.5:1 (average, and the
   brightest decile for a light face), the outline against the face at least 3:1, on every floor of the table in
   section 3(b). The same rule applies to elite names (gold on dark; a dark gold-brown with a light outline on pale),
   fighter names and the local fighter's name (green on both).
2. **An elite's name is not covered by its camp's badge or by pack members' bars** (shots 09, 10).
   Stated rule: the badge steps clear of any drawn name (the way the respawn and ward labels already do through
   `NameRectSource`), and the elite's name draws above other mobs' bars; either may move at most 3 world units.
3. **Names draw above every health bar** (shot 06: the local fighter's green name under two mob bars).
4. **The hub lobby card holds its text** in the "unavailable" state at 1024x768, 1280x720, 1920x1080 and 960x720,
   after `MatchHud.ApplyTextScale` ran, and stays clear of the tiles.

## 2. Dependencies
none. Runs beside P-UNITY-HUD-BUILD-3 (that packet owns `UI/MatchHud*.cs` and `Net/Ui/HudContentText.cs`; this one does not touch them).

## 3. Diagnosis (oracle author, from the code; paths under `client-unity/UnityProject/Assets/Scripts/`, line numbers after the `stub:` commit)

### (a) What a name is drawn with
- Face: `Presentation/OverheadIndicators.cs:201` picks a THEME colour by tone and never looks at the ground: mob `TextSecondary` #B2BFCE
  (`UI/UiPaletteTokens.cs:25`), elite `Accent` #F4D576, the local fighter `Success` #89DA9B, other fighters `TextPrimary` #F2EEE3.
  Alpha :204 is .5 for an idle full-health mob; the presenter raises every shown mob name to 1 afterwards
  (`SpriteActorPresenter.cs:244`, DEV-024), so the strength is decided in two places. Legacy for reference: `packages/client/src/render/MobView.ts:29-30`
  (#b0bec5 / #ffd54f), :109 black stroke 2 px, :27,182 idle alpha .5; `PlayerView.ts:172-173` (#b9f6ca local, #eceff1, black stroke 2).
- Outline: ONE static shared material for every world label (`OverheadIndicators.cs:86-101`): outline colour `OutlineDark` #0D111B (:98), width .1 (:93),
  sharpness .7, face dilate .04. One material means one outline colour for all names: a light outline for pale ground needs a second material (or per-label
  colours); the oracle reads the material the label actually uses (`fontSharedMaterial`).
- Size 2.5 (11 px legacy), 2.5*12/11 for an elite (:205). TMP material copy of `NunitoBold`.
- The brief said "pale face with a pale outline". The code says the outline IS dark (#0D111B). What the player sees on snow (shot 06, crop of the name,
  pixels 845..945 x 400..420): darkest glyph pixel (134,154,178), 5th percentile (143,160,182), the floor around it about (164,204,233) (luminance .55): the glyph
  core measures about 1.5:1 against the snow. A 2.5-unit label has strokes about 1.5 px wide and the .1 outline eats most of them, so the glyph is a muddy
  mid-grey, neither the face nor the outline colour. The theme face alone is 1.0 to 1.4:1 on snow. The oracle therefore pins the FACE colour (what survives
  at that size is the face's share) and a 3:1 outline against it; it cannot render glyphs, see "What the oracle does not prove".
- Why the old checks passed: `NamePackGroup2EditModeTests.ThePackNameReadsOnEveryZonesFloor` compared against `RegionThemes.Get(zone).BaseSrgb` (one flat colour) and
  accepted `max(face vs floor, outline vs floor) >= 3`; the dark outline satisfies that on any floor on paper.

**Contrast as measured today** (face = the colour drawn today; floor = the sampled ground of section 3(b); each cell is average / brightest decile; rule: both at least 4.5):

| floor | avg L | Mob #B2BFCE | Elite #F4D576 | Fighter #F2EEE3 | Local #89DA9B |
|---|---|---|---|---|---|
| Basalt (Fire) | .027 | 7.29 / 5.29 | 9.49 / 6.88 | 11.75 / 8.53 | 8.15 / 5.91 |
| Flagstone (Sentenced) | .017 | 8.39 / 5.98 | 10.92 / 7.78 | 13.52 / 9.64 | 9.38 / 6.69 |
| Mud (Plague) | .062 | 5.03 / **3.47** | 6.55 / 4.52 | 8.12 / 5.60 | 5.63 / **3.88** |
| Snow (Frost) | .490 | **1.04 / 1.12** | **1.36 / 1.16** | **1.68 / 1.44** | **1.16 / 1.00** |
| Sand (Holy) | .383 | **1.30 / 1.13** | **1.69 / 1.15** | **2.09 / 1.42** | **1.45 / 1.01** |
| Limestone (Coliseum) | .290 | **1.65 / 1.18** | **2.15 / 1.54** | **2.67 / 1.90** | **1.85 / 1.32** |
| Ice | .559 | **1.08 / 1.60** | **1.20 / 1.23** | **1.49 / 1.01** | **1.03 / 1.43** |
| Healing light | .277 | **1.72 / 1.13** | **2.23 / 1.47** | **2.77 / 1.81** | **1.92 / 1.26** |
| Holy temple paving | .414 | **1.21 / 1.13** | **1.58 / 1.48** | **1.95 / 1.83** | **1.35 / 1.27** |

Face against outline today: mob 10.1, elite 13.1, fighter 16.3, local 11.3 (all fine). Red on every pale or mid floor (as briefed). **Flag:** Plague mud is also red today
for the mob (3.47) and local (3.88) faces against its brightest decile (the grass patches); Basalt, Flagstone, and the elite and fighter faces on mud are green.
The mud numbers rest on an assumed lighting ratio (no Plague screenshot, section 3(b)); the implementer lightens the mob and local faces on dark ground a little
(for example the mob face to about #E3EAF1), which the 4.5:1 rule on mud requires.

### (b) The floor, measured
`View/Regions/RegionGround.cs` draws ONE quad with the `Roguehalla/RegionGround` shader (`Resources/Regions/RegionGround.shader`), so there is no CPU colour to ask for.
The ground is the baked detail layers (`View/Regions/RegionGroundTextures.cs`: r detail with relief, g secondary mask, b accent mask) tinted by the region palette
(`RegionThemes`, `RegionPaletteGenerated`) with the formula of `ShadeRegion` (:145-171), `ShadePlague` (:175-240) and the temple slabs (:262-300); ice and healing light come from the terrain
table (`RegionThemes.TerrainLookOf`). The baked array is unreadable on the CPU (`array.Apply(true, true)` at `RegionGroundTextures.cs:37`), so the stub adds
`RegionGroundTextures.DetailLayer(layer)` (the same pixels, readable; `Build` now shares one `FillLayer` with it).
`Tests/Editor/NameLegibleFloors.cs` evaluates the shader's formula texel by texel over those layers (macro variation neutral) and scales by the drawn-light ratio
measured on the round-6 screenshots (clean floor patches against this model: Fire basalt .62 to .73, Frost snow .59 to .77, Holy sand 1.28, temple paving .81 to 1.16, glossy ice
.85 to .88; .68 where no screenshot shows the ground). Result, sRGB, average / darkest decile / brightest decile:

| floor (SurfaceKind) | average | darkest decile | brightest decile | screenshot check (as drawn, avg L) |
|---|---|---|---|---|
| Basalt | #46251C | #2B140D | #64372C | shot 12: .025 |
| Flagstone | #272223 | #0E0D12 | #433937 | shot 01 dark tiles: .016 (lit pools up to .5) |
| Mud | #394C23 | #303423 | #43681D | none |
| Snow | #A1BED0 | #8CB1C6 | #B8CBD7 | shots 05, 06: .43 to .51 |
| Sand | #CC9F55 | #AB7A29 | #EEC378 | shot 08: .385 |
| Limestone | #9C9183 | #645C54 | #B9AD9B | none |
| Ice | #A6CAE3 | #3296C9 | #DFF0FA | shot 10: .49 to .65 |
| Healing light | #AC8B4B | #765417 | #D2AE65 | none |
| Holy temple paving | #BEAA86 | #B8A47E | #C2B08F | shot 08 left: .35 |

NOT modelled: lit pools (lanterns and point lights make Sentenced tiles up to L .5 near a lamp, shot 01), fog, Plague water and grass pockets, Holy garden pockets, lava glow.
Not covered by a floor row: lava, ember, bog, shallow water, grass.

### (c) Sorting, the camp badge
- Every actor's order is its own: `Presentation/SpriteActorPresenter.cs:354` `order = 2000 + round(y * .5)`. Bars: track `order + 4`, health `+ 5`, barrier `+ 6` (:440). A name:
  `OverheadIndicators.cs:209` `f.Order + 12`. So a name is above ITS OWN bar only. An actor lower on the screen has a higher order: mobs 20 px in front of the fighter
  put their bars (order + 5 = 2335, 2337) over the fighter's name (2332): shot 06. The test reproduces it (name sorts at 2332, a bar at 2337).
- The camp badge in the world is drawn by `Presentation/CampRespawnLabels.cs` `DrawBadges` (:240), not by the presenter: a plaque (`Order - 1`) and one or two icons (`Order`) with
  `Order = 29000` (:18), placed at the CAMP position (not over the mobs) 44 units above it (`BadgeOffsetUnits`, :27). It therefore draws above every name whatever the sort order, and
  nothing moves it: only the respawn and ward labels call `Clear` (:187) against `NameRectSource` (:133). `ArenaView.cs:140` wires that to `SpriteActorPresenter.FighterNameRects`
  (`SpriteActorPresenter.cs:189`), which holds fighter names only (:295), never an elite's or a pack's.
- An elite's name (`SpriteActorPresenter.MergeMobNames`, :195) is never merged or stacked (stacking is for fighters and pack names, `StackFighterNames`); it sits at `OverheadStack` name height, which is where a
  neighbour's bar (stood 40 px behind it) and the camp badge land.

### (d) How a presenter knows the floor under a name
`View/Regions/SurfaceMap.cs:44` `SurfaceAt(Vector3 world)` (and `SurfaceAtTile`) answers a `SurfaceKind` (Snow, Ice, Sand, TempleFloor, Flagstone, Basalt, HolyLight, Limestone, Mud, ...) from the region plane, the terrain plane and the temple and Plague layers;
`ArenaView.Surfaces` (`ArenaView.cs:22`) is an instance property, and the presenter had no reference to it. The stub adds `SpriteActorPresenter.Surfaces` (public field, `SpriteActorPresenter.cs:67`)
and sets it at `ArenaView.cs:129` (one line, outside the brief's scope, done in the stub so the implementer does not edit `ArenaView.cs`; no other packet owns that line). `SurfaceAt` takes the Unity world position of the name's anchor
(`OverheadIndicators.NameWorldPosition`, after the pack anchor move). The floor luminance per `SurfaceKind` is the implementer's table (a handful of constants: the table of (b) is the evidence), fed to `NamePalette.IsPale`.
Null `Surfaces` (tests, no map) keeps today's dark-ground colours.

### (e) The hub card
`UI/HubLobbyActivityView.cs:37` builds the body with `MythicUi.Text`, which attaches a `MythicTextScale` with `BaseSize = 15 * 1.5` (`UI/MythicUi.cs:94`). FIX-4 then set auto-size 11..15 on the body (:39). Every
`MatchHud.ApplyTextScale` (`UI/MatchHud.cs:121`, run when the Showcase settings change) ends in `MythicUi.ApplyTextScale(_root, scale)` (:131), whose `MythicTextScale.Apply`
(`UI/MythicTextScale.cs:34-35`) rewrites size and maximum to `BaseSize * scale` (22.5) and the minimum to .85 of that (19.1): nine lines cannot fit a 150-high card at a minimum of 19.1, so the last line runs out of the bottom.
FIX-4's test never called that path (it measured right after `Initialize`), so it passed. The card's height is not derived from its text at all: `CardHeight = 150` (:44) clipped by the viewport (:51). The oracle runs the real sequence
(build, place, `MythicUi.ApplyTextScale(root, scale)`, place again): at every window and scale the body is 19.1 (1.0) or 28.7 (1.5) with a text 208 or 352 tall in a box 181 to 194 tall. `MythicTextScale` has a `FitBox`/`MinSize` mode
(`MythicTextScale.cs:18-20, 38-40`) that fits to the box for the current text and survives `Apply`; a card whose height follows its text is the other way. Either is allowed.

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/NamePalette.cs` (+ the synced copy under `UnityProject/Assets/RoguehallaNet/Net/Ui/`, with its `.meta`), created in the `stub:` commit
- the oracle files below

## 5. Exclusive write scope (corrected to the real files)
- `client-unity/RoguehallaNet/Net/Ui/NamePalette.cs` (`IsPale`, `Colours` bodies) and its synced copy (`bash client-unity/sync-net.sh`)
- `client-unity/UnityProject/Assets/Scripts/Presentation/OverheadIndicators.cs` (face and outline per label, strength in `Update`, name sort order, the material), `OverheadExtras.cs` only if the elite star must follow a moved name
- `client-unity/UnityProject/Assets/Scripts/Presentation/SpriteActorPresenter.cs` (read `Surfaces` for the name's anchor and choose the palette with hysteresis; `FighterNameRects` to include shown elite and pack names; elite name clear of other mobs' bars)
- `client-unity/UnityProject/Assets/Scripts/Presentation/CampRespawnLabels.cs` (`DrawBadges` steps clear of `NameRectSource` rects)
- `client-unity/UnityProject/Assets/Scripts/UI/HubLobbyActivityView.cs`
- the existing tests listed under "Existing tests this packet replaces" (deleted)
- NOT in scope: `UI/MatchHud*.cs`, `Net/Ui/HudContentText.cs` (P-UNITY-HUD-BUILD-3), `View/ArenaView.cs` (its one wiring line is already in the stub), `View/Regions/*`, `UI/MythicUi.cs`, `UI/MythicTextScale.cs`, `packages/`

## 6. Contracts and references
- Presentation only; Rust decides every outcome (R-AUTH); no wire change; no game rule is read from Unity, only the ground's look.
- DEV-024 (names at full strength) stays; its row may gain one sentence ("names follow the ground") in the hand-off as a proposed edit.

## 7. Behaviour to preserve
- One name per camp pack; hover or lock moves it; elites and quest givers keep their own names; fighter names stack at most three lines; world names hidden while the Tab map is open
  (P-UNITY-NAME-GROUP-2 and FIX-4 oracles stay green).
- No `Surfaces` (null): the light-face, dark-outline names of today, so every earlier name test keeps its numbers.
- The camp badge is one buff icon (plus the elite chest icon); no per-mob role marks.
- The hub card stays at least 200 x 100 HUD units, inside the window, clear of the tiles.

## 8. Acceptance checks
- Unit (`RoguehallaNet.Tests/NameLegibleTests.cs`): the palette rule on the nine measured floors for four kinds; both palettes' outline against face; dark and light directions; elite gold and dark gold-brown; local green; hysteresis.
- EditMode (`NameLegibleEditModeTests`, `NameLegibleHubCardEditModeTests`): names through the presenter over each floor (map built per case); zone-edge follow; strength from `Update`; sort order; elite versus badge and bars; the hub card at four windows and two text scales.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-NAME-LEGIBLE-1` passes.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/NameLegibleTests.cs` (46 cases: 34 red on the stub; 12 pass as guards: the ten dark-floor rows (Basalt and Flagstone for the four kinds, Plague mud for elite and fighter), local green on both palettes, the contrast helper)
- `client-unity/UnityProject/Assets/Tests/Editor/NameLegibleEditModeTests.cs` (+ `.meta`): 50 cases, 34 red on the stub; 16 pass as guards (the ten dark-floor rows, the three elite-gold-on-dark cases, local green, no-map keeps today's colours, the floor table)
- `client-unity/UnityProject/Assets/Tests/Editor/NameLegibleFloors.cs` (+ `.meta`): the floor measurement; `NameLegibleFloors.Published` equals the unit test's table (checked by `FloorTableMatchesTheMeasurement`)
- `client-unity/UnityProject/Assets/Tests/Editor/NameLegibleHubCardEditModeTests.cs` (+ `.meta`): 8 cases (4 windows x text scale 1.0 and 1.5), all red on the text being taller than its box

## API stubbed in the `stub:` commit
- `NamePalette` (`Net/Ui/NamePalette.cs`): `NameKind { Mob, Elite, Fighter, Local }`, `NameColours { Face, Outline }` (0xRRGGBB), `Luminance`, `Contrast` (implemented), `IsPale(floorLuminance, wasPale)` (stub: never pale), `Colours(kind, pale)` (stub: today's colours).
  Contract in the doc comments: hysteresis band at least .02 with the switch between .1 and .6; pale = dark face and light outline, dark = light face and dark outline; elite gold #F4D576 on dark; local fighter green on both.
- `SpriteActorPresenter.Surfaces` (`SurfaceMap`, public field) and `ArenaView.cs:129` sets it. The presenter reads `Surfaces.SurfaceAt(world position of the name anchor)`.
- `CampRespawnLabels.Draw(rows, wards, badges)` (test seam: draws the world badges from ready `CampBadgeRow`s; `Update` draws them from the session as before; the 2-argument `Draw` calls it with no badges).
- `RegionGroundTextures.DetailLayer(int layer)` (readable baked pixels; `Build` shares `FillLayer`).
- What the oracle reads of a drawn name: the `TextMeshPro` child "Name": `color` times the material's face colour (alpha composited over the floor), the material's outline colour (`fontSharedMaterial`), `MeshRenderer.sortingOrder`, `MeshRenderer.bounds`.
  A bar is any enabled `SpriteRenderer` whose name starts "Health and barrier track", "Confirmed health" or "Confirmed barrier" (the track's outline sprites included).

## Existing tests this packet replaces (the implementer deletes the first one; the coordinator or owner approves)
- `client-unity/UnityProject/Assets/Tests/Editor/HudVisualFixEditModeTests.cs`: `AnIdleFullHealthMobKeepsItsNameFaintAndAHurtOrEngagedOneReadsFull` (line 128-152). It pins the legacy idle alpha .5 INSIDE `OverheadIndicators.Update`
  while the presenter raises every shown mob name to 1 afterwards (DEV-024), so the strength is set in two places and the lower one is never seen. Replaced by
  `NameLegibleEditModeTests.EveryMobNameIsFullStrengthStraightFromUpdateAndTheVisionFadeStillMultipliesIt` (full alpha for a calm, hurt, engaged, elite and dummy mob straight from `Update`, and `ApplyOpacity` still multiplies), so the strength is set in one place. All its other assertions are kept there.
  The neighbouring `AnEliteNameIsTwelveOverElevenTheSizeOfAPlainMobName` is untouched.
- No other existing test is replaced. Passing today and expected to stay green with a palette change: `NamePackGroup2EditModeTests.ThePackNameReadsOnEveryZonesFloor` (no `Surfaces` in that scene: the dark palette), `NamePackFix4EditModeTests`, `HudVisualFix4EditModeTests`, `HubLobbyPanel*EditModeTests` (they never call the text-scale path).
  If a fix changes the card so one of these fails, say so rather than editing it.

## 9. Validation commands
- `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests` · `bash client-unity/sync-net.sh --check` · `client-unity/UnityProject/Tools/editmode.sh`, then `git checkout -- client-unity/UnityProject/Assets/Resources/Showcase/NunitoRegular.asset`.

## 10. Risk and suggested model tier
Sonnet. Hard parts: the pale palette must hold 4.5:1 for a dark face (near-black tints: a face on limestone's darkest decile needs luminance at most about .03, healing light about .026 for the green) and keep the elite brown and the local green recognisable;
the outline is one shared material today; the elite layout test needs the badge and the name to move relative to each other through `NameRectSource` and the presenter's rects.

## 11. Known traps
- World text is not reached by `MatchHud.ApplyTextScale`: measure from the drawn mesh. The HUD card IS reached by it (section 3(e)): that is the bug.
- Only a hurt mob draws a health bar; a calm full-health mob's name is the lone-name case.
- An EditMode run modifies `Assets/Resources/Showcase/NunitoRegular.asset`: `git checkout --` it, never commit it.
- Tests dirty `UiTheme.Current`; the new tests restore it.
- Hand-off includes `git diff --stat packet/P-UNITY-NAME-LEGIBLE-1`.

## What the oracle does not prove
- Rendered glyphs: the EditMode run is `-nographics`; it measures colours set on the label and the material, not pixels. Whether a 2.5-unit label's thin strokes keep the face colour next to a .1 outline (section 3(a)) is not measured; the implementer may also thin the outline.
- The floor is the unlit albedo scaled by a measured ratio: lit pools, fog, Plague water, garden pockets, lava, ember, bog, shallow water and grass are not covered, and Sentenced tiles next to a lamp (L up to .5) are not.
  Plague mud, limestone, Sentenced flagstone and healing light have no screenshot behind their lighting ratio.
- The 2.0:1 floor on the darkest decile for a dark face (a 4.5:1 there is impossible on mid-tone floors) is the oracle's choice, as is the 3-unit stepping bound.
- That hysteresis is wired in the presenter (only the pure rule's band and the zone-edge colour flip are tested; no test walks a border pixel by pixel).
- That `ArenaView` wires `NameRectSource` for elite and pack names (`ArenaView.cs:140` already calls `FighterNameRects`; the test wires it itself the same way).
- The hub card at text scales between 1.0 and 1.5, or other fonts.

## Notes from previous attempts
Three earlier packets (P-UNITY-NAME-GROUP-1, -GROUP-2, P-UNITY-HUD-VISUAL-FIX-4) each passed their tests and each
left names unreadable on snow in the running client.
