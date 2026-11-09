# Launch fixture object and EventSystem lifecycle repair

**Source correction only; the next actual engine42 run is UNRUN.** Code `68931e0634959035d14039ea445186398d888bd3` changes one fixture file on `codex/unity-launch-lifecycle`. The branch starts from035b and includes immutable actual-failure receipt `338d9237dc867b9f17b351b82e480940e5adbfff` before this correction. No production code changed.

## Preserved actual outcome

The [035b engine receipt](../unity-functional-035b22c8/editor-first/README.md) remains **FAIL:27 passed/15 failed out of42**. Old Quest8/Trader6/PlayerFlows11 all passed; Launch17 had2 passes/15 failures. The failed test assembly MVID was `cad30248-17a5-410a-8d1b-d6b883f2b74d`. There were13 duplicate-global-light errors and2 unknown-EventSystem errors. All39 payload hashes in its unchanged manifest `20a466dbb580fe6e9344ff3ef09b26a159caf0470df98dfe4f04ca5278f0a8bf` were verified again.

Root's public **post-suite** inventory reports no lights/EventSystems and current0; the Editor was restored to clean5b, empty Main and its original preferences. That proves final cleanup. It does not show per-case object identities or exclude overlap between cases. No per-case leaked object ID is claimed here.

## Source diagnosis

The first launch case, CrossOrigin, completes its healthy public Arena control. EditingTarget never creates an Arena. Those are the two passes. Later Arena initialization emits the package's duplicate-global error.

`MatchClient.JoinCore` creates an Arena as an independent root. The fixture manually invokes its actual `Awake`, which creates a global `Light2D`. Its former `Dispose` destroyed only the client root and relied on the player's `OnDestroy`/deferred `Destroy` path for that separate Arena. This leaves deterministic ownership and teardown missing from the EditMode fixture. The installed URP source registers lights on `OnEnable`, detects duplicate globals in its static list, and deregisters on `OnDisable`. The source and observed ordering support inter-case overlap; the raw tape is not an observed inventory of the overlapping instances.

The EventSystem failure is direct: its `current` setter only promotes an instance already in the package's registered list. Registration occurs in `OnEnable`. A newly created plain EventSystem was promoted before EditMode had registered it. Existing passing PlayerFlows/InputRouting fixtures use their test-only `[ExecuteAlways]` subclass and a disable/enable lifecycle first.

[package-source-anchors.json](package-source-anchors.json) records exact installed package files/hashes and the relevant methods. No package source or global registry is modified. No production ownership defect is established by this analysis.

## Fixture-only change

- The transport factory still receives the real Arena created by the public launch path and still runs its real `Awake`. It parents and tracks every created/replaced Arena under the fixture root, verifies its actor/Wish initialization, and captures owned lights even if a later part of initialization throws.
- Teardown calls normal public Leave while the client/HUD are alive. It explicitly deactivates and immediately destroys only its tracked current/retired Arena roots, then destroys its own root. This avoids relying on a deferred player teardown as the test lifetime.
- Read-only observations of the real URP registration list before setup and after cleanup must be equivalent. Owned Arena/light references must be destroyed. The fixture never clears/removes registry entries or destroys borrowed scene objects.
- HUD cases reuse the existing `[ExecuteAlways]` `UiInputRoutingEventSystem`, force its normal disable/enable lifecycle, promote it and assert registration before HUD creation. They also assert the HUD reused it. Teardown clears its selection, disables/destroys only that system, then restores the prior active system and selection.

All17 test bodies and attributes are **byte-identical** to035b, including their healthy positive controls, ownership/mode gates and expected names/arguments. Their shared tail SHA-256 is `14b3d9195f5deda1c5851821db0cf6f8b406320d531121ba79729e7ddfec5f6f`. Old25, account-binding tests and the reused ExecuteAlways helper are unchanged. No renderer initialization, public launch, mode confirmation or credential check was bypassed; no logged error is suppressed or declared expected.

## Verification and remaining gate

Compile-only builds of all Scripts and Editor test sources pass: client0 warnings/0 errors; test sources0 errors and one existing `CS0067` unused Trophy fixture event warning. Profiles/logs are retained. Source scope and hashes are in [receipt.json](receipt.json); `git diff --check` passes. Independent read-only review found no fixture ownership/assertion defect.

There was **no author Editor access, native rerun, Play session, browser/server run or Web rebuild**. The compiler check does not execute the new ownership assertions or establish that the15 actual failures are resolved. Root reviews this exact source and releases any next functional gate after the sole Editor owner's static-window work. Banking adoption remains paused with no implementation.
