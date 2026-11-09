# Owned Arena disposal in Editor EditMode

**Corrective source ready; another actual engine42 gate is UNRUN.** Code `8ef97af964e598e970f1c04e058a99de63449543` is based on failed gate source `8cdbd77d4f3e1e002956b2f5c352eea53b12a42d`, on `codex/unity-editmode-disposal`. Only `MatchClient.cs` changes:18 inserted lines and two callsite replacements.

## Actual failure retained

The 8c run executed42 selectors: old25 all passed, Launch17 had1 pass/16 failures, totaling26 passes/16 failures. MVID was `b78f3c03-15d1-4924-b90a-9fe89d2737f4`. Every recorded launch failure is the real Unity error **“Destroy may not be called from edit mode!”**, at `CloseCurrentSession` line158 through public Leave, refusal or replacement launch. EditingTarget does not create an Arena and passes.

The four original group result files, loaded-identity record and as-tested source manifest are copied unchanged under [raw-failed-8c](raw-failed-8c). Their hashes are in [receipt.json](receipt.json). The actual gate remains FAIL; its output is not treated as expected or suppressed.

## Exact seam and correction

All MatchClient partials were inspected. There are only two Arena destruction sites: the stale-generation abort in `JoinCore` line87 and captured-old-Arena cleanup in `CloseCurrentSession` line158. Both used the player-only deferred `Destroy` in an actual Editor EditMode public lifecycle.

Both now use one helper taking the already captured `GameObject`. It deactivates the owned root, uses `DestroyImmediate` only inside `#if UNITY_EDITOR` when `Application.isPlaying` is false, and otherwise retains deferred `Object.Destroy`. It reads no mutable Arena/Session field and never looks up a replacement target. The stale-generation identity guard remains.

The close ordering is unchanged: invalidate old Session/bindings, clear Arena ownership and held input, retire the captured old root, show the menu, then call the captured old Session's Leave. A replacement created by that last callback therefore starts after the old root is retired. The known `ArenaView.OnDestroy` only unsubscribes its settings callback; no new launch is triggered there. No ordinary Player/Play destruction timing is changed by this correction.

The complete launch fixture and all old25 test files are byte-identical to8c. Real public Join/Leave/refusal, renderer initialization, all17 bodies/attributes and prior healthy controls remain. No log allowlist, expected error, reflection bypass or PlayMode migration was added. Game rules, networking/ABI, account policy, assets/settings, shared records and lockfiles are unchanged.

## Focused managed checks

- Full Editor Scripts compile:0 warnings/0 errors.
- Full Editor test-source compile:0 errors, one existing `CS0067` unused Trophy fixture event warning. No tests executed.
- Full Player Scripts compile without `UNITY_EDITOR`:0 warnings/0 errors.
- Actual compiled helper IL inspected with Mono.Cecil metadata only: Editor contains `get_isPlaying`, `DestroyImmediate` and deferred fallback; Player contains `SetActive` and deferred `Destroy`, with no immediate call or `isPlaying` check.
- Source/preprocessor checks verify the conditional, both callsites, captured-target/identity guards and teardown ordering. `git diff --check` passes.

Profiles, logs, inspector source and assembly hashes are retained in [managed](managed) and [receipt.json](receipt.json). These checks compile/read assemblies without invoking Unity methods; they do not establish an actual runtime pass.

No author Editor/native rerun, Play, browser/server run or Web build occurred. Root reviews the exact diff and evidence before assigning another actual42 run. The corrected native result is UNRUN, and banking implementation remains paused.
