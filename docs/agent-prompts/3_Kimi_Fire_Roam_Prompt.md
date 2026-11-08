# P-KIMI-ROAM-1: Fire roaming charge as an authoritative Rust mechanic with captured legacy parity

## ID and outcome

You are Kimi Code working on Roguehalla, a game migrating from a TypeScript/Colyseus server (`packages/`, the legacy
oracle) to a pure Rust authoritative simulation (`crates/rh-sim`). Port **Fire's roaming charge** (backlog item
P-FACTION-2) into `rh-sim` as live, scheduled gameplay. This covers the out-of-combat ramp, the movement-speed modifier
it feeds, the armed physical burst on the next qualifying landed weapon hit, and every reset and lifecycle rule. Prove it
matches the actual legacy TypeScript tick by tick.

The deliverable is a real mechanic wired into the real `Sim` step behind an explicit default-Off mode. It needs fixtures
captured from the unchanged TypeScript, a strict per-tick comparison, restore/replay/allocation/hash evidence and
negative controls that show the tests detect real behaviour bugs. A pure helper, a disconnected module or a test-only
reimplementation is **not** the deliverable.

Work in a separate checkout on branch `kimi/fire-roam`, based on the current `origin/optimization_port`, which contains
`856618eb`. Record your actual base SHA. Open one PR to `optimization_port` and do not merge it. Codex is the
coordinator and integrates after an independent review. Do not modify any other worker's checkout or branch.

Before writing code, read in this order: `AGENTS.md`; `docs/MIGRATION.md` (top checkpoint); `docs/CONTRACTS.md`
(C-TICK, C-INPUT, C-RNG, C-NUM, C-DET, C-OBS, C-PARITY); `docs/backlog/README.md` ("Shared-file rule", "Cross-cutting
rules"); `docs/adr/0009-core-layout.md`; `crates/rh-sim/README.md`; `docs/sweep/PACKAGES.md`; `parity/README.md`;
`tools/fire-fixtures/README.md`; then this packet. Read every legacy file listed below in full. Read the existing Rust
Fire signature (`crates/rh-sim/src/systems/fire.rs`) and one complete prior faction integration end to end (the Fire or
Sentenced evidence under `docs/evidence/`) so your work follows the established pattern instead of inventing one.
**When a comment or design doc disagrees with legacy code, the code wins.**

## Dependencies

Everything this mechanic needs is already merged on `optimization_port`:
- The P-FACTION-1 Fire/Holy/Plague/Frost/Sentenced foundation in explicit `FactionMode` ladders (`crates/rh-sim/src/statics.rs`).
- The hook chain (`AttackStarted`, `HitLanded`, `Hurt`, `FighterOut`, `RaidStarted`, `RunEnded` in `hooks.rs`).
- The damage ledger with derived/deferred hits (`systems/ledger.rs`, `state.rs`).
- Stat mirrors and modifier sources (`stat_fold/`, `modifiers/`).
- The arena lifecycle and status runtime.

No new crates, npm packages, cloud logins or Unity work. Reuse the locked toolchain and the pinned legacy capture
runtime (Linux x64 Node 22.23.4 in a container, exactly as `tools/fire-fixtures/README.md` and `tools/map-fixtures/README.md`
describe).

**Concurrent work to avoid.** Codex is changing player faction/axe reset:
- `systems/signatures*` and the new `systems/signatures/lifecycle.rs`
- the `Teleported` link in the faction chain
- `systems/arena_rules.rs`, `systems/arena_validation.rs`
- `abilities/source_tests/**`, `modifiers/hit_window.rs`

Do not edit those files or the schedule rows they own. Rebase on `optimization_port` before opening the PR. If a
conflict lands in a shared file, keep Codex's version and re-apply your minimal hunk.

## Relevant legacy paths (verified at `856618eb`; re-verify with `rg`)

- `packages/server/src/sim/fireRoam.ts` (135 lines): runtime, hooks, `update` system, `roamingSpeed` mod source, `install`.
- `packages/shared/src/fireRoam.ts` (22 lines): `FIRE_ROAM_RAMP_MS` 20000, `FIRE_ROAM_MAX_SPEED_MULT` 1.5,
  `FIRE_ROAM_CHARGE_MAX` 1000, `FIRE_ROAM_BURST_BASE` 50, `FIRE_ROAM_BURST_AD_SHARE` 0.4, `fireRoamSpeedMult`,
  `fireRoamCharge`, `fireRoamBurstDamage`.
- `packages/server/test/fireRoam.test.ts` (191 lines): the legacy authors' intended cases. Use it as a case checklist, never
  as an oracle; expected values come only from capture.
- `packages/server/src/sim/gameplay.ts`: the install order of `installFireRoam` relative to other installers. Hook links run
  in chain order. `world.systems.unshift(update)` makes `update` the FIRST system.
- `packages/server/src/sim/ledger.ts` (around lines 356-395): `hitLanded` fires once per entry, only when the applied amount is
  greater than 0 and the entry is not `arena`, after the victim's damage and its hit fx; DoT entries included. Also
  `deferHit`, and where `hurt` fires (survivors only, `applied > 0`).
- `packages/server/src/sim/mods.ts` `adOf` (around line 384): `decodeFlat(s.adBonus)`, the **quantized bonus-Offense mirror**,
  not a raw sum and not AP.
- `packages/server/src/sim/world.ts` (`chainHook`, `DamagePacket`, `LedgerEntry` flags), `weapons.ts` (where a weapon action
  and its `packet` object are created), `projectiles.ts` and `melee.ts` (how one action's packet reaches one or more ledger
  entries, including splash and multi-target arcs).
- `packages/shared/src/schema.ts`: `roamCharge` (uint16, 0..1000) and `roamReady` (bool) on `PlayerState`. In legacy they are
  public, synced fields.
- `docs/FIRE_ROAM.md` is **stale**. It says "magic, `50 + 0.4 × AP`", but the code is a **physical** packet
  (`phys: 1, magic: 0, true: 0`) scaled by `adOf` (bonus Offense). Backlog owner question 10 records this. Port the code,
  and flag the discrepancy in your handoff.
- `parity/legacy-capture/` (`capture.ts`, `world.ts`, `scenarios/fire.ts`): the existing Fire traces install `HOLY_MODULES`
  and **exclude** Fire roam (see `tools/fire-fixtures/README.md`). Your scenarios need a module set that includes
  `fireRoam` exactly as `gameplay.ts` installs it.

Rust seams (read, reuse, do not duplicate):
- `crates/rh-sim/src/schedule.rs` Pending rows for `"P-FACTION-2"`: `fireRoam.update` (about line 809), `fireRoam.roamingSpeed`
  (about 934), and the hook links `fireRoam.onAttackStarted`, `fireRoam.onHitLanded` and the four `fireRoam.<arrow>` links
  (about 1150, 1170, 1270, 1327, 1395, 1465).
- `statics.rs` `FactionMode`, `hooks.rs`, `systems/ledger.rs` (`derived`, `passive` and the other entry flags; `packet: Packet`
  is a **value**, not an identity), `state.rs` (deferred hits), `modifiers/` (`ModContribution` speed source),
  `stat_fold/` (mirror encode/decode), `checkpoint.rs` (`check_world`), `content.rs` (`content_hash`).

## New paths

- `crates/rh-sim/src/systems/fire_roam.rs`: the system, mod source and pure helpers. Hook links are `fn(&mut Hx, &HookArgs)` in
  their own file per ADR 0009 (for example `systems/fire_roam/links.rs` if you make it a directory module).
- Focused tests: unit tests in the module, `crates/rh-parity/tests/fire_roam.rs`, plus restore/no-alloc/headless tests in the
  crates where the existing faction tests live.
- `parity/fire-roam/**`: the compact canonical captured corpus, plus `source-manifest.json` with source SHA-256 values,
  revision, command and runtime identity.
- `parity/legacy-capture/scenarios/fire_roam.ts` (a new scenario file) and `tools/fire-roam-fixtures/**` (helpers, README,
  `mutants/*.patch`, the mutation runner).
- `docs/evidence/stage2-fire-roam/README.md`: compact results and handoff. No huge generated logs, no credentials.

## Exclusive write scope

You own the new paths above. You may make **only these minimal hunks** in shared files, each listed verbatim in your
handoff:

1. `crates/rh-sim/src/schedule.rs`: flip exactly the eight `P-FACTION-2` rows from `pending(...)` to their ported entries
   at their existing positions (never reorder, add or remove another row), and update `what_the_slice_has_ported_stays_ported`.
2. `crates/rh-sim/src/statics.rs`: append ONE `FactionMode` variant at the end of the ladder (for example
   `EngagementHolyPlagueFireFrostSentencedRoam`) plus a `const fn fire_roam(self) -> bool`. Every existing variant's
   behaviour and serialized form must be unchanged, and `Off` stays the default. Update exhaustive matches only where the
   compiler requires.
3. `crates/rh-sim/src/state.rs` (and `scratch.rs` only if you need per-tick working sets): one private per-player roam state
   group and whatever arm marker the burst needs. Everything is hashed and checkpointed.
4. `crates/rh-sim/src/checkpoint.rs`: `check_world` rules for every new invariant, with one refusal test each.
5. `crates/rh-sim/src/content.rs`: register the five roam constants once and include them in `content_hash`.
6. `crates/rh-sim/src/systems/mod.rs` / `lib.rs`: the module declaration.
7. `crates/rh-sim/tests/hash_coverage.rs` (and its leaf list if it has one): cover each new serialized leaf.
8. `parity/legacy-capture/{capture.ts,world.ts}`: only the registration lines for a roam-including module set and your
   scenario file. Never change existing scenarios, module sets or recorded fields.
9. `crates/rh-parity`: test registration and, if needed, a roam projection in the per-tick comparator, additive only.

**Forbidden:**
- Observation and protocol: `observe.rs`/`OBSERVATION_VERSION`, `crates/rh-protocol/**`, `protocol/fixtures/**`, the C#/JS
  mirrors, `rh-server` wire.
- Other code areas: Unity, `systems/signatures*`, `arena_*`, `abilities/**`, `cards/**`, `terrain/**`, `reward_chests/**`, and
  the existing Fire signature's behaviour in `systems/fire.rs`.
- Files you must never edit: every existing fixture or golden file, `Cargo.toml`/`Cargo.lock`, CI workflows, `packages/**`
  (the legacy source is the oracle and stays byte-identical), and the shared status records (`docs/MIGRATION.md`, the
  `docs/CONTRACTS.md` status table, backlog statuses other than your own row).

`roamCharge`/`roamReady` are public in legacy. Exposing them in observations and on the wire is a separate coordinator
step (P-NET-3). Put a proposed observation/protocol hunk and its C-OBS classification in the handoff only.

If a scope boundary blocks correctness, stop at a minimal failing reproducer and ask the coordinator. Do not widen scope
silently.

## Contracts and references

- **C-TICK.** `update` runs at its schedule position (legacy: the first system, via `unshift`). The speed source is evaluated
  where legacy's mod sources are folded. Hook links fire at their existing chain positions. Never reorder.
- **C-RNG.** Roam uses no randomness and reads no clock or entropy. Time comes only from the sim's server time.
- **C-NUM.** binary64, the legacy evaluation order (`Math.floor((elapsedMs / FIRE_ROAM_RAMP_MS) * FIRE_ROAM_CHARGE_MAX)`
  exactly as written, then the clamp; `1 + (1.5 - 1) * fraction`), no FMA, no re-association.
- **C-DET.** All new state is hashed and checkpointed. Restoring at ANY tick and continuing gives the same per-tick
  hashes, events and outcomes. Replays reproduce exactly.
- **C-OBS.** No new observation field in this packet. Leak tests stay green.
- **C-INPUT.** No new input or command. Roam is driven only by existing attacks, damage and lifecycle.
- **Allocation.** `crates/rh-sim/tests/no_alloc.rs` stays at zero allocations per warmed step with roam active for several
  Fire players. Use fixed per-player storage, not a map that grows during a tick.
- **Parity policy.** Discrete outcomes (charge integers, ready flags, which entry consumes the arm, kills, winners) are
  exact. Continuous values must be within 2e-6 after the fixture's 1e-6 rounding, and a tolerance that hides a changed
  outcome is a bug.

## Behaviour to preserve (port the CODE exactly; re-verify each point in source)

1. **Charge clock.** Each Fire player who is alive while the phase is `active` has a last-combat time.
   - It is set at raid start for every player.
   - It is set lazily to "now" if missing during `update`.
   - It is deleted on `fighterOut`, on run end, and whenever the player is not Fire, not alive, or the phase is not active.
     In that case `update` also zeroes `roamCharge` and `roamReady`.
2. **`update` (every tick, first system).**
   - `elapsed = max(0, now - lastCombatAt)`; `roamCharge = fireRoamCharge(elapsed)`.
   - If `elapsed >= 20000`, `roamReady = true`.
   - `update` never clears `roamReady` for an eligible player.
3. **Resets.**
   - `resetCharge` sets `lastCombatAt = now` and `roamCharge = 0` (Fire players only). It does NOT clear `roamReady`.
   - It runs on every `hitLanded` entry whose attacker is a Fire player. That includes DoT, signature, ability, derived and
     the burst's own entry, because the reset happens BEFORE the eligibility check.
   - It also runs on `hurt` with `applied > 0` for the hurt fighter.
   - Misses, blocks, zero-damage entries and arena entries never reach `hitLanded`, so they reset nothing.
4. **Arming happens on attack START, not on hit.**
   - On `attackStarted` by an alive Fire player with `roamReady` in an active phase, that action's packet is marked as armed
     by that player.
   - An attack started before the player became ready is never armed, even if it lands after.
   - Legacy keys the mark by packet OBJECT IDENTITY (a `WeakMap`), reset only at raid start. Rust's `Packet` is a value, so you
     need an explicit, hashed, checkpointed identity for "this action's packet" carried to every ledger entry that action
     produces. Two different attacks with equal packet values must never be confused.
5. **Consuming the arm** happens in `hitLanded`, after the reset. All of these must hold:
   - The entry is an eligible auto: `weapon` present, and no `ability`, `sig`, `dot`, `passive`, `derived` or `arena`.
   - The entry's packet is armed by this owner.
   - The owner's `roamReady` is still true at that moment.

   Then set `roamReady = false` (so with one swing, arc or splash that produces several entries, only the first eligible
   entry in ledger order consumes the arm). If the victim still exists, queue a deferred hit for the NEXT ledger pass:
   - the attacker as `by`, `weapon: null`, `derived: true`, `stagger: false`;
   - packet `{phys: 1, magic: 0, true: 0, raw: 50 + 0.4 * max(0, adOf(owner))}`, where `adOf` is the decoded, quantized
     bonus-Offense mirror at that moment.

   Victims can be players or mobs. Mitigation, PvP scaling, outgoing multipliers, kill credit and the hit cap apply through the
   ordinary ledger exactly as legacy applies them to a derived hit. Reproduce whatever happens to an arm mark whose packet
   lands after `roamReady` was re-armed by a later ramp. The mark persists until raid start, so verify this in source and pin
   it with a case.
6. **Speed modifier (`roamingSpeed`).**
   - Applies only to alive Fire players in an active phase who have a last-combat time.
   - Contributes `speedMult = fireRoamSpeedMult(fireRoamCharge(now - lastCombatAt))`, computed FRESH from the clock at
     evaluation time, not from the stored `roamCharge`.
   - It returns no contribution (legacy `null`) otherwise.
   - It flows through the existing stat-mirror fold and its quantized `speedMult` mirror, so movement reads exactly what
     legacy's mirror decodes. Match how often legacy re-folds this source (its `updateMods` pass asks every source once a
     tick) and in which tick position.
7. **Lifecycle.** At raid start, clear all marks and clocks, then set every player's clock to now and their charge and ready
   to 0 and false. On `fighterOut`, delete the clock and zero both fields. At run end, zero both fields for all players and
   clear the clocks. Phases other than `active` (lobby, planning, ended) keep everything at zero.
8. **Other factions and mobs** are unaffected. A mob attacker or mob hurt never changes a player's roam, except as a damage
   source that hurts a Fire player.
9. **Existing behaviour is untouched.** Under every existing `FactionMode` (including `Off`), all existing fixtures, parity
   output, state hashes and content are byte-identical to the base.
10. **Training worlds** install roam in legacy too. Training (P-ARENA-2) is out of scope. Record that gap in the handoff and
    do not claim training parity.

## Acceptance checks

**SUCCESS — all of these must hold:**

- **Real wiring.** With the new mode, the production `Sim` step runs roam through its schedule rows and hook links. No
  test-only path, side table or parallel reimplementation decides outcomes.
- **Unchanged under existing modes.** Every existing mode reproduces its prior per-tick hashes and outputs exactly. Show the
  existing parity report output and existing fixture tests unchanged, plus a dedicated test that runs existing Fire traces
  under the prior ladder variant and compares per-tick hashes with the base.
- **Pure helpers match legacy exactly.** `fireRoamCharge`, `fireRoamSpeedMult` and `fireRoamBurstDamage` match captured
  outputs of the ACTUAL shared TypeScript functions over a deliberate boundary grid:
  - every 50 ms tick from 0 to 25000 ms;
  - each side of 19950/20000/20050;
  - negative and huge elapsed;
  - offense 0, negative, fractional mirror values and large values;
  - non-finite inputs where the TS functions accept them.
- **Captured scenarios** (actual unchanged TypeScript, roam-including module set, pinned Linux x64 Node 22.23.4 container,
  source checksums, `--check` recapture byte-exact). At minimum, one scenario each for:
  1. Full ramp, with the per-tick charge and the quantized speed mirror and the resulting positions.
  2. Reset by landed damage dealt.
  3. Reset by damage taken.
  4. A miss and a block that do NOT reset.
  5. Sword hit consuming the arm.
  6. Bow arrow armed at draw start landing later.
  7. An attack started one tick BEFORE ready that does not consume.
  8. Multi-target swing or wand splash consuming exactly once.
  9. A Fire DoT/signature entry that resets but never consumes.
  10. A Wish/ability hit that resets but never consumes.
  11. Burst on a mob victim.
  12. A burst that kills, with the kill credit.
  13. Burst damage with bonus Offense greater than 0 from an existing producer (chest boost, farm stat or card source already
      ported), plus a case with 0.
  14. A victim that leaves or dies between the hit and the deferred burst.
  15. An armed packet still in flight across a charge reset and a re-ramp.
  16. Two Fire players fighting each other.
  17. A non-Fire control.
  18. Lobby, planning and run end.
  19. Death and `fighterOut`.

  For each scenario, compare these per tick: positions, hp, `roamCharge`, `roamReady`, speed mirror, complete ledger rows
  (including the derived burst's packet and amount), events, kill credit and results. Missing, extra, duplicate or reordered
  ticks or keys fail.
- **Restore everywhere.** Every captured scenario restores from a checkpoint at every tick and continues with identical
  per-tick hashes, events and outcomes. A seeded `rh-headless` match under the new mode with Fire seats replays and restores
  exactly.
- **State integrity.** `check_world` refuses each new invalid state, with one test each. For example: charge above 1000;
  `ready` or a clock on a non-Fire, dead or inactive player; a clock in the future; an arm mark naming a missing owner or an
  inconsistent identity. `hash_coverage` reports zero unhashed new leaves.
- **Allocation.** `no_alloc` reports zero allocations per warmed step with at least four Fire players ramping, arming and
  bursting.
- **Negative controls.** At least ten committed `.patch` mutants are applied one at a time by a runner script that runs the
  focused suites, requires a semantic test FAILURE (not a compile error, panic in setup or hang) and restores the tree. The
  unchanged control must pass. The mutants:
  1. `ceil` instead of `floor` in the charge.
  2. Ready at 19950 ms.
  3. A reset that also clears `roamReady`.
  4. Arming on hit instead of attack start.
  5. Consuming once per target.
  6. DoT/signature entries allowed to consume.
  7. Magic packet or AP instead of physical/bonus Offense.
  8. An unquantized offense sum instead of the decoded mirror.
  9. The burst applied in the same ledger pass instead of deferred.
  10. No reset on damage taken.
  11. The speed source reading the stored charge instead of the fresh clock.
  12. Identity by packet value equality.

  Production code contains no mutant switches.
- **Gates pass.** Formatting, strict Clippy in both workspace modes, focused tests, the schedule and content parity tests,
  `parity-report` and the workspace gate all pass. The handoff reports exact base/head, toolchain, commands, case and tick
  counts, mutant table, every shared-file hunk, the proposed observation/protocol hunk and the known limits.

**FAILURE — return INCOMPLETE with the preserved evidence (never a success claim) if any apply:**
- Expected values come from a hand-written TypeScript or Rust oracle, or from Rust output.
- A fixture is regenerated or edited to match Rust.
- The legacy source is changed.
- A tolerance hides a discrete difference.
- A test is `#[ignore]`d, cfg-gated away, skipped or deleted.
- An assertion is weakened, or an existing test's expectation is changed.
- Production code special-cases scenario ids or test names.
- Clock, entropy or wall-time sleeps are used for ordering.
- The tick allocates.
- Existing hashes or fixtures change under existing modes.
- Edits fall outside the scope above.
- Observation or protocol is changed.
- The result claims that P-FACTION-2, training, wire exposure or Unity is complete.

## Engineering standard (how the code must look)

- Use the existing architecture, not a new framework:
  - one system file with entry points `fn(&mut Cx)`;
  - links `fn(&mut Hx, &HookArgs)` fired by the existing hook call sites;
  - state in `state.rs`, constants defined once and visited for `content_hash`;
  - typed ids, not strings or ad hoc integers.
- Small, named functions that mirror the legacy functions one-to-one (`reset_charge`, `eligible_auto`, `on_attack_started`,
  `on_hit_landed`, `update`, `roaming_speed`), with doc comments that cite the legacy symbol and explain WHY when behaviour is
  surprising.
- Prohibited constructs:
  - `unsafe`, new dependencies or global state;
  - `unwrap`/`expect` reachable from checkpoint/replay input;
  - silent `unwrap_or_default` on parsed fixtures;
  - catch-all match arms that hide new variants;
  - commented-out code;
  - `TODO` stubs presented as done;
  - speculative abstraction or caching without measured need (R-OPT-2).
- Fixture parsing is strict: unknown keys, missing fields, wrong types, non-finite numbers and duplicate or reordered cases
  are errors. CLIs reject zero work and unknown arguments.
- Tests are deterministic and hermetic:
  - ordering by tick and inputs, never by sleeps;
  - every PostgreSQL-dependent test (if any) fails, rather than skips, without `DATABASE_URL`;
  - no test compares Rust to itself as its only oracle;
  - assertions check exact fields, not "something changed".
- If legacy behaviour looks like a bug, port it faithfully, pin it with a case, and list it as an owner question. Do not
  "fix" it.

## Validation commands

Existing:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p rh-sim
cargo test -p rh-sim --test no_alloc -- --nocapture
cargo test -p rh-sim --test hash_coverage
cargo test -p rh-parity --test schedule
cargo test -p rh-parity --test content
cargo run -p rh-parity --bin parity-report
eval "$(tools/pgtest/start.sh)" && cargo test --workspace --all-features --locked   # once, after focused checks pass
```

To be created by this packet (document exact names in `tools/fire-roam-fixtures/README.md`):
- `cargo test -p rh-parity --test fire_roam`;
- the canonical capture and `--check` recapture commands for the pinned container;
- the mutation runner (`tools/fire-roam-fixtures/run-mutants.sh`).

Use at most two parallel workers for long runs, because other agents share the machine.

## Risk and suggested model tier

Medium. The rules are short, but the hard parts are hook ordering, deferred-hit timing, mirror quantization and packet
identity. Work in this order:
1. Port the pure helpers and their grid.
2. Capture the scenarios.
3. Implement against the captures one rule at a time.
4. Add restore, allocation and hash coverage.
5. Write the mutants last.

When a rule, position or number is uncertain, preserve the smallest source-backed failing case and ask the coordinator
instead of guessing.

## Known traps

- `docs/FIRE_ROAM.md` says magic/AP. The code is physical/bonus Offense, so port the code.
- `resetCharge` never clears `roamReady`. The arm survives combat until a qualifying landed hit.
- The reset precedes the eligibility check, so a DoT or signature tick from a Fire player resets the ramp without consuming.
- `hitLanded` is skipped for zero-damage and arena entries. A shield-blocked or fully absorbed hit is neither a reset nor a
  consume.
- Arm on ATTACK START. A bow's packet is created when its draw starts; verify where, in `weapons.ts`.
- One packet can yield several entries (arc, splash). The first eligible entry in ledger order consumes; the rest see
  `roamReady == false`.
- The burst is deferred to the NEXT ledger pass, is itself a derived Fire entry, and therefore resets the charge again when
  it lands.
- `update` is the first system. The speed source reads the clock, not `roamCharge`. A one-tick skew between them is
  legacy behaviour.
- `adOf` is the quantized mirror (`decodeFlat`), not the folded double.
- `Packet` value equality is not identity, and two equal packets from different attacks must stay distinct.
- Keep the existing Fire signature (burn/backlash, which applies only on ticks where voluntary walking changes position)
  untouched. Roam speed changes the walk distance, which may change when those signature rules fire. That interaction must
  match the capture, not be special-cased.
- Training installs roam in legacy. That is out of scope here; say so.

## Handoff (in the PR description and `docs/evidence/stage2-fire-roam/README.md`)

- Base and head SHA.
- Toolchain and capture container identity.
- Every command run, with counts: tests, scenarios, ticks, grid cases, mutants killed and runtime.
- The per-scenario table.
- Each shared-file hunk, verbatim.
- The proposed observation/protocol hunk with C-OBS reasoning.
- The `FIRE_ROAM.md` discrepancy and other owner questions.
- What is NOT done: training, wire/Unity exposure, P-FACTION-2 status update.
- Any failure, reported honestly. Do not update `docs/MIGRATION.md`, the `CONTRACTS.md` status table or `Cargo.lock`.
