# Quest completion through Room publication — bounded native delivery proof

Disposition: **IMPLEMENTED TEST-ONLY COMPONENT PROOF; focused proof + unchanged quest_bridge regressions + scoped
format + strict default/all-feature server lint all pass.** This is a bounded backend integration witness, not full
quest-port parity, hosted activation, socket/browser delivery or a `181`-record transport claim.

## Identity and scope

- Worktree: `/Users/nevinmckinnon/Documents/Projects/RogueHalla-worktrees/backend-quest-room-delivery`
- Branch: `codex/deepseek-quest-room-delivery`; exact clean base HEAD at start and through every run:
  `9ee84dfe3fa35cfdefc4b6cabaf4b9091db6a24c` (`ef6161c3` reviewed integration plus the Root dispatch packet commit,
  which itself is 3 files / 445 insertions of docs only; `crates/` is unchanged from `ef6161c3`).
- Lease: additive tests/helpers only in the existing `crates/rh-server/src/quest_bridge_tests.rs` (+ 790 / − 0,
  sha256 `3a02b4097a583c8662bd06d54a6979836c469139cf369f32aad281f419fe0b6b`) plus this NEW evidence directory.
  No production Rust, protocol/wire type, quest rule/objective/reward/catalog, host profile, source corpus, fixture,
  expectation, existing test, `Cargo.lock`, dependency or shared-status file was edited.
- Frozen source witnesses are unchanged (read only here):
  `parity/quest-room-feedback/source.json` sha256 `977450a6e0e1a1fcc3bd135edf7ebe6291f10d4da7aef98a44fc76b5886bd978`,
  `parity/quest-giver/source.json` sha256 `039d4e058fa914f42080f1c55d8640cc508c5b4745504930ca3db49579adc8b4`
  (equal to the oracle's `input.sha256`), `parity/arena/source.json` sha256
  `6ff324e134127d9c84a4f4383965f11e08a108fbe306424b1547795265adf6f5`. No recapture, no source or corpus edit.
- Toolchain/environment for every command: `/Users/nevinmckinnon/.cargo/bin/cargo`, Rust/Cargo `1.97.0`
  (`c980f4866` / `2d8144b78`), pinned by the worktree `rust-toolchain.toml`; `CARGO_INCREMENTAL=0`,
  `CARGO_TARGET_DIR=target-deepseek-quest-room-delivery`, `CARGO_NET_OFFLINE=true`, `CARGO_BUILD_JOBS=1`, and
  `--offline --locked -j 1` on every Cargo run. Workspace Write/model settings were not changed.

## What the proof actually runs

One new focused test,
`room::quest_bridge_tests::quest_room_earned_shards_completion_delivers_exact_owner_and_foreign_toasts`, because the
shared test `cfg` keeps quest transport disabled as a component fixture while the Source runtime profile enables
quests (`Settings::sim` is `quests: !training`; `main.rs` `quests:false` is the no-runtime fallback only).

1. **Deterministic genesis inspection, no installed offer.** The existing seed-7 Source-arena `quest_bridge_sim`
   recipe generates the actual offer set. The test selects the genuinely produced published Open `shards-frost`
   Collect offer (5 spawned tokens) from that runtime and fails if it is absent — it never installs, substitutes or
   rewrites an offer. Observed genesis facts for this declared fixture: offer id `54`, giver spot `(848, 240)`,
   giver actor `PlayerId(12)`, five token positions `(4816,4592) (4944,4400) (4752,4336) (4944,4336) (4720,4336)`.
2. **Two actually joined human seats and real Outboxes.** `Room::join` seats `name0` on conn 1 / `PlayerId(1)` and
   `name1` on conn 2 / `PlayerId(2)`, each with its own `Arc<Outbox>`. The test asserts the shared `cfg` is
   quest-disabled only as the labelled fixture.
3. **Explicitly labelled deterministic active-Sim component bootstrap.** `Sim::reset_active` creates the active run
   with exactly one declared initial `Placement` at the actual generated giver spot (the only setup geometry) and the
   foreign placement at `arena.spawns[1]`; both sim quest config and active phase are asserted. The swap is a
   component fixture, **not** the hosted lobby/startup path. Before any handle or action, **both** seats'
   `FxProjector`s are rebound and **both** `ItemObserver`s recreated against the swapped Sim, and carries cleared.
4. **First ordinary `Room::wake(start + 50 ms)`** publishes the current QuestView/Props; the owner `QuestHandle` is
   taken from the decoded delivery (`WireQuestView` row), not from private state.
5. **Accept** is a decoded, typed `WireCommand::QuestAccept` submitted through `RoomCmd::Input` with the joined
   player/conn/monotone seq. `Room::handle` resolves through the issued handle, validates and submits; the delivered
   owner row becomes `owner_accepted`, `owner_progress == 0`, and the real `Quest accepted: Shards of the Watch`
   notice is decoded at that wake. The foreign seat receives none of the owner's accept notice.
6. **Movement/pickup progression is earned, one ordinary 50 ms wake per slot.** Targets come from the currently
   delivered `WireQuestView.objectives`; pickup capabilities come from the currently delivered `WireProps` quest
   rows; both use the current decoded `SelfView` position. Each of the three objective units is one accepted
   `WireCommand::Move` (snapshot `ack_input` and `SelfView.move_seq` assertions) followed by an accepted
   `WireCommand::Pickup` with the issued `PickupHandle`; the delivered row's `owner_progress` advances `1→2→3`, the
   delivered progress notices (`Shards of the Watch: n/3`) are decoded, and the remaining entitled cue count is
   asserted (`token_spawns - pickups`). No teleport, private container id, hidden pickup id, installed progress,
   reward, carry or Event is used.
7. **Return and automatic turn-in** are one accepted `Move` back to the delivered giver spot, then ordinary
   `Room::wake` calls. Completion is detected only in the unmodified native `room.last_events` (a quest `Event::Gv`
   for the owner); the **native completion tick/time is read from the running Room** (`1386`, `69300 ms` in every
   run) and is never copied from the source witness (`tick 8`, `400 ms` is provenance of the captured projection
   input only).
8. **The wake is the only carrier path.** `Room::wake` steps the Sim, feeds each completed `FxTickReport` into the
   seat `FxProjector` (`room.rs:1241` wake, `:1327` `step_into`, `:1341-1343` `fx.feed`/`append_into` into the seat
   carry), then `Room::publish` (`:1377`) and the actual Room Publisher
   (`wire.rs:335` `frames_prepared`, `:361` `build_observation_frames`, `:409` `ServerMsg::Events`) push into the
   real Outboxes. A `sim.step()` + `publish(&events)` shortcut is never used; the Toasts can only arrive through
   the wake-fed carry. Every wake also asserts each seat `FxProjector::tick() == room.sim().tick()` and that the
   decoded snapshot is stamped at the completed tick.
9. **Client-side decode.** Each seat's Outbox frames are decoded with the shared `rh_protocol::SnapshotTracker`
   (Full and delta snapshots, plus `State`/`Events`/`Fx`), i.e. the same decode path a client uses. Ticks, capability
   handles and action facts in the test all come from this decoded delivery.

## Exact two-viewer completion oracle (after native production)

The test reads the frozen legacy Room-method witness `parity/quest-room-feedback/source.json` (format
`rh-quest-room-feedback/1`, case 7 `completion-retirement`, frame 8 `turned-in`,
`input.sha256 = 039d4e05…`, `rawEventsSha256 = 6e40908a3cf563b1d5778b185129c829218af6fd80c903a8a1605552563e7a26`)
and asserts the source provenance row (`tick 8`, `time 400`) explicitly; it is never imposed on the native clock.
It takes the witness receiver's actual rows for the owner (`client` sends to source alias `p0` plus the one
`broadcast` call) and for the foreign viewer (the `broadcast` row only), binds source alias `p0`/`name0` to the
declared native owner placement name `name0`, and requires complete ordered vector equality against the decoded
`ServerMsg::Events` rows of the **completion wake** for both real Outboxes:

| viewer | expected decoded Toast vector (exact order) |
| --- | --- |
| owner `name0` (4) | `+10 GV (quest)`; `Rime Stalker: +10 kill stacks · +12.5 Defense total`; `Quest complete: Shards of the Watch`; `name0 completed quest: Shards of the Watch` |
| foreign `name1` (1) | `name0 completed quest: Shards of the Watch` |

Both Events frames are stamped with the actual native completion tick (`1386`), carry exactly those row counts (no
extra row, no missing row, no membership/substring filtering), and the wire Toast has no recipient field: privacy is
established by the separate viewer batches and absence assertions, not an invented wire recipient. The owner GV
notice appears exactly once through the observation mapping; the unmodified `last_events` producer batch is asserted
to be **exactly four native events**: one `Event::Gv` quest producer (`amount 10`, owner), no duplicated world
`Event::Toast` for the GV text, then the owner farm notice, the owner completion notice and the public notice in that
order. The delivered row also binds `owner_completed`, closed `Done` row state and `done_by = "name0"`. Independent corroboration only (never a
substitute for the delivery): the actual generated offer is `Done`, `done_by` the owner, accepted only by the owner,
the owner's typed quest GV part is `10`, and the farm stat count is the producer's stack reward (`10`).

## Commands, exits and counts (cwd above; raw logs under `logs/`)

| # | Command | Result | log |
| --- | --- | --- | --- |
| 01 | `cargo test -p rh-server --lib --offline --locked -j 1 room::quest_bridge_tests::quest_room_earned_shards_completion_delivers_exact_owner_and_foreign_toasts -- --nocapture` | **1 passed, 0 failed**, exit 0 | `logs/01-focused-proof.log` |
| 02 | same focused test again (determinism) | **1 passed, 0 failed**, exit 0; identical proof lines | `logs/06-focused-proof-repeat.log` |
| 03 | `cargo test -p rh-server --lib --offline --locked -j 1 room::quest_bridge_tests` (unchanged regressions + new) | **5 passed, 0 failed**, exit 0 | `logs/02-quest-bridge-regressions.log` |
| 04 | `cargo fmt -p rh-server -- --check` | **exit 0**, empty output | `logs/03-fmt-check.log` |
| 05 | `cargo clippy -p rh-server --all-targets --locked --offline -j 1 -- -D warnings` | **exit 0**, clean | `logs/04-clippy-default.log` |
| 06 | `cargo clippy -p rh-server --all-targets --all-features --locked --offline -j 1 -- -D warnings` | **exit 0**, clean | `logs/05-clippy-all-features.log` |
| 07 | focused test on a second independent from-scratch target directory (`target-deepseek-quest-room-delivery-proof2`; removed afterwards) | **1 passed, 0 failed**, exit 0, identical proof lines | `logs/08-fresh-target-rebuild.log` |

The focused proof prints its own receipt (cwd above, captured raw in `logs/01-focused-proof.log`):
accepted `shards-frost` handle `9` at native tick `3`; pickups at native ticks `677`, `679`, `700` with delivered
pickup handles `[18, 19, 20]`; native completion tick `1386` (`69300 ms`) with the exact owner/foreign vectors above.

## Preserved first real failures

- `logs/first-failure-objectives-assert.log` — first real implementation run: the draft asserted the delivered
  entitled objective-cue count still equalled the catalog `token_spawns` (5) after the first real pickup; the native
  producer had correctly removed the picked container, so the delivered cue set was 4. Cause was the draft
  expectation, not a producer/reach gap; the assertion now derives the remaining count as `token_spawns - pickups`.
  Nothing was loosened into output filtering: the exact progress/notice, ready, completion, tick and Toast
  assertions all ran and passed after the fix.
- `logs/clippy-firstfailure-default.log` and `logs/clippy-firstfailure-all-features.log` — first strict clippy runs
  failed (`exit 101`) on `clippy::assign-op-pattern` for `*at = *at + tick` in the new wake helper; rewritten to
  `*at += tick` (a snapshot-tick assertion was added at the same time). The final runs (rows 05/06 above) are clean.
- No other real failure occurred: the spliced proof test compiled on its first attempt and its only test-run failure
  before completion was the objective-count draft expectation above.

## Boundaries / limitations (no over-claim)

- Component fixture only: direct `Room::new` + real `join` seats + the explicit active-Sim swap/rebind described
  above with one declared initial Placement at the actual generated giver. It does not exercise the hosted lobby,
  admission/director startup, or any deployment path.
- The Source runtime profile already enables quests (`Settings::sim`: `quests: !training`); the shared bridge `cfg`
  quest-disabled start is a test-fixture fact and **not** a global hosted quest gate. This proof changes no
  production/host profile and claims no quest activation change.
- Delivery proof is per-seat Room publication to real Outboxes plus protocol encode/decode. It does not prove live
  authenticated sockets/transports, client Unity/browser display or retention, persistence/reconnect notice
  retention, the full `181`-record source transport stream, non-notice FX/combat parity, or full quest-port parity.
- The native completion tick/time and route length (`1386` / `69300 ms`) are facts of this deterministic fixture and
  the actual accepted route; the source witness `tick 8` / `400 ms` is provenance of its captured projection input
  only and was not forced. The fixture's generated offer ids/positions are deterministic for this declared
  seed/arena configuration, not a general hosted guarantee. No broad workspace, browser, capture or expected-corpus
  campaign was run.
- No production hunk is needed or proposed; no new scope decision was required because the real accepted
  Move/Pickup/automatic turn-in route reached the full Shards completion through Room wakes.
- Worker did not merge, push, deploy, commit, contact Claude, run a browser/socket gate, or edit shared status.

## Candidate seal for Root (worker made no commit)

Only these paths differ from the base HEAD; `logs/*.log` matches the repository's `*.log` ignore rule, so Root must
force-add the log directory when committing (README/manifest/diff are not ignored):

```
git add crates/rh-server/src/quest_bridge_tests.rs
git add docs/evidence/quest-public-completion-room-delivery
git add -f docs/evidence/quest-public-completion-room-delivery/logs
```

- Modified (leased existing file): `crates/rh-server/src/quest_bridge_tests.rs` (+790 / −0,
  sha256 `3a02b4097a583c8662bd06d54a6979836c469139cf369f32aad281f419fe0b6b`);
  tracked diff: `working-tree.diff`.
- New: `docs/evidence/quest-public-completion-room-delivery/{README.md,scoped-manifest.md,working-tree.diff,logs/*}`.
- `target-deepseek-quest-room-delivery/` is build cache only and is **not** part of the candidate seal; no target,
  cache or binary artifact is listed here or in the manifest.
- Exact per-file sha256 of the scoped candidate (computed after the final edit; the manifest excludes itself and the
  logs that keep changing only with wall-clock text—hashes are recorded in `logs/09-final-manifest.log`):
  see `logs/09-final-manifest.log` and `scoped-manifest.md`. No commit was created by this worker, so the working
  tree remains exactly the candidate for Root's own seal/commit.
