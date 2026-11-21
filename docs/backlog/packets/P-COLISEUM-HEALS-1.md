# P-COLISEUM-HEALS-1: four heal pickups at the centre of the grand coliseum (sim)

- **Serves:** not in the plan: owner request 2026-11-19 (Nevin: the grand coliseum drawing has four "Heals" chests at
  the centre; "should heal 40% HP overtime"), relayed by the coliseum lane. The lane's defaults below (2x2 cluster,
  Large-potion heal, 30 s return) were told to the owner as defaults; he may change the timer.
- **Implementer tier:** implementer-opus (`rh-sim` state, tick, check_world)
- **Reviewer:** reviewer-opus
- **Integration base:** `feature/unity-rework`; stacked on `packet/P-COLISEUM-GRAND-1` @ `e086e773` (unmerged)
- **D-rules touched:** D1 loose proof (no legacy counterpart; the heal reuses the legacy Large-potion Hot, pinned by
  test) · D2 n/a · D5/D6/D9 none (no client prediction; pickups never block movement; no wire change in this packet)

## 1. ID and outcome

On a map whose coliseum is the grand one (P-COLISEUM-GRAND-1), four heal pickups stand at the coliseum centre, one on
each of the four floor tiles around the centre point: tiles (79,79), (80,79), (79,80), (80,80), i.e. the coliseum
`centre` ± half a tile (world (2544,2544), (2576,2544), (2544,2576), (2576,2576)), in that order (NW, NE, SW, SE).
During the active phase a standing player whose body touches an available pickup takes it: it starts exactly the
existing Large-potion heal over time (`potions::DEFINITION.large_share` 0.4 of max hp over `heal_ms` 5000 in
`step_ms` 500 steps, the same `Hot` in `World.potion_healing`), the potion stock is not touched, and the pickup is
unavailable for 30 s (`heal_pickups::DEFINITION.respawn_ms`, the owner's dial) and then available again. On every
other map nothing exists and nothing changes: legacy worlds keep their state, draws and hash.

Clients do not see the pickups yet (see "Split" below): this packet is the rule; P-COLISEUM-HEALS-2 puts them on the
wire and in Unity.

### Split (oracle author's decision, for the coordinator)

Every channel that shows a prop with availability needs a wire change: prop kinds are strict (`rh-protocol`
`state/props.rs:192-207` refuses an unknown kind byte), and the one existing kind with a clock, `Cannon { ready_at }`
(kind 6), is drawn as a cannon by Unity and read as a cannon by the bots (`rh-policy` `bots/perception.rs:285`);
`Chest { open }` (kind 2) would send bots to a chest whose F takes nothing. A new prop kind is a protocol bump to 19, and
ten existing tests pin protocol 18 (Rust `protocol_18_stamp.rs:40,43`, `frost_wall_wire.rs:131`, `map_public.rs:330`,
`envelope.rs:34`, `rh-server` `wire/tests/frames.rs:48`, `tests/ending_metadata.rs:50`; C# `Protocol18StampTests.cs`;
JS `tools/unity-browser-reload-proof/protocol-18-stamp.test.mjs`, `check.mjs:66-102`, `normal-companion.test.mjs`,
`check.test.mjs:240`): amending them is an owner approval. So the wire, the three decoders, the fixtures v19 and the
Unity drawing are **P-COLISEUM-HEALS-2** (protocol 21: 20 was taken by the coordinator's origin sync, P-SYNC-ORIGIN-1, 2026-11-20; proposal: `WirePropKind::Heal { ready_at: u32 }`, prop kind 8, the cannon's
encoding; `PropKind::Heal { ready_at }` in `item_view.rs`; bots ignore it; Unity draws a chest/heal sprite that glows
when `ready_at <= server ms`). Until it lands the pickups are invisible (the item view skips them) but work.

## 2. Dependencies

`P-COLISEUM-GRAND-1` (stacked base): the oracle builds grand maps with `coliseum::grand_layout()`, a stub on the base
that equals the legacy layout. The implementer starts from the GRAND implementation (after it lands, or branched from
`agent/opus/P-COLISEUM-GRAND-1` by the coordinator's choice). Until then every grand-map test is red at its first
assertion ("no heal spots on the grand map").

## 3. Relevant legacy paths

Legacy has no such pickup. The parts it reuses:
- `packages/server/src/sim/consumables.ts:53-73` `handleUseConsumable`: the Hot (`next = now + HEAL_OVER_TIME_STEP_MS`,
  `left = POTION_HEAL_MS / step`, `amount = maxHp * share / steps`), `healingUntil = now + POTION_HEAL_MS`,
  `potionsHealing = active.length`. Port: `crates/rh-sim/src/systems/potions.rs:40-111` (`use_potion`).
- `packages/server/src/sim/consumables.ts:75-98` `updateConsumables`: wind emblems, then the Hot loop, then the boost
  expiry. Port: `crates/rh-sim/src/systems/consumables.rs:8-12` (`wind::update`, `potions::update_hots`,
  `wind::expire`), the consumables schedule slot.
- `packages/server/src/sim/consumables.ts:149-168` `updateWindEmblems`: the legacy walk-over rule: active phase, not
  training, standing players within reach, nearest first, ties by `tieRank`. Port: `crates/rh-sim/src/systems/wind.rs:44-95`.
- `packages/shared/src/constants.ts:652-653` `POTION_HEAL_MS = 5000`, `POTION_LARGE_SHARE = 0.4`. Port:
  `crates/rh-sim/src/potions/mod.rs:25-32` `DEFINITION`.

Port paths this packet touches:
- `crates/rh-sim/src/state.rs:403-415` `ContainerKind` (stub adds `Heal`), `:419-435` `Container` (`ready_at` reused).
- `crates/rh-sim/src/sim.rs:124-153` `try_new_with_mob_initializer` (where construction places containers).
- `crates/rh-sim/src/checkpoint.rs:570-593` the container rules (`ready_at != 0` refused on every kind but `Cannon`).
- `crates/rh-sim/src/systems/initial_loot.rs:180-200` provenance (containers past the initial serial).
- `crates/rh-sim/src/item_view.rs:340-364` the prop kind match (stub: `Heal` is skipped).
- `crates/rh-sim/src/mapdata/model.rs:121-126` `ColiseumDef { rect, centre, gates, inner_spawns }`.
- `crates/rh-sim/src/mapgen/coliseum.rs:142-149` `GRAND_DEFINITION`, `grand_layout` (P-COLISEUM-GRAND-1).

Owner decisions searched (`docs/OWNER_DECISIONS.md`: "heal", "coliseum", "potion", "content hash"): none on the
subject. Row 91 (2026-11-12, generator definitions out of the content hash) is the precedent P-COLISEUM-GRAND-1 used and
this packet follows for its `DEFINITION` (see §7).

## 4. Design

**The switch is the map**, not a config field: pickups exist iff the arena has map layers whose coliseum `rect` is the
grand one (`x = y = CX - 18 = 62`, `w = h = 36`, from `GRAND_DEFINITION.half`), and the four tiles are floor.
Why: the server picks the grand coliseum by choosing the map maker (P-COLISEUM-GRAND-1), and that packet's oracle pins
`Settings::sim()` equal with and without `--legacy-coliseum` ("the switch changes the maps, not the rules",
`crates/rh-server/tests/coliseum_grand.rs:71-78`), so a `SimConfig` flag would need a per-room config the server does
not have. The map travels in the statics (digest), the checkpoint, the replay and the Welcome blob, so the rule is
reproducible everywhere. Legacy maps (18-tile coliseum), the practice arena (no layers) and every fixture keep no
pickups. Writing it as `heal_pickups::spots(&Arena) -> Option<[Vec2; 4]>` (stub in place).

**State: four `Container`s of a new kind `ContainerKind::Heal`** (appended last, so every existing variant index and
serialized byte is unchanged), no new `World` field: `items` empty, `opened` false, `target` None, `born_tick` 0,
`ready_at` the server time it is next available (0 at construction; available iff `server_time >= ready_at`). Created
by the constructor **inside the initial window**: in `initial_loot::initialize`, after the initial loot, before the mob
initializer, ids from `next_entity_id` in NW, NE, SW, SE order, and `initial_birth_serial` then moves past them
(`initial_birth_serial = entity_counter`, on every config branch, including the one without initial loot or mobs).
Why (reviewer-opus rejection of `agent/opus/P-COLISEUM-HEALS-1` @ `22c23147`, which placed them after
`initial_birth_serial`): `replay.rs:128` `Recorder::new` records every container with `id > initial_birth_serial` as a
scenario `WeaponRack`, and `run_replay` seeds them again (`systems/items.rs:204` `seed_weapon_container`): 8 pickups and
a divergence on step 0 of every grand replay (the server replays, `rh-server` `room.rs` ~573); and the raid-start mob
birth serials (`mob_checkpoint.rs:191`, `mobs.rs:335,385`) and quest offer ids (`quests/giver.rs:131`) are counted as
`initial_birth_serial + n + 1`, so pickups after the window shift them and a live grand world's checkpoint is refused
("quest immutable placement mismatch"). `initial_loot::validate` then expects `initial_birth_serial == expected.serial
+ number of spots` and accepts the `Heal` ids in `(expected.serial, initial_birth_serial]` (they are not in
`expected.objects`). `seed_weapon_container` refuses `ContainerKind::Heal` (a scenario container is never a pickup). No RNG draw. A legacy world's state hash is unchanged
because no field was added and no legacy world holds a `Heal` container (pinned).

**Taking: `heal_pickups::update(cx)`, called from `consumables::update`** (no new schedule row: the rows mirror
legacy's table, `crates/rh-parity/tests/schedule.rs`), after `potions::update_hots` and before `wind::expire`. Skipped
in training and outside `Phase::Active`. For each `Heal` container in container order whose `ready_at <= now`:
- candidates are players that are standing, below max hp (`hp < max_hp`), with no potion heal running
  (`potions_healing == 0`; this also keeps a player to one pickup at a time, so one player cannot take two or more of
  the cluster), and whose centre is within `DEFINITION.reach` (20 u: the 12 u legacy body plus 8 u; the pickups are
  32 u apart, so a body touches at most two and takes the first);
- the winner is the nearest; equal distances go to the lower `rng::tie_rank_origin(order_salt, tick, origin)`, the
  wind emblem's legacy rule (`wind.rs:66-81`): no join-order advantage;
- the winner gets the Large Hot exactly as `use_potion` builds it (share 0.4, `next = now + step_ms`, 10 steps,
  `healing_until = now + heal_ms`, `potions_healing` mirror); refactor `use_potion` to share one helper rather than
  copy it. Stocks (`potion_small`, `potion_large`) unchanged; no `PotionNotice`;
- the pickup's `ready_at = now + DEFINITION.respawn_ms` (30 000).
Line of sight is not checked (20 u, open floor). A Pickup command (F) never targets a heal pickup: the item view skips
them in this packet, and a heal pickup holds no item.

**Lifetime:** a heal running when its owner goes down ends as any potion Hot does (`update_hots`, `fighter_out`); the
pickup's clock runs regardless.

**check_world** (`checkpoint.rs`, plus the provenance in `initial_loot::validate`), one refusal test each in the oracle:
on a grand map exactly four `Heal` containers at the four spots in order; none on any other map; each with no item, not
opened, no target, `born_tick` 0, `ready_at` finite and `0 <= ready_at <= server_time + respawn_ms`.

**Content identity:** `heal_pickups::DEFINITION { respawn_ms: 30_000, reach: 20 }` lives in
`systems/heal_pickups.rs` and gets a `NON_GAMEPLAY` row in `crates/rh-sim/tests/content.rs` ("not folded into
content_hash until the owner decides", as `GRAND_DEFINITION`), in its own `oracle-amend:` commit: folding it would move
`GOLDEN_CONTENT_HASH` and every pinned copy (the GRAND brief §4 lists them) for a rule read only on grand maps. The
heal itself uses the already folded `potions::DEFINITION`.

**Identities:** no `CHECKPOINT_FORMAT`, `REPLAY_FORMAT` or `OBSERVATION_VERSION` change is expected (a new enum
variant, no new field, nothing observed); if the implementer finds one needed, bump it and say so.

## 5. Exclusive write scope

- `crates/rh-sim/src/systems/heal_pickups.rs` (stub: replace `spots`, add `update`, the constructor helper).
- `crates/rh-sim/src/systems/consumables.rs` (call `heal_pickups::update`).
- `crates/rh-sim/src/systems/potions.rs` (extract the Hot start shared with `use_potion`; behaviour unchanged).
- `crates/rh-sim/src/sim.rs` (construction; the pickups are placed from `initial_loot::initialize`).
- `crates/rh-sim/src/systems/items.rs` (`seed_weapon_container` refuses `Heal`; added 2026-11-20, approved by the lane
  coordinator).
- `crates/rh-sim/src/checkpoint.rs`, `crates/rh-sim/src/systems/initial_loot.rs` (the `Heal` rules).
- `crates/rh-sim/src/state.rs` (doc of `ContainerKind::Heal`, `Container.ready_at`), `crates/rh-sim/src/item_view.rs`
  (only the `Heal` arm), `crates/rh-sim/src/systems/mod.rs`.
- Not in scope: `schedule.rs`, `content.rs`, `observe.rs`, any wire crate, `rh-server`, `client-unity/`.

## 6. Contracts and references

C-TICK (no new row; inside the consumables slot), C-RNG (no draw), C-PARITY (legacy worlds byte-identical, fixtures
green), C-INPUT (no command: walking is the input), C-OBS (nothing observed in this packet), the rh-sim AGENTS.md list
(no_alloc: four containers, no allocation per step beyond the existing Hot `Vec`; hash_coverage; check_world).

## 7. Behaviour to preserve

- Legacy worlds: no `Heal` container, the same state hash (the oracle pins a legacy run's hash measured on the stub:
  `0xba40_e6d0_daec_05d9` in `legacy_worlds_are_unchanged`, a 200-step run with a player at 50% hp), the same entity ids.
- `use_potion` behaviour and notices unchanged (`potions_tests.rs` stays green).
- `content_hash()` unchanged (`GOLDEN_CONTENT_HASH`).

Existing tests that pin what this packet touches (survey):
- `crates/rh-sim/src/systems/potions_tests.rs`: potion stock, Hot, notices, potion refusals on restore: unchanged rule.
- `crates/rh-sim/src/systems/wind_tests.rs`: wind pickup in the same slot: unchanged.
- `crates/rh-sim/src/checkpoint.rs` container rule `c.kind != Cannon && ready_at != 0` (refuses a non-cannon clock):
  `Heal` becomes the second kind with a clock.
- `crates/rh-sim/tests/content.rs` `NON_GAMEPLAY`: one added row (`oracle-amend:`).
- `crates/rh-server/tests/coliseum_grand.rs:71-78` (`plain.sim() == legacy.sim()`): kept by the map-derived switch.
- Compile-only (`stub:`): the exhaustive `ContainerKind` matches in `systems/loot_world_tests.rs:154`,
  `systems/cannons_source_tests.rs:117`, `systems/planning/source_tests.rs:988` gain a `Heal` arm; no assertion moves.

## 8. Acceptance checks

- `cargo test -p rh-sim --lib systems::heal_pickups` green (the oracle).
- `cargo test -p rh-sim --test content`, `--test hash_coverage`, `--test no_alloc` green; `cargo test -p rh-parity` green.
- `scripts/gate.sh --quick --oracle packet/P-COLISEUM-HEALS-1` green.

## Oracle files (read-only for implementers)

- `crates/rh-sim/src/systems/heal_pickups_tests.rs` (`oracle:`).
- `crates/rh-sim/tests/content.rs` (`oracle-amend:`: one `NON_GAMEPLAY` row for `systems/heal_pickups.rs` `DEFINITION`;
  no existing expectation changes; for the owner's approval).
- `docs/backlog/packets/P-COLISEUM-HEALS-1.md` (`brief:` / `oracle:`).

Stub commit (the implementer may edit these): `crates/rh-sim/src/systems/heal_pickups.rs`,
`crates/rh-sim/src/systems/mod.rs`, `crates/rh-sim/src/state.rs` (`ContainerKind::Heal`),
`crates/rh-sim/src/item_view.rs` (the `Heal` arm), and the compile-only arms in the three test files above.

## 9. Validation commands

- `cargo test -p rh-sim --lib systems::heal_pickups`
- `cargo test -p rh-sim --test content`
- `scripts/gate.sh --quick --oracle packet/P-COLISEUM-HEALS-1`

## 10. Risk and suggested model tier

implementer-opus / reviewer-opus: new container kind in the hashed state, check_world rules, construction order, the
consumables slot. Small code; the risk is the legacy worlds (hash, ids) and the restore rules.

Risks:
- Invisible until P-COLISEUM-HEALS-2: players heal at the centre with no cue but the hp bar.
- Bots (HumanBot, Brain) do not seek the pickups; a bot that walks over one takes it.
- The coliseum fight happens inside the grand coliseum: four 40% heals every 30 s change its pacing (owner's call).
- Proposed `DEVIATIONS.md` row (owner signs): "DEV-<n> | world | Legacy has no heal pickup; the coliseum holds no
  item. | On grand-coliseum maps four heal pickups stand at the coliseum centre; touching one starts the Camp potion's
  heal (40% max hp over 5 s), and it returns after 30 s. Legacy maps unchanged. | Owner request 2026-11-19 (drawing:
  "Heals"; "should heal 40% HP overtime"). | `systems::heal_pickups` tests | reversible (map) | proposed".

## 11. Known traps

- `ready_at` on a non-cannon container is refused today (`checkpoint.rs`, `initial_loot.rs`): relax it for `Heal`
  only, with its own bound.
- Ids: the pickups are allocated inside the initial window (after the initial loot, before `initial_birth_serial` is
  fixed); every later id on a grand map moves by four, legacy ids do not (no pickup there). Allocating them after the
  window breaks replay and checkpoint restore (§4; pinned by `a_grand_replay_reproduces_the_run_with_four_pickups` and
  `a_live_grand_world_checkpoints_after_raid_start`).
- A player standing between two pickups touches both: the first in container order is taken, the second is not (the
  player now has a heal running). A player at the exact cluster centre (22.6 u from each) touches none.
- `server_time >= ready_at` (not `>`): the pickup is available again on the tick its clock reaches.
- `potions::validate` checks `healing_until` against the last Hot and the amount bound against `large_share`: the
  pickup's Hot must satisfy both (it does if it is built exactly as `use_potion`'s Large one).
- Do not emit a `PotionNotice` (its wire byte is 1..=10; a new notice is a wire change, HEALS-2).

## Notes from previous attempts

- Oracle (second author, after a container restart cut the first): every grand-map test fails at its first assertion
  on the stub (`grand_sim` asserts four `Heal` containers; `pickups_stand_…` asserts `spots`); `legacy_worlds_are_unchanged`
  and `the_rule_numbers_are_the_lane_defaults` pass and must stay green. Measured on the stub's grand (= legacy-layout)
  world: no mobs under `SimConfig::default()`, two bodies on one spot are not pushed apart, nothing else heals or hurts
  a parked player over 31 s, and a Large Hot from 50% lands exactly on 0.9. If the GRAND implementation adds mobs or
  hazards near the centre and the exact 0.9 moves, that is a coordinator question, not an implementer edit.
- Owner note relayed 2026-11-19 "8 sides sorry for confusion" concerns the coliseum's shape (GRAND); the four spots
  are the centre tiles of any shape whose centre is (80,80), so this oracle does not depend on it unless the centre
  tiles stop being floor.
- Oracle amendment (third author, 2026-11-20, after reviewer-opus rejected `22c23147`): two tests added to
  `heal_pickups_tests.rs`. `a_grand_replay_reproduces_the_run_with_four_pickups`: a `SimConfig::default()` grand run
  (player 0 placed damaged on the NW pickup, 60 steps) through `Recorder` and JSON, `run_replay` gives the same final
  hash and exactly the same four pickups; `seed_weapon_container(Heal, ..)` is refused. On 22c23147 it fails with
  `Diverged { step: 0, .. }`. `a_live_grand_world_checkpoints_after_raid_start`: `SimConfig::live_content()` on the
  grand map, seeds 5 and 31, two players, stepped until `raid_started_at > 0` plus 20 steps, mobs present, checkpoint
  restores with the same hash. On 22c23147 it fails with `Malformed("quest immutable placement mismatch")`. Both are
  red on the stub at their first heal-count assertion. A throwaway fix (place in `initial_loot::initialize`, the
  validate offset, `seed_weapon_container` refusing `Heal`) on top of 22c23147 turned all nine tests green, so the
  oracle is satisfiable; that code was discarded.
