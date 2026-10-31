# Bot and state-update measurements, 2026-10-30

## Full-room comparison

Run `node --import tsx packages/server/bench/stateUpdate.ts` from the repository root. It uses seed 1's certified map, 400 unmeasured ticks, then 1,200 measured ticks (60 simulated seconds). Six or eight hard-tier bots occupy camps; the fixture re-wakes each occupied camp every 500 ms and refills players below half health to sustain combat. These are benchmark fixtures, not gameplay changes. About 13 mobs fight on average among 139–144 mobs.

The real headless room, BotManager, FxChannel and Colyseus SchemaSerializer run on every tick. One or eight joined mock WebSocket clients measure serialization/fanout without adding simulated fighters. The full roster is present before measurement (176 or 178 entries); no new roster entries arrive during the measured window. Mock sends measure encoded payload plus WebSocket framing, not network or kernel send costs.

Both production images ran Node 24/Linux amd64 on the same macOS ARM host through Docker's architecture emulation, with `--cpus 0.5 --memory 4g --network none` and the same read-only benchmark mount. The baseline gameplay source is `534560f9c3e0878262157c326579a8539b3adb5c`; transport diagnostics have no sockets or work in this benchmark. The final image includes this change's vision specialization and duplicate perception-check removal. Baseline A ran before the final image, and baseline B repeated afterward. No other heavy work ran during the final/repeat pair.

| Bots | Observer clients | Baseline A tick CPU avg | Final tick CPU avg | Baseline B tick CPU avg | Final vs baseline mean | Final tick CPU p99 | Final state-update CPU avg |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 6 | 1 | 5.894 ms | 5.883 ms | 6.140 ms | -2.2% | 12.004 ms | 0.0725 ms |
| 6 | 8 | 5.709 ms | 5.786 ms | 5.919 ms | -0.5% | 12.818 ms | 0.0503 ms |
| 8 | 1 | 6.633 ms | 6.597 ms | 6.828 ms | -2.0% | 15.897 ms | 0.0706 ms |
| 8 | 8 | 6.431 ms | 6.302 ms | 6.712 ms | -4.1% | 13.999 ms | 0.0594 ms |

The full-room CPU differences are small relative to the baseline drift; they do not establish a large or reliable end-to-end speedup. Thread CPU timing in this emulated environment is coarse for tiny state-update calls. The benchmark runs tightly with occasional `setImmediate` yields, rather than pacing ticks at 50 ms: its wall-time tails include Docker CPU-quota throttling and emulation, and must not be interpreted as live Cloudflare game jitter or ping.

Every final gameplay-state SHA-256 matched both baselines, across both observer counts. Six-bot runs ended at `bd3354ff1ed71fd75dae87a6dd630b9619097b0f485bb9debd1ef51f09bcd77e`; eight-bot runs at `acebc98dd5f38caafa717083e8f6976c3b8708597ca9b15b5cc9e9d0a927b2c7`. All runs reported zero bot errors and refused inputs. Command counts matched: 568 sent/567 applied for six bots, 729/729 for eight.

## State-update cost

| Bots | Full sync per client | Patch bytes/s/client | FX bytes/s/client | Patch frequency |
| ---: | ---: | ---: | ---: | ---: |
| 6 | 30,380 B | 6,649 B | 572 B | 20 Hz |
| 8 | 30,995 B | 7,889 B | 468 B | 20 Hz |

Measured state-update work comprises FX batching/encoding/fanout, roster extension/commit and schema `applyPatches`. It accounts for about 0.9–1.2% of final measured room-plus-state CPU. The existing encoder already shares encoded patches across observers. No external schema or tick/patch cadence change is justified by these costs. Making empty container reward arrays optional would save roughly 2–3.5% of these bytes while requiring cached-client/default compatibility work; it would not address the measured network RTT, so it was left unchanged.

## Isolated bot processing

`BOT_BENCH_MOVE=1 node --import tsx packages/server/bench/botProcessing.ts` exercises seven real bot runners with 84 nearby synthetic mobs, moving origins, 1,000 warm-up frames and 10,000 measured frames. It measures BotManager frames without the full combat simulation or socket sends. In the matched Node 24/Linux amd64 pair, mean frame time fell from 2.087 to 1.984 ms (about 4.9%); p95 fell from 4.289 to 3.958 ms. Both sent 1,792 commands with zero errors. This isolated result is not a claim of a 5% whole-game or ping reduction.

The retained optimization validates a VisionMemory origin once per scan, then uses known tile endpoints without repeating origin/bounds/floor checks for every ray. Original division-based crossing arithmetic remains unchanged. Differential tests compare 40,000 exact-center/fractional rays and complete visibility cells against the original traversal. Mob perception also avoids a second identical visibility check for a mob already accepted for minimap visibility. Bot counts, decision cadence, visibility rules and difficulty are unchanged.
