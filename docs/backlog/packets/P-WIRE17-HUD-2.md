# P-WIRE17-HUD-2: protocol 17 carries the champion panel values; shared HUD negative vectors

- **Serves:** not in the plan: owner approval 2026-11-10 (MIGRATION checkpoint, decision 3: the Unity HUD presents what
  the legacy HUD presents; bottom-left damage panel)
- **Implementer tier:** implementer-opus (wire format, observation, cross-crate)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10: read the legacy code, one sanity test per build);
  golden vectors required for a wire change · D2 n/a · D5/D6/D9 none
- **Status:** oracle committed on `packet/P-WIRE17-HUD-2` (oracle author, 2026-11-12).

## 1. ID and outcome
Split from P-WIRE17-HUD-1 (size), and split again by the oracle author (2026-11-12, see "Split"). Still protocol 17,
`v17.json` regenerated. When this lands:
- The owner build summary (State key 13) carries, after its mob rows, the numbers the legacy bottom-left champion panel
  prints in its auto and passive rows (`packages/client/src/ui/championCombatModel.ts:91-216`) plus the Fire roam
  charge: a list of (panel code, value) pairs, owner-only, quantized to `HUD_QUANTUM`.
- `protocol/fixtures/v17.json` carries shared negative vectors for the HUD-1 fields (reviewer note on P-WIRE17-HUD-1,
  2026-11-11), refused identically by the Rust, C# and JS decoders, plus the panel's own refusals.

**Split (oracle author, 2026-11-12).** The brief's three parts were (a) panel values, (b) weapon scaling terms in the
Welcome weapon table, (c) negative vectors. (a) alone touches build_summary, observe, the projection, the key-13 codec,
samples, the C# codec and the JS decoder (estimate ~350 changed lines); with (b) it passes 400. This packet is (a)+(c).
(b) moves to **P-WIRE17-HUD-2b** (`docs/backlog/packets/P-WIRE17-HUD-2b.md`, brief only), together with the panel's
Wish row: every Wish number is a per-faction content constant (championCombatModel.ts:219-227), as weapon scaling is
per-weapon content, and several have no Rust constant yet (see HUD-2b).

## 2. Dependencies
- P-WIRE17-HUD-1 merged (key 13, `HUD_QUANTUM` = 1e-4, the three decoders; strictly serial with any other key-13 or
  decoder packet).

## 3. Relevant legacy paths (read by the oracle author)
- `packages/client/src/ui/championCombatModel.ts`
  - `:74` `fmt`: display rounding to 2 decimals (Unity's job; the wire keeps 1e-4).
  - `:96-97` attacks per second = `1 / attackInterval(paced faction, held weapon, asMult mirror)`.
  - `:98-113` auto row: `base = damagePerHit`, `bonusHp = max(0, maxHp - FACTIONS[f].hp)`, `scalingDamage` with
    `bonusDefense = max(0, armorBonus) + shieldBonus`, `hitMult = folded.mults.hit` (card fold);
    physical = `(base x phys + scaling.phys) x hitMult`, magic = `(base x magicShare + scaling.magic) x hitMult`,
    true = `base x trueShare x hitMult`.
  - `:114-116` Fire roam text: `min(1000, max(0, roamCharge))`/1000, or "armed" when `roamReady`.
  - `:124` value line `total / hit · aps/s`; `:126` tooltip prints the three components.
  - `:144-155` Fire "Dragonslayer": value `burn = (burn x bm + AP_DOT_RATIO x SO + FIRE_BURN_AD_RATIO x Offense) x
    dotMult` (bm = held weapon `dpsMult`, `signatures.ts:83`); scaling line prints `AP_DOT_RATIO`, `FIRE_BURN_AD_RATIO`,
    `dotMult`.
  - `:157-175` Sentenced "Sentence": value `pulse x 100` % target HP / hit, `pulse = markPct(f, stacks, heavier, bonus)
    x markWeight(f, w, as, MARK_AS_EXPONENT = 1) x sentencedHuntMarkMultiplier(huntStacks)` (`mark.ts:44,62`,
    `sentencedHunt.ts:10`); scaling line prints `mark_kill x 100` (paced: 0.0135).
  - `:177-194` Plague "Rat King": value `disease = (plague x bm + PLAGUE_AP_PER_HIT x SO x hitsPerSecond) x dotMult`;
    scaling line: "Walk over a body" (0 bodies) / "Zombie fallen" (no living zombie) / zombie hp / max hp and bodies.
  - `:196-203` Frost "Ice wall": value `slow x 100` % AS (`slow = params.slow + frostChillBonusOf(SD, as - 1)`,
    `championPassives.ts:21`) and `(1 - CHILL_MOVE_MULT) x 100` % MS; scaling line prints `FROST_ELITE_GUARD_BONUS` and
    ACTIVE / "elite fights" from `frostEliteGuard`.
  - `:205-214` Holy "Radiant": `hpFrac = clamp(hp / maxHp, 0, 1)` (1 when maxHp is 0), `share = lifestealFraction(f,
    hpFrac)` (`factions.ts:177`: `min(ls_cap, ls0 + ls1 x (1 - hpFrac))`), `campLeech = holyCampLifestealOf(camps) x
    (Bloodthirst and hpFrac < 0.5 ? 2 : 1)` (`championPassives.ts:6`); value `(share + campLeech) x 100`; scaling line
    prints camps and `campLeech x 100`.
  - `:219-227` Wish row: per-faction constants only (moved to HUD-2b).
- `packages/client/src/ui/championCombatHud.ts:72`: the panel is shown only while the local player is alive and the
  room is training or active (Unity's job: status and phase are already on the wire).
- `packages/shared/src/weapons.ts:96-124` (weapon table), `:172` `attackInterval`, `:181` `damagePerHit`, `:203`
  `scalingDamage`; `packages/shared/src/factions.ts:48-70` (faction sheet), `:218` `pacedFaction`;
  `packages/shared/src/fireRoam.ts:10-21`.

## 4. New paths
- tests only (see "Oracle files"); `protocol/fixtures/v17.json` is regenerated by the implementer with
  `cargo run -p rh-protocol --bin protocol-fixtures`.

## Field list (decided by the oracle author; the tests pin it)

Every number the legacy auto and passive rows print in their value and scaling lines, plus the three per-hit
components the auto tooltip prints and the Fire roam charge. Codes are `rh_sim::build_summary::PanelCode` variant
indices (append only). Notation: `p` the owner's `Player`, `m = p.core.modifiers.mirrors()`, `w =
p.core.active_weapon()`, `f = content::paced(faction)`, `bm = content::weapon(w).dps_mult`, `dot =
p.core.modifiers.mult_of(MultKey::Dot)` (the card/farm fold only, as legacy's `folded.mults.dot`), `h =
p.core.modifiers.hit_mult()`, `aps = 1 / content::attack_interval(&f, w, m.as_mult)`.

| Code | Name | Factions | Legacy | Rust source | Unit |
|---|---|---|---|---|---|
| 0 | HitPhysical | all | model.ts:110 | `pk = modifiers::packet(&p.core, w)` (`modifiers/mod.rs:581`): `pk.raw x pk.phys x h` | points/hit |
| 1 | HitMagic | all | :111 | `pk.raw x pk.magic x h` | points/hit |
| 2 | HitTrue | all | :112 | `pk.raw x pk.true_ x h` | points/hit |
| 3 | AttacksPerSecond | all | :96-97 | `aps` (`content.rs:309`) | 1/s |
| 4 | BurnDps | Fire | :145-148 | `(FIRE_BURN_DPS x DUEL_PACE x bm + DEFINITION.ap_dot_ratio x m.ap_bonus + DEFINITION.fire_ad_ratio x m.ad_bonus) x dot` | magic/s |
| 5 | BurnSoRatio | Fire | :152 | `DEFINITION.ap_dot_ratio` (0.6) | per point |
| 6 | BurnOffenseRatio | Fire | :152 | `DEFINITION.fire_ad_ratio` (0.5) | per point |
| 7 | DotMult | Fire | :152 | `dot` | multiplier |
| 8 | RoamCharge | Fire | :115 | `fire_roam::charge(now - p.roam.last_combat_at)`, 0 when `last_combat_at` is None (`systems/fire_roam.rs:28`) | 0..=1000 |
| 9 | RoamArmed | Fire | :115 | `p.roam.ready` as 0/1 | flag |
| 10 | MarkPulse | Sentenced | :164-168 | `modifiers::mark_pulse(p, w, 1.0, true)` (`modifiers/mod.rs:706`) | fraction of target max hp |
| 11 | MarkKillStack | Sentenced | :169 | `MARK_KILL_PCT x DUEL_PACE` (0.0135) | fraction |
| 12 | DiseaseDps | Plague | :181-182 | `(PLAGUE_DPS x DUEL_PACE x bm + DEFINITION.plague_ap_per_hit x m.ap_bonus x aps) x dot` | magic/s |
| 13 | CorpseStacks | Plague | :179,:184-186 | `p.farm.corpse_stacks()` | count |
| 14 | ZombieHp | Plague, only when stacks > 0 and a living zombie exists | :186 | `plague_zombies::zombie_of(w, id)` mob, `Status::Alive`: `vitals.hp` | points |
| 15 | ZombieMaxHp | as 14 | :186 | same mob: `vitals.max_hp` | points |
| 16 | ChillSlow | Frost | :198,:200 | `1 - modifiers::frost_chill(&p.core)` (`modifiers/mod.rs:637`) | fraction |
| 17 | ChillMoveSlow | Frost | :200 | `1 - CHILL_MOVE_MULT` (0.3) | fraction |
| 18 | EliteGuardBonus | Frost | :201 | `FROST_ELITE_GUARD_BONUS` (25) | points |
| 19 | EliteGuardActive | Frost | :201 | `p.frost_guard.active` as 0/1 | flag |
| 20 | HolyLifeSteal | Holy | :206-211 | `content::holy_lifesteal_fraction(hp_frac) + camp_leech` | fraction |
| 21 | HolyCampClears | Holy | :208,:212 | `p.camps_cleared` | count |
| 22 | HolyCampLeech | Holy | :209 | `camps_cleared x HOLY_CAMP_LIFESTEAL_PER_CLEAR x (2 if Bloodthirst and hp_frac < 0.5 else 1)` | fraction |

Holy `hp_frac = clamp(hp / max_hp, 0, 1)`, 1 when `max_hp <= 0` (legacy :206). Every panel carries codes 0-3 then
exactly its faction's codes, ascending; a Plague panel carries 14 and 15 only while both conditions hold.

### Deliberately left out (legacy prints them, this packet does not carry them)
- The auto row's total (value line, `:124`): the sum of codes 0-2; Unity adds three received numbers for display.
  A reviewer may call this an R-AUTH edge; adding a code later is append-only.
- Tooltip-only numbers: auto `:126-128` (attack-speed mirror, weapon scaling phys/magic, hit mult); Fire backlash,
  roam speed %, burst damage (`:116,:153-154`); Sentenced stacks, Heavier Sentence %, hunt % (`:170-174`); Plague
  hits/s, zombie projected max hp and damage, execute band and coefficient (`:190-193`); Frost and Holy tooltip
  constants; Holy hp % (`:213`). A follow-up packet can append codes if the owner wants the tooltips.
- The Wish row (`:219-227`) and the weapon scaling terms (`:119-122`, `weaponBar.ts:167`, `buildModel.ts:204,:224`):
  P-WIRE17-HUD-2b.

### Where the live Rust sim differs from the legacy panel formula (pinned to the legacy panel; display only)
- Plague disease: the live sim pays the SO rider per landed hit at the measured rate (`p.signature.ap_hits.rate()`,
  `systems/plague.rs:58-64`) and folds the DoT crit conversion into `Runtime::dot_mult()` (`modifiers/mod.rs:159,
  :425-437`); the panel, like legacy, estimates with `aps` and the fold's `MultKey::Dot` only. Same in legacy (the
  server and the panel differ there too): no deviation.
- Holy: the panel's life steal excludes card and mob leech ("before card and mob leech", `:213`); the GAINED strip
  (key 13 gains[4], HUD-1) carries those. As legacy.
- Archetype hitboxes (DEV-009/010/011) and no regen in combat (DEV-017) change no panel number.

## Wire layout (rh-protocol `state.rs`; types stubbed). All integers little-endian.
- Key 13 payload, when present: the HUD-1 bytes unchanged (9 x i32 gains, mob row count u8, mob rows), then appended:
  panel count u8 (<= `MAX_PANEL_VALUES` = 23), then that many rows of `code` u8 (< `PANEL_CODE_COUNT` = 23, strictly
  ascending) and `value` i32 = q(v) = `(v / HUD_QUANTUM).round()` (flags: 0 or 10 000).
- Encoder (`check`) and decoder refuse: count > 23 (`EncodeError::TooMany { what: "summary panel values", n, max: 23 }`
  / `DecodeError::TooMany`, checked before reading rows); code >= 23 (`BadValue`/`BadField("summary panel code")`);
  a code not above the previous (`BadField("summary panel order")`). Per-row order of checks: code, then order.
- Projection (`rh-policy/src/delivery/collections.rs`): `Observation.panel` (Some exactly when `summary` is Some) ->
  `WireBuildSummary.panel` in ascending code order; a summary with `panel: None` sends an empty panel. A non-finite
  value or one whose quanta do not fit i32 is refused (`EncodeError`), never clamped. The summary is compared and
  re-sent on its quantized form, panel included, as in HUD-1.
- C#: `WirePanelValue { byte Code; int Value; double Scaled }`, `WireBuildSummary.Panel`, `Hud.PanelCodeCount`,
  `Hud.MaxPanelValues` (stubbed). `BuildSummaryState` writes, checks and reads the panel; refusals map to
  `DecodeError.TooMany` / `BadField`, encoder refusals throw `EncodeException`.
- JS (`crates/rh-server/web/probe.html` `readBuildSummary`): `panel` rows `{ code, quanta, value: quanta x HUD_QUANTUM }`;
  error messages `"too many summary panel values"`, `"bad summary panel code"`, `"bad summary panel order"`.

## Vector names (generated by `samples.rs`, read by all three decoders)
Server (positive):
- `state_build_summary_panel`: State tick 216, key 13 present, gains `[25000, 15000, 0, -5000, 0, 0, 0, 0, 0]`, no mob
  rows, panel `(0,18182) (1,473697) (2,0) (3,19800) (4,643750) (5,6000) (6,5000) (7,12500) (8,2500000) (9,0)`.
- `state_build_summary`, `state_build_summary_empty`: unchanged values, empty panel (one more zero byte).
- `state_all_max_budget`: its summary carries all 23 codes, each `i32::MIN`; the frame stays exactly 247,696 bytes
  (the prop-label padding absorbs the panel).

malformedServer (exact bytes pinned in `crates/rh-protocol/tests/hud_panel_wire.rs` `wanted_negatives`; camp prefix =
`88 05 01 06 01 03 1e 02 00` + f64 1000 + f64 181000; summary prefix = `88 05 01 0d 01` + 36 zero bytes):

| Name | Bytes | Rust | C# | JS |
|---|---|---|---|---|
| `state_camp_reward_stat_10` | camp prefix + `0a 10 27 00` | BadField("camp reward") | BadField | /camp reward/ |
| `state_camp_ward_verdict_3` | camp prefix + `00 03` | BadField("camp ward") | BadField | /camp ward/ |
| `state_camp_ward_missing_expiry` | camp prefix + `00 01` | Truncated | Truncated | /./ |
| `state_build_summary_gains_short` | `88 05 01 0d 01` + 32 zero bytes | Truncated | Truncated | /./ |
| `state_build_summary_mob_stat_9` | summary prefix + `01` + `00 09 01` + i32 1 + `00` | BadField("summary stat code") | BadField | /summary stat code/ |
| `state_build_summary_panel_code_23` | summary prefix + `00 01` + `17` + i32 1 | BadField("summary panel code") | BadField | /summary panel code/ |
| `state_build_summary_panel_order` | summary prefix + `00 02` + `03` i32 1 + `03` i32 1 | BadField("summary panel order") | BadField | /summary panel order/ |
| `state_build_summary_panel_count_over` | summary prefix + `00 18` + 24 rows (`c` + i32 1, c = 0..23) | TooMany | TooMany | /too many summary panel values/ |

## Identities
- Move: `OBSERVATION_VERSION` 25 -> 26 (`Observation.panel`); `POLICY_CONTRACT_VERSION` 19 -> 20 (projection).
- Do not move: `PROTOCOL_VERSION` (17), `MAX_STATE_KEYS` (13), `CHECKPOINT_FORMAT`, `REPLAY_FORMAT`, content hash; no sim
  state, schedule row or RNG draw changes, so every fixture's state hash is unchanged.
- `parity/abilities/hash-tape.json` records `observationVersion`: regenerated by the coordinator (protected path), as
  for HUD-1 (`e9dc0b84`).

## 5. Exclusive write scope
- `crates/rh-sim/src/build_summary.rs` (`champion_panel` body; the types are stubbed), `crates/rh-sim/src/observe.rs`
  (fill `Observation.panel` in `observe_into` without allocating; `OBSERVATION_VERSION`),
  `crates/rh-sim/src/reward_chests/trophy_observer_tests.rs:259` (version pin 25 -> 26 only)
- `crates/rh-protocol/src/state.rs` (key-13 panel write/read/check), `crates/rh-protocol/src/samples.rs` (vectors above)
- `crates/rh-policy/src/delivery/` (projection and comparison), `crates/rh-policy/src/lib.rs` (`POLICY_CONTRACT_VERSION`
  and its pin at `:1853`)
- `client-unity/RoguehallaNet/Protocol/State.cs` and its synced copy (`bash client-unity/sync-net.sh`)
- `crates/rh-server/web/probe.html` (JS decoder); `protocol/fixtures/v17.json` (regenerated only)
- Not in scope: `crates/rh-protocol/src/weapon.rs` (HUD-2b).

## 6. Contracts and references
- C-OBS: the panel is computed from the viewer's own `Player` (and its own zombie) only and travels inside that seat's
  key 13; an unseated viewer gets none.
- R-AUTH: Unity shows these numbers; it never computes them (beyond display rounding and the auto total, see above).
- HUD-1's quantization (`HUD_QUANTUM`, refuse never clamp) and re-send rule.

## 7. Behaviour to preserve
- No schedule row, RNG draw or sim state change; `champion_panel` is read-only and allocation-free (stack array);
  `tests/no_alloc.rs` and the observation no-alloc tests stay green.
- Bots keep acting on the same facts (the projection gains a field; no decision reads it).

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-WIRE17-HUD-2 --regen-fixtures` passes (full).
- The oracle tests below pass; `node tools/protocol-js/check-vectors.mjs`, `dotnet test
  client-unity/RoguehallaNet.Tests` and `bash client-unity/sync-net.sh --check` pass on the regenerated `v17.json`.

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/observe/panel_tests.rs`: Holy (Sword, Machine Gun, Ad1, Bloodthirst, 40% hp, 6 camps) and Fire
  (Wand, Here Comes the Boom, Ad1, Ap1, 5 s out of combat, then armed) panels equal the legacy formulas worked by hand
  within one quantum; a fresh champion of each faction carries exactly its codes (Sentenced pulse 0.0216, Plague
  disease 62.4, Frost 0.32/0.3/25/0, Holy 0.07); C-OBS guard; `OBSERVATION_VERSION` 26.
- `crates/rh-protocol/tests/hud_panel_wire.rs`: key-13 panel layout and round trips, refusals (code 23, order,
  duplicate, 24 values), the named server samples, the eight malformed vectors byte for byte with their reasons.
- `crates/rh-protocol/tests/hud_wire.rs`: `summary_frame` now appends the panel bytes (see "Existing tests").
- `crates/rh-protocol/tests/vectors.rs`: reason arms for the eight new malformed vectors.
- `crates/rh-policy/tests/hud_panel_delivery.rs`: projection within half a quantum, ascending codes, empty panel
  without an observed one, NaN / out-of-range refused, re-send on a quantized panel change only, identities 26/20.
- `crates/rh-policy/tests/hud_delivery.rs`: identity pins moved to 26/20 (see "Existing tests").
- `client-unity/RoguehallaNet.Tests/HudPanelProtocolTests.cs`: C# layout, round trip, encoder refusals, the
  regenerated `state_build_summary_panel` vector, presence of the eight malformed vectors.
- `client-unity/RoguehallaNet.Tests/ProtocolVectorTests.cs`: switch cases for the eight malformed vectors.
- `tools/protocol-js/check-vectors.mjs`: JS reasons for the eight malformed vectors, the panel vector, empty panel on
  `state_build_summary`.
- this brief.

## Existing tests this packet changes (owner approval required; all mechanical)
- `crates/rh-protocol/tests/hud_wire.rs` (stub commit): `panel: Vec::new()` in three `WireBuildSummary` literals (the
  struct gained a field). (oracle commit): `summary_frame` appends the panel count and rows, because key 13's bytes
  grow; `build_summary_round_trips_with_the_brief_layout` and `build_summary_refuses_an_over_cap_mob_row_count` are
  red until the codec writes the panel.
- `crates/rh-policy/tests/hud_delivery.rs` (oracle commit): identity pins 25 -> 26 and 19 -> 20.
- `crates/rh-protocol/tests/vectors.rs`, `client-unity/RoguehallaNet.Tests/ProtocolVectorTests.cs`,
  `tools/protocol-js/check-vectors.mjs` (oracle commit): additions only (reason arms and checks for new vectors).
- Implementer: `crates/rh-sim/src/reward_chests/trophy_observer_tests.rs:259` (25 -> 26) and
  `crates/rh-policy/src/lib.rs:1853` (19 -> 20).
- `crates/rh-protocol/tests/vectors.rs::committed_vectors_match_the_encoder` is red from the stub commit on: the
  vectors' `debug` text prints `WireBuildSummary` and now shows `panel: []`. Regenerating `v17.json` fixes it.

## Stub notes (to be replaced, not kept)
- `build_summary.rs`: `PanelCode`, `PANEL_CODE_COUNT`, `ChampionPanel` (get/set/clear/iter/codes) are final;
  `champion_panel` returns an empty panel. `observe.rs`: `Observation.panel` exists and is never filled.
- `state.rs`: `WirePanelValue`, `PANEL_CODE_COUNT`, `MAX_PANEL_VALUES` are final; `WireBuildSummary.panel` is neither
  written, read nor checked. `samples.rs` / `collections.rs`: `panel: Vec::new()` placeholders.
- C#: `WirePanelValue`, `Panel`, `Hud.PanelCodeCount`, `Hud.MaxPanelValues` exist; the codec ignores the panel.

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes observe::`, `cargo test -p rh-protocol`, `cargo test -p rh-policy`
- `cargo run -p rh-protocol --bin protocol-fixtures`, `node tools/protocol-js/check-vectors.mjs`
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`

## 10. Risk and suggested model tier
Opus: observation, wire and three decoders; the panel formulas cross several modifier folds.

## 11. Known traps
- Use the fold's `MultKey::Dot` for the panel, not `Runtime::dot_mult()` (which adds Plague's crit conversion).
- `Observation` is reused by `observe_into`: reset `panel` for an unseated viewer.
- The roam charge changes 2.5 units a tick for 20 s while ramping: the summary is re-sent about every tick then (one
  key-13 item, about 100 bytes). Legacy synced `roamCharge` just as often; coarsening it would be a deviation.
- `observe.rs` is a shared file: this packet merges alone.

## Notes from previous attempts
