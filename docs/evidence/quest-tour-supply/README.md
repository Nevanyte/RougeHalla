# Actual-source Grand Tour supply witness

Source-only evidence prepared by Sol for [P-QUEST-BACKEND-1](../../backlog/packets/P-QUEST-BACKEND-1.md), against
`optimization_port` source base `4151b3af597cc06d1b3b77f4e3e21cc9906b6a86`. All writes are new tool/corpus/evidence
paths plus the allocated architecture/packet. No Rust, package source, old fixture/expectation, wire/schema or shared
MIGRATION/CONTRACTS/Cargo.lock edit was made by this source worker. Root owns committing/transferring this frozen evidence;
DeepSeek owns all native code/tests/repair/extraction.

## Frozen artifacts

| Artifact | Bytes | SHA256 |
|---|---:|---|
| `parity/quest-tour-supply/source.json` |638,109| `0bb63ed402b411d4f9bf23381fa162e64e08f5704905f974e3920c982fae5714` |
| `parity/quest-tour-supply/controls.json` |1,260| `64d9b5e50b61964853ae95d0d4b057392b83e344d3874731003dc914e0b601db` |

`parity/quest-tour-supply/manifest.json` pins these artifacts and all five frozen tool files. The source corpus profile
records Node/image/platform, lock/config pins, installed dependency versions and a125-file conservative static
import/export/literal-load closure (including type imports), with per-file bytes/SHA256 and aggregate digest. This is
explicitly static closure analysis, not runtime loader instrumentation. The capture/tool paths remain frozen while
native work proceeds; do not edit a tool README without regenerating its provenance-bearing corpus.

## Actual source flow

The pinned `node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`
image runs Linuxamd64/Nodev22.23.4. Real `createGameWorld` production module order uses seed1/attempt0/decor:false,
world random seed12, reward salt[1,2,3,4], source orderSalt1237598750, quests/PvE on, signatures/walkHints off, no planning,
three declared human seats. Config and every declared option/seat are retained in each case.

| Frame | Tick/time | Reached source facts |
|---|---|---|
| spawned-known-open |1/50ms| Genuine source roster publishes Grand Tour;204 live regional mobs |
| accepted-through-input |2/100ms| Real queued questAccept records p0 and starts catalog deadline |
| earned-frost-visit |4/200ms| Ordinary sword input kills one actual normal Frost mob; stored progress1 and visits{Frost};203 live mobs |
| real-camp-producer-before-recheck |4/200ms| Labelled real killMob batch completes camps; recheck=true, tour still Open; no helper sweep called |
| ordinary-step-recheck-result |5/250ms| Real scheduled questSystem consumes recheck; status, retirement, deadline and notices captured |

Declared setup equips p0's sword, places/history-resets the actor and sets the chosen real normal Frost mob HP to1.
All actor actions use the normal source input queue. The supply-exhaustion batch calls actual `killMob` with no credited
killer and every target is recorded. It is a declared out-of-step producer, not ordinary player-fought camps. No
progress/visited/accepted/publication/recheck/status/deadline field is forged. The source's own camp deaths request the
recheck, and an ordinary50ms step makes the decision. Respawn, deadline and end-run timers are not reached.

- `frost-visit-fire-holy-stays-open`:84 live mobs remain in Fire/Holy; source sees two fresh regions, stays Open and
  retains its giver. Final stored progress is1, visited Frost, quest GV0. Four retained notices overall.
- `frost-visit-frost-sentenced-expires`:80 live mobs remain in Frost/Sentenced; source sees only one fresh region for
  the required two, expires, retires its giver and freezes its deadline at close time. Quest GV remains0. Three retained
  notices overall.

Both other standing humans have zero tour progress, so two live regions cannot satisfy their three-region tour. Every
snapshot carries all live mob kind/type/brain region/elite/HP/poses and all standing humans plus every offer's public/
private state. The native consumer must verify its catalog-zone supply agrees with these actual source brain regions;
substituting a different supply without a discrepancy report is not authorized.

Notices retain all source Toast and quest-GV events returned by ordinary steps, with returned-step tick/time envelopes.
Other event classes are intentionally outside this bounded quest-notice surface. The corpus includes GV/farm facts,
giver/container retirement and exact open-before/after facts; it is not a full event-stream equality claim.

## Commands and controls

From `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-gameplay-quests`:

```sh
bash tools/quest-tour-supply-fixtures/capture.sh
bash tools/quest-tour-supply-fixtures/run-mutants.sh --write
bash tools/quest-tour-supply-fixtures/run-mutants.sh --check
```

The frozen capture command passes its write and two subsequent byte-identical checks. Each invocation separately
constructs both Worlds twice and compares their complete cases. The mutation writer passes:

- Population-count-as-region-mask semantic control: KILL in both final status paths. Source Open becomes Expired in
  case0; source Expired becomes Open in case1. All earlier recorded frames are exactly equal. A source/build/runtime
  failure would fail the runner and is not counted as a semantic kill.
- Comment-only control: NONKILL, every case/action/notice unchanged while source provenance changes.
- Restored disposable source copy: complete corpus byte-identical; final immutable original-source bytecheck PASS.

The separate read-only controls receipt reproduction passes (exit0) and is recorded in `logs/control-receipt-check.log`. It includes its
exact command/working directory, exit status and returned raw stdout. Source/control/tool exact pins are portable in
the manifest and corpus; gameplay expected values have not been edited after capture.

Safety comes from disposable-copy mutation: canonical `/repo` and `/capture` mounts are read-only, patched source and
intermediate outputs live only in a unique container `/tmp` directory and are removed in finally. The canonical corpus
is unchanged by the mutation runner. `--check` mounts the output read-only. `npm ci --ignore-scripts --no-audit
--no-fund` runs only in container-local node_modules tmpfs. No paid service or cloud action occurs.

## Preserved exploratory failures and limits

The initial Docker attempt failed before Node execution because the new worktree lacked an ignored node_modules
mountpoint for its nested tmpfs. Creating that empty ignored directory fixed the mount setup. A later exploratory
bytecheck correctly failed tool-provenance equality when the capture script was extended while that earlier run was
still checking. The frozen final run completed both checks with no concurrent tool changes. Neither exploratory
failure is relabelled as a pass.

This is two source World cases plus controls. It is not Rust/native admission, full quest parity, a player-fought
campaign, all notice cases, Room/socket/Unity/browser flow or durable progression evidence. Fixture salts are declared
offline inputs, not live secrets. The Rust mask repair and objective/reward extraction are separate DeepSeek work.
Root separately admits the approved `tour-supply/visited-region-mask/1` content marker; schema versions stay unchanged,
and existing checkpoint/replay ContentMismatch prevents silent cross-rule continuation. No backend deployment or
Claude BakedContent/client regeneration is implied.
