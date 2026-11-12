# Actual legacy loot-world runtime witness

`source.json` (`rh-loot-world-source/1`, 7 cases, 46 frames, 78,382 bytes, SHA256
`f1758aa3760c10d70c2b62eccebfba46b4ce137734458aaad9449ea9a2174e39`; the first six cases are unchanged, the seventh was added by `fix/mechanics-cons`) is parity evidence for the P-COMBAT-4 loot
world: it executes the unchanged TypeScript source, never Rust. Expected values were produced by that source; the
fixture records server-private run counters, item uids, container births and RNG stream tails and is never a client
projection or gameplay training data.

```sh
tools/loot-world-fixtures/capture.sh            # capture into a fresh temporary directory
tools/loot-world-fixtures/capture.sh --check    # one canonical recapture/compare against parity/loot-world
```

The canonical witness is the official Linux amd64 Node 22.23.4 Docker image pinned by digest in
`tools/loot-world-fixtures/capture.sh`; the repository is mounted read-only and `npm ci --ignore-scripts` uses the
lockfile. `Math.random` throws and item ids are sequential. Capture and check each execute the harness once; only the
pinned container's bytes are evidence. `RH_LOOT_WORLD_DIRECTORY` selects another output directory.

## Constructor and boundary

The world is the actual `createWorld` over the existing `parity/initial-loot/input-map.json` map with twelve
declared ground spots added on floor tiles (the map is otherwise the complete exported map; it is not regenerated).
The installer profile is the actual `loot, weapons, targeting, projectiles, mobs, buffs, feed, camps, chests,
mobLife, mobAI, abilities, vision, cardHooks, mods` order, with the declared configuration in the fixture. All
expected state comes from actual source calls: normal `addPlayer` joins, one ordinary `step` (the real lobby
close/raid start), genuine `enqueueClientMessage` pickup and swap commands consumed by ordinary fixed steps, one
actual `grantCard(world, c, "committed")`, one actual `removePlayer` departure, and two declared container creations
through the actual `addContainer`/`holdBirth` API. The trusted parts are only the declared existing-player state
(placements, carried weapons, potion counts) and those two declared container creations; no expected post-state seeds
native input.

## Format

Each case separates declared `input` (setup and ordered actions) from actual `frames`. A frame records the tick,
server time, entity/item counters, every player's position/HP/potions/weapons/slot/cooldown/status, every container
(kind, position, opened, exact item uids/defaults, private stat-crate offer), the owner-addressed toasts the actions
produced and the private main/reward/quest stream tails (next four draws each). Private values are server-only parity
evidence.

## Covered behaviour

- The actual `spawnLoot` container allocation and ground-weapon rolls (chest `c1` small potion, ground `c2` sword,
  `c3` axe, `c4` sword) and the exact constructor RNG prefix.
- Ground-spot weapon pickup into an empty hand (weapon taken, prop vanishes, shared cooldown), second-slot fill with
  no cooldown, both-slots-full replacement that drops the held weapon where the player stands, and the same-tick
  blind-id guess refused by the container birth gate (next tick it is takeable).
- Committed's `lockSecondSlot` (`EffectFlag::LockSecondSlot`): an empty second slot is not filled, the hand is
  replaced and its weapon dropped, and the locked swap is refused (hand and cooldown unchanged).
- A real between-tick departure: the body holds the carried weapons and small potions, the departing player's slots
  clear, the body waits one tick before it is takeable, and it stays as an empty prop once looted.
- Camp (large) potions in a departing carrier's body (`body-drop-camp-potions`): `dropBody` order is weapons, then every
  `potionLarge`, then every `potionSmall`; both stocks clear, and each potion is taken back one per pickup.
- `holdBirth`/`bornThisTick` scheduling: a chest created inside a tick and held is first pickable two ticks on, and
  a between-tick container waits one tick; both then resolve through the ordinary pickup path.
- An ordinary unlocked swap (hand flips, `SWAP_SECONDS` cooldown).

## Native consumer

`crates/rh-sim/src/systems/loot_world_tests.rs` replays every case from the real `initial_loot` constructor (the same
map/ground spots/secrets and actual `spawnLoot` allocation), the actual `cards::grant` for Committed, the actual
`remove_player` departure and the declared container creations, and compares every frame bit-exactly (numbers by bit
pattern), including the RNG stream states. Two in-test mutation guards require the Committed grant and the body's
birth wait to be load-bearing; `docs/evidence/stage2-combat-4/mutants.json` records external mutants that revert the
production flag reads and fail the parity test.

```sh
cargo test -p rh-sim --all-features --lib systems::loot_world_tests
```

## Remaining producer domains

This witness covers the loot world's crate/ground/bodies/births and the pickup/swap consumers for the admitted line-A
profile. It does not cover travel cannons and the cannon pickup (`P-CONS-1`), reward containers and the camp-chest/kill-augment `holdBirth` producers (`P-CARDS-1/P-CARDS-2`), quest
items (`P-QUEST-1`), the traders' identical slot rule (`P-TRADE-1`), or client-predicted locked swap facts (no
protocol fact at protocol 7). `P-COMBAT-4` stays INCOMPLETE for those owners.
