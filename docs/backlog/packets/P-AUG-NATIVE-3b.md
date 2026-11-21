# P-AUG-NATIVE-3b: native augment Wish Engine (percent table) and the Wish restore envelope that admits a shorter cooldown

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 13 (P-CARDS-2/3), under the owner's 2026-11-18 approval of the elite and
  augment rework (`docs/OWNER_DECISIONS.md:12`, row "Elite and augment rework"; plan of record
  `docs/backlog/AUGMENT_ELITE_REWORK.md`: packet row P-AUG-NATIVE-3b (line 172), the coordinator notes "P-AUG-NATIVE-3,
  Wish Engine" (lines 216-226), Appendix A row "Wish Engine (percent)" (line 399)). No other OWNER_DECISIONS row names
  Wish Engine.
- **Implementer tier:** implementer-opus (rh-sim state, the Wish restore validator, save/restore hash-exactness).
- **Reviewer:** reviewer-opus.
- **Integration base:** `coord/int-68` @ `c5efcdb83` (integration 67 plus P-AUG-NATIVE-2 and P-AUG-NATIVE-3). Gate runs
  take `--base coord/int-68`.
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10): the workbook's per-faction table checked once
  through the real hook; restore soundness by played checkpoints and forged refusals; Legacy and native-free Rework
  pinned byte-identical by digests recorded at the stub commit · D2 n/a · D5/D6/D9 none (no wire change; the owner view's
  `recharge_ms` value changes for a holder only, its shape does not).

## 1. ID and outcome

Wish Engine gets behaviour (Rework only; a Legacy world and a Rework world without Wish Engine play byte-identically to
the base). Workbook `docs/quests/FUTURE_ONLY_Quest_Design_Discussion.xlsx`:

- Augments row 42: "Each Wish cast → −(faction cooldown ÷ 15)% Wish cooldown; all factions cap after 5 min of use",
  cap −20% "(floor 50% overall)".
- Augments rows 68-76, "Wish Engine (percent cooldown): per-faction table": "Step per cast = cap × cooldown ÷ (minutes to
  cap × 60), so every faction reaches the cap after the same time spent using its Wish on cooldown"; cap 0.2, minutes 5,
  floor 0.5 ("G13, all reduction combined"); Fire 30 s step 0.02 ("Per charge (2 charges)"), Frost 45 s 0.03, Plague
  120 s 0.08, Holy 150 s 0.1, Sentenced 180 s 0.12.
- Augment_Tuning row 46: "Cap −25% (still above the 50% floor)". Registered by P-AUG-NATIVE-1a:
  `REWORK_WISH_ENGINE_CAP = 0.25`, `REWORK_WISH_ENGINE_CAP_MS = 300000` (`crates/rh-sim/src/constants.rs:626-629`).

### Decisions (with reasons)

1. **What the table keys on.** On `NativeEvent::WishCast` (the holder's Wish *landed*: `systems/abilities/mod.rs:326-337`,
   after `cast_ended(.., Landed)`), Wish Engine's `counter` (the share) becomes
   the next point of its grid (below), one step of `step = CAP × row_cooldown_ms / CAP_MS` further, where
   `row_cooldown_ms` is the cooldown of the Wish row the world
   cast (`abilities::definition_for(&config, ability).cooldown_ms`: the catalog's, or Frost Wall's under
   `frost_wish = Wall`), before training, Arcane Overload and Wish Engine. That is the workbook's step with cap 0.25:
   Fire 0.025, Frost 0.0375, Plague 0.1, Holy 0.125, Sentenced 0.15; casts to the cap 10, 7, 3, 2, 2. Fire's two-charge
   Blaze steps once per charge cast (workbook "Per charge"). The handler has no `MatchStatic`, so the hook carries the
   row's cooldown: the stub changes the event to `NativeEvent::WishCast { row_cooldown_ms }` and the call site passes it.
   - A cancelled, fizzled or teleport-refunded cast earns nothing (it never lands; 1b's site). Same tick: the share a
     cast spends is the one before its own landing, so a cast never shortens itself.
   - The share lives on a grid, bit-exact: after `n` landed casts it is `min(CAP, n × step)` (the handler takes
     `n = round(counter / step)` and writes `min(CAP, (n + 1) × step)`). Not repeated addition: ten additions of 0.025
     give 0.24999999999999997, so Fire would reach the cap on its eleventh cast instead of the workbook's tenth (the
     oracle pins the tenth). Each faction's grid is finite; a value off it is unreachable.
2. **How the cooldown is shortened, and where.** The share multiplies the Wish multiplier: the next cast spends
   `cooldown_for(config, ability, Some(wish_cooldown_mult × (1 − share)))` (`abilities/mod.rs:437-455`). Reasons:
   `cooldown_for` is already the one function the producer (`systems/abilities/mod.rs:158-162`) and the restore
   validator (`abilities/checkpoint.rs:61-66`) share since P-FROST-RESTORE-1; `scaled_cooldown` already rounds
   (`js_round`, as Arcane Overload) and floors the combined multiplier at `WISH_MULT_MIN` 0.5 (the workbook's "floor 50%
   overall", GAME_DESIGN G13 `WISH_COOLDOWN_MULT_MIN`); for a share of 0 the product `m × (1. - 0.)` is bit-identical
   to `m`, so no non-holder's number moves. One helper computes the multiplier from a player (the folded
   `wish_cooldown_mult()` times `1 − cards::native::wish_engine_share(&build)`) and every reader calls it: the producer,
   the restore validator and the owner view (`OwnerView::of`, `abilities/mod.rs:506-508`). The share is **not** folded
   into `modifiers` (`MultKey::WishCooldown`): a handler cannot refold (no `k`), and a folded share would make the
   validator's "multiplier now" ambiguous between a lever and a share.
   - Training worlds keep `TRAINING_COOLDOWN_MS` (`scaled_cooldown` returns it first); the share still grows there.
3. **How restore stays sound, without a new field.** The stored spend (`card_runtime.wish_cast`, `cards/runtime.rs:26-29`)
   already records the cooldown the cast spent, and the pair (lever, share) that produced it is recoverable from that
   number alone: within a lever the cooldown falls strictly with the share (steps of at least 750 ms), and the two
   levers' ranges never meet (no Arcane Overload: `[0.75, 1] × row`; Rework Arcane Overload 1.5: `[1.125, 1.5] × row`).
   The oracle guards that injectivity (`wish_lever_tests.rs`). So the per-cast record is the spend itself; Wish Engine's
   three meters stay unused (caps 0, as 1a set them). The validator (`abilities/checkpoint.rs`) is redone as an envelope
   over levers × lattice shares:
   - **The spend.** A Wish Engine holder's spend has a lattice share `s` with `counter == s` (not landed: in flight,
     fizzled, refunded) or `counter == next(s)` (landed); its cooldown is `cd(lever, s)` for lever ∈ {none, the
     multiplier now}. A non-holder's spend has share 0 (today's two-element check, `checkpoint.rs:130-141`, exactly).
   - **Earlier casts.** Today's premise "a cooldown only lengthens between casts" (`checkpoint.rs:53-60`, the
     `cd <= upto` filter at `:25`, `prior_min` at `:183`, the charge lattice at `:42-51`) is false for a holder: an
     earlier cast had a share `<= s`, so a *longer* cooldown. `prior_clock_any`, `prior_min` and
     `charge_clock_lattice` take every cooldown of a lattice share `<= s` under either lever (a holder's finite set; a
     non-holder's set is today's two).
   - **Fire's charge equation** (`checkpoint.rs:211-227`): "the previous full clock lay at most one recharge ahead" must
     use the earlier cast's (longer) recharge: the second charge cast right after a landing has
     `full_at = at1 − 50 + cd(s0) + cd(s1) > at1 + 2·cd(s1)`, refused today.
   - **Wishful Thinking's budget** (`checkpoint.rs:183-201`, `trim_trace_coherent` `:68-97`): a trim in the 60 s window
     may have been cut under an earlier, longer spend, so the window budget is computed from the spend's lever at share
     0 (the longest cooldown a trim can have been cut under). For share 0 this is today's `recharge`, so no non-holder's
     bound moves.
   - **In flight** (`checkpoint.rs:319-327`): the same spend envelope (a holder's in-flight spend has `counter == s`).
   - **`native::check`** (`cards/native/mod.rs:340`): a Wish Engine counter must equal a value of its faction's lattice
     (bit-exact; the lattice comes from `definition_for(&k.config, wish(faction))`).
   - A forged state the envelope refuses: a counter off the lattice; a counter more than one step above the spend's
     share; a spend whose share is above the counter; a non-holder's shortened spend; clocks under the spend's own; an
     in-flight spend at a share the holder has not reached.
4. **`CHECKPOINT_FORMAT` stays `rh-checkpoint/35`.** No serialized field is added or reshaped (the spend already holds
   the cooldown; the slot is 1a's). The validator admits a holder's states and nothing else new; a pre-packet checkpoint
   restores as before (no holder could step: no pool offers native cards until P-AUG-NATIVE-4). If the implementer finds
   a per-cast field necessary after all, that is a format bump and goes back to the coordinator.
5. **HUD.** `OwnerView::of` reads the same helper, so `recharge_ms` (and Fire's `charges`/`next_charge_at`, which read
   it) show the cooldown the next cast will spend. Its signature and catalog row stay (`observe.rs:818` untouched;
   Frost Wall's `FROST_WALL_COOLDOWN_MS` equals Freeze's 45000, so the catalog row agrees today; the coordinator's
   `cooldown_for` note for `OwnerView` under `frost_wish = Wall` stays open). `rh-policy`
   `temporal_percept/memory.rs:372` estimates *other* players' Wish cooldowns from the catalog: an opponent's Wish Engine
   is hidden (C-OBS), so it stays (bots overestimate a holder's cooldown by at most 25%).
6. **Readout and pool.** Readout rows `[Source::Counter]` (max `CAP`). `zone::POOL` gains `(WishEngine, Offer::Any)`
   (Generalist: workbook Augments row 93, "Chest slot 3"). No pool reads `POOL` until P-AUG-NATIVE-4;
   `reward_chests/` is out of scope.
7. **Content hash does not move.** `CAP` and `CAP_MS` are registered (1a); the rule (`table.rs:163-164`) is unchanged
   (meters stay 0). `POOL` is not folded (`tests/content.rs:69`). If the implementer changes a rule or adds a row, that is
   a regold through `scripts/regolden-content.sh` and must be said in the hand-off.

### Legacy and flags

- Wish Engine is new (no legacy implementation; `rg -i "wish.?engine" packages` finds nothing). Legacy the reads sit
  beside, as ported: `abilities/mod.rs:431-455` (cooldown scaling, `WISH_MULT_MIN`), `cards/mod.rs:236-276`
  (`wishfulThinking`: floor `cast.at + floor_share × cast.cooldown_ms`, `:261`).
- **Flag (owner): Wishful's floor.** Wishful Thinking's floor stays half of the *spend's* cooldown
  (`cards/mod.rs:261`), so Wish Engine at the cap plus Wishful at its floor brings one cast to 0.375 of the row's
  cooldown. The workbook's "floor 50% overall" is read as the combined multiplier floor (`WISH_MULT_MIN`), which the cap
  never reaches. A floor over both levers needs the Wishful producer to know the unshortened cooldown: a separate packet
  if the owner wants it. Proposed DEVIATIONS row below.
- **Flag: training.** The share grows in a training world although the cooldown there is always 5 s.
- **Flag: the restore cannot count casts.** A counter on the lattice and within one step of the spend's share is
  admitted whatever the history (necessary equations, as the rest of `abilities/checkpoint.rs`).

## 2. Dependencies

- P-AUG-NATIVE-1a/1b (slot, hooks, batch tables), P-AUG-NATIVE-3 (zone table), P-AUG-TUNE-1 (share-rule Wishful),
  P-FROST-RESTORE-1 (`cooldown_for` shared by producer and validator): all in `coord/int-68`.
- Parallel: P-AUG-NATIVE-3c (`movement.rs`, `walk_hint.rs`, zone Pathfinder/Hazard Walker reads), P-AUG-NATIVE-4
  (`faction.rs`, `reward_chests/`), P-WIRE19-B (`observe.rs`, protocol). Keep out of their files; `zone.rs` is shared
  with 3c (different arms: merge one at a time).

## 3. Relevant legacy paths

- None for the card (new). Ported reads it changes: `crates/rh-sim/src/abilities/mod.rs:431-455` (`cooldown`,
  `cooldown_for`, `scaled_cooldown`), `:506-530` (`OwnerView::of`); `crates/rh-sim/src/systems/abilities/mod.rs:155-174`
  (the producer's spend), `:326-337` (the `WishCast` site); `crates/rh-sim/src/abilities/checkpoint.rs:1-430` (the Wish
  restore validator); `crates/rh-sim/src/cards/mod.rs:236-276` (Wishful); `crates/rh-sim/src/cards/native/mod.rs:325-430`
  (`exact_counter`, `check`).

## 4. New paths

- `crates/rh-sim/src/cards/native/wish_engine_tests.rs` (oracle).
- `crates/rh-sim/src/abilities/wish_lever_tests.rs`: the Arcane Overload lever guard, moved unchanged out of
  `abilities/checkpoint.rs` (stub, so `checkpoint.rs` stays writable) and then extended to Wish Engine (oracle-amend).

## 5. Exclusive write scope

- `crates/rh-sim/src/cards/native/zone.rs`: Wish Engine's handler arm, readout row, `POOL` entry, and the share and
  lattice helpers.
- `crates/rh-sim/src/cards/native/mod.rs`: the body of `wish_engine_share` (stubbed) and Wish Engine's `check` rule. Not
  the `mod` lines.
- `crates/rh-sim/src/cards/native/table.rs`: the Wish Engine rule's comment (the rule itself is not expected to change).
- `crates/rh-sim/src/abilities/mod.rs`: the multiplier helper, `OwnerView::of` reading it, the `cooldown`/`cooldown_for`
  docs. Not the `mod wish_lever_tests;` line.
- `crates/rh-sim/src/abilities/checkpoint.rs`: the envelope (section 1, decision 3). The `wishful_in_flight_tests`
  module stays as it is and green.
- `crates/rh-sim/src/systems/abilities/mod.rs`: the producer's multiplier (one call, `:158-162`). The hook site already
  passes the row's cooldown (stub).
- `docs/agent/AUGMENT_REWORK.md`: a short "Wish Engine (P-AUG-NATIVE-3b)" paragraph.
- Only if a content row or rule changes (not expected): `constants.rs` (append), `tests/content.rs`, and the
  content-hash copies through `scripts/regolden-content.sh`.

Nothing in `cards/native/hooks.rs` (stub done), `weapon.rs`, `faction.rs`, `reward_chests/`, `observe.rs`,
`checkpoint.rs` (root; the format stays), `rh-policy`, `rh-protocol`, `rh-server`, `client-unity/`, `schedule.rs`.

## 6. Contracts and references

- C-TICK (no schedule row, no hook link), C-RNG (no draw), C-DET (a holder's checkpoint mid-cast and mid-cooldown
  restores hash-exact), C-PARITY (Legacy and native-free Rework unchanged), C-OBS (own share only), C-INPUT.
- `docs/agent/AUGMENT_REWORK.md` "Native hooks and batch tables"; `crates/rh-sim/AGENTS.md`;
  `docs/backlog/packets/P-FROST-RESTORE-1.md`, `P-AUG-TUNE-1.md` (the last two envelope changes).

## 7. Behaviour to preserve

- Legacy worlds and Rework worlds without Wish Engine: state hashes and checkpoints byte-identical (digests recorded at
  the stub commit in `wish_engine_tests.rs`; `hooks_tests::a_rework_world_without_native_cards_plays_as_on_the_base`).
- A non-holder's Wish envelope exactly as today (two cooldowns, `cd <= upto`, budget from the spend).
- Zero allocations per step (`tests/no_alloc.rs`, `tests/native_no_alloc.rs`); `tests/hash_coverage.rs` (no new leaf).

## Existing tests that pin what this packet touches

| Test | Asserts | Outcome |
|---|---|---|
| `abilities/checkpoint.rs:448-482` `wish_cooldown_lever_tests::one_unique_card_only_lengthens_the_wish_cooldown_in_both_tables` | among the 80 catalog cards' fold rows, exactly one unique `WishCooldown` lever (Arcane Overload), factor >= 1, in both tables | moved unchanged to `abilities/wish_lever_tests.rs` (stub), then extended (oracle-amend, for the owner): a second test names Wish Engine the one native lever, bounded by its cap, under the G13 floor, its range disjoint from Arcane Overload's, and the (lever, share) envelope injective for every faction. The original assertion stays true (Wish Engine has no fold row). |
| `abilities/checkpoint.rs:490-735` `wishful_in_flight_tests` (3) | a trimmed Frost Wish cast again restores in flight (both tables, with and without Arcane Overload); Fire's second charge after a grant restores; in-flight bounds refuse forged clocks | unchanged, must stay green (non-holders) |
| `abilities/source_tests/wishful_rework_restore_tests.rs:76-260` (7) | Rework 1.5%/20% trims restore and the cap is refused one past; Legacy bound unchanged; a lengthening cooldown and a grant between casts restore | unchanged, must stay green |
| `abilities/frost_restore_tests.rs:141-215` | Frost Wall and Freeze in flight restore; each world refuses the other's target kind | unchanged |
| `abilities/owner_view_tests.rs:17-140` | owner view clocks, training 5 s, Blaze charges | unchanged (non-holders) |
| `tests/native_cards.rs:231-262` | Wish Engine counter cap = `REWORK_WISH_ENGINE_CAP`, meters 0 | rule unchanged |
| `tests/native_cards.rs:421-530` | `check_world` positive controls and refusals | never sets a Wish Engine counter; unchanged |
| `cards/native/hooks_tests.rs:19-80` (name scan), `:429` (zone `POOL` a subset of the five zone cards) | `WishCast` name at a site outside native; pool subset | the variant keeps its name; one more subset entry |
| `cards/native/hooks_tests.rs:326` native-free digest | no Wish casts | unchanged |
| `cards/native/zone_tests.rs` | the three zone cards | unchanged |

## 8. Acceptance checks

- `scripts/gate.sh --quick --oracle packet/P-AUG-NATIVE-3b --base coord/int-68` passes; the full gate is the
  coordinator's on the merge.
- `cargo test -p rh-sim --lib wish` (the oracle and every existing Wish restore test) green;
  `scripts/regolden-content.sh --check` exits 0 (no content move expected).

## Oracle files (read-only for implementers)

- `crates/rh-sim/src/cards/native/wish_engine_tests.rs`
- `crates/rh-sim/src/abilities/wish_lever_tests.rs` (oracle-amend; the move itself is the stub)
- `docs/backlog/packets/P-AUG-NATIVE-3b.md` (this brief)

The tests, and why each is red on the stub (every one fails on an assertion):

| Test (`cards::native::wish_engine_tests::` unless named) | Pins | Red on the stub because |
|---|---|---|
| `wish_engine_steps_by_the_workbook_table_per_landed_wish_and_shortens_the_next_cooldown` | per faction, played to the cap and one past: the step (0.025, 0.0375, 0.1, 0.125, 0.15), the share before and after each landed cast, the cap reached exactly on cast 10/7/3/2/2, each spend `row × (1 − share)` within 1 ms, the stock clock `at + cooldown` (single charge), the owner view's `recharge_ms` equal to the spend, `0.75 × row` at the cap | "Fire: cast 0 landed and stepped the share to 0" |
| `arcane_overload_and_wish_engine_multiply` | Frost and Holy holding both: spend `row × 1.5 × (1 − share)` within 1 ms; owner view equal | "Frost: cast 1 spent 67500, want about 64968.75" |
| `only_the_holder_s_own_landed_wishes_shorten_only_its_own_cooldown` | every faction: a caster holding Pathfinder (the hook fires) spends the full row and its view shows it; an idle Wish Engine holder earns nothing from another's casts; positive control: a casting holder steps | the control: "the casting holder steps" (the non-holder half passes, as it must) |
| `a_holder_checkpointed_at_every_cast_landing_and_recast_restores_and_plays_on` | every faction to the cap and one past: a checkpoint after each acceptance, each landing and two ticks before each recast restores hash-exact and plays on equal (16-24 ticks, through the next cast); Fire's back-to-back charges | "Fire: 0 of the checkpointed spends were shortened, want at least 10" |
| `a_recast_after_wishful_cuts_or_an_overload_grant_restores_across_the_step` | Frost: Wishful cuts the first spend by its full 20% budget, the recast (one step shorter) inside the same window, the window's cuts above the recast's own budget; or Arcane Overload granted between the casts; a checkpoint on each of 12 ticks from the recast, and around the next recast | "overload=false: the recast spent 45000, want about 43312.5" |
| `forged_wish_engine_states_are_refused` | from a Frost holder two casts in: a counter off the grid, a counter two steps above the spend's share, a spend above the counter, a non-holder's shortened spend, clocks under the spend's own, and (in flight) a spend at a share not reached: each refused; controls restore | the precondition: "the second cast spent one step's cooldown, not 45000" |
| `wish_engine_reads_out_its_share_and_joins_the_zone_pool` | readout `[(WishEngine, Counter, 0.125, 0.25)]` for a Holy holder after one cast, none for the other player; `zone::POOL` holds `(WishEngine, Any)` | rows `[]` |
| `legacy_and_rework_without_wish_engine_play_as_on_the_base` | Fire (Wishful, Pathfinder in Rework) and Frost (Arcane Overload from tick 300) casting for 2400 ticks: state hashes every 50 ticks and the final world's JSON, digests recorded at the stub commit | green (a preservation guard) |
| `abilities::wish_lever_tests::wish_engine_is_the_one_native_lever_and_a_spend_names_its_lever_and_share` (oracle-amend) | `wish_engine_share` is the counter for Wish Engine and 0 for every other native card at its caps; cap inside the G13 floor; Arcane Overload × (1 − cap) > 1; every (lever, share) cooldown distinct per faction and Frost row | "WishEngine at its caps: left 0.0, right 0.25" |

Stub (`stub:` commit, behaviour-neutral): `NativeEvent::WishCast { row_cooldown_ms }` and its call site passing the
row's cooldown; `cards::native::wish_engine_share` returning 0; the `mod wish_engine_tests;` line in
`cards/native/mod.rs`; the lever guard moved to `abilities/wish_lever_tests.rs` with its `mod` line in `abilities/mod.rs`.

## 9. Validation commands

- `cargo test -p rh-sim --features trusted-status-probes --lib wish`
- `cargo test -p rh-sim --features trusted-status-probes --lib cards::native`
- `cargo test -p rh-sim --test native_cards --test native_no_alloc --test hash_coverage --test content`
- `scripts/regolden-content.sh --check`

## 10. Risk and suggested model tier

Opus: the restore validator is the risk. A bound too tight refuses a legitimate holder's checkpoint (the oracle plays
every faction to the cap and restores at each cast, each landing and before each recast); a bound too loose admits a
forged one (the oracle's refusals). The non-holder path must stay exactly today's (the digests and the existing tests).

## 11. Known traps

- The share a cast spends is read at acceptance; the step comes at landing. A checkpoint between the two (Frost,
  Plague, Sentenced cast 250-350 ms) has `counter == s`; after the landing `counter == next(s)`.
- Fire: both charges back to back put two different cooldowns into one full clock; the charge lattice is the gcd over
  every cooldown in the holder's set, not the spend's two.
- `js_round(45000 × 0.9625) = 43313` (off the tick lattice): a holder's clocks leave the tick lattice even without
  Wishful.
- Float: the grid is `min(CAP, n × step)` with integer `n` in the handler, the check and the validator alike; compare
  bit-exactly (`counter == CAP || counter == round(counter / step) × step`), never accumulate.
- No allocation in the producer or the handler; the validator runs at restore only.

## Proposed DEVIATIONS (for the owner)

- Wish Engine counts landed casts only, steps by the world's Wish row (Fire per charge), and the 50% floor is the
  combined multiplier floor; with Wishful Thinking a cast can reach 0.375 of the row's cooldown (decision 2 and the flag
  in section 1).

## Notes from previous attempts
<!-- Coordinator appends on escalation: tier, branch, the gate's failure block. Nothing else. -->
