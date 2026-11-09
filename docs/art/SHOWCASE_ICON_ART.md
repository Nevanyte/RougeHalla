# Showcase procedural icon atlas

`ShowcaseIconArt.cs` is a self-contained Unity presentation utility. It creates an original monochrome glyph atlas on first access; it does not add UI elements, bind to gameplay events, or edit any existing project source. Copy it into `Assets/Scripts/Presentation/ShowcaseIconArt.cs` when the owner approves integration.

## Public API

- `ShowcaseIconArt.Get(string key)` returns a cached `Sprite`. Unknown or null keys return `fallback.unknown` (a neutral diamond with a question mark).
- `ShowcaseIconArt.Keys` returns the stable read-only key list.
- Keys use `stat.*`, `damage.*`, `weapon.*`, `wish.*`, `world.*`, and `fallback.unknown` namespaces. The weapon keys follow canonical legacy IDs: sword, bow, wand, shield, axe, and fists.

The nine stat icons preserve the legacy combat glyph concepts: sword, sparkle, combined damage, plus, bow/arrow, shield, nested ward, boot, and droplet. Physical/magic/true damage retain sword/sparkle/checked-diamond silhouettes. Wish icons have distinct silhouettes independent of hue: snowflake, volley, trial sigil, flame, and shield-plus.

## Atlas behavior

- One lazily initialized 1024×1024 RGBA32 texture, arranged as an 8×8 atlas of 128×128 transparent cells. All returned sprites reference this shared texture to support Canvas batching.
- Icons are hand-authored vector coordinates rasterized into a 2× supersampled working buffer. Each visible mark has white fill/stroke and a dark ink outline; a UI `Image` tint colors the full glyph, so use a bright-enough tint to retain outline contrast.
- At least 8 transparent pixels remain between glyph art and cell edges (the authored shapes retain a larger internal inset); full-cell sprite rectangles preserve a transparent gutter between neighboring entries.
- Bilinear filtering, clamp wrapping, no mipmaps, no physics/fallback shapes, full-rect sprite meshes, centered pivots, 128 pixels per unit.
- Creation is lazy and cached. Call `Get` from Unity's main thread before using the returned sprite. No per-frame geometry, texture upload, or per-frame allocations are performed by this utility.

## Provenance and license

This is original procedural art and source code authored for Roguehalla's preview. No external raster images, AI-generated assets, or third-party textures are embedded. The C# source and generated glyphs follow the repository MIT license (`LICENSE`, Copyright (c) 2026 RougeHalla contributors). The combat stat glyph silhouettes are adapted from the project’s existing `packages/client/src/ui/combatIcons.ts` vector coordinates so labels remain recognizable across clients; they are redrawn procedurally here and do not introduce a separate asset license.

This is asset preparation only, not UI integration. The UI owner should select semantic keys and apply its intended size, tint, layout, accessible label, and fallback behavior.
