# Owned Arena / Training launch packet

**Source implemented; engine and browser acceptance remain UNRUN.** Source commit `4ec547312dc9b7214bbf6a8e20a6ff7ed3f3ba3b` is based on coordinator main `a0c4818ce9df8ad0f4124db31e65ba1244bddc3b`, branch `codex/unity-launch-modes`. This packet adds deliberate launch selection to the existing menu; it does not replace account, recovery, progression, cosmetics or result UI.

## Operator configuration and player flow

`server` retains its existing Arena meaning and default. Optional `trainingServer` supplies the separate Training WebSocket endpoint. For example, a page at `https://game.example/play` with account API `https://game.example/api` can configure:

```text
server=wss://game.example/arena/ws
trainingServer=wss://game.example/training/ws
```

An operator must route these paths to the separate real runtime processes while retaining the fixed authoritative account API origin. This packet creates no proxy, process, hosted placement or deployment. The unchanged `AccountConnectionPolicy.CheckOwnedTarget` requires compatible HTTP(S)/WS(S), the same host and port, no URL userinfo/query/fragment, and a path ending in `/ws`. A different localhost port is a different origin and is refused.

`MatchLaunchConfig` independently validates and caches immutable typed targets. Missing or invalid Training disables its action with a clear unavailable message; it never substitutes Arena. Invalid Arena does not silently select Training. URLs and credentials are not included in these messages. Existing one-target visits keep their Arena default.

The existing **START RUN** action explicitly chooses Arena; a separate **TRAINING** action explicitly chooses Training. Return to menu and Play again retain the selected mode within the current client lifetime. A retained seat must be left through **Leave / menu** before choosing another mode or faction. Reload still starts with the existing Arena default; no live-seat token persistence was added.

## Ownership, callback and mode guards

- The account owner and credential origin remain fixed. The target, requested mode, faction and launch generation are captured before the owned account request. The current selection/target/generation and `AccountFlow.CanJoin` are checked before synchronous Session creation. Normal Hello still carries the actual owned canonical identity/token; no new mode field, ticket convention, name convention or ABI change exists.
- A mode change during a pending account request cancels/fences that request. Profile/faction changes, Leave and destruction invalidate old completions. Synchronous account callbacks cannot let an outer faction/join operation overwrite or relaunch a newer choice.
- Session callbacks capture the exact Session and generation. Teardown removes old bindings, clears shared presentation state and retires the old Arena before invoking the old Session's Leave. Reentrant callbacks may start a replacement without the outer teardown destroying it or cancelling its account operation.
- Welcome does not contain the mode. Its default `Training=false` is unconfirmed. The initial Idle/Connect/Welcome window keeps gameplay input/presentation blocked, the pending menu noninteractable, and map/player-flow views unbound. The global Leave control remains available.
- Only the currently accepted snapshot can confirm the requested mode. Welcome/timeline changes revoke confirmation and recheck it. A mismatched delivered Training fact safely leaves/refuses that exact Session with an explanation and no fallback. Retired callbacks cannot confirm, reset or refuse a replacement.
- The **PRACTICE** indicator and no-run-rewards/banking copy require a matching delivered Training fact. Training labels do not manufacture that fact. Unconfirmed terminal sessions unlock recovery controls; changing destination still requires explicit Leave. Arena `Training=false` alone cannot distinguish core from Source runtime, so actual Source endpoint acceptance remains required.

No Rust rules, training commands/console, map code, art/assets/resources/prefabs, protocol codec/model, account credential policy, result banking contract or shared status/lockfile changed. Purchases and bank-complete inference remain outside this packet.

## Validation

The final rebuilt .NET suite passes **768/768**, including **16** new pure launch-config cases. These test independent availability, exact origin/scheme/port/path/userinfo/query/fragment refusal, missing Training/no fallback, unknown mode, actual nullable mode facts and unavailable-message redaction. [net-validation.json](net-validation.json) retains counts and raw external TRX hashes for all three complete runs. An intermediate run had one stale assertion for a removed administrative hint; the final run corrects that redundant text expectation while retaining the meaningful availability/origin checks. The earlier raw outcomes remain outside Git without overwrite.

Compile-only builds of all Unity Scripts and Editor test sources pass against the current built Net assembly and existing read-only Unity DLLs. Client compile:0 warnings/0 errors. Test-source compile:0 errors and one existing `CS0067` unused `MatchHudTrophyEditModeTests.TestTransport.Closed` event warning. Copied project profiles and logs record the exact configuration; this is managed compilation with Editor symbols, not Unity Editor execution, IL2CPP/AOT, Web compilation or rendered proof.

[expected-native-cases.json](expected-native-cases.json) records **17 expected selectors in14 new methods**, all **UNRUN**. The cases cover unavailable/cross-origin targets, pending/rapid switches, target changes, Leave/destruction, real owner Hello identity, first-snapshot confirmation, wrong-mode refusal, resume epochs, retired callbacks, reentrant teardown/cancellation, pending J/map suppression, Practice/Play again, and terminal-before-fact recovery. Deferred cancellation tests await the exact production `JoinOwned` worker rather than sleeping; separate cases exercise the public Join dispatcher and menu/decoded Session seams. No fixture success is offered as actual backend/browser evidence.

The existing Quest journal, Trader, PlayerFlows and account-binding test files are byte-identical to the base, as recorded in [source-receipt.json](source-receipt.json). Their engine regression runs remain for Root's batch. `git diff --check` passes. No Rust tests were rerun because no Rust source changed.

## Remaining acceptance

Root assigns the exact Unity native regression and new17-selector gate, then batches the Web build. Actual owned browser acceptance still needs the approved same-origin routing with two real runtime processes: account claim/load/reload, Source Arena planning/active/result/menu, Training with delivered `Training=true`, Leave/return and reconnect/mismatch/cancellation behavior. Verify layout/focus/text scaling and updated launch controls in the actual engine/browser.

There was **no Editor run, new Web build, browser/server process run, new screenshot, cloud operation or deployment** in this packet. The frozen a3d baseline proof and its separately reviewed PARTIAL scope remain unchanged. Training console, full-page live-seat resume and match-correlated banking receipts are later packets. This source seal does not claim the full game UI complete.
