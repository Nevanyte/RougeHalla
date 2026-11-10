# Stage1 private continuation invocation metadata

Sanitized reference only. Private root:

  $PRIVATE_STAGE1_COMPARE = ~/.codex/tools/roguehalla-backend-20261109/quest-stage1-compare

Machine-readable private receipt: $PRIVATE_STAGE1_COMPARE/transcripts/continuation-commands.json
This evidence file intentionally contains no checkpoint, state hash or transcript content.

## Exact retained runs

The continuation runs predate final seal 9f3e9502. Baseline was immutable 36564c33; candidate used the pre-cleanup
Stage1 inventory below. Final 9f3e9502 is the separately reviewed no-op identity-conversion/format delta.

Pre-cleanup candidate code used by these runs:
- live.rs af48b280022b30428d9a6d1548e9467ba9cebf8cc127140d88001d63c8a52ef4
- mod.rs fded335464ea83787de4937b54825c8300af615197881627350ce1bca22f4557
- objectives.rs 80cdbb391ea7a13094a17b1287b6c80f998deb7572af99d6d01b89366767fdfd
- rewards.rs a35af0afd927c43ddcbb1a2fb9ffe19a84174df41d6b0dec099237b1c3fa4371


Baseline:
- cwd: $PRIVATE_STAGE1_COMPARE/baseline
- command: cargo test -p rh-sim --lib stage1_ --locked --offline -- --nocapture
- redirection: > $PRIVATE_STAGE1_COMPARE/transcripts/continuation-baseline-run.log 2>&1
- env: PATH=$HOME/.cargo/bin:$PATH;
  CARGO_TARGET_DIR=~/.codex/tools/roguehalla-backend-20261109/target-quests;
  CARGO_BUILD_JOBS=1; CARGO_NET_OFFLINE=true;
  RH_QUEST_STAGE1_NORMAL_CONTINUATION_DIR=$PRIVATE_STAGE1_COMPARE/transcripts/continuation-baseline;
  RH_QUEST_STAGE1_CONTINUATION_DIR=$PRIVATE_STAGE1_COMPARE/transcripts/continuation-baseline
- exit: 0
- terminal: 2 passed; 0 failed; 0 ignored; 847 filtered out; finished in 20.73s
- retained log: 624 bytes

Candidate (pre-cleanup Stage1 inventory):
- cwd: $PRIVATE_STAGE1_COMPARE/candidate
- command: cargo test -p rh-sim --lib stage1_ --locked --offline -- --nocapture
- redirection: > $PRIVATE_STAGE1_COMPARE/transcripts/continuation-candidate-run.log 2>&1
- env: same PATH/CARGO_TARGET_DIR/CARGO_BUILD_JOBS/CARGO_NET_OFFLINE;
  both RH_QUEST_*_DIR values point at .../transcripts/continuation-candidate
- exit: 0
- terminal: 2 passed; 0 failed; 0 ignored; 847 filtered out; finished in 20.03s
- retained log: 625 bytes

## Toolchain / provenance caveat

The retained continuation logs contain only Cargo/test terminal output; they do not embed an invocation envelope.
The cwd/env/command/redirection values above are recovered from the actual tool calls that produced those logs.
Toolchain identity was queried after the runs, not captured in the continuation logs: cargo 1.97.0
(c980f4866), active toolchain 1.97.0-aarch64-apple-darwin overridden by backend-quest-runtime/rust-toolchain.toml,
rustc 1.97.0 (2d8144b78), binary commit 2d8144b7880597b6e6d3dfd63a9a9efae3f533d3. No run-time field is claimed.
Private transcripts/checkpoints remain outside Git.