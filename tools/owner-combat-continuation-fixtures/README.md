# Owner-combat continuation fixtures (OWNER_COMBAT_SOURCE_WITNESS bounded continuation)

Additive capture rig for the five remaining owner-combat rows (L07, L08, D02, M04, M05). It drives the real
`packages/server/src/sim` world through `createGameWorld` / `addPlayer` / `enqueueClientMessage` / `step` at 50 ms, decodes
the real `@colyseus/schema` full snapshot and patches into one retained client state, and calls the original human projection
methods from `packages/client/src`. It changes no production, native, Unity, protocol, Cargo or status file, and it does not
touch the frozen `tools/owner-combat-fixtures`, `parity/policy/owner-combat` or `docs/evidence/owner-combat-source` slice.

## Commands

```sh
bash tools/owner-combat-continuation-fixtures/capture.sh            # write parity/policy/owner-combat-continuation/*.json, then check
bash tools/owner-combat-continuation-fixtures/capture.sh --check    # compare byte for byte (output mounted read-only)
bash tools/owner-combat-continuation-fixtures/run-mutants.sh        # 3 semantic kills + 1 provenance survivor + restored control
```

`RH_OWNER_COMBAT_CONTINUATION_OUTPUT` redirects the capture; the path must stay inside this isolated worktree. The pinned image
is `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`,
`--platform linux/amd64`, repo and tool directory mounted read-only, `--tmpfs /repo/node_modules`,
`npm ci --ignore-scripts --no-audit --no-fund`, then
`node --import tsx --experimental-loader ./client-stub-loader.mjs`. The canonical serialization is
`JSON.stringify(corpus) + "\n"`; every corpus carries a profile with the internal TypeScript/style import closure, the
manifests/lock/tsconfig hashes, the tool hashes, the declared map/profiles/setups, the frozen original 32-file hash map, and a
`captureSha256` over the JSON including the profile and excluding only `captureSha256` itself.

## Corpora

- `producer.json` — L07 (real target death under a nonempty canonical wand lock), L08 (the actual `sim/step.ts
  removePlayer(world,id)` called between completed steps and labelled direct lifecycle), D02 (real bow draw vs a legal ordinary
  swap), M04 (the real training `fleet3` card attempt; BLOCKED by the source), M05 (real training down/revival with a real
  admissible interactive card and a second down during a live bow draw).
- `human-projection.json` — the actually decoded owner fed to the original `LockDisplay`, retained `DrawTrack`,
  `isExtension`/`nextCooldown`, `statsOf` and `ChampionCombatHud.update`; direct-lifecycle L08 snapshots are labelled.

Every producer frame carries the canonical owner group (`attackTarget`, `drawStartedAt`, `readyAt`, `asMult`, `windupMult`,
`speedMult`) and build/mobStats before and after the real wire, the patch bytes SHA-256, a full-snapshot encode/decode of the
group, the source events, the original `perceive()` on the live and decoded states, source predicates, projectiles, and
read-only observer taps for `hitLanded`, `fighterOut` and `weaponSwapped`. The only direct lifecycle call is L08's
`removePlayer`; every other input is an ordinary `enqueueClientMessage` message.

## Semantic controls

`mutants/*.patch` are applied to a disposable `/tmp/repo` copy; the read-only `/repo` is never patched, and every file any
patch touches is restored from `/repo` before each mutant. `compare.mjs` skips `/profile` (provenance only) and reports the
first semantic JSON-path mismatch. Raw logs and output SHA256SUMS are written to
`docs/evidence/owner-combat-continuation/mutants/`.

| mutant | expected |
|---|---|
| `01-clearlock-attacktarget-omit` | KILL, L07 lock mirror survives target death (`cases/0/frames/20/owner/attackTarget`) |
| `02-weaponchanged-cancel-omit` | KILL, D02 draw survives the legal swap (`cases/2/frames/8/owner/drawStartedAt`) |
| `03-trainingsettle-resetweapons-omit` | KILL, M05 revival keeps the spent readyAt (`cases/4/frames/58/owner/readyAt`) |
| `04-provenance-only-comment` | IDENTICAL (must not kill) |

## Boundaries

Source and projection witness only: no native/Rust parity, no Unity/DOM/rendering/GPU, no socket/Room/join/reconnect, no
protocol/public-field admission. The client modules run inside Node with stub DOM/CSS/Phaser modules; no real DOM, layout or
Phaser work happens. L08 is a direct lifecycle API call and is not an ordinary-reachability claim. M04 is recorded as a
source refusal, not a produced speed mirror.
