# Settings modal B/H input test review

Read-only review of the available `UiInputRoutingEditModeTests.cs`, `MatchHud.Features.cs`, `ModernSettingsView.cs`, and `MatchHud.cs` source. No Editor, Play, Git, or test commands were run.

## Focused test coverage

Recommended focused filter: `Roguehalla.Client.Tests.UiInputRoutingEditModeTests` with these test names:

- `SettingsOwnsKeyboardAndBlocksBuildHelpShortcutsWithoutWorldCommands`
  - Opens the real `MatchHud` settings view through its settings toggle, asserts `MatchUI/ModernSettings` exists and stays active after B and H, and asserts both `BuildDrawer` and `ControlsHelp` remain closed.
  - After each key, calls the UI and client input readers, flushes the local session, and asserts the fake transport decoded no `ClientMsg.Input` world commands.
- `BuildAndHelpShortcutsStillToggleAndSwitchBetweenTheirPanels`
  - Verifies B opens/closes Build, H opens/closes Help, and switching B→H or H→B closes the other panel.
- `ClosingSettingsRestoresThePreviouslyFocusedWorldHudControl`
  - Verifies the build-details control is hidden while settings is shown and the same selected control is restored on close.

These are the relevant assertions for the modal regression and preservation of the existing Build/Help affordances. The tests exercise a real `MatchHud`/`ModernSettingsView` hierarchy and Input System keyboard edges. The session uses a local fake transport; the command assertion is about absence of locally queued world input, not server behavior.

## APIs and test path

- `MatchHud.ReadUiInput()` is public and reads the active `Keyboard.current`.
- The test injects actual key edges with `InputSystem.QueueStateEvent` + `InputSystem.Update`, then calls `ReadUiInput()`. `MatchClient.ReadInput()` is invoked by the fixture through reflection; `Session.FlushInput()` emits pending input through `ITransport`.
- The fixture transport decodes sent `ClientMsg.Input` frames and collects `WireCommand`s, so the modal test checks the concrete command stream rather than only an input-blocking boolean.
- `ModernSettingsView.Root` and `IsVisible` are public; `SetVisible(bool)` is public. The tested shortcut paths use the existing settings toggle, not simulated pointer clicks.
- Positive Build/Help tests use the same key injection but call the UI reader directly, then assert the actual panels’ `activeSelf` values and mutual exclusion.

## Scope limits / review notes

- The negative “no world commands” assertion is specifically exercised for B and H while Settings owns keyboard input. The positive B/H panel-switch test checks visibility/mutual exclusion, not the outgoing command stream; those shortcuts are presentation toggles and do not call a world command API in the reviewed handlers.
- The modal test checks the real Settings root remains open and both conflicting panels remain closed. It does not click a `Selectable`; that is appropriate for verifying keyboard ownership.
- The suite’s setup swaps in an Input System settings clone and synthetic keyboard/EventSystem, with explicit teardown/restoration. Run the two named hotkey tests plus the focus-restoration test for this narrow regression; retain the broader class suite only if the gate requires it.
