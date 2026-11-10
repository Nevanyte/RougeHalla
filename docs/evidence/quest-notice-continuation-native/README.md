# Quest notice continuation — bounded cases1/2/3/5

Status: IMPLEMENTED / FOUR FROZEN CASES + CONTROLS PASS / UNCHANGED 0/4 PASS / FMT+STRICT CLIPPY PASS.
This is the native continuation consumer for the frozen six-case quest-notice corpus, not 181-record transport parity.

## Identity and scope

- Base: 7c18d051e380ffbba8911bed6ba6ded34b932aca (Stage1 admitted composition plus docs transfer).
- Frozen corpus: parity/quest-notices/source.json, 1,154,229 bytes,
  SHA256 a20d751e88cb16765cf2aa3ef856765a0d3321d8e25eb6e41c6722cdf9a99244 (unchanged).
- Changed only:
  - NEW crates/rh-sim/src/quests/notices_continuation_source_tests.rs (24,829 B,
    SHA256 5efd6fb274da0cd85482de8e7fb8c2e12d105e34a85bfdf3b056b5d3096aef0e)
  - one cfg(test) declaration in quests/mod.rs (SHA256 81bf78251b30a62ca73c78337c10cb2da7a71f88b00be92fa825f14869853bb1)
  - systems/coliseum.rs visibility-only hunk fn teleport -> pub(crate) fn teleport
    (SHA256 8c19c892399dbcea475a5b9b8bcbfefc9d1bbefb67a805f6fecbcb78e9dff688)
  - this evidence directory.
- Existing quests/notices_source_tests.rs cases0/4, source/tools/corpora, production quest/objectives/rewards/
  live/catalog/rules, versions, pins, Cargo.lock, clients and shared status are untouched.

## Actual boundaries and guards

Each test is separately selectable and uses the real normal constructor, captured map/seeds/config/salts and
typed seats, with strict action dispatch in tick/sequence/actionCount order. Unknown actions and unresolved typed
ids panic rather than being skipped or cast.

- Case1 pickup-closed-guard: only the declared staleClosedStatus/restoreOpenForSibling/staleCarrier writes are
  accepted, each after checking the real produced quest7l box/item still exists. Real pickup/accept go through
  validate+submit. Final guard confirms c7n and its quest item are retained. NONCANONICAL diagnostic defense only.
- Case2 expiry-cohort-order: real accepted Shards collection and three token pickups through validate+submit;
  before the two explicit 50ms deadline-only nudges the test checks progress=3/accepted. The target step produces
  discovery -> aggregate 2-expiry -> quest GV -> farm notice -> owner completion -> room completion, all compared.
- Case3 teleport-close-notices: real native systems::coliseum::teleport is called at the declared between-step
  boundary. Before: 10 published Open. Producer event vector is captured immediately: aggregate "10 quests
  expired" precedes Event::Teleported. After: zero published Open, ten expired offers, hidden removed, unknown0.
  The following ordinary step has no replay of the producer queue.
- Case5 camp-and-publication-closure: actual mob_life::hurt + ledger::pay_all whole-region producer passes,
  selecting living mobs by catalog type.zone. Fire 44->0 and Frost 41->0 with retained threat-derived paths;
  explicit 50ms grand-tour deadline and HP1000 are declared. Real 4s Cinder Cull publication, prepublication
  accept refusal, Thaw the Watch publication-before-aggregate-expiry, and both same-step closures are exercised.

Exact ordered Toast/Gv fields (tick/time, kind, recipient/privacy, text, GV actor/amount/reason) are compared for
the selected cases. Retained/excluded counts (source vs native):
- case1: notices 3 vs 3; source events 5/excluded2 vs native 4/excluded1; previews1
- case2: notices 12 vs 12; source16/excluded4 vs native13/excluded1; previews3
- case3: notices 3 vs 3; source5/excluded2 vs native5/excluded2; previews0
- case5: notices 7 vs 7; source115/excluded108 vs native113/excluded106; previews2
The non-notice event-class differences are reported, not forced into equality; there is no 181-record parity claim.
Each source questReveal is checked against the entitled owner's actual prepared QuestView (definition/giver/expiry)
and the absence of that hidden definition from the relevant public source boundary and from every foreign human.

Reader/intake controls: unknown source action is rejected; wrong typed quest id is rejected; a recipient-mutated
notice comparator is proven unequal. All controls pass.

## Commands / environment / exits

All run in cwd /Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-quest-runtime with:
PATH=$HOME/.cargo/bin:$PATH; CARGO_TARGET_DIR=~/.codex/tools/roguehalla-backend-20261109/target-quests;
CARGO_BUILD_JOBS=1; CARGO_NET_OFFLINE=true; flags --locked --offline.

- cargo test -p rh-sim --lib quests::notices_continuation_source_tests -- --nocapture
  final: 5 passed, 0 failed; exit0 (final-four-cases.log)
- cargo test -p rh-sim --lib quests::notices_source_tests::selected_parcel_and_run_end_cases_match_ordered_toast_gv_notices
  final: 1 passed, 0 failed; exit0 (existing-cases-0-4.log)
- cargo clippy -p rh-sim --all-targets --all-features -- -D warnings: exit0 (clippy-all.log)
- cargo fmt -p rh-sim -- --check: exit0, empty output (fmt-check.log)

Toolchain was queried after the runs (not embedded by Cargo output): cargo 1.97.0 (c980f4866), active
1.97.0-aarch64-apple-darwin overridden by worktree rust-toolchain.toml, rustc 1.97.0 (2d8144b78), binary
2d8144b7880597b6e6d3dfd63a9a9efae3f533d3.

## Preserved first failures

- first-compile-run.log: first real run; 3 cases passed, case2 preview boundary and case5 later-publication
  assertion failed, control test was malformed. This is a real first failure, preserved.
- second-run.log: case2 pickup progress and case5 public-frame boundary + malformed control remained; preserved.
- clippy-firstfailure-raw.log: first strict clippy failure (unused copied helpers + bool assert).
- fmt-firstfailure-raw.log: first fmt failure after clippy cleanup.
- No private checkpoint/state/transcript content is included in this evidence.

## Limits

Bounded six-case Toast/GV + entitled-preview witness only. Case1 is noncanonical diagnostic state; case2/5
deadline nudges prove order not natural 300s duration; case3 is a direct producer boundary, not patience-timer
reach or full movement/immunity parity; case5 is inline whole-region producer, not ordinary sword clearing.
No full 181-record transport, client/Unity delivery, new design/persistence, source-integrity rewrite or
identity/version change is claimed. Root owns integration/admission; card/NPC worker is untouched.
