# Surface effects evidence (branch rework/surface-fx)

Real-browser captures (Playwright, headed Chromium, 1920x1080, `?surfacefx=1&fx.quality=high`) of the WebGL build against a local
`rh-server` (1 bot). Each JPEG is a contact sheet of 460x300 or 640x380 crops around the local player, in time order (left to right, top
to bottom, about 0.6 s apart). Raw PNGs and console logs stay outside the repo.

| File | What it shows |
|---|---|
| `snow-walk-sequence.jpg`, `snow-then-ice-stop.jpg` | Frost snow: compressed blue-grey prints with a lit rim, alternating feet, trailing behind the walker. Prints are none on Ice (by design). |
| `sand-walk-sequence.jpg` | Holy sand: dark brown depressions; none on the temple floor or flagstone. |
| `plague-water-and-bog.jpg` | Plague shallow water: concentric ripples at each footfall, wake streaks; wet prints (glisten) after leaving it; bog with its green glow pulse. |
| `wet-prints-leaving-water.jpg` | The wet prints that follow water, and a ring ripple at the water edge. |
| `basalt-ash-scuffs-then-sand-stop.jpg` | Fire basalt: small pale ash scuffs. |
| `mud-walk-and-fade-sequence.jpg` | Plague mud prints and the frames at 0.6, 3, 5, 7, 9 and 11 s after stopping. |

Honest notes
- The spawn region is random per match and the character is often stopped by walls or enemies, so a clean 0.6/5/9/11 s fade sequence on
  snow or sand was not captured. The 10 s lifetime, the 2.5 s fade and "a track stays after its maker leaves" are verified by unit tests
  (`SurfaceFxTests`, `SurfaceFxEditModeTests`), and the mud sequence above shows the prints at the left of the first frames gone by the last.
- Prints are deliberately small and low in contrast: sand and snow read well, mud and basalt are subtle, and nothing sits on the character.
- Another actor's trail leaving view was not captured in a match; the tracker/pool tests cover it (marks outlive their maker, no cue for an
  actor that is not delivered).
- Surfaces reached in a match with cue logs: Basalt, Bog, Flagstone, Grass, Mud, Sand, ShallowWater, Snow (and Ice and TempleFloor briefly).
  Not logged in a match: Ember, Lava, HolyLight, Limestone: covered by the EditMode surface-mapping test.

## Ripple positions for a later shader pass

`SurfaceFx.CopyRipples(RippleInfo[] dest)` (Assets/Scripts/Presentation/SurfaceFx/SurfaceFx.cs) returns up to 64 active ripple centres:
`World` (Unity world space), `Birth` (same clock as `Time.unscaledTime`), `Life`, `Diameter` (world units at the end of life) and
`Reaction` (Shallow or Bog). The shader globals `_RhFxNow` (clock) and `_RhFxGlisten` are set every frame; the atlas is `SurfaceFxAtlas.Texture`.

## Frame cost

Built-in recorder (`?perf=1`, `window.__rhPerf`), 30 s of walking, effects on versus `?fx.tracks=0&fx.ripples=0&fx.footsteps=0`:
mean 8.335 ms versus 8.343 ms, p95 9.9 versus 9.7 ms, p99 10.3 versus 10.2 ms. Both ran at the adaptive Low preset on a heavily loaded
machine, so this shows no measurable cost at that setting only (Low caps prints at 384 and turns ripples off).
