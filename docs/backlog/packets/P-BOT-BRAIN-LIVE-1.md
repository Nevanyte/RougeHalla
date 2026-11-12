# P-BOT-BRAIN-LIVE-1: the ported Brain on live and headless seats (degraded fair profile)

- **Serves:** not in ORDER_OF_OPERATIONS: owner beta-follow-up decision 7 (MIGRATION, 2026-11-10: "wire the ported Brain to
  live and headless seats, turn the legacy learner on"). Owner answers 2026-11-11 (chat): **degraded fair profile**
  approved (facts a seat cannot see are explicitly unknown, never inferred, never read from `World`); the learner runs on
  the beta (done: `hosting/technical-demo/bootstrap.py`, commit 81ded797).
- **Implementer tier:** implementer-opus (cross-crate: rh-policy, rh-server, rh-headless; fairness)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof · D2 n/a · D5 none · D9 bots act only through validate + submit
- **Supersedes for activation purposes:** P-BOT-FAIR-ACTIVATION-1's "no defaults" rule, narrowed by the owner's degraded
  profile: an unpublished fact is passed as source `undefined` (or the source's documented absent value) and listed in a
  DEVIATIONS row; it is never defaulted to a plausible number and never taken from hidden state.

## 1. ID and outcome
Live fill bots today run `HumanBot` (`crates/rh-policy/src/bots/bot.rs`), a bounded front end. The ported legacy Brain
(`crates/rh-policy/src/bots/temporal_percept/brain.rs`, private, `#![allow(dead_code)]`) has no production input: its
`Percept` is only ever built by test code (`brain/source_input.rs`). When this lands, a `BrainBot` policy composes a
`Percept` from each seat's accepted `Frame14` only, drives the Brain, and maps its released commands to `PublicCommand`s
through the existing seat path (`drive_seats_queued` → `Seat::resolve` → `sim.submit`). `rh-server --bot-brain full`
(default `off`) seats it for fill bots; `rh-headless` can select it per match.

## 2. Dependencies
None merged-in-flight. Read `docs/evidence/bot-fair-activation-plan/field-closure.md` first: it classifies every source
field against protocol 14/17 (available / derivable / needs provider / source-only).

## 3. Relevant legacy paths
- `packages/server/src/bots/brain/types.ts:296-674` (`Features`, views, `Percept`), `perception.ts:329-698`,
  `frames.ts:124-217` (FrameRing), `memory.ts:301-910`, `brain.ts`, `runner.ts:29-66`

## 4. New paths
- `crates/rh-policy/src/bots/temporal_percept/brain/compose14.rs`: `FairPerceptRing14` + `Frame14` → `Percept`
- `crates/rh-policy/src/bots/temporal_percept/brain/room_paths.rs`: production `BrainPathService` over the room path service
- `crates/rh-policy/src/bots/brain_bot.rs`: `pub BrainBot` (`Policy`), re-exported from `bots/mod.rs`
- `crates/rh-headless/tests/brain_bots.rs`

## 5. Exclusive write scope
- the new files; `crates/rh-policy/src/bots/{mod.rs,bot.rs (factor the command mapper at :710-736 into a shared fn)}`,
  `crates/rh-policy/src/lib.rs` (optional `Policy::finish`, once-only `Seat::finish`)
- `crates/rh-server/src/{main.rs,bot_fill.rs,room.rs,director.rs,bot_learning.rs}` (`--bot-brain off|full`, seat choice at
  `room.rs:1158`, replay name `"brain"`, `HumanBot` as the fault fallback instead of `Idle`, `seat.budget` for Brain seats,
  Brain choices into `BotRunFacts`/`LiveLearning::record`)
- `crates/rh-headless/src/lib.rs` (`BotKind` for `run_bot_match_config`), `src/bin/tournament.rs` (`--policy`)
- `docs/DEVIATIONS.md` (the degraded-profile row)

## 6. Composer design (the core of the packet)
Build the source record as `BVal` with the exact key sets the source declares (`brain/source_input.rs`: `SELF_KEYS`,
`HUD_KEYS`, `FIGHTER_KEYS`, `MOB_KEYS`, `CONTAINER_KEYS`, `PROJECTILE_KEYS`, `MINIMAP_KEYS`, `FEATURE_KEYS`, `EXTRAS_KEYS`),
and run the test-only validators on composed output in tests so the shape stays exact.

| Source group | From the accepted frame | Degraded (unknown) |
|---|---|---|
| `now`, `viewT`, order | `Frame14::source_time`, tick, session context; `viewT` from the pinned world delay | — |
| `self` pose/status/hp/barrier/faction/weapons/slot/kills/gv/bounty/moveSeq | `owner()`, `inventory()` (required group; refuse the frame without it) | — |
| `self` draw/ready/asMult/speedMult/windupMult | `owner_combat()` (exact milli conversions) | — |
| `self.power`, `self.build` | `build()` + card catalog (`cardPower`) | missing Build → refuse, not 0 |
| `self.mobKills` | not on the wire | **undefined** (Strategy's elite/farm reads take their source undefined branch) |
| `self.attackTarget` | `owner_combat().lock`: Clear → null, Held(Some) → id | Held(None) → **undefined**, never null |
| `self.immuneUntil`, `name`, `sig`/`brand` mirrors | source-only for current decisions | source absent value |
| fighters | `WireActor` rows (player kind); `vx/vy` from two same-session samples; `dist/los/tint/central` from self + map | remote `drawStartedAt`, `immune` → **undefined** |
| mobs | `WireActor` rows (npc kind), static type/name mapping | `drawStartedAt` → **undefined**; NPC ids are per-sample (`NpcRef14`): no cross-frame join |
| containers | `props()` handles, reward chests; unknown (`undefined`) vs empty (`null`) kept | — |
| projectiles | current x/y/facing/owner only | `x0/y0/t0/range`, stable id → **undefined**; one-sample courses only |
| minimap | not on the wire | **empty with t = undefined** (Memory keeps no dot history) |
| events | accepted `EventBatch`/`FxBatch` by kind, world vs immediate lanes, exactly once | windup/launch/end events absent |
| extras | wish, effects, fields, camps (no ward owner), chests, plan as delivered | camp `wardOwner/wardExpiresAt` → **undefined** |
| features | bound from the server's configured `SimConfig` (abilities, factions, quests, terrain) | — |

Hard rules: the composer takes only `&Frame14` (and its own ring); it never sees `Sim`/`World`. Hidden-state twins must
compose identical percepts. No join by position, row order or type.

## 7. Behaviour to preserve
- `--bot-brain off` (default): byte-identical live and headless behaviour, replays and hashes.
- Seat contract: every command through `validate` + `Sim::submit`; a faulting Brain seat falls back to `HumanBot`.

## 8. Acceptance checks
- Composer: every composed percept passes the source validators; hidden-state twin test (two worlds differing only in a
  hidden actor give identical percepts and identical `BrainBot` commands).
- `rh-headless/tests/brain_bots.rs`: 8 Brain seats, source-arena profile, two seeds, 6,000-tick cap: no seat fault, every
  seat proposes and has commands accepted, at least one kill resolves, two runs give the same final state hash, the
  recorded replay verifies.
- CPU: per-seat decision time p99 recorded against P-BOTS-1's legacy target (8 bots: mean < 1.5 ms, p99 < 6 ms).
- Learner: `Policy::finish` → `LiveLearning::record` writes the Brain's choice keys (opener, second, spawn, boon, camp).
- `scripts/gate.sh` passes (full).

## 9. Validation commands
- `cargo test -p rh-policy`, `cargo test -p rh-headless --test brain_bots`, `cargo test -p rh-server`

## 10. Risk and suggested model tier
High: about 1,500-2,500 lines across three crates; fairness (C-OBS), determinism, per-tick allocation (the `BVal`
rebuild), CPU per bot. Opus, with an Opus review.

## 11. Known traps
- `BVal` own-key order is part of the source contract (trace equality).
- The Brain seeds from the low 32 bits of `MatchStart.seed`.
- `Seat.budget` is never set in `rh-server` today; set it for Brain seats or a slow Brain stalls a room.
- Learner writes need the single-writer lease and only non-training, non-void runs.

## Notes from previous attempts
Scoped on 2026-11-11 in the cloud session (no implementation).
