//! Declared historical checkpoint controls for the already-public tax percentage.
//! These are serialization/fingerprint checks, not source gameplay or earned Mark-tax fixtures.
use rh_headless::digest::OutcomeDigest;
use rh_sim::{Arena, FactionId, FactionMode, Placement, Secrets, Sim, SimConfig, Vec2};
use serde_json::json;

fn scene(with_mobs: bool) -> Sim {
    let arena: Arena = if with_mobs {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../rh-sim/tests/fixtures/mob-foundation-small.json"
        ))
        .unwrap();
        rh_sim::mapdata::MapExport {
            format: "rh-map/2".into(),
            legacy_map_hash_u32: 0,
            map: serde_json::from_value(fixture["map"].clone()).unwrap(),
        }
        .validate()
        .unwrap()
        .into_arena()
        .unwrap()
    } else {
        rh_sim::arenas::practice_arena()
    };
    Sim::reset_active(
        SimConfig {
            quests: false,
            faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentenced,
            mob_mode: if with_mobs {
                rh_sim::mob_runtime::MobMode::SpawnFoundation
            } else {
                rh_sim::mob_runtime::MobMode::Off
            },
            ..Default::default()
        },
        arena,
        Secrets::from_seed(12),
        &(0..3)
            .map(|i| Placement {
                profile: format!("tax-digest-{i}"),
                faction: if i == 1 {
                    FactionId::Fire
                } else {
                    FactionId::Sentenced
                },
                bot: false,
                at: Vec2::new(80. + 24. * f64::from(i), 80.),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect::<Vec<_>>(),
    )
}

fn tax(base: &Sim, victim: u32, by: u32, percent: u8) -> Sim {
    let mut cp = serde_json::to_value(base).unwrap();
    cp["world"]["factions"]["taxed"] = json!([{"victim": victim, "by": by}]);
    cp["world"]["factions"]["public_tax"] = if percent == 0 {
        json!([])
    } else {
        json!([{"victim": victim, "percent": percent}])
    };
    let mut found = false;
    for group in ["players", "mobs"] {
        for actor in cp["world"][group].as_array_mut().unwrap() {
            if actor["core"]["id"].as_u64() == Some(u64::from(victim)) {
                let bits = actor["core"]["signature"]["bits"].as_u64().unwrap();
                let bit = u64::from(rh_sim::constants::SIG_TAXED);
                actor["core"]["signature"]["bits"] = json!(if percent == 0 {
                    bits & !bit
                } else {
                    bits | bit
                });
                found = true;
            }
        }
    }
    assert!(found, "declared tax victim is a real retained actor");
    Sim::restore(cp).unwrap()
}

fn fingerprint(sim: &Sim) -> u64 {
    let mut d = OutcomeDigest::new();
    d.try_tick(sim, &[]).unwrap();
    d.value()
}

#[test]
fn player_and_npc_public_percentages_change_the_digest_but_private_tax_owners_do_not() {
    for with_mobs in [false, true] {
        let base = scene(with_mobs);
        let victim = if with_mobs {
            base.mobs()[0].core.id.0
        } else {
            2
        };
        let zero = tax(&base, victim, 1, 0);
        let a = tax(&base, victim, 1, 15);
        let b = tax(&base, victim, 1, 20);
        let other_owner = tax(&base, victim, 3, 15);
        assert_eq!(
            rh_sim::public_snapshot(&base),
            rh_sim::public_snapshot(&zero)
        );
        assert_eq!(fingerprint(&base), fingerprint(&zero));
        assert_ne!(fingerprint(&zero), fingerprint(&a));
        assert_ne!(fingerprint(&a), fingerprint(&b));
        assert_eq!(
            rh_sim::public_snapshot(&a),
            rh_sim::public_snapshot(&other_owner)
        );
        assert_ne!(a.state_hash(), other_owner.state_hash());
        assert_eq!(fingerprint(&a), fingerprint(&other_owner));
    }
}
