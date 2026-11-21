# The augment and elite rework: how to change a number

The owner approved the elite and augment rework on 2026-11-18 (plan of record:
[docs/backlog/AUGMENT_ELITE_REWORK.md](../backlog/AUGMENT_ELITE_REWORK.md)). Every rework change is **live-only**: it
applies when `SimConfig::augments` or `SimConfig::elites` is `Rework` (`SimConfig::live_content()`), and never in the
default world (`Legacy`) that parity, headless runs and most tests play. P-AUG-RULES-1 built the switch and the seams;
this guide says how a later packet uses them.

## The two rules

- `SimConfig::augments: AugmentRule { Legacy, Rework }` and `SimConfig::elites: EliteRule { Legacy, Rework }`
  (`crates/rh-sim/src/statics.rs`). `Legacy` writes nothing (JSON `null`, no word in the state hash), so a `Legacy`
  world's hashes, checkpoints and replays are the ones it had before the fields existed. `Rework` is `"rework"` in
  JSON and `"augments=rework"` / `"elites=rework"` in the state hasher.
- Do not branch on the rule in game code. Read the rule's **table** instead (below): a reader that asks
  `config.augments == Rework` is a reader the tables cannot retune.

## The card table: `cards::Tuning`

`MatchStatic::cards: &'static cards::Tuning` (`crates/rh-sim/src/cards/tuning.rs`) is the table of the world's
`augments` rule, picked by `Tuning::of(&config)` when the statics are built (a static, never built per step). It
answers:

- `def(id)`: the card definition this world plays (the override row if the table has one, else the generated
  catalog's `CardId::definition()`); `rows(id, faction)`: that definition's rows for a faction;
- `numbers()`: the named numbers that are not card rows (`CardNumbers`: Plant Your Feet, Gambler's two chances and
  two factors, Wishful Thinking's budget, window and floor, the G1 and G4 caps, Third Time's divisor and extra);
- `pool()`, `augment_pool(pickers)`, `conditional_pool(pickers)`: what a chest may offer;
- `fold_definition()` (crate-only): the stat fold's definition with the table's G1 (`hit`) and G4 (`hpRace`) clamps.

### How a reader reaches it

- With the match statics: `k.cards` (systems `cx.k.cards`, hooks `hx.k.cards`).
- A helper without `k` takes `tuning: &cards::Tuning` as a parameter, and its caller passes `k.cards`
  (`Build::rows`, `modifiers::outgoing_damage`, `execute_share`, `hp_race_mult`, `maximum_packet`,
  `checkpoint::valid_ranged_packet`, `Runtime::valid`, `kill_augments::roll_with`, `reward_chests::drop_augment_in`,
  `modifiers::maximum_mark_rate_in`, `cards::wishful_thinking`).
- The no-`k` public forms (`reward_chests::augment_pool`, `kill_augments::invested_stats` / `roll` / `build_marks`,
  `modifiers::maximum_mark_rate`) answer under `Tuning::legacy()`.
- Never read `CardId::definition()` for a card's rows or numbers in game code: an override would apply in one place
  and not another (the fold but not the restore check, the hook but not the fold). `CardId::definition()` stays
  right for what the shape guard keeps equal: `unique`, `tier`, `kind`, `base`, `requires`, flags, tags, title.

Readers still on the legacy numbers, and why (each is a later packet's to move if its numbers change):

| Reader | Why |
|---|---|
| `abilities/checkpoint.rs` Wishful trim bounds (`WISHFUL_BUDGET_MS`, `WISHFUL_WINDOW_MS`) | P-AUG-TUNE-1 retunes Wishful and moves the bound with it |
| `cards/fight_clock.rs` `watches` | reads only the `while` condition, a shape the guard keeps equal; its caller (`systems/items.rs`) has no `k` |
| `kill_augments::build_marks` (observation marks) | display only; its callers (`fx_report.rs`, `observe.rs`) hold no `k` |
| `quests/rules.rs` (card base and tier) | shape fields the guard keeps equal |
| `content_hash` (`maximum_mark_rate()`) | the legacy mark rate; the `REWORK_*` numbers are hashed through the registry (P-AUG-CONTENT-1) |

### Adding an override row (P-AUG-CONTENT-1 and later)

The override table is ONE hand-written file, `crates/rh-sim/src/cards/rework_overrides.rs`:
`pub(crate) static REWORK_OVERRIDES: &[CardDef] = &[ ... ];`.

1. Copy the card's `CardDef { ... }` block from `crates/rh-sim/src/cards/catalog_data.rs` **unchanged in layout**:
   one field per line, in the order `id`, `kind`, `tier`, `base`, `requires`, `unique`, `ready`, `title`, `text`,
   `tags`, `rows`, `selections`. Keep rows in `CardId` order across the table. The Unity mirror test
   (`client-unity/UnityProject/Assets/Tests/Editor/BuildDrawerEditModeTests.cs`) reads `id`, `title`, `text` and
   `tags` from this file with the same regex it uses on `catalog_data.rs`, so the layout is a contract.
2. Change only **row numbers** and the **`text`** string (a selection's `text` too). `cards::check_override` refuses
   anything else: a changed id, kind, tier, base, requires, unique, ready, title, tags, a row added or removed, a row's
   variant, key, flag, trigger event, `once`, action, which numbers are present (`None` vs `Some`), a selection's
   faction, and any non-finite number. `tuning_tests::the_real_override_table_passes_the_guard` runs the guard over
   the real table, and every debug build re-runs it when a `Rework` world is built.
3. A changed number is a **registered constant by name**, never a literal: add a row to the `content!` registry in
   `crates/rh-sim/src/constants.rs` (append; e.g. `REWORK_COMMITTED_DAMAGE: f64 = 0.22, "share";`) and write
   `v: crate::constants::REWORK_COMMITTED_DAMAGE` in the override row. Unchanged numbers are copied as written in
   `catalog_data.rs`. Registering moves the content hash: regenerate its pinned copies with the documented command
   (`scripts/regolden-content.sh`, P-CONTENT-REGOLDEN-1).
4. What the content hash folds: the registered `REWORK_*` numbers (the `content!` registry) and, since
   P-AUG-POOL-1-fix, the realized override rows themselves: `content::card_table_snapshots` folds each row's id and
   its numbers (walked by `cards::map_numbers`, rows then selections) under `mvp-progression/1`, so `REWORK_OVERRIDES`
   is in `TABLES_FOLDED_BY_HASH` in `crates/rh-sim/tests/content.rs`. Adding or removing a row, or pointing a row
   number at another constant, is a regold (`scripts/regolden-content.sh`). The other fields are guarded equal to the
   catalog by `check_override` and are not folded; override `text` is display-only and is not in the hash.
5. One override row reaches every reader at once (fold, cached-fold restore check, ledger, hooks, pools, the
   ranged-packet envelope, the training console). Nothing else is edited for a numbers-only change.

### Changing a named number

The `REWORK` table's `numbers` (`cards/tuning.rs`) are registered constants by name; under P-AUG-RULES-1 they are the
legacy ones. To retune one: register `REWORK_<NAME>` in `constants.rs` and point the `REWORK` field at it. Notes:

- `outgoing_row_cap` is both the stat fold's `hit` clamp and the outgoing row ceiling; `hp_race_cap` is both the
  `hpRace` clamp and the Race to 0 ceiling. Never edit `stat_fold/definition.rs` (it is the legacy content identity).
- Gambler reads `roll < up_chance` up, `roll < up_chance + down_chance` down.
- Third Time reads `(streak + 1) % third_time_every == 0` and adds `third_time_extra` applications. Its legacy `3`
  and `1.` are the two literal numbers in the `LEGACY` / `REWORK` tables (legacy wrote them inline); register them
  when the rework moves them.
- Wishful's budget, window and floor also bound the trims at restore (`abilities/checkpoint.rs`, still legacy):
  whoever retunes them moves that bound too.
- The content hash folds every `CardNumbers` field of both tables by slot, in field order (P-AUG-POOL-1-fix,
  `content::card_table_snapshots`). Repointing a field at another constant, swapping two fields or changing a literal
  is a regold (`scripts/regolden-content.sh`). A new `CardNumbers` field fails to compile in `content/fold.rs`
  (`visit_card_tables` destructures it without `..`) and in the oracle's `number_fields` until it is listed in both.

### The chest pool (P-AUG-POOL-1)

- `Tuning::pool()` is the world's chest pool: `reward_chests::INTERACTIVE` (the legacy 14) under `Legacy`,
  `reward_chests::REWORK_POOL` (the 14 plus Committed, Fists of Fury, Machine Gun, Here Comes the Boom, A Race to 0)
  under `Rework`. The training console grants from it; `check_world` refuses a camp chest (`camp: Some`) offering a
  card outside it. Camp-less chests (a campless elite's, the console's, tests' declared ones) are not pool-checked.
- Every chest rolls `roll_with` over `Tuning::offer_pool(&[Picker])` (the drop with the eligible pickers, the console
  with the player alone): `augment_pool` (catalog order, not held by every picker), less the entries whose `Offer`
  does not admit the pickers, plus the Eye for an Eye weighting. Under `Legacy` it is exactly `augment_pool`, with the
  same reward draws (pinned by `reward_chests/pool_tests.rs`).
- Offer rule (decision 5): a table's `faction_only` lists `(card, faction)` pairs (`Offer::Faction`); every other pool
  card is `Offer::Any`. A faction card is offered only when there is at least one eligible picker and every one is that
  faction. Both real tables list none yet; to add one (P-AUG-NATIVE-4), put the card in the pool and the pair in
  `faction_only`.
- Eye for an Eye weighting (`weight_eye_for_an_eye`, `Rework` only): when an eligible picker owns a card whose rows
  (for its faction) hold a `TriggerAction::Return`, Eye for an Eye is repeated beside itself to count
  `REWORK_EYE_FOR_AN_EYE_WEIGHT` (whole) times. It adds no draw: `roll_with`'s distinct-pick filter drops every copy
  once picked, and a zone theme counts it once.
- The chest inputs are in the content hash (P-AUG-POOL-1-fix): `content::card_table_snapshots` folds each table's
  pool ids, its `faction_only` pairs and its weighting flag under `mvp-progression/1`. Adding or removing a pool card,
  adding a faction pair or flipping the flag is a regold (`scripts/regolden-content.sh`).

## The elite table: `mob_runtime::EliteTuning`

`EliteTuning { k, hp_mult, dmg_mult }` (`crates/rh-sim/src/mob_runtime.rs`); `EliteTuning::of(rule)` returns the
static `LEGACY_ELITES` (the legacy `ELITE_K` / `ELITE_HP_MULT` 2.0 / `ELITE_DMG_MULT` 1.5) or `REWORK_ELITES` (`ELITE_K`,
`REWORK_ELITE_HP_MULT` 1.5, `REWORK_ELITE_DMG_MULT` 1.0; owner decision 2026-11-19, P-ELITE-TUNE-1).

- Readers with `k` read `EliteTuning::of(k.config.elites)` (camp spawn, the mob restore checks).
- Readers without `k` (`World::faction_spec` and through it `defense`, `paced_faction_spec`, `signature_damage`;
  `point_damage`; `sentenced::npc_pulse`; the practice-mob birth) read `EliteTuning::of_world(w)`: the rule the world's
  mob runtime stores, `MobRuntime::elites`.
- `MobRuntime::elites` is set where the runtime is built to `EliteTuning::stored_rule(config.elites)`: the config's
  rule, except that a rule whose numbers equal the legacy ones is stored as `Legacy` (it writes nothing). Since
  `REWORK_ELITES` differs from legacy, a `Rework` world's runtime writes `"rework"` and the state hash folds it; a
  `Legacy` world writes nothing. `check_world` (`systems/mobs.rs` `check_elite_rule`, run by `mobs::validate`) admits exactly
  that one value per statics digest.
- `Mob::born_with(elites, ...)` takes the table for an elite's spawn hp; `Mob::born` is the legacy form for births that
  are never elite and for tests.
- The bots (`rh-policy` `bots/planning.rs` `mob_faction`, `temporal_percept/strategy/hunt_adapter.rs` `mob_max_hp`)
  read `EliteTuning::of(EliteRule::Legacy)`: their maths has no match context. P-AUG-BOTS-1 (rh-policy only) threads
  the room's rule there: a `MatchStart` field beside `frost_wish` (`rh-policy/src/lib.rs`), and `&EliteTuning` into
  `matchup_share` / `mob_faction` / `mob_max_hp` (callers `knowledge.rs`, `planning.rs`, `mob_hunt.rs`). Until it lands,
  a retune does not reach the bots (coordinator decision on the P-AUG-RULES-1 review note, 2026-11-19).

To retune the Rework elites: change `REWORK_ELITE_HP_MULT` / `REWORK_ELITE_DMG_MULT` in `constants.rs` (`k` stays
`ELITE_K`), regolden the content hash with `scripts/regolden-content.sh`, and re-run the elite bench
(`tools/balance-camps/README.md`). `tests/elite_tune.rs` pins the numbers.

## Native cards (P-AUG-NATIVE-1a)

The 14 new augments (the plan's "Plus 13 new" and Marked Man) are `CardId` variants 80..=93 after `FinalVerdict`,
listed in `CardId::NATIVE` (index order). `CardId::ALL` stays the 80 catalog cards, `Counts` stays 80 bytes, and
`emit_cards.py` / `catalog_data.rs` are untouched.

- **Definitions:** `crates/rh-sim/src/cards/native/table.rs` `NATIVE_DEFINITIONS` (hand-written, native order):
  augment, tier 1, unique, ready, no rows yet. `CardId::definition()` and `tier()` answer native ids from it;
  `Tuning::def` falls back to it like any card with no override row.
- **State:** `Build::native: NativeCards`, one `NativeSlot { count, counter, meters: [f64; NATIVE_METERS], marks }`
  per native card (fixed size). `counter` is the card's stacks in its own units, `meters` its working meters, `marks`
  a bit set. A slot whose `count` is 0 is all zero: `Build::set(id, 0)` zeroes the whole slot, and any new code that
  clears a native card must too. `Build::owns`/`count`/`set`/`add`/`valid`/`cards`/`power` branch on native ids;
  `Build::cards()` yields the 80 first, then the held native cards. `Build::counts()` and every observation, pool,
  chest and wire byte carry no native id until P-WIRE19-A.
- **Save, restore, hash:** `Build` serializes `native` first and only when a native card is held, as the held rows
  only (`{"card","count","counter","meters","marks"}`, native order). A build holding none writes and hashes exactly as
  before (`hash.rs`, fourth World exception). Restore refuses an empty list, a `count` 0 row, a catalog card, and a
  card repeated or out of order. `CHECKPOINT_FORMAT` moved to `rh-checkpoint/35`.
- **Caps:** `cards::native::rule(id)` (`NATIVE_RULES` in `table.rs`): `counter_cap`, `meter_caps` and `marks` per
  card. `check_world` (`cards::native::check`) refuses a held native card outside a `Rework` table, a count over 1,
  a counter or meter outside `0..=cap` (or non-finite), a mark outside the rule's bits, and any reward chest offering a
  native card. It also bounds every player's `card_tank_hp` to `0..=` the world table's largest Tank Engine cap.
- **Setting a cap (batch packets):** a slot 1a leaves at cap 0 is unused and must stay 0. To use one, register the
  number in the `content!` registry (`constants.rs`, append), point the card's `NativeRule` field in `table.rs` at it
  by name, and regold (`scripts/regolden-content.sh`). The native ids, definitions (rows walked by
  `cards::map_numbers`) and rules are folded into the content hash (`cards::native::visit_content`, after the
  `CardId::ALL` names in `visit_progression_content`), so adding rows or moving a cap is a regold too.
- **Wish Engine:** its slot's `counter` is the earned cooldown share (cap `REWORK_WISH_ENGINE_CAP`); its three meters
  are reserved for P-AUG-NATIVE-3's per-cast record (that packet sets their caps and redoes the Wish restore envelope).

## Native hooks and batch tables (P-AUG-NATIVE-1b)

A native card acts through **hooks**: plain helper calls from inside existing systems. No hook adds a schedule row, a
hook-chain link, an RNG draw or an event. `cards::native::hooks::fire(k, w, holder, NativeEvent)` returns at once
unless the table is `Rework` and the holder holds a native card. It then runs each held card's handler, in native
order. `fire_held(w, holder, event)` is the same without the `MatchStatic`, for the two sites that have none (`heal`,
Frost). It is sound because a non-`Rework` world holds no native card. A site that must compute something for the hook
asks `hooks::holds_native(k, w, id)` first, so a non-holder pays one check.

| Hook | Fires for the holder | Site |
|---|---|---|
| `LongRangeHit` | its own projectile (not reflected, not a wand splash) landed a hit after flying ≥ `REWORK_MARKSMANS_TALLY_RANGE_SHARE` of its launch range (`hooks::long_range`) | `systems/ledger.rs`, landed-hit loop |
| `CreditedKill { player, elite }` | it is the credited killer of a player, or of a mob | `systems/credit.rs` `credit_kill` (before `PlayerKilled`); `systems/mob_life.rs` (before `MobKilled`) |
| `FistHit` | a `HitCount` hit with `Fists` | ledger |
| `MobKill { mob_type }` | it is credited with a mob kill (whether it is the first of its type is the card's state) | `mob_life.rs` |
| `HazardTick { hazard, ms }` | a tick on ember (0), bog (1) or ice (2) | `systems/terrain/mod.rs`: `burn_dt` (ember), `bog` (bog, and ice read at the same point) |
| `WishCast` | its Wish landed | `systems/abilities/mod.rs`, after `cast_ended(.., Landed)` |
| `CorpseHarvest` | it consumed a plague corpse (F or auto) | `systems/plague_corpses.rs` `consume` |
| `BurstLanded` | its charged roaming Fire burst went off on a hit | `systems/fire_roam.rs` `hit_landed` |
| `ChillInflicted { ms }` | its ranged chill (`FROST_RANGED_CHILL_MS`), or one tick of its attack chill on a victim | `systems/frost.rs` `ranged_hits`, `after_damage` |
| `HuntStack { stacks }` | its hunt paid stacks (the number paid) | `systems/sentenced_hunt.rs` `fighter_out` |
| `Block { prevented }` | once per `HookArgs::Blocked` (melee and projectile) | `cards::on_blocked`, after Tank Engine |
| `Overheal { amount }` | a heal (not regen) went past its max hp by `amount` | `systems/heal.rs` `apply_with` |
| `HitCount { victim, amount, burst }` | one `Event::Hit` its weapon landed (`passive: false`), with that hit's amount | ledger, after `HitLanded` |

The ledger hooks fire after the hit's amount is dealt. A stack a hit earns is not in that hit: `outgoing_damage` is
read at the start of the pass.

**Batch tables.** Each card lives in exactly one table: `cards/native/weapon.rs`, `zone.rs` or `faction.rs`. A batch
edits only its own table, which holds:

- `handle(w, i, card, event)`: a `match (card, event)` arm per hook the card uses. Each arm changes player slot `i`'s
  `build.native` slot. Caps come from `native::rule(card)`, never a literal.
- `readouts(card)`: the card's readout rows, `Source::Counter`, `Meter(n)` or `Marks`. `cards::native::readouts(sim,
  viewer)` turns them into fixed-size `Readout { card, kind, value, max }` rows, read only from the viewer's own slots
  (C-OBS). The max is the rule's cap, or for marks the rule's bit count. Nothing observes them yet: P-WIRE19-B puts them
  on the wire beside `observe.rs` `out.me`.
- `POOL: &[(CardId, Offer)]`: membership (`Offer::Faction` for the faction table).

A card that changes damage joins one of the two seams in `native/mod.rs`:

- `outgoing_share(build)`: added to the `outgoing_damage` sum, under the G1 ceiling (Marksman's Tally).
- `landed_burst(k, w, by)`: added after mitigation, before the PvP hit cap, to the holder's first landed weapon hit on
  a victim, and spent by that hit's `HitCount { burst > 0 }` (Bastion). It is capped at one burst per seat per victim.

**Admission (P-AUG-NATIVE-4).** Under `Rework`, `Tuning::in_pool(id)` is a catalog card of `pool()` or a native that a
batch table lists in its `POOL` (`native::pool_members()`); `pool()` and `REWORK_POOL` stay the catalog's 19.
`augment_pool` appends the ready native augments not held by every picker after the catalog walk, in native order (the
order is behaviour: `roll_with` draws by index); `offer` answers a native with its table's `Offer`; `offer_pool` always
filters by `Offer::admits` under `Rework` (a faction card only when every eligible picker is that faction, none with no
picker). `reward_chests::validate_world` takes the card table and checks camp chests with `in_pool`. Under `Legacy`
nothing changes: no native is appended and `check_world` refuses a chest offering one. The membership is folded into
the content hash (`native::visit_content`). The draw protocol is unchanged; the natives are tier 1. The practice
console still grants catalog cards only. `trusted_build::apply` refuses a native card outside `Rework`
(`BuildRefusal::NativeOutsideRework`).

**Bounds and envelopes.**

- `MAX_FOLD_ROWS` (80, `cards/mod.rs`) is the most fold rows one copy of every card gives, under either table and any
  faction's selection. `Build::rows` stops silently when it is full. A batch that adds native `Fold` rows raises it;
  `hooks_tests::max_fold_rows_covers_every_card_of_both_tables` guards it.
- A batch card that bakes damage into a projectile packet must join the Rework `maximum_packet` envelope
  (`modifiers/mod.rs`), or restore refuses its packets. Neither exemplar does: Tally is in `outgoing_damage` and Bastion
  is added after mitigation.
- Each batch adds its card's exact `native::check` rule, for example integral counters or Pathfinder's counter tied to
  its marks.

**No allocation.** Handlers, `readouts` and `Bursts` use fixed arrays and slot fields only. `tests/native_no_alloc.rs`
counts a warmed Rework tick with both exemplars active.

**Exemplars.**

- **Marksman's Tally:** `counter = min(REWORK_MARKSMANS_TALLY_CAP, counter + REWORK_MARKSMANS_TALLY_PER)` per
  `LongRangeHit`. The counter is a damage share.
- **Bastion:** each `Block` adds what the block kept, measured as Tank Engine measures it, to `meters[0]`, capped at
  `REWORK_BASTION_METER_CAP` (250). The next landed weapon hit deals `REWORK_BASTION_SHARE × meters[0]` more, and the
  meter goes to 0.

## Checks that guard the seam

- `crates/rh-sim/tests/augment_rules.rs`: the rules' encoding, the 64 statics identities of the silent switches, the
  Legacy elite table equals the legacy constants and Rework has the owner numbers, `Legacy` and `Rework` agree until the first elite strike, a `Rework` checkpoint with fold cards and a
  packet in flight restores.
- `crates/rh-sim/src/cards/tuning_tests.rs`: the shape guard, the real table through it, readers through a doctored
  table (fold and restore check, G1 in both places, Gambler), and the `Rework` ranged envelope over the fold cards.
- `crates/rh-sim/tests/hash_coverage.rs`: the `Rework` scenarios and the `MobRuntime::elites` row.

## Moving the content hash: `scripts/regolden-content.sh`

A packet that changes content moves `content_hash`. Never hand-edit the copies. After the change, run
`scripts/regolden-content.sh` (it computes the hash with `cargo run -q -p rh-sim --example content_hash`). It rewrites
the four text copies (`crates/rh-sim/tests/content.rs` `GOLDEN_CONTENT_HASH`, the two `tools/unity-browser-reload-proof`
`.mjs` files, `BakedContent.cs`), then runs the documented commands for the two protected copies
(`cargo test -p rh-sim --lib record_ability_hash_tape -- --ignored` and `cargo run -p rh-parity --bin hitbox-fixtures`).

- `--check` lists stale copies as `STALE <path>` (exit 1) without running the two protected commands (it still runs `cargo run --example content_hash` unless `--hash HEX` is given).
- `--dry-run` prints `WOULD EDIT` / `WOULD RUN` lines; `--text-only` skips the protected commands.
- `BakedContent.cs` is a build artefact by name: a diff that changes it needs `scripts/gate.sh --allow-artefacts`.
- Copies of the hash exist only in those six files; a new value pin elsewhere fails `regolden_content`.

## Weapon batch (P-AUG-NATIVE-2)

- Calluses: `FistHit` adds 0.07 to `counter` (cap 30); the counter is armor, a farm row of the fold (`modifiers::combined_farm_rows`, via `native::fold_stats`).
- Executioner's Ledger: `CreditedKill` with `player || elite` adds 3 (cap 30); the counter is AD, a farm row of the fold.
- `native::hooks::fire` refolds the holder after a `FistHit` or `CreditedKill` when a fold-feeding counter is held, so the mirrors move at once (the slot handler has no `MatchStatic`).
- Eighth Strike: the ledger doubles the 8th landed weapon hit (`native::strike_mult`, before Bastion's burst and the PvP cap); `HitCount` advances the counter mod 8.

## Zone batch (P-AUG-NATIVE-3)

Pathfinder, Hazard Walker and Overflow live in `cards/native/zone.rs`. Pathfinder's counter (`min(cap, 0.012 x marks)`) multiplies the
holder's walk by `1 + counter` through one accessor, `modifiers::speed_mult` (P-AUG-NATIVE-3c: the walk, the owner block's
`speed_milli` the client predicts with, the owner readout and a Plague zombie's pace read it; the cached wire mirror, build marks,
trades and the haste bound stay on the folded mirror). Hazard Walker's stacks (one per hazard second, cap 15) resist ember
(`burn_dt`), bog (`bog_read`) and the ice's slip time (`native::ice_grip`: acceleration over `1 - resist`, read by the walk and the
walk hint) by 4% each, add 0.5% of base max hp each in `sync_max_hp`, and 20 s on a hazard makes it immune (on ice: no slip, a walk
hint, no ice exposure counted). Overflow turns
the overheal into a G6-capped barrier; every barrier of an Overflow holder fades over 8 s. `check` ties Pathfinder's counter to its
marks exactly and Hazard Walker's stacks to the meters as an upper bound. Wish Engine is P-AUG-NATIVE-3b.

## Faction batch (P-AUG-NATIVE-4)

Corpse Hoarder, Stoked, Glacier and Trophy Hunter live in `cards/native/faction.rs`, each `Offer::Faction` of its own faction.

- One seam per stat. `native::fold_stats` returns `FoldStats { armor, ad, ap }`: armor is Calluses + Glacier, AD the Ledger,
  AP Stoked, each a farm row of the fold (`CombinedFarm` holds 39 rows). Max hp is `native::flat_max_hp` (Hazard Walker's
  stacks + Corpse Hoarder's `counter x base hp`), read by `sync_max_hp`. Damage is `outgoing_share` (Tally + Trophy Hunter).
- Corpse Hoarder: `CorpseHarvest` adds 0.03 (cap 0.24); the handler syncs max hp and keeps the hp it had (no heal), as the
  corpse's own row does.
- Stoked: `BurstLanded` adds 2 AP (cap 30). The hook fires where `fire_roam` queues the burst (`defer_hit`), the tick before
  the burst's own hit: a queued burst counts even if its victim then leaves. `hooks::fire` refolds after it.
- Glacier: `ChillInflicted { ms }` adds `0.15 x ms / 1000` armor (cap 30), from every chill source: 1200 ms per ranged Frost
  hit (`frost::ranged_hits`) and one tick (50 ms) per source per tick while the victim's chill is below 1
  (`hooks::attack_chill`). Those come through `fire_held` (no `MatchStatic`), so no refold runs at the hook: the same
  tick's `mods.updateMods` row folds the armor for every fighter, after the damage phase that chilled. The armor mirror
  has the wire's 0.1 resolution.
- Trophy Hunter: `HuntStack { stacks }` adds `0.02 x stacks` (cap 0.15), a damage share beside Marksman's Tally.
- The four counters are non-integral shares: `check` adds no rule beyond the caps. A stored fold that disagrees with the
  counters is refused on restore by the existing `invalid armor mirror` check (`Runtime::valid` refolds).

## Wish Engine (P-AUG-NATIVE-3b)

A landed Wish (`NativeEvent::WishCast { row_cooldown_ms }`) moves Wish Engine's counter, the share, to the next point of
its row's lattice `min(0.25, n x step)`, `step = 0.25 x row cooldown / 300 s` (`abilities::WishEngineGrid`, bit-exact from
the integer `n`; Fire steps per charge). Every reader of the Wish cooldown goes through `abilities::wish_mult` (the
folded Arcane Overload lever times `1 - share`): the cast producer, the owner view and the restore validator. The restore
(`abilities/checkpoint.rs`, `WishEnvelope`) reads the (lever, share) pair off the stored spend, which is distinct per
pair (`abilities/wish_lever_tests.rs`), so no per-cast field exists and `CHECKPOINT_FORMAT` did not move; earlier casts
are judged under every lattice share no larger and every lever no longer. `check` holds the counter on its faction's
lattice. A non-holder's envelope is the pre-packet one exactly. With Wishful Thinking at its floor a cast can reach
0.375 of the row (the 50% floor is the combined multiplier's, `WISH_MULT_MIN`).
