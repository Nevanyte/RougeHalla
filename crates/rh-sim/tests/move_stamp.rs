//! Issue-time stamped orders (`RawCommand::MoveAt` / `AttackMoveAt`, protocol 15; docs/DEVIATIONS.md): an order stamped
//! with the time its client issued it starts a walker that stood idle through the previous tick up to one tick earlier,
//! by walking the credited time with the ordinary walk along the ordinary path. Unstamped orders, and stamped orders that
//! earn no credit, are the legacy behaviour bit for bit.

use rh_sim::arenas::practice_arena;
use rh_sim::constants::TICK_MS;
use rh_sim::replay::{apply_input, run_replay, Recorder, ReplayInput, ReplayStart};
use rh_sim::{
    validate, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, Vec2, WeaponId,
};

fn at(n: u32, faction: FactionId, x: f64, y: f64, w: Option<WeaponId>) -> Placement {
    Placement {
        profile: format!("p{n}"),
        faction,
        bot: false,
        at: Vec2::new(x, y),
        hp: None,
        weapon0: w,
        weapon1: None,
    }
}

/// The live server's switch: the credit is part of lag fairness (off in parity, headless and recordings).
fn config() -> SimConfig {
    SimConfig {
        quests: false,
        lag_fairness: true,
        ..Default::default()
    }
}

fn order(s: &mut Sim, id: u32, raw: RawCommand) {
    s.submit(PlayerId(id), validate(raw).unwrap()).unwrap();
}

fn pos(s: &Sim, id: u32) -> Vec2 {
    s.player(PlayerId(id)).unwrap().pos()
}

/// One idle player at (300, 300), stepped long enough to have stood still through a whole tick.
fn idle() -> Sim {
    let ps = [at(1, FactionId::Holy, 300., 300., None)];
    let mut s = Sim::reset_active(config(), practice_arena(), Secrets::from_seed(3), &ps);
    for _ in 0..3 {
        s.step();
    }
    s
}

/// The stamp a client sends when it issued the order `ago` ms before the tick's walk begins (the last step's time).
fn issued(s: &Sim, ago: f64) -> f64 {
    s.server_time() - ago
}

fn walked_one_tick(stamp: Option<f64>) -> f64 {
    let mut s = idle();
    let from = pos(&s, 1);
    let (x, y) = (700., 300.);
    match stamp {
        None => order(&mut s, 1, RawCommand::Move { x, y, seq: None }),
        Some(t) => order(&mut s, 1, RawCommand::MoveAt { x, y, seq: None, t }),
    }
    s.step();
    let to = pos(&s, 1);
    (to.x - from.x).hypot(to.y - from.y)
}

/// A match of three players walking, stopping and attack-moving, each order either unstamped or carrying `stamp(s)`.
fn scenario(stamp: impl Fn(&Sim) -> Option<f64>) -> Sim {
    scenario_with(config(), stamp)
}

fn scenario_with(config: SimConfig, stamp: impl Fn(&Sim) -> Option<f64>) -> Sim {
    let ps = [
        at(1, FactionId::Holy, 300., 300., Some(WeaponId::Bow)),
        at(2, FactionId::Frost, 380., 330., Some(WeaponId::Wand)),
        at(3, FactionId::Fire, 450., 300., Some(WeaponId::Sword)),
    ];
    let mut s = Sim::reset_active(config, practice_arena(), Secrets::from_seed(9), &ps);
    for k in 0..240u32 {
        for i in 1..=3u32 {
            let x = 250. + ((k * 37 + i * 61) % 400) as f64;
            let y = 250. + ((k * 53 + i * 29) % 180) as f64;
            let t = stamp(&s);
            let raw = match ((k + i) % 11, t) {
                (0, None) => RawCommand::Move { x, y, seq: None },
                (0, Some(t)) => RawCommand::MoveAt { x, y, seq: None, t },
                (4, None) => RawCommand::AttackMove { x, y, seq: Some(4) },
                (4, Some(t)) => RawCommand::AttackMoveAt {
                    x,
                    y,
                    seq: Some(4),
                    t,
                },
                (7, _) => RawCommand::Stop { seq: None },
                _ => continue,
            };
            order(&mut s, i, raw);
        }
        s.step();
    }
    s
}

#[test]
fn a_stamp_that_earns_no_credit_is_the_unstamped_match_bit_for_bit() {
    let plain = scenario(|_| None);
    // Issued at or after the tick's walk began: no credit.
    let late = scenario(|s| Some(s.server_time() + TICK_MS));
    let at_start = scenario(|s| Some(s.server_time()));
    assert_eq!(late.state_hash(), plain.state_hash());
    assert_eq!(at_start.state_hash(), plain.state_hash());
    // A non-finite stamp validates as the plain order.
    assert_eq!(
        validate(RawCommand::MoveAt {
            x: 1.,
            y: 2.,
            seq: Some(1),
            t: f64::NAN
        }),
        validate(RawCommand::Move {
            x: 1.,
            y: 2.,
            seq: Some(1)
        })
    );
    assert_eq!(
        validate(RawCommand::AttackMoveAt {
            x: 1.,
            y: 2.,
            seq: None,
            t: f64::INFINITY
        }),
        validate(RawCommand::AttackMove {
            x: 1.,
            y: 2.,
            seq: None
        })
    );
}

#[test]
fn without_lag_fairness_every_stamp_is_the_unstamped_match_bit_for_bit() {
    let legacy = SimConfig {
        lag_fairness: false,
        ..config()
    };
    let plain = scenario_with(legacy.clone(), |_| None);
    for ago in [TICK_MS, 20., 1e6] {
        let stamped = scenario_with(legacy.clone(), |s| Some(s.server_time() - ago));
        assert_eq!(stamped.state_hash(), plain.state_hash(), "stamp {ago} ms old");
    }
    // The same stamps do earn credit with the flag on, so the scenario exercises it.
    let on = scenario(|s| Some(s.server_time() - TICK_MS));
    assert_ne!(on.state_hash(), scenario(|_| None).state_hash());
}

#[test]
fn an_idle_walker_walks_the_credited_time_as_well() {
    let tick = walked_one_tick(None);
    assert!(tick > 0.);
    assert_eq!(
        walked_one_tick(Some(f64::MAX)),
        tick,
        "a future stamp earns nothing"
    );
    for (s, credit) in [(0., 0.), (12.5, 12.5), (30., 30.), (49., 49.)] {
        let s = issued(&idle(), s);
        let d = walked_one_tick(Some(s));
        let want = tick * (TICK_MS + credit) / TICK_MS;
        assert!(
            (d - want).abs() < 1e-9,
            "credit {credit}: walked {d}, want {want}"
        );
    }
}

#[test]
fn a_forged_stamp_buys_at_most_one_tick() {
    let tick = walked_one_tick(None);
    for ago in [TICK_MS, 51., 300., 1e6, 1e300] {
        let d = walked_one_tick(Some(issued(&idle(), ago)));
        assert!(
            (d - 2. * tick).abs() < 1e-9,
            "stamp {ago} ms old walked {d}"
        );
    }
}

#[test]
fn a_walker_that_moved_last_tick_earns_nothing() {
    // A fighter already walking would count the credited span twice (it walked its old path then).
    let mut s = idle();
    order(
        &mut s,
        1,
        RawCommand::Move {
            x: 700.,
            y: 300.,
            seq: None,
        },
    );
    s.step();
    let mut plain = s.clone();
    let t = issued(&s, 1e6);
    order(
        &mut s,
        1,
        RawCommand::MoveAt {
            x: 300.,
            y: 700.,
            seq: None,
            t,
        },
    );
    order(
        &mut plain,
        1,
        RawCommand::Move {
            x: 300.,
            y: 700.,
            seq: None,
        },
    );
    s.step();
    plain.step();
    assert_eq!(s.state_hash(), plain.state_hash());
}

#[test]
fn stop_and_go_with_forged_stamps_never_outruns_walking() {
    let tick = walked_one_tick(None);
    let mut s = idle();
    let from = pos(&s, 1);
    let ticks = 40;
    for k in 0..ticks {
        let t = issued(&s, 1e6);
        if k % 2 == 0 {
            order(
                &mut s,
                1,
                RawCommand::MoveAt {
                    x: 1500.,
                    y: 300.,
                    seq: None,
                    t,
                },
            );
        } else {
            order(&mut s, 1, RawCommand::Stop { seq: None });
        }
        s.step();
    }
    let to = pos(&s, 1);
    let d = (to.x - from.x).hypot(to.y - from.y);
    // Walking without pause for the same time (plus the one idle tick that came before) covers at least as much.
    assert!(
        d <= tick * (ticks + 1) as f64 + 1e-9,
        "walked {d} in {ticks} ticks"
    );
    assert!(
        d > tick * (ticks / 2) as f64,
        "the credit was earned at all"
    );
}

#[test]
fn the_credit_follows_the_planned_path_like_ordinary_walking() {
    // One credited tick reaches exactly where two ordinary ticks along the same path do: the same routine on the same
    // collision-planned path, so it cannot cut a corner or enter a wall that ordinary walking would not.
    let goals = [(1500., 1200.), (100., 1400.), (2000., 300.), (300., 2400.)];
    for (x, y) in goals {
        let mut credited = idle();
        let mut plain = credited.clone();
        let t = issued(&credited, TICK_MS);
        order(&mut credited, 1, RawCommand::MoveAt { x, y, seq: None, t });
        order(&mut plain, 1, RawCommand::Move { x, y, seq: None });
        credited.step();
        plain.step();
        plain.step();
        let (a, b) = (pos(&credited, 1), pos(&plain, 1));
        assert!(
            (a.x - b.x).abs() < 1e-9 && (a.y - b.y).abs() < 1e-9,
            "goal ({x}, {y}): credited {a:?}, plain {b:?}"
        );
        let map = credited.collision_map();
        let tile = rh_sim::constants::TILE;
        assert!(!map.is_solid((a.x / tile).floor() as i64, (a.y / tile).floor() as i64));
    }
}

#[test]
fn a_stamped_match_replays_and_restores_bit_for_bit() {
    let ps = [
        at(1, FactionId::Holy, 300., 300., Some(WeaponId::Bow)),
        at(2, FactionId::Frost, 380., 330., None),
    ];
    let cfg = config();
    let mut sim = Sim::reset_active(cfg.clone(), practice_arena(), Secrets::from_seed(4), &ps);
    let mut rec = Recorder::new(
        &sim,
        cfg,
        ReplayStart::Active {
            placements: ps.into(),
        },
    );
    let mut credited = false;
    for k in 0..120u32 {
        for i in 1..=2u32 {
            let x = 250. + ((k * 37 + i * 61) % 500) as f64;
            let y = 250. + ((k * 53 + i * 29) % 300) as f64;
            let t = issued(&sim, [0., 20., 49., 400.][((k + i) % 4) as usize]);
            let raw = match (k + i) % 5 {
                0 => RawCommand::MoveAt { x, y, seq: None, t },
                2 => RawCommand::AttackMoveAt {
                    x,
                    y,
                    seq: Some(2),
                    t,
                },
                3 => RawCommand::Stop { seq: None },
                _ => continue,
            };
            let input = ReplayInput::Command {
                player: PlayerId(i),
                cmd: validate(raw).unwrap(),
            };
            apply_input(&mut sim, &input);
            rec.record(input);
        }
        if k == 60 {
            // A checkpoint taken with stamped orders queued restores and steps identically.
            let json = serde_json::to_value(&sim).unwrap();
            let mut back = Sim::restore(json).unwrap();
            let mut ahead = sim.clone();
            ahead.step();
            back.step();
            assert_eq!(back.state_hash(), ahead.state_hash());
        }
        let before = pos(&sim, 1);
        sim.step();
        rec.stepped(&sim);
        let after = pos(&sim, 1);
        credited |= (after.x - before.x).hypot(after.y - before.y) > 1.5 * walked_one_tick(None);
    }
    assert!(credited, "the scenario exercises a credited walk");
    let (again, _) = run_replay(&rec.replay).expect("the stamped match replays");
    assert_eq!(again.state_hash(), sim.state_hash());
}
