# P-DRESS-BAKE-1: decoration is baked on the server with each map and sent to clients in the map blob

- **Serves:** owner decision 3 (MIGRATION, 2026-11-10: world order = rule-based decoration, identical on every
  client); owner direction 2026-11-12 (decoration arranged round the landmark); plan lane D packet 8
- **Implementer tier:** implementer-opus (cross-crate: rh-server map serving, rh-protocol map blob, C# and JS
  decoders)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework (b3a8fb516: observation 28, policy contract 22, protocol 17)
- **D-rules touched:** D1 n/a (decoration has no legacy counterpart as rules: DEV-021) · D2 n/a · wire: the map blob's
  two reserved sections gain value checks and start shipping; protocol stays 17 until the build that is next deployed
  (owner approval 9) · no sim change (D5/D6/D9 untouched)
- **Status:** oracle committed on `packet/P-DRESS-BAKE-1` (oracle author, 2026-11-13).

## 1. ID and outcome
`rh-mapdress` computes a map's decoration from the map alone (`rh_mapdress::dress(map, map_hash, rules) -> Dressing`:
props with a kind code and a world position, and a ground-variant plane; P-DRESS-ENGINE-1, P-DRESS-ANCHOR-1). Nothing
uses it: the Unity client still rolls its own scatter per floor tile (`View/Regions/RegionProps.cs` `Scatter`), which is
why decoration looks random and differs from client to client. When this lands the server dresses every map it serves,
once, when the map is prepared (a pooled map as it is certified; the fixed `--map` at start), with the shipped rules
(`crates/rh-mapdress/rules/zones.json`), and the Welcome's map blob carries the result in the two sections P-WIRE17-MAP-1
reserved: the prop list and the ground-variant plane. Every client of a room receives the same bytes. The sim never
reads them: decoration is looks only and stays out of the state hash, the content hash, checkpoints and replays. A map
with no dressing (no layers, older tools, tests) encodes exactly as today.

The Unity side (drawing the props and ground variants, removing the client scatter) is P-UNITY-DRESS-1.

## 2. Dependencies
- P-DRESS-ANCHOR-1 merged (in the base). Serial with the other protocol packets (P-WIRE17-MAP-2): they share
  `crates/rh-protocol/src/map.rs`, `samples.rs`, the decoders and `protocol/fixtures/v17.json`.

## 3. Established facts (oracle author, 2026-11-13; line numbers at b3a8fb516)

1. **The sections exist; this packet reuses them unchanged.** P-WIRE17-MAP-1 reserved presence bit `0x20` props and
   `0x40` ground variants (`crates/rh-protocol/src/ground.rs:33-34`), in wire order after bushes
   (`map.rs:478-485`, `write_public`). Props: `count u16` (1..=`MAX_MAP_PROPS` 8192), then 7-byte rows
   `kind u8, x u16, y u16, variant u8, flags u8`, x and y in WORLD UNITS (`map.rs:19-22, 33-34, 70-78, 465-477`;
   brief `P-WIRE17-MAP-1.md:93-94`). Ground variants: an RLE plane like bushes (`map.rs:87-89`, `write_plane`).
   Both are in the semantic hash (`map.rs:493-521`). The decoders read both today and check only the prop count and
   the plane's runs (`map.rs:789-796`, `MapBlob.cs:467-477, 600-606`, `probe.html:158-168`). `MapProp` mirrors
   `DressProp` field for field (`crates/rh-mapdress/src/lib.rs:36-44`). No new section id, no new layout, no
   `SECTION_VERSION` change; only value checks are added. MAP-1's design note "prop coordinates are not range-checked
   (the protocol does not know the tile size)" (`P-WIRE17-MAP-1.md:168`) is superseded: the tile is 32 world units
   (`rh_mapdress` lib doc, `lib.rs:4-5`; legacy `TILE`).
2. **Prop order, caps, kind range, variant and flags** (the "Wire rules" below). Order: sorted by `(y, x, kind)`
   ascending, strictly (a repeated key is refused); not `dress`'s order, which is stage order
   (`lib.rs:686-723`: legacy, rings, clusters, edges, filler) and cannot be checked by a decoder. Prop cap: the existing
   `MAX_MAP_PROPS` = 8192 (= `rh_mapdress::MAX_PROPS`, which `dress` truncates to). Kind range: protocol constants, not
   a runtime message: rule props `1..=MAX_PROP_KIND` (100: the rules' block scheme, five zones x ten codes x two
   blocks, `crates/rh-mapdress/src/rules.rs:10-13`; the shipped file uses 1..=91), legacy props
   `0..LEGACY_PROP_KINDS` (34: the generator's prop catalogue `rh_sim::mapgen::terrain_gate::DEFAULT_DEFINITION.props`,
   `crates/rh-sim/src/mapgen/terrain_gate/rules.rs:80, 252`; `dress` keeps `GameMapData.props` with `FLAG_LEGACY`,
   `lib.rs:486-498`). A server test ties both to the shipped rules and the catalogue, so a rule file that outgrows them
   fails a test, not a client. `variant` IS sent: it picks the sprite variant (`lib.rs:217`, `0..=3`) and must be the
   same on every client; a legacy prop's variant is the generator's `v` and is not range-checked. `flags` IS sent:
   bit 1 tall (the fade-behind, `FLAG_TALL`), bit 2 legacy (the kind is a catalogue index, not a rule code,
   `FLAG_LEGACY`); any other bit is refused. Ground-variant cap: `MAX_GROUND_VARIANT` = 15 (the rules use 0..=8:
   `rules.rs:17-19`; 15 leaves room inside a nibble). Served maps today carry no legacy props (`StyledMaker` runs
   `decor: false`, `crates/rh-server/src/map_pool.rs:66-73`; the seed-1 fixture has `props: []`).
3. **Size, measured** (release, real Welcome: the server's archetype, weapon and HUD tables, `room.rs:602-622`; 160 x 160
   maps, seeds 1, 2, 3, 77, 12345, shipped rules): option-off Welcome 18,395-19,173 bytes dressed (10,535-11,201
   undressed; 603-636 props, 3.5k non-zero ground cells); landmark-mode Welcome 26,425-31,012 bytes dressed
   (10,298-13,721 undressed; 1,097-1,186 props, 23k non-zero ground cells). Largest measured: 31,012 bytes
   (landmark, seed 12345) against `MAX_SERVER_FRAME` 262,144: 231 KB (88 %) headroom. Worst case on a 160 x 160 map
   at the caps: undressed 13.7 KB + full prop section 57,346 + a ground plane with one run per cell 76,804 = about
   148 KB, still under the frame (the encoder refuses a larger Welcome, `map.rs:287-293`). `dress` itself: 5-6 ms
   per map (release); a debug pool take with generation: about 0.9 s.
4. **Where a served map becomes a blob.** `MapAssets::new(arena)` (`crates/rh-server/src/room.rs:331-341`) calls
   `public_ground::encode_static_map` (`public_ground.rs:133-138`). Pooled maps: the worker thread runs
   `StyledMaker::make` (`map_pool.rs:75-101`), which has the `GameMapData` (with `anchors`) and its hash, then converts
   to an `Arena` and loses the anchors (`rh-sim/src/mapdata/model.rs:316-318`: anchors stay off `LayerData`; "the
   decoration bake reads them from the generator's map at pool-build time"); `admit` (`map_pool.rs:104-115`) builds
   the `MapAssets` on the supervisor thread (`arrive`) or, in the test-only inline mode, on the taker
   (`map_pool.rs:377-399`). Fixed `--map`: `runtime::Settings::arena` / `source_map` (`runtime.rs:248-271`) at
   start-up, then `Director::new` builds `MapAssets::new(cfg.arena)` once (`director.rs:525`) and the pool's
   configured map in `main.rs:962`. A room only clones the `Arc`s (`director.rs:965-985`, `room.rs:322-329`). All of
   these are off the room's tick: the room task never encodes a map. Hence the dressing goes where `MapAssets` is
   built: pooled maps dress from the generator's `GameMapData` (worker or supervisor thread), the fixed map at
   `MapAssets::new` (its export has no anchors today: seed-1 and first-playable carry none).
5. **An older client and the new sections.** A client built since P-WIRE17-MAP-1 (merge b23051004) already decodes
   both sections with no value checks (`MapBlob.cs:418-419`, `probe.html:560`): it accepts a dressed blob and ignores
   it (no Unity script reads `MapBlob.Props` or `GroundVariants`; `RegionProps.cs` keeps its scatter until
   P-UNITY-DRESS-1). A client built before P-WIRE17-MAP-1 refuses the Welcome on the presence bits (`"presence"`), as
   with the other protocol 17 growth. Both are covered by the protocol 18 stamp before the next deploy (owner
   approval 9). The new checks only make new clients stricter; the old server never sends props.

## 4. Wire rules (the decoder's order per prop row; Rust, C# and JS identical)

Constants (`crates/rh-protocol/src/map.rs`, stub commit; C# `MapBlob`, JS `probe.html` mirror them):
`PROP_FLAG_TALL = 1`, `PROP_FLAG_LEGACY = 2`, `MAX_PROP_KIND = 100`, `LEGACY_PROP_KINDS = 34`, `MAX_PROP_VARIANT = 3`,
`MAX_GROUND_VARIANT = 15`, existing `MAX_MAP_PROPS = 8192`.

Props section, after the existing count check (`"prop count"`) and the row bytes (`Truncated`), for each row in order:
1. `flags & !(TALL | LEGACY) != 0` -> `"prop flags"`;
2. rule prop (no LEGACY): `kind == 0 || kind > MAX_PROP_KIND`; legacy prop: `kind >= LEGACY_PROP_KINDS` ->
   `"prop kind"`;
3. rule prop: `variant > MAX_PROP_VARIANT` -> `"prop variant"` (a legacy prop's variant is not checked);
4. `x / 32 >= w || y / 32 >= h` (integer division, i.e. `x >= 32 w`) -> `"prop tile"`;
5. the row's `(y, x, kind)` is not strictly greater than the previous row's -> `"prop order"` (covers duplicates).

Ground-variant plane: the existing run checks (`"run"`, short `"length"`, `Truncated`), then any cell value
`> MAX_GROUND_VARIANT` -> `"ground variant"`. As today, every value check runs in the preflight before the semantic and
context hash checks.

Encoder (`check_public`, `EncodedMap::from_public`, C# `CheckPublic`): the same checks with the same reasons as
`EncodeError::BadMap` / `EncodeException`; the count check stays first (the existing
`attach(|p| p.props = vec![p.props[0]; MAX_MAP_PROPS + 1])` must stay `"prop count"`); a ground plane of the wrong
length stays `"plane length"`. The encoder never sorts or drops: an unsorted list is an error.

## 5. Server rules

- Rules: `runtime::DRESS_RULES_JSON` (the embedded `zones.json`, stub) parsed by `runtime::dress_rules(text)`, which
  returns `Err` with a message containing `"dressing rules"` and the parser's reason (`rh_mapdress` prefixes
  `"rule file"`). The start-up path parses them before any map is prepared and exits with that message
  (e.g. `Settings::arena`, which `main.rs:863-866` already turns into `exit(2)`); the parsed rules are shared (a
  `OnceLock` or passed in), never re-parsed per map. A rules failure is never an undressed map.
- Dressing of a map: `rh_mapdress::dress(&game_map_data, u64::from(legacy_map_hash_u32), &rules)`; `StyledMaker` sets
  `legacy_map_hash_u32` from `map_hash::map_hash` (`map_pool.rs:87-88`), a fixed map carries its own.
- Wire form: every `DressProp` as a `MapProp` (same five fields), sorted by `(y, x, kind)`, absent when empty; the
  ground plane as is when any cell is non-zero, else absent. A map without layers (practice arena) has no dressing and
  encodes exactly as today.
- `public_ground::encode_static_map(map)` stays undressed (its test `public_ground.rs:269-271` asserts the reserved
  sections ship absent; it is a test of that function, unchanged). `MapAssets::new(arena)` dresses (the fixed map and
  every existing caller); pooled maps dress from the generator's map (anchors included) so landmark bands reach the
  wire. `public_ground::matches_static_map(&assets.welcome_map, &arena.map)` must stay true for a dressed blob of that
  map and for an undressed one (`room.rs:505` asserts it in `Room::new`; `room/ground_tests.rs:60, 83-90, 116-120`,
  `map_pool/tests.rs:225` assert it) and false for a different map, e.g. by comparing everything but the two dressing
  sections, which must themselves pass the wire rules. `RoomConfig` gains no field (it is built by struct literal in many existing tests).
- Nothing here runs on the tick; `dress` runs where the `MapAssets` is built.

## 6. Exclusive write scope
- `crates/rh-protocol/src/map.rs` and its tests, `crates/rh-protocol/src/samples.rs`, `protocol/fixtures/v17.json`
  (regenerated with `cargo run -p rh-protocol --bin protocol-fixtures`)
- `crates/rh-server/src/{map_pool.rs,public_ground.rs,room.rs,runtime.rs}`; `crates/rh-server/Cargo.toml` (the
  `rh-mapdress` dependency is in the stub commit; the matching `Cargo.lock` line is the coordinator's)
- `client-unity/RoguehallaNet/Protocol/MapBlob.cs`, the synced Unity copy (`bash client-unity/sync-net.sh`);
  `crates/rh-server/web/probe.html`; `tools/protocol-js/**` except the oracle file below
- `tools/unity-browser-reload-proof/**`: not needed (`wire-metadata.js:169-190` bounds the sections by count only)
- **Proposed for the coordinator** (outside the brief's scope as written): `crates/rh-protocol/tests/map_public.rs`
  lines 693-706 (see section 7); `crates/rh-server/src/main.rs` only if the start-up rules check is not routed through
  `Settings::arena`; `crates/rh-server/src/map_pool/tests.rs` is not expected to change.
- Not `crates/rh-sim/`, not `crates/rh-mapdress/` (no accessor is missing: `Rules::starter`, `Rules::from_json`,
  `dress`, `FLAG_TALL`, `FLAG_LEGACY`, `MAX_PROPS` and the rule structs are public), not Unity scripts.

## 7. Behaviour to preserve
- Every existing vector keeps its bytes (`welcome`, `welcome_public_shipped`, `welcome_public_all`,
  `welcome_ground_both` are pinned by digest in the oracle; `welcome_public_all`'s two props are already sorted and in
  range). The client's map validation still refuses a malformed blob.
- **One existing test must change (owner/coordinator approval):** `crates/rh-protocol/tests/map_public.rs:693-706`
  (`prop_count_over_the_cap_is_refused`) decodes 8192 props at `x = 0..8191`, `y = 0` on the 8 x 6 sample map and
  expects them accepted; under the tile rule every prop from `x = 256` on is outside the map (`"prop tile"`). Proposed
  edit (lines 694-700 only): `x: (i % 256) as u16, y: (i / 256) as u16` (32 rows of 256 world units, inside the
  8 x 6 map, already in `(y, x, kind)` order). Lines 707-722 (the over-cap and zero-count refusals) are unchanged. No
  other existing Rust, C# or JS test changes.
- Map preparation stays off the room's tick; the state hash, `content_hash`, checkpoints and replays do not see the
  dressing.

## 8. Acceptance checks
- Wire, Rust (`crates/rh-protocol/tests/map_dressing.rs`): new server vectors `welcome_dress_props_ground` and
  `welcome_dress_props_only` (8 x 6 map; the props and plane below), new `malformedMap` vectors (names, frames and
  reasons below); encoder and decoder refusals; boundary acceptance; existing Welcomes keep their bytes.
- Wire, C# (`client-unity/RoguehallaNet.Tests/MapDressingTests.cs`) and JS (`tools/protocol-js/check-dressing.mjs`):
  the same vectors and reasons. The existing harnesses also pick the new vectors up from `v17.json` with no edit:
  C# `MapBlobPublicTests.EveryWelcomeVectorDecodesItsPublicSections` and `MalformedMapIsRefusedForTheRustReason`
  (every `server` Welcome and every `malformedMap` entry), JS `check-vectors.mjs:490-510` (every Welcome's props and
  ground plane) and `:673-679` (every `malformedMap` entry, reason matched at the end of the message).
- Server (`crates/rh-server/tests/dress_bake.rs`): a pooled map's blob (option off and landmark mode) carries `dress`
  of that map in wire form; the fixed `--map` (seed-1 export) too, the practice arena nothing; a landmark map's plane
  carries every landmark-band ground variant the rules declare and an option-off map none; two preparations of one seed
  and two rooms on them send byte-identical blobs; a broken rules text is an error naming the dressing rules; the wire
  caps cover the shipped rules.
- Not gameplay: a dressed and an undressed room on the seed-1 map, same fixed secrets and bot seed, have equal state
  hashes for 120 steps, the same `content_hash` in the Welcome, equal replay hashes and arenas; the undressed replay
  verifies on this build (`run_replay`).
- `scripts/gate.sh --oracle packet/P-DRESS-BAKE-1` passes (full, with `--regen-fixtures`).

### Vectors the implementer adds (`samples.rs`, then regenerate)
- `server_samples()`: `welcome_dress_props_ground` and `welcome_dress_props_only`, each `welcome_map_msg` of an 8 x 6
  map (any valid tiles and other sections) whose `public.props` are, in this order,
  `(kind, x, y, variant, flags)`: `(41, 48, 40, 0, 1)`, `(3, 100, 60, 2, 0)`, `(3, 101, 60, 3, 0)`, `(7, 101, 60, 0, 0)`,
  `(33, 16, 176, 200, 2)`, `(100, 255, 191, 1, 1)`; the first with `ground_variants = Some((0..48).map(|i| i % 16))`,
  the second with `None`.
- `malformed_map()`: on the 4 x 3 raw map with `welcome_public_raw(2, flags, sections, false)`, one prop row
  `(kind, x, y, variant, flags)` each unless stated, section `raw_list(count u16 + rows)`:
  `map17_dress_prop_kind_zero` `(0,16,16,0,0)` "prop kind"; `map17_dress_prop_kind_over` `(101,16,16,0,0)` "prop kind";
  `map17_dress_legacy_kind_over` `(34,16,16,0,2)` "prop kind"; `map17_dress_prop_flags` `(1,16,16,0,4)` "prop flags";
  `map17_dress_prop_variant` `(1,16,16,4,0)` "prop variant"; `map17_dress_prop_x_outside` `(1,128,16,0,0)` "prop tile";
  `map17_dress_prop_y_outside` `(1,16,96,0,0)` "prop tile"; `map17_dress_prop_order` rows `(1,16,48,0,0), (1,16,16,0,0)`
  "prop order"; `map17_dress_prop_duplicate` rows `(1,16,16,0,0)` twice "prop order"; `map17_dress_props_truncated`
  count 2 with only `(1,16,16,0,0)` "truncated"; `map17_dress_ground_over` flags `0x40`, `raw_plane` of 12 cells of 16
  "ground variant"; `map17_dress_ground_long` flags `0x40`, `raw_plane` of 13 cells of 1 "run". The Rust oracle
  compares each frame byte for byte with its own builder (checked against `map17_prop_count_zero`).

## Oracle files (read-only for implementers)
- `crates/rh-protocol/tests/map_dressing.rs`
- `crates/rh-server/tests/dress_bake.rs`
- `client-unity/RoguehallaNet.Tests/MapDressingTests.cs`
- `tools/protocol-js/check-dressing.mjs` (not run by the gate: `scripts/gate.sh:174-175` runs only `check-vectors.mjs`
  and `check-first-playable.mjs`; the new vectors still reach the JS decoder through `check-vectors.mjs`. Proposed
  gate line for the owner: `run "JS dressing vectors" node tools/protocol-js/check-dressing.mjs`.)
- `docs/backlog/packets/P-DRESS-BAKE-1.md`

Stub commit (the implementer's to edit): the six constants in `crates/rh-protocol/src/map.rs`;
`runtime::DRESS_RULES_JSON` and the `runtime::dress_rules` stub (returns the starter rules, ignoring its text);
the `rh-mapdress` dependency in `crates/rh-server/Cargo.toml`.

Red at the oracle commit (each on an assertion): Rust `the_decoder_refuses_out_of_range_dressing_for_its_reason`,
`the_encoder_refuses_what_the_decoder_refuses`, `the_vectors_carry_a_map_with_props_and_a_ground_plane`,
`the_vectors_carry_a_map_with_props_only`, `the_vectors_carry_every_dressing_refusal`; server
`a_pooled_map_s_blob_carries_dress_of_that_map_with_the_shipped_rules`,
`the_fixed_map_is_dressed_and_a_map_without_layers_is_not`,
`a_landmark_map_s_blob_carries_the_landmark_bands_ground_variants`, `two_rooms_given_the_same_map_send_byte_identical_blobs`,
`dressing_changes_no_state_hash_no_content_hash_and_no_replay`, `dressing_rules_that_fail_to_parse_are_a_start_up_error`;
C# the three `TheVectorsCarry*` tests and the eleven `Dressing_*` encoder cases; JS `check-dressing.mjs`. Green guards:
the caps, boundary acceptance, round trip, builder self-check, pinned existing Welcomes,
`the_wire_caps_cover_the_shipped_rules`, `TheEncoderAcceptsDressingOnEveryBoundary`.

## 9. Validation commands
- `cargo test -p rh-protocol`; `cargo test -p rh-server`; `dotnet test client-unity/RoguehallaNet.Tests`;
  `node tools/protocol-js/check-vectors.mjs`; `node tools/protocol-js/check-dressing.mjs`;
  `node --test tools/unity-browser-reload-proof/*.test.mjs`; `bash client-unity/sync-net.sh --check`

## 10. Risk and suggested model tier
Opus: three decoders, an encoder, the fixture generator and the server's map preparation move together. The hard parts
are keeping `matches_static_map` (and `Room::new`'s assertion) strict for undressed and dressed blobs alike, and
carrying the generator's map (with anchors) from `StyledMaker::make` to where the pool builds `MapAssets` without
changing the `MapMaker` contract the pool's tests implement (`map_pool/tests.rs:16-27`: a default method or a second
maker path keeps them compiling).

## 11. Known traps
- Prop order is part of the bytes: sort `(y, x, kind)` after `dress`; `dress` itself returns stage order.
- `dress`'s map hash must be the export's `legacy_map_hash_u32` widened to u64 (the same number `order_tests.rs`
  derives from `map_hash::map_hash`); any other seed changes every prop.
- Dress the pooled map before `into_arena`: the arena drops `anchors` and a landmark map would then be dressed by the
  fallback rings (the landmark test catches it).
- The tile is 32 world units: `x / 32 < w`. A prop at `x = 32 w - 1` is inside.
- Keep value checks before the semantic hash check, so a refusal names the fault.
- The land-generation session owns `crates/rh-mapdress/**` and may change rules and kind codes within their blocks; the
  oracle compares with `dress` and the rules' own values, so a rules change never needs an oracle edit unless a code
  leaves `1..=100` or a ground variant passes 15 (then `the_wire_caps_cover_the_shipped_rules` fails first, by design).
- The Unity client must not draw both the shipped props and its own scatter: that switch is P-UNITY-DRESS-1; until
  then the client ignores the new sections after validating them.

## Notes from previous attempts
