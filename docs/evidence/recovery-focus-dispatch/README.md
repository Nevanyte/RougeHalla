# Recovery ShouldRunBehaviour diagnosis and test-only repair

Base inspected: `ff5a8969263046a43544883f3d2e22677f100771` in the private composed protocol14-client-union repo. Initial read was at `a5eeb315a10e8e28efb37568330cf13179e8d118`; the relevant test and runtime source are unchanged. Owner reported the finite 95bd retake: recovery1/2 failed with an unhandled native Unity `ShouldRunBehaviour()` assertion at AccountRecoveryViewEditModeTests.cs:183, Component.SendMessage. The exact failed receipt remains owned/preserved by the Art lane. This diagnosis did not launch/access the Editor, rerun Unity, inspect private keys or rewrite receipts.

## Finding

The current failure is the EditMode message-dispatch context, not evidence that recovery TMP is inactive or disabled at activation:

- Test line150 calls TMP_InputField.LateUpdate directly through reflection. It does NOT use SendMessage. Lines151–155 then demand focus, read-only mode, unchanged key and full raw-string selection in either direction. Execution reaching the reported line183 is later than those assertions.
- Line183 instead calls `_view.SendMessage("OnApplicationFocus", false, RequireReceiver)` on AccountRecoveryView. That class is an ordinary MonoBehaviour, not ExecuteAlways. The test is EditMode and only its EventSystem subclass is ExecuteAlways (test16–17; setup60–65). GameObject/Component SendMessage goes through Unity's behaviour-dispatch eligibility; it is the inappropriate entry here.
- The repository already documents this exact restriction in ArenaPresentationEditModeTests.cs358–362: EditMode lacks the player lifecycle, SendMessage refuses non-ExecuteAlways behaviours, so its real C# Awake initializer is invoked directly. The recovery callback should use that same test-context technique.
- The recovery host was created active (test73–75). SetVisible(true) at134 activates the overlay, Reveal and SelectKey invoke real button handlers, and no test code disables the TMP component. Runtime SelectKey (AccountRecoveryView.cs66–74) rechecks owner/key, calls actual Select and ActivateInputField, and sets raw string positions. The callback at85 performs SetVisible(false), which at52 clears the key then hides the overlay and at54–55 clears owned selection. HideKey restores Password/readOnly remains unchanged. No runtime SendMessage exists in this source.

## Pinned TMP evidence

Root Packages/manifest.json and packages-lock.json pin com.unity.ugui 2.0.0; the inspected local package is com.unity.ugui@cd4936b8279f, package.json 2.0.0, under the Art project's Library/PackageCache. Root ProjectVersion.txt pins 6000.0.85f2 (b028303d8e7d). Exact local TMP_InputField.cs SHA256:
`05c26a964a47658a122198d37885e48929982cc67573bf11fc8338e0725c7a5a`.

- TMP_InputField.cs4313–4327: ActivateInputField checks text/font/IsActive/IsInteractable and schedules m_ShouldActivateNextUpdate.
- Lines1610–1619: actual LateUpdate processes the pending activation using ActivateInputFieldInternal.
- Lines4330–4336: internal activation needs current EventSystem and selects the actual field GameObject.
- Lines4367–4379: desktop activation invokes OnFocus, enables input and updates the label. The existing test's deferred focus/full-selection checks therefore remain meaningful direct C# component controls; they are not a complete player-loop/browser proof.

Package source is supporting static evidence, not a new Editor execution receipt. Native engine source was not inspected; the exact internal eligibility diagnosis follows the reported native stack and the repository's established same-context repair. No claim that all runtime UI integration is already proved follows from this read.

## Smallest honest correction

Replace only test183 with direct reflection invocation of the real private `AccountRecoveryView.OnApplicationFocus(false)` callback, using Instance|NonPublic exactly as the established Arena test technique. This retains the callback body under test and avoids native SendMessage dispatch outside the player lifecycle. The callback's absence/change still causes test failure; no exception/log suppression or optional assertion is introduced. Do not add ExecuteAlways to runtime, disable TMP, remove deferred activation, replace the field with a mock, suppress the assert, change content/selection checks or treat masking as blur proof.

All previous assertions remain unchanged: no reveal for unowned/failed profiles; explicit reveal of actual owner key; actual manual field selection and delayed TMP focus/select-all; readOnly and unchanged key; no automatic clipboard writes; clear/mask on close/name switch/cancel/blur; overlay hidden on blur. No production, other test, package, status, lock or fixture bytes change.

## Verification boundary / required owner retake

Static exact-line replacement and git diff --check only; no tests/builds/Editor launched here. Owner should admit the one-line correction and perform its already bounded recovery2 + globalbinding4 + real Play proof retake, retaining the failed 95bd receipt. A new unhandled assertion after this correction is a new concrete defect to investigate; it must not be suppressed. Normal runtime browser/player-loop focus dispatch remains a separate real proof, as do native/manual keyboard copy and correct pointer/selection behavior under the actual EventSystem.
