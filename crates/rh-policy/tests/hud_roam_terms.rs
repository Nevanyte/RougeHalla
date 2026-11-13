//! P-WIRE17-HUD-2c oracle (loose proof, owner direction 2026-11-10): the server's Welcome HUD block
//! (`rh_policy::delivery::projection::wire_hud`) carries the Fire roam constants the legacy roam line prints
//! (`packages/client/src/ui/championCombatModel.ts:115-116`), read from the sim's content registry, and the identities move
//! for the champion panel's new codes.
use rh_policy::delivery::projection::wire_hud;
use rh_protocol::HudTerm;

fn term(code: HudTerm) -> f64 {
    wire_hud()
        .terms
        .iter()
        .find(|t| t.code == code as u8)
        .unwrap_or_else(|| panic!("the block carries {code:?}"))
        .value
}

/// Legacy `packages/shared/src/fireRoam.ts:2-7`: FIRE_ROAM_RAMP_MS 20_000 (printed / 1000: "after 20 s"),
/// FIRE_ROAM_CHARGE_MAX 1000 ("x/1000 charged"), FIRE_ROAM_BURST_BASE 50 and FIRE_ROAM_BURST_AD_SHARE 0.4
/// ("(50 + 0.4x Offense)").
#[test]
fn the_fire_roam_terms_are_the_legacy_constants() {
    assert_eq!(term(HudTerm::FireRoamRampMs), 20_000.0);
    assert_eq!(term(HudTerm::FireRoamChargeMax), 1_000.0);
    assert_eq!(term(HudTerm::FireRoamBurstBase), 50.0);
    assert_eq!(term(HudTerm::FireRoamBurstAdShare), 0.4);
}

/// The values come from the sim's registry (`crates/rh-sim/src/constants.rs`), not a hand-kept copy.
#[test]
fn the_fire_roam_terms_come_from_the_sim_constants() {
    use rh_sim::constants::{
        FIRE_ROAM_BURST_AD_SHARE, FIRE_ROAM_BURST_BASE, FIRE_ROAM_CHARGE_MAX, FIRE_ROAM_RAMP_MS,
    };
    assert_eq!(term(HudTerm::FireRoamRampMs), FIRE_ROAM_RAMP_MS);
    assert_eq!(term(HudTerm::FireRoamChargeMax), FIRE_ROAM_CHARGE_MAX);
    assert_eq!(term(HudTerm::FireRoamBurstBase), FIRE_ROAM_BURST_BASE);
    assert_eq!(
        term(HudTerm::FireRoamBurstAdShare),
        FIRE_ROAM_BURST_AD_SHARE
    );
}

#[test]
fn identities_move_for_the_new_panel_codes() {
    assert_eq!(
        rh_sim::OBSERVATION_VERSION,
        29,
        "Observation.panel gains codes 23-27 (27); 28: P-WIRE17-HUD-3"
    );
    assert_eq!(
        rh_policy::POLICY_CONTRACT_VERSION,
        23,
        "the projected owner summary gains codes 23-27 (21); 22: P-WIRE17-HUD-3"
    );
}
