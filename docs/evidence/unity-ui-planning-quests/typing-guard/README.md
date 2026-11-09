# Planning quest review: text-input ownership correction

This supplements the [original planning source handoff](../README.md). Its source/compile/pure receipts remain preserved. No earlier engine-unrun result is promoted.

## Exact correction

- Prior source/evidence: `ed2e4c5d15658d6b277565c32b9b5e6d7c54dbed` / `ac584b2dba9ffa7a560936f54055fcb6bb6be597`.
- Corrective code: `ecb06b97189d14c236aba3bf7d64288c0fffc451`, parent the prior evidence seal, on `codex/unity-ui-planning-quests`.
- Only `MatchHud.Features.cs` changes: six lines added, three removed. All three existing quest/trader/player-flow test files are byte-identical to the prior seal, including `PlanningJournalRespectsSettingsAndFocusedTextEntry`. No expectation, test count, native fixture, map, Net/Rust/rule, protocol, asset, scene, status or lock change.

Root's read-only review found that generic Tab navigation ignored the initial text-input state. During planning it could move focus away from a TMP field, after which the map call re-read Typing as false and interpreted a digit from the same key batch as a planning action. The existing new regression already requires the field to remain focused and no J/Tab/digit/W commands to escape; it is unchanged.

ReadUiInput now captures Typing once at entry, before any focus-changing handler, and uses it consistently for the ordinary hotkey gate, generic Tab navigation and map input. A typing field therefore keeps focus through ordinary J/Tab/digit handling, and the existing world-input reader still observes the focused field. No persistent latch or new input context/state was introduced. The explicit recovery Escape exception still deactivates its field and closes the Hub panel before the ordinary gate; the captured value suppresses other UI/map keys in that same read. Native TMP explicit submission callbacks are untouched. Existing planning/page/modal and authoritative CanAccept behavior is unchanged.

## Validation

```sh
/Users/nevinmckinnon/.dotnet/dotnet build /tmp/roguehalla-ui-planning-quests-compile/tests/Tests.csproj --nologo -v:q
/Users/nevinmckinnon/.dotnet/dotnet test client-unity/RoguehallaNet.Tests/RoguehallaNet.Tests.csproj --filter 'FullyQualifiedName~UiInputGateTests|FullyQualifiedName~PlanningSelectionsTests' --no-restore --nologo -v:minimal
```

One corrective managed graph compile passed: **0 errors, 1 existing CS0067 unused-event warning** in MatchHudTrophyEditModeTests. Matching Net, actual Unity runtime and all Editor test sources compile against installed Unity6000.0.85f2/package assemblies with the same separate runtime/test graph. One focused pure-control invocation passed **10/10** (UiInputGate5, PlanningSelections5), zero failed/skipped. Complete raw stdout/stderr from each invocation is tracked in [managed-compile.log](managed-compile.log) and [pure-controls.log](pure-controls.log). No broad, repeated unchanged QuestBridge, Rust or Editor suite was run.

Static checks pass: exact one-file corrective scope, whitespace, the current full five-file planning source hashes, unchanged metadata, unchanged exact25 selectors and byte-identical three test sources/regression. `source.sha256` pins all five current planning files, `correction.sha256` the one corrected file, `native-selectors.txt` the unchanged25-method contract and `validation.json` the checks/counts and test hashes.

The correction has been source-reviewed and compiled; the unchanged focus regression has not been engine-run here. No empirical Unity red/green result is claimed. **All25 current-source engine selectors remain UNRUN** (Quest8, Trader6, PlayerFlows11); the earlier exact43e6d08d engine20 pass remains historical. Root owns review/merge and the sole art Editor owner owns that finite engine/rendered gate. No Editor, Play, capture, screenshot, browser, Web build or performance run occurred, and the original held visual/browser gates remain unchanged. This corrective source/evidence handoff ends stopped for Root review.
