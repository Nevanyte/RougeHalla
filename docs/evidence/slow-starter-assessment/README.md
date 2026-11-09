# Slow Starter source assessment

Source evidence and a proposed native seam only. No Rust implementation, native parity, checkpoint admission, cloud result or performance claim is made here. One worker; no Cargo, production edits, old fixture/tape edits, merge or push. Isolated branch `codex/slow-starter-fight-clock`, exact base `db5ed80b2b89a156eae09cd0bd3f4c9e77e9e6de`. Root requested this source-first assessment after accepting the owned receipt endpoint.

## Reproduction

From the repository root:

```sh
python3 tools/slow-starter-fixtures/extract_reuse.py --check docs/evidence/slow-starter-assessment/reused-case30.json
python3 tools/slow-starter-fixtures/check.py docs/evidence/slow-starter-assessment/source.json --negative-controls
bash -n tools/slow-starter-fixtures/capture.sh
bash -n tools/slow-starter-fixtures/door-probe.sh
shasum -a 256 -c docs/evidence/slow-starter-assessment/SHA256SUMS

# A new directory is required; existing outcomes are never overwritten.
bash tools/slow-starter-fixtures/capture.sh /absolute/new/output/directory
python3 tools/slow-starter-fixtures/check.py /absolute/new/output/directory/source.json --negative-controls
bash tools/slow-starter-fixtures/door-probe.sh /absolute/new/door/directory
```

Capture uses the existing pinned Node22.23.4 Linux/amd64 Docker digest `aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, emulated on this Apple Silicon host. The repository is mounted read-only at `/source`; only the needed legacy package/harness/corpus files are copied to a disposable tmpfs. `npm ci --ignore-scripts` uses the existing lock. All132 sealed source-input hashes and11 old harness-input hashes must match before execution. No local `node_modules`, dependencies or lockfiles are edited. Docker `--rm` removes only these task-owned containers/tmpfs; outputs remain. This evidence contains synthetic constructor seeds and synthetic actors, never live credentials or production data.

## Existing source reused first

`parity/card-runtime/source.json`,53,035,071B, SHA256 `f67417ff219039296852886e61aa9661ac535d2f5ce0126fa3f76f6a3a740337`, remains unchanged. Case30 `while-hp-and-fight-cache-transition` has195 ordinary steps, real Attack/Release and actual ledger results. Constructor placements, sword and card grants are explicitly declared setup. Its final HP placements are diagnostic and do not establish the fight-clock result.

The read-only extraction retains every changed clock/hold and genuine landed frame, plus exact intermediate RNG offsets. At100ms start=last=100, hit25.29657695322707. At3050ms start100/last3050 and holds0. At3100ms age3000 flips holds1, damage sum−0.3→0.35000000000000003. The3550/4050ms hits pay48.786255552652214. At7050ms idle gap3000 flips holds0 while retaining start100/last4050. RNG total49 through this interval; final total137, not a constant49 throughout the195 steps. The extraction's canonical hashes explicitly use Python JSON serialization; they are not original byte hashes or JavaScript JSON hashes.

## Seven bounded source witnesses

Final [source.json](source.json):3,948,151B, SHA256 `10681ab8a9be45a194e665de7206ac49c2813663412f9590b5df191996d4afdc`. Each case ran pristine, with read-only lexical inspection, then as an inspected deterministic repeat. The seven pristine/inspected comparisons cover public state, every retained tick's landed list/events/RNG offsets, complete nonempty event tape and complete random tape. The seven repeats also compare the selected private clock/watch/cache observations. Inspector sessions disconnect before ordinary execution. The new wrapper reuses the unchanged old engine and inspection code; it does not rewrite source. There are1,099 ordinary steps per final seven-case pass,3,297 across the three runs. This is a finite source assessment, not a whole-game campaign.

| Witness | Actual source result |
|---|---|
| Last hit4050, ordinary re-attack7000 (gap2950) | Hit48.786255552652214; start100/last7000; holds1. |
| Re-attack7050 (gap3000) | Hit still48.786255552652214 from the already-paid cached fold; **then** start=last7050, holds0/−30%. |
| Re-attack7100 (gap3050) | Idle7050 had already expired the hold; hit25.29657695322707; start=last7100, holds0. |
| Mutual sword inputs100 | Two real landed entries, p0→p1 and p1→p0. Both watched players are touched twice in this pass; each ends start=last100. |
| Solo Training / actual born dummy | Unwatched hit100 makes no clock. Explicit real `grantCard` helper at100 adds watch but does not rescan the still-present old landed list. First newly watched hit600 starts clock; hold matures3600. Real TrainCard0 at3900 is a no-op. Real Clear4550 removes flattened rows/watch/clock **before** that pass's ordinary hit, which pays unmodified64.32558139534883. Declared helper grant5150 leaves clock empty; next real hit5500 starts a new fight, maturing8500. NPC `mob1` is the unchanged source-born plain dummy, never a watched player. |
| Ordinary lethal watched player victim | Real sword hit12850 kills p1. The dead victim still receives last12850, start100. At15850 its hold expires but clock/watch remain. No installed HP, status or death. Third player keeps the run active. |
| Ordinary patience teleport | Declared normal5s patience reaches settle/teleported at5050. Clock start100/last5000 and holds1 survive. No forced phase/teleport helper. |

The final training witness has one human and actual source-born dummies, with player placement and sword declared at bootstrap. It does not move, replace or seed NPC identity, max HP or outcome. Its two card acquisitions are explicitly declared real grant helpers. No witness installs a fight clock, landed entry, damage result, death or phase.

**Admission limit:** `cards.ts`'s `isInteractiveAugment` omits Slow Starter, despite `ready:"a"`. Both `chests.handleChoose` and `training.trainCard` require that predicate; native `reward_chests::INTERACTIVE` and Training eligibility agree. This packet does not widen those doors. The separate four-step [door.json](door.json) retains actual `enqueueClientMessage` acceptance for TrainCard1 and0, actual no-op build results, labelled helper grant, and successful real Clear. Ordinary acquisition/reacquisition of Slow Starter through those restricted doors is not claimed. The optional catalog row is tested from honest declared bootstrap/helper setup.

## Actual landed lifecycle and cache order

`step.ts:253` resets `world.combat.landed=[]` at the start of each active pass, before actions/weapons. `ledger.ts:101–139` consumes the ledger once; outgoing multipliers are snapshotted before any victim is paid. At349–384, a victim must have taken positive applied damage; each positive mitigated non-arena entry appends one landed record, including lethal, ability, DoT, passive and derived entries. Barrier/overkill shares can affect the stored amount; `noteFights` only consumes IDs. Arena burn and wholly unapplied damage do not create these records. A repository search found this sole reset and sole append; intervening systems read rather than consume/splice the list.

`mods.updateMods` is after the completed ledger and earlier systems, before settle. Its first action is `noteFights`, which touches both `by` and `victim` for each record if their ID is watched. It neither checks standing nor filters to weapon hits; duplicate touches at one fixed time are idempotent. NPC victims are real landed targets, but source `store` only watches player states. A helper executed between steps can observe the previous landed array; it must not cause another `noteFights` invocation. The next ordinary pass clears that old list before new contacts. No RNG is consumed by the clock itself; the full retained tapes include other systems' real draws (final totals49/49/49/49/1/225/70).

`recomputeMods` rebuilds rows, evaluates holds with the existing clock, folds, then `store` updates watch. With no flattened FightTime row, `store` deletes that ID from watch and deletes its clock, even if other cards/Wish state remain. A row-bearing refold alone does not create a clock. Event-driven recomputes are still allowed before late mods and can evaluate an old clock at the current time. The paid7050 hit is the concrete guard against moving fight touches/refolds ahead of the ledger.

Source `fightClocks` is a lexical WeakMap outside `rt.cards`. `cardHooks.resetAll` on raidStarted clears `rt.cards`, pending and bleeds; `resetFight` on teleport clears streak/boost/pending. Neither deletes the fight map. Real teleport/death are captured above. Training Clear deletes via build removal plus recompute/store, not merely card-memory reset. `trainingSettle` revives/resetWeapons without touching this map. Removal/abandon delete player/runtime maps but do not directly clean this weak-map watch/clock; native IDs monotonically advance and are never reused. A source-only same-string-ID re-add could retain orphan memory; that is outside the admitted native identity lifecycle and is not silently generalized.

**Remaining source coverage:** same-world exported `startRaid` reuse, actual Training death/revive and administrative remove/re-add are static code-path assessments, not new executed witnesses. No direct lifecycle helper was presented as ordinary play. Source semantic mutants have not run. The eight checker controls damage retained observations and require the specific intended rejection; they establish checker sensitivity only, not source/native mutation coverage. Root decides whether any further witness is necessary before native admission.

## First outcomes and checks

Attempt001 exited125 before source execution: Docker could not create a nested node_modules mountpoint inside a read-only bind. Its failure log is retained. The corrected runner uses a task-owned `/repo` tmpfs and immutable `/source` bind.

Attempt002 successfully completed its seven pristine/inspected/repeat observations, SHA256 `c08523310b50888522100643e61d2b4e965210c5f80d441d0eecb895b1cf975d`,3,262,520B. Its proposed TrainCard gain/removal did nothing, and its10s attack was nonlethal; neither candidate was counted as lifecycle proof. The original full output remains outside Git at `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/slow-starter-source-2026-11-09-attempt-002/source.json`; bounded log retained here. Attempt003 changed only those declared lifecycle actions: labelled grant/real clear and one fixed19s ordinary death extension. No progression, HP, clock or outcome was installed to conceal either limitation. The final four-step door probe independently retains actual parser/queue acceptance that the compact clock frames omit.

Sealed-case extraction, final seven-witness checker,143 input hashes, intermediate RNG offsets, eight intended damaged-observation rejections, shell syntax, Python AST parsing and Git whitespace checks pass. No Rust formatting/lint/test claims follow: production and Cargo remain held for Root review. [NATIVE_PROPOSAL.md](NATIVE_PROPOSAL.md) is the exact proposed owner/reset/hash/checkpoint/tape footprint, not authorization or implementation.
