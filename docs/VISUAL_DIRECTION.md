# Visual direction for the Unity client (targets for the next stage)

Requirement: [REQUIREMENTS.md](REQUIREMENTS.md) R-VIS. Existing art only: the legacy game draws colored shapes (faction
discs, weapon glyphs, tile walls/fences/hazards, zone palettes) procedurally (`packages/client/src/render/`, palettes in
`packages/shared/src/factions.ts` `color` and `packages/client/src/render/zoneArt/palette.ts`). Upgrade how it is drawn,
not what is drawn.

## Preserve (non-negotiable)
- Silhouettes and sizes: player disc radius 12 u, weapon shapes, mob role marks, wall/fence/LOW tile footprints, the 2.5D
  projection's readability (`packages/client/src/render/projection.ts`: screenY = worldY x Y_SCALE, height drawn upward).
- Hitboxes and geometry exactly as simulated (render from server state; never scale a body for "juice" beyond the legacy
  cues in `figurePose.ts`).
- Identity: faction colors and zone hues plus the non-hue cues (zone dash patterns and shapes) for color-blind players.
- Competitive readability: telegraphs (windups, cast rings), hit numbers, hp bars, statuses, chest and quest markers.
- Fairness: nothing rendered may reveal an actor the observation does not contain (no light, shadow, particle, sound or
  minimap cue for hidden or out-of-sight actors; the server already filters what it sends).

## Targets
| Area | Target | Notes |
|---|---|---|
| Resolution | Render at device pixel ratio up to 2x, capped by a pixel budget (legacy: 4K budget) with dynamic resolution on the low tier | More pixels do not create missing source-art detail. |
| Frame pacing | 60 FPS on Apple M5 Pro, the owner's initial reference selected 2026-11-05; smooth frame pacing (no hitches on join or map build) | Measure the client separately. This initial hardware choice does not establish performance on other mid-range desktops. |
| Lighting/materials | URP 2D/3D lights for soft ambient + per-zone tint; subtle rim on walls; emissive faction accents; contact shadows under discs | Never let darkness hide an actor that is in sight. |
| Post-processing | Restrained: mild bloom on emissives, color grading per zone, optional vignette; off on the low tier | No depth of field, no heavy motion blur. |
| Particles | Hits, swings, deaths, camp clears, Wishes: short-lived, capped counts; reduced-motion setting zeroes motion effects (legacy `juiceScale`) | Never over gameplay-critical indicators. |
| Animation/interpolation | Remote actors interpolated in render time (70-150 ms adaptive delay, RoguehallaNet `RenderClock`); local player predicted; squash/lunge cues from legacy `figurePose.ts` | Render time never runs backwards. |
| UI clarity | Legacy HUD layout (vitals, cards row, build strip, minimap, weapon bar, quest log, chest panel) rebuilt in uGUI/UI Toolkit with scalable text | Tooltips as in legacy; click-through where legacy is click-through. |

## Quality tiers
Adaptive (frame-time driven) with a manual override in settings: **Low** (1x resolution, no post, minimal particles,
no dynamic shadows), **Medium** (DPR-capped, bloom, particles), **High** (full DPR within budget, lights and shadows).
Every tier keeps every essential indicator. Accessibility: reduced motion, color-blind-safe cues, text size.

## Budgets to establish (P-UNITY-1)
Download size (compressed Web build), time to first frame, memory (WASM heap + GPU), frame time p50/p99 on the named
hardware, draw calls (legacy reached ~35 per frame by baking static shapes: `packages/client/src/render/bake.ts`).
