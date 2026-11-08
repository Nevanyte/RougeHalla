# parity/policy

- `bot-fill.json` — the actual-source BotManager lobby-fill witness (arrival schedule, squeeze, human joins, closing
  top-up, yield seat, tier/persona/faction/callsign draws) captured in the pinned linux/amd64 Node 22.23.4 container; see
  `tools/bot-fill-fixtures/`.
- `bot-runtime.json` — the P-BOTS-7 remainder witness (`rh-bot-runtime-source/1`, 32,184 bytes, SHA256
  `b2964101f594ed5fd8cf3a7d9fee7098db658b3829ef2d603353373bcfe43540`): the source command delay line (arrivals for declared
  latency/jitter/seeds and `at` batches, plus the 256-command queue cap), `parseMix` edge cases and `loadConfig(env).bots`
  cases (BOTS_FILL_TO/ARRIVAL_SECONDS/TIER_MIX/PERSONA_MIX/LATENCY_MS/JITTER_MS/SEED/BOT_STATS_FILE), captured by
  `tools/bot-runtime-fixtures/` in the same pinned image with per-source-file SHA256 provenance.
- `capture.sh --check` for both tools re-runs the capture in the pinned container and requires identical bytes.
