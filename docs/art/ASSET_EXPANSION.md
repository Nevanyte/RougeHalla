# Flare expansion import packet

This is an opt-in source and preview catalog. It adds no gameplay rules and does not alter `ShowcaseCatalog`, the live presenter, or existing import/catalog assets.

## Import

In Unity, run **Roguehalla → Art → Import Flare Expansion**. The importer writes only under `Assets/Art/Derived/FlareExpansion/`, including `AssetReadiness.asset`. The catalog is deliberately outside `Resources`; a player build will not pull these review assets in automatically.

The dedicated API is `Roguehalla.Client.AssetReadinessCatalog`:

- `ShowcaseCatalog.Appearance[] Actors`
- `Sprite[] Environment` with parallel `string[] EnvironmentKeys`
- `FindActor(string)` and `FindEnvironment(string)` lookup helpers

Actor keys are `mob-goblin-elite`, `mob-antlion`, `mob-skeleton-archer`, `mob-skeleton-mage`, `mob-zombie`, `mage`, and `mage-female`. Environment keys identify the Flare family, class and tile ID, for example `cave-floor-16` and `cave-wall-64`.

## Source set and coverage

Source PNGs and animation definitions are copied unchanged to `Assets/Art/ThirdParty/FlareExpansion/Raw/`; the selected files and hashes are recorded in `asset-manifest.json`. The two human player body bases and head bases are read from the already retained Flare source set. The importer reads source PNG bytes directly, so it does not rewrite original PNGs or change their importer metadata.

Seven appearances are composed: five mob atlases and two mage outfits. Each is required to contain all eight directions for stance, run, swing, block, hit, die, cast and shoot. The importer validates layer direction/index coverage and frame rectangles before emitting sprites. The mage outfits combine default body layers, Flare mage boots/skirt/vest/sleeves/hood, the existing matching head, and a staff layer. Per-frame source pivots are retained; the staff is included in the appearance atlas.

The environment set extracts 12 samples from official cave tile definitions: IDs 16–21 for floors, 64–67 for walls/structures, and 128–129 for props. Every crop uses the source `tile=` rectangle and pivot metadata. No uniform atlas grid is assumed. Grassland remains in external staging; it is not included in this import packet.

This set adds an insect, an elite goblin, skeletal ranged and caster roles, and zombie art. It does not establish literal rat, imp or ogre artwork, or unique artwork for every mob, boss or faction. Additional source clips such as `critdie`, `spawn`, and goblin `run_alt` are retained in the original definitions but are not exposed through the current eight-action appearance shape.

## License and attribution

Flare: Empyrean Campaign / `flare-game` source commit: `af6eee6d339ac98011864bfe89da837fe7769c28`. The project README and contribution guide specify CC-BY-SA 3.0 or later for art/data unless otherwise noted. The official Credits snapshot, with exact revision, date and checksums, is stored beside the source files at `Assets/Art/ThirdParty/FlareExpansion/CREDITS_CAPTURE.html` and `.txt`; the project license is `LICENSE.txt`. Per-file source paths, Git blob IDs, byte sizes and SHA-256 values are in `asset-manifest.json`.

No individual artist is assigned to a file unless the captured ledger names that exact path. Credits for a separately staged composite atlas are retained in the capture, but grassland art is not part of this import. Derived actor sheets and cave crops remain Flare art derivatives and must retain the applicable attribution and CC-BY-SA share-alike terms on redistribution.

## Importer boundary

The entry point is `Roguehalla.Editor.FlareExpansionImporter.Import()`, exposed in the menu above. It composes each layer sequentially to keep source pixel buffers bounded, writes derivatives only in `Assets/Art/Derived/FlareExpansion/`, and populates the isolated asset at `Assets/Art/Derived/FlareExpansion/AssetReadiness.asset`. No gameplay or live scene references are added by this packet.
