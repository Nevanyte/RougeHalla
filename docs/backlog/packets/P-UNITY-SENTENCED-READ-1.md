# P-UNITY-SENTENCED-READ-1: Sentenced walls and fences read clearly against the floor

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (Unity UI packets); owner direction 2026-11-10 (MIGRATION checkpoint)
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (art) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
In Sentenced the owner cannot tell walls and fences from walkable floor. Legacy keeps the wall top about twice as light
as the floor, adds a lighter rim on open edges and draws light fence bars over a darkened blocked tile; Unity's wall and
fence colours sit at almost the floor's darkness under the zone's weakest lighting. When this lands Sentenced wall tops,
wall rims and fence tiles meet a measured luminance contrast against the floor, in the palette and after the zone's
lighting.

## 2. Dependencies
none

## 3. Relevant legacy paths
- `packages/client/src/render/zoneArt/palette.ts`: Sentenced floor, wall top, wall front, rim and fence colours
  (survey: floor `#3a3b42`, wall top `#7b7e8a`, wall front `#4b4e58`, rim `#a4a8b6`, fence bars `#8d93a3` over a 30% dark
  shade; oracle author: verify the values and cite the lines)
- `packages/client/src/render/zoneArt/zoneStyle.ts`: where the rim and the fence shade are drawn (cite the lines)

## 4. New paths
- none expected

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/View/Regions/RegionThemes.cs` (Sentenced wall colours only)
- `client-unity/UnityProject/Assets/Scripts/View/Regions/RegionWallAtlas.cs` (fence bars, rim)
- `client-unity/UnityProject/Assets/Scripts/View/Regions/RegionWalls.cs` (fence style selection, `:92`)
- `client-unity/UnityProject/Assets/Scripts/View/Atmosphere/RegionAtmosphereTable.cs` (Sentenced row only)
- `client-unity/UnityProject/Assets/Tests/Editor/RegionThemeEditModeTests.cs`
- `client-unity/UnityProject/Tools/contrast-gate.cjs`, `contrast-lib.cjs`, `contrast-lib.test.cjs`

## 6. Contracts and references
- Owner direction in `docs/prompts/UNITY_REWORK_FABLE.md:69-74`: black/dark-grey tiles and a 3:1 contrast gate.
- `docs/prompts/UNITY_REWORK_STATE.md:65,129,137`: known Sentenced lighting notes (flagstone tint, lights-off after
  about 10 s parked on `rework/flicker`, corner haze). The lights-off bug is out of scope unless it is a one-line cause.
- No game rule: collision comes from the server's tiles; this changes colours only.

## 7. Behaviour to preserve
- Other zones' palettes and atmosphere rows.
- `RegionPaletteGenerated.cs` is generated: do not hand-edit it.
- Fog-of-war darkness (owner request 2026-11-10: unseen ground about 0.30 of lit).

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-UNITY-SENTENCED-READ-1` passes (full).
- `node --test client-unity/UnityProject/Tools/contrast-lib.test.cjs`: Sentenced wall top versus floor, rim versus
  floor and fence bar versus fenced-tile ground each at least 3:1 (WCAG relative luminance) on the palette values the
  test reads from the C# sources.
- EditMode: the same three pairs measured on the generated textures; a fence tile has a darker ground than open floor.

## Oracle files (read-only for implementers)
- `client-unity/UnityProject/Tools/contrast-lib.test.cjs`
- `client-unity/UnityProject/Assets/Tests/Editor/RegionThemeEditModeTests.cs`

## 9. Validation commands
- `node --test client-unity/UnityProject/Tools/contrast-lib.test.cjs`
- Unity EditMode batch run (Editor closed). Not part of the gate: report whether it was run.
- Sentenced screenshots from `Assets/Scripts/View/Regions/RegionPreviewCapture.cs`, attached to the hand-off.

## 10. Risk and suggested model tier
Sonnet. The gate does not run Unity, so the node contrast test is the machine check; the look still needs a screenshot.

## 11. Known traps
- Raising wall brightness without the rim leaves flat grey blocks: legacy's readability comes from the rim on open edges.
- Lighting multiplies the palette: a pair that passes on palette values can fail under exposure 0.55 and saturation -22.
  State both measurements.
- Fences in every zone use the Sentenced fence style (`RegionWalls.cs:92`): check the other zones' screenshots too.

## Notes from previous attempts
