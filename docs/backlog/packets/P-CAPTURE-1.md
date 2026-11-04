# P-CAPTURE-1: generalise the capture tool and the parity harness

## ID and outcome
P-CAPTURE-1. Adding a mechanic's parity scenarios becomes mechanical: the capture tool serialises **any** legacy event
generically (no per-kind code), records everything a scenario does (inputs, between-tick actions such as leaves, per-scenario
world options and secrets, projectile launches, per-tick extra state), the Rust harness compares generically and **fails
loudly on anything it cannot compare**, a catalogue of base scenarios per planned mechanic exists, and a CI job re-captures
the fixtures when `packages/` changes and diffs them against the committed ones.

## Dependencies
None. Wave 0: every mechanic packet (P-COMBAT-1..3, P-FACTION-1, P-ARENA-1, P-MOBS-1) edits the same two files; land this
first or serialise carefully (README "Shared-file rule").

## Relevant legacy paths (verified)
- `parity/legacy-capture/capture.ts` (447 lines): `run()` builds `createGameWorld({...}, { signatures: false, walkHints: false })` (l.103-116), `canonicalEvent()` (l.86-101: handles `hit, swing, death, victory, windup, block, stagger, cancel, raidEnded`; **every other fx collapses to `{kind}`**, e.g. `projEnd`), `SCENARIOS` (l.224-387), `pathfindingFixture`, `exportMap` (`rh-map/1`), `revision()` (embeds `git rev-parse HEAD` and `+dirty-packages` into every fixture's `legacyRevision`), the `--only <name>` and `--out <dir>` flags. `parity/legacy-capture/bench.ts` times the legacy `step()` on a fixture's inputs.
- Legacy types to serialise: `SimEvent` (`packages/server/src/sim/world.ts` l.625-639: `fx | toast | raidStarted | planningStarted | plan | questReveal | raidEnded | gv | resolved`), `FxEvent` (`packages/shared/src/messages.ts`; wire form `fxCodec.ts`), `RunResult`.
- Rust harness: `crates/rh-parity/src/lib.rs` (`Fixture`, `build()` l.~250: placements with no weapon, `spawn_seed: 0`, `SimConfig::default()`; `compare()`: `canon(&Event)` maps only the Rust events that exist; **a hardcoded `leave_after` for the scenario named `leave_mia` (tick 40, p2)**; `raw_command()` maps only the slice's input types and reports "input type X is not in the slice"; `TOL` 2e-6; `Report`), `tests/parity.rs` (`every_slice_fixture_matches_legacy` requires >= 8 slice fixtures, `pathfinding_matches_legacy_on_a_generated_map`, `a_changed_rule_is_caught`), `src/bin/parity_report.rs`, `src/bin/parity_bench.rs`.
- CI: `.github/workflows/rust.yml` (fmt, clippy `-D warnings`, `cargo test --workspace`, parity report, headless smoke, browser proof, C# job) and the legacy `.github/workflows/deploy.yml` (manual deploy; do not touch).

## New paths
`parity/legacy-capture/{canon.ts,scenarios/*.ts,world.ts}` (split `capture.ts` without changing its CLI), `parity/README.md` updates, `crates/rh-parity/src/{canon.rs,mapping.rs}`, `.github/workflows/parity-recapture.yml`, `parity/fixtures/` (regenerated output only when a rule actually changed).

## Exclusive write scope
`parity/**`, `crates/rh-parity/**`, `.github/workflows/parity-recapture.yml`. Not `crates/rh-sim` (harness hooks it needs, e.g. a `Placement.weapon0`, belong to the mechanic packets) and not `.github/workflows/rust.yml` (coordinator).

## Contracts and references
C-PARITY (`parity/README.md`: discrete exact, continuous 2e-6; "a tolerance that hides a changed hit, winner, reward or timing is a harness bug"), C-DET, C-RNG (secrets are injected and recorded: `orderSalt`, `rewardSalt` [1,2,3,4], `questSalt` [5,6,7,8]; add new injected secrets per mechanic, never read entropy). `docs/REQUIREMENTS.md` R-PROC-2 (never claim parity beyond what is compared).

## Behaviour to preserve
- Fixture format `rh-legacy-scenario/1` stays readable; additions are optional fields (bump to `/2` only if a field changes meaning).
- Legacy runs headless via the real `createGameWorld` + `step` with `world.random = mulberry32(randomSeed)`, so `orderSalt` is the first draw (the harness asserts it); inputs go through the real `enqueueClientMessage` and are recorded verbatim with their tick; events emitted **between** ticks (a leave's MIA result) are returned with the **next** step in legacy and the harness mirrors that.
- Capture flags observed today: `signatures:false`, `walkHints:false`, mobs/quests/hazards/regen off, no cards, PvP rules on. The mechanic packets add modes (`signatures: true` in P-FACTION-1: **note** this also installs Fire roam, bruiser passives, Plague corpses/zombies and the Sentenced hunt, `gameplay.ts` l.90-93; `mobs`, `planSeconds`, `coliseumSchedule`, `weapon0/1`). Design `world.ts` so a scenario declares `modules: string[]` built from the exported per-module `install` functions rather than a boolean.

## Acceptance checks
1. **Generic canonicalisation:** one function turns any `SimEvent` into JSON `{kind, ...fields}` with sorted keys and every float rounded with `r6`; unknown fx kinds are serialised with all their fields (no collapse to `{kind}`); `toast` is kept (as `{kind:"toast", to, text}`) and `gv`/`resolved` handled as today. Existing fixtures regenerate **byte-identical modulo `legacyRevision`** except where the generic form adds fields: list each change in the PR and update the Rust `canon` in the same PR.
2. **Recorder additions:** projectile launches (`world.projectiles` new ids per tick: id, kind, owner, x, y, vx, vy, t, range, targetId) and ends (`projEnd` with x, y, why); between-tick `actions` (`{tick, type: "leave"|"join"|"drop", player}`) recorded in the fixture, replacing the harness's hardcoded `leave_mia` special case; optional per-tick extras (`mobs`, `fields`, `statuses`, `containers`) behind a `record: [...]` scenario list; secrets used (`legacyConfig.secrets`).
3. **Harness:** a table maps legacy kinds to a comparison; any legacy event or input kind present in a `slice` fixture but absent from the table **fails** the test with the kind named (today unmapped kinds are skipped or reported as "not in the slice"); a per-scenario `requires` list in the fixture asserts those kinds occurred (so an empty scenario cannot pass); mismatch reports show the first differing tick and field.
4. **Catalogue:** at least one scenario skeleton (parity `capture-only` until its packet lands) for each of: swap/pickup, shield/sword/axe, bow/wand projectiles, wand lock, each faction signature, planning/coliseum/sudden death, a mob camp. Each states the packet that flips it to `slice`.
5. **CI job** `parity-recapture.yml` (paths: `packages/**`, `parity/legacy-capture/**`): `npm ci`, `npx tsx parity/legacy-capture/capture.ts`, then a script that diffs `parity/fixtures` and `parity/maps` against the commit **ignoring the `legacyRevision` field** (otherwise every commit differs); fails with the scenario names that changed and a hint ("a legacy rule changed: update Rust or re-record on purpose"). Runs `cargo test -p rh-parity` after.
6. `a_changed_rule_is_caught` still fails when a constant is mutated; add a mutation per new scenario family as packets land.
7. Time: the full re-capture finishes under 10 minutes on a CI runner (record the time).

## Validation commands
`npx tsx parity/legacy-capture/capture.ts` and `--only <name>` / `--only map` / `--only pathfinding`, `npx tsx parity/legacy-capture/bench.ts --scenario crowded_8`,
`cargo test -p rh-parity`, `cargo run -p rh-parity --bin parity-report`, `cargo run --release -p rh-parity --bin parity-bench -- crowded_8 20`,
`cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`.

## Risk and suggested model tier
Medium: no game rules change, but a harness that silently skips things defeats every later packet. Strong builder, high effort on
the "fail loudly" design and on keeping existing fixtures green. Do not weaken tolerances.

## Known traps
- `legacyRevision` changes with every commit (and `+dirty-packages` when `packages/` is dirty): diff must ignore it, and the committed fixtures should record the revision they were captured at.
- Fixture size: `crowded_8.json` is 1.35 MB; a 3,700-tick camp scenario with mobs will be much larger. Use compact forms (omit unchanged players per tick) behind a `format` flag and keep the repository small.
- `capture.ts` imports the legacy source directly (`../../packages/...`); a legacy refactor can break the capture: that is the point of the CI job.
- Floating point: use the same `r6` rounding on both sides; do not round differently in Rust.
- Do not let the harness feed inputs through `submit_unbudgeted` for scenarios that test the order budget; add a flag.
- Node 22+ and `npm ci` are needed for capture; the Rust side needs neither.
