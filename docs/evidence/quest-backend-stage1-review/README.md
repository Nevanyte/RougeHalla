# Quest Stage1 independent preservation review

2026-11-10. **HOLD for final seal, completed gates and the narrow private continuation repair below.** This is a read-only WIP review, not admission. DeepSeek owns all Rust and private harness changes. The reviewer ran no Rust tests and changed no source, fixture, production code or shared status.

Baseline: `36564c333d56beb8d47a9962cec033eea85b1921`. Reviewed native worktree: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-quest-runtime`, still on that HEAD with four Stage1 files modified/new. The candidate has no final identity yet. Private evidence lives outside Git at `/Users/nevinmckinnon/.codex/tools/roguehalla-backend-20261109/quest-stage1-compare/`. No private checkpoint contents, state hashes or transcript digests are included here.

## Production inspection

Only `quests/live.rs`, `quests/mod.rs`, new `quests/objectives.rs` and new `quests/rewards.rs` were changed at inspection. Existing serialized state and entry-point paths, catalog, reward rules, hooks/schedule, source consumers and identities remain unchanged. The typed objective is derived on demand, receives explicit counts/masks/facts and supply, and has no World or persistent state. Reward application retains authoritative grant paths and completion stays in `live.rs`.

- Capped count advancement returns `None` rather than creating an absent zero row; existing progress rows update in place and new rows append. Tour still writes the visit row first and progress second on every credited tour kill, including saturated/repeated-region kills, matching the baseline rather than applying the ordinary count no-op rule to tours.
- Mob/player/collect/fetch distinctions and existing eligibility gates are retained. The elite row has `region: None`, so the new region predicate preserves its admitted “any elite, anywhere” behavior. All admitted catalog counts are positive; replacing absent readiness with numeric zero therefore preserves absent-row behavior. This review does not claim arbitrary invented Def combinations are a registered gameplay domain.
- Supply still sums the same live catalog regions/elite counts and evaluates every standing human, including unaccepted humans; any feasible human prevents expiry. No standing human still leaves the offer open. The repaired stored tour mask is passed directly.
- Reward plan lowering uses unchanged `rules::reward_stats`. Application retains the same training suppression of quest GV, quest-cap room calculation, saturating total, real mob-stat grant and gained-only farm notice. Ordered effects remain retirement/done, quest GV, farm notice when gained, owner completion, room completion. No historical card payout is introduced.

Inspected WIP SHA-256 inventory (code only):

| Path under `crates/rh-sim/src/quests/` | Bytes | SHA-256 |
| --- | ---: | --- |
| `live.rs` | 34144 | `af48b280022b30428d9a6d1548e9467ba9cebf8cc127140d88001d63c8a52ef4` |
| `mod.rs` | 1246 | `fded335464ea83787de4937b54825c8300af615197881627350ce1bca22f4557` |
| `objectives.rs` | 4029 | `80cdbb391ea7a13094a17b1287b6c80f998deb7572af99d6d01b89366767fdfd` |
| `rewards.rs` | 2309 | `a35af0afd927c43ddcbb1a2fb9ffe19a84174df41d6b0dec099237b1c3fa4371` |

## Private comparison evidence inspected

The private baseline production `live.rs`, `mod.rs`, catalog and rules match `git show 36564c33`; candidate production files match the WIP above. The generated lifecycle harnesses are byte-identical between baseline and candidate, as are the generated normal-constructor harnesses. Both worktrees and the native worktree use byte-identical lifecycle and tour-supply source inputs.

Existing private transcripts match byte for byte: ten lifecycle cases/37 captured frames and both normal-constructor tour-supply cases/five frames each. Each recorded frame contains full checkpoint JSON, events and three prepared human QuestViews in addition to private hashes. Lifecycle records retain two restore refusals from the existing reset_active domain; these must remain honestly reported. The normal-constructor records all restore successfully, with before-step identity and the currently recorded one-step clone/restored state/event comparisons matching. This is useful partial evidence, not the complete agreed continuation proof.

## Required narrow harness repair

1. **Actual normal continuation is incomplete and omits producer events.** In the currently generated `baseline/` and `candidate/crates/rh-sim/src/quests/tour_supply_source_tests.rs`, lines977–978 step a clone and a restored Sim once. Lines990–995 label the clone result “original”. Neither speculative branch receives the outer `pending` producer-event queue. That queue is nonempty at the real pre-recheck boundary, so these branches do not execute the same event/action continuation as the actual source replay. They also omit all remaining source actions.
2. **Lifecycle continuation is not exercised.** `instrument.py:51–65` (generated lifecycle test around lines638–655) serializes/restores and records hashes, but does not continue original/Clone/restored with the remaining source action script. A matching restore snapshot alone does not establish continuation preservation.
3. **Generator and generated harness differ.** `instrument_normal.py:77` contains `pending.clear()`, but both actual generated normal harnesses omit it. Consequently the existing main source replays preserve pending events; this review does not claim those main transcripts dropped them. Update the private generator to accurately reproduce the repaired harness and assert replacement counts so stale text replacement cannot silently weaken later runs.

Smallest adequate repair: keep the finite existing ten lifecycle and two normal source scripts, without additional canonical cases or production edits. At one meaningful nonterminal captured boundary per existing script, fork a real `Clone` and an actually accepted restored state alongside the still-running original, preserving each runner's source action index, pending producer events and any harness notice bookkeeping. Feed all remaining declared source actions and ordinary steps through the same runner logic. The normal cases must include the real pre-recheck pending-event boundary through tick5; append identical copies of the pending producer queue to all relevant branches before the next step rather than clearing it or inventing expected events. Keep original genuinely original, with distinct Clone/restored labels.

Compare complete checkpoints/private state, ordered returned events and prepared human QuestViews at the remaining captured boundaries, both within original/Clone/restored and between baseline/candidate. For lifecycle states that genuinely refuse restore, preserve/report that refusal and continue original/Clone; use the actual normal-constructor accepted restores for the restore-continuation requirement. Do not relax admission, install expected quest state, replace source actions with bare steps, or edit source expectations. Reuse mechanically identical instrumentation and exact same input bytes on both revisions. Re-run only these repaired private comparisons; unrelated canonical gates need no repetition solely for a private harness repair.

Existing normalized main-record equality and reset_active refusals should be retained as earlier partial evidence, not overwritten as if the initial continuation proof were complete.

## Remaining admission gates

Bind final clean seal and exact four-file diff; inspect completed quest/quest_view and relevant content/layout/hash/checkpoint/replay/integration receipts, including the existing giver allocation guard. At this WIP review the manager reports quests34 passed/1 ignored and quest_view26 passed, while some hash/integration receipts were incomplete and the author was checking the live run. Those reports are not yet a final-seal validation claim here. Retain all original failures honestly and keep Stage0/source identities unchanged. Final disposition follows the repaired private comparison evidence and final receipts; no broad reviewer rerun is requested.
