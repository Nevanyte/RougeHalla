# Showcase prop candidate catalog import

This is an opt-in data import for review sprites. It does not select props for a map, infer zone/landmark placement, create colliders, or add gameplay/UI behavior.

## Inputs and reuse

- `Assets/Art/ThirdParty/FlareProps/candidate-tiles.json` and `asset-manifest.json` provide 42 candidate records plus exact pinned source hashes, tile rects, and offsets.
- `Assets/Art/ThirdParty/FlareProps/Raw/` retains the grassland atlas/definitions and captured license/credits.
- Dungeon files are read from the existing `Assets/Art/ThirdParty/Flare/Raw/` path; cave files are read from existing `Assets/Art/ThirdParty/FlareExpansion/Raw/`. The importer verifies all six atlas/definition SHA-256 hashes against the candidate source manifest. It does not copy or modify those existing files.

The captured source is Flare: Empyrean Campaign commit `af6eee6d339ac98011864bfe89da837fe7769c28`; captured Credits revision `61939e26d397b51c0c36da8cb861f89c8bf1d6db` edited 2026-04-05T03:05:38Z. Public pinned repository files cost USD 0 and retain CC-BY-SA 3.0-or-later project terms unless the exact credits ledger lists an exception. The ledger and license copy are retained locally. Dungeon and grassland composite credits are listed in the source manifest; it does not attribute individual tile artists, so no crop gets an inferred author. Cave has no individual attribution/exception for the exact atlas path in that captured ledger.

## Import

Copy the contents of this staging package under `client-unity/UnityProject/` after parent review, together with the `Assets/Art/ThirdParty/FlareProps/` source folder. Existing dungeon/cave raw files must already exist at the paths above and match the pins.

Use **Roguehalla → Art → Import Flare Prop Candidates**. The importer reads the exact 42 record JSON and the Flare `tile=` rows, compares the source rectangle and offsets, verifies the definition's `img=` path and atlas bounds, checks source file byte count and SHA-256, then writes per-tile derived PNGs under `Assets/Art/Derived/FlareProps/Tiles/`. It imports those PNGs as individual Sprite assets with the same Flare-to-Unity pivot conversion already used for the expansion tiles:

```csharp
pivot.x = flareOffsetX / (float)tileWidth;
pivot.y = (tileHeight - flareOffsetY) / (float)tileHeight;
```

The generated `Assets/Art/Derived/FlareProps/ShowcasePropCatalog.asset` sits outside `Resources`. Each `Entry` holds read-only properties for stable key, source atlas and definition provenance, exact source rectangle and Flare offset, normalized pivot, candidate label, Sprite and any raw animation line. Keys are `flare.<family>.<tile-id-D3>`, for example `flare.dungeon.145`.

Runtime/read-only lookup surface:

```csharp
catalog.Count
catalog.GetEntry(index)
catalog.TryGetEntry("flare.dungeon.145", out var entry)
catalog.GetSprite("flare.dungeon.145")
```

No public collection or setter exposes the serialized catalog array. The importer uses `SerializedObject` to write it.

## Animation and coverage boundary

A candidate entry whose source tile has `animation=` stores that exact line in `AnimationRecord`; `HasAuthoredAnimation` is true. Its `Sprite` still represents only the source `tile=` base rectangle. Current candidate tile 265 is the cave portal ring with an authored 4-frame animation; this importer preserves the raw record but does not claim to create the animated sequence. Review the coverage table in [PROP_ASSET_COVERAGE.md](PROP_ASSET_COVERAGE.md) for direct candidates, family-reuse samples, and explicit gaps across all 34 legacy prop keys and five landmarks. These images are not approved placement or complete landmark geometry.

## Integration corrections

The importer selects the primary named atlas section in multi-image definitions (grassland also contains water). It pads the extracted source rectangle with transparent pixels to preserve every source pixel, include out-of-crop ground pivots, and retain at least 2px clearance; it does not resample. The catalog normalized pivot describes that padded output. Two of 42 source pivots lie outside their original crop. All 42 generated sprites were verified against source pixels and imported pivots; no physics shapes are generated.
