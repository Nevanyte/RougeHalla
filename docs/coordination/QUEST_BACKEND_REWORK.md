# Quest backend preparation

Prepared against `optimization_port` at `4151b3af597cc06d1b3b77f4e3e21cc9906b6a86` (2026-11-10 UTC).
This is a bounded implementation plan, not a quest redesign or a completion claim. The owner wants remaining Rust
backend gameplay to continue while Claude owns Unity/networking. DeepSeek writes **all Rust, including tests**;
Sol/Luna prepare source evidence, packets, review and coordination. Root owns admission and shared status records.

## What exists

The quest backend already implements the twenty K1 definitions, private roster/placement, known/hidden offers,
acceptance, kill/collect/fetch progress, carrier death/drop/steal, automatic turn-in, expiry/linger and run-end/teleport
closure. `quests/live.rs` is 1,064 lines at this base. Its module header still describes an earlier data-only slice;
that comment does not describe current code. `quest_view/mod.rs` also has an outdated wire-gated introduction.

| Boundary | Current owner/source | Keep during this work |
|---|---|---|
| Definitions and content identity | `quests/catalog.rs`, `content.rs` entry `quests/1` | Twenty row IDs/order, tuning and content visitor order |
| Private selection and placement | `quests/roster.rs`, `quests/placement.rs`, `live::spawn` | Quest salt/stream draws, allocation order and spawn timing |
| Durable simulation state | `live::{Offer,Quests,Status}`, `World::quests` | Exact serde layout, enum order, vector insertion order and hash coverage |
| Lifecycle and effects | `quests/live.rs`, `giver.rs`, `notices.rs` | Existing scheduled entry points and hook positions |
| Reward calculations | `quests/rules.rs`, `live::{gv_quest,complete}` | GV quest cap and actual mob-stat grant; historical reward-card fields are not card payout |
| Observation and capabilities | `quest_view`, combined observer, input resolver | Entitlement before allocation; prepare/commit only after delivery; owner facts and handle scope |
| Persistence | Existing results/GV path | No new quest tables, saved quest progress, endpoint or result format |

The baseline identity is protocol14/checkpoint29/replay23/OBS21/policy15/content `7c6a633f68c2cc72`.
Claude's separate protocol15 work is outside this packet. Verify the actual integration base before execution; never
copy a newer Unity/networking branch wholesale to obtain quest changes.

## Repair before extraction: distinct regions are a set

There is a concrete source discrepancy in `live::close_impossible`. Its tour branch obtains `mask.count_ones()` and
then uses that **count** as if it were the visited-region bitmask. Legacy `killSupplyLeft` in
`packages/server/src/sim/quests.ts` uses `qt.tours.get(pid)?.has(zone)` for each supplied region.

A player who has earned one Frost visit has mask `0b01000` (FactionId order Fire/Sentenced/Plague/Frost/Holy).
The current branch substitutes `1` and incorrectly marks Fire visited instead:

| Remaining alive regions; tour needs two more | Source result | Current Rust predicate |
|---|---|---|
| Fire + Holy | Two fresh regions: offer remains possible | Fire treated as visited: prematurely expires |
| Frost + Sentenced | One fresh region: offer is impossible | Both treated as fresh: wrongly survives |

Both outcomes are now captured in source seal `c605f2fb`, with immutable bytechecks and semantic controls; see [source evidence](../evidence/quest-tour-supply/README.md). Native repair remains under development. The source witness must reach these
situations in an actual `createGameWorld` and ordinary 50ms `step`, with acceptance through the normal input queue,
a visit earned through the real kill path and camp recheck produced by real camp deaths. It must not install progress,
visits, `recheck`, status or expected expiry. A declared batch through the existing real `killMob` producer is acceptable
with its exact boundary labelled; it is not player-fought camp proof. Prefer an ordinary attack for the credited Frost
kill; any declared damage/HP/placement setup must be explicit. Account for every standing human: an unvisited player
with enough supply would correctly keep the offer open. Keep all other humans at zero progress so two remaining regions
cannot satisfy their three-region tour. Observe a later ordinary step, not a direct call to an extracted predicate.

The frozen batch uses empty explicit credit entries, but `killMob` still consumes prior mob threat. Case0 includes an additional credited Frost mob reward; the recorded GV/farm/notices are authoritative and must not be suppressed. Older “uncredited” capture prose is incorrect; source bytes remain frozen.

Do this as its own repair commit before extraction. Do not change an existing corpus to make the result pass.
The repair changes reachable gameplay/state trajectories; Root has approved an appended `tour-supply/visited-region-mask/1` semantics marker in the existing quest content
visitor (length and UTF8 bytes after the unchanged20-row fold), written by DeepSeek. This moves the rules hash while
leaving protocol14/checkpoint29/replay23/OBS21/policy15 shapes unchanged. Both checkpoint restore and replay execution
already refuse old content through typed ContentMismatch. Root admits the new hash/pins; Claude BakedContent is left
for normal joint integration, with no deployment implied.

## Minimal architecture

Keep the existing lifecycle shell and all serialized state. Add two internal modules with concrete, deterministic
functions. Avoid a plugin registry, virtual dispatch, scripting, generic event bus, dynamic content loader or new stored
objective representation. There is one current rule set to support.

`objectives.rs` owns the current objective interpretation and pure calculations. A small typed objective value lowered
from `&catalog::Def` represents Kill (human player, or mob filters with region/elite/distinct-region information), Collect
and Fetch. It is derived on demand and never serialized. The lowering preserves source precedence, including elite
filtering before tour progress. The module takes the current stored progress/visited mask, a typed credited event or
live-supply summary, and returns a value/change for the existing caller to apply. It does not receive a `World`, select
players, grant rewards, allocate IDs, inspect secrets or emit notices.

The useful operations are capped count advancement, credited mob/player matching, tour-mask advancement, objective
readiness and per-player remaining kill supply. Distinguish “no update” from “write zero” so absent rows and vector
insertion order remain identical. Fetch readiness is parcel ownership, not count; collect and kill use stored count.
Keep acceptance, human eligibility, standing/phase/published/open checks in the lifecycle adapter at their current
source positions. Keep the any-standing-human/no-standing-human aggregation in that adapter. Supply includes eligible
standing humans even before acceptance, exactly as source; it must not silently become an accepted-player-only test.

`rewards.rs` owns a small typed payout plan (GV, mob-stat type and stack count) derived from the existing `rules`
functions, and the narrow application of that plan through existing GV and `grant_mob_stat` paths. Retain the quest GV
cap/training behavior and event order. Completion still retires the offer exactly once, marks the winner and then pays
GV, farm grant/notice, owner completion, room completion. A second tick after completion cannot pay again.

Keep `rules.rs` as the source-compatible catalog/reward/wording API. The plan must not replace the catalog reward card
with a new card grant: the current actual reward is GV plus farm stacks. Do not change exact JS-compatible numeric
formatting. The new seam is a smaller place to replace the reward policy later, not permission to change it today.

`live.rs` remains the lifecycle adapter: spawn/publish, acceptance, pickup/container effects, actor retirement,
reveal/deadline/linger, tie rank, and scheduled/hook entry points. Its existing phase-local ordering remains explicit.
Do not perform a broad file split simply to reduce its line count. `giver.rs` remains the neutral actor adapter.

`quest_view` remains a separate entitled projection. It may later consume the objective readiness function, but this
packet leaves it untouched to avoid Claude's transport write scope. Its existing owner readiness/navigation tests
provide a cross-boundary behavioral check against lifecycle results. No objective policy receives observer handles,
and no projection receives unentitled hidden definitions or private quest stream state.

## Rework once the owner supplies a design

The architecture enables bounded later changes without guessing their contents now:

1. Change the catalog/objective lowering and evaluator when the new verbs/constraints are known. If new progress state
   is necessary, propose its stored form, restore validation, hash/replay and migration behavior together at that time.
2. Change the payout plan/calculation when actual rewards are decided. Reuse the existing authoritative grant path;
   persistent progression remains the results/persistence adapter's job.
3. Change lifecycle transitions only for specified trigger/deadline/competition semantics, preserving hooks/schedule
   unless an independently captured/approved rule change requires a deliberate departure.
4. Propose new public facts only when existing rows cannot express the design. Root and Claude then coordinate the
   versioned Rust/C#/JS union and client work. No private objective state becomes a capability automatically.

A multi-stage quest, branching dialogue, account quest journal, daily reset, party share, bot participation and reward
redesign are all decisions still to be supplied, not implicit deliverables.

## Existing evidence to preserve

| Source evidence | Native consumer / exact scope |
|---|---|
| `parity/quests/data.json` | `quests/tests.rs`: all20 catalog/reward/wording rows, three rosters, seed1/2 placements with map pins |
| `parity/quests/lifecycle.json` | `quests/lifecycle_tests.rs`: ten actual-source cases with labelled helpers; per-frame quest/private/giver/container/GV/farm comparisons |
| `parity/quest-giver/source.json` | `quests/giver_tests/source.rs`: all eight source giver cases, ordinary input/runtime; neutral actor and retirement surfaces |
| `parity/quest-public/doors.json` | `quests/notice_tests/source_public.rs`: fourteen actual action cases and ordered toasts/acceptance |
| `parity/quest-notices/source.json` | `quests/notices_source_tests.rs`: selected cases0/4 only, full retained Toast/Gv classes plus owner/foreign preview assertions |
| `parity/quest-presentation/source.json` | `quest_view/presentation_source_tests.rs`:20 definitions ×9 declared formatting contexts; not180 gameplay cases |
| `parity/quest-room-feedback/source.json` | Derived Room-method feedback over one existing giver batch; no new World or socket claim |
| `parity/quest-human-eligibility/{ordinary,diagnostic}.json` | Source eligibility evidence, with explicit normal-history/diagnostic boundaries; native bot controls also live in `quests/live_tests.rs` |

`quest_view/tests.rs` additionally protects lazy owner/roster identity, hidden-world equivalence, nonactionable finder
previews, commit/reconnect/rejection behavior, navigation without pickup authority, duplicate labels and retained owner
history. These are material requirements for a quest redesign even though their code is outside this packet.

The six-case quest notice capture is not equality of the whole181-record native stream; source-only/method/diagnostic
limits remain explicit. This work does not close that remainder or establish a browser/public quest flow.

## Ordered delivery

Use [P-QUEST-BACKEND-1](../backlog/packets/P-QUEST-BACKEND-1.md). Stage0 is the source-derived tour-supply repair;
Stage1 extracts objectives/rewards while preserving the repaired behavior. Keep the source-capture receipt,
regression-before-fix, fix and extraction results separable. Root admits/merges; only Root updates MIGRATION,
CONTRACTS and Cargo.lock. This preparation has not run gameplay tests or changed Rust.
