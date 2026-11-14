# P-FROST-WALL-1d: Frost Wall, fourth sim part: loot pick-up, Plague corpse consume and trader reach read a standing wall

- **Serves:** owner beta follow-up decision 2 (MIGRATION, 2026-11-10: "Frost Wall replaces Freeze"); reviewer-opus's
  ranked list on P-FROST-WALL-1c (items 1 to 3; item 4, the training console, stays in DEV-029)
- **Implementer tier:** implementer-opus (`rh-sim` tick code: action admission, an auto system, a walker, an RNG-drawing
  roll, and an observation read)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework; branched from the coordinator's staging merge `85bfd025e`
- **D-rules touched:** D1 loose proof against the unreleased legacy patch `78dd8bd4` (read with `git show`; not merged
  into `packages/`) · D2 n/a · no identity moves (content hash, observation 30, protocol 17, policy contract 24,
  checkpoint `rh-checkpoint/32`, replay `rh-replay/25`) · parity fixtures run with the switch off and stay untouched ·
  D5/D6/D9 none

## Routing
- **Serves:** owner beta follow-up decision 2 (not an ORDER_OF_OPERATIONS item; recorded in MIGRATION 2026-11-10).
- **Tier:** implementer-opus. **Reviewer:** reviewer-opus.
- **D-rules:** D1 loose proof (one red test per reader with a wall standing; green guards with the switch off, with the
  thing on the player's own side, and for the sight-only reads that must not move).
- **Write scope:** section 5.

## 1. ID and outcome
After P-FROST-WALL-1c every combat, movement and placement reader reads a standing wall through
`crate::barriers::body_map(k, &crate::barriers::held(w), w.rt.gates_locked)`. Three groups of legacy `collisionMap`
readers (patch `78dd8bd4` makes `collisionMap(world)` wall-aware) still read the plain map in Rust. When this lands,
with a wall standing (`SimConfig::frost_wish == Wall`):
1. **Loot pick-up** (`systems/items.rs:297`, the hand line `pickup_reach` with `MASK_MOVE`): a player cannot take a
   container (ground weapon, body, chest, cannon, quest item) whose line crosses the ice; the order is refused with
   `PickupRefusal::Unreachable` ("Can't reach that"), as `loot.ts:146` refuses it. **And the observation agrees**
   (`item_view.rs:301`/`:364` focus, `:132` quest-item eligibility): the F-focus is not given to a prop the hand cannot
   reach, because `item_view.rs:110` is the one rule for "F offers it" and "the action lands".
2. **Plague corpse consume** (`systems/plague_corpses.rs:101-106`, one check shared by the F action and the auto-harvest):
   a corpse the wall rose over is neither consumed by F ("Can't reach that", `PlagueNotice::Unreachable`) nor
   auto-consumed.
3. **Trader reach** (`traders/runtime.rs:99-106` `line_of_sight`, used by `near` for the visitor rule; `:124` the
   walker's path and step map; `:241-248` the trade action): a player across the ice cannot trade ("Move closer to the
   trader"), is not a visitor (the trader neither stops for them nor rolls their stat offers), and a walking trader
   never steps into the ice (its path is cut, as `segmentClear(map, …)` cuts it at `traders.ts:129`).
That is six map reads in four files (`items.rs:297`; `item_view.rs:132`, `:301` for the reach use at `:364` only;
`plague_corpses.rs:102`; `runtime.rs:101`, `:124`, `:244`), each a switch from the plain map to `barriers::body_map`.
No content, wire, observation shape or identity changes.

## 2. Dependencies
P-FROST-WALL-1c merged (in `85bfd025e`). Serial with packets touching `items.rs`, `item_view.rs`, `plague_corpses.rs`
or `traders/runtime.rs`. P-FROST-WALL-3 (a profile selects `Wall`) should wait for this.

## 3. Relevant legacy paths (commit `78dd8bd4`)
`packages/server/src/sim/world.ts:1079` in the patch (`:1072` in-repo), `collisionMap`, gains the barrier overlay
(`withBarriers(base, cells)`, patch line 70 of the world.ts hunk). The readers below are in-repo files the patch does not
touch, so their line numbers are the same in both trees. Masks (`packages/shared/src/map.ts:13-22`,
`geometry.ts:83,93`): the wall's tiles are LOW; LOW is in `MASK_MOVE` (0xff) and `MASK_MELEE`, not in `MASK_SIGHT`. Every
reader in this packet passes `MASK_MOVE` explicitly, so legacy's own mask means **the wall blocks every one of them**.

| Legacy reader | Mask | Rust counterpart | This packet | A player sees today, with a wall standing |
|---|---|---|---|---|
| `loot.ts:146` handlePickup hand line (before `useCannon` at `:147`) | MOVE | `systems/items.rs:297` `pickup_check` → `item_view.rs:111-119` `pickup_reach` | **ports** | loot (and a cannon) taken through the ice |
| (client) `render/interact.ts:12-14` `canInteract`, MOVE, on `RaidScene.ts:727` (patch) `pickupMap` | MOVE | `item_view.rs:301`,`:364` (focus), `:132` (quest item row) | **ports** (see doubts) | the F-focus on loot behind the ice |
| `plagueCorpses.ts:51` F consume | MOVE | `systems/plague_corpses.rs:101-106` (`consume`, `auto = false`) | **ports** | a corpse under the ice eaten from beside it |
| `plagueCorpses.ts:86` auto-harvest (then `handleConsumeCorpse` re-checks `:51`) | MOVE | the same `consume` (`auto = true`) from `system` `:143-165` | **ports** (same read) | the same, with no key pressed |
| `traders.ts:65` handleTrade | MOVE | `traders/runtime.rs:241-252` | **ports** | trading through the ice |
| `traders.ts:103` `map` → `:109` visitor line | MOVE | `runtime.rs:99-111` `line_of_sight`/`near`, called at `:135` | **ports** | a trader stops (and the stat broker rolls offers) for a visitor across the ice |
| `traders.ts:103` `map` → `:120` `findPath(map, …, 12)`, `:129` `segmentClear(map, …, 12)` | MOVE | `runtime.rs:124` (`:161`, `:188-194`) | **ports** | a trader walks through the ice |
| `traders.ts:139-141` install destinations on `w.map` (not `collisionMap`) | MOVE | `runtime.rs:62` (at `raidStarted`) | nothing to port (legacy never reads the wall here) | none |
| `training.ts:198,222,307` practice placements | MOVE | `systems/training.rs:227`, `systems/training/console.rs:331`, `:384` | leaves (DEV-029) | a practice camp or chest set on a wall tile |
Sight-only reads that stay on the plain view (the wall does not stop sight): the visibility of a prop
(`item_view.rs:316` `self.vision.sees(map, …)`; `items.rs:298-304`, `:341-347` `point_visible`), the trade view's
merchant list (`traders/trade_view.rs:69` `point_visible`), the corpse prop rows (`item_view.rs:388-413`: no reach test
at all).

Legacy order inside the readers (kept): pick-up refuses distance (`TooFar`) before the line (`Unreachable`,
`loot.ts:145-146`); corpse consume checks range, then the line, then removes the corpse (`plagueCorpses.ts:47-56`);
trade checks range or line together (one notice), then `pick` (`traders.ts:65-66`).

## 4. New paths
- `crates/rh-sim/src/barriers_reach_tests.rs` (oracle; committed).

## 5. Exclusive write scope
- `crates/rh-sim/src/systems/items.rs`: line 297 only (the map passed to `pickup_reach`). `:299` and `:342` (the
  `point_visible` sight reads) stay on `collision_view`.
- `crates/rh-sim/src/item_view.rs`: line 132 (`eligible_quest_item`'s `pickup_reach`) and the map `pickup_reach` reads
  at `:364`. `:301`'s `map` also feeds `self.vision.sees(map, …)` at `:316`: that sight read keeps
  `sim.collision_view()`; add a second binding for the body map (e.g. `let held = crate::barriers::held(&sim.w); let
  reach = crate::barriers::body_map(&sim.k, &held, sim.w.rt.gates_locked);`) taken once per `candidates` call.
- `crates/rh-sim/src/systems/plague_corpses.rs`: line 102 only. `consume` holds `let p = &w.players[ix]` across the
  read: take `barriers::held(w)` (an `Arc` clone, no allocation) before or beside it.
- `crates/rh-sim/src/traders/runtime.rs`: lines 101 (`line_of_sight`), 124 (`update`'s `map`), 244 (`handle_trade`).
  `update` destructures `Cx { k, w, pf, .. }` and mutates `w` in the loop (`w.players[i].trade_offers`, `modifiers::
  recompute`): take the `held` clone once before the loop and pass the body map (or the clone) to `near`/
  `line_of_sight`; do not hold a borrow of `w` across the loop. `:62` stays (destinations: legacy reads `w.map`).
- `crates/rh-sim/src/barriers.rs`: only the `#[cfg(test)] #[path = "barriers_reach_tests.rs"] mod reach_tests;` lines
  (the stub's); nothing else.
- `docs/DEVIATIONS.md` DEV-029: propose the edit in the hand-off (replace "Not yet: loot pick-up, Plague corpse consume,
  trader reach and the training console's placements read the plain map … (P-FROST-WALL-1d ports the first three; …)"
  with: loot pick-up and its F-focus, Plague corpse consume (F and auto) and trader reach (trade, visitor, walker) read
  the wall (P-FROST-WALL-1d); not yet: the training console's practice placements).
- Not: `constants.rs`, `content.rs`, `observe.rs`, `schedule.rs`, `tests/content.rs`, `vision.rs`, `trade_view.rs`,
  `systems/training*`, `parity/**`, `protocol/**`, `tools/**`, the protocol crate, the policy crate, the Unity client.

## 6. Contracts and references
- C-TICK: no row moves; every read stays where it is in its function. C-INPUT: the same admission order.
- C-OBS: the observation's shape is unchanged; only `VisibleProp.cue.focused` / `cue.body_hint` (wire
  `WireProps.focus`, `crates/rh-protocol/src/state.rs:327-337`) and the presence of a `PropKind::QuestItem` row can take a
  different value, and only while a wall stands. No `OBSERVATION_VERSION`, protocol or policy-contract move.
- C-RNG: with the switch off no draw is added, removed or reordered. With a wall standing, a player across the ice is
  not a visitor, so the stat broker's `roll_stat_trades` (reward stream) is not drawn for them and the walker's
  `shuffled(destinations)` draw follows its now-earlier `next_walk_at`: that is legacy's count (`traders.ts:109-123`).
- C-PARITY: every parity fixture runs with `Freeze` and is untouched.

## 7. Behaviour to preserve
- Switch off: byte-identical. `barriers::body_map` returns `k.collision_map(locked)` when no wall stands
  (`barriers.rs:344-354`), with no allocation. These stay green without re-recording:
  - `cargo run -p rh-parity --bin parity-report` (all MATCH);
  - `cargo test --locked -p rh-sim --features trusted-status-probes --lib ability_hash_tape_matches_the_base` (red on
    `85bfd025e` until the coordinator's carry lands; must not get worse: the same failure, nothing new);
  - `cargo test --locked -p rh-sim --features trusted-status-probes --test step_event_window --test no_alloc --test
    frost_wall_no_alloc --test frost_wall_push_no_alloc --test barrier_observe_no_alloc --test frost_wall_replay --test
    frost_wall_observe --test hash_coverage`;
  - the oracle's guards, including `guard_switch_off_the_observation_is_todays` (a pinned digest of a whole observation
    with loot in reach).
- Identities: none move (pinned by `guard_the_content_hash_is_the_golden_value`, which follows `GOLDEN_CONTENT_HASH` in
  `crates/rh-sim/tests/content.rs`).
- Reads stay in place in the tick (`schedule.rs`: `items::pickup` action, `plague_corpses::consume_action` action,
  `plague_corpses::system` after damage, `traders::runtime::update` system, `handle_trade` action).

## 8. Acceptance checks
- The oracle file passes; `scripts/gate.sh --oracle packet/P-FROST-WALL-1d` passes (full) apart from the two known
  carry tests named in the baseline, if the carry has not landed. No `parity/**`, `protocol/fixtures/**` or `tools/**`
  file changes; no identity constant changes.

## Established facts (oracle author, 2026-11-14, verified on `85bfd025e`)
- Today all six reads take the plain map: `items.rs:297` `cx.k.collision_map(cx.w.rt.gates_locked)`; `item_view.rs:132`
  and `:301` `sim.collision_view()` (a `collision::View` that derefs to the current plain map); `plague_corpses.rs:102`
  `k.collision_map(w.rt.gates_locked)`; `runtime.rs:101`, `:124`, `:244` `k.collision_map(…)`.
- Each uses `MASK_MOVE` (`item_view.rs:115` `ray_blocked(…, MASK_MOVE)`; `plague_corpses.rs:105`; `runtime.rs:104`,
  `:247`; the walker `:193` `segment_clear(…, MASK_MOVE)` and `pf.find_path(map, …)` at `:161`), as legacy does.
- Why `items.rs:297` and `item_view.rs` move together: `pickup_reach` (`item_view.rs:110-119`) is documented as "the
  same authoritative hand reach decides whether F offers the item and whether the action lands". The observation sets
  `cue.focused` (and a body's `body_hint`) on the nearest prop that passes `pickup_reach` (`:362-381`, `:414-417`);
  policy bots act on it (`rh-policy/src/delivery/collections.rs:63`, `lib.rs:1339`). If only the action moved, a bot or
  client would be told to press F on loot the server then refuses. `:132` hides a quest item outside reach entirely
  (`eligible_quest_item` → `continue`), so it moves with them.
- Corpse range: `PLAGUE_CORPSE_INTERACT_RANGE` and `PLAGUE_CORPSE_AUTO_RANGE` are both 24 u (`constants.rs:265-266`). A
  player clear of the ice (disc radius 12) is at least 12 u from a wall tile, so a corpse on the **far** side of a wall is
  never in reach; the case a player meets is a corpse the wall rose over (a player died where the ice now stands). The
  oracle drives that case.
- Trader reach is `TRADER_RANGE` 112 u (`constants.rs:404`): a trader 100 u away beyond the wall is in range.
- The observation of a corpse prop has no reach read, and the trade view lists merchants by sight only: neither moves.
- The legacy client's F prompt in the patch reads `pickupMap = gatesLocked ? withGates(map) : map`
  (`git show 78dd8bd4:packages/client/src/scenes/RaidScene.ts`, line 727): **without** the wall, while its trader panel
  reads `planMap()` (with it). See "Legacy doubts".

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/barriers_reach_tests.rs`
- `docs/backlog/packets/P-FROST-WALL-1d.md`
Stub (the implementer's): the `mod reach_tests` lines in `crates/rh-sim/src/barriers.rs`. No signature was stubbed: the
oracle drives only existing APIs.

## Baseline (on `packet/P-FROST-WALL-1d`, before any implementation)
(filled after the runs)

## 9. Validation commands
`export PATH="$HOME/.cargo/bin:$PATH"`, then:
- `cargo test --locked -p rh-sim --features trusted-status-probes --lib barriers`
- `cargo test --locked -p rh-sim --features trusted-status-probes --test step_event_window --test no_alloc --test frost_wall_no_alloc --test frost_wall_push_no_alloc --test barrier_observe_no_alloc --test frost_wall_replay --test frost_wall_observe --test hash_coverage`
- `cargo test --locked -p rh-sim --features trusted-status-probes --lib ability_hash_tape_matches_the_base`
- `cargo run -p rh-parity --bin parity-report` (all MATCH)
- `scripts/gate.sh --quick`; `scripts/gate.sh --oracle packet/P-FROST-WALL-1d`

## 10. Risk and suggested model tier
Opus: an action admission, an auto system, a walker with a pathfinder and an RNG-drawing roll, and observation code; the
default config must stay byte-identical, and the observation's sight read must not move with its reach read.

## 11. Known traps
- `item_view.rs:301`'s `map` is used twice: for sight (`:316`, must stay the plain `View`) and for reach (`:364`, must
  become the body map). Do not swap the one binding.
- `items.rs:297` sits before `take`, so it also gates cannons (`use_cannon`) and quest items, as `loot.ts:146` precedes
  `useCannon` and `onQuestPickup`. Refusal order: `TooFar` before `Unreachable` (unchanged).
- `plague_corpses::consume` is shared by F and auto; one read covers both. The auto loop advances only on refusal
  (`:157-163`): a refusal must stay a refusal (no removal), or the loop changes shape.
- Traders: `near` is called per player per trader inside `update` while `w` is borrowed; take the `held` `Arc` once.
  The walker's `pf.find_path` and `segment_clear` must read the same body map as the visitor rule (legacy uses one
  `map`). A walker whose next step meets the ice clears its path and stops (no new draw that tick).
- Sight and shots are NOT stopped by the wall: prop visibility, the pick-up refusal's `target_visible`
  (`items.rs:332-348`), the trade view and the vision cache stay on the plain view.

## Legacy doubts (pinned as legacy server; flag, do not fix)
- Client F prompt: in `78dd8bd4` the client's `pickupMap` (RaidScene.ts:727 in the patch) does not carry the wall, so
  legacy's highlight would offer loot behind the ice that its own server refuses (`loot.ts:146`). The client file says the
  highlight copies the server's rule (`render/interact.ts:1`, "so the highlight, the F key and the weapon bar's hint
  agree with it"). Rust's observation focus is that copy computed on the server; this packet makes it agree with the
  server's rule (the patch's evident intent), not with the patch's client. Proposed as part of DEV-029's text; the owner
  may prefer a separate row.
- `traders.ts:103` reads one `map` for the visitor line, the path and the step; Rust reads `collision_map` three times.
  Same map today; with the wall they must all be the body map.
- `runtime.rs:62` computes destinations from `collision_map(gates_locked)` at `raidStarted`, legacy from `w.map` at
  install (`traders.ts:139-141`). Not this packet's concern (no wall can stand before the raid starts); noted only.

## Not established by this oracle
- `item_view.rs:132` (a quest item row offered only within reach): driving it needs a live quest offer; it is the same
  `pickup_reach` call on the same map as `:364`, and the write scope requires it to move with it. The reviewer checks it
  by reading.
- A body's `body_hint` under the focus (the same `best` selection as the ground weapon driven here).
- A cannon or chest across the ice (the same `pickup_check` as the ground weapon).
- The Barter villager's trade (the same reach check as the stat broker's).
- The walker's `find_path` re-plan with a wall standing (the oracle drives the step's `segment_clear` with a pre-set
  path; the re-plan reads the same `map` binding).
- Gates locked with a wall standing. A diagonal wall.
- The training console's placements (left out).

## What stays for DEV-029
- The training console's practice placements (`systems/training.rs:227`, `systems/training/console.rs:331`, `:384`;
  legacy `training.ts:198,222,307`): a practice camp or chest may be set on a wall tile. Training worlds only.
- Nothing else in legacy's `collisionMap` reader list is left: `traders.ts:139-141` (install) reads `w.map`, never the
  wall.

## Notes from previous attempts
<!-- Coordinator appends on escalation: tier, branch, the gate's failure block. Nothing else. -->
