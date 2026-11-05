# Complete base-player Frost, power zero

`EngagementHolyPlagueFireFrost` explicitly enables player Frost rate, proximity movement and ranged movement chill together with the preceding Holy/Plague/Fire installation. Off and prior modes remain distinct. Cards, build bonuses, resistance, mobs, elite passives and Fire roam remain outside this slice.

Ten ordinary intake traces in `parity/legacy-capture/scenarios/frost.ts` use the actual `HOLY_MODULES` installation in recorded source order. They add 2,265 ticks; the 80 preceding canonical files are untouched. Every new tick records full Frost source/episode/movement/action clocks plus existing complete combat, engagement, raw/landed and signature diagnostics. Rust validates and submits the recorded commands, compares diagnostics, and restores after every tick through ongoing Draws. A separate asymmetric trace proves an idle, out-of-reach Frost chills its ranged attacker through the reverse engaged edge.

Three separate proof families deliberately use direct helpers or trusted setup and do **not** claim ordinary gameplay intake:

- `helpers.ts`: 150 exact calls to exported actual `stretchUntil` and 13 to actual `frostMoveMultiplier`, including fractional/zero/expired and hold/thaw/reset boundaries.
- `runtime-matrix.ts`: 21 trusted private signature/clock setups passed through installed actual `afterDamage` and movement modifier; inclusive radius, source order/dedup/min, thaw quantization, episode switching/gap/reset, exact ranged expiry, mixed min handoff, short/full Draw clocks and dead/departed live checks.
- `ranged-ledger.ts`: 15 trusted ledger setups through actual `recordHit`, `applyLedger` and installed `afterDamage`; Bow/Wand, refresh, full/partial barriers, immunity, zero damage, same-pass dead shooter/victim, departures and nonqualifying melee/signature rows.

All three tools refuse any runtime other than Linux x64 Node22.23.4. `source-manifest.json` pins exact package source, recorder and proof SHA-256 identities. Canonical captures have `legacyRevision: unknown` because the image lacks git; the manifest supplies source identity separately. Modules are exact, nonempty and checked by Rust. Missing/extra Frost diagnostic keys fail parity.

Use image `c86ecead9e55` with a read-only `/repo`, executable writable tmpfs `/repo/node_modules`, and external `/out`. After `npm ci --ignore-scripts --no-audit --no-fund`, run:

```
npx --yes --package node@22.23.4 node --import tsx parity/legacy-capture/capture.ts --out /out --only frost_weapon_bow
npx --yes --package node@22.23.4 node --import tsx tools/frost-fixtures/helpers.ts /out/helpers.json
npx --yes --package node@22.23.4 node --import tsx tools/frost-fixtures/runtime-matrix.ts /out/runtime-matrix.json
npx --yes --package node@22.23.4 node --import tsx tools/frost-fixtures/ranged-ledger.ts /out/ranged-ledger.json
```

Repeat ordinary capture with the other nine scenario names. Compare files byte-for-byte. Rust checks are `cargo test -p rh-parity --test frost`, `cargo test -p rh-sim --lib systems::frost`, `cargo test -p rh-sim --test hash_coverage --test no_alloc`, `cargo test -p rh-headless --test frost`, and `cargo test -p rh-policy --lib frost_tests`.

Persistent source IDs and clocks are private, serialized and hash-covered; scratch's actual-start marker is ephemeral. Checkpoint13/replay11/observation10/policy7 mark the new semantics. Observations expose the existing chilled bit and timing/position consequences, without private source IDs/history. Protocol5 intentionally does not expose signature bits or effects; transport/Unity are unchanged.
