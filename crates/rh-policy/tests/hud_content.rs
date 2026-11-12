//! P-WIRE17-HUD-2b oracle (loose proof, owner direction 2026-11-10): the HUD content block the server puts in every
//! Welcome (`rh_policy::delivery::projection::wire_hud`) carries the numbers the legacy HUD prints, read from the sim's
//! own content, and the golden-vector sample is that same block.
//!
//! Legacy: weapon scaling `packages/shared/src/weapons.ts:96-124` (printed by `packages/client/src/ui/weaponBar.ts:167`,
//! `buildModel.ts:204-213,:224`, `championCombatModel.ts:119-122`); Wish row `championCombatModel.ts:219-227` over the
//! constants at `packages/shared/src/abilities.ts:140-167`.
use rh_policy::delivery::projection::{wire_hud, wire_weapons};
use rh_protocol::{HudTerm, WireHudContent, HUD_TERM_COUNT};
use rh_sim::{FactionId, WeaponId};

fn term(hud: &WireHudContent, code: HudTerm) -> f64 {
    hud.terms
        .iter()
        .find(|t| t.code == code as u8)
        .unwrap_or_else(|| panic!("the block carries {code:?}"))
        .value
}

/// One scaling row per weapon, in the weapon table's id order, equal to legacy `WEAPONS[w].scaling` / `.dominant`.
#[test]
fn the_scaling_rows_are_the_legacy_weapon_table() {
    let hud = wire_hud();
    let ids: Vec<u8> = hud.scaling.iter().map(|s| s.id).collect();
    let weapon_ids: Vec<u8> = wire_weapons().iter().map(|w| w.id).collect();
    assert_eq!(
        ids,
        WeaponId::ALL.map(|w| w.code()).to_vec(),
        "one row per weapon, by wire id"
    );
    assert_eq!(ids, weapon_ids, "the same ids as the Welcome weapon table");
    // (weapon, ad, ap, hp, def, dominant) from weapons.ts:96-124; absent legacy terms are 0.
    let legacy = [
        (WeaponId::Sword, 1.0, 1.0, 0.0, 0.0, true),
        (WeaponId::Bow, 1.0, 0.0, 0.0, 0.0, false),
        (WeaponId::Wand, 0.3, 1.0, 0.0, 0.0, false),
        (WeaponId::Shield, 0.0, 0.3, 0.0, 0.4, false),
        (WeaponId::Axe, 1.0, 0.0, 0.02, 0.0, false),
        (WeaponId::Fists, 0.6, 0.6, 0.0, 0.0, false),
    ];
    for (w, ad, ap, hp, def, dominant) in legacy {
        let row = hud
            .scaling
            .iter()
            .find(|s| s.id == w.code())
            .unwrap_or_else(|| panic!("{w:?} has a scaling row"));
        assert_eq!(
            (
                row.ad,
                row.ap,
                row.bonus_hp,
                row.bonus_defense,
                row.dominant
            ),
            (ad, ap, hp, def, dominant),
            "{w:?}"
        );
        // The sim's own fold reads the same row (modifiers/rules.rs, column order AD, AP, bonus HP, bonus defense,
        // dominant).
        let sim = rh_sim::modifiers::DEFINITION.weapon_scaling[usize::from(w.code())];
        assert_eq!(
            [row.ad, row.ap, row.bonus_hp, row.bonus_defense],
            [sim[0], sim[1], sim[2], sim[3]],
            "{w:?} from DEFINITION.weapon_scaling"
        );
        assert_eq!(row.dominant, sim[4] != 0.0, "{w:?} dominant");
    }
}

/// Every Wish number the legacy panel prints, by code, equal to the legacy constant. Frost's Wish is Freeze on this
/// branch; the Frost Wall packet appends its own codes and updates this test.
#[test]
fn the_wish_terms_are_the_legacy_constants() {
    let hud = wire_hud();
    let codes: Vec<u8> = hud.terms.iter().map(|t| t.code).collect();
    assert_eq!(
        codes,
        (0..HUD_TERM_COUNT).collect::<Vec<_>>(),
        "every code once, ascending"
    );
    use HudTerm::*;
    let legacy = [
        (FreezeStunMs, 1250.0),        // FREEZE_STUN_MS, abilities.ts:141
        (FreezeRange, 450.0),          // FREEZE_RANGE, :140
        (SwarmHiddenMs, 8000.0),       // SWARM_MS, :143
        (SwarmCloudRadius, 72.0),      // SWARM_CLOUD_RADIUS, :145
        (TrialZoneMs, 5000.0),         // TRIAL_MS, :150
        (TrialDealtMult, 0.8),         // TRIAL_DEALT_MULT, :151 ("20% less dealt")
        (TrialMoveMult, 0.7),          // TRIAL_MOVE_MULT, :153 ("30% slower")
        (TrialTakenMult, 1.2),         // TRIAL_TAKEN_MULT, :152 ("+20% taken")
        (TrialExitStunMs, 1500.0),     // TRIAL_EXIT_STUN_MS, :154
        (TrialRadius, 300.0),          // TRIAL_RADIUS, :147 (tooltip)
        (TrialConvictedRadius, 200.0), // TRIAL_CONVICTED_RADIUS, :149 (tooltip)
        (BlazeBurnDps, 30.0),          // BLAZE_BURN_DPS, :162
        (BlazeBurnMs, 2000.0),         // BLAZE_BURN_MS, :163 (printed as the "trail" seconds)
        (BlazeMinDist, 64.0),          // BLAZE_MIN_DIST, :157
        (BlazeMaxDist, 300.0),         // BLAZE_RANGE, :156
        (LastStandMs, 5000.0),         // LAST_STAND_MS, :164
        (LastStandSpeedBonus, 0.3),    // LAST_STAND_SPEED_BONUS, :166 ("+30% move")
        (LastStandHealShare, 0.3),     // LAST_STAND_HEAL_SHARE, :167
        (LastStandFloorHp, 1.0),       // LAST_STAND_FLOOR_HP, :165 (the panel prints "1 HP")
    ];
    for (code, want) in legacy {
        assert_eq!(term(&hud, code), want, "{code:?}");
    }
}

/// The values are read from the sim's Wish definitions, not hand-kept: a retune in rh-sim moves the wire with it.
#[test]
fn the_wish_terms_come_from_the_sim_definitions() {
    use rh_sim::abilities::{self as ab, Target};
    use rh_sim::status_runtime::{AbilityId, BLAZE_FIELD_POLICY, TRIAL_FIELD_POLICY};
    let hud = wire_hud();
    let Target::Unit(freeze_range) = ab::definition(AbilityId::Freeze).target else {
        panic!("Freeze targets a unit")
    };
    let (burn_dps, burn_ms) = BLAZE_FIELD_POLICY.burn.expect("Blaze burns");
    let sim = [
        (HudTerm::FreezeStunMs, ab::FREEZE_STUN_MS),
        (HudTerm::FreezeRange, freeze_range),
        (HudTerm::SwarmHiddenMs, ab::SWARM_MS),
        (HudTerm::SwarmCloudRadius, ab::SWARM_RADIUS),
        (HudTerm::TrialZoneMs, ab::TRIAL_MS),
        (HudTerm::TrialDealtMult, ab::TRIAL_DEALT_MULT),
        (HudTerm::TrialMoveMult, ab::TRIAL_MOVE_MULT),
        (HudTerm::TrialTakenMult, ab::TRIAL_TAKEN_MULT),
        (
            HudTerm::TrialExitStunMs,
            TRIAL_FIELD_POLICY
                .exit_stun_ms
                .expect("Trial stuns on exit"),
        ),
        (HudTerm::TrialRadius, ab::TRIAL_RADIUS),
        (HudTerm::TrialConvictedRadius, ab::TRIAL_CONVICTED_RADIUS),
        (HudTerm::BlazeBurnDps, burn_dps),
        (HudTerm::BlazeBurnMs, burn_ms),
        (HudTerm::BlazeMinDist, ab::blink::MIN_DIST),
        (HudTerm::BlazeMaxDist, ab::blink::MAX_DIST),
        (HudTerm::LastStandMs, ab::LAST_STAND_MS),
        (HudTerm::LastStandSpeedBonus, ab::LAST_STAND_HASTE),
        (HudTerm::LastStandHealShare, ab::LAST_STAND_HEAL),
        (HudTerm::LastStandFloorHp, ab::LAST_STAND_FLOOR),
    ];
    for (code, want) in sim {
        assert_eq!(term(&hud, code), want, "{code:?}");
    }
}

/// Each faction's Wish has the numbers its legacy row prints (value and scaling lines, championCombatModel.ts:222-226).
#[test]
fn every_faction_wish_has_its_row() {
    use rh_sim::status_runtime::AbilityId;
    use HudTerm::*;
    let hud = wire_hud();
    for f in [
        FactionId::Fire,
        FactionId::Sentenced,
        FactionId::Plague,
        FactionId::Frost,
        FactionId::Holy,
    ] {
        let row: &[HudTerm] = match rh_sim::abilities::wish(f) {
            AbilityId::Freeze => &[FreezeStunMs, FreezeRange],
            AbilityId::Swarm => &[SwarmHiddenMs, SwarmCloudRadius],
            AbilityId::Trial => &[
                TrialZoneMs,
                TrialDealtMult,
                TrialMoveMult,
                TrialTakenMult,
                TrialExitStunMs,
            ],
            AbilityId::Blaze => &[BlazeBurnDps, BlazeBurnMs, BlazeMinDist, BlazeMaxDist],
            AbilityId::LastStand => &[LastStandMs, LastStandSpeedBonus, LastStandHealShare],
            #[allow(unreachable_patterns)]
            other => panic!("{f:?}: no legacy Wish row for {other:?}"),
        };
        for code in row {
            assert!(term(&hud, *code) > 0.0, "{f:?} {code:?}");
        }
    }
}

/// The golden-vector sample block is the server's block, so `protocol/fixtures` cannot go stale on a content change; the
/// block passes the decoder's checks. The block is content: `wire_hud` takes no viewer, every seat gets the same bytes.
#[test]
fn the_sample_block_is_the_servers_block() {
    let hud = wire_hud();
    assert_eq!(rh_protocol::hud_content::content_fault(&hud), None);
    assert_eq!(hud.scaling.len(), 6);
    assert_eq!(hud.terms.len(), usize::from(HUD_TERM_COUNT));
    assert_eq!(rh_protocol::samples::sample_hud(), hud);
}
