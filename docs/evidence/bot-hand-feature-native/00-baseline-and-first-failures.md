# Baseline transcript and preserved first failures

Recorded for P-BOT-HAND-FEATURE-1 (`docs/evidence/bot-hand-feature-native/README.md`). Kept so the failure history is not
erased by the final green receipts: every command below was actually run in this worktree, and none was silenced by
relaxing a gate. Times are wall-clock as printed by Cargo; exits are the shell exit of the exact command.

## Environment

- Worktree: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-hand-feature`, branch
  `codex/deepseek-hand-feature`.
- Pre-change HEAD: `dcb33d15c919bc0f70101e446b5106165234ad67` (clean tree; packet-only allocation commit).
- Post-source-transfer HEAD: `90b191b3` ("Capture complete private Brain source composition", cherry-pick from Root; the
  Rust WIP below was preserved).
- Toolchain: `cargo 1.97.0 (c980f4866 2026-06-30)`, `rustc 1.97.0 (2d8144b78 2026-07-07)`, pinned by
  `rust-toolchain.toml`; Rust installed at `/Users/nevinmckinnon/.cargo/bin/cargo`.
- Every Rust command: worktree root cwd,
  `CARGO_TARGET_DIR="$PWD/target" CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
  CARGO_NET_OFFLINE=true`, `--locked --offline -j 1`, own worktree-local target.

## Baseline before any edit (old hand/core overlap)

```sh
cargo test -p rh-policy --lib --locked --offline -j 1 bot_core_humanizer_matches_source
```

Exit 0. Build finished in 1 m 08 s; `running 1 test`; `test bots::parity_tests::bot_core_humanizer_matches_source ...
ok`; `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 219 filtered out; finished in 0.02s`. The clean
baseline of the complete `rh-policy` lib suite was 220 tests (later 228 = 220 + 8 new).

## First failures and repairs (exact messages)

1. **Full-workspace metadata probe over an incomplete shared cargo cache (not a gate).**
   `cargo metadata --offline --locked --format-version 1 -q` → exit 101:
   `error: failed to download 'android_system_properties v0.1.6'` / `Caused by: attempting to make an HTTP request, but
   --offline was specified`. This is metadata over the whole workspace (platform deps are resolved too); the shared
   registry cache lacks that crate. The leased target builds and tests fully offline with `-p rh-policy` (baseline above
   and every receipt in `README.md`), so this is recorded as an environment limitation of the full-workspace probe, not
   as a passing/failing gate of this packet.

2. **Strict default Clippy, first run — `clippy::unnecessary_mut_passed`.** Exit 101:

   ```text
   error: the function `release` doesn't need a mutable reference
      --> crates/rh-policy/src/bots/humanizer/feature_tests.rs:538:36
       |
   538 |     let released = release(&mut h, &mut release_at, &mut motor, &mut lapse);
       |                                    ^^^^^^^^^^^^^^^
   ```

   Repaired by passing `&release_at` (the binding stays `mut` only for its `now` assignment). This was a test typo, not
   a behavior change.

3. **Strict default Clippy, second run — `clippy::type_complexity`.** Exit 101:
   `error: very complex type used. Consider factoring parts into `type` definitions` (the reader-negative mutation
   table `Vec<(&str, Box<dyn Fn(&mut Value)>)>`). Repaired with the test-local `type CorpusMutation = (&'static str,
   Box<dyn Fn(&mut Value)>);`. Both strict modes then pass (`logs/06`, `logs/07`).

4. **Strict sealed-source reader integration failures (implementation iterations, before the final reader).** The
   first real runs of the new comparison failed exactly, in order:
   - `strict sealed hand source reader: source.maps.open.value: unexpected member terrain` — the declared open arena is
     a full `GameMap` (19 members), not just `seed/w/h/tiles`; the reader now validates every declared member and only
     builds `BotMap` from the collision layer.
   - `strict sealed hand source reader: source.handSupplement[0].seeds: missing $ tag` — `seeds` is declared as a plain
     JSON input descriptor, not a tagged method value; a raw-u32 reader replaced the tagged one.
   - `strict sealed hand source reader: source.handSupplement[0].operations[0].counts: missing $ tag` — same for the
     recorded per-lane counts.
   - Negative-control run panicked at `tagged object entries` — the "renamed profile" mutation targeted a raw profile
     object with the tagged-object helper; corrected to a direct raw assignment. All 13 malformed-declaration controls
     then pass (`logs/03`).
   These are recorded because they are real first failures of the intake, not because any gate was softened: the final
   reader is strictly stronger (closed records, full tier/map validation, contiguous indices, counts cross-checks).

5. **Semantic mutation controls (expected kills, not defects).** Deliberate mutations of the new gate, run on
   disposable edits and reverted:
   - `logs/08`/`logs/10`: check moved from the start of `offer` to after draw/offer bookkeeping → exit 101; the sealed
     source comparison plus four semantic tests fail (the empty/attack-only profiles expose the missing rejection).
   - `logs/09`/`logs/11`: lock gated by the later conversion `"attack"` instead of the mapped `"target"` → exit 101;
     the lock/target-vs-attack test and the sealed source comparison fail (`target-only`/`partial` profiles).
   - `humanizer.rs` was restored after each run and hash-verified before continuing; no mutation text remains.

## Final receipts (final bytes)

`logs/02` old bot-core 5/5 pass · `logs/03` 8 new tests pass · `logs/04` 228 `rh-policy` lib tests pass ·
`logs/05` fmt clean · `logs/06` + `logs/07` strict Clippy (default, all-features) clean. Raw outputs are committed as
`*.log` receipts (force-added because `.gitignore` ignores `*.log`; the existing evidence directories do the same).

## Seal attempt (git metadata unavailable to this session)

`git add` of the candidate files from the worktree root exited 128:

```text
fatal: Unable to create '/Users/nevinmckinnon/Documents/Projects/RogueHalla/.git/worktrees/backend-bot-hand-feature/index.lock': Operation not permitted
```

Cause: the worktree's common git directory is outside the session workspace and the Workspace Write policy refuses
writes there. Per the dispatch (“seal if git permitted or else Root seals; no permission expansion”), no wider sandbox
mode was requested, the failed command was not retried, and no commit/merge/push was attempted. The index is unchanged
(`git status` shows only ` M` / `??`); Root seals the exact inventory in `README.md`.
