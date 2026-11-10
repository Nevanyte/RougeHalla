# Frozen B M5 Pro capture preparation

This is **offline preparation only**. No browser, native server, player admission or instrumentation window has been run.
Root must first resolve the Computer Use requirement for the separate Playwright test browser. The environment marker
below records that review; setting it is not itself permission. Do not run while the owner needs exclusive foreground
input in another game. The public demo and existing user browser are outside this runner.

The entry point uses the existing Node22.23.4/Playwright installation, Web B `build_81371688fcdf` and Mac B binary.
No install, Unity command, rebuild, profile migration, TLS setup or control endpoint is performed.

## Offline command

From this checkout, with the existing pinned Node:

```sh
/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/map-styled-bench/npm-cache/_npx/361c55be1121897e/node_modules/node/bin/node client-unity/UnityProject/Tools/profile-m5-b.cjs --check
```

This hashes the pinned native/map/manifests and streams the15-URL sealed asset integrity check. It reads installed
Playwright/executable metadata. It never binds a port, launches Chromium/native or touches a player/database.

## Reviewed execution command — not executed in this packet

Root supplies its exact existing local peer-socket database below, with the ordinary `rh_game` role. An already prepared
dedicated `rh_m5_profile` or `rh_m5_profile_<suffix>` database is also accepted. The frozen server runs its normal
readiness/migration path; the runner does not start, stop or create PostgreSQL. It uses only fresh normal profile claims;
no new grants, profile deletion or changes to existing accounts. `RH_M5_DATABASE_URL` must be a
credential-free Unix-socket DSN, without password or remote host.
The native binary only accepts it through `--database-url`; the wrapper converts this environment prerequisite into
native argv after validating it and omits the URI from reports. A password-bearing URI is refused.

```sh
RH_M5_BROWSER_REVIEW=approved \
RH_M5_DATABASE_URL='postgresql://rh_game@localhost/roguehalla?host=%2Fprivate%2Ftmp%2Frh-browser-c52-pg-65439&port=65439' \
RH_M5_OUT='/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/coordination/reports/m5-profile-reviewed-01' \
/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/map-styled-bench/npm-cache/_npx/361c55be1121897e/node_modules/node/bin/node client-unity/UnityProject/Tools/profile-m5-b.cjs --run
```

The existing socket/database must still be ready when Root leases a run; this packet did not connect to it. The output directory must not
exist. Source17837 and static18243 must be unused. A bind collision aborts without stopping its owner; after startup an
owned-PID `lsof` check prevents accidentally attaching to another listener. Nothing uses ports7777/7779/8888.

## One bounded workload

- Launch one bundled headed Chromium with `chromiumSandbox:true` and the supported
  `ignoreDefaultArgs:['--enable-unsafe-swiftshader']` filter. These are two deliberate changes to Playwright's defaults;
  other default arguments remain. Read back the effective command line and refuse the run if `--no-sandbox` or
  `--enable-unsafe-swiftshader` is present, including value-suffixed spellings. Record these checks, version,
  viewport/DPR/canvas and renderer. The new nonpersistent context has no user profile,
  storage import, HAR or trace. Outbound HTTP is restricted to the two loopback origins.
- Visit the frozen Hub with endpoint-only `server` and `accountApi` overrides. Type a fresh callsign, click LOAD,
  select Holy and START RUN through normal canvas UI. Only HTTP status is observed for the profile claim; its private
  response body/headers are not read by this runner. No recovery key, token query, auto-join handler or app global is used.
- Admit two normal owned public companion seats concurrently within the ordinary lobby window. Require both returned
  public MatchIds to equal the browser's public Welcome before any Plan/input work. Choose spawn and READY through the
  actual UI; helpers use ordinary validated Plan inputs. Require Active, alive, nontraining state.
- Confirm ordinary short movement, allow10s warmup, then take **one30s** measurement with alternating short A/D pulses.
  No attacks, R, stat changes, debug commands, scripted game-rule calls or survival repairs. The existing small48×40 map,
  three seats, default presentation,1280×720/DPR1 and this movement schedule define the workload. A blocked movement or
  lost gate aborts; the runner never silently retries with a different workload.
- Release keys and use normal Leave; normal Leave/close both helpers; detach collector; close only the fresh context and
  owned browser. SIGTERM the owned native child after player cleanup, with a recorded owned-child-only SIGKILL fallback.
  Close only the owned static listener. Keep reports/spool for review. An8min watchdog and fixed failure codes bound the run.

## Metrics and limits

`profile.json` records requested and actual duration separately; raw RAF callbacks, callback CPU, available GPU samples,
memory samples, long tasks, resource timings, WS RTT samples and application byte totals come from the existing profiler.
The native/Web source hashes and dependencies are included. No raw protocol frames, credentials, private account bodies,
arbitrary error messages, remote browser endpoints or user browser profile paths are written.

This first capture is **loopback HTTP/WS**. It establishes no WSS, TLS, Calgary, packet-loss, network-interface or Unity
Session RTT result. Observer RTT includes callback scheduling. RAF cadence includes display/browser pacing; synchronous
callback cost is not total browser CPU or Unity PlayerLoop. JS heap/Wasm memory is not total process/RSS/GPU memory.
Unsupported GPU elapsed statistics are absent. Available samples retain the unchanged hook's **UNALIGNED** warning:
pending warmup queries can resolve in the window, so this is not a strict-window GPU distribution. Buffer counters are
page-lifetime values. Focus/visibility loss or stale/dead/closed/replaced game connection makes the capture incomplete.
The raw reported WebGL renderer is retained and classified as `software`, `hardware-indicated` or `unknown`.
Explicit software descriptors take priority; generic backend/vendor names remain unknown. A concrete adapter descriptor
is only an indication, not verified GPU execution. Host CPU identity is not renderer evidence; software/unknown results
make no M5 GPU performance claim. This single measured30s local scenario establishes no target FPS, full-map result or
legacy baseline.

Browser APIs are the existing [Playwright isolated-context API](https://playwright.dev/docs/api/class-browser) and
Chromium's read-only [command-line metadata API](https://chromedevtools.github.io/devtools-protocol/tot/Browser/#method-getBrowserCommandLine).
[Playwright launch options](https://playwright.dev/docs/api/class-browsertype#browser-type-launch) document the sandbox
option and individual default-argument filtering used here.
Actual browser execution still depends on Root's Computer Use review.

## CUA adapter boundary — not implemented in this finite packet

Root subsequently selected app-owned instrumentation plus CUA for the first actual measurement. **Do not run this CLI
as a substitute for that decision.** The CLI implementation and its offline controls are retained for review; no actual
capture is claimed. Its Playwright callback/evaluate collector cannot simply be attached to an in-app-browser handle.

The exact missing adapter is:

1. A `--serve-cua` backend mode that never imports/launches/controls Playwright. It owns only the separate native/static
   processes and normal helper seats, with the same hashes, ports, validated local database and cleanup boundaries.
2. An output-directory copy of B's `index.html` with the existing passive profiling hook and public P14 Tracker loaded
   before Unity. Record copy/preload/overlay hashes separately. Original HTML and all WASM/data/assets remain untouched.
3. In-page passive Welcome/Snapshot/State/Ping/Pong observation, discarding private resume/auth fields immediately and
   never inspecting outbound Hello credentials. Gate on current Active/alive/nontraining and matching actual public
   room/peers. Root drives all Hub, Plan, movement and Leave through CUA. A small visible Start/Stop/status/report panel
   begins one fixed30s window only after10s warmup and the real gate; no game handlers or globals provide shortcuts.
4. Either a bounded visible report download or a same-origin, exact-loopback POST receiver with explicit field/type/array
   limits and a strict body cap (for example8MiB). Admit only scalar public identities, bounded raw metric samples and
   availability/limit fields. Reject unknown fields; never accept account bodies, auth/session values, frame payloads,
   URLs, arbitrary error strings or control input. Sanitize in-page data before it crosses to Node.
5. A normal public readiness signal to admit the helpers within the real lobby window, and returned same-MatchId checks.
   No browser launch, socket manipulation, scripted click/keyboard calls or user-profile access from the CLI. Browser
   version/default flags must come from supported CUA metadata where available; otherwise record them as unavailable.

This adapter requires a separate bounded implementation/review of in-page collection and report validation. It was not
expanded into this entrypoint packet. No listeners, browser sessions, joins or instrumentation were started to test it.
