# P-TERRAIN-1: authoritative terrain effects and ice movement

## ID and outcome

Port ember burn, bog slow, ice traction/collision/recovery and light healing into the ordinary Rust simulation in
their existing legacy schedule and hook positions. Preserve faction home rules, private history/statistics, events,
credit and headless/checkpoint behavior. Unity receives authoritative presentation facts only.

Current work is an unmerged private source/runtime proposal. Partial player comparisons or native-only mob tests
cannot close this packet. Keep the public first-playable profile's hazards Off until the required map facts reach
its client and the admitted gameplay domains are verified.

## Dependencies

The complete map generator and typed terrain layers are integrated. Generic status/stat folding, shared fighter
combat and selected Holy/Fire/Plague PvE are available. Frost/Sentenced NPC signatures, training actors and the real
arena gate lifecycle remain separate producer work. Do not enable them merely to accommodate a fixture.

The terrain kernel may integrate before P-ARENA-1; full locked-arena lifecycle acceptance follows that packet.
P-ARENA-1 serializes its shared-state changes after this candidate, without waiting for this packet's full completion.

## Relevant legacy paths

- `packages/server/src/sim/terrainEffects.ts`: surfaces, burn/bog/light passes, combat/report clocks and reset hooks.
- `packages/shared/src/{terrain,walk}.ts`: effect matrix, faction home rules, slide integration and recovery.
- `packages/server/src/sim/{movement,step,ledger,arena,factions,mobLife}.ts`: movement modifier order, actual damage,
  recent-rival credit, quiet healing and returning mobs.
- `packages/shared/src/{geometry,pathfind,map}.ts`: collision, replanning and centre-tile queries.

Verify exact file/function locations from source before implementation; code wins over stale gameplay prose.

## New paths

- `crates/rh-sim/src/terrain.rs` and `systems/terrain/{mod,walk,source_tests,native_tests}.rs`.
- `tools/terrain-fixtures/{capture.mts,capture.sh}` and `parity/terrain/` source witnesses.
- Focused allocation, restore, privacy and headless tests, with exact filenames recorded at integration.

## Exclusive write scope

The runtime worker proposes new mechanic leaves and serialized changes in an isolated private copy. The source
worker owns only terrain capture/fixture leaves in a separate private proposal. Neither edits the live checkout,
Cargo.lock or shared status records. The coordinator integrates on optimization_port after independent review.

Shared integration includes fighter/path/state/static configuration, movement/heal/ledger/hooks, content identity,
checkpoint/replay versions, schedule classification and consumers of serialized path/slip shapes. No production
authority, map-generation ownership, AWS changes or Unity gameplay is granted by this packet.

## Contracts and references

C-TICK, C-INPUT, C-DET, C-NUM, C-PARITY, C-OBS and C-RNG; ADRs0005/0007/0009/0013/0019;
`docs/sweep/PACKAGES.md`, `docs/REQUIREMENTS.md`, `parity/README.md`. Fixed20Hz pure simulation, source tick order,
validated commands, private runtime and zero warmed-step allocations remain required.

## Behaviour to preserve

- Off disables passes and traction; Map applies faction home rules; All removes home exemptions and boosts.
  A direct surface query still describes the map under Off. Read the fighter's centre tile.
- Fire ignores ember, Plague ignores bog, Frost grips ice, Holy receives doubled light healing under Map.
  Training dummies are neutral. Returning mobs skip burn but remain ordinary targets for player damage.
- Ember records source-named true arena damage through the existing ledger; it is not sudden-death damage.
  Barrier, lethal-floor bookkeeping, terrain damage statistics and recent-rival credit use source semantics.
  Locked gates suppress burn; no ordinary transition to locked gates is fabricated before P-ARENA-1.
- Bog composes with other modifiers and slow resistance in the source order, including the common movement floor.
- Ice preserves exact acceleration, carry velocity, overshoot/collision sweep, path-array replacement identity,
  replan/grip/stuck state, and history-derived velocity. Internal path-buffer reuse must not erase logical identity.
- Light heals players only, after damage. Preserve both ordinary quiet-heal lockout and terrain's landed-hit clock,
  per-player sums, reporting threshold/window, event order and cumulative statistics. No heal-through-combat shortcut.
- Raid start clears all slips and terrain report/combat accumulators; teleport clears slips. Preserve hook order.
- All persistent runtime/path identity participates in hashing and validated restore; unsupported gate/provenance
  tuples are refused rather than accepted into an uncontinuable world.

## Acceptance checks

1. Preserve the frozen first source corpus:66 installed/helper/runtime cases,11 ice traces, surface/sweep/history
   witnesses, provenance and source hashes. Enumerate every case consumed by native comparison. Missing cases
   remain visible failures/incomplete coverage, never a successful filtered run.
2. Compare full declared player state, HP/barrier/movement/history, landed hits, statuses, private clocks/statistics,
   credit/results and ordered event payloads. Normalize representation only, with exact discrete outcomes and the
   established continuous tolerance. Expected post-state is never used to construct native input state.
3. Handle the frozen recorder's cumulative event-array quirk only in the comparator. Do not duplicate actual Rust
   event delivery. Preserve the original fixture bytes and record this boundary explicitly.
4. For manually constructed legacy NPC/dummy/reset cases, use trusted test-only initial-setup adapters or focused
   hook/leaf comparisons. Do not widen production actor admission, forge restored birth provenance or silently
   omit those cases. A helper comparison does not prove ordinary actor lifecycle support.
5. Add separate genuine source-born NPC traces through constructor/raid hooks and ordinary source steps. Record
   the untouched birth state and RNG/counters before any declared positioning/HP/path setup. Native traces must
   use legitimate admitted births and cover burn/death/credit, return exemption, bog/ice and no NPC light healing.
   Preserve separate accounting for signature-disabled faction tests and fully installed faction gameplay.
6. Restore/continue real generated player and mob states, replay a terrain-enabled headless run, verify private
   observations and malformed clocks, actor provenance, duplicate accumulators, slip tuple dependencies, path
   generation headroom and unavailable locked-gate producers. Hash tests populate supported Some states; no
   unsupported Off-slip fixture is grandfathered into restore.
7. Content identity folds executable surface mappings and source names, all constants and walk policy. Prove
   zero ordinary warmed-step allocation, including collision replanning, plus schedule/hash/content classification.
8. Full packet acceptance additionally requires actual arena-lock/teleport continuation and all included NPC/training
   producer domains. Preserve these requirements if a reviewed, explicitly bounded kernel integrates first.

## Validation commands

Existing: `cargo test -p rh-sim`, `cargo test -p rh-sim --test checkpoint`,
`cargo test -p rh-sim --test replay`, `cargo test -p rh-sim --test hash_coverage`,
`cargo test -p rh-sim --test content`, `cargo test -p rh-sim --test no_alloc`,
`cargo test -p rh-parity --test schedule`, `cargo test -p rh-headless`.
Focused terrain and canonical capture commands are to be created by this packet and recorded with actual results.
Run the workspace integration checks after integration; do not repeat completed full-map capture campaigns.

## Risk and suggested model tier

High: source numerical/path identity, history, damage credit, private state and restore invariants warrant a strong
runtime builder and independent strong review. A separate source witness worker reduces shared assumptions.

## Known traps

Manual legacy mobs are not valid native checkpoint births. Source path object identity matters even when coordinates
are equal. The source recorder's retained event list is a harness detail, not a gameplay behavior. Terrain damage
must not inherit sudden death's no-credit rule. Holy's home boost disappears under All. Partial helper parity cannot
close full source-born NPC, arena, headless or public-client acceptance.

Success lines must name the verified scope. Until every full acceptance gate passes, report
`P-TERRAIN-1 INCOMPLETE: <remaining domains>` and never mark the entire packet Done.
