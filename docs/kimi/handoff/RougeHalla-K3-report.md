# RougeHalla K3 hand-in

- Dependency/base: K1 commit `592f2a241d14d8c34dd4e442f4ca66bf5b10b922`
- Branch: `kimi/quests-k3`
- Commit: `4e96e9df96026b60b9240d79202e44bc49d87b3b`

## Delivered

- Added `npm run questbench -w @raid/server` with `--quick`, `--seeds N`, `--players N`, `--cap N`, `--quiet`, and `--help`.
- Runs the real headless sim with farm-only, quest-greedy, and mixed policies. Policies use normal move/target/pickup inputs and synced public quest state only.
- Includes uniform-policy measurement seats and mixed-policy lobbies. Policy seats and factions rotate independently across seeds.
- Reports per-quest completion, median/p90 completion time, buffPower before/after, farm-only power at the same elapsed times and their ratio, nearby deaths, and fight engagements.
- Reports policy power at minutes 1/2/3/5 and mixed-lobby win rates.
- Explains report interpretation and limitations in the output. Errors are caught and reported with a successful exit so the harness never fails CI.

## Early report

The final two-seed, four-player run completed 26/26 lobbies and recorded 80 quest completions with no harness failures. Mixed-lobby wins after rotation were farm-only 0/3, quest-greedy 1/2, and mixed 1/3. This is a small early sample, not a balance ruling or K2 approval. Some quests still have no completions, and death/exhausted-camp sample loss limits the farm comparison; the report retains those limitations rather than hiding them.

Full output: `RougeHalla-K3-report.log`. Quick smoke output: `RougeHalla-K3-quick.log`.

## Verification on the committed K1 + K3 tree

- `npm run typecheck`: passed; see `RougeHalla-K3-typecheck.log`.
- `npm test`: passed; see `RougeHalla-K3-test.log`.
- `npm run build`: passed; see `RougeHalla-K3-build.log`.
- `npm run questbench -w @raid/server -- --quick`: 10/10 lobbies, 26 completions, no harness failures.

## Boundaries

- No bot, core quest, shared, client, protected, or K2 files were changed by the K3 commit.
- The patch and bundle contain only K3 and therefore require the stated K1 base commit.
