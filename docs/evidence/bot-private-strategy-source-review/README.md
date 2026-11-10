# Private strategy source witness — independent discovery and review ledger

**Discovery complete; corpus admission pending.** This is an upfront source review for P-BOT-STRATEGY-1, not an approval
of an unproduced capture or a claim that the full strategy is implemented. Sol source author `quest_architect` owns the
new tooling, corpus and source evidence. Reviewer owns only this ledger plus the coordinator-authorized two precise
contract wording corrections in the packet. No tooling, corpus, Rust, shared-status or existing capture was changed or run.

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
