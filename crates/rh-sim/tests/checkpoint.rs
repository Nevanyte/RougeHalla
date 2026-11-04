//! Checkpoint scope (docs/CONTRACTS.md C-DET): a checkpoint is `{format, statics, world}`; per-tick scratch (the action
//! rank, the damage ledger, the melee requests, the bounty snapshot) is never serialized, and a restored match continues
//! bit-identically.

use rh_sim::arenas::practice_arena;
use rh_sim::{Command, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};
use serde_json::Value;

/// Eight fighters packed into one corner of the practice arena, all swinging at their neighbour.
fn crowded_8() -> Sim {
    let factions = [
        FactionId::Holy,
        FactionId::Fire,
        FactionId::Frost,
        FactionId::Holy,
        FactionId::Fire,
        FactionId::Frost,
        FactionId::Holy,
        FactionId::Fire,
    ];
    let ps: Vec<Placement> = factions
        .iter()
        .enumerate()
        .map(|(i, &faction)| Placement {
            profile: format!("p{i}"),
            faction,
            bot: false,
            at: Vec2::new(400.0 + 28.0 * (i % 4) as f64, 400.0 + 28.0 * (i / 4) as f64),
            hp: None,
        })
        .collect();
    Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(9),
        &ps,
    )
}

fn drive(sim: &mut Sim, ticks: u32) {
    for t in 0..ticks {
        for i in 1..=8u32 {
            let a = (t as f64 * 0.05) + i as f64;
            let _ = sim.submit(PlayerId(i), Command::Aim { a });
            if t % 7 == 0 {
                let _ = sim.submit(PlayerId(i), Command::Attack { a, t: None });
            }
            if t % 7 == 3 {
                let _ = sim.submit(PlayerId(i), Command::Release { a, t: None });
            }
        }
        sim.step();
    }
}

fn keys(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::Object(m) => {
            for (k, v) in m {
                out.push(k.clone());
                keys(v, out);
            }
        }
        Value::Array(a) => a.iter().for_each(|v| keys(v, out)),
        _ => {}
    }
}

#[test]
fn a_checkpoint_contains_no_scratch_keys() {
    let mut sim = crowded_8();
    drive(&mut sim, 100);
    assert!(
        sim.players().iter().any(|p| p.vitals.hp < p.vitals.max_hp),
        "the crowd fought, so the ledger and melee scratch were used"
    );
    let json = serde_json::to_value(&sim).unwrap();
    let mut all = Vec::new();
    keys(&json, &mut all);
    for banned in [
        "rank",
        "ledger",
        "melee",
        "stepping",
        "bounty_at_tick_start",
        "downed_this_tick",
        "scratch",
    ] {
        assert!(
            !all.iter().any(|k| k == banned),
            "a checkpoint must not carry the scratch key `{banned}`"
        );
    }
    assert_eq!(json["format"], "rh-checkpoint/3");
    let top: Vec<&String> = json.as_object().unwrap().keys().collect();
    assert_eq!(top.len(), 3, "format, statics, world: {top:?}");
}

#[test]
fn a_mid_fight_checkpoint_continues_identically() {
    let mut a = crowded_8();
    drive(&mut a, 100);
    let mut b = Sim::restore(serde_json::to_value(&a).unwrap()).unwrap();
    assert_eq!(a.state_hash(), b.state_hash());
    for sim in [&mut a, &mut b] {
        drive(sim, 120);
    }
    assert_eq!(a.state_hash(), b.state_hash());
}
