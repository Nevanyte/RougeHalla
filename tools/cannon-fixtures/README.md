# Bounded travel-cannon probes (P-CONS-1c)

These programs import the original TypeScript modules. They do not patch `packages/`, replace functions or inject damage:
the only trusted part is the private state a scenario would otherwise have to play hundreds of ticks to reach (a
position, a cannon's private reload clock and destination, a root status, a walk/attack-move/held mirror). Every attempt
goes through the real `enqueueClientMessage` intake and ordinary 50 ms steps, and the constructor case records the
consumables installer's actual travel producer after the loot prefix.

`capture.mts` builds the seed-1 generated map with the recorded slice module profile (loot, weapons, targeting,
projectiles, mobs, buffs, feed, camps, chests, mobLife, mobAI, abilities, vision, consumables, cardHooks, mods), two
players, one bootstrap step, then drives:

| Case | What it pins |
|---|---|
| `spawn` | The actual travel producer: every container id/kind/position/item, and each cannon's half-way-round destination and zero reload clock. |
| `blast` | A real F pickup at the cannon: the 75 s reload stamp, the displacement and `displaceSeq`, the cleared path/attack-move/held/target mirrors, the toast. |
| `reload-two-seconds`, `reload-one-second`, `reload-ready-boundary` | The source's rounded-up whole-second reload notice and both sides of the ready boundary. |
| `sealed`, `sealed-before-reload` | The coliseum gate seal, and that it is checked before the reload clock (source order). |
| `cannot-enter` | The root cannot-move branch; a stun is refused earlier by the pickup admission. |
| `blocked-landing` | A landing whose disc is not clear silently declines: no stamp, no toast, no move. |
| `clears-mirrors` | The blast clears the walk path, the attack-move goal, the held trigger and the weapon target mirror (a wand user, so the target clear is not done by `weaponChanged`). |
| `chest-control` | The cannon branch is not the pickup branch: an ordinary chest still stores its potion with no displacement. |

Only the pinned Linux x64 Node 22.23.4 runtime is accepted; the corpus records `nodeSha256`, the recorder hash, the
source hashes and the seed-1 legacy map hash. The image is `node:22.23.4-bookworm-slim@sha256:aaa4b5ba…` with a
read-only `/repo`, an executable writable tmpfs `/repo/node_modules` and a writable `/out`:

```sh
mkdir -p node_modules                    # mountpoint for the container's node_modules tmpfs
bash tools/cannon-fixtures/capture.sh    # writes parity/cannons/source.json
bash tools/cannon-fixtures/capture.sh --check
```

The committed corpus must be compared byte-for-byte after a re-capture (`cmp`); only the pinned container's bytes are
parity evidence. Rust validation: `cargo test -p rh-sim systems::cannons --lib` replays every recorded raw container id
through `validate` + `submit_unbudgeted` (the parity harness path: the legacy capture fed the same intake directly),
compares every frame exactly, restores a checkpoint mid-blast and compares the continuation.

Mutation guards: `bash tools/cannon-fixtures/run-mutants.sh` applies each committed patch to the cannon modules (seal
order, reload bound and rounding, cooldown, landing disc, cannot-move, displacement, path/mirror clears, weapon-change,
travel link and installation, focus rule, pickup routing, notice words), requires a semantic test failure and then
checks the unchanged control. `CARGO` may point at the pinned toolchain.
