# Character contrast gate

Owner direction 2026-11-10: "there MUST be an objective 3:1 contrast ratio" between characters and the ground in the final visual pass
([UNITY_REWORK_FABLE.md](../prompts/UNITY_REWORK_FABLE.md) section 4, "Character contrast is a hard gate"). This page defines the measurement,
says how to run it and how to read it, lists what it does not cover, and records the baseline. The lab measures; it never tunes art.

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

The silhouette is what the real presenter draws at 50% coverage or more: sprite, neutral dark outline (`Character contrast rim`), faction mantle, held weapon cue and the
light rim (`Character light rim`) wherever its alpha is at least one half. The ring is every pixel 3 to 12 px outside it that no actor mask covers (neighbours, hp bars and badges
are never ground). Contact shadows and faction footprints are drawn in the normal frame and so are part of what the contour and ring look like; the shadow is not part of the silhouette
mask. The light rim is its own mask class, so the tool can also measure the core (everything but the rim) and report how much of the silhouette is rim (`rimShare`).

Sensitivity worth knowing: the rim counts as silhouette only at alpha >= 0.5. On pale ground the presenter keeps the rim at a middling alpha (`AtmosphereShadows.RimAlpha` estimates the
ground from the palette base, not from the lit ground), so the rim is drawn as a pale halo with about the ground's own luminance, and the outermost 2 px of the silhouette are then ground-coloured
while the dark outline sits a few pixels inside. The gate reads that as no edge, which is the owner's definition ("as drawn"), and EDGE core shows the outline the rim hides.

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
  booleans are 0/1). `edgeP10`, `edgeMin`, `edgeMedian`, `edgeGroundP10`, `body`, `bodyGround`, `hp`, `foot`, `insignia` are WCAG ratios; `clip` and `frame` are the animation
  frame that was frozen; `purity` is the share of the surrounding floor tiles carrying the same surface; `prop` and `propMode` (`front` or `beside`) mark props cells.
* `CONTRAST.md`: pass counts per config and zone; per zone a table (rows = look, columns = surface) whose cell is `EDGE p10 / EDGE min / BODY`, worst case over pose, facing, size
  and quality, with a cross where EDGE p10 fails anywhere; props, marker and BODY-distribution tables; plan notes; browser console errors.
* `worst.jpg`: the 24 lowest-EDGE cells. Left of each tile: the cell as rendered. Right: the measurement itself, contour sectors red (below the gate) or green, the ground ring blue.
  Use it to check that the tool measured what you think it measured.

## What is and is not covered

Covered: the grid above on plain ground, and the same looks standing in front of and beside the zone's most common props (an idle, south-facing look per prop instance; props density
is high, so neighbouring props are part of the picture, and cells are only kept apart from each other).

Not covered (say so when quoting a pass):

* Combat effects, Wish effects, telegraphs, hit flashes, damage numbers, status icons and signature icons: none are drawn in the lab. Their 4.5:1 requirement needs its own cells.
* Fog of war over actors, fade in and fade out, and anything that dims or hides an actor (none exists in the lab, none is simulated).
* The local player's own presentation (mint hp bar, larger footprint, accent light): every lab actor is a remote. Faction colours are covered through `hero`, `hero@sentenced`, `mage`,
  `hero-female`, `mage-female` and the mob looks.
* Name and level text: the presenter draws none today. If a label is added it needs a marker class in `ContrastLabStage.ClassOf` and the mask shader.
* Dead actors, barrier rings, held-weapon variety beyond sword, wand and bow, other animation frames than the one frozen (idle frames vary between runs; see the baseline), 8-way facings beyond the two measured.
* Zone borders (a view straddling two zones blends their lighting; the lab keeps the whole view inside one zone), the live match camera offset, and anything driven by real vision or network state.
* HUD, minimap, Tab map and overlays: all hidden. The lab measures the world layer only.
* Ambient motion is averaged, not frozen: dust, snow and haze in front of an actor are in the numbers but their position differs per frame.

## Files and hooks

* `Assets/Scripts/ContrastLab/ContrastLabPlan.cs` (map, looks, planner), `ContrastLabStage.cs` (stage, render modes, hook), `Assets/Resources/ContrastLab/RhContrastMask.shader`,
  `Assets/Plugins/WebGL/RhContrastLab.jslib`, `Assets/Tests/Editor/ContrastLabEditModeTests.cs`.
* One hook in an existing file: `Assets/Scripts/Bootstrap.cs`, a six-line branch before the `preview` branch that builds the stage only when `?contrastlab=1`.
* `Tools/contrast-gate.cjs`, `Tools/contrast-lib.cjs`, `Tools/contrast-lib.test.cjs`.

## Baseline

Measured on the branch `rework/contrast-lab` (code of `d6f18dce` plus the lab), 2026-11-10, Chromium (Playwright) headed on `ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro)`,
ortho size 9, 2808 cells (702 per size/quality: 13 looks x 2 poses x 2 facings x every surface of every zone, plus 26 prop cells per zone that has props), 4 normal frames and 3 ground frames
averaged per page. No browser console errors. Evidence (small, committed): [`evidence/contrast-lab/`](evidence/contrast-lab/) holds `contrast.json` (every cell of the
first run), `CONTRAST.md` (all tables) and `worst.jpg`. Raw captures stay outside the repository.

**Result: FAIL.** No cell reaches EDGE p10 >= 3.0 in any zone, size or quality (0 / 2808); the best cell is 2.42 (Fire lava, mob-antlion, walking north) and the median is about 1.1. Markers: 270 of 2808
cells have all three markers at 4.5 or better (all of them in Plague, Frost and Coliseum; none in Fire, Sentenced or Holy).

**EDGE (gated: p10 of 16 contour sectors >= 3.0), by zone and configuration.** Cells are every look x pose x facing on every surface of the zone, plus the props cells; "pass" counts EDGE p10 >= 3.0.

| configuration | fire | sentenced | plague | frost | holy | coliseum |
|---|---:|---:|---:|---:|---:|---:|
| 1920x1080/high | 0 / 182 | 0 / 78 | 0 / 130 | 0 / 130 | 0 / 130 | 0 / 52 |
| 1920x1080/ultra | 0 / 182 | 0 / 78 | 0 / 130 | 0 / 130 | 0 / 130 | 0 / 52 |
| 2560x1440/high | 0 / 182 | 0 / 78 | 0 / 130 | 0 / 130 | 0 / 130 | 0 / 52 |
| 2560x1440/ultra | 0 / 182 | 0 / 78 | 0 / 130 | 0 / 130 | 0 / 130 | 0 / 52 |

| zone | EDGE p10 median | best | worst | core p10 >= 3 | core median | BODY p10 / median / p90 (plain ground) | hp bar >= 4.5 | footprint >= 4.5 | insignia >= 4.5 | all three |
|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| fire | 1.14 | 2.42 | 1.00 | 10 / 728 | 1.21 | 1.06 / 1.37 / 4.14 | 8% | 0% | 0% | 0% |
| sentenced | 1.08 | 1.23 | 1.00 | 0 / 312 | 1.11 | 1.03 / 1.19 / 1.67 | 0% | 2% | 0% | 0% |
| plague | 1.31 | 1.81 | 1.01 | 48 / 520 | 1.73 | 2.09 / 3.29 / 5.11 | 68% | 13% | 57% | 12% |
| frost | 1.12 | 1.60 | 1.04 | 151 / 520 | 2.66 | 3.09 / 4.85 / 7.89 | 99% | 25% | 98% | 25% |
| holy | 1.12 | 1.53 | 1.01 | 13 / 520 | 1.94 | 2.80 / 3.43 / 4.56 | 60% | 0% | 48% | 0% |
| coliseum | 1.15 | 1.90 | 1.06 | 56 / 208 | 2.54 | 3.74 / 5.22 / 7.23 | 100% | 36% | 100% | 36% |

Per surface (plain ground, all four configurations): EDGE p10 median / best, core p10 median, BODY median.

| zone / surface | cells | EDGE p10 median | best | core median | BODY median |
|---|---:|---:|---:|---:|---:|
| fire / Basalt | 208 | 1.09 | 1.36 | 1.17 | 1.24 |
| fire / Ember | 208 | 1.13 | 1.40 | 1.16 | 1.25 |
| fire / Lava | 208 | 1.46 | 2.42 | 2.01 | 3.84 |
| sentenced / Flagstone | 208 | 1.07 | 1.22 | 1.11 | 1.19 |
| plague / Bog | 208 | 1.41 | 1.81 | 2.37 | 4.32 |
| plague / Mud | 208 | 1.23 | 1.78 | 1.65 | 2.77 |
| frost / Ice | 208 | 1.11 | 1.40 | 2.22 | 4.14 |
| frost / Snow | 208 | 1.12 | 1.48 | 2.88 | 6.12 |
| holy / HolyLight | 208 | 1.11 | 1.32 | 1.96 | 3.29 |
| holy / Sand | 208 | 1.15 | 1.53 | 2.03 | 3.65 |
| coliseum / Limestone | 208 | 1.15 | 1.90 | 2.54 | 5.22 |

Worst cells (EDGE p10 and min both about 1.0): Sentenced flagstone beside a dead-grass tuft with `mob-goblin-elite` (1.00), Fire basalt with `hero@sentenced` walking (1.00), `goblin` idle (1.01),
`knight` walking north (1.01), Plague mud with `mob-goblin-elite` in front of a fern (1.01). Best cells: Fire lava with `mob-antlion` (2.42, 2.22, 2.16), Coliseum limestone with `hero` facing north (1.90).
Size and quality make no measurable difference to EDGE: mean EDGE p10 is 1.206 (1920x1080 High), 1.208 (Ultra), 1.185 (2560x1440 High), 1.187 (Ultra).

What the numbers say:

* **Dark ground cannot be passed with a dark outline.** Fire (basalt and ember about 0.03 to 0.06 relative luminance) and Sentenced (flagstone) cap a black outline at about (0.05 + 0.05) / 0.05 = 2; the light rim has to
  carry the gate, and today it reads at the ground's luminance (EDGE p10 1.0 to 1.3, BODY median 1.2 to 1.4 in Fire and Sentenced). Lava and bog light up the ring around the actor, so those patches fare best.
* **Pale ground has the opposite problem.** On Frost snow, Coliseum limestone and Holy sand the dark outline does separate the sprite (core p10 median 2.9, 2.5 and 2.0; 151 of 520 Frost, 56 of 208 Coliseum and 13 of 520 Holy cells pass on the core alone), but the light rim
  is still drawn at half alpha or more and covers it with a pale halo, so the gated EDGE is about 1.1. Lowering the rim alpha on pale ground (from the lit ground luminance, not the palette) is the lever with the largest immediate effect.
* **BODY** (reported, not gated) is a tuning target only where the sprite is darker than the ground: median 5.2 on limestone and 4.9 on snow, 3.4 on sand, 3.3 on Plague, 1.4 on Fire basalt and 1.2 on Sentenced flagstone (dark sprite on dark ground).
* **Markers.** The faction footprint at the feet is the weakest marker (0% in Fire and Holy, 2% Sentenced, 13% Plague, 25% Frost, 36% Coliseum). The hp bar passes in 100% of Coliseum and 99% of Frost cells but 0% to 8% in Fire and Sentenced (dark plate on dark ground). Plague and Holy sit between.
* **Props** (26 cells per zone with props, in front of or beside the two or more most common prop arts): no better than plain ground (EDGE p10 median 1.1 to 1.2, worst 1.01); nothing is camouflaged more than the bare ground already is.
* Pose and facing do not change the picture (idle median 1.15, walk 1.13; south 1.14, north 1.14).

Run-to-run stability (the full run done twice on the same build, same machine): the pass/fail outcome of every cell was identical (0 flips). Mean absolute difference in EDGE p10 0.027 (p95 0.12, max 0.57), in EDGE min 0.025 (max 0.45),
in BODY 0.10 (max 2.3). Cells that landed on the same animation frame differ by 0.017 on average, cells that landed on a different idle or walk frame by 0.042. The largest swings are animated surfaces (Fire lava, Plague bog) and
one frame-dependent sprite pose; Sentenced and Holy move by about 0.01. The idle frame is whichever the presenter shows when the lab freezes (it follows wall-clock time); `clip` and `frame` in `contrast.json` say which. A threshold decision should
keep a margin of about 0.15 over 3.0 for ambient noise and 0.6 for animation-frame luck.

