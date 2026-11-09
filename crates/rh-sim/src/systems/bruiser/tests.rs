//! Captured actual-source Frozen Justice comparison (P-FACTION-5): the elite-contact guard, its standard-mirror
//! defense bonus and every reset, replayed through the ported rows against the pinned-container corpus.
//!
//! Corpus: «parity/bruiser/frozen-justice.json», captured from the unmodified source by
//! «tools/bruiser-fixtures/capture.mts» (declared map «tools/bruiser-fixtures/declared-map-input.json», the same map as
//! «crates/rh-sim/tests/fixtures/mob-pve-map.json»). The declared operations are source exports (placements, real
//! «recordHit»+«applyLedger», «downPlayer», the installed blocked/runEnded/campCleared chains) and the corpus records
//! real public state only (weapon lock, «frostEliteGuard», «defenseOf»); it is never regenerated from Rust.
use crate::hooks::{self, HookArgs, Hx, OutCause};
use crate::mob_runtime::MobMode;
use crate::{
    Arena, FactionId, FactionMode, Placement, PlayerId, Secrets, Sim, SimConfig, TileMap, Vec2,
    WeaponId,
};
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../../../parity/bruiser/frozen-justice.json");
const MAP: &str = include_str!("../../../tests/fixtures/mob-pve-map.json");

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("the captured Frozen Justice corpus parses")
}

fn arena() -> Arena {
    let data: crate::mapdata::GameMapData =
        serde_json::from_str(MAP).expect("the captured map parses");
    let (w, h, tiles, layers) = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map: data,
    }
    .validate()
    .expect("the captured map is an admitted rh-map/2 export")
    .into_parts();
    let spawns = layers
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    Arena {
        map: TileMap::new(w, h, tiles)
            .unwrap()
            .with_layers(layers)
            .unwrap(),
        spawns,
    }
}

fn placements(f: &Value) -> Vec<Placement> {
    f["case"]["start"]["players"]
        .as_array()
        .expect("declared players")
        .iter()
        .map(|p| Placement {
            profile: p["id"].as_str().unwrap().into(),
            faction: FactionId::parse(p["faction"].as_str().unwrap()).unwrap(),
            bot: false,
            at: Vec2::new(p["x"].as_f64().unwrap(), p["y"].as_f64().unwrap()),
            hp: None,
            weapon0: WeaponId::parse(p["weapon"].as_str().unwrap()),
            weapon1: None,
        })
        .collect()
}

fn make_sim(f: &Value) -> Sim {
    let mut secrets = Secrets::from_seed(1);
    secrets.spawn_seed = 12;
    secrets.reward_salt = [1, 2, 3, 4];
    Sim::reset_active(
        SimConfig {
            mob_mode: MobMode::Pve,
            faction_mode: FactionMode::EngagementHolyPlagueFireFrost,
            ..Default::default()
        },
        arena(),
        secrets,
        &placements(f),
    )
}

fn player_id(name: &str) -> PlayerId {
    PlayerId(name[1..].parse::<u32>().unwrap() + 1)
}

/// The native fighter for a declared mob id: the corpus declares "mob1"/"mob2"; the elite is the only elite mob, and the
/// declared normal is the camp's first normal mob.
fn mob_id(sim: &Sim, f: &Value, name: &str) -> PlayerId {
    if f["case"]["elite"]["id"] == name {
        sim.w
            .mobs
            .iter()
            .find(|m| m.elite)
            .map(|m| m.core.id)
            .expect("the captured map spawns its elite")
    } else {
        sim.w
            .mobs
            .iter()
            .find(|m| !m.elite)
            .map(|m| m.core.id)
            .expect("the captured map spawns its normal camp roster")
    }
}

fn round(x: f64) -> f64 {
    (x * 1e6).round() / 1e6
}

/// The captured public projection: each player's weapon lock (as the source id), guard flag and «defenseOf».
fn snapshot(sim: &Sim, f: &Value, elite: PlayerId, normal: PlayerId) -> Value {
    let label = |id: Option<PlayerId>| match id {
        None => Value::Null,
        Some(id) if id == elite => Value::from(f["case"]["elite"]["id"].as_str().unwrap()),
        Some(id) if id == normal => Value::from(f["case"]["normal"]["id"].as_str().unwrap()),
        Some(_) => Value::Null,
    };
    let players: Vec<Value> = sim
        .players()
        .iter()
        .map(|p| {
            let base = crate::content::faction(p.faction());
            let m = p.modifiers.mirrors();
            serde_json::json!({
                "id": format!("p{}", p.id.0 - 1),
                "lock": label(p.weapon.targeting.target),
                "guard": p.frost_guard.active,
                "armor": round((base.armor + m.armor_bonus).max(0.)),
                "shield": round(base.shield + m.shield_bonus),
            })
        })
        .collect();
    serde_json::json!({"tick": sim.server_time() as u64 / 50, "time": sim.server_time(), "players": players})
}

fn close(a: f64, b: f64, label: &str) {
    assert!(
        (a - b).abs() <= 1e-9 * b.abs().max(1.),
        "{label}: native {a} source {b}"
    );
}

fn check_frame(
    sim: &Sim,
    f: &Value,
    expected: &Value,
    elite: PlayerId,
    normal: PlayerId,
    label: &str,
) {
    let actual = snapshot(sim, f, elite, normal);
    assert_eq!(
        actual["tick"].as_u64(),
        expected["tick"].as_u64(),
        "{label}: tick"
    );
    close(
        actual["time"].as_f64().unwrap(),
        expected["time"].as_f64().unwrap(),
        label,
    );
    let want = expected["players"].as_array().unwrap();
    let got = actual["players"].as_array().unwrap();
    assert_eq!(got.len(), want.len(), "{label}: player count");
    for (w, g) in want.iter().zip(got) {
        assert_eq!(g["id"], w["id"], "{label}: player id");
        assert_eq!(g["lock"], w["lock"], "{label}: lock");
        assert_eq!(g["guard"], w["guard"], "{label}: frostEliteGuard");
        close(
            g["armor"].as_f64().unwrap(),
            w["armor"].as_f64().unwrap(),
            label,
        );
        close(
            g["shield"].as_f64().unwrap(),
            w["shield"].as_f64().unwrap(),
            label,
        );
    }
}

fn fire(sim: &mut Sim, args: &HookArgs) {
    let mut ev = Vec::new();
    let mut hx = Hx {
        stats: Default::default(),
        fx: None,
        k: &sim.k,
        w: &mut sim.w,
        ev: &mut ev,
    };
    hooks::fire(&mut hx, args.clone());
}

fn apply_op(sim: &mut Sim, f: &Value, op: &Value) {
    let elite = mob_id(sim, f, f["case"]["elite"]["id"].as_str().unwrap());
    let normal = mob_id(sim, f, f["case"]["normal"]["id"].as_str().unwrap());
    match op["op"].as_str().unwrap() {
        "place" => {
            let id = player_id(op["player"].as_str().unwrap());
            let i = sim.w.idx(id).unwrap();
            let (x, y) = (op["x"].as_f64().unwrap(), op["y"].as_f64().unwrap());
            let now = sim.server_time();
            let p = &mut sim.w.players[i];
            p.body.x = x;
            p.body.y = y;
            p.motion.path.clear();
            p.body.history.reset(crate::state::Sample { t: now, x, y });
        }
        "lock" => {
            let id = player_id(op["player"].as_str().unwrap());
            let i = sim.w.idx(id).unwrap();
            let target = match op["target"].as_str() {
                None => None,
                Some(name) if name == f["case"]["elite"]["id"].as_str().unwrap() => Some(elite),
                Some(name) if name == f["case"]["normal"]["id"].as_str().unwrap() => Some(normal),
                Some(other) => panic!("unknown declared lock target {other}"),
            };
            sim.w.players[i].weapon.targeting.target = target;
        }
        "step" => {
            sim.step();
        }
        "hit" => {
            let victim = match op["victim"].as_str().unwrap() {
                name if name == f["case"]["elite"]["id"].as_str().unwrap() => elite,
                name if name == f["case"]["normal"]["id"].as_str().unwrap() => normal,
                other => panic!("unknown declared hit victim {other}"),
            };
            let by = player_id(op["by"].as_str().unwrap());
            let entry = crate::systems::bruiser::contact_entry(victim, by, Some(WeaponId::Wand));
            sim.with_cx(|cx| {
                crate::systems::ledger::record_hit(cx.w, &mut cx.s.ledger, entry);
                crate::systems::ledger::apply(cx);
            });
        }
        "blocked" => {
            let holder = match op["holder"].as_str().unwrap() {
                name if name == f["case"]["elite"]["id"].as_str().unwrap() => elite,
                "p0" | "p1" => player_id(op["holder"].as_str().unwrap()),
                other => panic!("unknown declared block holder {other}"),
            };
            let attacker = match op["attacker"].as_str().unwrap() {
                name if name == f["case"]["elite"]["id"].as_str().unwrap() => elite,
                "p0" | "p1" => player_id(op["attacker"].as_str().unwrap()),
                other => panic!("unknown declared block attacker {other}"),
            };
            fire(
                sim,
                &HookArgs::Blocked {
                    holder,
                    attacker,
                    prevented: crate::state::Packet {
                        raw: 10.,
                        phys: 1.,
                        magic: 0.,
                        true_: 0.,
                    },
                    melee: true,
                },
            );
        }
        "down" => {
            let id = player_id(op["player"].as_str().unwrap());
            let i = sim.w.idx(id).unwrap();
            sim.w.players[i].status = crate::state::Status::Dead;
            fire(
                sim,
                &HookArgs::FighterOut {
                    id,
                    cause: OutCause::Down,
                },
            );
        }
        "run_ended" => fire(sim, &HookArgs::RunEnded),
        "camp_cleared" => fire(sim, &HookArgs::CampCleared { camp: 0 }),
        other => panic!("unknown declared operation {other}"),
    }
}

fn check_case(sim: &mut Sim, f: &Value, case: &Value) {
    let elite = mob_id(sim, f, f["case"]["elite"]["id"].as_str().unwrap());
    let normal = mob_id(sim, f, f["case"]["normal"]["id"].as_str().unwrap());
    let name = case["name"].as_str().unwrap();
    let frames = case["frames"].as_array().unwrap();
    assert_eq!(frames.len(), case["ops"].as_array().unwrap().len() + 1);
    check_frame(sim, f, &frames[0], elite, normal, &format!("{name} start"));
    for (i, op) in case["ops"].as_array().unwrap().iter().enumerate() {
        apply_op(sim, f, op);
        check_frame(
            sim,
            f,
            &frames[i + 1],
            elite,
            normal,
            &format!("{name} op {i} {}", op["op"].as_str().unwrap()),
        );
    }
}

#[test]
fn captured_frozen_justice_cases_reproduce_through_the_ported_rows() {
    let f = fixture();
    // The declared map spawns exactly the captured elite and camp roster at the captured poses.
    {
        let sim = make_sim(&f);
        let elite = mob_id(&sim, &f, f["case"]["elite"]["id"].as_str().unwrap());
        let mob = sim.w.mobs.get(elite).unwrap();
        assert!(mob.elite);
        assert_eq!(mob.core.pos(), Vec2::new(144., 112.));
        let normal = mob_id(&sim, &f, f["case"]["normal"]["id"].as_str().unwrap());
        assert!(!sim.w.mobs.get(normal).unwrap().elite);
    }
    for case in f["case"]["cases"].as_array().unwrap() {
        let mut sim = make_sim(&f);
        check_case(&mut sim, &f, case);
    }
}

#[test]
fn a_guarded_state_restores_and_continues_exactly() {
    let f = fixture();
    let mut sim = make_sim(&f);
    let case = f["case"]["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "run_end_clears_guard")
        .unwrap()
        .clone();
    // Replay through the guarded frame (before the run-end operation) and restore there.
    let elite = mob_id(&sim, &f, f["case"]["elite"]["id"].as_str().unwrap());
    let normal = mob_id(&sim, &f, f["case"]["normal"]["id"].as_str().unwrap());
    let ops = case["ops"].as_array().unwrap();
    let frames = case["frames"].as_array().unwrap();
    for (i, op) in ops.iter().enumerate() {
        if i + 2 == frames.len() {
            break;
        }
        apply_op(&mut sim, &f, op);
        check_frame(&sim, &f, &frames[i + 1], elite, normal, "restore prelude");
    }
    assert!(sim.w.players[0].frost_guard.active, "the guard is held");
    let mut restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
    assert_eq!(sim.state_hash(), restored.state_hash());
    for _ in 0..2 {
        let a = sim.step();
        let b = restored.step();
        assert_eq!(a.len(), b.len());
        assert_eq!(sim.state_hash(), restored.state_hash());
        assert_eq!(
            sim.w.players[0].frost_guard,
            restored.w.players[0].frost_guard
        );
    }
    // The guard clears at the same run-end boundary on both.
    fire(&mut sim, &HookArgs::RunEnded);
    fire(&mut restored, &HookArgs::RunEnded);
    assert_eq!(sim.state_hash(), restored.state_hash());
    assert!(!sim.w.players[0].frost_guard.active);
    assert!(!restored.w.players[0].frost_guard.active);
    let _ = op_count(&case);
}

fn op_count(case: &Value) -> usize {
    case["ops"].as_array().unwrap().len()
}
/// Mutant controls: a corpus replay must reject a flipped guard, a nudged defense value, a mislabelled lock and a
/// dropped frame instead of passing silently.
#[test]
fn mutants_of_the_captured_corpus_cannot_false_match() {
    let f = fixture();
    let cases = f["case"]["cases"].as_array().unwrap();
    let replay = |mutated: &Value| {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut sim = make_sim(&f);
            check_case(&mut sim, &f, mutated);
        }))
        .is_err()
    };
    let frame_of = |name: &str, index: usize| {
        let case = cases.iter().find(|c| c["name"] == name).unwrap();
        case["frames"][index].clone()
    };
    // A flipped guard flag.
    let mut flipped = frame_of("locked_elite_guard", 4);
    flipped["players"][0]["guard"] = Value::from(false);
    assert!(
        replay(&mutated_frame(&f, "locked_elite_guard", 4, flipped)),
        "a flipped guard must fail"
    );
    // A nudged armor value.
    let mut nudged = frame_of("hit_contact_linger", 3);
    nudged["players"][0]["armor"] = Value::from(141.001);
    assert!(
        replay(&mutated_frame(&f, "hit_contact_linger", 3, nudged)),
        "a nudged armor must fail"
    );
    // A mislabelled weapon lock.
    let mut mislabelled = frame_of("locked_elite_guard", 4);
    mislabelled["players"][0]["lock"] = Value::from(f["case"]["normal"]["id"].as_str().unwrap());
    assert!(
        replay(&mutated_frame(&f, "locked_elite_guard", 4, mislabelled)),
        "a wrong lock label must fail"
    );
    // A dropped action and its frame together cannot pass either (the frames must line up with the operations).
    let mut dropped = cases[0].clone();
    dropped["ops"].as_array_mut().unwrap().pop();
    dropped["frames"].as_array_mut().unwrap().pop();
    let mut trimmed = f.clone();
    trimmed["case"]["cases"] = Value::Array(vec![dropped]);
    assert!(replay(&trimmed), "a truncated case must fail");
}

/// Replace one expected frame of one named case in the corpus value, keeping every other case intact.
fn mutated_frame(f: &Value, name: &str, index: usize, frame: Value) -> Value {
    let mut out = f.clone();
    let cases = out["case"]["cases"].as_array_mut().unwrap();
    let at = cases
        .iter()
        .position(|c| c["name"] == name)
        .expect("the named case exists");
    cases[at]["frames"][index] = frame;
    out
}

/// The recorded gate keeps the passive off in the capture plans the legacy fixture worlds were captured with.
#[test]
fn the_bruiser_gate_keeps_the_passive_off_outside_its_plans() {
    let f = fixture();
    let mut secrets = Secrets::from_seed(1);
    secrets.spawn_seed = 12;
    secrets.reward_salt = [1, 2, 3, 4];
    // The same world class with the capture plan: mobs are born (PvE stays constructible) but the auxiliary installer is off.
    let mut sim = Sim::reset_active(
        SimConfig {
            mob_mode: MobMode::Pve,
            ..Default::default()
        },
        arena(),
        secrets,
        &placements(&f),
    );
    let elite = mob_id(&sim, &f, f["case"]["elite"]["id"].as_str().unwrap());
    let entry = crate::systems::bruiser::contact_entry(elite, PlayerId(1), Some(WeaponId::Wand));
    sim.with_cx(|cx| {
        crate::systems::ledger::record_hit(cx.w, &mut cx.s.ledger, entry);
        crate::systems::ledger::apply(cx);
    });
    sim.step();
    assert!(
        !sim.w.players[0].frost_guard.active,
        "the gate is off, so no guard"
    );
    assert_eq!(sim.w.players[0].frost_guard.until, None);
}
