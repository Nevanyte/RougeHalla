# Order governor: result and evidence

Branch `claude/sleepy-feynman-vddfbv`, on top of the netcode checkpoint (`ca8cddee`, branch `claude/peaceful-babbage-rtsgq6`, which
contains `optimization_port` at `e96f2a9c`). Serves ORDER_OF_OPERATIONS polish of the network path; closes the Wave 2 deferred row
"Order budget can drop a Release or Attack during sustained steering plus clicking" in
[NETCODE_COMPETITIVE_PLAN.md](../NETCODE_COMPETITIVE_PLAN.md) (section "Order governor").

No `rh-sim` change, no wire change, no protocol bump, no parity fixture touched. The server keeps its order budget and drops exactly
as before; the client stops sending into the drop.

## What changed

| Where | Change |
|---|---|
| `RoguehallaNet/Net/OrderBudgetModel.cs` (new) | Client mirror of `rh-sim` `OrderBudget` (30 burst, 15/s, Aim free) with a 1.5-token safety margin; `SteerPacing` (held-key repeat interval). |
| `RoguehallaNet/Net/InputSender.cs` | `Flush` holds commands the model cannot pay for, in order; queued movement orders collapse to the newest; a press held over 200 ms is withdrawn with its release unless an earlier press is held on the server. `Governed = false` is the old behaviour. Counters `Held`, `Coalesced`, `Withdrawn`. |
| `RoguehallaNet/Net/LocalMotion.cs` | `SpeedMultiplier` getter (read-only). |
| `UnityProject/Assets/Scripts/Net/MatchClient.cs` | The held-key repeat uses `SteerPacing.RepeatIntervalMs(Session.Input.SteerRepeatHasRoom(now), m.SpeedMultiplier)`. Not compiled (no Unity editor). |
| `rh-server` `metrics.rs`, `room.rs` | `intakeRefusals.overBudget`, `.overBudgetPressOrRelease`, `.queueFull` on the process metrics, counted from `Sim::submit` refusals of human input. |
| Tests | C# `OrderGovernorTests` (14). `NetTests.FramesCarryAtMostSixteenCommands...` and `NetcodeV15Tests.MovesCarryTheIssueTime...` now build ungoverned senders (they test packing and stamping). `seat_boundary_tests` assert the new counters; one pre-existing `clippy::bool_assert_comparison` fixed. |

## Synthetic fight (C# `OrderGovernorTests`, not a real link)

60 frames/s for 20 s; frames reach a C# copy of the server bucket 30 to 90 ms later in order and are applied at the 50 ms tick.
8 seeds each.

| Scenario | Ungoverned | Governed |
|---|---|---|
| Strafing archer | 17 to 24 drops (0 to 3 presses, 4 to 7 releases); longest held trigger 350 to 950 ms | 0 drops, 0 holds; longest trigger 150 to 200 ms |
| Frantic | 192 to 223 drops (26 to 41 presses, 52 to 69 releases); longest trigger 550 to 900 ms | 0 drops, 368 to 382 holds, 4 to 10 of ~142 presses withdrawn; longest trigger 150 to 200 ms |

## Gates

Code SHA `114e1c9` (2026-11-10, this container):

- `cargo test --workspace --no-fail-fast` with Postgres from `tools/pgtest/start.sh`: 2145 passed, 0 failed, 16 ignored (checkpoint: 2144).
- `cargo fmt --all -- --check`: clean. `cargo clippy -p rh-server --all-targets -- -D warnings`: clean.
- `cargo run -p rh-parity --bin parity-report`: 109 slice scenarios + 13 capture-only, 300 pathfinding queries, all MATCH.
- `cargo run -p rh-protocol --bin protocol-fixtures`: `v15.json` regenerates with no diff.
- `dotnet test client-unity/RoguehallaNet.Tests`: 1085 passed, 0 failed (checkpoint: 1071; +14 `OrderGovernorTests`).
  `client-unity/sync-net.sh --check`: up to date. `dotnet build client-unity/RoguehallaNet.Probe`: 0 errors.
- `node tools/protocol-js/check-vectors.mjs`: 73 server vectors, 226 malformed, 29 chains, 52206 checks agree. `check-first-playable.mjs`: passed.
- Not run: Unity editor build, browser proof, any real-link measurement.

## Limits

- The model starts full per `Session`: a resume onto a partly drained seat, or a link stall during which the server bucket capped
  at 30 while the client kept spending, can still produce server drops. The new counters show them.
- A held press is late by up to 200 ms before it is withdrawn.
- `MatchClient` was edited without a Unity editor and not compiled.
- Nothing was measured on a real link.
