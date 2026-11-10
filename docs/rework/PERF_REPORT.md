# Performance report: Unity Web client at 144 fps (branch `rework/perf2`)

Target (owner): 144 fps (6.94 ms) at 2560x1440 on the top row (Ultra) in a full match; keep every effect, find waste first, cut
only as a last resort and show the technical limit. Base commit `23a000d7`. Phase/item: render and client performance under
docs/ORDER_OF_OPERATIONS.md (Unity presentation; no game rules touched, no wire change, `packages/` untouched).

## 0. Headline

Re-measured on the merged tree (backend `a2d1022ebe713382`, real quests, finished bots) with the two new fixes of section 4a built in.
Ultra, 2560x1440 fullscreen on the RZ39 2560x1440 @ 144 Hz panel (the browser window was on that display), vsync on, Playwright Chromium
156.0.8078.4, `rh-server` with 7 bots.

* **Does Ultra at 2560x1440 hold 144 Hz? Yes, in every scenario measured: 0.00% dropped frames** (a frame over 10.4 ms) in all 18 windows
  (six zones including the coliseum, standing, walking and fighting, Tab map), p50 6.90 ms (the vsync cadence), **1% low 115 to 120 fps**.
  The previous run of this report had 0 to 1.1% dropped (median 0.05%) and 1% low 92 to 130 fps; the new windows are single 4 to 6 s
  windows per row, so a rare hitch (a long GC, a net burst) would not necessarily be inside one. Before this branch the same Holy fight
  dropped 6.5 to 8.7% of its frames.
* **The machine was busy, so these are not clean numbers:** load average 3 to 12 on 18 cores during the vsync-on run (11 to 12 in the Fire
  session), other agents' browsers kept the GPU 50 to 84% busy before every window, and the vsync-off run had load 23 to 39. Pass or
  fail at 144 Hz holds under that load, which is the harder condition; the milliseconds are upper bounds.
* **Headroom (vsync off, merged tree, load 23 to 39):** frame p50 3.4 to 3.9 ms (Fire), 5.0 to 5.8 ms (Holy), 6.2 to 6.7 ms (Frost, 46 actors
  fighting). Main thread: scripts 0.8 to 2.4 ms, render submission 2.5 to 4.8 ms. Frost and Holy are still the heaviest zones; GPU
  timer 2.4 to 3.3 ms in this run, but see the load note: the earlier quiet-ish runs had Frost at 5.0 to 5.3 ms GPU.
* **Two new fixes (section 4a):** damage numbers no longer rebuild their TextMeshPro mesh every frame (**TMP rebuilds 1,294 to 2,003 per
  second with the old fade against 28 to 69 per second with the new one** in fights, same build, same scene, interleaved windows; one
  unexplained Frost walk window read 2,062 on the new path); local lights
  are sorted and the ones that cannot reach the picture are not uploaded (0 to 6.3 of 20 per frame dropped; the saving is small in these
  spots, not measurable in milliseconds under this load).
* **A real defect found and fixed while verifying the adaptive quality (section 7):** at 144 Hz the controller could never step back up
  (its refresh estimate sat 14% under the true cadence on timestamp jitter). Fixed with a unit test that fails without the fix.
* **Biggest wins of the branch (unchanged, all keep every effect):** WebGL code optimization was "Shorter build time" in the cloned
  Library: Runtime Speed halves the scripts (1.6 to 2.4 ms -> 0.75 to 1.3 ms); the soundscape called `Resources.Load` every frame (0.6 to
  0.8 ms -> 0.02 ms); every creature was presented twice per frame; the hidden launch menu rebuilt its strings every frame; total garbage 9
  to 14 KB/frame -> 3.7 to 6.5 KB/frame.
* **Not measurable here:** an idle GPU, Safari and Firefox (the browser versions in section 10 come from vendor documentation, not from a
  run), a clean vsync-off number on a quiet machine.

## 1. Method, and why it holds up on a shared machine

The machine was never quiet: load average 6 to 50 on 18 cores, other Unity builds, and Playwright Chromium instances that are not
ours (`ioreg` IOAccelerator "Device Utilization" **55 to 65% with no page of ours open**). The same Holy spot measured 4.4 then 8.6 ms
of GPU in consecutive 3 s windows. So:

* **Real build, real match.** WebGL player built by `Tools/build-web.sh`; every variant copied aside and all served side by side by
  one `python3 -m http.server 8107`; `rh-server` on 7807 with 7 bots; headed Chromium (Metal ANGLE), 2560x1440 fullscreen on the
  **RZ39 2560x1440 @ 144 Hz panel (main display)**. The 1920x1080 runs are a 1920x1080 window on the same 144 Hz panel; the
  1920x1080 @ 100 Hz panel (E2212F) was not used.
* **Interleaving.** `Tools/perf-matrix.cjs` runs one session per build in alternating order (A B C, then C B A) and compares builds
  only against each other inside one run. Load average and system GPU busy % are stored per window.
* **Counts beside times (load independent):** draw calls, SetPass calls, batches, triangles (`ProfilerRecorder`, valid in release
  players); WebGL calls per frame by kind and uniform floats uploaded (wrapped context); managed bytes allocated per frame **per
  section** (`GC.GetTotalMemory` deltas; WebGL never collects mid-frame); GC count; TMP text rebuilds per second
  (`TMPro_EventManager.TEXT_CHANGED_EVENT`); uGUI rebuild queue lengths; a scene census (particle systems playing and off screen,
  Light2D, renderers enabled / visible / in frustum / enabled off screen, canvases, raycast targets, texture memory).
* **CPU attribution in the player.** `PerfRecorder` brackets the PlayerLoop (`preUpdate`, `scripts` = Update + LateUpdate, `render`
  = PostLateUpdate including canvases and the URP render, `uiRebuild`), `PerfMarks` brackets owned systems (net poll, HUD and its
  parts, camera + atmosphere, present, actors, collections, surface fx, vision, props, effects, wish fx, soundscape, fx cues). A
  build with embedded symbols (`RH_WEB_DEBUG_SYMBOLS=embedded`, never shipped) gave V8 sampling profiles of the main thread.
* **GPU.** One `EXT_disjoint_timer_query_webgl2` query per frame, vsync off only (with vsync on the query also spans the drawable
  wait). Per-pass queries were tried and rejected: on ANGLE/Metal each query adds about 0.55 ms by itself, so passes are counted
  (`Tools/webgl-pass-capture.js`: target size, draws, program switches), not timed.
* **Browser process.** CPU seconds of our Chromium's GPU process and renderer per window (`ps`): the GPU process (command decoding,
  ANGLE to Metal) runs 1.0 to 1.7 cores at uncapped frame rates.
* **In-match toggles.** `PerfRecorder.SetFlags` switches an effect between interleaved windows (baseline, effect off, baseline);
  `fx.scale=0.5` (a quarter of the pixels) separates pixel cost from the rest.
* Every percentage of frames "over 6.94 ms" with vsync on is about 45% by construction: rAF timestamps jitter around the 6.94 ms
  cadence, so half of the deltas land just above it. **The vsync-on criterion is the dropped-frame share** (delta > 1.5 x 6.94 ms).

Reproduce: `node Tools/perf-matrix.cjs --builds a=URL,b=URL --quality ultra --zones holy,sentenced --windows stand:5,walk:6,map:4
--rounds 2 --gl --vsync off|on [--cpuprofile 8] [--passes] [--res 1920x1080] [--launch]`; in-match toggles as
`--windows "stand:3,stand[fx.cookies=0]:3,stand:3"`. Evidence (JSON, small): `docs/rework/evidence/perf2/`.

## 2. Frame budget per scenario

"Scenario" is the zone the session was sent to; the player walks there with the keyboard after spawning, "region seen" is where it
actually was (the walk is steered by keyboard toward the zone centroid and sometimes ends against a wall or away from the zone; it is
now allowed 120 s instead of 75 s and records a trace, and in this tree's runs Fire and Frost were reached). "map" is the Tab map held open. Each row is one window of 4 to 8 s (medians when there are several).

**Merged tree (backend `a2d1022ebe713382`, real quests, finished bots), Ultra, 2560x1440 fullscreen on the RZ39 2560x1440 @ 144 Hz panel
(main display; the browser window was on it, the 1920x1080 @ 100 Hz E2212F was not used), vsync ON, `?perf=1`, one 4 to 6 s window per row.**
"dropped" is a frame longer than 1.5 refresh intervals (10.4 ms). The p50 of 6.90 ms is the vsync cadence itself. Rows with "region
seen" different from the zone are windows where the scripted walk had left the zone (the walk to a zone depends on the spawn point and
can end against a wall: trace in `merged-vsync-on-ultra.summary.json` and the run notes). Evidence: `merged-vsync-on-ultra.summary.json`.

| zone (spawned for) | window | region seen | actors | p50 ms | dropped >10.4 ms | 1% low fps | scripts ms | render ms | TMP rebuilds/s | garbage B/frame | load avg | GPU busy by others % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fire | stand | fire | 20 | 6.90 | 0.00% | 115 | 0.86 | 1.83 | 19 | 4851 | 11.5 | 60 |
| fire | walk | fire | 28 | 6.90 | 0.00% | 115 | 0.92 | 1.85 | 44 | 7550 | 12.0 | 59 |
| fire | map | fire | 28 | 6.90 | 0.00% | 115 | 0.83 | 1.69 | 13 | 8227 | 11.2 | 59 |
| sentenced | stand | sentenced | 55 | 6.90 | 0.00% | 115 | 1.21 | 1.48 | 21 | 13805 | 7.2 | 50 |
| sentenced | walk | holy | 52 | 6.90 | 0.00% | 115 | 1.32 | 1.37 | 115 | 15014 | 6.7 | 51 |
| sentenced | map | sentenced | 46 | 6.90 | 0.00% | 115 | 1.17 | 1.53 | 84 | 16132 | 6.6 | 54 |
| plague | stand | plague | 60 | 6.90 | 0.00% | 119 | 1.29 | 1.34 | 58 | 10844 | 4.6 | 50 |
| plague | walk | plague | 49 | 6.90 | 0.00% | 117 | 1.43 | 1.66 | 124 | 9168 | 4.3 | 51 |
| plague | map | plague | 44 | 6.90 | 0.00% | 118 | 1.16 | 1.71 | 76 | 10450 | 4.2 | 58 |
| frost | stand | frost | 25 | 6.90 | 0.00% | 115 | 0.76 | 1.30 | 17 | 6082 | 3.9 | 67 |
| frost | walk | sentenced | 26 | 6.90 | 0.00% | 115 | 0.81 | 1.42 | 21 | 6357 | 3.7 | 67 |
| frost | map | sentenced | 26 | 6.90 | 0.00% | 120 | 0.83 | 1.65 | 19 | 10310 | 3.6 | 55 |
| holy | stand | holy | 46 | 6.90 | 0.00% | 116 | 1.53 | 2.52 | 108 | 13112 | 3.7 | 81 |
| holy | walk | holy | 46 | 6.90 | 0.00% | 117 | 1.57 | 2.16 | 52 | 29103 | 3.9 | 81 |
| holy | map | holy | 46 | 6.90 | 0.00% | 117 | 1.45 | 2.26 | 45 | 29720 | 3.8 | 84 |
| coliseum | stand | coliseum | 43 | 6.90 | 0.00% | 119 | 1.03 | 1.49 | 34 | 7439 | 3.4 | 52 |
| coliseum | walk | coliseum | 38 | 6.90 | 0.00% | 117 | 0.96 | 1.14 | 52 | 8098 | 3.2 | 50 |
| coliseum | map | coliseum | 38 | 6.90 | 0.00% | 117 | 0.88 | 1.05 | 13 | 8844 | 3.0 | 53 |

**Machine state, not clean:** `uptime` load averages were 3 to 12 during these windows (11 to 12 in the Fire session, 3 to 7 in the
others) on 18 cores, and `ioreg` showed the GPU 50 to 84% busy before each window with other agents' browsers running (Holy 81 to 84%).
The dropped-frame shares are therefore a worst case for a shared machine; the CPU/GPU milliseconds are upper bounds.

**Vsync OFF, same merged tree and build (Fire, Frost, Holy, three sessions; the two runs section 5 listed as missing, Fire at vsync off
and Frost at vsync on, are in the tables above and below).** The `stand[...]` rows are in-match A/B windows of the two fixes in
section 4a (`fx.numberfade=0` fades damage numbers the old way; `fx.lightcull=0` uploads every light); plain `stand` rows around them
are the baselines. **The machine was very busy for this run: load average 23 to 39** (the A/B tables are about counts, which do not
depend on load; the millisecond columns do, and moved by more than the effects measured). Evidence: `merged-vsync-off-ab.summary.json` (and `merged-vsync-off-ab-walk.summary.json`, an earlier run of the same build with walking windows, where the player wandered between zones).

| zone | window | region | actors | p50 ms | scripts ms | render ms | GPU ms | TMP rebuilds/s | lights offered / uploaded | load avg | GPU busy by others % |
|---|---|---|---|---|---|---|---|---|---|---|---|
| fire | stand | fire | 12 | 3.90 | 0.79 | 2.91 | 2.06 | 69.1 | 15.79 / 15.79 | 23 | 46 |
| fire | stand[fx.numberfade=0] | fire | 15 | 4.10 | 0.90 | 3.01 | 2.21 | 1293.9 | 16.01 / 16.01 | 25 | 74 |
| fire | stand | fire | 1 | 3.60 | 0.45 | 2.82 | 1.14 | 185.9 | 13.99 / 13.99 | 29 | 18 |
| fire | stand[fx.lightcull=0] | fire | 1 | 3.60 | 0.44 | 2.70 | 1.04 | 1 | 13.88 / 13.88 | 27 | 40 |
| fire | stand | fire | 1 | 3.40 | 0.48 | 2.59 | 1.42 | 1 | 13.89 / 13.89 | 28 | 21 |
| fire | walk | fire | 1 | 3.30 | 0.53 | 2.49 | 1.74 | 1.4 | 13.89 / 13.89 | 28 | 12 |
| frost | stand | frost | 46 | 6.20 | 2.35 | 3.48 | 2.82 | 35.4 | 20 / 13.7 | 27 | 27 |
| frost | stand[fx.numberfade=0] | frost | 38 | 5.90 | 2.29 | 3.47 | 3.50 | 1411.9 | 20 / 17.59 | 28 | 44 |
| frost | stand | frost | 34 | 6.60 | 2.05 | 4.28 | 2.48 | 39.3 | 20 / 19.77 | 30 | 34 |
| frost | stand[fx.lightcull=0] | frost | 24 | 6.70 | 1.52 | 4.75 | 2.39 | 80.5 | 20 / 20 | 31 | 22 |
| frost | stand | frost | 17 | 6.40 | 1.38 | 4.64 | 2.45 | 55.2 | 20 / 20 | 31 | 38 |
| frost | walk | frost | 22 | 6.70 | 2.14 | 4.63 | 2.51 | 2061.9 | 20 / 20 | 33 | 35 |
| holy | stand | holy | 18 | 5.80 | 1.32 | 4.17 | 3.28 | 12.2 | 19 / 19 | 29 | 50 |
| holy | stand[fx.numberfade=0] | holy | 18 | 5.50 | 1.38 | 3.90 | 3.21 | 12.2 | 20 / 20 | 29 | 43 |
| holy | stand | holy | 18 | 5.00 | 1.33 | 3.58 | 2.89 | 12 | 20 / 20 | 32 | 29 |
| holy | stand[fx.lightcull=0] | holy | 18 | 5.70 | 1.46 | 3.97 | 4.04 | 11.9 | 20 / 20 | 39 | 19 |
| holy | stand | holy | 18 | 5.50 | 1.45 | 3.86 | 3.24 | 11.9 | 20 / 20 | 39 | 24 |
| holy | walk | sentenced | 26 | 5.30 | 1.53 | 3.63 | 2.52 | 32.9 | 19.56 / 17.93 | 38 | 28 |

Reading the vsync-off medians (frame p50 3.4 to 3.9 ms Fire, 5.0 to 5.8 ms Holy, 6.2 to 6.7 ms Frost under load 23 to 39) as headroom:
Frost in this run had 46 actors in a fight and the CPU side (scripts 1.4 to 2.4 ms + render 3.5 to 4.8 ms) was the larger part of the
frame, the GPU timer read 2.4 to 2.8 ms, so with the machine this busy the CPU/GPU split of the earlier quiet runs (Frost GPU bound,
5.0 to 5.3 ms GPU) was not reproduced. No clean vsync-off number can be given for this tree.

## 3. Where the time goes (attribution)

Main thread, Ultra, 2560x1440, Sentenced fight with 26 actors, V8 profile with symbols (8 s, vsync off, about 300 fps):

| part | share of main thread | notes |
|---|---|---|
| URP render (PostLateUpdate) | 52% | draw submission 34% (`ScriptableRenderContext.Submit`: batching, uniforms, buffer uploads), culling 5%, RenderGraph record/compile/execute (C#) 7% |
| scripts (Update) | 23% | `MatchClient.Update` 21%, of which presenting the actors 17% (actor presenter and overhead indicators about two thirds of it) |
| canvases | 7% | `PlayerUpdateCanvases` 3.8%, will-render 3.2%: the HUD moves RectTransforms every frame |
| LateUpdate | 3% | HUD, soundscape |
| WebGL JS glue | 2.5% self | `bufferSubData`, `uniform4fv`, `bindBuffer`, `bindTexture`; in the Holy profile `glUniform4fv` grew to 21% inclusive: GPU-process back-pressure, see below |

Per system, `?perf=1` sections, Ultra, final build (ms per frame, median of windows; vsync off):

| system | planning | fight, 20 to 25 actors | fight, 40+ actors |
|---|---|---|---|
| scripts total | 0.40 to 0.65 | 1.0 to 1.6 | 2.0 to 2.9 |
| actors (presenter + overheads, NOT editable here) | 0.06 | 0.54 to 0.87 | 1.0 to 2.4 (about 0.04 ms per actor) |
| rest of present (fog, props, effects, wish fx, collections) | 0.07 | 0.15 to 0.25 | 0.2 to 0.3 |
| HUD | 0.08 | 0.08 to 0.11 | 0.1 |
| camera + atmosphere (light field, particles) | 0.04 | 0.06 to 0.09 | 0.09 |
| soundscape + region audio | 0.005 | 0.02 to 0.04 | 0.04 |
| net poll | 0.01 | 0.01 to 0.12 | 0.12 |
| UI rebuild (canvas) | 0.02 | 0.03 to 0.06 | 0.06 |
| render (submission, waits on the GPU process when it falls behind) | 3.3 to 3.8 | 2.5 to 4.5 | 3.0 to 6.9 |
| GPU (frame timer, other tenants included) | 1.4 to 2.6 | 2.0 to 3.7 | 3.4 to 5.5 (Frost, Holy up to 8.6) |

Counts (final build, Ultra, 2560x1440): 170 to 270 draw calls, 128 to 176 SetPass calls, 3.8k to 4.5k triangles; 26 render passes
per frame (1024x32 grading LUT, four 1280x720 light textures, the World-layer pass, a **full-resolution copy for the camera sorting
layer texture**, the main pass with 105 draws and 71 program switches, 16 bloom passes 1280x720 down to 40x22 and back, the uber
post + overlay UI pass with 45 draws, the final blit). 350 to 380 `uniform4fv` calls per frame carrying 13.4k floats: 72 of them are the
24-light arrays (`_RhLP`, `_RhLC`), 170 to 185 are the 8-entry sun and actor tables of `RhSun.hlsl`, re-uploaded at almost every
program switch. 400 `bufferSubData` per frame (sprite and text geometry). Scene census: 2,900 to 3,400 renderers enabled, only 156 to
276 visible, 2,700 to 3,150 enabled off screen (static decor, walls; Unity culls them, 5% of the main thread); 6 to 10 particle
systems playing, 4 to 6 of them off screen with no particles (no cost); 2 Light2D on (global + one); 3 canvases, 32 to 76 raycast
targets; 134 MB of textures, 111 MB in 22 render textures.

GPU-heavy zones, in-match toggles in Holy (vsync off, interleaved 3 s windows; baseline windows drifted 4.4 to 8.6 ms with other
tenants): local lights off about -1.0 ms, local wall shadows off about -1.1 ms, cookies off -0.4 to -0.9 ms, gloss off about -0.3 ms;
`fx.scale=0.5` (a quarter of the pixels) cut the whole frame to 2.9 ms. Everything that costs in Holy and Frost is **per pixel in the
region shaders** (`RegionGround.shader` and the lit sprite/mesh shaders through `RhLocalLights.hlsl`), plus the full-resolution sorting
layer copy and the HDR post chain. At vsync off the page's main thread also stalls inside GL calls whenever Chrome's GPU process (1.0
to 1.7 cores) falls behind; that is why "render" CPU tracks GPU time in those zones.

## 4. Optimisations (all effects kept; picture unchanged)

| # | change | before | after | how verified |
|---|---|---|---|---|
| 1 | **WebGL code optimization Runtime Speed** (it was "Shorter build time", stored only in the per-machine Library; RhBuild now sets it) | scripts 1.6 to 2.4 ms in fights, 1.2 to 1.3 ms planning | 0.75 to 1.3 ms, 0.43 to 0.45 ms | interleaved A/B, 2 zones x 2 rounds (`ab2`) |
| 2 | **WebAssembly 2023 target** (native wasm exceptions instead of JS `invoke_*` trampolines, SIMD) | wasm 60.9 MB, framework.js 526 KB; planning frame 4.32 / 3.95 ms, scripts 0.45 / 0.43 | 57.0 MB, 361 KB; 4.03 / 4.01 ms, 0.40 / 0.37 | same A/B; the frame gain is small and within noise, the size gain is exact |
| 3 | **Soundscape**: `Resources.Load("Showcase/Catalog")` every frame -> once | 0.73 to 0.86 ms/frame | 0.005 to 0.03 ms | section `soundscape`, every window |
| 4 | **Creatures presented once per frame**: `RefreshVisibility(presentFollows)` leaves creatures, pending cues, effects and fades to the `Present` that follows; pending cues flush right after Present draws their subjects | present 0.45 to 1.17 ms | 0.34 to 0.86 ms at similar actor counts | sections; EditMode test `PresentFollowsDrawsLatestCreatureAndItsQueuedCueOnceInTheSameFrame` |
| 5 | **Hidden launch menu** refreshed at 4 Hz instead of every frame while a match covers it (every frame while visible) | HUD garbage 4.2 to 4.3 KB/frame | 1.0 to 1.4 KB/frame (`hudAccount` 50 B) | allocation per section |
| 6 | **World-layer walk** (every renderer of the arena, once a second, `Transform.name` up the parent chain for each candidate) only when the arena hierarchy changed, at least every 10 s; rejected renderers cached | periodic 1 s hitch (present max 3.1 ms) | no periodic walk; `WorldLayer` tests unchanged | sections (max), EditMode `ActorOutline` tests |
| 7 | `ShowcaseCatalog.Find` indexed (the presenter asks up to four times per actor per frame, linear string scan) | linear scan | dictionary | small; EditMode tests |
| - | total managed garbage | 9.2 to 14.0 KB/frame in fights | 3.7 to 6.5 KB/frame (c2), GC every 3 to 6 s instead of 1 to 2 s | `gcBytesPerFrame`, `gcCollections` |
| - | vsync on, Holy fight | 6.5 to 8.7% dropped | 0.5% dropped (final run) | `vsync1` vs final `ultra-on` |

Picture: none of these touches a shader, a material, a sorting order, a light or a particle setting; the build-setting changes do not
change floating-point results the renderer uses (SIMD in engine code aside), and same-scene screenshots per run are kept in
`docs/rework/evidence/perf2/`. Fix 6 has one theoretical difference: a renderer whose sort order drops below 1800 *after* creation
without any hierarchy change joins the World layer within 10 s instead of 1 s (none was found in the code).

### 4a. Fixes made in the finishing pass (files nobody else owns; no visual change)

| # | change | before | after | how verified |
|---|---|---|---|---|
| 8 | **Local lights culled and sorted** in `LocalLightField.Push`: a light whose reach (shader's own test: x as is, y times the ground squash, against the camera rectangle plus 1.5 tiles) cannot touch the picture is not uploaded; the rest are ordered nearest the camera centre first (insertion sort in place, no allocation). Each light keeps its own colour, cookie and baked shadow slot, so order is free. The shader loop has no early exit by order, so the gain comes from the dropped lights. | all lights offered are uploaded (up to 20 of 24 slots) | Frost 13.7 of 20 uploaded in one window, 17.6 to 20 in others; Holy 19 of 19 to 20 of 20; Fire 0 dropped | exact counts `lightsOfferedPerFrame` / `lightsUploadedPerFrame` (same build, `fx.lightcull=0` switch); EditMode test `PushDropsLightsOutOfReachAndOrdersTheRestNearestFirst`. GPU effect not measurable under load 23 to 39 (Frost 2.4 to 2.8 ms with and without; Holy windows 2.9 to 4.0 ms swung with the load, not with the switch). |
| 9 | **Damage numbers fade through the vertex alpha** of their existing mesh (`UpdateVertexData(Colors32)`), tone set once at spawn; `TMP_Text.color` is no longer touched per frame (it marks the text dirty and regenerates the whole mesh). The SDF shader scales the outline by vertex alpha, so face and outline fade together as before. Only the numbers in `ArenaView`, not the overhead labels. | TMP rebuilds per second, old path (`fx.numberfade=0`): Fire stand 1,294, Frost stand 1,412, Holy walk 2,003 (earlier run `merged-vsync-off-ab-walk.summary.json`; Holy stand 12, where nobody was fighting) | same scenes, new path: Fire 69, Frost 35 to 55, Holy walk 28 to 69, Holy stand 12 (the remainder is overhead labels and real text changes). One outlier: a Frost walk window on the new path read 2,062 per second with 21 KB/frame of garbage; not traced (overhead labels or a burst of new actors, the damage numbers are not rebuilt there) | same build and scene, interleaved windows (`fx.numberfade=0` = old path), counted by `TEXT_CHANGED_EVENT`; garbage per frame 6.8 KB -> 4.2 KB in Fire, Frost 7.8 KB against 6.7 to 8.5 KB (no difference beyond noise); frame time not separable under load |
| 10 | **Adaptive quality can step up at 144 Hz** (`AdaptiveQualityController` refresh floor follows a 16-frame average instead of single-frame minima) | refresh estimate 5.7 to 6.0 ms on a true 6.94 ms cadence, frame ratio 1.14 to 1.15 > the 1.10 up-threshold: no step up in 80 s | estimate 6.90 ms, ratio 1.00, step up works (section 7) | browser run before and after (`adaptive-before-fix.json`, `adaptive-after-fix.json`); unit test `JitteredVsyncCadenceStillStepsUp` fails on the old code, passes on the new |

Tried and not kept: nothing reverted; the per-pass GPU timer was rejected as a method (see section 1).

## 5. What remains and what limits it

1. **Holy and Frost are GPU bound, per pixel** (region shaders: local-light loop with up to 20 lights, cookies, wall shadows,
   ice/water, gloss) at 2560x1440 = 3.7 Mpx, drawn more than once where walls and props overlap the ground. With vsync on they hold
   144 Hz on this machine even with the GPU shared, but they have the least headroom (vsync off: 5.5 to 7.2 ms p50 under load).
   Cheapest remaining levers, cheapest first: (a) assign lights to screen tiles or upload them sorted by distance so the shader loop
   stops after the last light in reach (no visual change); (b) half-resolution camera sorting layer copy (the outline only reads it for
   polarity); (c) one fewer bloom iteration on High only. None is needed for 144 Hz on this machine; (a) and (b) are in files owned by
   the other agent (proposals below).
2. **Actors scale the CPU**: about 0.04 ms per presented actor per frame and 100 to 150 bytes of garbage per actor per frame, in the
   presenter and overhead files (proposals below). With 60 to 80 actors on screen (Sentenced and Holy crowds) scripts reach 2 to 3 ms;
   still inside the budget with vsync on (0% and 0.5% dropped).
3. **TMP rebuilds** reached 220 to 1,040 per second in big fights (Plague walk 1,044/s): fading text through `.color` makes TextMeshPro
   regenerate the whole mesh every frame. The damage numbers in `ArenaView` are fixed (4a, item 9); on the merged tree the vsync-on run
   shows 13 to 124 per second (Plague walk 124, Sentenced walk 115, Holy stand 108), which is the overhead labels (proposal below).
4. **Chrome's GPU process** is a fixed cost per frame at uncapped rates (1.0 to 1.7 cores); with vsync on it is about 0.3 to 0.5 core and
   never the limit.
5. **Not measured**: an idle GPU (other tenants), Safari/Firefox, a second machine, a long (multi-minute) match at full crowd. Fire at
   vsync off and Frost at vsync on are now measured (section 2) but under heavy load. The cull of lights could be moved to `Add` time so
   the 20-light cap is filled with lights that are in reach (today a far light can take a slot and is dropped afterwards). Instance-ID churn during fights (100 to 6,000 new Unity object ids per
   second in some windows, none in others) was not traced to a source; memory stays flat, so it is not a leak.

## 6. Proposals for the files owned by the other agent (exact changes, expected gain)

* **`SpriteActorPresenter.cs` (Present):** (1) resolve the look once per actor and cache it on the `Art` keyed by
  `(kind, faction, mob, archetypeKey)`; today it calls `ShowcaseActorLook.AppearanceKey` and `ShowcaseCatalog.Find` up to four times per
  actor per frame (now indexed, still four lookups). (2) Guard every renderer write with a change check (`if (r.enabled != v)`,
  `sortingOrder`, `color`, `sprite`, `localScale`, `localRotation`): `Renderer.set_enabled` alone is 1.2% of the main thread in a fight.
  (3) `SuppressOverlappingNames` sorts with a lambda every frame: use a static `Comparison<Art>` field. Expected: about a third of the
  0.04 ms per actor, and most of the 100 to 150 B of garbage per actor per frame.
* **`OverheadIndicators.cs` / `OverheadExtras.cs`:** same change-guarded writes (19 and 16 `enabled` writes per actor per frame);
  fade text without `TMP_Text.color` (it sets `havePropertiesChanged` and regenerates the mesh): use the same vertex-alpha method as the
  damage numbers now in `ArenaView.SetNumberAlpha` (`textInfo.meshInfo[0].colors32` + `UpdateVertexData(Colors32)`). Expected: TMP rebuilds from hundreds per second to only real
  text changes.
* **Character outline (owner decision, being applied elsewhere): the outline is switched off by default.** The proposal "half-resolution
  camera sorting layer copy" below therefore becomes: **no sorting-layer grab at all when no outline variant is active** (skip the 2560x1440
  HDR copy, one of the 26 render passes, whenever the outline is off, and re-enable it only for the opt-in variants). That is a bigger
  saving than the half-resolution copy and needs no contrast re-run for the default look.
* **`SpriteOutline.cs`:** `Sync` reads `_source.transform.lossyScale` every frame (`CalculateGlobalScaleLossy` 0.6% of the main
  thread); compare `localScale` of the source and its parent chain only when the sprite changes, or pass the known actor scale in.
* **`RegionGround.shader` and `RhLocalLights.hlsl` users (ground, walls, props):** break the light loop at the light count actually in
  reach of the drawn rectangle: sort `_RhLP/_RhLC` by distance to the camera centre in `LocalLightField.Push` (done, section 4a item 8)
  and pass a per-draw "lights in reach" bound; or bin lights into screen tiles in a 32x18 index texture. Expected: Holy and Frost GPU
  -1 to -2 ms at 2560x1440 (the light loop is the biggest per-pixel term: about 1 ms with lights off in Holy).
* **`RhSun.hlsl` tables** (used by the actor and ground shaders): move the eight constant 8-entry tables (`_RhSunCol`, `_RhAmbCol`,
  `_RhShadowCol`, `_RhFloorCol`, `_RhCloud`, ...) into one 8x8 RGBA32F texture written once per region change: 170 to 185 array uploads
  (5.4k floats) per frame disappear from the command stream to Chrome's GPU process.
* **2D renderer asset:** if some outline variant stays available, `m_CameraSortingLayerDownsamplingMethod` (full resolution today) to 2x
  bilinear: the outline only takes the polarity of the ground behind the figure; a half-resolution copy saves a 2560x1440 HDR copy per frame
  (contrast gate must be re-run). With the outline off by default, see the first bullet: no grab at all.
* **`RegionActorLit.shader` / `RhActorOutline*`:** nothing measured worth changing beyond the uniform tables above.

## 7. Quality rows and default

| row | render scale | particles | local lights | wall shadows | cookies, gloss, water | post | intended for |
|---|---|---|---|---|---|---|---|
| Ultra | 1.0 | 1.5x | 20 | on | on | bloom, grading, vignette | this machine: holds 144 Hz at 2560x1440 (measured) |
| High | 1.0 | 1.0x | 12 | on | on | all | nearly identical look, less light-loop work in lantern and temple zones |
| Medium | 0.9 | 0.35x | 6 | off | off | no vignette | integrated GPUs, 1080p60 |
| Low | 0.75 | none | none | off | off | none | weak laptops |

The rows are sensible steps (High is Ultra minus fireflies, 8 fewer local lights and 1.0x instead of 1.5x particles). The default is
**adaptive**, starting at High (`ShowcaseSettings`, `AdaptiveQualityController`): a 3 s probe picks the start row (Ultra when frames
sit at the refresh interval and main-thread CPU is below 36% of it), it steps down after 2 s over 1.25x the refresh interval and up after
8 s under 1.1x, and bans an upgrade that failed within 15 s for 60 s. Verified in the browser (`Tools/adaptive-check.cjs`: default adaptive mode, no `quality=` parameter, real bot match, Ultra-capable
2560x1440 window on the 144 Hz panel, vsync on; the published row is logged with timestamps, the controller's state is read every second,
and the page's CPU is throttled 6x through CDP for 20 s and released). Evidence: `adaptive-before-fix.json`, `adaptive-after-fix.json`.
Observed on the fixed build (machine load 22, falling to 11):

* **Start row:** the 3 s probe ran from 1 s to 4 s, reported High from 0.6 s, and at 5.0 s picked **Ultra** (refresh estimate 6.91 ms,
  frame ratio 1.00, CPU 0.37 of the refresh).
* **Steps down:** Ultra -> High at 11.9 s (CPU ratio 0.66 > 0.55 for 2 s in the fight; the machine was busy), then with the 6x CPU
  throttle -> Medium at 15.4 s and -> Low at 18.9 s (frame ratio 3.7, p50 frame 26.9 ms, p95 34.7 ms while throttled).
* **Steps back up:** after the throttle was released at 38 s the frame ratio was 1.00 at once; the controller stepped Low -> **Medium at
  94.9 s**, 57 s later. It waits for main-thread CPU under 36% of the refresh interval (2.5 ms) for 8 s and the CPU ratio sat at
  0.37 to 0.47 until about 83 s (bots fighting on a loaded machine), so the long wait comes from the CPU test, not from a defect.
  Phase statistics (rAF): free 0.2% frames over 1.5x p50, throttled 0.7%, released 0%.
* **Before the fix** (same scenario, load 54, `adaptive-before-fix.json`): the start row stayed High (frame ratio 1.15), the refresh
  estimate sat at 5.7 to 6.0 ms on a real 6.94 ms cadence, and the controller never stepped up in 80 s of smooth 144 Hz at Low.
  Cause and fix: section 4a item 10. Limits of this check: one run per condition, on a machine whose load ranged from 11 to 54;
  the thresholds (2.5 ms CPU for stepping up) mean a loaded machine climbs back slowly.

No rule engine was added.

## 8. Build size

Fresh build of the merged tree (`node client-unity/UnityProject/Tools/build-size.cjs`, Runtime Speed, WebAssembly 2023), no server-side
compression (plain static hosting), sizes in MB:

| file | raw | gzip | brotli q11 |
|---|---|---|---|
| Build/Web.data | 46.8 | 34.6 | 31.7 |
| Build/Web.wasm | 54.3 | 14.9 | 9.8 |
| StreamingAssets/Audio (15 mp3, fetched on demand) | 8.3 | 8.3 | 8.2 |
| Web.framework.js, loader, index, 18 licence and small files | 0.5 | 0.1 | 0.1 |
| **total, 35 files** | **110.0** | **57.9** | **49.8** |

Judged on the larger of the gzip and brotli totals: **57.9 MB against the 150 MB limit** (92.1 MB of headroom). Audio is not
part of the first load, so the first-load download is Web.data + Web.wasm + framework: gzip about 49.6 MB, brotli about 41.6 MB.
Same tree built with `RH_WEB_WASM2023=0` (section 10): total 113.2 raw / 58.5 gzip / 50.2 brotli; wasm 57.4 MB raw, framework.js 490 KB (against 352 KB with the 2023 target). Evidence: `build-size.json`, `build-size-wasm2023-off.json`.

## 9. Commits and tests

Commits on `rework/perf2` since `feature/unity-rework` (merge commit excluded; this report and evidence are the last commit):

| commit | what |
|---|---|
| `b8a7dd4c` | `?perf=1` recorder (CPU per engine phase and owned system, managed bytes, UI/TMP rebuilds, render counters, scene census) and the perf-matrix driver |
| `5a557823` | soundscape `Resources.Load` every frame removed; creatures, cues and fades presented once per frame; World-layer walk only on hierarchy change; hidden launch menu at 4 Hz |
| `a7af2c68` | RhBuild sets the WebGL code optimization from `RH_WEB_CODE_OPTIMIZATION` (it lived only in the Library); profiling switches |
| `20f6988c` | Runtime Speed by default and the WebAssembly 2023 target (`RH_WEB_WASM2023=0` turns it off) |
| `9ee1da64` | `ShowcaseCatalog.Find` indexed by key |
| `1ec2a542` | perf-matrix: keyboard walk to the zone, quality row, browser process CPU, system GPU busy |
| `57b51a62` | local lights culled to the camera reach and sorted nearest first; EditMode test |
| `7bc3b1ef` | damage numbers fade through vertex alpha, no TMP rebuild per frame |
| `e52e3b0c` | adaptive quality step-up fix at 144 Hz, unit test, `adaptive-check.cjs`, controller debug state |
| `5901c64b` | recorder: lights offered/uploaded, adaptive state, A/B switches `fx.lightcull` and `fx.numberfade`; perf-matrix walk trace and 120 s limit |
| (last) | `build-web.sh` header comment for the build switches; this report and the evidence |

Tests, final tree: `dotnet test client-unity/RoguehallaNet.Tests` **1,242 passed, 0 failed** (1,241 before the new adaptive test); Unity EditMode
(`-runTests -testPlatform EditMode`, Unity 6000.0.85f2) **585 passed, 0 failed** (including the new light test). `git diff --stat -- packages/`
empty. Not run: PlayMode tests, the Rust workspace tests (no Rust change), `node tools/browser-proof/proof.mjs`. Builds: five Unity WebGL builds
on this tree, all succeeded; the content hash baked into the player was `a2d1022ebe713382` (the `BakedContent.cs` churn was reverted
before every commit).


## 10. Browser reach of the WebAssembly 2023 target, and how to build without it

The default build now uses Unity's "WebAssembly 2023" target (`PlayerSettings.WebGL.wasm2023`): native WebAssembly exception handling
(instead of JS `invoke_*` trampolines), fixed-width SIMD and BigInt-to-i64 integration. A browser missing any of these cannot instantiate
the module at all (the page shows Unity's load error); there is no automatic fallback.

Minimum desktop versions that can run the build:

| browser | Unity's stated minimum (Unity 6 manual, "WebAssembly 2023 prerequisites") | feature floor from the WebAssembly feature table (legacy exception handling / SIMD / BigInt) | **use** |
|---|---|---|---|
| Chrome | 91 | 95 / 91 / 85 | **95** |
| Edge (Chromium) | 91 | same engine as Chrome | **95** |
| Firefox | 89 | 100 / 89 / 78 | **100** |
| Safari | 16.4 | 15.2 / 16.4 / 15 | **16.4** (macOS 13.3, iOS 16.4) |

Sources: Unity manual page `wasm-2023-prereq` (Chrome 91, Safari 16.4, Firefox 89, Edge 91) and the WebAssembly feature table
(`features.json` of github.com/WebAssembly/website: exceptions Chrome 95, Firefox 100, Safari 15.2; simd Chrome 91, Firefox 89, Safari 16.4;
bigInt Chrome 85, Firefox 78, Safari 15). The two sources disagree for Chrome/Edge (91 vs 95) and Firefox (89 vs 100) because Unity's page
lists SIMD's floor while module instantiation also needs exception handling; the safe numbers are the "use" column. The Edge row is
derived from Chrome (same engine), not separately sourced. Whether Unity 6000.0's toolchain emits the legacy or the newer (exnref)
exception encoding was not checked in the wasm; the floor above assumes legacy, which is the lower floor, so if the module uses exnref
the real minimums are higher (not looked up). Only the Chromium row was
run here: Playwright Chromium 156.0.8078.4 runs both the 2023 build (all measurements above) and the `RH_WEB_WASM2023=0` build (it joined a
match and completed the planning and walk phases). Firefox and Safari were not run.

Reach over speed: build without the 2023 target with

```
RH_WEB_WASM2023=0 RH_SERVER_INFO_URL=http://127.0.0.1:7807/info client-unity/UnityProject/Tools/build-web.sh
```

(the switch lives in `RhBuild.BuildWeb`, `PlayerSettings.WebGL.wasm2023 = env != "0"`; it is listed at the top of `build-web.sh`).
Measured cost of the switch: wasm 54.3 -> 57.4 MB raw (9.8 -> 10.1 MB brotli), framework.js 352 -> 491 KB, total gzip 57.9 -> 58.5 MB; the
planning frame was 4.32 / 3.95 ms against 4.03 / 4.01 ms in the earlier interleaved A/B (within noise), scripts 0.45 / 0.43 against 0.40 / 0.37 ms.
So the speed difference is small and the owner can choose reach without a visible frame-time cost on this machine; it was not measured
on a slower machine. Combining `RH_WEB_CODE_OPTIMIZATION` (default Runtime Speed) is independent of this and does not affect browser reach.
