//! Native privacy/delivery controls; all declared fixture setup is separate from captured outputs.
use super::{Kind, TradeView};
use crate::{FactionMode, PlayerId, PublicCommand, Secrets, Sim, SimConfig, Vec2};
use serde_json::Value as V;
fn corpus() -> V {
    serde_json::from_str(include_str!("../../../../parity/trade-public/doors.json")).unwrap()
}
fn arena() -> crate::Arena {
    use crate::mapgen::{coliseum, map_hash, pipeline};
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
    crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: hash,
        map,
    }
    .validate()
    .unwrap()
    .into_arena()
    .unwrap()
}
fn construct(v: &V) -> Sim {
    construct_with_bot(v, false)
}
fn construct_with_bot(v: &V, bot: bool) -> Sim {
    let c = &v["world"]["config"];
    let seed = v["world"]["random"]["seed"].as_u64().unwrap() as u32;
    let mut s = Sim::try_new(
        SimConfig {
            min_players: c["minPlayers"].as_u64().unwrap() as usize,
            lobby_seconds: c["lobbySeconds"].as_f64().unwrap(),
            fill_seconds: c["fillSeconds"].as_f64().unwrap(),
            quests: true,
            initial_loot: true,
            consumables: true,
            regen: false,
            mob_mode: crate::mob_runtime::MobMode::Pve,
            faction_mode: FactionMode::Off,
            abilities: crate::abilities::Mode::Full,
            hazards: crate::terrain::Mode::Map,
            lifecycle: crate::ArenaMode::Source(crate::ArenaRules {
                plan_seconds: 0.,
                first_patience_seconds: None,
                coliseum_schedule: None,
                patience_seconds: c["patienceSeconds"].as_f64().unwrap(),
                patience_min_seconds: c["patienceMinSeconds"].as_f64().unwrap(),
                sudden_death_seconds: c["suddenDeathSeconds"].as_f64().unwrap(),
            }),
            pvp_rules: false,
            ..Default::default()
        },
        arena(),
        Secrets {
            order_salt: crate::rng::Mulberry32::new(seed).next_u32(),
            spawn_seed: seed,
            reward_salt: serde_json::from_value(v["world"]["random"]["rewardSalt"].clone())
                .unwrap(),
        },
    )
    .unwrap();
    for p in v["world"]["players"].as_array().unwrap() {
        s.add_player(
            p["name"].as_str().unwrap(),
            Some(crate::FactionId::parse(p["faction"].as_str().unwrap()).unwrap()),
            bot && p["name"] == "name0",
        )
        .unwrap();
    }
    s.step();
    assert_eq!(s.tick(), 1);
    assert_eq!(s.phase(), crate::Phase::Active);
    assert_eq!(
        s.w.quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .filter(|q| q.published)
            .count(),
        10
    );
    s
}

fn place(s: &mut Sim, id: PlayerId, at: Vec2) {
    let now = s.server_time();
    let p = s.w.players.get_mut(id).unwrap();
    p.body.x = at.x;
    p.body.y = at.y;
    p.body.facing = 0.;
    p.body.history.reset(crate::state::Sample {
        t: now,
        x: at.x,
        y: at.y,
    });
}
fn view(s: &Sim, id: PlayerId) -> TradeView {
    crate::observe(s, id, &[]).trade.unwrap()
}
fn at(s: &Sim, kind: Kind) -> Vec2 {
    s.w.traders
        .as_ref()
        .unwrap()
        .traders
        .iter()
        .find(|t| t.kind == kind)
        .unwrap()
        .at
}
fn trade(s: &mut Sim, id: PlayerId, kind: Kind, pick: i8) -> Vec<crate::Event> {
    let observer = crate::ItemObserver::new(id);
    let command = observer
        .resolve(
            s,
            PublicCommand::Trade {
                merchant: kind,
                pick,
            },
        )
        .unwrap();
    s.submit(id, command).unwrap();
    s.step()
}
#[path = "view_tests/source_public.rs"]
mod source_public;

#[test]
fn owner_quotes_are_read_only_private_stable_and_not_rolled_by_observation() {
    let mut s = construct(&corpus());
    let spot = at(&s, Kind::Stats);
    place(&mut s, PlayerId(1), spot);
    let before = serde_json::to_value(&s).unwrap();
    for _ in 0..3 {
        assert!(view(&s, PlayerId(1)).offers.is_empty());
    }
    assert_eq!(before, serde_json::to_value(&s).unwrap());
    let events = trade(&mut s, PlayerId(1), Kind::Stats, 0);
    assert!(events.iter().any(|e|matches!(e,crate::Event::Toast{to:Some(PlayerId(1)),text} if text=="Wait for the trader's offers")));
    assert!(crate::observe(&s, PlayerId(1), &events)
        .events
        .iter()
        .any(|e| matches!(e,crate::SeenEvent::Toast{text}if text=="Wait for the trader's offers")));
    assert!(crate::observe(&s, PlayerId(2), &events)
        .events
        .iter()
        .all(|e| !matches!(e, crate::SeenEvent::Toast { .. })));
    let saved = view(&s, PlayerId(1));
    assert_eq!(saved.offers.len(), 3);
    assert_eq!(saved.offers, s.w.players[0].trade_offers);
    assert!(saved.merchants.iter().any(|m| m.kind == Kind::Stats));
    assert!(view(&s, PlayerId(2)).offers.is_empty());
    let before = serde_json::to_value(&s).unwrap();
    for _ in 0..3 {
        assert_eq!(view(&s, PlayerId(1)), saved);
    }
    assert_eq!(before, serde_json::to_value(&s).unwrap());
    // Reusing one output across owners must erase the previous owner's saved state.
    let mut reused = crate::Observation::default();
    crate::try_observe_into(&s, PlayerId(1), &[], &mut reused).unwrap();
    assert_eq!(reused.trade.as_ref().unwrap().offers, saved.offers);
    crate::try_observe_into(&s, PlayerId(2), &[], &mut reused).unwrap();
    assert!(reused.trade.as_ref().unwrap().offers.is_empty());
    assert!(!reused.trade.as_ref().unwrap().trade_used);
    assert!(reused.trade.as_ref().unwrap().stats.is_empty());
    assert!(reused.trade.as_ref().unwrap().barter_ready_at.is_none());

    // Declared foreign poison: no foreign quote/stat/deadline may influence this owner's view.
    s.w.players[1].trade_offers = saved.offers.clone();
    s.w.players[1].trade_offers[0].cost_value = f64::NAN;
    s.w.players[1].trade_stats = vec![(super::Stat::Ad, f64::NAN)];
    s.w.players[1].trade_used = true;
    s.w.traders
        .as_mut()
        .unwrap()
        .barter_at
        .push((PlayerId(2), f64::NAN));
    assert_eq!(view(&s, PlayerId(1)), saved);
    // Declared scene membership setup; saved owner quotes are never repriced when a merchant leaves sight.
    s.w.traders
        .as_mut()
        .unwrap()
        .traders
        .iter_mut()
        .find(|t| t.kind == Kind::Stats)
        .unwrap()
        .at = Vec2::new(5072., 5072.);
    let hidden = view(&s, PlayerId(1));
    assert_eq!(hidden.offers, saved.offers);
    assert!(hidden.merchants.iter().all(|m| m.kind != Kind::Stats));
    let mut observer = crate::ItemObserver::new(PlayerId(1));
    observer.reconnect();
    let mut out = Default::default();
    observer.observe_into(&s, &[], &mut out, None).unwrap();
    assert_eq!(out.trade.unwrap().offers, saved.offers);
    assert!(crate::observe(&s, PlayerId(99), &[]).trade.is_none());
    // Only the selected owner's invalid facts are a typed publication refusal.
    s.w.players[0].trade_offers[0].cost_value = f64::NAN;
    assert_eq!(
        crate::try_observe(&s, PlayerId(1), &[]),
        Err(crate::OfferError::Trades(
            super::ViewError::InvalidOwnerState
        ))
    );
}
#[test]
fn trade_permits_owning_bot_and_rejects_committed_barter_without_spend() {
    let c = corpus();
    let mut s = construct_with_bot(&c, true);
    let spot = at(&s, Kind::Stats);
    place(&mut s, PlayerId(1), spot);
    s.step();
    assert_eq!(view(&s, PlayerId(1)).offers.len(), 3);
    assert!(crate::observe(&s, PlayerId(1), &[]).quests.is_none());
    let e = trade(&mut s, PlayerId(1), Kind::Stats, 0);
    assert!(s.w.players[0].trade_used);
    assert!(e
        .iter()
        .any(|e| matches!(e,crate::Event::Toast{text,..}if text.starts_with("Stat trade: "))));
    let mut s = construct(&c);
    assert!(crate::cards::grant(
        &s.k,
        &mut s.w,
        PlayerId(1),
        crate::cards::CardId::Committed
    ));
    s.w.players[0].weapon.weapon0 = Some(crate::WeaponId::Sword);
    s.w.players[0].weapon.weapon1 = None;
    s.w.players[0].potion_small = 1;
    let spot = at(&s, Kind::Barter);
    place(&mut s, PlayerId(1), spot);
    let e = trade(&mut s, PlayerId(1), Kind::Barter, 2);
    assert!(s.w.players[0].weapon.weapon1.is_none());
    assert_eq!(s.w.players[0].potion_small, 1);
    assert!(s.w.traders.as_ref().unwrap().barter_at.is_empty());
    assert!(e.iter().any(
        |e| matches!(e,crate::Event::Toast{text,..}if text=="Make an empty weapon slot first")
    ));
    let before = s.state_hash();
    assert!(crate::ItemObserver::new(PlayerId(1))
        .resolve(
            &s,
            PublicCommand::Trade {
                merchant: Kind::Barter,
                pick: 3
            }
        )
        .is_err());
    assert_eq!(before, s.state_hash());
}
