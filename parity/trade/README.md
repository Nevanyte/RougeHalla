# parity/trade

- `runtime.json` — `rh-trade-source/1`, 5 cases, captured in the pinned linux/amd64 `node:22.23.4-bookworm-slim@sha256:aaa4b5…`
  container by `tools/trade-fixtures/capture.mts` from the unmodified source harness (production module order, quests on,
  generated map seed 1 attempt 0, floor random `mulberry32(12)`, reward salt `[1,2,3,4]`).
- Provenance records the image, Node version and SHA256 of every `packages/shared/src` + `packages/server/src/sim` source
  file the harness imports, so the corpus cannot drift silently.
- Cases: `spawn`, `wander` (200 ticks of walking), `stat-offer` (frozen broker, rolled offers, no reroll after moving
  away), `stat-trade` (one exchange, second refused) and `barter` (three trades with the cooldown and fists refusals).
- Each case records the ordered action script (declared place/weapon setup vs ordinary input-queue messages) with the
  per-frame action count, the synced trader actors (id/kind/name/x/y/walk clock), the destination-grid digest, the private
  barter cooldowns, and each player's weapons/slot/potions/hp/maxHp/mirrors/tradeUsed/tradeOffers/tradeStats.
- Native replay: `crates/rh-sim/src/traders/tests.rs`; `bash tools/trade-fixtures/capture.sh --check` re-runs the capture
  in the pinned container and requires identical bytes.
