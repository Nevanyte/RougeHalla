# P-BOT-TACTICS-1 — complete private tactics native closure (DeepSeek)

Status: **HOLD-repaired, locally gated and reviewable as an uncommitted scoped candidate** (Root independent initial review
`a54533b8` held three groups; the bounded repairs are recorded in [REPAIRS.md](REPAIRS.md) and all affected gates are
re-run green below). This closes the private
decision-to-intent layer (`createTactics` with its real Fight, WorldTactics, OrbWalk, Reflexes and Retreat) over the
Root-admitted source handoff `54ff01a2`. It does **not** claim whole-Brain composition, module registry/execution, public
fact publication, live activation, World/Sim behavior, observation/protocol behavior, Unity, networking or deployment.

## Assignment, workspace and provenance

| Item | Value |
|---|---|
| Packet | `docs/backlog/packets/P-BOT-TACTICS-1.md` (Root dispatch `f252b8697cbff3afcee71711cf33db40c411399a`) |
| Worktree | `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-tactics` |
| Branch | `codex/deepseek-private-tactics` |
| Clean HEAD at start (unchanged, not committed) | `f252b8697cbff3afcee71711cf33db40c411399a` |
| Source admission | `docs/evidence/bot-private-tactics-source-review/ADMISSION.md` (independent reproduction `c8d0a5e6`) |
| Frozen file summary SHA-256 | `source.json` = `5d27d1b4522d386d4ede5f3064a28660dedff43e32a24ade264f4512e30fcfa8` (11,656,923 B); `coverage.json` = `b43c64fe…` (1,069,183 B); `manifest.json` = `9f764060…` (37,387 B) — recomputed here, equal to the admission table |
| Native source inventory | [source-inventory.txt](source-inventory.txt) (bytes/SHA-256/lines, exact scoped paths) |
| Corpus identities | [corpus-identities.txt](corpus-identities.txt) |
| Retained first failures | [first-failures.md](first-failures.md) |

Only the two Root-allocated existing-file hunks are present (`git diff`, also in the inventory):

1. `crates/rh-policy/src/bots/temporal_percept.rs`: `+mod tactics;` (one line).
2. `crates/rh-policy/src/bots/temporal_percept/strategy.rs`: `-mod types;` → `+pub(super) mod types;` (visibility only;
   no strategy type, algorithm, fixture or test change).

Everything else is new under the leased paths only:
`crates/rh-policy/src/bots/temporal_percept/tactics.rs`, `.../tactics/**` and this evidence directory. No change to
public Fighter/OrbWalk/Retreat APIs, `bot.rs`/`brain.rs`/`Goal`, World/Sim, observation/protocol, Unity/network,
source/tools/fixtures, dependencies, `Cargo.lock` or shared status records. No build artifacts are tracked (the only target
directory is the worktree-local `/target`, which git ignores; a nested source-tree build cache was detected and removed
before sealing).

## HOLD repair round (Root review `a54533b8`)

The three reviewed groups are repaired without widening tolerance or changing any fixture/expectation: one real checked
decode/apply entry shared by normal replay and malformed injection on the same reached runner with a full pre/post snapshot
(Memory/retained counters/full transcript/RNG ordinal+next/Knowledge fingerprint/path stats+budget/env/percept) and exact
remaining-continuation equality; ordered tagged key sequences at every specialized comparator boundary (with only the plain
fixed `drawCounts` envelope key-set and the separate documented sorted-key plain-JSON compatibility corpora excluded);
geometry tolerance bound to actual computed `pickHoldSpot` ancestry with tiny-delta controls proving direct declared Hold
endpoints are bit-exact. Details, per-group controls and receipts: [REPAIRS.md](REPAIRS.md).

## Native implementation


| File | Role |
|---|---|
| `tactics.rs` | private `createTactics` closure: one-time sudden-death knowledge draw, flee reset, `fight.leave`, nine-goal dispatch, world-then-shared-Reflex arbitration/hold, flee retention/corner fallback, both stats aliases (`SourceGoal`, `SourceFoe` aliases for the harness). |
| `tactics/types.rs` | complete private declared-source contract: full `TacticPercept` (self/HUD/fighters/mobs/containers/projectiles/minimap/16 event kinds/extras/features), `TacticSelf` (with `Presence` for optional `windupMult`), `Foe`, `Intent`/`IntentBody`/`IntentTiming`, `MemoryApi`/`KnowledgeApi`/`PathApi` (`PathArg`/`PathRoute` keeping caller object identity), `RngStream`, `TacticsContext`, `TacticsConfig`/`TacticsMap`, `TacticsStats`/`TacticsOutput`, priority, `2e-6` whitelisted geometry helpers (`dist` = V8 `Math.hypot` port). |
| `tactics/fight.rs` | complete source-shaped private Fight: guards, current/mob/Memory lookup (dead/lost/remembered/returning), camp-mate lock rules, player/mob swap policy and jitter draw order, windup guard, lock/arms/targetability, reach mask vs LOS (`collisionMap` before melee `hasLineOfSight`, short-circuited for sight weapons), bounty rule, sudden-death hysteresis + Retreat, 10 s progress watch, melee-chaser OrbWalk, plan cache/replan/3 failures/waypoint/click, approach/attack/leave semantics. |
| `tactics/world.rs` | complete source World: slot table with 3000 ms stale pruning, loot terminal order (picked/refused/emptied/skipped/gone/budget/enemy/mob safety), toast normalization/event dedupe, settle/stop/pickup retry/final latch, seen-container vs remembered-pos walk identity, LOS/path/walk/waypoint fallback and the typed empty-route boundary, roam, all holds (coliseum crowd/persona/seeded 24-step `pickHoldSpot` with collision-map call order, arrival/settled/stop resend), idle. |
| `tactics/kite.rs` | complete source moving-while-fighting: `ownTimings` wrapper (admitted leaf), `awayPoint`, `OrbWalk` (initial Infinity, launch/new-shot, away applied/drop/timeouts, timed re-lock, retained cycles), private `Reflexes` (source dodge/juke, 48-entry decision cache, hold, wand-windup bow shots, real Memory stimuli/feints, counters) and `Retreat` (1200 ms/48 u retention, multi-threat minimum distance, reset semantics). |
| `tactics/source_reader.rs` | strict lossless `rh-method-value/1` tagged reader (Undefined/Null/`-0`/non-finite sentinels, ordered Map/Set/Uint8Array, duplicate-key rejection). |
| `tactics/source_strict.rs` | complete strict envelope/finite/consumed-field validator mirroring the source author's `verify.mjs` (profile, five maps, config/tierValues/personaValues/overrides/path, initial, 70-draw setup, all 11 method declarations + full Percept + consumed facts, output channels, `loot-path-empty` thrown row) plus the 17 reader negatives. |
| `tactics/source_decode.rs` | typed decode of the frozen corpus (maps/config/percepts/goals/foes/noteSent) into the private contracts, constructing the admitted-Memory `MemoryPercept` projection; expected outputs are never decoded into native state. Test-only plain-JSON percept bridge for the immutable compatibility corpora. |
| `tactics/source_trace.rs` | ordered callback/RNG transcript, real-service recording wrappers (Memory whereabouts, Knowledge weaponEdge, RoomPathService with the declared argument-sensitive denial/empty test-service boundary), exact source-shape encoders, Memory snapshot encoder and the comparator. |
| `tactics/source_tests.rs` | the 154-case / 720-method chronological replay driver: real admitted Memory (`observe`/`noteSent`/`recordChoice`), real Knowledge constructor (70 declared draws), real RoomPathService with per-observe budget/frame, one per-case decide stream, per-op typed intake before mutation, complete channel comparison, recreate run. |
| `tactics/private_tactics_tests.rs` | declared native controls (typed-intake non-advance, changed expected channels, changed declared input, partial-replay resume, object-order controls). |
| `tactics/compat_tests.rs` | immutable compat-corpora overlap replay (see below). |

### Reuse vs new ports (admitted components kept untouched)

- **Reused real admitted implementations**: `temporal_percept::memory::Memory` (all folds/`observe`/`noteSent`/`recordChoice`/`view`/`whereabouts`), `bots::knowledge::Knowledge` (`create_with`, the exact 70-draw constructor and `weaponEdge`), `bots::paths::RoomPathService`/`PathBudget`/`WalkAnswer`/`path_length` (real A* cache/budget/`los`/`clear`/`collisionMap`), `bots::random::Rng` (Mulberry32), `bots::kite::own_timings` (+`TURNS`/`LENGTHS`), `bots::mob_hunt::{retreat_point, weapon_edge, useless, best_edge, best_slot_vs_mob, mob_weapon, is_ranged}`, `rh_sim` content/map/geometry/`source_hypot`/`js_round`/`number_string`, and the strategy `Goal`/`GoalStatus` union (visibility hunk only).
- **Newly ported private classes (required, not substitutes)**: Fight/WorldTactics/OrbWalk/Reflexes/Retreat are source-shaped re-ports because the admitted old components' contracts are narrower than the declared witness: `bots::reflex::Reflexes::check` takes `TierId` and calls `TierParams::by_id`, so it cannot carry the per-case resolved `dodgeP/jukeP/feintRead/step/reaction/orbwalk` values (146 cases override them); `bots::orbwalk` takes concrete `&RoomPathService` and `Owner/PlayerRef`; `bots::fight` needs `PlayerRef` + its own `memory_prefix` and covers only visible/remembered-player normal fights; `bots::fight::retreat::Retreat` is `pub(super)` in a private module. No PlayerRef aliases or ID truncation bridge arbitrary source strings; no public API/implementation was changed. The private Reflexes reuses the approved pure leaves' formulas and V8-exact `source_hypot`, and is driven by real Memory-derived stimuli/feints (see compat E).
- **Rejected substitutes**: no player-only fight, simplified flee, missing loot executor, empty cues, hardcoded outputs, or expected Memory/state as runtime input anywhere.

## Replay semantics and comparison

- Every case recreates real state from the declared config/map and seeds; operations run chronologically. `observe` decodes the full declared Percept, starts a fresh real path-budget tick, records `paths.setFrame`, and folds the real admitted Memory; `noteSent`/`recordChoice` call the real Memory methods; context methods receive the last observed Percept, the real Memory view, real Knowledge, the real path service and the per-case decide stream. All typed inputs are decoded before any mutation; expected rows never feed native state.
- Compared channels per operation: result, full Memory snapshot, both stats aliases, complete callback transcript (names, arguments, results, order), cumulative RNG events/counts, path-service counters; plus constructor setup draws and initial Memory/stats. Recreate with the same seeds/inputs is checked by replaying the whole corpus twice and comparing the native transcript bit for bit.
- **Object order**: carried tagged source values compare with property insertion order preserved at every specialized boundary: act/check result roots, Intent objects (the tolerated `move.to` derived point must still be an ordered `x,y` object), each callback/RNG event object and callback argument/result object, `paths.walk` result objects, root Memory sections, and the plain derived-point helper. The only main-corpus exclusion is the plain fixed-schema `drawCounts` envelope (serde envelope map does not preserve JSON object order; compares as a consumed key set, arrays/values exact). The separate immutable compatibility corpora are canonical sorted-key plain JSON, so their property order is a documented serialization-artifact exclusion (key sets, array/Map order, values and identities still exact). Permutation controls require RED for seven specialized tagged boundaries plus Memory/callback arguments, and prove the plain-envelope reorder still passes while extra envelope keys fail.
- **Numeric contract**: exact binary64 bits, identities, ordering, timers/counters/flags, callback order and discrete outcomes; no f32, rounding, blanket epsilon or utility/status tolerance. The only allowance is the independently reviewed `2e-6` absolute geometry whitelist (`NUMERICS.md`): retreat/away/side-step/juke/pick-hold-spot point leaves, the corresponding `paths.clear` target point and the path service's continuous `walk.dist` estimate. Tolerance for `paths.walk` argument points is bound to actual computed `pickHoldSpot` ancestry only: the three captured direct declared Hold endpoints stay bit-exact under a `1e-9` tiny-delta control, while the genuine computed crowded-slot target keeps the approved allowance. The observed maximum continuous difference in the reflex overlap was `0.0`; no tolerance was needed to turn the main corpus green.
- **Empty World route boundary**: `loot-path-empty`'s unchanged source `TypeError` at the missing last waypoint of the explicitly declared empty (not null) test-service route is mapped to the private typed `TacticsError::EmptyWorldRoute`, raised at the actual missing-waypoint boundary after the real pre-error Memory/path/callback effects and before Reflex arbitration. The harness compares the source thrown name/message, the Undefined result and the preserved prior effects. The real service still normalises a normal empty route to null; `fight-empty-path` remains an ordinary successful no-path trajectory.

## Source replay result (frozen, unmodified corpus)

```
PARITY_TOTAL private-tactics source parity: 154 cases / 720 operations / 0 failures
PARITY_TOTAL private-tactics source recreate: 154 cases / 720 operations / 0 failures
```

All suites (tactics 118/462, reflex 21/163, orb 8/66, retreat 2/18, fight 3/6, world 2/5), all 16 method names, all nine
goal kinds and all four status states are executed by the real classes. Full receipts: [tactics-tests-final.log](tactics-tests-final.log);
per-case/method coverage reference: [source-coverage-reference.md](source-coverage-reference.md).

## Native controls

- `private_tactics_source_reader_controls`: **17/17** strict raw negatives rejected (7 tagged-value decode rejects,
  SameValueZero duplicate Map key (`-0`/`0`), wrong format, extra top-level key, 5 declaration mutations, missing
  `tierValues.orbwalk.p`, duplicate case id), matching the source author's `verify.mjs` reader controls; count printed.
- `private_tactics_source_envelope_guard`: the real corpus validates; prints **154 cases / 720 operations / 70 knowledge
  draws per case / suites / maps**.
- `private_tactics_source_typed_intake_non_advance`: **8** malformed operation declarations are injected on a **reached** runner (two real chronological operations already applied) through the same checked decode/apply entry normal replay uses; each names the consumed field in the typed error, the full pre/post snapshot is identical — complete delivered Memory, retained counters, full ordered callback/RNG transcript, decide ordinal and independently replayed next value, direct Knowledge fingerprint, path counters **and budget**, declared environment, reached Percept — and the complete unchanged remaining history then reproduces the exact uninterrupted transcript. Plus one case-level config intake rejection before any runner state exists.
- `private_tactics_partial_replay_resumes_exactly`: the same reached-runner rejection/resume contract, proving the exact full continuation.
- `private_tactics_expected_channel_controls`: **8** changed expected channels (status/result, intent geometry,
  callback result, removed callback, RNG index, Memory field, stats counter, pathStats counter) are detected through the
  same replay entrypoint; no expected row is installed as input.
- `private_tactics_changed_input_changes_execution`: a changed declared input (percept weapons) changes the real native
  transcript, proving execution over the declared facts rather than an expected-output tape.
- `private_tactics_object_order_controls`: carried tagged object order is compared (two controls), and the documented
  plain-envelope exclusion is verified to be the only one (with key-set strictness retained).
- `private_tactics_decode_smoke` / `private_tactics_plain_percept_bridge`: 5 maps / 154 cases / 720 operations decode;
  the immutable compat corpora's plain percepts decode (67 bot-fight + 68 bot-reflex + 46 bot-sd rows).

## Compatibility overlap with the immutable admitted corpora (not new unified coverage)

Replayed through the **new private implementations with the real admitted dependencies** (real Memory observe,
Knowledge, RoomPathService, seeded streams); source expectations unchanged. Each corpus is byte- and source-SHA-pinned in
the test. 5 tests, 0 failures:

| Overlap | Reached | Result |
|---|---|---|
| Own-timings (`bot-fight.timings` / `unavailableTiming`) through private `kite::own_timings` | 90/90 + 6/6 | exact bits; faction-absent rows `None` |
| OrbWalk (`bot-fight.orbs`) through private `OrbWalk` | 6/6 cases, 20/20 rows | result/`wait`/null, cycles, per-row decide delta, cumulative draws and independent next value exact |
| Direct Fight (`bot-fight.directFight`) through private `Fight` | 1/1 frame | result and decide draw exact |
| Fight/Tactics (`bot-fight.cases`) sequentially through one real private `Tactics` per case | 16/16 cases, 47/47 rows | result/status/attacking, five stats counters, full path transcript (sequence/args/results; compressed `declaredMap` marker checked against the declared map plus native full map callback), pathStats, budget left, decide deltas/cumulative draws/next exact; `normalReflex` overlap boundary compared on 47/47 rows through a fresh real private `Reflexes` (0 documented gaps) |
| Reflexes (`bot-reflex`) through real admitted `Memory.observe` + private `Reflexes` | 49/49 cases, 68/68 rows, 67/67 checks | Memory stimuli/feints re-derived 68/68 (never installed), result incl. geometry (2e-6 leaf; observed max abs `0.0`), hold/counters, decide deltas/draws, clear-call transcript and independent next exact; 1 observe-only row mimicked exactly |

Earlier hash verification alone was explicitly not accepted as overlap evidence; these run the new closures. The older
corpora's own regression tests remain unchanged and green (see focused receipts). Totals are not presented as independent
extra coverage of the 154-case witness.

## Gates, commands and environment

Pinned toolchain `rustc 1.97.0 (2d8144b78 2026-07-07)` / `cargo 1.97.0 (c980f4866 2026-06-30)`; `--locked --offline`;
`-j 1`; `CARGO_INCREMENTAL=0`; `RUSTFLAGS="-C debuginfo=0"`; worktree-local target dir
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-tactics/target`; cwd = the worktree above.

| Gate | Command | Result | Receipt |
|---|---|---|---|
| Format | `cargo fmt -p rh-policy -- --check` | exit 0 | [fmt-check.log](fmt-check.log) |
| Clippy default | `cargo clippy -p rh-policy --lib --tests --locked --offline -j 1 -- -D warnings` | exit 0 | [clippy-default-final.log](clippy-default-final.log) |
| Clippy all-features | `cargo clippy -p rh-policy --lib --tests --all-features --locked --offline -j 1 -- -D warnings` | exit 0 | [clippy-all-final.log](clippy-all-final.log) |
| Private tactics tests (post-repair) | `cargo test -p rh-policy --lib --offline --locked -j 1 private_tactics -- --nocapture` | **18 passed / 0 failed** (5 compat + 13 private/source; 6.00 s) | [repair-private-tactics.log](repair-private-tactics.log) (pre-repair log retained: [tactics-run-nocapture.log](tactics-run-nocapture.log)) |
| Compatibility overlap | `cargo test -p rh-policy --lib --offline --locked -j 1 private_tactics_compat -- --nocapture` | 5 passed / 0 failed | [tactics-tests-final.log](tactics-tests-final.log) |
| Source strict/reader | `cargo test -p rh-policy --lib --offline --locked -j 1 private_tactics_source` | 5 passed / 0 failed | [tactics-tests-final.log](tactics-tests-final.log) |
| Focused unchanged components | exact filters in the receipt | all green (see file) | [focused-regressions.log](focused-regressions.log) |
| Full library regression (post-repair current tree) | `cargo test -p rh-policy --lib --offline --locked -j 1` | **238 passed / 0 failed** (234.41 s) | [repair-full-regression.log](repair-full-regression.log); pre-repair production-identical receipt retained: 236 passed in [full-regression-final.log](full-regression-final.log) |

The retained first in-order failures (harness intake bug, module-goal dispatch panic, then the 12-channel first source
mismatch with its two real findings) are kept in [first-failures.md](first-failures.md); no earlier failure was weakened,
and the final run above is the only post-fix gate run per command.

## Evidence index

`README.md` (this file), `source-inventory.txt` (native file bytes/SHA/lines + the two allowed hunks), `corpus-identities.txt`
(frozen fixture hashes recomputed equal to the admission table), `source-coverage-reference.md` (declared case/method
index), `first-failures.md`, `fmt-check.log`, `clippy-default-final.log`, `clippy-all-final.log`,
`tactics-tests-final.log`, `tactics-run-nocapture.log` (printed parity/overlap/control counts),
`focused-regressions.log`, `full-regression-final.log`, `regression-name-index.txt` (same run's relevant test names),
`final-gate-exit-codes.txt`, `code-identity.txt`, `receipt-identities.txt` (fresh SHA-256 of the frozen corpora and every
evidence artifact), `REPAIRS.md` (HOLD repairs, per-group controls and receipts),
`repair-*.log` (post-repair gates), `focused-regressions-NOTE.md` (honest coverage accounting).

## Known finite limits and open gaps (honest)

- This is a finite declared-method witness, not a public/Brain/live claim. Whole-Brain composition, module registry and
  module `act` execution, planning/Wish/hazard goal states, engagement/missed-click feedback, sequence stamping and the
  four derived Brain RNG streams remain later packets (a direct `module` goal correctly returns the source failed output;
  `createBrain` is not executed here).
- The frozen corpus has **zero instances** of 13 of the 16 observed event kinds, minimap mobs, arrow projectiles,
  non-empty `extras`, gated collision maps on a path-querying trajectory (the single `gatesLocked` case makes no path
  calls), `services.log`, knowledge `factionEdge`/`mobShare`/`odds`, and `Fight.leave` (never called). The strict reader
  and decoders cover those declared shapes, but they are not reached behaviors; the source ledger's unisolated paths
  remain the authority on the finite suite's limits and do not authorize omitted branches.
- Geometry leaves are the only non-bit-exact allowance (`2e-6` on the reviewed whitelist); boundary outcomes, status
  strings, orders, timers, identities and callback sequences remain exact. Gaussian/transcendental blanket tolerance is
  not used. The compatibility corpora's plain-JSON property order is the single documented serialization-artifact
  exclusion (their key sets/array order/values stay exact); the frozen tagged witness compares full tagged order.
- `bots::reflex`/`bots::orbwalk`/`bots::fight` public components are preserved unchanged (their own admitted corpora
  remain green); the private re-ports are required by their narrower contracts, as documented above.
- No World/Sim, observation, protocol, Unity, networking, dependency/lock, source/tools/fixture or shared-status change.
  The candidate is intentionally uncommitted for Root review/integration; no secret World/checkpoint/replay data appears
  here (corpus hashes are the already-admitted frozen fixture identities).
