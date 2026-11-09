# Bounded repair of the actual6cdf Hub Editor failures

Base: `6cdf893c67f55b70eb832c49ca01e72a7f7839f6`.
Runtime/regression repair: `55f5be573c768c4567d833f62328cb8d54440d61`.
Approved real-lifecycle fixture addition: `9371b8d00af14b39eb3be15d8297e71a52454ed8`.
Only6 existing source/test files change. Original Art JSON is copied byte-for-byte under original-failures; its source
manifest hashes for all6 files match this exact base. The original run remains failed: cosmetics2/7, recovery1/2,
account binding3/4. There is no new actual Editor run in this packet.

## Causes and minimal changes

1. All5 cosmetic failures contain the native CanvasGroup.set_alpha → RetireCard stack. A missing Unity component can
   have a non-null managed wrapper; C# ?? does not invoke Unity's null equality. RetireCard now uses explicit ==null
   before adding LayoutElement/CanvasGroup. Existing active-row/deferred-destruction behavior is retained. The existing
   focus regression now starts without either component and repeats retirement to prove reuse/no duplicates. UUID,
   Unknown history, current-owner fences, alpha/input/layout retirement semantics and focus replacement are unchanged.
2. Recovery failed at focus expected64/actual0; the earlier anchor0 check passed, so this was an empty caret range,
   not merely reversed selection. Pinned TMP clamps caret positions to generated textInfo.characterCount, while raw
   string selection is independent. SelectKey now sets the full raw-string range after the same owner/key recheck.
   The regression asserts the immediate raw range, invokes real TMP LateUpdate to advance deferred activation, requires
   isFocused/readOnly and full unchanged key range (either direction), then retains all clipboard/close/switch/cancel/
   blur/privacy assertions. No automatic copy, credential lookup, exposure or persistence behavior is added.
3. Captured ordinary Join found a Session/transport but URLnull, before Connect. Two distinct lifecycle defects were
   identified by source audit: (a) menu visibility disables combat controls, but Bind's three direct label lookups
   excluded inactive children and could throw before Connect; use includeInactive:true for those3 existing labels.
   (b) the EditMode fixture did not supply ArenaView's real Awake before BindPresentationSession reset its presenters.
   At the existing test transport-factory boundary, invoke the REAL Awake only when both actual presenter fields are
   absent, then assert initialized. No presenters are manually injected and no production lifecycle is relaxed.
   The success regression deliberately hides menu combat controls, verifies inactive labels exist, waits for actual
   transport.Connect or a surfaced error, and preserves the exact URL/canonical name/faction/token assertions.

## Verification and one proposed actual retake

Jobs1/debug-none managed compile of matching local Net/runtime and existing Editor-test source succeeds with0 errors,
1 inherited CS0067 unused event warning. The first compile before the approved fixture addition is retained separately;
the final compile follows that actual source change. Templates/results are isolated in sibling compile, copied from
the existing Unity6000.0.85f2 managed API-reference projects; no Editor/UPM/render/browser or broad .NET tests ran.
Both logs are compile-only, not actual Unity regression passes. git diff --check passes.

Art/root's single affected retake selectors (13 existing tests, not13 passes):
- Roguehalla.Client.Tests.HubCosmeticsViewEditModeTests (7)
- Roguehalla.Client.Tests.AccountRecoveryViewEditModeTests (2)
- MatchClientAccountBindingEditModeTests (4, global class)

Actual native missing-component, TMP selection and ordinary connection acceptance remain held until this retake.
All AccountApi/credential/protocol/Net code, owner privacy/UUID semantics, icons/glass/drawer/header geometry, gameplay,
source fixtures, shared records and Cargo.lock stay outside this patch. No old failed evidence is relabelled as passing.
