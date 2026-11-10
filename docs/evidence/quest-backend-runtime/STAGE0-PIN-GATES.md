# Stage0 pin and gate follow-up

Status: PINS APPLIED, REQUESTED GATES GREEN, FINAL TWO-CASE CONSUMER GREEN.

## Exact pin diffs

1) parity/abilities/hash-tape.json:258
- "contentHash": "7c6a633f68c2cc72",
+ "contentHash": "8edd862f48ffa100",
File SHA256 after: 9df7ffb87d81062d513257f17efe6e003fab047fc62d0177e7f8396e1ca3d4c4
Raw diff: stage0-content-pin.diff

2) crates/rh-sim/tests/content.rs:522 (authorized exact literal only)
-const GOLDEN_CONTENT_HASH: u64 = 0x7c6a_633f_68c2_cc72;
+const GOLDEN_CONTENT_HASH: u64 = 0x8edd_862f_48ff_a100;
File SHA256 after: 5e8c9de391b2d5b5a21ec1e3acb80dd4ede7b8c547847a73415573abf874e190
Raw diff: stage0-content-golden-pin.diff

No case fold/ticks/schema/other corpus was edited. record_ability_hash_tape was NOT run.

## Gates on final tree

Target: /Users/nevinmckinnon/.codex/tools/roguehalla-backend-20261109/target-quests
Env: PATH=$HOME/.cargo/bin:$PATH, CARGO_TARGET_DIR=target above, CARGO_BUILD_JOBS=1,
CARGO_NET_OFFLINE=true, all commands with --locked --offline.

- cargo test -p rh-sim --lib abilities::source_tests::hash_tape::ability_hash_tape_matches_the_base
  1 passed, 0 failed, 0 ignored; all63 unchanged cases match. Raw: stage0-pin-hash-tape.log
- cargo test -p rh-sim --test content
  21 passed, 0 failed, 0 ignored. Raw: stage0-content-full-gate.log
- cargo test -p rh-sim --lib quest_view::
  26 passed, 0 failed, 0 ignored. Raw: stage0-quest-view-gate.log
- cargo test -p rh-sim --test checkpoint a_checkpoint_names_its_content_and_build_and_refuses_other_content
  1 passed, 0 failed, 0 ignored. Raw: stage0-checkpoint-content-mismatch.log
- cargo test -p rh-sim --test replay a_replay_names_its_build_and_a_file_without_the_new_keys_still_verifies
  1 passed, 0 failed, 0 ignored. Raw: stage0-replay-content-mismatch.log
- cargo clippy -p rh-sim --all-targets --all-features --locked --offline -- -D warnings
  exit0. Raw 199-byte PASS: stage0-clippy-all.log
- cargo fmt -p rh-sim -- --check
  exit0, empty output. Raw: stage0-fmt-check.log
- cargo test -p rh-sim --lib quests::tour_supply_source_tests
  final code: 2 passed, 0 failed, 0 ignored (both expected statuses). Raw: stage0-profile-green-final.log

## Preserved original failures / honest overwrite note

- stage0-content-pin-expected-failure.log: first hash-tape failure at the old contentHash pin.
- stage0-content-golden-pin-scope-failure.log: original content.rs GOLDEN_CONTENT_HASH failure
  (content_hash is now 8edd862f48ffa100) before the separately authorized literal edit.
- stage0-clippy-frameregions-firstfailure-raw.log, stage0-fmt-frameregions-firstfailure-raw.log,
  stage0-consumer-frameregions-firstfailure-raw.log: raw first failures from the transient remaining
  FRAME_REGIONS reference after the unregistered const was removed.
- stage0-fmt-postcontent-firstfailure-raw.log: raw fmt failure (missing trailing newline) after the
  content follow-up, preserved then fixed.

Historical first failures whose raw files were overwritten before this follow-up:
- The first strict clippy run failed clippy::extend_with_drain at
  tour_supply_source_tests.rs:927; changed to append. Its raw log was later overwritten by the PASS log
  and is not available. It is documented here and was not reconstructed.
- The first full content target run failed every_const_in_the_source_tree_is_registered_or_explained
  because the test's top-level FRAME_REGIONS const was not content-registered; the const was removed
  (local literals only). Its raw log was later overwritten by the PASS log and is not available; it was
  not reconstructed.
Earlier preserved red/green and Stage0 gate logs remain unchanged; the prior final green log at the
pre-follow-up tree is recoverable from Stage0 commit 4fb5714e93386b6e7daa08ab3bf405888331c263.

## Limits

Stage1 remains NOT STARTED pending independent release of this Stage0+pin composition. No schema/public/
client/Unity/Claude/shared-status/Cargo.lock edit, no source fixture/tool edit, no heavy unchanged suite or
all-map rerun, no merge/push, no gameplay expectations changed.
