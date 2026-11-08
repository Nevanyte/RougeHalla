# Owner-combat source capture (OWNER_COMBAT_SOURCE_WITNESS)

Canonical **actual-source** capture for the owner combat group audit: the real `createGameWorld`/`step` lifecycles in
`packages/server/src/sim`, driven only by ordinary `enqueueClientMessage` inputs, decoded through the real
`@colyseus/schema` wire and projected through the original human methods in `packages/client/src`. Evidence only: this
packet changes no production, schema, protocol, native, Unity or content file.

## Commands

```sh
bash tools/owner-combat-fixtures/capture.sh            # write parity/policy/owner-combat/*.json, then check them
bash tools/owner-combat-fixtures/capture.sh --check    # compare byte for byte (output mounted read-only)
bash tools/owner-combat-fixtures/run-mutants.sh        # 4 semantic kills + 2 survivors + restored control
```

`RH_OWNER_COMBAT_OUTPUT` redirects the capture; the path must stay inside this isolated worktree. The pinned image is
`node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`,
`--platform linux/amd64`, repo and tool directory mounted read-only, `--tmpfs /repo/node_modules`,
`npm ci --ignore-scripts --no-audit --no-fund`, then `node --import tsx --experimental-loader ./client-stub-loader.mjs`.
The canonical serialization is `JSON.stringify(corpus) + "\n"`; every corpus carries a `profile` with the internal
TypeScript/style import closure, the manifests/lock/tsconfig hashes, the tool hashes, the declared map/profiles/setups and a
`captureSha256` over the JSON including the profile and excluding only `captureSha256` itself. External package contents
are pinned by `package-lock.json` and the recorded installed versions, not claimed as a fully hashed external graph.

## Corpora

- `producer.json` — twelve real cases (L01-L06, D01, D03, D04, M01-M03). Every frame is one completed 50 ms step and
  records: the queued ordinary inputs with their accepted flag, the canonical owner group (attackTarget, drawStartedAt,
  readyAt, asMult, windupMult, speedMult) plus context (status/faction/slot/weapons/hp/effects) **before** the wire and
  **after** decoding the real patch, the patch bytes SHA-256 and a fresh full-snapshot encode/decode of the group, the
  source events in order, the original `perceive()` on both the live host state (the server brain's input) and the decoded
  client state, and labelled probes (canPlayerSeeActor, direct LOS, bushConceals, isHidden/isUntargetable, lockable, and the
  lock runtime's own lockSeen/lockLosLostAt/action).
- `human-projection.json` — the actually decoded owner row fed to the original human methods: `LockDisplay.note/shown`
  (synced vs optimistic at declared UI clocks), one retained `DrawTrack` per lifecycle with `fullDrawSeconds`,
  `isExtension`/`nextCooldown` carried through the decoded `readyAt` sequence, `statsOf` (real `buildGains`) and the real
  `ChampionCombatHud.update` rows read back from the stub nodes.
- `boundaries.json` — DECLARED probes only: `PlayerState` uint32 reflection/defaults and encode/decode for every declared
  `drawStartedAt`/`readyAt` value with the original bot u32 output, f64 mirror roundtrips and `encodeMult`/`decodeMult`, and
  declared `LockDisplay`/`DrawTrack`/`nextCooldown` boundary probes.

## Semantic controls

`mutants/*.patch` are applied to a disposable `/tmp/repo` copy; the read-only `/repo` is never patched, and every file any
patch touches is restored from `/repo` before each mutant. `compare.mjs` skips `/profile` (provenance only) and reports the
first semantic JSON-path mismatch; `run-mutants.sh` fails unless each mutant's first mismatch equals `mutants/expected.txt`
and each mutant marked `IDENTICAL` recaptures every corpus semantically identically. Raw logs and output SHA256SUMS are
written to `docs/evidence/owner-combat-source/mutants/`.

| mutant | expected |
|---|---|
| `01-setlock-attacktarget-omit` | KILL, `producer.json /cases/0/frames/1/owner/attackTarget` "tgt" -> "" |
| `02-clearlock-attacktarget-omit` | KILL, `producer.json /cases/1/frames/6/owner/attackTarget` "" -> "tgt" |
| `03-perceive-u32-identity` | KILL, `producer.json /cases/0/frames/5/bot/self/readyAt` 1360 -> 1360.1010101010102 |
| `04-writemirrors-windupmult-omit` | SURVIVOR (no reachable producer changes windupMult; see the evidence README) |
| `05-nextcooldown-arithmetic` | KILL, `human-projection.json /cases/0/frames/0/cooldown/nextCooldown` 250 -> 251 |
| `06-provenance-only-comment` | IDENTICAL (must not kill) |

## Boundaries of this evidence

Source and projection witness only: no native/Rust parity, no Unity/DOM/rendering/GPU, no socket/Room/join/reconnect, no
protocol or public-field admission, and no claim that the declared boundary probes are reachable gameplay. The client
modules run inside Node with stub DOM/CSS/Phaser modules; the projection methods themselves are the original exports.
