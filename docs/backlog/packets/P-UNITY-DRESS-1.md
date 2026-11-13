# P-UNITY-DRESS-1: the client draws the decoration the server sends and rolls none of its own

- **Serves:** owner decision 3 (MIGRATION, 2026-11-10: rule-based decoration, identical on every client); plan lane D
  packet 9; the Unity half of P-DRESS-BAKE-1
- **Implementer tier:** implementer-sonnet (Unity view code)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework at or after `df07deec` (P-DRESS-BAKE-1 merged)
- **Status:** oracle committed on `packet/P-UNITY-DRESS-1` (oracle author, 2026-11-13).
- **D-rules touched:** D1 n/a (DEV-021: decoration has no legacy counterpart as rules) · no wire change · no game rule
  in Unity (decoration is looks only; props stay walk-through)

## 1. ID and outcome
Since P-DRESS-BAKE-1 every Welcome's map blob carries the server's decoration: a prop list (`MapBlob.Props`: kind code,
world x and y, variant 0-3, flags: tall 1, legacy 2; sorted by (y, x, kind)) and a ground-variant plane
(`MapBlob.GroundVariants`: one byte per tile, 0 = none, 1-15). The client validates both and ignores them: it still
rolls its own scatter per floor tile (`View/Regions/RegionProps.cs` `Scatter`), which is why decoration differs from
client to client and looks random. When this lands:
- a map whose blob carries props draws exactly those props, at those positions, with that variant, and rolls no
  scatter; a map whose blob carries none (the practice arena, an older server) keeps today's scatter, unchanged;
- a tile with a non-zero ground variant draws that variant's ground (the landmark bands' variants 3-6, Plague's water
  7 and mud 8) in place of the zone's base ground; variant 0 draws today's ground;
- tall props (flag 1) keep the fade of P-UNITY-PROP-FADE-1 when an actor stands behind or inside them;
- the client's table from kind code to sprite is generated from, or checked against,
  `crates/rh-mapdress/rules/zones.json` (another session edits that file: a test fails when the two disagree), and a
  kind the table does not know draws a visible placeholder and logs once, never nothing and never an exception.

## 2. Dependencies
- P-DRESS-BAKE-1 merged (it is). The land-generation task owns `crates/rh-mapdress/**`; this packet reads its rules
  file and edits nothing there.

## 3. Relevant paths
- `client-unity/RoguehallaNet/Protocol/MapBlob.cs` (`Props`, `GroundVariants`, the caps), `crates/rh-mapdress/src/rules.rs`
  (the kind-code blocks: 1-10 Fire … 41-50 Holy, second blocks 51-100; `is_tall`), `rules/zones.json` (kind names)
- `client-unity/UnityProject/Assets/Scripts/View/Regions/{RegionProps.cs,RegionPropArt.cs,RegionGround.cs,RegionGroundTextures.cs,PlagueGround.cs,RegionMap.cs}`

## 3a. Established facts (oracle author, 2026-11-13; line numbers at bf5b3cfa4)

1. **How the scatter is built today.** `ArenaView.cs:238` calls `RegionProps.Build(_mapRoot, map)` once at map load;
   `Create` (`RegionProps.cs:~122`) calls `Scatter(map)` (the pure placement list, `:~28`) and makes ONE `GameObject` per
   placement (named by its sprite key) with a `SpriteRenderer`, all sharing one atlas and one material (one batch), at
   `ArenaView.WorldPoint(pl.X * 32, pl.Y * 32)` (placement X, Y are TILE units), `sortingOrder = 2000 + round(Y*32/2) + Bias`.
   A placement whose art is missing is skipped silently (`if (!RegionPropArt.TryGet(...)) continue`). `Scatter` is also read by
   `View/Atmosphere/AccentLights.cs:108` (lantern lights), `Atmosphere/RegionShadows.cs:78`, `ContrastLab/ContrastLabPlan.cs:208`,
   `AtmospherePreviewCapture.cs:71`: all outside this packet's scope, so `Scatter` stays THE placement list (decision 1).
   `Scatter` = per floor tile roll (the themes' `PropRule`s) + temple props (`TempleLayout`) + coliseum props (`ColiseumProps`) +
   real bushes from the bush plane (`AddRealBushes`). Tests locate props as the existing `TempleInteriorEditModeTests` does:
   `GetComponentsInChildren<SpriteRenderer>()`, `name` = sprite key, `transform.localPosition` = `ArenaView.WorldPoint`.
2. **Rule kinds, codes, art** (51 kinds; blocks 1-50, 61, 81, 91; `tall` from the rules file). "own" = a sprite of that name exists
   in `RegionPropArt*.cs`. A kind without art draws the nearest existing prop (column "client art"); the 23 "none" rows are the
   art-pass list.

| kind | code | tall | art today | client art |
|---|---|---|---|---|
| fire.spire | 1 | yes | own | fire.spire |
| fire.crystal | 2 | | own | fire.crystal |
| fire.rocks | 3 | | own | fire.rocks |
| fire.vent | 4 | | own | fire.vent |
| fire.ash | 5 | | none: nearest fire.rocks | fire.rocks |
| fire.crust | 6 | | none: nearest fire.rocks | fire.rocks |
| fire.basalt | 7 | | none: nearest fire.rocks | fire.rocks |
| fire.emberjet | 8 | | none: nearest fire.vent | fire.vent |
| fire.boulder | 9 | | none: nearest fire.rocks | fire.rocks |
| fire.ashheap | 10 | | none: nearest fire.rocks | fire.rocks |
| sent.tomb | 11 | | own | sent.tomb |
| sent.cross | 12 | | own | sent.cross |
| sent.slab | 13 | | own | sent.slab |
| sent.deadtree | 14 | yes | own | sent.deadtree |
| sent.lantern | 15 | | own | sent.lantern |
| sent.deadgrass | 16 | | own | sent.deadgrass |
| sent.flag | 17 | | none: nearest sent.slab | sent.slab |
| sent.grave | 18 | | none: nearest sent.tomb | sent.tomb |
| sent.lamp | 19 | | none: nearest sent.lantern | sent.lantern |
| sent.stump | 20 | yes | none: nearest sent.deadtree | sent.deadtree |
| sent.fence | 61 | | none: nearest sent.cross | sent.cross |
| plague.column | 21 | yes | own | plague.column |
| plague.rubble | 22 | | own | plague.rubble |
| plague.tree | 23 | yes | own | plague.tree |
| plague.bush | 24 | | own | plague.bush |
| plague.fern | 25 | | own | plague.fern |
| plague.mushroom | 26 | | own | plague.mushroom |
| plague.root | 27 | | none: nearest plague.rubble | plague.rubble |
| plague.reed | 28 | | none: nearest plague.fern | plague.fern |
| plague.fungus | 29 | | none: nearest plague.mushroom | plague.mushroom |
| plague.sedge | 30 | | none: nearest plague.fern | plague.fern |
| frost.rock2 | 31 | | own (the art is tall, the rule is not) | frost.rock2 |
| frost.shards | 32 | | own | frost.shards |
| frost.pine | 33 | yes | own | frost.pine |
| frost.pine2 | 34 | yes | own | frost.pine2 |
| frost.drift | 35 | | own, `frost.drift2` is variant 1 | frost.drift |
| frost.rock | 36 | | own | frost.rock |
| frost.shelf | 37 | | none: nearest frost.rock | frost.rock |
| frost.crag | 38 | | none: nearest frost.rock2 | frost.rock2 |
| frost.snowbank | 39 | | none: nearest frost.drift | frost.drift |
| frost.flurry | 40 | | none: nearest frost.drift | frost.drift |
| frost.spire | 81 | yes | none: nearest frost.pine2 | frost.pine2 |
| holy.pillar | 41 | yes | own | holy.pillar |
| holy.rock | 42 | | own | holy.rock |
| holy.palm | 43 | yes | own | holy.palm |
| holy.shrub | 44 | | own | holy.shrub |
| holy.flowers | 45 | | own | holy.flowers |
| holy.grass | 46 | | own | holy.grass |
| holy.paver | 47 | | none: nearest holy.rock | holy.rock |
| holy.banner | 48 | | none: nearest col.banner (coliseum art) | col.banner |
| holy.hedge | 49 | | none: nearest holy.shrub | holy.shrub |
| holy.turf | 50 | | none: nearest holy.grass | holy.grass |
| holy.brazier | 91 | | none: nearest temple.brazier | temple.brazier |

   The oracle pins: the table holds exactly the file's kinds (name, code, tall); a kind with "own" art draws its own name; every
   table art exists in `RegionPropArt`. The "client art" column of the "none" rows is a recommendation, not pinned. Art that exists
   but no rule uses: `fire.stump`, `sent.urn`, `sent.gargoyle`, `sent.scarecrow`, `frost.reeds`, `frost.bush`, `temple.*`, `col.*`.
   Variants: only `frost.drift` has a second sprite (variant 1).
3. **Legacy props (flag 2, kind below 34).** Served maps carry none (decor off). The client does not know the generator's
   catalogue, so a legacy row draws the placeholder (`DecorationKinds.ArtKey` returns `Placeholder` whenever flag 2 is set).
   Pinned: it does not throw and is drawn as the placeholder; logging is free.
4. **Ground today.** `RegionGround` is ONE quad with `Resources/Regions/RegionGround.shader`: region weights from the region
   plane, terrain planes, Plague's water, grass and mud baked from `PlagueGround` (client noise, not from the server), temple
   skin, all from one `Texture2DArray` of six procedural layers (`RegionGroundTextures`, one per region, tinted by the palette).
   There is no per-variant texture. "Variant v's ground" is therefore a TINT: `GroundVariantLook.TryGet(region, variant)` gives
   colour and strength; `RegionGround.BakeVariants(map)` bakes one RGBA32 texel per tile (rgb tint, a strength, 0 = base ground);
   the material gets it as `_VariantTex` (w x h) and the shader blends it over the base ground. The shader is outside
   `View/Regions`, so the write scope names it. Variants the rules use: 1-2 (each zone's fallback rings; the brief's "3-8" missed
   them, the oracle covers every variant found in the file), 3-6 (landmark bands: same number, different meaning per zone, hence
   the region argument), 7 water and 8 mud (Plague round bog). All satisfiable with tints: no new art is REQUIRED. Art-pass
   wishlist: real textures for the bands and for 7/8 (the existing `PlagueGround` water and mud look better than a tint; the
   implementer may route 7 and 8 through that path as long as `BakeVariants` and the table behave as pinned). Whether the client's
   own `PlagueGround` noise water is still drawn when the server sends 7/8 is not pinned.
5. **Fade.** There is no single `Tall` definition. `RegionPropSprite.Tall` (set per sprite by `Add(..., tall)` in
   `RegionPropArt*.cs`) feeds `Prop.Tall` and `_tallByCell` in `RegionProps.Create`; the `tall` built from `Art.EndsWith(...)`
   in `Scatter` is spacing only (its own comment). For a shipped prop the row's flag 1 replaces `art.Tall`: a flagged row fades
   whatever its sprite, an unflagged row never fades even on a tall sprite (pinned both ways: `ThePropFlagDecidesTheFade`).
   Scatter placements keep `art.Tall`. Rule `tall` and art `Tall` disagree in places (frost.rock2 art tall; sent.stump no art).
6. **Fixture and blobs.** Pin on `crates/rh-sim/src/mapdata/fixtures/seed1.map.json` (checked in; loaded through `JsonUtility`
   as `RegionArtEditModeTests.Load` does): `RegionProps.Scatter` = **2218** placements today (measured in EditMode at the base).
   Blobs with props are built in the test with `MapBlob.WithPublic(null, null, bushes, props, groundVariants)` on a 40 x 40 open
   map (left half Plague, right half Frost; scatter 118 placements today) or on the fixture. No server involved.

## 3b. Decisions for the coordinator (the oracle assumes the recommended answer)
1. **`Scatter` stays the single placement list.** The brief says "`Scatter` placed none" for a dressed blob; three readers of
   `Scatter` (lantern lights, shadows, contrast lab) are outside the write scope and would lose every prop. The oracle
   pins: for a blob with props `Scatter` returns exactly the blob's props as placements (tile units, `Kind`, `Variant`,
   `Flags` set; no roll, no temple, no coliseum, no per-tile scatter) plus the real bushes; for a blob without, today's list
   with `Kind` 0. If a new list API is preferred, the oracle's `Scatter` calls change.
2. **Temple and coliseum furniture** (`temple.*`, `col.*`) are client-drawn buildings, not scatter. Not pinned either way on a
   real map (`OnARealMap...` filters them out); the synthetic-map tests have none. Recommendation: keep them. Real bushes
   (concealment cells) are kept and pinned.
3. **Log format**: `Debug.LogWarning` whose text contains `kind <code>`, once per unknown code per `RegionProps.Build`
   call; `ground variant <n>` once per unknown variant per `BakeVariants` call (per build, not per process, so tests do not
   depend on order).

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/View/Regions/{RegionProps.cs,RegionGround.cs,RegionPropArt.cs}` (and the
  `RegionPropArt.*.cs` partials if the placeholder is painted there)
- `client-unity/UnityProject/Assets/Resources/Regions/RegionGround.shader` (`_VariantTex`; `RhSun.hlsl` only if needed)
- `client-unity/RoguehallaNet/Net/Ui/{DecorationKinds.cs,GroundVariantLook.cs}` (the stub's files, filled in), their synced
  copies and `.meta` files under `UnityProject/Assets/RoguehallaNet/Net/Ui/` (`bash client-unity/sync-net.sh`)
- not `Protocol/**`, not `crates/**`, not the existing tests

## 7. Behaviour to preserve
- Maps without shipped decoration look exactly as today (the scatter's own tests stay green); the keep-clear the
  scatter respected is the server's job now and is not re-checked on the client; no per-frame garbage; the prop fade.

## 8. Acceptance checks
- EditMode: given a blob with N props, exactly N prop objects exist at the blob's positions with the blob's kinds and
  variants, and `Scatter` placed none; given a blob with none, today's scatter count for that map (pinned on a
  checked-in map fixture, not a generated one).
- EditMode: a tile with ground variant v draws variant v's texture or tint; v = 0 draws the base ground; every variant
  the shipped rules use (3-8) has an entry; an unknown variant draws the base ground and logs once.
- The kind table covers every kind in `zones.json` (a test reads the file); an unknown kind draws the placeholder.
- A tall prop fades as P-UNITY-PROP-FADE-1 pins; a prop without the flag does not.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-DRESS-1` passes.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/DecorationKindsTests.cs` (engine-free: kind table and ground tints against `zones.json`)
- `client-unity/UnityProject/Assets/Tests/Editor/DressedMapEditModeTests.cs` and its `.meta`
- `docs/backlog/packets/P-UNITY-DRESS-1.md`

Stub commit (the implementer fills in): `RoguehallaNet/Net/Ui/DecorationKinds.cs` and `GroundVariantLook.cs` (empty table;
`ArtKey` returns null; `TryGet` false) with synced copies and metas; `RegionProps.Placement` gains `Kind`, `Variant`,
`Flags`; `RegionGround.BakeVariants(MapBlob)` returns an empty array.

Red at the oracle commit (each on an assertion). Engine-free: `TheKindTableHoldsExactlyTheKindsOfTheRuleFile`,
`AKindWithItsOwnArtDrawsItAndEveryOtherKindDrawsAnExistingSpriteOfItsOwn`,
`ArtKeyUsesTheVariantWhereTheArtHasOneAndThePlaceholderForWhatItDoesNotKnow`, `ALegacyPropDrawsThePlaceholderAndNothingThrows`,
`EveryGroundVariantTheRuleFileUsesHasATintInEveryRegion`, `TheBandsAreToldApartAndWaterReadsBluerThanMud`. Guard (green
today): `VariantZeroAndAnUnusedVariantHaveNoLookSoTheBaseGroundShows`. EditMode: every test of `DressedMapEditModeTests` is
red except the guards `ABlobWithoutPropsKeepsTodaysScatterUnchanged` and `GuardAFrameOfADressedMapAllocatesNothingForDecoration`.
Existing tests whose expectation must change: none (`RegionArtEditModeTests` and `TempleInteriorEditModeTests` call `Scatter`
on maps without props, unchanged).

## 10. Risk and suggested model tier
Sonnet. The art: say which rule kinds have a sprite today and which do not (the oracle author lists them); a kind
without art uses the nearest existing prop of its zone and is named in the hand-off for the art pass. Landmark art
(the volcano, church, tree, cave and hall as buildings) is not this packet.

## 11. Known traps
- Prop positions are world units (32 per tile) with a small offset inside the tile; draw order follows y.
- A landmark-mode map carries about 1,100-1,190 props and about 23,000 non-zero ground cells: build them once at
  Welcome, batched like today's scatter, not per frame.
- An EditMode run modifies `Assets/Resources/Showcase/NunitoRegular.asset`: `git checkout --` it, never commit it.

## Notes from previous attempts
