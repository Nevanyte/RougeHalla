# Private native bot vision — code complete, actual source capture PREPARED / UNRUN

**Parity is NOT proven.** The native component is implemented and its hand-derived tests pass, but no
actual source output exists yet: Root must review [CAPTURE-REQUEST.md](CAPTURE-REQUEST.md) before the
first capture. Nothing here activates live/public vision or changes a transport, identity or schema.

- Branch `claude/full-bot-vision`; base `cdec00efa6d56661264271ebc3437f7b7f5349c2` (Root-approved
  descendant of `6a251045`); code commit `2c988ff0d9e710f85dd5a015b5eb83ecb43fa276`; this evidence
  commit adds only `docs/evidence/bot-vision/**`.
- Source of truth: `packages/server/src/bots/brain/vision.ts` (`BotVision.update/canSee/filter`, blob
  `ca8c3f47`) and what it reads in `packages/shared/src/vision.ts` (`VisionMemory`, `bushConceals`),
  `map.ts` (`withGates`, `inColiseum`, `isWallTile`) and `constants.ts`.
- Write scope used: NEW `crates/rh-policy/src/bots/temporal_percept/vision.rs` + `vision/{declared,grid,adapter,tests,source_tests}.rs`;
  NEW `tools/bot-vision-fixtures/**`; NEW `parity/policy/bot-vision/**`; NEW `docs/evidence/bot-vision/**`;
  one `mod vision;` line in `temporal_percept.rs` (rustfmt ordered it after `#[cfg(test)] mod tests;`).
  No Memory file, temporal algorithm, live policy, `Cargo.toml`, `Cargo.lock` or shared status record changed.

## Native behavior (crates/rh-policy/src/bots/temporal_percept/vision*)

| Source behavior | Native | Declared witness case |
| --- | --- | --- |
| `now`, `enabled = phase === "active" && !training`; nonactive/Training clears trail and wards (not reveals) | `BotVision::update` | `reset-gates` |
| owner origin `Math.fround(me.x/y)` only when `me?.status === "alive"` | `update`, `declared::Plan.origin` | `trail-throttle`, `wards[17]` |
| `VisionMemory.update`: finite/ttl/radius guard, 100 ms throttle ignoring origin, reuse refresh of the last visible list, coliseum rectangle, summed-wall skip, fast trace with flat-index reads, exact corner trace, standing tile | `grid::Grid` | `trail-throttle`, `gates-coliseum` |
| exclusive expiry `expiresAt > now`; nonfinite point never visible | `Grid::can_see` | `trail-throttle[10..14]` |
| reconnect `vision` restore: strict seed/w/h, array cells, `Number.isInteger` index in range, finite expiry `> now`, each accepted snapshot clears first, ignored while disabled | `declared::{snapshot_cells, restored_cell}`, `update` | `reconnect-restore` |
| `bushRevealUntil` (`p.extra?.bushRevealUntil ?? 0`, kept only `> now`) rebuilt every active update | `update` | `bush-reveal` |
| wards at original camp indexes: owner/expiry guard, `!site` skip, rebuild on end or map identity change with `ttl = end - now`, removal of unseen indexes | `update`, `Ward` | `wards` |
| `gatesLocked ? withGates(map) : map`, map object identity for throttle/reuse/wards | `Sight`, `BotVision::new` | `gates-coliseum`, `wards[5]` |
| `canSee`: disabled → true; own trail; any ward with `now < end` | `BotVision::can_see` | every probe |
| filter: fighters (`canSee && !bushConceals(map, percept.self, f, reveal, now)`), mobs, containers, projectiles, minimap mobs, chests | `BotVision::filter` | `filter-families`, `bush-reveal` |
| fields: `canSee(f)` and, for trails, `canSee({x2, y2})` (both ends) | `filter` | `filter-families[1]` |
| events: `at === null` kept; unseen death → `{...event, at: null, by: null}` (by appended when absent); other unseen dropped | `filter` | `filter-families[1]` |
| effects trimmed to `self` + filtered fighter/mob ids, JS own-key order (array indexes first) | `filter`, `js_key_order` | `filter-families[1..3]` |
| delayed projectile/row retention through the trail after moving away | `filter` | `filter-families[5,7]` |
| source throws (nullish private message/player, minimap without mobs, event without `at`) | refused before any mutation | four `throw-*` cases |

Declared domain limits (refused, never guessed): string/object coercion of `bushRevealUntil`,
`wardExpiresAt`, the seat's `x/y`; nonnumeric filtered coordinates; non-finite `serverTime`. Where the
source throws, its partial mutation is not modeled: native refuses with no change. Source allocation
failure for an absurd off-map origin is not modeled. The exact trace keeps the source's unguarded loop.

## Prepared actual-source witness (tools/bot-vision-fixtures) — UNRUN

`scenario.mjs` (pure data, 12 cases / 104 steps) declares `PerceptionInput.state/privates` (players as a
`Map`) and composed-Percept shapes on the captured seed-1 map. `runtime.mjs` runs the UNMODIFIED source
`BotVision` through the pinned Node's built-in type transform with allowlisted, hash-checked module hooks,
records every input (encoded before the call), output, canSee answer, filter probe, `inputUnchanged`,
`stateUnchanged`, `sameObject`, thrown errors and an actual private diagnostic read (trail cells, throttle
fields, wards, reveals) in `rh-vision-value/1` (order-preserving; -0/NaN/±Infinity/undefined/holes/Map
explicit), writes raw first, then `verify.mjs` writes a separate verdict. `prepare.mjs` and `closure.mjs`
only read and hash files. Labels: declared method context; no World, perceive, compose or socket is run,
and no earned World/socket claim is made. No grid, ward or reveal is ever installed from an output.

`prepared/MANIFEST.json` (sha256 `250e6e03…9654`) pins the code SHA, all 75 closure files/249 edges, two
package scopes, six tool files, the map, the declared-input hash and the runtime. The static closure scan
found no unresolved specifier and no value import of a type-only name.

## Actual commands and results in this lane

| Command | Result |
| --- | --- |
| `cargo test -p rh-policy` | lib: 199 passed, 0 failed, 1 ignored (`actual_source_parity`); doc-tests: 2 passed |
| `cargo test -p rh-policy temporal_percept::vision` | 14 passed, 0 failed, 1 ignored |
| `cargo fmt -p rh-policy --check` | exit 0 |
| `cargo clippy -p rh-policy --all-targets -- -D warnings` | exit 0 |
| `node --check` on the six tool files | all pass |
| `node tools/bot-vision-fixtures/prepare.mjs … --declared-out` / `--manifest-out` | written; regenerated declared inputs are byte-identical |
| `bash -n` on the extracted capture script | syntax OK (not executed) |
| permission-flag probe: `node --permission --allow-fs-read=… -e …` on a scratch directory | confirms separate `--allow-fs-read` flags, `child`/`worker` scopes; no source, no TypeScript |
| native mutation sensitivity (`rust-mutations.json`) | 13 KILL, 1 expected NONKILL (equivalent reuse) |

Base rh-policy had 185 lib tests; the 15 new vision tests (one ignored) account for the difference.
Retained, non-product: two red full-crate runs while an overlapping scratch mutation run of this lane had
files mutated (see CONTROL-MATRIX.md), and the first-pass M7/M10 NONKILL.

`declared_inputs_are_consumable` proves only that every declared input reads through the Rust adapter and
that native refuses exactly at the four declared source-throw steps. A scratch design check (not committed,
not evidence) ran the declared cases through the native component and the verifier's coverage predicates;
this shaped probe placement only and is no prediction of the source.

## Blockers and remaining work

- **Blocker (by design):** the first actual capture awaits Root review of the literal command. First
  missing input for parity: `parity/policy/bot-vision/source.json` (does not exist). The first possible
  execution risk is Node 22.23.4's built-in `--experimental-transform-types` + `registerHooks` +
  `--permission` combination, never exercised on this source.
- After an admitted capture: pin `SOURCE_BYTES`, un-ignore `actual_source_parity`, report the first
  discrepancy if any; then the source semantic controls S1–S10/N1 under their own lease.
- Root reconciles the `mod vision;` line with DeepSeek's independent Memory declaration.
- Not in scope and not claimed: perceive/compose wiring of `canSee`, live Brain/public activation,
  external reproduction, full Memory, accepted-history/P15 design.
