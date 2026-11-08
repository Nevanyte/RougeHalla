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

| Presentation feature | High | Medium | Low |
| --- | --- | --- | --- |
| Nearby map torch lights | At most 6 | At most 3 | Off |
| Selective 2D torch shadows | On | Off | Off |
| Existing point-light normal evaluation | Accurate | Disabled | Disabled |
| Volume / bloom / grading | On | On | Off |
| Map ember glows, 32 ambient motes, 3 haze layers | On | On | Off |
| Actor artwork, faction insignia, health/status/weapon cues | Retained | Retained | Retained |
| Delivered fields, projectiles, props and reward indicators | Retained | Retained | Retained |
| Confirmed cosmetic flashes / damage amounts | Shared cap of 48 | Shared cap of 48 | Shared cap of 48 |

Each point-light anchor owns two authored preset instances. Only one may be enabled at an enabled anchor; both receive the same color, intensity, radii, falloff and shadow policy before selection. The local-player accent remains High-only. Missing or invalid presets disable optional point lighting and fail the build precheck; essential unlit indicators and the ambient light remain available.

The 2D light render texture uses half scale; the main scene render scale remains 1.0. The separate staged study
has five fixed elemental demonstration lights and is an art review, not a live-game quality/performance acceptance run.
See [VERIFICATION.md](VERIFICATION.md) for the exact fixed-High backbuffer and performance conditions.

## Reduced motion and text

Reduced motion is a saved boolean preference, defaulting off. Presentation components can observe `Changed` and apply it
to decorative movement or transitions; it does not alter actor movement or other gameplay behavior.

Text scale defaults to 1.0 and is clamped to 0.85–1.5. A changed value raises `Changed`. UI components should use the
current scale when laying out text; the setting does not itself resize every TextMesh Pro object.

The live renderer freezes decorative fog/dust drift and effect growth/rise, and selects stable animation frames
when reduced motion is enabled. Delivered positions, aiming, telegraphs and interaction facts continue updating.

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


## Staged animation selector (source draft)

Source commit `01ce403d` adds a dedicated catalog animation podium to the no-socket `?preview=1` study. It compiled in Unity `6000.0.85f2`, and the filtered Editor suite passed 42/42 tests at source head `04d8de08`; portable details are in [source-cue evidence](evidence/source-cues/summary.json). This follow-up is **not in the served `4f37e9f0` Web build**; keyboard operation and rendered layout remain unverified. The existing staged lineup and faction accents are retained. The podium is labeled `STAGED ANIMATION PREVIEW / NO NETWORK`; it does not show authoritative gameplay or prove live cue integration.

| Key | Preview selection |
| --- | --- |
| `[` / `]` | Previous / next catalog appearance |
| Up / Down | Previous / next action: Idle, Walk, Attack, Block, Hit, Death, Cast, Shoot |
| Left / Right | Previous / next source direction: SW, W, NW, N, NE, E, SE, S |
| `1`–`5` | Existing faction accent selection |

The initial selection is hero / Idle / E when the hero entry exists, otherwise the first available appearance. Appearance and action changes restart at frame zero; direction changes preserve the clip phase. Actions loop except Death, which holds its final frame. Reduced motion selects the first frame for ordinary actions and the final Death frame. Missing or malformed clips clear and hide the podium sprite and show `MISSING CLIP`, rather than substituting another action. The new card captures the current text scale when created; it has no independent settings controls.

The next approved validation batch should exercise all control groups, a stance-only knight's missing action and recovery to a valid appearance, reduced motion, zero WebSockets, ground contact and text at 1.50 scale. Visual clearance from the lineup and podium remains a rendered check. These build/browser/layout checks are still deferred; the Editor test pass does not cover them.
