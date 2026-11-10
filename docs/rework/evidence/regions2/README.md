# Regions pass 2 evidence (branch `rework/regions2`)

Real browser captures: headed Chromium 1920x1080, the Unity Web build against `rh-server` (seed1, 7 bots), `?fx.quality=high`, by
`client-unity/UnityProject/Tools/atmosphere-shots.cjs` (the spawn choice 1..5 and faction pick the zone; a zone is whatever the server puts the hero in,
so not every zone appears in every run). Editor shots in `editor/` come from `AtmospherePreviewCapture` (now takes `-atmMap <rh-map/2 json>`, seed 1 or 2,
terrain mode on) at `fx.brightness=1.4`; the Editor renders much darker than the browser, so they show layout, not final brightness.
Contrast = WCAG (L1+0.05)/(L2+0.05) between the extreme 5% of the sprite (or hp bar) window and the median of the ground ring (14 to 60 px). Hero only:
mobs and mid-walk frames are NOT measured here (the script has no way to find them); see "Not done".

## Temple (generated, client side, from collision tiles + region plane)

Method: isolated 3x3 wall blocks wholly inside Holy; densest window of them = the hall; candidate squares centred near the hall, wholly inside Holy,
containing the hall, 35 to 70% of Holy; score = distance from 52% coverage + offset + oasis tiles and wall runs cut by the edge; deterministic.

| Seed | Footprint | Pillar blocks | Share of Holy |
|---|---|---|---|
| 1 | 51 x 51 at (63,4) | 27 | 2601 / 4936 = 52.7% |
| 2 | 48 x 48 at (59,1) | 26 | 2304 / 4936 = 46.7% |

`temple-footprint-seed1.jpg`, `temple-footprint-seed2.jpg` (yellow box over the region plane). Editor: `editor/seed1-temple-outside.jpg` (sand, steps, frieze, carpet),
`editor/seed1-temple-inside.jpg`, `editor/seed2-temple-*.jpg`. Browser inside views: `after/after-s2f0-holy-fire-1.jpg`, `after/after-s3f3-holy-frost-1.jpg`.

## Plague, Fire, Sentenced, Coliseum

`editor/plague-mud-grass-water-bog.jpg` (editor, dark), browser: `after/after-s2f3-plague-frost-1.jpg`, `after-pass1/after-s1f0-plague-fire-1.jpg` (mud, grass, shallow water and bog together).
`editor/fire-near-lava.jpg`, `editor/fire-far-from-lava.jpg`, `after/after-s1f0-fire-fire-1.jpg`. `editor/sentenced-lanterns.jpg`, `after/after-s4f0-sentenced-fire-1.jpg`. `editor/coliseum.jpg`.

## Per-zone numbers (browser; range over the valid shots, hero only)

Before = first measurement on this base (Plague/Holy/Frost, my run) and the coordinator's measurements of the merged build for Fire and Sentenced (my baseline run never reached them).

| Zone | Before mean / p95 / clipped | Before sprite / bar | After mean | After p95 | After clipped | After sprite edge | After hp bar |
|---|---|---|---|---|---|---|---|
| Holy | 0.65 / 0.95 / 9.1% (coordinator); 0.53 / 0.88 / 2.1% (mine) | 9.4 to 10 / 10.4 | 0.45 to 0.63 | 0.76 to 0.83 | 0.04 to 0.31% | 5.6 to 6.0 | 6.8 to 8.0 |
| Frost | 0.67 / 0.86 / 0.05% | 8.9 to 12.4 / 11.8 | 0.60 (first pass; not re-reached after the last small shadow tune) | 0.77 to 0.80 | 0.04 to 0.45% | 5.5 to 7.9 | 9.5 to 9.7 |
| Plague | 0.35 to 0.40 / 0.54 | 3.4 to 3.8 / 3.8 to 4.1 | 0.22 to 0.24 | 0.42 to 0.47 | 0.04 to 0.05% | 4.0 to 8.0 | 6.8 to 7.8 (3.0 to 4.3 in the first pass, fixed by the rim and darker ground) |
| Fire | 0.24 / 0.55 | 3.4 / 7.7 | 0.21 to 0.24 | 0.50 to 0.74 | 0.04 to 0.08% | 5.5 to 8.1 | 5.1 to 8.7 |
| Sentenced | 0.18 / 0.28 | 3.6 to 4.3 / 9.1 to 10.6 | 0.14 to 0.27 (0.27 is a view with Holy sand) | 0.30 to 0.69 | 0.04 to 0.05% | 6.9 to 13.3 | 10.2 to 10.6 |

Brightness order in the browser: Holy 0.45 to 0.63 > Frost 0.60 > Plague 0.22 to 0.24 ~ Fire 0.21 to 0.24 > Sentenced 0.14. Plague and Fire are too close to call by mean
(Fire's mean depends on lava share); the order of the light (sun + ambient) is asserted by `PassiveLightRankingFollowsTheBrief` and `PassiveLightOrderingStillHolds`.
Plague ended darker than the coordinator's 0.28 to 0.34 aim because the hp bar and edge contrast needed a darker ground; the rays and bog are its bright elements.

Ground luminance behind the hero (linear): Plague 0.03 to 0.09, Fire 0.02 to 0.04, Sentenced 0.02 to 0.03 (so the dark armoured hero's BODY cannot reach 3:1 there; the EDGE
carries the gate through the rim, which is now HDR on dark ground: `AtmosphereShadows.ApplyRim`).

## TerrainMode

`MapBlob.TerrainMode` is the room's terrain-effect mode (Rust `terrain::Mode`): Off = no terrain surface has an effect; Map = effects on, a faction ignores the surface of its own
region; All = effects on for everyone. With Off, ember (4), bog (5), ice (6) and light (7) are pure surface effects, so `RegionMap.EffectiveTerrain` drops them: neutral region ground, no
glow, no accent lights, SurfaceMap answers the region default. Lava (1), fence (2) and crevasse (3) sit on wall or low tiles (collision geometry) and stay. Tested.

## Not done / weak

- Mobs, mid-walk frames, 2560x1440 and Ultra were not measured; `?fx.quality=` only offers low, medium, high (shadows show at High and Ultra only).
- Last-resort faction outline not used. Without it every measured hero edge is >= 3.0 (min 3.0 on one Plague frame in the first pass; 4.0 and up in the final build), bars >= 4.5 in the final build, but Plague and Fire hero BODY ratios are well under 3:1 by arithmetic.
- Stained-glass light, braziers and the emblem are in; hanging lamps and a real low perimeter wall are not (a wall would look like collision).
- Temple steps read as a flat band from the south in the editor shots.
