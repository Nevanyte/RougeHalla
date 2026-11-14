# P-UNITY-DRESS-2: on a dressed map, shadows follow the shipped tall flag and the client rolls no water of its own; one map-run limit in C#

- **Serves:** owner decision 3 (2026-11-10: decoration has order; identical on every client) and decision 4 (Plague marsh
  rings are real terrain); reviewer notes on P-UNITY-DRESS-1 and P-WIRE17-MAP-2 (2026-11-13)
- **Implementer tier:** implementer-sonnet (Unity presentation, engine-free C#)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (presentation) · no wire change · D9 untouched (no game rule in Unity)

## 1. ID and outcome
Three leftovers of the decoration work, all client-side, found by reading (none seen on screen yet):

1. **Shadows ignore the shipped tall flag.** Drawing and fading a shipped prop use the row's flag
   (`RegionProps.cs:168`: `pl.Shipped ? (pl.Flags & 1) != 0 : art.Tall`), but the shadow pass takes its casters from
   `RegionProps.Scatter(map)` and reads only the sprite art's `Tall` (`View/Atmosphere/RegionShadows.cs:78-84`, strength
   `.9` tall / `.75` flat). A shipped prop whose row says tall but whose stand-in sprite is not (or the reverse) fades
   one way and casts the other. When this lands, a shipped prop is tall for shadows exactly when it is tall for
   drawing: one definition, used by both. Client-rolled props (maps without dressing) keep `art.Tall`.
2. **Plague gets two waters on a dressed map.** `PlagueGround` paints Water, Grass or Mud from position noise on every
   tile whose terrain is 0 (`View/Regions/PlagueGround.cs:37-51`), and `RegionGround.cs:53-54` always bakes it. On a
   dressed map the server's marsh rings (terrain codes mud and water, which slow) are real; the noise water beside
   them looks the same and does nothing. When this lands, on a dressed map (the map blob carries shipped props, the
   same test `RegionProps.cs:39` uses) the client's Plague noise produces no Water and no Mud: plain ground only, so
   every water or mud tile a player sees is one that slows. Maps without dressing are drawn exactly as today.
   `PlagueGround.Build` also reads raw `map.Terrain` where the rest of the client reads `EffectiveTerrain`
   (`RegionMap.cs:40-42`); it reads `EffectiveTerrain` after this packet.
3. **Two map-run limits in C#.** `Wire.MaxMapRuns` is `5 * MaxMapTiles` and unused (`RoguehallaNet/Protocol/Codec.cs:24-26`,
   with `MaxMapDecodedBytes`, also 5x and unused); the limit the decoder enforces is the private
   `MaxPlaneRuns = 6L * Wire.MaxMapTiles` (`Protocol/MapBlob.cs:80`), which equals Rust's
   `MAX_CUMULATIVE_RUNS = 6 * MAX_MAP_TILES` (`crates/rh-protocol/src/map.rs:19`). When this lands there is one
   constant, `Wire.MaxMapRuns = 6 * MaxMapTiles`, the decoder uses it, and the stale 5x values are gone. No accepted or
   refused blob changes.

Not in this packet: the patience label's size (`CampPatienceOutlines.cs:16`, `LabelSize = 1.6f`) is judged at the
screenshot round; the hidden quest carrier already has tests (`WorldMarks2EditModeTests.cs:171-192`).

## 2. Dependencies
P-UNITY-DRESS-1 (merged), P-WIRE17-MAP-2 (merged). Independent of P-UNITY-LANDMARK-1.

## 3. Relevant legacy paths
- none for 1 and 3. For 2: legacy has no cosmetic water beside real marsh (the marsh is new terrain, DEV row of
  P-TERRAIN-MARSH-1); on maps without dressing today's look stays.

## 4. New paths
- tests only

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/View/Atmosphere/RegionShadows.cs`
- `client-unity/UnityProject/Assets/Scripts/View/Regions/RegionProps.cs` (only to expose the one tall test)
- `client-unity/UnityProject/Assets/Scripts/View/Regions/PlagueGround.cs`, `RegionGround.cs` (only the Plague bake call)
- `client-unity/RoguehallaNet/Protocol/Codec.cs`, `Protocol/MapBlob.cs`, and their synced copies under
  `client-unity/UnityProject/Assets/RoguehallaNet/` (by `bash client-unity/sync-net.sh`)
- not the wire, not `crates/`, not `DecorationKinds.cs` (its unused `Tall` column is the kind table's, a later packet
  decides whether it stays), not any existing test

## 7. Behaviour to preserve
- Maps without dressing: props, shadows and Plague ground byte-for-byte as today.
- Every map blob accepted or refused today is still accepted or refused (the enforced limit is already 6x).
- Fade behaviour of shipped props (`DressedMapEditModeTests.cs:163-177`).

## 8. Acceptance checks
- EditMode: a dressed map with one shipped prop whose row is tall on a non-tall sprite, and one the other way round:
  the shadow pass treats each as the row says (strength .9 / .75). Red today.
- EditMode: on a dressed Plague map no tile of the client's Plague texture is Water or Mud; on the same map without
  props the texture equals today's (pin a digest of today's output for one seed). Red today for the first half.
- Engine-free (`RoguehallaNet.Tests`): `Wire.MaxMapRuns == 6 * Wire.MaxMapTiles`; a blob with exactly the limit's
  runs decodes and one more is refused (the second half is green today and is a guard).
- `scripts/gate.sh --quick --oracle packet/P-UNITY-DRESS-2` passes.

## Oracle files (read-only for implementers)
- `client-unity/UnityProject/Assets/Tests/Editor/DressedMap2EditModeTests.cs` (+ `.meta`)
- `client-unity/RoguehallaNet.Tests/MapRunLimitTests.cs`

Stub commit (the implementer replaces or edits it): `RegionShadows.cs` gains `RegionShadowMap.PropStrengths` (the strength
each prop caster was added with; behaviour unchanged). The implementer keeps that accessor, as the test reads it.

**Baseline** (on `packet/P-UNITY-DRESS-2` after the stub): EditMode 1063 tests, 1 red:
`AShippedPropCastsAsItsRowSaysWhateverItsSprite` (assertion: tall sprite, flat row, expected .75, was .9); the other two
tests of the file are guards, green today. RoguehallaNet.Tests 1972, 3 red, each on an assertion:
`TheMapRunLimitIsSixPlanesOfTiles` (expected 6291456, was 5242880), `TheStaleDecodedBytesConstantIsGoneOrSixPlanes`
(same numbers; passes if the constant is deleted), `MapBlobKeepsNoRunLimitOfItsOwn` (MapBlob's private `MaxPlaneRuns`
exists; no const field of MapBlob whose name contains "Run" may remain). `sync-net.sh --check` clean.

**Not pinned, on purpose:** the Plague half (outcome 2). See "Established facts" 2: its premise is wrong and the
coordinator or owner must decide it. The run limit has no "at the limit decodes, one more refused" test: neither blob can
exist (fact 4).

## 9. Validation commands
- `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/UnityProject/Tools/editmode.sh`; then
  `git checkout -- client-unity/UnityProject/Assets/Resources/Showcase/NunitoRegular.asset` if the run left it modified.
- `bash client-unity/sync-net.sh --check`

## 10. Risk and suggested model tier
Sonnet. Small; the Plague half changes what a dressed map looks like, so it is seen at the next screenshot round.

## 11. Known traps
- "Dressed" must be one predicate shared with `RegionProps.cs:39`, not a second test that can disagree.
- The server's water and mud are drawn as ground variants 7 and 8, tints over the base ground
  (`RoguehallaNet/Net/Ui/GroundVariantLook.cs:13-21`); the client's `TerrainKind` enum stops at 7
  (`RegionThemes.cs:11`) and the sim's mud and water terrain codes are 8 and above (`crates/rh-mapdress/tests/marsh.rs:23`).
  Establish first, with a test on a dressed Plague map, that every tile whose terrain code is mud or water is drawn as
  water or mud; if some are not, stop and report: that is a larger defect than this packet.
- An EditMode run modifies `NunitoRegular.asset`: never commit it.

## Notes from previous attempts

## Established facts (oracle-author, 2026-11-13; all on the branch at `coord/int-26`)

1. **Shadows.** `RegionShadowMap.Collect` (`View/Atmosphere/RegionShadows.cs:67-87`): wall and low tiles are casters of
   strength 1; then every `RegionProps.Scatter(map)` placement whose art exists (`RegionPropArt.TryGet`), with
   `art.Height * pl.Scale >= .38` and a sunny position, is a caster: half-width `max(.07, art.Width*pl.Scale*(art.Tall ? .16 : .30))`,
   strength `art.Tall ? .9 : .75`. Both the width and the strength read `art.Tall`; the drawing and fade path reads
   `pl.Shipped ? (pl.Flags & 1) != 0 : art.Tall` (`RegionProps.cs:168`). The one shared test would be a static on
   `RegionProps`, e.g. `IsTall(Placement pl, RegionPropSprite art)` returning exactly that expression, called at
   `RegionProps.cs:168` and in `Collect` for the strength (and, the implementer decides, the width; the oracle pins strength only).
   Fixture facts: `sent.deadtree` (kind 14) has a tall sprite, `fire.crystal` (kind 2) a low one
   (`TheFixtureSpritesDisagreeWithTheirRows` guards that).
2. **Plague: the brief's premise is wrong; the Plague half is NOT written.** The server's marsh is not terrain. Owner
   decision 2026-11-12 (MIGRATION.md:432): "Marsh slow 0% water 0% mud 30% bog"; `P-TERRAIN-MARSH-1` is CANCELLED, there
   are no terrain codes 8 or 9 (the wire refuses a terrain value above 7: `crates/rh-protocol/src/map.rs:1215`;
   `TerrainKind` stops at 7, `RegionThemes.cs:11`). Mud and water are **ground variants 7 and 8**, looks only, laid on the
   zone's plain floor round bog (`crates/rh-mapdress/tests/marsh.rs:1-23`), carried only by the ground-variant plane
   (`MapBlob.GroundVariants`), tinted by `GroundVariantLook` (rgb tint over the base ground, strength .62) in
   `RegionGround.BakeVariants` (`RegionGround.cs:105-120`), for any tile whose region is 1..5. So (a) there is no terrain
   code whose tile must be drawn as water or mud; (b) "every water or mud tile a player sees is one that slows" is false:
   neither slows anyone; (c) `PlagueGround.Build` already skips every tile with a non-zero terrain value
   (`PlagueGround.cs:48`), so noise water never lies on bog, only on plain floor, where the server's rings also lie
   (they overlap there, and `RegionGround` draws both). Every variant 7 or 8 tile in region 1..5 is drawn tinted, so nothing
   server-sent goes undrawn; the "larger defect" stop condition is not met, but the packet's outcome 2 rests on a
   superseded decision. Whether a dressed Plague map should lose its client noise (still two looks of water, one of them
   position noise) is a design call for the owner; the `EffectiveTerrain` change in outcome 2 is independent of it and
   remains valid.
3. **"Dressed"** is `map.Props != null && map.Props.Length > 0` (`RegionProps.cs:39`, the first line of `Scatter`). A single
   predicate would be `RegionProps.IsDressed(MapBlob map)` with that body, used at `RegionProps.cs:39` and in `PlagueGround`
   (if outcome 2 stands). Note `PlagueGround.Build` is also called from `Scatter`'s client-rolled branch (so on a
   dressed map it is only reached from `RegionGround.Build`, `RegionGround.cs:21`).
4. **Run limits.** `Wire.MaxMapRuns = 5 * MaxMapTiles` and `Wire.MaxMapDecodedBytes = 5 * MaxMapTiles`
   (`Codec.cs:25-26`): used nowhere outside the synced copy (grep of `client-unity/`). The enforced limits are private to
   `MapBlob`: `MaxPlaneRuns = 6L * Wire.MaxMapTiles` (`MapBlob.cs:80`; used at `:796`, `:1007`) and
   `MaxDecodedPlaneBytes = 6L * Wire.MaxMapTiles` (`:80`; used at `:794`). Rust: `MAX_CUMULATIVE_RUNS = 6 * MAX_MAP_TILES`
   and `MAX_DECODED_PLANES = 6 * MAX_MAP_TILES` (`crates/rh-protocol/src/map.rs:19-20`). Neither side of the run limit can
   be built as a blob: a plane has at most one run per tile and six planes make exactly 6 * 1048576 runs, which needs about
   18 MB, while the encoder refuses over `Wire.MaxServerFrame` (256 KiB, "welcome too large") and the decoder refuses a longer
   extension; and a plane's runs above its tile count are refused before the cumulative check. So the limit is a ceiling no
   frame reaches: the oracle pins the constants and that `MapBlob` keeps no copy. (A prototype at the limit failed on
   "welcome too large", which is how this was found.)
