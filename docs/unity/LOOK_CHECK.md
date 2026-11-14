# The look check: see a Unity presentation change before and after

Two ways to look, for two purposes. Use the first while working; only the second counts as "seen".

## 1. Editor render (an agent's before and after)

One command renders named scenes through the client's real map view (`ArenaView`, the real landmark art, the real
self actor) to sRGB PNGs, 1920 x 1080. A second command compares two PNGs. The capture runs in the Unity editor in
batch mode with graphics (never `-nographics`: a camera render crashes there). It is an editor-only tool
(`client-unity/UnityProject/Assets/Editor/Look/LookCapture.cs`); no player build contains it.

Steps (an agent making a tuning change):

1. Find the scene in the dial's row of [DIALS.md](DIALS.md). List all scene names (done when 37 names print):

```
client-unity/UnityProject/Tools/look-capture.sh --list
```

2. Render the scene BEFORE your change (done when the command prints one `look-capture: <dir>/<scene>.png` line per
   scene and exits 0; first run in a fresh worktree takes minutes while Unity imports):

```
client-unity/UnityProject/Tools/look-capture.sh cave-inside --out /tmp/look/before
```

3. Render the same scene a second time from the same tree, so you know the noise of one tree (a render is not
   frame-identical to itself):

```
client-unity/UnityProject/Tools/look-capture.sh cave-inside --out /tmp/look/before2
```

4. Make your change, render AFTER, then compare. The command prints one line of `key=value` pairs: `diff_px` (pixels
   with any channel differing), `total_px`, `max` and `mean` (largest and mean per-channel difference), `size`, `bbox`
   (`x0,y0,x1,y1` of the difference) and with `--crop` the path of the changed region cut from the after image; with
   `--noise` also `noise_diff_px`, `noise_max`, `noise_mean` for the two renders of one tree:

```
client-unity/UnityProject/Tools/look-capture.sh cave-inside --out /tmp/look/after
client-unity/UnityProject/Tools/look-compare.py /tmp/look/before/cave-inside.png /tmp/look/after/cave-inside.png --crop
client-unity/UnityProject/Tools/look-compare.py /tmp/look/before/cave-inside.png /tmp/look/after/cave-inside.png --noise /tmp/look/before/cave-inside.png /tmp/look/before2/cave-inside.png
```

   (The second prints the difference and the noise on one line; use it as your report's figure.)

   Compare only two images of one scene. A change is real when `diff_px` and `max` stand clearly above the noise
   figures and `bbox` lies where the change should show. Then Read both PNGs (and the crop) and say what you see.
   The noise alone is
   `look-compare.py --noise <a.png> <b.png>`. Sizes that differ are refused (exit 2).

Options of `look-capture.sh` (exit 0 done; 1 run failed, log at `<dir>/look-capture.log`; 2 usage; 3 unavailable: no
editor at `$RH_UNITY_EDITOR` or the version in `ProjectSettings/ProjectVersion.txt`, or the project is open in an
editor): `--ground-only` draws only the ground mesh (no props, actors, walls); `--quality low|medium|high|ultra`
(default `ultra`). After a run the script restores `ProjectSettings/ShaderGraphSettings.asset` and
`Assets/Resources/Showcase/*.asset` when they were unmodified before. A file that was already modified before the run (for example a font asset left by an EditMode run) is not touched: the script warns and names it; restore it with `git checkout -- <file>` before committing, and never commit anything under `Assets/Resources/` or `ProjectSettings/`. Several scenes in one command share one editor
start: name them all.

Scenes (each is the PNG's file stem). Zone scenes: a 60 x 60 map of one zone with an L-shaped wall cluster and a fence
run (a bog patch in Plague), two stand-in actors; "dressed" adds a ground-variant plane and one prop, as a server-dressed
map has:

- `fire-scene`, `fire-scene-dressed`
- `plague-scene`, `plague-scene-dressed`
- `sentenced-scene`, `sentenced-scene-dressed`
- `holy-scene`, `holy-scene-dressed`
- `frost-scene`, `frost-scene-dressed`

Landmark scenes: the approved drawing in `docs/landmarks/blueprints/` stamped in the middle of a 60 x 60 map of its
zone, anchor as the art tests stamp it, stand-in actors (red, blue, yellow blocks) by the doorway. `wide` shows the
whole landmark, `close` the doorway, `inside` or `under` puts the self actor on a tile that fades the roof (the roof
must be faded in this shot and opaque in `wide`), `rot-wide` is the drawing turned (x and y swapped):

- cave: `cave-wide`, `cave-close`, `cave-inside`, `cave-rot-wide`
- volcano: `volcano-wide`, `volcano-close`, `volcano-rot-wide`
- church: `church-wide`, `church-close`, `church-inside`, `church-rot-wide`
- bog: `bog-wide`, `bog-close`, `bog-under`, `bog-rot-wide`
- hall: `hall-wide`, `hall-close`, `hall-inside`, `hall-rot-wide`
- the volcano two tiles from the map edge, its outlets running into the map as streams: `volcano-edge-wide`,
  `volcano-edge-close`, `volcano-edge-rot-wide`

Frost Wall scenes: a 60 x 60 map of open Frost ground (zone 4, no landmark), the wall or the aim preview injected into the
arena's own `FrostWallPresenter` as the server's state would be (no server, no wire), camera at play zoom (orthographic
size 9). The cast telegraph is not drawn by any scene (it needs a live Wish start and moves with time; judge it in a Web
round). The preview pulses; the noise note below applies:

- `frost-wall`: a horizontal wall of 7 tiles, fresh; the self actor one tile south of it, a stand-in block one tile north
- `frost-wall-vertical`: a vertical wall of 7 tiles, fresh; the self actor beside its south end, a stand-in beside its north end (draw order row by row)
- `frost-wall-cracking`: the `frost-wall` scene 500 ms from the wall's end (paler)
- `frost-wall-preview`: no wall; the aim preview open (reach ring, a block per tile, line and centre dot, in Frost's colour)
- `frost-wall-preview-invalid`: no wall; the preview aimed into a block of rock: no tile, red

Limits:
- The renders are not frame-identical: wind, cloud shadows, ice shimmer and light flicker run on the shader clock, so
  two renders of one tree differ. Measured 2026-11-14 for `cave-inside` rendered twice: `noise_diff_px=1334190` of
  2073600, `noise_max=165`, `noise_mean=1.94`; so judge `mean`, `max` and `bbox` against the noise figures and look at the images. Pinning the clock needed a
  temporary shader edit and is not part of this tool. Always state the noise figure (`--noise`) next to a difference.
- The capture reaches four non-public client members by reflection (`ArenaView.Awake`, `ArenaView._landmarks`,
  `Landmark.Fades`, `ArenaView._frostWall`); EditMode names the one that stops resolving after a rename.

Known differences from the game, which is why this is not proof of a look:
- Plague and Sentenced scenes render darker than the Web client (measured 2026-11-13: Plague grass about 40, 75, 37
  against 104, 132, 77; Sentenced floor about 106, 89, 81 against 152, 136, 114). Cause not found. Use the render for
  differences (did my change move what it should, and nothing else), not for absolute brightness or colour.
- Test maps are small and hand-built: no pooled map's density of props, lamps and decoration bands.
- No session: no fog of war, no other players, no HUD.

## 2. Web round (what the owner is shown)

A build of the Web client run against a local server, driven in a browser, with screenshots. A look is approved only
on these. The recipe (server flags for pooled landmark maps, the build script, serving, the
driver) is [WEB_ROUND.md](WEB_ROUND.md).

Rules learned the hard way (2026-11-13):
- Never show the owner, or approve, a look from colour patches, texture composites or editor renders. Twice in one
  day a look approved that way was wrong in the client.
- A test that measures a colour model (albedo against a palette entry) says nothing about the screen: the ground is a
  shaded texture under a strong zone light. Measure rendered pixels, or do not claim the look.
