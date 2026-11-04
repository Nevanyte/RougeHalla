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
        by_name: format!("p{}", by - 1),
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
