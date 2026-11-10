# Tactics source candidate reproduction review

## Result

**Reproduction and source-integrity PASS; native admission remains outside this review.** This independent review used the
clean fresh worktree `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-tactics-source-review` at
HEAD `54ff01a26c25165b75a4109589b241d7ee061e77`. Its initial `git status --short` was empty. The only later untracked
files are in this new review evidence directory; no tracked file changed. The candidate is still source-only and
unsealed for native use.

The pinned capture check reproduced `source.json` (11,656,923 bytes,
`5d27d1b4522d386d4ede5f3064a28660dedff43e32a24ade264f4512e30fcfa8`) and `coverage.json` (1,069,183 bytes,
`b43c64fea6c6da17faaccf578a1e4d6614c96e352f5f951fefafcca95ae68f77`): 154 cases, 720 chronological methods. The
dependency-free reader/verifier passed with 17 reader negatives; the pinned manifest checker reproduced the frozen
37,387-byte manifest (`9f76406016d0ebc498b0a3a3ec7cad677fc43ecd40b530a963a57a7f3d6eb957`), including 17 semantic
controls. Full raw output and exit receipts are in this directory.

Before/after snapshots pin **226 manifest entries**: 113 source files, 84 actual TypeScript runtime imports, 9 config
files, 13 harness files, 4 compatibility corpora and 3 candidate corpus files. Both snapshots have zero mismatches,
identical manifest hash, source/tool/config/compatibility/corpus bytes and map hashes; the pinned comparison exits zero. Exact inventories
are in [before.json](before.json) and [after.json](after.json); [inventory-comparison.json](inventory-comparison.json)
records the byte-for-byte comparison.

## Commands and environment

All commands ran from `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-tactics-source-review`.
The image is pinned to
`node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292`, Linux amd64.
The capture wrapper runs `npm ci --ignore-scripts --no-audit --no-fund` only inside the container; the verifier and
manifest checker run in the same pinned image with `/repo` mounted read-only and require no packages. No host npm
install occurred.

```sh
bash tools/bot-private-tactics-fixtures/capture.sh --check
docker run --rm --platform linux/amd64 \
  --mount "type=bind,src=$PWD,dst=/repo,readonly" \
  --mount "type=bind,src=$PWD/docs/evidence/bot-private-tactics-source-review/reproduction,dst=/evidence" \
  -w /repo node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292 \
  sh -eu -c 'node tools/bot-private-tactics-fixtures/verify.mjs && node tools/bot-private-tactics-fixtures/manifest.mjs --check'
```

The first capture attempt exited 125 before Node started because Docker could not create its `/repo/node_modules`
tmpfs mountpoint in a read-only bind. Following the task instruction, an empty ignored `node_modules/` mountpoint was
created; the same capture check then exited 0. Both raw outcomes are retained in `capture-check.raw.txt`,
`capture-check.exit.txt`, `capture-check-attempt-2.raw.txt`, and `capture-check-attempt-2.exit.txt`.

The first inventory-script invocation exited 1 because its initial version treated corpus basenames as repository-root
paths. That raw failure is retained; the corrected recorder ran in the pinned container before and after source checks,
with zero mismatches in both snapshots. Its version and the exact comparison command are under `inventory.mjs` and
`compare.mjs`; raw command outputs/exits are included as `.txt` files.

## Source and control audit

The capture is a finite method-level source witness: declared chronological inputs are decoded before use, and real
`createTactics`, Memory, exported dependency methods, path services, Knowledge callbacks and seeded RNGs run. The runner
constructs callback wrappers around actual calls and records their ordered arguments/results. Each case is recreated
from fresh real objects/seeds and its complete transcript must match exactly. Operation outputs, callback results and
RNG tape values are captured for comparison; none are supplied as setup inputs or fed into later calls. Source inputs
are checked for mutation after each operation.

I inspected `controls.mjs` and the frozen `controls-attempt-4.log`; summary parsing is retained in
`controls-audit.json`: there are 17 mutation runs plus comment and restored
runs. All 19 child captures exited 0; no KILL came from a compile/decoder/runtime failure. The 17 KILL receipts compare
selected actual results, counters, callbacks or RNG counts after executable source edits. They cover Orb initial state,
mate selection/retention, swap cooldown, Reflex preemption/hold, Orb launch/reset, Retreat retention, flee reset/fallback,
loot retry/fail/latch/event-once, hold-spot cache and stale-slot eviction. Comment-only is NONKILL; restored source
matches the selected complete chronological cases, and canonical source/output bytes were checked unchanged. The final
controls check was already independently repeated by the author; this review did not rerun the mutant sweep because no
specific mutation concern was found.

The candidate manifest pins the unchanged compatibility sources `bot-fight`, `bot-sd`, `bot-reflex`, and `bot-core`;
the before/after inventory verifies their exact listed hashes. A separate read-only `git diff --name-only` from base
`10519519bd4d9a5b55b1bf3042500d20c7ff4ea0` reports no changes in bot/shared source, lockfile, frozen strategy tools or
strategy/compatibility corpus paths. The exact output is `protected-path-diff.txt` (empty).

## Boundaries

This review confirms reproducibility and integrity of the declared source candidate, not completeness of tactics
behavior. The candidate reports 16 executable reached assertions and 17 raw negatives. [LEDGER.md](../../bot-private-tactics-source/LEDGER.md)
lists unisolated source paths and finite limits; it is not a blanket branch-coverage claim. Existing compatibility
corpora remain separate dependencies and were hash-checked, not replayed here.

The explicitly declared `emptyPath` test service can return `[]`; the witnessed World loot operation then throws in
unchanged source. The actual RoomPathService normalizes an empty `findPath` route to `null`. This is a test-service
boundary observation, not a normal gameplay failure and not a requirement for Rust to panic. The suite also contains a
separate Fight empty-path case that handles that test-service result without making the same throw claim.

Numeric rules in the candidate's `NUMERICS.md` are source-review proposals: declared inputs, timers, discrete decisions,
identity/order and callback/RNG results remain exact. Any listed continuous-geometry tolerance needs independent
approval before native comparison. This run inspected no native outputs, did not inspect or alter Rust/Unity/shared
status, and makes no native privacy, public policy, live bot, or whole-Brain completeness claim.
