# Proposed 64-case Unity settlement gate

Gate source: **`305a45ced95b091e9b920b14251542788b91189c`**.
Production implementation remains **`17b0f6401d730012f5e3580d2a59ed805e369fdc`**;
its managed/source evidence was sealed at `70e5335ca0479aa28853984b63019b6519f1f528`.
This packet follows that seal and strengthens one additive Editor test body. It does
not change production, managed test code, the previous 42 Editor cases, or any case name.
The branch was not rebased or merged onto a later main revision.

**All 64 cases remain UNRUN at this source. No Editor lease was used.** This packet
proposes an exact contract for coordinator review; it neither authorizes nor launches a
Unity campaign. The coordinator chooses the frozen integration SHA and dispatches the
sole Editor owner. Read-only discovery at that frozen SHA must bind the exact methods,
argument types/values, source/meta identities and unique leaf names before execution.
Missing, extra or substitute leaves must hold the gate.

## Scope and typed selectors

`proposed-contract.json` supplies all 64 normative CLR method/typed-argument tuples and
full NUnit leaf selectors. The 42 prior full names come from actual **public NUnit
discovery**, not the CLI result labels that omit namespaces. The 22 new cases come from
compiled test metadata and the installed NUnit argument-name formatter; no test body or
Unity API is invoked to prepare names. Int64 arguments retain their CLR type and exact
decimal value. `unchanged-old42-selectors.json` separately preserves the prior selectors.

| Fixture | Preserved cases | New cases |
|---|---:|---:|
| `Roguehalla.Client.Tests.QuestJournalViewEditModeTests` | 8 | 0 |
| `Roguehalla.Client.Tests.TraderDialogViewEditModeTests` | 6 | 0 |
| `Roguehalla.Client.Tests.PlayerFlowsEditModeTests` | 11 | 0 |
| `MatchLaunchEditModeTests` | 17 | 0 |
| `MatchSettlementEditModeTests` | 0 | 22 |

## Expected observations in the 22 new leaves

| Method | Cases | Expected behavior to verify in Unity |
|---|---:|---|
| `GenuineResultBeforeModeConfirmationNeedsAnAcceptedOwnedArenaFactAndExplicitCheck` | 1 | A genuine early Result is retained without querying; an accepted Arena fact plus explicit Check starts the exact owned UUID read. Saved credit is independent of wire GV and cached balance. Result and Leave do not reopen/claim the account. |
| `AcceptedArenaWithoutAGenuineResultNeverSendsAReceiptRead` | 1 | Accepted Arena alone and manual Check cannot send a receipt read. |
| `AcceptedTrainingWithAGenuineResultNeverQueriesOrClaimsSavedCredit` | 1 | Real accepted Training and genuine Result cannot query or display saved credit. |
| `CommittedZeroVoidAndMaximumCreditsAreDisplayedWithoutBalanceInference` | 3 | `(false,0L)`, `(true,0L)` and `(false,9007199254740991L)` show exact committed facts; explicit void is distinct and cached balance stays unchanged. |
| `UnknownOnlyBurstHasThreeSequentialReadsAtTwoAndFiveSecondsAndManualCooldown` | 1 | Three nonoverlapping reads maximum; unknown-only waits of 2s then 5s; in-flight/manual controls cannot overlap; manual cooldown is exact. |
| `HttpErrorsStopTheBurstAndNeverBecomeUnknownOrSaved` | 5 | `403`, `408`, `429`, `500`, `503` stop automatic reads and display error, never unknown or saved. |
| `TimelineCutCancelsSuccessAndErrorAndRequiresAnExplicitNewBurst` | 2 | Old success and old error are both canceled/fenced across a real source-clock cut. Fresh accepted Arena does not restart; explicit Check can start a new read. |
| `ReconnectCannotRestartOrClaimUntilAFreshSameMatchArenaFactAndManualAction` | 1 | Drop/Welcome revokes mode confirmation and the old read; same UUID needs a fresh accepted Arena snapshot and manual Check. |
| `DifferentWelcomeCannotPairRetainedLastResultWithANewMatchUuid` | 1 | A different Welcome UUID clears receipt context despite retained `LastResult`; only its own genuine new Result can start a read. |
| `DuplicateDecodedResultFencesTheOldIdentityWithoutReplenishingAutomaticBudget` | 1 | A second decoded result identity cancels the old read and cannot refill automatic budget. Old completion cannot publish; manual Check can proceed. |
| `OwnerChangeHidesTheRowAndFencesBothOldSuccessAndError` | 2 | Owner change immediately requests cancellation and hides the row. Both late success and late error remain suppressed; manual Check cannot leak a request. |
| `LeaveIsImmediateAndRetiredCallbacksCannotTouchTheReplacementResults` | 1 | An old HTTP fake deliberately remains incomplete after cancellation while a replacement owned Arena reaches its own genuine Result. No overlapping read or stale publication is permitted. Old completion leaves the replacement paused; only explicit Check starts exactly one current read. Retired event delegate cannot act. |
| `LeavingDuringUnknownDelayCancelsTheTimerAndDoesNotSendAnotherRequest` | 1 | Leave cancels the pending unknown retry timer immediately and sends no next read. |
| `ResultsRowUsesActualReceiptStateAndNeverBlocksReturnToMenu` | 1 | Actual HUD row follows checking/committed state, does not reopen profile, and clears after Return to menu. |

The strengthened cross-session case is nonvacuous: it asserts the fake reply task is
still incomplete after cancellation, creates the replacement owned Session and accepted
snapshot before completing the old request, and asserts both no second HTTP request and
disabled Check. After old completion it asserts no publication or automatic read, then
the current manual read is the one that confirms `+4 GV`. This tests the intentionally
recoverable paused state for a transport that ignores cancellation.

## Source and compile evidence

`source-inputs.json` pins 192 current C# inputs. `source-checks.json` compares them to the
prior seal: the **only changed input** is the strengthened
`MatchSettlementEditModeTests.cs` body. All production and managed test sources remain
byte-identical to the implementation that passed **822/822** managed tests, including
49 settlement cases and the five allocation controls. All 30 preexisting Editor `.cs`
files remain byte-identical to `854a08f1d622e931eff40eba40ba3820cbe040da`.

The revised Editor test source was compiled against the same installed Unity/package
DLLs: **0 errors**, one preexisting unused `Closed` event CS0067 warning at
`MatchHudTrophyEditModeTests.cs:116`. This is a managed source/type check, not Unity test
execution. Production Editor/player compilation and the 822-case managed run remain
preserved in [the original settlement packet](../unity-settlement-receipt/README.md).
No actual browser, Web build, server or cloud operation occurred.

The source/input manifest, compile logs, metadata/name-formatting helper and typed contract
are pinned by `MANIFEST.json`. Its payload scope is this gate-contract directory, excluding
the manifest itself; the earlier settlement evidence manifest remains unchanged.
The formatter's exact source bytes are stored losslessly as `name-formatter/Program.cs.gz`
to preserve the generated source's trailing blank line without adding a whitespace failure.
Decompress it to `Program.cs` beside `NameFormatter.csproj` to reproduce the pure formatter
proof; the decompressed source matches the SHA-256 recorded in the proof and contract.
