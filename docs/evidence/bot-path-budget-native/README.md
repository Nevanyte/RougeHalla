# P-BOT-PATH-BUDGET-1 native evidence: borrowed room path allowance

2026-11-10 (UTC receipts 10:06–10:10). DeepSeek implementation of the Root-dispatched, bounded packet
[P-BOT-PATH-BUDGET-1](../../backlog/packets/P-BOT-PATH-BUDGET-1.md), on branch `codex/deepseek-path-budget` at base
`374033999c3aa9bd4cfc1e002d243786879c4a7b` (clean start, worktree
`/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-path-budget`). The candidate is **not committed**
and **no shared status/commit record was edited**: Root seals the exact scoped candidate below. All Rust/tests here are
DeepSeek's; no source recapture, fixture edit, dependency/Cargo.lock edit, Brain/Strategy/Tactics/Modules/engine edit,
protocol/Unity edit or live activation occurred.

## Code candidate (final scope)

Only the leased paths changed; `git status --porcelain` shows exactly the edit, the new test directory and this evidence
directory. `git diff --check` exits 0. `Cargo.lock` is unchanged.

| Path | State | SHA-256 | Lines |
| --- | --- | --- | ---: |
| [`crates/rh-policy/src/bots/paths.rs`](../../../crates/rh-policy/src/bots/paths.rs) | modified | `5080560d0d18fd0678e63a404e99a31a930aea47ed06bc75bf832694a1c7d273` | 262 |
| [`crates/rh-policy/src/bots/paths/shared_budget_tests.rs`](../../../crates/rh-policy/src/bots/paths/shared_budget_tests.rs) | new | `05094723de942f61d9b4a9f980d75182b6e230604d47a8ce933e23e37f68ac1c` | 373 |
| [`crates/rh-policy/src/bots/paths_parity_tests.rs`](../../../crates/rh-policy/src/bots/paths_parity_tests.rs) | unchanged | `4d80b7472c104afe2551a8ac98921637a8148d09a293bbd2b011b408ab740ca2` | 153 |
| [`parity/policy/bot-tactics.json`](../../../parity/policy/bot-tactics.json) | unchanged | `eee99102ed65c580dfe82e696e32fb9887d7ebc66e935349e43d9bd1ba909a5f` | — |
| `Cargo.lock` | unchanged | `b14507716b80f1c0b85f7298b380b3c9146917134d9361c1bb408062782c0b22` | — |
| `crates/rh-policy/src/bots/paths.rs` **before** (base) | — | `1a25bae35dc5a3533dfeb8b0eb95e26f5a487c9fc9bef63e674554bc78a077b4` | 213 |

Exactly the leased edits: the one private `trip` transition takes `Option<&mut PathBudget>` and selects the borrowed
allowance **only at the existing miss/`take` point**; the existing `walk`/`path` entries forward to the same private
`walk_with`/`path_with` with `None` (owned budget), and new crate-private `walk_with_budget`/`path_with_budget` forward
with `Some(borrowed)`. One `#[cfg(test)] mod shared_budget_tests;` declaration is added to `paths.rs`; the tests live in the
new `paths/shared_budget_tests.rs`. Public `new/budget/budget_mut/walk/path/los/clear/collision_map/set_frame/stats` and all
`PathBudget` value semantics are untouched. Exact diff: [`receipts/09-final-diff.patch`](receipts/09-final-diff.patch).

Read and honored as the admitted context, without recapture: the unchanged source port at
`packages/server/src/bots/brain/services.ts:96–121`, the frozen-source fixture identity below, the admitted bridge hunk in
[P-BOT-BRAIN-NATIVE-1](../../backlog/packets/P-BOT-BRAIN-NATIVE-1.md) (`### Knowledge, Memory, Humanizer and path service`),
and the independent review's `Independently dispatchable path bridge` section in
[bot-brain-native-plan-review](../bot-brain-native-plan-review/README.md) (base path hash there matches the base hash above).
The released Brain `identity-shared-budget` history (`tools/bot-private-brain-fixtures/runner.mts:85–110`,
`cases.mts:145–148`, `checks.mts` identity-shared-budget row) was read only as caller evidence for the meaning: one caller
service handle/cache is reused across Brains/recreation, a distinct service keeps its own cache, and distinct actual services
consume the one room allowance; that full Brain replay remains a later composition gate.

Contract mapping (packet §Exact contract): (1) owned APIs and `PathBudget` clone/value semantics preserved;
(2) crate-private `walk_with_budget`/`path_with_budget` take `&mut PathBudget` for the call only and return the existing
`WalkAnswer`/path representation; (3) one `trip`/`walk_with`/`path_with` core, allowance selected only at the existing
`take` miss point, no copy/swap/second loop; (4) order preserved — finite check, fresh cache hit (no take), chosen take,
search/store, stale cached answer, fallback/stats; LOS/clear/collision_map/set_frame stay allowance-free and `set_frame`
never calls `start_tick`; (5) borrowed calls leave the owned budget untouched (asserted every replayed step) and owned calls
leave external allowances untouched (asserted); both entry families share one service cache/stats; (6) cache identity is per
actual service handle (two-service test), not per Brain; (7) only the caller `start_tick` replenishes, and one allowance
passed serially through two services exposes the remaining amount to the second call.

## Frozen source/input identity (unchanged; no recapture, no installed expected state)

`parity/policy/bot-tactics.json`, format `rh-bot-paths-source/1`, is read through `include_str!` and only its captured rows
are compared; no row is installed as component state. Its own pinned source identity is unchanged and bound here:
`captureSha256=030c00d5e120f5ddaa982144961386cc1b1a83ee968e5701712a625422e74685`,
`sourceTree=ea34d1c010d96ed47804929e98cea06e3b8dc27b184d4ceb8d0e7b4a7f747f18`,
`tool=434131a25beeecd03ae1cb6082c51219ecfd7c142cc6a96fdd8575ef385d04b8`, `budgetPerTick=3`, node/linux/x64
`v22.23.4` profile, with per-file SHA-256 for `services.ts`, `tactics/kite.ts`, `brain/types.ts`, `mobHunt.ts`,
`pathfind.ts`, `geometry.ts`, `map.ts` recorded in [`receipts/10-final-scope-hashes.txt`](receipts/10-final-scope-hashes.txt).
No expected allowance/stats/trip values were installed; comparisons are the existing exact/r6 source comparators, not
loosened.

## Commands, environment, exits and counts

Cwd for every command: the worktree above. Toolchain: repository-pinned `rust-toolchain.toml` channel `1.97.0`, invoked as
`/Users/nevinmckinnon/.cargo/bin/cargo` (`cargo 1.97.0 (c980f4866 2026-06-30)`, `rustc 1.97.0 (2d8144b78 2026-07-07)`);
`CARGO_HOME`/`RUSTUP_HOME`/`RUSTFLAGS` unset; isolated ignored target
`target/path-budget-build` (via `CARGO_TARGET_DIR`; top-level `/target` is git-ignored); `--locked --offline -j 2` for every
Cargo command. Raw logs are retained verbatim under [`receipts/`](receipts/).

| # | Command (filter) | Exit | Result | Raw receipt |
| --- | --- | ---: | --- | --- |
| 01 | `cargo test -p rh-policy --lib bots::paths_parity_tests` (baseline, before edits) | 0 | 1 passed, 0 failed, 227 filtered | [01](receipts/01-baseline-owned-parity.log) |
| 02 | baseline strict Clippy default then `--all-features`, `--lib --tests`, `-- -D warnings` (before edits) | 0 / 0 | both `Finished`, no warnings | [02](receipts/02-baseline-clippy.log) |
| 03 | `cargo test -p rh-policy --lib bots::paths::shared_budget_tests` (first run of new tests) | 0 | 2 passed, 0 failed | [03](receipts/03-shared-budget-tests-run1.log) |
| 04 | `cargo fmt -p rh-policy -- --check` | 0 | no diff | [04](receipts/04-fmt-check.log) |
| 05 | `cargo clippy -p rh-policy --lib --tests --locked --offline -j 2 -- -D warnings` | 0 | no warnings | [05](receipts/05-clippy-default-lib-tests.log) |
| 06 | `cargo clippy -p rh-policy --all-features --lib --tests --locked --offline -j 2 -- -D warnings` | 0 | no warnings | [06](receipts/06-clippy-all-features-lib-tests.log) |
| 07 | `cargo test -p rh-policy --lib bots::paths --locked --offline -j 2` | 0 | 3 passed, 0 failed, 227 filtered (new borrowed replay + new two-service + unchanged owned parity) | [07](receipts/07-focused-path-tests.log) |
| 08 | `cargo test -p rh-policy --lib bots::paths_parity_tests::the_path_service_matches_the_source_step_by_step ...` | 0 | unchanged owned parity: 1 passed, 0 failed, 229 filtered | [08](receipts/08-owned-parity-unchanged.log) |

Test inventory: new module `bots::paths::shared_budget_tests` with
`the_borrowed_entries_replay_the_frozen_source_script` and
`two_services_share_one_caller_allowance_without_sharing_caches`; unchanged existing
`bots::paths_parity_tests::the_path_service_matches_the_source_step_by_step`. Package test count went 228 → 230; the new
tests passed on their very first recorded run (03), and no comparator, fixture, filter or tolerance was changed. No
semantic/test failure occurred, so there is no red test receipt to preserve. The only non-zero exit during the work was
the *scratch* `cargo fmt -p rh-policy -- --check` on the just-written unformatted test file (diff against the new file
only); that output was not retained as a gate receipt, the file was formatted with `cargo fmt -p rh-policy`, and the
retained formatting gate 04 then exits 0 with no diff.

## Actual allowance/cache observations (test-only facts)

Borrowed replay of the unchanged frozen script (fixture `budgetPerTick=3`, distinct owned budget per tick 7 deliberately set
on the service): all 94 declared rows — 9 `frame`, 20 `walk`, 3 `path`, 1 `los`, 1 `clear`, 60 `away` — match the captured
source answers; the 23 walk/path rows go through the borrowed entries and match every captured service-counter row and
captured `left` row, including the NaN/`x:null` walk that leaves counters and `left` unchanged. The caller allowance follows
the source exactly through 3→2→1→0, frame resets, fresh hits, stale-window searches, gated/pruned frames and fallbacks; the
service-owned budget stays `7` after every step and at the end. `los`/`clear`/`away` rows spend nothing.

Two-service native sequence (caller allowance `PathBudget::new(1)`, actual services `first`/`second` over the declared map,
frame 0, owned per-service budgets 5):

| Step | Actual entry | Caller left after | `first` (searches,hits,fallbacks) | `second` (…) | owned `first`/`second` |
| --- | --- | ---: | --- | --- | --- |
| 1 | `first.walk_with_budget` near `(400,400)→(400,500)` | 0 | (1,0,0) | (0,0,0) | 5 / 5 |
| 2 | `first.path` owned (shared cache, no debit) | 0 | (1,1,0) | (0,0,0) | 5 / 5 |
| 3 | `first.walk_with_budget` near (fresh hit) | 0 | (1,2,0) | (0,0,0) | 5 / 5 |
| 4 | `first.path_with_budget` near (fresh hit) | 0 | (1,3,0) | (0,0,0) | 5 / 5 |
| 5 | `second.walk_with_budget` near (no cache, exhausted → fallback) | 0 | (1,3,0) | (0,0,1) | 5 / 5 |
| 6 | `second.path_with_budget` near (fallback → `None`) | 0 | (1,3,0) | (0,0,2) | 5 / 5 |
| 7 | both `set_frame(50)` | 0 (no replenish) | unchanged | unchanged | 5 / 5 |
| 8 | caller `start_tick` | 1 | — | — | 5 / 5 |
| 9 | `first.walk_with_budget` far `(16,16)→(80,400)` (granted search) | 0 | (2,3,0) | (0,0,2) | 5 / 5 |
| 10 | `second.walk_with_budget` far (no cache, exhausted → fallback) | 0 | (2,3,0) | (0,0,3) | 5 / 5 |
| 11 | caller `PathBudget::clone().start_tick()` | 0 (clone left 1; caller not refilled) | — | — | 5 / 5 |
| 12 | `first.walk` owned new key (search spends owned only) | 0 | (3,3,0) | (0,0,3) | 4 / 5 |
| 13 | `second.path_with_budget` far (still exhausted, still no cache) | 0 | (3,3,0) | (0,0,4) | 4 / 5 |
| 14 | caller `start_tick`, `second.walk_with_budget` near (granted search) | 0 | (3,3,0) | (1,0,4) | 4 / 5 |

Asserted answers there, not just absence of panic: near search/hit `dist=64, exact:true` and cached path `[(400,464)]`
(source row values); near fallback `dist=130, exact:false`; far search `dist=282.509668, exact:true` (source r6 value);
far fallback `hypot(64,384)*1.3, exact:false`; owned new-key walk `None` (existing empty-path answer) with the owned budget
5→4. These pin the release conditions: no owned-budget debit on borrowed calls, no per-service caller refill, no shared
cache between distinct services, no cache-hit debit, and a clone not sharing the remaining allowance.

## Existing behavior limits carried unchanged (not released here)

- Public owned behavior is preserved exactly: `RoomPathService::new/budget/budget_mut/walk/path/los/clear/collision_map/
  set_frame/stats`, `PathBudget::new/start_tick/take/left/Clone`, the 1 s cache key/freshness, 8 s stale window, prune sweep,
  stats counters and the straight-line×1.3 fallback are untouched; the owned parity test is unchanged and still passes
  against the unchanged fixture.
- The new entries are crate-private call plumbing only; nothing consumes them yet in the crate. They carry
  `#[cfg_attr(not(test), allow(dead_code))]` until the later Brain path-adapter packet lands, so non-test builds stay
  warning-clean under `-D warnings` (verified by gates 05/06).
- Cache identity is still bound to each actual `RoomPathService` handle, never to a Brain instance; this packet invents no
  Brain/config identity, does not reset caller services, and does not add a config/service registry.
- Not released/admitted by this evidence: full private Brain composition/replay, Strategy/Tactics/Modules/Memory/Hand
  changes, persistent `Send` callback migration, live/persistent runner budgets, publication/identity providers, gate-map or
  precision broadening, hosted bots and deployment.

## Seal instructions for Root

The candidate is the exact scoped, uncommitted change set above (one tracked modification, one new test file, this evidence
directory); raw receipts and the full diff are bound in [`receipts/`](receipts/) and
[`receipts/09-final-diff.patch`](receipts/09-final-diff.patch). Final hashes are in
[`receipts/10-final-scope-hashes.txt`](receipts/10-final-scope-hashes.txt). No git commit, index write, shared-status record,
`Cargo.lock` or permission change was attempted; `target/path-budget-build` is ignored build output outside the candidate.
