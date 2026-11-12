# P-WIRE17-HUD-2b: protocol 17 carries weapon scaling terms and the Wish row numbers

- **Serves:** not in the plan: owner approval 2026-11-10 (MIGRATION checkpoint, decision 3: bottom-left damage panel)
- **Implementer tier:** implementer-opus (wire format, three decoders)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof; golden vectors required · D2 n/a · D5/D6/D9 none
- **Status:** brief only (split from P-WIRE17-HUD-2 by its oracle author, 2026-11-12); needs `oracle-author`.

## 1. ID and outcome
Public content numbers the legacy HUD prints, still protocol 17, `v17.json` regenerated:
- The Welcome weapon table (`crates/rh-protocol/src/weapon.rs`) carries each weapon's scaling terms from
  `DEFINITION.weapon_scaling` (`crates/rh-sim/src/modifiers/rules.rs:5,19-26`: AD, AP, bonus HP, bonus defense,
  dominant), as legacy's slot line and tooltip use them (`packages/client/src/ui/weaponBar.ts:167`,
  `buildModel.ts:204,:224` "Scales with ...", `championCombatModel.ts:119-122`: terms joined with " or " when dominant,
  " + " otherwise).
- The champion panel's Wish row numbers (`championCombatModel.ts:219-227`), per faction constants: Freeze stun s and
  range; Swarm hidden s and radius; Trial zone s, less dealt, slower, more taken, exit stun s; Blaze true DPS, trail s,
  min and max blink; Last Stand floor s, move bonus, heal share. Either appended as panel codes 23.. to key 13
  (append-only after P-WIRE17-HUD-2's codes 0..=22) or carried in Welcome as content: the oracle author decides.

## 2. Dependencies
- P-WIRE17-HUD-2 merged (same decoders; key 13 panel codes).

## 6. Contracts and references
- Rust constants present today (`crates/rh-sim/src/abilities/mod.rs:230-244`): `FREEZE_STUN_MS`, `SWARM_MS`,
  `TRIAL_MS`, `TRIAL_DEALT_MULT`, `TRIAL_TAKEN_MULT`, `TRIAL_MOVE_MULT`, `BLAZE_TRAIL_MS` (legacy `BLAZE_BURN_MS`?),
  `LAST_STAND_MS`, `LAST_STAND_HASTE` / `LAST_STAND_HEAL` (legacy `LAST_STAND_SPEED_BONUS` / `LAST_STAND_HEAL_SHARE`?).
  Not found under the legacy names (map each to its Rust source before inventing one): `FREEZE_RANGE`,
  `SWARM_CLOUD_RADIUS`, `TRIAL_EXIT_STUN_MS`, `BLAZE_BURN_DPS`, `BLAZE_MIN_DIST`, `BLAZE_RANGE`.
- Weapon scaling is public content (Welcome), as in legacy.

## Carried from the review of P-UNITY-HUD-BUILD-2 (2026-11-12)
The Unity champion panel leaves these legacy fragments blank because no panel code carries them; this packet (or a
split of it) delivers them, and a Unity follow-up draws them:
- the auto row's scaling line (`scaleTerms`, `championCombatModel.ts:135`, e.g. "1x Offense"): static weapon data,
  the weapon scaling terms in Welcome cover it;
- the Fire roam line's move-speed percent and arming-burst text (`championCombatModel.ts:118-121`): the roam speed
  multiplier and burst damage as owner panel codes;
- tooltip-only numbers (attack-speed mirror, hit multiplier, passive breakdowns): decide per number whether it is
  worth a panel code; list what is left out.
