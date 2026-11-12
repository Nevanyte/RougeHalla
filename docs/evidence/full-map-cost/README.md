# Room cost on full generated maps (P-MAP-3 follow-up)

**Question.** `--map-pool` gives each room a full generated map (160x160, 50 camps, about 200 mobs) instead of the
beta's hand-authored 48x40 map (3 camps). How much more does a room cost the server per tick, and in memory?

**Command** (cloud container, 4 vCPU `Intel(R) Xeon(R) Processor @ 2.30GHz`, release build, nothing else running):

    cargo build --release -p rh-headless --example full_map_cost
    target/release/examples/full_map_cost 8 12000 maps/first-playable.json

`crates/rh-headless/examples/full_map_cost.rs` plays one match per map with eight live-style fill bots (`HumanBot`, tier
and persona as `rh-server` seats them) under the live `--runtime source-arena` rules (archetype hitboxes, no regen in
combat, every faction, PvE mobs, quests, terrain, initial loot, source lifecycle). It times each `Env::advance`
(every bot's observation and decision plus `Sim::step`) and reads `VmRSS`/`VmHWM` from `/proc/self/status`. The
generated maps are exactly what the pool serves (`certified_styled`, decor off), seeds 1-8.

## Result (single run per map, 2026-11-12)

| Map | Ticks | Ended | Peak mobs | Mean µs | p50 µs | p99 µs | Max µs | Rooms per core at mean | Map gen |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| first-playable 48x40 | 1,452 | yes | 15 | 154 | 171 | 340 | 520 | 326 | — |
| generated-1 | 1,487 | yes | 214 | 1,348 | 1,244 | 3,615 | 4,752 | 37 | 45 ms |
| generated-2 | 1,185 | yes | 227 | 1,815 | 2,123 | 5,253 | 5,709 | 28 | 63 ms |
| generated-3 | 12,000 | cap | 196 | 796 | 702 | 2,296 | 10,256 | 63 | 46 ms |
| generated-4 | 1,183 | yes | 208 | 1,617 | 1,812 | 3,901 | 32,945 | 31 | 74 ms |
| generated-5 | 1,237 | yes | 209 | 1,786 | 1,882 | 4,399 | 11,368 | 28 | 66 ms |
| generated-6 | 12,000 | cap | 206 | 770 | 668 | 2,138 | 5,013 | 65 | 48 ms |
| generated-7 | 1,639 | yes | 210 | 1,738 | 1,880 | 3,020 | 4,008 | 29 | 47 ms |
| generated-8 | 12,000 | cap | 217 | 804 | 707 | 2,508 | 4,545 | 62 | 57 ms |

- **Per tick:** a full map costs about **5-12x** the beta map: tick-weighted mean 0.93 ms against 0.15 ms, p99 up to
  5.3 ms. The tick budget is 50 ms, so a room uses 1.5-3.6% of one core on average.
- **Spikes:** one tick of generated-4 took 33 ms (two thirds of a tick budget), and three others took 10-11 ms. A
  single room would still keep pace, but a host packing rooms on one core would see that tick late.
- **Memory:** about 7-8 MiB of resident memory per live room on a full map, from the jump within each run (for example
  10.3 MiB to 17.9 MiB for generated-1), against about 6 MiB for the beta map. Process peak after all nine matches was
  28 MiB.
- **Generation:** 56 ms per map on average (45-74 ms), off the tick on the pool's worker thread; legacy measured about
  45 ms at 136x136 and 65 ms at 160x160.
- **Rough capacity:** at the mean, 28-65 full-map rooms per core of this machine against about 326 beta-map rooms. The
  beta's `--max-rooms 1` host is nowhere near either limit.

## What this does not establish

- **Not the whole server tick.** Wire encoding, outbox pacing, sockets and TLS for eight human connections are outside
  `Env::advance`. `rh-server`'s `densitybench --map <file>` measures those for one map file; it was not run here.
- **Bots only.** No human clients; the early endings (six of nine matches ended at 59-82 s of game time) mean most runs
  cover the opening, with the 12,000-tick runs (10 minutes) covering mid-match mob counts.
- **One run per map on a shared cloud vCPU.** Wall times are informational; the 33 ms spike was not reproduced or
  attributed.
- **Not Unity.** Client frame time, download size and rendering on a 160x160 map are unmeasured, and remain the main
  open question before `--map-pool` goes on in hosting.
- **Signature landmarks** (`--signature-landmarks`) were not in these maps.
