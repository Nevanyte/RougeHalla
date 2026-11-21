# P-AUG-NATIVE-5: Marked Man: +50% normal-kill stacks with the half carried, and the holder on every minimap

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 13 (P-CARDS-2/3, P-MOBS-2), under the owner's 2026-11-18 approval of the
  elite and augment rework (`docs/OWNER_DECISIONS.md:13`, row "Elite and augment rework": "Add 'marked man' to the list
  of augments and the plan is perfect"). Plan of record: `docs/backlog/AUGMENT_ELITE_REWORK.md` decision 9 (`:90-93`),
  packet row (`:177`), details (`:255-258`), wave W8, Verification "Live world" (`:333`).
- **Implementer tier:** implementer-opus (sim state and check rule, observation, wire, three decoders, cross-crate:
  `CLAUDE.md` rule 2, `crates/rh-protocol/AGENTS.md`)
- **Reviewer:** reviewer-opus
- **Integration base:** `coord/int-72` @ `4f1a1884a` (all native batch cards and Wish Engine, native chest pools;
  protocol 20, observation 33, policy contract 28, `rh-checkpoint/36`, content `84fb785f2972e59a`).
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10); Marked Man has no legacy implementation (workbook
  "Proposed" card, Augment_Tuning row, `AUGMENT_ELITE_REWORK.md:358`), the base it scales is legacy
  `packages/server/src/sim/mobLife.ts:265` · D2 n/a · D5/D6/D9 none. C-OBS gains one deliberate public fact (below).
- **Shared-file packet:** `observe.rs`, the protocol and its three decoders, `protocol/fixtures/v20.json`, the content
  hash. Gate flags `--regen-fixtures --allow-artefacts`.

## 1. ID and outcome

A `Rework` world offers **Marked Man** in elite chests to every picker. Its holder:

1. **Stacks.** Every normal (non-elite) mob kill credited to the holder pays 1.5 × the legacy 3 stat stacks
   (`REWORK_MARKED_MAN_STACK_MULT`, already registered, `constants.rs:655-656`). Whole stacks are paid at once; the half
   stack is carried in the card's native counter and paid with the next kill: kills pay 4, 5, 4, 5, ... (two kills pay
   9 = 2 × 4.5). Nothing else is multiplied.
2. **Visibility.** While the holder is `Alive`, every observation (every other player, the holder itself, a viewer with
   no seat) carries one public row `{ id, x, y }` for it, the holder's body position at that tick, **whatever the
   viewer's vision** (line of sight, radius, bushes, wards, stealth statuses do not hide it). This is the minimap marker.
   Nothing else about the holder reaches a viewer who cannot see it.

A `Legacy` world, and a `Rework` world where nobody holds Marked Man, are unchanged: the same draws, stacks, state hash
and checkpoint bytes, an observation without the new field in its JSON, and State frames without the new key (so every
wire frame of today's matches is byte-identical; only the version stamps move).

### Decisions (asked of this brief; decided and pinned by the oracle)

1. **Table and offer rule.** Marked Man lives in the zone/generalist table `crates/rh-sim/src/cards/native/zone.rs`
   (where P-AUG-NATIVE-1b put it, `P-AUG-NATIVE-1b.md:58`; `hooks_tests.rs:447` already allows it there). Its `POOL`
   row is `(CardId::MarkedMan, Offer::Any)`: a generalist card, offered to every picker. `augment_pool` appends natives
   in native order, and Marked Man (93) is last, so it joins the Rework offer pool at the end. Rework chest outcomes
   move by design (as P-AUG-NATIVE-4's did); Legacy draws are unchanged (no native is appended there).
2. **The +50% and the carry, exactly.** In `systems/mob_life.rs` `pay`, the `!a.elite` branch (`:546-575`), the amount
   handed to `grant_mob_stat` becomes, for a holder (`Build::native` slot of `MarkedMan` with `count > 0`, under the
   world's card table):
   - `e = kill_stacks × (REWORK_MARKED_MAN_STACK_MULT − 1) + counter` (`kill_stacks` is `farm::DEFINITION.kill_stacks`,
     3; so `e` is 1.5 or 2.0);
   - `whole = floor(e)`, `amount = kill_stacks + whole`, `carry = e − whole` (exact in f64: 0.5 or 0).
   - One `grant_mob_stat(k, w, id, paid, amount)` call; when it pays (`gained > 0`) the slot's `counter` becomes
     `carry`. When it pays nothing (the killer is not standing) the counter is unchanged. The toast reports `gained` as
     today.
   - A non-holder's amount is `kill_stacks` and no native slot is read or written (the pure helper returns
     `(kill_stacks, None)`).
   - Not multiplied: the Rework elite helper share (`:524-545`, `REWORK_ELITE_SHARE_STACKS`, decision 7; it is a share
     of the camp's worth, not a kill's stacks: decision 9 says "only normal-mob kills pay stacks"), player kills (no
     stacks in legacy), hunt stacks, every other source. Flagged for the owner in the hand-off; the oracle pins it.
   - No new draw, event, schedule row or hook: the read is in `pay`, beside the existing grant. The native
     `CreditedKill`/`MobKill` hooks keep firing after it, unchanged.
3. **Check rule and cap.** The carry is `frac(n × 1.5)` for whole `n`, i.e. 0 or 0.5. Register
   `REWORK_MARKED_MAN_CARRY_CAP: f64 = 0.5, "stacks";` in the `content!` registry (append) and point Marked Man's
   `NativeRule` (`table.rs:175-176`, today `counter(0.)`) at it. `native::check` adds Marked Man's exact rule: the
   counter is 0 or exactly the cap (refuse 0.25, 0.75, 1.0, negatives, non-finite), with a test-time assertion that
   `(kill_stacks × (MULT − 1)).fract()` equals the cap so a retune of either number fails loudly. `CHECKPOINT_FORMAT`
   does not move (the slot exists since 1a; only its admitted range widens).
4. **No readout row.** `zone::readouts(MarkedMan)` stays `None`: a half stack is not a HUD number. The holder's own
   `Observation::readouts` stay empty for Marked Man (pinned).
5. **The marker needs the wire; the existing public paths cannot carry it.** The brief asked to reuse the bounty and
   hunt markers. Neither places a player outside vision: `bounty` is a field of a delivered actor row
   (`observe.rs:954`, only inside vision) and of `SeenEvent::Bounty { id, bounty }` (no position); the hunt target is an
   id in the owner's own `SelfView` (`observe.rs:63-65`, `:883`). The roster (State key 12) is public and the same for
   every viewer but by design "carries no position" (`observe.rs:358-360`, ADR0026) and is resent whole on any change.
   Adding the holder to `visible` would leak its hp, weapon, effects and events (every `can_see` filter keys off
   `visible`, `observe.rs:1003-1025`), which decision 9's "nothing else private leaks" forbids. Unity's minimap draws
   only delivered actors (`TacticalMapMarks.cs:12-13`). So this packet adds one public list:
   - **Observation:** `pub marked: Vec<MarkedView>` with `MarkedView { id: PlayerId, x: f64, y: f64 }`
     (`crates/rh-sim/src/observe.rs`), by ascending id, every `Alive` holder of Marked Man, filled for every viewer
     (also a viewer with no seat) beside `roster_into`. `#[serde(default, skip_serializing_if = "Vec::is_empty")]`, so
     an observation without a holder serializes as before the field.
   - **Wire: optional State key 15, `StateItem::Marked(Vec<WireMarked>)`**, layout below, sent on change from an empty
     baseline exactly like key 14 (`collections.rs:780-785`): `next != self.marked || (full && !next.is_empty())`.
     A world without a holder never sends it, not even in a full or forced State.
6. **Protocol number: stays 20, `v20.json` regenerated in place.** 21 is promised to P-COLISEUM-HEALS-2 and the next
   free number to P-TICK-3 (`docs/MIGRATION.md:136-138`), so a bump here would collide. Protocol 20 has never been pushed
   or deployed (`MIGRATION.md:10`, nothing pushed), which is P-WIRE19-B's decision 1 precedent for adding an optional
   key inside an unshipped version. **Coordinator check before merging:** if any protocol-20 build is pushed or deployed
   first, this packet takes the next free number instead (22 if P-TICK-3 has not taken it), with its own fixture file.
7. **Identities.** `OBSERVATION_VERSION` 33 → **34** (`docs/CONTRACTS.md` C-OBS: a new observation field bumps it);
   `POLICY_CONTRACT_VERSION` 28 → **29** (the projected State gains key 15 and the decoded view its rows; precedent
   `rh-policy/src/lib.rs` 26-28). Content hash moves once (the cap constant and the pool row are both folded:
   `native::visit_content`, `mod.rs:543-546`) through `scripts/regolden-content.sh`. Checkpoint, replay and state-hash
   formats do not move.
8. **Bots.** Bots read the same observation (C-OBS), so they receive `marked` too; using it is P-AUG-BOTS-1's or later
   work. Nothing in `rh-policy/src/bots/` changes here.
9. **Unity minimap drawing is NOT in this packet.** The C# decoder and `Collections.Marked` are (the wire rule: all
   three decoders in one branch). Drawing the marker is a Sonnet C# follow-up, proposed as **P-AUG-UI-3**, touching only
   `client-unity/RoguehallaNet/Net/Ui/WorldMarks.cs` (and its synced copy
   `client-unity/UnityProject/Assets/RoguehallaNet/Net/Ui/WorldMarks.cs`) and
   `client-unity/UnityProject/Assets/Scripts/UI/TacticalMapMarks.cs`. None of these is in P-AUG-UI-2's scope
   (`MatchHud.Chest.cs`, `CardDisplayCatalog.cs`, `BuildDrawerEditModeTests.cs`, training-console files).

### Wire layout (State key 15)

`varint key 15, u8 n (0..=32), n × { varint id (nonzero, strictly ascending), u16 x, u16 y }`, positions as actor
positions: `quant::quantize_pos` (1/8 u, LE u16; `dequantize_pos` on read). Bound `n <= rh_protocol::state::MAX_ROSTER`
(32): Marked Man is unique, one row per seated player at most.

| check (decoder, in this order) | Rust | C# | JS (probe) |
|---|---|---|---|
| `n > 32` (before any row) | `BadField("marked count")` | `BadField` | `/marked count/` |
| `id == 0` | `BadField("marked id")` | `BadField` | `/marked id/` |
| `id <= previous id` | `BadField("marked order")` | `BadField` | `/marked order/` |

Every u16 position decodes. The encoder refuses atomically (`EncodeError`, writes nothing): more than 32 rows
(`TooMany { what: "marked", .. }`), id 0 or order (`BadValue`), a position outside `0..=POS_MAX` or NaN
(`BadValue("position")`, as actors). `MAX_STATE_KEYS` 14 → 15; the malformed vectors `state_unknown_key` and
`state_too_many_keys` name 16 (`88 00 01 10`, `88 00 10`). `scene_candidate/mod.rs:465` keeps the literal 13.

Golden vectors the implementer adds to `samples.rs` (server; the oracle holds the exact bytes):
- `state_marked`: tick 220, one key-15 item, rows (2, 100.0, 2000.5), (7, 0.0, 8191.875).
  Hex `88dc01010f02022003843e070000ffff`.
- `state_marked_empty`: tick 220, key 15 with no rows (clears the client's rows). Hex `88dc01010f00`.

Malformed (server), patches of `state_marked` (row 0 id at byte 6, row 1 id at byte 11):

| name | bytes | reason |
|---|---|---|
| `state_marked_count_33` | `88dc01010f21` | marked count |
| `state_marked_id_0` | byte 6 = `00` | marked id |
| `state_marked_order` | byte 11 = `02` (equal to row 0) | marked order |

Shapes: Rust `WireMarked { id: u32, x: f32, y: f32 }` (stubbed); policy `CollectionPublisher.marked`,
`CollectionView::marked() -> &[WireMarked]` (stubbed, returns empty), projection `id = PlayerId.0`,
`x = dequantize_pos(quantize_pos(x as f32))` (so a sub-quantum move is not resent), `complete()` unchanged (keys
1..=13). C#: `struct WireMarked { uint Id; float X; float Y; }`, `sealed class MarkedState : StateItem` (`Key` 15,
`WireMarked[] Rows`, `MaxCount = 32`), `StateKey.Marked = 15`, `StateItem.MaxKeys = (int)StateKey.Marked`;
`Net/Collections.cs` `IReadOnlyList<WireMarked> Marked` (empty until key 15, replaced by each, emptied by `Reset`),
`Apply`'s known-key bound to `StateKey.Marked`, `HasFullState` unchanged; Unity copy by `bash client-unity/sync-net.sh`.
probe.html: `{ key: 15, value: [{ id, x, y }, ...] }`, key and item-count bounds 14 → 15.

## 2. Dependencies

- In the base: P-AUG-NATIVE-1a/1b (slot, rule, hooks, zone table), P-AUG-NATIVE-4 (native pool admission), P-WIRE19-B
  (key 14 and its on-change rule, the template here), P-SYNC-ORIGIN-1 (protocol 20, observation 33, policy 28).
- Parallel: P-AUG-BOTS-1 (`rh-policy` bots: `chests.rs`, `choice.rs`, `planning.rs`, `hunt_adapter.rs`, and a
  `MatchStart` field in `rh-policy/src/lib.rs`) and P-AUG-UI-2 (C# HUD). **Overlap to sequence:** this packet edits
  `rh-policy/src/lib.rs` only at `POLICY_CONTRACT_VERSION`; BOTS-1 edits `MatchStart` in the same file. If BOTS-1 also
  moves the contract, whichever merges second takes 30. No other overlap with UI-2 (decision 9).
- Next: P-AUG-UI-3 (proposed, minimap drawing), P-CI-GREEN-7 (the provenance pin of `check-vectors.mjs`, which this
  packet edits again).

## 3. Relevant legacy paths

- `packages/server/src/sim/mobLife.ts:33, :265`: a credited normal kill grants `MOB_KILL_STACKS` (3) stacks of the
  mob type's stat; elites grant none. Ported at `crates/rh-sim/src/systems/mob_life.rs:546-575` (`grant_mob_stat`,
  `farm.rs:172-193`; `max_count` is 2^53 − 1, so a refusal is only a killer that is not standing).
- Marked Man itself: none (rg "markedMan|Marked Man" over `packages/` finds nothing). Workbook Augment_Tuning row
  "Double stacks from kills; always on the minimap" → "+50% stacks from kills (not double); still always visible"
  (`AUGMENT_ELITE_REWORK.md:358`).
- Minimap: legacy `packages/client/src/ui/minimapMarkers.ts` draws only synced, visible contacts; there is no legacy
  out-of-vision marker to port.

## 4. New paths

- Oracle: `crates/rh-sim/src/systems/mob_life/marked_man_tests.rs`, `crates/rh-sim/tests/marked_man_observe.rs`,
  `crates/rh-protocol/tests/marked_wire.rs`, `crates/rh-policy/tests/marked_man_delivery.rs`.

## 5. Exclusive write scope

- `crates/rh-sim/src/systems/mob_life.rs` (the `!a.elite` grant; not the `mod` lines the stub added)
- `crates/rh-sim/src/cards/native/zone.rs`, `table.rs`, `mod.rs` (`check`, a pure `marked_man_amount` helper or similar)
- `crates/rh-sim/src/constants.rs` (append `REWORK_MARKED_MAN_CARRY_CAP`)
- `crates/rh-sim/src/observe.rs`, `crates/rh-sim/src/observe/hud.rs` (filling `marked`; the stub added the type and
  field), `OBSERVATION_VERSION`
- `crates/rh-protocol/src/state.rs`, `state/item.rs`, `samples.rs`, `scene_candidate/mod.rs`, `lib.rs` (doc lines)
- `protocol/fixtures/v20.json` (only by `cargo run -p rh-protocol --bin protocol-fixtures`)
- `crates/rh-policy/src/delivery/collections.rs`, `delivery/frame.rs`, `delivery/projection.rs`,
  `crates/rh-policy/src/lib.rs` (`POLICY_CONTRACT_VERSION` only)
- `crates/rh-server/src/outbox/scene_candidate/client14_fixture.rs` (the stub's arm), `crates/rh-server/web/probe.html`,
  `tools/protocol-js/check-vectors.mjs` (its key-15 lines move to 16)
- `client-unity/RoguehallaNet/Protocol/StateItem.cs`, `Protocol/StateItemsSocial.cs` (or a new `StateItemsMarked.cs`),
  `Protocol/State.cs`, `Net/Collections.cs`, and their copies under `client-unity/UnityProject/Assets/RoguehallaNet/`
  (only by `bash client-unity/sync-net.sh`)
- Content hash copies, only by `scripts/regolden-content.sh`: `crates/rh-sim/tests/content.rs` `GOLDEN_CONTENT_HASH`,
  the two `tools/unity-browser-reload-proof` `.mjs` files, `BakedContent.cs` (artefact: `--allow-artefacts`),
  `parity/abilities/hash-tape.json` (also records `observationVersion`), `protocol/fixtures/archetypes_v1.json`
- **Version stamps only** (33 → 34, 28 → 29; P-WIRE19-B's implementer moved the same pins): every test that pins
  `OBSERVATION_VERSION` 33 or `POLICY_CONTRACT_VERSION` 28, at least
  `crates/rh-sim/src/reward_chests/trophy_observer_tests.rs:259`, `observe/panel_tests.rs:472`,
  `observe/panel_tooltip_tests.rs:322`, `observe/hud_clock_tests.rs:224`, `observe/readouts_view_tests.rs:210`,
  `crates/rh-sim/tests/frost_wall_observe.rs:372`, `crates/rh-policy/src/frost_tests.rs:84`,
  `crates/rh-policy/tests/wire19_readouts.rs` (last test), `hud_panel_delivery.rs`, `frost_wall_delivery.rs`,
  `hud_clock_delivery.rs`, `hud_delivery.rs`, `hud_roam_terms.rs`, `quest_carrier_delivery.rs`,
  `crates/rh-policy/src/bots/frost_wall_bots_tests.rs` (grep for the two numbers; change nothing else in them)

Not in scope: `crates/rh-policy/src/bots/**`, any Unity drawing (`UnityProject/Assets/Scripts/**`), `Cargo.lock`,
shared records.

## 6. Contracts and references

- C-OBS (`docs/CONTRACTS.md:498-503`): "other actors only within `VISION_RADIUS`". Marked Man is the one deliberate,
  owner-decided exception, and only as `{ id, x, y }`: no actor row, no hp, weapon, effects, events. Proposed contract
  text for the coordinator in the hand-off.
- C-RNG / C-TICK: no draw, no schedule row, no hook link added.
- `AGENTS.md` wire-change rule; `crates/rh-protocol/AGENTS.md` (three decoders, strict keys, refuse-don't-clamp).
- `docs/agent/AUGMENT_REWORK.md` "Setting a cap", "Admission", "Moving the content hash".

## 7. Behaviour to preserve

- Legacy world: every draw, stack, event, observation field (except the version), state hash, checkpoint byte, wire
  frame. Parity fixtures unchanged except the regold's `contentHash` lines.
- Rework world with no holder: stacks 3 per normal kill, no `marked` in any observation JSON, no key 15 on the wire.
- The order inside `pay`: credit, the stat grant (with its toast), settled weapon awards, the native hooks, the
  `mobKilled` chain (`mob_life.rs:509-638`).
- `tests/no_alloc.rs` and `tests/native_no_alloc.rs`: `observe_into` fills `marked` in a caller-owned `Vec` (clear,
  then push; no allocation once warm), like `roster_into`.

## 8. Acceptance checks

- `scripts/gate.sh --quick --oracle packet/P-AUG-NATIVE-5` green, then the coordinator's full gate with
  `--regen-fixtures --allow-artefacts`.
- `cargo run -p rh-protocol --bin protocol-fixtures` leaves `v20.json` holding `state_marked`, `state_marked_empty` and
  the three malformed vectors; `dotnet test client-unity/RoguehallaNet.Tests` and `node tools/protocol-js/check-vectors.mjs`
  decode them (the waived provenance pin stays the only red of the chain).
- `scripts/regolden-content.sh --check` clean.

## Oracle files (read-only for implementers)

- `docs/backlog/packets/P-AUG-NATIVE-5.md`
- `crates/rh-sim/src/systems/mob_life/marked_man_tests.rs`
- `crates/rh-sim/tests/marked_man_observe.rs`
- `crates/rh-protocol/tests/marked_wire.rs`
- `crates/rh-policy/tests/marked_man_delivery.rs`
- oracle-amend `crates/rh-sim/tests/native_cards.rs` (Marked Man's counter cap 0 → `REWORK_MARKED_MAN_CARRY_CAP`)
- oracle-amend `crates/rh-protocol/tests/wire19_readouts.rs` (`MAX_STATE_KEYS` 15; the first unknown key is 16)
- oracle-amend `crates/rh-protocol/tests/hud_wire.rs` (`MAX_STATE_KEYS` 15)
- oracle-amend `crates/rh-policy/src/delivery_tests.rs` (State key 16 is the unknown one)
- oracle-amend `client-unity/RoguehallaNet.Tests/Wire19ReadoutTests.cs` (key 16 unknown; the two moved vectors)
- oracle-amend `crates/rh-sim/src/reward_chests/native_pool_tests.rs` (the faction-offer sweep over four room seeds,
  floors 32 and 65; coordinator decision below)

Existing tests that pin what this packet changes (each amended above, or a version stamp in the write scope):
`tests/native_cards.rs:248` (cap 0); `rh-protocol/tests/wire19_readouts.rs:76, :217-275` and `hud_wire.rs:236`
(`MAX_STATE_KEYS` 14, key 15 unknown); `rh-policy/src/delivery_tests.rs:537` ("State 15 is still unknown");
`Wire19ReadoutTests.cs:124-125, :179-180`; `tools/protocol-js/check-vectors.mjs:162-166` (a tool, implementer edits);
the version stamps listed in section 5. Tests that hold and must stay green: `native_cards.rs` "observed as one who does
not" (no Marked Man in `held_rows`), `native_pool_tests.rs` (generic over `pool_members`), `hooks_tests.rs:447`.

### Conflict for the coordinator (resolved 2026-11-20)

Measured by the oracle author on `packet/P-AUG-NATIVE-5` with only the `POOL` row `(CardId::MarkedMan, Offer::Any)`
added (then reverted): `crates/rh-sim/src/reward_chests/native_pool_tests.rs:168`
(`a_faction_native_is_offered_only_to_an_all_that_faction_chest_and_legacy_offers_none`, P-AUG-NATIVE-4's floor
`own[f] >= 10`, "Measured 15..=23 of 400") goes red: own-card counts over its one seeded 400-chest sweep become
Plague 19, **Fire 8**, Frost 18, Sentenced 13 (the Any-native counts 26, 24, 25, 32 still clear their floor of 20).
One more Any card in the pool reshuffles that seed's draws and dilutes each faction card; Fire's 8 is a tail of one
seed, not a broken offer rule. The floor is a knife edge for any pool growth. This brief does **not** amend it (loosening
an existing floor is the coordinator's and owner's call): options are an `oracle-amend` lowering the floor (e.g. to 5,
still a positive control against "never offered"), or a sweep over several room seeds with a summed floor. Every other
red of the probe run is the content-hash family that `scripts/regolden-content.sh` moves (`tests/content.rs`
`hash_golden`, `frost_wall_content.rs`, `regolden_content.rs`, `barriers_reach_tests` / `barriers_readers_tests`
golden guards, `hash_tape`) and this packet's own oracles.

**Coordinator decision (2026-11-20): do not lower the floor; make the sweep robust.** Amended in its own
`oracle-amend:` commit: the sweep runs four room seeds (5, 6, 7, 8; 1600 chests per faction) and sums. Measured own-card
counts Plague/Fire/Frost/Sentenced: 67/61/66/64 without Marked Man pooled, 70/53/60/54 with it; `OWN_FLOOR` 32 (about
60% of 53). Any-native counts 125/128/113/132 and 109/108/115/127; `ANY_FLOOR` 65 (about 60% of 108). Every
never-to-another-faction, never-to-a-mixed-chest and Legacy assertion is unchanged. The floor holds before and after
the implementer adds the row. **Policy contract:** 30 for this packet (P-AUG-BOTS-1 takes 29 and merges first); the
coordinator moves this oracle's 29 pins to 30 when rebasing.

## 9. Validation commands

- `export PATH="$HOME/.cargo/bin:$PATH"; cargo test -p rh-sim --lib marked_man; cargo test -p rh-sim --test marked_man_observe`
- `cargo test -p rh-protocol --test marked_wire; cargo test -p rh-policy --test marked_man_delivery`
- `cargo run -p rh-protocol --bin protocol-fixtures`; `bash client-unity/sync-net.sh`; `scripts/regolden-content.sh`
- `scripts/gate.sh --quick --oracle packet/P-AUG-NATIVE-5 --regen-fixtures --allow-artefacts`

## 10. Risk and suggested model tier

Opus: a hashed native slot's admitted range and its exact check rule, an observation field that must not allocate, a
cross-language wire key, and the content regold. The mechanics are small; the breadth is the risk.

## 11. Known traps

- The carry must only move when the grant pays; a killer that is not standing keeps its carry.
- `e` must be computed as `kill_stacks × (MULT − 1) + counter` and split with `floor`; 1.5 and 0.5 are exact in f64,
  so `counter` stays bit-exactly 0 or 0.5 and the restore check can demand equality.
- The marker is the holder's `Alive` position for **every** viewer, including the holder and an unseated viewer; it
  ignores vision, bushes and stealth by design. A holder that is `Dead`, `Mia` or in the `Lobby` has no row.
- `can_see` (`observe.rs:1003`) and every event filter must keep reading `visible`, never `marked`.
- The policy publisher must compare quantized rows, or a moving holder is resent on every sub-quantum move.
- `Build::set(id, 0)` zeroes the whole slot (guide "State"): losing the card drops the carry.

## Notes from previous attempts
