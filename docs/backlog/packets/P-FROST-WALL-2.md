# P-FROST-WALL-2: a standing Frost Wall on the wire (observation, protocol, three decoders, bot delivery, Welcome)

- **Serves:** owner beta follow-up decision 2 (MIGRATION, 2026-11-10: "Frost Wall replaces Freeze"); the wire half cut
  from P-FROST-WALL-1 (its brief, lines 5, 20-21). Scope narrowed by the coordinator on 2026-11-14 (below).
- **Implementer tier:** implementer-opus (observation, wire format, three decoders, cross-crate)
- **Reviewer:** reviewer-opus
- **Integration base:** `47a886495` (coord/int-39 plus P-FROST-WALL-1c's implementation); oracle written there
- **D-rules touched:** D1 loose proof against the unreleased legacy patch `78dd8bd4` (read with `git show`; not in
  `packages/`) · golden vectors required · observation 29 -> 30, policy contract 23 -> 24 · protocol stays 17
  (`v17.json` regenerated) · C-OBS · D2 n/a · D5/D6/D9 none (no prediction change; see "Client pathing")

## Scope (coordinator, 2026-11-14)
- **Out, to P-FROST-WALL-2a** (in parallel on the same base): the wall's numbers entering the `content!` registry and
  the content hash moving, `crates/rh-sim/tests/content.rs`, the hash tape's `contentHash`,
  `protocol/fixtures/archetypes_v1.json`, the two browser-proof scripts. This packet touches none of them. (The old
  section 5c is gone.)
- **Out, to P-FROST-WALL-3** (after the Unity client draws the wall): `frost_wish: Wall` in
  `SimConfig::live_content()`, the characterisation tables in `crates/rh-server/tests/live_content.rs`, the two example
  files still copying the live world. (The old outcome (d), section 5b and section 10's flip text are gone.) With the
  default config nothing on the wire changes for a Freeze world except what the layout change forces (the Welcome's
  HUD block gains seven terms, section F5).
- **Cut by size (this oracle author, 2026-11-14), to P-FROST-WALL-2b:** the C# client STATE (`CollectionsView` exposing
  standing walls in map coordinates, `AreaKind.Wall`, a typed Frost-Wish accessor on the Welcome). The C# DECODER stays
  here (AGENTS.md: Rust, C# and JS decoders change in one branch). Section "Next packets".

## 1. Outcome
When this lands, under `SimConfig::frost_wish = Wall`:
(a) a standing wall is in the observation of every viewer who may see it, by the rule every non-trail field already
follows (F2), carrying its tiles (the sim's barrier row), its owner when the viewer sees the caster, and its start and
end time; it leaves every observation when it falls; the public snapshot carries it too;
(b) State key 3 carries it as field kind 3 with a tile list (F4); Rust, C# and JS decode and refuse alike; the landing
cue (`CastLanded`) keeps its point rule, so a viewer who sees none of the wall gets neither the wall nor its centre (F3);
(c) the Welcome's HUD block says which Wish Frost has in the room and carries the wall's public numbers (F5), so the
Unity client knows to offer an aim preview and needs no hand-kept copy of the numbers;
(d) bots: State key 3 delivered to a fair seat (`CollectionPublisher`, the same publisher the server uses) carries the
wall's tiles exactly as a human's.
Under `Freeze` no observation, frame or vector holds a wall.

## 2. Dependencies
- P-FROST-WALL-1, -1b, -1c merged (in the base). P-FROST-WALL-2a may merge before or after: no file is shared except
  `parity/abilities/hash-tape.json`, which the coordinator re-records at merge (F6).
- Serial with every packet touching `observe.rs`, `status_runtime/observe.rs`, `state.rs`, `hud_content.rs`,
  `samples.rs`, `probe.html`, the C# `State.cs`/`WireHudContent.cs`, `v17.json`.

## 3. Established facts (oracle author, verified on `47a886495`)

### F1. What legacy synced (`git show 78dd8bd4 -- packages/shared/src/schema.ts packages/server/src/sim/fields.ts packages/shared/src/barriers.ts packages/client/src/render/FieldView.ts`)
- `FieldState` (schema.ts:236-256) gains `cells: t.string()`: the wall's tiles as `encodeCells` (barriers.ts:81-83:
  row-major indices in base 36, comma-joined), `""` for every other kind, set once, never updated. The rest of the row
  is the ordinary field: `kind` (index into FIELD_KINDS, "wall" appended), `ability` (index into ABILITY_IDS: legacy
  appended `frostWall`), `x, y, x2, y2` (for a wall `seg.x1, seg.y1, seg.x2, seg.y2`, server `abilities.ts:595-598`),
  `r` 0, `owner` (caster id), `subject` "", `startedAt`, `endsAt` (now + 4000).
- `addField`/`removeField` (fields.ts:29-53) mirror the entry into `state.fields` once and delete it when it ends: the
  client never moves or edits a wall.
- The client decodes the tiles with the map's tile count, dropping bad entries one by one (`decodeCells`,
  barriers.ts:86-94). Rust refuses instead (C-NET: refuse, never repair).
- Visibility in legacy: `state.fields` went to every client; the client drew a field only when
  `canSee(centre)` with `centre = (x, y)` for every non-cloud kind and, for a trail only, also `canSee(x2, y2)`
  (FieldView.ts `update`, 78dd8bd4 lines ~160-166). Legacy bots: the same rule (`packages/server/src/bots/brain/
  perception.ts:813-816` `seeFields`). So legacy showed a wall when its FIRST END `(x1, y1)` was visible.
- Legacy's client planning map (`RaidScene.ts` `planMap`, 78dd8bd4) applied EVERY synced wall's tiles as LOW, seen or
  not (it had every field). See "Client pathing".

### F2. The Rust visibility rule for fields, and the wall
- `crates/rh-sim/src/status_runtime/observe.rs:74-101` `project`: a field is projected when
  `vision::point_visible(map, me, (f.x, f.y))`, and for `FieldKind::Trail` also `(f.x2, f.y2)`; owner/subject are named
  only when the viewer is that id or sees that actor. An unseated viewer gets no field (`:81`). `:86-89` skips every
  `Wall` field ("until P-FROST-WALL-2"); `public` (`:102-117`, the public snapshot) filters walls out too.
- `point_visible` (`vision.rs:477-489`, `point_with` `:357-370`): alive viewer, point within `VISION_RADIUS` 900
  (`constants.rs:73`) with no sight blocker, or remembered (tile trail, `VISION_TRAIL_MS` 30 s), or seen by an owned
  camp ward.
- The wall field's `(x, y)` is `seg.x1, seg.y1` and `(x2, y2)` is `seg.x2, seg.y2`
  (`systems/abilities/effects.rs:331-341`). **Decision: the wall simply joins the non-trail rule** (remove the two
  filters; no new rule): it is shown when its first end is visible, as legacy did (F1). Pinned, and flagged under
  "Legacy doubts": a viewer who sees only the second end and some tiles gets no wall; one who sees only the first end
  gets all of it.
- The tiles live in `AbilityRuntime::barriers` (`barriers.rs:244-258`, one row per wall field, ascending row-major
  indices, `check` `:356-389`): `FieldView` gains `tiles: Vec<u32>`, copied from the row of that field
  (`#[serde(default, skip_serializing_if = "Vec::is_empty")]`, so every other field serializes as before).

### F3. The landing event (`CastLanded`) and C-OBS
- Emitted at `systems/abilities/mod.rs:307-315` with `x, y` = the wall's centre for a placed cast (`placed_at`,
  `:330-345`) and `target: None`.
- Filtered by `observe.rs:794-812` `filter_events`: always passed to `to_seen` (`:613-645`), which keeps the caster id
  only when seen and the point only when `points[0]` holds, i.e. `wish_point_permissions` (`:758-790`): the caster
  itself, or `point_visible(centre)`. With neither, the event is dropped. **So it is already filtered by visibility under
  `Wall`** (reviewer-opus's open question on P-FROST-WALL-1): a viewer who sees none of the wall and not the caster gets
  no landing cue at all; one who sees the caster but not the centre gets the cue without a point. Pinned (green) next to
  the wall tests. The cue's point rule (centre) and the wall's (first end) differ by design of legacy: pinned as is.
- The cast start (`CastStarted`, `:219-227`) carries the caster's facing point `face`, filtered the same way; untouched.

### F4. Wire layout (decided; the tests pin it)
- State key 3 row, today (`crates/rh-protocol/src/state.rs` `WireField::write/read`): `kind u8 | ability u8 | owner
  opt varint | subject opt varint | x y x2 y2 r vx vy f32 | started_at f64 | ends_at f64`, then `valid()`: `kind < 3`,
  `ability < 5`, ... -> `BadField("field")`.
- New: field kind codes `0 zone, 1 cloud, 2 trail, 3 wall` (`FieldKind` order; `rh_protocol::state::FIELD_KIND_*`,
  `FIELD_KIND_COUNT` 4). A **kind-3 row only** continues after `ends_at` with `count u8 | count x tile u32 LE`: row-major
  tile indices into the Welcome map. Rows of kinds 0-2 are byte for byte as today (every existing vector keeps its bytes
  apart from F5's HUD change).
- Cap `MAX_WALL_TILES` = 64 (a wall takes at most 17 tiles with the legacy numbers at any angle and offset, measured
  over 200 000 random placements; 64 leaves room for a retune). A wall row is at most 48 + 10 + 1 + 256 bytes.
- Decoder checks, in this order (Rust `DecodeError`; C# `DecodeException` message `"BadField: <reason>"` or error
  `Truncated`; JS `Error("bad <reason>")`):
  1. kind >= 4: `BadField("field")` (as today for kind >= 3; the row is read whole first, so no tile list is read).
  2. kind 3: `count` 0 or above 64: `BadField("wall tiles")`, before any tile is read.
  3. `count x 4` above what the frame still holds: `Truncated`.
  4. a tile >= `map::MAX_MAP_TILES` (1 048 576, the largest map any Welcome may carry): `BadField("wall tile")`. The
     decoder of a State frame has no map; the tile against the actual Welcome map is the client state's check
     (P-FROST-WALL-2b).
  5. tiles not strictly ascending: `BadField("wall order")`.
  6. then the common `valid()` (`"field"`).
- Encoder (`try_encode`, `SnapshotData`, `CollectionPublisher`): refuses with `EncodeError::BadValue(reason)`: a kind-3
  row with no tiles or more than 64 (`"wall tiles"`), a tile >= MAX_MAP_TILES (`"wall tile"`), tiles not ascending
  (`"wall order"`), tiles on a row of another kind (`"field"`), kind >= 4 (`"field"`).
- `WireField` gains `tiles: Vec<u32>` and loses `Copy` (stub). JS: a wall row decodes to the usual object plus
  `tiles: [..]` after `endsAt`; rows of other kinds have NO `tiles` key (`check-vectors.mjs:116` pins today's row JSON).
- Ability code: the wall field's `ability` is 0 (`Freeze`), see F7.

### F5. The Welcome says which Wish Frost has (HUD block, P-WIRE17-HUD-2b's append-only term table)
- `crates/rh-protocol/src/hud_content.rs` `HudTerm` gains codes **23 `FrostWish`** (0 Freeze, 1 Wall:
  `hud_content::FROST_WISH_FREEZE/WALL`), **24 `FrostWallRange` 450, 25 `FrostWallMinRange` 64, 26 `FrostWallLength` 224,
  27 `FrostWallMs` 4000, 28 `FrostWallCellReach` 24, 29 `FrostWallEndSlack` 8** (legacy 78dd8bd4 constants.ts and
  barriers.ts; Rust `abilities/mod.rs:272-278`, `barriers.rs:20-22`). `HUD_TERM_COUNT` and `MAX_HUD_TERMS` 23 -> 30.
  Codes 24-29 are the numbers the aim preview mirrors (P-UNITY-FROST-WALL-1 section 4); the cast and cooldown times are
  already in the owner's Wish record.
- `rh_policy::delivery::projection::wire_hud_for(FrostWish)` builds the block (every code, ascending; `FrostWish` from
  the argument, 24-29 from the sim's constants in every room); `wire_hud()` stays and equals `wire_hud_for(Freeze)`.
  The server's Welcome (`crates/rh-server/src/room.rs:318-321` `hud_content()`, used at `:644`) must carry the block of
  the room's own `config().frost_wish` (e.g. a `hud_content_for(wish)` with one `OnceLock` per value; `wirebench.rs:488`
  keeps `hud_content()`).
- Why the HUD block and not a new Welcome field: it is already decoded by all three clients, append-only by code, and a
  new code changes only a count in each decoder; a Welcome trailer would change every Welcome's layout. The block was
  documented as "public content constants"; `FrostWish` is a room setting, still the same for every viewer of the room.
  Update the module doc.
- Consequence for a Freeze world: every real Welcome grows by 7 x 9 = 63 bytes (`FrostWish` 0 and the six numbers). No
  other byte changes.

### F6. Identities (decided)
| Identity | Moves | Why | Pinned at (all must move in this branch) |
|---|---|---|---|
| `OBSERVATION_VERSION` | 29 -> 30 | `FieldView` gains `tiles`; `Observation.fields` carries `FieldKind::Wall` | `crates/rh-sim/src/observe.rs:20`; existing tests `crates/rh-sim/src/reward_chests/trophy_observer_tests.rs:259`, `src/observe/panel_tests.rs:472`, `src/observe/panel_tooltip_tests.rs:322`, `src/observe/hud_clock_tests.rs:224`, `crates/rh-policy/tests/hud_roam_terms.rs:46`, `tests/quest_carrier_delivery.rs:63`, `tests/hud_clock_delivery.rs:73`; new `crates/rh-sim/tests/frost_wall_observe.rs`; `parity/abilities/hash-tape.json:261` `observationVersion` (coordinator re-records at merge with `cargo test --locked -p rh-sim --features trusted-status-probes --lib record_ability_hash_tape -- --ignored`; `ability_hash_tape_matches_the_base` is red on the implementer branch until then, as after P-WIRE17-MAP-2 and HUD-3) |
| `POLICY_CONTRACT_VERSION` | 23 -> 24 | it versions the observation and command shapes (`crates/rh-policy/src/lib.rs:25-52`): the projected State key 3 gains a field kind and its tile list | `crates/rh-policy/src/lib.rs:52` (and a "Version 24" doc line above it); existing tests `crates/rh-policy/tests/hud_roam_terms.rs:51`, `tests/quest_carrier_delivery.rs:68`, `tests/hud_clock_delivery.rs:78`; new `crates/rh-policy/tests/frost_wall_delivery.rs` |
| `PROTOCOL_VERSION` | stays 17 | owner plan: one protocol number grown by serial packets; an older 17 client refuses a wall row ("field") and a Welcome with codes >= 23 ("hud term code"): the same flag as MAP-2/MAP-3, the coordinator decides | `crates/rh-protocol/src/lib.rs`, `Codec.cs`, `probe.html` (unchanged); `protocol/fixtures/v17.json` regenerated by `cargo run -p rh-protocol --bin protocol-fixtures` |
| `HUD_TERM_COUNT` / `MAX_HUD_TERMS` | 23 -> 30 | F5 | `hud_content.rs`; C# `WireHudContent.TermCount` (`client-unity/RoguehallaNet/Protocol/WireHudContent.cs:50`); JS `probe.html:558,562`; existing tests listed in section 5 |
| `CHECKPOINT_FORMAT`, `REPLAY_FORMAT` | no | no serialized sim shape changes (the barrier rows were part 1's) | |
| content hash | no (P-FROST-WALL-2a) | | |

### F7. The `frostWall` ability id: not in this packet
Legacy appended `frostWall` to ABILITY_IDS. In Rust, appending `AbilityId::FrostWall` moves the content hash (the id
loop of `abilities::visit_content` and `status_runtime::rules::visit_extra_content`, P-FROST-WALL-1's notes) and breaks
exhaustive matches (`crates/rh-policy/src/delivery/projection.rs:176` `ability_code`, the C# `AbilityId` enum). The
coordinator put the content hash in P-FROST-WALL-2a, so here Frost's Wish keeps the id `Freeze` (wire ability code 0)
under both Wishes, as P-FROST-WALL-1 decided: a client tells a wall from a Freeze by the field kind (3) and the Welcome's
`FrostWish` term; the Wish record and the cast cues (`wish_fx_started/landed`) carry ability 0 in both. A distinct id and
wire code, if wanted, belong with or after P-FROST-WALL-2a: **flagged to the coordinator**.

## 4. New paths
- Oracle: `crates/rh-sim/tests/frost_wall_observe.rs`, `crates/rh-protocol/tests/frost_wall_wire.rs`,
  `crates/rh-policy/tests/frost_wall_delivery.rs`, `crates/rh-server/tests/frost_wall_welcome.rs`,
  `client-unity/RoguehallaNet.Tests/FrostWallProtocolTests.cs`, `tools/protocol-js/check-frost-wall.mjs`.

## 5. Exclusive write scope
- `crates/rh-sim/src/status_runtime/observe.rs` (the two filters go; `tiles` filled from the barrier row);
  `crates/rh-sim/src/status_runtime/fields.rs` (the `Wall` doc comment); `crates/rh-sim/src/observe.rs:20` only.
- `crates/rh-protocol/src/{state.rs, hud_content.rs, samples.rs, lib.rs (docs only)}`; `protocol/fixtures/v17.json`
  (regenerated only, by its command).
- `crates/rh-policy/src/delivery/{collections.rs, projection.rs}`, `crates/rh-policy/src/lib.rs` (the version and its
  doc line).
- `crates/rh-server/src/room.rs` (the Welcome's HUD block per room; nothing else).
- `crates/rh-server/web/probe.html`; `tools/protocol-js/check-vectors.mjs` (expectations for the new malformed
  vectors; the Welcome HUD term list at `:600-606`).
- `client-unity/RoguehallaNet/Protocol/{State.cs, WireHudContent.cs}` and the synced copy (`bash client-unity/sync-net.sh`).
- Existing tests, pin lines only (owner approval; mechanical): the F6 pins; `crates/rh-protocol/tests/hud_content_wire.rs`
  `:5, :135-136, :178, :183, :270, :292-295, :406-407, :470` (count 23 -> 30; the first unknown code becomes 30);
  `crates/rh-protocol/tests/hud_tooltip_wire.rs:69-70`; `client-unity/RoguehallaNet.Tests/HudContentProtocolTests.cs:73,
  :132, :138`; `client-unity/RoguehallaNet.Tests/HudTooltipProtocolTests.cs:52`. Vector `welcome_hud_term_code`
  (`samples.rs:3412-3413`) moves from code 23 to 30 (its bytes change; reason unchanged). `sample_hud()` (`samples.rs:925`)
  grows to 30 terms (`FrostWish` 0 and the six numbers), so every Welcome vector's bytes change.
- Not: `content.rs`, `constants.rs`, `tests/content.rs`, `parity/**`, `archetypes_v1.json`, `statics.rs`
  (`live_content()`), any Unity script, `CollectionsView`/`Session.cs` (P-FROST-WALL-2b), `LocalMotion.cs`,
  `Pathfinder.cs`, `Cargo.lock`.

## 6. Contracts
- C-OBS: the wall is shown only by the existing field rule; the owner only when seen; the landing point only by its
  point rule; an unseated viewer gets nothing. The tiles are the server's (the client never computes the wall it draws).
- C-NET / ADR 0011: three decoders in one branch; refuse, never clamp or drop (legacy dropped bad cells: not ported).
- C-POLICY: bots receive key 3 through the same publisher as humans; the Brain's use of walls is not this packet.
- C-PARITY: every parity fixture runs with `Freeze`: no wall, no change.

## 7. Behaviour to preserve
- Freeze worlds: observations, frames and vectors byte for byte, except the Welcome HUD block (F5) and the regenerated
  vectors that carry `sample_hud()`.
- No allocation per step under the default config (`tests/no_alloc.rs`); a `Vec` per wall per observation under `Wall`
  is accepted (no no-alloc oracle observes a standing wall).
- `FieldView` sort order unchanged for non-walls (add `tiles` last in `FieldView::cmp`, or not at all).

## 8. Acceptance checks
- The oracle files pass; `scripts/gate.sh --oracle packet/P-FROST-WALL-2 --regen-fixtures` passes (full), apart from
  `ability_hash_tape_matches_the_base` (coordinator carry, F6).
- `node tools/protocol-js/check-frost-wall.mjs` passes (not run by the gate; proposed gate line for the owner:
  `run "JS frost wall vectors" node tools/protocol-js/check-frost-wall.mjs`).

## Oracle files (read-only for implementers)
- `docs/backlog/packets/P-FROST-WALL-2.md` (this brief)
- `crates/rh-sim/tests/frost_wall_observe.rs` (8 tests: 7 red, 1 green guard): a viewer seeing the wall gets it with
  tiles, owner, segment and 4000 ms; one seeing none of it gets neither wall nor landing centre (and the near viewer
  does get the centre); the first-end rule (legacy) both ways; an unseated viewer; the public snapshot; it falls and
  leaves every observation; Freeze guard; `OBSERVATION_VERSION` 30.
- `crates/rh-protocol/tests/frost_wall_wire.rs` (11 tests: 9 red, 2 green guards): constants; the layout by a
  hand-written builder; the caps (64 tiles, the last index, one tile); decoder refusals (kind 4, count 0, count 65,
  truncated list, tile >= MAX_MAP_TILES, repeated, descending); encoder refusals; 512 walls of 64 tiles fit a frame;
  vectors `state_frost_wall`, `state_frost_wall_max`, `welcome_frost_wall` (and `welcome` with all 30 codes) by value;
  malformed `state_field_kind_unknown`, `state_wall_tiles_zero`, `state_wall_tiles_over`, `state_wall_tiles_truncated`,
  `state_wall_tile_off_map`, `state_wall_tile_order`, and `welcome_hud_term_code` moved to code 30. Guards: protocol 17;
  other kinds keep their bytes.
- `client-unity/RoguehallaNet.Tests/FrostWallProtocolTests.cs` (8 tests, all red): the same rows, refusals with the Rust
  reasons, encoder refusals, the three vectors and the six malformed ones from `v17.json`.
- `tools/protocol-js/check-frost-wall.mjs` (fails at its first check): the probe's JSON for a wall row (`tiles` after
  `endsAt`, no `tiles` key on other kinds), refusals, the vectors, Welcome codes 0..29.
- `crates/rh-policy/tests/frost_wall_delivery.rs` (4 tests: 3 red, 1 green guard): a real sim's wall through
  `CollectionPublisher` into key 3 and a seat's `CollectionView` with its tiles; Freeze guard; `wire_hud_for` (every code,
  23 = 0/1, the six numbers; `wire_hud() == wire_hud_for(Freeze)`; the block encodes); identities 30/24.
- `crates/rh-server/tests/frost_wall_welcome.rs` (1 test, red): a room's Welcome carries `wire_hud_for(its frost_wish)`.

Stub commits (the implementer's to replace): `crates/rh-sim/src/status_runtime/observe.rs` (`FieldView.tiles`, filled with
nothing), `crates/rh-sim/src/actor_refs/tests.rs` and `crates/rh-protocol/tests/state.rs` (struct literals gain
`tiles: Vec::new()`; no assertion changed), `crates/rh-protocol/src/state.rs` (`WireField.tiles`, no `Copy`, the kind
codes with `FIELD_KIND_COUNT` still 3, `MAX_WALL_TILES`), `crates/rh-protocol/src/hud_content.rs` (codes 23-29 and
`FROST_WISH_*`; `HUD_TERM_COUNT` still 23), `crates/rh-protocol/src/samples.rs` (literals), `crates/rh-policy/src/
delivery/{collections.rs, projection.rs}` (`tiles: Vec::new()`; `wire_hud_for` returning `wire_hud()`), C#
`Protocol/State.cs` (`WireField.Tiles`, `FieldsState.Kind*`, `KindCount` still 3, `MaxWallTiles`) and
`Protocol/WireHudContent.cs` (`HudTerm` codes 23-29; `TermCount` still 23), with the synced Unity copy.

## Baseline (on `packet/P-FROST-WALL-2`, before any implementation)
Every red test fails on an assertion, an `expect` of today's refusal, or a missing named vector (the fixture file
exists; the vector is absent: an assertion in each harness), never on a compile error:
- `cargo test -p rh-sim --test frost_wall_observe`: 7 failed ("slot 0 sees the standing wall: []", version 29 != 30, ...).
- `cargo test -p rh-protocol --test frost_wall_wire`: 9 failed (`FIELD_KIND_COUNT` 3 != 4; count 0 decodes as
  `BadField("field")`; the encoder refuses the wall row as `"field"`; "missing server vector state_frost_wall").
- `dotnet test client-unity/RoguehallaNet.Tests --filter FrostWallProtocolTests`: 7 failed of 8, all red but the
  trail-bytes check (`OtherKindsCarryNoTileList` passes: a guard).
- `node tools/protocol-js/check-frost-wall.mjs`: "a wall row is refused: bad field".
- `cargo test -p rh-policy --test frost_wall_delivery`: 3 failed ("one wall row in key 3: []", 29 != 30, "the block
  carries FrostWallRange").
- `cargo test -p rh-server --test frost_wall_welcome`: 1 failed (`None` != `Some(0.0)`).
- Satisfiable: the observation tests were run against a dry-run of the two filters removed and the barrier tiles copied
  (reverted before commit): every test passed once the rig stepped past the 30 s sight memory.

## 9. Validation commands
`export PATH="$HOME/.cargo/bin:$HOME/.dotnet:$PATH"`, then
- `cargo test -p rh-sim --test frost_wall_observe`; `cargo test -p rh-protocol`; `cargo test -p rh-policy`;
  `cargo test -p rh-server --test frost_wall_welcome --test lifecycle`
- `cargo run -p rh-protocol --bin protocol-fixtures` (regenerates `v17.json`), then `node tools/protocol-js/check-vectors.mjs`,
  `node tools/protocol-js/check-frost-wall.mjs`
- `bash client-unity/sync-net.sh`, `dotnet test client-unity/RoguehallaNet.Tests`
- `scripts/gate.sh --quick`; `scripts/gate.sh --oracle packet/P-FROST-WALL-2 --regen-fixtures`

## 10. Risk and suggested model tier
Opus: an observation identity, a wire row in three decoders, a Welcome block, the bot contract. No profile selects
`Wall` after this packet (P-FROST-WALL-3), so a defect here is invisible to players until then.

## 11. Known traps
- The tile list follows the row ONLY for kind 3; reading it for other kinds breaks every existing vector.
- Count before tiles; truncation before reading tiles (a short list must not read the next row as tiles).
- `WireField` loses `Copy`: `collections.rs:710` compares field lists (`!=`), still fine.
- `sample_hud()` is `[f64; MAX_HUD_TERMS]`: growing the count forces seven values (F5 order).
- The far-viewer test needs the 30 s sight memory expired (the rig steps 640 times first).

## Client pathing (decision: not in this packet)
Legacy's planning map applied every standing wall's tiles as LOW (F1). In `RoguehallaNet` the predicted walk
(`Net/LocalMotion.cs`) and its pathfinder (`Net/Pathfinder.cs`) read the Welcome `MapBlob`; `Session.cs:461-470`
already chooses, for locked gates, to SUSPEND prediction rather than build a second collision model ("never infer a
second collision model"). Adding walls is not a clean addition: (1) the server re-plans walks already under way when a
wall rises (`effects.rs` wall landing, `walk_blocked` + `replan`), which prediction would have to mirror; (2)
`SetCollisionMap` suspends prediction and drops the predicted path (`LocalMotion.cs:237-243`), so swapping maps on each
rise and fall is itself a correction; (3) the client holds only the walls it may see (C-OBS), legacy held all. Named as
**P-FROST-WALL-PREDICT-1**: either suspend prediction while a delivered wall stands within reach (the gate precedent,
small), or a `MapBlob` copy with the delivered tiles LOW fed to `LocalMotion` plus the mid-walk re-plan, checked with
`rh-sim` walk vectors (`server_walk_*`) recorded with a wall standing. Until then, under `Wall` a predicted walk through
ice is corrected by the server (a visible snap), and only once P-FROST-WALL-3 selects `Wall`.

## Next packets
- **P-FROST-WALL-2b (C# client state; implementer-sonnet, reviewer):** `CollectionsView` exposes key-3 walls:
  `AreaKind.Wall = 3`, `AreaView.Tiles` as `MapTile[]` in map coordinates (index -> `(i % W, i / W)` with the Welcome
  map, empty for other kinds), a tile at or beyond `W * H` refused as `InvalidCollectionStateException("wall tile")`
  (the session fails, as for a bad trade state), and a typed Frost-Wish accessor on `WireHudContent` (`FrostWish?`,
  null when the block lacks code 23). Oracle: Session-level tests in `RoguehallaNet.Tests` with `FakeTransport`
  (Welcome with a 4 x 4 map, then a State with a wall). Depends on this packet.
- **P-FROST-WALL-PREDICT-1:** above. **P-FROST-WALL-3:** the flip. **P-UNITY-FROST-WALL-1:** draws walls, aim preview.

## Legacy doubts (pinned as legacy; flag, do not fix)
- 78dd8bd4 `client/src/render/FieldView.ts` `update`: a wall is drawn when its first end `(x1, y1)` is visible,
  whatever the rest; a viewer who sees the second end and several tiles sees no wall. Pinned
  (`the_wall_is_shown_by_its_first_point_as_every_non_trail_field_is`). A "any tile visible" rule is its own packet.
- 78dd8bd4 `shared/src/barriers.ts:86-94`: bad cells are dropped silently; Rust refuses the frame instead (C-NET).

## Not established by this oracle
- A room end to end (a Frost human's cast reaching another human's socket): the policy test drives the real sim
  through the server's own publisher; the room only adds transport.
- Walls with gates locked, two walls at once, a wall whose owner left (owner redacted by the existing rule).

## Notes from previous attempts
