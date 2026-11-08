//! Private diagnostic hash controls, not a claim of this exact historical engagement graph.
use rh_headless::digest::OutcomeDigest;
use rh_sim::{FactionId, Placement, Secrets, Sim, SimConfig, Vec2};
use serde_json::json;

#[test]
fn frost_source_ids_length_and_order_change_private_digest_without_public_identity_changes() {
    let placements: Vec<_> = (0..3)
        .map(|i| Placement {
            profile: format!("p{i}"),
            faction: FactionId::Frost,
            bot: false,
            at: Vec2::new(200. + 200. * i as f64, 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let sim = Sim::reset_active(
        SimConfig {
            faction_mode: rh_sim::FactionMode::EngagementHolyPlagueFireFrost,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(12),
        &placements,
    );
    let mut checkpoint = serde_json::to_value(sim).unwrap();
    checkpoint["world"]["players"][0]["core"]["signature"]["chill"] = json!(0.68);
    let make = |ids: serde_json::Value| {
        let mut cp = checkpoint.clone();
        cp["world"]["players"][0]["core"]["signature"]["chillers"] = ids;
        Sim::restore(cp).unwrap()
    };
    let a = make(json!([2, 3]));
    let b = make(json!([3, 2]));
    let c = make(json!([2]));
    let d = make(json!([3]));
    let fingerprint = |sim: &Sim| {
        let mut digest = OutcomeDigest::new();
        digest.tick(sim, &[]);
        digest.value()
    };
    for other in [&b, &c, &d] {
        assert_eq!(rh_sim::public_snapshot(&a), rh_sim::public_snapshot(other));
        assert_ne!(a.state_hash(), other.state_hash());
        assert_ne!(fingerprint(&a), fingerprint(other));
    }
}

#[test]
fn actual_training_recipients_have_a_nonpanicking_private_digest() {
    let mut sim = Sim::new(
        SimConfig {
            training: true,
            dummies: true,
            quests: false,
            consumables: false,
            min_players: 1,
            fill_seconds: 0.,
            lobby_seconds: 0.,
            faction_mode: rh_sim::FactionMode::EngagementHolyPlagueFireFrost,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(12),
    );
    sim.add_player("Frost", Some(FactionId::Frost), false)
        .unwrap();
    sim.step();
    assert_eq!(sim.mobs().len(), 2, "actual training dummy producer");
    let mut digest = OutcomeDigest::new();
    digest.try_tick(&sim, &[]).unwrap();
}

#[test]
fn actual_typed_npc_digest_keeps_the_legacy_encoding() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../rh-sim/tests/fixtures/mob-foundation-small.json"
    ))
    .unwrap();
    let arena = rh_sim::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map: serde_json::from_value(fixture["map"].clone()).unwrap(),
    }
    .validate()
    .unwrap()
    .into_arena()
    .unwrap();
    let sim = Sim::reset_active(
        SimConfig {
            quests: false,
            mob_mode: rh_sim::mob_runtime::MobMode::SpawnFoundation,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(12),
        &[Placement {
            profile: "typed-control".into(),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(80., 80.),
            hp: None,
            weapon0: None,
            weapon1: None,
        }],
    );
    assert_eq!(sim.mobs().len(), 3);
    assert!(sim.mobs().iter().all(|m| m.mob_type.is_some()));
    let mut digest = OutcomeDigest::new();
    digest.try_tick(&sim, &[]).unwrap();
    // Captured with the previous typed-only `expect(...).as_str()` fold.
    assert_eq!(digest.value(), 10_483_942_180_027_709_302);
}
