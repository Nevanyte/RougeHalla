//! Lag fairness (`SimConfig::lag_fairness`, the lag-fairness rows of docs/DEVIATIONS.md): a swing starts where the
//! attacker stood, a shot catches up the shooter's lag beyond one tick against rewound bodies, and a unit-target cast is
//! ranged against the rewound target. Each is the identity at the one-tick baseline lag, bounded by `MAX_REWIND_MS`,
//! deterministic under replay, and off by default (legacy).

use rh_sim::abilities::{self, Slot};
use rh_sim::arenas::practice_arena;
use rh_sim::constants::{PLAYER_SPEED, TICK_MS};
use rh_sim::events::Event;
use rh_sim::replay::{apply_input, run_replay, Recorder, ReplayInput, ReplayStart};
use rh_sim::{
    validate, FactionId, Placement, PlayerId, ProjectileEnd, RawCommand, Secrets, Sim, SimConfig,
    Vec2, WeaponId,
};

fn config(fair: bool) -> SimConfig {
    SimConfig {
        quests: false,
        lag_fairness: fair,
        ..Default::default()
    }
}

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

fn order(s: &mut Sim, id: u32, raw: RawCommand) {
    s.submit(PlayerId(id), validate(raw).unwrap()).unwrap();
}

/// The `t` a client with view lag `lag` stamps on a command applied at the next step.
fn stamp(s: &Sim, lag: f64) -> Option<f64> {
    Some(s.server_time() + TICK_MS - lag)
}

/// The state hash `sim` would have with `lag_fairness` off: the same world under the legacy statics digest.
fn legacy_hash(sim: &Sim) -> u64 {
    let mut v = serde_json::to_value(sim).unwrap();
    v["statics"]["config"]["lag_fairness"] = serde_json::Value::Bool(false);
    Sim::restore(v).unwrap().state_hash()
}

/// A mixed match: bow, wand, sword and fists walking, swinging and shooting with no `t` or a one-tick `t`, and a Frost
/// Wish cast with each.
fn mixed(fair: bool, ticks: u32) -> (Sim, Vec<String>) {
    let ps = [
        at(1, FactionId::Holy, 300., 300., Some(WeaponId::Bow)),
        at(2, FactionId::Frost, 380., 330., Some(WeaponId::Wand)),
        at(3, FactionId::Fire, 450., 300., Some(WeaponId::Sword)),
        at(4, FactionId::Holy, 520., 340., None),
    ];
    let cfg = SimConfig {
        abilities: abilities::Mode::Full,
        wish_lock_ms: 0.,
        ..config(fair)
    };
    let mut s = Sim::reset_active(cfg, practice_arena(), Secrets::from_seed(9), &ps);
    let mut log = Vec::new();
    for k in 0..ticks {
        for i in 1..=4u32 {
            let a = k as f64 * 0.11 + i as f64;
            let t = if (k + i) % 2 == 0 {
                None
            } else {
                stamp(&s, TICK_MS)
            };
            if k % 9 == i {
                let x = 250. + ((k * 37 + i * 61) % 400) as f64;
                let y = 250. + ((k * 53 + i * 29) % 180) as f64;
                order(&mut s, i, RawCommand::Move { x, y, seq: None });
            }
            if k % 5 == i % 5 {
                order(&mut s, i, RawCommand::Attack { a, t });
            }
            if k % 5 == (i + 2) % 5 {
                order(&mut s, i, RawCommand::Release { a, t });
            }
        }
        if k % 40 == 30 {
            let t = if k % 80 == 30 {
                None
            } else {
                stamp(&s, TICK_MS)
            };
            order(
                &mut s,
                2,
                RawCommand::Cast {
                    slot: Slot::Wish,
                    x: 0.,
                    y: 0.,
                    id: Some(PlayerId(3)),
                    t,
                    seq: None,
                },
            );
        }
        log.push(format!("{:?}", s.step()));
    }
    (s, log)
}

#[test]
fn at_the_baseline_lag_it_is_the_legacy_match_bit_for_bit() {
    let (off, a) = mixed(false, 240);
    let (on, b) = mixed(true, 240);
    assert!(a.iter().any(|t| t.contains("ProjectileLaunched")));
    assert!(a.iter().any(|t| t.contains("Swing")));
    assert!(a.iter().any(|t| t.contains("Hit {")));
    assert!(a.iter().any(|t| t.contains("CastStarted")));
    for (k, (a, b)) in a.iter().zip(&b).enumerate() {
        assert_eq!(a, b, "events differ at tick {k}");
    }
    assert_eq!(legacy_hash(&on), off.state_hash());
    assert_ne!(
        on.state_hash(),
        off.state_hash(),
        "the switch is in the statics digest"
    );
}

const SHOOTER: Vec2 = Vec2 { x: 500., y: 420. };
const LANE_Y: f64 = 260.;

/// One bow shot at `aim` by p1 (view lag `lag`) at p2 running along the open lane from `x0`. Returns where the arrow hit
/// p2, if it did.
fn shot(fair: bool, lag: f64, x0: f64, aim: f64) -> Option<Vec2> {
    let ps = [
        at(
            1,
            FactionId::Holy,
            SHOOTER.x,
            SHOOTER.y,
            Some(WeaponId::Bow),
        ),
        at(2, FactionId::Holy, x0, LANE_Y, None),
    ];
    let mut s = Sim::reset_active(config(fair), practice_arena(), Secrets::from_seed(3), &ps);
    order(
        &mut s,
        2,
        RawCommand::Move {
            x: 1450.,
            y: LANE_Y,
            seq: None,
        },
    );
    for _ in 0..8 {
        s.step();
    }
    let t = stamp(&s, lag);
    order(&mut s, 1, RawCommand::Attack { a: aim, t });
    s.step();
    order(&mut s, 1, RawCommand::Release { a: aim, t: None });
    for _ in 0..30 {
        for e in s.step() {
            if let Event::ProjectileEnded { reason, at, .. } = e {
                return (reason == ProjectileEnd::Hit).then_some(at);
            }
        }
    }
    None
}

/// The window of aims that hit, scanned coarse then fine.
fn window(fair: bool, lag: f64, x0: f64) -> (f64, f64) {
    let coarse = (0..120)
        .map(|i| -2.9 + 0.02 * i as f64)
        .find(|&a| shot(fair, lag, x0, a).is_some())
        .expect("some aim hits");
    let hits: Vec<f64> = (-80..=80)
        .map(|i| coarse + 0.002 * i as f64)
        .filter(|&a| shot(fair, lag, x0, a).is_some())
        .collect();
    (hits[0], *hits.last().unwrap())
}

#[test]
fn a_shot_needs_no_ping_lead_at_100_and_200_ms() {
    let x0 = 300.;
    for lag in [100., 200.] {
        // What the shooter saw: the runner (lag - one tick) behind where the server has it, so the aim a one-tick
        // shooter would need against that track is the aim this shooter takes.
        let back = PLAYER_SPEED * (lag - TICK_MS) / 1000.;
        let (lo, hi) = window(false, TICK_MS, x0 - back);
        let c = (lo + hi) / 2.;
        let q = (hi - lo) / 4.;
        for aim in [c - q, c, c + q, c - 4. * q, c + 4. * q] {
            let seen = shot(false, TICK_MS, x0 - back, aim);
            let fair = shot(true, lag, x0, aim);
            assert_eq!(seen.is_some(), fair.is_some(), "lag {lag} aim {aim}");
            if let (Some(a), Some(b)) = (seen, fair) {
                assert!(
                    (a.x - b.x).abs() < 1e-6 && (a.y - b.y).abs() < 1e-6,
                    "{a:?} {b:?}"
                );
            }
        }
        assert!(shot(true, lag, x0, c).is_some());
        // Without it the same aim lands (lag - one tick) of runner travel behind: the shooter would have to lead.
        let (flo, fhi) = window(true, lag, x0);
        let (llo, lhi) = window(false, lag, x0);
        let fair_c = (flo + fhi) / 2.;
        let legacy_c = (llo + lhi) / 2.;
        assert!((fair_c - c).abs() < 0.01, "lag {lag}: {fair_c} vs seen {c}");
        assert!(
            (legacy_c - c).abs() > 0.02,
            "lag {lag}: legacy needs a lead"
        );
    }
    assert!(shot(false, 200., x0, {
        let back = PLAYER_SPEED * 0.15;
        let (lo, hi) = window(false, TICK_MS, x0 - back);
        (lo + hi) / 2.
    })
    .is_none());
}

#[test]
fn the_catch_up_is_capped_at_the_rewind_cap() {
    let (lo, hi) = window(true, 300., 300.);
    for aim in [lo, (lo + hi) / 2., hi, lo - 0.05, hi + 0.05] {
        assert_eq!(shot(true, 300., 300., aim), shot(true, 5000., 300., aim));
    }
    // The legacy fixtures' clamp at the baseline: a stamp from the future is the one-tick lag.
    for aim in [lo, hi] {
        assert_eq!(shot(true, 0., 300., aim), shot(false, 0., 300., aim));
    }
}

/// p1 (fists) walks toward a standing p2 and swings with view lag `lag` once 75 u separate them on the server.
fn chase_swing(fair: bool, lag: f64) -> bool {
    let ps = [
        at(1, FactionId::Holy, 300., 300., None),
        at(2, FactionId::Holy, 600., 300., None),
    ];
    let mut s = Sim::reset_active(config(fair), practice_arena(), Secrets::from_seed(5), &ps);
    order(
        &mut s,
        1,
        RawCommand::Move {
            x: 590.,
            y: 300.,
            seq: None,
        },
    );
    while s.player(PlayerId(1)).unwrap().pos().x < 600. - 75. {
        s.step();
    }
    let t = stamp(&s, lag);
    order(&mut s, 1, RawCommand::Attack { a: 0., t });
    let ev = s.step();
    ev.iter().any(|e| {
        matches!(
            e,
            Event::Hit {
                victim: PlayerId(2),
                by: Some(PlayerId(1)),
                ..
            }
        )
    })
}

#[test]
fn a_chase_swing_starts_where_the_attacker_stands() {
    assert!(chase_swing(false, TICK_MS));
    assert!(chase_swing(true, TICK_MS));
    for lag in [200., 300.] {
        assert!(
            !chase_swing(false, lag),
            "legacy rewinds the attacker {lag} ms back"
        );
        assert!(chase_swing(true, lag));
    }
}

/// p1 (Frost) casts Freeze at p2, who runs away and is just past range on the server when the cast is applied.
fn freeze_from_behind(fair: bool, lag: f64) -> bool {
    let ps = [
        at(1, FactionId::Frost, 120., 300., None),
        at(2, FactionId::Holy, 400., 300., None),
    ];
    let cfg = SimConfig {
        abilities: abilities::Mode::Full,
        wish_lock_ms: 0.,
        ..config(fair)
    };
    let mut s = Sim::reset_active(cfg, practice_arena(), Secrets::from_seed(6), &ps);
    order(
        &mut s,
        2,
        RawCommand::Move {
            x: 1400.,
            y: 300.,
            seq: None,
        },
    );
    // Range 450 plus the 32 u slack; the cast applies one step after the order.
    while s.player(PlayerId(2)).unwrap().pos().x + PLAYER_SPEED * TICK_MS / 1000. < 120. + 490. {
        s.step();
    }
    let t = stamp(&s, lag);
    order(
        &mut s,
        1,
        RawCommand::Cast {
            slot: Slot::Wish,
            x: 0.,
            y: 0.,
            id: Some(PlayerId(2)),
            t,
            seq: None,
        },
    );
    s.step().iter().any(|e| {
        matches!(
            e,
            Event::CastStarted {
                id: PlayerId(1),
                ..
            }
        )
    })
}

#[test]
fn a_unit_cast_is_ranged_against_the_rewound_target() {
    assert!(!freeze_from_behind(false, TICK_MS));
    assert!(!freeze_from_behind(true, TICK_MS));
    assert!(!freeze_from_behind(false, 200.));
    assert!(freeze_from_behind(true, 200.));
}

#[test]
fn a_lagged_match_replays_bit_for_bit() {
    let ps = [
        at(1, FactionId::Holy, 500., 420., Some(WeaponId::Bow)),
        at(2, FactionId::Frost, 300., 260., Some(WeaponId::Wand)),
        at(3, FactionId::Holy, 700., 300., Some(WeaponId::Sword)),
    ];
    let cfg = SimConfig {
        abilities: abilities::Mode::Full,
        wish_lock_ms: 0.,
        ..config(true)
    };
    let mut sim = Sim::reset_active(cfg.clone(), practice_arena(), Secrets::from_seed(8), &ps);
    let mut rec = Recorder::new(
        &sim,
        cfg,
        ReplayStart::Active {
            placements: ps.into(),
        },
    );
    let mut launched = 0;
    for k in 0..160u32 {
        let lag = [TICK_MS, 100., 200., 280.][(k % 4) as usize];
        let mut inputs = Vec::new();
        for i in 1..=3u32 {
            let a = k as f64 * 0.09 + i as f64 * 2.;
            if k % 7 == i {
                let x = 250. + ((k * 37 + i * 61) % 600) as f64;
                inputs.push((
                    i,
                    RawCommand::Move {
                        x,
                        y: 300.,
                        seq: None,
                    },
                ));
            }
            if k % 6 == i {
                inputs.push((
                    i,
                    RawCommand::Attack {
                        a,
                        t: stamp(&sim, lag),
                    },
                ));
            }
            if k % 6 == i + 2 {
                inputs.push((i, RawCommand::Release { a, t: None }));
            }
        }
        if k % 50 == 20 {
            inputs.push((
                2,
                RawCommand::Cast {
                    slot: Slot::Wish,
                    x: 0.,
                    y: 0.,
                    id: Some(PlayerId(3)),
                    t: stamp(&sim, lag),
                    seq: None,
                },
            ));
        }
        for (i, raw) in inputs {
            let input = ReplayInput::Command {
                player: PlayerId(i),
                cmd: validate(raw).unwrap(),
            };
            apply_input(&mut sim, &input);
            rec.record(input);
        }
        launched += sim
            .step()
            .iter()
            .filter(|e| matches!(e, Event::ProjectileLaunched(_)))
            .count();
        rec.stepped(&sim);
    }
    assert!(launched > 0);
    let (again, _) = run_replay(&rec.replay).expect("the lagged match replays");
    assert_eq!(again.state_hash(), sim.state_hash());
}

/// What became of the crossing arrow: whether a ball deleted it, whether it hit the victim, and the damage it dealt.
#[derive(Debug, PartialEq)]
struct Crossing {
    deleted: bool,
    hit: bool,
    damage: f64,
    /// Where the arrow ended.
    end: Option<Vec2>,
}

/// p1 (bow) shoots east along the open lane at the standing victim p3, while p2 (wand) shoots a ball north across the
/// lane. A shooter with view lag `lag` fires `(lag - one tick)` later on the server than a baseline shooter would, so
/// its back-dated shot is launched at the baseline shot's time: the same crossing, seen late.
fn crossing(arrow_lag: f64, ball_lag: f64, ball_y: f64, ball_at: u32) -> Crossing {
    let ps = [
        at(1, FactionId::Holy, 300., LANE_Y, Some(WeaponId::Bow)),
        at(2, FactionId::Frost, 380., ball_y, Some(WeaponId::Wand)),
        at(3, FactionId::Fire, 480., LANE_Y, None),
    ];
    let mut s = Sim::reset_active(config(true), practice_arena(), Secrets::from_seed(4), &ps);
    let late = |lag: f64| ((lag - TICK_MS) / TICK_MS).round() as u32;
    // (tick, shooter, aim, lag)
    let shots = [
        (
            ball_at + late(ball_lag),
            2,
            -std::f64::consts::FRAC_PI_2,
            ball_lag,
        ),
        (20 + late(arrow_lag), 1, 0., arrow_lag),
    ];
    let mut out = Crossing {
        deleted: false,
        hit: false,
        damage: 0.,
        end: None,
    };
    for k in 0..80u32 {
        for &(tick, id, a, lag) in &shots {
            if tick == k {
                let t = stamp(&s, lag);
                order(&mut s, id, RawCommand::Attack { a, t });
            } else if tick + 1 == k {
                order(&mut s, id, RawCommand::Release { a, t: None });
            }
        }
        for e in s.step() {
            match e {
                Event::ProjectileEnded {
                    launch, reason, at, ..
                } if launch.owner == PlayerId(1) => {
                    out.deleted |= reason == ProjectileEnd::Deleted;
                    out.end = Some(at);
                }
                Event::Hit {
                    victim: PlayerId(3),
                    by: Some(PlayerId(1)),
                    amount,
                    ..
                } => {
                    out.hit = true;
                    out.damage += amount;
                }
                _ => (),
            }
        }
    }
    out
}

/// A ball deletes the arrow it crosses before the arrow can reach a body (`delete_arrows`), and a shot catching up its
/// shooter's lag meets the other live flights where they were at each catch-up sub-step, before its body test: a lagged
/// shooter gets the baseline outcome, deleted at the same point (DEV-010). Two crossings: the arrow is the lagged shot
/// and crosses the ball 54 u out from the bow, inside its catch-up from 200 ms; the ball is the lagged shot and crosses
/// the lane 50 u out from the wand, inside its catch-up from 200 ms.
#[test]
fn a_catching_up_shot_meets_the_ball_or_arrow_it_crosses() {
    let baseline = crossing(TICK_MS, TICK_MS, 420., 10);
    assert!(
        baseline.deleted && !baseline.hit && baseline.damage == 0.,
        "{baseline:?}"
    );
    assert_eq!(crossing(TICK_MS, TICK_MS, 310., 16), baseline);
    for lag in [100., 200., 300.] {
        let arrow_lagged = crossing(lag, TICK_MS, 420., 10);
        let ball_lagged = crossing(TICK_MS, lag, 310., 16);
        eprintln!("lag {lag}: arrow lagged {arrow_lagged:?}; ball lagged {ball_lagged:?}");
        assert_eq!(arrow_lagged, baseline, "lagged arrow at {lag} ms");
        if lag < 300. {
            assert_eq!(ball_lagged, baseline, "lagged ball at {lag} ms");
        } else {
            // The limit no catch-up can lift: the baseline arrow reaches the victim 200 ms after its launch, in the sweep
            // of the very tick the 300 ms ball is launched in (250 ms back). Its hit is already in the ledger and the
            // flight has ended, so the ball meets nothing; a later sweep cannot take the damage back.
            assert!(
                !ball_lagged.deleted && ball_lagged.hit && ball_lagged.damage > 0.,
                "{ball_lagged:?}"
            );
        }
    }
    // Control: the same arrow hits the victim when no ball crosses it (the ball is cast after the arrow has landed).
    let open = crossing(300., TICK_MS, 420., 40);
    assert!(!open.deleted && open.hit && open.damage > 0., "{open:?}");
}
