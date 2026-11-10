# P-BOT-TACTICS-1: complete private source tactics closure

## Outcome and scheduling

Implement the complete unchanged legacy `createTactics` decision-to-intent layer privately, including its real Fight,
WorldTactics, OrbWalk, Reflexes and Retreat dependencies. The full private strategy's nine goal families must all have
their source-defined execution behavior. A player-only fight, simplified flee, missing loot executor, false/no-reflex
substitution or reduced public Goal adapter does not satisfy this packet.

This is the next dependency-complete layer after P-BOT-STRATEGY-1. It does not activate Brain, HumanBot, a live seat or
headless policy. All Rust, including readers/tests/repairs, is authored by DeepSeek. Sol/Luna owns source preparation and
independent source/native review; Root allocates worktrees/targets, approves interface hunks and integrates.

Source-only discovery/capture may start after Root reviews this packet, independently of evolving strategy/native
outputs. Native interface work may start after Root admits the full private strategy types and prepares a clean branch.
Native fixture reader/comparison/admission waits for an immutable independently reproduced source seal. Source authors
must not inspect native answers to tune inputs or expected results. No capture or implementation is dispatched by this
document's creation.

## Source and admitted components

**Source release (2026-11-10):** candidate `54ff01a2` is released for finite native consumption by [Root's admission](../../evidence/bot-private-tactics-source-review/ADMISSION.md), after independent reproduction `c8d0a5e6`. All154 cases/720 methods and every captured channel remain required. That decision fixes the narrow derived-geometry whitelist and maps the exceptional World empty-route case to a typed native error with equivalent pre-error effects; it neither omits the case nor requires a panic. Native dispatch still waits for private strategy admission and an exact branch/visibility allocation.

Actual code wins over older documentation. Read AGENTS.md, current backend checkpoint, REQUIREMENTS/CONTRACTS,
ADR0005/0007 and P-BOT-STRATEGY-1. Preserve C-OBS/C-RNG/C-INPUT/C-DET/C-NUM/C-PARITY/C-POLICY.

Source closure:

- `packages/server/src/bots/brain/tactics.ts`: full dispatch, one-time knowledge draw, flee, shared dependency ownership,
  world/reflex arbitration and all stats.
- `packages/server/src/bots/brain/tactics/fight.ts`: complete player/mob and remembered/current fight state machine.
- `packages/server/src/bots/brain/tactics/world.ts`: loot, roam, all holds, idle and hold-spot selection.
- `packages/server/src/bots/brain/tactics/kite.ts`: ownTimings/reactOr, OrbWalk, Reflexes, Retreat and geometry helpers.
- `brain/{types,memory,knowledge,services,random,brain}.ts`, `bots/mobHunt.ts` and their actual shared imports: exact
  context/caller order, target identity, camps, weapons, collision/reach masks, geometry and path contracts.
- `packages/server/test/bots/{tactics,brain,humanizer,clicks}.test.ts` and related source tests aid discovery; expected
  results must come from actual unchanged source methods rather than translated test assertions.

Read the following existing Rust/code fixtures before designing adapters. Presence is not admission of a full layer.

| Existing implementation | Reuse and exact limitation |
|---|---|
| `bots/temporal_percept/memory.rs`, real method input reader | Use the admitted full Memory, not memory_prefix or captured expected memory. Strategy's real Memory API establishes the dependency. |
| `bots/temporal_percept/strategy/types.rs` after admission | Reuse full private Goal/GoalStatus and reason contracts. StrategyPercept is a strategy-specific input; do not assume it contains all tactic projectile/facing/windup/interaction facts. |
| `bots/fight.rs` plus source/sudden-death tests | Already implements an admitted visible/remembered-player normal component. Its NormalTactics API uses PlayerRef, its own memory_prefix and only Idle/Fight goals; it cannot stand in for full createTactics or source string/mob identity. Preserve existing tests and public behavior. |
| `bots/reflex.rs`, `kite/reflex_geometry.rs` | Actual source Reflexes with MethodKey string identities, retained decisions/hold/counters, typed complete facts and clear-path callback. Reuse this real component where input contracts fit; real Memory-derived stimuli/feints must feed it. No blanket empty cues. |
| `bots/orbwalk.rs` | Actual source stateful component, already source-tested, but its Owner/PlayerRef/concrete path API is narrower than arbitrary private source string targets. Do not mint PlayerRef aliases for source IDs. See interface decision below. |
| `bots/fight/retreat.rs`, `mob_hunt.rs`, `kite.rs` | Single-visible-player retained Retreat is narrower than source multi-threat Retreat. Reuse proved retreat_point/away_point/timing/weapon leaves, retaining complete source multi-threat state and reset semantics. |
| `bots/world_tactics.rs` | Already source-tested roam, idle and non-coliseum hold. Loot, coliseum approach/crowding/spot state are explicitly missing; its public Goal is incomplete. Preserve old consumer, close all missing source branches privately. |
| `bots/paths.rs`, `knowledge.rs`, `random.rs`, static tables | Reuse real source-compatible implementations, clock/gate/cache/budget semantics and seeded streams. Record actual calls/results, including failures. No new entropy or hidden state. |
| `bots/humanizer.rs`, `clicks.rs`, `parity/policy/bot-core.json` | Existing hand/click scheduling is downstream and stays unchanged. Tactics emits Intents; it does not delay/scatter/stamp/submit them or consume motor/lapse draws that source tactics does not consume. |

The smallest honest slice is this complete tactic layer. Complete Brain/module integration follows it: chest module +
ChestHunter/card choice remain genuinely missing in policy code; planning/Wish/hazard state machines and hand/clicks
already exist but need full context/caller integration. Source Brain still needs full private Goal adoption, module
guards/observe/goals/intents/adjust/act order, engagement/missed-click feedback, sequence1..255 stamping/noteSent,
statistics/end summary and exact four derived RNG streams. Existing public brain.rs contains a bounded scheduler and
merge helper, not that full composition. Humanizer also lacks source optional feature-message filtering before draws;
the old bot-core capture constructs it without features. These are explicit later closures, not reasons to rewrite the
hand or claim whole-bot completion here. Public fact publication and accepted live activation remain separately gated.

## Interfaces and exclusive scope

New source worker paths only:

- `tools/bot-private-tactics-fixtures/**` (capture/check/strict codec/semantic controls/documentation, split as useful).
- `parity/policy/bot-private-tactics/{source.json,controls.json,manifest.json}`; additional new coverage ledger only if
  useful, with honest reached behavior rather than a blanket line-count claim.
- `docs/evidence/bot-private-tactics-source/**`.

New DeepSeek paths only:

- `crates/rh-policy/src/bots/temporal_percept/tactics.rs` and `tactics/**` (complete private implementations, typed inputs,
  callback adapters, strict reader and tests).
- One registration line `mod tactics;` in `temporal_percept.rs`, after Root allocates the integration-base hunk.
- `docs/evidence/bot-private-tactics-native/**`.

Independent review writes only new `docs/evidence/bot-private-tactics-source-review/**` and
`docs/evidence/bot-private-tactics-admission-review/**`, under Root's leases. Root alone edits shared statuses/Cargo.lock.

**Interface proposal, requiring separate Root allocation after strategy seal:** in `temporal_percept/strategy.rs`, change
only `mod types;` to `pub(super) mod types;` if the sealed layout still matches, exposing already crate-private contracts
only to temporal_percept siblings. Do not alter any type/algorithm/fixture in active strategy scope. Strategy's existing
Memory `source_input` visibility expansion should suffice; verify the admitted version rather than repeating it.

**Root's interface decision:** implement full source-shaped private Fight, OrbWalk and Retreat within the new tactic
directory, reusing compatible admitted pure leaves and the real existing Reflexes component. Preserve all existing
public Fight/OrbWalk/Retreat APIs and implementations exactly; do not refactor their Owner/PlayerRef/concrete-path
contracts under this packet. No invented ID aliases or truncation may bridge arbitrary source identities to PlayerRef.
Replay the existing admitted finite Fight/Orb source cases against the new private implementations as compatibility
overlap, in addition to the new full-layer witnesses, without changing source expectations. Existing code is a useful
reference, not an oracle. The new typed input layer may supply complete source facts; strategy's active types and
percept consumer remain unchanged apart from the separately allocated visibility-only hunk above.

No active strategy implementation/tool/source edits, public `bot.rs`/`brain.rs`/Goal edits, World/Sim/server/headless,
protocol/observation/decoder/Unity, dependency/lock, existing corpus/capture, wire version, live identity resolver,
learning persistence or actual input submission. No training/models/datasets/Python/inference. No merge/push.

## Complete behavior contract

Use the full private source Goal union: Idle, Farm, Hunt, Fight, Loot, Flee, Roam, Hold, Module. Module passed directly
to createTactics returns source failed output; source Brain, in the later packet, runs the real module's act instead.
Return complete ordered intents (body, priority, timing/stimulus, why), status(state/why), attacking and exact lifetime
stats/getStats. Preserve arbitrary string equality, optional/Undefined/Null distinctions and ordered Maps/Sets.

**Ownership/order:** one shared OrbWalk, Reflexes and Retreat per createTactics, with the same Fight reference to those
instances. Draw knowledge of sudden death once on first act before every goal branch, including idle/module. Non-flee
resets a previous flee's Retreat; noncombat calls Fight.leave, which clears lastMove/held/plan but not every engagement,
swap timer/counter. Do not turn source partial resets into full resets. Recreate clears all lifetime state. Preserve
exact RNG and callback order even if the eventual emitted intent is identical.

**Fight:** current fighter then mob then actual Memory fighter/mob lookup, alive/lost/returning states; faction and empty
hand/fists checks; mob coliseum/gate rejection; engagement identity/gap, chance draw/reset and distinct mobTargets;
locked camp-mate radius/camp/elite/returning/counter/ranged viability; player-known versus mob weapon swap policy and
windup/cooldown/jitter timer; source reach-mask versus LOS distinction; attacking against actual substituted mate;
real Reflex preemption/hold before bounty hunt opening and sudden-death hysteresis; progress distance/HP/attacking
touches and ten-second failure; real OrbWalk against remembered chasing/current velocity; wand lock/targetability;
plan cache/replan/goal-drift/three-no-path failures, waypoint selection, move resend/standing thresholds and re-lock
timing. Keep source approach and failure why strings. No missing mob, remembered or ranged branch may return Idle.

**Flee/Retreat:** explicit source threats versus visible alive players and remembered-awake mobs; full multi-threat
minimum-distance retained destination test; exact retention/arrival/replan/reset; finite until boundary; first successful
flight blocked then running and one retreat counter; lowHp/hpLoss first matching stimulus; cornered nearest visible
player/regional-mob fallback through the same real Fight, stable tie/order, source running-why substitution and empty
corner failed output. Flee does not gain a reflex call absent from source. Reset interactions matter across goals.

**World:** all source loot slot state, carried-at-start, lastNow event dedup, stop/pickup retry/fail/budget/final latching,
toast normalization/timestamps, seen versus real remembered container, skipped/emptied/gone facts, nearby player/awake
mob safety, LOS/path/walk/waypoint fallback and settle-before-pickup. Full roam distance/settle/walk. All holds include
coliseum crowd/persona/seeded24-step spot selection, collision/in-coliseum/fallback scoring, arrival/settled/stop resend.
Preserve goal-state keys and3000ms stale pruning, including calls that do not invoke slot(). Stop-once for idle and
other holds stays exact. World.act runs before shared Reflexes.check; reflex removes only order intents, preserves
other channels, blocks with source why/attackingfalse, and a pending hold suppresses order without inventing a new
status. Keep shared reflex history across world/combat transitions.

**Orb/Reflex:** retain every admitted behavior, decision cache eviction/order, shot/projectile identity and source Memory
feints; own-origin/range/course/lag/aim/timing and blocked headings; one remembered yes/no per source key; dodge outranks
juke, hold suppression and counters. Orb initial Infinity, launch/new-shot detection, reset-with-retained-cycle-count,
away applied/drop/timeout transitions and timed re-lock must survive the new full integration. No mocked dependency
answers or fabricated public availability may replace these real methods.

## Actual-source witness and review

Freeze additive `rh-bot-private-tactics-source/1` from unchanged source in an isolated pinned local Docker runtime. Pin
source closure/lock/runtime image/map/config/tool hashes and byte lengths. Declare method-level percept/services inputs
honestly; they are not earned Sim/public facts. Real createMemory.observe/noteSent/recordChoice histories produce the
Memory view, never expected memory snapshots or hand-installed progress. Real Knowledge has a separately declared
seeded stream. Record decide/motor/lapse streams and actual draws even when a lane is unused. Component stream seeds
do not claim createBrain derivation unless that real caller is executed.

Call real createTactics with its unchanged default dependencies, plus direct exported Fight/World/Orb/Reflex/Retreat
methods where necessary to distinguish retained state. Capture every result immediately with deep owned snapshots,
both stats aliases and complete ordered path/knowledge/RNG callback arguments/results. Use real source path service on
declared maps where practical; any alternative descriptor must be deterministic and argument-sensitive with inputs
recorded, never output tape or constant answers that hide wrong coordinates/order. Preserve actual null/empty-path
differences. Closure-local state cannot be invented as diagnostics: use subsequent source calls that distinguish it;
capture own state only where the actual object exposes it without rewriting source.

Publish a reached-behavior ledger for every behavior above, with concrete case/operation/path and explicit open gaps.
Target risk combinations rather than a blanket faction/tier/weapon Cartesian product. Include all nine goal kinds and
all four statuses; current/remembered player+mob, camp-mate branches, null/non-null path/reach masks, flee corner/reset,
loot feedback/final/stale slots, crowded coliseum holds, real dodge/juke versus normal behavior, world↔fight shared hold,
source timer exact below/at/above and no-draw branches. A label naming a branch does not prove it was reached. Keep
existing source corpus immutable; prior witnesses can be cited/reused with exact provenance, but a new unified method
sequence must establish new interactions. Do not rerun every old capture just to increase totals.

Semantic controls must reach intended behavioral assertions, not fail to compile/decode. Choose a bounded meaningful
set, including camp-mate retention/returning exclusion, swap draw/cooldown, shared real reflex preemption/hold, Orb
launch/reset, flee threat retention/reset/corner fallback, loot event-once/retry/failure/final latching, and hold spot/
stale state. A control that changes nothing on the chosen trajectory is an explicit gap. Record raw REDs and surviving
controls; do not weaken earlier failures to manufacture intended ones. Existing supported-player/Orb/Reflex regressions
must remain green as component interfaces are reused.

Strict raw decoding rejects unsupported schema/tags/enums, duplicate Map keys, missing consumed facts, malformed or
nonfinite declared clocks/geometry before any Memory/tactic state, RNG or path mutation. Internal source sentinels remain
explicit tags, including Undefined/Null/Infinity/-Infinity/signedzero. Compare all consumed inputs and full outputs;
unknown optional data is not automatically empty/false. Required source fields added by this closure live in the new
typed input layer rather than silently extending strategy's narrower consumer.

Keep exact binary64 inputs, identities, ordering, flags, counters, clocks/expiry and discrete branch/goal/status results.
Use P-BOT-STRATEGY-1's already approved contracts only on an independently reviewed explicit field/path whitelist:
`1e-9 * max(1, abs(source))` for genuinely Gaussian/transcendental continuous leaves, or inherited `2e-6` absolute geometry
leaves/derived callback coordinates. No rounded fixtures, blanket epsilon, f32 conversion, approximate timer, native-output
exception or utility/status tolerance. Exact threshold outcomes bind the boundary cases. Do not impose unsupported
bit equality on independently implemented transcendental leaves and then retune source expectations.

Independent fresh-worktree pinned-runtime byte reproduction of the frozen source/tools/manifest gates native comparison.
Native replay must use the real admitted Memory and full tactic classes, compare full result/stats/callback/RNG transcript
and distinguish retained-state behavior. Reset/recreate with same seeds/inputs must replay identically. No expected
FightRef/foe/camp/progress/loot state, substitute dependency result or candidate-driven callback may feed runtime setup.

## Native gates and final handoff

Root prepares isolated branch/base/target after strategy admission and interface decisions; do not use another packet's
build target. Use pinned Rust1.97.0, locked/offline, jobs1, incremental0 and debug info0. Suggested new filter name
`private_tactics`; final module/test paths and exact commands accompany frozen interface/source handoff.

- New full source parity, strict reader negatives and reached semantic controls.
- Relevant unchanged old fight/sudden-death/Orb/Reflex/world/hand/Memory/strategy comparisons, with exact filters/counts;
  avoid presenting overlapping filters as independent extra coverage. Run each required gate once after final changes.
- `cargo fmt -p rh-policy -- --check` and strict default/all-feature `cargo clippy -p rh-policy --lib --tests --locked --offline -- -D warnings`
  (add `--all-features` for the second lint).

Store exact command/cwd/base+seal/toolchain/target/environment, source/code hashes, raw exit/output, counts/timings and
red/green binding. Preserve first failures and report a genuine prerequisite mismatch for separate Root scope; do not
repair Memory/strategy/publication or old expectations under this packet. Root obtains independent exact source/native
review before integration. Whole Brain, module registry/execution, accepted fair intake, transport/handles and live
validate+submit remain later gates; completing this packet closes the full private tactic layer without claiming those.
