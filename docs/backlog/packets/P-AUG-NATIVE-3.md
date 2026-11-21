# P-AUG-NATIVE-3: native augments Pathfinder, Hazard Walker and Overflow (zone batch table, live world only)

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 13 (P-CARDS-2/3), under the owner's 2026-11-18 approval of the elite and
  augment rework (`docs/OWNER_DECISIONS.md:12`, row "Elite and augment rework"; plan of record
  `docs/backlog/AUGMENT_ELITE_REWORK.md`, packet row P-AUG-NATIVE-3, Appendix A rows "Pathfinder", "Hazard Walker",
  "Overflow"). No other OWNER_DECISIONS row names these cards.
- **Implementer tier:** implementer-sonnet. No hook is missing (section 1.5 checks each). Two seams are new reads, not
  hooks (Pathfinder's walk, Hazard Walker's terrain and max hp); if the implementer finds a read cannot be made without a
  new hook or a schedule row it stops and the packet goes to Opus.
- **Out of scope: Wish Engine.** It shortens the Wish cooldown, which needs a redesign of the Wish restore envelope
  (`abilities/checkpoint.rs`, Opus). It is **P-AUG-NATIVE-3b**, written separately. Wish Engine stays inert here: no
  handler, no readout, not in `zone::POOL`, and no change to `abilities/`.
- **Reviewer:** reviewer-opus (terrain, barrier and max-hp reads inside the tick).
- **Integration base:** `coord/int-67` @ `d837d7652` (P-AUG-NATIVE-1b hooks, batch tables, readouts; P-WIRE19-A). Gate
  runs take `--base coord/int-67`.
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10): one test per card through the real hooks, a mid-count
  restore, a native-free world unchanged · D2 n/a · D5/D6/D9 none (no wire, no observation change; readouts are produced
  sim-side, P-WIRE19-B carries them). Parallel packets: P-AUG-NATIVE-2 (`weapon.rs`), P-WIRE19-B (`observe.rs`,
  protocol). Keep out of their files.

## 1. ID and outcome

Three of the 14 native augments get behaviour. When this lands (all under `AugmentRule::Rework`; a Legacy world and a
Rework world without these cards play byte-identically to the base):

1. **Pathfinder** (workbook Augment_Tuning "+1.2% per type, cap 24%; collection shown on the map"; Augments "First kill
   of each of the 20 mob types"). On `NativeEvent::MobKill { mob_type }` the first kill of each NORMAL (non-elite) type
   sets that type's bit in `marks` (bit i = position in `MobTypeId::ALL`; `NATIVE_RULES` Pathfinder `marks` already holds
   the 20 normal bits) and `counter = min(REWORK_PATHFINDER_CAP, REWORK_PATHFINDER_PER x popcount(marks))`. A repeat, an
   elite type and a non-holder change nothing. The counter is a move-speed share: the holder's walk multiplier is
   `(1 + counter)` times what it is today. Readout rows: `[Source::Counter, Source::Marks]`.
   - **The speed read** is `crate::modifiers::movement` (`modifiers/mod.rs:576`, the registered stage
     `buffs.moveSpeedMult`, `schedule.rs:1231-1235`): it returns `mirrors().speed_mult` for players; multiply by
     `1 + counter` for a Pathfinder holder (one guard through `hooks::holds_native`-style check on the player's build; a
     non-holder pays one branch). `systems/walk_hint.rs` folds the same registered chain, so the walk hint follows. No
     schedule row, no refold, no cached mirror.
   - **Flag (client):** the wire speed mirror (`modifiers.wire`, read by `client-unity/RoguehallaNet/Net/LocalMotion*.cs`)
     does not include the counter, so local walk prediction runs up to 24% slow and the server corrects it. Fixing it
     means a refold on every new mark (`recompute`, which needs `k`, not available in a handler) or wiring the share into
     the mirror: a later packet with the coordinator's decision. Not done here.
2. **Hazard Walker** (Augment_Tuning "Faster growth, cap 15; immunity after 20 s on each hazard"; Augments "Each second on
   a zone hazard (ember, bog, ice) -> resistance to it plus a little max HP"). The workbook gives no growth, resistance or
   hp number: **decisions, all registered content rows** (owner signs them via DEVIATIONS), appended to `constants.rs`
   after `REWORK_BASTION_METER_CAP`:

   | Row | Value | Meaning |
   |---|---|---|
   | `REWORK_HAZARD_WALKER_STACK_MS: f64` | 1000., "ms" | one stack per second of hazard time ("Hazard seconds -> resistance") |
   | `REWORK_HAZARD_WALKER_RESIST_PER: f64` | 0.04, "share" | each stack resists the hazard by 4% (15 stacks: 60%) |
   | `REWORK_HAZARD_WALKER_HP_PER: f64` | 0.005, "share" | each stack adds 0.5% of base max hp (15 stacks: 7.5%) |

   State (slot layout fixed by 1a): `meters[h]` = ms stood on hazard h (0 ember, 1 bog, 2 ice), capped at
   `REWORK_HAZARD_WALKER_IMMUNE_MS`; `marks` bit h = immune to h; `counter` = stacks =
   `min(REWORK_HAZARD_WALKER_CAP, floor((meters[0] + meters[1] + meters[2]) / STACK_MS))`, always a whole number. On
   `NativeEvent::HazardTick { hazard, ms }` the handler adds `ms` to `meters[hazard]` (capped), sets the mark when the meter
   reaches the cap, recomputes `counter` and, when it changed, calls `modifiers::sync_max_hp`.
   - **Ember** (`terrain/mod.rs` `burn_dt`, `:84`, burn `share` before the ledger hit): `share x (1 - resist)`, resist =
     `RESIST_PER x counter`; immune (mark bit 0): the tick is skipped before the ledger hit (`continue`), so no hook
     fires and the meter stays at its cap.
   - **Bog** (`terrain/mod.rs` `bog_read`, `:57`, which `bog` and the dt-0 `bog_value` share): the slow `m` becomes
     `1 - (1 - m) x (1 - resist)`; immune (mark bit 1): 1.
   - **Max hp** (`modifiers/mod.rs:564` `sync_max_hp`): `faction.hp x max_hp_mult + card_tank_hp + faction.hp x
     HP_PER x counter` (a native flat-hp term from `cards::native`, shared later with Corpse Hoarder).
   - **Same tick:** the hook fires after the tick's damage, so a tick's damage uses the stacks and mark from before it; the
     tick that fills the meter is still resisted, not immune.
   - **Ice effect: pinned only as counting.** The `HazardTick` for ice (read in `terrain::bog`'s `native_hazards`, `:41`,
     once per standing player and tick; confirmed by `hazard_walker_counts_each_hazard_second...`, which stands idle
     on each hazard for 40 ticks) feeds the meter, stacks and mark. The ice slip itself (no slip when immune, resisted
     slip) would need reads in `systems/movement.rs:71,102` and `walk_hint.rs:176` (`terrain::at(..).accel`) in the walk
     hot path: not in this packet. Proposed as **P-AUG-NATIVE-3c** (Opus or Sonnet at the coordinator's call). Until then
     the immune mark for ice is earned but does nothing.
   - Readout rows: `[Counter, Meter(0), Meter(1), Meter(2)]`.
3. **Overflow** (Augment_Tuning "Fades over 8 s", was 5 s; Augments "Healing beyond max HP becomes a shield that fades
   over 5 s", cap "Shield cap"). On `NativeEvent::Overheal { amount }` (the excess beyond max hp; `heal.rs:69-77`) the
   holder gains a barrier of `amount`, clamped to the existing G6 cap `BARRIER_MAX_SHARE x max_hp` (**decision: the
   "Shield cap" is the G6 cap, no new row**; `NATIVE_RULES` Overflow stays `counter(0)`, pinned by
   `tests/native_cards.rs:243`). It uses the heal barrier that exists (`vitals.barrier`, `barrier_until`,
   `barrier_decays`; `systems/buffs.rs:36` `grant_heal_barrier`, `:51` `expire`), with the fade of an Overflow holder
   changed from 5 s to `REWORK_OVERFLOW_FADE_MS` (8 s): the deadline is `now + 8000` and the decay per second is
   `BARRIER_MAX_SHARE x max_hp / 8` (linear, a full barrier lasts 8 s). **The holder's fade applies to every barrier it
   holds** (a Second Skin barrier too: decision, simplest and checkpoint-safe; flagged). No readout, no state.
4. **Check rules** (`native::check`, `cards/native/mod.rs:267`; the batches' own exact rules):
   - Pathfinder: `|counter - min(cap, PER x popcount(marks))| < 1e-9`.
   - Hazard Walker: `counter` whole and `<= min(cap, floor(sum(meters) / STACK_MS))`. Deliberately an inequality: the
     existing `tests/native_cards.rs` pins states that an equality would refuse (`held_rows` counter 3 with 21.5 s of
     meters, and its one-leaf hash perturbations `counter 2`, `meters[1] 1501`, `marks 0b011`); those tests stay as they
     are. The exact derivation is pinned by play (`hazard_walker_counts...`).
5. **Hooks needed, checked against 1b's table** (`docs/agent/AUGMENT_REWORK.md` "Native hooks"): Pathfinder `MobKill`
   (`mob_life.rs:591`), Hazard Walker `HazardTick` (`terrain/mod.rs:136` ember, `:51-55` bog and ice), Overflow
   `Overheal` (`heal.rs:69`). All present. **Reading flags:** (a) the bog hook fires inside `bog`, once per player per
   tick, only when `bog_read`'s `counts` (speed != 1); the dt-0 `bog_value` fires none (confirmed: no hook call there);
   (b) the ice hook fires from the same `bog` call when `k.hazards.slip` and `terrain::at(..).accel > 0` (a Frost player
   never slips: `terrain.rs:61`); (c) the ember hook is skipped for Fire players (`terrain.rs:59`) and for dummies; (d)
   `Overheal` fires for every heal kind but `QuietRegen`, lifesteal included.
6. **Pool and admission.** `zone::POOL` gains `(Pathfinder, Any)`, `(HazardWalker, Any)`, `(Overflow, Any)`; Wish Engine
   joins in P-AUG-NATIVE-3b. (No pool reads `POOL` today; the existing zone-table test accepts a subset.) **Wiring
   `cards::native::pool_members()` into the Rework chest pool is P-AUG-NATIVE-4's, for all three batch tables** (coordinator
   note): `reward_chests/pools.rs` and the pool functions are outside this packet's write scope, and the oracle asserts
   no chest offer of these cards.
7. **No new serialized field, no format bump.** Slots are 1a's. The content hash moves once (three new rows, the batch
   table if folded) through `scripts/regolden-content.sh`.

## 2. Dependencies
- P-AUG-NATIVE-1b and P-WIRE19-A (in `coord/int-67`). Parallel: P-AUG-NATIVE-2 (`weapon.rs`), P-WIRE19-B.
- Content lane: another content-hash move; regolds again after any sibling that moves it.

## 3. Relevant legacy paths
The three cards are new (no legacy implementation). Legacy the reads sit beside, in the Rust port:
- `systems/heal.rs:53-77` (the G6 heal barrier grant and the overheal hook), `systems/buffs.rs:29-77` (legacy
  `sim/buffs.ts`: `HEAL_BARRIER_LIFE_MS` = 0.25/0.05 = 5 s, `decayBarrier`).
- `systems/terrain/mod.rs:24-147` and `terrain.rs:56-67` (`BURN` 0.02 of max hp per second, `BOG` 0.7, slip on ice).
- `modifiers/mod.rs:564-587` (`sync_max_hp`, `movement`).
- Workbook `docs/quests/FUTURE_ONLY_Quest_Design_Discussion.xlsx`: Augment_Tuning rows Pathfinder, Hazard Walker,
  Overflow; Augments rows of the same names (text quoted in section 1).

## 4. New paths
- `crates/rh-sim/src/cards/native/zone_tests.rs` (oracle).
- Rows `REWORK_HAZARD_WALKER_STACK_MS`, `_RESIST_PER`, `_HP_PER` appended to the `content!` registry (not stubbed: the
  oracle reads them through `REGISTRY`).

## 5. Exclusive write scope
- `crates/rh-sim/src/cards/native/zone.rs` (handlers, readouts, `POOL`, the flat max-hp term and the resist helper).
- `crates/rh-sim/src/cards/native/table.rs`: only if a rule changes (none expected), and `cards/native/mod.rs`: the
  `check` rules of 1.4 and the thin pass-through helpers the reads call (`pub(crate)` functions for the speed share, hazard
  resist/immunity and max-hp flat term, each guarded by one `build.native.is_empty()` check). Not the `mod zone_tests;`
  line (stub).
- The named reads, helper call only: `modifiers/mod.rs` `movement` and `sync_max_hp`; `systems/terrain/mod.rs` `burn_dt`
  and `bog_read`; `systems/buffs.rs` `grant_heal_barrier`/`expire` (Overflow's fade).
- `crates/rh-sim/src/constants.rs`: the three appended rows only.
- `crates/rh-sim/tests/content.rs`: `NON_GAMEPLAY` / folded entries for any new static (none expected).
- The content-hash copies, through `scripts/regolden-content.sh` only (`tools/unity-browser-reload-proof/check.mjs`,
  `normal-companion.mjs`, `BakedContent.cs` (`--allow-artefacts`), `parity/abilities/hash-tape.json` and
  `protocol/fixtures/archetypes_v1.json` (`--regen-fixtures`)).
- `docs/agent/AUGMENT_REWORK.md`: a short "Zone batch (P-AUG-NATIVE-3)" paragraph.

Nothing in `weapon.rs`, `faction.rs`, `abilities/`, `observe.rs`, `rh-protocol`, `rh-server`, `rh-policy`, `schedule.rs`,
`systems/movement.rs`, `walk_hint.rs`, `client-unity/` (except the regolden copy).

## 6. Contracts and references
- C-TICK (no schedule row, no hook link), C-RNG (no draw), C-OBS (readouts own-only), C-DET (restore mid-count
  hash-exact), C-PARITY (Legacy and native-free Rework unchanged), C-INPUT. `docs/agent/AUGMENT_REWORK.md` "Native hooks
  and batch tables", `crates/rh-sim/AGENTS.md`.

## 7. Behaviour to preserve
- Legacy world and native-free Rework world: state hashes, events, checkpoints (`hooks_tests::a_rework_world_without_
  native_cards_plays_as_on_the_base`, `native_cards.rs` legacy tests, and the new `a_world_without_zone_cards_is_unchanged_by_the_new_reads`).
- Observations of a holder equal a non-holder's (1a). Zero allocations per step (`tests/no_alloc.rs`,
  `native_no_alloc.rs`).

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-AUG-NATIVE-3 --base coord/int-67 --allow-artefacts --regen-fixtures` passes;
  the full gate is the coordinator's on the merge.
- `scripts/regolden-content.sh --check` exits 0; `cargo test -p rh-parity --test schedule` green.

## Existing tests that pin what this packet touches (none changes)
| Test | Asserts | Compatible because |
|---|---|---|
| `tests/native_cards.rs:240-262` (caps and marks table) | Pathfinder cap 0.24 and the 20 normal bits; Hazard Walker cap 15, meters 20000 x3, marks 0b111; Overflow counter 0 | no rule changes |
| `tests/native_cards.rs:308-347` (`held_rows`, one-leaf hash perturbations) | Hazard Walker counter 3 / meters [20000,1500,0] / marks 0b001 restores; counter 2, meter 1501, marks 0b011 each restore and move the hash | Hazard Walker check is an inequality, section 1.4 |
| `tests/native_cards.rs:421-530` (`check_world` refusals) | Pathfinder at cap with all marks restores; Hazard Walker at cap with all meters restores; foreign marks refused | exact Pathfinder rule holds for the control (0.012 x 20 = 0.24 within 1e-9) |
| `hooks_tests::the_batch_tables_hold_their_own_cards_and_no_pool_offers_them_yet` | zone `POOL` entries are a subset of the five zone cards, `Offer::Any` allowed, no duplicates | three entries are a subset |
| `hooks_tests::a_rework_world_without_native_cards_plays_as_on_the_base` | native-free digests | must stay green |
| `hooks_tests::max_fold_rows_covers_...` | no fold rows | no fold rows added |
| `exemplars_tests::readouts_show_each_owner_its_own_native_cards_only` | Tally and Bastion rows only | unaffected |

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/cards/native/zone_tests.rs`
- `docs/backlog/packets/P-AUG-NATIVE-3.md` (this brief)

Stub (`stub:` commit): the `#[cfg(test)] mod zone_tests;` line in `cards/native/mod.rs`. Nothing else is needed to
compile: the oracle calls existing functions only and reads the new rows through `REGISTRY` (absent until appended).

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --lib cards::native`
- `cargo test -p rh-sim --test native_no_alloc --test native_cards --test content --test hash_coverage`
- `cargo test -p rh-parity --test schedule`
- `scripts/regolden-content.sh` then `scripts/regolden-content.sh --check`

## 10. Risk and suggested model tier
implementer-sonnet. Hard parts: the terrain and barrier reads sit inside the tick (a read that fires for a non-holder
changes parity), `sync_max_hp` after a stack, and the content-hash move. Escalate to Opus if a read needs a new hook.

## 11. Known traps
- Terrain: `bog_value` (dt 0, walk hint) must apply the same resist/immunity as `bog` without firing a hook or writing a
  meter. `burn_dt` hooks only when damage is applied; an immune tick skips both.
- `sync_max_hp` raises hp by the max-hp delta: the oracle pins max hp only.
- `heal.rs` fires `Overheal` after the hp clamp with `over = before + amount - max_hp`; Overflow gets that excess, not the
  heal. Barrier grants clamp to the cap at grant time (existing helper).
- Same tick: hooks fire after the tick's effect; do not apply a stack in the tick that earns it.
- A native slot cleared (faction reset, console) is zeroed whole (1a); the max-hp term then vanishes: `console.rs` already
  calls `sync_max_hp` after clearing.

## Proposed DEVIATIONS (for the owner)
Hazard Walker's three rows (1 stack/s, 4% resist, 0.5% hp) and Overflow's G6 cap and holder-wide 8 s fade are decisions,
not workbook numbers.

## Notes from previous attempts
<!-- Coordinator appends on escalation: tier, branch, the gate's failure block. Nothing else. -->
