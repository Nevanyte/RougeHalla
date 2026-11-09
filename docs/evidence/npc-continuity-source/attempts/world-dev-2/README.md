# Actual World living-mob continuity attempt

Focused development capture of `tools/npc-continuity-fixtures/world.mts` at source base `197926e27747545934fb801e3df61ae7070905a2`. It ran the real `createGameWorld` assembly and actual 50 ms `step` loop. The arena, camp geometry, seats, factions and deterministic seeds are declared before world creation; the camp mob is spawned by the normal raid-start hook. The observer leaves and returns only through accepted queued `move` messages. No mob, player, phase, HP or loadout state was written after world creation.

- Runtime: `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, Linux amd64.
- Container setup: repository read-only bind; `node_modules` and npm cache on tmpfs; `npm ci --ignore-scripts --no-audit --no-fund`.
- Capture: `captureWorldHistory` called with an async-capable callback that validated callback fields and counted every delivered step. Callback count and source step count both equal 731.
- Output: [world-output.json](world-output.json), 198,922 bytes, SHA-256 `8742230dc6aa43f428d0ee5f54fb288f302218798445250f57aadb1384d87f22`; JSON parsing and key milestone check passed.
- Module: `world.mts` SHA-256 `2a9bd0b42131635f7c1225ce2256be7daae5fedb47246760e4cbcbf11bfc18aa`.

Observed source milestones: `mob1` began alive and visible at 800 units; after the observer moved to 98.33 units and stayed beyond the mob's 900-unit sight radius for 30,250 ms, the same mob remained alive and `canPlayerSee` was false at 1,485.67 units; after queued return movement, that same live mob became visible again at 892 units. The output includes two accepted movement receipts and per-step visibility samples.

This is only the living out-of-sight and return slice. It does not attempt a hidden kill, camp clear or respawn, and does not prove how the parent memory/policy interprets the delivered steps. RNG evidence hashes/counts only the instrumented `opts.random` stream; `createGameWorld`'s separate fixed-salt reward/quest streams are identified but their internal draws are not claimed as traced.

`world-dev-1` is preserved as an initial successful source run with a harness serialization mistake: its writer emitted literal `\\n` characters after the JSON document. It is not a valid output artifact and is not used for this receipt.
