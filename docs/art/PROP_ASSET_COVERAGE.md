# Flare prop and landmark asset coverage (staged candidates)

This handoff adds an opt-in, presentation-only Unity prop catalog and importer for the existing 42 candidate records. It reuses the pinned dungeon atlas/definitions already in `Assets/Art/ThirdParty/Flare/Raw/` and cave atlas/definitions already in `Assets/Art/ThirdParty/FlareExpansion/Raw/`; only the pinned grassland atlas/definitions and candidate provenance bundle are newly staged under `Assets/Art/ThirdParty/FlareProps/Raw/`. The importer writes derived single-sprite crops and a catalog outside `Resources`. It defines no world placements, collision, map rules, UI or gameplay behavior.

## Provenance, pin, and credits

- Upstream: [flareteam/flare-game](https://github.com/flareteam/flare-game), commit [`af6eee6d339ac98011864bfe89da837fe7769c28`](https://github.com/flareteam/flare-game/tree/af6eee6d339ac98011864bfe89da837fe7769c28).
- Exact attribution source: [Credits revision `61939e26d397b51c0c36da8cb861f89c8bf1d6db`](https://github.com/flareteam/flare-game/wiki/Credits/61939e26d397b51c0c36da8cb861f89c8bf1d6db), edited 2026-04-05T03:05:38Z. Captured HTML/text and upstream `LICENSE.txt` are retained in `Raw/`.
- Project art and data are CC-BY-SA 3.0 or later unless a specific exception is recorded. Public pinned GitHub download price is USD 0; this does not remove attribution/share-alike terms.
- The exact credits ledger attributes the dungeon atlas composite to Hythlodaeus (CC-BY 3.0 model render) and TiZiana (CC-BY 3.0 stone textures). The grassland composite has multiple explicitly credited model and texture contributors, including CC-BY-SA contributors. The complete contributor list/license notes are in `asset-manifest.json`; tile-to-artist mapping is not stated, so no one is assigned to an individual crop. The cave atlas path has no individual attribution/exception in this captured ledger; its manifest records the project default and does not infer an artist.

The raw inputs are three pinned atlases: dungeon and cave are reused from their existing repository paths, while grassland is retained once in the new FlareProps third-party source folder. The 42 reviewed candidate crops are copied alongside the manifest for transparent bounds/visual comparison; importer output crops are separately regenerated from the source atlases and exact tile definitions.

## Source and extraction details

| Family | Source atlas | Dimensions | Useful source areas | Definition |
|---|---|---:|---|---|
| Dungeon | `tileset_dungeon.png` | 2167×3999 | stone floors/walls, hanging banners, barred doorways, torch, brazier, statues, plinths, chests, barrels, crates, chains, remains | `tileset_dungeon.txt` |
| Cave | `tileset_cave.png` | 2057×3037 | cave floors/walls, rubble/bone clusters, stone spires, timber pieces, portal-ring family | `tileset_cave.txt` |
| Grassland | `tileset_grassland.png` | 2180×3612 | grass/cliff surfaces, campfire, anvil, fence posts, vegetation, rocks, gravestones/crosses, trees/dead trees, building components | `tileset_grassland.txt` |

Each `tile=` line is retained verbatim. Per the [official Tile Set Definitions format](https://github.com/flareteam/flare-engine/wiki/Tile-Set-Definitions), a row is `tile=index,left_x,top_y,width,height,offset_x,offset_y`; the last two numbers are Flare's draw offset relative to the source rect, with the offset point at the isometric grid-square center. They are **not** a Unity-normalized pivot. Use the raw values and preserve source orientation. If a tile has an `animation=` record, `candidate-tiles.json` stores it; a crop file shows only the base `tile=` rectangle, not the animation sequence.

Candidate PNGs under `Candidates/` are direct RGBA rectangle crops of those pinned source images, with no resizing, rotation, recoloring, or paint. They are review aids, not complete Unity sprites. The crop manifest records source atlas, definition file, tile ID, source rect, draw offsets, SHA-256, and animation note. Before import, validate transparent bounds and convert Flare offsets to the Unity ground anchor used by the actual map art path.

The original `tiledefs` provide useful matching isometric floor/wall samples. The previous expansion importer already extracted six cave floors and four cave walls; these candidates extend analysis into the dungeon and grassland families. Surface samples in this bundle are tile ID 16 (each family), with dungeon wall 64, cave wall 64, and grassland cliff/wall 48 as representative examples. These are not a full map palette.

## The 34 `PROP_KINDS` candidates

“Direct candidate” means the source silhouette/function reads as the prop named. “Family reuse” means it can support a related material or motif but is not that exact prop. “Gap” means no sufficiently close authored source was found in these three atlases. Tile IDs refer to the pinned raw definitions; the crop and exact coordinates/offsets are listed in `asset-manifest.json`.

| `PROP_KINDS` key | Home zone | Best source candidate | Coverage |
|---|---|---|---|
| `ember_vent` | fire | Dungeon brazier 151; grassland campfire 102 | Family reuse only; neither is a vent |
| `glow_crack` | fire | Dungeon luminous floor rune 60 (variants 61–63) | Family reuse; glowing mark, no wall crack |
| `basalt_shard` | fire | Grassland rock clusters 129–131; cave stone spires 80/84 | Family reuse; rock, no basalt identification |
| `ash_drift` | fire | Cave debris floors 48/52 | Family reuse; rubble, no ash drift |
| `banner` | sentenced | Dungeon hanging cloth 107 | Direct candidate |
| `chain` | sentenced | Dungeon chain 192/193 | Direct candidate |
| `gallows` | sentenced | — | Gap; no gallows frame or scaffold found |
| `cell_bars` | sentenced | Dungeon barred doorway 114/115 | Direct candidate |
| `lantern` | sentenced | Dungeon pedestal torch 150 | Family reuse; torch silhouette, not a hanging lantern |
| `fungus_cap` | plague | — | Gap; no mushroom/fungus prop found |
| `bubble` | plague | — | Gap; no bubble/sap glob prop found |
| `drip` | plague | — | Gap; no distinct droplet/ooze prop found |
| `pipe` | plague | — | Gap; no pipe fixture found |
| `ice_spire` | frost | Cave stone spires 80/84 | Family reuse; not ice |
| `snow_drift` | frost | — | Gap; no snow surface/heap in these three sets |
| `frost_sparkle` | frost | Cave portal ring 265 | Family reuse; blue glow motif only; source tile is animated, only base crop is included |
| `icicle` | frost | Cave spire/wall formations 80/84 | Family reuse; no ice material |
| `column_cap` | holy | Dungeon upright stone pieces 110/111 | Family reuse; no isolated capital tile confirmed |
| `banner_red` | holy | Dungeon red hanging cloth 108/109 | Direct candidate |
| `candelabra` | holy | Dungeon torch 150 | Family reuse; no multi-arm candelabra |
| `rubble` | holy | Dungeon bone/rubble clusters 176/177/180; cave debris 48/52 | Family reuse; visually sourced as bone/rock debris, not consecrated rubble |
| `stained_glass` | holy | — | Gap; no translucent window/glass panel found |
| `crater_lip` | fire | — | Gap; no authored crater rim/lip in these sets |
| `anvil` | fire | Grassland 103 (anvil on stump) | Direct candidate |
| `slag_heap` | fire | Grassland rock clusters 129–131 | Family reuse; rocks are not slag |
| `gate_post` | sentenced | Grassland fence posts 105–111 | Direct candidate |
| `stocks` | sentenced | — | Gap; no stocks/wooden restraint prop found |
| `tunnel_beam` | plague | Cave timber/plank pieces 224/228 | Family reuse; boards are not a framed tunnel support |
| `burrow_rubble` | plague | Cave debris floors 48/52 | Family reuse; cave debris, not burrow-specific |
| `reed` | plague | Grassland vegetation 120/121 | Family reuse; tall grass/reed-like vegetation, species not verified by credits/definitions |
| `tower_frost` | frost | Grassland building fragments 208/209/296 | Family reuse only; no frosted tower silhouette |
| `ice_crack` | frost | — | Gap; no ice floor/crack material found |
| `altar` | holy | Dungeon plinth/table 136/137 and statue 128/130 | Family reuse; no explicitly named altar |
| `brazier` | holy | Dungeon fire bowl 151 | Direct candidate |

Direct source coverage is therefore limited to a small subset; similar rock, fire, stone, and timber pieces are called family reuse rather than relabeled as exact matches. No candidate should be bound to a live prop just because its theme appears plausible.

## Five landmark candidates

| Landmark key | Source candidate | Assessment |
|---|---|---|
| `forge` | Grassland anvil 103, campfire 102, roofed building 296 | Useful fixture/structure parts for a Forge dressing; not a complete or named Flare forge |
| `guardHouse` | Grassland stone/wood building components 208–219 and roofed building 296 | Strongest generic guardhouse candidate; the source does not call the structure a guardhouse |
| `burrow` | Cave walls 64–121 and debris floors 48–55 | Cave family supports a burrow palette; no identifiable burrow entrance/building |
| `watchtower` | Grassland building fragments 208–219, trees 240–255 | No legible watchtower asset; tower form remains a gap |
| `shrine` | Dungeon statue 128/130 and plinth 136/137; cave stone/glow ring 264/265 | Reusable statue/plinth/ring motifs; no complete named shrine |

These landmark mappings are material/shape references only. They do not claim a complete landmark kit or imply that a live map publishes the landmark key.

## Live-data boundary

The legacy prop definitions are design targets for later asset selection. The Unity map currently has collision/map facts without all 34 decorative prop keys, five faction-zone intentions, feature/landmark variants, or tile-level terrain looks. Do not place these candidates by guessing at a world region, zone, collision wall, camp, or hidden state. Future placement must consume actual public server/map fields; until those facts are available, keep these as isolated review candidates.

The source `PROP_KINDS.home` values above label the legacy asset brief. They are not client runtime authority or a permission to infer placement. Likewise, tile 265's animation data is not represented by its one-frame crop; only use it as a static review image unless an importer preserves every definition frame/duration.

## Import handoff

`ShowcasePropCatalogImporter` reads `candidate-tiles.json` and `asset-manifest.json`, verifies the exact upstream pin and SHA-256/byte-size of each original atlas and tile-definition file, parses each tile ID from its pinned `tile=` row, checks the JSON rectangle/offset against that row, confirms the definition's `img=`, and bounds-checks the rectangle. It creates derived per-tile PNGs under `Assets/Art/Derived/FlareProps/Tiles/`, imports them as sprites with the existing Flare crop/pivot conversion, and creates `Assets/Art/Derived/FlareProps/ShowcasePropCatalog.asset`.

The catalog key shape is `flare.<family>.<tile-id-D3>` (for example, `flare.dungeon.145`). `TryGetEntry(key, out entry)`, `GetEntry(index)`, and `GetSprite(key)` are read-only lookups. Each entry keeps the exact atlas and tile-definition source paths/URLs/hashes, tile rect, original Flare draw offset, converted normalized pivot, candidate role/description, Sprite and raw animation record if present. For tile 265 the Sprite is only its base rectangle; the animation line is retained but this catalog does not claim or build the complete animation.

Keep the catalog outside `Resources` and opt-in until public map/prop facts and visual footprints are approved. Candidate roles and home-zone labels are design-review metadata only; the importer never places a prop or claims complete landmark geometry.

## Integration corrections

The importer selects the primary named atlas section in multi-image definitions (grassland also contains water). It pads the extracted source rectangle with transparent pixels to preserve every source pixel, include out-of-crop ground pivots, and retain at least 2px clearance; it does not resample. The catalog normalized pivot describes that padded output. Two of 42 source pivots lie outside their original crop. All 42 generated sprites were verified against source pixels and imported pivots; no physics shapes are generated.
