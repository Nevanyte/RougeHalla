# P-UNITY-LOOK-TOOLS-1: a look check any agent can run (editor capture and compare), and the Web round written down

- **Serves:** owner direction 2026-11-13 (chat): the coordinator's job is "making those future small changes easier
  ... so that sonnet sub agents can easily make small changes"; the tuning lane (`docs/agent/TUNING_LANE.md`) step 5
- **Implementer tier:** implementer-sonnet (Unity editor tooling, scripts, docs)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** none (tooling and documentation; nothing in a build, no game rule, no wire)

## 1. ID and outcome
During 2026-11-13 the coordinator's session grew a capture tool and two screenshot rounds' worth of commands, all
uncommitted, in a session scratchpad. They found real defects (roof fades that never reached the screen, a ground
shader over the Web sampler limit, looks that tests had passed) and they cost a Fable session to operate. When this
lands they are repository tools with one-line commands, so a Sonnet agent making a tuning change can see its own before
and after, and a Web round can be run from a recipe.

1. **Editor capture, committed as an editor-only tool** (never in a player build): from the uncommitted script handed
   over in the dispatch (`LandmarkPreviewCapture.cs`: it builds a small map of one zone, optionally stamps a landmark
   from `docs/landmarks/blueprints/*.txt` with a correct anchor, builds it through the real `ArenaView` path, and
   renders named shots to PNG). Kept: sRGB output (the project is Linear; writing a linear target to PNG was the first
   version's fault: pin it with a test on the render target's settings), the scene list (five zone scenes plain and
   dressed; five landmarks wide, close, inside or under, rotated; the volcano against the map edge), stand-in actors,
   ground-only mode. One wrapper script: `client-unity/UnityProject/Tools/look-capture.sh <scene...> --out <dir>`
   (finds the editor like `editmode.sh` does, runs batch mode WITH graphics, fails with a clear message if the project
   is open elsewhere, lists scene names with `--list`).
2. **Compare:** `client-unity/UnityProject/Tools/look-compare.py <before.png> <after.png>` (standard library only, or
   the repo's existing image helper if there is one): pixels differing, largest and mean per-channel difference, and
   `--noise <a.png> <b.png>` to state the same for two renders of one tree; exit code 0 always, numbers on stdout, an
   optional `--crop` of the largest differing region written beside the inputs.
3. **The documents filled in:** `docs/unity/LOOK_CHECK.md` section 1 gets the exact commands and the scene names;
   `docs/unity/WEB_ROUND.md` is written from the two rounds' command files (handed over in the dispatch): building
   `rh-server`, the flags for a solo room on pooled landmark maps and without them, the Web build script and what a
   clean run prints, serving the build, the browser driver and its commands, how practice is entered, what to capture
   and how to name it, and the rules (stop only your own processes; restore `BakedContent.cs`).
   `docs/unity/DIALS.md`'s "Scene" column names scenes the tool has.
Not in this packet: deterministic frame-identical renders (they needed a temporary shader edit to pin time; record that
in LOOK_CHECK.md as a limit and compare against the noise figure instead); any change to a shader or to `ArenaView`.

## 2. Dependencies
none

## 3. Relevant legacy paths
none

## 4. New paths
- `client-unity/UnityProject/Assets/Editor/Look/` (the capture, editor-only assembly `Roguehalla.Editor`)
- `client-unity/UnityProject/Tools/look-capture.sh`, `look-compare.py` (stubs on the packet branch), `web-drive.cjs`
  (scope addition, see Established facts); the script tests are `.test.cjs` (the gate's convention)
- `docs/unity/WEB_ROUND.md`

## 5. Exclusive write scope
- the new paths above; `docs/unity/LOOK_CHECK.md`, `docs/unity/DIALS.md` (the Scene column only)
- not `Assets/Scripts/**` (the capture must reach what it needs through existing public or internal-visible API; if it
  needs a member that is private, report it: do not widen production visibility silently), not any shader, not any
  existing test or tool

## 7. Behaviour to preserve
- Nothing in a player build changes: the capture compiles only in the editor assembly; `Tools/build-web.sh` output is
  unaffected (the oracle checks the capture's files sit under an `Editor` folder or the editor asmdef).
- The EditMode suite's run time grows by seconds, not minutes.

## 8. Acceptance checks
- EditMode: the scene builders make valid maps (each scene name builds a `MapBlob` the client's own validation
  accepts; each landmark scene's anchor equals what that landmark's art tests stamp); the scene list the script prints
  equals the list in LOOK_CHECK.md; the render target the capture creates is sRGB (the linear-PNG fault cannot return).
- A script test for `look-compare.py` on small generated images (identical, one pixel off, a block changed).
- Docs: every command in LOOK_CHECK.md section 1 and WEB_ROUND.md names a file that exists in the tree.
- The coordinator runs `look-capture.sh` for two scenes and `look-compare.py` on them once, after merge.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-LOOK-TOOLS-1` passes.

## Established facts (the contract; written by the oracle author, 2026-11-14)

Source material: the session capture `LandmarkPreviewCapture.cs` (client assembly, uncommitted), `run-capture.sh`, the
landmark-shots and sampler reports, and the round 9 and 10 command files. Nothing was run in those places.

**Files** (all new unless marked):
- `client-unity/UnityProject/Assets/Editor/Look/LookCapture.cs` (+ `.meta`), namespace `Roguehalla.Editor`, assembly
  `Roguehalla.Editor` (`includePlatforms: ["Editor"]`). The stub commit holds its compile-only surface; the implementer
  replaces the bodies and may add files under `Assets/Editor/Look/` (each with a `.meta`).
- `Assets/Editor/Look/scenes.txt`: the scene list, one name per line, no blanks; read by `look-capture.sh --list` and equal to
  `LookCapture.SceneNames` (EditMode pins both).
- `Tools/look-capture.sh`, `Tools/look-compare.py` (stubs exist), `Tools/web-drive.cjs` (new, see "Scope additions").
- `docs/unity/WEB_ROUND.md` (new); `docs/unity/LOOK_CHECK.md` section 1 and section 2's pointer; `docs/unity/DIALS.md` Scene column.
- Existing files the STUB commit already changed (flagged for the owner; neither is test logic): `Assets/Editor/Roguehalla.Editor.asmdef`
  gains the reference `RoguehallaNet` (the capture uses `Roguehalla.Net` types; asmdef references are not transitive), and
  `Assets/Tests/Editor/Roguehalla.Client.EditModeTests.asmdef` gains `Roguehalla.Editor` (the test calls `LookCapture`). No
  existing test body or capture changed.

**Scene list** (32 names, in this order; each is the PNG's file stem):
`<zone>-scene`, `<zone>-scene-dressed` for zone in `fire plague sentenced holy frost`; then for each landmark in
`cave volcano church bog hall`: `<k>-wide`, `<k>-close`, `<k>-inside` (cave, church, hall only) or `<k>-under` (bog only),
`<k>-rot-wide` (volcano has no inside or under); then `volcano-edge-wide`, `volcano-edge-close`, `volcano-edge-rot-wide`.
Zones (RegionId): fire 1, sentenced 2, plague 3, frost 4, holy 5. Landmark zones: volcano 1, church 2, bog 3, cave 4, hall 5.
The hall's anchor zone is 5 here (the hall art test stamps 1; zone is not compared with the art tests).
Maps are 60 x 60, one zone in every tile, ground terrain mode All. Zone scenes: L-shaped wall (x 26..27, y 24..31 and x 28..34,
y 30..31) and a fence run on row 34 (x 33..41, Low + Fence) or, in plague, a 6 x 4 bog patch (x 33..38, y 34..37); dressed adds one
prop and a ground-variant plane (a non-empty prop list is what makes the client treat a map as dressed). Landmark scenes: the
drawing `docs/landmarks/blueprints/<k>.txt` in orientation 0 (`-wide`, `-close`, `-inside`, `-under`) or orientation 1
(`-rot-wide`, x and y swapped), footprint centred, no props; the volcano's outlets continue outward as Low + Lava, never as walls.
Edge scenes: the volcano's footprint at y = 2 (orientation 0, front south) or x = 2 (orientation 1, front east).
The anchor is stamped as the art tests stamp it (kind, footprint size, centre, entrance and front, compared relative to the
footprint's corner): cave centre `E`, entrance `D`; volcano entrance `O`, centre the lava tile nearest the lava centroid (first in
row-major order on a tie); church entrance `M` (row 28, columns 12..16, marked before orienting), centre `E`; bog centre drawing
tile (14,14), entrance (12,0) (13,0) (0,11) (0,12) (13,28) (14,28), front always 4; hall entrance `M` (row 36, columns 15..21),
centre footprint tile (18,18); front from the entrance's mean against the footprint's middle (DIR16: 0 east, 4 south, 8 west, 12 north).

**`LookCapture` API** (signatures in the stub): `SceneNames`, `ReflectionTargets`, `MissingReflectionTargets()`, `BuildMap(scene)`,
`AnchorOf(scene)` (null for zone scenes), `ZoneOf(scene)`, `TargetDescriptor()`, `Run()`. Batch entry:
`Unity -batchmode -projectPath <p> -executeMethod Roguehalla.Editor.LookCapture.Run -lookScenes a,b,c -lookOut <dir> [-lookGroundOnly 1] [-lookQuality low|medium|high|ultra] -logFile <log>`;
no `-quit`, no `-nographics` (the capture exits the editor itself: 0, or 1 after logging the exception). Dropped from the session
script: `-lmTime` (it needed a temporary shader edit; LOOK_CHECK.md records deterministic frames as a limit), `-lmProp`, `-lmNoArt`,
`-lmDebug`, `-lmMatch`. Kept: stand-in actors (red, blue, yellow blocks by the doorway; two on zone scenes), ground-only mode,
quality preset (default ultra), the real self actor through `ArenaView.Present`, the converging atmosphere ticks.
`TargetDescriptor()`: 1920 x 1080, `RenderTextureFormat.ARGB32`, 24-bit depth, `sRGB = true` (the first version wrote a linear
`ARGBHalf` target to PNG and came out dark and over-saturated).

**What the capture needs that the editor assembly cannot reach today, and the option chosen.** Everything it calls on `ArenaView`,
`RegionMap`, `RegionAtmosphere`, `LandmarkView`, `Landmark`, `AtmosphereQuality`, `SelfView`, `MapBlob` is public except three
members: `ArenaView.Awake` (private; Unity does not run it for an object made in code in edit mode), the private field
`ArenaView._landmarks` (the built landmarks), and `Landmark.Fades(int, int)` (internal; picks the tile whose occupant fades the roof,
for the `inside` and `under` shots). Options: (a) keep the capture in the client assembly under `#if UNITY_EDITOR`; (b)
`InternalsVisibleTo`; (c) the editor assembly with these three reached by reflection. Chosen: **(c)**. It changes no production file
and no visibility; (a) leaves a capture type in the client assembly, (b) edits `Assets/Scripts`, which the scope forbids. Cost: a
rename breaks the capture, so `LookCapture.ReflectionTargets` lists exactly `ArenaView.Awake`, `ArenaView._landmarks`,
`Landmark.Fades` and EditMode fails by name if one stops resolving. A fourth non-public member means this brief is amended first.
The only assembly change is the `RoguehallaNet` reference above.

**`look-capture.sh`**: `look-capture.sh <scene...> --out <dir> [--ground-only] [--quality low|medium|high|ultra]`; `look-capture.sh --list`.
Order of checks: usage, availability, run. Exit codes: 0 every named scene's `<dir>/<scene>.png` exists and is non-empty; 1 the run
failed (editor exit, compile error, a PNG missing; last log lines to stderr; log at `<dir>/look-capture.log`); 2 usage (unknown
scene: `look-capture: unknown scene: <name>`; no scene or no `--out` or no value: the message names `--list` or `--out`); 3
unavailable (message begins `look-capture: unavailable: `): no editor at `$RH_UNITY_EDITOR` (else the version in
`ProjectSettings/ProjectVersion.txt` under `/Applications/Unity/Hub/Editor`), or `Temp/UnityLockfile` exists, as `editmode.sh`. `--list`
prints `scenes.txt` and exits 0 without Unity. Nothing is created (not even `<dir>`) on 2 or 3. After a run the script restores
`ProjectSettings/ShaderGraphSettings.asset` and `Assets/Resources/Showcase/*.asset` with `git checkout --` when they were unmodified
before. The editor runs WITH graphics.

**`look-compare.py`** (python3, standard library only; 8-bit RGB or RGBA, non-interlaced PNG, all five filters; alpha ignored):
`look-compare.py <before.png> <after.png> [--crop] [--noise <a.png> <b.png>]`, or `look-compare.py --noise <a.png> <b.png>`.
One stdout line of space-separated `key=value`, in this order: `diff_px` (pixels with any channel differing), `total_px`, `max`
(largest per-channel difference), `mean` (mean absolute per-channel difference over RGB), `size=<w>x<h>`, `bbox=<x0>,<y0>,<x1>,<y1>`
(inclusive, or `none`), `crop=<path>` when `--crop` and there is a difference (the bounding box cut from `<after>`, written as
`<after-stem>-diff-crop.png` beside it), then `noise_diff_px`, `noise_max`, `noise_mean` when `--noise` is given (alone: only
these). Exit 0 whenever numbers are printed. **Refinement of the brief's "exit code 0 always":** a refusal (sizes differ,
unreadable file, bad arguments) prints nothing on stdout, one line on stderr beginning `look-compare: ` (naming both sizes as `WxH`,
or the file) and exits 2.

**Scope additions** (proposed, needs the coordinator's nod; the oracle already depends on it): `Tools/web-drive.cjs`, the session's
`drv.cjs` as a repository tool: same commands (`goto move click down up press wait shot errs quit`, POST JSON to `127.0.0.1:9777`),
Playwright from `RH_PLAYWRIGHT_MODULE` else `playwright` (as `smoke-web.cjs` does), no machine-specific path; WEB_ROUND.md quotes
`node client-unity/UnityProject/Tools/web-drive.cjs 1920 1080`. Without it the Web round's browser driver is not reproducible; if
refused, the driver checks in `look-docs.test.cjs` must be removed first.

**Gate wiring.** The gate's "Unity tool tests (node --test)" step runs `Tools/*.test.cjs`, so the script tests are
`look-compare.test.cjs` (compare and wrapper) and `look-docs.test.cjs` (docs). The brief's `look-compare.test.py` is superseded.

**Docs contract** (what `look-docs.test.cjs` pins). Quoted commands are the lines of fenced code blocks; a token naming a repository
path (relative, with a slash, no `$ < > * : =`) must exist, except build outputs under `target/` and
`client-unity/UnityProject/{Build,Logs,Library,Temp}/`. LOOK_CHECK.md section 1 quotes the capture command with `--out`, `--list`, a
compare and a `--noise` compare; lists all 32 names as backticked tokens and no other scene-shaped name; drops the "not landed"
status text; names the noise figure and frame-identical renders as a limit; says the capture runs with graphics; links WEB_ROUND.md.
WEB_ROUND.md quotes at least eight commands including `cargo build --release -p rh-server`, `--runtime source-arena`, `--map-pool`,
`--signature-landmarks`, `--fill-bots 0`, `RH_SERVER_INFO_URL=... Tools/build-web.sh`, `http.server`, and the driver; and says:
restore `BakedContent.cs`; `diagnostic=1` disables TRAINING (practice needs accounts: a throwaway Postgres, a `--features postgres`
build, the URL without `diagnostic=1`); stop only your own processes; what a failing shader build prints; what a clean run prints
("Audio check: all streamed files present"); that Plague and Sentenced editor renders are darker than the Web client. From the
rounds: the faction does not choose the start zone; more than a few fill bots ends a match in about a minute, so use a solo room;
`--signature-landmarks` hides the Sentenced floor scatter (run a second arena without it); `--map-pool` is a bare switch; the
pool's last-resort map is `crates/rh-sim/src/mapdata/fixtures/seed1.map.json`. DIALS.md's rows already pass; the test keeps them
in the list.

## Oracle files (read-only for implementers)
- `client-unity/UnityProject/Assets/Tests/Editor/LookCaptureEditModeTests.cs` (+ `.meta`): EditMode, no rendering. Scene list, maps
  validate, zones, anchors from the drawings, dressed vs plain, sRGB target, editor-only assembly, the three reflection targets.
- `client-unity/UnityProject/Tools/look-compare.test.cjs`: `look-compare.py` on generated PNGs; `look-capture.sh --list`, usage and
  unavailable exits.
- `client-unity/UnityProject/Tools/look-docs.test.cjs`: LOOK_CHECK.md, WEB_ROUND.md, the driver, DIALS.md.
- Stub commit (the implementer replaces these; not oracle): `Assets/Editor/Look/LookCapture.cs` (+ `.meta`, folder `.meta`), the two
  Tools stubs, the two asmdef reference additions.

## Baseline (on the oracle commit, 2026-11-14)
- EditMode (`bash client-unity/UnityProject/Tools/editmode.sh`): total 1430, passed 1280, failed 150; all 150 are
  `LookCaptureEditModeTests`, by assertion (null map, empty list, `sRGB` false, `scenes.txt` missing), no compile error. Guards that
  pass today and must stay green: the pinned list has 32 distinct names; the capture is in `Roguehalla.Editor` and no player
  assembly has it.
- `node --test` on the two new files: 16 of 17 fail by assertion on the stub's exit 1 or the missing docs; DIALS.md passes.
- A reference `look-compare.py` (PIL, scratch) passes all seven compare tests, so the compare contract is satisfiable.
- Not established: the anchor expectations were re-derived from the art tests and the capture's stamping and were not run against an
  implementation; a disagreement between the two should be settled against the art test files, which win. The real capture needs
  graphics and was not run.

## 9. Validation commands
- `bash client-unity/UnityProject/Tools/editmode.sh`; then `git checkout --` any modified font asset under
  `client-unity/UnityProject/Assets/Resources/Showcase/`.
- `bash client-unity/UnityProject/Tools/look-capture.sh --list` and one real capture with graphics.

## 10. Risk and suggested model tier
Sonnet. The capture exists and works; this is making it a tool and writing down what was learned.

## 11. Known traps
- A camera render crashes under `-nographics`: the capture runs in batch mode with graphics; EditMode tests (which run
  without graphics in the gate) must not render.
- The capture's Plague and Sentenced scenes are darker than the Web client; say so where the commands are.
- Unity may modify `ProjectSettings/ShaderGraphSettings.asset` and font assets on a capture run: the wrapper restores
  them (`git checkout --`) or the doc tells the agent to.

## Notes from previous attempts
