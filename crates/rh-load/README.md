# rh-load: load and soak harness for rh-server

`rh-load` opens ordinary authenticated WebSocket sessions (`ws://` or `wss://`) to a real `rh-server`, speaks the
current wire protocol (v5, through the `rh-protocol` library: Hello with callsign and ticket, Welcome, snapshots and deltas,
Input, Ping, Leave, resume with the session token), joins matches and sends scripted inputs at human cadence. It measures
what the server does under that load and writes a raw JSON report plus a human summary.

It is scripted only: no learned model, no game rule. The client chooses click targets (random floor tiles of the Welcome map),
aim angles and whether to hold the trigger; the server's simulation validates and applies everything. The only `rh-sim` use
is the content hash for the Hello and the world tile size for turning a floor tile into a click target.

Everything it measures about the slice is labelled **baseline slice only, not full-game capacity**.

## Build and run

```sh
source <scratchpad>/rh-env.sh                       # pinned Rust 1.97.0 (only needed in this repo's agent setup)
cargo build --release --locked -p rh-server -p rh-load

# One scenario against a server the harness spawns (a --release build; native arm64 on the M5 Pro):
target/release/rh-load run --server-bin target/release/rh-server \
    --matches 10 --players-per-match 8 --ramp-per-sec 5 --duration 60 \
    --label demo --out-dir target/load --hardware-label "Apple M5 Pro 18-core 64 GB"

# A density sweep: a fresh server per level, one JSON per level plus a table:
target/release/rh-load sweep --server-bin target/release/rh-server --levels 10,25,50,100,200 \
    --duration 60 --ramp-per-sec 10 --label sweep --out-dir target/load

# Attach to a server somebody else started (for example in Docker; no CPU/RSS sampling without --pid):
target/release/rh-load run --target 127.0.0.1:7777 --control 127.0.0.1:7778 --dev-auth --emulated --matches 5 --duration 60
```

Output goes to `--out-dir` (default `target/load`): `<label>.json` (everything, including a per-sample time series),
`<label>.summary.txt` (the same figures as text), `<label>.server.log` (the spawned server's stdout/stderr, not committed;
`*.log` is git-ignored). A sweep also writes `<label>-sweep.json` and `<label>-sweep.txt`.

## How a run works

1. **Credentials.** The harness generates throwaway callsign/token pairs (`lt<run>p<n>`, 32 hex digits, from the OS RNG), writes
   them to `<out-dir>/<label>.auth.tmp` (mode 0600, one `callsign token` per line), starts the server with
   `--auth static:<that file>` and deletes the file at the end. Tokens are never printed or recorded in reports. With an attached
   server (`--target`) use `--dev-auth` (server started with `--auth dev`, any ticket).
2. **Cold start.** The harness spawns `rh-server` and records the time to `GET /control/health` = 200 and to the public port
   accepting TCP.
3. **Ramp.** `--matches N` groups of `--players-per-match P`, one group every `1/--ramp-per-sec` seconds, players of a group
   `--join-stagger-ms` apart. The server's open-lobby rule (fullest lobby first) turns the stream of Hellos into rooms of 8.
4. **Steady window.** Starts 3 s after the last player's first connect and lasts `--duration` seconds. Snapshot-interval statistics
   count only inside it. A player whose match ends (its Result arrives) leaves and queues again unless `--no-rejoin`.
5. **End.** All clients Leave; the harness takes the final server metrics; the spawned server gets SIGTERM.

### Scenario options

| option | meaning |
|---|---|
| `--matches N --players-per-match P` | concurrent matches wanted and humans per match (1..=8) |
| `--ramp-per-sec R --join-stagger-ms MS` | ramp rate (matches/s) and the gap between one match's joins |
| `--duration S` | steady-window seconds |
| `--think-ms MS` | mean ms between a player's input frames (jittered 0.5x to 1.5x); a ping goes every second |
| `--aggression A` | 0..1, chance per input frame to attack a visible enemy and to walk toward it. 0 = movement only, matches never end |
| `--reconnect-fraction F --reconnect-every S --reconnect-delay-ms MIN:MAX` | that fraction of players drop their socket (no Leave) about every S seconds, wait MIN..MAX ms, and resume with the session token (the server holds the seat 10 s) |
| `--churn-clients K --churn-dwell MIN:MAX` | K extra clients that join a lobby, linger MIN..MAX seconds, Leave and repeat |
| `--slow-fraction F --slow-stall-secs S` | that fraction of players use a 2 KiB receive buffer and stop reading for S seconds while pinging at 25/s, then read again and report how the server ended them (reject code, `closed`, or `survived`). The server ends a stalled reader with `TooSlow` when 256 important frames queue behind a blocked socket; on loopback the OS buffers (about 130 KiB) must fill first, so use S of 120 or more |
| `--max-rooms N --min-players N --lobby-seconds S --fill-seconds S --fill-bots N` | server settings used when the harness spawns the server (overload: `--matches` above `--max-rooms`; refused players retry and are counted by reason) |
| `--shutdown-at S --shutdown-mode sigterm\|drain --drain-wait S` | S seconds into the steady window send SIGTERM (spawned server) or `POST /control/drain`; probe a fresh admission every 500 ms; wait up to `--drain-wait` for the server to finish and exit |
| `--tls --insecure` | wss to a `--self-signed` server; `--insecure` accepts its certificate (local only; without it the webpki roots verify a real certificate) |
| `--server-args "..."` | extra whitespace-separated arguments for the spawned server (for example `--map parity/maps/seed1.map.json`) |
| `--seed N --sample-secs S` | RNG seed (roles and jitter; the same seed gives the same plan) and sample period |
| `--emulated --hardware-label T --build-profile P` | recorded in the report (the harness cannot tell an emulated server from a native one) |

## What is measured, and how

| quantity | method | boundary |
|---|---|---|
| per-host room capacity | `GET /control/health` `rooms` each sample; players admitted vs refused; `capacity.roomsSteadyMean`, `playersNeverAdmitted` | one host, loopback, harness on the same machine |
| server CPU and RSS | `ps -o cputime=,rss= -p <pid>` each sample; CPU = delta of cumulative CPU seconds over wall time (1.0 = one busy core) | 10 ms resolution on macOS; the harness's own CPU and RSS are sampled the same way (`harnessCpuCores`) |
| tick cost | server `metrics` from `/control/health`: `stepUs` (one room's simulation step), `publishUs`, `latenessUs` (wake late vs its grid slot), `droppedSteps` | cumulative histograms of the whole server run (a fresh server per run), quantiles are bucket upper bounds at most 25% above truth, **no server-side p95 exists** |
| tick as clients see it | interval between consecutive snapshots at each client, 1 ms histogram (p50/p95/p99/p99.9/max), count over 100/200/500 ms, snapshot ticks skipped | includes harness scheduling noise; steady window only |
| deadline misses | `droppedSteps` (pacer backlog beyond catch-up), `latenessUs`, client late-snapshot counts | the server has no "deadline missed" counter beyond these |
| bandwidth per client | WebSocket payload bytes in and out per play session divided by its connected seconds (sessions of at least 5 s) | no WS/TCP/TLS framing |
| join / placement latency | Hello sent to Welcome received; Welcome to first Snapshot; TCP+WS connect; resume Hello to Welcome | client-observed, loopback |
| reconnects | attempts, successes, failures by reject code | resume happens inside the 10 s grace by construction (`--reconnect-delay-ms` max 8000) |
| refusals | `Reject` codes at admission, counted by reason | counted per attempt, a refused player retries every 1 to 3 s |
| cold start | spawn to control health 200, spawn to TCP accept | process start only, not an image pull or VM boot |
| shutdown | probes during drain, fresh vs resume Welcomes after the trigger, results after the trigger, abnormal session ends, time to server exit | see `shutdown` in the report |

A level is called **degraded** (`verdict`) when any of these holds: server `droppedSteps` > 0, `stepUs` p99 > 25 ms (half a
tick), `latenessUs` p99 > 25 ms, client snapshot interval p99 > 100 ms, or more than 0.5% of snapshot ticks missed. These thresholds
are a harness choice, written into every report next to the verdict; they are not a server contract.

Every report records: git revision (with `-dirty` if tracked files differ), host (CPU brand, logical cores, memory, OS, arch),
`emulated`, server binary and guessed build profile, the full scenario, durations, command line and the raw output path.

## Tests

```sh
cargo test -p rh-load            # 31 unit tests (scenario parsing, stats math, script, ps/http parsing, reports) + 2 integration tests
```

The integration tests (`tests/smoke.rs`, about 10 s) run an in-process `rh-server` with static auth on real sockets and drive a
tiny scenario (play, reconnect, lobby churn, overload refusals, drain refusal, bad credentials).
