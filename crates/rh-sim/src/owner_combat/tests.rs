//! Numeric transforms and the bounded ordinary native prefix. Hidden/invalid-state tests are diagnostics.
use super::*;
use crate::{
    validate, Arena, ContainerKind, FactionId, ItemObserver, Observation, Placement, PublicCommand,
    RawCommand, Secrets, Sim, SimConfig, TileMap, Vec2, WeaponId,
};
use serde_json::Value;
fn boundaries() -> Value {
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/policy/owner-combat/boundaries.json"
    )))
    .unwrap()
}
fn producers() -> Value {
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/policy/owner-combat/producer.json"
    )))
    .unwrap()
}
fn number(v: &Value) -> f64 {
    v.as_f64().unwrap_or_else(|| match v.as_str().unwrap() {
        "NaN" => f64::NAN,
        "+Infinity" => f64::INFINITY,
        "-Infinity" => f64::NEG_INFINITY,
        "-0" => -0.,
        other => panic!("unexpected numeric encoding {other}"),
    })
}
fn simple_sim() -> Sim {
    Sim::reset_active(
        SimConfig::default(),
        crate::arenas::practice_arena(),
        Secrets::from_seed(7),
        &[
            Placement {
                profile: "owner".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(300., 272.),
                hp: None,
                weapon0: Some(WeaponId::Wand),
                weapon1: None,
            },
            Placement {
                profile: "target".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(420., 272.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ],
    )
}

#[test]
fn source_u32_matches_all_26_schema_and_bot_boundary_probes() {
    let b = boundaries();
    let rows = b["playerTimerSchema"]["probes"].as_array().unwrap();
    assert_eq!(rows.len(), 26);
    for row in rows {
        let actual = source_to_u32(number(&row["input"]));
        assert_eq!(u64::from(actual), row["wire"]["decoded"].as_u64().unwrap());
        assert_eq!(u64::from(actual), row["bot"]["value"].as_u64().unwrap());
    }
}

#[test]
fn source_u32_matches_every_recorded_producer_clock_without_rebuilding_it() {
    let p = producers();
    let mut frames = 0;
    for case in p["cases"].as_array().unwrap() {
        for frame in case["frames"].as_array().unwrap() {
            for key in ["drawStartedAt", "readyAt"] {
                assert_eq!(
                    u64::from(source_to_u32(number(&frame["owner"][key]))),
                    frame["ownerDecoded"][key].as_u64().unwrap(),
                    "case {} step {} {key}",
                    case["id"],
                    frame["step"]
                );
            }
            frames += 1;
        }
    }
    assert_eq!(frames, 808);
}

#[test]
fn mirror_validation_preserves_source_encoded_f64_bits_without_u16_or_twenty_x_cap() {
    let b = boundaries();
    for row in b["mirrorSchema"]["helper"].as_array().unwrap() {
        let value = number(&row["encodeMult"]);
        let got = checked_mirrors([value; 3]).unwrap();
        assert!(got.iter().all(|v| v.to_bits() == value.to_bits()));
    }
    for row in b["mirrorSchema"]["rawWireRoundtrip"].as_array().unwrap() {
        let value = number(&row["inputWire"]);
        if value.is_finite() && value >= stat_fold::encode_mult(0.) {
            let got = checked_mirrors([value; 3]).unwrap();
            assert!(got.iter().all(|v| v.to_bits() == value.to_bits()));
        } else {
            assert_eq!(checked_mirrors([value; 3]), Err(Error::InvalidMirror));
        }
    }
    for bad in [0., 49., 50.5, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        for field in 0..3 {
            let mut values = [1000.; 3];
            values[field] = bad;
            assert_eq!(checked_mirrors(values), Err(Error::InvalidMirror));
        }
    }
}

#[test]
fn native_nonfinite_clocks_refuse_before_source_normalization_and_cache_errors_never_default() {
    let s = simple_sim();
    let mut owner = s.player(PlayerId(1)).unwrap().clone();
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        owner.weapon.draw_started_at = bad;
        assert_eq!(project(&owner, &[]), Err(Error::NonFiniteDrawClock));
        owner.weapon.draw_started_at = 0.;
        owner.weapon.ready_at = bad;
        assert_eq!(project(&owner, &[]), Err(Error::NonFiniteReadyClock));
        owner.weapon.ready_at = 0.;
    }
    owner.weapon.draw_started_at = 4_294_967_570.75;
    owner.weapon.ready_at = 4_294_968_425.450854;
    let got = project(&owner, &[]).unwrap();
    assert_eq!((got.draw_started_at, got.ready_at), (274, 1129));
    // Projection-only cache diagnostic, not a gameplay grant or a claimed reachable mirror producer.
    owner.modifiers.test_set_attack_wire(1e303);
    assert_eq!(
        project(&owner, &[]).unwrap().as_milli.to_bits(),
        1e303_f64.to_bits()
    );
    owner.modifiers.test_set_attack_wire(f64::INFINITY);
    assert_eq!(project(&owner, &[]), Err(Error::InvalidMirror));
}

#[test]
fn projection_only_hidden_identity_pairs_are_equal_and_never_retained() {
    let s = simple_sim();
    let before = s.state_hash();
    let mut a = s.player(PlayerId(1)).unwrap().clone();
    let mut b = a.clone();
    a.weapon.targeting.target = Some(PlayerId(2));
    b.weapon.targeting.target = Some(PlayerId(999));
    let ga = project(&a, &[PlayerId(3)]).unwrap();
    let gb = project(&b, &[PlayerId(3)]).unwrap();
    assert_eq!(ga, gb);
    assert_eq!(ga.lock, Lock::Held { target: None });
    assert_eq!(
        project(&a, &[PlayerId(2)]).unwrap().lock,
        Lock::Held {
            target: Some(PlayerId(2))
        }
    );
    assert_eq!(project(&a, &[]).unwrap().lock, Lock::Held { target: None });
    a.weapon.targeting.target = None;
    assert_eq!(project(&a, &[PlayerId(2)]).unwrap().lock, Lock::Clear);
    assert_eq!(s.state_hash(), before);
}

#[test]
#[ignore = "uses the existing global dhat allocator; run this exact test alone with --ignored --test-threads=1"]
fn projection_allocates_zero_for_visible_hidden_changed_identity_and_error_paths() {
    let s = simple_sim();
    let before_hash = s.state_hash();
    let mut a = s.player(PlayerId(1)).unwrap().clone();
    let mut b = a.clone();
    a.weapon.targeting.target = Some(PlayerId(2));
    b.weapon.targeting.target = Some(PlayerId(999));
    let mut invalid = a.clone();
    invalid.weapon.ready_at = f64::NAN;
    // The complete loop measures all process allocations, a conservative upper bound on this thread.
    // Fixture construction, profiler/TLS warmup and state hashing occur outside the measured interval.
    let _profiler = dhat::Profiler::builder().testing().build();
    let _ = dhat::HeapStats::get();
    let mut counts = [0; 3];
    for (i, membership) in [&[][..], &[PlayerId(3)][..], &[PlayerId(2)][..]]
        .iter()
        .enumerate()
    {
        let before = dhat::HeapStats::get().total_blocks;
        for _ in 0..10_000 {
            std::hint::black_box(project(std::hint::black_box(&a), membership)).unwrap();
            std::hint::black_box(project(std::hint::black_box(&b), membership)).unwrap();
            std::hint::black_box(project(std::hint::black_box(&invalid), membership)).unwrap_err();
        }
        counts[i] = dhat::HeapStats::get().total_blocks - before;
    }
    assert_eq!(counts, [0; 3]);
    assert_eq!(s.state_hash(), before_hash);
}

fn source_native(case: &Value) -> Sim {
    let mut tiles = vec![0; 40 * 20];
    for y in 0..20 {
        for x in 0..40 {
            if x == 0 || y == 0 || x == 39 || y == 19 || x == 17 && (1..=12).contains(&y) {
                tiles[y * 40 + x] = 1;
            }
        }
    }
    let arena = Arena {
        map: TileMap::new(40, 20, tiles).unwrap(),
        spawns: vec![],
    };
    let names = ["own", "tgt", "thr", "fou"];
    let factions = [
        FactionId::Fire,
        FactionId::Holy,
        FactionId::Frost,
        FactionId::Plague,
    ];
    let placements: Vec<_> = names
        .iter()
        .enumerate()
        .map(|(i, name)| {
            let p = &case["declaredSetup"]["placement"][name];
            Placement {
                profile: (*name).into(),
                faction: factions[i],
                bot: false,
                at: Vec2::new(number(&p[0]), number(&p[1])),
                hp: None,
                weapon0: None,
                weapon1: None,
            }
        })
        .collect();
    let mut s = Sim::reset_active(
        SimConfig {
            consumables: false,
            pvp_rules: false,
            ..SimConfig::default()
        },
        arena,
        Secrets::from_seed(7),
        &placements,
    );
    let weapon = WeaponId::parse(case["racks"][0]["def"].as_str().unwrap()).unwrap();
    s.seed_weapon_container(ContainerKind::Ground, placements[0].at, &[weapon])
        .unwrap();
    // reset_active already includes the same raid-start step at t=50 as createGameWorld.
    s
}

#[test]
fn ordinary_native_acquire_reclick_retarget_move_stop_and_draw_compare_the_source_prefix() {
    let p = producers();
    let mut compared = 0;
    for id in ["L01", "L02", "L03", "D01"] {
        let case = p["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == id)
            .unwrap();
        let mut s = source_native(case);
        let mut observer = ItemObserver::new(PlayerId(1));
        let mut obs = Observation::default();
        observer.observe_into(&s, &[], &mut obs, None).unwrap();
        for frame in case["frames"].as_array().unwrap() {
            let step = frame["step"].as_u64().unwrap();
            for action in case["actions"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|a| a["step"].as_u64() == Some(step))
            {
                let msg = &action["msg"];
                let command = match action["message"].as_str().unwrap() {
                    "pickup" => observer
                        .resolve(
                            &s,
                            PublicCommand::Pickup {
                                handle: obs.props[0].handle,
                            },
                        )
                        .unwrap(),
                    "target" => validate(RawCommand::Target {
                        id: match msg["id"].as_str().unwrap() {
                            "tgt" => PlayerId(2),
                            "thr" => PlayerId(3),
                            _ => unreachable!(),
                        },
                    })
                    .unwrap(),
                    "move" => validate(RawCommand::Move {
                        x: number(&msg["x"]),
                        y: number(&msg["y"]),
                        seq: Some(1),
                    })
                    .unwrap(),
                    "stop" => validate(RawCommand::Stop { seq: Some(1) }).unwrap(),
                    "attack" => validate(RawCommand::Attack {
                        a: number(&msg["a"]),
                        t: None,
                    })
                    .unwrap(),
                    "release" => validate(RawCommand::Release {
                        a: number(&msg["a"]),
                        t: None,
                    })
                    .unwrap(),
                    other => panic!("unexpected ordinary prefix command {other}"),
                };
                s.submit(PlayerId(1), command).unwrap();
            }
            s.step();
            observer.observe_into(&s, &[], &mut obs, None).unwrap();
            let entitled: Vec<_> = obs.visible.iter().map(|a| a.id).collect();
            let before = s.state_hash();
            let got = project(s.player(PlayerId(1)).unwrap(), &entitled).unwrap();
            assert_eq!(s.state_hash(), before);
            let expected = &frame["ownerDecoded"];
            let target = match expected["attackTarget"].as_str().unwrap() {
                "" => None,
                "tgt" => Some(PlayerId(2)),
                "thr" => Some(PlayerId(3)),
                other => panic!("unexpected target {other}"),
            };
            let lock = target.map_or(Lock::Clear, |id| Lock::Held { target: Some(id) });
            assert_eq!(got.lock, lock, "{id} step{step} lock");
            assert_eq!(
                u64::from(got.ready_at),
                expected["readyAt"].as_u64().unwrap(),
                "{id} step{step} ready"
            );
            assert_eq!(
                u64::from(got.draw_started_at),
                expected["drawStartedAt"].as_u64().unwrap(),
                "{id} step{step} draw"
            );
            assert_eq!(
                [got.as_milli, got.windup_milli, got.speed_milli],
                [
                    number(&expected["asMult"]),
                    number(&expected["windupMult"]),
                    number(&expected["speedMult"])
                ]
            );
            compared += 1;
        }
    }
    assert_eq!(compared, 136);
}
