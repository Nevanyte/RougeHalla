# Training console source review

## Scope

Read-only review of `TrainingConsoleView` and `TrainingConsolePointerRelease` against `P-UNITY-TRAINING-CONSOLE.md`, the Unity UI/uGUI guidance, and existing session/UI helper APIs. No source was changed. Unity compile, EditMode tests, Play, screenshots, and browser checks remain unrun.

Reviewed source SHA-256:
- `client-unity/UnityProject/Assets/Scripts/UI/TrainingConsoleView.cs` — `b0de11cc888ccc53b6266f84722987859b03915851ca7bb93461ce1e593699b0`
- `client-unity/UnityProject/Assets/Scripts/UI/TrainingConsolePointerRelease.cs` — `acd5a3ac0d1ee5873c44ff0d24b0c984bf8b460283f01c868477000f90bc8f9a`

## Findings

**No actionable source defect found in the two reviewed files.** The view builds under the supplied parent transform, requires its existing Canvas and GraphicRaycaster, and creates no Canvas or EventSystem. The panel backdrop sets `raycastTarget: false`; the scroll viewport and actual controls own their raycasts. The ScrollRect uses a top-pivot content transform, `VerticalLayoutGroup` plus content `ContentSizeFitter`, and the existing `KeyboardScrollPane` for keyboard scrolling. This structure is consistent with the uGUI scroll-content pattern; actual clipping, responsive fit, and pointer acceptance still need later runtime review.

Actions are gated by the exact bound `Session`, its `TimelineEpoch`, `InMatch`, a current phase/training fact, no result, and a caller-supplied `MatchLaunchMode.Training` confirmation. Session state/snapshot/timeline subscriptions are detached on disable and destroy; captured button/input callbacks retain session/epoch/generation and are rejected when stale. `OnDestroy` disables and destroys only the owned console root. The pointer-release helper handles left-click release without intercepting keyboard navigation.

The UI emits only existing Train command shapes. `QueueCurrent` calls `InputSender.Train` and then ordinary `Session.FlushInput`; that flush can also send earlier pending commands, in their existing order. The view’s status copy remains truthful (`Request sent; server outcome unconfirmed.`), and no local rules or success acknowledgments are introduced. Parser acceptance of a literal zero remains unchanged; current ordinary legacy and Rust input admission both reject an explicit zero stat count. The view does not add an elite/stat eligibility filter.

## Integration and verification boundary

- The owner must call `SetLaunchContext` only from the verified launch path, with the same live Session and confirmed epoch/mode. `Session.Training` by itself is not sufficient confirmation.
- The owner must wire `ContainsFocus` into the existing typing/input gate and consume `HandleEscape()` only when it returns true; closed consoles return false, and the component never calls Leave or duplicates the owner’s subsequent Escape handling.
- The immediate `FlushInput` behavior is intentionally documented above; it is not a Train-only send path.
- This review is source/API analysis only. No compile/test or visual evidence was produced, so it does not establish that the layout is usable at 1280×720 or 2560×1440, nor that any pointer event reaches the controls in the running scene.

## Relevant locations

- `TrainingConsoleView.Initialize` validates/reuses the parent Canvas and configures the scroll view and controls.
- `SetLaunchContext`, `AcceptedTraining`, `CurrentAction`, `Bind`, and `Revoke` implement launch/session/epoch checks and stale-listener fencing.
- `QueueCurrent` uses ordinary `InputSender.Train` and `Session.FlushInput`.
- `OnDisable`/`OnDestroy` detach listeners and retire the owned root.
- `TrainingConsolePointerRelease.OnPointerClick` clears pointer-selected UI focus only for a left click.

## Final focus delta

The final source retains the opening control’s keyboard focus in `SetOpen(true)`; closing still releases focus. Mouse release remains in the pointer-only helper. This narrow delta was compile-checked in the final affected-source receipt; its actual interaction remains unrun.
