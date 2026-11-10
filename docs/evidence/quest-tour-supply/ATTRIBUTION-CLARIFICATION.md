# Grand Tour supply witness — existing-threat attribution clarification

This additive clarification corrects the attribution description of the frozen source witness. It changes no source,
tool, corpus, expected result, manifest or original receipt. Source seal is `c605f2fb`; the exact transferred source seal
in DeepSeek's worktree is `a3d8e8d4`. All12 files in those two seals compare byte-identically.

`parity/quest-tour-supply/source.json` remains **638,109 bytes**, SHA-256
`0bb63ed402b411d4f9bf23381fa162e64e08f5704905f974e3920c982fae5714`.

The tool supplies empty explicit ledger entries and amounts to each out-of-step `killMob` call. That does **not** mean
every kill is uncredited. Source `packages/server/src/sim/mobLife.ts::killMob` first reads the mob's existing
`brain.threat` and may select an in-run player from that history. `world.ts::payLater` executes rewards immediately
when the world is not collecting a ledger pass. Existing threat and reward/notice side effects are part of this declared
producer boundary and must be preserved.

The frozen data demonstrates this in `cases[0]` (`frost-visit-fire-holy-stays-open`):

| JSON path below `cases[0]` | Earned visit, frame2/tick4/200ms | After producer, frame3/tick4/200ms |
|---|---|---|
| `frames[*].humans[0].gv.mobs` |6|12|
| `frames[*].humans[0].mobStats` |`[["rimeStalker",3]]`|`[["rimeStalker",6]]`|
| `frames[*].humans[0].gv.quest` |0|0|
| `frames[*].quest.progress` |`[["p0",1]]`|`[["p0",1]]`|
| `frames[*].quest.visits` |`[["p0",["frost"]]]`|`[["p0",["frost"]]]`|

The next ordinary step returns the real queued notices at tick5/250ms:

- `cases[0].notices[2]`: `Camp potion stored · Heal 40% HP over 5s` to p0.
- `cases[0].notices[3]`: `Rime Stalker: +3 kill stacks · +7.5 Defense total` to p0.

Case1 (`frost-visit-frost-sentenced-expires`) retains p0 mob GV6 and Rime Stalker stacks3. Both cases still have tour
progress1/visited Frost and zero **quest** payout. The attribution difference does not invalidate either captured supply
regression or its semantic control; the same-region additional credit does not advance the distinct-region tour.

Interpret the original `uncredited` / `no credited killer` prose and action boundary label as **no explicit credited hit
entries supplied**. It is not an assertion that existing threat is empty or that source suppresses all rewards.
Keep the frozen wording untouched so its provenance hashes remain valid; this clarification supplies the corrected scope.

The native consumer must replay the real lethal producer with retained threat, ordinary source-equivalent inline reward
behavior and the captured event-return boundary. Do not clear threat, install reward/progress/visit state, suppress a
real credited payout, discard its actual farm/camp notice or rewrite expected values. Source `world.events` retains
out-of-step notices until the next normal step returns them; native test plumbing must preserve the corresponding
producer events and compare them at that returned-step envelope. Retain the fixture's before-recheck reward state and
ordered tick5 notices. Any native mismatch here must be reported separately from the one-line tour mask repair.
