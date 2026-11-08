# Presentation settings

`ShowcaseSettings` contains local presentation preferences. It does not change simulation rules, gameplay state, network
messages, or server results. The settings component is a scene singleton: its values apply while that component lives,
and each value is stored in Unity `PlayerPrefs` for the next launch on the same browser/device. The component itself is
not marked `DontDestroyOnLoad`; a full scene replacement destroys the singleton, so a later instance reloads the stored
preferences.

## Quality

Quality starts in **Adaptive** mode unless the user previously selected a manual tier. Adaptive mode samples Unity's
`FrameTimingManager` main-thread CPU frame time. It smooths samples with an exponential moving average (`0.12` blend).
If the smoothed value stays above 8.5 ms for 2 seconds, quality drops one tier; if it stays below 6 ms for 8 seconds,
quality rises one tier. Between those thresholds, both timers reset. Tiers are Low, Medium, and High; changes stop at
the endpoints.

The adaptive metric is only a proxy for presentation load. This implementation intentionally ignores GPU timing because
WebGL does not provide it here, and CPU time does not measure browser compositor work, display refresh, network delay,
or perceived smoothness. If frame timing samples are unavailable or zero, adaptive quality does not change. Manual mode
uses the selected tier without adaptation. The quality control cycles Adaptive → High → Medium → Low → Adaptive.

## Reduced motion and text

Reduced motion is a saved boolean preference, defaulting off. Presentation components can observe `Changed` and apply it
to decorative movement or transitions; it does not alter actor movement or other gameplay behavior.

Text scale defaults to 1.0 and is clamped to 0.85–1.5. A changed value raises `Changed`. UI components should use the
current scale when laying out text; the setting does not itself resize every TextMesh Pro object.

## Audio

Music, ambience, and SFX volumes default to 0.72, 0.62, and 0.85 respectively, each clamped to 0–1. Changes raise
`AudioChanged` and `Changed`; `ShowcaseAudio` applies the values to configured sources. Browser playback must be unlocked
from a user gesture by calling `UnlockFromUserGesture`. The settings store scalar source volume values; it does not
control mixer routing or guarantee that clips/sources exist.

## Persistence

Preferences use the `roguehalla.showcase.*` Unity `PlayerPrefs` keys. Quality mode/tier and reduced motion are saved
immediately. Text scale and audio values queue `PlayerPrefs.Save()` after 0.5 seconds without another change to reduce
write frequency; their values are also set in `PlayerPrefs` immediately. Storage is local to the browser profile/device,
can be cleared by the platform, and is not synchronized between devices or accounts.

Run `node tools/art/verify-presentation.cjs` from the repository root to report WCAG contrast for the actual
`ShowcasePalette.cs` color declarations, confirm required art provenance notices, and check image/animation paths
referenced by the Flare metadata. Contrast results cover solid palette colors only, not composited transparency, font
weight/size, outlines, or rendered UI. Accent colors are informational; text colors are checked against the three dark
surfaces at the WCAG AA 4.5:1 normal-text threshold.
