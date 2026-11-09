//! The real source17 action recipes (tools/trade-public-fixtures/capture.mts:746–936).
//! Expected events are assertions only; inputs/setups below follow those recorded recipes.
use super::*;
use serde_json::json;
fn merchant(label: &str) -> Option<Kind> {
    Kind::ALL.into_iter().find(|k| k.id() == label)
}
fn setup(s: &mut Sim, d: &V) {
    match d["kind"].as_str().unwrap() {
        "place" | "place-at-trader" => place(
            s,
            PlayerId(1),
            Vec2::new(d["x"].as_f64().unwrap(), d["y"].as_f64().unwrap()),
        ),
        "safe-far-point" => {}
        "weapon" => {
            let w = crate::WeaponId::parse(d["weapon"].as_str().unwrap());
            if d["slot"] == 0 {
                s.w.players[0].weapon.weapon0 = w
            } else {
                s.w.players[0].weapon.weapon1 = w
            }
        }
        "potion" => s.w.players[0].potion_small = d["small"].as_u64().unwrap() as u8,
        "grantCard" => {
            assert_eq!(d["id"], "committed");
            assert!(crate::cards::grant(
                &s.k,
                &mut s.w,
                PlayerId(1),
                crate::cards::CardId::Committed
            ));
        }
        "status" if d["to"] == "dead" => s.w.players[0].status = crate::Status::Dead,
        "status" => {
            assert_eq!(d["status"], "stun");
            assert!(crate::systems::status::operations::apply(
                &s.k,
                &mut s.w,
                &mut Vec::new(),
                PlayerId(1),
                crate::status_runtime::StatusApply {
                    kind: crate::status_runtime::StatusKind::Stun,
                    source: crate::status_runtime::StatusSource {
                        id: None,
                        name: std::sync::Arc::from(""),
                        owner_id: None
                    },
                    ms: 1000.,
                    ability: None,
                    tag: None,
                    value: None,
                    add: None,
                    data: None
                },
                true
            )
            .is_some());
        }
        "phase" => {
            assert_eq!(d["to"], "ended");
            s.w.phase = crate::Phase::Ended
        }
        "forced-wall" => {
            let m = &s.k.arena.map;
            let mut tiles = m.tiles.clone();
            tiles[d["index"].as_u64().unwrap() as usize] = d["to"].as_u64().unwrap() as u8;
            let map = m.source_collision_fixture(tiles);
            std::sync::Arc::make_mut(&mut s.k.arena).map = map;
        }
        k => panic!("unhandled declared source setup {k}"),
    }
}
fn run(s: &mut Sim, n: u32, events: &mut Vec<crate::Event>) {
    for _ in 0..n {
        events.extend(s.step());
    }
}
fn request(s: &mut Sim, m: &V, events: &mut Vec<crate::Event>) {
    assert_eq!(m["type"], "trade");
    assert_eq!(m["actor"], "p0");
    if let Some(kind) = merchant(m["payload"]["trader"].as_str().unwrap()) {
        events.extend(trade(
            s,
            PlayerId(1),
            kind,
            m["payload"]["pick"].as_i64().unwrap() as i8,
        ));
    } else {
        // The new public grammar is a closed catalog kind; invalid kinds cannot name hidden actors.
        assert!(crate::validate(crate::RawCommand::Trade {
            trader: None,
            pick: 0
        })
        .is_err());
        run(s, 1, events);
    }
}
fn feedback(events: &[crate::Event]) -> V {
    json!(events
        .iter()
        .filter_map(|e| match e {
            crate::Event::Toast { to, text } =>
                Some(json!({"to":to.map(|id|format!("p{}",id.0-1)),"text":text})),
            crate::Event::PotionNotice { id, notice } =>
                Some(json!({"to":format!("p{}",id.0-1),"text":notice.message()})),
            _ => None,
        })
        .collect::<Vec<_>>())
}
#[test]
fn all_seventeen_captured_trade_actions_keep_exact_feedback_and_owner_outcomes() {
    let c = corpus();
    let cases = c["actions"]["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 17);
    for case in cases {
        let mut s = construct(&c);
        let a = &case["actual"];
        let ds = case["declared"].as_array().unwrap();
        let mut events = Vec::new();
        let order = case["id"] == "order-cooldown-before-held";
        for d in ds.iter().take(if order { ds.len() - 1 } else { ds.len() }) {
            setup(&mut s, d)
        }
        match case["id"].as_str().unwrap() {
            "stat-offer-roll" => run(&mut s, 1, &mut events),
            "stat-trade" => {
                run(&mut s, 1, &mut events);
                request(&mut s, &a["message"], &mut events)
            }
            "stat-repeat" => {
                run(&mut s, 1, &mut events);
                events.extend(trade(&mut s, PlayerId(1), Kind::Stats, 0));
                request(&mut s, &a["message"], &mut events)
            }
            "stat-no-offers-yet" => {
                request(&mut s, &a["message"], &mut events);
                run(&mut s, 1, &mut events)
            }
            "barter-cycle" => {
                run(&mut s, 1, &mut events);
                request(&mut s, &a["first"], &mut events);
                request(&mut s, &a["immediate"], &mut events);
                run(&mut s, 100, &mut events);
                request(&mut s, &a["second"], &mut events);
                run(&mut s, 100, &mut events);
                request(&mut s, &a["third"], &mut events)
            }
            "barter-no-weapon" | "barter-full-pouch" | "barter-no-potion" | "barter-both-slots"
            | "barter-committed" => {
                run(&mut s, 1, &mut events);
                request(&mut s, &a["message"], &mut events)
            }
            "order-cooldown-before-held" => {
                run(&mut s, 1, &mut events);
                request(&mut s, &a["message"], &mut events);
                setup(&mut s, ds.last().unwrap());
                request(&mut s, &a["message"], &mut events)
            }
            _ => request(&mut s, &a["message"], &mut events),
        }
        assert_eq!(
            feedback(&events),
            a["toasts"],
            "source feedback {}",
            case["id"]
        );
        let p = &s.w.players[0];
        let f = &a["final"]["players"][0];
        assert_eq!(
            p.trade_used,
            f["tradeUsed"].as_bool().unwrap(),
            "source used {}",
            case["id"]
        );
        assert_eq!(p.potion_small as u64, f["potionSmall"].as_u64().unwrap());
        assert_eq!(
            p.weapon.weapon0.map_or("", |w| w.as_str()),
            f["weapon0"].as_str().unwrap()
        );
        assert_eq!(
            p.weapon.weapon1.map_or("", |w| w.as_str()),
            f["weapon1"].as_str().unwrap()
        );
        let own = view(&s, PlayerId(1));
        let expected = f["tradeOffers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|raw| serde_json::from_str::<V>(raw.as_str().unwrap()).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            own.offers.len(),
            expected.len(),
            "quote count {}",
            case["id"]
        );
        for (actual, expected) in own.offers.iter().zip(expected) {
            assert_eq!(actual.cost.as_str(), expected["cost"].as_str().unwrap());
            assert_eq!(actual.cost_value, expected["costValue"].as_f64().unwrap());
            assert_eq!(actual.gain.as_str(), expected["gain"].as_str().unwrap());
            assert_eq!(actual.gain_value, expected["gainValue"].as_f64().unwrap());
            assert_eq!(actual.label, expected["label"].as_str().unwrap());
        }
        let expected_stats = f["tradeStats"].as_array().unwrap();
        assert_eq!(own.stats.len(), expected_stats.len());
        for ((stat, value), expected) in own.stats.iter().zip(expected_stats) {
            assert_eq!(stat.as_str(), expected[0].as_str().unwrap());
            assert_eq!(*value, expected[1].as_f64().unwrap());
        }
        let expected_deadline = a["final"]["barterAt"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row[0] == "p0")
            .map(|row| row[1].as_f64().unwrap());
        assert_eq!(own.barter_ready_at, expected_deadline);
        assert_eq!(
            s.tick() as u64,
            a["final"]["tick"].as_u64().unwrap(),
            "source tick {}",
            case["id"]
        );
    }
}
