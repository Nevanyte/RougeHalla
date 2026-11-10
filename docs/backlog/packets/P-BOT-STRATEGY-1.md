# P-BOT-STRATEGY-1: complete private source strategy and hunting state

## ID and outcome

P-BOT-STRATEGY-1 implements the complete legacy strategy decision layer and its missing stateful hunting/build-route
dependencies in private Rust modules, driven by source-executed Memory method histories. Preserve every goal family,
candidate rule, retained timer, route, hunter transition and random draw. This advances the complete legacy bot; a
reduced selector, stub hunter or hard-coded route does not satisfy this packet.

The owner resumed Rust gameplay/bots/quests on November 9, 2026; DeepSeek owns Rust implementation and Sol/Luna own most
source capture, design and independent review. Claude continues Unity/networking. This packet is a private component
implementation: full Brain/tactic/module integration, accepted fair publication and live activation follow separately.
The old P-BOTS-1 packet's proposed new crate, initial fists-only assumptions and fairness substitutions are historical;
do not follow them for this source-fidelity work.

## Dependencies

- P-BOT-MEMORY-ADMISSION-1: reviewed candidate `0ea1589a37cdcf957195fe4955a917e644c4b88e` on backend base
  `4151b3af597cc06d1b3b77f4e3e21cc9906b6a86`; coordinator integrates before preparing the exact implementation branch.
  Independent release: `docs/evidence/backend-bot-memory-admission-review/README.md`.
- Existing source FrameRing/MethodValue, Memory, random, knowledge, tier/persona tables and pure build/hunt helpers.
  Verify signatures and semantics before reuse; presence is not whole-strategy parity.
- **Parallel source and native implementation; freeze before parity:** Sol/Luna independently captures unchanged actual-source Memory API + strategy/hunt/route cases and reviews their source/tool/runtime identity and branch ledger. After interface/readiness review, DeepSeek may implement the complete source-derived native classes in parallel, using unchanged TypeScript contracts. Source authors must not tune oracles to native outputs or narrow source inputs to fit native types. The strict fixture reader, native comparison and admission wait for Root's immutable independently reproduced source handoff. Keep implementation, source seal and parity receipts separately reviewable; source mismatches remain evidence rather than reasons to rewrite expectations.
- Prepared native branch/worktree/base: `codex/deepseek-private-strategy`, `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-strategy`, `d21552d3`. Target: `/Users/nevinmckinnon/.codex/tools/roguehalla-backend-20261109/target-strategy`. DeepSeek owns all Rust/tests; Sol owns new source paths; Root coordinates admission. Source schema is additive `rh-bot-private-strategy-source/1`; final exact codec/input contract comes with the frozen manifest.
- No new public Observation field, wire revision, Unity work or live BotVision adapter is required for this private seam.

## Relevant legacy paths (verified with `rg`)

- `packages/server/src/bots/brain/strategy.ts`: complete 901-line strategy, its full Goal/GoalDecision behavior and state.
- `packages/server/src/bots/brain/huntAdapter.ts`: remembered fighter/mob inputs, seeded homes, catch-up, release, awakeNear.
- `packages/server/src/bots/mobHunt.ts`: `MobTracker`, `MobHunter`, tunables and existing pure weapon/retreat helpers.
- `packages/server/src/bots/brain/buildRoute.ts`: `BuildRoute`, contest/zone memory and replanning; static build/value leaves.
- `packages/server/src/bots/brain/memory.ts`: factory, observe, noteSent, recordChoice and view.whereabouts.
- `packages/server/src/bots/brain/types.ts`, `random.ts`, `knowledge.ts`, `services.ts`, `brain.ts`: exact context/config,
  goal/status/module/path/learned contracts and source caller order. Actual imports under `packages/shared/src/` define
  stats, rewards, weapons, faction/mob catalogs, numeric functions and map constants; derive the source closure from imports.
- `packages/server/test/bots/{strategy,memory,buildRoute,knowledge}.test.ts` and
  `packages/server/test/mobHunt.test.ts`: source behavior cases, useful for coverage discovery rather than frozen oracles.
- Existing capture patterns: `tools/bot-brain-prefix-fixtures/`, `tools/bot-protection-cues-fixtures/`,
  `tools/npc-continuity-fixtures/`; do not modify their sealed payloads, expectations or provenance.
- Existing Rust: `crates/rh-policy/src/bots/temporal_percept/{memory.rs,data.rs,input.rs}`, `random.rs`, `knowledge.rs`,
  `types.rs`, `build_route.rs`, `mob_hunt.rs`. The last two explicitly lack the stateful source classes.

## New paths

- Source worker: `tools/bot-private-strategy-fixtures/{capture.mts,cases.mts,capture.sh,verify.mjs,controls.mjs,README.md}`,
  `parity/policy/bot-private-strategy/{source.json,coverage.json}` and
  `docs/evidence/bot-private-strategy-source/`. Scripts/files are to be created by Phase A; exact filenames may be split
  within these new directories for maintainability, with a complete manifest.
- Rust worker: `crates/rh-policy/src/bots/temporal_percept/strategy.rs` and `strategy/` containing private contract types,
  strategy, hunt adapter, tracker/hunter, build route, strict source reader and source/declared-control tests.
- Native receipts: `docs/evidence/bot-private-strategy-native/`.

## Exclusive write scope

**Sol/Luna Phase A lease:** only the three new source/evidence directories above. Source implementations, package locks,
existing captures/fixtures and Rust stay immutable. Run a frozen isolated source checkout/runtime; do not operate on
Claude's primary checkout, other workers' targets or processes. This packet authorizes no messages to external people.

**DeepSeek Phase B lease:** only the new `temporal_percept/strategy.rs`, `strategy/**` and native evidence directory;
add only `mod strategy;` to `temporal_percept.rs`. One explicit visibility-only edit is allowed in `memory.rs`:
`mod source_input;` may become `pub(super) mod source_input;` so the private sibling consumes the existing crate-private
Memory input types. No Memory fold, comparator, expected result, method behavior or existing source-test edit belongs in
this lease. Add new actual Memory API tests below the new strategy test directory. If a genuine Memory mismatch is found,
retain the red and report it; root allocates a separately reviewed repair before dependent work continues.

No public `bot.rs`/`brain.rs`/Goal change, live policy-seat wiring, rh-sim, rh-server, rh-headless, observation,
protocol/decoder, Unity, cloud, dependencies, Cargo.lock or shared-status edit. No merge or push. Separate reviewed
source seal and native implementation/evidence seals; Root integrates and updates shared records.

## Contracts and references

AGENTS.md; docs/MIGRATION.md current backend lane; docs/REQUIREMENTS.md R-GAME/R-AUTH/R-ML; docs/CONTRACTS.md
C-OBS/C-INPUT/C-RNG/C-DET/C-NUM/C-PARITY/C-POLICY; ADR0005 and ADR0007; the Memory independent release above.

Inputs are owned declared source-method facts and previously perceived bot memory, never a native World/Sim reference,
hidden current entity lookup, authoritative identity resolver, secret RNG or wall clock. Memory/strategy state remains
private. Future live/headless actions still use validate + Sim::submit with ordinary budgets and configured cadence;
this packet neither adds action submission nor changes current live behavior. No training/models/datasets/Python
bindings/inference service or actual cross-match learning store; learned-bias callbacks are bounded declared inputs.

## Behaviour to preserve

**Complete context:** use a full private source Goal union (Idle/Farm/Hunt/Fight/Loot/Flee/Roam/Hold/Module), full status,
decision/choice/why and relevant Percept/config/map/self fields. Existing public `brain::Goal` is an incomplete compatibility
surface and must not constrain this port. Distinguish absent/Undefined/Null, preserve source string ID equality, ordered
Map/Set state and complete state retention; no arbitrary truncation or approximate facts. Do not use expected Memory or
expected candidate rows as inputs. Reuse the real admitted Memory and real native dependency state machines.

**Strategy:** exact decide call order; sync/settle/exclusions/loot skip; route/hunter update; enemy memory and third-party
cues; pursuit progress/avoid timers and hit/near release; flee/fight/hunt/evade/last-seen choices; appraisal cache and
opening/bounty/HP thresholds; farm, camp walks/value, patrol/centre/lie-low/patience/coliseum/sudden-death/hold/loot
candidates; feature-module enabled/goals order and utility clamp; dedup/filter/tie order; wait fallback; softmax/lapse
draws; tunnel attention and hysteresis; chosen goal identity/key, choice omission when kept; releasing hunt on nonfarm.
Source formulae and thresholds win over prose, older tuning docs or a preferred bot policy.

**Stateful closure:** full BuildRoute planning and deterministic camp tie-break; contests from player proximity, remote
alive loss and stolen heading, zone hit/avoid memory, expiry/replan/broken route/respawn wait. Full MobTracker records,
homes/rising/death/removal and MobHunter engagement, damage/progress/ban/retreat/player-lock/repick counters and timers.
HuntAdapter source input conversion includes remembered whereabouts age, blocked current threats, returning-mob exclusion,
type/name/faction-derived max HP, seeded homes, path callback failure and Easy straight-walk factor. Preserve catch-up
240ms piece size/14-piece cap and the hunter's own time-step cap; catch-up uses the same snapshot at interpolated times.
Release is the source synthetic-near-player call into the real hunter, not an invented reset.

**Random/numeric:** exact separate decide/lapse streams and draw order/count. Source Gaussian consumes two uniforms and
discards the spare; strategy caches the resulting per-foe appraisal draw until its expiry. No draws on
branches where source does not draw. Source unitHash uses UTF-16 code units, wrapping ECMAScript integer arithmetic and
source string identity; test non-ASCII IDs. Preserve Infinity/-Infinity sentinels internally via explicit tagged fixture
values, signed zero, binary64 operation order and source-compatible math where required. Do not route these values through
wire quantization or f32. No tolerance may hide changed goal, target, expiry, timer, candidate order or RNG consumption.

### Scoped numeric admission decision

Root permits source freeze with every numeric value retained unrounded. Preserve exact Memory outputs, declared inputs,
RNG values/count/order, tags, collection/callback order, identities, discrete decisions and pure arithmetic clocks/timers.
The existing bot-core `1e-9 * max(1, abs(source))` contract may apply only to explicitly identified Gaussian/transcendental-derived continuous leaves; the existing parity `2e-6` absolute bound may apply only to explicitly identified continuous geometry/hypot-derived leaves and route estimates. The source evidence must enumerate each logical field and derivation. Native comparator path whitelists require independent review before admission; no blanket numeric epsilon, approximate module utility, expiration boundary or output-driven exception is authorized. Exact branch outcomes still bind all boundary cases. Explicit computed geometry callback arguments may use the same geometry rule; declared/discrete callback arguments remain exact. These inherited contracts never justify rounding or changing the frozen source values.

## Acceptance checks

1. **Freeze actual-source Memory API witness.** Execute unchanged createMemory/observe/noteSent/recordChoice/whereabouts
   chronologically. Cover complete emitted command shapes and reflection/failure/arrival, bounties/choices/lastOrder/
   lastCast, Wish castLand, chasing/third-party, plan/chest/death/teleport, never-dotted absence and exact expiry boundaries.
   Preserve initial/null frames and compare all eight Memory outputs and returned stimuli. Every row records its method
   inputs and caller sequence. Label declared percepts/services honestly; manually installed context is not earned gameplay.
2. **Freeze complete actual-source strategy witness.** Call real createStrategy and its real HuntAdapter/MobHunter/
   MobTracker/BuildRoute over the Memory history, with all additional declared percept/config fields recorded. Capture
   decisions and ordered candidates, Strategy.state, route/contests, target/stats, awakeNear and ordered callback calls/
   returns plus decide/lapse draw transcript. Capture read-only own-state diagnostics only when needed to inspect private
   timer/Map state, without modifying classes, replacing dependencies or installing desired outcomes. A changed dependency
   state must be detectable through snapshots or subsequent real calls. No expected candidate answers feed native inputs.
3. **Close coverage rather than advertise a tiny subset.** All nine goal families and the behavior list above have
   identified source branches and chronological cases. Include failed/done/blocked/running status; enabled/disabled/
   missing module goals; learned bias enabled/disabled/unknown; all tiers/personas and five-faction route inputs; path
   blocked/null/success; exact below/at/above boundaries; tie/duplicate/module ordering; source-aged remembered players;
   hunter catch-up cap; off-home healing; retreat/ban/lock and route contests/zone expiry. Publish an honest branch ledger.
   A branch lacking a witness stays open and cannot silently become a stub or disappear from the full packet outcome.
4. **Strict corpus and independent reproduction.** Version the additive schema; pin runtime/image/lock/source/tool/map
   identities, ordered inputs and payload hashes/bytes. Checked readers reject unsupported shapes/tags/enums/duplicate
   Map keys, preserve Undefined/Null/nonfinite tags, and do not mutate native state before typed conversion succeeds.
   Reproduce the canonical source bytes independently in a fresh isolated checkout/runtime before native admission.
5. **Real native closure parity.** Replay raw source method/context inputs into the admitted Memory plus real new native
   strategy/hunter/tracker/route code. Compare the full recorded outputs, candidate order/state, callback transcript and
   RNG draws/counts, with exact discrete values and exact binary64 where required by the method witness. Use a documented
   existing numeric contract only where source math genuinely requires it, approved before freezing expectations; no
   rounded-input shortcut, output-derived input, f32 conversion or widened blanket tolerance. Reset/recreate must clear
   every retained private state and restore the same transcript for the same inputs/seeds.
6. **Semantic controls.** Source/native mutations must fail at an intended semantic assertion, not merely compile/read
   failure: change candidate order/dedup tie, hysteresis, expiry comparison, pursuit progress/reset, loot failure/skip,
   hunter catch-up/release/home/rising/ban and route contest/replan/tie behavior. Keep actual failed receipts and surviving
   controls with exact scope. Synthetic negative/reader controls stay separate from actual-source parity claims.
7. **Regression and review.** Preserve all admitted 2,112 protection and 773 NPC comparisons, prefix/temporal controls and
   their semantics. Run focused new tests and relevant affected controls, scoped format, strict default/all-feature policy
   library/test Clippy on the sealed base. No blanket dead-code allowance beyond the existing private ancestor. Root
   obtains independent review of exact source/native seals, scope, state coverage and limitations before integration.

## Validation commands

Phase A commands to be created and documented by that worker: the new `capture.sh` with write/check modes,
`node tools/bot-private-strategy-fixtures/verify.mjs`, and semantic controls/external reproduction. Use the repository's
existing pinned source Docker/runtime workflow; do not run captures against Claude's active tree.

Phase B uses repository-pinned Rust 1.97.0, `--locked --offline`, jobs 1, `CARGO_INCREMENTAL=0`, debug info 0, and a new
root-assigned packet-owned target (suggested sibling `target-strategy` below
`/Users/nevinmckinnon/.codex/tools/roguehalla-backend-20261109/`). Never clean/reuse another packet's target. Commands:

- `cargo test -p rh-policy --lib private_strategy --locked --offline -- --nocapture` (new test namespace/filter to create).
- `cargo test -p rh-policy --lib memory --locked --offline -- --nocapture`.
- `cargo test -p rh-policy --lib protection_cues --locked --offline -- --nocapture`.
- `cargo fmt -p rh-policy -- --check`.
- `cargo clippy -p rh-policy --lib --tests --locked --offline -- -D warnings`.
- `cargo clippy -p rh-policy --lib --tests --all-features --locked --offline -- -D warnings`.

Retain command/cwd/exact input and code revision, environment/toolchain, target, test counts/scopes, exit codes and raw
failure/pass output. The Memory filter already includes prefix tests; avoid presenting overlapping filters as distinct
coverage. Root runs any wider integration gate once for the admitted union.

## Risk and suggested model tier

High source-fidelity risk: roughly 900 lines of strategy plus missing stateful dependencies; stochastic consumption,
ordered Maps, memory timing and callback order interact. Owner routing is DeepSeek for Rust, Sol/Luna for source
capture/design/review. Keep Phase A source freeze, stateful dependency implementation and complete strategy composition
as separate reviewable seals within this one full outcome. Report progress and exact remaining branches; do not relabel
a partial delivery as a complete strategy or full bot.

## Known traps

- Stop dependent work on a genuine source mismatch, missing prerequisite, dirty prepared checkout or required out-of-lease
  change. Retain evidence and report; do not silently widen the lease or tune source fixtures.
- Existing BuildRoute/MobHunt Rust files contain useful pure leaves; they do not contain the missing source classes.
- Current private Memory's typed observe API does not guarantee atomic validation of arbitrary nonfinite typed input.
  Keep raw checked-reader behavior distinct from internal sentinel/math behavior and future public intake requirements.
- Strategy uses Memory.whereabouts as well as MemoryView fields. Preserve that real query: its position is the last seen
  position, only its uncertainty radius grows with age, and the query expires after the memory span;
  do not reconstruct it from current hidden positions or captured expected whereabouts answers.
- Module/learned/path/knowledge callbacks need exact call/result semantics. Declared callback tapes bind this finite
  strategy seam; they do not establish real module, learned persistence or path-service integration. Avoid a tautological
  callback harness that returns the same answer regardless of requested argument/order.
- Static source facts and source-public map declarations are acceptable private inputs. Source World hidden reads,
  cross-sample alias stitching and fabricated public identities are not authorized by this packet.
- No need to wait for a new wire to port private strategy. Fair live publication/validation, full tactic/reflex/loot/module
  integration, complete Brain/humanizer output orchestration and real headless/live outcomes remain later gates.
- Learning persistence/fill/tournament completion remain explicit full-bot requirements after this decision-layer closure;
  no balancing, training, model or win-rate claim follows from method-level equality.
