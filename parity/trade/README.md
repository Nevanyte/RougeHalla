# parity/trade

- `runtime.json` — `rh-trade-source/1`, 6 cases, 64,709 bytes, SHA256
  `a03bfd021997c99e60a1cf1307c34dabef1bd1dd6c1c75d78ecd0818ad0805e1`, captured in the pinned linux/amd64
  `node:22.23.4-bookworm-slim@sha256:aaa4b5…`
  container by `tools/trade-fixtures/capture.mts` from the unmodified source harness (production module order, quests on,
  generated map seed 1 attempt 0, floor random `mulberry32(12)`, reward salt `[1,2,3,4]`).
- Provenance records the image, Node version and SHA256 of every `packages/shared/src` + `packages/server/src/sim` source
  file the harness imports, so the corpus cannot drift silently.
- Cases: `spawn`, `wander` (200 ticks of walking), `stat-offer` (frozen broker, rolled offers, no reroll after moving
  away), `stat-trade` (one exchange, second refused), `barter` (three trades with the cooldown and fists refusals) and
  `barter-locked-second-slot` (p0 owns Committed through the real `grantCard` and its potion → second-weapon trade is
  refused — slot empty, potion kept, no cooldown — while p1 without the card makes the same trade into slot 1).
- Each case records the ordered action script (declared place/weapon/potion/grantCard setup vs ordinary input-queue
  messages) with the
  per-frame action count, the synced trader actors (id/kind/name/x/y/walk clock), the destination-grid digest, the private
  barter cooldowns, and each player's weapons/slot/potions/hp/maxHp/mirrors/tradeUsed/tradeOffers/tradeStats.
- Native replay: `crates/rh-sim/src/traders/tests.rs`; `bash tools/trade-fixtures/capture.sh --check` re-runs the capture
  in the pinned container and requires identical bytes.
