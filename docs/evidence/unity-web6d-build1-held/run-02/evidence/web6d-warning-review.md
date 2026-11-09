# WebGL warning review — 6d build

Build `build_bf4d3ece70b3` succeeded for WebGL: **17 warnings, 0 errors**; build report SHA-256 `d4f41a5ade6b590a7998a87a486d967eb800faf9912b7ec50cd95eb91fda26ce`.

## Comparison with historical a3d build

The historical a3d review records 32 warnings / 0 errors. Every current file/message warning group matches a group in that review; there are no new warning IDs or messages. Current report has fewer entries (17 vs 32); this count difference is not interpreted as a source-quality change.

| Source file | Current | Historical | Current source occurrence line(s) | Classification |
|---|---:|---:|---|---|
| `Assets/Scripts/Presentation/AssetReadinessPreview.cs` | 2 | 3 | 129, 155 | same-deprecation-as-historical |
| `Assets/Scripts/Presentation/ShowcaseEnvironmentStudy.cs` | 1 | 1 | 243 | same-deprecation-as-historical |
| `Assets/Scripts/Presentation/ShowcasePreview.cs` | 2 | 4 | 244, 394 | same-deprecation-as-historical |
| `Assets/Scripts/UI/AccountRecoveryView.cs` | 1 | 2 | 38 | same-deprecation-as-historical |
| `Assets/Scripts/UI/HubAtriumView.cs` | 1 | 2 | 257 | same-deprecation-as-historical |
| `Assets/Scripts/UI/HubGuideView.cs` | 2 | 4 | 294, 311 | same-deprecation-as-historical |
| `Assets/Scripts/UI/HubProgressView.cs` | 1 | 2 | 48 | same-deprecation-as-historical |
| `Assets/Scripts/UI/MythicUi.cs` | 1 | 2 | 97 | same-deprecation-as-historical |
| `Assets/Scripts/UI/QuestJournalView.cs` | 2 | 4 | 126, 131 | same-deprecation-as-historical |
| `Assets/Scripts/UI/TraderDialogView.cs` | 2 | 4 | 238, 336 | same-deprecation-as-historical |
| `Assets/Scripts/UI/WeaponCounterGuide.cs` | 1 | 2 | 107 | same-deprecation-as-historical |
| `Assets/Scripts/View/ArenaView.cs` | 1 | 2 | 95 | same-deprecation-as-historical |

All 17 entries are `CS0618`: TMP `enableWordWrapping` deprecations and the `ShadowCaster2D.useRendererSilhouette` deprecation. The latter appears once in this report at `Assets/Scripts/View/ArenaView.cs:95`; the historical report had two warning entries at that same site. Preserve the prior caution: `selfShadows` is not assumed to be a behavior-identical textual replacement.

## Timing record

The BuildReport says `2026-11-10T02:18:12.3940060Z` to `2026-11-10T02:21:07.7437132Z` (internal interval 175349.7 ms; report says 175349 ms). The separately recorded queue/persisted start was approximately `2026-11-09T20:18Z`, six hours earlier than the report start. The internal interval matches the reported duration; this does not prove which timestamp basis is authoritative.

## Limits

- The BuildReport warning objects provide file and message, not source line. Listed lines are read-only source scan matches.
- This is warning classification only; no runtime, browser, visual, or performance acceptance is implied.
- No build, job polling, output copy, or project changes were performed.

Historical review JSON SHA-256: `9af5adc0df6cba59e2b8d472c132fd5d976b84d1489a54b15efa05f5d4d12019`.
