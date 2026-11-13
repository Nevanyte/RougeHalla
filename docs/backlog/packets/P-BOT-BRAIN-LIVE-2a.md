# P-BOT-BRAIN-LIVE-2a: the Brain's input side accepts everything the composer emits (piece 2, first cut)

- **Serves:** not in ORDER_OF_OPERATIONS: owner beta-follow-up decision 7; approval 7, 2026-11-12 (see [P-BOT-BRAIN-LIVE-1](P-BOT-BRAIN-LIVE-1.md))
- **Implementer tier:** implementer-opus (fairness, the Brain's input grammar)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework with P-BOT-BRAIN-LIVE-1 merged
- **D-rules touched:** D1 loose proof · D2 n/a · D5 none · D9 bots act only through validate + submit

## Why a cut
Piece 2 as first briefed (`BrainBot`, mapper, headless selection) plus the five review items is about 800 lines, and the
Brain has no production services yet (path service, `BrainMap` from an arena, learned/log sinks are all test-only in
`brain/tests.rs`, `brain/source_input.rs`). Cut: **2a** (this file: input side, proven on composed percepts) and
[**2b**](P-BOT-BRAIN-LIVE-2.md) (`BrainBot`, services, mapper, headless). 2b starts after 2a lands.

## 1. Outcome
A percept built by `Composer14` from any accepted frame is accepted by all five component readers and the source
validator without inventing a value for an `undefined` leaf; a Brain bot can cast its Wish; a held lock whose target is
hidden still counts as held; the seat's composer setup carries the pinned delays and only public statics; a composition
the ring does not cover yet is flagged.

## 2. Findings from the tree (2026-11-12)
- **Wider than names.** `adapters.rs` reads `text`/`number` and rejects `undefined` for more than the review listed: on a
  plain scene `memory_percept` and `tactic_percept` refuse `fighters[].drawStartedAt`, `strategy_percept` refuses
  `self.immuneUntil`; with no roster rows all four of memory/module/strategy/tactic refuse `name` (`adapters.rs:304,325,
  385,451,566,652,683,753,917,928,1048`). Other always-undefined leaves (`self.mobKills`, `hud.alive/minPlayers/winner`,
  `mobs[].drawStartedAt`, projectile `id/vx/vy/x0/y0/t0/range`, `minimap.t`) may be refused later in the tick (the
  oracle only reaches what the five projections read). The rule: a reader takes `undefined` where the source type
  allows it to flow; typed fields become `Option`/NaN-carrying only where the source arithmetic does the same; the
  `raw` record stays untouched.
- **Validator.** `source_input.rs:82` `MOB_KINDS` lacks `zombie` (error: `unsupported enum value zombie`). Quest-giver
  rows (name undefined) are not covered by the oracle: its scene needs a quest view (`Encode(BadValue("giver actor"))`
  otherwise). The implementer adds a quest-giver check if the scene is buildable.
- **Wish.** `compose14.rs` omits `extras.wish`; `adapters.rs:1113 module_wish` needs a numeric `rank`. Wishes have one
  rank (`bots/wish.rs` `WISHES`, `WishRank`), so rank 1 is the only reading and `rank_of(NaN)` already floors to 1.
  Chosen: **accept an undefined `rank`** and build `def` from the public catalog (`bots::wish::WISHES` plus
  `rh_sim::abilities::definition`), never from `World`. `ability` is the id text (`"freeze"`). Fallback only if the def
  record cannot be built: record "Brain bots never cast Wishes" as a proposed DEVIATIONS row.
- **Held lock.** `brain.rs:1288 is_engaged` reads `me_attack_target.is_some()`; legacy `brain.ts:218` is `!== null`.
  Stub adds `Percept.me_attack_held` (`source_input.rs` sets `attack_target.is_some()`, the corpus only has null or a
  string); the composer must set it from the lock (`Held` of any target); `is_engaged` must read it.
- **World delay.** Legacy live: `worldDelayMs = INTERP_DELAY_MS (100, packages/shared/src/constants.ts:18) + latencyMs`,
  `selfDelayMs = latencyMs` (`BotManager.ts:351`; fill default `latencyMs` 30, `brain/types.ts:1250`). The in-process
  client bot uses `selfDelayMs: 0, worldDelayMs: INTERP_DELAY_MS` (`BotClient.ts:321`). **Pinned for `BrainBot`:**
  `BRAIN_WORLD_DELAY_MS = 100`, `BRAIN_SELF_DELAY_MS = 0` (the real transport supplies the latency; the bot adds none).
  The composer needs **`Composed14.covered`**: `frames.ts:131` returns no percept while the oldest sample is later
  than `viewT`; such a frame is still pushed into the ring (a refusal could not be, being atomic), and `BrainBot` skips
  the Brain tick when `!covered`. Not pinned by the oracle and left to the implementer plus reviewer: the camera
  stays on the old spot across a coliseum teleport (`frames.ts:137-142`; `compose14.rs` has `eye = me_at` always) and mobs
  are drawn at the newest sample (NPC references are per-sample). If either is not implemented it becomes a
  proposed DEVIATIONS row for piece 3, not silent.
- **Setup.** `Setup14.arena: Arc<Arena>` carries spawns and, through `MapLayers`, seed, crate/ground spots and the spawn
  pool. `MapLayers` cannot simply be stripped: validation ties `crate_spots` to the camp chests
  (`rh-sim/src/mapdata/validate.rs:338`). `Setup14::public(&Arena, Features, attention_central)` is the one constructor a
  seat uses; the oracle requires pinned delay, empty `spawns`, same tiles, and the same composed record as a full-arena
  setup. **Owner question:** a clean fix changes the type of `Setup14.arena` (tiles plus gate tiles only), which edits
  the `setup()` helpers of `compose14_tests.rs` and `compose14_review_tests.rs`; this packet does not do that.
  Call `Composer14::reset()` on a new session or a clock gap (2b).

## 3. Exclusive write scope
`crates/rh-policy/src/bots/temporal_percept/brain/{adapters.rs, source_input.rs (MOB_KINDS, and the validator only),
percept.rs, compose14.rs}` and `brain.rs` (the `is_engaged` line). Nothing in `rh-protocol`, `rh-sim`, `rh-server`, `rh-headless`.
Not the oracle file, not `compose14_tests.rs`, not `compose14_review_tests.rs`, not `parity/**`.

## 4. Behaviour to preserve
Every existing rh-policy test and `parity/policy` corpus (the Brain corpus drives `source_input.rs` and the readers).

## Oracle files (read-only for implementers)
- `crates/rh-policy/src/bots/temporal_percept/brain/brain_input_tests.rs` (11 tests)

## Routing
- Tier: implementer-opus; reviewer: reviewer-opus. Serves: owner decision 7. D-rules: D1 loose proof, D9.

## 5. Acceptance
`cargo test -p rh-policy brain_input_tests` green, `cargo test -p rh-policy`, `cargo fmt --all -- --check`,
`cargo clippy -p rh-policy --all-targets --all-features -- -D warnings`, `scripts/gate.sh --oracle packet/P-BOT-BRAIN-LIVE-2a`.

## Stub commit (already in)
`Percept.me_attack_held` (+ `source_input.rs` sets it), `Composed14.covered` (always true), `BRAIN_WORLD_DELAY_MS`,
`BRAIN_SELF_DELAY_MS`, `Setup14::public` (placeholder: delay 0, full arena), `mod brain_input_tests;` in `brain.rs`.
Edits to `compose14.rs` in the stub: those three plus `me_attack_held: false` in the `Percept` literal.

## Not proven
Names/`undefined` are accepted, but the oracle cannot say what the Brain then *does* with an unknown value; quest-giver
rows; teleport camera and mob interpolation under delay; that the Wish def equals the legacy `ABILITIES` record
byte for byte (only that the module reads one rank and a name); the other always-undefined leaves beyond the five readers.
