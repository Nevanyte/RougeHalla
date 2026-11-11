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
- `client-unity/RoguehallaNet/Net/Ui/OverheadStack.cs`: the pure layout, `OverheadStack.Build(in OverheadFacts, List<OverheadElement>)`. (`OverheadLayout` is taken by an older struct in `Indicators.cs`, whose tests stay.) A stub exists (today's Unity arrangement); the implementer replaces its body and deletes the four extra `OverheadKind` members (`InsigniaPlate`, `SignatureIcon`, `NamePlate`, `StatusBadge`).

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/OverheadStack.cs` and its synced copy; `Indicators.cs` only if a helper is needed (its tests are oracle files)
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
- `client-unity/RoguehallaNet.Tests/OverheadLayoutTests.cs` (new; 21 cases, 20 red on the stub)
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

## Legacy layout as verified (oracle author)
Units in the layout: legacy px, y up from the feet, `Y` = bottom edge, `X` = centre. BODY_LIFT 14 + FIGURE_RADIUS 13.2.
- Hp bar: top 35.2 (`PlayerView.ts:285`), 4 px high (`FighterArt.ts:354`); width 28 player, 36 mob/dummy, 48 elite (`MobView.ts:19-20,175`). Fill colour from hp/maxHp: above 50% `66bb6a`, above 25% `ffca28`, else `ef5350` (`FighterArt.ts:383`); barrier `81d4fa` segment after the fill, bar scale `max(maxHp, hp+barrier)`, widths rounded to half a pixel (`hpView.ts:20`, `FighterArt.ts:378-392`).
- Name: bottom 45.2, 11 px, own `#b9f6ca`, others `#eceff1` (`PlayerView.ts:65,171-174`); mob `#b0bec5`, elite `#ffd54f` (`MobView.ts:23-24`); `[BOT]` tag `displayName.ts:6`. Every name shows (no overlap hiding).
- Wish icon: 15 px, right edge = name left edge - 3, centre y 51.7, grey when not ready; width falls back to 6 px/char unmeasured (`PlayerView.ts:394-410`).
- Mark pips: 4 of 5x3 px, gap 4, top 57.2 / bottom 54.2, just ABOVE the name and BELOW the crown (`MarkPlate.ts:25-37`, `PlayerView.ts:175`). The task text listed pips last; the code says otherwise.
- Crown: base (bottom) 60.2 (not 61.2 as `LEGACY_INDICATORS.md` P7 says), 22x13 scaled `1 + .5*min(1, bounty/150)`; number bottom at `60.2 + 13s + 1` (`PlayerView.ts:34-39,492`).
- Build row: three FIXED spots x = -18 (secondary weapon), 0, +18 (stats), never re-centred; centre y 72.2, or `60.2 + 13s + 14` with a crown; 18 px squares (`PlayerView.ts:453-480`).
- Statuses are body art at fixed anchors (`StatusArt.ts:20,259-291`: stun at head y 38, silence x +21, attack-slow x -21, anti-heal x -(barHalf+9)); NOT in the layout and not pinned by this oracle.

## Size and split
The pure layout plus rewiring `OverheadIndicators.cs`/`OverheadExtras.cs` for bar, name, Wish, crown, build row and pips, and removing insignia, signature row, name plate and overlap hiding, is likely near 300 lines of Unity diff. Moving the status glyphs from the badge row to their fixed body anchors is a separate `P-UNITY-OVERHEAD-2` (no layout oracle yet; this packet keeps the existing status glyphs working while the badge row stays).

## Pinned legacy oddities
Pips overlap the name's top 2 px; the build row never re-centres when the secondary weapon is missing; bar rounding is to half a pixel with JS `Math.round` (use floor(x + .5), not banker's rounding).

## Notes from previous attempts
