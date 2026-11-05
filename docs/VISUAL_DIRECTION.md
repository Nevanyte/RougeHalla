# Visual direction for the Unity client (targets for the next stage)

Requirement: [REQUIREMENTS.md](REQUIREMENTS.md) R-VIS. **Owner update 2026-11-05:** the Unity assets need not be one-to-one
copies. Compatible open-source assets, original assets made with Unity tooling and creative character/environment
redesign are allowed. This supersedes the earlier existing-art-only direction. Preserve third-party terms and record
asset provenance. Complete Rust gameplay/parity/headless before expanding the visuals.

The legacy procedural discs, glyphs, tiles and palettes (`packages/client/src/render/`,
`packages/shared/src/factions.ts`, `packages/client/src/render/zoneArt/palette.ts`) remain useful references for gameplay
cues and faction identity. They are not mandatory final artwork.

## Preserve (non-negotiable)
- Authoritative geometry: the Rust player radius, weapon reach and wall/fence/LOW footprints govern gameplay. New models
  and silhouettes may differ from the legacy discs; make ground contact, reach and obstacles readable from server data.
- Render from authoritative state. Imported asset colliders/physics must not become a second gameplay simulation.
- Identity: distinct factions, zones and mob roles, with non-hue cues for color-blind players. Palettes and symbols may evolve.
- Competitive readability: telegraphs (windups, cast rings), hit numbers, hp bars, statuses, chest and quest markers.
- Fairness: nothing rendered may reveal an actor the observation does not contain (no light, shadow, particle, sound or
  minimap cue for hidden or out-of-sight actors; the server already filters what it sends).

## Targets
| Area | Target | Notes |
|---|---|---|
| Resolution | Render at device pixel ratio up to 2x, capped by a measured pixel budget with dynamic resolution on the low tier | Establish budgets against the chosen assets and actual browser build. |
| Frame pacing | Highest sustainable frame rate on Apple M5 Pro with intended quality intact; smooth pacing without join/map-build hitches | Owner updated the goal on 2026-11-05: explore the performance limit rather than stop at 60 FPS. Measure CPU/GPU frame times separately from browser/display caps and server throughput. |
| Lighting/materials | URP 2D/3D lights for soft ambient + per-zone tint; subtle rim on walls; emissive faction accents; contact shadows under discs | Never let darkness hide an actor that is in sight. |
| Post-processing | Restrained: mild bloom on emissives, color grading per zone, optional vignette; off on the low tier | No depth of field, no heavy motion blur. |
| Particles | Hits, swings, deaths, camp clears, Wishes: short-lived, capped counts; reduced-motion setting zeroes motion effects (legacy `juiceScale`) | Never over gameplay-critical indicators. |
| Animation/interpolation | Remote actors interpolated in render time (70-150 ms adaptive delay, RoguehallaNet `RenderClock`); local view follows server positions until Rust-vector movement prediction passes | Animation may be redesigned; render time never runs backwards and animation never decides a hit. |
| UI clarity | Present vitals, cards/build, map, weapons, quests and chest choices with scalable text and clear controls; layout may improve | Preserve required information, intended actions and accessible interaction. |

## Quality tiers
Adaptive (frame-time driven) with a manual override in settings: **Low** (1x resolution, no post, minimal particles,
no dynamic shadows), **Medium** (DPR-capped, bloom, particles), **High** (full DPR within budget, lights and shadows).
Every tier keeps every essential indicator. Accessibility: reduced motion, color-blind-safe cues, text size.

## Budgets to establish (P-UNITY-1)
Download size (compressed Web build), time to first frame, memory (WASM heap + GPU), frame time p50/p99 on the named
hardware, draw calls (legacy reached ~35 per frame by baking static shapes: `packages/client/src/render/bake.ts`).
