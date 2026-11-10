# Region atmosphere evidence (branch `rework/atmosphere`)

Browser shots: headed Chromium, 1920x1080, the real Unity Web build against `rh-server` (7 bots), `?fx.quality=high` so the adaptive
quality downgrade cannot change the look. Produced by `client-unity/UnityProject/Tools/atmosphere-shots.cjs` (luma and character-contrast
metrics are computed from each screenshot, per shot, in `luma-*.json`). Editor shots in `editor/` come from the batch harness
`AtmospherePreviewCapture` (same ArenaView, real URP 2D pipeline, no HUD). The spawn region is the server's choice, so the file names carry
no reliable region; view the pictures. Named copies: `sentenced-gothic.png`, `holy-golden-sand.png`, `plague-marsh-rays.png`,
`frost-snow-ice.png`, `fire-lava-glow.png`; Fire far from lava and the Frost to Plague border are in `editor/`. `walk-*-border-0N.png` is a
walk across the Sentenced to Holy border (the light grades continuously over about 3 tiles). Console logs: no errors in any run.

## Brightness (mean luma, Rec.709 of sRGB, 0..1; HUD included in the browser numbers)

| Zone | Before (first browser pass, shaders without grading) | Browser, final | Editor, final | Clipped >0.9 |
|---|---|---|---|---|
| Holy | 0.64 to 0.67 | 0.62 to 0.64 | 0.51 | 1.9% to 2.6% (glare from sand highlights, slightly over the 2% aim) |
| Frost | 0.45 to 0.65, up to 5.6% clipped | 0.60 | 0.47 | 0.04% |
| Plague | 0.44 | 0.34 | 0.16 | 0.04% |
| Fire | 0.28 to 0.35 (saturated orange), up to 20% clipped | 0.20 to 0.36 (depends on lava share) | 0.08 | 0.04% |
| Sentenced | 0.35 to 0.36 | 0.21 (measured before the last passive tweak that made Sentenced's ambient lower than Fire's; that final value was only checked in the editor and by the ordering unit test, not re-shot in the browser) | 0.035 | 0.04% |

Order Holy > Frost > Plague > Fire > Sentenced holds in the browser, but Fire and Sentenced are close and Fire's mean depends on how much lava is
in view. The editor renders darker than the browser (the WebGL path appears to lose some HDR headroom), so the single `AtmosphereQuality.WorldBrightness`
scalar (default 0.9, `?fx.brightness=`) was tuned against browser shots. The asked-for 0.30 to 0.45 band for Fire/Sentenced is not met on
purpose: dark basalt and charcoal flagstone (palette L 0.38 / 0.36) cannot reach it without turning orange or grey; the passive floor keeps them readable.

## Character separation (local player, 1920x1080)

WCAG ratio between the darkest/lightest 5% of the sprite window (outline and light rim included) and the median of the ground ring; same for
the hp bar. Dark outline plus a new light rim (`AtmosphereShadows.ApplyRim`, strength from the ground's palette luminance):

| Ground | Sprite edge | Hp bar |
|---|---|---|
| Frost snow (ground luma 0.57) | 5.9 to 8.2 | 9 to 10 |
| Holy sand (0.49) | 4.8 to 6.4 | 7.6 to 7.8 |
| Plague (0.19) | 3.4 to 4.0 | 4.0 to 4.3 |
| Fire (0.05) | 3.1 to 6.7 | 3.6 to 8.1 |
| Sentenced (0.05) | 2.7 to 4.6 | 6.1 to 6.9 |

Weak spots: a few Sentenced and Plague samples sit just under 3:1 for the sprite and Plague/Fire bars are at 3.6 to 4.3 (below 4.5:1). Not tuned further.
Only the dark armoured hero and the mage appearance were in the samples; mobs were not measured separately.

## Cost (frame pacing, headed Chromium, 1920x1080, `?fx.quality=high`)

Every variant (all effects on; particles off; sun and shadows off; accent lights off; post off; everything off) held vsync: 1152 frames in 8 s,
mean 6.94 ms (144 Hz), p95 7.5 to 7.6 ms, p99 7.7 to 7.8 ms. So the added cost is below what this method can resolve at 1080p; no per-effect
number is claimed. Not measured: 2560x1440 at 144 Hz on the owner's display, and GPU time. Particle budget at High: Snow 302, Embers 144,
Dust 86, Spores 142, Pollen 79 live particles at most (hard cap 420). Accent lights: cap 4 at High, 2 at Medium, 0 at Low; typical Frost view 3 to 4
active, Fire 2 to 3. Shadow chunks (32 tiles): 4 visible of 25 for a typical view, baked once each when first seen.

## Download size

`Web.data` 48,502,165 B with the audio left out (first build with the atmosphere code was 48,492,336 B; the main checkout's earlier build
48,419,211 B on a different branch state). The eleven MP3 files (8,707,346 B) are copied to `Build/Web/StreamingAssets/Audio/` by `RhBuild` and
fetched after the match starts; embedding them would have made `Web.data` about 57.2 MB. A pre-atmosphere build of this exact branch was not made.
