# Scoped candidate manifest — P-QUEST-ROOM-DELIVERY-1 (worker handoff to Root)

Worker: DeepSeek (Rust/tests). Root owns scope, seals and admission. **No commit, merge, push, deploy or shared-status
edit was made by this worker**; the paths below are the exact remaining working-tree candidate for Root to seal/commit.

## Identity

- Worktree: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-quest-room-delivery`
- Branch: `codex/deepseek-quest-room-delivery`
- Base HEAD (clean before and after every run): `9ee84dfe3fa35cfdefc4b6cabaf4b9091db6a24c`
- Toolchain: `/Users/nevinmckinnon/.cargo/bin/cargo` and Rust/Cargo 1.97.0 (`c980f4866` / `2d8144b78`), pinned by
  the worktree `rust-toolchain.toml`.
- Run environment: `CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=target-deepseek-quest-room-delivery
  CARGO_NET_OFFLINE=true CARGO_BUILD_JOBS=1`, plus `--offline --locked -j 1` on every Cargo command.
- Frozen read-only witnesses are unchanged: `parity/quest-room-feedback/source.json`
  `977450a6e0e1a1fcc3bd135edf7ebe6291f10d4da7aef98a44fc76b5886bd978`; `parity/quest-giver/source.json`
  `039d4e058fa914f42080f1c55d8640cc508c5b4745504930ca3db49579adc8b4` (the oracle's `input.sha256`);
  `parity/arena/source.json` `6ff324e134127d9c84a4f4383965f11e08a108fbe306424b1547795265adf6f5`.

## Exact changed paths

| Path | State | Detail | SHA256 |
| --- | --- | --- | --- |
| `crates/rh-server/src/quest_bridge_tests.rs` | modified, additive only | **+790 / −0** (single tracked-file diff) | `3a02b4097a583c8662bd06d54a6979836c469139cf369f32aad281f419fe0b6b` |
| `docs/evidence/quest-public-completion-room-delivery/README.md` | new | delivery/limitation record | `c292a5d6e6136ac9f8fc1c66c1b02b5ae9737c9a419f5329c112f47f2a660118` |
| `docs/evidence/quest-public-completion-room-delivery/working-tree.diff` | new | exact tracked diff of the leased file (`git diff -- crates/rh-server/src/quest_bridge_tests.rs`) | `33bf1b525637560ee30de590a7f1376ce886feed3d7591ec7071cf80e61d54be` |
| `docs/evidence/quest-public-completion-room-delivery/logs/01-focused-proof.log` | new | focused proof, 1 passed/0 failed, exit 0 | `aa2b807801cc222dd46ca1b0212f894dee8245db54f7e01ab27d1c69b430dcb8` |
| `docs/evidence/quest-public-completion-room-delivery/logs/02-quest-bridge-regressions.log` | new | unchanged 4 regressions + new test, 5 passed/0 failed, exit 0 | `44d6bf3e425e0eb217cfc136be767e75d6c64738e100b5a8fcd540acba36b56c` |
| `docs/evidence/quest-public-completion-room-delivery/logs/03-fmt-check.log` | new | `cargo fmt -p rh-server -- --check`, exit 0 | `3fbe6cc2e86ea105fc7e67b1da59e851b99ef57db1a0fe643516bee4a5eba877` |
| `docs/evidence/quest-public-completion-room-delivery/logs/04-clippy-default.log` | new | strict default all-targets clippy, exit 0 | `f07111d3c75cff2ee69e7d2ff392d737fab1f1ceb72ae6d94de945227de6fe79` |
| `docs/evidence/quest-public-completion-room-delivery/logs/05-clippy-all-features.log` | new | strict all-feature all-targets clippy, exit 0 | `3ce92b93698098b4dc288e7fc3f13a651ee04a5633ee36b0737eecb8540e4a1f` |
| `docs/evidence/quest-public-completion-room-delivery/logs/06-focused-proof-repeat.log` | new | focused proof repeat, identical proof lines, exit 0 | `8d9d6cb6345f906e63358423915a799b7bc89ed3653712739ad4f1e5922137d1` |
| `docs/evidence/quest-public-completion-room-delivery/logs/07-identity.log` | new | final identity/status/hash receipt | `0ba300e1c358bda89cdca8ccf573a27fc9a0cfebacab1a0dba2bc32b315b2fd9` |
| `docs/evidence/quest-public-completion-room-delivery/logs/08-fresh-target-rebuild.log` | new | focused proof on a second from-scratch target dir (removed afterwards), exit 0 | `b3628eafb767f4d3d2f57274079c4fc734856cc5958ac7e59efe7819193824b5` |
| `docs/evidence/quest-public-completion-room-delivery/logs/first-failure-objectives-assert.log` | new | preserved first real test failure | `3c124c00a6ad7989f88e9f907aabbcd4336de766bf7d4083f5742a94306265dd` |
| `docs/evidence/quest-public-completion-room-delivery/logs/clippy-firstfailure-default.log` | new | preserved first strict-clippy failure | `8ebb9ce3dc7b84412a694b5a817514169924f770c73c08cae9f794d1c5eba89e` |
| `docs/evidence/quest-public-completion-room-delivery/logs/clippy-firstfailure-all-features.log` | new | preserved first strict-clippy failure | `4c0be648f62f135652a24493f5de5a441d69a042d321bac292efb2831d0a18fa` |
| `docs/evidence/quest-public-completion-room-delivery/logs/09-final-manifest.log` | new | raw generated manifest receipt | generated last; self-excluded from the hash list |

`scoped-manifest.md` and `logs/09-final-manifest.log` were generated last and deliberately exclude their own hashes.
`target-deepseek-quest-room-delivery/` is an untracked build cache and is **not** part of the candidate or seal; no
target/cache/binary path is included above.

## Root staging (logs are covered by the repository's `*.log` ignore rule)

```
git add crates/rh-server/src/quest_bridge_tests.rs
git add docs/evidence/quest-public-completion-room-delivery
git add -f docs/evidence/quest-public-completion-room-delivery/logs
```

`git status --porcelain=v2` before handoff (full text in `logs/07-identity.log`):

```
1 .M N... 100644 100644 100644 1cf18408bb217f3d84649a67fa0cd873bd39d3cc 1cf18408bb217f3d84649a67fa0cd873bd39d3cc crates/rh-server/src/quest_bridge_tests.rs
? docs/evidence/quest-public-completion-room-delivery/
? target-deepseek-quest-room-delivery/
```

## Verification summary (raw logs in `logs/`)

- Focused proof `room::quest_bridge_tests::quest_room_earned_shards_completion_delivers_exact_owner_and_foreign_toasts`:
  1 passed / 0 failed, exit 0, twice with identical proof lines; native completion tick `1386`, `69300 ms`; owner
  Toast vector exactly the four frozen-oracle rows and foreign exactly the one public row, both stamped `1386`.
- Unchanged `quest_bridge` module: 5 passed / 0 failed, exit 0 (four pre-existing tests unchanged plus the new one).
- `cargo fmt -p rh-server -- --check`: exit 0.
- Strict `cargo clippy -p rh-server --all-targets -- -D warnings`: exit 0.
- Strict `cargo clippy -p rh-server --all-targets --all-features -- -D warnings`: exit 0.
- No production hunk is needed; no constructor, publisher, wire, rule or profile change was made or proposed.
