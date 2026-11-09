//! Native query parity for the catalogued camps-cleared scale against the released source helper probes.
//!
//! The helpers corpus (parity/pack-leader/helpers.json) is the immutable source oracle; these tests call the ACTUAL native
//! queries with the declared helper counts and compare results. The declared-helper contexts are not earned clear parity.
use super::{execute_share, outgoing_damage, OutgoingKind, VsProbe};
use crate::stat_fold::StatSums;
use crate::{arenas, cards::CardId, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};
use serde_json::Value;

fn helpers() -> Value {
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/pack-leader/helpers.json"
    )))
    .expect("released helper corpus")
}

fn setup() -> Sim {
    let ps = [
        Placement {
            profile: "a".into(),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(400., 400.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
        Placement {
            profile: "b".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(456., 400.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
    ];
    Sim::reset_active(
        SimConfig::default(),
        arenas::practice_arena(),
        Secrets::from_seed(7),
        &ps,
    )
}

fn grant(sim: &mut Sim, cards: &[CardId]) {
    for card in cards {
        assert!(crate::cards::grant(&sim.k, &mut sim.w, PlayerId(1), *card));
    }
}

fn player(sim: &Sim) -> usize {
    sim.w.idx(PlayerId(1)).expect("declared attacker")
}

fn probe<'a>(doc: &'a Value, id: &str) -> &'a Value {
    doc["probes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == id)
        .expect("released helper probe")
}

fn count(label: &str) -> u16 {
    label.rsplit('-').next().unwrap().parse().unwrap()
}

#[test]
fn declared_helper_counts_0_1_7_8_9_20_match_the_native_query() {
    let doc = helpers();
    let mut sim = setup();
    grant(&mut sim, &[CardId::PackLeader]);
    let i = player(&sim);
    let p = &sim.w.players[i];
    for id in [
        "declared-helper-count-0",
        "declared-helper-count-1",
        "declared-helper-count-7",
        "declared-helper-count-8",
        "declared-helper-count-9",
        "declared-helper-count-20",
    ] {
        let probe = probe(&doc, id);
        let n = count(id);
        let other = outgoing_damage(
            &p.core,
            &p.build,
            1.,
            OutgoingKind::Other,
            1.,
            n,
            0,
            VsProbe::default(),
            false,
        );
        assert!(
            (other - probe["other"].as_f64().unwrap()).abs() < 1e-12,
            "{id}: native other {other} != source {}",
            probe["other"]
        );
        let hit = outgoing_damage(
            &p.core,
            &p.build,
            1.,
            OutgoingKind::Hit,
            1.,
            n,
            0,
            VsProbe::default(),
            false,
        );
        assert!(
            (hit - probe["hit"].as_f64().unwrap()).abs() < 1e-12,
            "{id}: native hit {hit} != source {}",
            probe["hit"]
        );
        // G1 row ceiling: the row multiplier times the entry's own kind mult never passes OUTGOING_ROW_CAP, so a x3
        // baked hit returns the ceiling for every declared camps count.
        let g1 = outgoing_damage(
            &p.core,
            &p.build,
            1.,
            OutgoingKind::Hit,
            3.,
            n,
            0,
            VsProbe::default(),
            false,
        );
        assert!(
            (g1 - probe["hitBaked3"].as_f64().unwrap()).abs() < 1e-12,
            "{id}: native G1/baked {g1} != source {}",
            probe["hitBaked3"]
        );
    }
}

#[test]
fn declared_helper_execute_share_matches_the_native_full_versus_without_queries() {
    let doc = helpers();
    let mut sim = setup();
    grant(&mut sim, &[CardId::PackLeader, CardId::CoupDeGrace]);
    let i = player(&sim);
    let p = &sim.w.players[i];
    let probe = probe(&doc, "declared-helper-execute-share-count-1");
    let at_0 = execute_share(&p.core, &p.build, 0.2, OutgoingKind::Hit, 1., 0);
    let at_1 = execute_share(&p.core, &p.build, 0.2, OutgoingKind::Hit, 1., 1);
    assert!(
        (at_0 - probe["executeShareCount0"].as_f64().unwrap()).abs() < 1e-12,
        "execute share count0 {at_0} != source {}",
        probe["executeShareCount0"]
    );
    assert!(
        (at_1 - probe["executeShare"].as_f64().unwrap()).abs() < 1e-12,
        "execute share count1 {at_1} != source {}",
        probe["executeShare"]
    );
    // The share uses the SAME count in both the full and the without-hpBelow queries: the count moves the share exactly as
    // the source helper recorded.
    assert!((at_1 - at_0).abs() > 1e-9);
}

#[test]
fn declared_helper_cache_refresh_timing_maps_to_the_explicit_native_count_argument() {
    let doc = helpers();
    let mut sim = setup();
    grant(&mut sim, &[CardId::PackLeader]);
    let i = player(&sim);
    let p = &sim.w.players[i];
    let probe = probe(&doc, "declared-helper-cache-refresh-timing");
    let stale = outgoing_damage(
        &p.core,
        &p.build,
        1.,
        OutgoingKind::Other,
        1.,
        0,
        0,
        VsProbe::default(),
        false,
    );
    let refreshed = outgoing_damage(
        &p.core,
        &p.build,
        1.,
        OutgoingKind::Other,
        1.,
        1,
        0,
        VsProbe::default(),
        false,
    );
    assert!((stale - probe["before"].as_f64().unwrap()).abs() < 1e-12);
    assert!((stale - probe["stale"].as_f64().unwrap()).abs() < 1e-12);
    assert!((refreshed - probe["refreshed"].as_f64().unwrap()).abs() < 1e-12);
}

#[test]
fn farm_damage_is_added_outside_the_camps_row_cap() {
    let mut sim = setup();
    grant(&mut sim, &[CardId::PackLeader]);
    let i = player(&sim);
    // A declared farm sum on the existing private fold (the source farm row adds outside the outgoing row cap).
    let farm = StatSums {
        damage: 2.,
        ..StatSums::default()
    };
    sim.w.players[i].modifiers.farm = farm.source_values();
    let p = &sim.w.players[i];
    let capped = outgoing_damage(
        &p.core,
        &p.build,
        1.,
        OutgoingKind::Hit,
        3.,
        20,
        0,
        VsProbe::default(),
        false,
    );
    // Count 20 is capped at +24%; the x3 baked hit puts the row multiplier on the G1 ceiling (2.5/3); the farm 2 is added
    // after that cap, so the total is the ceiling plus farm (above the row cap itself).
    let ceiling = crate::constants::OUTGOING_ROW_CAP / 3.;
    assert!(
        (capped - (ceiling + 2.)).abs() < 1e-12,
        "G1-capped row {capped} should be ceiling {ceiling} + farm 2"
    );
}
