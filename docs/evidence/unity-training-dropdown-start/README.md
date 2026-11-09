# Training dropdown EditMode lifecycle correction

Source **`76f341ed60ca5bb8ac70d76cf244c9afc1be9e23`** is a direct child of the
preserved repair seal **`2601f9d84fadc20ae57d193c29409ca4042614a4`** on
`codex/unity-training-dropdown-start`. It adds four lines in one file:
`TrainingConsoleIntegrationEditModeTests.cs`. No runtime, package, protocol,
library, asset or settings source changes.

## Exact failure and installed source

The complete frozen **`956a80dcfe89dd290816f2ea6051b210b7a4834f`** retake remains
**FAILED: 90 executed once, 89 PASS, 1 FAIL, 0 UNRUN, no retries**. All eight
Training view tests passed; the Training integration group passed 12 of 13.
`DropdownEscapeRequestsPopupHideBeforeConsoleCloseAndTrainingLeave` threw before
its popup assertions, from public `TMP_Dropdown.Show()` through
`AlphaFadeList(float,float,float)` at installed `TMP_Dropdown.cs:1183`.

The installed `com.unity.ugui@cd4936b8279f` is version 2.0.0. Its dropdown source
SHA-256 is `e4f051dabc62b6d88ead39185aa9f93a269c25f3f517160ebe374942906c211d`.

- Line 365 declares `m_AlphaTweenRunner` without an initializer.
- `Awake()` at 461–473 does not initialize that field and exits outside Play mode.
- The actual initialization is in protected `Start()` at 475–482: create the
  `TweenRunner<FloatTween>`, call `Init(this)`, call `base.Start()`, and refresh
  the shown value.
- Public `Show()` has already created its popup and passed template setup when
  it calls `AlphaFadeList(..., 0f, 1f)` at 968. The exact failing line 1183 is
  `m_AlphaTweenRunner.StartTween(tween)`.

The synthetic EditMode fixture configured a real template/options and called
public `Show()` without this required `Start()` initialization. The raw stack,
the unique field initializer and the path already past popup setup identify a
fixture lifecycle omission. They do not identify a production template defect.
`installed-package/` pins the source/package bytes and relevant numbered excerpts.

## Bounded correction

The existing test dropdown subclass exposes
`InitializeForEditMode() => base.Start()`. Fixture setup invokes it exactly once,
after configuring options and deactivating the template, before selecting the
dropdown and calling its real public `Show()`.

The test continues through actual public Show/Hide behavior and its existing
EditMode disposal overrides. No private tween, popup or `IsExpanded` state is
installed. No exception is suppressed. All existing outcome assertions, expected
values, test methods, attributes, selectors, typed arguments and GUIDs remain.
`source-change.patch.gz` (lossless Git diff) and `logs/body-scope-checks.json` verify the exact two
insertions; all other bytes of the changed file are preserved.

This corrects the proven initialization precondition. It does **not** claim a
new native pass or rule out a later failure after the old throw point.

## Compilation and preservation

| Check | Result |
|---|---|
| Exact current all-Editor-test-source compile | 0 errors; one preexisting Trophy CS0067 unused-event warning |
| Compiled selectors and typed arguments | All 90 match the unchanged prior contract and selector list |
| Compiled lifecycle IL | One real TMP Start call in the initializer; one fixture initialization before one public Show |
| Runtime and library source | Unchanged from the preserved repair seal |
| Other Editor test sources | 33 files byte-identical |
| Existing metadata files | All 616 byte-identical |
| Unchanged managed suite | Not rerun, as directed |
| New native tests, Editor/Play, browser/Web, server/cloud operations here | None; **UNRUN** |

The compile profile uses the already built, unchanged Client/Net references from
the previous repair compiler run. This is ordinary managed compilation, with no
Unity Editor import or execution. Compiled artifact hashes/MVIDs are not a claim
about a newly loaded native Editor assembly.

`metadata/metadata-audit.json` and `metadata/dropdown-il-proof.json` pin the
compiled selector comparison and actual call ordering. The initializer calls
the installed package's real `Start()`; that method creates and initializes the
runner which `AlphaFadeList` reads. The audit only reads metadata and IL: no test
body or Unity API was invoked. `metadata/source-input-pins.json` hashes the eight
fixture source/meta/GUID pairs, compile profile, 169 assembly references and
compiler/package artifacts. The audit tool source and raw logs are included.

## Both failed revisions remain separate

`first-red/` preserves all seven original raw fixture groups, invocation records,
source identity, expected 90-case contract, loaded identity, publication pins,
discovery binding, ledger and native summary for frozen **99172**. Its result
remains **77 executed: 73 PASS, 4 FAIL, 13 UNRUN**. The complete original proof is
also preserved in coordinator seal `ea39a0aa1007456360e319026b0e68cf56bf4a37`.

`second-red/` preserves all eight raw fixture groups and the corresponding
identity/source/contract/summary records for frozen **956a**. Its result remains
**90 executed: 89 PASS, 1 FAIL, 0 UNRUN**. Each copy receipt hashes the exact raw
bytes. `native-red-accounting.json` independently checks unique raw result names
against each unchanged 90-case contract without executing tests.

The second ledger lists seven fully passing completed fixture types and the
failing current group's 13 names as `unresolvedCurrentFixtureFullNames`. It lists
zero `unrunFullNames`. Its eighth group records a validation error rather than a
passing summary. **Unresolved is not unrun**: the actual eighth raw output has all
13 results, and all eight raw outputs plus the native summary establish the
complete 90-case result. The ledger is retained byte-for-byte.

The earlier four view failures are fixed in the distinct 956a run; their original
failed records remain intact. Counts from different source revisions are never
combined. Layout was not attempted because the full 90-pass prerequisite was not
met. Coordinator review and a fresh source-bound native gate are still required.
