# Player-flow corrective source receipt

This receipt supplements the original [source handoff](../README.md); it preserves that receipt, its failed initial compile and its original 19 engine-unrun test identities. No prior result has been reclassified.

## Identity and bounded fixes

- Prior sealed source/evidence: `49903926f770fa81ebaec3e3be838920bc01d6e7` / `8c21f0e5faf13cc35f8f15c5a23a811d6b4827ab`.
- Corrective source: `de86e15952d0d94ef1dfc992d2207c8494285234`, branch `codex/unity-ui-player-flows`, based directly on that evidence seal.
- Exactly four changed code/test files: MatchHud.cs, MatchHud.PlayerFlows.cs, PlayerFlowsEditModeTests.cs and QuestJournalViewEditModeTests.cs. There are no new metas or other source/asset changes. The original source packet remains 18 files including unchanged metas.
- Root review requested exactly these two repairs. Root owns review/merge; sole-Editor ownership remains with the art lane. No further UI feature or visual work is included.

The quest reconnect test now expects the runtime's existing `Reconnecting · quest actions paused` wording. The Reconnecting state assertion and inactive row requirements remain; explicit disabled-acceptance and FlushInput/no-input assertions strengthen them. No runtime text was changed to satisfy the stale expectation.

The notice delegate now captures Session, TimelineEpoch and delegate identity. An earlier EventsReceived subscriber can deliver a source-clock cut while an old invocation list is running; a Session-identity-only guard admitted that old callback after the history had cleared. TimelineReset now detaches/rotates the listener before clearing and refreshing UI. The old captured epoch/delegate is rejected, and the new listener accepts subsequent batches. Delegate identity also fences an unsubscribed binding even if a rebind uses the same Session and epoch. Unbind invalidates the field before UI cleanup. No event deduplication or label-based identity was added.

The added encoded-frame regression places an earlier subscriber before the HUD listener, fills old history, delivers a newer tick with equal source time during an old notice batch, and checks the real Session epoch increment and empty history when the old invocation resumes. Two subsequent batches must arrive in source order including identical Toasts. Existing old-Session rebind and resumed-Welcome tests remain unchanged.

## Validation

```sh
/Users/nevinmckinnon/.dotnet/dotnet build /tmp/roguehalla-ui-player-flows-compile/tests/Tests.csproj --nologo -v:q
```

One corrective managed-graph compile passed: **0 errors, 1 existing CS0067 unused-event warning** in MatchHudTrophyEditModeTests. Matching Net, Unity runtime and Editor-test sources were compiled against installed Unity assemblies and the art checkout's package assemblies. Raw output is tracked in [managed-compile.log](managed-compile.log). The project paths/hashes match the earlier [managed graph receipt](../managed-graph.json). No Unity tests were executed by this command.

```sh
/Users/nevinmckinnon/.dotnet/dotnet test client-unity/RoguehallaNet.Tests/RoguehallaNet.Tests.csproj --filter 'FullyQualifiedName~WishSessionTests.SourceClockCutsAcceptFreshTicksClearTemporalConsumersAndPreserveCanonicalStateAndWalk|FullyQualifiedName~WishSessionTests.AClockCutRejectsDelayedOldPongsAndReconnectClearsOldWishAndMovement' --no-restore --nologo -v:minimal
```

Both affected unchanged pure Session source-clock controls passed: **2/2**, no failures/skips. This invocation emitted an `AD0001` analyzer exception warning (`CSharpDetectPreviewFeatureAnalyzer`, MissingMethodException in CodeAnalysis HashSetExtensions) while building RoguehallaNet.Probe; it is preserved in the tracked raw [source-clock-controls.log](source-clock-controls.log). No source or analyzer configuration was changed to suppress it. The prior 14 quest/trade pure controls are historical passes and were not repeated for this correction.

Static checks passed: the four-file correction scope, whitespace, unchanged meta bytes/GUIDs, exact SHA256 against the source commit, and full selector identities. [source.sha256](source.sha256) gives all 18 current source/meta file hashes; [correction.sha256](correction.sha256) identifies the four corrected files. [native-selectors.txt](native-selectors.txt) gives **20 compiled, engine-unrun methods**: journal7, trader6, integration7. The only added method is `InFlightSameSessionNoticeCallbackCannotCrossSourceClockCutAndNewEpochKeepsDuplicates`. The older 19 methods have not acquired native execution evidence.

The new regression has been source-reviewed and compiled; it has not been engine-run or empirically demonstrated red/green in Unity. No Editor, Play, screenshot, capture, browser, Web build or performance run occurred. All original rendered-hit, layout, authoritative-browser, privacy, recovery and full-inventory acceptance limitations remain open. No Net/Rust/protocol/status/lock changes were made. This correction is sealed for Root handoff; the lane stops here.
