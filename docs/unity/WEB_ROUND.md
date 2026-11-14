# Web round: a Web build against a local server, driven in a browser, with screenshots

A look is approved only on screenshots from this round (see [LOOK_CHECK.md](LOOK_CHECK.md) section 2). Run every step in
order from the repository root (your worktree); each step says what "done" looks like. Editor renders from
[LOOK_CHECK.md](LOOK_CHECK.md) section 1 are for you; the owner is shown only Web screenshots.

## 0. Prerequisites

- Node with Playwright and a Chromium: set `RH_PLAYWRIGHT_MODULE` to the directory of the `playwright` node module. On this
  machine the earlier rounds used the one at `~/.codex/tools/rougehalla-stage2/browser/node_modules/playwright`: use it if it
  is present; otherwise report that Playwright is missing and stop (never install anything).

```
export RH_PLAYWRIGHT_MODULE=$HOME/.codex/tools/rougehalla-stage2/browser/node_modules/playwright
node -e "require(process.env.RH_PLAYWRIGHT_MODULE)"
```

  Done when the second command prints nothing.
- The Unity editor of `ProjectSettings/ProjectVersion.txt` under `/Applications/Unity/Hub/Editor` (or `RH_UNITY_EDITOR`). Close the
  editor on this project: a batch build needs it closed. A leftover `Temp/UnityLockfile` is removed only when no Unity process of
  yours runs.
- Free ports: 7817 (arena server), 7818 (practice server, only for step 7), 7819 (second arena, without landmarks), 8117 (page), 9777 (driver). Done when `lsof -i :7817 -i :7818 -i :7819 -i :8117 -i :9777` prints nothing. If it lists
  processes, check whose they are: this machine runs other sessions' servers, often on other ports. Ignore those on ports
  you do not use; if one holds a port above, pick another port for yours (change it everywhere in this document) and never stop it.
- Rust: `export PATH="$HOME/.cargo/bin:$PATH"`.
- A scratch folder for logs, pids and screenshots outside the repository; below it is `$OUT` (`mkdir -p $OUT`).

## 1. Build the server

```
cargo build --release -p rh-server
```

Done when it ends with `Finished` (about 40 s warm). In a fresh worktree the first server build is cold (about 1 minute):
finish it before the next step. If it fails, report the last 20 lines and stop. Step 2 runs `target/release/rh-server` (this build). Practice (step 7) needs the Postgres build, which goes to its own
folder so it never replaces the arena binary (its first build is cold, several minutes; build it only if you need practice):

```
cargo build --release -p rh-server --features postgres --target-dir target/pg
```

## 2. Start both arenas (a solo room each)

Start both arenas before the build (step 3): the build bakes the content hash of the server on 7817, and the 7819 arena
(without landmarks) is needed for the Sentenced floor scatter. Both are started with the commands below.

Pooled landmark maps: the pool is built into `rh-server`; `--map-pool` is a bare switch (no directory), `--signature-landmarks`
needs it, and `--map` is the pool's last-resort map. `--fill-bots 0` makes a solo room: with more than a few fill bots the
match ends in about a minute ("last standing"), with 7 you die in seconds. Note the pid; you stop only this one.

```
target/release/rh-server --bind 127.0.0.1:7817 --insecure-dev-auth --api-cors-origins http://127.0.0.1:8117 --runtime source-arena --map crates/rh-sim/src/mapdata/fixtures/seed1.map.json --map-pool --signature-landmarks --min-players 1 --fill-bots 0 --lobby-seconds 8 --fill-seconds 2 > $OUT/arena.log 2>&1 &
echo $! > $OUT/arena.pid
curl -s http://127.0.0.1:7817/info
```

Done when `/info` answers `{"contentHash":"...","protocol":N,"state":"ready"}`; the log says "map pool on". If `/info` does not
answer within 10 s, read `$OUT/arena.log`, report it, and stop. Each session draws a new pooled map; the faction does not
pick the zone (step 6).

Without landmarks (second arena, own port 7819; needed to see the Sentenced floor scatter, because `--signature-landmarks`
makes the server's ground-variant bands cover it). Use `--api-cors-origins` as above and open the page with `server=` pointing to 7819:

```
target/release/rh-server --bind 127.0.0.1:7819 --insecure-dev-auth --api-cors-origins http://127.0.0.1:8117 --runtime source-arena --map crates/rh-sim/src/mapdata/fixtures/seed1.map.json --map-pool --min-players 1 --fill-bots 0 --lobby-seconds 8 --fill-seconds 2 > $OUT/arena2.log 2>&1 &
echo $! > $OUT/arena2.pid
```

## 3. Build the Web client

The client bakes the server's content hash from `/info` into `Assets/Scripts/BakedContent.cs` before compiling, so the server
of step 2 must already answer. Close the editor first. The build takes about 8 minutes and one tool call times out at 3
minutes, so run it in the background and poll unity-build.out until it prints the final lines (or the process has ended):

```
RH_SERVER_INFO_URL=http://127.0.0.1:7817/info client-unity/UnityProject/Tools/build-web.sh > $OUT/unity-build.out 2>&1 &
echo $! > $OUT/build.pid
```

Poll with `tail -n 5 $OUT/unity-build.out` and `kill -0 $(cat $OUT/build.pid)` (it fails once the build has ended) every minute
or two. Never start a second build. Done when the process has ended, `$OUT/unity-build.out` contains `Audio check: all streamed files present` and no line with
`Shader error`, and `Logs/web-build.log` has none either. A clean run exits 0 and prints `Baked authoritative content hash <hex>`, `Building Web player; log: ...` and
`Audio check: all streamed files present`; `Logs/web-build.log` has no line with `Shader error`. A failing build exits 1 with
`error: a Roguehalla shader failed to compile for WebGL` and a line like
`Shader error in 'Roguehalla/RegionGround': maximum ps_5_0 sampler register index (16) exceeded ...`: the player files may
still be fresh (the later checks did not run) but report it; do not approve a look from it. Then restore the files the build
rewrites (never commit them; the build also modifies `ProjectSettings/ShaderGraphSettings.asset`):

```
git checkout -- client-unity/UnityProject/Assets/Scripts/BakedContent.cs
git checkout -- client-unity/UnityProject/ProjectSettings/ShaderGraphSettings.asset
```

Done when `git status` shows no change to `BakedContent.cs` or `ShaderGraphSettings.asset`. Do this after every build, also a clean one.

## 4. Serve the build

```
python3 -m http.server 8117 -d client-unity/UnityProject/Build/Web > $OUT/http.log 2>&1 &
echo $! > $OUT/http.pid
```

Done when `curl -sI http://127.0.0.1:8117/` answers 200. A plain server is enough (the build is uncompressed).

## 5. Start the browser driver

```
node client-unity/UnityProject/Tools/web-drive.cjs 1920 1080 > $OUT/drive.log 2>&1 &
echo $! > $OUT/drive.pid
```

A Chromium window opens (headed, 1920 x 1080, device scale 1). Send commands as JSON by POST to `127.0.0.1:9777`; each answers
`ok` (or `ERR ...`; `errs`, `anchors`, `where`, `eval` and the walk answer JSON). Commands: `goto {url}`, `move {x,y,steps}`,
`click {x,y,button}` (`button` `left` or `right`), `down {key}`, `up {key}`, `press {key}`, `wait {ms}`, `shot {path}`, `errs`
(browser console errors so far, JSON), `quit`; with the probe (step 6): `eval {js}` (an expression run in the page, answered as JSON),
`anchors`, `where`, `goto {x,y,within,timeoutMs}` (walks the player; step 6b). Shell functions do not persist between tool calls:
put the helper in a script file and `source` it at the top of every call. A shell does not expand variables inside single quotes,
so build each JSON with double quotes where it needs a variable:

```
echo 'post() { curl -s -X POST http://127.0.0.1:9777 -d "$1"; echo; }' > $OUT/post.sh
source $OUT/post.sh
post '{"cmd":"wait","ms":1000}'
```

Done when that prints `ok`. If it prints nothing the driver is not up: read `$OUT/drive.log` (usually `RH_PLAYWRIGHT_MODULE` is not
exported in this shell).

## 6. Open the page and play

Page URL (one line; `<name>` any profile name, `<f>` the faction id: Fire 0, Sentenced 1, Plague 2, Frost 3, Holy 4):

`http://127.0.0.1:8117/?server=ws%3A%2F%2F127.0.0.1%3A7817%2Fws&trainingServer=ws%3A%2F%2F127.0.0.1%3A7818%2Fws&accountApi=http%3A%2F%2F127.0.0.1%3A7817%2Fapi&profile=<name>&faction=<f>&diagnostic=1&token=t1&auto=0&fx.quality=high&scenario.probe=1`

Parameters: `server` the arena WebSocket; `trainingServer` the practice WebSocket; `accountApi` the HTTP API of the arena
server (point it at 7817, not 7818); `profile` and `token` a throwaway identity; `faction` the faction id; `diagnostic=1`
runs without accounts (an arena match works; practice does not, see step 7); `auto=0` stays in the hub; `fx.quality` the
quality preset; `scenario.probe=1` publishes the diagnostics probe (`window.__rhProbe`) that `where`, `anchors` and `goto {x,y}` read.
To play on the 7819 arena give the 7819 page URL explicitly: change only `server=` to `ws%3A%2F%2F127.0.0.1%3A7819%2Fws`; `accountApi` stays at 7817.

```
URL="http://127.0.0.1:8117/?server=ws%3A%2F%2F127.0.0.1%3A7817%2Fws&trainingServer=ws%3A%2F%2F127.0.0.1%3A7818%2Fws&accountApi=http%3A%2F%2F127.0.0.1%3A7817%2Fapi&profile=s1&faction=3&diagnostic=1&token=t1&auto=0&fx.quality=high&scenario.probe=1"
post "{\"cmd\":\"goto\",\"url\":\"$URL\"}"
post '{"cmd":"wait","ms":15000}'
post "{\"cmd\":\"shot\",\"path\":\"$OUT/00-hub.png\"}"
```

Done when the hub screenshot shows the lobby. Then enter the match (all click coordinates assume the 1920 x 1080 window of step 5): click START RUN at (163, 677), wait 3 s, press `1` or `2`
to pick one of the two spawns offered on the plan screen, click READY at (1390, 107), wait 4 s. Done when `where` (step 6b) answers a
position; if it answers `ERR`, the click missed: `shot` the screen, and repeat the pick and READY from the plan screen. The faction does NOT choose the zone you
start in (each session draws a new map): the plan offers two spawns in two OTHER zones, so take a Tab-map shot after joining
(`down` `Tab`, `shot`, `up` `Tab`) to see where you are, then walk to the zone or landmark you want. If `where` still answers `ERR`
after 30 s, read `errs`.

Moving: hold `W`, `A`, `S`, `D` with `down` and release with `up`. Keys act about 0.5 s after key-up, so near props or walls use
250 to 500 ms taps (`down`, `wait`, `up`), not long holds. Long walks: hold `Tab` (the map), right-click a point on the Tab map
to set a walk target, release `Tab`, wait. A walk target stays active and a held key overshoots while it is: clear the target first (tap any of `W`, `A`, `S`, `D` once; `goto {x,y}` does this itself). A target on a blocked tile, or inside a closed
building from the wrong side, makes no path and no movement: aim beside it, or at the building's entrance (step 6b).

### 6b. Find a landmark

Needs the page opened with `scenario.probe=1` (step 6) and a joined match. The landmark kinds are `volcano`, `church`, `bogtree`,
`cave`, `hall` (one per zone; the look scenes call the bog tree `bog`, the probe says `bogtree`); they exist only on the 7817
arena. Do not photograph an ordinary tree or hut for a landmark: go to its anchor.

```
post '{"cmd":"anchors"}'
post '{"cmd":"where"}'
post '{"cmd":"goto","x":368,"y":208,"within":48,"timeoutMs":60000}'
```

`anchors` answers a JSON list, one row per landmark: `{"kind":"cave","zone":4,"footprint":{"x":10,"y":5,"w":6,"h":6},"centre":{"x":368,"y":208},"entrance":[{"x":336,"y":336}]}`.
`footprint` is in tiles; `centre` and `entrance` are world units (32 per tile), the unit `where` and `goto` use. `[]` means this map
has no landmarks (the 7819 arena, or a fallback map): leave and join again. `where` answers `{"x":..,"y":..}`; `ERR ... scenario.probe=1`
means the page was opened without that parameter or the match is not joined yet.

`goto {x,y,within,timeoutMs}` (defaults 48 and 30000) walks to the point and answers
`{"ok":true,"reason":"reached","x":..,"y":..,"dist":..,"elapsedMs":..}`. Done when `ok` is true; then `shot` and check the picture shows
the landmark. Use `centre` for a landmark you can walk up to; a closed building is entered through an `entrance` point: go to it
first, then to `centre`. When it fails: reason `blocked` means it pushed 1.5 s without getting closer; it stopped with every key
released, at the position it answers, and does not path-find or retry, so pick another point (beside the blocked tile, or an
`entrance`) and call it again. Reason `timeout` means `timeoutMs` ran out; call it again (it continues from where you are) or raise
`timeoutMs`. `eval {js}` reads anything else the probe holds, for example `{"cmd":"eval","js":"window.__rhProbe.me.hp"}`.

## 7. Practice (the TRAINING button)

`diagnostic=1` disables TRAINING (the hub says "Unavailable"). Practice needs accounts: a throwaway Postgres, the
`--features postgres` build of step 1, and the URL WITHOUT `diagnostic=1` and with `accountApi` pointing at the practice server (7818).

```
RH_PGTEST_STATE=$OUT/pgstate TMPDIR=/private/tmp/rh-pg tools/pgtest/start.sh
```

(use a short `TMPDIR`: the unix-socket path has a length limit; `mkdir -p` it first). It prints `export DATABASE_URL=postgres://...`;
use that URL below, then start the practice server and stop it with its pid and `tools/pgtest/stop.sh` when done:

```
target/pg/release/rh-server --bind 127.0.0.1:7818 --database-url "$DATABASE_URL" --insecure-dev-auth --api-cors-origins http://127.0.0.1:8117 --runtime training > $OUT/training.log 2>&1 &
echo $! > $OUT/training.pid
```

## 8. What to capture and how to name it

- 1920 x 1080 PNG per `shot`, in `$OUT`, named `<NN>-<zone>-<what>.png` in the order taken (`10-frost-spawn.png`,
  `30-walkin-1.png`, `41-cave-inside.png`). Take the shots the task names, plus a wide one at the spawn.
- Landmark roofs: outside before entering (opaque), inside (about 10 percent), just after leaving (half), and back after
  about 45 s away (opaque again).
- After the last shot, send `errs` and keep the answer in `$OUT/errs.json`; an empty list `[]` is the expected answer.
- Report each file by absolute path with one sentence of what it shows. Never state a colour or a look you did not see in a
  screenshot you read.

## 9. The rules

- Stop only your own processes (those you started), by the pids you kept in `$OUT/*.pid` (`kill $(cat $OUT/arena.pid)`), never by name or
  pattern. First `{"cmd":"quit"}` to the driver; a later `kill` of the driver's pid may print "no such process", which is harmless. If you started the throwaway Postgres of step 7, stop it too with `tools/pgtest/stop.sh` (same `RH_PGTEST_STATE`), and the practice server by its pid.
- Restore `Assets/Scripts/BakedContent.cs` and `ProjectSettings/ShaderGraphSettings.asset` (step 3) and leave `git status` clean of everything the round touched.
- Never show the owner, or approve, a look from anything but Web screenshots (not editor renders, colour patches or
  texture composites). Editor renders of Plague and Sentenced scenes are darker than the Web client, so they cannot stand in.
- The Coliseum timer gives 10 minutes per session: a longer screenshot session ends in the result screen; join again.
- Do not edit code during a round; report what you saw.
