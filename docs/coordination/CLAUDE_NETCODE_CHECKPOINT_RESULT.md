# Competitive netcode checkpoint: result and evidence

Code SHA: `c57a6aca` (branch `claude/peaceful-babbage-rtsgq6`; contains `optimization_port` at `e96f2a9c`). The commit that adds
this paragraph changes this file only; it is the evidence SHA.

Gates run by the coordinator on `c57a6aca` (2026-11-10):

- `cargo fmt --all -- --check`: clean.
- `cargo test --workspace --no-fail-fast` with Postgres from `tools/pgtest/start.sh`: 2144 passed, 0 failed, 16 ignored.
- `cargo run -p rh-parity --bin parity-report`: 109 slice scenarios + 13 capture-only, 300 pathfinding queries, all MATCH.
- `cargo run -p rh-protocol --bin protocol-fixtures`: `v15.json` regenerates with no diff.
- `dotnet test client-unity/RoguehallaNet.Tests`: 1071 passed, 0 failed. `client-unity/sync-net.sh --check`: up to date.
- `node tools/protocol-js/check-vectors.mjs`: 73 server vectors, 226 malformed, 29 chains, 52206 checks agree with `v15.json`.
- `node tools/protocol-js/check-first-playable.mjs`: passed.

Closed after the worker reports below were written (commit `606de2fc`): the 17 u target-only aim bound is asserted on every replay
trace (measured maximum 12.47 u); the walk cache is also keyed on a snapshot-buffer revision, because replacing the newest snapshot at
the same time did reuse the old walk (5.95 u lead along the old direction before the fix); the JS check requires the `truncated`
reason for the new malformed cases; `rtt.rs` has a test that a stamp one lead past the newest snapshot is never clamped downward.

Branch `claude/peaceful-babbage-rtsgq6`. This file is evidence only. Every result below is copied from the worker packet reports;
the records author ran no cargo or dotnet. Synthetic timings and replay errors are not performance gains. Nothing was measured on a
real link. The Unity scene scripts under `Assets/Scripts` were never compiled here.

Commands the reports name (dotnet is the scratchpad SDK, `DOTNET_ROOT=<scratchpad>/dotnet/sdk DOTNET_CLI_TELEMETRY_OPTOUT=1`):

- `dotnet test client-unity/RoguehallaNet.Tests`
- `client-unity/sync-net.sh --check`
- `node tools/protocol-js/check-vectors.mjs`, `check-first-playable.mjs`, `node tools/scene-candidate/check.mjs`, `check-client14.mjs`
- `cargo test -p rh-protocol`; focused `rh-sim` tests `lag_fairness`, `move_stamp`, `actor_refs`, `windup_tests`; `rh-server` `seat_boundary_tests`

## Findings

### 1. OwnAttackCue adopts a ready-time jump before the blockers

- Tests: `ReadyJumpTogetherWithDeathIsRejected`, `...WithStunIsRejected`, `...WithWeaponChangeIsRejected`,
  `ReadyJumpPastTheTimeoutIsRejected`, `GenuineLateServerEffectsAreStillRetainedAndAbsorbedOnce` (`OwnAttackCueTests`).
- Before: the fix was applied first and the original file restored for a true before-run. New plus existing cue tests:
  `Failed! Failed: 6, Passed: 14, Total: 20`. The four blocker tests failed (Update returned false, the cue was adopted instead of cut).
- After: pass. The 13 existing cue tests are unmodified and green.
- Not addressed: `SnapshotBuffer` replace-current-tick with an equal `ServerMs` (not shown reachable).

### 2. Session source cut does not clear RemoteDraw

- Tests: `BackwardsSourceCut...` and `EqualTimeSourceCutResetsTheDrawnFigure` (`SessionTests`).
- Before: backwards cut, expected X 200 but was 208.5 (the stale walk was applied after the cut). Equal-time cut, expected 150 but was
  134.0002 (the figure blended from its pre-cut pose).
- Partly as described: an equal-time cut cannot reuse the walk cache (one sample, no extrapolation); the stale follower state was the
  real defect.
- After: pass with `RemoteDraw.Reset()` in the `sourceCut` block.

### 3. Aiming policy

- Tests: `RemoteDrawAimTests` (new). Failing before the change:
  - `NewestThousandRenderNineEightyStampsTheExtrapolatedTimeItDraws`: expected 1030.0 but was 1000.0.
  - `TheStampNeverPassesTheServersApplyTime`: expected at most 1050.0 but was 1200.0.
  - replay straight walk, judged where drawn: expected less than 0.3 but was 0.844.
  - follower lag cap: expected at most 20.001 but was 23.75.
- Two test-model mistakes were fixed in the tests, not the code: the held-target check (apply step with the 70 ms minimum render delay)
  and the circle replay threshold (0.3 raised to 0.5; the new stamp scores 0.36 on the circle at 60 ms one way).
- After: 19 of 19 RemoteDraw tests pass.
- Bounds (constants in `RemoteDraw`): `AimTimeErrorBoundMs` 50 ms; `AimTargetErrorBound(v)` = min(10, 0.05 v) + 0.05 v = 17 u at 170 u/s;
  `MaxFollowLag` 20 u; drawn figure against judged pose at most 37 u at walk speed.
- Replay, synthetic traces (drawn-vs-judged error, mean / max in u, 0/15/30/60 ms one way):

  | Trace | New stamp | Newest-capped stamp (before) |
  |---|---|---|
  | Straight walk | 0.00 / 0.00 | 0.84 / 2.55 (15 ms), 2.50 / 5.67 (30 ms), 3.32 mean (60 ms) |
  | Circle | 0.09 to 0.36 / 0.27 to 0.90 | 0.84 to 3.32 mean |
  | Reversal | 0.05 to 0.50 / 5.1 to 15.0 | not in the report excerpt |
  | 0 ms link | 1.6 / 5.1 (the sim's one-tick lag floor) | same |

  The report excerpt was cut off after the reversal line, so the reversal before-value is missing here; `PLAYER_PREDICTION.md` gives a
  0.84 to 3.43 mean range for the old stamp overall.
- Scene change, no test possible: `ArenaView` stops drawing an ended track when the drawn tick reaches `LiveTick`. Uncompiled.

### 4. Fresh projectile track numbering

- Test: `actor_refs::tests::tied_fresh_tracks_bind_presented_owners_whatever_the_private_launch_order`.
- Before: `fresh ties are not numbered by presented owner` (left `[(1, Some(PlayerId(2))), (2, Some(PlayerId(2147483650))), (3, Some(PlayerId(2147483648)))]`, right with the last two swapped); the forward and reversed runs also differed (`private storage/launch order changed exposed bindings or lifecycle`).
- After: pass, tracks `[1,2,3]`, `[1,2,3]`, `[1,2]`, `[1]`, `[1,4]` across sighting, move, end, loss and re-sighting.
- Also changed: lookup by binary search over `ProjectileTracks.live` (no correctness finding; projectile_view, actor_refs and `*_no_alloc` tests stay green).
- Control kept: `observe::windup_tests::an_actor_entering_sight_mid_draw_shows_the_true_start_time` passes without a code change. It pins
  that an actor entering sight mid-draw publishes the draw's true `started_at` and `lands_at`. Inherited legacy exposure, recorded in the
  plan and ADR 0024.

### 5. Catch-up projectiles skip ball/arrow deletion

- Test: `a_catching_up_shot_meets_the_ball_or_arrow_it_crosses` (`rh-sim/tests/lag_fairness.rs`).
- Before: `lag 200: arrow lagged Crossing { deleted: false, hit: true, damage: 48.54290598290599, end: Some(Vec2 { x: 461.0, y: 260.0 }) }`, panic at `lag_fairness.rs:509` ("lagged arrow at 200 ms").
- After: pass. Measured table (practice arena lane y=260; deleted / victim hit / damage / arrow end x):

  | Lag | Arrow lagged, before | Arrow lagged, after | Ball lagged, before | Ball lagged, after |
  |---|---|---|---|---|
  | 50 (baseline) | deleted / no / 0 / 354 | same | same | same |
  | 100 | deleted / no / 0 / 354 | same | deleted / no / 0 / 354 | same |
  | 200 | not deleted / hit / 48.54 / 461 | deleted / no / 0 / 354 | deleted a tick late / no / 0 / 390 | deleted / no / 0 / 354 |
  | 300 | not deleted / hit / 48.54 / 461 | deleted / no / 0 / 354 | not deleted / hit / 48.54 / 461 | not deleted / hit / 48.54 / 461 |

- Returned to Root: a ball lagged 300 ms is spawned after the baseline arrow's hit was recorded in that tick's sweep; undoing it would
  cancel recorded damage. Asserted in the test as a measured limit. Control: with no ball crossing, the arrow lagged 300 ms hits.
- Unverified: the homing-flight past position (taken along the present heading) has no test.

## Other defects found

- Stamp intake: `rh-sim/tests/move_stamp.rs` `without_lag_fairness_a_stamp_is_dropped_at_intake`. Before: state hash `left: 6566475062554255949 right: 3008900808056057882`. Fixed in `inputs::submit` / `submit_unbudgeted`. Control half (flag on) passes.
- JS probe accepted a non-finite `MoveAt` stamp: `node tools/protocol-js/check-vectors.mjs` stopped with `move_at_nonfinite_t malformed client: got false, want true`. Fixed with `finite(r.f64())` in `probe.html`.
- C# and JS lacked expectations for the 15 new `malformedServer` names: C# `Failed 15, Passed 1054, Total 1069` (`KeyNotFoundException: no expectation for <name>`). Maps added.
- `scene_candidate` protocol 15 comment said additive; corrected (comment only).

## Seat boundary (rh-server `room/seat_boundary_tests.rs`, 10 tests, each with `lag_fairness` on and off)

Live runtime profile as a two-seat duel, commands through `RoomCmd::Input`. No defect found, so no test was left failing. Per the report:

| Lagged Wish on a runner (200 ms stamp), queued distance | `lag_fairness` on | off |
|---|---|---|
| about 461 u | Landed | Fizzled |
| about 505 u | Fizzled | Refused |

Casts at about 409 u land in both modes and at about 514 u are refused in both. Other results: a Wish lands 250 ms after CastStarted
(stun 1250 ms, cooldown spent); a Wish cancelled by stun ends Interrupted, by death Cancelled, with no later effect; one hit per
press/release for bow, wand and sword; a stamped shot at 200 ms hits 150 ms earlier with the flag on, same damage, identical at baseline;
10 presses in a tick admit 6 and charge all 10; a Wish behind six presses is dropped with its token spent; with the budget exhausted a
press and a release are dropped but a free Aim still turns the seat (a dropped Release leaves the trigger held).

## Protocol 15 vectors and consumers

- `protocol/fixtures/v15.json` regenerated; the report states no existing vector changed and a second run was byte-identical. v14 and older are untouched.
- Added server vectors `state_projectiles_sighting`, `_reanchor`, `_end`, `_loss`, `_resighting`, `_key_absent`, `snapshot_facing_grid`; client `input_stamped_moves_seq_matrix`; chains `facing_grid_steps`, `kit_lifecycle`; 15 malformed client and 15 malformed server cases (names in the report).
- Results: `dotnet test client-unity/RoguehallaNet.Tests` Passed 1070, Failed 0, Skipped 0 (the 1070 includes `StateKeySevenTrackLifecycleReplaysThroughASession`; an earlier run before the aim tests: 1015 passed). `node tools/protocol-js/check-vectors.mjs` passes (73 server vectors, 226 malformed, 29 chains, 52206 checks). `check-first-playable.mjs` 60 checks, 65 with projectiles. `scene-candidate/check.mjs` PASS 8 cases; `check-client14.mjs` PASS 459 assertions (protocol 14 tools, they say nothing about 15). `cargo test -p rh-protocol`: every result line ok, 0 failed. `sync-net.sh --check`: up to date. Disk 21 GB free.
- Mutation checks (restored): JS `mask & 16384` changed to `mask & 8` made check-vectors fail (`truncated`); C# `ActorDelta.MKit` changed to `MStep` failed 19 of 1070.

## Remaining limits

- Unity scene scripts (`ArenaView`, `MatchClient`, others) not compiled here. Members called were checked by grep only.
- Nothing measured on a real link; replay and byte figures are synthetic or `wirebench`, not performance gains.
- Balance not run (no harness); DEV-009 to DEV-012 stay `pending`.
- JS probe move helper still sends plain Move; `tools/browser-proof` depends on it and was not run against 15.
- Rust and JS rejection reasons for the 15 new malformed server names were not compared; the v15.json was not re-diffed by the consumers worker.
- `MatchClient.Update` calls `session.Poll()` before `_ownCue.Update` (read, not compiled or run).
- `lag_fairness` is on in live `rh-server` runtime profiles and off elsewhere; Root owns the final activation. ADR 0024 stays Proposed.
