# P-BOTS-7: the lobby fill policy (BotManager, BOTS_FILL_TO, callsigns, yield seat)

Stacked PR: deepseek/p-bots-7 -> deepseek/p-bots-6 @ f87727dd; branch created at that head, clean before work. PR base is
the bots tip. No wire/protocol change (stays protocol 7), no dependency/Cargo.lock change, no schedule or
serialized-state change. Ledger row: docs/evidence/deepseek-rust/PROGRESS.md.

Status: DONE-VERIFIED slice; P-BOTS-7 remains INCOMPLETE at packet level (exact remainder below). No packet file exists:
the scope was derived from the backlog row (line 163: "Fill policy: BOTS_FILL_TO, persona/tier mix, arrival schedule,
yield seat, bots never touch profiles/quests", dep P-BOTS-1, sources server/src/bots/BotManager.ts + callsigns.ts;
crates/rh-server/src/director.rs already fills), the P-BOTS evidence remainders and the legacy code.

## Assessment before writing (code and git, not memory)

The Rust server already had a fill, but only the placeholder: Room.fill_bots() seats scripted Brawler bots named bot1,
bot2, ... immediately when a human is present, and Room.join removes the newest bot when a human joins a full lobby. None
of the legacy manager's lobby surface was ported: no arrival schedule across the countdown, no tier/persona mix, no
callsign pool (bot names were botN), no faction balance, no closing top-up and no room-level policy state. The director
passed only fill_bots_to and the room kept its own placeholder fill. The fill policy is the manager's lobby behaviour
only: brains, the command delay line (latency/jitter), the learning store and the stats file are other packets.

## Delivered

- crates/rh-server/src/bot_fill.rs: the fill policy as plain data and deterministic streams (no clock, I/O or entropy):
  - constants and config: BOT_ID_PREFIX, BOT_PATH_BUDGET_PER_TICK, MAX_PER_FACTION, FACTION_TEMPERATURE,
    ARRIVAL_END_MARGIN_MS, LEARN_EXPLORE and the exact 64-name CALLSIGN_POOL; BotFillConfig with the source
    BOT_FILL_DEFAULTS (fillTo 8, arrivalSeconds 12, tier mix 0.3/0.45/0.25, persona mix 4/1/2/3, latency 30, jitter 8).
  - pure draws in the source order: mix (murmur finaliser), pickWeighted, softmaxIndex, pickCallsign (free-name draw,
    digit-suffix walk, last-resort name), bot_id.
  - BotFillState: lobbyTick (arrival times drawn uniformly over the countdown less the last second; pending arrivals
    dropped as humans join; squeeze when the countdown shortens; due seats drawn and seated), lobbyClosing (the closing
    step tops the lobby up), yieldSeat (newest gives its seat up), the manager's arrived/yielded counters, and the seat
    draws in the manager's order: tier, persona, faction (per-faction cap, LEARN.explore floor, softmax over NO_BIAS),
    callsign, seed = mix(seed, 1000+n). Every draw is made on a real seating, exactly as the source does.
- crates/rh-server/src/room.rs: opt-in Room.with_bot_fill(config): seed from the room's fixed bot seed (tests/replay) or
  OS entropy (not a match secret); fill_step() runs before each lobby step (arrivals due, plus the closing top-up on the
  step that closes the lobby, mirroring the sim's updateLobby rule) and seats the drawn bots on the normal seat contract
  with rh-policy HumanBot(tier, persona): observation-only perception, actions only through validate + submit, faction
  in the sim, callsign as the display name, and the replay Join records the bot's policy/interval/seed. yield_newest_bot
  keeps the policy's bookkeeping in step when a human takes a full lobby's newest seat. Without with_bot_fill the room
  keeps its previous immediate placeholder fill, so tests, benches and direct Room users are unchanged.
- crates/rh-server/src/director.rs: DirectorConfig.bot_fill (None by default) and fill_policy()/spawn_room wiring, so a
  room spawned by the director gets the configured policy with the room's own fill count; crates/rh-server/src/main.rs
  enables it for the live server from --fill-bots.
- parity/policy/bot-fill.json (rh-bot-fill-source/1, 182,698 bytes, 77 cases, SHA256
  70dfdee77e21cfce302fd77f21229947f9c46c1d9c3b85d02c4fb0c047aede24), captured only in the pinned Linux amd64 Node
  22.23.4 container by tools/bot-fill-fixtures/capture.sh and byte-checked by --check: the real BotManager over a real
  headless world across seven declared scenarios (default arrival schedule, a human join squeezing the countdown, the
  yield seat twice, the lobby-closing top-up, a countdown squeeze, a yield-order case with two seated bots to remove,
  and no-humans-no-bots), each recorded tick by tick (server time, countdown, humans, arrivals with the exact spec
  lines and the manager's fill-stream draws and roster factions), plus the exported constants, 30 callsign cases
  (including the whole-pool-taken digit fallback and the all-spellings-taken last resort), the bot ids and 35 softmax
  draws.
- crates/rh-server/src/bot_fill_tests.rs: 4 parity tests replaying every captured piece exactly (constants, callsigns,
  ids, softmax, and all seven scenarios tick by tick including human joins and yields).
- Native rh-server fill tests: room tests for the arrival schedule over the countdown (bots only inside the arrival
  window, top-up to the target on the closing step, callsigns from the pool, known factions, and byte-identical replay
  from the same fixed seed) and for a human taking the newest bot's seat in a full lobby (policy yielded counter and
  spec list both move, player count stays at MAX); a director test that the configured policy reaches a spawned room
  with the room's own fill count and that no policy keeps the placeholder fill.
- tools/bot-fill-fixtures/: capture tool/README plus run-mutants.sh with 4 committed mutants (arrival end margin,
  squeeze margin, exploration floor, yield order): 4/4 killed, unchanged control passes.

## Honest deviations from the source (documented, not faked)

1. The manager's isNameTaken profile lookup is not reachable from the room: the callsign predicate covers the room's
   names (case-insensitive) only, so a pool name that a real profile owns elsewhere could be drawn (the source skips
   it). Bots still never create or touch a profile, token or quest.
2. The bots' command delay line (latencyMs/jitterMs, BotManager.deliver/beforeStep) is not applied: the room seats act
   on the policy cadence. The config fields are carried so the feature has one place to land.
3. The learning store's biases (BotStatsStore, P-BOTS-5) are the NO_BIAS zeros; the explore draw and the softmax draw
   are still reproduced in the source order so the streams stay exact.
4. Faction counts use the sim's effective factions (a faction-less join gets the sim's default, as the source's
   addPlayer does); non-player factions do not exist in the room roster.
5. A room that does not opt in keeps the old immediate placeholder fill and scripted Brawler seats; the live server
   binary opts in, and the policy's brains are the ported HumanBot rather than a scripted Brawler.
6. The lobby HUD head-count/ticking is a client read of the roster; no separate HUD surface is added.

## Verification

- tools/bot-fill-fixtures/capture.sh --check: byte-identical pinned-container recapture (77 cases).
- cargo test -p rh-server --lib --all-features bot_fill: 4 passed / 0 failed (plus the room and director fill tests).
- tools/bot-fill-fixtures/run-mutants.sh: 4/4 mutants killed; unchanged control passes.
- cargo test --workspace --all-features --locked with the PostgreSQL test cluster (tools/pgtest/start.sh):
  1,481 passed / 0 failed / 3 existing ignored across 154 test binaries; exit 0.
- cargo clippy --workspace --all-targets --all-features -- -D warnings: clean (exit 0, zero warnings).
- cargo fmt --all -- --check: clean.

## Exact remainder for P-BOTS-7

1. The profile-name lookup predicate (a read-only profile registry seam for the fill) and the command delay line
   (latency/jitter) for the fill bots.
2. The learning store (BotStatsStore, P-BOTS-5) biases and the stats-file wiring, and the manager's per-bot stats
   (commands sent/applied/refused/lost/frames/errors) surfaced through room metrics/telemetry.
3. The live-server environment configuration for BOTS_FILL_TO / arrivalSeconds / mixes (the server binary currently
   enables the policy with the room's --fill-bots count and the BOT_FILL_DEFAULTS mix; a config/env surface is a
   separate wiring task) and the fill bots' tournament/addBot overrides.
4. The room's tick-driven head-count semantics for the lobby HUD and telemetry tags that carry each bot's tier/persona.
5. Full continuation of the fill bots' brains in the live room (strategy/tactics/memory consumers are the P-BOTS-1/3/4
   remainder; this slice wires the ported HumanBot tier/persona seats).

This slice reads only public Observation through the seats, submits only through validate + submit, keeps the fill
deterministic from its seed, and changes no wire, schedule or serialized state; P-BOTS-7 INCOMPLETE covers 1-5 above.

## Remainder round (P-BOTS-7b): the delay line, the env surface and the profile-name seam

On `deepseek/p-bots-7b` (PR against `deepseek/p-bots-5`), the first three items of the exact remainder are delivered:

1. **The command delay line** (source `BotManager.deliver`/`beforeStep`): a fill bot's proposal is clicked at `at`, reaches
   the server `latencyMs +- jitterMs` later (jitter from the manager's own line stream, `mix(seed, 1)`), never before the
   command ahead of it, and is applied by the first step at or after its arrival. `rh-policy::bots::delay::DelayLine`
   implements the queue (including the source 256-command cap) and the room owns one line per seated fill bot: it collects
   the proposals from the new `drive_seats_queued` driver, enqueues them with the fill config's latency/jitter, and before
   each step resolves and submits every command whose arrival has come through `Sim::submit` (validate included) — the
   same intake a human message takes. The placeholder fill (no policy configured) stays immediate, as before. The replay
   records the commands at delivery time. Native counters `sent/applied/refused/lost` are exposed by `Room::bot_delivery`
   and the per-bot telemetry tags by `Room::bot_specs`; the control-API/HUD exposure stays with the client/coordinator.
2. **The env/config surface** (source `config.ts parseBots`): `BotFillConfig::from_env` parses BOTS_FILL_TO,
   BOTS_ARRIVAL_SECONDS, BOTS_TIER_MIX, BOTS_PERSONA_MIX, BOTS_LATENCY_MS, BOTS_JITTER_MS, BOTS_SEED and BOT_STATS_FILE with
   the source semantics (`parseMix` rules, non-negative clamping/fallback, the MAX_PLAYERS clamp, the seed `>>> 0`); the
   server binary reads it and `--fill-bots` (or first-playable) overrides only the count, keeping the Rust server's
   historical fill-off default unless the environment or the CLI asks for fill. `BOT_STATS_FILE` is parsed and reported but
   the file store itself is superseded by the PostgreSQL learning store (P-BOTS-5). The captured env cases are compared
   field by field against `parity/policy/bot-runtime.json`.
3. **The profile-name seam** (source `BotManager.isNameTaken`): the persistence reads every durable callsign once at
   startup (`rh-persist::Store::profile_callsigns`, `Persistence::bot_names`) and the director passes the lower-cased
   read-only set to each new room (`Room::with_bot_names`), whose fill policy consults it before drawing a callsign — no
   fill bot ever draws a profile-owned name, and bots never read or write a profile, token or quest.

### Remainder-round verification

- `parity/policy/bot-runtime.json` (`rh-bot-runtime-source/1`, 32,184 bytes, SHA256
  `b2964101f594ed5fd8cf3a7d9fee7098db658b3829ef2d603353373bcfe43540`), captured by `tools/bot-runtime-fixtures/capture.mts`
  in the pinned linux/amd64 Node 22.23.4 container from the unchanged source: 4 delay-line cases (declared latency/jitter/
  seed/`at` batches, arrivals compared bit for bit, plus the 256/4 queue-cap split), 8 `parseMix` cases and 12
  `loadConfig(env).bots` cases. `capture.sh --check` is byte-identical.
- `cargo test -p rh-policy --lib bots::delay`: 3 passed (the pinned arrivals, delivery order/boundary, seeded stream).
- `cargo test -p rh-server --lib --all-features bot_fill`: 7 passed (the existing parity plus the captured env surface).
- Native room tests: the 100 ms-latency test proves a proposal is not applied on its own or the next 50 ms step and lands
  on the one after (and replays from its seed); the name test takes every callsign pool name as profile-owned and shows
  every seated fill bot draws another name.
- PostgreSQL, pinned throwaway cluster (feature `postgres`): `cargo test -p rh-server --features postgres --test bot_names`
  — 1 passed: the durable callsigns read read-only and lower-cased, nothing changed by the read.
- Workspace gate: **1,517 passed, 0 failed, 3 ignored, 157 test binaries, exit 0** (with the pinned PostgreSQL cluster;
  the previous 1,509 plus the eight remainder-round tests: 3 policy delay, 2 room, 2 bot_fill env and the PostgreSQL
  `bot_names` test, which is the 157th binary).
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` and `cargo fmt --all -- --check`: clean.

### Remainder after this round

- The fill bots' tournament/`addBot` overrides and the live-room continuation of the brains (P-BOTS-1/3/4).
- The per-bot frames/errors/results counters (brain-side; the delivery half is native now) and their room-metric/telemetry
  exposition (coordinator/client owned, with the lobby HUD).
- A live refresh of the profile-name set after a profile is created while the server runs (the startup snapshot covers
  every profile that exists then; the account/control path owns later creations).
