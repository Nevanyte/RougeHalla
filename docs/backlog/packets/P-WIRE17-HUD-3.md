# P-WIRE17-HUD-3: protocol 17 carries the room's minimum players and the owner's healing and wind-emblem end times

- **Serves:** owner direction 2026-11-10 (MIGRATION checkpoint, decision 7: the HUD presents what legacy presents);
  gaps recorded by the oracle of P-UNITY-HUD-STATUS-1 ("Not on the wire") and P-UNITY-HUD-TERRAIN-1 ("RESTING")
- **Implementer tier:** implementer-opus (observation, wire format, four parsers, cross-crate)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10: one worked sanity test per fact); golden vectors
  required for a wire change · D2 n/a · D5/D6/D9 none
- **Status:** oracle committed on `packet/P-WIRE17-HUD-3` (oracle author, 2026-11-12). Re-checked against the merged
  tree (HUD-2b and HUD-2c landed after the first draft of this brief: observation 27, policy contract 21).

## 1. ID and outcome
Three legacy HUD texts cannot be drawn because their facts are not sent: "Waiting for players n/min" (the room's minimum
players), "Healing xN Ns" (when the running healing potions end) and "+50% speed · Active Ns" (when the wind emblem's
boost ends). Still protocol 17, `v17.json` regenerated. When this lands:
- State key 1 (the owner's inventory, already owner-only and already carrying `potions_healing`, the "xN") appends the
  two end times, each optional (absent when not running).
- State key 9 (the public arena lifecycle view, already carrying `lobby_ends_at`, the "run starts in Ns") appends the
  room's minimum players.
- The C# client exposes them on `CollectionsView` (`InventoryView.HealingUntil`, `.SpeedBoostUntil`,
  `ArenaView.MinPlayers`).

**Cut (oracle author, 2026-11-12):** the Unity call sites (`SlotText.HealingStatus(count, until, now)`, the wind-emblem
timer, `PhaseLine`'s "/min") move to a follow-up Unity packet (proposed **P-UNITY-HUD-STATUS-2**, implementer-sonnet):
they have no failing oracle here, and this packet is already a four-parser wire change. The "RESTING" chip needs no wire
(see "Rest state"); it goes to the same Unity packet.

## 2. Dependencies
- P-WIRE17-HUD-2, -2b, -2c merged (same decoders and fixtures). Strictly serial with any other packet touching
  `observe.rs`, `item_view.rs`, `state.rs`, `samples.rs`, `probe.html`, `State.cs` or the scene-candidate fixtures.

## 3. Relevant legacy paths (read by the oracle author)
- `packages/client/src/ui/hud.ts:44` "Waiting for players `${playerCount}/${minPlayers}` — run starts in
  `fmtSeconds(lobbyEndsAt - serverNow)`"; `:193` reads `state.minPlayers`. `packages/shared/src/schema.ts:349`
  `minPlayers: uint8` on the public RaidState; `packages/server/src/sim/world.ts:899` `state.minPlayers =
  opts.config.minPlayers`; `packages/server/src/config.ts:228` `MIN_PLAYERS` env, default `MIN_PLAYERS_TO_START` = 2
  (`packages/shared/src/constants.ts:130`).
- `packages/client/src/ui/weaponBar.ts:144-148`: `healingUntil > serverNow ? "Healing" + (healing > 1 ? " x" + healing :
  "") + " " + ceil((healingUntil - serverNow) / 1000) + "s"`; `speedBoostUntil > serverNow ? "+50% speed" : "Walk over
  emblems"` and `"Active " + ceil((speedBoostUntil - serverNow) / 1000) + "s"`. Schema `schema.ts:148-151`
  (`healingUntil`, `potionsHealing`, `speedBoostUntil`, uint32 ms; legacy syncs them on the player row to everyone).
- `packages/server/src/sim/consumables.ts:67` `healingUntil = now + POTION_HEAL_MS` ("the newest potion always ends
  last"); `:81,:89` zeroed when the fighter falls or the last potion ends; `:93-94` `speedBoostUntil` zeroed once `<=
  now` or not alive; `:141` zeroed on `fighterOut`; `:164` `speedBoostUntil = now + SPEED_BOOST_MS`.
  `constants.ts:652,:657`: both 5000 ms.
- Rest chip: `packages/client/src/render/zoneArt/terrainFeedback.ts:51` (rule), `:89-94` (chip), `:116-158`
  (`CombatMemory`); server `packages/server/src/sim/terrainEffects.ts:112-164` (`lightPass`, the 3 s lockout,
  one summed `heal` fx per second).

## Field table (decided; the tests pin it)
| Fact | Legacy | Rust source | Carrier | Why there |
|---|---|---|---|---|
| Healing end | weaponBar.ts:147, consumables.ts:67 | `Player.healing_until` (`crates/rh-sim/src/state.rs:553`, set `systems/potions.rs:84`, zeroed `:118,:139,:152`) | `Inventory.healing_until: Option<f64>` (`item_view.rs`) -> `WireInventory.healing_until`, State key 1 | Key 1 is the owner's own consumable group (built only from the viewer's player, `item_view.rs:500`) and already carries `potions_healing`, the "xN" of the same text. It is re-sent only when it changes (a drink or the end), unlike key 13's panel. Key-13 panel codes cannot hold it: their i32 quanta of 1e-4 overflow at server time 214 748 ms. |
| Speed boost end | weaponBar.ts:146,148, consumables.ts:164 | `Player.speed_boost_until` (`state.rs:596`, set `systems/wind.rs:87`, zeroed `:138,:148`) | `Inventory.speed_boost_until: Option<f64>` -> `WireInventory.speed_boost_until`, key 1 | As above; the boost sits in the same consumables row of the legacy weapon bar. |
| Room minimum players | hud.ts:44, world.ts:899 | `SimConfig::min_players` (`crates/rh-sim/src/statics.rs:210`; the room's `--min-players`, `crates/rh-server/src/runtime.rs:166`, or `MAX_PLAYERS` under matchmaking timing, `bot_fill.rs:192`) | `ArenaView.min_players: u32` (`systems/planning/view.rs`) -> `WireArena.min_players: u8`, key 9 | Key 9 is the projection of legacy's public RaidState lifecycle (`lobby_ends_at` is the same line's countdown), present while the source lifecycle runs (training has no lobby line: `hud.ts:42`). A Welcome field would move the Welcome header or HUD block in all four parsers, every hand-built Welcome vector (`samples.rs` `PRE_MAP_LEN`), `MapBlobGroundTests` offsets and the reload-proof parser; key 9 changes one State key in three parsers and costs one byte per arena send. Public: every viewer gets the same value (C-OBS: room configuration). |

Values: end times are server milliseconds as the sim holds them (f64, as `WireArena`'s timers), `None` exactly when the
sim holds 0 (legacy's "not running"). The projection copies them unchanged; Unity prints `ceil((t - serverNow) / 1000)`.
No rule is computed from them in Unity (R-AUTH).

## Rest state (finding: no wire field)
Legacy's "RESTING" chip is **client-derived from facts legacy already sent**, not a server fact
(`terrainFeedback.ts:51`): `resting = surface heal share > 0 at the fighter's tile (light) && player && alive &&
(healing || (!combat && hurt))`, where `combat` is a client `CombatMemory` of `hit` fx with an attacker in the last
`HEAL_LOCKOUT_SECONDS` (3 s) involving the fighter, and `healing` is a `heal` fx on it in the last 1.5 s
(`HEAL_SHOWN_MS`). Unity already receives every input: the terrain plane (`MapBlob.Terrain`, light = code 7) under the
predicted position, `WireSelf.status`, `hp`/`max_hp`, and the droppable fx `WireFx::Hit { victim, by }`,
`WireFx::SigHit`, `WireFx::Heal { id }` (the Rust light pass emits one summed `Event::Heal` per player per second,
`crates/rh-sim/src/systems/terrain/mod.rs:160-169`, as legacy `lightPass`). So the smallest correct choice is to send
nothing and derive it as legacy did: the follow-up Unity packet ports `terrainStates`' rest rule and `CombatMemory`.
Notes for it: under the live `terrain::Mode::All` the sim passes no faction (`systems/terrain/mod.rs:19`), so the Holy
"RESTING x2" never happens live (`restBoost` is 1); a hit whose attacker is redacted arrives with `by = u32::MAX` (legacy
counted only `by !== null`); the server's own lockout clock is `w.terrain.combat_at` (`terrain/mod.rs:126-130,:144-149`).

## Wire layout (Rust `crates/rh-protocol/src/state.rs`; types final in the stub). Little-endian.
- **Key 1** (when present): `active_slot u8, weapon u8 x2, potion_small u8, potion_large u8, potions_healing u8`
  (unchanged), then **`healing_until` opt f64, `speed_boost_until` opt f64** (each: `00`, or `01` + f64).
  Encoder (`check`): either value non-finite or negative -> `EncodeError::BadValue("inventory clock")`. Decoder: the
  potion counts are still checked as soon as they are read (`state_bad_potion_count` keeps its reason), then each clock:
  a non-finite or negative value -> `BadField("inventory clock")`; a flag other than 0/1 -> `BadTag` (the codec's `opt`).
  0 and `f64::MAX` are accepted (finite, non-negative), as the arena timers.
- **Key 9** (when present): unchanged fields, then **`min_players u8`** after `started_with`. `MAX_MIN_PLAYERS` = 32 (=
  `MAX_ROSTER`; a match seats at most 8, matchmaking timing sets 8). Encoder: `> 32` -> `BadValue("arena")`; decoder:
  `BadField("arena")` (the existing `WireArena::valid` reasons). A frame ending before the byte: `Truncated`.
- Projection (`crates/rh-policy/src/delivery/collections.rs`): `inventory()` copies both clocks; `arena()` carries
  `min_players`; a value over 32 (including any `u32` past 255) is refused through the encoder, never clamped or
  wrapped (`u8::try_from(..).unwrap_or(u8::MAX)` then the check refuses, or a fallible `arena()`).
- Sim (`crates/rh-sim/src/item_view.rs:500`): `healing_until: (me.healing_until != 0.).then_some(me.healing_until)` and
  likewise `speed_boost_until`; `systems/planning/view.rs` `arena_view`: `min_players` from `k.config.min_players`
  (saturating to u32). Read-only: no sim state, schedule row or RNG draw changes; every state hash is unchanged.

## Parsers to update (four hand-written; the reload-proof parser is untouched)
| Parser | File | Change |
|---|---|---|
| Rust | `crates/rh-protocol/src/state.rs` | key 1 `len`/`check`/`write`/`read` for the clocks; `WireArena::{valid, len, write, read}` for `min_players` |
| C# | `client-unity/RoguehallaNet/Protocol/State.cs` (+ `Net/Collections.cs`, then `bash client-unity/sync-net.sh`) | key 1 read/write/check; `ArenaState` read/write/check (`MinPlayers <= WireArena.MaxMinPlayers`); `CollectionsView` copies the three values. **Trap:** `InventoryState.Check` runs after the whole item is read, so with the clocks appended `state_bad_potion_count` (`... 06 00 00`, frame ends after the counts) would decode as `Truncated`; check the potion counts before reading the clocks (as Rust and JS do) |
| JS probe | `crates/rh-server/web/probe.html` | key 1 object gains `healingUntil`, `speedBoostUntil` (in that order, after `potionsHealing`; `null` when absent; error message containing `inventory clock`); key 9 object gains `minPlayers` after `startedWith` (error containing `min players` when > 32) |
| JS reload proof | `tools/unity-browser-reload-proof/wire-metadata.js` | none: it parses only Hello and the Welcome prefix; the Welcome layout does not change |

## Vector names (generated by `samples.rs`, read by the Rust, C# and JS decoders)
Server (positive):
- **new** `state_inventory_clocks`: State tick 216, key 1 only: active slot 1, slots `[Some(0), Some(2)]`, small 3,
  large 1, healing 2, `healing_until` 15050, `speed_boost_until` 17000.
- **new** `state_inventory_speed_boost`: the same with healing 0, `healing_until` None, `speed_boost_until` 17000.
- `state_all` (and every vector with key 1): both clocks None (two `00` bytes appended).
- `state_planning`: its arena gains `min_players` 2 (legacy `MIN_PLAYERS_TO_START`).
- `state_all_max_budget`: inventory clocks `f64::MAX` both, arena `min_players` 32; the frame stays 247,696 bytes (the
  prop-label padding absorbs the 19 new bytes; checked on the scratch implementation).
- Every other vector carrying key 1 or key 9 changes bytes only by the appended fields.

malformedServer:
| Name | Bytes | Rust | C# | JS |
|---|---|---|---|---|
| `state_inventory_healing_nan` | `88 00 01 01 01 00 00 00 00 00 00` + `01` + f64 NaN + `00` | BadField("inventory clock") | BadField | /inventory clock/ |
| `state_inventory_healing_negative` | same base + `01` + f64 -50 + `00` | BadField("inventory clock") | BadField | /inventory clock/ |
| `state_inventory_boost_infinite` | same base + `00 01` + f64 +inf | BadField("inventory clock") | BadField | /inventory clock/ |
| `state_inventory_clock_truncated` | same base + `01` + the first 4 bytes of f64 1.0 | Truncated | Truncated | /./ |
| `state_arena_min_players_over` | `88 00 01 09 01` + 24 zero bytes + `00 00 00` + 8 zero bytes + `00` + `21` (33) | BadField("arena") | BadField | /min players/ |
| `state_arena_min_players_missing` | the same without the last byte | Truncated | Truncated | /./ |

(`state_bad_potion_count` keeps its bytes and its reason in all three decoders.)

## Identities
- Move (implementer): `OBSERVATION_VERSION` 27 -> 28 (`crates/rh-sim/src/observe.rs:20`: `Inventory` and `ArenaView`
  gain fields); `POLICY_CONTRACT_VERSION` 21 -> 22 (`crates/rh-policy/src/lib.rs:48` and its pin at `:1894`: the projected
  inventory and arena carry them); the pin `crates/rh-sim/src/reward_chests/trophy_observer_tests.rs:259` 27 -> 28.
- Do not move: `PROTOCOL_VERSION` 17 (owner approved stamping 18 on the next deployed build as a separate step),
  `CHECKPOINT_FORMAT` (31), `REPLAY_FORMAT` (25), content hash 4674a176a28e3c7a (no content change), `MAX_STATE_KEYS`.

## SHARED RECORDS (coordinator)
- `parity/abilities/hash-tape.json` `observationVersion` 27 -> 28: regenerate with
  `cargo test -p rh-sim --features trusted-status-probes --lib record_ability_hash_tape -- --ignored` (protected path).
  Until then `abilities::source_tests::hash_tape` is red on the implementer's branch; expected, as for HUD-2c.
- MIGRATION checkpoint identities: observation 28, policy contract 22.

## 4. New paths
- tests only (see "Oracle files"). Regenerated by documented commands, never hand-edited:
  - `protocol/fixtures/v17.json`: `cargo run -p rh-protocol --bin protocol-fixtures`
  - `protocol/fixtures/scene-candidate/full14.json` (its State frames carry keys 1 and 9; the C#
    `SceneCandidate*` tests, `tools/scene-candidate/check.mjs` and the rh-server socket tests read it):
    `RH_SCENE_FIXTURE_OUT=$PWD/protocol/fixtures/scene-candidate/full14.json cargo test -p rh-server --lib
    native_fixture_roundtrip_and_explicit_export`
  - `protocol/fixtures/scene-candidate/client14.json`: `RH_SCENE_CLIENT14_FIXTURE_OUT=$PWD/protocol/fixtures/scene-candidate/client14.json
    cargo test -p rh-server --lib client14_fixture_actual_receiver_acceptance_and_rejections`

## 5. Exclusive write scope
- `crates/rh-sim/src/item_view.rs` (fill the clocks), `crates/rh-sim/src/systems/planning/view.rs` (`min_players`),
  `crates/rh-sim/src/observe.rs` (`OBSERVATION_VERSION` only), `crates/rh-sim/src/reward_chests/trophy_observer_tests.rs:259`
  (pin only); `crates/rh-sim/src/state.rs` only if a visibility change is needed (none expected: `item_view` is in the crate)
- `crates/rh-protocol/src/state.rs` (codec), `crates/rh-protocol/src/samples.rs` (two new server vectors, six malformed
  vectors, `state_planning` 2, max budget values)
- `crates/rh-policy/src/delivery/collections.rs` (projection), `crates/rh-policy/src/lib.rs` (`POLICY_CONTRACT_VERSION`
  and its pin)
- `client-unity/RoguehallaNet/Protocol/State.cs`, `client-unity/RoguehallaNet/Net/Collections.cs`, then
  `bash client-unity/sync-net.sh` (synced copies under `client-unity/UnityProject/Assets/RoguehallaNet/`)
- `crates/rh-server/web/probe.html` (JS decoder)
- `protocol/fixtures/v17.json`, `protocol/fixtures/scene-candidate/{full14,client14}.json` (regenerated only, commands
  above)
- Not in scope: `crates/rh-sim/src/mapgen/`, `crates/rh-mapdress/` (other agents), the Welcome, Unity UI, bots (no
  decision reads the new fields; the Brain's `hud.minPlayers` stays undefined, pinned by
  `compose14/tests.rs:215`).

## 6. Contracts and references
- C-OBS: the end times come from the viewer's own `Player` and travel in that seat's key 1; another seat's key 1 carries
  its own (none running) and an unseated viewer has no key 1 (`hud_clock_tests.rs`). Legacy synced both clocks to every
  client on the player row; sending them to the owner only is narrower than legacy and hides nothing the owner lacks.
  The room minimum is public room configuration, identical for every viewer.
- C-NET / ADR 0011: appended fields in protocol 17, Rust, C# and JS in one branch, vectors regenerated.
- R-AUTH: Unity prints the times and the minimum; it computes no rule from them.

## 7. Behaviour to preserve
- No schedule row, RNG draw, sim state or state hash change; `item_view` stays allocation-free (`tests/no_alloc.rs`,
  observation no-alloc tests green).
- Every other vector keeps its bytes; `state_bad_potion_count` keeps its reason in all three decoders.
- Key 1 is still re-sent only when it changes (now also when a clock starts or ends).

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-WIRE17-HUD-3 --regen-fixtures` passes (full), except
  `abilities::source_tests::hash_tape` until the coordinator regenerates the tape (SHARED RECORDS).
- `node tools/protocol-js/check-vectors.mjs`, `node tools/scene-candidate/check.mjs`,
  `node tools/scene-candidate/check-client14.mjs`, `dotnet test client-unity/RoguehallaNet.Tests`,
  `bash client-unity/sync-net.sh --check` pass on the regenerated fixtures.
- The oracle author checked that a straightforward implementation (the layout above, the projection copies, the sim
  fills, `samples.rs` vectors) passes every Rust (`rh-protocol`, rh-sim `observe::` and the trophy pin, `rh-policy`),
  JS and C# protocol oracle (scratch, not committed). With `v17.json` regenerated the C# reds were the
  `state_bad_potion_count` trap above and the scene-candidate tests reading the old `full14.json` / `client14.json`;
  with the trap fixed and both scene fixtures regenerated by their commands, `dotnet test` (1772), `check-vectors.mjs`,
  `tools/scene-candidate/check.mjs` and `check-client14.mjs` all passed.

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/observe/hud_clock_tests.rs` (new; mod line in the stub): a potion drunk on the tick at t0 + 50 ends
  at t0 + 5050; a second one 1 s later moves the end to its own + 5000 with two running; absent once none runs; an
  emblem picked up at t reports t + 5000 and is absent after expiry; C-OBS guard (another seat, unseated); arena
  `min_players` 1/3/8 for seated and unseated viewers; `OBSERVATION_VERSION` 28.
- `crates/rh-protocol/tests/hud_clock_wire.rs` (new): key-1 layout byte for byte and round trips (each clock alone,
  both, 0 and `f64::MAX`); encoder and decoder refusals (NaN, +/-inf, negative); the old layout and partial clocks are
  `Truncated`; key-9 layout, bounds 0..=32, refusals 33/255, old layout `Truncated`; the two new server vectors; the
  new values in `state_all`, `state_planning`, `state_all_max_budget` (still 247,696 bytes); the six malformed vectors
  byte for byte with their reasons.
- `crates/rh-protocol/tests/vectors.rs`: reason arms for the six malformed vectors (additions only).
- `crates/rh-policy/tests/hud_clock_delivery.rs` (new): the projection copies the clocks bit for bit (absent stays
  absent) and the minimum; NaN/inf/negative clocks and minimums over 32 (33, 256, `u32::MAX`) are encode errors; a
  clock change re-sends key 1 alone; identities 28/22.
- `client-unity/RoguehallaNet.Tests/HudClockProtocolTests.cs` (new): C# layout, round trips, encoder refusals, decoder
  refusals, old layouts `Truncated`, `WireArena.MaxMinPlayers`, `CollectionsView` exposure, the regenerated vectors.
- `client-unity/RoguehallaNet.Tests/ProtocolVectorTests.cs`: switch cases for the six malformed vectors (additions
  only).
- `tools/protocol-js/check-vectors.mjs`: `state_all` key 1 gains `healingUntil:null,speedBoostUntil:null`;
  `state_planning` `minPlayers` 2; the two new vectors decode exactly; max-budget clocks and minimum; reasons for the
  six malformed vectors.
- Identity pins moved 27 -> 28 / 21 -> 22 (see below).
- this brief.

## Existing tests this packet changes (owner approval required; all mechanical)
- **Stub commit** (editable by the implementer, no behaviour): struct literals gain the new fields with placeholder
  values (`None` / 0): `crates/rh-protocol/tests/state.rs`, `crates/rh-protocol/src/samples.rs` (3 literals),
  `crates/rh-policy/src/{bots/wish_module_tests.rs, delivery/trade_tests.rs, delivery/collections.rs (test module),
  bots/hazards/tests.rs, bots/temporal_percept/brain/{brain_input_tests.rs, compose14.rs (test helper),
  compose14_review_tests.rs, compose14_tests.rs, compose14/reconcile_tests.rs}}`,
  `crates/rh-server/{src/outbox/scene_candidate/fixture.rs, tests/percept_witness.rs}`, `crates/rh-sim/src/item_view.rs`
  (test literal). `Inventory` and `WireInventory` lose `Eq` (they hold f64 now); nothing needed it.
- **Oracle commit** (read-only): identity pins 27 -> 28 (observation) and 21 -> 22 (policy contract) in
  `crates/rh-sim/src/observe/panel_tests.rs:451`, `crates/rh-sim/src/observe/panel_tooltip_tests.rs:322`,
  `crates/rh-policy/tests/hud_delivery.rs:80,85`, `crates/rh-policy/tests/hud_panel_delivery.rs:65,70`,
  `crates/rh-policy/tests/hud_roam_terms.rs:47,52`; `tools/protocol-js/check-vectors.mjs` `state_all` key-1 literal
  (two keys appended).
- Implementer (in scope): `crates/rh-sim/src/reward_chests/trophy_observer_tests.rs:259` (27 -> 28),
  `crates/rh-policy/src/lib.rs:1894` (21 -> 22).
- Red from the stub commit on, until the implementer's work and the regenerated fixtures:
  `crates/rh-protocol/tests/vectors.rs::committed_vectors_match_the_encoder` (the vectors' debug text prints the new
  fields).

## Stub notes (to be replaced, not kept)
- `state.rs`: `WireInventory.{healing_until, speed_boost_until}`, `WireArena.min_players`, `MAX_MIN_PLAYERS` final; the
  codec neither writes, reads nor checks them (reads fill `None` / 0).
- `item_view.rs` fills `None`; `planning/view.rs` fills 0; `collections.rs` projects `None` / 0.
- `samples.rs`: placeholders `None` / 0 in the three literals (`state_all`, max budget, `state_planning`).
- C#: `WireInventory.{HealingUntil, SpeedBoostUntil}`, `WireArena.{MinPlayers, MaxMinPlayers}`,
  `InventoryView.{HealingUntil, SpeedBoostUntil}`, `ArenaView.MinPlayers` exist; the codec and `CollectionsView` ignore
  them.

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --lib observe::`,
  `cargo test -p rh-sim --features trusted-status-probes --test content`, `cargo test -p rh-sim --test no_alloc`
- `cargo test -p rh-protocol`, `cargo test -p rh-policy`, `cargo test -p rh-server` (scene-candidate fixtures)
- the three regeneration commands in "New paths", `node tools/protocol-js/check-vectors.mjs`,
  `node tools/scene-candidate/check.mjs`, `node tools/scene-candidate/check-client14.mjs`
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`

## 10. Risk and suggested model tier
Opus: an observation identity, two State keys in three decoders, two extra Rust-generated fixtures.

## 11. Known traps
- C# checks key 1 after reading the whole item: keep `state_bad_potion_count` a `BadField` (see the parser table).
- `None` is the sim's 0, not "past": an end time already reached but not yet cleared by the sim (wind clears at `<= now`
  in its system) is sent as is; Unity shows the text only while `t > serverNow`, as legacy.
- JS key order matters (`JSON.stringify` comparisons): `healingUntil`, `speedBoostUntil` after `potionsHealing`;
  `minPlayers` after `startedWith`.
- The scene-candidate fixtures embed whole State frames: regenerate them, never patch them.
- `observe.rs`, `state.rs`, `samples.rs` and `probe.html` are shared: this packet merges alone.

## Legacy doubts (pinned as legacy; flagged)
- `schema.ts:148-151`: legacy syncs `healingUntil` / `speedBoostUntil` on the public player row to every client; the
  port sends them to the owner only (key 1). Narrower than legacy, nothing the HUD needs is lost (only the owner's own
  weapon bar reads them). Not a behaviour change of the game; no DEVIATIONS row proposed, the reviewer may ask for one.
- Matchmaking lobby timing (`crates/rh-server/src/bot_fill.rs:192`, owner direction 2026-11-10, not legacy) sets the
  sim's `min_players` to `MAX_PLAYERS` (8) so humans never close the lobby early; the line then reads "n/8". That is
  what the room enforces; pinned as such (`SimConfig::min_players`, whatever the room built).
- `consumables.ts:67` gives the latest potion's end, not the earliest: "Healing x2 4s" while an older potion ends
  sooner. Pinned (the newest ends last).

## Notes from previous attempts
