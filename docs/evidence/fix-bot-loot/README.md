# fix-bot-loot: live fill bots pick up weapons and choose chest rewards

Branch `fix/bot-loot`, based on `integration/backend-unity-union` 976a6559 (protocol 16, observation 24, checkpoint 31,
replay 25, policy 18, content a2d1022ebe713382). **No version identity changed.** No wire, sim, observation or replay
format change; `rh-sim` is untouched.

## Defect

`HumanBot::emit` dropped every `Pickup` and `Choose` (bot.rs "connecting their source loot executors is still pending"),
and nothing produced the intents. Live rooms seat `HumanBot`, so fill bots never picked up a weapon or answered a reward
chest, and fought with fists all match.

## Legacy behaviour (packages/)

- `server/src/bots/brain/tactics/world.ts` actLoot/takeIt/nextStep: walk to the container (waypoints around a wall), stop,
  wait 150 ms still, press F (`pickup`), retry after 400 ms; end on carried count up, two "too far"/one "nothing there"
  toast, the row emptied/gone, a 6 s budget, an enemy within 240 u or an awake mob within 220 u.
- `server/src/bots/brain/strategy.ts` loot() and settle(): a ground weapon within 15 tiles, a body within 8, a weapon
  chest within 8 in the first 25 s; not when engaged, an enemy is within 240 u or an awake mob within 220 u; not a weapon
  already carried; base 0.5 (+0.35 x counter) for a known weapon, 0.3 for unknown contents; a failed or > 8 s loot goal is
  skipped 30 s; finished goals are excluded 1.5 s / failed 5 s.
- `server/src/bots/brain/modules/chests.ts` + `bots/chestHunt.ts`: the cards are read only while the panel is open; the
  one `choose` (best free card by `cardScore`, `-1` = skip) is sent whatever the bot is doing (priority combat, a
  reaction to the panel opening), asked again only for a different card (max 3 asks inside 4 s), never while stunned or
  casting or inside the chest's birth hold; the `ChestHunter` decides walks to chests (time left, fight radius, stall
  give-up).

## What changed

- `crates/rh-policy/src/bots/perception.rs`: the containers and reward chests are keyed by their **public cue** (wire
  position + kind, chest position + expiry) instead of row index `c{i}`/`r{i}`; the frame returns `LootFacts` = each prop
  row and chest **with the handle that observation delivered**, contents as legacy seeContainers draws them (ground
  weapon, focus/body hint, open chest empty), chest options as source ids (`ad1`, `boost:ad`, `kill:..`) only while the
  panel would be open (the server's own `can_choose` and the 88 u panel range), own-pick `taken_by`, the owner's own
  build row and the arena clocks. Handles renew on every cue change/GRACE, so a key is never a handle.
- `crates/rh-policy/src/bots/loot.rs` (new): the live executor. `act_loot` (world.ts actLoot), `loot_goal`
  (strategy.ts loot, narrowed below), `settle` (skip/exclusion), `observe`/`pick_intent`/`chest_goal`/`act_chest`
  (chests.ts). The card choice is the parity-captured `choose_option` and the walk decision the parity-captured
  `ChestHunter` port, reused unchanged through a narrow `live_chests` re-export (`temporal_percept.rs`,
  `temporal_percept/modules.rs`: re-export only, no module code changed).
- `crates/rh-policy/src/bots/brain.rs`: `Goal::Loot { container }`, `Goal::Chest { chest }`.
- `crates/rh-policy/src/bots/bot.rs`: strategy runs `settle`, then the compatibility order chest -> loot -> the existing
  fight/farm/roam; tactics dispatch Loot/Chest to the executor (a chest goal runs alone, as a source module goal); the
  chest pick is merged into every other goal's intents (the module `intents` hook). `emit` resolves a `Pickup`/`Choose`
  key **only** against the latest accepted observation's rows; an unknown key is dropped. The command then goes through
  the seat's existing `resolve` + `validate` + `Sim::submit` intake (C-INPUT). Nothing reads World/Sim (C-OBS).

## What bots now do

A weaponless (or one-handed) bot with no enemy/awake mob near walks to a visible ground weapon (or body, or early weapon
chest), stops, presses F and picks it up. When a reward chest is up it walks to it (when the hunt says it can reach it in
time), and once the cards are readable it chooses the best usable card for its weapon/faction/build/risk, re-asking for
another card if the first was taken; it also answers a readable chest it is merely standing at while fighting/farming.
In a fight (engaged, a fighter inside its threat range, an awake mob within 220 u) it never holds a chest goal: it
fights (wish and combat intents intact) and the pick rides along the fight goal.

## Gates (this worktree, CARGO_TARGET_DIR=target-fix)

| Gate | Result |
| --- | --- |
| `cargo test -p rh-policy --lib` | 453 passed, 0 failed (13 new: 9 executor + 4 seat) |
| `cargo test -p rh-server` | 341 passed, 0 failed, 2 ignored (all targets; first commit, not re-run for the follow-up, which touches only rh-policy bot code) |
| `cargo test --release -p rh-headless --test source_arena_soak -- --ignored` | 2 passed (5 seeds x 2 hitbox modes, each run twice): no panic, deterministic (follow-up re-run: 30.9 s) |
| `cargo test --release -p rh-headless --test bot_loot -- --ignored --nocapture` (new) | passed; see counts below |
| `cargo test --release -p rh-headless --test bots --test tournament --test determinism_sweep` | 3 + 5 + 11 passed (first commit) |
| `cargo clippy -p rh-policy -p rh-headless --all-targets -- -D warnings` | clean (re-run) |
| `cargo fmt --check` (rh-policy, rh-headless) | clean |

New tests:
- `bots::loot::tests` (8): detour offered and its source gates (enemy, awake mob, engaged, carried, both hands full,
  radius, someone nearer); walk -> stop -> F -> retry window -> done; refusal toasts, gone row, enemy near; 30 s skip and
  8 s budget; best free card, same-card re-ask, another card after a take, MAX_ASKS, ask window; no pick while stunned,
  casting, panel shut, birth hold, picked, about to vanish; chest goal in reach / far walk + move / gone / coliseum; own
  card counted once, asks dropped when the panel closes; a fight (enemy in threat range or engaged) suppresses the chest
  goal, a held chest goal is handed back Done with the pick still sent, and the fight goal's hook still offers the pick.
- `bots::bot::loot_seat_tests` (4): `emit` resolves keys only to delivered handles and drops `c0`/`r0`/stale keys; a
  real `Sim` + `Seat` weaponless bot walks to a seeded axe and picks it up through validated intake (no `MissingPickup`,
  deterministic); an offered chest is answered only after its cards are readable, always with the delivered handle and
  a pick in -1..=2, and a bot never sends Pickup/Choose without a delivered row; a real-Sim bot punched at a readable
  chest never holds Goal::Chest, ends in Goal::Fight, sends combat commands and still sends its Choose.
- `rh-headless/tests/bot_loot.rs` (ignored, full map, live config, 8 HumanBots, recorded replay inputs):

| seed | resolved Pickup | MissingPickup | resolved Choose | unresolved Choose | bots seen armed |
| --- | --- | --- | --- | --- | --- |
| 6 | 8 | 0 | 2 | 0 | 4 |
| 42 | 2 | 0 | 2 | 0 | 4 |

  Each seed is run twice and compared (deterministic). Before this change both resolved counts were 0 by construction.
  The review follow-up re-run gives identical counts.

Soak/golden note: the soak test asserts determinism, not fixed hashes, and no headless/server golden changed. The state
hashes of bot matches do change versus 976a6559, as expected, because bot behaviour changed (bots now loot and choose).

## Review follow-up (LAND WITH NOTES)

1. MEDIUM, fixed: the chest goal pre-empted defence. Source chests.goals() competes by worth() (cap 0.84) under a
   committed fight (0.85) or a flight; this seat has no utilities, so `chest_goal` now returns nothing while
   `fighting(v)` (engaged, a fighter inside persona.playerThreat, an awake mob within 220 u: the source predicate), and
   `act_chest` hands a held chest goal back Done the moment a fight starts, with that output's pick still sent. The
   fight goal then runs with its wish/combat intents, and the module `intents` hook keeps offering the pick. Both new
   tests fail with the two guards removed and pass with them.
2. LOW, noted, not changed: after one weapon is taken from a two-weapon body, world.ts's slot (keyed by container,
   pruned only after 3 s unused) keeps repeating Done("picked up"); with the 1.5 s done-exclusion the goal is re-offered
   and immediately ends again, so the second weapon is not taken. That is the source slot rule; changing it would leave
   world.ts, so it is kept and recorded here (cost: one empty think every ~1.5 s near such a body).

## Parity status

- Captured legacy parity already covers the reused leaves: `chooseOption`/`cardScore` and `ChestHunter`
  (parity/policy/bot-private-modules) and the private `actLoot` port (parity/policy/bot-private-tactics).
- **Outstanding:** no captured fixture yet for the live seat composition (the live `act_loot`/`pick_intent`/`act_chest`
  glue and the narrowed loot candidate over Frame14 facts). The live `act_loot` is a line-by-line restatement of
  world.ts rather than a call into the private port (whose context needs the inactive private Memory/Knowledge/Path
  adapters). Strong native tests stand in until a capture packet adds one (tools/bot-private-tactics-fixtures style).

## Limits / narrowings (documented in loot.rs)

- Loot candidates see visible fighters only (no remembered enemies or remembered containers: a container that leaves
  the view ends the detour as "gone"); the Knowledge counter term is 0, so a bot with both hands full never swap-loots
  (source needs counter > 0.34) and the source `second|faction|weapon` choice key is not recorded.
- Mob "awake" is the source no-memory fallback (speed > 20 u/s).
- Candidate order is the compatibility front end's (chest, loot, fight, farm, roam), not the source utility softmax with
  hysteresis; neither chest nor loot is a goal in a fight (where the source ranks them below the fight).
- Two-weapon body: the second weapon is not taken (source slot rule, see review follow-up 2).
- Trophy chests use KILL_AUG_SECONDS life when any option is a kill augment (the wire has no life field).
- Touched outside the narrow scope: only the `live_chests` re-export lease in the private temporal_percept facade.
