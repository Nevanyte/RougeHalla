use super::*;
use serde_json::Value;
pub(crate) fn corpus() -> Value {
    serde_json::from_str(include_str!(
        "../../../../../parity/policy/bot-memory-subset.json"
    ))
    .unwrap()
}
fn u(v: &Value, k: &str) -> u64 {
    v[k].as_u64().unwrap()
}
fn float(v: &Value, k: &str) -> f32 {
    f32::from_bits(u(v, k) as u32)
}
fn owner(v: &Value) -> Option<Owner13> {
    if v.is_null() {
        return None;
    }
    Some(Owner13 {
        id: u(v, "id") as u32,
        faction: u(v, "faction") as u8,
        weapon: u(v, "weapon") as u8,
        status: u(v, "status") as u8,
        x: float(v, "xBits"),
        y: float(v, "yBits"),
        facing: float(v, "facingBits"),
        hp: float(v, "hpBits"),
        max_hp: float(v, "maxHpBits"),
        barrier: float(v, "barrierBits"),
        barrier_ring_step: u(v, "barrierRingStep") as u8,
        ready_in_ms: u(v, "readyIn") as u16,
        kills: u(v, "kills") as u16,
        bounty: u(v, "bounty") as u16,
        gv: u(v, "gv") as u16,
        effects: u(v, "effects") as u16,
        move_seq: u(v, "moveSeq") as u8,
        displace_seq: u(v, "displaceSeq") as u8,
        sig: u(v, "sig") as u8,
    })
}
fn actor(v: &Value) -> Actor13 {
    Actor13 {
        id: u(v, "id") as u32,
        kind: u(v, "kind") as u8,
        faction: u(v, "faction") as u8,
        weapon: u(v, "weapon") as u8,
        status: u(v, "status") as u8,
        x: u(v, "x") as u16,
        y: u(v, "y") as u16,
        facing: u(v, "facing") as u16,
        hp_pct: u(v, "hpPct") as u8,
        barrier_pct: u(v, "barrierPct") as u8,
        barrier_ring_step: u(v, "barrierRingStep") as u8,
        bounty: u(v, "bounty") as u16,
        effects: u(v, "effects") as u16,
        displace_seq: u(v, "displaceSeq") as u8,
        sig: u(v, "sig") as u8,
        mob_type_code: u(v, "mobTypeCode") as u8,
    }
}
pub(crate) fn basic_owner() -> Owner13 {
    Owner13 {
        id: 1,
        faction: 0,
        weapon: 0,
        status: 1,
        x: 32.,
        y: 32.,
        facing: 0.,
        hp: 100.,
        max_hp: 100.,
        barrier: 0.,
        barrier_ring_step: 0,
        ready_in_ms: 0,
        kills: 0,
        bounty: 0,
        gv: 0,
        effects: 0,
        move_seq: 0,
        displace_seq: 0,
        sig: 0,
    }
}
pub(crate) fn basic_actor(id: u32) -> Actor13 {
    Actor13 {
        id,
        kind: 0,
        faction: 3,
        weapon: 0,
        status: 1,
        x: 800,
        y: 1600,
        facing: 0,
        hp_pct: 100,
        barrier_pct: 0,
        barrier_ring_step: 0,
        bounty: 0,
        effects: 0,
        displace_seq: 0,
        sig: 0,
        mob_type_code: 0,
    }
}
pub(crate) fn input(now: f64, actors: Vec<Actor13>) -> Snapshot13 {
    Snapshot13 {
        protocol: 13,
        epoch: Epoch(1),
        viewer: PlayerRef::new(1).unwrap(),
        source_time: now,
        owner: Some(basic_owner()),
        actors,
    }
}
#[test]
fn adapter_reproduces_actual_js_decoding_and_current_rust_generated_golden_bits() {
    let f = corpus();
    assert_eq!(f["codecCases"].as_array().unwrap().len(), 5);
    for case in f["codecCases"].as_array().unwrap() {
        let v = &case["input"];
        let own = owner(&v["owner"]);
        let viewer = PlayerRef::new(own.map_or(3, |o| o.id)).unwrap();
        let decoded = Snapshot13 {
            protocol: 13,
            epoch: Epoch(1),
            viewer,
            source_time: v["sourceTime"].as_f64().unwrap(),
            owner: own,
            actors: v["actors"].as_array().unwrap().iter().map(actor).collect(),
        };
        let frame = Frame::from_decoded(decoded);
        if case["admissible"] == false {
            assert!(
                frame.is_err(),
                "generic codec vector must not attest live reference namespace"
            );
            continue;
        }
        let frame = frame.unwrap();
        let want = &case["expected"];
        assert_eq!(frame.source_time(), want["sourceTime"].as_f64().unwrap());
        assert_eq!(
            matches!(frame.owner(), Fact::Delivered(None)),
            want["owner"].is_null()
        );
        assert_eq!(
            frame.actors().len(),
            want["actors"].as_array().unwrap().len()
        );
        if let Fact::Delivered(Some(owner)) = frame.owner() {
            for (key, value) in [
                ("id", owner.id.get() as u64),
                ("faction", owner.faction.code() as u64),
                ("weapon", owner.weapon.code() as u64),
                ("status", owner.status as u64),
                ("readyIn", owner.ready_in_ms as u64),
                ("kills", owner.kills as u64),
                ("bounty", owner.bounty as u64),
                ("gv", owner.gv as u64),
                ("effects", owner.effects as u64),
                ("moveSeq", owner.move_seq as u64),
                ("displaceSeq", owner.displace_seq as u64),
                ("sig", owner.sig as u64),
                ("barrierRingStep", owner.barrier_ring_step as u64),
            ] {
                assert_eq!(value, u(&want["owner"], key), "owner {key}");
            }
            for (key, value) in [
                ("xBits", owner.x),
                ("yBits", owner.y),
                ("facingBits", owner.facing),
                ("hpBits", owner.hp),
                ("maxHpBits", owner.max_hp),
                ("barrierBits", owner.barrier),
            ] {
                assert_eq!(
                    (value as f32).to_bits(),
                    u(&want["owner"], key) as u32,
                    "{} {key}",
                    case["name"]
                );
            }
        }
        for (got, want) in frame
            .actors()
            .iter()
            .zip(want["actors"].as_array().unwrap())
        {
            assert_eq!((got.x as f32).to_bits(), u(want, "xBits") as u32);
            assert_eq!((got.y as f32).to_bits(), u(want, "yBits") as u32);
            assert_eq!((got.facing as f32).to_bits(), u(want, "facingBits") as u32);
            assert_eq!(got.hp_pct, u(want, "hpPct") as u8);
            for (key, value) in [
                ("faction", got.faction.code() as u64),
                ("weapon", got.weapon.code() as u64),
                ("status", got.status as u64),
                ("bounty", got.bounty as u64),
                ("effects", got.effects as u64),
                ("displaceSeq", got.displace_seq as u64),
                ("sig", got.sig as u64),
                ("mobTypeCode", got.mob_type_code as u64),
                ("barrierPct", got.barrier_pct as u64),
                ("barrierRingStep", got.barrier_ring_step as u64),
            ] {
                assert_eq!(value, u(want, key), "actor {key}");
            }
        }
        for missing in [
            MissingFact::OwnerLock,
            MissingFact::OwnerAbsoluteReady,
            MissingFact::OwnerDraw,
            MissingFact::OwnerMirrors,
            MissingFact::Names,
            MissingFact::BotTag,
            MissingFact::PlayerCounts,
            MissingFact::MobMinimap,
            MissingFact::EventOrigins,
            MissingFact::ItemContinuity,
        ] {
            assert_eq!(frame.unavailable(missing), Fact::Unavailable);
        }
    }
    for row in f["clockFrames"].as_array().unwrap() {
        let now = row["sourceTime"].as_f64().unwrap();
        let frame = Frame::from_decoded(input(now, vec![])).unwrap();
        assert_eq!(frame.source_time().to_bits(), now.to_bits());
    }
    assert!(f["clockFrames"]
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r["sourceTime"].as_f64().unwrap() != r["tick"].as_f64().unwrap() * 50.));
}
#[test]
fn adapter_rejects_unsupported_codes_namespaces_and_malformed_frames() {
    for mutate in [
        |s: &mut Snapshot13| s.protocol = 12,
        |s: &mut Snapshot13| s.source_time = f64::NAN,
        |s: &mut Snapshot13| s.owner.as_mut().unwrap().hp = f32::INFINITY,
        |s: &mut Snapshot13| s.owner.as_mut().unwrap().id = 2,
        |s: &mut Snapshot13| s.actors[0].kind = 255,
        |s: &mut Snapshot13| s.actors[0].kind = 2,
        |s: &mut Snapshot13| s.actors[0].id = 1,
        |s: &mut Snapshot13| s.actors[0].id = u32::MAX,
        |s: &mut Snapshot13| s.actors[0].hp_pct = 101,
        |s: &mut Snapshot13| s.actors[0].faction = 15,
    ] {
        let mut s = input(7.25, vec![basic_actor(2)]);
        mutate(&mut s);
        assert!(Frame::from_decoded(s).is_err());
    }
    let mut s = input(7.25, vec![basic_actor(2), basic_actor(2)]);
    assert_eq!(Frame::from_decoded(s).unwrap_err(), Error::ActorOrder);
    s = input(7.25, vec![basic_actor(2); ACTOR_LIMIT + 1]);
    assert_eq!(Frame::from_decoded(s).unwrap_err(), Error::ActorLimit);
    let mut npc = basic_actor(1 << 31);
    npc.kind = 1;
    let f = Frame::from_decoded(input(7.25, vec![npc])).unwrap();
    assert!(matches!(f.actors()[0].reference, Reference::RegionalMob(_)));
    assert!(f.actors()[0].reference.player().is_none());
    npc.id = u32::MAX;
    assert_eq!(
        Frame::from_decoded(input(7.25, vec![npc])).unwrap_err(),
        Error::Namespace
    );
    let mut absent = input(7.25, vec![]);
    absent.owner = None;
    assert!(matches!(
        Frame::from_decoded(absent).unwrap().owner(),
        Fact::Delivered(None)
    ));
}
#[test]
fn adapter_preserves_owner_f32_precision_and_remote_code_grid() {
    let mut s = input(88.125, vec![basic_actor(2)]);
    let raw = 1.0000000000001_f64;
    s.owner.as_mut().unwrap().x = raw as f32;
    s.actors[0].x = 9;
    s.actors[0].facing = 32768;
    let f = Frame::from_decoded(s).unwrap();
    let Fact::Delivered(Some(owner)) = f.owner() else {
        panic!()
    };
    assert_eq!(owner.x, 1.);
    assert_ne!(owner.x, raw);
    assert_eq!(f.actors()[0].x, 1.125);
    assert_eq!(
        (f.actors()[0].facing as f32).to_bits(),
        (-32768_f32 * ((std::f64::consts::TAU / 65536.) as f32)).to_bits()
    );
}
