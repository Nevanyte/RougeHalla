# Strategy composition bridge — native implementation receipt

2026-11-10. DeepSeek-authored Rust/test implementation of the independently released bounded bridge in
[P-BOT-STRATEGY-COMPOSITION-BRIDGE-1](../../backlog/packets/P-BOT-STRATEGY-COMPOSITION-BRIDGE-1.md), bound by the released
[bridge plan review](../bot-strategy-composition-bridge-review/README.md) (plan cut `afdb13ac`, final documented release
`bed245bd`). This receipt covers the completed, locally tested candidate. It is **not** a commit, seal, admission or live
activation; Root owns scope/review/git/integration and seals the final candidate. No Claude communication, no Sol/Luna
handoff, no non-Rust file and no source/corpus/tool/expectation change occurred.

## Identity and inputs

| Item | Value |
|---|---|
| Worktree | `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-bot-strategy-composition` |
| Branch / clean start | `codex/deepseek-strategy-composition` @ `bed245bd9c1a966d61dc449335f97f1102ec4555` (clean before edits) |
| Packet (released bytes) | 10,117 bytes / SHA-256 `3bf77a840291c4ca32f0a2abb3d26acd646271830ac7aadfdc293bd9601aff87` |
| Binding review README | SHA-256 `f0e7ea27b095f573730507cb6049518e2441a83871e38f60c469c22cdf96fd07` |
| Plan evidence README | 5,952 bytes / SHA-256 `a4d65b5d542994897c52dd0ea9a2dc798c81a74a70949fa77394d61f235316cb` |
| Toolchain | pinned Rust `1.97.0` (`rust-toolchain.toml`); `cargo 1.97.0 (c980f4866 2026-06-30)`, `rustc 1.97.0 (2d8144b78 2026-07-07)` |
| Cargo contract | `/Users/nevinmckinnon/.cargo/bin/cargo`, `--locked --offline -j1`; `CARGO_INCREMENTAL=0`; isolated ignored target `target/strategy-composition-build` |
| Start-state and scope checks | `logs/baseline-head.txt`, `logs/scope-checks.txt` |

## Scoped production bridge (3 existing files)

| File | Exact change |
|---|---|
| `crates/rh-policy/src/bots/temporal_percept/strategy/types.rs` | `AttackFn = Arc<dyn Fn() -> bool + Send + Sync>`, `LogFn = Arc<dyn Fn(&str) + Send + Sync>`; `FeatureModule::goals` context argument only changes `&StrategyContext` → `&mut StrategyContext`; `&self` receiver, empty default body, bounds and every other field/type unchanged. |
| `crates/rh-policy/src/bots/temporal_percept/strategy/mob_hunt.rs` | Default no-op `LogFn` built with `std::sync::Arc::new`; `new`/`new_with_log` timing, arguments and behavior unchanged. |
| `crates/rh-policy/src/bots/temporal_percept/strategy/engine.rs` | The sole existing module-goal call copies the immutable `modules`/`features` cfg references into locals and forwards the current `ctx: &mut StrategyContext` to `FeatureModule::goals`; enabled check, registration order, candidate normalization, dedupe/selection and RNG/callback order unchanged. |

`hunt_adapter.rs` and `build_route.rs` are **byte-identical to HEAD** (`logs/scope-checks.txt`): `HuntAdapter::new` already
passes `opts.log.clone()` (an `Arc` clone of the same allocation) into `MobHunter::new_with_log` while retaining `opts`;
`Strategy::decide` already passes `self.opts.attacking.clone()`/`log.clone()` into `HuntAdapterOptions`. No wrapper closure,
no independent allocation, no algorithm/type-visibility/path-service/Policy change. No `unsafe impl Send/Sync`, no
whole-Brain/Strategy lock, no new dependency, no duplicated engine or copied path-budget/RNG provider.

## Scoped test-support bridge (3 existing files)

| File | Exact change |
|---|---|
| `strategy/source_trace.rs` | `TraceHandle = Arc<Mutex<TraceLog>>` with `Arc::new(Mutex::new(...))`; `options_log`/`options_attacking` build the new aliases; recorder internals append/reset/copy owned data under short `lock().expect(...)` guards released before return; `TraceRng::draw` records under the same short guard; `RecordedModule::goals` adopts the mutable-context signature. A poisoned lock panics (no forged successful callback result). One shared ordered callback/RNG transcript preserved. |
| `strategy/private_strategy_tests.rs` | `CountingModule::goals` adopts the mutable-context signature. `private_strategy_attacking_instances_are_independent` persistent callbacks now capture `Arc<Mutex<Vec<_>>>` via `Arc::clone`; its six readout accesses become short `lock().expect(...)` guards. Two focused new controls (below). |
| `strategy/source_tests.rs` | Exactly the eight leased trace access expressions become short `lock().expect(...)` guards: two owned encoded snapshots (`non_advance_snapshot`, `fill_evidence`) and six resets dropped before dispatch. No reader/decoder/comparator/control/expected-value/fixture logic changed (see `candidate.diff`: only those eight expressions). |

Old → new access-site mapping (`source_tests.rs`; the six resets use the same one-line guard):
`2754 → 2750`, `2824 → 2825`, `2911 → 2912`, `3049 → 3050`, `3143 → 3144`, `3203 → 3204`, `3366 → 3367`, `3940 → 3941`.
Recorder accesses in `source_trace.rs`: `117/163/1342 → 120/167/1346`; independent-instance readouts in
`private_strategy_tests.rs`: current `1021/1023/1112/1121/1127/1132` (old `1014/1015/1101/1106/1110/1115`).

### New focused controls (both in `private_strategy_tests.rs`)

1. `private_strategy_actual_types_are_send_and_callbacks_share_state` — compile-time `Send` assertion for the actual
   `Strategy`, `HuntAdapter`, `MobHunter` (and `StrategyOptions`/`HuntAdapterOptions`), plus `Send + Sync` for the two
   callback aliases and their constructed values. Runtime: `Arc::ptr_eq` on cloned `options_log`/`options_attacking`
   handles proves one shared allocation, and the exact four-event ordered callback transcript (arguments, order, returned
   values) is compared, so the storage migration preserved behavior.
2. `private_strategy_module_goals_forward_same_mutable_path_and_decide_services` — drives the enabled module hook through
   the **actual `Strategy::decide`** module-goal stage. The hook makes one real `ctx.paths.walk` request at sentinel
   coordinates and consumes one draw from the declared mutable decide lane (`ctx.decide`), recording only what it saw. After
   the decision the test asserts the sentinel request landed **exactly once on the same caller-owned path service**, the
   draw value is one of the caller's declared overrides, and that value appears **exactly once in the shared ordered
   transcript at its own per-stream ordinal**, with each stream's recorded events equal to that stream's `draws()`. A
   read-only or copied provider/budget/stream would fail these assertions. This is plumbing evidence, not a module/source
   oracle; no production module or path-budget ownership is implemented here.

## Gates (final formatted candidate)

Baseline first, untouched `bed245bd` with the same isolated target, then the final candidate. Every command used
`--locked --offline -j1`, `CARGO_INCREMENTAL=0`, `CARGO_TARGET_DIR=target/strategy-composition-build`, and the pinned
`/Users/nevinmckinnon/.cargo/bin/cargo`.

| # | Command | Result |
|---|---|---|
| B1 | `cargo test -p rh-policy --lib bots::temporal_percept::strategy::private_strategy_tests ... -- --nocapture` | 11 passed, 0 failed, exit 0 (`logs/baseline-declared11.log`) |
| B2 | `cargo test -p rh-policy --lib bots::temporal_percept::strategy::source_tests ... -- --nocapture` | 11 passed, 0 failed, exit 0 (`logs/baseline-source11.log`) |
| B3 | `cargo fmt -p rh-policy -- --check` | exit 0 |
| 1 | `cargo test -p rh-policy --lib bots::temporal_percept::strategy::private_strategy_tests --locked --offline -j1 -- --nocapture` | **13 passed, 0 failed, exit 0** (`logs/final-tests.log`; unchanged declared 11 + the 2 new controls) |
| 2 | `cargo test -p rh-policy --lib bots::temporal_percept::strategy::source_tests --locked --offline -j1 -- --nocapture` | **11 passed, 0 failed, exit 0** (`logs/final-tests.log`); PARITY_TOTAL: 98 cases / 658 ops primary (tracker 1/14, hunter 24/127, route 17/36, memory 12/122, adapter 9/67, strategy 35/292) **+ 4 histories / 48 calls** module-goal-key supplement, 0 failures; strict reader/trace-negative/intake-non-advance controls included |
| 3 | `cargo fmt -p rh-policy -- --check` | exit 0, empty (`logs/fmt-apply.log`) |
| 4 | `cargo clippy -p rh-policy --lib --tests --locked --offline -j1 -- -D warnings` | exit 0 (`logs/clippy-bridge.log`) |
| 5 | `cargo clippy -p rh-policy --lib --tests --all-features --locked --offline -j1 -- -D warnings` | exit 0 (`logs/clippy-bridge.log`) |

The two filters are reported separately and never summed: declared filter 13 (old declared 11 + 2 new controls, all in
`private_strategy_tests`), source filter 11. Expected values remained comparison oracles only; no recapture and no answer
edit.

### First failures preserved, then repaired

- `logs/build-1.log` — first compile of the bridge edits: exit 101, two `E0061` errors because the new value-level
  Send/Sync helper was declared without its argument. Repaired before any candidate test run; `logs/build-2.log` exit 0.
- `logs/fmt-check-1.log` — first formatting gate: exit 1 on four rustfmt diffs in the new test code. `cargo fmt -p rh-policy`
  applied (`logs/fmt-apply.log`, exit 0) and re-checked clean; all gates above rerun on the formatted bytes.

## Final candidate hashes (for Root seal)

Six existing in-lease files are modified; `hunt_adapter.rs`, `build_route.rs`, `source_reader.rs`, `source_strict.rs` and all
other tracked files are byte-identical to HEAD. The only other new content is this evidence directory. No commit was made and
no git metadata was written; Root owns the seal.

| File | SHA-256 |
|---|---|
| `strategy/types.rs` | `f8e8118c72e50b87cd0fc599d2e30bb292530d620df0378b6fd11d579e83bad9` |
| `strategy/mob_hunt.rs` | `320fea0c1e38d983b57bc69601b032a0146900d6bf9f7709f3dbe41c91f3c8a4` |
| `strategy/engine.rs` | `72250e13ca557f0e1d3bb324085ba7eee4ffb2e9bd6347fd61fa87ee4301870d` |
| `strategy/source_trace.rs` | `825b6b52d9685bc090cfa1887041536a33c2388eea4aa358cdd76be88d457023` |
| `strategy/private_strategy_tests.rs` | `b1b09a5a21268ecb2a7b5068cb03a989bf931f76ec77d3c28b97f1ac6c9d165b` |
| `strategy/source_tests.rs` | `9e02d64df68ff3609c365cd4e04cb8651649c7c3203e119fc94ab2a5b2b7ebdb` |
| Scoped `git diff` (6 files, untracked evidence excluded) | SHA-256 `8b796701fbe99f3548a61b05a5da53921c41a31827316beea40c53e5c298983e` (612 lines; also saved as `candidate.diff`) |

Full receipt: `logs/final-candidate-hashes.txt`; diffstat 6 files changed, 340 insertions(+), 43 deletions(-). No
`Cargo.lock`, `Cargo.toml`, toolchain, corpus, tool, expected-value, source-reader or source-strict file changed
(`logs/scope-checks.txt`).

Raw logs are in `logs/`; the repository `*.log` ignore rule means they need `git add -f` if Root commits them
(`README.md`, `candidate.diff` are not ignored). No full-workspace run or unrelated Memory/protection suite campaign was
performed; only the two requested `rh-policy` lib filters and the requested lint/format gates.

## Limits (unchanged by this bridge)

This bridge only makes the admitted Strategy dependency `Send`-compatible and lets the existing module-goal dispatch receive
the current mutable tick services. It does not implement or admit the later Brain/module adapter, complete chest module,
ModulePercept scratch bridge, caller/registry lifecycle, fair Observation/FrameRing binding, `validate` + `Sim::submit`
driver, live/headless activation, path allowance ownership (separate P-BOT-PATH-BUDGET-1), persistence, wire/client changes
or full-game parity. The later production Brain still owes its own full persistent object-graph `Send` assertion after the
Hand/Tactics/Modules interfaces are sealed. These controls are declared native/plumbing controls, not a source re-capture;
the frozen source witness remains the behavior authority and passed unchanged.
