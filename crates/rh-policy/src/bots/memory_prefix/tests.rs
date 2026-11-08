use super::*;
use crate::bots::delivered::{
    tests::{basic_actor, corpus, input},
    Frame,
};
use serde_json::Value;
fn fixture_frame(row: &Value) -> Frame {
    let now = row["now"].as_f64().unwrap();
    let mut input = input(now, vec![]);
    let owner = input.owner.as_mut().unwrap();
    owner.x = row["owner"]["x"].as_f64().unwrap_or(32.) as f32;
    owner.y = row["owner"]["y"].as_f64().unwrap_or(32.) as f32;
    for v in row["players"].as_array().unwrap() {
        let mut a = basic_actor(v["id"].as_u64().unwrap() as u32);
        a.x = v["x"].as_u64().unwrap() as u16;
        a.y = v["y"].as_u64().unwrap() as u16;
        a.hp_pct = v["hpPct"].as_u64().unwrap_or(100) as u8;
        a.bounty = v["bounty"].as_u64().unwrap_or(0) as u16;
        a.status = match v["status"].as_str().unwrap_or("alive") {
            "alive" => 1,
            "dead" => 2,
            "mia" => 3,
            _ => panic!(),
        };
        a.weapon = WeaponId::parse(v["weapon"].as_str().unwrap_or("sword"))
            .unwrap()
            .code();
        a.faction = FactionId::parse(v["faction"].as_str().unwrap_or("frost"))
            .unwrap()
            .code();
        input.actors.push(a);
    }
    Frame::from_decoded(input).unwrap()
}
fn opt_weapon(v: &Value) -> Option<WeaponId> {
    v.as_str().map(|s| WeaponId::parse(s).unwrap())
}
#[test]
fn actual_source_memory_subset_reproduces_all_48_declared_frames() {
    let f = corpus();
    let cases = f["memoryCases"].as_array().unwrap();
    assert_eq!(cases.len(), 6);
    let mut frames = 0;
    for case in cases {
        let tier = TierId::parse(case["tier"].as_str().unwrap()).unwrap();
        let mut m = Memory::new(Epoch(1), PlayerRef::new(1).unwrap(), tier, 8).unwrap();
        for row in case["frames"].as_array().unwrap() {
            let frame = fixture_frame(&row["input"]);
            m.observe(&frame).unwrap();
            frames += 1;
            let want = &row["result"];
            assert_eq!(
                m.own_motion().unwrap().still_since,
                want["stillSince"].as_f64().unwrap()
            );
            assert_eq!(m.records().len(), want["records"].as_array().unwrap().len());
            for (r, w) in m.records().iter().zip(want["records"].as_array().unwrap()) {
                assert_eq!(r.id.get(), w["id"].as_u64().unwrap() as u32);
                assert_eq!(
                    r.pos,
                    Vec2::new(w["x"].as_f64().unwrap(), w["y"].as_f64().unwrap())
                );
                assert_eq!(r.seen_at, w["seenAt"].as_f64().unwrap());
                assert_eq!(r.faction.as_str(), w["faction"].as_str().unwrap());
                assert_eq!(r.in_hand, opt_weapon(&w["inHand"]));
                assert_eq!(r.other_slot, opt_weapon(&w["otherSlot"]));
                assert_eq!(
                    r.weapons_seen,
                    w["weaponsSeen"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|v| WeaponId::parse(v.as_str().unwrap()).unwrap())
                        .collect::<Vec<_>>()
                );
                assert_eq!(r.alive, w["alive"].as_bool().unwrap());
                assert_eq!(r.died_at, w["diedAt"].as_f64());
                assert_eq!(
                    r.bounty,
                    u16::try_from(w["bounty"].as_u64().unwrap()).unwrap()
                );
                assert_eq!(
                    m.hp_belief(r.id).unwrap().source_estimate(),
                    w["hpEstimate"].as_f64().unwrap()
                );
                match (m.whereabouts(r.id), &w["whereabouts"]) {
                    (None, Value::Null) => {}
                    (Some(got), want) => {
                        assert_eq!(
                            got.at,
                            Vec2::new(
                                want["at"]["x"].as_f64().unwrap(),
                                want["at"]["y"].as_f64().unwrap()
                            )
                        );
                        assert_eq!(got.radius, want["radius"].as_f64().unwrap());
                    }
                    _ => panic!("whereabouts {w}"),
                }
            }
        }
    }
    assert_eq!(frames, 48);
}
#[test]
fn lifecycle_and_capacity_refusals_are_atomic_and_explicit_reset_clears_memory() {
    let mut m = Memory::new(Epoch(1), PlayerRef::new(1).unwrap(), TierId::Normal, 1).unwrap();
    m.observe(&Frame::from_decoded(input(7.5, vec![basic_actor(2)])).unwrap())
        .unwrap();
    let baseline = m.clone();
    for (s, want) in [
        (input(7.5, vec![]), Error::ClockResetRequired),
        (input(7.25, vec![]), Error::ClockResetRequired),
        (
            input(57.5, vec![basic_actor(2), basic_actor(3)]),
            Error::Limit,
        ),
    ] {
        assert_eq!(m.observe(&Frame::from_decoded(s).unwrap()), Err(want));
        assert_eq!(m, baseline);
    }
    let mut s = input(57.5, vec![]);
    s.epoch = Epoch(2);
    assert_eq!(
        m.observe(&Frame::from_decoded(s).unwrap()),
        Err(Error::Epoch)
    );
    assert_eq!(m, baseline);
    let mut s = input(57.5, vec![]);
    s.owner = None;
    assert_eq!(
        m.observe(&Frame::from_decoded(s).unwrap()),
        Err(Error::OwnerAbsent)
    );
    assert_eq!(m, baseline);
    m.reset(Epoch(2), PlayerRef::new(1).unwrap());
    assert!(m.records().is_empty());
    assert!(m.own_motion().is_none());
    let mut s = input(0.125, vec![basic_actor(3)]);
    s.epoch = Epoch(2);
    assert_eq!(m.observe(&Frame::from_decoded(s).unwrap()), Ok(()));
    assert!(m.whereabouts(PlayerRef::new(2).unwrap()).is_none());
}
#[test]
fn unseen_disappearance_retains_prior_facts_and_npc_refs_never_enter_player_memory() {
    let mut m = Memory::new(Epoch(1), PlayerRef::new(1).unwrap(), TierId::Hard, 8).unwrap();
    m.observe(&Frame::from_decoded(input(100.125, vec![basic_actor(2)])).unwrap())
        .unwrap();
    let prior = m.records()[0].clone();
    let mut npc = basic_actor(1 << 31);
    npc.kind = 2;
    let frame = Frame::from_decoded(input(200.125, vec![npc])).unwrap();
    m.observe(&frame).unwrap();
    assert_eq!(m.records(), &[prior]);
    assert_eq!(
        m.whereabouts(PlayerRef::new(2).unwrap()).unwrap().at,
        Vec2::new(100., 200.)
    );
    // No alternative hidden world can be passed to this API: no World/Observation or hidden rows are inputs.
    // This direct dependency test is not a paired-world/persistent-publisher proof.
}

#[test]
fn hidden_and_off_camera_rows_cannot_change_memory_or_consume_record_capacity() {
    let mut a = Memory::new(Epoch(1), PlayerRef::new(1).unwrap(), TierId::Normal, 1).unwrap();
    a.observe(&Frame::from_decoded(input(7.125, vec![basic_actor(2)])).unwrap())
        .unwrap();
    let mut b = a.clone();
    a.observe(&Frame::from_decoded(input(57.125, vec![])).unwrap())
        .unwrap();
    let mut hidden = basic_actor(2);
    hidden.effects = crate::bots::wish::EFFECT_HIDDEN;
    hidden.status = 2;
    hidden.hp_pct = 0;
    hidden.weapon = 4;
    hidden.bounty = 65535;
    let mut far = basic_actor(3);
    far.x = 7200;
    far.hp_pct = 0;
    far.status = 3;
    b.observe(&Frame::from_decoded(input(57.125, vec![hidden, far])).unwrap())
        .unwrap();
    assert_eq!(a, b);
    assert_eq!(b.records().len(), 1);
    assert!(b.records()[0].alive);
    // Input-level noninterference only; the raw Frame is a codec-shaped carrier, not an attested fair percept.
}
