# P-BOT-BRAIN-LIVE-2: `BrainBot` policy, shared command mapper, headless selection (piece 2 of 3)

- **Serves:** not in ORDER_OF_OPERATIONS: owner beta-follow-up decision 7; approval 7, 2026-11-12 (see [P-BOT-BRAIN-LIVE-1](P-BOT-BRAIN-LIVE-1.md))
- **Implementer tier:** implementer-opus (cross-crate: rh-policy, rh-headless; fairness; determinism)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework with P-BOT-BRAIN-LIVE-1 merged
- **D-rules touched:** D1 loose proof · D2 n/a · D5 none · D9 bots act only through validate + submit

**Status: brief only. Its oracle is written by `oracle-author` after piece 1 lands** (it needs `Composer14`).

## 1. ID and outcome
A `BrainBot` implements `Policy`: each decision it composes a `Percept` from the seat's accepted `Frame14` with
`Composer14`, runs the ported Brain, and maps the Brain's released commands to `PublicCommand`s through the same mapper
`HumanBot` uses. `rh-headless` can seat Brain policies per match. Nothing in `rh-server` changes (piece 3).

## 2. Dependencies
P-BOT-BRAIN-LIVE-1 merged (`Composer14`, `Setup14`, `Composed14`).

## 3. Relevant legacy paths (rechecked 2026-11-12)
- `packages/server/src/bots/brain/brain.ts` (tick, `noteSent` at :205-213), `runner.ts:29-66` (potion throttle after accepted send), `humanizer.ts`
- Native: `crates/rh-policy/src/bots/bot.rs:782` `HumanBot::emit` (the command mapper; resolves `Pickup`/`Choose` through
  `LootFacts`), `bot.rs:663,707-708` `Goal::Chest`/`Goal::Loot`, `bots/perception.rs:160` `LootFacts`/`PropRef`/`ChestRef`
- `crates/rh-policy/src/lib.rs:203-252` `Policy` (no `finish`), `:298` `Seat.budget: Option<Duration>`, `:263` `Fault::OverBudget`
- `crates/rh-headless/src/lib.rs:520` `run_bot_match_config` (seats `scripted::Brawler` today), `src/tournament.rs:551` (seats `HumanBot`)

## 4. New paths
- `crates/rh-policy/src/bots/brain_bot.rs`: `pub BrainBot`, re-exported from `bots/mod.rs`
- `crates/rh-headless/tests/brain_bots.rs` (oracle)

## 5. Exclusive write scope
- `crates/rh-policy/src/bots/brain_bot.rs`, `bots/mod.rs`, `bots/bot.rs` (factor `emit` into a shared fn taking
  `&LootFacts`; `HumanBot` behaviour byte-identical), `bots/temporal_percept.rs` and `temporal_percept/brain.rs` (a
  `pub(crate)` constructor/tick surface for the private Brain; no behaviour change to it), `crates/rh-policy/src/lib.rs`
  (optional `Policy::finish`, once-only `Seat::finish`)
- `crates/rh-headless/src/lib.rs` (a `BotKind` for `run_bot_match_config`: default keeps `Brawler`), `src/tournament.rs`,
  `src/bin/tournament.rs` (`--policy human|brain`)

## 6. Contracts and references
C-INPUT, C-OBS, C-POLICY, R-ML-3/4; ADR 0005. `BrainBot::check_input` refuses a frame the composer refuses, before any state
or RNG changes. The Brain seeds from the low 32 bits of `MatchStart.seed`. `LootFacts` for a Brain `Pickup`/`Choose`
come from the same accepted `Frame14` (never `World`); a container not in the seat's `LootFacts` emits nothing.

## 7. Behaviour to preserve
`HumanBot` decisions, headless `run_bot_match*` defaults, replays and state hashes for every existing seed.

## 8. Acceptance checks (to become oracle tests)
- `rh-headless/tests/brain_bots.rs`: 8 Brain seats, source-arena profile, two seeds, 6,000-tick cap: no seat fault, every seat
  proposes and has commands accepted, at least one kill resolves, two runs give the same final state hash, the recorded replay verifies.
- hidden-state twin: two worlds differing only in a hidden actor give identical `BrainBot` commands
- a Brain `Pickup` for a container absent from `LootFacts` emits nothing
- CPU: per-seat decision time recorded against P-BOTS-1's legacy target (8 bots: mean < 1.5 ms, p99 < 6 ms), reported not gated
- `scripts/gate.sh --oracle packet/P-BOT-BRAIN-LIVE-2` passes (full)

## 9. Validation commands
`cargo test -p rh-policy`, `cargo test -p rh-headless --test brain_bots`

## 10. Risk and suggested model tier
High, about 450 lines. Opus, Opus review. Split further at the `Policy::finish` seam if it exceeds the budget.

## 11. Known traps
- `Seat.budget` is `None` unless set; a slow Brain stalls a room (piece 3 sets it for live seats).
- Per-tick `BVal` rebuild allocation; the room path budget starts once per room frame, not once per bot.
- Learner writes need the single-writer lease and only non-training, non-void runs (piece 3).

2026-11-12 (coordinator, from the reviewer-opus review of piece 1 @ 13c5d90e): this piece must also settle
- **The Brain's input reader rejects what the composer now emits.** `adapters.rs` (`text(row, "name")`) refuses an
  `undefined` name (self and fighters without a roster row, zombies, quest givers), and the test-only source validator
  (`source_input.rs:82`) accepts only kinds `mob`, `elite`, `dummy`, `npc`, not `zombie`. Widen the reader (and the
  validator) to legacy's grammar: write scope gains `adapters.rs` and `source_input.rs`.
- **`extras.wish` is absent**, so the Wishes module sees no wish and a Brain bot never casts (`adapters.rs:974`).
  `WireWishOwner` carries no rank and `module_wish` requires a number: either let `module_wish` accept an undefined
  rank and take `def` from the public catalog, or record "Brain bots never cast Wishes" as a deviation. Prefer the first.
- **Held lock on a hidden target**: `brain.rs:1286` checks `me_attack_target.is_some()` where legacy `brain.ts:218`
  checks `!== null` (undefined counts as held). Add a typed "held" flag or read it from `raw`; write scope gains
  `percept.rs`/`brain.rs` for that line.
- **World delay**: legacy live bots ran `worldDelayMs = INTERP_DELAY_MS + latencyMs`, `selfDelayMs = latencyMs`
  (`BotManager.ts:351`). Pin the delays `BrainBot` uses; with a delay above zero the composer has no "ring does not
  cover viewT yet" refusal (legacy `frames.ts:131` returns no percept), runs the camera ahead across the coliseum
  teleport (`frames.ts:137-142`) and draws mobs at the newest sample: decide whether `Composed14` needs a covered flag.
- Build `Setup14` only from what a client receives (it currently borrows the server's map type, which also holds the
  seed, crate and ground spots and the spawn pool, unread by the composer); call `reset()` on a new session or a clock gap.
