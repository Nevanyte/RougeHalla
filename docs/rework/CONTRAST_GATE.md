# Character contrast gate

Owner direction 2026-11-10: "there MUST be an objective 3:1 contrast ratio" between characters and the ground in the final visual pass
([UNITY_REWORK_FABLE.md](../prompts/UNITY_REWORK_FABLE.md) section 4, "Character contrast is a hard gate"). This page defines the measurement,
says how to run it and how to read it, lists what it does not cover, and records the baseline. The lab measures; it never tunes art.

## Owner decision 2026-11-10: no line outline on characters (contrast risk accepted)

The owner reviewed the adaptive outline in play: "FAR too thick", "overlap[s] with itself when character sprite moves making large segments visually too dense", "quite sharp in certain places", "it outlines the shadow below its feet",
"in practice has a lot of visual artifacts", and decided: **"I would prefer just to do no line outline at all at the risk of losing character/background contrast."** The gate below is therefore **known to fail by choice**; this page keeps the measurement so the cost stays visible.

What changed (branch `rework/contrast`):

* Every stroke on figures, the held weapon, the foot marker, the hp track, the insignia and the overhead plates is **off by default** (`SpriteOutline.Enabled = false`). No dark halo is drawn on this tree (it was removed in `2384ca94`; older paragraphs below describing it are historical). The faction mantle stays off and `NoEnlargedOffsetOrStaticCopyOfTheBodyIsDrawn` still guards against scaled or offset copies of the body.
* The **baked ground shadow is removed from every actor sprite** (owner: "remove all transparent aspects of a character sprite in favour of our own lighting system"): `ActorShadowStrip` runs in `ShowcaseLiveCatalogBaker`, see [../art/LIVE_CATALOG_BAKER.md](../art/LIVE_CATALOG_BAKER.md) and [../art/LICENCE_LEDGER.md](../art/LICENCE_LEDGER.md). Our own shadow (soft contact ellipse sized to the look's foot box plus a softer cast shadow along the one sun, zone tinted) grounds the figure.
* The camera sorting layer grab (a full-frame HDR copy) is **off** unless an opt-in variant reads it, and then it is a 2x downsample.
* Two opt-in variants for judging from captures, both off by default: `?fx.outline=1` (1 px adaptive tone outline from the opaque silhouette, outer contour only, one line around body and weapon) and `?fx.rim=1` (nothing outside the sprite: the body's own outermost 1 to 2 pixels lightened on dark ground and darkened on bright ground).

Strict gate, 1920x1080, High, the whole matrix (931 cells: 13 looks on every surface of every zone, idle and walking, two facings, props, edge and seam cells), measured on the real WebGL build, Apple M5 Pro:

| variant | EDGE p10 >= 3.0 | markers all >= 4.5 | verdict |
|---|---:|---:|---|
| baseline `d6f18dce` (full matrix, 4 configs) | 0 / 2,808 | 265 / 2,808 | FAIL |
| adaptive 3 px outline (previous branch state, full matrix, 4 configs) | 3,339 / 3,724 | 3,204 / 3,724 | FAIL (Fire ember, Plague bog) |
| **none (default now)** | **62 / 931** (Fire 1 / 242, Sentenced 0 / 90, Plague 2 / 212, Frost 41 / 166, Holy 9 / 166, Coliseum 9 / 55) | **1 / 931** | **FAIL** |
| outline (`fx.outline=1`) | OUTLINE_EDGE | OUTLINE_MARK | OUTLINE_VERDICT |
| rim (`fx.rim=1`) | RIM_EDGE | RIM_MARK | RIM_VERDICT |

BODY (interior against the ring, reported) medians with no outline: Fire 1.43, Sentenced 1.49, Plague 1.36, Frost 6.94, Holy 4.43, Coliseum 7.35. **The gate does not pass without an outline, and that is the accepted state.** The footprint ring is a faction mark and is still drawn; its own contrast is in the markers column.
Evidence and the three-way comparison: [evidence/contrast/README.md](evidence/contrast/README.md).

## The definition

WCAG 2.x, on sRGB pixels of **screenshots of the real WebGL build** in headed Chromium on a real GPU:

* Relative luminance `L = 0.2126 R + 0.7152 G + 0.0722 B` on the linearised channels (`c / 12.92` below 0.04045, else `((c + 0.055) / 1.055)^2.4`).
* Contrast ratio `(Lhi + 0.05) / (Llo + 0.05)`.
* Sizes 1920x1080 and 2560x1440; quality High and Ultra; every zone (Fire, Sentenced, Plague, Frost, Holy, Coliseum); every surface a character
  can stand on in that zone (`SurfaceKind`, from `ArenaView.Surfaces`); every look in the sprite catalog (`Showcase/Catalog.asset`: 12 keys, plus
  `hero@sentenced` because Fire and Sentenced players share the `hero` sprite and carry different faction colours); idle and mid-walk; two facings
  (south, toward the viewer, and north, away). `facings=4` or `8` adds more.

Per cell (one character standing somewhere):

| Number | What | Gate |
|---|---|---|
| **EDGE** | The silhouette contour as drawn (its outer 2 px) against the ground ring just outside it (3 to 12 px out). Computed **per contour segment**: 16 angular sectors around the silhouette centroid; per sector, median luminance of the sector's contour pixels against median luminance of the sector's ring pixels. | **p10 of the 16 sector ratios >= 3.0** |
| EDGE min, EDGE median | Lowest sector, and median over sectors. | reported |
| EDGE core | The same p10 for the sprite and its dark outline alone (rim excluded) against the ring beyond the rim. Shows what the edge would be if the light rim were absent or invisible. | reported |
| EDGE vs ground | The same p10 with the ring taken from the no-actors frame (the ground texture alone, without the actor's own contact shadow). | reported |
| **BODY** | Median luminance of the sprite interior (silhouette eroded 2 px) against the median of the whole ring. | reported (not gated) |
| **MARKERS** | Hp bar, faction footprint at the feet, faction insignia beside the bar: each marker's contour (outer 2 px of its mask) median against the median of the ground ring around it (3 to 12 px out). The minimum over 8 sectors is also reported. | **each >= 4.5** |

Why p10 of sectors, and not the minimum: a contour is partly dark outline and partly light rim, and some sectors always cross something that is not
the character's edge (a weapon tip, a shadow tongue, a thin limb). With 16 sectors the 10th percentile (linear interpolation between order statistics)
sits between the two lowest sectors, so one stray sector cannot fail or rescue a cell, but a character whose edge is lost over a tenth of its
outline fails. The absolute minimum is always reported next to it. Unmeasurable cells (no silhouette, fewer than 6 px in a sector, a missing marker) are
counted as failures, never skipped.

The silhouette is what the real presenter draws at 50% coverage or more: sprite, the adaptive neutral outline (`Character contrast rim`), held weapon cue (and its outline). The faction mantle (a static faction polygon behind the body) is switched off (`ShowcaseIdentityOwner.MantleEnabled`): it did not animate with the figure and read as a ghost copy. Before branch `rework/contrast` it also held a
half-transparent light rim (`Character light rim`); that rim is gone (the mask class remains, always empty, so `rimShare` reads 0 and EDGE core equals EDGE). The ring is every pixel 3 to 12 px outside the silhouette that no actor mask covers (neighbours, hp bars and badges
are never ground). Contact shadows, the calming halo and faction footprints are drawn in the normal frame and so are part of what the contour and ring look like; neither the shadow nor the halo is part of the silhouette mask. The stroke and the marker outlines
rebuild their own silhouette in the shader, so in `mask` mode they are drawn by the same shader (`_MaskMode`) with the class colour: the mask is exact for them too.

## How it works

1. **The lab stage** (`?contrastlab=1`, `Assets/Scripts/ContrastLab/`). Needs no server. A synthetic `MapBlob` holds six zone blocks of 72 x 80 tiles
   (one large block per zone, four slots each): terrain patches for every terrain kind the zone can have (lava and ember for Fire, bog for Plague,
   ice for Frost, light for Holy, fences for Sentenced), wall and low-wall runs, a dense pillar grid inside Holy (3-tile pitch, for temple detection when
   it lands) and the zone's natural deterministic props. It is handed to the real `ArenaView`, exactly as the launch backdrop does. Only one zone is
   framed at a time, with the match camera (orthographic size 9), so lighting, grading and haze blend as in play.
   `ContrastLabPlanner` then scans the finished map with `SurfaceMap` for every surface that really exists (so layers that land later, such as temple floor
   and Plague mud, grass and water, are measured automatically) and stamps every (look x pose x facing) on clean ground of each.
2. **Actors go through the match path.** The stage builds `InterpActor` rows (the type a match snapshot produces) and calls `ArenaView.Present(rows, null,
   null, 0)` every frame, which is the call a match makes. `SpriteActorPresenter` therefore draws the outline, light rim, contact shadow, hp bar, faction
   marks and weapon cue exactly as in a match, at real scale, with the real gait. Each look is reached through the same `ShowcaseActorLook.AppearanceKey`
   rules a match uses (player faction, mob type, zombie, training dummy). There is no second drawing path. A walking cell is driven toward its place for 0.4 s so
   the real gait plays a mid-stride frame; the cell reports the clip and frame it landed on.
3. **Freeze.** After the camera and atmosphere have settled (3.5 s for a new zone, 1.5 s for a new page) and the walk is done, the stage stops calling
   `Present`. Actors keep exactly the pixels they had, so the three render modes line up to the pixel. Ambient effects (dust, haze, snow, lights, shimmer) keep
   running; the tool averages luminance over several frames instead of freezing them (4 normal frames, 3 ground frames, 200 ms apart).
4. **Render modes** (`window.__rhContrastLab.setMode`): `normal` (as played), `no-actors` (actor layer culled: ground, props, lights, haze), `mask` (only the actors,
   each renderer drawn by `RhContrastMask.shader` in a flat colour on black with the post-processing stack off): silhouette red, hp bar green, faction
   footprint blue, faction insignia and badges yellow, any other indicator magenta. The mask is pixel exact because it is the same renderers at the same frame.
5. **The hook** `window.__rhContrastLab` (`RhContrastLab.jslib`): `ready`; `state` (zone, page, `pageCount`, `totalPages`, `zones`, `zonePageCounts`, mode, quality,
   screen size, plan notes); `cells` (id, zone, surface, appearance key and id, pose, facing, clip and frame, prop and prop mode, `rect` in CSS px and `x,y,w,h` in
   backbuffer px); `setZone(name, page)`, `setPage(n)`, `setMode(mode)`. Every call clears `ready` until Unity answers for that command.
6. **The tool** (`Tools/contrast-gate.cjs`, pure maths in `Tools/contrast-lib.cjs`) drives every page, captures the three modes, computes the numbers and writes the reports.

The page host must be the literal `127.0.0.1`. The tool refuses a software renderer (SwiftShader, llvmpipe) unless `--allow-software` is given and records the GPU string.

## Run it

```bash
export PATH="$HOME/.cargo/bin:$HOME/.dotnet:$PATH"
# 1. Build the Web player (needs a running server only to bake the content hash), see docs/MIGRATION.md.
target/release/rh-server --runtime source-arena --map crates/rh-sim/src/mapdata/fixtures/seed1.map.json --bind 127.0.0.1:7887 \
  --min-players 1 --fill-bots 7 --lobby-seconds 5 --fill-seconds 3 &
RH_SERVER_INFO_URL=http://127.0.0.1:7887/info client-unity/UnityProject/Tools/build-web.sh
git checkout -- client-unity/UnityProject/ProjectSettings client-unity/UnityProject/Assets/Resources/Showcase/NunitoBold.asset client-unity/UnityProject/Assets/Resources/Showcase/NunitoRegular.asset   # only if churned
python3 -m http.server 8187 --bind 127.0.0.1 -d client-unity/UnityProject/Build/Web &
# 2. Measure.
node client-unity/UnityProject/Tools/contrast-gate.cjs --url http://127.0.0.1:8187/ --out /tmp/contrast
```

Options: `--zones fire,holy` · `--sizes 1920x1080,2560x1440` · `--quality high,ultra` (forces `?quality=`; the merged code honours `?quality=low|medium|high|ultra`,
whereas `?fx.quality=` stops at high) · `--edge 3.0` · `--marker 4.5` · `--query "facings=4&props=3"` (extra page flags) · `--frames 4` · `--ground-frames 3` ·
`--max-pages 2` (quick looks) · `--raw <dir>` (keeps the normal and mask screenshots and the state of every page; never commit these) · `--allow-software`.
Exit code 1 when any gated number is below its threshold or a cell could not be measured; 0 otherwise; 2 on a tool or browser error.

Quick look for one zone: `node ... --zones holy --sizes 1920x1080 --quality high` (about a minute). To see the stage yourself open
`http://127.0.0.1:8187/?contrastlab=1&zone=holy&page=1&quality=ultra` (`zone` is `fire|sentenced|plague|frost|holy|coliseum`; `page` is the page within the zone;
`facings=1..8`; `props=0..8` sets the props pages to about 13 x n cells).

Run-to-run difference: `node client-unity/UnityProject/Tools/contrast-gate.cjs --compare runA/contrast.json runB/contrast.json`.

Tests: `node --test client-unity/UnityProject/Tools/contrast-lib.test.cjs` (luminance, ratio, PNG, masks, distance transform, a 0.5-grey disc on 0.1 ground giving the analytic
(0.5 + 0.05) / (0.1 + 0.05), half-dark and half-light contours with known per-sector answers, ring exclusion, argument parsing) and the Unity EditMode suite
(`ContrastLabEditModeTests`: every surface of every zone exists in the lab map, every catalog key is stamped on every surface in every zone, the plan is deterministic, views stay
inside their block, and the lab is unreachable without `?contrastlab=1`).

## Reading the output

* `contrast.json`: thresholds and the statistic, one entry per size/quality (`configs`), then every cell as a row of `columns` (string columns are indexes into `strings`, -1 = empty,
  booleans are 0/1). `edgeP10`, `edgeMin`, `edgeMedian`, `edgeGroundP10`, `edgeCoreP10`, `body`, `bodyGround`, `hp`, `foot`, `insignia` are WCAG ratios (`rimShare` is the rim's share of the silhouette pixels); `clip` and `frame` are the animation
  frame that was frozen; `purity` is the share of the surrounding floor tiles carrying the same surface; `prop` and `propMode` (`front` or `beside`) mark props cells.
* `CONTRAST.md`: pass counts per config and zone; per zone a table (rows = look, columns = surface) whose cell is `EDGE p10 / EDGE min / BODY [core p10]`, worst case over pose, facing, size
  and quality, with a cross where EDGE p10 fails anywhere; props, marker and BODY-distribution tables; plan notes; browser console errors.
* `worst.jpg`: the 24 lowest-EDGE cells. Left of each tile: the cell as rendered. Right: the measurement itself, contour sectors red (below the gate) or green, the ground ring blue.
  Use it to check that the tool measured what you think it measured.

## What is and is not covered

Covered: the grid above on plain ground, and looks standing in front of and beside the zone's props: the two most common tall arts (trees, spires, columns, pillars, scarecrows) and the two most common low arts (grass, tombstones, rocks, drifts, ferns), taken in turns, one idle south-facing look per prop instance (the art table does not flag tombstones as tall, so they count as low). Prop density
is high, so neighbouring props are part of the picture, and cells are only kept apart from each other.

Also covered (conditions, run with `--query "cond=..."`; the default matrix is the plain pages only):

* `cond=local`: the first player cell of a page is drawn as the local player (mint hp bar, larger footprint, accent light). Gated like any other cell.
* `cond=marks`: every overhead plate and ring the presenter can draw at once, around and over each figure: statuses, bounty crown and number, off-hand weapon, build (stat) marks, Wish ready icon, mark plate, signature slots and cue, elite star and rings, barrier bubble and ring steps, teleport-immunity and roam-ready rings. The silhouette, hp track, footprint and insignia are not measurable there by construction (rings and the bubble cover the body), so this condition gates the **plates** marker alone: the outline of the union of every plate and ring (mask class OTHER, holes closed so the glyphs of a name or a number are not counted as edges), vs the ground ring, median >= 4.5. Cells whose silhouette cannot be segmented are reported as unmeasured.
* `cond=fog`, `cond=fade`, `cond=flash`: see the evidence README.

Not covered (say so when quoting a pass):

* **Dead actors** are exempt on purpose: a dead fighter is drawn at 0.65 opacity as a faded corpse, keeps a stroke at 0.6 alpha (`ActorOutlineModel.StateAlpha`, tested) and is not an actor a player must pick out; no lab cell draws one.
* **The melee hit zone** (`HitZonePresenter`) is not drawn in the lab. Its sector edge is a dark line (`EdgeDarkAlpha` .9 of the theme ink) beside a light line (`HitZoneModel.EdgeAlpha` .6 white): the better of the two reads at least 3.1:1 on every ground and 4.5:1 below 0.12 and above 0.4 ground luminance, proved by `TheHitZoneEdgeReadsOnEveryGround` (a bound by construction, not a screenshot measurement). The wind-up telegraph is the same edge pair.
* Combat effects, Wish effects, hit flashes, damage numbers beyond the `cond=flash` frame, and signature icons beyond the `cond=marks` plates.
* Barrier bubble and ring steps are drawn by `cond=marks` but only as part of the plates marker; their own contrast on the gated body is not isolated.
* Held-weapon variety beyond sword, wand and bow, other animation frames than the one frozen (idle frames vary between runs; see the baseline), 8-way facings beyond the two measured.
* Zone borders are covered by the `seam` pages (two zone blocks side by side), not by the camera offset of a live match or anything driven by real vision or network state.
* HUD, minimap, Tab map and overlays: all hidden. The lab measures the world layer only.
* Ambient motion is averaged, not frozen: dust, snow and haze in front of an actor are in the numbers but their position differs per frame.

## Files and hooks

* `Assets/Scripts/ContrastLab/ContrastLabPlan.cs` (map, looks, planner), `ContrastLabStage.cs` (stage, render modes, hook), `Assets/Resources/ContrastLab/RhContrastMask.shader`,
  `Assets/Plugins/WebGL/RhContrastLab.jslib`, `Assets/Tests/Editor/ContrastLabEditModeTests.cs`.
* One hook in an existing file: `Assets/Scripts/Bootstrap.cs`, a six-line branch before the `preview` branch that builds the stage only when `?contrastlab=1`.
* `Tools/contrast-gate.cjs`, `Tools/contrast-lib.cjs`, `Tools/contrast-lib.test.cjs`.

## Baseline

Measured on branch `rework/contrast-lab` (the code of `d6f18dce` plus the lab), 2026-11-10, Chromium (Playwright) headed on `ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)`, orthographic size 9, 2808 cells (702 per size/quality: 13 looks x 2 poses x 2 facings on every surface of every zone, plus props cells in every zone that has props), 4 normal and 3 ground frames averaged per page. No browser console errors. Small committed evidence: [`evidence/contrast-lab/`](evidence/contrast-lab/) holds `contrast.json` (every cell of the first run), `CONTRAST.md` (all tables) and `worst.jpg`; raw captures stay outside the repository.

**Result: FAIL.** EDGE p10 >= 3.0 holds for 0 of 2808 cells; the best cell is 2.09 and the median is 1.14. Markers: 265 of 2808 cells have all three markers at 4.5 or better.

**EDGE (gated: p10 of 16 contour sectors >= 3.0): passing cells / cells, by zone and configuration** (plain ground plus props cells).

| configuration | fire | sentenced | plague | frost | holy | coliseum |
|---|---:|---:|---:|---:|---:|---:|
| 1920x1080/high | 0 / 182 | 0 / 78 | 0 / 130 | 0 / 130 | 0 / 130 | 0 / 52 |
| 1920x1080/ultra | 0 / 182 | 0 / 78 | 0 / 130 | 0 / 130 | 0 / 130 | 0 / 52 |
| 2560x1440/high | 0 / 182 | 0 / 78 | 0 / 130 | 0 / 130 | 0 / 130 | 0 / 52 |
| 2560x1440/ultra | 0 / 182 | 0 / 78 | 0 / 130 | 0 / 130 | 0 / 130 | 0 / 52 |

| zone | cells | EDGE p10 median | best | worst | core p10 >= 3 | core median | BODY p10 / median / p90 (plain ground) | hp bar >= 4.5 | footprint >= 4.5 | insignia >= 4.5 | all three |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| fire | 728 | 1.15 | 2.09 | 1.00 | 5 | 1.21 | 1.07 / 1.38 / 4.09 | 7% | 0% | 0% | 0% |
| sentenced | 312 | 1.07 | 1.38 | 1.01 | 0 | 1.12 | 1.04 / 1.19 / 1.67 | 0% | 1% | 0% | 0% |
| plague | 520 | 1.31 | 1.79 | 1.01 | 49 | 1.74 | 2.06 / 3.25 / 5.31 | 68% | 13% | 56% | 13% |
| frost | 520 | 1.12 | 1.49 | 1.02 | 132 | 2.57 | 3.17 / 4.87 / 7.65 | 98% | 23% | 97% | 23% |
| holy | 520 | 1.12 | 1.59 | 1.03 | 16 | 1.95 | 2.77 / 3.43 / 4.50 | 59% | 0% | 48% | 0% |
| coliseum | 208 | 1.15 | 1.77 | 1.06 | 60 | 2.56 | 3.72 / 5.24 / 7.22 | 100% | 37% | 100% | 37% |

Per surface (plain ground, all four configurations):

| zone / surface | cells | EDGE p10 median | best | core median | BODY median |
|---|---:|---:|---:|---:|---:|
| fire / Basalt | 208 | 1.09 | 1.36 | 1.17 | 1.24 |
| fire / Ember | 208 | 1.12 | 1.40 | 1.16 | 1.25 |
| fire / Lava | 208 | 1.44 | 2.09 | 2.01 | 3.77 |
| sentenced / Flagstone | 208 | 1.07 | 1.21 | 1.12 | 1.19 |
| plague / Bog | 208 | 1.41 | 1.79 | 2.31 | 4.38 |
| plague / Mud | 208 | 1.24 | 1.78 | 1.66 | 2.75 |
| frost / Ice | 208 | 1.11 | 1.43 | 2.23 | 4.08 |
| frost / Snow | 208 | 1.12 | 1.49 | 2.83 | 6.17 |
| holy / HolyLight | 208 | 1.11 | 1.31 | 1.96 | 3.29 |
| holy / Sand | 208 | 1.16 | 1.48 | 2.04 | 3.73 |
| coliseum / Limestone | 208 | 1.15 | 1.77 | 2.56 | 5.24 |

Props (a look in front of or beside the zone's two most common tall props and two most common low props, taken in turns; EDGE p10 median / worst, tall and low separately):

| zone | tall props cells | tall median / worst | low props cells | low median / worst | plain-ground median |
|---|---:|---|---:|---|---:|
| fire | 52 | 1.12 / 1.02 | 52 | 1.08 / 1.01 | 1.16 |
| sentenced | 28 | 1.09 / 1.01 | 76 | 1.07 / 1.01 | 1.07 |
| plague | 44 | 1.14 / 1.01 | 60 | 1.25 / 1.03 | 1.34 |
| frost | 44 | 1.15 / 1.02 | 60 | 1.13 / 1.04 | 1.12 |
| holy | 32 | 1.24 / 1.07 | 72 | 1.15 / 1.03 | 1.12 |

Worst cells (EDGE p10): 1.00 fire Basalt `hero@sentenced` walk facing S (2560x1440/high); 1.00 fire Basalt `hero@sentenced` walk facing S (2560x1440/ultra); 1.01 fire Basalt `goblin` idle facing S (1920x1080/high); 1.01 fire Ember `knight` walk facing S (1920x1080/high); 1.01 fire Basalt `mob-goblin-elite` idle facing S beside fire.rocks (1920x1080/high).
Best cells: 2.09 fire Lava `mob-antlion` idle facing N (1920x1080/high); 1.95 fire Lava `mob-antlion` walk facing N (1920x1080/ultra); 1.94 fire Lava `mob-antlion` idle facing N (1920x1080/ultra).
Mean EDGE p10 per configuration: 1920x1080/high 1.203, 1920x1080/ultra 1.209, 2560x1440/high 1.183, 2560x1440/ultra 1.183.
EDGE p10 median by pose: idle 1.16, walk 1.13.
EDGE p10 median by facing: N 1.14, S 1.14.

Run-to-run stability (the full run done twice on the same build and machine): 0 of 2808 cells changed pass/fail. Mean absolute difference in EDGE p10 0.029 (p95 0.12, max 0.42), in EDGE min 0.029 (max 0.44), in BODY 0.11 (max 1.86). Cells that froze on the same animation frame differ by 0.018 on average (1546 cells), cells that froze on a different idle or walk frame by 0.044 (1262 cells). The idle frame is whichever the presenter shows when the lab freezes (it follows wall-clock time); `clip` and `frame` in `contrast.json` name it.


What the numbers say:

* **Dark ground cannot be passed with a dark outline.** Fire basalt and ember (ring luminance about 0.05 around the actors) and Sentenced flagstone cap even a black outline at about (0.05 + 0.05) / 0.05 = 2. The light rim has to carry the gate there, and today it reads at the
  ground's own luminance: EDGE p10 1.0 to 1.4 and BODY median 1.2 in Fire basalt, Fire ember and Sentenced. Lava and bog fare best (EDGE p10 median 1.44 and 1.41; BODY 3.8 and 4.4, so the sprite is clearly darker than that ground).
* **Pale ground has the opposite problem.** On Frost snow, Coliseum limestone and Holy sand the dark outline does separate the sprite (core p10 median 2.8, 2.6 and 2.0; 132 of 520 Frost, 60 of 208 Coliseum and 16 of 520 Holy cells pass on the core alone), but the light rim is still
  drawn at half alpha or more and covers it with a pale halo, so the gated EDGE is about 1.1. Lowering the rim alpha on pale ground (from the lit ground luminance, not the palette estimate in `AtmosphereShadows.RimAlpha`) is the lever with the largest immediate effect.
* **BODY** (reported, not gated) is a tuning target only where the sprite is darker than the ground. Medians: snow 6.2, limestone 5.2, bog 4.4, ice 4.1, lava 3.8, sand 3.7, holy light 3.3, mud 2.8, basalt and ember 1.2, flagstone 1.2 (dark sprite on dark ground).
* **Markers.** The faction footprint at the feet is the weakest (0% in Fire and Holy, 1% Sentenced, 13% Plague, 23% Frost, 37% Coliseum). The hp bar passes in all of Coliseum and 98% of Frost but only 7% of Fire and none of Sentenced (dark plate on dark ground); Plague 68%, Holy 59%. The insignia follows the hp bar.
* **Props** (tall: trees, spires, columns, pillars; low: grass, tombs, rocks, drifts): never better than bare ground, EDGE p10 medians 1.07 to 1.25, worst 1.01 to 1.07. Props do not camouflage characters any more than the ground already does.
* **Pose, facing, size and quality** do not change the picture: idle 1.16 against walk 1.13, south and north both 1.14, and the four size/quality configurations within 0.03 of each other (mean EDGE p10 1.18 to 1.21).
* **Stability.** A threshold decision should keep a margin of about 0.15 over 3.0 for ambient noise and 0.5 for animation-frame luck (animated lava and bog, and the idle or walk frame the freeze happens to land on, are the noisy cases; Sentenced, Holy and Frost move by about 0.01 to 0.02).

## Branch `rework/contrast`: the adaptive neutral outline

The baseline above is the state before this branch. What changed in the game (owner direction 2026-11-10; faction-coloured outlines are not approved and are not used):

* **One neutral stroke per figure and per gated marker.** `SpriteOutline` adds a child quad under the sprite it outlines (the body, the weapon cue, the hp track, the faction footprint, the insignia backplate). `Resources/Shaders/RhActorOutline.shader` rebuilds the source silhouette from the source sprite's own atlas rectangle (the catalog's frames are trimmed to their opaque pixels, so the quad is padded) and dilates it by a **world-space width**: 0.05 units for a figure (3 px at 1080p, 4 px at 1440p: the same share of the figure), 0.04 for markers. It is unlit, opaque, never emissive and takes its alpha only from the vertex colour, so the vision fade (which multiplies every `SpriteRenderer` under the actor root), the dead state (0.6) and Swarm's hidden state (the body's alpha) act on it unchanged. The old dark rim and the half-transparent pale halo (`Character light rim`, `AtmosphereShadows.ApplyRim`) are removed.
* **The colour is a hard choice per pixel, near black or near white, from the ground just outside the stroke.** The shader finds the outward direction of the silhouette at the pixel, reads nine to fifteen taps of the ground 6 to 14 px beyond it (median, dark-biased on veined ground) from `_CameraSortingLayerTexture`, scales by the current post exposure, and picks the light stroke below 0.26 and the dark stroke above it, with a 0.06 dead zone inside which one polarity per figure (a wide mean around its centre) decides, so a stroke never speckles. Nominal on-screen luminances: dark 0.004, light 0.86 (shader HDR 1.5; the neutral tonemapper compresses it). On a ground of luminance L the nominal choice gives at least sqrt((0.86 + 0.05) / (0.004 + 0.05)) = 4.1:1; in glowing zones bloom lifts the dark stroke to 0.05 to 0.07, which is why the flip sits at 0.26 and not at the nominal crossover 0.17 (`ActorOutlineModel`, tested).
* **Where the ground comes from.** `Assets/Settings/Roguehalla2DRenderer.asset` turns on the 2D renderer's Camera Sorting Layer Texture (full resolution), bound to a new sorting layer **World** (`ProjectSettings/TagManager.asset`, uniqueID 1000, sorted before Default). `WorldLayer.Tag` (called from `ArenaView.ApplyQuality` and once a second from `ArenaView.Present`) puts every renderer that sorts below order 1800 (the ground quad, surface prints and ripples, ambient dust and the behind-actor particles, ground-level Wish effects) onto it; text and anything under an actor root never joins. Drawing order is unchanged (those renderers already sorted first), props, walls and actors keep their y interleaving in Default, so the grab holds the lit ground, its shadows and its glow, and no prop or actor. Authored torch prefabs listed only the Default layer, so `ShowcasePointLight` lights every layer. There is one grab per frame, and nothing else reads it. `?fx.outlinegrab=0` (measurement only) switches the grab off and uses the CPU estimate (`AtmosphereShadows.GroundLumaLinear`) as the polarity, `?fx.outline=0` turns every stroke off; no quality preset touches either.
* **A calming halo** (`HaloRadius` 0.16 units, about 10 px, strength 0.7): around a figure whose stroke is light (dark and mid ground), a soft black veil of the ground takes the edge off bright veins and glints (Fire ember cracks, Plague glow dots) that would sit next to a light stroke. It darkens only, never on pale ground, and is not part of the silhouette mask.
* **The overhead cluster clears the real head.** `HeadTop` (tallest idle or walk frame of the look) lifts the hp bar, plates and indicators so a bar never cuts a figure's contour (the catalog's `WorldHeight` under-states some looks).

### What the lab gained

`edge` pages (a figure straddling every straight run of a surface change that exists in a zone, in both orientations: lava edge, ember edge, ice edge, temple threshold and sand/holy light, mud, grass and bog), `seam` pages (a figure on each border of two zone blocks, where their light and ground blend), the conditions `?cond=fog` (fog of war on, every figure in its own clearing), `?cond=fade` (frozen half way through the vision fade-in) and `?cond=flash` (a confirmed hit: flash, damage number, Hit clip, refreshed until the freeze), `--only Ember:1,Bog` (visit only those surfaces or page kinds), the columns `ringLum` and `contourLum` (median luminance of the ring and of the contour), the sector medians in the debug view, and the tuning switches `ol.cross`, `ol.dead`, `ol.light`, `ol.dark`, `ol.halo`, `ol.gain`, `ol.r`, `ol.down`, `ol.flip`, `ol.debug` (1 polarity, 2 ground luminance, 4 the grab seen through the quad). The strict EDGE statistic is untouched.

### Result on the merged tree (2026-11-10)

Full matrix (1920x1080 and 2560x1440, High and Ultra): **EDGE 3,339 / 3,724 cells, plain ground 2,384 / 2,472, markers 3,204 / 3,724; the gate exits 1.** Baseline: 0 / 2,808. Failures are Fire ember (68 plain cells), Plague bog and shallow water (19), one Holy sand cell, figures behind props, and surface boundaries and seams.
Tables, before and after worst-cell sheets, the ghost-figure filmstrips, the conditions (fog, fade, hit flash), the measured cost and what each remaining lever would cost: [evidence/contrast/README.md](evidence/contrast/README.md).
