//! Native external-session controls, separate from captured source parity.
use rh_headless::Env;
use rh_sim::{
    traders::Kind, FactionId, Placement, PlayerId, PublicCommand, Secrets, Sim, SimConfig, Vec2,
    WeaponId,
};
fn scene(at: Option<Vec2>) -> Sim {
    use rh_sim::mapgen::{coliseum, map_hash, pipeline};
    let fixed = coliseum::fixed_layout();
    let map = pipeline::Pipeline::new(&fixed)
        .generate_styled(
            1,
            Some(0),
            pipeline::Options {
                decor: false,
                ..Default::default()
            },
        )
        .unwrap();
    let hash = u32::from_str_radix(&map_hash::map_hash(&map), 16).unwrap();
    let arena = rh_sim::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: hash,
        map,
    }
    .validate()
    .unwrap()
    .into_arena()
    .unwrap();
    let placement = Placement {
        profile: "trader-seat".into(),
        faction: FactionId::Holy,
        bot: false,
        at: at.unwrap_or(arena.spawns[0]),
        hp: None,
        weapon0: Some(WeaponId::Sword),
        weapon1: None,
    };
    Sim::reset_active(
        SimConfig {
            quests: true,
            consumables: true,
            pvp_rules: false,
            ..Default::default()
        },
        arena,
        Secrets {
            order_salt: 7,
            spawn_seed: 0,
            reward_salt: [1, 2, 3, 4],
        },
        &[placement],
    )
}
fn at(kind: Kind) -> Vec2 {
    // Trusted fixture navigation only: discover the deterministic seed's real producer position.
    // The second scene uses an ordinary typed initial placement; no trader/offer/outcome is inserted.
    let cp = serde_json::to_value(scene(None)).unwrap();
    let row = cp["world"]["traders"]["traders"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["kind"] == serde_json::to_value(kind).unwrap())
        .unwrap();
    serde_json::from_value(row["at"].clone()).unwrap()
}
fn assert_restore_bounds(s: &Sim) {
    // Every checkpoint below originates from a real accepted trade. Only these two rejection
    // controls alter one cached mirror; they never supply a successful trade's expected outcome.
    let cp = serde_json::to_value(s).unwrap();
    let restored = Sim::restore(&cp).unwrap();
    assert_eq!(restored.state_hash(), s.state_hash());
    let base = s.players()[0].modifiers.mirrors().armor_bonus;
    let lower = rh_sim::stat_fold::encode_flat(base - rh_sim::constants::AXE_SHRED_CAP);
    let upper = rh_sim::stat_fold::encode_flat(base);
    for bad in [lower - 1., upper + 1.] {
        let mut tampered = cp.clone();
        tampered["world"]["players"][0]["core"]["modifiers"]["wire"][3] = bad.into();
        assert!(
            matches!(Sim::restore(&tampered),Err(rh_sim::CheckpointError::Malformed(why)) if why.contains("invalid armor mirror"))
        );
    }
}
#[test]
fn fixed_kind_public_commands_trade_through_the_actual_external_headless_door() {
    let s = scene(Some(at(Kind::Stats)));
    let (mut env, first) = Env::from_external_checkpoint(s, 150).unwrap();
    let own = first[0].trade.as_ref().unwrap();
    assert!(own.offers.is_empty());
    assert!(own.merchants.iter().any(|m| m.kind == Kind::Stats));
    let roll = env.step(&[vec![]]);
    let offers = roll.observations[0].trade.as_ref().unwrap().offers.clone();
    assert_eq!(offers.len(), 3);
    let accepted = env.step(&[vec![PublicCommand::Trade {
        merchant: Kind::Stats,
        pick: 0,
    }]]);
    let own = accepted.observations[0].trade.as_ref().unwrap();
    assert!(own.trade_used);
    assert!(!own.stats.is_empty());
    assert_eq!(own.offers, offers);
    assert!(env.sim.players()[0].trade_used);
    assert!(accepted.observations[0]
        .events
        .iter()
        .any(|e| matches!(e,rh_sim::SeenEvent::Toast{text} if text.starts_with("Stat trade: "))));
    let deltas = own.stats.clone();
    let refused = env.step(&[vec![PublicCommand::Trade {
        merchant: Kind::Stats,
        pick: 1,
    }]]);
    assert_eq!(
        refused.observations[0].trade.as_ref().unwrap().stats,
        deltas
    );
    assert!(refused.events.iter().any(|e|matches!(e,rh_sim::Event::Toast{to:Some(PlayerId(1)),text} if text=="You already made your stat trade this run")));
    assert!(
        env.sim.players()[0].modifiers.mirrors().armor_bonus < -rh_sim::constants::AXE_SHRED_CAP
    );
    assert_restore_bounds(&env.sim);
    let cp = serde_json::to_value(&env.sim).unwrap();
    let (mut resumed, full) =
        Env::from_external_checkpoint(Sim::restore(&cp).unwrap(), 100).unwrap();
    assert_eq!(full[0].trade.as_ref().unwrap().offers, offers);
    assert_eq!(full[0].trade.as_ref().unwrap().stats, deltas);
    let out = resumed.step(&[vec![]]);
    assert!(out.observations[0].trade.as_ref().unwrap().trade_used);
    let (mut barter, first) =
        Env::from_external_checkpoint(scene(Some(at(Kind::Barter))), 100).unwrap();
    assert!(first[0].trade.as_ref().unwrap().barter_ready_at.is_none());
    let accepted = barter.step(&[vec![PublicCommand::Trade {
        merchant: Kind::Barter,
        pick: 0,
    }]]);
    assert_eq!(barter.sim.players()[0].weapon.weapon0, Some(WeaponId::Bow));
    let ready = accepted.observations[0]
        .trade
        .as_ref()
        .unwrap()
        .barter_ready_at
        .unwrap();
    assert_eq!(ready, barter.sim.server_time() + 5000.);
    let refused = barter.step(&[vec![PublicCommand::Trade {
        merchant: Kind::Barter,
        pick: 1,
    }]]);
    assert_eq!(barter.sim.players()[0].weapon.weapon0, Some(WeaponId::Bow));
    assert_eq!(
        refused.observations[0]
            .trade
            .as_ref()
            .unwrap()
            .barter_ready_at,
        Some(ready)
    );
    assert!(refused.observations[0].events.iter().any(|e|matches!(e,rh_sim::SeenEvent::Toast{text} if text=="The villager is packing your last trade")));
}

#[test]
fn a_positive_folded_trade_base_keeps_the_stricter_relative_shred_bound() {
    let (mut env, _) = Env::from_external_checkpoint(scene(Some(at(Kind::Stats))), 100).unwrap();
    let roll = env.step(&[vec![]]);
    assert_eq!(
        roll.observations[0].trade.as_ref().unwrap().offers[1].gain,
        rh_sim::traders::Stat::Armor
    );
    env.step(&[vec![PublicCommand::Trade {
        merchant: Kind::Stats,
        pick: 1,
    }]]);
    assert!(env.sim.players()[0].modifiers.mirrors().armor_bonus > 0.);
    assert_restore_bounds(&env.sim);
    let cp = serde_json::to_value(&env.sim).unwrap();
    let mut restored = Sim::restore(&cp).unwrap();
    let mut direct = env.sim.clone();
    for _ in 0..3 {
        assert_eq!(direct.step(), restored.step());
        assert_eq!(direct.state_hash(), restored.state_hash());
    }
}
