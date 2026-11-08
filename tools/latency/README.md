# Unity input-latency proof

`e2e.cjs` measures real Unity Web input through the actual browser WebSocket, authoritative self `move_seq` echo, and post-`Present` local and opponent traces. It launches two actual Unity browser clients. The observer must see exactly one remote human; absence, ambiguity, trace overflow, decoder/runtime errors, a missing stage, or a partial trial makes the run fail/incomplete. It does not read simulation state or synthesize protocol inputs.

The input path is measured at these boundaries:

1. Browser keyboard event driven by Playwright (no hardware input device timing).
2. Unity's `sampleMove` hook in `ReadInput` (with real order sequence and Unity frame).
3. The actual WebSocket Input frame sent in that same Unity frame.
4. An accepted server snapshot whose `me.moveSeq` echoes that order.
5. Unity's post-`Present` local trace and the observer Unity client's post-`Present` remote actor trace.

Unity `performance.now()` values are converted with each page's `performance.timeOrigin`. The observer actor is selected by the unique remote human row from the observer's own snapshots; its reference is never compared with the driver's Welcome ID. Post-`Present` means the managed presentation update completed; it does not claim photons or display scanout.

The report also summarizes each client's actual Unity Ping/Pong socket RTT, snapshot delivery gaps, and Unity frame
gaps. These observations cover the whole session, including startup, and help distinguish a transport delay from a
rendering pause. They are diagnostics rather than additional pass thresholds.

Before every input the harness requires the received and presented opponent pose to agree and remain stationary for at
least 350 ms. It then measures a post-send movement from that baseline. This prevents interpolation from the preceding
trial being mistaken for a response to the current input. Self presentation is the first presentation carrying the
confirmed movement echo; a future local predictor may display movement before that confirmation.

## Local run

Use the repository's Node setup and install the pinned browser-proof dependency from the repository root, as in
`CONTRIBUTING.md` (once per environment):

```sh
npm i --no-save playwright@1.63.0 && npx playwright install chromium
```

The harness resolves `playwright` from this checkout using normal Node resolution (`NODE_PATH` also works).
`RH_PLAYWRIGHT_MODULE=/absolute/path/to/playwright` overrides that resolution for an existing private install.
No machine-specific module path is assumed; `--help` works before Playwright is installed.

Build and run the Rust server on the duel map with exactly two real players and no bot fill. For this checkout:

```sh
cargo run -p rh-server -- --bind 127.0.0.1:7797 --map parity/maps/duel.map.json --min-players 2 --lobby-seconds 2 --fill-seconds 1 --fill-bots 0
```

Build the Unity Web player against the running server, then serve it:

```sh
RH_SERVER_INFO_URL=http://127.0.0.1:7797/info client-unity/UnityProject/Tools/build-web.sh
python3 -m http.server 8097 -d client-unity/UnityProject/Build/Web
```

Run the four added-RTT profiles (0, 50, 100 and 150 ms). The TCP proxy splits RTT evenly across both directions. Jitter is split the same way and sampled deterministically from a seeded stream. Every byte remains reliable and ordered. Optional periodic stalls model TCP head-of-line blocking; they do not emulate packet loss.

```sh
node tools/latency/e2e.cjs --sweep --trials 2 --jitter-ms 10
```

For a single profile use `--rtt-ms 50 --jitter-ms 10`. For separate stall experiments use `--rtt-ms 50 --stall-every 20 --stall-ms 100`; keep stall runs distinct from jitter-only runs when comparing. The JSON report defaults to `tools/latency/latency-report.json`; override with `RH_LATENCY_OUTPUT`.

## Existing HTTPS/WSS deployment

The same browser proof accepts a player URL and a direct WebSocket endpoint. Direct mode trusts the browser's normal public TLS validation and applies no impairment, because an HTTPS page cannot use a local insecure `ws://` proxy. It still records actual input-to-authoritative-self-and-opponent timings.

```sh
RH_LATENCY_CREDENTIALS_FILE=/absolute/private/test-players.json RH_LATENCY_DIRECT=1 node tools/latency/e2e.cjs \
  --url 'https://example.test/?server=wss%3A%2F%2Fgame.example.test%2Fws' \
  --server-url 'wss://game.example.test/ws'
```

The private credentials JSON has `driver` and `observer` objects, each with a `profile` (2–16 allowed callsign characters)
and `token`. Use authorized test players admitted to one controlled two-player match with no bot fill. Keep that file
outside Git; reports redact tokens. The harness does not create accounts, place matches, or bypass host admission.
Direct mode reports `injected: false` and rejects requested RTT/jitter injection. With a player HTTPS origin and no explicit
server URL, it uses the same origin's `/ws` endpoint.

For the local TLS fixture only, start `rh-server` with `--self-signed` and run with
`RH_LATENCY_ALLOW_SELF_SIGNED=1 --server-url wss://localhost:7798/ws`. That environment variable requires both the player URL and server URL to use loopback
hostnames. This tests Unity WSS behaviour while explicitly skipping trust for the generated loopback certificate; it does
not prove public certificate/DNS readiness.

Run the fast contract/scheduler tests with:

```sh
node --test tools/latency/latency.test.cjs
```

## All-five Unity Wish input proof

`wish-e2e.cjs` drives five fresh, real Unity WebGL clients through Playwright browser keyboard and pointer input. It
checks the faction-to-Wish mapping, Unity `ReadInput` sample marker, same-frame actual Cast frame and sequence, an own-caster
confirmed `castLanded` retaining the server's original `eventTime`, its exact `presentWishLanded` Unity marker, and an authoritative owner charge
update. It never calls the probe page's `P.cast`, `Session.Cast`, or sends a synthetic game WebSocket frame. Missing Unity
trace/art hooks produce an `INCOMPLETE` report; a successful run is not claimed until the composed player is built and run.
Unity trace recording is disabled during the ordinary opening-lock warm-up, while browser errors, decoder errors, and wire
capture remain active. It is enabled only after the authoritative owner baseline is ready; an overflow during a measured
case fails the report. Confirmed FX and presentation occurrence arrays retain receive order and keep same-tick events
separate rather than grouping by tick or ability.

The runner starts a new local `rh-server` process per ability with `--wish-full`, the two-spawn duel map, two humans,
zero bot fill, and training disabled. The controlled map is `tools/latency/wish-duel.json` (`rh-map/1`), a 16×10 enclosed
room with clear spawns at `[144,144]` and `[304,144]`. It waits for the server-published owner `readyAt` after the ordinary
45,000 ms opening lock; it does not change the clock or spend a stock early. The server binary and Unity build must come
from the same source/content revision. Build the server and use a temporary server on port 7796 to bake the Web content
hash before building the player:

```sh
cargo build -p rh-server
target/debug/rh-server --bind 127.0.0.1:7796 --map tools/latency/wish-duel.json --min-players 2 --lobby-seconds 2 --fill-seconds 1 --fill-bots 0 --wish-full
RH_SERVER_INFO_URL=http://127.0.0.1:7796/info client-unity/UnityProject/Tools/build-web.sh
```

Stop that temporary server after the Web build, serve `client-unity/UnityProject/Build/Web` on HTTP port 8097, and run:

```sh
node tools/latency/wish-e2e.cjs
```

The runner accepts only loopback `http://` or `https://` Unity Web URLs. Each local server binds `127.0.0.1`; by default,
the runner picks an ephemeral port with a brief bind-zero probe, then starts its own child. If another process wins the
release-to-bind race, that case fails and the runner leaves the other listener alone. `--port-base N` optionally requests
a fixed range of five ports and fails closed if the child cannot bind. Use `--url http://127.0.0.1:8097/`, `--server-bin PATH`,
`--map PATH`, `--port-base N`, `--headed`, and `--timeout-ms N` to override local defaults. Each case gets a fresh pair of browser clients.
The default timeout is 90 seconds to include the unmodified opening lock. The JSON report defaults to
`tools/latency/wish-report.json`; screenshots are saved under `tools/latency/wish-evidence/`. These are generated evidence
outputs and should be reviewed before publication. The report records each actual port, full server `/info` response, and
SHA-256 hashes for the server binary and map. The runner uses the v12 decoder from `crates/rh-server/web/probe.html`
as a decoder only; its public probe input helpers are never invoked.

Check the report's fail-closed contract without starting Unity, Chromium, or a server:

```sh
node --test tools/latency/wish-proof-contract.test.cjs
```

These contract tests use synthetic in-memory reports to check verdict rules; they are not executed game evidence. No
browser/Unity run is included here. A real all-five result requires the composed build and a saved `wish-report.json` with
five passing cases and their screenshots.
