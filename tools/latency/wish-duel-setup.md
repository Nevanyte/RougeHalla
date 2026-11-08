# Controlled Wish latency duel

`wish-duel.json` is a legal `rh-map/1` 16×10 enclosed room with two clear, nonoverlapping human spawns at `(144, 144)` and `(304, 144)` native units. They are 160 units apart on unobstructed floor with shared line of sight. The ordinary server profile provides no bots, mobs, loot, or training.

For a local server admission check or manual two-human run:

```sh
target/debug/rh-server --bind 127.0.0.1:7777 --map tools/latency/wish-duel.json --min-players 2 --lobby-seconds 2 --fill-seconds 1 --fill-bots 0 --wish-full
```

This uses the production 50 ms tick. `--wish-full` is an explicit opt-in; keep the ordinary 45,000 ms opening Wish lock and wait for the server-published `ready_at` before casting. The final five-faction proof should use two real Unity clients and the runner's local-only endpoints, passing `--map tools/latency/wish-duel.json`; the server binds loopback only. Do not bypass cooldown or stock timing.

## Local loader/admission receipt

The fixture was loaded and admitted by a brief loopback-only startup, then the server was stopped. Binary used: `/Users/nevinmckinnon/.codex/targets/rougehalla-wish-server/debug/rh-server`, SHA-256 `e7f7679687e5c6f26609517037a411fe295733556a96aa8f008d98c501dd4c81`. The startup banner reported protocol 12 and shortened content prefix `356457e6ccfb22cd`; HTTP `/info`, build ID, and full content hash were not captured. No source identity is inferred from the current Git revision. This receipt covers map loading and server arena admission only; it is not final protocol, content, or Unity client proof.
