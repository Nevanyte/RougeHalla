# P-WIRE17-MAP-2: protocol 17 carries the camp patience plane and the quest carrier's actor id

- **Serves:** owner direction 2026-11-10 (MIGRATION checkpoint, decision 7: the HUD presents what legacy presents);
  `docs/rework/LEGACY_INDICATORS.md` rows W11 (blocked by B16) and W7 (blocked by B14); findings of the oracle author of
  P-UNITY-WORLD-MARKS-1 ("Moved to a wire packet" in that brief)
- **Implementer tier:** implementer-opus (wire format, map blob, observation, cross-crate)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework (bf5b3cfa4; P-WIRE17-HUD-3 and P-DRESS-BAKE-1 merged: observation 28, policy
  contract 22, protocol 17)
- **D-rules touched:** D1 loose proof (one legacy tile-count check, below) plus golden vectors for the wire; D2 n/a;
  D5/D6/D9 none

## 1. ID and outcome
Two legacy world marks cannot be drawn because their facts are not sent.
- **Patience range (W11):** legacy outlines, for every living camp, the tiles of the camp's territory from which its mobs
  still chase. The map blob gains a **patience plane**: one byte per tile, 0 or the 1-based index of the camp whose
  patience range covers the tile, computed once per map by the server with the sim's own leash rule, run-length encoded
  like the other planes. It is public map data (legacy clients computed it from the map) and the same for every viewer.
- **Quest carrier (W7):** the quest row names its carrier by a view-local roster id the client cannot map to a fighter.
  The row gains the carrier's **public actor id**, present only while the viewer is delivered that fighter (C-OBS).
Still protocol 17, `v17.json` regenerated; the C# client exposes both (`MapBlob.Patience`, `QuestRowView.CarrierActor`).
Drawing them is `P-UNITY-WORLD-MARKS-2`.

## 2. Dependencies
- P-WIRE17-HUD-3 and P-DRESS-BAKE-1 merged (same decoders and fixtures; this packet is strictly serial with any packet
  touching `map.rs`, `state.rs`, `samples.rs`, `probe.html`, `observe.rs`/`quest_view`, `v17.json`).

## 3. Established facts (oracle author, with sources)

### Legacy
- `packages/client/src/render/CampPatience.ts:18-33` `campPatienceOutline(map, i)`: null when `camp.area <= 0` or no
  spots; else tile `(tx, ty)` is inside when `map.territoryGrid[i] === i + 1` **and** some spot `home` of the camp has
  `leashOk(map, i + 1, home, tileCentre)`, tile centre `((tx + 0.5) * TILE, (ty + 0.5) * TILE)`.
  `:88-98`: drawn only while the camp has living mobs (`camps[i].alive > 0`) and the phase is active: a client rule;
  the alive count is already on the wire (`WireCamp`), so the plane is static.
- `packages/shared/src/mobs.ts:230-262`: `territoryAt`, `territoryLeash` (`min(camp.radius, MOB_LEASH_CAP)` when the camp
  exists, has `area > 0` and holds the home; else 0), `leashOk` (reach 0: circle of `MOB_LEASH_RADIUS`; else distance
  `<= reach - margin` and the point on the camp's territory, plus the four margin probes).
  `packages/shared/src/constants.ts:539,541`: `MOB_LEASH_RADIUS = MOB_LEASH_CAP = 24 * TILE`.
- **No overlap:** the outline is a subset of the camp's own territory cells, and `territoryGrid` holds one camp per
  tile, so two camps can never claim one tile. One byte per tile is exact (known trap 11 answered: no bit planes).
  Legacy run on seed 1 (scratch, below): overlap 0.
- `packages/client/src/render/QuestView.ts:68-76`: the carrier flag is drawn at `frame.positions.get(quest.carrier)`,
  the client's rendered actors (`RaidScene.ts:297,614,734`): the local player included, unrendered (unseen) actors not.
  So: present for the viewer itself and for delivered fighters, absent otherwise.

### Loose proof numbers (legacy's own code, not a capture)
`tsx` (main checkout's `node_modules`, Node 25.8.1) running legacy `leashOk` from `packages/shared/src/mobs.ts` on
`crates/rh-sim/src/mapdata/fixtures/seed1.map.json` (map hash 3499839449, the legacy generator's seed-1 map): camp 0
covers **652** tiles, all 50 camps **24 669**, overlap 0, camp 0's centre tile (28, 46) carries 1; the plane is 1 573
runs (4 723 bytes RLE; the seed-1 Welcome stays far under `MAX_SERVER_FRAME`). The Rust test transcription of the same
rule reproduces 24 669 exactly. Tolerance in the test: 5%.

### Rust: the leash rule and the plane
- The sim's leash is `crates/rh-sim/src/systems/mob_ai.rs:18-57` (`territory`, `leash`), private and taking
  `&MatchStatic`. No public accessor computed "the tiles from which camp i's mobs still chase". The stub adds
  `crates/rh-sim/src/mapdata/patience.rs`:
  `pub fn leash_ok(data: &LayerData, camp: u32, home: Vec2, p: Vec2, margin: f64) -> bool` (camp 0-based) and
  `pub fn patience_plane(data: &LayerData) -> Vec<u8>`. The implementer moves the rule's body into `leash_ok` and makes
  `mob_ai::leash` call it (`layers()` present: `leash_ok(l.data(), ...)`; absent: the `MOB_LEASH_RADIUS` circle, as
  today), so the sim and the plane share one rule. Float order must stay identical (`crate::math::hypot`,
  `reach - margin`): parity and state hashes must not move.
- The map blob's public sections are assembled in `crates/rh-server/src/public_ground.rs:63-128`
  (`public_sections(&LayerData)`); `encode_dressed_map`/`matches_static_map` go through it, so filling `patience` there
  covers the Welcome and the cache. Ship `None` when no tile is covered (a map without layers, camps or territory: the
  version-2 blob, unchanged).
- `content_hash` (`crates/rh-sim/src/content.rs:454-470`) covers content and the generator definition, not per-map
  sections: it does not move. The plane enters the map's semantic and context hashes (as every section does).

### Rust: the map blob
- Presence bits (`crates/rh-protocol/src/ground.rs:28-36`): 0x01 terrain, 0x02 regions, 0x04 camps, 0x08 coliseum,
  0x10 bushes, 0x20 props, 0x40 ground variants (P-DRESS-BAKE-1's value checks); `PRESENCE_KNOWN = 0x7f`. No reservation
  exists for a patience plane; 0x80 is the last free bit and is pinned **refused** by `map17_presence_unknown`
  (`samples.rs:3538`), `map_ext_presence` (`samples.rs:5332`), `crates/rh-protocol/tests/map_public.rs:536-545`, C#
  `MapBlobPublicTests.cs:144` and JS `check-vectors.mjs:679,768,884`. Using it would change those tests' meaning and
  leave no unknown bit. **Decision: section version 3** with a second presence byte (below). Every existing vector,
  test and version-2 blob is untouched.

### Rust: the quest row
- State key **10** (`StateItem::Quests`, `crates/rh-protocol/src/state.rs:1940`), record `available u8` then
  `WireQuestView` (`state.rs:1628-1645`). Row layout (`state.rs:1717-1741`): `handle varint, def str, giver f64 x2,
  state u8, expires_at f64, participants (varint count; id varint, accepted u8, progress varint, visited u8),
  carrier varint (0 none), done_by opt str, flags u8 (0x01 can_accept, 0x02 owner_accepted, 0x04 owner_completed,
  0x08 owner_ready; others "quest flags"), owner_progress varint, owner_visited u8, name, giver_label, brief, objective,
  reward (str)`.
- The roster id is view-local: `crates/rh-sim/src/quest_view/mod.rs:211-243` (`QuestObserver::stage` sorts the published
  rows' people by name, assigns `RosterId`s from the observer's counter); the carrier's at `:351-357`. The stage keeps
  `PlayerId -> RosterId` (`Committed.roster`).
- The quest view is staged in `crates/rh-sim/src/item_view.rs:462` and attached at `:496-498`, **before** the actor
  projection at `:534-542`. The snapshot's actors are `Observation::visible` (`crates/rh-sim/src/observe.rs:1040-1118`:
  other players by `actor_with` sight/trail/wards, the viewer excluded; mobs by `point_visible`/tile cache, hidden
  statuses excluded), then `actor_refs::project` (`crates/rh-sim/src/actor_refs.rs:7-36`): a player keeps its own
  `PlayerId` as public id (`:247-255`), unmapped actors are dropped. The delivery projection copies `visible` into the
  snapshot (`crates/rh-policy/src/delivery/session.rs:63`, `projection.rs:38`).
- **Rule:** `carrier_actor = Some(c)` exactly when the row's carrier `c` is the viewer, or `c` is in `out.visible` after
  the projection (its id there); else `None`. Fill it in `item_view` after `actor_refs::project` (the stage's roster map
  resolves the roster id). Bots and unseated viewers have no quest view (`item_view.rs:496`), unchanged.
- Key 10 is re-sent when it changes (`crates/rh-policy/src/delivery/collections.rs:729`): it is now re-sent when the
  carrier enters or leaves sight. Intended (the same fact as the snapshot's actor list); the extra traffic is one key-10
  record per transition.

### Older clients
A protocol-17 client built before this packet refuses every Welcome whose map has camps with territory (section
version 3: `BadMap("section version")`, a refused Welcome, no play) and every key-10 record with a visible carrier
(`BadField("quest flags")`). Version-2 maps and rows without a carrier actor decode as before. `PROTOCOL_VERSION` stays 17
on the coordinator's instruction (HUD-3 precedent: owner approved stamping 18 on the next deployed build). **Flag:**
AGENTS.md says bump when incompatible; this is incompatible for a stale 17 client. Admission compares protocol and
content hash only, so a stale web build would join and then fail to decode: the coordinator decides with the owner.

## 4. Wire layout (decided; the tests pin it)

### Map extension
- Without a plane: version 2, byte for byte as today.
- With a plane: `ext_len u32 | version u8 = 3 | presence u8 (as v2) | presence2 u8 | semantic_hash u32 | the v2
  sections in presence-bit order | patience plane (presence2 0x01: u32 run count, [value u8, len u16 LE] runs, maximal
  runs as every plane) | terrain_mode u8 | context_hash u32`.
- presence2: 0x01 patience; any other bit `"presence"`; version 3 with presence2 0 is `"presence"` (one encoding per
  map: no plane means version 2). Version 1 and 4+ `"section version"`.
- Semantic hash: as v2 but over `[3, presence, presence2]` and, after the ground-variant cells, the plane's decoded
  cells. Context hash unchanged in form.
- Value rule: each cell `<= camps.len()` (0 when the camps section is absent) else `"patience camp"`, encoder
  (`with_public`, `EncodedMap::from_public`, C# `WithPublic`) and decoder alike. Plane length: encoder
  `"plane length"`, decoder `"length"` (short) / `"run"` (long) as other planes. A run count past the extension:
  `Truncated`. All-zero planes are legal present data; the server never sends one.
- Bounds: `decoded_bytes`/`MAX_DECODED_PLANES` and `MAX_CUMULATIVE_RUNS` grow from 5 to 6 planes;
  `matches_public`/`matches_public_any_dressing` read the 7-byte v3 header.
- `MapPublic.patience: Option<Vec<u8>>` (stub). JS: `map.patience` (`Uint8Array` or `null`). C#: `MapBlob.Patience`,
  `WithPublic(camps, coliseum, bushes, props, groundVariants, patience)` (stub overload).

### Quest row
- Flag 0x10 = carrier actor present; then a varint actor id right after the flags byte, before `owner_progress`.
- Decoder: flag 0x10 with carrier 0 is `BadField("quest flags")` (so the existing `state_quest_flags_unknown`
  vector, flags 0x10 with carrier 0, keeps its reason in all three decoders); actor 0 is
  `BadField("quest carrier actor")`; 0x20..0x80 stay `"quest flags"`.
- Encoder (`WireQuestView::check`): `carrier_actor` without `carrier`, or `Some(0)`: `BadValue("quest carrier actor")`.
- `WireQuestRow.carrier_actor: Option<u32>`; JS key `carrierActor` immediately after `carrier` (check-vectors.mjs
  compares State JSON exactly, key order included; the Rust vector JSON writer at `samples.rs:7278` must match); C#
  `WireQuestRow.CarrierActor` (`uint?`), message `"quest carrier actor"`, JS message `"bad quest carrier actor"`.

### Golden vectors the implementer adds to `crates/rh-protocol/src/samples.rs` (then regenerates `v17.json`)
- server `welcome_public_patience`: `welcome_map_msg` of `public_map(true)` plus `patience` cell `i` = `i % 4`
  (8 x 6, three camps).
- server `state_quests_carrier_visible`: one State (key 10) whose first row has carrier roster 7 and
  `carrier_actor` 5; `state_quests_carrier_hidden`: carrier roster 7, no actor. "No carrier": the existing
  `state_quests_available` (unchanged bytes). E.g. `quest_view_sample()` with those two fields set.
- malformedMap (reason): `map17_patience_camp_over` ("patience camp", a cell past the camp count),
  `map17_patience_without_camps` ("patience camp"), `map17_patience_length` ("length"), `map17_patience_truncated`
  ("truncated": a run count past the extension), `map17_v3_presence_empty` ("presence"), `map17_v3_presence_unknown`
  ("presence"). These are picked up on their own by `map_public_samples::every_malformed_map_is_refused_for_its_reason`
  (Rust), `MapBlobPublicTests.MalformedMapIsRefusedForTheRustReason` (C#) and `check-vectors.mjs:672-678` (JS); the JS
  "presence" mapping there expects `/ground presence$/`.
- No new malformedServer vectors (each would need arms in `tests/vectors.rs`, `ProtocolVectorTests.cs` and
  `check-vectors.mjs`); the quest refusals are pinned by hand-built frames in all three languages instead.
- Every existing vector keeps its bytes. `committed_vectors_match_the_encoder` goes red until `v17.json` is regenerated
  (the stub's `debug` text prints the new fields).

## 5. Exclusive write scope
- `crates/rh-protocol/src/{map.rs, ground.rs, state.rs, samples.rs}`; `protocol/fixtures/v17.json` (regenerated only:
  `cargo run -p rh-protocol --bin protocol-fixtures`)
- `crates/rh-sim/src/mapdata/patience.rs` (replace the stub), `crates/rh-sim/src/systems/mob_ai.rs` (`leash` delegates),
  `crates/rh-sim/src/quest_view/mod.rs` (field and stub note only), `crates/rh-sim/src/item_view.rs` (fill
  `carrier_actor`), `crates/rh-sim/src/observe.rs` (`OBSERVATION_VERSION` only)
- `crates/rh-server/src/public_ground.rs` (fill the plane by calling `patience_plane`)
- `crates/rh-policy/src/delivery/collections.rs` (project the field), `crates/rh-policy/src/lib.rs`
  (`POLICY_CONTRACT_VERSION` and its doc and pin at `:1896`)
- identity pins, 28 -> 29 and 22 -> 23, pin lines only: `crates/rh-sim/src/reward_chests/trophy_observer_tests.rs:259`,
  `crates/rh-sim/src/observe/panel_tests.rs:472`, `panel_tooltip_tests.rs:322`, `hud_clock_tests.rs:224`,
  `crates/rh-policy/tests/{hud_delivery.rs:80,85, hud_panel_delivery.rs:65,70, hud_roam_terms.rs:47,52,
  hud_clock_delivery.rs:73,78}` (owner approval: existing tests, mechanical; HUD-3 precedent)
- `client-unity/RoguehallaNet/Protocol/{MapBlob.cs, State.cs}`, `client-unity/RoguehallaNet/Net/Collections.cs`, then
  `bash client-unity/sync-net.sh` (synced copies under `client-unity/UnityProject/Assets/RoguehallaNet/`)
- `crates/rh-server/web/probe.html` (JS decoder)
- If red after regeneration only: `protocol/fixtures/scene-candidate/{full14,client14}.json` by their documented
  commands (HUD-3 brief, "New paths"); expected unchanged (their key-10 rows carry no visible carrier).
- Not in scope: `crates/rh-mapdress/`, `crates/rh-sim/src/mapgen/`, Unity UI, bots.

## 6. Contracts and references
- C-OBS: the actor id only for the viewer itself or a delivered actor (`carrier_actor_tests.rs`); the plane derives from
  the map alone (same bytes for every viewer, `crates/rh-server/tests/map_patience.rs`).
- C-NET / ADR 0011: Rust, C# and JS decoders in one branch; refusals, not clamps.
- C-TICK / C-PARITY: `mob_ai::leash` keeps its float order; no schedule row, RNG draw or state-hash change.

## 7. Behaviour to preserve
- Every existing vector keeps its bytes and its reason; version-2 blobs are unchanged; parity report and replays green.
- Rows without a carrier actor are byte-identical; `state_quest_flags_unknown` keeps "quest flags".

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-WIRE17-MAP-2 --regen-fixtures` passes (full), except
  `abilities::source_tests::hash_tape::ability_hash_tape_matches_the_base` until the coordinator regenerates
  `parity/abilities/hash-tape.json` (it pins `observationVersion`; red after the bump is **expected**, not a defect).
- `node tools/protocol-js/check-map-patience.mjs` passes (not run by the gate; proposed gate line for the owner after
  `scripts/gate.sh:175`: `run "JS patience and carrier vectors" node tools/protocol-js/check-map-patience.mjs`).

## Identities
- Move: `OBSERVATION_VERSION` 28 -> 29 (`crates/rh-sim/src/observe.rs:20`: `QuestRow` gains `carrier_actor`);
  `POLICY_CONTRACT_VERSION` 22 -> 23 (`crates/rh-policy/src/lib.rs:50`; the projected quest row carries it); pins above.
- Do not move: `PROTOCOL_VERSION` 17, `CHECKPOINT_FORMAT`, `REPLAY_FORMAT`, `content_hash` (no content change; the map
  blob is not in it), `MAX_STATE_KEYS`.
- SHARED RECORDS (coordinator): `parity/abilities/hash-tape.json:261` `observationVersion` 28 -> 29
  (`cargo test -p rh-sim --features trusted-status-probes --lib record_ability_hash_tape -- --ignored`); MIGRATION
  identities observation 29, policy contract 23; the gate line above.

## Oracle files (read-only for implementers)
- `crates/rh-protocol/tests/map_patience.rs` (new): v3 layout by a hand-written builder, round trip, cache bytes,
  semantic hash, decoder and encoder refusals, the vectors by name; guards for version 2.
- `crates/rh-protocol/tests/quest_carrier_wire.rs` (new): row layout, decoder and encoder refusals, the vectors by
  name; guards for unchanged rows and `state_quest_flags_unknown`.
- `crates/rh-sim/tests/patience_plane.rs` (new): the plane equals legacy's rule (transcribed, reading the JSON) tile by
  tile on seed 1; the loose proof (652 / 24 669 within 5%); camp 0's centre carries 1 and its range stays within the
  cap; `leash_ok` equals legacy `leashOk` on 100 sampled tiles at margins 0 and 20.
- `crates/rh-sim/src/quest_view/carrier_actor_tests.rs` (new; mod line in the stub): another seat gets the id only
  while it sees the carrier; the carrier gets its own id; no carrier no id; unseated viewer no quests; dead viewer no
  leak.
- `crates/rh-server/tests/map_patience.rs` (new): the seed-1 Welcome carries `patience_plane(data)`; same for every
  viewer; no layers or no covered camp, no plane.
- `crates/rh-policy/tests/quest_carrier_delivery.rs` (new): identities 29/23; the projection copies the actor id; key
  10 re-sent alone when only it changes.
- `client-unity/RoguehallaNet.Tests/MapPatienceTests.cs`, `client-unity/RoguehallaNet.Tests/QuestCarrierProtocolTests.cs`
  (new).
- `tools/protocol-js/check-map-patience.mjs` (new).
- this brief.

## Existing tests this packet changes (owner approval; mechanical)
- Stub commit: `crates/rh-protocol/tests/quest_bridge.rs:31` gains `carrier_actor: None` and
  `crates/rh-protocol/tests/map_public.rs:293` gains `patience: None` (struct literals; no assertion changes).
- Implementer: the identity pins listed in section 5.
- Red from the stub on, until `v17.json` is regenerated: `crates/rh-protocol/tests/vectors.rs`
  `committed_vectors_match_the_encoder` (the vectors' `debug` text prints the new fields; HUD-3 precedent).

## Stub notes (to be replaced, not kept)
- `MapPublic.patience`, `WireQuestRow.carrier_actor`, `QuestRow.carrier_actor` exist; the codec neither writes, reads
  nor checks them; literals fill `None` (`map.rs` decode, `samples.rs` x3, `public_ground.rs`, `collections.rs`,
  `quest_view/mod.rs`).
- `mapdata/patience.rs`: `leash_ok` returns false, `patience_plane` zeros.
- C#: `MapBlob.Patience`, the six-argument `WithPublic` (ignores the plane), `WireQuestRow.CarrierActor`,
  `QuestRowView.CarrierActor` (always null).

## 9. Validation commands
- `cargo test -p rh-protocol`, `cargo test -p rh-sim --features trusted-status-probes --test patience_plane`,
  `cargo test -p rh-sim --features trusted-status-probes --lib quest_view::`, `cargo test -p rh-server --test map_patience`,
  `cargo test -p rh-policy`, `cargo test -p rh-sim --test no_alloc`
- `node tools/protocol-js/check-vectors.mjs`, `node tools/protocol-js/check-map-patience.mjs`
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`

## 10. Risk and suggested model tier
Opus: a map-extension version in three decoders, an observation identity, a shared leash rule inside the tick.

## 11. Known traps
- More than 255 camps cannot be indexed in a byte: `MAX_MAP_CAMPS` is 64, so the encoder's camp-count check covers it.
- Overlap: impossible (one territory cell, one camp), see section 3.
- `mob_ai::leash` is in the tick: delegate without changing float order, allocations (none) or the no-layers circle.
- `item_view` stays allocation-free per step (`tests/no_alloc.rs`, `item_offer_alloc.rs`): fill the field in place.
- The quest view is staged before the projection: resolve visibility after `actor_refs::project`, not in `stage`.
- JS key order and the `"presence"` -> `/ground presence$/` mapping in `check-vectors.mjs`.

## Legacy doubts (pinned as legacy; flagged)
- `CampPatience.ts` samples tile centres only; a mob may chase slightly beyond the outline at territory edges. Pinned.
- A camp with spots outside its own territory uses the 24-tile circle for that spot, but only territory tiles count.
  Pinned.

## Notes from previous attempts
