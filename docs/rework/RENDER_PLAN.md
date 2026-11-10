# Render plan: pushing the URP 2D renderer (branch `rework/render`)

Owner brief (2026-11-10): bring the game to life; Breath of the Wild spirit (bold readable shapes, soft painterly shading, strong
light, wind, weather, glowing accents); landscape vivid and beautiful; every effect ON at Ultra, behind its own switch, culled to
the camera, measured against 144 fps at 2560x1440; nothing may hide a visible actor or lower the 3:1 character contrast gate.

## Architecture decision: one analytic local-light field, owned by the region shaders

The ground (one quad), the wall meshes and the prop sprites are already custom shaders. Light2D renders into a half-resolution light
texture and offers no per-pixel height, no occlusion by our wall grid and no per-light shaping, so the biggest wins (relief, soft
shadows, cookies, flicker, spec) are done by a shared HLSL include, `RhLocalLights.hlsl`, fed by one C# class,
`LocalLightField`, that gathers every light source in view (terrain accents, lanterns, temple lamps, Wish flashes, impact flashes,
fireflies, embers) into a fixed global array (`_RhLP`, `_RhLC`). Ground, walls and props evaluate it per pixel with a distance early-out.

* The accent `Light2D`s stay for actors and sprites (they light characters exactly as before), but switch to a light blend style
  that the region shaders ignore, so surfaces are not lit twice. With the relief switch off the accents go back to blend style 0 and
  the old flat look is exactly restored.
* Normals: ground regions bake a normal array from the same height channel as the pattern (`RegionGroundTextures`); terrain
  (lava crust, ice, bog, water) takes screen-space derivatives of its own procedural height; walls and props use a pseudo-normal
  from their painted luma plus a blurred-alpha dome (4 taps, only in range of a light). Characters are untouched (contrast gate).
* Shadows: ShadowCaster2D needs a shape path per caster and one shadow render per light in a half-res RT; our walls are chunked
  meshes. Instead a baked wall signed-distance texture (4 texels per tile, one upload) gives soft penumbra shadows by sphere
  tracing (max 12 steps, only for the nearest shadowing lights, only inside the light radius). Shadows darken the ground, walls and
  props only, never actors, so darkness cannot hide a visible actor.

## Features, in build order (each: switch `?fx.<name>=0|1`, culled, measured)

| # | Feature | Switch | Why / expected cost |
|---|---|---|---|
| 1 | Local-light field + relief lighting (normals, wrap diffuse, flicker with noise) | `relief` | Biggest change to how lava, lanterns, torches, lamps feel. ALU only; budget 0.5 ms |
| 2 | Soft local shadows from walls (SDF trace) | `lshadows` | Lanterns/torches stop lighting through walls. Budget 0.5 ms |
| 3 | Light shaping: procedural cookies (grate, dapple, stained glass), spec on ice / wet stone / water / polished temple floor, emissive for bloom | `cookies`, `gloss` | Atmosphere per zone. ~0.2 ms |
| 4 | Wind: gusting field, vertex shear on trees/grass/banners, grass bending away from delivered actors | `wind` | Atlas packed so sway-capable art sits below a V threshold: no extra material, no extra draw calls. ~0 ms (vertex) |
| 5 | Cloud shadows (sun term only, never under the passive floor, cleared around actors) | `clouds` | One 2-octave noise per pixel. ~0.15 ms |
| 6 | Water/ice/lava: caustics and moving refraction in the ground shader (no grab needed: the bed is part of the same shader), ice depth parallax + soft reflection of the sky, lava crust flow and heat shimmer extended, bog sheen | `water`, existing `ice`, `shimmer` | The ground is a single procedural shader, so refraction costs no grab at all |
| 7 | Light-emitting life: fireflies (Plague), light-emitting embers (Fire), dust in temple shafts | `fireflies`, `emberlight` | Entries in the same light field, tiny cost |
| 8 | Grade/post: painterly per-zone grade (lift/gamma/gain via existing volume), tinted restrained bloom, soft tonemap | `grading` (existing) | Already one pass; ~0 |
| 9 | Wish and combat effects: pooled flashes for the five Wishes, projectile trails, impact sparks, hit flashes that light the scene | `fxlights`, `sparks` | Light field entries + one small particle system |
| 10 | Light budget: lift `HardMaxLights` to what 2560x1440 affords (measured), Ultra row |  `lights` | Measured, not guessed |

Dropped on purpose (documented in the README with reasons): ShadowCaster2D (see above), camera sorting layer texture grab
(nothing to grab: refraction/reflection are inside the ground shader; actor reflections on ice cannot satisfy the 3:1 edge gate
because a mirrored body touches its own feet).

## Rules every feature follows

* Everything driven only by delivered data; fireflies, bending and flashes exist only for actors/effects the client presents.
* Clouds, reflections, bend and dapple are damped to zero in a small disc around every presented actor (shared `_RhActors`).
* No per-frame managed allocation: fixed arrays, pooled objects, `Shader.SetGlobalVectorArray` with preallocated arrays.
* Each switch has an EditMode test (off means nothing built or the global array is empty), plus cap and cull tests.
* Measurement: `perf-run.cjs --attribution` at 2560x1440, vsync off, heaviest zone (Fire/lava), full bot match, one toggle at a time.
