# P-WIRE17-HUD-2b: protocol 17 carries weapon scaling terms and the Wish row numbers

- **Serves:** not in the plan: owner approval 2026-11-10 (MIGRATION checkpoint, decision 3: the Unity HUD presents what
  the legacy HUD presents; bottom-left damage panel)
- **Implementer tier:** implementer-opus (wire format, three decoders, cross-crate)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10); golden vectors required for a wire change · D2 n/a ·
  D5/D6/D9 none
- **Status:** oracle committed on `packet/P-WIRE17-HUD-2b` (oracle author, 2026-11-12). Split: the Fire roam panel codes
  and the tooltip-only numbers moved to **P-WIRE17-HUD-2c** (`docs/backlog/packets/P-WIRE17-HUD-2c.md`, brief only).

## 1. ID and outcome
Still protocol 17, `v17.json` regenerated. When this lands every Welcome carries, after the weapon table and before the
map, a **HUD content block**: public content the legacy HUD prints and the wire did not carry.
- One **weapon scaling row** per weapon (legacy `WEAPONS[w].scaling` and `.dominant`): what the weapon slot line, the
  slot tooltip ("Scales with ...") and the auto row's scaling line print.
- The **HUD terms**: a (code, value) list of public constants; this packet defines codes 0-18, every number of the
  champion panel's Wish row for each faction (value, scaling line and tooltip), read from the sim's Wish definitions.

**Decisions (oracle author).**
- Both are per-weapon / per-ability content constants, identical for every viewer: Welcome, not State key 13 (no
  per-tick cost, no C-OBS question, no observation or policy identity change).
- One new Welcome section rather than wider weapon-table rows: the protocol-16 weapon table (hit shapes) and its 16
  refusal vectors stay byte-identical in layout, and the term list is append-only for later public constants (HUD-2c adds
  the Fire roam constants there).
- Raw legacy constants on the wire (ms, world units, multipliers), f64 like the weapon table. Unity formats them
  ("20% less dealt" = `(1 - TrialDealtMult) x 100`, seconds = ms / 1000); it computes no rule from them.
- Split (size): codec + vectors + three decoders + builder for this block is about 450 changed lines; the Fire roam panel
  codes touch rh-sim `build_summary`/`observe`, key 13 and the identities, so they are HUD-2c.

## 2. Dependencies
- P-WIRE17-HUD-2 merged (it is: same decoders). Strictly serial with any other Welcome or decoder packet.

## 3. Relevant legacy paths (read by the oracle author)
- `packages/shared/src/weapons.ts:96-124`: `scaling: { ad, ap, hp, def }` (absent = 0) and `dominant` per weapon.
- `packages/client/src/ui/weaponBar.ts:167` slot line = `weaponScalingText(w ?? FISTS)`; `buildModel.ts:204-213`
  `weaponScalingText` (terms > 0, sorted biggest first, joined " or " when dominant, "(the higher)" suffix, "No scaling");
  `buildModel.ts:224` tooltip "Scales with ...".
- `packages/client/src/ui/championCombatModel.ts:119-122` `scaleTerms` (terms != 0 in ad, ap, hp, def order, `fmt(c)x
  label`, " or " when dominant else " + ", "none"); `:125` the auto row's scaling line; `:128` the tooltip.
- `championCombatModel.ts:219-227` `wishRow`; constants `packages/shared/src/abilities.ts:140-167`.

## Field list (decided by the oracle author; the tests pin it)

### Weapon scaling rows (Welcome HUD block, one per `rh_sim::WeaponId::ALL`, wire id `code()`)
| Field | Legacy | Rust source | Sword, Bow, Wand, Shield, Axe, Fists |
|---|---|---|---|
| `ad` | weapons.ts:96-124 `scaling.ad` | `rh_sim::modifiers::DEFINITION.weapon_scaling[code][0]` (`modifiers/rules.rs:19-26`) | 1, 1, 0.3, 0, 1, 0.6 |
| `ap` | `scaling.ap` | `[code][1]` | 1, 0, 1, 0.3, 0, 0.6 |
| `bonus_hp` | `scaling.hp` | `[code][2]` | 0, 0, 0, 0, 0.02, 0 |
| `bonus_defense` | `scaling.def` | `[code][3]` | 0, 0, 0, 0.4, 0, 0 |
| `dominant` | `dominant` | `[code][4] != 0` | true, false x5 |

### HUD terms (Welcome HUD block; `rh_protocol::HudTerm`, append-only)
| Code | Name | Legacy constant (abilities.ts) | Printed at (championCombatModel.ts) | Rust source | Value |
|---|---|---|---|---|---|
| 0 | FreezeStunMs | `FREEZE_STUN_MS` :141 | :222 value, tooltip | `abilities::FREEZE_STUN_MS` | 1250 |
| 1 | FreezeRange | `FREEZE_RANGE` :140 | :222 | `abilities::definition(AbilityId::Freeze).target` = `Target::Unit(450.)` (no named constant) | 450 |
| 2 | SwarmHiddenMs | `SWARM_MS` :143 | :223 | `abilities::SWARM_MS` | 8000 |
| 3 | SwarmCloudRadius | `SWARM_CLOUD_RADIUS` :145 | :223 | `abilities::SWARM_RADIUS` | 72 |
| 4 | TrialZoneMs | `TRIAL_MS` :150 | :224 value | `abilities::TRIAL_MS` | 5000 |
| 5 | TrialDealtMult | `TRIAL_DEALT_MULT` :151 | :224 value | `abilities::TRIAL_DEALT_MULT` | 0.8 |
| 6 | TrialMoveMult | `TRIAL_MOVE_MULT` :153 | :224 scaling | `abilities::TRIAL_MOVE_MULT` | 0.7 |
| 7 | TrialTakenMult | `TRIAL_TAKEN_MULT` :152 | :224 scaling | `abilities::TRIAL_TAKEN_MULT` | 1.2 |
| 8 | TrialExitStunMs | `TRIAL_EXIT_STUN_MS` :154 | :224 scaling | `status_runtime::TRIAL_FIELD_POLICY.exit_stun_ms` (`status_runtime/fields.rs:113`) | 1500 |
| 9 | TrialRadius | `TRIAL_RADIUS` :147 | :224 tooltip | `abilities::TRIAL_RADIUS` | 300 |
| 10 | TrialConvictedRadius | `TRIAL_CONVICTED_RADIUS` :149 | :224 tooltip | `abilities::TRIAL_CONVICTED_RADIUS` | 200 |
| 11 | BlazeBurnDps | `BLAZE_BURN_DPS` :162 | :225 value | `status_runtime::BLAZE_FIELD_POLICY.burn.0` (`fields.rs:117`) | 30 |
| 12 | BlazeBurnMs | `BLAZE_BURN_MS` :163 | :225 value ("s trail") | `BLAZE_FIELD_POLICY.burn.1` | 2000 |
| 13 | BlazeMinDist | `BLAZE_MIN_DIST` :157 | :225 scaling | `abilities::blink::MIN_DIST` (`abilities/blink.rs:5`) | 64 |
| 14 | BlazeMaxDist | `BLAZE_RANGE` :156 | :225 scaling | `abilities::blink::MAX_DIST` (`blink.rs:6`) | 300 |
| 15 | LastStandMs | `LAST_STAND_MS` :164 | :226 value | `abilities::LAST_STAND_MS` | 5000 |
| 16 | LastStandSpeedBonus | `LAST_STAND_SPEED_BONUS` :166 | :226 value | `abilities::LAST_STAND_HASTE` | 0.3 |
| 17 | LastStandHealShare | `LAST_STAND_HEAL_SHARE` :167 | :226 scaling | `abilities::LAST_STAND_HEAL` | 0.3 |
| 18 | LastStandFloorHp | `LAST_STAND_FLOOR_HP` :165 | :226 value (literal "1 HP") | `abilities::LAST_STAND_FLOOR` | 1 |

No new Rust constant: every value is read from an existing sim definition (the content registry,
`crates/rh-sim/tests/content.rs`, is untouched; `cargo test -p rh-sim --test content` passes on the stub). Frost's Wish is
Freeze on this branch: **the Frost Wall packet must append its own codes (19+, or after HUD-2c's) and update
`crates/rh-policy/tests/hud_content.rs` `every_faction_wish_has_its_row`**; codes 0-1 stay (append-only).

### Deliberately left out
- Ability names and blurbs (`def.name`, `def.blurb`, the "No damage scaling" strings): text, not numbers. Unity keeps its
  own strings (as for every other label).
- Wish cast times, cooldowns, charges, Trial cast range (400), Blaze trail lifetime (`BLAZE_TRAIL_MS` 2500) and half width:
  the panel does not print them; cooldowns already reach the client through the owner ability view.
- Fire roam numbers and tooltip-only numbers: P-WIRE17-HUD-2c.

## Wire layout (rh-protocol `src/hud_content.rs`; types final, functions stubbed). Little-endian.
Welcome: header, archetype table, vision block, weapon table, **HUD block**, map.
- `scaling count u8` (<= `MAX_SCALING_ROWS` = 32), rows of `SCALING_ROW_LEN` = 34 bytes: `id u8, ad f64, ap f64,
  bonus_hp f64, bonus_defense f64, dominant u8` (0/1). Ids strictly ascending.
- `term count u8` (<= `MAX_HUD_TERMS` = 19), rows of `HUD_TERM_ROW_LEN` = 9 bytes: `code u8` (< `HUD_TERM_COUNT` = 19),
  `value f64`. Codes strictly ascending.
- Every f64 finite and in `0..=MAX_HUD_VALUE` (1e6). Empty block = 2 bytes; the server's block = 2 + 6 x 34 + 19 x 9 =
  377 bytes; the largest legal block 2 + 32 x 34 + 19 x 9 = 1261 bytes.
- Decoder (`DecodeError::BadField(reason)`): scaling count over the cap before reading any row ("scaling count"); a
  dominant byte > 1 as soon as its row is read ("scaling dominant"); after the rows, a value out of range ("scaling"),
  then ids not strictly ascending ("scaling order"); term count over the cap before reading rows ("hud term count"); a code
  >= 19 as soon as it is read ("hud term code"); after the rows, a value out of range ("hud term"), then codes not
  strictly ascending ("hud term order"). A frame ending inside the block: `Truncated`.
- Encoder (`content_fault`, `try_encode`, `encode_welcome_into`: `EncodeError::BadValue(reason)`; `encode_welcome`
  debug-asserts): scaling count, scaling values, scaling order, term count, term code, term values, term order.
- `encode_welcome` / `encode_welcome_into` take `hud: &WireHudContent` after `weapons` (stub commit; the room passes
  `rh_server::room::hud_content()`, built once from `rh_policy::delivery::projection::wire_hud`).
- C# (`client-unity/RoguehallaNet/Protocol/WireHudContent.cs`): `HudTerm`, `WireWeaponScaling { Id, Ad, Ap, BonusHp,
  BonusDefense, Dominant }`, `WireHudTerm { Code, Value }`, `WireHudContent { Scaling, Terms, Term(code), ScalingOf(id) }`,
  constants; `ServerMsg.Welcome.Hud` (already read and written through the stubbed `Length/Write/Read`). Decoder throws
  `DecodeException(DecodeError.BadField, reason)`; the encoder throws `ArgumentException(reason)` (as `WireWeapon`).
- JS (`crates/rh-server/web/probe.html`, a `readHud` after `readWeapons`): `m.hud = { scaling: [{ id, ad, ap, bonusHp,
  bonusDefense, dominant (boolean) }], terms: [{ code, value }] }`; errors `"bad scaling count"`, `"bad scaling
  dominant"`, `"bad scaling"`, `"bad scaling order"`, `"bad hud term count"`, `"bad hud term code"`, `"bad hud term"`,
  `"bad hud term order"`.
- Fixture JSON (`samples.rs` Welcome `decoded`, beside `"weapons"`): `"hud":{"scaling":[{"id":0,"ad":1,"ap":1,
  "bonusHp":0,"bonusDefense":0,"dominant":true},...],"terms":[{"code":0,"value":1250},...]}` (the JS check compares it
  exactly).

## Vector names (generated by `samples.rs`, read by all three decoders)
Server (positive): every Welcome sample built by `welcome_map_msg` (`welcome`, `welcome_ground_*`, `welcome_public_*`)
carries `sample_hud()`: the six scaling rows and the 19 terms above, equal to `wire_hud()` (held by the rh-policy test).

malformedServer (on the 2 x 2 `welcome_map` frame, the block spliced after the empty weapon table; the reason is pinned
by `tests/hud_content_wire.rs`, `tests/vectors.rs`, the C# and JS checks):

| Name | Block | Rust | C# | JS |
|---|---|---|---|---|
| `welcome_hud_scaling_count` | `21` (33) then the map | BadField("scaling count") | BadField | /bad scaling count/ |
| `welcome_hud_scaling_dominant` | sword row with dominant `02`, 0 terms | BadField("scaling dominant") | BadField | /bad scaling dominant/ |
| `welcome_hud_scaling_nan` | one row, `ad` NaN | BadField("scaling") | BadField | /bad scaling$/ |
| `welcome_hud_scaling_negative` | one row, `ap` -0.5 | BadField("scaling") | BadField | /bad scaling$/ |
| `welcome_hud_scaling_order` | rows id 1 then id 0 | BadField("scaling order") | BadField | /bad scaling order/ |
| `welcome_hud_term_count` | 0 rows, term count 20 | BadField("hud term count") | BadField | /bad hud term count/ |
| `welcome_hud_term_code` | 0 rows, term (19, 1.0) | BadField("hud term code") | BadField | /bad hud term code/ |
| `welcome_hud_term_infinite` | 0 rows, term (0, +inf) | BadField("hud term") | BadField | /bad hud term$/ |
| `welcome_hud_term_over_max` | 0 rows, term (0, 1e6 + 1) | BadField("hud term") | BadField | /bad hud term$/ |
| `welcome_hud_term_order` | 0 rows, terms (4, 5000) (3, 72) | BadField("hud term order") | BadField | /bad hud term order/ |
| `welcome_hud_truncated` | 0 rows, term count 2, one row, 4 bytes of the next; frame ends | Truncated | Truncated | /./ |

## Identities and size
- Move: nothing. `PROTOCOL_VERSION` stays 17 (owner approved stamping 18 on the next deployed build as a separate step);
  `OBSERVATION_VERSION` (26) and `POLICY_CONTRACT_VERSION` (20) do not move: the block is Welcome content, not part of the
  observation or its projection. Content hash unchanged (computed from the registry; no sim content changes). No sim
  state, schedule row or RNG draw: every state hash and `parity/abilities/hash-tape.json` stay as they are.
- Size: the server's Welcome grows by 377 bytes. No max-size Welcome vector exists (`state_all_max_budget` is a State
  frame, unaffected); `MAX_SERVER_FRAME` (256 KiB) is checked for both real maps by
  `crates/rh-server/src/room/ground_tests.rs` (`assert!(bytes.len() <= MAX_SERVER_FRAME)`), which now includes the block.

## 4. New paths
- tests only (see "Oracle files"); `protocol/fixtures/v17.json` is regenerated by the implementer with
  `cargo run -p rh-protocol --bin protocol-fixtures`, never hand-edited.

## 5. Exclusive write scope
- `crates/rh-protocol/src/hud_content.rs` (the stubbed functions), `crates/rh-protocol/src/samples.rs` (`sample_hud`,
  the hand-built Welcome frames' pre-map bytes, the eleven vectors, the Welcome JSON `"hud"`),
  `crates/rh-protocol/src/encode.rs` and `src/lib.rs` only if needed (the plumbing is final in the stub)
- `crates/rh-policy/src/delivery/projection.rs` (`wire_hud` body)
- `client-unity/RoguehallaNet/Protocol/WireHudContent.cs` (and `Messages.cs` if needed), then `bash
  client-unity/sync-net.sh` (synced copy under `client-unity/UnityProject/Assets/RoguehallaNet/`)
- `crates/rh-server/web/probe.html` (JS decoder); `protocol/fixtures/v17.json` (regenerated only)
- Not in scope: rh-sim (no new constant), key 13, observation, `crates/rh-server/src/room.rs` (plumbed in the stub).

## 6. Contracts and references
- C-NET / ADR 0011: a new Welcome section in protocol 17, same branch for Rust, C# and JS, vectors regenerated.
- C-OBS: public content, identical for every viewer (`wire_hud()` takes no viewer); no owner state.
- R-AUTH: Unity prints these numbers and the weapon scaling terms; it derives no rule from them.

## 7. Behaviour to preserve
- Existing Welcome vectors keep every other byte; the weapon table's 16 refusal vectors keep their reasons.
- No sim, observation or policy decision change.

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-WIRE17-HUD-2b --regen-fixtures` passes (full).
- `node tools/protocol-js/check-vectors.mjs`, `dotnet test client-unity/RoguehallaNet.Tests` and `bash
  client-unity/sync-net.sh --check` pass on the regenerated `v17.json`.

## Oracle files (read-only for implementers)
- `crates/rh-protocol/tests/hud_content_wire.rs`: constants; the block's place and bytes (empty = two zero bytes, a
  two-row example byte for byte, max length 1261); `encode_welcome` = `ServerMsg::encode` with the block; encoder refusals
  and their order; decoder refusals on hand-built blocks and their order; truncation; the `welcome` sample carries
  `sample_hud()` with the legacy values; the eleven named malformed vectors and their reasons.
- `crates/rh-protocol/tests/vectors.rs`: reason arms for the eleven vectors (additions only).
- `crates/rh-policy/tests/hud_content.rs`: the loose proof: `wire_hud()` scaling rows equal legacy weapons.ts and the
  sim's `DEFINITION.weapon_scaling`, ids equal the weapon table; terms equal the legacy abilities.ts constants and the
  sim's Wish definitions; every faction's Wish has its row's codes; `sample_hud() == wire_hud()`.
- `client-unity/RoguehallaNet.Tests/HudContentProtocolTests.cs`: C# constants, the regenerated `welcome` vector's block,
  layout and round trip, encoder refusals and order, the `welcome_hud_*` vectors' reasons.
- `client-unity/RoguehallaNet.Tests/ProtocolVectorTests.cs`: switch cases for the eleven vectors (additions only).
- `tools/protocol-js/check-vectors.mjs`: `m.hud` equals the Rust JSON for every Welcome; the `welcome` vector's block
  equals the legacy literal; the eleven vectors exist; their JS reasons.
- this brief.

## Existing tests this packet changes (owner approval required; all mechanical)
- Stub commit: `crates/rh-protocol/tests/encode.rs` (an `hud` argument in every `encode_welcome`/`encode_welcome_into`
  call, `hud:` in three `ServerMsg::Welcome` literals; `welcome()` and two calls use `sample_hud()`, the rest an empty
  block); `crates/rh-server/tests/lifecycle.rs` (`hud` in the Welcome destructure and rebuild);
  `crates/rh-server/src/room/ground_tests.rs` and `src/public_ground.rs` tests (one argument each).
- Oracle commit: `crates/rh-protocol/tests/vectors.rs`, `client-unity/RoguehallaNet.Tests/ProtocolVectorTests.cs`,
  `tools/protocol-js/check-vectors.mjs`: additions only.
- `crates/rh-protocol/tests/vectors.rs::committed_vectors_match_the_encoder` is red from the stub commit on (the Welcome
  vectors' `debug` text now prints `hud: WireHudContent { .. }`). Regenerating `v17.json` fixes it.

## Stub notes (to be replaced, not kept)
- `hud_content.rs`: types, constants and `HudTerm` are final; `content_fault` returns None, `content_len` 0,
  `write_content` writes nothing, `read_content` reads nothing.
- `samples.rs`: `sample_hud()` returns an empty block. `projection.rs`: `wire_hud()` returns an empty block.
- C#: `WireHudContent.Length/Write/Read` are no-ops (types, constants, `Term`, `ScalingOf` final).

## 9. Validation commands
- `cargo test -p rh-protocol`, `cargo test -p rh-policy --test hud_content`, `cargo test -p rh-server ground_tests`,
  `cargo test -p rh-server --test lifecycle`
- `cargo run -p rh-protocol --bin protocol-fixtures`, `node tools/protocol-js/check-vectors.mjs`
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`

## 10. Risk and suggested model tier
Opus: a new Welcome section in three decoders with shared refusal vectors.

## 11. Known traps
- `samples.rs` hand-builds Welcome frames (`welcome_map`, `PRE_MAP_LEN`, `welcome_weapon_bytes`, the archetype and
  vision splices): each needs the two empty-block bytes between the weapon table and the map, or every hand-built
  Welcome vector changes its refusal reason. The weapon vectors' splice offsets move by nothing (the block is after them).
- JS `exactJson` compares doubles exactly and keys exactly: `dominant` is a boolean, keys camelCase as above.
- The decoder checks `dominant` and `code` while reading (like the weapon `kind`), values and order after the rows.
- The oracle author verified that a straightforward codec passes every Rust oracle test (scratch implementation, not
  committed).

## Legacy notes (pinned as legacy; flagged)
- `championCombatModel.ts:225` prints `BLAZE_BURN_MS` (2000, the burn DoT) as the "s trail" seconds, while the trail
  field lives `BLAZE_TRAIL_MS` (2500, abilities.ts:160). Pinned: code 12 carries the burn ms the panel prints.
- `championCombatModel.ts:226` prints "floor at 1 HP" as a literal; code 18 carries `LAST_STAND_FLOOR` so Unity need
  not hardcode it.
- `championCombatModel.ts:122` lists terms with coefficient != 0 in ad, ap, hp, def order; `buildModel.ts:204-213` lists
  terms > 0 sorted biggest first and adds "(the higher)": two legacy formats from the same data, both derivable from the
  rows.

## Notes from previous attempts
