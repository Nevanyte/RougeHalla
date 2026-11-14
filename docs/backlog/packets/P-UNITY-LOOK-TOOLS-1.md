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
- `client-unity/UnityProject/Tools/look-capture.sh`, `look-compare.py`, `look-compare.test.py` (or `.test.cjs`
  following the folder's convention)
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
