# Original Gap Prop Art

This staged source adds nine original procedural sprite studies for prop kinds that did not have suitable sourced artwork in the current review set. The artwork is generated from Unity C# shapes and pixel shading at runtime; it uses no third-party images, downloaded files, or AI-generated material. It does not place props, assign zones, add colliders, or claim gameplay coverage.

## Public API

Copy `Assets/Scripts/Presentation/ShowcaseOriginalPropArt.cs` into the Unity client presentation source tree. It exposes:

- `ShowcaseOriginalPropArt.Keys`: the nine stable semantic keys.
- `ShowcaseOriginalPropArt.Get(key)`: returns a cached `Sprite`, or `null` for an unknown key.
- `ShowcaseOriginalPropArt.TryGet(key, out sprite)`: lookup without exceptions.
- `ShowcaseOriginalPropArt.TryGetInfo(key, out info)`: name, estimated art bounds, and normalized ground pivot.
- `ShowcaseOriginalPropArt.SharedAtlas`: the shared generated texture.

Keys are `gap.gallows`, `gap.stocks`, `gap.mushroom-cluster`, `gap.toxic-bubble-vent`, `gap.rusted-pipe`, `gap.snow-drift`, `gap.ice-crack`, `gap.stained-glass-fragment`, and `gap.crater-rim`.

Each sprite is a 256 by 256 cell in one cached 768 by 768 RGBA atlas, generated once on first access. Pixels per unit are 128. The common normalized pivot `(0.5, 16/256)` sits just above the cell bottom so the art can be aligned to a ground point. The sprites use a full-rectangle mesh and disable fallback physics-shape generation. The texture has bilinear filtering, clamp wrapping, and no mipmaps. Transparent margins separate neighboring cells.

## Art inventory

| Key | Depicted form | Approximate maximum art bounds (world units) |
|---|---|---:|
| `gap.gallows` | Timber frame, crossbeam, rope and hanging loop | 1.36 × 1.68 |
| `gap.stocks` | Timber restraint frame with two openings | 1.26 × 1.34 |
| `gap.mushroom-cluster` | Three layered caps over a mossy base | 1.58 × 1.40 |
| `gap.toxic-bubble-vent` | Jagged stone vent with green bubbles | 1.66 × 0.88 |
| `gap.rusted-pipe` | Oblique bent iron pipe with rust seams | 1.72 × 1.12 |
| `gap.snow-drift` | Layered cool snow mound | 1.70 × 0.86 |
| `gap.ice-crack` | Grounded ice shelf with branching fissures | 1.62 × 0.80 |
| `gap.stained-glass-fragment` | Framed colored glass panel with warm center light | 1.36 × 1.72 |
| `gap.crater-rim` | Oblique impact rim with a small molten center | 1.72 × 0.94 |

Bounds are art extents estimates, not collision or placement dimensions. Every listed width and height is below two world units. The dark outlines, layered planes, low-saturation shadows, and small bright accents follow the project's mythic palette; these were authored as scene props rather than UI glyphs.

## Scope and verification

This package is source-only staging. Unity was not run, so the atlas has not been rendered or visually reviewed in the target project. The code creates only an in-memory texture and sprites on first lookup; it contains no `GameObject`, renderer, placement logic, physics component, or UI dependency. A parent integration can include selected sprites in a separate art review scene after compiling and inspecting them.

## Unity integration and review

Imported on a separate continuation after 9181dc32. Unity 6000.0.85f2 compile passed. All nine cached sprites were instantiated in an actual no-network Play-mode study and visually inspected. Parent review corrected disconnected mushroom stems, stock supports, pipe brackets, noose direction, filter gutters and measured bounds. `TryGetInfo` now returns the exact generated alpha-bounds dimensions (including cast shadows); the table above remains the initial estimate. Every generated opaque/transparent-alpha sample is checked for a 2px atlas-cell gutter before upload. All nine have zero physics shapes, repeat lookup returns the cached sprite, and measured extents remain below 2 world units. `ReleaseCachedAssets()` supports teardown after renderer users are released.

Open `Roguehalla/Art/Play Original Prop Study` in the Editor for the no-network review. The actual 2560×1440 Unity render is `evidence/live-integration-2026-11-08/original-prop-study.png`. No live prop placement, map fact, collision or full landmark architecture was added. Fresh study console has zero warnings/errors. The 62-test suite receipt in 9181 remains separate; this continuation used compile/runtime asset validation and visual review, not another unchanged suite run.
