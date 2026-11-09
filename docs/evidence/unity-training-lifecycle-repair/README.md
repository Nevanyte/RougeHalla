# Training view lifetime repair after the first red gate

Source **`d90dd0a12b898dceae6715e26c1aec71a68d8d3a`**, direct child of preserved Training
seal **`e2b2671107506f5cb892cfb74cba7374c7a52a6d`**, changes exactly two C# files:
`TrainingConsoleView.cs` and `TrainingConsoleViewEditModeTests.cs`.
Branch: `codex/unity-training-lifecycle-repair`.

**The actual frozen `99172b65a317fc489b2290caa43c1735f26f2e26` run remains FAILED.**
It executed 77 cases once: **73 PASS, 4 FAIL**; the 13 integration cases were **UNRUN**.
The prior64 and five selector cases passed in that run. The Training view group returned
four passes/four failures, so the worker stopped. No remaining cases, retry or Editor
operation was invoked by this repair lane. Earlier/new passes must not be combined into
a replacement result for that source.

`original-red/` preserves exact raw failing-group stdout/stderr/invocation, the execution
ledger, actual loaded identity and source pins. The CLI's transport-level success field
does not change the test group's failing Summary. `original-red/receipt.json` pins the
copied bytes and separates the incomplete 90-case campaign from a completed gate.

## Diagnosed causes

1. **Destroyed native view, retained managed callbacks.** The actual stack shows a captured
   button callback reaching `ActionsAvailable` → `Behaviour.isActiveAndEnabled` after
   `DestroyImmediate(_hostObject)`. The later teardown `Session.Leave()` reaches the same
   property through a still-subscribed state listener. `_destroyed` alone was insufficient:
   the native object was gone before lifecycle cleanup had retired that managed wrapper.
   The console root belongs to an external Canvas, so destroying the host did not destroy
   its UI child. This is a product lifetime bug; it is not dismissed as a test harness issue.
2. **Invalid EventSystem restoration.** The original fixture assigned
   `EventSystem.current = _previousEvents` before retiring its owned system. A null prior
   system is not an entry in UGUI's registered-system list, so the public setter emitted
   the exact “unknown EventSystem” error. The installed UGUI setter promotes only registered
   objects; normal OnEnable/OnDisable manage that registration. Suppressing the log would
   leave the teardown error intact.
3. **Closed panel in the clock-cut test.** The test delivers a genuine lower-time snapshot
   on a later tick. The view correctly revokes the old epoch and closes the panel, then the
   test explicitly reconfirms the new epoch but tries `SelectMob(3)` without opening it.
   `SelectMob` requires `CanAct`, which requires `IsOpen`. This makes the final True
   expectation inconsistent with the missing open precondition. The raw runner retained
   only generic Expected True/False alongside teardown diagnostics, so it does not identify
   that assertion line; the inconsistent source path is independently explicit. Production
   must not auto-reopen after reset to make that test pass.

The coordinator explicitly approved one clock-test precondition insertion: after the
new-epoch `ActionsAvailable` assertion and **before** invoking the captured stale event,
add `Assert.IsTrue(_view.SetOpen(true))`. Every existing outcome assertion and expected
value remains. The stale callback is now tested against a genuinely open, freshly confirmed
panel, while the separate current action can succeed. No other test-body change was made.

## Corrective behavior

- A single `OwnerAlive` gate checks Unity native lifetime before availability/focus/root/
  panel access, action callbacks and Session listener work. A retained wrapper cannot reach
  `isActiveAndEnabled` or act on a later Session after native destruction.
- `OnDestroy` and the retained-wrapper fallback share idempotent owned disposal. It marks
  the view invalid and increments its action generation first, detaches only its own Session
  handlers, clears session/event/root ownership, replaces TMP callbacks, then releases focus.
  Owned root retirement runs in `finally`. No new ExecuteAlways behavior or public gameplay
  shortcut was introduced.
- Root retirement captures the owned GameObject before deactivation. Editor EditMode uses
  `DestroyImmediate` only under `UNITY_EDITOR` and `!Application.isPlaying`; Player/Play use
  deferred Destroy. No mutable root lookup can retire a replacement.
- The fixture null-binds a live view before leaving its owned sessions, retires only its
  host/Canvas/EventSystem, and attempts all cleanup even after an error. All cleanup failures
  are reported in order. It clears owned selection, disables/destroys the registered owned
  EventSystem and lets normal unregister restore the previous current system. It restores
  prior selection only when that prior active system is already current. It never assigns
  null or promotes an unregistered foreign EventSystem.

No game assertion, expected result, selector, attribute, skip, GUID, gameplay rule or
authoritative eligibility was changed. The original no-auto-reopen behavior, Session/epoch
fences, Train payloads and ordinary all-pending `FlushInput` remain. All prior64, other leaf
and integration test bodies remain byte-identical to the preserved seal.

## Verification and remaining gate

| Check | Result |
|---|---|
| Editor Client source compile | 0 errors, 0 warnings |
| Player Client source compile | 0 errors, 0 warnings |
| All Editor test source compile | 0 errors; one preexisting Trophy CS0067 unused-event warning |
| Net library build for compiler reference | 0 errors, 0 warnings |
| Compiled selector and typed-argument metadata | All 90 match the unchanged selector list and prior typed contract |
| Editor/Player lifetime guard IL | Guard ordering and owned cleanup checks pass; Player root retirement uses deferred Destroy only |
| Unchanged managed library suite | Not rerun, as directed; no Net/library test source changed |
| Current native tests / remaining integration13 / retry | **UNRUN** |
| Editor/Play/browser/Web/server/cloud operations here | **None** |

`logs/body-scope-checks.json` verifies the entire eight-test body/attribute tail against
the old bytes plus exactly the coordinator-approved line. `source-change.patch.gz` preserves
the exact old/new unified diff losslessly; its decompressed byte hash is in
`source-diff-receipt.json`. Raw compile logs/profiles, source/meta preservation checks and
the unchanged prior typed 90-case contract are included in this seal.
`metadata/current-selectors.json` describes the current compiled 90 cases; the metadata
report pins all eight current fixture source/meta pairs and all compiler inputs.
Its DLL hashes/MVIDs identify the managed compiler artifacts only, not a Unity-loaded
assembly. The audit reads metadata and IL without invoking test bodies or Unity APIs.

This is compiled corrective source for independent review, not a new Unity pass. Root must
review and freeze a fresh corrected source before authorizing **one** justified complete
90-case retake. Keep the failed 99172 record distinct and return the Editor to its frozen
baseline through the sole Editor owner. Layout, browser and server-applied Training proof
remain separate and unclaimed.
