# P-WIRE17-HUD-2c: protocol 17 carries the Fire roam line and the auto tooltip's missing numbers

- **Serves:** not in the plan: owner approval 2026-11-10 (MIGRATION checkpoint, decision 3: bottom-left damage panel)
- **Implementer tier:** implementer-opus (rh-sim observation, key 13, Welcome terms, four decoders, cross-crate)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10: one worked sanity test per group); golden vectors
  required for a wire change · D2 n/a · D5/D6/D9 none
- **Status:** oracle committed on `packet/P-WIRE17-HUD-2c` (oracle author, 2026-11-12). Split from P-WIRE17-HUD-2b.

## 1. ID and outcome
Still protocol 17, `v17.json` regenerated. The Unity champion panel gets the last legacy fragments it leaves blank
(review of P-UNITY-HUD-BUILD-2):
- Fire roam line (`packages/client/src/ui/championCombatModel.ts:114-116` `fireRoamText`): the move-speed bonus for the
  current charge and the armed burst's damage, as owner panel codes 23-24 on State key 13; the four constants the line
  prints as text, as Welcome HUD terms 19-22.
- Auto tooltip (`:128`): the hit multiplier and the weapon scaling's physical and magic additions, as owner panel codes
  25-27 (every champion).

Decisions (oracle author, confirming the HUD-2b proposal): codes as proposed; the per-owner numbers go to key 13 (they
vary with the owner's charge and build: owner state, C-OBS), the constants to the Welcome (public content). Next free
codes after this packet: panel 28, HUD term 23. **Frost Wall** (Frost's Wish is Freeze on this branch) appends its own
codes after these; nothing is renumbered.

## 2. Dependencies
- P-WIRE17-HUD-2 (key 13 panel, codes 0-22) and P-WIRE17-HUD-2b (Welcome HUD block, terms 0-18): both merged.
- Strictly serial with any other key-13, Welcome or decoder packet (`observe.rs`, `samples.rs`, `probe.html` are shared).

## 3. Relevant legacy paths (read by the oracle author)
- `packages/client/src/ui/championCombatModel.ts`
  - `:115` "Fire Roam is armed" when `roamReady`, else `min(1000, max(0, roamCharge))/1000 charged` (codes 8, 9 already).
  - `:116` `(fireRoamSpeedMult(roamCharge) - 1) x 100` % move speed (code 23); `FIRE_ROAM_RAMP_MS / 1000` s (term 19);
    `fireRoamBurstDamage(mirrors.adBonus)` physical (code 24); `FIRE_ROAM_BURST_BASE` + `FIRE_ROAM_BURST_AD_SHARE` x
    Offense (terms 21, 22); `:115` `FIRE_ROAM_CHARGE_MAX` (term 20).
  - `:100-103` `scalingValues = scalingDamage(w, {ad, ap, bonusMaxHp, bonusDefense = max(0, armor) + shield}, asMult,
    interval)`; `:108` `hitMult = folded.mults.hit`; `:128` "Weapon scaling adds `scalingValues.phys` physical and
    `scalingValues.magic` magic before the `hitMult` x hit multiplier" (codes 26, 27, 25).
- `packages/shared/src/fireRoam.ts:2-7` constants, `:10-13` `fireRoamSpeedMult`, `:16-18` `fireRoamCharge`, `:20-22`
  `fireRoamBurstDamage` (`50 + 0.4 x max(0, offense)`).
- `packages/shared/src/weapons.ts:203-219` `scalingDamage` (dominant: the AP side only when `ap x sc.ap > ad x sc.ad`,
  strictly; otherwise the sum), `:96-124` the weapon table.
- `packages/server/src/sim/fireRoam.ts:25-31` `resetCharge` zeroes `roamCharge` on a landed hit or hurt and leaves
  `roamReady`; `:84-92` `update` sets `roamCharge = fireRoamCharge(elapsed)`.
- Rust: `crates/rh-sim/src/systems/fire_roam.rs:28-43` (`charge`, `speed_mult`, `burst_damage`, `pub(crate)`, already
  reachable from `build_summary.rs`), constants `crates/rh-sim/src/constants.rs:215-220` (registered);
  `crates/rh-sim/src/modifiers/mod.rs:592-636` `packet_with_sheet` computes the scaling `phys`/`magic` internally (not
  exposed); `crates/rh-sim/src/modifiers/mod.rs:139` `hit_mult`.

## Field table (decided; the tests pin it)
| Where | Code | Name | Legacy | Rust source | Unit / quantization |
|---|---|---|---|---|---|
| key 13 panel (Fire only) | 23 | RoamSpeedBonus | model.ts:116 | `fire_roam::speed_mult(c) - 1.`, `c` = the code-8 charge (0 when `last_combat_at` is None) | fraction; i32 quanta of 1e-4 (0.125 -> 1250) |
| key 13 panel (Fire only) | 24 | RoamBurstDamage | :116 | `fire_roam::burst_damage(m.ad_bonus)` | physical points; quanta (54.8 -> 548000) |
| key 13 panel (all) | 25 | HitMult | :108, :128 | `p.core.modifiers.hit_mult()` (the `h` of codes 0-2) | multiplier; quanta (2.5 -> 25000) |
| key 13 panel (all) | 26 | ScalingPhysical | :100-103, :128 | the `phys` term of `modifiers::packet_with_sheet` (`modifiers/mod.rs:605-607`) for `p.core`, the held weapon, `content::paced(f)`, base hp `content::faction(f).hp`; before `h` | points per hit; quanta |
| key 13 panel (all) | 27 | ScalingMagic | :128 | its `magic` term (`mod.rs:608-612`); before `h` | points per hit; quanta |
| Welcome HUD term | 19 | FireRoamRampMs | :116 | `rh_sim::constants::FIRE_ROAM_RAMP_MS` | ms, f64 (20000) |
| Welcome HUD term | 20 | FireRoamChargeMax | :115 | `FIRE_ROAM_CHARGE_MAX` | charge units, f64 (1000) |
| Welcome HUD term | 21 | FireRoamBurstBase | :116 | `FIRE_ROAM_BURST_BASE` | damage, f64 (50) |
| Welcome HUD term | 22 | FireRoamBurstAdShare | :116 | `FIRE_ROAM_BURST_AD_SHARE` | per bonus Offense, f64 (0.4) |

Panel order: codes 0-3, the faction's codes, then (Fire) 23, 24, then 25, 26, 27 for every champion. A panel is
`Some` exactly as before. Quantization and refusal (non-finite or out of i32 range: `EncodeError`, never clamped) are
HUD-2's, unchanged. Unity formats: `% move speed = code 23 x 100`; "after `term19 / 1000` s"; "(term21 + term22x
Offense)". It computes no rule from them (R-AUTH).

Implementation note (not pinned): factor the scaling `phys`/`magic` out of `packet_with_sheet` (e.g. a
`pub(crate) fn weapon_scaling(core, weapon, sheet, base_max_hp) -> (f64, f64)` that `packet_with_sheet` calls) so the
panel and the hit packet cannot drift; `modifiers/mod.rs` is in scope for that refactor only (no behaviour change,
every existing test and state hash unchanged).

## Wire (no layout change; bounds move)
- Key 13: `PANEL_CODE_COUNT` = `MAX_PANEL_VALUES` = 28 (Rust `state.rs`, C# `Hud.PanelCodeCount`/`MaxPanelValues`,
  JS `PANEL_CODE_COUNT`/`MAX_PANEL_VALUES` in `probe.html`). Rust and C# moved in the stub commit; JS is the
  implementer's.
- Welcome HUD block: `HUD_TERM_COUNT` = `MAX_HUD_TERMS` = 23 (Rust `hud_content.rs`, C# `WireHudContent.TermCount`,
  JS `readHud` literals 19 -> 23 in `probe.html`, `MAX_HUD_TERMS` in `tools/unity-browser-reload-proof/wire-metadata.js`).
  The server's Welcome grows 4 x 9 = 36 bytes (block 377 -> 413 bytes); the largest legal block 2 + 32 x 34 + 23 x 9 =
  1297 bytes.
- `state_all_max_budget` carries all 28 codes at `i32::MIN`: 5 more rows (25 bytes) absorbed by the prop-label padding
  (checked on the stub: the frame stays 247,696 bytes, `tests/quest_metadata.rs` green).

## Parsers to update (all four Welcome/state parsers)
| Parser | File | Change |
|---|---|---|
| Rust | `crates/rh-protocol/src/{state,hud_content}.rs` | bounds only (done in the stub) |
| C# | `client-unity/RoguehallaNet/Protocol/{State,WireHudContent}.cs` + Unity copy | bounds and `HudTerm` members (done in the stub) |
| JS probe | `crates/rh-server/web/probe.html` | `PANEL_CODE_COUNT = 28, MAX_PANEL_VALUES = 28`; `readHud` `m > 23`, `code >= 23` (and its comment) |
| JS reload proof | `tools/unity-browser-reload-proof/wire-metadata.js:18` | `MAX_HUD_TERMS = 23` (else the real `welcome` vector is refused by `check.test.mjs` "Real protocol 17 golden Hello and Welcome frames") |

## Vector names (generated by `samples.rs`, read by the Rust, C# and JS decoders)
Server (positive):
- **new** `state_build_summary_panel_tooltip`: State tick 216, key 13 present, gains `[25000, 15000, 0, -5000, 0, 0, 0,
  0, 0]`, no mob rows, panel = `state_build_summary_panel`'s ten rows then `(23,1250) (24,548000) (25,25000) (26,36364)
  (27,121212)` (the worked Fire owner below: 0.125, 54.8, 2.5, 3.6/0.99, 12/0.99).
- `welcome`, `welcome_ground_*`, `welcome_public_*`: `sample_hud()` carries 23 terms, 19-22 = 20000, 1000, 50, 0.4
  (equal to `wire_hud()`, held by `crates/rh-policy/tests/hud_content.rs::the_sample_block_is_the_servers_block`).
- `state_all_max_budget`: all 28 panel codes (automatic, `0..PANEL_CODE_COUNT`).

malformedServer:
| Name | Change | Bytes | Rust / C# / JS |
|---|---|---|---|
| `state_build_summary_panel_code_23` | **retired** (code 23 decodes now) | n/a | must be absent |
| `state_build_summary_panel_code_unknown` | **new**, bound-neutral replacement | summary prefix + `00 01` + `1c` + i32 1 | BadField("summary panel code") / BadField / /summary panel code/ |
| `state_build_summary_panel_count_over` | name kept, bytes move | summary prefix + `00 1d` + 29 rows (`c` + i32 1, c = 0..28) | TooMany(29) / TooMany / /too many summary panel values/ |
| `welcome_hud_term_count` | name kept, bytes move | 0 rows, term count 24, then the map | BadField("hud term count") / BadField / /bad hud term count/ |
| `welcome_hud_term_code` | name kept, bytes move | 0 rows, one term (23, 1.0) | BadField("hud term code") / BadField / /bad hud term code/ |

(summary prefix = `88 05 01 0d 01` + 36 zero bytes, as in P-WIRE17-HUD-2.)

## Identities
- Move (implementer): `OBSERVATION_VERSION` 26 -> 27 (`crates/rh-sim/src/observe.rs:20`; `Observation.panel`'s
  `ChampionPanel` gains five codes, its serialized array 23 -> 28), `POLICY_CONTRACT_VERSION` 20 -> 21
  (`crates/rh-policy/src/lib.rs:46` and its pin at `:1855`; the projected owner summary carries more codes), and the pin
  `crates/rh-sim/src/reward_chests/trophy_observer_tests.rs:259` 26 -> 27.
- Do not move: `PROTOCOL_VERSION` 17 (owner approved stamping 18 on the next deployed build as a separate step),
  `CHECKPOINT_FORMAT`, `REPLAY_FORMAT`, content hash (no new registry row; the four constants are already registered),
  `MAX_STATE_KEYS`. No sim state, schedule row or RNG draw: every fixture's state hash is unchanged.

## SHARED RECORDS (coordinator)
- `parity/abilities/hash-tape.json` `observationVersion` 26 -> 27: regenerate with
  `cargo test -p rh-sim --features trusted-status-probes --lib record_ability_hash_tape -- --ignored` (protected path).
  Until then `abilities::source_tests::hash_tape` is red on the implementer's branch (`hash_tape.rs:53`); that is
  expected, the coordinator regenerates on the merge.
- MIGRATION checkpoint identities: observation 27, policy contract 21.

## Deliberately left out
- Unity display of the new codes and terms (`client-unity/RoguehallaNet/Net/Ui/ChampionPanelText.cs`, the Unity
  panel): a Unity packet; this packet carries the numbers only.
- Attack-speed mirror (`:127`): already on the wire (`WireOwnerCombat.as_milli`).
- Auto total (`:124`): the sum of codes 0-2 (HUD-2 decision).
- `FIRE_ROAM_MAX_SPEED_MULT` (1.5): the line prints the current percent (code 23), not the cap.
- Plague hits/s (`:190`), Holy hp % (`:213`), the Fire burn per-stat split (`:153`), Fire backlash per swing (`:154`),
  Sentenced Heavier Sentence and hunt % (`:172-173`), Plague zombie projection and execute band (`:191-193`), Frost and
  Holy tooltip constants (`:202`, `:213`): tooltip-only; a later packet can append codes 28+ / terms 23+.

## 4. New paths
- tests only (see "Oracle files"); `protocol/fixtures/v17.json` is regenerated by the implementer with
  `cargo run -p rh-protocol --bin protocol-fixtures`, never hand-edited.

## 5. Exclusive write scope
- `crates/rh-sim/src/build_summary.rs` (`champion_panel` body; the codes are stubbed), `crates/rh-sim/src/observe.rs`
  (`OBSERVATION_VERSION` only), `crates/rh-sim/src/modifiers/mod.rs` (the scaling refactor of the implementation note,
  no behaviour change), `crates/rh-sim/src/systems/fire_roam.rs` (visibility only, if needed),
  `crates/rh-sim/src/reward_chests/trophy_observer_tests.rs:259` (pin 26 -> 27 only; another agent works in camp
  rewards: one-line change)
- `crates/rh-protocol/src/samples.rs` (sample terms 19-22, the new server vector, the four moved/renamed malformed
  vectors), `crates/rh-protocol/src/{state,hud_content}.rs` only if needed (bounds are final in the stub)
- `crates/rh-policy/src/delivery/projection.rs` (`wire_hud` terms 19-22), `crates/rh-policy/src/lib.rs`
  (`POLICY_CONTRACT_VERSION` and its pin)
- `client-unity/RoguehallaNet/Protocol/{State,WireHudContent}.cs` only if needed, then `bash client-unity/sync-net.sh`
- `crates/rh-server/web/probe.html`, `tools/unity-browser-reload-proof/wire-metadata.js`
- `protocol/fixtures/v17.json` (regenerated only)
- Not in scope: `crates/rh-sim/src/cards/`, `systems/{melee,projectiles,ledger,signatures}.rs`, `statics.rs`,
  `mapgen/`, `crates/rh-policy/src/bots/` (other agents), Unity UI.

## 6. Contracts and references
- C-OBS: codes 23-27 are computed from the viewer's own `Player` only and travel in that seat's key 13.
- C-NET / ADR 0011: append-only codes in protocol 17, Rust, C# and JS in one branch, vectors regenerated.
- R-AUTH: Unity prints the numbers; it never derives them.

## 7. Behaviour to preserve
- No schedule row, RNG draw, sim state or state hash change; `champion_panel` stays read-only and allocation-free
  (`tests/no_alloc.rs`, observation no-alloc tests green).
- Codes 0-22 and terms 0-18 keep their values; every other vector keeps its bytes.
- The hit packet (`modifiers::packet`) is unchanged by the refactor (combat parity).

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-WIRE17-HUD-2c --regen-fixtures` passes (full), except
  `abilities::source_tests::hash_tape` until the coordinator regenerates the tape (SHARED RECORDS).
- `node tools/protocol-js/check-vectors.mjs`, `node --test tools/unity-browser-reload-proof/*.test.mjs` (CI runs it,
  the gate does not), `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check` pass on
  the regenerated `v17.json`.
- The oracle author checked that a straightforward implementation (scaling split as in `packet_with_sheet`, the two
  roam helpers, the four terms, the vectors above, the JS bounds) passes every Rust, C#, JS and reload-proof oracle
  (scratch, not committed).

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/observe/panel_tooltip_tests.rs` (new): Fire roam bonus and burst at charge 250 (0.125, 54.8), full
  and armed (0.5), armed after a reset (0: follows the charge); hit mult and scaling split for Bow, Wand, Sword (SO side
  and the tie), Shield, Axe, worked by hand; only Fire gets codes 23-24 while every champion gets 25-27; C-OBS guard
  (another seat never observes the owner's new codes, unseated: none); `OBSERVATION_VERSION` 27.
- `crates/rh-sim/src/observe/panel_tests.rs`: code lists gain 23-27 / 25-27, version pin 27 (see "Existing tests").
- `crates/rh-protocol/tests/hud_tooltip_wire.rs` (new): bounds 28/23 and `HudTerm` 19-22; key-13 round trip with codes
  23-27, refusals (code 28, order, 29 values); the new server vector; the retired/new/moved malformed vectors byte for
  byte; `sample_hud` terms 19-22 and the `welcome` vector; term refusals at 23/24.
- `crates/rh-protocol/tests/{hud_content_wire,hud_panel_wire,vectors}.rs`: bounds moved (see "Existing tests").
- `crates/rh-policy/tests/hud_roam_terms.rs` (new): `wire_hud()` terms 19-22 equal legacy fireRoam.ts and the sim
  constants; identities 27/21.
- `crates/rh-policy/tests/{hud_delivery,hud_panel_delivery}.rs`: identity pins 27/21.
- `client-unity/RoguehallaNet.Tests/HudTooltipProtocolTests.cs` (new): C# bounds and `HudTerm` 19-22; round trip and
  encoder refusals; the regenerated `state_build_summary_panel_tooltip`, `state_build_summary_panel_code_unknown`,
  `state_build_summary_panel_count_over` and `welcome` vectors.
- `client-unity/RoguehallaNet.Tests/{HudPanelProtocolTests,HudContentProtocolTests,ProtocolVectorTests}.cs`: bounds and
  names moved.
- `tools/protocol-js/check-vectors.mjs`: the tooltip vector's codes and quanta, `code_23` absent, `code_unknown`
  present with its reason, `welcome` terms 0-22.
- this brief.

## Existing tests this packet changes (owner approval required; all mechanical: bounds and names follow the appended codes)
All in the **oracle** commit, so they are read-only for the implementer (the gate protects only files touched by
non-`stub:` commits; putting spec changes in the stub would leave them editable):
- `crates/rh-sim/src/observe/panel_tests.rs`: the three exact code lists gain 23-24 (Fire) and 25-27 (all); the
  version pin 26 -> 27.
- `crates/rh-protocol/tests/hud_content_wire.rs`: `HUD_TERM_COUNT`/`MAX_HUD_TERMS` 19 -> 23, last code
  `FireRoamBurstAdShare`, `legacy_terms` + 4 roam constants, max block 1261 -> 1297, refusal cases code 19 -> 23 and
  count 20 -> 24, the boundary term 18 -> 22, vector term count 19 -> 23.
- `crates/rh-protocol/tests/hud_panel_wire.rs`: bounds 23 -> 28, refusal code 23 -> 28, 24 -> 29 values,
  `state_build_summary_panel_code_23` -> `state_build_summary_panel_code_unknown` (code 28), count_over 29 rows.
- `crates/rh-protocol/tests/vectors.rs`, `client-unity/RoguehallaNet.Tests/ProtocolVectorTests.cs`: the renamed vector's
  arm.
- `client-unity/RoguehallaNet.Tests/HudPanelProtocolTests.cs`: bounds 28, refusals 28 / 29, the renamed vector.
- `client-unity/RoguehallaNet.Tests/HudContentProtocolTests.cs`: bounds 23, `LegacyTerms` + 4, refusal code 23.
- `crates/rh-policy/tests/hud_delivery.rs`, `hud_panel_delivery.rs`: identity pins 27/21.
- `tools/protocol-js/check-vectors.mjs`: renamed vector, welcome terms + 4, the new vector check.
- Implementer (in scope): `crates/rh-sim/src/reward_chests/trophy_observer_tests.rs:259` (26 -> 27),
  `crates/rh-policy/src/lib.rs:1855` (20 -> 21).
- Red from the stub commit on, until the implementer's work and the regenerated `v17.json`:
  `crates/rh-protocol/tests/vectors.rs::{committed_vectors_match_the_encoder, malformed_server_frames_are_rejected_for_the_documented_reason}`,
  `crates/rh-policy/tests/hud_content.rs::{the_sample_block_is_the_servers_block, the_wish_terms_are_the_legacy_constants}`
  (unchanged tests: they need all 23 terms in `wire_hud`).

## Stub notes (to be replaced, not kept)
- `build_summary.rs`: `PanelCode` 23-27 and `PANEL_CODE_COUNT` 28 are final; `champion_panel` does not set them.
- `hud_content.rs` (`HudTerm` 19-22, `HUD_TERM_COUNT` 23) and `state.rs` (`PANEL_CODE_COUNT`, `MAX_PANEL_VALUES` 28)
  are final; C# likewise (`HudTerm`, `TermCount`, `Hud.PanelCodeCount`, `Hud.MaxPanelValues`).
- `samples.rs` `sample_hud`: terms 19-22 are placeholder zeros.
- `observe/panel_tooltip_tests.rs` was an empty placeholder in the stub so its `mod` line compiles.

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes --lib observe::panel`,
  `cargo test -p rh-sim --features trusted-status-probes --test content`, `cargo test -p rh-sim --test no_alloc`
- `cargo test -p rh-protocol`, `cargo test -p rh-policy`
- `cargo run -p rh-protocol --bin protocol-fixtures`, `node tools/protocol-js/check-vectors.mjs`
- `node --test tools/unity-browser-reload-proof/*.test.mjs` (CI only; the gate does not run it)
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`

## 10. Risk and suggested model tier
Opus: an observation identity, key 13 and the Welcome in four parsers, and a refactor next to the hit packet.

## 11. Known traps
- Code 23 follows the charge, not the armed flag (pinned, see legacy doubts): after a hit resets the clock an armed
  owner shows "armed" and 0 %.
- The burst uses `max(0, Offense)` (`fire_roam::burst_damage` already clamps).
- Sword is dominant: a tie of SO and Offense contributions is the Offense side (strict `>`).
- Bonus hp is `max_hp - content::faction(f).hp` (unpaced sheet hp), bonus defense `max(0, armor) + shield` (SD may be
  negative): both already so in `packet_with_sheet`.
- Use the paced faction sheet and `attack_interval` exactly as `packet_with_sheet`; the per factor is `as_mult x
  interval`, which is not `1 / (rate x (1 + boost))` once the interval floors.
- `welcome_hud_term_count`/`_code` keep their names; `state_build_summary_panel_code_23` must disappear (the JS check
  fails on any malformed vector without an expectation, and code 23 now decodes).

## Legacy doubts (pinned as legacy; flagged)
- `championCombatModel.ts:116` computes the speed percent from `roamCharge` even when the burst is armed: an armed owner
  whose charge was reset by a hit (`server/src/sim/fireRoam.ts:25-31` keeps `roamReady`) reads "armed (0% move speed)".
  Pinned: code 23 follows the charge.
- `fire_roam.rs:39-41` notes the burst scales with bonus Offense while `docs/FIRE_ROAM.md` says AP: legacy code wins
  (Offense), already flagged there.
- The panel's burst uses the decoded wire mirror `mirrors.adBonus` (`:116`), the server's burst `adOf(owner)`
  (`server/src/sim/fireRoam.ts:64`): the Rust panel and the Rust burst both read `m.ad_bonus`, so they agree.

## Notes from previous attempts
