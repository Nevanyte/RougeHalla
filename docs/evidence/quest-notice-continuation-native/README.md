# Quest notice continuation — repaired hold candidate

Status: HOLD ITEMS REPAIRED / SIX FOCUSED TESTS + UNCHANGED 0/4 PASS / DEFAULT+ALL-FEATURE LINT AND FMT PASS.
Bounded six-case Toast/GV + entitled-preview witness only; no 181-record transport parity.

## Identity / scope

- Base for this follow-up: b4aa87f8791c3a2586cc1402461f7b003d530212 (prior candidate); initial packet base
  7c18d051e380ffbba8911bed6ba6ded34b932aca.
- Frozen source unchanged: parity/quest-notices/source.json 1,154,229 B,
  SHA256 a20d751e88cb16765cf2aa3ef856765a0d3321d8e25eb6e41c6722cdf9a99244.
- New consumer final: 31,960 B,
  SHA256 91ed449b81039d6f28c56cb44497a366bc0ddc054c3ab09df3029b5c99fed026.
- cfg(test) module registration unchanged from b4aa87f8:
  81bf78251b30a62ca73c78337c10cb2da7a71f88b00be92fa825f14869853bb1.
- Approved visibility-only coliseum hunk unchanged:
  8c19c892399dbcea475a5b9b8bcbfefc9d1bbefb67a805f6fecbcb78e9dff688.
- Existing cases0/4 consumer, frozen source/tools, production quest/objectives/rewards/live/catalog/rules,
  versions, pins, Cargo.lock, clients and shared status are untouched.

## Repaired controls

- Unknown-action control now constructs and starts the real raid and rejects through the actual apply_action path.
- Wrong-binding control first proves the real active state/quest runtime and a known valid offer binding, submits a
  valid acceptance through apply_action, then injects questZZ through the same path and requires its intended typed
  resolution failure.
- Comparator control runs a clean real case2 expectation and confirms exact equality, then feeds the SAME ordered
  comparator a recipient-mutated copy and a reordered copy; both must fail. No synthetic-only Notice assert_ne remains.

## Repaired reached-state guards

- Case1 captures the actual produced c7n item UID and box/quest binding before diagnostic writes; after the declared
  stale-closed, sibling restore, real acceptance, diagnostic carrier and silent real pickup, it asserts the same UID/
  box survives and checks Expired status/carrierNone then Open/accepted/p1 carrier at the frozen applied/tick
  boundaries. Silent final pickup adds no notice.
- Case3 before producer asserts actual 10 published Open + 10 hidden/20 total; immediately after asserts 10
  specifically Expired with closed_at at producer time, hidden0, unknown0, and aggregate Toast before Teleported.
  The next ordinary step retains expired state; no producer queue is replayed (exact notice vector).
- Case2 checks real accepted/progress3 before EITHER 50ms deadline nudge (applied8), and final Done/Expired/Open/
  unpublished offer facts including closedAt300.
- Case5 reads actual state at frozen actionCount boundaries: Cinder Cull published/Open at 82/2, Expired/closedAt4150
  at 83/3; Frost Open/unpublished at 84/4-85/5; at 164/7 grand-tour and Frost both published/Expired/closedAt8200,
  Cinder retains closedAt4150. Real Fire44->0 / Frost41->0 producers and retained threat remain.

## Counts / views

Ordered Toast/Gv retained/excluded (source vs native): case1 3/3 notices, 5/4 events; case2 12/12, 16/13;
case3 3/3, 5/5; case5 7/7, 115/113. Non-notice class differences are reported, not forced. Preview counts 1/3/0/2;
each reveal checks entitled owner definition/giver/expiry and hidden-definition absence from the relevant public
boundary and from every foreign human.

## Commands / exits (cwd backend-quest-runtime; private target; jobs1; locked/offline)

- cargo test -p rh-sim --lib quests::notices_continuation_source_tests -- --nocapture:
  final 6 passed, 0 failed; exit0 (final-four-cases.log).
- cargo test -p rh-sim --lib quests::notices_source_tests::selected_parcel_and_run_end_cases_match_ordered_toast_gv_notices:
  1 passed, 0 failed; exit0 (existing-cases-0-4.log).
- cargo clippy -p rh-sim --all-targets -- -D warnings (default features): exit0 (clippy-default.log).
- cargo clippy -p rh-sim --all-targets --all-features -- -D warnings: exit0 (clippy-all.log).
- cargo fmt -p rh-sim -- --check: exit0, empty output (fmt-check.log).

PATH prepended $HOME/.cargo/bin; CARGO_TARGET_DIR=~/.codex/tools/roguehalla-backend-20261109/target-quests;
CARGO_BUILD_JOBS=1; CARGO_NET_OFFLINE=true. Toolchain queried after runs (not embedded by Cargo output):
cargo/rustc 1.97.0 (c980f4866/2d8144b78), active toolchain overridden by worktree rust-toolchain.toml.

## Preserved first failures (corrected honesty)

- first-compile-run.log: actual first run 3 passed/2 failed: case2 missing preview source-frame boundary,
  malformed active/control path; case5 passed in that run.
- second-run.log: 3 passed/2 failed: case2 pre-nudge progress observed2, case5 overbroad future-public-frame
  assertion; control passed. These led to the corrected frozen boundary/sequence.
- clippy-firstfailure-raw.log: unused copied helpers + bool assert.
- fmt-firstfailure-raw.log: formatting after clippy cleanup.
- An intermediate guard-failure raw log was overwritten before preservation; it is not reconstructed or claimed.
No private checkpoint/state/transcript content is committed.

## Limits

Bounded Toast/GV + entitled-preview witness only. Case1 is noncanonical diagnostic state; case2/5 deadline nudges
prove order not natural300s duration; case3 is direct producer, not timer/spatial/immunity parity; case5 is inline
whole-region producer, not ordinary sword clearing. No client/Unity delivery, persistence, new design, identity
change or 181-record parity claim. Root owns integration/admission.
