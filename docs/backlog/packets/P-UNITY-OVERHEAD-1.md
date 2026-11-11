# P-UNITY-OVERHEAD-1: the overhead HUD shows what legacy shows, where legacy shows it

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (Unity UI packets, P-UI-7 combat presentation); owner direction 2026-11-10
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (presentation) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
The owner finds the Unity overhead HUD messy and unlike the original. Legacy, bottom to top: an HP bar (28x4 px for
players, wider for mobs; green above 50%, amber above 25%, red below; the barrier as a blue segment after it), the name
in outlined text (own name mint, `[BOT]` prefix), the Wish icon left of the name, bounty crown and number, a build row
(secondary weapon, top two stats), Sentenced mark pips and text cues; statuses are drawn on the body at fixed spots.
Unity adds a faction insignia plate, a signature-icon row, name plates, status badges in a row, and stacks the Wish icon
above the name. When this lands the Unity overhead stack has the legacy elements in the legacy order and positions, the
additions are gone, and the layout is produced by a pure function with tests.

## 2. Dependencies
- P-UNITY-MOB-DEATH-1 merged (both edit `SpriteActorPresenter.cs`)

## 3. Relevant legacy paths
- `packages/client/src/render/PlayerView.ts`: overhead bar, name, Wish icon, bounty, build row (survey: `:65`,
  `:394-483`; oracle author: verify and cite)
- `packages/client/src/render/StatusArt.ts`: where each status is drawn on the body
- `packages/client/src/render/MarkPlate.ts`: mark pips and cues (survey: `:25-44`)
- `docs/rework/LEGACY_INDICATORS.md` sections 1-2.3 and `docs/rework/LEGACY_LAYOUT.md`: existing write-ups

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/OverheadLayout.cs` (pure layout; name may change) and its test file

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/OverheadLayout.cs` and its synced copy
- `client-unity/UnityProject/Assets/Scripts/Presentation/OverheadIndicators.cs`
- `client-unity/UnityProject/Assets/Scripts/Presentation/OverheadExtras.cs`
- `client-unity/UnityProject/Assets/Scripts/Presentation/SpriteActorPresenter.cs` (overhead wiring and name-overlap
  hiding only)
- `client-unity/UnityProject/Assets/Tests/Editor/HudLegacyLayoutEditModeTests.cs`

## 6. Contracts and references
- ADR 0026 (legacy indicator facts, Proposed): every fact drawn comes from the wire as it is today; no new wire field.
- C-OBS: nothing is shown for an actor that the observation does not carry.
- Out of scope (needs wire 17): remote Wish timing, percentages on the secondary text cues.

## 7. Behaviour to preserve
- Elite ring and star, teleport-immunity ring, Fire roam glow.
- The lock ring.
- Bar values and thresholds come from the same observation fields as today.

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-UNITY-OVERHEAD-1` passes (full).
- Unit tests on the pure layout: element order bottom to top equals legacy; bar size per actor kind; bar colour at 51%,
  50%, 26%, 25% hp; barrier segment follows the hp fill; Wish icon is left of the name; a bot's name has the `[BOT]`
  prefix; no insignia plate, signature row or name plate is emitted.
- EditMode: `HudLegacyLayoutEditModeTests` asserts the presenter draws exactly the layout's elements.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/OverheadLayoutTests.cs` (new)
- `client-unity/UnityProject/Assets/Tests/Editor/HudLegacyLayoutEditModeTests.cs`

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/sync-net.sh --check`
- Unity EditMode batch run (Editor closed). Not part of the gate: report whether it was run.
- `node client-unity/UnityProject/Tools/indicator-shots.cjs` against a local build; attach the sheet.

## 10. Risk and suggested model tier
Sonnet. Medium: several elements move; the pure layout keeps it testable. Split off the on-body status art as
`P-UNITY-OVERHEAD-2` if the diff passes about 300 lines.

## 11. Known traps
- Hiding an overlapping name (`SpriteActorPresenter.cs:196`) is a Unity addition: legacy shows every name.
- Pixel sizes are legacy screen pixels at legacy zoom: convert once, in the layout, and test the conversion.
- Status art on the body uses fixed anchors per status kind; do not derive them from sprite bounds.

## Notes from previous attempts
