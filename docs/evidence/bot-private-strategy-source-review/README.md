# Private strategy source witness — independent discovery and review ledger

**RELEASE bounded98 source at `5ec31212b0082d650cbe15d58877e82ac2793060` for native consumption.** Independent fresh-checkout
source/coverage reproduction and pinned-runtime verification pass; the final receipt below supersedes earlier pending
states in this chronological review. Module numeric goal-key semantics remain an explicit supplemental gap. This is
not native strategy admission or a claim that the full bot is implemented. Sol source author `quest_architect` owns the
new tooling, corpus and source evidence. Reviewer owns this ledger, its authorized reproduction receipts and the earlier
coordinator-authorized two precise contract wording corrections in the packet. No tooling, corpus, Rust or shared-status
file was changed. Capture execution occurred only in the final authorized fresh98 reproduction recorded below.

Reviewed the complete unchanged `strategy.ts`, `huntAdapter.ts`, `mobHunt.ts` and `buildRoute.ts`, plus their types,
random/memory APIs and relevant source test examples. Source tree inspected at `93ed730206b5b67d5b72018b4f87c414f968cd3e`;
the six key hashes below bind the inspected bodies independently of later documentation commits.

| Source path below `packages/server/src/bots/` | SHA-256 |
|---|---|
| `brain/strategy.ts` | `edf3ec7f0e2b68de24e52def86e046209cd53c98c598057d38baf810f1ec2116` |
| `brain/huntAdapter.ts` | `0dac45d23811dbb72a8e8e5aa888e563a616f1fba255cde516176278e70c027d` |
| `mobHunt.ts` | `88fc22040e62b1bc5226c37c16095032533df1e104dee0b27fdcb671c33fe6ff` |
| `brain/buildRoute.ts` | `fbe819cc2b36da50c7b01b0e4c40cf77c5c27286e6b5c69d76bc24e862af4f5e` |
| `brain/memory.ts` | `29c2086be936ec867ddec97c2e4442b86acdbf1255e55de001e73892f7b128a8` |
| `brain/random.ts` | `a23fb8d369ffced9e30719706b12eb5ec65afb14da16429a7cdc9dbc7e3f92f7` |

## Evidence boundary and priorities

The full source implementation is the target. Finite source witnesses should catch meaningful state/order/goal changes,
with an honest ledger of remaining gaps; they need not manufacture one case for every short-circuit or a Cartesian
product of every tier/persona/threshold. Prefer a few chronological suites in which state transitions affect subsequent
real calls. Do not count manually constructed context as earned World gameplay or direct class tests as coupled
Memory→strategy integration. Existing source unit tests often install fake Memory records; use their public class
vectors or behavioral ideas, then build real createMemory histories for coupled evidence.

The author has received the requirements below directly and accepted: real Memory histories, complete read-only
Strategy own-state diagnostics, separate real Hunter/Tracker/BuildRoute suites, argument-sensitive callback descriptors,
and one ordered callback/RNG transcript. No source seal/canonical bytes/runtime receipt has been reviewed yet.

## High-yield witness ledger

All rows currently have status **required witness design sent; capture not yet reviewed**. Source line anchors refer to
the hashed bodies above. A later review should replace this status with exact case IDs and observed outcomes rather
than treating this discovery document as evidence of execution.

| Coupled surface | Concrete witness and difference it detects |
|---|---|
| Candidate and goal lifecycle (`strategy.ts:245–351`, `844–850`) | Capture every ordered candidate, not only selected goal. Enabled module offers duplicate goal keys with equal then greater utility: equal retains first value; greater replaces value in original Map insertion slot. Module utility clamps at zero only and may exceed 1.3; built-in `scored` caps at 1.3. Fail/done exclude, Blocked keeps candidate, Done Flee renews. Loot fail and strictly `>8000ms` budget impose 30-second skip. Exact expiry reopens options. Dead/nonalive returns Idle before sync/route/hunter/RNG/callback work and clears candidates while retaining prior internal state. |
| Selection and stochastic state (`strategy.ts:301–323`, `522–534`, `random.ts`) | Current Fight inside reconsider window suppresses pickOption draws; at expiry it reweighs, and real hurt Flee interrupts. Softmax/lapse still runs before hysteresis restores a current goal on gain `<0.1`; equality is allowed to switch if picked. Appraisal refresh at `until<=now` consumes two decide uniforms, discards the spare, then caches the normal draw per foe. One candidate performs no pick draws. Record distinct decide/lapse streams and enough subsequent calls to detect drift. |
| Pursuit and remembered enemies (`strategy.ts:357–389`, `496–519`, `854–901`) | Start Hunt with at least two wanted foes so last-one-standing fallback cannot hide avoidance. Exactly40u improvement does not reset progress, 41u does; timeout is strictly greater than jittered limit. Attack or visible distance<150 resets; hit event timestamp>=avoidSince, close target or expiry releases avoidance. Take a detour to reset chase, then resume. Current dead row suppresses stale living memory. Remembered age5000 no longer contests hunts through HuntAdapter, but strategy may Hunt through12000 then offer lastSeen; whereabouts expiry finally removes it. |
| Real Memory inputs used downstream (`memory.ts:407–559`, `804–918`) | First observe ordinary fighters, then real reciprocal Hit/Block events create third-party engagement; partner Death removes cue. Announce bounties so strategy uses max(current,remembered), including positive→zero/death deletion; bounty-only never-seen record still has no whereabouts. Execute noteSent Move/Stop/Target/Pickup/Cast, reflection/failure/arrival and recordChoice; verify opener/second keys and omission when kept. Explicit undefined versus null container weapon must change loot eligibility. Observe Wish castLand, chasing, plan/chest, teleport/dead filter and visible/minimap-only mob histories to replace remaining synthetic-only API claims. |
| Loot and safe alternatives (`strategy.ts:578–649`) | Free-slot unknown contents versus explicit null, duplicate carried weapon and full-slot counter replacement; learned second choice and recorded opener suppression. Enemy near self and enemy nearer container are distinct blockers; remembered enemy may block nearest-container while only visible foes determine self danger. Ground stale expiry, skipped state, closed/body/chest/early predicates and failed/budgeted detour must affect subsequent candidates, not only diagnostic flags. |
| Hunter state and Adapter coupling (`huntAdapter.ts:98–200`, `mobHunt.ts:156–477`) | Acquire a real target before 240/>240 and capped long-gap Adapter steps, with `lastAt>0`; use a target that takes no damage so catch-up materially advances drop/focus timers. Release by choosing nonfarm must call real hunter with playerDistance0 and preserve normal lock/unlock behavior. First home seed, off-home hurt/heal, returning exclusion, death/gone and awakeNear expose tracker differences. Low HP while on sleeping target disengages and bans without retreat count; awake target retreats through minimum then maximum and remains banned. Player-lock priority and release, damage reset, stall/approach/whole-target/focus/kill budgets and exact repick reopening should be visible in retained target/stats and later decisions. |
| Build routes and camp integration (`buildRoute.ts:140–259`, `strategy.ts:650–733`) | Initial route then away living-count loss, nearby other player or stolen heading triggers contest and immediate replan; two planned camps in one zone trigger longer zone avoidance. Unplanned remote kill and unchanged sticky state1 do not contest. Expiry makes camps eligible again. Direct identical-score reversed camp input must still choose lower index. Include respawn waiting and elite readiness, then coupled strategy extras/maps to show actual route changes and choice/candidate order. A planned camp beyond nearest horizon remains offered; only first four eligible camp walks use path callbacks. |
| Coliseum and full goal behavior (`strategy.ts:735–841`) | Teleport stored through real Memory controls hold patience decay; keep safe existing hold point or choose a better inner spawn when threatened. Alive2 removes ring-hold option. Sudden-death onset bypasses normal appraisal/hold and hunts weaker/near targets. Patience dash requires positive remaining time<=20000 and unlocked gates, and stops after arrival. Include ordinary centre/patrol/lie-low/wait, Module and not-alive Idle so the complete union is actually serialized and consumed; not every goal needs to win every combination. |

## Concrete public source vectors supplied to author

These are designs read from current unit-test setup, **not executed receipts**. They can be reproduced through actual
public class APIs without fake Memory. In each direct RouteInput, use now100000/runMs60000/self(0,0)/speed160/power0/
mobKills0, r96/spots4/alive4/state0 camps and true canFarm unless overridden.

- `new BuildRoute(BUILD_GOALS.fire[0])`, camps c0 at500/type flameCaller, c1 at800/emberImp, c2 at1100/pardoner:
  actual source test expects route `[1,2,0]`.
- c0 at600/pardoner and c1 at1500/emberImp: real update first chooses0, then at+500 c0 alive3/state1 chooses1 and
  records contest0. `isContested(0,100500+CONTEST_MS)` is false. Nearby player at(620,40) is the independent contest form.
- c0 at600/pardoner and c1 at900/pardoner in Fire, c2 at2000/bailiff in Sentenced: real initial plan then players at600
  and900 contests both Fire camps and leaves route `[2]`; source test retains `[2]` after30001ms and reopens Fire after90000ms.
- Coupled strategy setup: real createMemory.observe at now300000 with cautious hp30/max100 and ordinary visible rival
  200u away supplies hurt Flee. An engaged self locked to a visible rival120u away supplies Fight/tunnel attention.
  Ordinary favorable regional mob with no nearby player supplies Farm; minimap-first history records source home before
  it walks off-home. Source-owned tiers/personas and argument-sensitive services should be preferred over installing
  expected Memory records or hunter answers.

## Callback contracts and sentinel traps

One chronological transcript should record the method, ordered arguments and result for callbacks actually used; an
argument-sensitive descriptor is preferable to a constant answer or unchecked tape. Services are declared component
inputs unless the fixture actually runs their production implementation. Native callbacks must validate argument/order
before returning the corresponding response. Runtime-specific object identity is not a native contract; record the
semantic fields consumed by each callback and avoid accidental extra reads.

| Boundary | Required semantic distinction |
|---|---|
| `paths.walk(from,to)` | HuntAdapter copies self x/y and reads only result.dist; camps passes self/camp and reads result.dist; result null is a real blocked path. Preserve declared `exact` metadata even though strategy does not branch on it. Easy uses straight-line×1.3 and never calls the path service for hunt walks. No path/los/clear/collisionMap callback is called by these four source modules. |
| `know.odds(me,snap)` | Exact self/opponent snapshot fields and order; normal appraisal reads `.score`, coliseum reads `.edge`; these must not be collapsed. Prefer unchanged real Knowledge with its own source-seeded stream, or an explicit argument-sensitive declared substitute. |
| `know.mobShare(me,region,elite)` / `know.weaponEdge(a,b)` | Argument order, elite flag and repeated calls matter; mob pick itself uses shared true matchupShare, while route/camp filters use bot Knowledge. A stub that uses one for both hides real differences. |
| `learned.bias(choice)` | Called only when a built-in scored choice exists and learned.enabled. Nonfinite→0 then clamp±LEARN.cap before weighting. Module-offered choices bypass scored and learned bias. Disabled or no-choice makes no bias call. |
| module `.enabled(features)` / optional `.goals(ctx)` | Source module array order, no goals call for disabled module and absent goals→empty. Capture source-returned decisions with their original data key order, optional choice and utility; no invented upper cap. Module state/goal serialization uses JSON.stringify ordering in goal keys. |
| `opts.attacking()` / log | Getter presence overrides fallback lock&&engaged; it is queried from more than one place, so record actual call count/order rather than assume once per think. Log callbacks observe chase/drop/retreat reasons but are not decision outputs or inputs. |
| RNGs | Gaussian always consumes two uniforms and discards the spare; appraisal cache holds its result. pickOption may use one/two lapse draws or a decide draw depending on count/lapse/T. Motor RNG is not used by this closure; accidental consumption should be observable. |

Corrected packet wording: Memory.whereabouts returns the unchanged last position, **not velocity extrapolation**;
uncertainty radius grows `0.6*PLAYER_SPEED*age/1000`, and expiry is strictly age>memorySpanMs. Known announced-but-never-seen
fighters have no whereabouts. Keep -Infinity/Infinity/signed zero/Undefined/Null through strict explicit encoding where
used; JSON.stringify alone would silently erase distinctions. Source unitHash iterates UTF-16 code units with wrapping
32-bit math, so one non-ASCII ID pair usefully checks the whole implementation rather than testing every Unicode form.

**Snapshot ownership:** encode/deep-copy results at each call immediately. Memory.view contains live Map/record/array
references; Strategy.state contains mutable chase and candidate references; route and Hunter/Tracker records also
change. Collecting live references and serializing only at the end would replace historical results with later state.
Source diagnostics may inspect read-only private bot state; they must never mutate it or read hidden World state.
MobTracker.observe iterates inputs again for removal; supply arrays/reiterable Maps, not a one-shot generator.

## Pending admission review

When Phase A seals, review the exact tool/source hashes, canonical payload and ledger, strict tagged codec, chronological
snapshot copies, real API/dependency calls, argument-sensitive callback behavior and finite semantic controls. Bind the
final decision to that immutable seal and actual runtime receipts. Unreachable post-wait-fallback `live.length===0`
need not be manufactured as a coverage case. V8 block coverage, if used, is discovery assistance; branch counts alone
do not establish semantics and do not require redundant recaptures. No capture execution, reproduction, mutation
outcome or source-admission result is claimed by this upfront review.

## Exploratory95-case harness review

**Still pending freeze/admission.** Read-only review now covers the actual new tools and exploratory source payload:
95 cases/636 operations,12,564,039 bytes, SHA-256
`59e6ca12d2fedc54994f0bd53b17fae5a2ecb9960b193f5a1f76cee8b1da3f46`. Source author is still adding semantic controls
and correcting the reach findings below. Tool provenance is intentionally moving and no final seal, manifest or
independent source reproduction has been reviewed. Reviewer ran no source capture and consulted no native strategy
implementation/output to choose source expectations.

This finite payload contains11 Memory API,33 Strategy,9 HuntAdapter,1 Tracker,24 Hunter and17 BuildRoute cases. Actual
runner construction calls unchanged source createMemory/createKnowledge/createStrategy/createHuntAdapter and real
MobTracker/MobHunter/BuildRoute classes. Memory observations/notes/choices feed the real live view through a read-only
whereabouts logging Proxy; no installed Memory Maps, fake hunter answer or replacement strategy candidate producer was
found. External path/learned/module/attacking services are declared method inputs, correctly separate from World/Brain
claims. Geometry-sensitive paths, key-sensitive learned bias, source Knowledge and ordered callback/RNG logs are useful
evidence. Every row immediately encodes inputs/results/Memory/own state, avoiding mutable-reference snapshot corruption.

### Material witness findings sent to author and coordinator

1. **Coupled third-party cue was never earned.** `strategy-appraisal-third-party-aged-memory` sends Hit(rival←third)
   then Block(rival←third), not a reciprocal trade. Memory.trade requires the reverse edge within TRADE_MS. Read-only
   decoded payload confirms rival.engagedWith is null at every observation in that case; its later partner death cannot
   remove a cue never created. The Memory-only case has a genuine reciprocal pair but no Strategy calls. Author accepted
   adding reciprocal events within the allowed interval, positive earned engagement/third-party candidate evidence and
   actual cue expiry/dead-partner removal in the coupled case. Existing source expectation bytes are exploratory and
   must be regenerated from unchanged source after this independently justified input repair.
2. **No-sequence walk reflection used an unintended sequence change.** After observed moveSeq5/fromx+76, Move at+600
   has no seq; observe+650/+700 default moveSeq to0. Source therefore reflects through changed seq before testing the
   intended distance8/8.001 alternative. Even fixing seq alone leaves pending.reflected as invisible closure state:
   Stop+750 replaces the Move before its400ms failure deadline. Requested a short history preserving seq and pending
   order through an observation at/after400ms so exact8 versus>8 changes an actual OrderFailed outcome. This checks a
   real behavior difference rather than requiring private closure inspection or many redundant threshold cases.
3. **Intentional lock loss lacked the active transition.** The purpose-drop label in
   `memory-lock-hp-credit-and-teleport` occurs after the original lock vanished and its give-up interval elapsed; Stop
   at+1600 sees no subsequent active→null lock transition. Requested real observed lock→noteSent Move/Stop→observed
   null lock and no lockLost/targetDown, contrasted with nonintentional loss. Keep it a declared actual-source method
   witness, not a claim of earned World movement.
4. **Reader claim exceeded implemented validation.** codec decode enforces closed tags and duplicate Map/object keys,
   but verify.validate checks only a partial envelope. Missing Hunt target passes checkGoal(kind), and tagged NaN/Infinity
   passes observe.now's typeof-number check; command payloads/method-suite compatibility are not fully validated. This
   does not invalidate a correctly captured payload. Author should either narrow the generic entire-record/strict-schema
   claim to its finite tagged-codec/envelope boundary, or add focused consumed-shape checks. The future Rust consumer
   must validate every field it actually consumes before mutating state; no public generic intake guarantee follows.

### Native consumption and diagnostic limits to retain

- For a declaration current=`$previous`, captured row.input.current is the previous **source** decision, useful as an
  expected transition guard. Native replay must follow the declaration using its own previous native decision, then
  compare against that guard. Feeding captured current directly would install an oracle-derived goal and hide a prior
  transition error. All observe inputs and external declared callbacks remain independent recorded input data.
- Supplied RNG override values currently do not advance the underlying Mulberry stream; after override exhaustion,
  fallback starts at the generator's first unused raw draw. Document this explicit declared callback behavior. Separate
  source-seeded Knowledge consumes its own seed+3 stream; decide/motor/lapse seed,+1,+2 are declared component streams,
  not createBrain derivation parity. Count and compare actual ordered draws, including setup Knowledge draws.
- Strategy own properties expose substantial state, but HuntAdapter homed/lastAt are lexical closure state absent from
  encode(object). Existing home/catch-up/release continuation cases can bind their behavior. Do not call the diagnostics
  an exhaustive snapshot of every closure variable; full native implementation still must preserve that source state.
- Covers labels are intentions. Eleven source reach assertions bind selected substantive behaviors; selected semantic
  mutations and their exact outcome paths are still being prepared. Do not promote all labels or V8 block counts to
  independently closed branch proofs. The captured all-nine chosen goals is useful finite coverage, not full live Brain.

Inspected tool-body anchors (before author's forthcoming case corrections): runner.mts SHA-256
`5bfbd9df4a30a8de79363c3f501d9d9d02f016fbb15fa493245d737984d51a8e`; memory-cases.mts
`484318081f09f024df2ae96ed521f2297c7976758123ecab80cf800f20d5ce34`; strategy-cases.mts
`17eafc7b446527a3451b0355f87d12464e5a41f83dabbf38f16014fc77ba7c5b`; dependency-cases.mts
`302c569153d4ee8837d6b7fa906e602b447151d1a89559048552715ae6b5c313`. These are exploratory review anchors, not a
substitute for the final complete immutable provenance manifest. Release/reproduction review waits for that seal.

## Corrected98-case source candidate review

**Bounded static/source-evidence review passes; final release waits for immutable seal and independent fresh-checkout
reproduction.** This candidate corrects the material exploratory reach/codec findings above. No new blocking oracle
defect was found in the98-case component witness. It still does not establish general Module.data numeric JSON key
semantics, full private implementation parity, World/Brain/live publication or all source branches.

Independently verified all17 files in `docs/evidence/bot-private-strategy-source/FROZEN_MANIFEST.json`, and the payload's
82 actual runtime TypeScript import pins,113 conservative source-tree pins, config and tool-file pins against local
source bytes. Runtime imports use Debugger.scriptParsed notifications including already parsed scripts; type-only
imports are honestly excluded. Read actual final command/cwd/exit receipts. No source capture or native code/test was
run or inspected by this review pass.

| Candidate artifact | Bytes | SHA-256 |
|---|---:|---|
| `parity/policy/bot-private-strategy/source.json` |12,263,237| `3a3ae0d498cc3933b5eee11c5be995f267f4a76530379ad7c73a934082125d8d` |
| `parity/policy/bot-private-strategy/coverage.json` |1,981,587| `a560ee78a81e9f851933aafda5d42fe566a0e72d346d74f51d15a1a1890d6e12` |
| `parity/policy/bot-private-strategy/controls.json` |8,143| `ad9b789f8c40c922ac221c6e5eef7a483037383d23b3b8624b6fea774fd4877b` |

### Corrections verified from actual payload and source

- Real reciprocal Hit/Block creates rival.engagedWith=third and a positive Strategy third-party candidate; exact age6000
  removes its cue, another reciprocal exchange renews it, and real partner Death removes it again. Decoded decision
  samples show true/true/true/false/true/false. The partner-death source mutation now changes the intended candidate cue.
- No-seq movement retains moveSeq5 through an actual400ms failure deadline: exact8 emits OrderFailed; a second real
  pending Move with8.001 displacement remains reflected at its deadline. A targeted `>8`→`>=8` control changes the
  actual failure output. This no longer relies on an unobserved closure flag or intervening Stop replacement.
- Added active observed lock→noteSent Stop→observed null lock yields no lockLost/targetDown. A later observed lock
  loss after the intentional-order window emits lockLost; its targeted intentional-drop mutation changes the output.
- Conditional module offers now consume current now/HP and actually switch from absent to present after the declared
  time/HP conditions. Module callback logs retain semantic now/self.id/self.hp projection; the source identity assertion
  remains. Raw structuredClone snapshots are encoded once, so decoded callback args are real arrays/objects rather than
  doubly tagged MethodValues. The earlier assertion failure revealing double encoding is retained as a failed log.
- Decoder remains closed for tags/Map/object keys and now rejects unsupported envelope/Goal fields, missing selected
  Goal fields, nonfinite observe.now and selected event/faction enums. Its README correctly limits this to tagged codec
  plus envelope/selected consumed fields, and explicitly requires full consumed-field/suite checks in the Rust reader.
  The final19 synthetic controls do not purport to validate arbitrary public Percepts/commands.
- README correctly specifies native-owned `$previous` goal replay, immediate immutable snapshots, component RNG
  seeds/override fallback, source Gaussian spare discard/appraisal cache and Adapter lexical-state diagnostic limits.
  The numeric tolerance table is a coordinator-approved path-whitelist contract, not a blanket comparator. Exact
  goal/identity/threshold/text/order/RNG behavior remains required even where a continuous math leaf has tolerance.

`capture-final.log` records one unchanged-source write and subsequent source/coverage byte-identical check,98 cases/
658 operations; each case additionally recreates a second real source instance. `verify-final.log` records all98/658
and19 reader controls, exit0. `controls-final.log` records19 semantic KILLs after successful child captures at intended
selectors: dedup, hysteresis, exclusion expiry, pursuit progress/hit release, loot budget, appraisal expiry/draw count,
module order, Adapter catch-up/release/home, Tracker rising, Hunter ban expiry, Route contest/tie/replan and the three
corrected Memory/third-party cases. Controls do not count compiler/import/runtime failure as a kill. Comment-only
NONKILL and restored exact case values cover three representative real cases; they are honestly a sample, not a whole
98-case restored-source receipt. Host source and canonical payload remain unchanged. coverage.json has16 reached
semantic assertions plus all nine chosen goals; labels and V8 block counts remain nonexhaustive discovery data.

### Bounded additional source gap: Module.data number serialization

Read-only traversal of every captured Module goal finds303 occurrences with numeric data leaves only1/2/3/4. The
admitted older `bot-brain-prefix` witness uses module data.slot0/1/2/3. Tags for -0/nonfinite elsewhere in the new corpus
(e.g. command angle/learned bias) **never reach Module.data** and do not exercise its goal key. Source strategy.ts
uses JSON.stringify(Module.data) for goal keys and JSON.stringify(goal) for kept-reference behavior; key equality
controls dedup, exclusions, goalSince and choice omission. Production current chest/Wish modules use string data,
but the source full private Goal.data contract is Readonly<Record<string,unknown>>, not integer-only data.

Thus general numeric module-key fidelity is unproved by this finite witness. Reported to Root and source author
without consulting native strategy code or outputs. A practical supplement is one small unchanged-source method
sequence with -0/0, nonfinite/null equivalence and small/large decimal/exponent boundaries (`1e-7`,`1e-6`,`1e20`,`1e21`),
recording actual currentKey/excluded keys/dedup/keeping in real Strategy calls. Test actual transition consequences,
not just a standalone stringify helper. No broad JSON fuzz or existing corpus rewrite is needed; Root decides an
additive frozen scope or a narrow recapture before author changes frozen tools. Until then retain this explicit gap
and do not claim complete module numeric-key parity from98 cases. The current source witness remains valid and useful
for its actual frozen method inputs.

No final source admission or independent reproduction is claimed in this subsection. Root will bind the review to the
immutable source commit and fresh-checkout exact-byte result before releasing native corpus comparison/admission.

## Final independent reproduction and bounded source release

**RELEASE** immutable source seal `5ec31212b0082d650cbe15d58877e82ac2793060` for native corpus consumption. On
coordinator authorization, reviewer executed the existing frozen check in a separate fresh clean checkout:

- Worktree `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-strategy-source-review`, branch
  `codex/strategy-source-review`, exact HEAD `5ec31212b0082d650cbe15d58877e82ac2793060`.
- `bash tools/bot-private-strategy-fixtures/capture.sh --check`: exit0,28.31s. Pinned Docker Node22.23.4/Linuxamd64,
  read-only source/tool/canonical-output mounts and temporary container-local dependencies. Reproduced all98 cases/
  658 operations with source SHA-256 `3a3ae0d498cc3933b5eee11c5be995f267f4a76530379ad7c73a934082125d8d` and coverage
  SHA-256 `a560ee78a81e9f851933aafda5d42fe566a0e72d346d74f51d15a1a1890d6e12` exactly. All16 reached assertions
  execute as part of the unchanged source check; source methods and fresh-instance determinism are rerun by the tool.
- Ran documented `node tools/bot-private-strategy-fixtures/verify.mjs` inside the same digest-pinned Node image with
  a read-only worktree mount: exit0,98 cases/658 operations/19 finite reader controls. Its receipt explicitly observes
  Nodev22.23.4/platformlinux/archx64. No unpinned host Node execution supplies this reproduction proof.
- Before/after manifest SHA-256 is `8ca988c39466a8536a5e8aba6190619b1fbe7f4c862b0f2822f5093164445e24`;
  all17 pinned tool/corpus files are byte/hash-identical before and after, exact source HEAD retained, Git status clean
  before and after. No source, canonical output, Rust, Claude worktree or old corpus was edited. Containers exit through
  the existing `--rm` lifecycle; no cache cleanup or shared-process operation was performed.

Raw commands/cwd/HEAD/runtime/exit/output and before/after hashes are retained in
[fresh-reproduction/RESULT.json](fresh-reproduction/RESULT.json),
[capture-check.log](fresh-reproduction/capture-check.log), [verify.log](fresh-reproduction/verify.log),
[before.json](fresh-reproduction/before.json) and [after.json](fresh-reproduction/after.json). Full Docker command and
timestamps are in the corresponding JSON receipts. The existing19 semantic controls were reviewed from sealed source
and receipts; this independent run intentionally did not repeat the full mutation campaign.

This release is for the exact bounded98 source method witness and approved numeric contract. It authorizes faithful
native replay/comparison against those independent expected results, using native retained state and checked inputs.
It does not admit the separately authored native classes, fix their mismatches, prove general Module.data JSON numeric
key formatting, activate the live bot or close full Brain/headless/World parity. The small numeric-key supplement
identified above remains separate; do not mutate this primary seal or relabel its integer-only module-data coverage.
