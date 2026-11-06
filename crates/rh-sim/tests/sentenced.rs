//! Trusted checkpoint-domain probes; ordinary-intake/source continuation is covered by rh-parity's Sentenced traces.
use rh_sim::{
    FactionId, FactionMode, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, Vec2,
};
use serde_json::{json, Value};
fn marked() -> Sim {
    let mut sim = Sim::reset_active(
        SimConfig {
            faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentenced,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(12),
        &(0..3)
            .map(|i| Placement {
                profile: format!("p{i}"),
                faction: if i == 0 {
                    FactionId::Sentenced
                } else {
                    FactionId::Holy
                },
                bot: false,
                at: Vec2::new(400. + i as f64 * 56., 320.),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect::<Vec<_>>(),
    );
    sim.submit(
        PlayerId(1),
        rh_sim::validate(RawCommand::Attack { a: 0., t: None }).unwrap(),
    )
    .unwrap();
    for _ in 0..40 {
        sim.step();
        if sim.players()[0].signature.mark.tier > 0 {
            break;
        }
    }
    assert!(sim.players()[0].signature.mark.tier > 0);
    sim
}
#[test]
fn strict_mark_mode_counter_clock_relationship_and_delayed_classification_admission() {
    let sim = marked();
    let base = serde_json::to_value(&sim).unwrap();
    let now = sim.server_time();
    for (field, value) in [
        ("tier", json!(5)),
        ("hits", json!(0)),
        ("hits", json!(9_007_199_254_740_992u64)),
        ("swaps", json!(9_007_199_254_740_992u64)),
        ("progress", json!(1.2)),
        ("progress", json!(-1.)),
        ("progress", json!(1e300)),
        ("far_since", json!(now + 1.)),
        ("amp_until", json!(now + 2001.)),
        ("denied", json!(true)),
    ] {
        let mut cp = base.clone();
        cp["world"]["players"][0]["core"]["signature"]["mark"][field] = value;
        assert!(Sim::restore(cp).is_err(), "{field}");
    }
    let mut cp = base.clone();
    cp["world"]["players"][0]["core"]["signature"]["target"] = Value::Null;
    assert!(Sim::restore(cp).is_err());
    let mut cp = base.clone();
    cp["world"]["players"][0]["credit"]["sentence"] = json!(6);
    assert!(Sim::restore(cp).is_err());
    let mut cp = base.clone();
    cp["statics"]["config"]["faction_mode"] = json!("EngagementHolyPlagueFireFrost");
    assert!(Sim::restore(cp).is_err());
    let mut cp = base.clone();
    cp["world"]["players"][0]["core"]["vitals"]["faction"] = json!("Holy");
    assert!(Sim::restore(cp).is_err());
    let mut cp = base.clone();
    cp["world"]["factions"]["dot"] =
        json!([{"victim":2,"by":1,"sig":"Mark","weapon":"Fists","amount":1.}]);
    assert!(Sim::restore(cp).is_err());
    let mut cp = base;
    cp["world"]["deferred"]["hits"] = json!([{"terrain":false,"dot":false,"ability":null,"arena":false,"source":null,"critical":false,"critical_mult":null,"victim":2,"by":1,"sig":"Mark","execute":true,"packet":{"raw":1.,"phys":0.4,"magic":0.6,"true_":0.},"weapon":"Fists","stagger":false,"projectile":null,"scale":1.,"derived":false,"passive":false}]);
    let mut legal = cp.clone();
    legal["world"]["deferred"]["hits"][0]["execute"] = json!(false);
    Sim::restore(legal).expect("an otherwise valid deferred Mark entry");
    assert!(Sim::restore(cp)
        .unwrap_err()
        .to_string()
        .contains("execute qualification"));
}
#[test]
fn mark_checkpoint_continuation_and_caller_prefix_do_not_change_hashes_or_events() {
    let mut sim = marked();
    let mut restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
    let prefix = rh_sim::Event::RaidStarted;
    for _ in 0..80 {
        let events = sim.step();
        let mut out = vec![prefix.clone()];
        restored.step_into(&mut out);
        assert_eq!(&out[1..], events);
        assert_eq!(out[0], prefix);
        assert_eq!(sim.state_hash(), restored.state_hash());
    }
}
