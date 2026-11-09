# WalkHint a4ece first capture: all24 diagnosis and bounded recipe proposal

Verdict: **FAILED capture retained; one justified declared-clock recipe correction proposed. No canonical/source admission.** No source/worktree/run mutation, build, JS scenario import, capture, container start/exec or retry was performed in this review. Only retained JSON/source and host-side binary64 arithmetic were inspected.

Exact code a4ece57e4f7e5c233e6c80a8663f43ca99be74b7. Phase B executed once by Root, 2026-11-09 16:22:09.519577–16:22:10.226633 UTC, exit1, Node v22.23.4/linux/x64; command hash9e75a40e…94a00a. Receipt `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/coordination/reports/walkhint-a4ece-phase-b-first.json` SHA256 `7c7ac83233468e97532b959e8aa48e7fedacc6e29b19bbdb9e811aff130024c6`. The only capture artifact is `/Users/nevinmckinnon/Documents/Projects/RogueHalla-bot-own-timings/docs/evidence/walk-hint-helper-boundaries/offline-790-corrected-review-01/captured/observations-before-verification.json` (145577B), SHA256 `3ad4fa1e7040c524026f0aab2bd5a816fffbb1effc6421fad7e8fe7774db0daa`. Neither source.json nor verification.json exists. All24 rows were computed before semantic verification stopped at the setup error. Do not overwrite/reuse this run.

## All24 retained actual observations

| Contexts | Actual result | Classification |
|---|---|---|
| goal-below/equal/above (3) | ticks1/1/0 | Declared goal-distance isolation reached; no setup error. |
| repath-before/equal/fresh (3) | ticks1/0/0; actual elapsed249.99999999999977/250/+Infinity | Declared elapsed predicate reached. “fresh” is the explicitly tagged -Infinity plan timestamp, not proof of an ordinary newly acquired lock. |
| los-before (1) | setup Error “LOS clocks do not straddle expiry”, detail1500 | The setup assertion rejected a rounded-equal elapsed value before walkHintOf was called. No hint result, input snapshot, helper draw count or event array was recorded for this row. |
| los-equal (1) | now2100/tick42, future at2150, lostAt650, elapsed1500; visible=true, lockable=true, currentLOS=false; ticks0 | Exact expiration branch reached. This is a declared historical lock timestamp with real current visibility/memory prerequisites, not an earned loss-of-LOS chronology. |
| future-hidden-active/revealed (2) | isUntargetableAt=true/false at2050 | Actual status/reveal APIs reached; reveal begins at next tick. |
| future-untargetable-before/equal (2) | true at2049.9999999999995; false at2050 | Exact half-open expiry reached from actual addStatus instance. |
| amove-nearest-ordered/hidden-nearest (2) | hint ticks0 and actual updateTargets selects p2; observed candidate order p0,p1,p2 | Actual chooser/order/hidden eligibility reached, rather than inferred from a hint alone. |
| amove-hide-to-acquire (1) | before ticks1/selected null; removeStatuses removes1 hidden; after ticks0/selected p1 | Actual source status-removal/selection sequence reached. |
| waypoint-below/equal/above (3) | ticks2/3/3; all actual floating comparison isolation flags true | Actual source slack boundary reached with adjacent segment inputs; no tolerance. |
| direction-below/equal/above (3) | direct255/0/0; pathKernel255/255/255; hints dir255/ticks3 for all | Direct adjacent binary64 kernel transition witnessed. Cartesian endpoints and actual atan2 angle collapse to identical values; no path-direction transition witnessed. |
| tie-before/equal/after (3) | weaponHoldsAt=false/false/true | Actual strict at+1e-6<landsAt endpoint reached with adjacent landsAt values. |

Every successful row has helper-sample draws0 and events[]. These observations are scoped to calls after declared setup; they do not assert zero setup RNG, absence of setup status FX, or equivalence of all derived RNG streams. Static comparison with the unchanged verifier expectations found no additional mismatch among the23 successful rows; the JS verifier was not rerun, and there is still no verified canonical corpus.

Direction details: input angle bits bf8921fb54442d19 / bf8921fb54442d18 / bf8921fb54442d17 are adjacent. All three endpoints are x299.99247018391446,y198.772846171428 and actual path-angle bits bf8921fb54442d41. Preserve this real negative finding. Do not tune endpoint/origin/radius or search for a favorable path transition in this correction.

## Exact failure and relevant source clocks

Sealed `tools/walk-hint-fixtures/boundaries-scenario.mts:176–183` computes at=world.serverTime+TICK_MS, equalLost=at-TARGET_LOS_GRACE_MS, then chooses nextUp(equalLost) for the “before” case. Forty real50ms steps give now2000; the two priming steps give now2100, so at2150, grace1500 and equalLost650.

The timestamp and the predicate result have different binary64 spacing. At650, one ULP is2^-43=1.1368683772161603e-13; at1500 one ULP is2^-42=2.2737367544323206e-13. The old nextUp650 is650.0000000000001 (bits4084500000000001). Its exact subtraction from2150 lies halfway between two representable elapsed values and round-to-nearest/even yields1500 (4097700000000000). Therefore the explicit `<1500` prerequisite correctly refuses. This is a recipe representability defect, not evidence of a source clock/targeting bug or the desired pre-expiry hint.

Actual source semantics, unchanged:

- `sim/step.ts:302–305` advances serverTime by dtMs and tick before phase work. Active pass calls updateAbilities (including expiry) before updateTargets (`step.ts:259–261`). The helper does not advance time; `walkHint.ts:61–64,96–101` evaluates the lock at now+50.
- `walkHint.ts:171` refuses when no current ray, lockSeen and positive lostAt, and `at-lostAt >=1500`. It uses elapsed subtraction, **not** `at >= lostAt+1500`; changing to a deadline comparison in the harness would model a different floating expression.
- `targeting.ts:165–174` resets lostAt on current sight, initializes it on the first missed ray, and on later real ticks drops at `now-lostAt >=1500`. Here the timestamp is a labelled declared cached-history input; no claim that fractional lostAt was naturally born at a50ms tick is made.
- `sim/vision.ts:24–25,53–55` reads/updates private VisionMemory at current serverTime. `shared/vision.ts:124–125` throttles refresh below100ms, remembers seen cells to now+30000, and `:216` sees a cell only while expiresAt>now. Moving back behind the wall does not erase the primed cells. The real los-equal record confirms current visibility/lockability while actual LOS=false. The vision-trail deadline is independent of the1500ms lock grace; neither TTL nor refresh cadence needs alteration.
- `sim/status.ts:213–217` ignores statuses at until<=future at. `:183–184` reveal is [revealFrom,revealUntil), and `:254–260` sets revealFrom=now+50. Physical stale-instance pruning is performed by abilities, but readers already apply those clocks; no pruning/source change is required. This explains the four successful future-status observations.
- `walkHint.ts:124–126` uses strict at+1e-6<landsAt for weapon holding. These retained tie cases already straddle the actual expression and must remain unchanged.

## Minimal proposed code-only correction (not applied)

Scope: only LOS recipe in `tools/walk-hint-fixtures/boundaries-scenario.mts`, plus dedicated evidence/manifest. Keep runtime/build/verify implementations, all24 IDs/expected results, sources, selected mounts, setup steps, positions, history, actual APIs and old69 bytes unchanged. No engine change, clock assignment, extra source export, tolerance, loop/search or expected-output refresh.

Choose the adjacent **elapsed predicate input first**, then invert to the declared stored timestamp, and require the actual floating subtraction to round-trip:

```ts
const at = w.state.serverTime + TICK_MS;
const targetElapsed = side === "before" ? nextDown(TARGET_LOS_GRACE_MS) : TARGET_LOS_GRACE_MS;
rt.weapon.lockLosLostAt = at - targetElapsed;
// existing source visibility/lockability/LOS queries remain unchanged
const elapsed = at - rt.weapon.lockLosLostAt;
// retain existing prerequisite checks, add exact arithmetic identity before the existing side check
need(elapsed === targetElapsed, "LOS elapsed round-trip did not isolate the declared boundary",
  { side, at, targetElapsed, lostAt: rt.weapon.lockLosLostAt, elapsed });
```

Keep the existing strict before/equal assertion; record targetElapsed and its bits in recipe diagnostics alongside actual lostAt/elapsed bits. At the fixed genuine setup clock this deterministically chooses targetElapsed1499.9999999999998 (40976fffffffffff), lostAt650.0000000000002 (4084500000000002), actual elapsed1499.9999999999998. Equal remains lostAt650/elapsed1500. The before timestamp is two ULPs above650 because it is the representation of the adjacent elapsed input, not because “two” was chosen to obtain a hint. If the arithmetic round-trip fails at another context, fail and retain evidence rather than searching. Existing actual source walkHintOf still supplies the output.

The expired-side test remains “equal”: source drops on >=, so exact equality is already the first expired boundary. Do not silently add a25th after-case, rename equality to after, or remove another context to manufacture a new count. No addition is needed to repair this two-case straddle.

## Proposed next operation sequence (not authorized/executed here)

1. Root reviews/applies this tiny code-only change and seals a NEW immutable head; preserve a4ece and this failed run/raw receipt. A source-only diff/manifest review can verify that no other recipe/body changed.
2. Propose a NEW run root `/Users/nevinmckinnon/Documents/Projects/RogueHalla-bot-own-timings/docs/evidence/walk-hint-helper-boundaries/offline-790-corrected-review-02`. It must not already exist. Root must separately authorize the same host-build-only operation with the NEW exact head and fresh prepared path. No old output reuse/rebuild-in-place.
3. Independently inspect the new generated manifest/bundle/metafile/pins, then propose a fresh literal minimal offline Phase B command with the NEW actual SHA256 pins and distinct owned container name. The old command hashes are not authorization for altered code/output. No runtime retry has been performed or is implied.
4. Retain the successful23 observations as actual noncanonical facts without claiming the failed stage passed; any later canonical source publication and semantic controls/bytechecks require their own successful receipts and independent scope review. Path-direction coverage remains OPEN even if the corrected capture succeeds.
