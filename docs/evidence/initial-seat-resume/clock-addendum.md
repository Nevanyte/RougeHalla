# Reentrant-clock cutoff and accepted dispatch boundary

This additive record preserves original code **82e9aba9aaa27257fd2438e0480aafa75bcff9fd** and its narrower evidence **98bc727afb1823d394cc30aa96e97d4c31693a97** unchanged. Corrected immutable code is **6fd7ed46fd4d3880ef9299984d80773fb8a6863b**, direct parent98bc. The sole production-code change after82e9 is one `if (_detached) return;` immediately after `OnReceived` evaluates its caller-owned `Now` delegate, plus the exact Session mirror. Two new test cases exercise reentrant clock detachment. No UI, storage, wire, server, dependency, workflow, hot-event multicast rewrite or allocation diagnostic change.

## Concrete repair and verification

The entry check cannot protect against a valid clock delegate that calls Detach before returning its timestamp. Before this guard, a Pong could then update ClockSync and start RttSample; a snapshot could update public snapshot/self/prediction fields and begin a source-cut TimelineReset, before the later snapshot guard. The new check stops that parser continuation. The Pong control requires no RTT notification or Sync sample; the source-cut snapshot control requires unchanged retained snapshot/self/prediction/count/epoch/mode and no TimelineReset/SnapshotReceived. Both use encoded synthetic protocol fixtures, not a browser or real server result producer.

On this corrected, frozen source: focused normal managed validation with warnings as errors **117 passed /0 failed /0 skipped**; **one** unfiltered full managed run **863 passed /0 failed /0 skipped**,6s reported duration. Exact mirrors, source hashes and `git diff base --check` pass. The six current code/test/mirror files match the frozen Git objects after both runs. The pinned SDK is8.0.427; original environment inventory identifies installed runtime8.0.33/macOS ARM64. No allocation trace, tolerance change, retry campaign, Rust/PG use or additional Editor/browser/cloud action occurred.

Commands, after sourcing the pinned environment and assigning the same task-owned unused Rust/PG paths as in the original record:

```sh
dotnet test client-unity/RoguehallaNet.Tests --filter 'FullyQualifiedName~SeatResumeTests|FullyQualifiedName~SessionTests' -warnaserror
dotnet test client-unity/RoguehallaNet.Tests -warnaserror
bash client-unity/sync-net.sh --check
git diff 8e467beb3ec76d8178927998b62a23cdf7b77a06 --check
shasum -a 256 -c docs/evidence/initial-seat-resume/clock-SHA256SUMS
```

`clock-frozen-source.json`, `focused-clock.log`, `full-managed-clock.log`, `clock-environment.log` and `clock-receipt.json` bind this validation. `clock-SHA256SUMS` is the current payload manifest. The original `SHA256SUMS` is a point-in-time seal for98bc, whose older Session/test hashes intentionally differ from corrected source: verify those entries through `git show 98bc727afb1823d394cc30aa96e97d4c31693a97:<path>`, not against the current tree. All13 original entries and all original evidence files were independently hash-checked against those immutable Git objects. This addendum's final evidence-only commit hash is handed to the lead separately.

## Precise event and ownership contract

An ordinary multicast notification **already begun before Detach may finish its remaining listeners of that same accepted notification**. Detach does not universally cancel a dispatch already executing, remove public Session subscribers or make retained DTOs immutable. StateChanged's obsolete InMatch chain is specially stopped as implemented. After cutoff, the old Session cannot accept another transport frame, publish a subsequent distinct parser notification, retain a new result, send input/Leave, resume or reconnect. Detached is a local lifecycle state, never a fabricated MatchEnded/Result.

**The UI owner must revoke its captured generation and Session ownership before calling Detach**, then unbind its own public subscriptions. Every old listener/completion must check that captured generation/Session against the current owner before mutating presentation or a replacement session. Removing a handler does not cancel a delegate invocation already in progress. The library cannot enforce these consumer-owned predicates; MatchClient/UI adoption remains a separate owner-reviewed packet.

## Read-only audit of other clock sites

Locations below refer to original82e9 Session.cs, so the reported coordinates remain immutable. Only the approved OnReceived guard was changed.

| Site | If its clock delegate deliberately Detaches before returning |
|---|---|
| Poll250 | Detached state makes the subsequent InMatch guard return; no new notification/send/reconnect. |
| FlushInput271 | Detach clears pending input before Input.Flush continues; Send is independently guarded. No send/notification authority is restored. Direct caller mutation of public InputSender is not an immutable-data promise. |
| OrderMove167 / OrderStop175 | Local Motion.Order/StopOrder can still execute after the clock returns, e.g. OrderPending may become true. No accepted network state, notification or send is produced. |
| CastQueued callback134 | Local Motion.NoteNonMovementOrder can continue after its clock callback, affecting retained prediction bookkeeping. No network/notification authority is produced. |
| ScheduleRetry338 | `_nextAttemptAt` can be assigned after Detach cleared it, but State/Connect/Poll guards suppress actual reconnection. |
| RefuseDelta519 | Local `_needFull`/`_lastResyncAt` and ResyncsSent bookkeeping can change after cutoff; guarded Send emits no Resync. A counter increment here is not proof a frame was transmitted. |

These remaining observations do not establish universal freezing of historical prediction/diagnostic fields under an intentionally reentrant clock. Root explicitly accepted the narrower terminal I/O/notification/input/reconnect authority contract; no general reentrancy cleanup or further source expansion was authorized. No new tests/campaign were executed for those read-only observations. All previous account/endpoint/bearer-mode/durability limitations remain applicable; this packet still proves no actual full-page reload or host-loss recovery.
