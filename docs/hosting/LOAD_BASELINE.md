# Local density baseline (P-CLAUDE-INFRA-1 section 3; backlog P-LOAD-1/2)

**Baseline slice only, not full-game capacity.** Every number here is one `--release` `rh-server` running today's slice game,
measured over loopback on one developer machine with the load harness on the same machine. None of it sizes a production
fleet, a pricing model or an AWS instance type. Final full-game capacity needs a refreshed build after gameplay is complete
(gate pending). Extrapolations are labelled as such; everything else was measured.

## What was measured, on what

| | |
|---|---|
| Server revision | `3d91abc3` (the branch base; this branch does not change any `rh-server` file). `target/release/rh-server` built with `cargo build --release --locked -p rh-server`, profile `release` (`debug = 1`), protocol 5, content hash `aa629bdb1a320371` |
| Harness | `crates/rh-load` (README there has every command). The sweeps and soak below ran from the working tree that became commit `1aeb83fb` (reports say `3d91abc3...-dirty` for that reason); the `final/` runs ran from the clean commit `1aeb83fb`. Between the two, only clippy-driven refactors changed (a loop form, an `is_nan` check, struct-literal construction in `main.rs`) |
| Hardware | Apple M5 Pro, 18 logical cores, 64 GB, macOS (Darwin 25.6.0), arch aarch64 |
| Execution | **Native arm64, not emulated.** Server and harness are separate processes on the same host, plain `ws://` over loopback unless noted (one `wss://` run, self-signed, certificate not verified) |
| Server options | `--max-rooms <levels+8> --min-players 8 --lobby-seconds 15 --fill-seconds 0 --fill-bots 0 --auth static:<throwaway file>`; practice map; default 20 Hz tick |
| Time | 2026-11-05 |
| Raw outputs | `docs/hosting/evidence/load/{sweep,soak,final}/*.json` (every report includes revision, host, scenario, timing, command and a time series) and the matching `*.summary.txt`. The reports' `meta.rawOutput` and `serverLog` fields name the original `target/load/...` paths; server stdout logs (a few lines each) stay under `target/` (git-ignored `*.log`) |

**Historical verdict limitation:** the raw reports below used steady-window missed ticks divided by all-run snapshot counts,
including the ramp. That can understate the missed fraction near the 0.5% threshold. The harness now uses only measured
steady-window intervals as its denominator. These historical files are unchanged; no refreshed capacity measurement is
claimed by the correction.

Method notes (exact definitions are in `crates/rh-load/README.md`): server CPU and RSS are sampled with
`ps -o cputime=,rss= -p <server pid>` every second (2 s in the soak); CPU is the delta of cumulative CPU time over wall time, so
1.0 means one fully busy core (10 ms resolution). Server tick figures come from `GET /control/health` `metrics`: they are
cumulative histograms over the whole run (a fresh server per level), quantiles are bucket upper bounds (at most 25% above the
true value). Client tick figures are the interval between consecutive snapshots as each client sees them, in the steady
window, 1 ms resolution. Bandwidth is WebSocket payload bytes per client per second.

## Density sweep (8 humans per match, 40 s steady window per level, fresh server per level)

Two load shapes: **movement-only** (`--aggression 0`: players click-move around the map and never attack, so matches do not
end) and **combat** (`--aggression 0.5`: players walk toward and attack visible enemies; matches end and players re-queue, so
the room count runs a little above the level). Think time 150 ms mean per input frame, a ping every second per client.
"Degraded" uses the harness thresholds (any of: server `droppedSteps` > 0, `stepUs` p99 > 25 ms, wake lateness p99 > 25 ms,
client snapshot interval p99 > 100 ms, > 0.5% snapshot ticks missed). The thresholds are a harness choice, not a server contract.

| mode | matches | players | rooms (steady mean) | server CPU (cores) | server RSS peak MB | harness CPU (cores) | server step p50/p99/max us | dropped steps | wake lateness p99 us | client interval p50/p95/p99 ms | ticks missed | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| move | 10 | 80 | 10 | 0.06 | 11 | 0.05 | 31/159/1100 | 0 | 3,583 | 50/51/53 | 0 | ok |
| move | 25 | 200 | 25 | 0.13 | 19 | 0.10 | 31/127/934 | 0 | 2,047 | 50/51/51 | 0 | ok |
| move | 50 | 400 | 50 | 0.23 | 32 | 0.18 | 31/191/4201 | 0 | 2,559 | 50/51/51 | 0 | ok |
| move | 100 | 800 | 100 | 0.40 | 58 | 0.33 | 23/95/610 | 0 | 2,559 | 50/51/51 | 0 | ok |
| move | 200 | 1,600 | 200 | 0.78 | 110 | 0.65 | 23/159/2000 | 0 | 2,559 | 50/51/52 | 0 | ok |
| move | 400 | 3,200 | 400 | 1.72 | 212 | 1.49 | 23/95/3447 | 0 | 2,559 | 50/51/52 | 0 | ok |
| move | 800 | 6,400 | 800 | 3.40 | 417 | 3.19 | 23/95/8378 | 0 | 4,095 | 50/53/54 | 0 | ok |
| move | 1,000 | 8,000 | 1,019 | 2.64 | 501 | 1.89 | 19/79/4184 | 0 | **32,767** | 50/52/54 (max 3,000) | 11,300 | **degraded** (wake lateness) |
| move | 1,200 | 9,600 | 1,208 | 2.56 | 543 | 1.67 | 19/95/16722 | **4,658** | 57,343 | 0/52/128 | 35,155 | **degraded** (connected clients fell from 8,200 to 4,130 within the window) |
| move | 1,600 | 12,800 | 905 | 2.12 | 528 | 0.94 | 19/111/62539 | 34 | 49,151 | 0/176/1,071 | 12,739 | **degraded** (collapse: 1,516 players never admitted) |
| combat | 50 | 400 | 51 | 0.27 | 34 | 0.22 | 39/319/1668 | 0 | 2,559 | 50/51/52 | 0 | ok |
| combat | 200 | 1,600 | 207 | 0.92 | 117 | 0.80 | 23/159/3227 | 0 | 2,559 | 50/51/52 | 0 | ok |
| combat | 400 | 3,200 | 423 | 1.83 | 229 | 1.61 | 15/95/6528 | 0 | 2,559 | 50/51/52 | 0 | ok |
| combat | 800 | 6,400 | 853 | 2.20 | 442 | 1.95 | 15/191/68628 | **36,847** | 229,375 | 50/182/395 | 729,331 | **degraded** |

Raw: `evidence/load/sweep/` (`sweep-native-*` movement, `sweep-combat*` combat; each level's JSON and summary, plus the
`*-sweep.txt` tables). The scenario's headline 200 matches / 1,600 players ran clean in both shapes.

**Reading it (measured, then interpretation):**

- Healthy up to **800 concurrent matches (6,400 players) movement-only** and **400 matches (3,200 players) combat** on this host;
  first degradation at 1,000 matches movement-only (wake lateness p99 33 ms, 11,300 missed snapshot ticks, nothing dropped) and at
  800 matches combat. The 1,000-match level is the edge of the movement-only range; 1,200 and above is overload. Server CPU per
  match is about 4 millicores at 800 movement-only (3.4 cores / 800), roughly linear from 10 matches up (0.06 cores at 10).
- The simulation step is not what limits density here: step p99 stays under 0.35 ms (combat 50: 319 us) until the server is
  already late, and the whole server uses about 2 to 3.4 cores of 18 when it degrades, with the harness using a similar amount.
  Degradation shows up as late wakes, dropped steps and missed snapshot ticks while both processes leave most cores idle. That points to
  something other than game CPU: the shared loopback network stack (about 128,000 server-to-client frames per second at 800 matches,
  192,000 at 1,200), the tokio scheduler, or the harness competing on the same machine. **This run does not determine which**
  (no profiling was done), so do not read the 1,000-match edge as a property of the server on Linux with a real NIC.
- Bandwidth per client is about **1.17 KB/s in and 97 B/s out** movement-only (about 1.45 KB/s in combat), independent of level
  while healthy (WebSocket payload only).
- Admission: Hello to Welcome p50 0.10 to 0.12 ms at every healthy level; p99 rises from 0.17 ms (10 matches) to 3.4 ms (800) as
  the whole ramp arrives together. Welcome to first snapshot is dominated by the 50 ms tick (p50 about 27 to 34 ms).
- Cold start (spawn to `/control/health` 200): 4 to 5 ms warm on every run; **313 ms for the first launch of a freshly
  built binary** (`smoke-ws`, run right after a build; 410 ms in an earlier uncommitted run). Process start only: not an image pull, VM boot or GameLift process start.
- At the failing levels the server log and reports show `Kicked`, `closed`, handshake and connect timeouts and refusals
  (`MatchFull` once the room cap of level+8 is full of re-queuing players, `ProfileInUse`): an overloaded or starved server turns
  into refused and dropped players, so the capacity figure is the last healthy level, not the last level that ran.

## Soak (11 minutes steady, reconnects, joins and leaves)

`rh-load run --matches 50 --duration 660 --ramp-per-sec 5 --aggression 0.25 --reconnect-fraction 0.2 --reconnect-every 20 --churn-clients 8 --slow-fraction 0.01 --slow-stall-secs 120 --sample-secs 2` (400 scripted players, 8 lobby churners,
4 slow-consumer players; 675 s total). Raw: `evidence/load/soak/soak-native.json`.

| | |
|---|---|
| Verdict | healthy by the thresholds above; no dropped steps, no decode errors, no abnormal session ends |
| Rooms | peak 152, steady mean 117 (not 50: finished players re-queue into new lobbies that open 15 s later, and the churners hold lobbies open, so rooms are small and numerous) |
| Server CPU | steady mean 0.32 cores (max 0.40); RSS mean 45 MB, peak 54 MB |
| Server tick | step p50 2 us, p99 47 us, max 16.8 ms (one outlier among 1,558,692 steps), wake lateness p99 6.1 ms |
| Client snapshot interval | p50 50, p95 51, p99 55, p99.9 67, max 159 ms; 201 of 5,214,328 intervals over 100 ms; 1 snapshot tick missed |
| Reconnects | 2,784 attempts, **2,784 resumed (100%)**, resume Hello to Welcome p50 0.10 ms, p99 5.5 ms |
| Lobby churn | 2,509 joins, 2,490 leaves (clients `Leave` mid-lobby); admission refusals: none |
| Bandwidth per client | in p50 786 B/s, p95 1,380 B/s (sessions include lobby time); out p50 112 B/s |
| Slow consumers | 4 stalled their reads for 120 s with a 2 KiB receive buffer: all 4 **survived** (no `TooSlow`), and the 396 other players kept a clean tick (above) |
| RSS trend | 31 MB at 14 s, 45 MB at 218 s, 50 MB at 422 s, 54 MB at 673 s: still creeping about 4 MB per 250 s at the end while the room count also grew (80 average in the first third, 140 in the last). **Inconclusive** whether that is per-room memory or growth with uptime; an 11-minute run cannot separate them. Needs a longer fixed-room-count soak |

## Functional scenario runs (clean commit `1aeb83fb`)

Raw: `evidence/load/final/` (`run.sh` is the exact command list). Native arm64, release server, short.

| run | what it exercised | result |
|---|---|---|
| `smoke-ws` | 2 matches, 15 s, plain ws | healthy; 16/16 admitted; client interval p99 52 ms; no refusals |
| `features-wss` | `--tls --insecure` (wss, self-signed), 3 matches, aggression 0.4, 30% reconnectors every 8 s, 4 churn clients, 10% slow readers (20 s stall), 60 s | healthy; 46/46 resumes ok; churn 95 joins/90 leaves; slow readers (2) survived the 20 s stall; no decode errors |
| `overload-maxrooms4` | 6 matches wanted, server `--max-rooms 4` | 32 of 48 players admitted, 16 never admitted; 187 refusals counted as `MatchFull`; the 4 admitted rooms stayed healthy (p99 52 ms) |
| `shutdown-sigterm` | 6 matches, aggression 0.9, SIGTERM 15 s into the steady window, wait up to 240 s | 7 rooms active at the trigger; server exited **62.1 s** later with status 0; **0 fresh Welcomes after the trigger**; first admission probe refused `ServerDraining` after 7.7 ms; 171 refusals, all `ServerDraining`; 45 players received their Result after the trigger; **0 abnormal session ends** |
| `shutdown-drain` | 4 matches, same, `POST /control/drain` | 5 rooms at the trigger; exit after **47.3 s**; 0 fresh Welcomes after; first refusal 0.4 ms; 126 `ServerDraining`; 32 Results after the trigger; 0 abnormal ends |

In the shutdown runs the final `/control/health` read is gone with the process, so their `server.metricsFinal` is null (the
time series holds the last readings). Boundaries: a probe after the trigger is a fresh admission only; the draining server
still accepts resumes for held seats (none were attempted: the shutdown runs have no reconnectors), so "new admissions refused"
is shown but "reconnect during drain" is not. Match completion after the trigger relies on players fighting to a result
(aggression 0.9); had a match not finished the server would have waited for it (the harness stops waiting at `--drain-wait`).

## What this does not show

- **Slow consumers and `TooSlow`.** Stalled readers were not disconnected in any run (4 at 120 s in the soak; 130 s in a separate uncommitted check): macOS loopback buffers (`net.inet.tcp.autosndbufmax` 4 MiB) absorb the slice's ~1.2 KB/s per client for far longer than
  the harness stalls. The server ends such a client with `TooSlow` when 256 important frames queue behind a blocked socket;
  that path is covered by `rh-server`'s own outbox and connection unit tests, not exercised end to end here. What the runs do show
  is that stalled readers cost the other players nothing measurable. Reaching `TooSlow` over a real network needs a lower
  buffer, a longer stall or a higher frame rate (the full game).
- **Emulated amd64.** No linux/amd64 run was made: no Rust image is on this machine, pulling one was not authorized, and
  compiling the workspace under QEMU emulation would not give a number comparable with the native ones. Not run.
- **Server-side p95, and windowed server tick quantiles.** The server exposes cumulative p50/p99/max only. The harness reports a
  client-side p95 and also the server's cumulative values; it adds no server metric (this branch changes no server file).
- **Cause of the 1,000+ degradation** (see above), a Linux host, a real NIC, TLS cost at density (one small `wss` run only),
  a PostgreSQL-backed server (these runs use in-memory persistence), and full-game load (204 mobs, abilities, 8 players per
  match with the full simulation cost). The legacy full game's step cost was about 5.9 ms average (`docs/MIGRATION.md`), against
  tens of microseconds here, so the slice's headroom does not carry over.
- Harness and server share the machine and its network stack; harness CPU is in every report (`harnessCpuCores` in the series),
  and client-side tick figures include harness scheduling noise.

## Reproduce

```sh
source <scratchpad>/rh-env.sh
cargo build --release --locked -p rh-server -p rh-load
ulimit -n 65536    # a 1,600-match run opens 12,800 sockets from the harness and as many in the server
target/release/rh-load sweep --server-bin target/release/rh-server --levels 10,25,50,100,200,400,800 --duration 40 \
    --ramp-per-sec 25 --aggression 0 --label sweep-native --out-dir target/load/sweep --hardware-label "Apple M5 Pro 18-core 64 GB"
target/release/rh-load run --server-bin target/release/rh-server --matches 50 --duration 660 --ramp-per-sec 5 --aggression 0.25 \
    --reconnect-fraction 0.2 --reconnect-every 20 --churn-clients 8 --slow-fraction 0.01 --slow-stall-secs 120 --sample-secs 2 \
    --label soak-native --out-dir target/load/soak
```

The harness is documented in `crates/rh-load/README.md`. The 200-match / 1,600-player scenario is just
`--matches 200 --players-per-match 8`; it is a parameter, not a target, and was run here locally only (no cloud load).
