# P-UNITY-WEB-DRIVE-2: a Web round can find every landmark and stand a player at it without exploring by hand

- **Serves:** owner direction 2026-11-13 (tooling that lets Sonnet agents run looks rounds; `docs/agent/TUNING_LANE.md`) and the final browser proof of the unity rework, which needs a shot of each of the five landmarks. Not a game rule.
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework (staging head `aadff95e3`)
- **D-rules touched:** D1 n/a (tooling) · D2 n/a · D5/D6/D9 none (the probe is opt-in diagnostics; nothing new on the wire; Unity gains no game rule)

## 1. ID and outcome
Round 11 (2026-11-14) was the first Web round run by an agent who did not write the recipe. It took two sessions and still
photographed ordinary trees instead of the landmark bog tree, because nothing told the driver where a landmark is. When this
lands:

1. `window.__rhProbe` (present only when the page is opened with `scenario.probe=1`; built by
   `Assets/Scripts/Diagnostics/ScenarioProbe.cs`, published through `Assets/Plugins/WebGL/RhProbe.jslib`, attached in
   `Bootstrap.cs:114`) gains `"anchors"`: the landmark anchors of the map as delivered (`MapBlob.Anchors`, from
   `Session.Map`), nothing else and nothing new on the wire. `ScenarioProbe.AnchorsJson(MapAnchor[])` (public static, stubbed)
   builds the array.
2. `Tools/web-drive.cjs` gains `eval`, `anchors`, `where`, `goto {x,y,...}`. Their logic lives in `Tools/web-drive-lib.cjs`
   (`run(cmd, page, env)`, stubbed) so the gate tests it without a browser; the driver calls it first and handles whatever it
   answers `null` to as before.
3. `docs/unity/WEB_ROUND.md` is corrected with the thirteen round-11 items and gains a "Find a landmark" step.

## 2. Dependencies
none (P-UNITY-LOOK-TOOLS-1 landed: it created `web-drive.cjs` and `WEB_ROUND.md`).

## 3. Relevant legacy paths
none (the legacy game has no probe). Client facts relied on, verified in the tree at `aadff95e3`:
- `Assets/Scripts/Diagnostics/ScenarioProbe.cs:34-` the probe's `LateUpdate` builds the JSON; `me` carries `x`,`y` (world
  units) from `s.Me`; `Common()` writes `id,x,y,sx,sy`.
- `Assets/Plugins/WebGL/RhProbe.jslib:4` `window.__rhProbe = JSON.parse(...)`, the only place the page gets it.
- `Assets/Scripts/Bootstrap.cs:114` the probe component is added only for `scenario.probe=1` on a loopback page.
- `RoguehallaNet/Protocol/MapBlob.cs:56-71` `MapAnchor { Zone, Kind, Front, Centre, Footprint, Entrance[] }`, tile units;
  `MapBlob.cs:86` kind codes `AnchorKindVolcano 1, Church 2, BogTree 3, Cave 4, Hall 5`; `MapBlob.cs:132` `Anchors`.
- `Assets/Scripts/View/ArenaView.cs:17` `WorldPoint(x, y)` and `:212` `(tile + .5) * 32`: a tile is 32 world units, a tile
  centre is `(t + .5) * 32`. y grows downward in world units (W moves y down the screen up, so y decreases).
- `Assets/Scripts/Net/MatchClient.cs:229-231, 364, 451-453` held keys become server steer orders and `OrderStop` on release;
  the Tab-map walk target is a server order (`TacticalMapController.cs:575-577`).

## 4. New paths
- `client-unity/UnityProject/Tools/web-drive-lib.cjs` (stub on the packet branch)
- (oracle) `Tools/web-drive.test.cjs`, `Tools/web-round-docs.test.cjs`, `Tools/fixtures/web-drive-page.html`,
  `Assets/Tests/Editor/ScenarioProbeAnchorsEditModeTests.cs` (+ `.meta`)

## 5. Exclusive write scope
- `client-unity/UnityProject/Tools/web-drive.cjs`, `client-unity/UnityProject/Tools/web-drive-lib.cjs`
- `client-unity/UnityProject/Assets/Scripts/Diagnostics/ScenarioProbe.cs` (and only that C# file; if the map is not reachable
  from `_mc.Session.Map` without touching `ArenaView.cs`, report it instead of widening visibility)
- `docs/unity/WEB_ROUND.md`
- not the wire, not `Bootstrap.cs`, not `RhProbe.jslib`, not any existing test

## 6. Contracts and references
C-OBS is not involved: anchors are public map data the client already holds. R-AUTH / D9: Unity holds no rule; the probe only
reads. `docs/unity/WEB_ROUND.md` and `Tools/look-docs.test.cjs` (its checks on WEB_ROUND.md must stay green: every quoted
command names a real file, the existing recipe items remain).

## 7. Behaviour to preserve
- Without `scenario.probe=1` the page exposes nothing new (`__rhProbe` absent; no extra jslib export).
- Existing driver commands and answers (`ok`, `ERR ...`) are unchanged. `goto` WITH a `url` is still page navigation; `goto`
  with `x` and `y` is the new walk (the name is the task's; the two are told apart by `url`).
- `RH_PLAYWRIGHT_MODULE` handling unchanged. New: `RH_DRIVE_HEADLESS=1` launches Chromium headless (the browser test uses it).

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-UNITY-WEB-DRIVE-2` passes (full).
- `node --test client-unity/UnityProject/Tools/web-drive.test.cjs client-unity/UnityProject/Tools/web-round-docs.test.cjs` green;
  with `RH_PLAYWRIGHT_MODULE` set the browser test runs too (it was run green against a reference implementation).
- `bash client-unity/UnityProject/Tools/editmode.sh` green incl. `ScenarioProbeAnchorsEditModeTests`.
- Not machine-checked, for the coordinator after merge: one real round on the Web build, `anchors` lists five rows on a
  signature-landmark map (see "Not pinned").

## Established facts (the contract)

**Probe** (`window.__rhProbe.anchors`, an array in `Anchors` order, `[]` when the map has none; present whenever `session` is
true and the map is delivered). Row, one per `MapAnchor`:
`{"kind":"cave","zone":4,"footprint":{"x":10,"y":5,"w":6,"h":6},"centre":{"x":400,"y":240},"entrance":[{"x":336,"y":336}]}`
- `kind`: lowercase names `volcano`, `church`, `bogtree`, `cave`, `hall` (codes 1..5). (The look scenes say `bog`; the probe
  says `bogtree`, after `AnchorKindBogTree`. An unknown code: `"kind":"unknown<code>"`.)
- `zone`: the zone code 1..5. `footprint`: tile units. `centre` and each `entrance` tile: world units, the tile's centre,
  `(t + .5) * 32`, floats with up to one decimal. Entrance is `[]` for a landmark without one.
- `ScenarioProbe.AnchorsJson(null)` and `(empty)` are `"[]"`.

**`web-drive-lib.cjs`** `run(c, page, env)` returns a string answer, or `null` for "not mine" (including `goto` with `url`).
It passes only expression STRINGS to `page.evaluate` and uses `page.keyboard.down/up/press`, `env.sleep(ms)` and `env.now()`
(never real timers: the tests simulate time). Any exception becomes `"ERR " + message`.
- `eval {js}`: answer `JSON.stringify(result)` (`undefined` becomes `null`); a throwing expression answers `ERR <message>`.
- `anchors`: JSON of `window.__rhProbe.anchors`. `where`: `{"x":..,"y":..}` of `window.__rhProbe.me`. Without the probe or
  without `me`: an `ERR` answer containing `scenario.probe=1`.
- `goto {x,y,within?,timeoutMs?}` (defaults 48 world units, 30000 ms); `x` or `y` missing: `ERR`. Steps, in order:
  1. Clear any Tab-map walk target: the FIRST keyboard event is a movement key (W/A/S/D) at once (simulated time <= 200 ms),
     then it waits out the half-second key lag (round-11 item 8, 12) before reading the position. A held or tapped movement
     key replaces the standing walk order. (This mechanism is the report's, not read out of `MatchClient`; see "Not pinned".)
  2. Loop until the stop: read `where`; if within `within` of the goal stop `reached`; else hold the key of the larger
     axis gap (east D, west A, south S, north W: y decreases northward). Far away: holds of up to 500 ms. Near the goal
     (about 200 units): taps of at most 250 ms and a settle wait before the next read, because keys keep acting about half a
     second after key-up.
  3. Always release every key it pressed before answering.
- Answer JSON: `{"ok":bool,"reason":"reached"|"blocked"|"timeout","x":..,"y":..,"dist":..,"elapsedMs":..}` with the final
  position and distance to the goal.
- **When blocked** (what `goto` does, to be copied into WEB_ROUND.md): if over 1500 ms of key time the distance to the goal
  has not shrunk by more than 2 units, it stops, releases the keys and answers `reason: "blocked"` with the position where it
  stopped. It does not path-find, does not try the other axis, does not retry; the caller picks another point (aim beside a
  blocked tile; a closed building is entered through its entrance from `anchors`). `timeout`: `timeoutMs` ran out first.
- `web-drive.cjs` calls the lib before its own switch with `env = {sleep: page.waitForTimeout, now: Date.now}` and writes the
  answer when it is not `null`. The help comment at its head lists the new commands.

**WEB_ROUND.md** keeps its structure. Added or changed (phrases are checked, case-insensitively, by
`Tools/web-round-docs.test.cjs`; the sentence around each is the implementer's):
| # | Item | Phrase the test looks for |
|---|---|---|
| 1 | port check may list other sessions' servers; ignore other ports | `other sessions' servers` |
| 2 | build takes ~8 min; tool call times out at 3 | `run it in the background`, `poll unity-build.out`, `one tool call times out` |
| 3 | build also modifies `ProjectSettings/ShaderGraphSettings.asset`; restore both | `ShaderGraphSettings.asset`, and a `git checkout -- ...ShaderGraphSettings.asset` line |
| 4 | fresh worktree's first server build is cold (~1 min), finish it before the next step | `first server build is cold` |
| 5 | start both arenas (7817 landmarks, 7819 none) before the build | `start both arenas before the build` |
| 6 | 7819 page URL given explicitly (only `server=` changes; `accountApi` stays 7817) | `give the 7819 page URL explicitly` |
| 7 | faction does not pick the zone, each session draws a new map | `take a Tab-map shot after joining` |
| 8 | keys act ~0.5 s after key-up: short taps near props | `250 to 500 ms taps` |
| 9 | `{"cmd":"quit"}` exits the driver; a later `kill` of its pid says no such process, harmlessly | `no such process` |
| 10 | shell functions do not persist between tool calls: a script file for posting | `shell functions do not persist` |
| 11 | Coliseum timer gives 10 minutes per session | `10 minutes per session` |
| 12 | a held key overshoots while a Tab-walk target is active | `clear the target first` |
| 13 | a Tab-walk target on a blocked tile makes no path | `aim beside it` |
Also: the driver's command list names `eval {js}`, `anchors`, `where`, `goto {x,y,within,timeoutMs}` in backticks; the page URL
has `&scenario.probe=1`; a heading containing "Find a landmark" (any `##`/`###`) whose body shows `"cmd":"anchors"`,
`"cmd":"where"` and `"cmd":"goto"` and names the kinds `cave`, `volcano`, `church`, `bogtree`, `hall` and `scenario.probe=1`; and
the blocked behaviour written with `reason `blocked`` (or `"reason": "blocked"`). Docs must still pass `look-docs.test.cjs`.

## Oracle files (read-only for implementers)
- `client-unity/UnityProject/Tools/web-drive.test.cjs`
- `client-unity/UnityProject/Tools/web-round-docs.test.cjs`
- `client-unity/UnityProject/Tools/fixtures/web-drive-page.html`
- `client-unity/UnityProject/Assets/Tests/Editor/ScenarioProbeAnchorsEditModeTests.cs` (+ `.meta`)
- `docs/backlog/packets/P-UNITY-WEB-DRIVE-2.md`

Stub commit (the implementer replaces): `Tools/web-drive-lib.cjs`, `ScenarioProbe.AnchorsJson`.

## 9. Validation commands
- `node --test client-unity/UnityProject/Tools/*.test.cjs` (gate's step skips `profile-hub14.test.cjs`; with
  `export RH_PLAYWRIGHT_MODULE=$HOME/.codex/tools/rougehalla-stage2/browser/node_modules/playwright` the browser test runs)
- `bash client-unity/UnityProject/Tools/editmode.sh` (never commit anything under `Assets/Resources/Showcase/`)
- `scripts/gate.sh --quick`

**Playwright in the gate:** no existing node test needs a browser and the gate's machines may lack Playwright, so the logic
is split into the pure lib (always tested, simulated page and clock) and the browser test, which skips with a message when
Playwright cannot load. The skip is deliberate; do not weaken the lib tests.

## 10. Risk and suggested model tier
Low. implementer-sonnet: a small C# JSON writer, a node module and a document. Hard part: `goto` near the goal with key lag.

## 11. Known traps
- `page.evaluate` must get strings (the fake page evaluates them; Playwright accepts them).
- Time in `goto` comes only from `env`; real `setTimeout` makes the simulated tests hang or lie.
- `JsonUtility` has no top-level arrays: build the array text by hand with `CultureInfo.InvariantCulture` (see `Num`).
- Do not leave a key held on any exit path, including exceptions.
- Do not touch the existing `goto {url}` navigation.

## Not pinned / flags
- The Tab-walk-clearing mechanism (any movement key press replaces the standing order) is the round-11 reports' observation;
  the tests pin only that a movement key is the first event. The coordinator should see it work once in a real round; if a
  key press does not cancel the walk, the fix is a follow-up (for example Escape, or clicking `ClearRoute` on the Tab map).
- The real client's speed, lag and walls are not simulated beyond the fixture (100 units/s, 300 ms lag, wall at x 400);
  thresholds (`within` 48, 1500 ms stall) are the packet's choice, not measured.
- The probe's real JSON for a live session (five anchors) is not run here; the EditMode test pins `AnchorsJson` only.
  Wiring it into the probe (`"anchors":` after `"camps"`) is the implementer's; reviewer reads it.
- `goto` with `url` versus `goto` with `x,y` share a name by the task's request; a distinct name (`walk`) would be cleaner.
- Kind name `bogtree` is chosen here (the look scenes use `bog`).

## Notes from previous attempts
