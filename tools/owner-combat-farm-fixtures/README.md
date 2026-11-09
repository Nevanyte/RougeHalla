# Owner-combat farm fixtures (additive ordinary generated/camp-bearing source packet)

Additive capture and consumer for ONE actual ordinary credited player kill of a real catalog nonelite **Plague Rat**
(`plagueRat`, swarm role) on a real generated `generateMap(20261101)` attempt 0 map, with `config.mobs: true`, nontraining,
and the complete `createGameWorld` module order. The kill is the ledger's real
`applyLedger -> mobLife.killMob -> payMobKill -> grantMobStat` chain; the +3 attackSpeed stacks fold through
`recomputeMods` and the real `sim/mods.ts writeMirrors` into the owner's synced `asMult` mirror (`1000 -> 1030` wire).
No direct write to mob stats/HP/death, farm gain, build, mirrors, RNG or outcome occurs in the capture.

## Commands

```sh
bash tools/owner-combat-farm-fixtures/capture.sh            # write parity/policy/owner-combat-farm/source.json, then check
bash tools/owner-combat-farm-fixtures/capture.sh --check    # compare byte for byte (output mounted read-only)
bash tools/owner-combat-farm-fixtures/run-mutants.sh        # semantic asMult-omit kill + provenance-only survivor + restored control
node --import tsx tools/owner-combat-farm-fixtures/verify.mjs --repo /repo   # full consumer (hashes + semantics)
```

`RH_OWNER_COMBAT_FARM_OUTPUT` redirects the capture to another directory inside this isolated worktree. The pinned image is
`node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`,
`--platform linux/amd64`; the repo and tool directory are mounted read-only, `/repo/node_modules` is an empty tmpfs, then
`npm ci --ignore-scripts --no-audit --no-fund` and `node --import tsx`. The canonical serialization is
`JSON.stringify(corpus) + "\n"`; the profile's `captureSha256` covers the JSON including the profile and excludes only itself.

## Corpus

`parity/policy/owner-combat-farm/source.json` (one file) records:

- the actual generated map seed/attempt/hash and tile hash, the actual camp roster index/id/zone/slot, and the actual
  catalog mob type/role/weapon/hp;
- initial, every pre-kill, the kill and the post-kill completed-step frames: host owner group, the retained
  `@colyseus/schema` full `encodeAll` at the first recorded step then every real per-step patch decoded into one retained
  `RaidState`, a fresh full-group snapshot encode/decode, the original `perceive` on the live and decoded states, source
  clocks and held state, the actual target/camp rows and events/observers;
- all seven mirror wires and their decoded values; the three required mirrors are `asMult`, `windupMult`, `speedMult`;
- the actual death fx, `mobKilled` hook, `fighterOut`, lethal `hitLanded`, the real `grantMobStat` toast, the mob GV event,
  and the resulting build/mobStats before and after;
- the source/tool/manifest/package-lock SHA inventory and the imported package versions.

## Consumer and semantic controls

`verify.mjs` checks the recorded output against the actual shared source functions
(`mobStatRows -> foldRows({farmRows}) -> mirrorsFromFold -> encodeMirrors`), never a copied formula, and checks every
source/tool/lock hash. `--semantic-only` skips the provenance hash checks (for a disposable mutant capture) but still
checks `captureSha256` and all semantics. `--compare` prints the first non-profile difference.

```
01-writemirrors-asmirror-omit  KILL       frames[N].owner.asMult expected=1030 actual=1000
02-provenance-only-comment     IDENTICAL  semantic consumer passes; compare identical excluding /profile
```

The semantic mutant is applied to a fresh disposable `/tmp/repo` copy inside the pinned container; the read-only host
source is never patched. The final restored unmutated control must match the checked-in corpus byte for byte.

## Boundaries

Source and owner-projection witness only: no native/Rust parity, no Unity/DOM/rendering/GPU, no socket/Room/join/reconnect,
no protocol or public-field admission. Declared SETUP: map seed, config, seat ids/factions, the owner/ally start positions
and the ground rack/loadout. NOT setup: NPC stats, roster, death, farm gain, build, mirrors and every RNG outcome. The
optional second move-speed farm case was not attempted; the required attack-speed case is complete.
