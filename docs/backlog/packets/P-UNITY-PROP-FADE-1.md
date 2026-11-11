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

### Today's behaviour (verified in `RegionProps.cs`, named facts)
- `FadedAlpha` = 0.30 and `FadeRate` = 9 alpha/s: `RegionProps.cs:14`; applied in `Tick` (`:154-165`, `MoveTowards`).
- Fade area: `NoteActor` (`:131-150`) scans cells 0..3 south and +-2 sideways of the actor, then needs prop foot south of
  the actor (`:142`), `|FootX - x| <= HalfW + 0.35` (`:143`), and actor y within `[FootY, FootY + Height]` (`:144`).
  `HalfW` is 0.8 x half the art width (`:119`). The old horizontal margin is 0.35 and the footprint never fades.
- "Tall" is defined twice: the suffix list at `:62-63` (pine, pine2, tree, palm, spire, stump, deadtree, scarecrow, column,
  pillar; used only for spacing in the static `Scatter`) and `Prop.Tall` (`:19`, set from `art.Tall` at `:119`, from the
  `tall` argument of `Add` in `RegionPropArt.cs:133-134`, `RegionPropArt.Temple.cs`). The sets differ (art-tall props such as
  tombs and gargoyles are not in the suffix list).
- `NoteActor` has no caller in `Assets/Scripts` outside `RegionProps.cs` as found by grep; the implementer must find the
  actor-draw call site and feed only drawn, visible actors (C-OBS).

### Proposed rule and constants (a proposal for the owner to tune)
`PropFade.TargetAlpha(footX, footY, halfW, height, footDepth, xs, ys, count)` returns 1 or `PropFade.FadedAlpha`. Fades
when any of the first `count` (visible) actors is behind the upper body (`ys > footY`, `ys <= footY + height`, within
`halfW + HorizontalMargin`) or inside the footprint (within `halfW + HorizontalMargin`, `footY - footDepth <= ys <= footY`).
Constants, all in `PropFade`: `FadedAlpha` 0.18 (today 0.30), `HorizontalMargin` 0.5 (half a tile; today 0.35),
`FadeRate` 9 (unchanged; `RegionProps.FadedAlpha`/`FadeRate` are removed). `footDepth` is a per-prop input (suggest 0.5).

### Scatter must not change
The spacing rule must keep treating exactly the same props as tall. `Scatter` is static and reads no art, so one definition
means deriving the flag for spacing from the same source for the same set (e.g. a shared name set exposed beside the art
flags), or recording a changed result as intended. Existing pin: `PropScatterOnTheCanonicalSeedMapIsStableAndSkipsTheColiseum`
and `PropScatterIsDeterministicAndRespectsTilesRegionsAndClearance` in
`client-unity/UnityProject/Assets/Tests/Editor/RegionThemeEditModeTests.cs` (lines 158, 182). Caveat: they compare two runs
and bounds (count, frost > 100), not a pinned hash; the implementer must additionally compare Scatter output before and after
(count and per-placement art/tile) and report it. Not part of the gate (Unity).

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/PropFade.cs` (stub committed with today's rule: behind only, 0.30; pure rule: prop rectangle, actor positions, result alpha) and its test

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
- `client-unity/UnityProject/Assets/Tests/Editor/RegionThemeEditModeTests.cs` (existing scatter tests, read-only; no hash pin exists, see above)

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
