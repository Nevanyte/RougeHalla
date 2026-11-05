# Offline protocol wire traces

These JSONL traces capture the public map and the encoded frames for the first viewer selected by `wirebench`. The format is `rougehalla-wire-trace` version 1. They are diagnostic replay inputs, not performance samples: trace writing adds work, its timing is excluded from benchmark claims, and `observeEncodeUsPerPlayerTick` is `null` in trace-mode stdout.

Local captures are kept outside the repository; `$RH_TOOLS` denotes the local tooling directory. Generated captures use 20 ticks/second. The N8 and N204 captures run for 6,200 ticks (310 seconds); the N68 trace remains a 600-tick (30-second) supplemental stress sample:

- `$RH_TOOLS/render-traces/wire-n8-default.jsonl` — 8-bot headless match on `parity/maps/seed1.map.json`.
- `$RH_TOOLS/render-traces/wire-n68-practice.jsonl` — synthetic 68-fighter crowd on the practice arena.
- `$RH_TOOLS/render-traces/wire-n204-practice.jsonl` — synthetic 204-fighter crowd on the practice arena.

The synthetic cases stress rendering and codec behavior beyond the real eight-player cap. They do not demonstrate full-game behavior or capacity.

## JSONL records

The first line is a `header` with `format`, `version`, `provenance`, `workload`, `syntheticFighters` (null for the default map), `seed`, `requestedTicks`, map identity and dimensions, `viewerPlayerId`, and `tickRate`. `mapBlobHex` contains the exact RLE MapBlob body bytes; `welcomeHex` contains the encoded public Welcome with that viewer ID, the real content hash, and offline zero match/session IDs.

Each later line is a `frame` with simulation `tick`, `viewerPlayerId`, `kind` (`snapshot`, `delta`, `important`, or `fx`), and `bytesHex`, the encoded protocol payload. The trace contains only public replication frames; it omits private state and state hashes. A kind is omitted on ticks where the publisher produced no frame of that kind.

The N8 capture follows the actual match terminal condition; this run completed 6,200 simulation steps. The synthetic N204 run also contains 6,200 steps. Simulated frame tick labels are 2 through 6,201 because the headless environment starts at tick 1 and each capture follows one step. Their 310-second span supports monotonic browser playback in one session. The 600-tick N68 sample can be used for short checks or explicitly labeled looped stress playback.
