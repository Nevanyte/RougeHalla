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
- Free ports: 7817 (arena server), 7818 (practice server, only for step 7), 7819 (second arena, without landmarks), 8117 (page), 9777 (driver). Done when `lsof -i :7817 -i :7818 -i :7819 -i :8117 -i :9777` prints nothing.
- Rust: `export PATH="$HOME/.cargo/bin:$PATH"`.
- A scratch folder for logs, pids and screenshots outside the repository; below it is `$OUT` (`mkdir -p $OUT`).

## 1. Build the server

```
cargo build --release -p rh-server
```

Done when it ends with `Finished` (about 40 s warm). Practice (step 7) needs the Postgres build instead, a second
binary built over the same path:

```
cargo build --release -p rh-server --features postgres
```

## 2. Start the arena server (a solo room)

Pooled landmark maps: the pool is built into `rh-server`; `--map-pool` is a bare switch (no directory), `--signature-landmarks`
needs it, and `--map` is the pool's last-resort map. `--fill-bots 0` makes a solo room: with more than a few fill bots the
match ends in about a minute ("last standing"), with 7 you die in seconds. Note the pid; you stop only this one.

```
target/release/rh-server --bind 127.0.0.1:7817 --insecure-dev-auth --api-cors-origins http://127.0.0.1:8117 --runtime source-arena --map crates/rh-sim/src/mapdata/fixtures/seed1.map.json --map-pool --signature-landmarks --min-players 1 --fill-bots 0 --lobby-seconds 8 --fill-seconds 2 > $OUT/arena.log 2>&1 &
echo $! > $OUT/arena.pid
curl -s http://127.0.0.1:7817/info
```

Done when `/info` answers `{"contentHash":"...","protocol":N,"state":"ready"}`; the log says "map pool on". Each session
draws a new pooled map.

Without landmarks (second arena, own port 7819; needed to see the Sentenced floor scatter, because `--signature-landmarks`
makes the server's ground-variant bands cover it). Use `--api-cors-origins` as above and open the page with `server=` pointing to 7819:

```
target/release/rh-server --bind 127.0.0.1:7819 --insecure-dev-auth --api-cors-origins http://127.0.0.1:8117 --runtime source-arena --map crates/rh-sim/src/mapdata/fixtures/seed1.map.json --map-pool --min-players 1 --fill-bots 0 --lobby-seconds 8 --fill-seconds 2 > $OUT/arena2.log 2>&1 &
echo $! > $OUT/arena2.pid
```

## 3. Build the Web client

The client bakes the server's content hash from `/info` into `Assets/Scripts/BakedContent.cs` before compiling, so the server
of step 2 must already answer. Close the editor first. Takes 6 to 7 minutes.

```
RH_SERVER_INFO_URL=http://127.0.0.1:7817/info client-unity/UnityProject/Tools/build-web.sh > $OUT/unity-build.out 2>&1
echo $?
tail -n 5 $OUT/unity-build.out
```

A clean run exits 0 and prints `Baked authoritative content hash <hex>`, `Building Web player; log: ...` and
`Audio check: all streamed files present`; `Logs/web-build.log` has no line with `Shader error`. A failing build exits 1 with
`error: a Roguehalla shader failed to compile for WebGL` and a line like
`Shader error in 'Roguehalla/RegionGround': maximum ps_5_0 sampler register index (16) exceeded ...`: the player files may
still be fresh (the later checks did not run) but report it; do not approve a look from it. Then restore the baked file
(the build rewrites it; never commit it):

```
git checkout -- client-unity/UnityProject/Assets/Scripts/BakedContent.cs
```

Done when `git status` shows no change to `BakedContent.cs`.

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
`ok` (or `ERR ...`). Commands: `goto {url}`, `move {x,y,steps}`, `click {x,y,button}` (`button` `left` or `right`), `down {key}`,
`up {key}`, `press {key}`, `wait {ms}`, `shot {path}`, `errs` (browser console errors so far, JSON), `quit`. A shell does not
expand variables inside single quotes, so define one helper and build each JSON with double quotes where it needs a variable:

```
post() { curl -s -X POST http://127.0.0.1:9777 -d "$1"; echo; }
post '{"cmd":"wait","ms":1000}'
```

Done when that prints `ok`. Define `post` again in every new shell.

## 6. Open the page and play

Page URL (one line; `<name>` any profile name, `<f>` the faction id: Fire 0, Sentenced 1, Plague 2, Frost 3, Holy 4):

`http://127.0.0.1:8117/?server=ws%3A%2F%2F127.0.0.1%3A7817%2Fws&trainingServer=ws%3A%2F%2F127.0.0.1%3A7818%2Fws&accountApi=http%3A%2F%2F127.0.0.1%3A7817%2Fapi&profile=<name>&faction=<f>&diagnostic=1&token=t1&auto=0&fx.quality=high`

Parameters: `server` the arena WebSocket; `trainingServer` the practice WebSocket; `accountApi` the HTTP API of the arena
server (point it at 7817, not 7818); `profile` and `token` a throwaway identity; `faction` the faction id; `diagnostic=1`
runs without accounts (an arena match works; practice does not, see step 7); `auto=0` stays in the hub; `fx.quality` the
quality preset.

```
URL="http://127.0.0.1:8117/?server=ws%3A%2F%2F127.0.0.1%3A7817%2Fws&trainingServer=ws%3A%2F%2F127.0.0.1%3A7818%2Fws&accountApi=http%3A%2F%2F127.0.0.1%3A7817%2Fapi&profile=s1&faction=3&diagnostic=1&token=t1&auto=0&fx.quality=high"
post "{\"cmd\":\"goto\",\"url\":\"$URL\"}"
post '{"cmd":"wait","ms":15000}'
post "{\"cmd\":\"shot\",\"path\":\"$OUT/00-hub.png\"}"
```

Done when the hub screenshot shows the lobby. Then enter the match (all click coordinates assume the 1920 x 1080 window of step 5): click START RUN at (163, 677), wait 3 s, press `1` or `2`
to pick one of the two spawns offered on the plan screen, click READY at (1390, 107), wait 4 s. The faction does NOT choose the zone you
start in: the plan offers two spawns in two OTHER zones, so walk to the zone or landmark you want.

Moving: hold `W`, `A`, `S`, `D` with `down` and release with `up`. Long walks: hold `Tab` (the map), right-click a point on the
Tab map to set a walk target, release `Tab`, wait. A walk target stays active: later WASD does not cancel it at once, so
expect to overshoot; and a target set inside a closed building from the wrong side makes no path and no movement.

## 7. Practice (the TRAINING button)

`diagnostic=1` disables TRAINING (the hub says "Unavailable"). Practice needs accounts: a throwaway Postgres, the
`--features postgres` build of step 1, and the URL WITHOUT `diagnostic=1` and with `accountApi` pointing at the practice server (7818).

```
RH_PGTEST_STATE=$OUT/pgstate TMPDIR=/private/tmp/rh-pg tools/pgtest/start.sh
```

(use a short `TMPDIR`: the unix-socket path has a length limit; `mkdir -p` it first). It prints `export DATABASE_URL=postgres://...`;
use that URL below, then start the practice server and stop it with its pid and `tools/pgtest/stop.sh` when done:

```
target/release/rh-server --bind 127.0.0.1:7818 --database-url "$DATABASE_URL" --insecure-dev-auth --api-cors-origins http://127.0.0.1:8117 --runtime training > $OUT/training.log 2>&1 &
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
  pattern. First `{"cmd":"quit"}` to the driver. If you started the throwaway Postgres of step 7, stop it too with `tools/pgtest/stop.sh` (same `RH_PGTEST_STATE`), and the practice server by its pid.
- Restore `Assets/Scripts/BakedContent.cs` (step 3) and leave `git status` clean of everything the round touched.
- Never show the owner, or approve, a look from anything but Web screenshots (not editor renders, colour patches or
  texture composites). Editor renders of Plague and Sentenced scenes are darker than the Web client, so they cannot stand in.
- Do not edit code during a round; report what you saw.
