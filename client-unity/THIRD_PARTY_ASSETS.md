# Third-party assets

## Flare game art

The Unity project contains a focused sample of original artwork and metadata from Flare: Empyrean Campaign.

- Source repository: <https://github.com/flareteam/flare-game>
- Pinned source commit: `af6eee6d339ac98011864bfe89da837fe7769c28`
- Official credit and per-source license ledger: <https://github.com/flareteam/flare-game/wiki/Credits>
- Upstream contributor guidance: <https://github.com/flareteam/flare-game/blob/af6eee6d339ac98011864bfe89da837fe7769c28/CONTRIBUTING.md>
- Source license text: `UnityProject/Assets/Art/ThirdParty/Flare/Raw/LICENSE.txt`
- Upstream credit file: `UnityProject/Assets/Art/ThirdParty/Flare/Raw/CREDITS.txt`
- Atlas frame rectangles, original anchors, animation sections, tile IDs and tile rectangles: `UnityProject/Assets/Art/ThirdParty/Flare/sprite-frame-metadata.json`

The upstream project states that Flare artwork is licensed CC BY-SA 3.0 (later versions permitted), except where a specific per-file license is listed in its credit ledger. The downloaded source files and definitions are unmodified and pinned in the metadata. Where artwork is adapted, record the original author/source, describe the change, retain the applicable share-alike license with that art, and keep the codebase license separate. Review the official ledger for each file before adding anything beyond this source set; several sources inside the dungeon atlas have their own CC BY 3.0 or public-domain notices.

The source assets are presented as part of this playable Unity project and are not a standalone downloadable art pack. Do not relicense Flare files as MIT. Preserve the upstream credits and licenses when redistributing the project.

## Flare game audio

A focused set of unchanged music, ambience and sound effects from the same pinned Flare: Empyrean Campaign revision is in `UnityProject/Assets/Art/ThirdParty/Flare/Audio/`. Exact per-file credits and licenses are recorded in [docs/art/AUDIO.md](../docs/art/AUDIO.md), with a colocated `NOTICE.txt` and per-file source paths and SHA-256 hashes in `manifest.json`. The licenses vary by file: music includes CC BY-SA 3.0; several effects are CC0/public domain; other effects have CC BY 3.0. `melee_attack.ogg` has no individual entry in the official credits ledger and is recorded as covered by Flare's general CC BY-SA 3.0 art license without inventing an author. Preserve these notices and the applicable per-file license when redistributing the audio.

## Flare player armor and derived atlases

Original male and female plate helm, cuirass, gauntlet, greave and boot atlases, along with their upstream animation definitions, are listed with pinned paths and hashes in `UnityProject/Assets/Art/ThirdParty/Flare/armor-manifest.json`; see [docs/art/ARMOR.md](../docs/art/ARMOR.md) for the layer map. The official credit ledger gives no per-file creator or exception for these avatar layers, so they use the Flare art default of CC BY-SA 3.0 or later, with no individual artist inferred.

`UnityProject/Assets/Art/Derived/Flare/` contains generated composite atlases assembled from the untouched source sprite layers using their original frame rectangles and anchors. These composites are derivatives of the Flare artwork and retain CC BY-SA 3.0 or later; the generator notes the source in `Assets/Editor/FlareCatalogImporter.cs`. The current selected set includes no separate Flare normal maps or alternate texture files. Source PNGs remain unmodified; Unity import settings and generated composites do not replace or change their provenance.
