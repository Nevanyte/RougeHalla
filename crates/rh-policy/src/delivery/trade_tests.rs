//! Pure publication controls. Synthetic views below do not claim earned gameplay/source captures.
use super::*;
use rh_protocol::{WireTradeKind, WireTradeStat, WireTradeView};
use rh_sim::{
    traders::{Kind, MerchantView, Stat, StatTrade, TradeView},
    Vec2, WeaponId,
};

fn view() -> Observation {
    Observation {
        tick: 100,
        inventory: Some(Inventory {
            active_slot: 0,
            slots: [Some(WeaponId::Sword), None],
            potion_small: 0,
            potion_large: 0,
            potions_healing: 0,
        }),
        trade: Some(TradeView {
            trade_used: false,
            offers: vec![StatTrade {
                cost: Stat::Armor,
                cost_value: 9.4,
                gain: Stat::AttackSpeed,
                gain_value: 1e303,
                label: "opaque −9.4 → huge".into(),
            }],
            // Duplicates and signed zero are retained facts, not an invitation to re-fold.
            stats: vec![(Stat::Armor, -0.), (Stat::Armor, 0.)],
            barter_ready_at: Some(-0.),
            merchants: vec![
                MerchantView {
                    kind: Kind::Stats,
                    at: Vec2::new(100.125, 200.25),
                },
                MerchantView {
                    kind: Kind::Stats,
                    at: Vec2::new(300., 400.),
                },
            ],
        }),
        ..Observation::default()
    }
}

fn decoded_trade(pending: &PendingState) -> Option<WireTradeView> {
    let ServerMsg::State { items, .. } =
        ServerMsg::decode(pending.frame.as_ref().unwrap()).unwrap()
    else {
        panic!("not State");
    };
    items
        .into_iter()
        .find_map(|item| match item {
            StateItem::Trade(value) => Some(value),
            _ => None,
        })
        .expect("Trade replacement")
}

#[test]
fn trade_projection_preserves_opaque_owner_facts_and_exact_inventory_labels() {
    let mut obs = view();
    let publisher = CollectionPublisher::default();
    let pending = publisher.prepare(&obs, true, true, false).unwrap();
    let wire = decoded_trade(&pending).unwrap();
    assert_eq!(wire.offers[0].cost, WireTradeStat::Armor);
    assert_eq!(wire.offers[0].label, "opaque −9.4 → huge");
    assert_eq!(wire.offers[0].cost_value.to_bits(), 9.4_f64.to_bits());
    assert_eq!(wire.offers[0].gain_value.to_bits(), 1e303_f64.to_bits());
    assert_eq!(wire.stats.len(), 2);
    assert_eq!(wire.stats[0].value.to_bits(), (-0.0_f64).to_bits());
    assert_eq!(wire.stats[1].value.to_bits(), 0.0_f64.to_bits());
    assert_eq!(
        wire.barter_ready_at.unwrap().to_bits(),
        (-0.0_f64).to_bits()
    );
    assert_eq!(wire.merchants.len(), 2);
    assert!(wire
        .merchants
        .iter()
        .all(|row| row.kind == WireTradeKind::Stats));
    assert_eq!(wire.merchants[0].x.to_bits(), 100.125_f64.to_bits());
    assert_eq!(wire.merchants[0].name, Kind::Stats.name());
    assert_eq!(
        wire.barter_labels,
        rh_sim::traders::barter_labels(Some(WeaponId::Sword))
    );
    drop(pending);

    obs.inventory.as_mut().unwrap().active_slot = 1;
    let empty_hand = decoded_trade(&publisher.prepare(&obs, true, true, false).unwrap()).unwrap();
    assert_eq!(
        empty_hand.barter_labels,
        rh_sim::traders::barter_labels(None)
    );
    assert_ne!(
        empty_hand.barter_labels,
        rh_sim::traders::barter_labels(Some(WeaponId::Fists))
    );
}

#[test]
fn trade_baseline_is_bitwise_transactional_and_unavailable_is_not_empty() {
    let mut obs = view();
    let mut publisher = CollectionPublisher::default();
    let initial = publisher.prepare(&obs, true, true, false).unwrap();
    drop(initial);
    let retry = publisher.prepare(&obs, true, true, false).unwrap();
    assert_eq!(retry.items.len(), 13);
    retry.commit(&mut publisher);
    assert!(publisher
        .prepare(&obs, false, false, false)
        .unwrap()
        .frame
        .is_none());

    obs.trade.as_mut().unwrap().stats[0].1 = 0.;
    let changed = publisher.prepare(&obs, false, false, false).unwrap();
    assert_eq!(
        decoded_trade(&changed).unwrap().stats[0].value.to_bits(),
        0.0_f64.to_bits()
    );
    drop(changed);
    assert!(publisher
        .prepare(&obs, false, false, false)
        .unwrap()
        .frame
        .is_some());
    publisher
        .prepare(&obs, false, false, false)
        .unwrap()
        .commit(&mut publisher);

    obs.trade.as_mut().unwrap().barter_ready_at = Some(0.);
    let changed = publisher.prepare(&obs, false, false, false).unwrap();
    assert_eq!(
        decoded_trade(&changed)
            .unwrap()
            .barter_ready_at
            .unwrap()
            .to_bits(),
        0.0_f64.to_bits()
    );
    changed.commit(&mut publisher);
    obs.trade.as_mut().unwrap().barter_ready_at = None;
    assert!(
        decoded_trade(&publisher.prepare(&obs, false, false, false).unwrap())
            .unwrap()
            .barter_ready_at
            .is_none()
    );

    obs.trade = None;
    obs.inventory = None;
    let unavailable = publisher.prepare(&obs, false, false, false).unwrap();
    assert!(decoded_trade(&unavailable).is_none());
    unavailable.commit(&mut publisher);
    obs = view();
    obs.trade = Some(TradeView::default());
    let empty = decoded_trade(&publisher.prepare(&obs, false, false, false).unwrap()).unwrap();
    assert!(
        !empty.trade_used
            && empty.offers.is_empty()
            && empty.stats.is_empty()
            && empty.merchants.is_empty()
    );
}

#[test]
fn unsupported_trade_views_and_inventory_refuse_without_advancing_forced_state() {
    let obs = view();
    let mut publisher = CollectionPublisher::default();
    publisher
        .prepare(&obs, true, true, false)
        .unwrap()
        .commit(&mut publisher);
    for fault in 0..8 {
        let mut bad = obs.clone();
        bad.trade.as_mut().unwrap().trade_used = true;
        match fault {
            0 => bad.inventory = None,
            1 => bad.inventory.as_mut().unwrap().active_slot = 2,
            2 => bad.trade.as_mut().unwrap().offers[0].label = "x".repeat(256),
            3 => bad.trade.as_mut().unwrap().offers[0].cost_value = f64::INFINITY,
            4 => bad.trade.as_mut().unwrap().stats[0].1 = f64::NAN,
            5 => bad.trade.as_mut().unwrap().barter_ready_at = Some(-1.),
            6 => bad.trade.as_mut().unwrap().merchants.push(MerchantView {
                kind: Kind::Barter,
                at: Vec2::new(1., 1.),
            }),
            _ => bad.trade.as_mut().unwrap().merchants[0].at.x = 8192.,
        }
        assert!(
            publisher.prepare(&bad, false, false, true).is_err(),
            "fault{fault}"
        );
        assert!(publisher.resync_due(obs.tick, true));
        assert!(publisher
            .prepare(&obs, false, false, false)
            .unwrap()
            .frame
            .is_none());
    }
    let forced = publisher.prepare(&obs, false, false, true).unwrap();
    assert_eq!(forced.items.len(), 13);
    assert!(forced.commit(&mut publisher));
    assert!(!publisher.resync_due(obs.tick, true));
    publisher.reconnect();
    assert_eq!(
        publisher
            .prepare(&obs, false, false, false)
            .unwrap()
            .items
            .len(),
        13
    );
}
