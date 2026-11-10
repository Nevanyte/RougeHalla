# PathBudget borrowed allowance bridge — independent review

Disposition: **RELEASE for the bounded path-service bridge** at the exact seal below. This admits only the borrowed
allowance plumbing and its scoped tests; it does not activate the later Brain path adapter or prove full Brain, live,
headless, or hosted behavior.

## Exact reviewed seal

- Worktree: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-path-budget`
- Branch: `codex/deepseek-path-budget`
- Commit: `5d351cb559412aaa15b0d3644639b1d9ec722c9f` (`Share caller path allowance through the existing path service core`)
- Commit parent/base: `374033999c3aa9bd4cfc1e002d243786879c4a7b`
- Worktree was clean at inspection.
- Production file SHA-256: `5080560d0d18fd0678e63a404e99a31a930aea47ed06bc75bf832694a1c7d273`
- New test file SHA-256: `05094723de942f61d9b4a9f980d75182b6e230604d47a8ce933e23e37f68ac1c`
- The 14-file commit scope is listed in the candidate evidence README and bound by the committed file inventory/diff
  receipts. Root independently confirmed the exact production and test hashes against that receipt.

I did not run tests. I read the complete production delta, the new two-test module, the candidate README and retained
receipts. This review is independent inspection of those code/results, not a fresh reproduction.

## Correctness review

The implementation keeps one `RoomPathService::trip` transition. Existing `walk` and `path` call the shared private
entries with `None`; new crate-private `walk_with_budget` and `path_with_budget` call the same entries with the caller's
`&mut PathBudget`. `trip` checks the fresh per-service cache before selecting an allowance, and only calls `take()` at
the former owned-budget debit point. An owned call takes from the original service field; a borrowed call takes from
the borrowed allowance. Neither budget is copied, swapped, replenished, or stored in the service.

The unchanged order remains: finite-input guard, fresh cache hit, chosen-budget debit, search and cache update, stale
cache answer if the debit is denied, then fallback and stats. `set_frame` still does not reset a budget. LOS, clear,
collision map, and other service state remain outside this debit path. Existing `new`, `budget`, `budget_mut`, owned
`walk`/`path`, and `PathBudget` value/clone APIs are unchanged. The patch is limited to `paths.rs`, one new scoped test
module, and its evidence directory; `Cargo.lock` and the frozen source fixture are unchanged.

The new source-script test reads the unchanged `bot-tactics.json` captured rows as comparisons. It drives 94 declared
rows, including 23 borrowed walk/path rows, while asserting the caller allowance and owned budget after each step. Its
comparison retains the legacy source fixture's `r6` distance convention; this is not a newly widened tolerance. The
second test exercises actual distinct service instances sharing a single caller allowance in sequence. It checks
fresh-cache hits before debit, fallback when the second service has no matching cache, external reset only through the
caller, owned calls spending only their owned allowance, and clone independence.

## Evidence reviewed

Candidate evidence is committed at `docs/evidence/bot-path-budget-native/README.md` and its receipts. Reported focused
results are:

- `cargo test -p rh-policy --lib bots::paths --locked --offline -j 2`: 3 passed, including the unchanged owned parity
  test and both new tests.
- The unchanged owned path parity test separately: 1 passed.
- `cargo fmt -p rh-policy -- --check`: exit 0.
- Strict Clippy default and `--all-features`, with `--lib --tests -D warnings`: exit 0 for both.
- The committed evidence binds source fixture identity, toolchain, commands, raw logs, final diff and file hashes.

These are the author's recorded executions, not reruns by this reviewer. The changed API is crate-private and currently
has no non-test caller; the subsequent Brain adapter must still consume it with one caller-owned room allowance and
preserve the intended service-handle/cache identity. That downstream work is outside this release.

## Root integration check

Root integrated seal `5d351cb5` as `07babf29e6f3d65c7e0951f32359cb4e88ef6c88`, preserving both exact source
hashes above, then ran `cargo test -p rh-policy --lib bots::paths --locked --offline -j 1` on the combined backend.
Result: **3 passed, 0 failed, 232 filtered**, exit0; test0.00s, wall30.02s including compile. The adjacent
`root-integrated-test.log` records command/cwd/HEAD and raw output. Pinned Rust1.97, incremental0, no RUSTFLAGS,
existing Root target `target/root-strategy-notice-admission/build`. This checks the new borrowed tests and unchanged
owned source parity after integration with Hand and potion proof; other author gates are not relabelled as reruns.
