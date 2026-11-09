# Public review APIs (read-only source audit)

Checkout reviewed: `RogueHalla-unity-art`, commit `d28df076bf98d10bfe6cb5fbc88b8d30a3fbe712`. No Editor, Play, source edits, or tests were used.

## Minimap scale preference

Source: `client-unity/UnityProject/Assets/Scripts/UI/UiDisplayPreferences.cs`.

- PlayerPrefs key: `rh.ui.minimapScale` (int index).
- Index/default mapping: `0 → 0.85`, `1 → 1.00` (default), `2 → 1.25`; constructor clamps stored indices into 0–2.
- Public preference API: `new UiDisplayPreferences()` reads persisted settings; `CycleMinimapScale()` advances and persists immediately; `ResetDefaults()` sets scale to 1 but also resets map toggle, route, FPS, and ping preferences.
- The preference class has no public direct scale setter. `TacticalMapController.SetMinimapScale(float)` is public and clamps to `.85–1.25`, but only changes the live minimap geometry; it does not update the preference or reposition the reward panel as `MatchHud.ApplyDisplayPreferences()` does.

Safe no-click path for a review launch: before `MatchHud`/`UiLayoutReview` is initialized, capture `PlayerPrefs.HasKey("rh.ui.minimapScale")` and `GetInt("rh.ui.minimapScale", 1)`, write the desired index with `PlayerPrefs.SetInt`, then `PlayerPrefs.Save()`. After the review object is destroyed, restore the old integer and save; if the key was originally absent, call `PlayerPrefs.DeleteKey("rh.ui.minimapScale")` and save. This makes the existing `UiDisplayPreferences` constructor apply the test value and preserves the prior unset/default state. Do not use `ResetDefaults()` for a scale-only test. There is no public in-place preference setter/accessor for the `MatchHud`-owned preference instance; changing PlayerPrefs after initialization will not notify that instance.

## Offline layout fixture

Sources: `UI/UiLayoutReview.cs`, `UI/UiLayoutReviewFrames.cs`, and `Bootstrap.cs`.

- Bootstrap query: `?uiReview=hud`, `?uiReview=planning`, or `?uiReview=map` (accepted at `Bootstrap.cs:60–63`). This creates `UiLayoutReview`; it uses an in-memory `LayoutTransport` and does not open a network socket.
- Direct fixture API: `Initialize(Camera camera, string mode)`, with `mode` exactly `hud`, `planning`, or `map`. It throws for null camera, unknown mode, or repeat initialization. Initialization builds the synthetic map/state, initializes `MatchHud`, and sets `IsReady` true only at the end. `Hud` exposes the created `MatchHud`.
- `SetTextScale(float)` forwards to `ShowcaseSettings.Current.SetTextScale(scale)`, clamped by `ShowcaseSettings` to `.85–1.5`. The call requires the fixture’s `MatchHud` to have initialized its `ShowcaseSettings`; wait for `IsReady` first. Text scale persists under `roguehalla.showcase.textScale` (float), so capture/restore its original key-presence/value if the review must leave local settings unchanged.
- The fixture is synthetic layout data, not gameplay or server evidence. It seeds seven visible actors, maxed vitals/build counts, all reward options, and no quests. `planning` adds plan choices and phase 3; `map` opens the tactical map. It publishes a new snapshot every 50 ms after initialization.

## Settings modal B/H key interaction

Source: `UI/MatchHud.Features.cs` (`ReadUiInput`, around lines 204–220).

`ReadUiInput` computes a `dialog` flag that includes the settings panel, but the global B and H handlers are not guarded by it. Pressing B while settings is open can toggle the build drawer; pressing H can toggle the help panel. Opening settings initially closes both, but these keys can reopen them over the modal. This is a source-level interaction risk, not a runtime capture claim. Escape is handled separately and closes settings through `ToggleSettings()`.
