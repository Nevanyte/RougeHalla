use crate::{
    Event, FactionId, ItemObserver, Observation, PlayerId, PublicCommand, Secrets, Sim, SimConfig,
};
use serde_json::{json, Value};
fn arena() -> crate::Arena {
    let data: crate::mapdata::GameMapData = serde_json::from_str(include_str!(
        "../../../../parity/initial-loot/input-map.json"
    ))
    .unwrap();
    let hash = u32::from_str_radix(&crate::mapgen::map_hash::map_hash(&data), 16).unwrap();
    let v = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: hash,
        map: data,
    }
    .validate()
    .unwrap();
    let (w, h, t, l) = v.into_parts();
    let spawns = l
        .data()
        .spawns
        .iter()
        .map(|p| crate::Vec2::new(p.x, p.y))
        .collect();
    crate::Arena {
        map: crate::TileMap::new(w, h, t)
            .unwrap()
            .with_layers(std::sync::Arc::new(l))
            .unwrap(),
        spawns,
    }
}
fn sim(input: &Value) -> Sim {
    let mut s = Sim::new(
        SimConfig {
            consumables: true,
            initial_loot: true,
            min_players: 2,
            fill_seconds: 0.,
            ..Default::default()
        },
        arena(),
        Secrets {
            spawn_seed: 12,
            reward_salt: [1, 2, 3, 4],
            ..Secrets::from_seed(1)
        },
    );
    s.add_player("p0", Some(FactionId::Fire), false);
    s.add_player("p1", Some(FactionId::Sentenced), false);
    s.step();
    let now = s.w.server_time;
    let p = &mut s.w.players[0];
    p.body.x = 112.;
    p.body.y = 112.;
    p.motion.path.clear();
    p.body.history.reset(crate::state::Sample {
        t: now,
        x: 112.,
        y: 112.,
    });
    p.vitals.hp = p.vitals.max_hp - input["damage"].as_f64().unwrap();
    p.potion_small = u8::try_from(input["stock"].as_u64().unwrap()).unwrap();
    s.take_events();
    s
}
fn key(id: u32) -> String {
    let mut n = id;
    let mut digits = Vec::new();
    loop {
        digits.push(char::from_digit(n % 36, 36).unwrap());
        n /= 36;
        if n == 0 {
            break;
        }
    }
    format!("c{}", digits.into_iter().rev().collect::<String>())
}
fn player(s: &Sim, id: PlayerId) -> &str {
    s.player_name(id).unwrap()
}
fn frame(s: &Sim, events: &[Event]) -> Value {
    let mut main = s.w.spawn_rng.clone();
    let mut reward = s.w.reward_rng.clone();
    json!({"tick":s.tick(),"time":s.server_time(),"serial":s.w.entity_counter,"uid":s.w.item_counter,"players":s.players().iter().map(|p|json!({"id":player(s,p.id),"hp":p.vitals.hp,"maxHp":p.vitals.max_hp,"potionSmall":p.potion_small,"potionsHealing":p.potions_healing,"healingUntil":p.healing_until,"weapon0":p.weapon.weapon0.map_or("",|w|w.as_str()),"weapon1":p.weapon.weapon1.map_or("",|w|w.as_str()),"status":if p.status==crate::Status::Alive{"alive"}else{"other"}})).collect::<Vec<_>>(),"containers":s.containers().iter().map(|c|json!({"id":key(c.id),"kind":match c.kind{crate::ContainerKind::Chest=>"chest",crate::ContainerKind::Ground=>"ground",crate::ContainerKind::Body(_)=>"body",crate::ContainerKind::WindEmblem=>"consumable"},"x":c.at.x,"y":c.at.y,"opened":c.opened,"items":c.items.iter().map(|it|json!({"uid":format!("U{}",it.uid),"def":it.def.as_str()})).collect::<Vec<_>>(),"statOffer":c.stat_offer})).collect::<Vec<_>>(),"rewards":s.w.reward_chests.iter().map(|c|json!({"id":key(c.id),"x":c.at.x,"y":c.at.y,"expiresAt":c.expires_at,"options":c.options.iter().flatten().map(|v|v.as_str()).collect::<Vec<_>>(),"pickers":c.pickers.iter().map(|id|player(s,*id)).collect::<Vec<_>>(),"takenBy":c.taken.iter().map(|v|v.map_or("",|id|player(s,id))).collect::<Vec<_>>()})).collect::<Vec<_>>(),"healing":s.w.potion_healing.iter().map(|e|json!([player(s,e.id),e.hots])).collect::<Vec<_>>(),"notices":events.iter().filter_map(|e|if let Event::PotionNotice{id,notice}=e{Some(json!({"to":player(s,*id),"text":notice.message()}))}else{None}).collect::<Vec<_>>(),"heals":events.iter().filter_map(|e|if let Event::Heal{id,amount}=e{Some(json!({"id":player(s,*id),"amount":amount}))}else{None}).collect::<Vec<_>>(),"rng":{"random":{"next":std::array::from_fn::<_,4,_>(|_|main.next_f64())},"rewardRandom":{"next":std::array::from_fn::<_,4,_>(|_|reward.next_f64())}}})
}
fn exact(a: &Value, b: &Value, path: &str) {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => assert_eq!(
            a.as_f64().unwrap().to_bits(),
            b.as_f64().unwrap().to_bits(),
            "{path}"
        ),
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path}");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                exact(a, b, &format!("{path}[{i}]"))
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(
                a.keys().collect::<Vec<_>>(),
                b.keys().collect::<Vec<_>>(),
                "{path}"
            );
            for (k, a) in a {
                exact(a, &b[k], &format!("{path}.{k}"))
            }
        }
        _ => assert_eq!(a, b, "{path}"),
    }
}
fn command(s: &mut Sim, observer: &mut ItemObserver, name: &str) {
    let public = if name == "pickup" {
        let mut o = Observation::default();
        observer.observe_into(s, &[], &mut o, None).unwrap();
        PublicCommand::Pickup {
            handle: o.props.iter().find(|p| p.cue.focused).unwrap().handle,
        }
    } else {
        assert_eq!(name, "use");
        PublicCommand::UseConsumable
    };
    let cmd = observer.resolve(s, public).unwrap();
    s.submit(PlayerId(1), cmd).unwrap();
}
#[test]
fn source_pickup_open_use_hot_and_restored_continuations() {
    let f: Value =
        serde_json::from_str(include_str!("../../../../parity/initial-loot/source.json")).unwrap();
    assert_eq!(f["format"], "rh-initial-loot-runtime/1");
    let cases = f["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 4);
    for c in cases {
        assert_eq!(c["noninterference"], true);
        let mut s = sim(&c["input"]);
        let mut observer = ItemObserver::new(PlayerId(1));
        let frames = c["frames"].as_array().unwrap();
        exact(&frame(&s, &[]), &assertion_frame(&frames[0]), "setup");
        let mut index = 1;
        let mut restored: Option<Sim> = None;
        let mut restored_observer = ItemObserver::new(PlayerId(1));
        for group in c["input"]["groups"].as_array().unwrap() {
            for step in 0..group["steps"].as_u64().unwrap() {
                if step == 0 {
                    for cmd in group["commands"].as_array().unwrap() {
                        let name = cmd.as_str().unwrap();
                        command(&mut s, &mut observer, name);
                        if let Some(r) = &mut restored {
                            command(r, &mut restored_observer, name);
                        }
                    }
                }
                let events = s.step();
                let expected = &frames[index];
                let actual = frame(&s, &events);
                exact(
                    &actual,
                    &assertion_frame(expected),
                    c["input"]["name"].as_str().unwrap(),
                );
                if let Some(r) = &mut restored {
                    let events2 = r.step();
                    exact(&frame(r, &events2), &actual, "restore");
                    assert_eq!(r.state_hash(), s.state_hash());
                } else if index == 2 {
                    let bytes = serde_json::to_vec(&s).unwrap();
                    restored = Some(
                        Sim::restore(&mut serde_json::Deserializer::from_slice(&bytes)).unwrap(),
                    );
                }
                index += 1;
            }
        }
        assert_eq!(index, frames.len());
        assert!(s.check_layout().is_ok());
    }
}
#[test]
fn constructor_storage_handles_and_private_stat_offer() {
    let input = json!({"damage":600,"stock":0});
    let mut a = sim(&input);
    assert_eq!(a.w.initial_birth_serial, 1);
    assert_eq!(
        a.containers()[0].items[0].def,
        crate::initial_world::ItemDef::PotionSmall
    );
    let mut b = a.clone();
    b.w.containers[0].stat_offer = false;
    let mut oa = ItemObserver::new(PlayerId(1));
    let mut ob = ItemObserver::new(PlayerId(1));
    let mut va = Observation::default();
    let mut vb = Observation::default();
    oa.observe_into(&a, &[], &mut va, None).unwrap();
    ob.observe_into(&b, &[], &mut vb, None).unwrap();
    assert_eq!(va.props, vb.props);
    assert_eq!(va.props[0].cue.kind, crate::PropKind::Chest { open: false });
    assert!(va.props[0].cue.focused);
    command(&mut a, &mut oa, "pickup");
    a.step();
    assert!(a.containers()[0].opened && a.containers()[0].items.is_empty());
    assert_eq!(a.w.reward_chests.len(), 1);
    let mut unopened = serde_json::to_value(&a).unwrap();
    unopened["world"]["containers"][0]["opened"] = json!(false);
    assert!(
        Sim::restore(&unopened).is_err(),
        "depleted initial crates cannot become unopened again"
    );
    let mut late_birth = serde_json::to_value(&a).unwrap();
    late_birth["world"]["containers"][0]["born_tick"] = json!(1);
    assert!(
        Sim::restore(&late_birth).is_err(),
        "initial constructor births stay at tick zero"
    );
    let mut cp = serde_json::to_value(&a).unwrap();
    cp["world"]["containers"][0]["stat_offer"] = json!(false);
    assert!(Sim::restore(&mut serde_json::Deserializer::from_str(&cp.to_string())).is_err());
    command(&mut a, &mut oa, "use");
    a.step();
    a.remove_player(PlayerId(2));
    a.step();
    for _ in 0..20 {
        a.step();
    }
    assert_eq!(a.phase(), crate::Phase::Ended);
    let bytes = serde_json::to_vec(&a).unwrap();
    assert!(Sim::restore(&mut serde_json::Deserializer::from_slice(&bytes)).is_ok());
}

fn assertion_frame(expected: &Value) -> Value {
    let mut frame = expected.clone();
    frame["rng"].as_object_mut().unwrap().remove("questRandom");
    for rng in frame["rng"].as_object_mut().unwrap().values_mut() {
        rng.as_object_mut().unwrap().remove("draws");
    }
    frame
}

#[test]
fn a_stored_camp_potion_is_preferred_and_heals_its_larger_share() {
    use crate::{arenas::practice_arena, Placement};
    let ps: Vec<_> = (0..2)
        .map(|i| Placement {
            profile: format!("q{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: crate::Vec2::new(320.0 + 64.0 * i as f64, 320.0),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let mut s = Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(5),
        &ps,
    );
    s.w.players[0].vitals.hp = 300.0;
    s.w.players[0].potion_large = 1;
    s.w.players[0].potion_small = 2;
    let max = s.w.players[0].vitals.max_hp;
    s.submit(
        PlayerId(1),
        crate::validate(crate::RawCommand::UseConsumable).unwrap(),
    )
    .unwrap();
    let ev = s.step();
    assert_eq!(s.w.players[0].potion_large, 0, "the camp potion was drunk");
    assert_eq!(
        s.w.players[0].potion_small, 2,
        "the small stock is untouched"
    );
    let e =
        s.w.potion_healing
            .iter()
            .find(|e| e.id == PlayerId(1))
            .unwrap();
    assert_eq!(e.hots.len(), 1);
    assert!(
        (e.hots[0].amount - max * 0.4 / 10.0).abs() < 1e-9,
        "a camp potion heals 40% over 5 s: {}",
        e.hots[0].amount
    );
    assert!(ev.iter().any(|x| matches!(
        x,
        Event::PotionNotice { id, notice: crate::potions::Notice::LargeUsed } if *id == PlayerId(1)
    )));
}

#[test]
fn without_a_camp_potion_the_small_one_is_used_and_a_full_bag_refuses_the_grant() {
    use crate::{arenas::practice_arena, Placement};
    let ps: Vec<_> = (0..2)
        .map(|i| Placement {
            profile: format!("r{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: crate::Vec2::new(320.0 + 64.0 * i as f64, 320.0),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let mut s = Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(6),
        &ps,
    );
    s.w.players[0].vitals.hp = 300.0;
    s.w.players[0].potion_small = 1;
    let max = s.w.players[0].vitals.max_hp;
    s.submit(
        PlayerId(1),
        crate::validate(crate::RawCommand::UseConsumable).unwrap(),
    )
    .unwrap();
    let ev = s.step();
    assert_eq!(s.w.players[0].potion_small, 0);
    assert_eq!(s.w.players[0].potion_large, 0);
    let e =
        s.w.potion_healing
            .iter()
            .find(|e| e.id == PlayerId(1))
            .unwrap();
    assert!((e.hots[0].amount - max * 0.25 / 10.0).abs() < 1e-9);
    assert!(ev.iter().any(|x| matches!(
        x,
        Event::PotionNotice { id, notice: crate::potions::Notice::Used } if *id == PlayerId(1)
    )));
    // A full camp stock refuses the grant, keeps its count and says nothing.
    s.w.players[0].potion_large = crate::potions::DEFINITION.cap;
    let mut v = Vec::new();
    assert!(!crate::systems::potions::grant(
        &mut s.w,
        &mut v,
        PlayerId(1),
        crate::potions::Size::Large
    ));
    assert_eq!(s.w.players[0].potion_large, crate::potions::DEFINITION.cap);
    assert!(v.is_empty());
}
