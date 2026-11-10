# Command, environment and failure receipts

## Environment (unchanged for every run)

| Fact | Value |
|---|---|
| Worktree | `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-modules` |
| Branch | `codex/deepseek-private-modules` |
| Base / dispatch HEAD | `9f74ff3e87461ff31f84720240455d6ef33f420b` (admitted backend `dedb8658` + Root dispatch) |
| Toolchain | Rust 1.97.0 (`rustc 1.97.0 (2d8144b78 2026-07-07)`, `cargo 1.97.0 (c980f4866 2026-06-30)`) via `/Users/nevinmckinnon/.cargo/bin/cargo` |
| Cargo dir | worktree-local `target-deepseek-private-modules` (teammates used their own `target-lane-*` dirs; other processes' targets untouched) |
| Build flags | `--locked --offline -j1`, `CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0` |
| Frozen source pins | corpus 12,755,158 B SHA-256 `645e85f1…b012`; coverage `50eaf16f…dea0af`; controls `dcc49cf8…d3980d`; manifest `fe8fe10f…5ab016`; source candidate `d48b79bf` + review `63f6fda8` |
| Root bridge allocation | `de908f2b` (read via `git show`; docs copied into this worktree's evidence record only) |
| Repo writes | only the packet-owned new files + five leased existing files (see BRIDGES.md/CANDIDATE.md); no `Cargo.lock`, dependency, shared status, source/golden/tool/corpus, World/Sim/protocol/client change |

## Final gates (exact commands and exits)

```sh
cd /Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-modules
export CARGO_TARGET_DIR=$PWD/target-deepseek-private-modules CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
C=/Users/nevinmckinnon/.cargo/bin/cargo

$C test -p rh-policy --lib --locked --offline -j1 frozen_private_modules_source_replay -- --nocapture
# exit 0 — PARITY_TOTAL bot-private-modules : 255 cases / 3259 ops (corpus 3259) / 0 failures
#          test result: ok. 1 passed; 0 failed
# (real 43.03 s in the recorded timed run, includes test-binary build in the cold case)

$C test -p rh-policy --lib --locked --offline -j1
# exit 0 — test result: ok. 354 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
# (finished in 280.92 s; wall real 281.70 s)

$C test -p rh-policy --lib --locked --offline -j1 controls_tests::
# exit 0 — ok. 28 passed; 0 failed

$C test -p rh-policy --lib --locked --offline -j1 source_input::
# exit 0 — ok. 5 passed; 0 failed

$C test -p rh-policy --lib --locked --offline -j1 send_assertions::
# exit 0 — ok. 1 passed; 0 failed (Registry/CustomModule/four built-in state types Send)

$C clippy -p rh-policy --lib --tests --locked --offline -j1 -- -D warnings
# exit 0 (no warnings)

$C clippy -p rh-policy --lib --tests --all-features --locked --offline -j1 -- -D warnings
# exit 0 (no warnings; rh-policy declares no features so this is the strict default profile too)

$C fmt -p rh-policy -- --check
# exit 0 (formatting-only; no source of any other crate touched)
```

Exact per-filter overlap receipts are in [OVERLAPS.md](OVERLAPS.md) (planning_parity 6/6, wish_parity 6/6,
wish_module 8/8, old hazards 4/4, bot hand 17/17, Memory 13/13, Strategy source 11/11, parity 31/31,
knowledge 4/4, paths 1/1, view 4/4, mob-hunt 5/5, knowledge-repair 3/3; new module groups: catalog 4, planning-core 5,
reader 5, trace 25, controls 28, Send 1, replay 1; every filter exit 0).

## Development failure history (kept; no expectation was edited)

Each first failure was fixed in native code/reader or by a mechanically correct input-shape fix; no tolerance, no
expected-value change, no skipped case.

1. `source.cases[93].configs.a.learned.entries[0][1]: nonfinite declared number is outside the finite source profile` —
   reader's finite exemption for the two source-sanitized learned-bias surfaces; fixed in the strict reader.
2. `source.maps[0].value`: embedded GameMap DTO mismatch during an in-flight reader state; reader map conversion pinned by
   `mapHashU32` recomputation and 8/8 maps validated.
3. `source.cases[248] … mobs[0].type`: captured own-`undefined` mob `type` — normalized to the admitted Memory reader's
   identical read (source output drops `undefined` for both absent and own-`undefined`; expected snapshot is identical).
4. `source.cases[10].operations[75].declaration.args.self: missing consumed fact faction` — per-HelperName self shapes
   (`activeWeapon` requires only `weapons`; card-choice/choose require faction+weapons+build; slot/risk optional).
5. Replay `contexts` keyed by cfg id (`me`) instead of the declared cfg token (`a`/`b`).
6. Planning adapter panic `a directive requires a deal` on the no-deal Ready branch (deal read scoped only to spawn
   directives).
7. Registry `policyGet` absent/absent identity: source `getCastPolicy() === policyValue` is `null === null` → `true`.
8. Root pre-seal `Send` correction: `Rc` → `Arc<dyn Fn + Send + Sync>` persistent registry callbacks, with the custom
   `enabled` capture moved to a thread-safe channel appended to the ordered trace; replay/controls re-run green.

Earlier lane-level red windows existed only from concurrent in-flight files (other DeepSeek lanes in the same workspace);
the final tree was frozen before the gates above.

## Reproduce

```sh
cd /Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-modules
CARGO_TARGET_DIR=$PWD/target-deepseek-private-modules CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  /Users/nevinmckinnon/.cargo/bin/cargo test -p rh-policy --lib --locked --offline -j1 -- --nocapture
```
