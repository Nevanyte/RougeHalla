//! The seams the systems share: the input seam (`Cx::submit`, C-INPUT), hook dispatch and the deferred queue.

use super::*;
use crate::arenas::practice_arena;
use crate::constants::{MAX_ACTIONS_PER_TICK, TICK_MS};
use crate::hooks::{self, HookArgs, Hx, OutCause};
use crate::state::Packet;
use crate::{FactionId, Placement, Secrets, Sim, SimConfig, Vec2};

fn sim() -> Sim {
    let ps: Vec<Placement> = (0..2)
        .map(|i| Placement {
            profile: format!("p{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(300.0 + 600.0 * i as f64, 300.0),
            hp: None,
        })
        .collect();
    Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(11),
        &ps,
    )
}

/// Runs one fixed step exactly as `Sim::step` does, then lets `actor` act inside the same `Cx`.
fn step_with_actor(sim: &mut Sim, actor: impl FnOnce(&mut Cx)) {
    sim.w.server_time += TICK_MS;
    sim.w.tick += 1;
    let mut ev = std::mem::take(&mut sim.w.pending_events);
    let mut cx = Cx {
        k: &sim.k,
        w: &mut sim.w,
        s: &mut sim.s,
        ev: &mut ev,
        pf: &mut sim.pf,
    };
    step(&mut cx);
    actor(&mut cx);
}

fn commands() -> Vec<Command> {
    let mut v = vec![
        Command::Move {
            x: 700.0,
            y: 320.0,
            seq: Some(1),
        },
        Command::Aim { a: 0.4 },
    ];
    // Past the order budget (30 tokens) and the per-tick action cap.
    v.extend((0..40).map(|i| {
        if i % 2 == 0 {
            Command::Attack { a: 0.1, t: None }
        } else {
            Command::Release { a: 0.1, t: None }
        }
    }));
    v.push(Command::Stop { seq: Some(2) });
    v
}

#[test]
fn a_command_through_cx_submit_and_through_sim_submit_leaves_identical_state() {
    let mut a = sim();
    let mut b = a.clone();
    let (mut over_budget, mut queue_full) = (0, 0);
    for cmd in commands() {
        for id in [PlayerId(1), PlayerId(2), PlayerId(99)] {
            let ra = a.submit(id, cmd);
            // The same command through a `Cx` built by hand, outside a step.
            let mut ev = std::mem::take(&mut b.w.pending_events);
            let rb = Cx {
                k: &b.k,
                w: &mut b.w,
                s: &mut b.s,
                ev: &mut ev,
                pf: &mut b.pf,
            }
            .submit(id, cmd);
            b.w.pending_events = ev;
            assert_eq!(ra, rb, "{cmd:?} for {id:?}");
            over_budget += (ra == Err(Reject::OverBudget)) as u32;
            queue_full += (ra == Err(Reject::QueueFull)) as u32;
        }
    }
    assert!(
        over_budget > 0 && queue_full > 0,
        "both rejections exercised"
    );
    const { assert!(MAX_ACTIONS_PER_TICK < 40) };
    assert_eq!(a.w, b.w);
    assert_eq!(a.state_hash(), b.state_hash());
    a.step();
    b.step();
    assert_eq!(a.w, b.w);
}

#[test]
fn an_actor_inside_the_tick_acts_exactly_like_a_submit_after_the_step() {
    let cmds = [
        Command::Move {
            x: 500.0,
            y: 300.0,
            seq: Some(3),
        },
        Command::Attack { a: 0.0, t: None },
    ];
    let mut a = sim();
    let mut b = a.clone();
    a.step();
    for c in cmds {
        a.submit(PlayerId(1), c).unwrap();
    }
    step_with_actor(&mut b, |cx| {
        for c in cmds {
            cx.submit(PlayerId(1), c).unwrap();
        }
    });
    assert_eq!(a.w, b.w);
    // Both queues apply on the next tick identically.
    a.step();
    b.step();
    assert_eq!(a.w, b.w);
    assert_eq!(a.state_hash(), b.state_hash());
}

#[test]
fn a_proposal_is_validated_before_it_queues() {
    let mut s = sim();
    let before = s.w.clone();
    let mut ev = Vec::new();
    let mut cx = Cx {
        k: &s.k,
        w: &mut s.w,
        s: &mut s.s,
        ev: &mut ev,
        pf: &mut s.pf,
    };
    let bad = RawCommand::Move {
        x: f64::NAN,
        y: 1.0,
        seq: None,
    };
    assert_eq!(cx.propose(PlayerId(1), bad), Err(Reject::NonFinite));
    assert_eq!(*cx.w, before, "a rejected proposal leaves no trace");
    let far = RawCommand::Move {
        x: 1e9,
        y: 1.0,
        seq: None,
    };
    cx.propose(PlayerId(1), far).unwrap();
    assert_eq!(
        cx.w.players[0].inputs.mv,
        Some(crate::input::MoveCmd::Move {
            x: crate::constants::WORLD_W,
            y: 1.0,
            seq: None
        }),
        "the validated (clamped) command is what queues"
    );
}

fn with_hx<R>(sim: &mut Sim, f: impl FnOnce(&mut Hx) -> R) -> R {
    let mut ev = Vec::new();
    f(&mut Hx {
        k: &sim.k,
        w: &mut sim.w,
        ev: &mut ev,
    })
}

#[test]
fn the_drop_body_hook_empties_the_slots_through_the_dispatcher() {
    use crate::content::WeaponId;
    let mut s = sim();
    s.w.players[1].weapon0 = Some(WeaponId::Sword);
    s.w.players[1].weapon1 = Some(WeaponId::Axe);
    let victim = s.w.players[1].id;
    with_hx(&mut s, |hx| hooks::fire(hx, HookArgs::DropBody { victim }));
    assert_eq!(s.w.players[1].weapon0, None);
    assert_eq!(s.w.players[1].weapon1, None);
}

#[test]
fn a_hook_with_no_ported_link_changes_nothing() {
    let mut s = sim();
    let before = s.w.clone();
    let id = s.w.players[0].id;
    with_hx(&mut s, |hx| {
        hooks::fire(hx, HookArgs::RaidStarted);
        hooks::fire(hx, HookArgs::RunEnded);
        hooks::fire(
            hx,
            HookArgs::FighterOut {
                id,
                cause: OutCause::Removed,
            },
        );
    });
    assert_eq!(s.w, before);
}

fn hit(by: u32, victim: u32, raw: f64) -> ledger::Entry {
    ledger::Entry {
        victim: PlayerId(victim),
        by: PlayerId(by),
        packet: Packet {
            raw,
            phys: raw,
            magic: 0.0,
            true_: 0.0,
        },
        weapon: crate::content::WeaponId::Fists,
        stagger: false,
    }
}

#[test]
fn a_deferred_hit_opens_the_next_ticks_ledger() {
    let mut s = sim();
    let max = s.w.players[1].max_hp;
    let h0 = s.state_hash();
    s.w.deferred.defer_hit(hit(1, 2, 10.0));
    assert_ne!(
        s.state_hash(),
        h0,
        "a queued effect is part of the state hash"
    );
    let json = serde_json::to_value(&s).unwrap();
    assert!(
        json["world"]["deferred"]["hits"].is_array(),
        "a non-empty queue is part of the checkpoint"
    );
    let mut restored: Sim = serde_json::from_value(json).unwrap();
    s.step();
    restored.step();
    assert!(s.w.players[1].hp < max, "the deferred hit landed");
    assert!(s.w.deferred.is_empty(), "and the queue is spent");
    assert_eq!(s.w, restored.w, "a restored queue lands identically");
    let json = serde_json::to_value(&s).unwrap();
    assert!(
        json["world"].get("deferred").is_none(),
        "an empty queue adds nothing to a checkpoint"
    );
}

fn credit(by: u32) -> ledger::PayLater {
    ledger::PayLater::CreditKill {
        by: PlayerId(by),
        victim_bot: false,
        bounty: 0,
    }
}

#[test]
fn pay_later_outside_the_pass_pays_at_once() {
    let mut s = sim();
    with_hx(&mut s, |hx| hx.pay_later(credit(1)));
    assert_eq!(s.w.players[0].kills, 1, "legacy: not collecting, pay now");
    assert!(s.w.pay.items.is_empty());
}

#[test]
fn pay_later_inside_the_pass_waits_for_its_end_and_pays_in_order() {
    let mut s = sim();
    s.w.pay.collecting = true;
    with_hx(&mut s, |hx| {
        hx.pay_later(credit(1));
        hx.pay_later(credit(2));
        hx.pay_later(credit(1));
    });
    assert_eq!(
        (s.w.players[0].kills, s.w.players[1].kills),
        (0, 0),
        "nothing is paid while the pass collects"
    );
    assert_eq!(s.w.pay.items, vec![credit(1), credit(2), credit(1)]);
    let mut ev = Vec::new();
    ledger::pay_all(&mut s.w, &mut ev);
    assert_eq!((s.w.players[0].kills, s.w.players[1].kills), (2, 1));
    assert!(s.w.pay.items.is_empty() && !s.w.pay.collecting);
    with_hx(&mut s, |hx| hx.pay_later(credit(2)));
    assert_eq!(
        s.w.players[1].kills, 2,
        "after the pass it pays at once again"
    );
}

#[test]
fn a_payout_of_the_pass_lands_in_the_same_tick_not_the_next() {
    let mut s = sim();
    s.w.players[1].hp = 1.0;
    s.w.deferred.defer_hit(hit(1, 2, 1.0e6));
    s.step();
    assert_eq!(s.w.players[1].hp, 0.0, "the lethal hit landed");
    assert_eq!(
        s.w.players[0].kills, 1,
        "and its kill credit was paid in that tick's pass"
    );
    assert!(s.w.pay.items.is_empty() && !s.w.pay.collecting);
    let json = serde_json::to_value(&s).unwrap();
    assert!(
        json["world"].get("pay").is_none(),
        "the payout queue is never part of a checkpoint"
    );
}

/// Three fighters spread out on the practice arena, named p0 p1 p2 (ids 1 2 3), one hit point each.
fn sim3() -> Sim {
    let ps: Vec<Placement> = (0..3)
        .map(|i| Placement {
            profile: format!("p{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(300.0 + 300.0 * i as f64, 300.0),
            hp: Some(1.0),
        })
        .collect();
    Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(21),
        &ps,
    )
}

#[test]
fn kill_credit_is_paid_after_every_victim_took_their_damage() {
    // p1 kills p2 and p2 kills p3 in the same pass: both hits land (the ledger is simultaneous), both die, and only then do
    // the two kill credits go out, in the order they were queued. A victim who is down but not yet settled can still be
    // credited: no reward decides who survives the pass.
    let mut s = sim3();
    let mut ev = Vec::new();
    let mut cx = Cx {
        k: &s.k,
        w: &mut s.w,
        s: &mut s.s,
        ev: &mut ev,
        pf: &mut s.pf,
    };
    settle::mark_tick_start(&mut cx);
    inputs::action_order(&mut cx);
    cx.s.ledger.push(hit(1, 2, 1.0e6));
    cx.s.ledger.push(hit(2, 3, 1.0e6));
    ledger::apply(&mut cx);
    assert!(cx.s.ledger.is_empty());
    assert!(cx.w.pay.items.is_empty() && !cx.w.pay.collecting);
    let at = |f: &dyn Fn(&Event) -> bool| ev.iter().position(f).unwrap_or(usize::MAX);
    let death2 = at(&|e| matches!(e, Event::Death { id, .. } if *id == PlayerId(2)));
    let death3 = at(&|e| matches!(e, Event::Death { id, .. } if *id == PlayerId(3)));
    assert!(
        death2 < ev.len() && death3 < ev.len(),
        "both victims died: {ev:?}"
    );
    let credits: Vec<(usize, PlayerId)> = ev
        .iter()
        .enumerate()
        .filter_map(|(i, e)| match e {
            Event::Gv { id, .. } => Some((i, *id)),
            _ => None,
        })
        .collect();
    assert_eq!(
        credits.iter().map(|(_, id)| *id).collect::<Vec<_>>(),
        [PlayerId(1), PlayerId(2)],
        "one kill credit per kill, in queue order: {ev:?}"
    );
    assert!(
        credits.iter().all(|(i, _)| *i > death2.max(death3)),
        "every credit comes after both deaths: {ev:?}"
    );
}

#[test]
fn a_hit_by_a_departed_shooter_is_named_from_the_roster() {
    // leave_mia's shape: a fighter leaves between ticks (MIA, removed from the seats) and a hit it dealt is still queued (a
    // deferred entry survives one tick boundary). The victim dies of it: the result names the shooter from its roster entry,
    // credits nobody (the shooter is gone: no kill, no GV) and the Death names no attacker.
    let mut s = sim3();
    s.w.deferred.defer_hit(hit(2, 1, 1.0e6));
    s.remove_player(PlayerId(2));
    assert!(s.player(PlayerId(2)).is_none(), "the shooter is gone");
    let events = s.step();
    let resolved = |id: u32| {
        events.iter().find_map(|e| match e {
            Event::Resolved { id: i, result, .. } if *i == PlayerId(id) => Some(result.clone()),
            _ => None,
        })
    };
    let victim = resolved(1).expect("the victim's run resolved");
    assert_eq!(victim.outcome, crate::results::Outcome::Died);
    assert_eq!(
        victim.killed_by.as_deref(),
        Some("p1"),
        "the departed shooter is named from the roster (id 2 joined as p1)"
    );
    assert!(
        events
            .iter()
            .any(|e| matches!(e, Event::Death { id, by: None, .. } if *id == PlayerId(1))),
        "{events:?}"
    );
    assert!(
        !events.iter().any(|e| matches!(e, Event::Gv { .. })),
        "no credit for a shooter who left: {events:?}"
    );
    assert_eq!(s.w.players.iter().map(|p| p.kills).sum::<u32>(), 0);
}

#[test]
fn the_far_reject_in_in_arc_gives_the_exact_verdict() {
    use super::melee::in_arc;
    use crate::constants::{ARC_EPS, PLAYER_RADIUS};
    use crate::math::{angle_between, asin, atan2, hypot};
    use crate::rng::Mulberry32;
    // The test as first written: the hypot first, then the two rejects, then the arc.
    fn reference(origin: Vec2, a: f64, reach: f64, half_arc: f64, p: Vec2, r: f64) -> bool {
        let dx = p.x - origin.x;
        let dy = p.y - origin.y;
        let d = hypot(dx, dy);
        if d <= r {
            return true;
        }
        if d > reach + r {
            return false;
        }
        angle_between(atan2(dy, dx), a) <= half_arc + asin((r / d).min(1.0)) + ARC_EPS
    }
    let mut rng = Mulberry32::new(7);
    let mut out = 0u32;
    for n in 0..400_000u32 {
        let reach = [38.0, 56.0, 90.0, 0.0][(n % 4) as usize];
        let half_arc = 0.2 + rng.next_f64();
        let origin = Vec2::new(
            100.0 + rng.next_f64() * 500.0,
            100.0 + rng.next_f64() * 500.0,
        );
        let a = (rng.next_f64() - 0.5) * 6.4;
        // Targets around the edge of the reach (where the pre-check hands over to the exact test), and anywhere.
        let (dist, ang) = if n % 3 == 0 {
            (
                (reach + PLAYER_RADIUS) * (1.0 + (rng.next_f64() - 0.5) * 4e-9),
                rng.next_f64() * 6.3,
            )
        } else {
            (
                rng.next_f64() * 4.0 * (reach + PLAYER_RADIUS + 1.0),
                rng.next_f64() * 6.3,
            )
        };
        let p = Vec2::new(origin.x + dist * ang.cos(), origin.y + dist * ang.sin());
        let want = reference(origin, a, reach, half_arc, p, PLAYER_RADIUS);
        assert_eq!(
            in_arc(origin, a, reach, half_arc, p, PLAYER_RADIUS),
            want,
            "{origin:?} {a} {reach} {half_arc} {p:?}"
        );
        out += !want as u32;
    }
    assert!(out > 100_000, "the sample has plenty of misses: {out}");
}
