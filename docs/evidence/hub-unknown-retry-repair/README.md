# Hub uncertain-purchase reopen repair

Base: `719cc2b7e78415226246c0273ae9c78f7385fc04`. Source repair: `6749d62f44483deb9fa1a8d37ce3f20c814419b1`.
The root owns integration and the actual Unity retake. This packet changes exactly one runtime display predicate and strengthens the same two existing Editor cases; the class still contains seven tests.

## Captured native failures

`original-failures.json` is a byte-identical copy of the actual Art EditMode receipt from `combined-719cc2-2026-11-08/evidence/tests-HubCosmeticsViewEditModeTests.json`: five passed and two failed. `original-source-integrity.json` binds it to the frozen 719 source. Both affected base-file hashes additionally match the retained 1,122-row `source-after-tests.json`; the exact two rows are in this packet's manifest.

- `SameNameCredentialReplacementHidesAndRejectsOldUnknownRetryWithoutLosingHistory`: line247's string Contains constraint received a null summary, causing NUnit's "actual value must be an IEnumerable" exception. This was not an absent profile assertion failure. The strengthened regression separately asserts the admitted full profile and nonnull summary so any later null has an explicit cause.
- `UnusableSameNameOwnerClearsWalletAndStatusWithoutDiscardingUnknownPurchase`: line327 expected the retained Unknown retry status after same-key reopen; the UI instead displayed "Choose a cosmetic to buy or equip." Earlier Unknown status, clearing on Cancel, current-owner operation check and restored500GV wallet had passed.

## Cause and bounded repair

The API's immutable response result is bound to the old flow generation. Cancel/reopen correctly invalidates that result, while `AccountApiService.IsCurrentOwner` correctly recognizes the retained operation when endpoint/name/current confirmed token still match. `MutationSummary` checked both and suppressed the valid uncertain operation because its old response was stale. The item-level `FindLatest` and explicit `Retry` already use current operation ownership and did not have this extra result-generation filter.

Keep the exact name/current registered-operation ownership check first. Exempt only `AccountMutationState.Unknown` from the subsequent stale-result suppression. All other result states keep that suppression. No result is published into a current profile, no money/item is granted, and no operation or UUID is replaced or discarded. Cancel/Opening/Failed/unusable profiles still clear the wallet/status. A different credential, even for the same name, fails the unchanged current-owner gate; its prior Unknown status and retry action stay hidden and direct retry does not send.

The two existing cases now distinguish a completed retained old result from the operation's current ownership, prove no POST on reopen, require the existing same-purchase retry action, and preserve explicit same-UUID retry/replacement refusal. The first case now waits for the same bounded completed-view condition already used in the second case rather than only the operation's intermediate state. No expected status was relaxed to default or null. No new cases were added.

## Validation and remaining gate

One managed API-reference compile of the actual runtime and existing Editor-test sources passed: zero errors, one inherited CS0067 unused `MatchHudTrophyEditModeTests.TestTransport.Closed` warning. `managed-compile.txt` preserves the exact output. The private copied project files target netstandard2.1/C#9 and reference the installed Unity6000.0.85f2 APIs; source and Net project references point only at this isolated checkout.

Command (after sourcing the coordinator's `final-env.sh`):

```sh
dotnet build /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/hub-unknown-retry-repair/compile/Tests.csproj --verbosity minimal -m:1 -p:DebugType=None -p:DebugSymbols=false
```

No Editor, Play, browser, screenshot, source capture, native test execution or broad .NET test suite was run. The native five-pass/two-failure receipt remains failed evidence, not a post-repair pass.

The first actual retake selector is `Roguehalla.Client.Tests.HubCosmeticsViewEditModeTests` (seven existing cases). If it passes, Root plans the unchanged remaining `Roguehalla.Client.Tests.HubProgressViewEditModeTests` (three), `Roguehalla.Client.Tests.AccountRecoveryViewEditModeTests` (two), and global `MatchClientAccountBindingEditModeTests` (four). Their actual outcomes are pending. The earlier drawer/input/owner passes remain revision-scoped evidence owned by Root.

No account API/credential logic, core Net, protocol, gameplay, styles/layout, earlier fake-null/recovery/includeInactive/Awake repairs, shared status or lock file was changed.
