# Launch fixture prerequisite repair

**Fixture correction ready for review; the corrected engine42 gate is UNRUN.** Corrective code is `9398ce232fcf8774ebd84a60cb7abefafd9e9a77` on `codex/unity-launch-modes`, following the sealed source lease `554ca4f59ecf75e5ad2d2761ce1ff5b5408d7dfb`. It changes only `MatchLaunchEditModeTests.cs`.

## Retained actual failure

The first actual engine gate at `9c658e049d4b4e77118004d481349d1523e2ded4` ran42 selectors:30 passed and12 failed. The original Quest8, Trader6 and PlayerFlows11 all passed. New Launch17 had5 passes/12 failures. Its actual test assembly MVID is `5060c178-6253-4a15-a153-f5615131d3c5`.

The original raw results, discovery binding, source manifest and ledger are copied byte-for-byte under [raw-engine-9c](raw-engine-9c). [receipt.json](receipt.json) records their original hashes. The gate remains **FAIL**. The source-after-tests receipt also retains the known ShaderGraph whitespace serialization overlay (its patch is stored losslessly as gzip to preserve trailing whitespace without triggering repository whitespace checks); the failure is not attributed to that overlay. The author's managed compile success and prior .NET768 pass never established that these native launch paths had run.

## First failing prerequisite

The new fixture's `Owned()` response supplied only a profile name and `new AccountStats()`. The actual types deliberately initialize **seven counters to-1**: profile GV/lifetime GV and runs/wins/draws/deaths/kills. `AccountSession.ValidReply` requires all seven to be nonnegative. Consequently Fetch returns `Unreadable`; the hub flow returns no join intent; `JoinOwned` returns before target comparison or Session creation. This accounts for the empty target-change error and missing transports feeding the later `Welcome().Last()` failures.

The accepted account-binding fixture explicitly supplies every counter. No Mono lifecycle or production ownership-policy defect was established as this first cause.

[account-boundary.json](diagnosis/account-boundary.json) is a bounded reproduction through the unchanged actual `AccountHubFlow`/`AccountSession` implementation. The old omitted-field response produces seven-1 values, Failed/Unreadable and no usable intent. The complete explicit-zero response produces Owned/None and a current `CanJoin` intent, with the same synthetic identity/token/origin. It constructs no Unity object, match Session or backend process. The reproduction source/profile and exact Net assembly/source hashes are retained; this is a diagnosis of the account boundary, not engine or real-account acceptance.

## Correction and stronger prerequisites

- `Owned()` now explicitly initializes all seven synthetic response counters to0. The existing strict account validation is unchanged.
- Common setup asserts the real initialized account owner is attached, diagnostics are off, the client starts without a Session, and both original same-origin targets are valid.
- Successful public Join cases await actual ownership and transport readiness: one profile request, Owned/FailureNone/ConnectionFailureNone, one Session/transport, and `Connect` at the selected target. Welcome delivery asserts those prerequisites before using the transport. No Session is substituted.
- Each of the five former negative passes now includes a healthy public Join and accepted matching-mode snapshot continuation/control. The destroy case uses a fresh healthy fixture afterward. A globally invalid owned response therefore cannot let those cases pass unnoticed.
- Existing deferred-worker cancellation cases still await their real production task. They now assert a genuine pending account operation; the second same-profile operation explicitly waits for the owner's semaphore to release the first HTTP request. The faction-cancel replacement and Play again/reentrant replacement await connected transports.

All original17 selector names/arguments and expected behaviors remain. The actual missing/cross-origin, stale target, cancellation, mode confirmation/refusal, resume, retired callback and UI assertions remain. Quest/Trader/PlayerFlows and existing account-binding test files are byte-identical to the failed9c gate. No production, credential policy, account model/codec, gameplay, art, protocol or shared-status/lock file changed.

## Affected managed checks and next gate

The actual managed account Session/hub-flow target passes **80/80**. The updated Editor test sources compile with0 errors and the same existing `CS0067` unused Trophy fixture event warning. Logs, compile profile and raw TRX hash are in [receipt.json](receipt.json) and [managed](managed). `git diff --check` passes. Independent source review found no assertion weakening or new production-path bypass.

There was **no author Editor/native rerun, Play session, browser/server run or Web rebuild**. Root reviews this exact correction and assigns one new42-selector engine gate with fresh source/assembly/discovery checks. All corrected native outcomes remain UNRUN until that actual gate. Further engine failures must be diagnosed from that run; this source correction does not predict a42/42 result or establish real Arena/Training/browser/banking completion.
