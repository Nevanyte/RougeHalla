# Actual World visible, out-of-sight, and return slice

Focused source capture from `tools/npc-continuity-fixtures/world.mts` at base `197926e27747545934fb801e3df61ae7070905a2`. It uses real `createGameWorld`, source `raidStarted` camp spawning, fixed 50 ms `step` calls, and accepted queued movement inputs. The declared inputs are the all-floor arena, three camp spots, two map spawns, two fire-faction seats, config, and deterministic seeds. No post-creation actor, phase, position, HP, weapon, camp, or roster writes occur.

- Runtime: `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, Linux amd64.
- Container: source mounted read-only; npm dependencies and cache on tmpfs; `npm ci --ignore-scripts --no-audit --no-fund`.
- Callback: async-capable `onStep({ world, events, label, viewerId, targetId })` awaited after every source step. It received all 773 steps, including lobby, queued approach, departure, 30.25-second hold, return, and render-delay settling.
- Output: [world-output.json](world-output.json), 211,783 bytes, SHA-256 `4c376b8848d124bbd1de9f13625909b875af4125b41077c878495127a5d8800a`. Parsed JSON and the three lifecycle assertions passed.
- Module used for this capture: `world.mts` SHA-256 `6eff62590bd7af8a10d6f7159a808a919895314d7db06192be476bb523bd65d6`.

Observed actual source milestones: natural mob `mob1` spawned in the declared camp and was initially visible at 800 units. The observer then used queued movement to reach an on-screen distance of 697.286 units. It left sight, reached 1,485.67 units away, and stayed outside the 900-unit radius for 30,250 ms; `mob1` remained alive and `canPlayerSee` was false. A queued return brought the same live mob back into the screen window at 688 units. The output records the actual observer/target IDs, all three source-spawned mob IDs and rows, source camp roster state, three accepted movement inputs, every per-step visibility sample, and deterministic `opts.random` draw count/digest.

The parent callback can feed each World step to schema, human-perception and bot-memory readers. This receipt does not claim those consumer results. Hidden death, camp clear, and respawn were not attempted. RNG tracing covers the instrumented `opts.random` stream only; fixed-salt reward and quest stream internals are explicitly not claimed as traced. Earlier `world-dev-1` through `world-dev-3` artifacts remain historical development attempts and are not this final receipt.

After this development capture, the module was changed to define the explicit config once and reuse it for both world construction and `declaredSetup.config`; no scenario values changed. At that development correction point, module SHA-256 was `dbdb6e20dc1287a8900a7cebc30e60b138fce463e810ffb162be1ef23de18bc9`. This development output predates that metadata completeness correction; the integrated parent capture should validate the current module.

The final integrated source subsequently also corrects the movement-count header comment. The final canonical profile, not either development hash above, identifies the sealed module.
