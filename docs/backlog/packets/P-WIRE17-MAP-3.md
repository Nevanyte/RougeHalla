# P-WIRE17-MAP-3: the map blob carries each zone's landmark anchor, so the client can draw landmarks as landmarks

- **Serves:** owner decision 4 (MIGRATION, 2026-11-10: one landmark per zone) and the owner's standing direction
  (2026-11-12: show each zone's landmark, close and wide, once drawn); ADR 0028 decision 7 (anchors); the Unity
  landmark art packets (`P-UNITY-LANDMARK-*`), which cannot start without it
- **Implementer tier:** implementer-opus (wire format, map blob, cross-crate)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework at or after `83a19406` (P-WIRE17-MAP-2 merged: map section version 3);
  oracle written on 1da708218
- **D-rules touched:** D1 n/a (landmarks have no legacy counterpart: DEV-020); golden vectors required · protocol
  stays 17 until the next deployed build (owner approval 9) · no sim change · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
The generator records each zone's landmark as a `ZoneAnchor { zone, kind, centre, footprint, front, entrance }` on
`GameMapData.anchors` (zone-code order; `crates/rh-sim/src/mapdata/model.rs:246`). They exist only on the generator's
map: the arena conversion drops them, and nothing on the wire names them. The client receives the landmark's tiles
(walls, ice, lava, bog, fence) and draws them as ordinary zone tiles, so a volcano is a wall blob and the church has
no roof. When this lands the Welcome's map blob carries the anchors as public map data in a new optional section
(map section version 3, the second presence byte's next free bit after the patience plane's 0x01, i.e. **0x02**): per
anchor the zone, the kind code, the centre tile, the footprint rectangle, the front (DIR16) and the entrance tiles, in
zone-code order. A map without anchors (option off, the fixed `--map`, practice) encodes exactly as today. The C#
client exposes them (`MapBlob.Anchors`); the JS probe decodes them (`map.anchors`). Drawing is the Unity packets'.

## 2. Dependencies
- P-WIRE17-MAP-2 merged (section version 3 and the second presence byte). P-DRESS-BAKE-1 merged (the pool's worker
  holds the generator's map, anchors included, before the arena conversion: the same place the anchors are read here).
- The landmark packets change what an anchor's footprint and entrance ARE (the cave's becomes the 29 x 29 box with
  P-MAPGEN-SIG-SCALE-1; the church's entrance becomes its main gate with SCALE-2): this packet carries whatever the
  generator records and pins no landmark's geometry.
- Serial with any packet touching `map.rs`, `ground.rs`, `samples.rs`, `probe.html`, `MapBlob.cs`, `v17.json`.

## 3. Established facts (oracle author, with sources)

No legacy counterpart (landmarks are DEV-020); `packages/` was not consulted.

### F1. Row layout, kind codes, caps, order (decided; the tests pin it)
- Model: `crates/rh-sim/src/mapdata/model.rs:241-257` `ZoneAnchor { zone: Zone, kind: FeatureKind, centre: TilePt
  (i32 x, y), footprint: TileRect (i32 x, y; u32 w, h), front: u8, entrance: Vec<TilePt> }`; zone codes
  `model.rs:34-42` (Fire 1, Sentenced 2, Plague 3, Frost 4, Holy 5). Producers: `crates/rh-sim/src/mapgen/landmarks/
  signature/{volcano.rs:196, church.rs:201, bog_tree.rs:91, cave.rs:326 and :406}`, `signature/mod.rs:617` (the Holy
  hall), `mapgen/style_scorch/mod.rs:375` (Volcano), `mapgen/style_rime/mod.rs:341` (Cave). Only the five kinds below are
  ever recorded.
- **Kind is a wire code table, not the `FeatureKind` ordinal** (`FeatureKind` is appended to by landmark packets;
  another session is appending `BogPool` after `Cave`): **1 Volcano, 2 Church, 3 BogTree, 4 Cave, 5 Hall**
  (`rh_protocol::map::ANCHOR_KIND_*`, C# `MapBlob.AnchorKind*`). The decoder does not tie a kind to a zone (a later
  landmark packet may give a zone another landmark); a new landmark kind is a new code. The server maps `FeatureKind ->
  code` in `public_ground.rs`; any other kind on an anchor is `EncodeError::BadMap("anchor kind")` (a generator bug,
  refused, never skipped).
- **Section** (presence2 bit 0x02, after the patience plane, before `terrain_mode`):
  `count u8 | count x row`, row = `zone u8 | kind u8 | centre x u16 | centre y u16 | footprint x u16 | y u16 | w u16 |
  h u16 | front u8 | entrance count u8 | entrance count x (x u16, y u16)`, little endian, tile units. Fixed row part 16
  bytes; the section is at most `1 + 5 x (16 + 16 x 4) = 401` bytes. Every generator value fits u16 (maps are at most
  1024 x 1024 tiles); the server refuses a negative or oversized one with a `BadMap` reason (the wire never clamps).
- **Decoder checks, in this order** (Rust `BadMap(reason)`; C# message `"BadMap: <reason>"`; JS `"bad map <reason>"`):
  1. `count` 0 or above 5 (`MAX_MAP_ANCHORS`): `"anchor count"` (absence is the bit: one encoding per map).
  2. Per row: read the fixed 16 bytes as one block (`Truncated` when the extension cannot hold them, so a count the rows
     do not fill is `Truncated`, never a garbage row); `zone` 0 or above 5: `"anchor zone"`; `zone` not above the
     previous row's: `"anchor order"` (ascending, no duplicates); `kind` not 1..=5: `"anchor kind"`; footprint `w == 0`,
     `h == 0`, `x + w > map w` or `y + h > map h` (no u16 overflow): `"anchor footprint"`; centre outside the half-open
     footprint (`x <= cx < x + w`, `y <= cy < y + h`): `"anchor centre"`; `front >= 16`: `"anchor front"`; entrance
     count above 16 (`MAX_ANCHOR_ENTRANCE`): `"anchor entrance"`; entrance count x 4 above what the extension still
     holds: `Truncated` (before any tile is read); each entrance tile outside the map: `"anchor entrance"`.
  3. Entrance tiles are checked against the **map** only, not the footprint (generator order kept, duplicates allowed),
     so a later landmark whose way in sits just outside its box still decodes.
- **Entrance cap 16**: today the cave mouth is 3 tiles, the church door 3; SCALE-2 makes the church's entrance its 5-tile
  main gate. 16 equals the coliseum gate cap (`MAX_GATE_TILES`), three times the largest planned entrance.
- **Encoder** (`MapBlob::with_public`, `EncodedMap::from_public`, C# seven-argument `WithPublic`): `MapPublic.anchors`
  empty = absent; refuses with the same reasons (`"anchor count"` for more than five; the rest as above).

### F2. What the generator guarantees about `centre` against `footprint` (measured)
Seeds 1-8, `StyledMaker { signature: true }.options()` (the pool's options), scratch test, not committed: every map has
5 anchors (zones 1..5 ascending: Volcano, Church, BogTree, Cave, Hall); **every centre is strictly inside its footprint**
(the half-open rectangle); every entrance tile inside its footprint, on the edge facing `front`; every footprint inside
the 160 x 160 map. Shapes on these seeds (not pinned): volcano 5 x 5 (centre = the cone's centre, the box's middle),
church 11-15 x 9-14 (centre = the camp tile), bog tree 13-15 x 13-15 (the trunk), cave 10-15 x 12-15 (the camp tile;
SCALE-1's 29 x 29 box is not on this base), Holy hall 38-39 x 38-39 (the hall's anchor point); entrances 3 tiles (church,
cave) or none. The decoder's check is therefore "inside, half-open"; the "on the edge" variant is not needed.

### F3. Where the anchors are at hand on the server
- Pooled maps: `crates/rh-server/src/map_pool.rs:129-140` `StyledMaker::make_dressed` holds `export.map: GameMapData`
  (anchors on it) before `into_arena(export)` (`:114`), which drops them (`rh_sim::mapdata` keeps them only for the
  export, `crates/rh-sim/src/mapdata/mod.rs:40-41`). No sim accessor is missing. Suggested route (the tests only see the
  served blob): `MadeMap` gains `anchors: Vec<rh_sim::mapdata::ZoneAnchor>` (filled there; the trait's default
  `make_dressed` at `:56` gives none); `admit_made` (`:154`) passes them to a new `MapAssets` constructor that calls
  `public_ground::encode_dressed_map` with them; a `public_ground` function converts `&[ZoneAnchor]` to
  `Vec<MapAnchor>` by the kind table. No sim state is added; the arena is untouched.
- **Keep `MapAssets { arena, welcome_map }` as it is**: `crates/rh-server/tests/dress_bake.rs:325` and the new
  `tests/map_anchors.rs` build it as a struct literal.
- Fixed `--map` (`runtime::source_map` then `MapAssets::new`) and the practice arena: none (an arena carries no anchors;
  the seed-1 fixture has none). `MapAssets::new` stays anchor-free.
- **The room's cache check**: `crates/rh-server/src/room.rs:521` asserts `public_ground::matches_static_map(welcome_map,
  arena.map)`, which rebuilds the public sections from the arena (no anchors) and calls
  `EncodedMap::matches_public_any_dressing` (`crates/rh-protocol/src/map.rs:1493` after the stub). That must accept the
  anchors section as it accepts the dressing (copy the decoded `anchors` in, as it copies `props` and
  `ground_variants`), or every landmark room panics at open. The server tests open rooms on pooled maps.

### F4. Hashes
- Semantic hash: header `[3, presence, presence2]` (presence2 `0x02`, or `0x03` with the patience plane), then the parts
  in wire order: after the patience plane's decoded cells, the anchors section's **wire bytes, count included** (as every
  list section). The context hash keeps its form. `matches_public` compares the anchors as part of the public map.
- `content_hash` (`crates/rh-sim/src/content.rs:454-470`) covers the registry, the tables and the generator definition,
  not per-map sections: it does not move (asserted). The state hash, checkpoints and replays never see the blob
  (asserted: 120 steps with and without the section, replay hashes and arena equal, the anchored room's replay verifies).

### F5. Older protocol-17 clients, and the vector that must move
- A client built before this packet refuses every Welcome whose map has anchors: presence2 bit 0x02 is unknown to it
  (`map.rs` preflight `PRESENCE2_KNOWN`, `MapBlob.cs:579`, `probe.html:571`: `"presence"`), a refused Welcome. With
  landmark mode on, that is every pooled map. `PROTOCOL_VERSION` stays 17 (owner approval 9: stamp 18 on the next
  deployed build); the same flag as MAP-2 (AGENTS.md says bump when incompatible): the coordinator decides.
- **`map17_v3_presence_unknown` uses bit 0x02**: `crates/rh-protocol/src/samples.rs:3860-3861`,
  `welcome_public_raw3(0x04, 0x03, …)` (presence2 `0x01 | 0x02`). Once 0x02 is anchors, that frame reads as a malformed
  anchors section. **The implementer changes its presence2 to `0x81`** (`0x01 | 0x80`, the last bit, which stays
  undefined longest); reason still `"presence"`; its bytes change (owner approval: an existing vector's bytes). C#
  `MapPatienceTests.cs:64` and JS `check-map-patience.mjs:45` read it by name and keep passing.
- **Existing test that must change** (owner approval, mechanical): `crates/rh-protocol/tests/map_patience.rs:421`
  `for bit in [0x02u8, 0x80]` (`version_3_needs_a_known_second_presence_byte`) becomes `[0x04u8, 0x80]`. Green until the
  decoder knows 0x02, red after.

### F6. Identities
None move. The map blob is not the observation (`OBSERVATION_VERSION` stays 29: no observation field), and `rh-policy`
never reads `MapPublic`/`MapBlob` outside a test, so `POLICY_CONTRACT_VERSION` stays 23. `PROTOCOL_VERSION` 17 (F5),
`CHECKPOINT_FORMAT`, `REPLAY_FORMAT`, `content_hash`: unchanged. `v17.json` regenerated by its command.

## 4. Wire layout (decided; the tests pin it)
- No anchors, no patience plane: version 2, byte for byte as today. Patience only: version 3, presence2 0x01, as today.
  With anchors: `ext_len u32 | 3 | presence | presence2 | semantic_hash u32 | the v2 sections | patience plane (0x01) |
  anchors section (0x02, F1) | terrain_mode u8 | context_hash u32`. `PRESENCE2_KNOWN` becomes 0x03; 0x04..0x80 stay
  `"presence"`.
- Types (stub): `rh_protocol::map::{MapAnchor { zone, kind, centre: MapTile, footprint: MapRect, front, entrance:
  Vec<MapTile> }, MapRect { x, y, w, h: u16 }, MAX_MAP_ANCHORS = 5, MAX_ANCHOR_ENTRANCE = 16, ANCHOR_KIND_* }`,
  `MapPublic.anchors: Vec<MapAnchor>`, `ground::PRESENCE2_ANCHORS = 0x02`. C#: `MapRect`, `MapAnchor(zone, kind, centre,
  footprint, front, entrance)`, `MapBlob.Anchors` (empty array when absent), `MaxAnchors`, `MaxAnchorEntrance`,
  `AnchorKind*`, seven-argument `WithPublic(…, patience, anchors)` (null or empty = absent). JS: `map.anchors`, always an
  array (empty when absent, like `camps`), rows `{ zone, kind, centre: { x, y }, footprint: { x, y, w, h }, front,
  entrance: [{ x, y }] }` in that key order.

### Golden vectors the implementer adds to `crates/rh-protocol/src/samples.rs` (then regenerates `v17.json`)
- server `welcome_public_anchors`: `welcome_map_msg` of `public_map(true)` (no patience plane) plus the five anchors of
  `crates/rh-protocol/tests/map_anchors.rs` `five()`; `welcome_public_anchor_one`: `public_map(false)` plus `one()` (the
  zone-4 cave row of `five()`). Neither may carry a patience plane (`map_patience.rs`
  `guard_existing_public_vectors_carry_no_plane` allows only `welcome_public_patience`).
- malformedMap (reason), each e.g. `welcome_public_raw3(0x00, 0x02, &[raw_list(rows)])` on the 4 x 3 raw map:
  `map17_anchor_count_zero` (`"anchor count"`), `map17_anchor_count_over` (6 rows, `"anchor count"`),
  `map17_anchor_zone` (zone 0 or 6), `map17_anchor_order` (zones 2, 1), `map17_anchor_duplicate` (zones 3, 3; both
  `"anchor order"`), `map17_anchor_kind`, `map17_anchor_footprint` (`x + w` past the map), `map17_anchor_centre`,
  `map17_anchor_front` (16), `map17_anchor_entrance_over` (17 tiles), `map17_anchor_entrance_tile` (a tile off the map;
  both `"anchor entrance"`), `map17_anchor_truncated` (count 2, one row: `"truncated"`); plus the moved
  `map17_v3_presence_unknown` (F5). Also checked by `samples.rs` `every_malformed_map_is_refused_for_its_reason`, C#
  `MapBlobPublicTests.MalformedMapIsRefusedForTheRustReason` and `check-vectors.mjs` (generic `/${reason}$/`).
- Every other existing vector keeps its bytes.

## 5. Exclusive write scope
- `crates/rh-protocol/src/{ground.rs,map.rs,samples.rs}`, `protocol/fixtures/v17.json` (regenerated only:
  `cargo run -p rh-protocol --bin protocol-fixtures`)
- `crates/rh-protocol/tests/map_patience.rs:421` only (F5; owner approval)
- `crates/rh-server/src/{map_pool.rs,public_ground.rs,room.rs}` (where the pooled map's anchors reach the blob)
- `client-unity/RoguehallaNet/Protocol/MapBlob.cs` and the synced Unity copy (`bash client-unity/sync-net.sh`);
  `crates/rh-server/web/probe.html`; `tools/protocol-js/**` except the oracle script
- not `crates/rh-sim/` (no accessor is missing), not `crates/rh-mapdress/`, no Unity scripts, not `Cargo.lock`

## 6. Contracts
- C-OBS: anchors restate public map features (legacy clients generated the whole map); nothing viewer-specific.
- Not gameplay: outside the state hash, content hash, checkpoints and replays; inside the map blob's semantic hash.
- C-NET / ADR 0011: Rust, C# and JS decoders in one branch; refusals, not clamps. Caps in F1.

## 8. Acceptance checks
- Wire: vectors for a map with five anchors, with one, with none (today's bytes); refusals for each cap and truncation;
  Rust, C# and JS agree on each.
- Server: a pooled landmark-mode map's blob carries exactly the generator's anchors; two rooms on one map send the
  same bytes; the fixed `--map` and the practice arena carry none; state hash, content hash and a replay are unmoved.
- `scripts/gate.sh --oracle packet/P-WIRE17-MAP-3 --regen-fixtures` passes (full).
- `node tools/protocol-js/check-map-anchors.mjs` passes (not run by the gate; proposed gate line for the owner, next to
  the patience one: `run "JS map anchors vectors" node tools/protocol-js/check-map-anchors.mjs`).

## Oracle files (read-only for implementers)
- `crates/rh-protocol/tests/map_anchors.rs` (new): the layout by a hand-written builder for five anchors, one, and with
  the patience plane; the server cache bytes and `matches_public`; decode of the pinned bytes; round trip at the caps
  (16 entrance tiles, front 15, centre on the footprint's last tile, a 1 x 1 footprint in the far corner); the semantic
  hash covering the anchors; decoder refusals for count, zone, order, duplicate, kind, footprint, centre, front,
  entrance and truncation; encoder refusals (both paths); the vectors by name. Guards (green today): a map without
  anchors encodes as before (version 2, or version 3 with only the patience bit); existing Welcome vectors carry no
  anchors; presence2 bits 0x04 and 0x80 stay refused.
- `crates/rh-server/tests/map_anchors.rs` (new): a pooled landmark map's blob carries exactly the generator's anchors
  (seeds 1 and 2, against `certified_styled` with the pool's options, mapped by the kind table); two rooms on one map
  send identical Welcome bytes carrying them; 120 steps of state hash, `content_hash` and the replay are unchanged with
  and without the section. Guards (green today): option-off pooled maps, the fixed `--map` and the practice arena carry
  none.
- `client-unity/RoguehallaNet.Tests/MapAnchorsTests.cs` (new): both Welcomes decode to the golden anchors and re-encode
  byte for byte; the seven-argument `WithPublic` recomputes the semantic hash; the refusal vectors exist with their
  reasons; encoder refusals. Guard: existing public Welcomes carry no anchors.
- `tools/protocol-js/check-map-anchors.mjs` (new): the JS `map.anchors` for both Welcomes (exact JSON, key order), `[]`
  for existing ones, every refusal vector.
- this brief.

## Existing tests and vectors this packet changes (owner approval; mechanical)
- Stub commit: `crates/rh-protocol/tests/map_public.rs:294` gains `anchors: Vec::new()` (an exhaustive `MapPublic`
  literal; no assertion changes).
- Implementer: `crates/rh-protocol/tests/map_patience.rs:421` and vector `map17_v3_presence_unknown`'s bytes (F5).
- Red from the stub on, until `v17.json` is regenerated: `crates/rh-protocol/tests/vectors.rs`
  `committed_vectors_match_the_encoder` (the vectors' `debug` text prints `anchors: []`; MAP-2 and HUD-3 precedent).

## Stub notes (to be replaced, not kept)
- `MapPublic.anchors` exists; the codec neither writes, reads nor checks it; literals fill `Vec::new()` (`map.rs`
  decode, `samples.rs` `public_map`, `public_ground.rs` `public_sections`). `ground::PRESENCE2_ANCHORS` is defined but
  unused (`#[allow(dead_code)]`: remove the allow) and not yet in `PRESENCE2_KNOWN`.
- Kept (not a stub): `crates/rh-protocol/src/lib.rs` `ServerMsg` gains `#[allow(clippy::large_enum_variant)]` with its
  reason: the new `Vec` in `MapPublic` lifts the Welcome variant to 475 bytes against 264 for `SnapshotDelta`, just past
  clippy's 200-byte threshold; boxing `MapBlob` would change every caller and test.
- C#: `MapRect`, `MapAnchor`, `MapBlob.Anchors` (always empty), the seven-argument `WithPublic` (ignores the anchors),
  the caps and kind constants. JS: nothing (the probe has no `anchors` key yet).

## 9. Validation commands
- `cargo test -p rh-protocol`, `cargo test -p rh-server --test map_anchors --test dress_bake --test map_patience`
- `node tools/protocol-js/check-vectors.mjs`, `node tools/protocol-js/check-map-anchors.mjs`,
  `node tools/protocol-js/check-map-patience.mjs`
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`

## 10. Risk and suggested model tier
Opus. An older protocol-17 client refuses a map with the new bit, as with the patience plane; the protocol 18 stamp
before the next deploy covers it.

## 11. Known traps
- `room.rs:521`'s cache assertion (F3): a landmark room panics at open unless `matches_public_any_dressing` accepts the
  anchors.
- Truncation (F1): read a row's fixed 16 bytes as one block and test the entrance bytes against what remains, else a
  short section is refused as `"anchor order"` or `"anchor entrance"` from the mode and context-hash bytes after it.
- `MapAssets` keeps its two fields (struct literals in tests).
- The wire kind is the code table, never `FeatureKind as u8`.
- New vectors carry no patience plane (MAP-2 guard).
- JS `anchors` is `[]` when absent, not `null` (as `camps`, unlike the planes).

## Notes from previous attempts
