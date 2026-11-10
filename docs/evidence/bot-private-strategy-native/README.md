# P-BOT-STRATEGY-1 — private strategy readiness, contracts and Phase B native implementation

Status: **Phase B private native closure implemented and locally gated; Phase A source capture/strict reader/parity remains
waiting for Root's frozen handoff.** This document is the readiness/design record requested before implementation and the
evidence index for the current native code. No source parity, actual-source admission, public Brain wiring or live
activation is claimed.

## Assignment and prepared workspace

- Packet: P-BOT-STRATEGY-1 (updated parallelism packet at coordinator commit `3e3a5fc3799c2c25f943b27310540cf15508d1b7`).
- Native branch/worktree: `codex/deepseek-private-strategy`,
  `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-strategy`.
- Prepared base: `d21552d34966cd4a3ffd10d931b3543c269cf5d2`; worktree was clean at start.
- Source inspected is the unchanged TypeScript closure at the hashes below. This is the same source identity recorded by
  `docs/evidence/bot-private-strategy-source-review/README.md` in the coordinator worktree.
- Phase A source paths (`tools/bot-private-strategy-fixtures/**`, `parity/policy/bot-private-strategy/**`,
  `docs/evidence/bot-private-strategy-source/**`) do not yet exist in this worktree. They were not created, modified or
  anticipated here.

## Source closure inventory (bytes and SHA-256; line counts from the worktree)

| Source | Lines | SHA-256 | Role |
|---|---:|---|---|
| `packages/server/src/bots/brain/strategy.ts` | 901 | `edf3ec7f0e2b68de24e52def86e046209cd53c98c598057d38baf810f1ec2116` | complete strategy decision layer |
| `packages/server/src/bots/brain/huntAdapter.ts` | 189 | `0dac45d23811dbb72a8e8e5aa888e563a616f1fba255cde516176278e70c027d` | Memory/Percept -> MobHunter adapter |
| `packages/server/src/bots/mobHunt.ts` | 592 | `88fc22040e62b1bc5226c37c16095032533df1e104dee0b27fdcb671c33fe6ff` | MobTracker, MobHunter, tunables, pure weapon/retreat leaves |
| `packages/server/src/bots/brain/buildRoute.ts` | 242 | `fbe819cc2b36da50c7b01b0e4c40cf77c5c27286e6b5c69d76bc24e862af4f5e` | BuildRoute, build table, route value/readiness |
| `packages/server/src/bots/brain/memory.ts` | 920 | `29c2086be936ec867ddec97c2e4442b86acdbf1255e55de001e73892f7b128a8` | admitted private Memory input/API |
| `packages/server/src/bots/brain/random.ts` | 79 | `a23fb8d369ffced9e30719706b12eb5ec65afb14da16429a7cdc9dbc7e3f92f7` | softmax/lapse and Gaussian/source distributions |
| `packages/server/src/bots/brain/knowledge.ts` | 88 | `5709954e5f8d65411ff5606b4b337b5cfc19af163833cd1f147279affd9ce263` | knowledge/odds callbacks |
| `packages/server/src/bots/brain/services.ts` | 142 | `be3f915c4788b8e8406b6739d364fb3957935903555c26168c5892f93f7567fb` | path service/callback contract |
| `packages/server/src/bots/brain/types.ts` | 1264 | `12b3cae05bcde760cd642b9c5eb9919bfc47189882c81258994c9f1122d3d361` | Goal/Decision/Status/Percept/MemoryView/module/learned contracts |
| `packages/server/src/bots/brain/brain.ts` | 351 | `e5068026aba10f5bfe85d806b33cb76c4fc7e4408a958d87703dc1f3a391f800` | source caller order, cadence, module guard and goal identity helper |

The static source imports under `packages/shared/src` (mob catalog, weapons, factions, map/camp constants, feed/reward
rules and TILE/PLAYER_SPEED/TARGET_RANGE) are bound by the existing `rh_sim` public content/catalog constants and the
private strategy constants. No source file, capture fixture, expected output or tolerance was changed.

## Required source contracts recorded for the frozen reader

### Goal union and decision/status

The private source union is exactly: `idle`, `farm{mob,camp}`, `hunt{target}`, `fight{target}`, `loot{container}`,
`flee{from,until}`, `roam{to,why:explore|camp|lastSeen|coliseum|centre}`,
`hold{at,why:coliseum|ambush|wait}` and `module{module,data}`. Goal keys follow the source switch (including the
JSON.stringify module key and three-tile roam quantization). Decision carries goal, utility, why and optional choice key;
status is running/done/failed/blocked. The public compatibility `brain::Goal` is not used or changed.

### Strategy decide order (the exact closure to freeze)

1. dead/non-alive self returns Idle immediately and clears candidates without sync/route/hunter/RNG/module work;
2. lazy HuntAdapter creation; sync(current) key timer; settle(status) exclusion/loot-skip/flee-ban timers;
3. planRoute from public camp views; advisory build type-weight and elite readiness into the hunt;
4. HuntAdapter.decide once; enemiesOf (on-screen + remembered via real Memory whereabout query); refreshAvoid; trackChase;
5. candidates in source order: flee, fight, coliseum or farm+hunts+evade+lastSeen+camps+patienceDash+patrol+lieLow+centre,
   then loot, then enabled module goals in module order with utility clamped only at zero;
6. dedupe/filter/exclusion; wait fallback if empty; record every ordered candidate; current-fight tunnel or softmax/lapse;
7. hysteresis restoration including the strict 0.1 threshold; release the hunt when the chosen goal is not farm;
8. chosen-goal identity via source goal key/JSON; keep current object when identical; omit choice when kept.

Stateful closure retained across calls: adapter/hunter/tracker, avoid id/until/since, chase record and jittered limit,
current key and goalSince, flee ban, exclusions, loot skip, judged appraisal cache, last candidates, BuildRoute and route
next step. The source draw streams are separate decide/lapse streams; no draw occurs on dead input or a one-option pick;
the appraisal draw is a two-uniform Gaussian whose spare is discarded and is cached per foe until `until <= now`.

### HuntAdapter/MobTracker/MobHunter contracts

HuntAdapter converts only declared facts: on-screen fighters plus remembered fighters younger than 5000 ms via the real
Memory.whereabouts query; nearest threat straight-line or x2 when unseen; alive mobs excluding returning; type/name/faction
derived max HP; first-seen home seeding; path callback distance or Easy 1.3 straight-line; source catch-up of gaps over
240 ms in at most 14 pieces over the same snapshot; release is a real hunter.decide with playerDistance 0. Tunables are
the existing source-derived `hunt_config_for`. MobTracker records home/last hp/rising/death/removal and awake/returning;
MobHunter retains engagement, damage/progress stall/approach, bans, player-lock, retreat min/max and repick timers, target,
stats and ordered candidate scoring. The native classes expose the same observable state for later transcripts.

### BuildRoute contracts

Initial faction build from seeded unitHash (<0.5 build A, else B); greedy value/second route up to four camps with
deterministic lower-index ties; camp value from mob count/value and elite value; spawn/clear timers; contest detection
from remote alive loss, player proximity and stolen heading; zone hit counts/expiry; replan on stale/broken/contested
route; canFarm callback for weapons/matchup. The static build table/value/readiness leaves reuse the existing pure Rust
helper instead of duplicating them.

### Memory API surface used (no expected rows as inputs)

Strategy reads real MemoryView fighters/mobs/camps/containers/self memory/bounties/choices, and calls the real
Memory.whereabouts(id, now) for remembered players. Native `MemoryApi` is implemented for the admitted `Memory`; the
test-only fake exists only below private declared controls. HuntAdapter additionally reads self.lastHitByPlayerAt,
mob home/returning/hp and camp/container facts. No World/Sim, hidden entity lookup, authoritative resolver, secret RNG or
wall clock is read. The only Memory source change in this packet is the explicitly permitted visibility line
`mod source_input;` -> `pub(super) mod source_input;` so the strategy tests can construct real admitted Memory percepts;
Memory folds, comparators, expected results, current source tests and semantics are unchanged.

### Callback and numeric contract

- Path callback: `walk(from,to) -> {dist, exact} | null`, source cache/budget behavior supplied by the existing
  RoomPathService; `los` and `clear` complete the source PathService surface.
- Knowledge callback: existing source-derived Knowledge faction/weapon/mobShare/odds methods, including tint/false
  knowledge behavior; no hidden state.
- Learned bias: enabled plus a bounded argument-sensitive `bias(key)`; unknown/disabled/NaN behavior is source-bounded.
- Feature modules: enabled(features) then goals(ctx) in registration order, no calls for disabled modules, utility
  minimum zero, duplicate keys preserve first insertion position and replace only on greater utility.
- Source random/numeric: separate decide/lapse streams, exact softmax/lapse draw counts, two-uniform Gaussian, UTF-16
  unitHash for non-ASCII IDs, binary64 operation order, Infinity sentinels and signed zero; no f32/wire quantization and
  no invented tolerance.

## Native implementation inventory (Phase B)

All code is under `crates/rh-policy/src/bots/temporal_percept/strategy/`; only the module declaration and the permitted
Memory visibility line touch existing files. No public bot/brain/Goal/wire/sim/server/headless/dependency path changed.

| Native file | Lines | SHA-256 | Contents |
|---|---:|---|---|
| `strategy.rs` | 11 | `e7066d4c1dd12ad8355e577fcb61ab6a9fa234327b151a852ef747bcf3d35597` | private module root/tests |
| `strategy/types.rs` | 687 | `db109336b42c98ec26539c3908b5dc4d3a81c2e8834167c70e571732d64f6c49` | source Goal/decision/status/context/Percept/MemoryApi/PathApi/module/learned contracts |
| `strategy/engine.rs` | 1774 | `0ea840e3dd631a4b322f90433dfd10666fff8812e84dda69ce4534bea363ca54` | complete Strategy decide, candidates, state, helpers |
| `strategy/mob_hunt.rs` | 568 | `a165f213eca2089ea35fd43a65c8d6a03a7dccde1ed92304d582440dab82ded3` | MobTracker, MobHunter, source hunt contracts/tunables |
| `strategy/hunt_adapter.rs` | 314 | `158e080c6f1a1bb80c86e100292bfa399bb92071d9da2df31276c7988cec35d4` | source adapter, home seeding, catch-up, release |
| `strategy/build_route.rs` | 262 | `deaabcc77d45d472632330321d48ed113c06289ec1f4398de5131310e2a8e263` | stateful BuildRoute route/contests/zones/replan |
| `strategy/private_strategy_tests.rs` | 841 | `08a3b796bf5aeb302772f33e8fa6b55c25ffbf4d62400ff73f221b64bbc932cb` | declared native controls and real-Memory API control |

The implementation deliberately uses private source-shaped records instead of the incomplete public
`types::Percept/SelfView/FighterView` surface; the existing pure `build_route`, `mob_hunt`, `random`, `knowledge`,
`paths` and admitted Memory are reused. No placeholder/stub/fake producer is used in production paths; fakes exist only
in the declared test module.

## Native validation receipts (packet target, jobs 1, locked/offline)

Target: `/Users/nevinmckinnon/.codex/tools/rougehalla-backend-20261109/target-strategy`; pinned Rust 1.97.0,
`CARGO_INCREMENTAL=0`, debug info 0, `CARGO_BUILD_JOBS=1`, `--locked --offline`.

| Command | Result |
|---|---|
| `cargo test -p rh-policy --lib private_strategy --locked --offline -- --nocapture` | 10 passed, 0 failed, exit 0 |
| `cargo test -p rh-policy --lib memory --locked --offline -- --nocapture` | 28 passed, 0 failed, exit 0 (includes the new actual-Memory strategy control; the 27 prior Memory tests remain) |
| `cargo test -p rh-policy --lib memory_prefix --locked --offline -- --nocapture` | 6 passed, 0 failed, exit 0 |
| `cargo test -p rh-policy --lib protection_cues --locked --offline -- --nocapture` | 4 passed, 0 failed, exit 0 |
| `cargo fmt -p rh-policy -- --check` | exit 0 |
| `cargo clippy -p rh-policy --lib --tests --locked --offline -- -D warnings` | exit 0 |
| `cargo clippy -p rh-policy --lib --tests --all-features --locked --offline -- -D warnings` | exit 0 |

Raw command headers and output are the .log files in this directory. The 2,112 protection and 773 NPC payloads,
expected results, comparison semantics and tolerances were not modified; the existing memory-prefix/temporal controls pass.
Declared controls cover goal union/key formatting, build-route tie/contest/replan, tracker home/rising/awake and hunter
target retention, dead-self early return, enabled/disabled module order and utility behavior, flee priority, real
loot/farm candidate production, adapter catch-up/release, and a real admitted-Memory observe/whereabouts/strategy decision.
These are **declared native controls**, not actual-source parity receipts.

## Honest limits, missing contracts and Phase A handoff requirements

1. **No frozen source witness exists yet.** The strict `rh-bot-private-strategy-source/1` reader, corpus replay,
   callback transcript, full candidate/state comparison, RNG draw-count comparison and source/native admission are not
   implemented because no immutable independently reproduced source manifest, schema bytes, corpus or expected rows are
   available in this worktree. They must wait for Root/Sol's Phase A freeze. No expected answer or source row is fabricated
   here; the .log receipts above prove only native compilation/declared controls, not source equality.
2. **Adapters still required after freeze:** a declared source Percept/config/map/service converter from the future fair
   view and a deterministic GameMap/camp/coliseum view into the private `StrategyMap`; source module data and ordered
   callback/service descriptors need the frozen schema. The current private contracts are exact enough to consume those
   rows without changing the native classes.
3. **Production wiring is intentionally absent:** no fair BotVision/Observation adapter, cache/path integration in a
   live seat, tactic/reflex/humanizer dispatch, module registry, learned-persistence store or public/live Brain activation.
   Full bot strategy/tactics/loot/module/learning/tournament completion remains later work.
4. **Source-witness gaps:** actual-source noteSent/recordChoice/whereabouts, bounties/choices/lastOrder/lastCast, Wish
   castLand, chasing/third-party, plan/chest/dead/teleport, never-dotted absence and exact expiry boundaries are not yet
   replayed end-to-end; the strategy-specific witness also awaits source cases for module/learned/path/route/hunter
   branches. Current tests use declared fakes where source capture must supply the facts.
5. **Numeric/serialization caveats to verify against the frozen corpus:** module goal JSON key formatting uses a local
   source-compatible JSON.stringify for ordered MethodValue data; its number exponent formatting is deliberately simple
   and must be checked against source witness values (including -0/nonfinite tags). Mob max HP derives from the public
   faction/type catalog and source scale constants; it must be compared with the source adapter witness. These are review
   questions, not silently accepted tolerances.
6. **No mutation/fuzz campaign or full-suite run was performed.** The packet's semantic controls, source/native comparison,
   independent reproduction and Root-wide integration gate remain pending Phase A. Existing admitted Memory tests and
   focused source controls pass unchanged.

## UNITY_REWORK_STATE.md forensic note (read-only; nothing undone)

The prior GUI edit summary path `docs/prompts/UNITY_REWORK_STATE.md` was **not written by the Memory admission or this
strategy lane**. The primary checkout file is clean and its only recent changes are commits by another worker identity:
`a52b2d4238275c0e9a364f78e623b75bef46a564`, author `test <test@example.com>`, date
`2026-11-09T23:13:41-06:00`, subject `docs(rework): state: brightness, gothic Sentenced, launch screen`. Its exact hunk
appends six lines after line 73 (lighting culling, launch/opening screen queue, lower luminance, gothic Sentenced
flagship brief). The sealed admission commit `0ea1589a37cdcf957195fe4955a917e644c4b88e` changes only the five Memory
code paths and nine files under `docs/evidence/backend-bot-memory-admission/`; no primary/worktree prompt file is in its
diff. No worktree prompt file was edited or reverted by this lane.

## Next concrete dependency and handoff order

Root/Sol: publish the frozen `rh-bot-private-strategy-source/1` schema, source/tool/runtime/map identities, canonical
bytes and ordered case suites (memory-api, strategy, hunt-adapter, mob-tracker, mob-hunter, build-route). Then this lane
will add the strict reader, compile raw method/callback inputs into the admitted Memory and the native classes, compare
full outputs/state/callback/RNG transcripts, add the source mutation controls and report exact remaining branches. No
parity or admission is claimed until that independent review. Root owns integration and shared records.

## Frozen source handoff: native parity bring-up (current WIP)

The frozen Phase A source release was added by Root as commit \`36a3b2b9\` with the exact source/coverage/manifest pins
from the local README. The updated packet numeric decision (unrounded source values; only named Gaussian/transcendental
and geometry paths may use the inherited reviewed bounds) was applied. The additive module-goal-key supplement was added
by Root as \`d629e174\`; its README/manifest were read and are not folded into the primary 98-case reader yet.

### Strict reader and replay harness

New test-only code \`strategy/source_reader.rs\` and \`strategy/source_tests.rs\` validates tagged values (including
undefined/null/-0/NaN/±Infinity, ordered maps/sets/objects, duplicate keys/values, u8 and instance/callable tags) before
native mutation, then replays the six corpus suites against the admitted native Memory and real native classes. The
harness never feeds expected Memory/candidates/callbacks into native decisions; declaration.current=\`$previous\` uses the
preceding native goal, with the captured current compared only as a guard. Module env overrides are taken from the
operation declaration (the capture stores them there), and the source RNG-stream override behavior is implemented
through the private \`RngStream\` seam: an override replaces a draw without advancing the fallback Mulberry stream until
the overrides are exhausted. Memory is the real admitted \`Memory\`; its camp geometry is the actual generated seed7 camp
list/radius, not a reconstructed stub.

### Passing frozen suites on the current WIP

- \`mob-tracker\`: 14 operations, pass.
- \`mob-hunter\`: 127 operations, pass.
- \`build-route\`: 36 operations, pass.
- \`memory-api\`: 122 operations, all eight Memory surfaces pass.
- \`hunt-adapter\`: pass before the latest Catch-up trace was attempted; the current all-suite run records first mismatches
  in the adapter catch-up history (see source-adapter-first-mismatches.log).

### Remaining first mismatches retained (not admitted)

- \`strategy-path-coordinate-block\` / \`strategy-path-source\`: native camp candidate ordering differs. The source path
  service uses the full generated GameMap, including the real source \`findPath\`; the current test path harness only
  implements the declared open/null/coordinate-block rules and cannot reproduce source path topology for \`kind:source\`.
  This is an adapter/service conversion gap, not permission to change source cases.
- \`hunt-adapter\` catch-up history: first native mismatch retained in source-adapter-first-mismatches.log (focus counter /
  target drop timing). No source expected value was altered.
- Strategy suite: 292 operations; first retained mismatches are path-service related (above) plus any dependent state/
  identity after those path outcomes. The raw log is preserved.
- The additive module-goal-key supplement (\`docs/evidence/bot-module-goal-key-source\`,
  \`parity/policy/bot-module-goal-key/source.json\`) has not been separately consumed by a strict native test yet. The
  primary 98-case reader/parity does not wait for it; full general module-key parity remains a separate supplement task.
- No live/public Brain/Unity/network/sim/dependency/shared-status/source edits were made.

## FROZEN SOURCE PARITY - COMPLETE (primary 98/658 + supplement 4/48)

Root's two strategy path mismatches are diagnosed and repaired inside this lease. The cause was the test/service
adapter, not an outside shared path implementation: the source runner's path policy is a declared service. The native
harness now constructs the actual generated seed7 TileMap from the frozen map's tiles and uses the real rh_sim
Pathfinder::find_path + path_length for kind:source, and the coordinate-block policy now falls through to the declared
straight-distance factor for non-blocked points (blocked points still return null). No source path service was replaced
with a stub and no source/case/tool was edited.

### Exact frozen identities rechecked on disk

- primary source.json 12,263,237 bytes, SHA256 3a3ae0d498cc3933b5eee11c5be995f267f4a76530379ad7c73a934082125d8d
- primary coverage.json 1,981,587 bytes, SHA256 a560ee78a81e9f851933aafda5d42fe566a0e72d346d74f51d15a1a1890d6e12
- primary FROZEN_MANIFEST.json 2,862 bytes, SHA256 8ca988c39466a8536a5e8aba6190619b1fbe7f4c862b0f2822f5093164445e24
- supplement source.json 1,004,072 bytes, SHA256 32836e03d47993fceec22fc7fb648e937d01b3e9b221da9499ea9e99d31efc0c
- supplement FROZEN_MANIFEST.json 1,585 bytes, SHA256 fc8f67be6e2153bd1d90ff1cd0b02467698ca35385bf29dd1c1b7bc4c6377d97

### Actual captured totals replayed

Primary six suites, all passing:
- memory-api 122 operations (12 cases)
- strategy 292 operations (35 cases)
- mob-tracker 14 operations (1 case)
- mob-hunter 127 operations (24 cases)
- hunt-adapter 67 operations (9 cases)
- build-route 36 operations (17 cases)
- Total: 98 cases / 658 operations, zero first-mismatch failures.

Supplement (rh-bot-module-goal-key-source/1), all passing:
- 4 cases / 48 operations, using the primary generated7 map binding and the actual native Strategy/Module/JSON-key path.
  Raw signed zero, NaN, +Infinity, -Infinity, null, omitted Undefined object keys, array-Undefined-to-null, object
  insertion order and ECMAScript exponent boundaries are retained. No supplement expected value is native input.

### Comparison policy (explicit, for independent review)

source_reader::same compares schema record objects by key (record field order is not a source value), while ordered
Maps/Sets/arrays and all tagged numeric bits remain exact. Raw Module.data objects are compared by same_raw, which
preserves object entry order, and primary/supplement strategy decisions + state.candidates use the goal-aware
same_goal / same_decision path so module data order is never normalized away. The supplement additionally compares the
native Goal through its source JSON key/full-goal retention and catches the -0/NaN/Infinity/null collisions. No blanket
epsilon is applied: all recorded primary and supplement values currently compare exactly; the reviewed Gaussian/geometry
tolerance whitelist was not needed or activated for these cases.

### Final gates (packet target, jobs 1, locked/offline)

- six primary suites + supplement filter: 7 tests passed, 0 failed, exit 0 (98/658 primary, 4/48 supplement)
- existing admitted Memory regression filter: 29 passed, 0 failed, exit 0 (run once for this final gate)
- cargo fmt -p rh-policy -- --check: exit 0
- strict default Clippy: exit 0
- strict --all-features Clippy: exit 0

Raw logs: source-six-final.log, memory-final-regression.log, clippy-default-final.log, clippy-all-final.log,
fmt-final.log; earlier first-mismatch receipts (source-*-first-mismatches.log, source-parity-final-wip.log,
path-trace-first-mismatch.log) remain preserved. The earlier WIP checkpoint 23561203 is retained as history; this section
supersedes only its parity status, not its old receipts.

### Remaining admitted limits

Still private finite method parity only: no live/public BotVision/Brain/tactics/reflex/module/learning integration or
headless/live outcome claim; the supplement covers the enumerated four histories, not arbitrary JSON.stringify
(toJSON/prototypes/cycles/BigInt/exotic nested-number fuzz); initial static/module-initializer V8 coverage and every
unwitnessed source branch remain uncovered; HuntAdapter closure storage is bound by continuation effects, not direct
reflection; no source/corpus/tool/Unity/network/sim/dependency/shared-status edit and no merge/push.

## ROOT/SOL HOLD acknowledgment and current repair WIP (supersedes the earlier "COMPLETE" heading)

The sealed independent review is HOLD at receipt 71fa0d35b9dc82404d2f3f6c88cec7ad3d218445 / native code
8baad8f583512213679d38372c3cc8911c793401, handoff docs/evidence/bot-private-strategy-admission-review/README.md
(seal reviewed 17d3e41c). Its seven findings are accepted. The earlier "FROZEN SOURCE PARITY - COMPLETE" heading above is
retained as history but is not an admission claim; callback/RNG/private-own channels were not enforced.

Work completed in this current WIP:
- Per-case callback/config state replaced the process-global SOURCE_ATTACKING; primary and supplement Strategy/HuntAdapter
  options now own their attacking/log callbacks (no atomic/global mutable case data).
- Added an exact corpus-envelope guard test: primary 98 cases and 658 operations with per-suite counts
  (memory122/strategy292/tracker14/hunter127/adapter67/route36) and supplement 4 cases/48 operations.
- Added native setup-transcript Knowledge draw and per-operation cumulative drawCount/ordered RNG helper checks (helpers are
  present; callback/service-channel wiring and full op-level enforcement remain in progress).
- Primary strategy result/candidate comparison now uses the goal-aware ordered raw-Module.data comparator, not only the
  generic keyed schema comparator.
- Existing 10 declared private_strategy_tests pass; current source_tests filter passes 8 tests including the new envelope
  guard and primary/supplement parity; fmt/clippy restored green after the WIP edits.

Still open before a new candidate seal (no claim of completion):
1. Capture and compare the unified ordered callback/RNG transcript for setup and every operation: all callback names,
   complete arguments/results, Memory.whereabouts, knowledge/learned/module/path/log/attacking/hunter.typeWeight and
   constructor draws; negative remove/reorder/count tests.
2. Serialize and compare every captured case.initial and op.own retained field (Strategy excluded/lootSkip/judged/
   currentKey/avoidSince/fleeBanUntil/adapter/hunter/route nested state, hunter bans/eng/timers, tracker records, route
   contests/zone caches), with retained-state corruption negatives.
3. Route actual case/op/config decoding through the complete strict tagged+typed reader (not the permissive sv helper);
   preflight complete operation input before any Memory/state/RNG mutation; add actual-entrypoint malformed-intake negatives
   proving exact state/RNG/callback non-advance.
4. Finish callback negative controls and final current-revision gate receipts; reuse unchanged Memory production-code
   evidence only where the binding justifies it.

Preserved green partial evidence from this WIP: declared-ten-hold-wip.log (10/0), source-eight-hold-wip.log
(8/0, primary 658 + supplement 48 totals), clippy-hold-wip.log, fmt-hold-wip.log. Earlier first-mismatch and sealed
logs remain untouched. This is a continuing private repair WIP, not admission.
