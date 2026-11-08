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
RH_PLAYWRIGHT_MODULE=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/browser/node_modules/playwright \
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
`RH_LATENCY_ALLOW_SELF_SIGNED=1 --server-url wss://localhost:7798/ws`. That environment variable is rejected for an external
hostname. This tests Unity WSS behaviour while explicitly skipping trust for the generated loopback certificate; it does
not prove public certificate/DNS readiness.

Run the fast contract/scheduler tests with:

```sh
node --test tools/latency/latency.test.cjs
```
