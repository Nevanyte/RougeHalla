# Reached behavior and finite limits

Rows below name actual chronological cases in `parity/policy/bot-private-tactics/source.json`. Operation indices are zero
based in the ordered `operations` array; an “act N” is the Nth act, starting at zero. `coverage.json` retains actual V8
function/block counts and transformed code per case, including two independent recreations. Coalesced V8 ranges are not
counted as universal branch coverage. `reachedAssertions` contains executable checks over the resulting source transcript;
semantic mutation receipts separately distinguish the risk branches. All contexts contain real Memory histories.

| Source behavior | Concrete source witness and observable distinction |
|---|---|
| All nine Goal kinds and all four status states | `dispatch-nine-and-knowledge-once`: idle, module, fight, hunt, farm, loot, roam, hold, flee in one retained createTactics; module failed, first flee blocked, ordinary running, until done. Separate guard/dead/path/refusal cases cover normal failed/done reasons. |
| Sudden-death knowledge drawn once before dispatch | Dispatch acts0/1 drawCounts.decide both1; `knowledge-first-module` first module also draws once. Independent Knowledge setup stream stays separate. |
| Shared ownership, leave and recreate | `world-fight-shared-dodge-hold`, `fight-world-shared-juke-hold`, `engagement-leave-gap-and-distinct-mobs`, `tactics-real-orb-cycle`, `flee-retention-reset-until`; same real createTactics closure across goals. Every case's complete history is reproduced using fresh real objects/seeds. |
| Current fighter before mob, then real Memory fighter/mob | `lookup-fighter-before-mob-and-memory` uses equal string identities and distinguishes current down fighter from live mob, then remembered fighter precedence; `fight-visible-memory-expiry`, `fight-mob-remembered-returning`, `lookup-remembered-dead-mob` distinguish visible/remembered/lost/down. Memory.whereabouts args/results are actual callbacks. |
| Self status/faction and fists/empty hand | `fight-guard-deadSelf`, `fight-guard-noFaction`, `fight-guard-otherHand`, `fight-guard-fists`, `empty-hand-second-slot`; guards occur before engagement draws. |
| Mob coliseum/gate rejection | `mob-guard-inColiseum`, `mob-guard-gatesLocked` produce distinct exact source failure strings. |
| Engagement identity/gap, partial leave reset, distinct mob targets | `engagement-leave-gap-and-distinct-mobs`: idle→same mob, exact4000/above4000 gap, new mob then old mob. Exact draws/cumulative mobTargets distinguish resets and lifetime dedup. |
| Camp-mate radius, camp and viability | `mate-near`, `mate-radius-at`, `mate-radius-above`; `mate-same-camp-far-real-history` and `mate-different-camp-far-history` derive actual campId from seeded-map homes via observe. `mate-dead`, `mate-nonregional`, `mate-elite`, `mate-both-elite`, `mate-ranged`, `mate-both-ranged`, `mate-counter`, `mate-player-lock-is-not-mate`; returning state comes from genuine off-home healing in `mate-returning-history`. Retained wand status/attacking versus re-lock of goal distinguishes actual substitution. |
| Player versus mob swap policy | `swap-player-cooldown`, `swap-mob`, `swap-unknown-knowledge`, `swap-unknown`, `swap-far`, `swap-at`, `swap-windup`; real Knowledge.weaponEdge args/results and separate seeded Knowledge draws recorded. |
| Exact swap clocks/no-draw branches | `swap-exact-seeded-cooldown` declares below/at the source formula's seeded cooldown; pure unchanged mulberry32 construction computes the boundary before execution, with no capture/native output as input. `swap-windup-boundary--0.001`, `-0`, `-0.001` are named by actual decimal delta (see case IDs); all exact binary64 clocks remain in declarations. No jitter draw on blocked cooldown/windup/unknown/far/unchanged choice. |
| Source reach mask versus sight | `reach-mask-sword` false versus `reach-mask-bow`/`reach-mask-wand` true across an actual low collision tile. Actual inReach, reachMask and hasLineOfSight run. |
| Attacking uses the substituted mate | `mate-near`, same-camp and both-ranged expose attackingtrue with no lock intent, while excluded mates cause goal re-lock and attackingfalse for wand. |
| Real Reflex preempts before bounty/SD, retaining swap and shared hold | `world-fight-shared-dodge-hold`, `fight-world-shared-juke-hold`, `fight-reflex-preserves-swap`, `world-reflex-preserves-pickup`. Counter and ordered intents show real dodge/juke; fight hold emits no ordinary order; world hold preserves pickup/status. |
| Bounty opening and engagement/lock exceptions | `bounty-opening`, `bounty-at70`, `bounty-engaged`, `bounty-locked` capture below/exact70%, ordinary engagement and existing lock branches. |
| Sudden-death lead hysteresis, hold and corner fallback | `sudden-death-hysteresis` passes through standing-off, retained retreat, negative-band continuation, released hold, renewed lead; `sudden-death-corner-fights` falls through when real Retreat's clear walks fail. Exact arithmetic source branch outcomes bind; hp shares are never rounded to make a threshold. |
| Progress distance/HP/attacking and timeout | `fight-progress-thresholds`, `fight-progress-hp-and-attacking-touch`, `fight-progress-timeout`; continuous<=4000 engagement touches isolate the strict10000 timeout. Exact40 movement versus movement above40, HP change and attacking refresh are declared. The first threshold trajectory also demonstrates that a later>4000 gap really resets the engagement; it is not claimed as the isolated timeout case. |
| Orb chase gates | `tactics-real-orb-cycle`, `orb-chaser-closing`, `orb-chaser-at-range`, `orb-chaser-above-range`, `orb-chaser-close-below`, `orb-chaser-close-at`, `orb-chaser-ranged`; real current velocity/weapon/distance and Memory are used. Remembered foes use ordinary approach rather than inventing seen availability. |
| Wand lock and targetability | `lock-wand-open`, `lock-wand-locked`, `lock-untargetable`; exact statuses/attacking and ordered lock intents. |
| Cached plans, drift, no path, waypoint/move resend | `fight-plan-three-failures` has path calls at0/400/800 with no path call at399/799; third failure produces exact failure. `fight-empty-path` treats empty planned route as no path. `fight-plan-drift-resend` has actual source routes, waypoint clear callbacks, drift96, retained/sent moves and still/elapsed resend. All callbacks include full arguments and actual results. |
| Explicit/implicit flee threats and first/repeated status | `flee-retention-reset-until` preserves explicit multi-threat retained destination and lowHp stimulus; `flee-visible-awake-mobs` derives awake from genuine off-home mob history; visible alive fighters are used when from is empty. |
| Flee reset/expiry and no invented reflex check | Non-flee idle followed by flee increments retreat count only once again; exact until ends flight and resets; flee cases show no Reflex call introduced by harness. |
| Corner fallback, nearest/tie/filter and exact running why | `flee-corner-empty`, `-player`, `-regional`, `-tie-player-first`, `-dummy`; argument-sensitive denial causes real Retreat to try headings and fail. Same real Fight executes the stable nearest player/regional choice, with source “cornered: fighting on” substitution only on running. |
| Multi-threat Retreat retention/replan/reset/arrival | `retreat-retain-boundaries`, `retreat-threat-invalidates-arrival`; actual destinations and zero-versus32 clear callbacks distinguish retention even where recalculation gives the same destination. Reset, elapsed1200, arrival48 and a new threat at the old destination are declared. Empty threats can retain a still-safe destination in the source; no invented full reset is applied. |
| Loot carried-at-start, final latch | `loot-pickedup-and-latched` succeeds on increased carried count then retains source done despite disappearing container; `loot-settle-retry-event-once-final` retains refusal despite later increased inventory until stale state expires. |
| Loot still150, retry400, stop resend and events once | `loot-settle-retry-event-once-final`: settling/stop, no pickup149, pickup150, silence399 since pickup, pickup400, repeated same percept not double-counted, second independent far refusal, final latch, stale reset. `world-idle-stop-stale` separately distinguishes stop resend at800. |
| Toast normalization/timestamps/refusal/gone | `loot-toast-gone-old-timestamps`, `loot-settle-retry-event-once-final`: old toast before pickup ignored; trailing period/whitespace/case, both far phrases and gone phrases handled by source functions. |
| Seen/real remembered container, skipped/emptied/gone | `loot-path-and-remembered`, `loot-memory-skipped` (real noteSent with containerId and toast), `loot-unseen-emptied`, `loot-empty`, `loot-nullweapon`, `loot-gone`. No expected memory installed. |
| Undefined/Null/missing distinctions | `loot-undefined-weapon` does not interpret Undefined as Null/emptied; `fight-undefined-windup-mult` versus `fight-missing-windup-mult` preserves explicit Undefined versus absent optional data and source defaulting. |
| Loot budget and stale slots | `loot-budget-continuous`: running at6000 then failed above6000 with intermediate calls preventing stale eviction. `loot-budget-boundary` deliberately demonstrates that an uncalled slot is recreated after a6000 gap, so that trajectory is not mislabeled as budget expiry. |
| Loot safety | `loot-enemy`, `loot-enemy-at`, `loot-awake-mob-safety`, `loot-mob-sleeping`, `-unknown-moving`, `-unknown-at20`, `-dead`; actual remembered awake versus source velocity fallback is distinguished. |
| Loot path/LOS/walk/waypoints/fallback | `loot-real-detour` returns an actual waypoint; `loot-budgeted-path-fallback` calls real path null then real walk guessed/exactfalse; `loot-path-null` fails; `loot-waypoint-boundary-150`/`-150.001` distinguishes path bypass. `loot-path-empty` is a separately labeled declared-service boundary throw, not normal RoomPathService behavior. |
| Roam arrive/settle/walk | `world-arrive-48-0`, `-48.001-0`, `-150-1200`, `-150.001-1200`; `roam-real-unreachable`; ordinary roam in dispatch/shared-hold cases. |
| Noncoliseum holds and idle stop once | `hold-ambush`, `hold-wait`, `world-idle-stop-stale`; no fake location move is introduced. |
| Coliseum crowd/persona/seeded24 selection/collision/inside/fallback | `hold-crowded-spot-stale` has26 draws then retained26 then51 after stale; `hold-generated-coliseum-inside` uses real generated region/collision map; `hold-spot-direct-fallback` distinguishes all candidates blocked→centre and no-other-fighters Infinity score; `hold-spot-generated-outside-fallback` exercises outside-region fallback candidates. |
| Hold arrival/settle/stop/key/stale | `world-arrive-24-0`, `-24.001-0`, `-120-800`, `-120.001-800`, `-100-799`; `hold-real-unreachable`; `hold-key-rounded-and-stale-boundary` proves rounded16 keys and strictly>3000 eviction. `world-idle-stop-stale` demonstrates roam does not call slot/prune. |
| World before Reflex; channel arbitration/status preservation | `world-reflex-preserves-pickup` emits [pickup,reflex move], later only pickup during hold; shared dodge/juke cases remove only order and preserve exact running world status if no newly chosen reflex. |
| Orb Infinity, shot share, launch, draw, retained count, reset, re-lock | Direct `orb-launch-reset-and-timeouts`, `orb-bow-draw-and-shot-share`, `orb-away-boundary-*`, `orb-cornered-no-faction-late`; integrated `tactics-real-orb-cycle`. Exact below/at/above900 and3000, new-shot share, draw clear, failed headings, timed due and reset-with-cycles retained are chronological calls. |
| Reflex geometry, identity and remembered yes/no | `reflex-course-*`, `reflex-extra-negative-offset`, `-second-heading`, `-blocked`, `-chance-no`; `reflex-decisions-eviction` revisits first key after48-entry eviction; `reflex-shot-key-collision` uses the same projectile and shot string key; repeated check does not redraw. |
| Real feints, shots, aim/time/priority/hold | `reflex-real-feint-history` derives feints1 from actual observe windup/cancel; `reflex-extra-wand-event`, `-mob-wand-event`, `-juke-late`, `-juke-too-early`, `-juke-aim-away`, `-juke-chance-no`; `reflex-dodge-outranks-juke`; world↔fight transitions prove shared hold/counters. |
| RNG/callback order and no downstream scheduling | Every row records actual decide/motor/lapse/Knowledge draw index/value, full callback args/results, returned intents/stats/Memory at that instant. Motor/lapse remain0. No Humanizer delay/scatter/click stamping/submit is executed or implied. |

## Control evidence and open gates

The initial semantic suite had15 KILL and one SURVIVED (`hold-spot-cache`): the second scene was no longer crowded, so the
mutated guard was never exercised. Its complete raw source/mutant selector and child receipts remain in
`controls-attempt-1.log`. The subsequent trajectory stays crowded; the final control receipt must independently reach
that guard. It does not erase or relabel the original survivor. The final added initial-Infinity control requires a valid already-launched positive readyAt on the first Orb step; a zero-initialized mutant must move while real source remains quiet. Other controls cover actual mate retention/returning,
swap+draw cooldown, shared preemption/hold, Orb launch/reset, retreat/flee retention/reset/corner and loot event-once/
retry/fail/final, plus stale slots. Comment-only and restored histories compare complete cases, not selected status only.

This is a finite risk suite, not an exhaustive weapon/faction/tier/geometry Cartesian product or proof that every possible
path through a closure is covered. V8 ranges and exact source bodies remain available to the independent reviewer; any
unproved path stays unproved. No memory/strategy prerequisite or implementation was repaired here. Existing admitted
Fight/Orb/Reflex/bot-core source corpora are pinned in the new manifest for later compatibility overlap; they are not
rerun or counted as extra new cases. The new private Rust implementation must replay those unchanged overlaps separately.

Independent fresh-worktree pinned reproduction, review of this source candidate and numeric path whitelist, Root's
empty-path native error contract, strategy admission, native implementation/comparison/regressions and integration are
open. Whole Brain/modules/hand feedback, earned fair fact publication, policy-seat validation/submission and live bot
activation remain separate later gates. No private map/Memory/RNG telemetry is sent to any public UI.

## Explicit unisolated paths for review

The following source paths are present in the real unchanged methods but are not independently isolated by a newly named
unified trajectory here. They are coverage gaps, not permission for a native stub or simplified fallback:

- Fight's `isMeleeChaser` last disjunct based solely on previously remembered `chasingMe` while current closing speed and
  close-distance tests are both false. New cases isolate current close/velocity/range/weapon gates; real Memory is still
  supplied in every case, but that last disjunct has no distinguishing new selector.
- A remembered goal mob combined with a visible locked camp mate, specifically the `goalKind` fallback from real Memory.
  New cases independently prove remembered mobs, actual same/different camp histories, current mates and returning
  exclusion; this particular cross-product is not called proved.
- Every fine course/aim edge and unknown-faction bow fallback inside Reflex. The real component runs, and existing
  separately pinned admitted Reflex witnesses remain an overlap dependency; the new suite does not multiply all those
  leaf vectors across every world/combat transition. Likewise it does not claim a full raw schema for every unexercised
  optional Percept extras/event payload beyond the declared finite source profile.
- World nextStep's last-waypoint fallback when a non-null nonempty test-service route has no waypoint farther than twice
  the body radius, despite a distant requested container. New real-service detour/null/budget-fallback and explicit empty
  route boundary are proved separately; that additional alternate-service shape has no distinguishing new case.

Root requested freezing after the two concrete Orb-Infinity/Retreat48 history repairs and required controls/fresh check.
These additional trajectories remain explicit reviewer follow-ups; this author candidate makes no blanket full-branch
admission claim. The native task still implements the entire source closure and later replay/review can require a scoped
source supplement without changing these expected outputs or tuning to native results.
