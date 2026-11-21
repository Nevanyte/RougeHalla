# P-WIRE19-B: protocol 19, part 2: the owner's own native readout rows on the wire (State key 14)

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 13 (P-CARDS-2/3, P-MOBS-2), under the owner's 2026-11-18 approval of the
  elite and augment rework (`docs/OWNER_DECISIONS.md:13`, row "Elite and augment rework"; plan in scope "Add own-card
  readouts (counters and pips)", `docs/backlog/AUGMENT_ELITE_REWORK.md:11`). Plan of record: packet row P-WIRE19-B
  (`AUGMENT_ELITE_REWORK.md:174`), wire lane WIRE19-A → WIRE19-B, wave W7, Verification "Wire" (`:324`); consumer
  P-AUG-UI-2 (`:176`, details `:247-254`: "HUD counters and pips"). The MIGRATION approval covers "protocol 19"
  (`docs/MIGRATION.md:214`).
- **Implementer tier:** implementer-opus (wire, cross-crate, cross-language: `CLAUDE.md` rule 2, `crates/rh-protocol/AGENTS.md`)
- **Reviewer:** reviewer-opus
- **Integration base:** `coord/int-67` @ `d837d7652` (P-AUG-NATIVE-1b and P-WIRE19-A merged: protocol 19, observation
  31, policy contract 26, content `a03745630efa1c12`).
- **D-rules touched:** D1 n/a (no legacy mechanic: the protocol is Rust-native and the native cards are new; the oracle
  is golden vectors) · D2 n/a · D5/D6/D9 none. C-OBS is the rule this packet must keep.
- **Shared-file packet:** protocol, the three decoders, `protocol/fixtures/v19.json`, `observe.rs`. Gate flag
  `--regen-fixtures`.

## 1. ID and outcome

When this packet lands, a player who holds native cards in a Rework world receives, in its own State frames, one row per
readout its cards declare (P-AUG-NATIVE-1b's producer `cards::native::readouts`): the card, what the row shows
(counter, meter or marks), the value and its maximum. Nobody else receives them: not another player, not a spectator,
not a public snapshot. A Legacy world, and a Rework player who holds no native card, never sends the new key at all, so
every frame of today's matches is byte-identical.

1. **Observation.** `Observation` gains `pub readouts: Vec<rh_sim::cards::native::Readout>`, filled beside `out.build`
   (the owner's card counts, `crates/rh-sim/src/observe.rs:806`) from `cards::native::readouts(sim, viewer).rows()`,
   the viewer's own rows in native order (empty for a non-player, a non-holder and every Legacy world). Serialized with
   `#[serde(default, skip_serializing_if = "Vec::is_empty")]`, so an observation without rows serializes and hashes
   exactly as before the field (only the version moves).
2. **Wire: State key 14, `StateItem::Readouts(Vec<WireReadout>)`.** `WireReadout { card: u8, kind: u8, value: f64,
   max: f64 }`, layout below. `MAX_STATE_KEYS` 13 → 14.
3. **Delivery.** `CollectionPublisher` (`crates/rh-policy/src/delivery/collections.rs`) projects
   `observation.readouts` to key 14 (`card = CardId::index()`, kind code 0 counter, 1 meter, 2 marks, value and max
   unchanged, bit for bit) and sends key 14 **only when the rows differ from what the client holds**, from an empty
   baseline: `next != self.readouts || (full && !next.is_empty())`. A client's readouts start empty on every Welcome,
   so a viewer without rows is never sent key 14, not even in a full or forced State.
4. **Every decoder:** Rust (`rh-protocol`), C# (`client-unity/RoguehallaNet`, Unity copy by `bash client-unity/sync-net.sh`),
   JS (`crates/rh-server/web/probe.html`). The decoded-frame views keep the rows: rh-policy `CollectionView::readouts()`,
   C# `Collections.Readouts`. Neither view requires key 14 for completeness (`CollectionView::complete`,
   `Collections.HasFullState`).

### Decisions (asked of this brief; decided and pinned by the oracle)

1. **Protocol stays 19; `v19.json` is regenerated in place.** P-WIRE19-A decision 6 reserved key 14 inside protocol 19
   on the condition that no WIRE19-A-only build is deployed. Nothing has been pushed or deployed since WIRE19-A merged
   into `coord/int-67` (the MIGRATION approval covers "protocol 19" as one change; no deploy is recorded). A WIRE19-A
   client would refuse key 14 (`state_unknown_key`), but such a client never ships: the server's version refusal
   (`crates/rh-server/src/conn.rs:126-135`, any Hello other than 19 gets `ProtocolMismatch`) stays exactly as WIRE19-A
   left it, and the oracle pins `PROTOCOL_VERSION == 19`. **Coordinator check before merging:** if any build of
   `coord/int-67` (or later, before this packet) is deployed or pushed for a client, this packet bumps to 20 instead,
   with a new `v20.json`, and `v19.json` becomes history.
2. **A new key, not a longer key 5.** Key 5 (`WireBuild`, 80 + 8 bytes) is a fixed array the three decoders read
   blind; appending a variable list there would change every full State frame. Key 14 is new, optional and
   change-only, so no existing vector or frame changes bytes.
3. **Key 14 is optional, sent on change from an empty baseline (decision for "a Legacy world sends none").** The
   alternative, key 14 in every full State, would add `0e 00` to every full frame and move pins in every crate that
   counts a full State's keys. Consequences the implementer must carry: rh-policy `CollectionView::complete()` stops
   at key 13 (the `seen` array still has a slot for key 14, which is not required); the scene-candidate
   experiment's complete-scene count (`crates/rh-protocol/src/scene_candidate/mod.rs:465`, `items.len() == 11 ||
   items.len() == MAX_STATE_KEYS`) keeps meaning "keys 1..=13" (use the literal 13, not the moved constant); C#
   `HasFullState` keeps keys 1..=11.
4. **Row encoding.** `u8 card` is the `CardId::index()` of a **native** card, 80..=93 (`CardId::NATIVE`); a catalog
   card (0..=79) never has a readout and is refused, as is 94 and above. `u8 kind` 0 counter, 1 meter, 2 marks
   (`ReadoutKind` order); 3 and above refused. `value` and `max` are f64 LE, unquantized (the producer's own numbers:
   a Tally counter is 0.003 per stack, so a HUD quantum would lose stacks; at most 28 × 18 bytes). A row is valid
   when both are finite and `0 <= value <= max` (the native `check_world` caps keep every slot inside its cap; marks
   count only the rule's bits). Rows come in native order: `card` never decreases (two rows of one card are allowed,
   `MAX_READOUTS = 28` is two per card); a decrease is refused. At most 28 rows (`rh_protocol::state::MAX_READOUTS`,
   equal to `rh_sim::cards::native::MAX_READOUTS`; the policy oracle pins the equality).
5. **Identities.** `PROTOCOL_VERSION` stays 19 (decision 1). `OBSERVATION_VERSION` 31 → **32**: CONTRACTS
   (`docs/CONTRACTS.md:523`) says any new observation field bumps it. `POLICY_CONTRACT_VERSION` 26 → **27**: the
   projected State gains key 14 and the decoded view gains the rows (precedent: versions 19-26, each a projection
   change bots do not decide on, `crates/rh-policy/src/lib.rs:41-57`). The checkpoint format, replay format, content
   hash and state hash do not move (no state, no content row). The oracle pins 32 and 27 exactly: no other W7 packet
   (NATIVE-4, BOTS-1) changes the observation or the projection; if one does and merges first, this packet takes the
   next numbers and the coordinator amends the two pins.
6. **`readout.rs` shape.** `Readout` and `ReadoutKind` gain `serde::Serialize, serde::Deserialize` (the Observation
   derives them), nothing else; the stub does it. P-AUG-NATIVE-2/3 edit `cards/native/{weapon,zone,table}.rs`, not
   `readout.rs`, so there is no overlap.
7. **The two moved malformed vectors.** `state_unknown_key` was `88 00 01 0e` (key 14) and `state_too_many_keys` was
   `88 00 0e` (14 keys); both name 15 now (`88 00 01 0f`, `88 00 0f`), names and reasons unchanged.

### Wire layout (State key 14)

`varint key 14, u8 n (0..=28), n × { u8 card (80..=93), u8 kind (0..=2), f64 value, f64 max }` (18 bytes a row).

Decoder checks, in this order, with the reason each decoder gives:

| check | Rust | C# | JS (probe) |
|---|---|---|---|
| `n > 28` (before any row) | `BadField("readout count")` | `BadField` | `/readout count/` |
| `card < 80 or > 93` | `BadField("readout card")` | `BadField` | `/readout card/` |
| `kind > 2` | `BadField("readout kind")` | `BadField` | `/readout kind/` |
| `value` or `max` not finite, `value < 0`, `value > max` | `BadField("readout value")` | `BadField` | `/readout value/` |
| `card` below the previous row's | `BadField("readout order")` | `BadField` | `/readout order/` |

The encoder refuses the same rows (`EncodeError`, atomically: a refused frame writes nothing; C# `EncodeException`).

Golden vectors the implementer adds to `samples.rs` (server; the oracle holds their exact bytes):
- `state_readouts`: tick 220, one key-14 item, five rows: (80 Marksman's Tally, counter, 0.12, 0.3),
  (81 Bastion, meter, 40, 250), (85 Pathfinder, counter, 3.6, 24), (85 Pathfinder, marks, 3, 20),
  (93 Marked Man, counter, 0, 1).
  Hex: `88dc01010e055000b81e85eb51b8be3f333333333333d33f510100000000000044400000000000406f405500cdcccccccccc0c4000000000000038405502000000000000084000000000000034405d000000000000000000000000000000f03f`
- `state_readouts_empty`: tick 220, key 14 with no rows (it clears the client's rows). Hex: `88dc01010e00`

Malformed (server), each a patch of `state_readouts` (row `i` starts at byte `6 + 18 i`: card, kind, value, max):

| name | patch | reason (table above) |
|---|---|---|
| `state_readouts_count_29` | `88dc01010e1d` (n 29, no rows) | readout count |
| `state_readouts_card_79` | row 0 card 79 | readout card |
| `state_readouts_card_94` | row 4 card 94 | readout card |
| `state_readouts_kind_3` | row 1 kind 3 | readout kind |
| `state_readouts_value_nan` | row 0 value NaN | readout value |
| `state_readouts_value_negative` | row 0 value -0.5 | readout value |
| `state_readouts_value_over_max` | row 1 value 250.5 | readout value |
| `state_readouts_max_infinite` | row 1 max +inf | readout value |
| `state_readouts_order` | row 2 card 80 (after 81) | readout order |

### JS and C# shapes

- probe.html: key 14's item is `{ key: 14, value: [{ card, kind, value, max }, ...] }` (keys in that order); the key
  bound and the item-count bound move from 13 to 14.
- C#: `struct WireReadout { byte Card; byte Kind; double Value; double Max; }`, `sealed class ReadoutsState : StateItem`
  (`Key` 14, `WireReadout[] Rows`, `MaxCount = 28`), `StateKey.Readouts = 14`, `StateItem.MaxKeys =
  (int)StateKey.Readouts`; `Net/Collections.cs` `IReadOnlyList<WireReadout> Readouts` (empty until a key-14 item
  arrives, replaced by each one, emptied by `Reset`), and `Apply`'s known-key bound moves to `StateKey.Readouts`.
- Rust policy: `CollectionPublisher.readouts`, `CollectionView::readouts() -> &[WireReadout]`.

## 2. Dependencies

- In the base: P-AUG-NATIVE-1b (`cards::native::readouts`, `Readout`, `ReadoutKind`, `MAX_READOUTS = 28`; Marksman's
  Tally and Bastion are the two cards whose rows exist today) and P-WIRE19-A (protocol 19, observation 31, policy 26).
- Parallel (W7): P-AUG-NATIVE-4 and P-AUG-BOTS-1. Neither may touch `observe.rs`, the protocol, the decoders or the
  delivery projection; batch packets add readout rows only through their own tables (`readout_sources`), which this
  packet carries without change.
- Next: P-AUG-NATIVE-5 (Marked Man, `observe.rs`), P-AUG-UI-2 (the HUD reads `Collections.Readouts`), P-CI-GREEN-7
  (the card provenance pin of `tools/protocol-js/check-vectors.mjs`, waived until then; this packet edits that file
  again).

## 3. Relevant legacy paths

None: the binary protocol is Rust-native (legacy Colyseus has none) and the native cards and their readouts are the
owner's rework (P-AUG-NATIVE-1a/1b section 3).

Rust and client sites (base `d837d7652`):
- Producer: `crates/rh-sim/src/cards/native/readout.rs:8` (`MAX_READOUTS`), `:11-28` (`ReadoutKind`, `Readout`),
  `:75-110` (`readouts`: Rework only, the viewer's own slots, native order, no allocation); rows today: Tally counter
  (`cards/native/weapon.rs:60-66`), Bastion meter 0.
- Observation: `crates/rh-sim/src/observe.rs:28` (`OBSERVATION_VERSION = 31`), `:296-334` (`Observation`), `:529-559`
  (`Default`), `:786-808` (`observe_with_tiles`: buffers cleared, `out.build` at `:806`), `:1115-1144` (test modules).
- Wire: `crates/rh-protocol/src/state.rs:26` (`MAX_STATE_KEYS = 13`), `:235-251` (`StateItem`);
  `src/state/item.rs:6-22` (`key`), `:23-63` (`encoded_len`), `:64-185` (`check`), `:186-242` (`write`), `:243-385`
  (`read`; unknown key `:383`), `:388-446` (`check_items`, the item list read); `src/lib.rs:176-183` (re-exports), `:208`
  (`PROTOCOL_VERSION = 19`); `src/scene_candidate/mod.rs:465` (complete-scene count); `src/samples.rs:5623`
  (`state_unknown_key`), `:5733` (`state_too_many_keys`), `:1371-1372` (`state_all`, `state_all_max_budget`, which stay
  as they are); `src/bin/fixtures.rs`.
- Delivery: `crates/rh-policy/src/delivery/collections.rs:18-34` (`CollectionPublisher`), `:674-778` (`prepare`),
  `:781-805` (`commit`); `src/delivery/frame.rs:47-64` (`CollectionView`, `seen`), `:112-114` (`complete`), `:117-145`
  (`apply`); `src/lib.rs:56-58` (`POLICY_CONTRACT_VERSION = 26`).
- Server: `crates/rh-server/src/outbox/scene_candidate/client14_fixture.rs:132-195` (exhaustive `StateItem` match; the
  stub adds the arm), `fixture.rs:380-385` (`experiment_state` keeps keys 1..=11; key 14 never occurs there).
- C#: `client-unity/RoguehallaNet/Protocol/State.cs:245` (`StateKey`), `StateItem.cs:13` (`MaxKeys`), `:239-391`
  (`ReadAll`; unknown key `:385`), `StateItemsSocial.cs:61-175` (`RosterState`, `BuildSummaryState`: the model);
  `Net/Collections.cs:336-347` (`Summary`, `KnownStateMask`, `HasFullState`), `:364-369` (`Reset`), `:371-…` (`Apply`;
  known-key bound `:376`).
- JS: `crates/rh-server/web/probe.html:983` (item count `> 13`), `:993` (key `> 13`), `:1108-1113` (keys 10-13).

## 4. New paths

- Oracle files (below). No generated file is new: `protocol/fixtures/v19.json` is regenerated in place.

## 5. Exclusive write scope

Production:
- `crates/rh-protocol/src/{state.rs, state/item.rs, lib.rs, scene_candidate/mod.rs, samples.rs}` (the stub added
  `WireReadout`, the constants and the variant; the implementer writes the bytes, checks, reads, the two vectors, the
  nine malformed vectors and the two moved ones; a new `src/state/readout.rs` beside the other key files is allowed).
- `protocol/fixtures/v19.json`: only by `cargo run -p rh-protocol --bin protocol-fixtures` (gate `--regen-fixtures`).
- `crates/rh-sim/src/observe.rs`: the field's fill beside `out.build` and the `OBSERVATION_VERSION` line.
- `crates/rh-sim/src/cards/native/readout.rs`: only if the fill needs a helper (the stub already added the derives).
- `crates/rh-policy/src/delivery/{collections.rs, frame.rs}`, `crates/rh-policy/src/lib.rs` (`POLICY_CONTRACT_VERSION`
  and its doc line).
- `crates/rh-server/src/outbox/scene_candidate/client14_fixture.rs` (the key-14 arm, if its JSON shape needs more than
  the stub's), `crates/rh-server/web/probe.html`.
- `client-unity/RoguehallaNet/Protocol/{State.cs, StateItem.cs, StateItemsSocial.cs}`,
  `client-unity/RoguehallaNet/Net/Collections.cs`, and their Unity copies through `bash client-unity/sync-net.sh` only.
- `parity/abilities/hash-tape.json`: its `observationVersion` line, by its documented recorder only
  (`cargo test -p rh-sim --lib record_ability_hash_tape -- --ignored`, or `scripts/regolden-content.sh`); no case fold
  may change.

Version-stamp moves in existing tests (mechanical, listed for the owner; nothing else in these tests changes):

| File:line | Pins today | Becomes |
|---|---|---|
| `crates/rh-sim/src/observe/{hud_clock_tests.rs:224, panel_tooltip_tests.rs:322, panel_tests.rs:472}`, `src/reward_chests/trophy_observer_tests.rs:259`, `tests/frost_wall_observe.rs:373` | `OBSERVATION_VERSION == 31` | 32 |
| `crates/rh-policy/src/frost_tests.rs:84`, `src/bots/frost_wall_bots_tests.rs:806`, `tests/{hud_roam_terms.rs:47/52, hud_delivery.rs:80/85, hud_panel_delivery.rs:65/70, hud_clock_delivery.rs:73/78, frost_wall_delivery.rs:19/24, quest_carrier_delivery.rs:64/69}` | observation 31, policy contract 26 | 32, 27 |

(`first_pick_view_tests.rs:310` and `wire19_rewards.rs:123` read `> 30` and `> 25`: they stay.)

Out: `docs/CONTRACTS.md`, `docs/MIGRATION.md` (coordinator: observation 32, policy contract 27, protocol 19 with key 14),
`hosting/**`, `BakedContent.cs`, `protocol/fixtures/v18.json` and older, `cards/native/{weapon,zone,faction,table,mod}.rs`
(the batch packets'), every oracle file below.

## 6. Contracts and references

- **C-OBS.** The rows are the viewer's own: built from the viewer's own native slots (`readouts(sim, viewer)`), carried
  only in that viewer's observation and its own State frames, never in a public snapshot, a spectator's or another
  seat's view. Another player's native state does not change one byte of a viewer's observation. The codec encodes only
  the filtered view and refuses (never clamps) an invalid row (`crates/rh-protocol/AGENTS.md`).
- C-NET, ADR 0002/0010/0011 (append-only), `crates/rh-protocol/AGENTS.md` (regenerate, three decoders in one branch),
  `client-unity/AGENTS.md` (library first, then `sync-net.sh`).
- C-DET / C-RNG / C-TICK: no state, draw or schedule change; `readouts` allocates nothing and the observation reuses its
  buffer (`out.readouts.clear()` then extend).

## 7. Behaviour to preserve

- Every existing vector byte except `state_unknown_key` and `state_too_many_keys` (decision 7); `state_all` and
  `state_all_max_budget` byte-identical (the max-budget frame plus 28 maximal readout rows still fits
  `MAX_SERVER_FRAME`; the oracle checks it without changing the vector).
- Every State frame of a Legacy world and of a Rework player without native cards (no key 14).
- The observation of every viewer without rows serializes and hashes as today, except `version` (32).
- `state_hash`, checkpoints, replays, content hash, the ability hash tape's case folds, pools, draws.
- Keys 1-13 of every decoder; `HasFullState` and `CollectionView::complete` semantics for keys 1..=13.

## 8. Acceptance checks

- `scripts/gate.sh --quick --regen-fixtures --oracle packet/P-WIRE19-B` passes (JS vectors, reload-proof tests, C#
  tests and the Unity copy check, `rh-protocol`, `rh-sim`, `rh-policy`, `rh-server`, `rh-load` tests, parity report).
- `git diff packet/P-WIRE19-B -- protocol/fixtures/v18.json` is empty.
- `git diff packet/P-WIRE19-B -- parity/abilities/hash-tape.json` changes only `observationVersion`.
- `node tools/provenance/check-card-chain.mjs` stays red only on the `tools/protocol-js/check-vectors.mjs` pin (waived
  until P-CI-GREEN-7).

## Oracle files (read-only for implementers)

New oracle tests (`oracle:` commit):
- `crates/rh-protocol/tests/wire19_readouts.rs`: `PROTOCOL_VERSION == 19`, `MAX_STATE_KEYS == 14`, `MAX_READOUTS ==
  28`, kind codes 0/1/2 (count 3), key 14; the two vectors' exact bytes from values, `encoded_len`, round trip, every
  prefix refused; key 14 after key 13 with 28 maximal rows; `state_all_max_budget` plus 28 maximal rows still fits
  `MAX_SERVER_FRAME`; the encoder refuses (atomically) 29 rows, cards 0/79/94, kind 3, NaN/±inf value or max, a
  negative value, value over max and a card decrease, and accepts value = max, value 0 = max 0, two rows of one card;
  the decoder's reasons for the nine patches (section 1 table) and key 15 unknown, 15 keys refused; `v19.json` is
  protocol 19, carries both vectors with the brief's hex, the nine malformed names (each refused), and the moved
  `state_unknown_key` (`8800010f`) and `state_too_many_keys` (`88000f`).
- `crates/rh-sim/src/observe/readouts_view_tests.rs`: each viewer's `Observation::readouts` is exactly
  `readouts(sim, viewer).rows()` (holder 1: Tally counter 0.12 and Bastion meter 40 with their caps; holder 2: its own
  Bastion 7; a non-holder and a non-player: none); two worlds that differ only in player 1's native numbers give
  players 2, 3 and a non-player byte-equal observations, and player 1 observations that differ only in `readouts`;
  `observe_into` on a reused buffer replaces the rows each tick and clears them for another viewer; Legacy and
  native-free observations have no rows and serialize without a `readouts` key, a holder's serializes and round-trips;
  `OBSERVATION_VERSION == 32`.
- `crates/rh-policy/tests/wire19_readouts.rs`: the publisher projects Tally, Bastion and Pathfinder rows as
  `(80, 0, 0.12, 0.3), (81, 1, 40, 250), (85, 2, 3, 20)`, key 14 last; a viewer without rows never gets key 14 over 39
  ticks including the first and a forced State; a holder gets it on the first State, not when unchanged, again on a
  changed value and on a forced State, an empty list once when the rows go, nothing after, and again after
  `reconnect`; `CollectionView` is complete without key 14 and keeps the rows it receives; `rh_protocol` and `rh_sim`
  `MAX_READOUTS` are equal; observation 32, policy contract 27.
- `client-unity/RoguehallaNet.Tests/Wire19ReadoutTests.cs`: protocol 19, `StateKey.Readouts == 14`, `MaxCount == 28`;
  the vectors encode from values and decode to their rows, re-encode byte for byte, every prefix refused; the encoder
  refuses the invalid rows (`EncodeException`) and accepts the boundary ones; the decoder refuses the nine patches as
  `BadField`, key 15 as `BadField`, 15 keys; `Session.Collections.Readouts` is empty before key 14, holds the five
  rows in order after it, and is cleared by the empty vector; `v19.json` carries the vectors, the nine malformed names
  (each `BadField`) and the two moved ones.

Amended existing tests (`oracle-amend:` commits, one file each, for the owner):
- `crates/rh-protocol/tests/hud_wire.rs:235`: `MAX_STATE_KEYS` 13 → 14 ("key 14 is the newest state key").
- `crates/rh-protocol/tests/v4.rs:278`: the undefined key is 15 (was 14).
- `crates/rh-protocol/tests/vectors.rs`: the nine `state_readouts_*` malformed reasons.
- `client-unity/RoguehallaNet.Tests/ProtocolVectorTests.cs`: the same nine names, `BadField`.
- `tools/protocol-js/check-vectors.mjs`: the nine reasons; the probe decodes the two vectors to exact items
  (`{key:14,value:[{card,kind,value,max}]}`), refuses the nine patches for their reasons, key 15 and 15 keys, accepts
  value = max; the fixture's `state_unknown_key` and `state_too_many_keys` name 15. (Card provenance pin waived until
  P-CI-GREEN-7.)
- `crates/rh-sim/src/cards/native/exemplars_tests.rs` (`readouts_show_each_owner_its_own_native_cards_only`): the
  observation carries the viewer's own rows and, apart from them, equals the native-free world's (was: equal).
- `crates/rh-sim/src/barriers_reach_tests.rs` (`observation_digest`): `0x2a3b_dc86_9b6d_5f4d`, the switch-off
  observation's digest at observation 32 (measured on the stub with the version forced to 32; only the version moved).

The brief: `docs/backlog/packets/P-WIRE19-B.md`.

Stub (`stub:` commit, the implementer's to edit): `crates/rh-protocol/src/{state.rs, state/item.rs, lib.rs}`
(`WireReadout`, `MAX_READOUTS`, `READOUT_KIND_*`, `StateItem::Readouts` refused by `check`), `crates/rh-sim/src/observe.rs`
(`Observation::readouts`, always empty; the `mod readouts_view_tests` line), `crates/rh-sim/src/cards/native/readout.rs`
(serde derives), `crates/rh-policy/src/delivery/{collections.rs, frame.rs}` (no-op arms, `CollectionView::readouts`
empty), `crates/rh-server/src/outbox/scene_candidate/client14_fixture.rs` (the arm), C# `Protocol/{State.cs,
StateItemsSocial.cs}`, `Net/Collections.cs` (`WireReadout`, `StateKey.Readouts`, `ReadoutsState` refusing, `Readouts`
empty) and their Unity copies.

Red at the oracle commits (stub in place), each on an assertion or a stub refusal: every Rust test of
`wire19_readouts.rs` (13 vs 14; the stub encoder refuses key 14; `BadField("state key")` vs the readout reasons; no
vector in `v19.json`), five of five `readouts_view_tests` (no rows observed; observation 31), the policy tests that need
key 14 sent or kept and the version pins, five of seven `Wire19ReadoutTests` (the two green ones pin constants and the
`BadField` refusals the stub already gives), `check-vectors.mjs` (no `state_readouts` vector), `hud_wire.rs`
(13 vs 14), `exemplars_tests` (no rows), `barriers_reach_tests` (observation 31's digest).

## 9. Validation commands

- `cargo run -p rh-protocol --bin protocol-fixtures`, `bash client-unity/sync-net.sh`
- `cargo test -p rh-protocol --test wire19_readouts`, `cargo test -p rh-policy --test wire19_readouts`,
  `cargo test -p rh-sim --features trusted-status-probes --lib observe::readouts_view_tests`
- `dotnet test client-unity/RoguehallaNet.Tests --filter "FullyQualifiedName~Wire19ReadoutTests|FullyQualifiedName~ProtocolVectorTests"`
- `node tools/protocol-js/check-vectors.mjs` (and the other `check-*.mjs`), `node --test tools/unity-browser-reload-proof/*.test.mjs`

## 10. Risk and suggested model tier

implementer-opus, reviewer-opus: three decoders and two decoded-frame views in one branch, a fixture regeneration, a
C-OBS rule on an owner-only list, an optional key that two completeness rules must ignore, and version stamps in two
crates. The logic is small; the risks are a decoder that drifts by one check order, a publisher that sends key 14 in a
Legacy full frame, and a `seen` array that makes key 14 required.

## 11. Known traps

- **`seen[(key - 1)]`** in `CollectionView::apply` indexes by key: with `MAX_STATE_KEYS = 14` it has room for key 14,
  but `complete()` must check keys 1..=13 only, or every Legacy bot's view never completes.
- **The scene-candidate count** (`scene_candidate/mod.rs:465`) compares with `MAX_STATE_KEYS`; moved to 14 it would
  refuse every committed 13-key scene. Use the literal 13 (its comment is already stale: "1..=12").
- **The two moved malformed vectors**: `state_unknown_key` (key 14 → 15) and `state_too_many_keys` (14 → 15); the C#
  `Count(ref r, MaxKeys)` and the probe's `n > 13` move with them. `crates/rh-protocol/tests/v4.rs:278` pins
  `[0x88, 0, 1, 14]` as unknown: amended to 15 by this oracle.
- **Check order** is part of the vectors: count, then per row card, kind, value/max, order. `state_readouts_card_94`
  sits on row 4 (after 85), so only the card check can catch it; `state_readouts_order` puts 80 after 81 with valid
  values.
- **Delivery equality** compares f64 rows; `WireReadout` derives `PartialEq` (a NaN never reaches it: the observation
  is checked by the encoder, which refuses it before commit).
- **Serde skip**: without `skip_serializing_if = "Vec::is_empty"` every observation digest moves
  (`barriers_reach_tests.rs` `observation_digest`, amended here for version 32 only).
- **No `const` in `rh-sim` test or source files** for this packet: the content registry counts every `const` under
  `src` (`barriers_reach_tests.rs:365-366`); `MAX_READOUTS` already has its `NON_GAMEPLAY` row.
- **`no_alloc`**: `out.readouts` is a reused `Vec` (clear, then extend from the fixed `Readouts`); never collect a new one.
- **C# `HasFullState`** must not include key 14; `Collections.Reset` empties `Readouts`.
- **The probe's item objects**: `{card, kind, value, max}` in that order (the JS oracle compares `JSON.stringify`).
- Do not commit `BakedContent.cs`, Showcase fonts or `ShaderGraphSettings.asset` if a Unity run rewrites them.

## Notes from previous attempts
<!-- Coordinator appends on escalation: tier, branch, the gate's failure block. Nothing else. -->
