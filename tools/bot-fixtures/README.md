# Bot human-likeness source witness (P-BOTS-1)

Canonical actual-source capture of the legacy bot brain's human-likeness core:
the tier/persona tables, the shared-mulberry32 distributions, the click model
(the client picker port and the move/target/minimap scatter) and the humanizer's
timed commands. The corpus is `parity/policy/bot-core.json`; the native
comparison is `crates/rh-policy/src/bots/parity_tests.rs`.

The capture runs the unchanged TypeScript modules directly
(`packages/server/src/bots/brain/{types,random,clicks,humanizer}.ts`) over declared
inputs, in the pinned
`node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`
linux/amd64 image (the same immutable image as the other fixture tools):

```sh
bash tools/bot-fixtures/capture.sh            # capture to a temporary directory
bash tools/bot-fixtures/capture.sh --check    # compare the checked-in corpus byte for byte
```

`RH_BOT_OUTPUT` points the capture at another directory; `--check` reads
`<dir>/bot-core.json`. The recorder asserts the exact Node version, platform and
architecture, replays every case twice and requires byte-identical output, and
hashes the whole `packages/server/src/bots/brain` + `packages/shared/src`
TypeScript closure into the corpus provenance.

## Declared inputs (never read back from the output)

A single declared 24x24 map (the declared-map input shared with the pve-dot
tool), declared percepts (the hand's fair view: the bot itself, on-screen
fighters/mobs, containers and chests), declared intent lists per frame, and
declared seeded streams (`motor`, `lapse`; the strategy's `decide` stream is not
drawn by this slice). The humanizer runs its real `submit`/`release` loop frame
by frame over those declared frames.

## What the corpus witnesses

- **Tables**: `TIERS` (easy/normal/hard) and `PERSONAS` (farmer/hunter/opportunist/
  cautious) field for field, `BOT_VIEW`, `HP_QUANT`, the minimap constants,
  `TARGET_SNAP_RADIUS`, `HUMANIZER_RULES` and the intent priorities.
- **Map solidity**: the legacy `isSolidAt` over every tile corner and center plus
  the out-of-bounds ring (the click scatter's wall retries depend on it).
- **Distributions**: `uniform`, `chance`, `gaussian` (Box-Muller),
  `exponential`, `exGaussian` (floor retry and cap), `softmaxIndex` and
  `pickOption` (softmax + lapse top-three) over declared seeds.
- **Clicks**: `pickTarget` ties and misses, `lockCandidates` (gates locked or not),
  window edge/clamp, `edgeToward`, `groundSigma`, `groundClick` (wall retry),
  `moveClick` in all three kinds (ground/edge/minimap) and `lockClick` including
  slipped flicks and click misses/wrong picks.
- **The humanizer**: 27 declared cases / 1,860 frames covering reaction locks with
  the attention multipliers, the refractory gap between independent decisions,
  steps and timed rhythms, hesitation, all channel conversions (move/stop/lock/
  swap/pickup/cast/plan/choose), the APM token bucket and starvation, dedupe and
  the lock re-send rule, click misses and the dead-self drop. Every emitted
  `TimedCommand` (click time, command, intent, priority, stimulus), every click
  miss and the final stats counters are compared by the native test.

## Boundary

This corpus pins the hand and the cadence, not the whole bot. The full
`perception.ts` fair-view constructor (camera window at a render time, minimap
dot ring, fx decoding, effect filtering), `memory.ts`, `strategy.ts`, `tactics/*`,
the feature `modules/*`, `mobHunt`/`chestHunt`, `BotManager` fill and the
learning/tournament tooling remain P-BOTS-1/P-BOTS-2..7 work and are not claimed
here.

Recapture only with the pinned container: the corpus is immutable expected
output, never regenerated from Rust.
