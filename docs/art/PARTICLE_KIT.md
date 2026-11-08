# Asset-readiness faction effect kit

`client-unity/UnityProject/Assets/Scripts/Presentation/AssetReadinessEffects.cs` is a standalone procedural effect source for the asset-readiness preview. `AssetReadinessEffects.Create(parent, localPosition, faction)` returns a child GameObject for faction indices Fire `0`, Sentenced `1`, Plague `2`, Frost `3`, and Holy `4`. It is not connected to ArenaView, MatchHud, the network client, or gameplay state. The returned name includes the faction so a staged lineup can label it as a preview.

## Visual language

Every vignette has a persistent pale ring and a central glyph drawn with cached, native `ShowcaseSprites` (`ring`, `sigil0`–`sigil4`, `rune`, `spark`). A tinted underlay reinforces identity, while the lighter, non-hue glyph and the per-faction silhouette details carry identity when hue is unavailable or particles are stopped.

| Faction | Persistent identifying shapes | Decorative motion |
|---|---|---|
| Fire | Pointed triangular glyph and ember arc | Sparse sparks emit along a partial ring arc. |
| Sentenced | Rune glyph with three narrow linked loops | Sparse amethyst rune motes. |
| Plague | Three-lobed glyph and three satellite lobes | Small three-lobed toxic motes. |
| Frost | Six discrete radial shards around a crystalline glyph | Sparse shard-shaped motes. |
| Holy | Central cross/ring glyph, second halo and eight rays | Sparse radiant sparks. |

The staged preview can reduce particle emission further or disable it completely: the ring, central glyph, chains, shards, lobes and rays remain visible. The component does not choose an actor label; the parent preview should label the vignette as a staged faction example.

## Density and material lifecycle

Each vignette owns one looping `ParticleSystem` with `maxParticles = 32`. Its emission is 4 particles/second (5 for Plague), with 1.1–1.8 second lifetimes, a circular shape and small size/speed bounds. Thus the system's configured upper bound is 32 live particles per vignette. It uses local simulation and does no per-frame C# work or random-number calls; Unity's particle simulation handles visual motion.

Particle sprites come from cached generated `ShowcaseSprites` art. Unlit particle materials are cached by sprite key, shared across the workshop vignettes and marked `HideAndDontSave`. The single isolated workshop calls `ReleasePreviewMaterials` on destruction, destroying these material copies and clearing their cache. Sprite texture/material allocation occurs only on the first request for each key during a workshop session. The static ring and faction detail sprites reuse `ShowcaseSprites.Create`/`Get`. The material uses the existing URP 2D Sprite Unlit shader, so ambient 2D lighting does not erase the non-hue identifiers.

`AssetReadinessEffects.SetReducedMotion(vignette, true)` stops and clears the particle system. Setting it back to `false` restarts it. The persistent sprites are separate child renderers and remain untouched. Disabling or destroying the vignette also clears its particles.

## Future live binding requirements

This helper is a preview primitive only. Before a future live caller uses it, that caller must:

- Create it only from the actor's delivered faction and only while that actor is currently visible to the local viewer.
- Remove or disable it immediately when the actor becomes hidden, leaves visibility, is destroyed, or a pooled actor changes identity/faction. Do not let particles or a ring outlive the actor's visibility.
- Keep it subordinate to server-driven actor identity and authoritative event timing. Do not infer combat state, emit damage, announce outcomes, or add client-side game rules here.
- Apply the user's reduced-motion/effects-intensity preference to particles while retaining the ring and glyph; reduced motion must not hide a meaningful cue or reveal hidden actors.
- Review stacking and total density before creating many simultaneously. The 32-particle cap is per vignette, so a mass-faction scene needs a scene-level cap or fewer decorative emitters.

The parent imported and exercised this kit in the Unity Editor. Current validation and screenshot evidence are recorded in [inventory/evidence/README.md](inventory/evidence/README.md). This kit is not bound to live gameplay, and the Editor preview is not browser or performance acceptance.
