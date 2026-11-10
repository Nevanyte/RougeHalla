# P-BOT-MODULES-1: complete private source feature modules

## Outcome and authority

**Root native preparation dispatch (2026-11-10):** start isolated `codex/deepseek-private-modules` from admitted backend
`dedb8658` plus this dispatch record. DeepSeek may implement the new `temporal_percept/modules.rs`, `modules/**` and
`docs/evidence/bot-private-modules-native/**`, add only `mod modules;` in `temporal_percept.rs`, and expose only existing
`strategy.rs` `mod types;` as `pub(super) mod types;` (same independently allocated visibility as Tactics). Before any
other existing engine edit, submit exact proposed planning/Wish/hazard bridge signatures and function-level hunks for
Root review. Do not duplicate an entire compatible existing engine merely to avoid that review. Source `faba1278` and
all255 histories/3259 operations remain frozen and required. No Tactics WIP is imported or edited; composition follows
its separate admission. The worker may proceed on new-file source-derived work while the bridge proposal is reviewed.

**Root source admission (2026-11-10):** immutable `faba1278` is integrated as `d48b79bf`, with independent final reproduction/review admitted at `63f6fda8`. Final source/coverage bytes,24 strict reader negatives,26 semantic kills and comment/restoration/manifest checks pass. See [final review](../../evidence/bot-private-modules-source-review/final-review.md). Native bridges remain separately undispatched; raw nonfinite Plan inputs remain outside this finite source profile.

**Root source-only dispatch (2026-11-10):** Sol is assigned the three new source/tool/evidence directories below in clean `codex/bot-private-modules-source`, `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-modules-source`, at exact `bd40fa2a274184b8748b005af78e18e74802f7ae`. This explicitly starts source preparation under the packet's immutable-source and independent-review rules. Native implementation, existing-engine bridge hunks and public activation remain undispatched. Root integrates the separately sealed candidate after review.

Source preparation is authorized above. The native architecture and bridge leases remain proposals; Root allocates an
exact clean native base and hunks before Rust execution. Sol/Luna own source preparation and independent review;
DeepSeek authors all Rust/tests/probes. Source capture proceeds independently of evolving native answers. Fixture
reader/comparison/admission waits for an independently reproduced immutable source seal. Do not inspect native answers
to tune inputs or expectations.

Implement the complete four actual legacy built-ins—Wishes, planning, chests, hazards—and their full hook/context contract,
ordered registry, missing ChestHunter and card-choice dependencies. A chest walk-only implementation, reduced Wish cast,
empty loot/card metadata, fake Memory snapshot, omitted slip/adjust, or unknown facts defaulted to false/empty does not
satisfy the outcome. Reuse source-backed compatible engines/leaves already present; older backlog “Coarse”/“not ported”
comments do not authorize replacing them. Full createBrain composition and its guards belong to the exact subsequent
sequence in [BOT_BRAIN_COMPLETION.md](../../coordination/BOT_BRAIN_COMPLETION.md), not public HumanBot activation here.

Read AGENTS, current MIGRATION/REQUIREMENTS/CONTRACTS/backlog, ADR0005/0007, P-BOT-STRATEGY-1 and P-BOT-TACTICS-1, then
actual source. Preserve C-OBS/C-RNG/C-INPUT/C-DET/C-NUM/C-PARITY/C-POLICY. No training/models/datasets/Python/inference,
new learned store, public privileged view, network/client work, gameplay rule change or altered tick order.

## Actual source and admitted dependencies

Source closure starts at `packages/server/src/bots/brain/modules/{index,chests,planning,wishes,hazards}.ts`,
`bots/chestHunt.ts`, `bots/abilityPolicy.ts`, and the actual shared card/boost/kill-augment/planning/ability/terrain/blink
imports, plus brain/{types,memory,knowledge,services,random}. Read actual Brain hook semantics in brain.ts without copying
its whole composer into this scope. Source tests `botChests.test.ts`, `bots/{chestsModule,planningModule,wishes,hazards,
brain,humanizer,boundary}.test.ts` aid discovery; assertions are not translated into expected fixtures.

| Existing Rust/source witness | Reuse and exact limitation |
|---|---|
| Admitted complete private Memory | All module history uses its real observe/noteSent/recordChoice/view API. Memory.self.lastCast/fighter hit times/stillSince/awake are dependencies, not expected inputs. |
| Full private strategy Goal/types after admission | Reuse all9 goals/full ordered Module data/status/intent contracts; no reduced public brain::Goal adapter. Current native strategy HOLD repairs remain outside this lease; no active visibility/type edit now. |
| `bots/planning.rs`, `bot-planning.json` | Reuse PlanModule and shared plan/matchup maths. Bridge ordered source private events/event t, exact consumed config, source coercions and learned callback calls instead of treating a parsed current PlanningView as the complete source input. |
| `bots/wish.rs`, `bot-wish.json`, wish_module_tests | Pure tag policy/definitions and slip state/geometry exist. Reuse compatible code; close actual lastCast/hit-map/dist/LOS/targetability/optional-intent/gated-landing seams. The current landing helper passes false gates and ignores supplied max/min; static fair-view approximation is not the private method contract. |
| `bots/hazards.rs`, `bot-hazards.json` | Existing full FSM/adjust and terrain leaves are source-backed. Bridge full source facts and actual collisionMap/clear callback timing; do not mint PlayerId aliases or assemble fictitious earned Observations to fit its old API. |
| `bots/{paths,kite,random,knowledge}.rs` | Reuse real compatible map/gate/path-budget/cache, away geometry, random and knowledge leaves. An arbitrary string chest/source ID never becomes a PlayerRef. |
| Sim static card catalog/blocker/boost/kill-augment format leaves | Reuse only immutable public metadata/format helpers whose source behavior matches; never instantiate or read World, private offers or hidden chest choices. Bot scoring/ChestHunter are genuinely missing. Unknown raw card id remains source takeable score0. |
| `bots/humanizer.rs`, bot-core, brain-prefix | Downstream compatibility only; packet outputs intents, not stamped/sent commands. Humanizer's feature-message gate is a separately reviewed later Brain seam. Prefix scheduler/merge captured opaque strategy draws and is not whole-Brain evidence. |

Native modules need a new private typed input layer for complete source module facts. The public types.rs RewardChestView
lacks takenBy/picked/lifeMs; SelfView lacks full build; WishView uses a narrowed enum/static definition; old Percept lacks
many HUD/Memory/event facts. Preserve required absence/Undefined/Null and arbitrary source strings rather than silently
extending or fabricating the public observation contract. Build counts/visible options are declared owner/readable facts,
not permission to read current hidden chest contents.

## Complete behavior contract

**Hook/context and registry.** Implement optional presence of enabled,observe,goals,intents,act,adjust with full ordered
inputs/results, not a common hook that ignores distinctions. Registry defaults are wishes→planning→chests→hazards;
register replaces by equal string id without moving it; reset clears registry and optional cast-policy slot. Wishes calls
real decideCast directly, not the registered opaque cast policy. No actual skills/relic module is invented. Enabled
filtering is observable separately from a direct module method; a direct method does not necessarily recheck enabled.
Per-module state is keyed by cfg object identity in source: shared cfg continues state, equal-valued distinct cfg isolates
it, two interleaved bots do not collide by actor name/id. New Brain's guarded bcfg identity is a later ownership bridge.
No implicit phase/death/teleport reset beyond source methods; recreate explicitly clears lifetime state.

**Chest choice leaves.** Port costsSomething, activeWeapon, cardScore/optionScore alias and chooseOption completely:
AD/AP/shield/fists/DoT-faction base fit, tags/rules, conditional prerequisites and uniqueness, existing-base deepening,
base tier/augment risk, tradeoff0.5/danger strictly>0.7, lower-is-better costs and special mult/flag costs, FistsOfFury/
Quickdraw/Committed carried-slot rules, boost max picks and kill stat mapping, unknown id0, unusable-Infinity, first equal
score and taken/free option order, empty/all-refused skip. Retain exact strings/iterable order, nullable build and optional slot/risk.
No card catalog mutation or authoritative grant logic.

**ChestHunter.** Full done/walking/stalls/walk-cache/stats state; reward kind and picker ownership; source sort by straight
distance then source string comparison; expiry/teleport-adjusted usable life and own lifeMs birth age; pick range/sight/
margin, hold before reading options, later old chest ahead of held chest, skip still marks done; held chest prevents
walking elsewhere. Retreating still permits free in-range pick before walking guard. Only nearest maxCandidates request
walk; null is cached too; cache250 boundary and coordinate/callback correctness bind. Fighting walking cap, ETA with
pace/slack and near chest threshold, strict best tie/order, progress24 and walked-only capped500 increments, interrupted
walk persistence, stall>=3000 give-up/log/counters, disappeared stall pruning and markDone cleanup all matter. The input's
now and serverTime are separate declared clocks; do not replace them by tick arithmetic.

**Chest module.** Full WeakMap-equivalent hunter/build/counted/readable/asks/last-goal state. Own build merges visible
counts and delayed self-pick counts with max; count each taken chest once, including repeat observations and boosts.
Panel close clears readable/asks, not all lifetime state. Far options are BLIND["?"] and far takenBy is empty in huntInput;
goals must not inspect hidden cards. Direct extras absent versus empty, picked/expired, alive/active/coliseum gates,
source fighting from real engagement/previous goal/near players/awake Memory mobs, fleeing/HP suppression, Easy straight
walk1.3 versus real path tier and teleport deadline are exact. goals creates a fresh temporary ChestHunter so merely
asking goals never spends the retained act-hunter stall record; skipTried still reads retained hunter.tried.

Readable nearest chest selection favors old over birth-held, preserves source ties, and may yield no pick after the
ask window. The selected nearest readable chest can exhaust its ask window without a second-best fallback; preserve that
source ordering rather than scanning for another readable chest as a convenience. No asks while own casting/stunned, too young or unlive. Pick uses real choice policy; repeat same option
keeps ask n, changed option increments up to3, first/readable timestamps and4000ms window stay exact. Source may offer
same option repeatedly for the hand to dedupe; do not invent one-send semantics. intents records current goal kind;
act sets module goal, uses source String(data.chest) conversion, may emit pick then move, waits held chest, preserves
running “taking” while asks pending and source done reasons. A readable panel suppresses unnecessary walk order.

**Planning.** Observe scans ordered private plan events even outside planning phase, validates with source readDeal
coercions, schedules only first valid deal using event.t (not percept.now), then replaces deal. Source numeric deal fields are binary64, not intrinsically i32/i8; keep accepted numeric values/sign tests/
formatting until the source lookup/decision narrows them, rather than truncating into the old parsed PlanDeal. Preserve optional/malformed
pick/boon defaults, literal-true taken flags, string-only boon filtering and source event order. Complete read/settle/lastCall
window scaling, no-deal1000, last-call precedence, free spawn filtering, no-faction/one-free no-draw branches, real
planSpawnScore, bias-enabled/unknown/nonfinite-sanitized callback behavior, softmax/lapse and first ties, source boon first
two, three asks and resend400+reaction.mu, doneAt settle and readySent latch. No reset solely because phase changes.
No learned file/service; callback descriptor is an immutable declared snapshot, argument-sensitive and recorded.

**Wishes.** Full def guard and actual tag/rank/effect/blockedBy policy, source rank clamping, Easy defensive filtering and
one remember draw per usable availability edge; absent/invalid defs, ready/casting/retry1000 no-draw branches. Build
castSituation from real Memory.lastHitAt/fighter.hitMeAt and source current dist/velocity/LOS/targetability/goal target,
not the old capped auxiliary list or “visible implies LOS”. Preserve ordered CAST_STIMULI preference, actual map/gates
and source blink constraints, player-only engage versus mob distinction, unit target/at/snap only when source supplies
those fields, exact priority/why. Use actual Memory.lastCast (released noteSent) for sent slip grace, never first observed
casting as a replacement clock. Full armed/pending2500/cast+700/hidden bit behavior, from/leg partial retention, nearest
source player order/ties, keep1200/arrive60 and away300 geometry, cast-before-step, module utility1.4, unknown mode failed,
no-longer-hidden/empty/corner done, repeated slip order blocking normal lock. Preserve source partial resets, including
not clearing from/leg merely because armedAt expires.

**Hazards.** Reuse complete source risk classification and stable dy/dx tile search/preference order, body-fit/clean
neighbors, owned faction homes. Full intents guards, kept step before new map search, expiry strictly>1500/arrive<=20,
step throttle>=600, standing>=250, no lock, loot suppression, clear-path accept callbacks, light only on ambush/wait
below reengageHp/unengaged/not already light, and exact held intent. adjust has its own alive/faction guard and source
collisionMap call even if no move changes; it is not gated by the intents phase/coliseum guard. Redirect only moves at
least4*TILE from self and on bad ground, nearest clean/fallback within3 tiles, retain timing/priority and append why.
Return original input list when unchanged; copy only after first actual redirect. No authoritative movement/terrain rule
is implemented by this policy module.

## Proposed leases, requiring Root allocation

New source-only paths:

- `tools/bot-private-modules-fixtures/**`.
- `parity/policy/bot-private-modules/{source.json,coverage.json,controls.json,manifest.json}`.
- `docs/evidence/bot-private-modules-source/**`.

New DeepSeek paths:

- `crates/rh-policy/src/bots/temporal_percept/modules.rs` and `modules/**`, including complete typed reader, chest choice/
  hunter, source-shaped module adapters/state, ordered registry and new tests.
- `docs/evidence/bot-private-modules-native/**`.
- One Root-allocated `mod modules;` line in temporal_percept.rs, after clean base/readiness.

Independent review writes only newly allocated source-review/admission-review evidence directories. Root alone edits
shared status/Cargo.lock and integration. Only the source lease in the dispatch note is active; no native write is allocated.

**Readiness bridge proposals, not blanket existing-file leases:** inspect the admitted strategy/tactics type layout only
after admission and reuse the already allocated private visibility where sufficient. Root separately approves exact
hunks in planning.rs for event-time/full-param/learned-callback entry, wish.rs for complete source context/Memory lastCast/
gated landing entry, and hazards.rs for source facts and actual callback entry. Existing public methods delegate to the
same compatible engines and retain their old behavior/fixtures. A shared source-compatible leaf can be exposed
crate-privately without changing public inputs. No broad core refactor, metadata rewrite or suppressed old regression.
If a genuinely incompatible state contract cannot share safely, retain its source mismatch and return an explicit
interface proposal to Root; do not automatically duplicate an already ported whole module or weaken the source profile.

Public bot.rs/brain.rs/types.rs/Observation/Sim/World/server/headless/Unity/network/decoder/identity/learning store,
Cargo.lock/dependencies, old fixtures/tools and active strategy files are outside this lease. Humanizer's optional
feature gate and full private Brain/guard coordinator are the next packet's narrow proposed leases, not hidden additions
here. A module may emit any source-defined Intent but never schedules, stamps, scatters or submits it.

## Actual-source witness recipe and contract

After Root approval, use unchanged source in the pinned Node22.23.4 linux/amd64 image
`sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, read-only source binds, npm ci --ignore-scripts
inside tmpfs and new corpus outputs only. New schema proposal: `rh-bot-private-modules-source/1` with reviewed MethodValue
codec and source/config/tool/map/lock/runtime/compatibility inventories, complete byte lengths and SHA256. Do not edit or
rerun old corpora merely to inflate totals. Independent fresh-worktree exact reproduction gates native comparison.

Cases declare cfg identity tokens, complete source config/features/percepts/static maps, independent seeded decide/
motor/lapse/Knowledge lanes, ordered operations and deterministic service/bias descriptors. These are declared method
facts, not earned public World facts or createBrain derivation. Two equal configs can have distinct identity tokens;
same token reuses the actual same source cfg object. Use real createMemory.observe/noteSent/recordChoice histories to
produce context; never install expected Memory/module/Hunter state. Use real createKnowledge and real path service on
declared maps where practical; record complete actual callback arguments/results/order and exact draw values/counts,
including unused lanes. Direct ChestInput walk/sight descriptors must depend on requested coordinates, not answer tapes.

Invoke actual exported costsSomething/activeWeapon/cardScore/optionScore/chooseOption, new ChestHunter constructor and
its decide/tried/markDone/target/stats APIs, actual four module objects' present hooks and actual registry APIs. Record
input/output immediately as deep owned values, all intent/goal/status/why fields and list-return identity when observable.
A direct module's private WeakMap is not a diagnostic API: distinguish its state through subsequent source hook calls.
Direct ChestHunter own exposed properties may be recorded read-only with exact provenance, never fed back as setup.
Direct-hook caller order is declared per case; it is not represented as full Brain caller parity. Brain guard/merge/
sequence/lifecycle execution is the separately specified full createBrain witness in BOT_BRAIN_COMPLETION.md.

Ready finite trajectory families (names are planned coverage, not claimed passes):

- `choice-fit-block-risk`: known bases/conditionals/augments/boosts/kill ids/unknown strings, null versus counts build, absent/Undefined optional
  slot/risk, active slot/fists, exact risk0.5/0.7 boundaries, costs and first ties/taken arrays, negativeInfinity.
- `hunter-hold-expiry-teleport`, `hunter-candidate-cache`, `hunter-stall-interrupt`: in-range young/old competition,
  hold150/margin350/teleport equality, path/null cache below/at250, nearest3/tie IDs, fighting/retreating/free pick,
  arrival ETA/slack, progress24, capped500 elapsed, interrupted/resumed walks and>=3000 give-up/markDone/stats/log.
- `chests-panel-race-build`, `chests-goals-vs-act`, `chests-two-configs`: BLIND versus readable, no hidden-card branch
  influence from afar, delayed own build merge/dedup, panel close/reopen, held pick, same-option retry versus changed
  max3 and4000 window, stun/cast, path tier/safety, ephemeral goals hunter versus retained act hunter and cfg isolation.
- `planning-events-and-asks`: multiple actual private events with event.t != now, malformed-but-source-valid message
  payloads, first scheduling/replacement, short/long windows, empty/taken/no-faction branches, learned calls, ask/ready
  exact boundaries and phase reentry without invented reset; reuse real plan maths rather than supplied scores.
- `wish-availability-cast-slip`: actual Memory hit and sent-cast histories, Easy availability yes/no/renewal, rank/def/
  status gates, tags and full current player/mob facts, closed-gate blink geometry, stimulus priority, cast-before-step,
  pending/sent/hidden transitions, partial expiry/recast, leg keep/arrival/corner and module goals/statuses.
- `hazard-hooks-and-adjust`: real Memory still anchor/engagement, burning/loot/lock/standing guards, held step before map
  callback, light/search stable ties, exact timer/distance boundaries, source gated collisionMap/clear callbacks,
  adjust independent of phase, unchanged-list identity and ordered multiple redirects.
- `registry-order-and-context`: default4, replacement keeps order, enabled filters, reset/cast-policy storage identity,
  optional hook presence, same cfg shared state versus interleaved equal-value different cfg isolation. No synthetic
  future module substitutes for a missing built-in implementation.

Publish a reached behavior ledger tying every contract above to concrete case/operation and callback/status/draw evidence,
with explicit unproved paths. Bounded semantic controls must reach meaningful card tie/risk/block, hunter hold/cache/stall,
chest panel/build/race/temp-hunter, planning event-time/ask/lapse/bias, Wish availability/lastCast/slip/landing and hazard
hold/adjust/identity assertions. Keep raw first failures and survivors; source mutation copies stay disposable, source/
corpus read-only, comment-only NONKILL and restored exact histories required. Do not label compile/decode errors KILL.

Strict raw conversion rejects unsupported schema/tags/enums/duplicate keys and missing consumed facts before Memory/
module/RNG/path mutation. Preserve source-supported optional data instead of normalizing absent/Undefined/Null to empty.
Nonfinite declared clocks/geometry are rejected; internal Infinity/-Infinity and explicit source-sanitized learned
callback results need field-aware tags, never a blanket finite-to-zero coercion. New source values are unrounded
binary64. Start native checks exact; Root must approve an explicit continuous geometry/transcendental field whitelist
before any tolerance. No timer/order/choice/utility/status/string/RNG tolerance or imported old rounded oracle.

## Native gates and completion boundary

Root prepares a clean admitted base, interface hunk list and dedicated target after strategy readiness. Use Rust1.97.0,
--locked --offline, jobs1, incremental0 and debug info0. Suggested new filter `private_modules`; final paths/commands
come with the actual source seal/interface handoff. Required gates once after final changes:

- Full new source replay, fresh-instance/context-isolation replay, strict atomic-reader negatives and reached controls.
- Unchanged planning_parity, wish_parity/wish_module and hazards comparisons for affected shared engines; bot-core hand,
  Memory and admitted private strategy/tactics compatibility where interfaces are reused. Report exact real filters/
  counts, noting overlap; do not sum overlapping filters as extra cases.
- `cargo fmt -p rh-policy -- --check`; strict default and --all-features
  `cargo clippy -p rh-policy --lib --tests --locked --offline -- -D warnings`.

Retain exact cwd/base/source/code/toolchain/target/env, commands/exits/raw RED/GREEN/counts/timing and source pins. A
prerequisite mismatch gets its own Root repair lease; do not change old expectations or active dependencies here. Root
obtains independent source and native admission before integration. This closes the complete private module layer;
full Brain guards/cadence/hand features/sequences/stats/end, fair publication and real validated live/headless use remain
explicit later work, never omitted from the complete-bot objective.

## Root corrected bridge allocation (2026-11-10)

Root accepts the independent [bridge review](../../evidence/bot-module-bridge-review/README.md) and allocates only
these additional function/state seams in the same isolated `backend-bot-modules` worktree. The initial proposal is
preserved; it is not approved verbatim. Existing public APIs and old fixtures remain behaviorally unchanged.

- **planning.rs:** LEARN constants' crate visibility; raw finite-f64 SourcePlanDeal; a source array-index adapter over
  the existing plan score (invalid/fractional/negative/out-of-range resolves no entry/-Infinity, never truncation);
  shared schedule/learned bias/choice helpers; extract the existing PlanModule deal/phase/read/settle/lastCall/ask/
  ready transitions into one private core consumed by both the old wrapper and source module. Existing public deal
  and methods adapt into that core. `TierId` is correct for schedule tables; actual supplied reaction.mu/softmaxT/
  lapseP are required where source uses them. Real event order/time and cfg identity remain at the source adapter.
- **wish.rs:** source-shaped borrowed ability/rank/context adapter and shared cast-policy/availability/retry/slip
  transition core, with the old WishModule retaining its legacy public-view/clock behavior through a compatibility
  adapter. Source input uses actual Memory.lastCast/hit facts; do not substitute the old capped hit list or inferred
  casting start. Source rank remains f64 and follows actual floor/clamp. The finite reader supports the five actual
  built-in definitions plus all captured absent/invalid-def guard cases exactly. It must validate preserved fields,
  orders and Blaze64/300 distances; unsupported custom future valid shapes are explicitly outside this finite profile
  and refused before mutation, not silently converted to a catalog row. No rh-sim blink edit is allocated: use the
  existing fixed-distance leaf only under that proved matching profile, with the real collision/open maps and gates.
  Old public open/unlocked behavior remains through its compatibility adapter; do not silently correct it here.
- **hazards.rs:** factor existing classification/search and step/hold/expiry/arrival/throttle/light/adjust machinery
  into one private fact/service-based core. Both old Observation wrapper and source module use it; do not fabricate
  an Observation or actor ID. Parameterize distance origin, ordered predicates and actual clear/collision callbacks,
  preserving stable ties, hook call timing and unchanged-list identity. Empty/unknown source faction has no home
  exception; it does not become a fabricated recognized faction.

New helper files may be added only under `bots/planning/source_core.rs`, `bots/wish/source_core.rs`,
`bots/hazards/source_core.rs` if necessary, with module declarations in those three leased files. New focused bridge
witness tests may live in these new files or the already allocated modules tree. This allocation is limited to the
named existing functions, associated private state and their wrapper plumbing; it is not a whole-file rewrite or a
lease on types.rs, World/Sim, public observation, old test expectations, source/goldens, dependencies or identities.
If a transition truly cannot be shared without changing source/public behavior, report the exact field and counterexample
for a separate decision rather than duplicating an entire engine. Temporary mirrored engines must not survive.

Start exact, including callbacks and finite values. No numeric tolerance is pre-approved; report a real failing leaf
with source/native ancestry before any relaxation. All255 histories/3259operations and meaningful intake/nonadvance/
semantic controls remain required, plus affected unchanged planning/Wish/hazard/hand/Memory/Strategy overlaps and strict
default/all-feature lint/format. The reviewer recommendation's “in principle” is resolved only by this corrected lease;
final code and evidence still require independent admission.
