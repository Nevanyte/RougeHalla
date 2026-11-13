# P-DRESS-BAKE-1: decoration is baked on the server with each map and sent to clients in the map blob

- **Serves:** owner decision 3 (MIGRATION, 2026-11-10: world order = rule-based decoration, identical on every
  client); owner direction 2026-11-12 (decoration arranged round the landmark); plan lane D packet 8
- **Implementer tier:** implementer-opus (cross-crate: rh-server map serving, rh-protocol map blob, C# and JS
  decoders)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (decoration has no legacy counterpart as rules: DEV-021) · wire: the map blob gains
  optional sections; protocol stays 17 until the build that is next deployed (owner approval 9) · no sim change

## 1. ID and outcome
`rh-mapdress` computes a map's decoration from the map alone (`rh_mapdress::dress(map, map_hash, rules) -> Dressing`:
props with a kind code and a tile, and a ground-variant plane; P-DRESS-ENGINE-1, P-DRESS-ANCHOR-1). Nothing uses it:
the Unity client still rolls its own scatter per floor tile (`View/Regions/RegionProps.cs` `Scatter`), which is why
decoration looks random and differs from client to client. When this lands the server dresses every map it serves,
once, when the map is prepared (a pooled map as it is certified; the fixed `--map` at start), with the shipped rules
(`crates/rh-mapdress/rules/zones.json`), and the Welcome's map blob carries the result in two optional sections:
the prop list (kind code, tile x, tile y, in a stated order) and the ground-variant plane (one byte per tile,
run-length coded like the blob's other planes). Every client of a room receives the same bytes. The sim never reads
them: decoration is looks only and stays out of the state hash, the content hash and replays. A map with no
dressing (older tools, tests) encodes exactly as today.

The Unity side (drawing the props and ground variants, removing the client scatter) is P-UNITY-DRESS-1.

## 2. Dependencies
- P-DRESS-ANCHOR-1 merged (in the base). Serial with the other protocol packets (P-WIRE17-HUD-3, P-WIRE17-MAP-2):
  they share `crates/rh-protocol/src/map.rs`, the decoders and `protocol/fixtures/v17.json`.

## 3. Relevant paths
- `crates/rh-mapdress/src/lib.rs` (`Dressing`, `DressProp`, `dress`), `rules.rs` (kind codes: the per-zone blocks and
  their second blocks; `is_tall`), `rules/zones.json`
- `crates/rh-protocol/src/map.rs` (the map blob: planes, optional sections added by P-WIRE17-MAP-1; value checks;
  `terrain_collision_compatible`), `crates/rh-server/src/{map_pool.rs,public_ground.rs,room.rs}` (where a served map
  becomes a blob), `client-unity/RoguehallaNet/Protocol/MapBlob.cs`, `crates/rh-server/web/probe.html`,
  `tools/protocol-js/`, `tools/unity-browser-reload-proof/wire-metadata.js` (it skips the map payload: confirm)

## 5. Exclusive write scope
- `crates/rh-protocol/src/map.rs` and its tests, `crates/rh-protocol/src/samples.rs`, `protocol/fixtures/v17.json`
  (regenerated with `cargo run -p rh-protocol --bin protocol-fixtures`)
- `crates/rh-server/src/{map_pool.rs,public_ground.rs,room.rs,runtime.rs}` and `crates/rh-server/Cargo.toml` only
  to depend on `rh-mapdress` (a workspace crate: `Cargo.lock` changes are the coordinator's: say so in the hand-off)
- `client-unity/RoguehallaNet/Protocol/MapBlob.cs` and its tests, the synced Unity copy; `crates/rh-server/web/probe.html`;
  `tools/protocol-js/**`; `tools/unity-browser-reload-proof/**` only if its parser reads into the map
- Not `crates/rh-sim/`, not `crates/rh-mapdress/` (a missing accessor is named, not added), not Unity scripts

## 6. Contracts and references
- C-OBS: the dressing is a function of the public map: it reveals nothing the map does not. C-RNG: `dress` uses its
  own hash noise seeded from the map hash, never a sim or reward stream.
- The dressing is not gameplay: it must not enter `content_hash`, the state hash, checkpoints or replays, and the
  server must refuse nothing because of it (a rules file that fails to parse is a start-up error with a message,
  not a silent undressed map).
- Frame size: the Welcome with the largest map and the prop cap stays under `MAX_SERVER_FRAME` (256 KiB) with
  headroom: state the measured size and the cap the decoder enforces.

## 7. Behaviour to preserve
- A blob without the new sections encodes and decodes byte for byte as today; every existing vector keeps its
  bytes except those the brief names; the client's map validation still refuses a malformed blob.
- Map preparation stays off the room's tick (the pool certifies maps off-tick: dressing is added there, not in a tick).

## 8. Acceptance checks
- Wire: golden vectors for a map with props and a ground plane, with props only, with neither; refusals: an unknown
  kind code (above the rules' range the decoder is told), a prop outside the map, a prop count over the cap, props
  out of the stated order or duplicated, a ground plane of the wrong length, a variant id over the cap, truncation;
  Rust, C# and JS agree on each.
- Server: two rooms given the same map produce byte-identical blobs; the blob's props equal
  `rh_mapdress::dress` of that map with the shipped rules; a signature map's blob carries the landmark bands'
  ground variants; dressing a map takes under a stated time off-tick (measure it).
- Not gameplay: the state hash of a short headless match is identical with dressing on and off; `content_hash` is
  unchanged; a replay recorded without dressing verifies against a server that dresses.
- `scripts/gate.sh --oracle packet/P-DRESS-BAKE-1` passes (full, with `--regen-fixtures`).

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-DRESS-BAKE-1`

## 9. Validation commands
- `cargo test -p rh-protocol`; `cargo test -p rh-server`; `dotnet test client-unity/RoguehallaNet.Tests`;
  `node tools/protocol-js/check-vectors.mjs`; `node --test tools/unity-browser-reload-proof/*.test.mjs`

## 10. Risk and suggested model tier
Opus. A client built before this packet meets a blob with sections it does not know: say exactly what it does
(refuse, as with the other protocol 17 growth) and that the protocol 18 stamp before the next deploy covers it.

## 11. Known traps
- The oracle author first establishes whether P-WIRE17-MAP-1 already reserved a section id or layout for dressing
  (its brief listed "optional dressing props + ground-variant plane"): reuse it if it exists.
- Prop order is part of the bytes: sort by (y, x, kind) or keep `dress`'s order, and state which.
- The Unity client must not draw both the shipped props and its own scatter: that switch is P-UNITY-DRESS-1; until
  then the client ignores the new sections after validating them.

## Notes from previous attempts
