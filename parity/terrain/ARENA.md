# Actual legacy arena-lock/teleport terrain continuation

`arena-source.json` (`rh-terrain-arena-source/1`, 78,937 bytes, SHA256
`c6c8543970152292b92a63e0d2279035ccde63fb57531f06b2f4dfa3a75c42ee`) is the source witness for the
P-TERRAIN-1 acceptance item "actual arena-lock/teleport continuation". It is parity evidence, not gameplay
training data, and it is not a claim that the full packet (or the full game) is complete.

The frozen original corpora are untouched and their bytes are asserted by the capture: `source.json`
(SHA256 `e6f870eca04de9ae537f2e367f32b357dada7c6d56b6d3d3712bc095486f1030`) and `born-source.json`
(SHA256 `0526ef2e2c45aab025c9a45a1a82b3a75e82b4c7bf72b310554ce749e2094a0a`). See [README](README.md) and
[BORN](BORN.md).

```sh
tools/terrain-fixtures/arena-capture.sh            # capture into a fresh temporary directory
tools/terrain-fixtures/arena-capture.sh --check    # one canonical recapture/compare against parity/terrain
```

`RH_TERRAIN_ARENA_DIRECTORY` selects another output directory. Capture and check each execute the harness
exactly once; neither performs an implicit additional capture. The canonical witness is the official Linux
amd64 Node 22.23.4 Docker image pinned by digest in `tools/terrain-fixtures/arena-capture.sh`; source is
mounted read-only and `npm ci --ignore-scripts` uses the repository lockfile. `Math.random` throws and item IDs
are sequential. The committed bytes are compared with `--check` after a recapture (`sha256` above).

## Format and boundary

The corpus separates declared `input` (the complete generated map `constructorInputMap`, the declared terrain
overlay, config, players and ordered actions) from actual source `constructed`/`joined`/`born` snapshots and
per-action `frames`. Every frame records the selected actual source lifecycle state (phase/tick/time, run
clocks, gate/coliseum flags, full declared player state and each player's private path/history/slide),
the terrain runtime (light accumulator, report clock, landed-hit combat clock), the hazard statistics
(seconds/damage/heal), the ledger/landed arrays and the ordered events. Private values are server-only parity
evidence and never a client projection. The complete main-stream RNG tape is recorded in order.

The world is the actual ordinary source constructor: `createWorld` over the existing
`tools/terrain-fixtures/born-map-input.json` map plus three declared floor overlay tiles (ember at tile 7,7;
light at 5,7; ice at 7,5), the core installer profile `weapons, targeting, projectiles, terrainEffects,
abilities, vision`, and `planSeconds: 0`. It intentionally contains no loot, camps, mobs or faction-signature
installers, matching the arena corpus' core profile. Every non-constructor operation is an actual source call:

- normal `addPlayer` joins and ordinary `step` ticks; the first tick closes the real lobby and runs the actual
  `beginRun` + `raidStarted` chain (the terrain `onRaidStarted` hook is what starts the light report clock);
- three declared existing-player placements and two declared terrain clocks (trusted test-only setup of already
  admitted state, never a forged actor or expected post-state);
- the real scheduled teleport: `coliseumSchedule.firstSeconds` 0.2 fires the actual `settle` ->
  `teleportToColiseum` producer on tick 5 (250 ms), which clears every slide, preserves the terrain clocks and
  accumulation, locks the gates, and fires the actual `teleported` hook chain;
- two ordinary locked ticks, then the real between-tick `removePlayer` departure (MIA) whose death reopens the
  gates at tick 8 (400 ms) and reschedules the next source slot to 2050 ms;
- one declared trusted post-lock reposition of an existing player back onto the ember tile so the locked burn
  pass is observable; the same declares the witness boundary explicitly;
- ordinary ticks through the 1500 ms teleport-immunity window (the burn pass runs and counts hazard seconds but
  the ledger takes no hp) and past it (the first damaging burn at tick 35, 1750 ms; ordinary damage continues).

## Covered behaviour

- Ember `beforeDamage` burn on a Holy player standing on a declared ember tile: actual ledger shape, true arena
  damage, hp taken, hazard seconds and damage statistics.
- Holy light healing at its installed `systems` position for the fire player standing on the declared light
  tile: hp gained, accumulating light clock, per-player heal statistics, and the summed public heal event when
  the 1000 ms report window closes (`amount: 5.95...` at 1050 ms).
- Ice traction for the plague player standing on the declared ice tile: a declared slide is carried, decelerated
  and regripped by the real movement integration; the slide is observed before the teleport.
- The real `teleportToColiseum` producer: source coliseum spots and the actual private `world.random` shuffle,
  immunity, path/input/history reset, gate lock, coliseum flag and ordered events.
- Teleport hook semantics for terrain: exactly the slides are cleared; the light accumulator, report clock and
  landed-hit combat clock survive.
- Locked gates: the burn pass is suppressed (hazard seconds and damage stay put) even for a fighter standing on
  ember inside a real lock; the light and slide state are unaffected.
- Real between-tick death: MIA result event, positional order, gate reopen, sudden-death clock clear and the
  next source slot on the run clock.
- Teleport immunity boundary: hazard seconds grow while hp is preserved, then real ember damage resumes from the
  exact tick at/after `teleportedAt + 1500` and continues.
- Restore/continue: the produced locked and unlocked states round-trip through `Sim::restore` with the same
  state hash, events and continuation hash; the complete RNG tape and the live spawn stream agree.

## Native consumer

`crates/rh-sim/src/systems/terrain/arena_tests.rs` rebuilds the declared constructor (real map/overlay,
order-salt draw, secrets), joins and steps the same actions through the ported lifecycle and compares every
declared frame, event and RNG draw. Two mutation guards start from the replay's own native snapshots: a slide
recreated after the produced teleport and a locked tick that counted the ember pass must each fail the
comparison.

```sh
cargo test -p rh-sim --lib --all-features systems::terrain::arena_tests
```

## Remaining domains (deliberately not claimed here)

This witness closes the arena-lock/teleport continuation item for the admitted core domain only. Full
P-TERRAIN-1 still requires training-dummy admission and its neutral/no-light surface rule (P-ARENA-2), the
remaining NPC signature faction domains (P-FACTION-2..5), mob slide clearing through a real teleport producer
in an admitted roster world (the existing helper cases and born captures cover mob slides as leaves), and the
public client terrain facts/activation owned by the coordinator (the public first-playable profile keeps hazards
Off).
