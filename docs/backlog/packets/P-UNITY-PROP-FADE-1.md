# P-UNITY-PROP-FADE-1: tall props fade clearly when a character is behind or inside them

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (Unity UI packets, P-UI-8 visuals); owner direction 2026-11-10
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (presentation) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Owner decision 2026-11-10: solid-looking props (trees, pillars, tombs, gargoyles) stay walk-through, but must fade more
clearly so a character is never hidden. Today tall props fade to 30% when an actor is behind them, and "tall" is defined
twice (a name-suffix list for spacing and a `Tall` flag for fading). When this lands there is one definition of tall, and
a tall prop fades for any visible actor behind it or standing inside its footprint, over a wider area and to a lower
alpha, with the numbers in one place.

## 2. Dependencies
- P-UNITY-SENTENCED-READ-1 merged (region art files)

## 3. Relevant legacy paths
- none: legacy props are flat decals and wall details (`packages/client/src/render/zoneArt/propsView.ts`); this is a
  Unity presentation rule

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/PropFade.cs` (pure rule: prop rectangle, actor positions, result alpha) and its test

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/PropFade.cs` and its synced copy
- `client-unity/UnityProject/Assets/Scripts/View/Regions/RegionProps.cs` (`:19` `Tall`, `:62` name-suffix list,
  `:119-166` fade)
- `client-unity/UnityProject/Assets/Scripts/View/Regions/RegionPropArt.cs`, `RegionPropArt.Temple.cs` (where `Tall` is
  set on the art, if that is where it lives)
- `client-unity/UnityProject/Assets/Tests/Editor/TempleInteriorEditModeTests.cs`

## 6. Contracts and references
- C-OBS: only actors the client may see cause a fade; a hidden enemy behind a tree must not make it fade.
- No collision: props never block movement (owner decision).

## 7. Behaviour to preserve
- Prop placement (`Scatter`) output is byte-identical: this packet changes fading only.
- Temple overhead props keep fading when the player is inside.

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-UNITY-PROP-FADE-1` passes (full).
- Unit tests: an actor behind the prop's upper body fades it; an actor inside its footprint fades it; an actor in front
  or beside does not; an actor absent from the observation never does; the faded alpha and the fade area are the
  constants the test names.
- EditMode: scatter output unchanged against a pinned hash for the seed-1 map; the spacing rule reads the same `Tall`
  flag as the fade.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/PropFadeTests.cs` (new)
- `client-unity/UnityProject/Assets/Tests/Editor/RegionThemeEditModeTests.cs` (scatter-unchanged case)

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/sync-net.sh --check`
- Unity EditMode batch run (Editor closed). Not part of the gate: report whether it was run.

## 10. Risk and suggested model tier
Sonnet. Small. The later dressing packets replace `Scatter`; the fade rule and the `Tall` flag carry over.

## 11. Known traps
- The fade must not leak hidden enemies (C-OBS): use drawn, visible actors only.
- Replacing the name-suffix list changes which props are "tall" for spacing, which would change scatter output: map the
  flag so the same set is tall, or record the changed hash as intended in the hand-off.
- Many props near one actor fade at once: keep the per-frame cost flat (no allocation).

## Notes from previous attempts
