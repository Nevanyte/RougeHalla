# P-CAMP-BUFF-THEMES-1: each zone's camps pay a themed stat, spread evenly, as a sim switch the live profiles turn on

- **Serves:** owner beta-follow-up decision 2 (MIGRATION, 2026-11-10: "Port all three Nov 4 changes": zone-themed camp
  buffs, legacy commit `a7b5c4ce` on `origin/claude/adoring-edison-mxt8ab`)
- **Implementer tier:** implementer-opus (rh-sim state, reward RNG draw order, save/restore/hash)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10): port by reading `a7b5c4ce`, one sanity test on the
  spread; existing parity fixtures stay byte-identical (the default stays the in-repo legacy roll) · D2 n/a

## 1. ID and outcome
In the unreleased legacy patch a camp's normal kills pay a **buff**: one of the nine mob stat kinds, drawn so each zone
mostly pays its own four (its theme), every buff is within a maximum distance of every camp, and the nine are spread
as evenly as possible. In this repo's legacy and in Rust a camp pays its own mob type's stat. Bringing `a7b5c4ce` into
`packages/` would move the file hash 218 captures pin (the reason P-REGEN-COMBAT-1 used a switch), so this packet does
the same: a `SimConfig` switch, default `Legacy` (serializes as nothing; no hash, fixture, checkpoint or replay moves),
`Themed` opted into by the live `source-arena` profile. Under `Themed` the camp roll follows `rollCampRosters`, each
camp carries its buff, a credited normal kill grants the camp's buff stat, and the camp row's reward on the wire (added
by P-WIRE17-HUD-1, already per camp) is the buff, so the Unity badge needs no change.

## 2. Dependencies
- P-WIRE17-HUD-1 merged (per-camp reward on the wire). P-REGEN-COMBAT-1-fix merged first (same `statics.rs` encoding
  rule: this switch must get its own digest value, not a shared string).

## 3. Relevant legacy paths
Read with `git show a7b5c4ce:<path>` (the commit is not in this branch's `packages/`; do not merge it):
- `packages/shared/src/rosters.ts` (`rollCampRosters`: the draw, its three factors, the repair steps)
- `packages/shared/src/constants.ts` (`CAMP_BUFF_MAX_DISTANCE_TILES` 65, `CAMP_BUFF_OFF_THEME_WEIGHT` 0.15,
  `CAMP_BUFF_NEED_REF_TILES` 30, `CAMP_BUFF_NEED_CAP_TILES` 90, `CAMP_BUFF_BALANCE_POWER` 2, `CAMP_BUFF_REPAIR_STEPS` 160)
- `packages/shared/src/mobStats.ts` (`mobStatKey`, `MOB_STAT_KEYS`, `campRewardId`), `packages/shared/src/schema.ts`
  (`CampState.buff`)
- `packages/server/src/sim/camps.ts` (roll at camp publish, only from `world.rewardRandom`, 2n - 1 draws for n camps),
  `mobLife.ts` (the kill grants the buff's stat), `mobStats.ts` (toast text names the source mob)
- `packages/shared/test/rosters.test.ts`, `packages/server/test/camps.test.ts` (the legacy acceptance numbers)

## 4. New paths
- `crates/rh-sim/src/mob_catalog/camp_buffs.rs` (stub on `packet/P-CAMP-BUFF-THEMES-1`: `CampSite`, `CampRoll`,
  `roll_camp_rosters`; the implementer replaces the body with the port of rosters.ts:61-297)
- Oracle files (read-only): `crates/rh-sim/src/camp_buff_tests.rs`, `crates/rh-server/tests/camp_buffs_profile.rs`

## 5. Exclusive write scope
- `crates/rh-sim/src/statics.rs` (`CampBuffRule`, `SimConfig::camp_buffs`: complete in the stub, edit only if needed),
  `crates/rh-sim/src/lib.rs` (re-exports only), `crates/rh-sim/src/hash.rs` (doc comment: the new config field and the
  new World field's unit-when-Legacy encoding, see "Storage" below)
- `crates/rh-sim/src/mob_catalog/camp_buffs.rs` (the roll), `crates/rh-sim/src/mob_catalog/mod.rs` (`mod` line only)
- `crates/rh-sim/src/constants.rs` (append the six `CAMP_BUFF_*` rows to `content!`; see "Identities")
- `crates/rh-sim/src/systems/mobs.rs` (`initialize_body`, :111: under `Themed` call `roll_camp_rosters` instead of
  `roll_camp_types`, at the same position, from `w.reward_rng` only; store the buffs)
- `crates/rh-sim/src/mob_runtime.rs` (`MobRuntime::buffs`, see "Storage"), `crates/rh-sim/src/sim.rs`
  (`Sim::camp_buffs`, stubbed to `&[]`), `crates/rh-sim/src/checkpoint.rs` (`check_world` rules)
- `crates/rh-sim/src/systems/mob_life.rs` (`pay`, :499-515: the stat and the toast),
  `crates/rh-sim/src/modifiers/farm_text.rs` (a `grant_notice` variant naming the mob killed)
- `crates/rh-sim/src/observe.rs` (`camp_hud_into`, :405-436: read the buff, nothing else)
- `crates/rh-sim/src/systems/walk_hint/helper_tests.rs` (:657, the one `MobRuntime { .. }` literal outside mobs.rs)
- `crates/rh-sim/tests/hash_coverage.rs` (a Themed mob scenario and the `VALIDATED` rows the campaign needs; no
  existing assertion changes). The stub already added `camp_buffs_themed_state` (config only, practice arena) to
  `scenarios()`, as P-REGEN-COMBAT-1 did for `regen_in_combat`: without it the campaign fails on the new
  `statics.config.camp_buffs` null leaf. An addition to an existing test, listed here for the owner.
- `crates/rh-server/src/runtime.rs` (`Settings::sim`: `camp_buffs: Themed` for both profiles)
- The harness mirrors of the live config, if the coordinator wants them on the live rule (they carry
  `regen_in_combat = Off` and got `camp_buffs: Legacy` in the stub): `crates/rh-headless/tests/source_arena_soak.rs`,
  `crates/rh-headless/examples/{hitbox_compare,full_map_cost,source_soak}.rs`. Say so in the hand-off if changed.
- Content-hash carry, only with the coordinator's approval (as 4c9a5c50 did): `crates/rh-sim/tests/content.rs`
  (`GOLDEN_CONTENT_HASH` only), `parity/abilities/hash-tape.json` (`contentHash` only),
  `protocol/fixtures/archetypes_v1.json` (`contentHash` only), `tools/unity-browser-reload-proof/{check,normal-companion}.mjs`
- No `CHECKPOINT_FORMAT`, `REPLAY_FORMAT` or `OBSERVATION_VERSION` change expected (see "Identities").
- Out of scope: `rh-policy` (another agent), `rh-protocol`, Unity, `systems/{melee,projectiles,ledger,signatures}.rs`,
  `mapgen/`, `cards/`.

## 6. Contracts and references
- C-RNG: the roll draws only from the reward stream, never the sim stream or the public seed; under `Legacy` the draw
  count and order are exactly today's.
- C-OBS: a camp's buff is public the same way its reward row already is (P-WIRE17-HUD-1); nothing new is sent.
- Determinism: ordered iteration only; no float in the draw that differs across platforms (legacy uses whole-number
  balance factors: copy the arithmetic).

## 7. Behaviour to preserve
- Every parity fixture, the hash tape and the determinism sweep byte-identical under the default config.
- Elite camps: elites grant no stat and drop an augment chest; unchanged.
- Training: say in the hand-off whether training opts in (legacy does whatever `camps.ts` does for training rooms).

## 8. Acceptance checks
- Oracle (one loose-proof test, `Themed`, seeds 1-8 of the certified generator or the fixture maps): every camp has a
  buff among the nine kinds; at least 60% of camps pay a buff of their own zone's theme (legacy measured about 70%);
  from every camp each of the nine buffs is within `CAMP_BUFF_MAX_DISTANCE_TILES` or the legacy fallback distance;
  the counts of the nine buffs differ by at most the legacy band.
- Oracle: under `Themed` a credited normal kill at a camp whose buff differs from its mob type grants the buff's stat
  stacks, not the mob type's.
- Oracle: `Legacy` and `Themed` give different statics digests; `Themed` round-trips through checkpoint and replay; a
  default-config state hash is unchanged.
- Carries a reviewer note on P-REGEN-COMBAT-1-fix (2026-11-12, MINOR, same file and tier): a `hash_coverage` case that
  restores a `regen_in_combat = Off` checkpoint whose `statics` precedes the format tag (the path that decodes through
  the checkpoint's `Buf` deserializer, which reads `"off"` only because serde's default `is_human_readable()` is true),
  and the same case for this packet's switch. The new switch's non-default value must get its own hasher tag, as
  `regen_in_combat` now has (`statics.rs`: human-readable form in JSON, a distinct tag for the hasher).
- `cargo run -p rh-parity --bin parity-report` all MATCH; `scripts/gate.sh --oracle packet/P-CAMP-BUFF-THEMES-1` passes.

## Oracle files (read-only for implementers)
Commit `oracle: P-CAMP-BUFF-THEMES-1` on `packet/P-CAMP-BUFF-THEMES-1`:
- `crates/rh-sim/src/camp_buff_tests.rs` (unit tests; its `mod` line in `lib.rs` is in the stub):
  - `camp_buff_themed_roll_keeps_each_zone_on_its_theme_spreads_the_nine_evenly_and_in_reach` (fails on the stub:
    45 draws, not 2n - 1 = 99). Pure roll over the five committed legacy full maps (`mapdata/fixtures/seed1`, `seed2`,
    `domain-maps` x3) x eight reward salts: 2n - 1 draws; every mob type a normal type of the camp's own zone; `buff`
    None exactly on theme; an off-theme buff is the spill type of the nearest camp whose zone has the stat on theme;
    every stat on floor(n/9)..=ceil(n/9) camps; >= 60% of camps on theme; the nearest camp paying each stat within the
    camp's bound (65 tiles or its ninth-nearest camp) plus one tile; at least 6 distinct rolls of 8 salts.
  - `camp_buff_themed_roll_draws_2n_minus_1_from_the_reward_stream_only` (fails: the world drew the bag's 45, not 99).
    A Themed lobby world consumed exactly 99 - 45 more reward draws than the Legacy one; its rosters and buffs equal
    the pure roll at the legacy roll's stream position; elites, `spawn_rng`, `wind_rng` unchanged.
  - `camp_buff_themed_buffs_round_trip_and_reach_the_state_hash` (fails: no `world.mob_runtime.buffs` array).
    `statics.config.camp_buffs = "themed"`, `world.mob_runtime.buffs` one entry per camp; restore is hash- and
    JSON-exact; editing an off-theme buff to another valid type moves the hash (or is refused); `check_world` refuses a
    short row and a Legacy world carrying buffs.
  - `camp_buff_themed_camp_row_reports_the_buff_to_every_seat` (fails: `camp_buffs()` empty). The HUD reward row of
    every camp is the farm row of `buff.unwrap_or(mob_type)`, identical for both seats.
  - `camp_buff_themed_normal_kill_grants_the_buff_stat_and_an_elite_grants_none` (fails: no off-theme camp).
    `mob_life::pay` of a normal kill at an off-theme camp adds `kill_stacks` (3) to the buff type and nothing to the
    mob's type; the toast starts `"<mob killed>: +3 kill stacks of <buff type>"`; an elite award grants no stat.
  - Guards (pass on the stub, must keep passing): `camp_buff_legacy_rule_rolls_the_bag_and_draws_exactly_as_before`
    (Legacy: `roll_camp_types`, 9 draws a zone at the same stream position; no buffs; a checkpoint without the new keys
    restores to the same hash), `camp_buff_legacy_normal_kill_grants_the_mob_type_stat`,
    `camp_buff_rule_is_its_own_statics_identity_and_legacy_folds_nothing` (the eight `mob_spacing` x
    `regen_in_combat` x `camp_buffs` digests are distinct; JSON `"themed"`, hash tag `"camp_buffs=themed"`),
    `camp_buff_and_regen_switches_restore_when_statics_precede_the_format_tag` (the carried `Buf`-path note, both
    switches), `camp_buff_themed_replay_verifies_and_does_not_pass_for_legacy`.
- `crates/rh-server/tests/camp_buffs_profile.rs`: `the_live_profiles_opt_into_themed_camp_buffs` (fails: source-arena
  carries `Legacy`). Both profiles `Themed`, the default `Legacy`, and a world built from the live profile on
  `parity/maps/seed1.map.json` publishes one buff per camp, some `Some`.
- `docs/backlog/packets/P-CAMP-BUFF-THEMES-1.md` (this brief)

## Oracle author notes (2026-11-12)

### Rule table (legacy a7b5c4ce; read with `git show a7b5c4ce:<path>`)
| Rule | Legacy |
|---|---|
| The nine stat kinds `MOB_STAT_KEYS`, catalog order of first type: damage, moveSpeed, maxHp, ap, armor, shield, ad, attackSpeed, lifesteal (the weighted draw iterates in this order) | `packages/shared/src/mobStats.ts:107-112` |
| A zone's theme is the four stats its four normal types pay (`zoneTheme`, `zoneStatTypes`) | `packages/shared/src/rosters.ts:53-55, 270-282` |
| Draw: camps in a `shuffle`d order (n - 1 draws; `rng.ts:47-55`, from the end, `randInt(rng, 0, i + 1)`), then one draw per camp, `rng() * total` over weights theme (1, or 0.15 off theme) x need `1 + (d/ref)^2` (d the distance to the nearest camp already given the stat, capped at 90 tiles; ref 30 tiles; world units) x balance `(n/9 / (count + 1))^2` (a loop of multiplications); pick the first b where the running `x -= w[b]` goes below 0, else the last | `rosters.ts:113-148` |
| Repair: no draws; at most 160 best moves (one reassign, or a two-camp swap) by key `25 dEx + 5 dBand - dTheme` strictly below 0, first found wins (camp, then stat, then the other camp); bound per camp `max(round(65 x 32), ninth-nearest camp distance)`; band floor(n/9)..ceil(n/9); coverage ignored when n < 9 | `rosters.ts:75-89, 151-226` |
| Types: on theme, the zone's type paying the stat and `buff` ""; off theme (a second pass in camp order), the zone's least-used type (ties by catalog order rotated by camp index, `(c + k) % 4`) and `buff` = `spillType`: the type paying the stat in the zone of the nearest camp (strict `<`, camp order) that has it on theme; fallback the first zone in `FACTION_IDS` order | `rosters.ts:244-297` |
| Distances: `Math.round(Math.sqrt(dx*dx + dy*dy))`, whole world units | `rosters.ts:61-73` |
| Constants: MAX_DISTANCE_TILES 65, OFF_THEME_WEIGHT 0.15, NEED_REF_TILES 30, NEED_CAP_TILES 90, BALANCE_POWER 2, REPAIR_STEPS 160 | `packages/shared/src/constants.ts:602-614` |
| Rolled at world build (`rollRosters`) from `world.rewardRandom` only, 2n - 1 draws replacing the bag's 9 a zone; the elites are unchanged (`rollCampElites`, no draw) | `packages/server/src/sim/camps.ts:31-45` |
| Kill: a credited normal kill grants `MOB_KILL_STACKS` (3) of `CampState.buff`, else the mob's type; a killer downed in the same pass gets no stat; elites no stat (augment chest unchanged) | `packages/server/src/sim/mobLife.ts:262-270` |
| Toast: `"<mob killed>: +3 kill stacks of <buff type name> · <stat text> total"` when the buff is another type | `packages/server/src/sim/mobStats.ts:11-23` |
| Client: the badge and tooltip read `campRewardId` (buff, else type); a spill-over buff gets a dashed rim | `packages/client/src/ui/planning.ts`, `ui/campInfo.ts`, `render/CampBuffs.ts` |

Amounts are unchanged (the farm table's per-stack values); only which stat a camp pays changes. Training: legacy rolls
nothing without camps; Rust training has `MobMode::Off` (`systems/mobs.rs:63-80`), so opting it in changes only its
config identity. The oracle expects both live profiles on `Themed` (legacy has no switch).

### Storage (the implementer must follow it; the oracle reads it)
- `MobRuntime::buffs` (`mob_runtime.rs:432`): one `Option<MobTypeId>` per camp under `Themed` (None = pays its own
  type, legacy `buff: ""`), empty under `Legacy`. JSON path `world.mob_runtime.buffs`: an array under `Themed`; under
  `Legacy` it folds **no word** into the state hash and is `null` or absent in JSON (the guard reads `.is_null()`).
  Recommended: a newtype that serializes an empty row as a unit (as `RegenInCombat::Legacy` does), with
  `#[serde(default)]` for checkpoints written before the field. `skip_serializing_if` is refused by `Sim::check_layout`.
  An always-tagged `Option` would move every Legacy mob-world hash, including the pinned `LEGACY_FOLD`
  (`systems/mob_spacing_tests.rs:383`, an existing test).
- This uses for a World field the exception `hash.rs:20-31` says not to copy. It is safe only because `check_world`
  ties the row to the hashed config (`Legacy` => empty; `Themed` => one entry per camp when `mob_runtime` is Some), so
  within one statics digest the two shapes never meet. Update the `hash.rs` doc to say so. **Flagged for reviewer-opus
  and the coordinator**: it is the only way to meet "Legacy byte-identical" without moving pinned hashes.
- `CampRoster` stays unchanged: `rh-policy/src/delivery/collections.rs:951` builds it by literal (out of scope) and
  `Observation::camps` carries it whole, so a field there would break `rh-policy` and change the observation shape.
- `hash_coverage.rs` campaign: under this encoding `world.mob_runtime.buffs` is `null` in the existing Legacy mob
  scenarios (`mob_audit_states`), and the campaign fails on a null leaf it cannot fill (the `never` assertion) unless a
  Themed scenario supplies a value, plus `VALIDATED` rows for the fills `check_world` refuses. That file is in the
  write scope for this.

### Identities
- Content hash `b35f23ed00df75b3`: moves when the six constants are registered in `content!` (they must be:
  `tests/content.rs` `every_const_in_the_source_tree_is_registered_or_explained`). The carry touches
  `GOLDEN_CONTENT_HASH`, the hash tape's `contentHash`, `archetypes_v1.json` and the two browser-proof scripts, as
  4c9a5c50 did. Needs coordinator approval.
- Checkpoint 31, replay 25: no bump. `Legacy` folds nothing and old checkpoints read through `#[serde(default)]`, the
  reasoning that added `regen_in_combat` without a bump. The coordinator may decide otherwise.
- Observation 26, policy contract 20: no shape change (the HUD reward row exists; under `Themed` it reports the buff),
  so the hash tape needs no observation-version regeneration.
- Protocol 17: no wire change. The `state_camp_hud` row (P-WIRE17-HUD-1) carries stat and amount, all the badge needs.
  Legacy's dashed rim for a spill-over buff is derivable client-side (the row's stat differs from the mob type's farm
  stat); a Unity follow-up, not this packet.

### Not in this packet
- Bots: legacy's Brain reads the buff (`buildRoute.ts` `RouteCamp.buff`, `huntAdapter.ts` `MobLike.reward`,
  `perception.ts`); the Rust Brain (`rh-policy`) would need `camp_hud[i].reward` or `Sim::camp_buffs` in its percept.
- A `DEVIATIONS.md` row (the live rule differs from the in-repo legacy oracle, like DEV-017), proposed in the hand-off.

### Legacy doubts and limits of the oracle
- The weighted draw uses f64 (`0.15`, `/`, `*`, `sqrt`); IEEE gives JS and Rust the same results, so a faithful port
  is bit-exact, but no exact vector pins it: this machine is darwin / Node 25, not the Linux x64 / Node 22.23.4 capture
  platform, and the owner's loose-proof standard asks for none. The patched legacy roll was run here (scratch, not a
  capture) on the same five maps with mulberry32 draws to set the thresholds: theme >= 64%, every stat on 5-6 camps,
  0 bound misses in 40 rolls.
- The oracle does not prove the repair loop's tie order or the off-theme type choice (least used, rotated ties), only
  the properties above and the spill-over buff.

## 9. Validation commands
- `cargo test -p rh-sim camp_buff`, `cargo test -p rh-sim --test hash_coverage`, `scripts/gate.sh --quick`

## 10. Risk and suggested model tier
Opus. The draw is about 300 legacy lines with a repair loop; the risks are an extra reward-stream draw under `Legacy`
and a field that misses save, restore or the hash.

## 11. Known traps
- Bots: legacy's Brain reads the buff for its farm route (`buildRoute.ts`, `huntAdapter.ts`, `perception.ts`). The
  ported Brain is not live; list what it would need in the hand-off, do not edit `rh-policy` here.
- A DEVIATIONS row is needed (the live rule differs from the in-repo legacy oracle, as DEV-017 does for regen): propose
  it in the hand-off.
- The toast text change is presentation: out of scope unless the event text is built in `rh-sim`.

## Notes from previous attempts
