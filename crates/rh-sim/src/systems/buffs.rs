//! Legacy `sim/buffs.ts` for the G6 barrier: the source Second Skin grant and the `buffs.expireBoosts` system.
//!
//! The source publishes `PlayerState.barrier` and keeps the timer in the private `PlayerRuntime.boost`; the port mirrors
//! that split with two private `Player` scalars (`barrier_until`, `barrier_decays`). The grant is clamped ONLY when a
//! grant happens (source helpers); a later max-hp decrease leaves a larger barrier standing until decay or the next grant.
use crate::constants::{BARRIER_DECAY_SHARE_PER_SECOND, BARRIER_EPS, BARRIER_MAX_SHARE, TICK_MS};
use crate::state::Status;

/// Legacy `barrierCap`: the most barrier a grant may leave at this max hp.
pub(crate) fn cap(max_hp: f64) -> f64 {
    BARRIER_MAX_SHARE * max_hp.max(0.)
}

/// Legacy `clampBarrier`: a barrier amount held to [`cap`] and never negative.
pub(crate) fn clamp(barrier: f64, max_hp: f64) -> f64 {
    barrier.max(0.).min(cap(max_hp))
}

/// Legacy `decayBarrier`: what is left of a barrier `dt_seconds` later, floored to zero below `BARRIER_EPS`.
pub(crate) fn decay(barrier: f64, max_hp: f64, dt_seconds: f64) -> f64 {
    let left = barrier - BARRIER_DECAY_SHARE_PER_SECOND * max_hp.max(0.) * dt_seconds.max(0.);
    if left > BARRIER_EPS {
        left
    } else {
        0.
    }
}

/// Legacy `HEAL_BARRIER_LIFE_MS`: a full G6 barrier lasts exactly this long over its decay.
pub(crate) fn heal_barrier_life_ms() -> f64 {
    (BARRIER_MAX_SHARE / BARRIER_DECAY_SHARE_PER_SECOND) * 1000.
}

/// Legacy `grantHealBarrier`: add, clamp to the then-current max hp, enable decay and extend the deadline to
/// max(previous, now + lifetime). Only a standing player holds a barrier.
pub(crate) fn grant_heal_barrier(w: &mut crate::state::World, i: usize, hp: f64, now: f64) {
    if !(hp > 0.) {
        return;
    }
    let p = &mut w.players[i];
    if p.status != Status::Alive {
        return;
    }
    p.vitals.barrier = clamp(p.vitals.barrier + hp, p.vitals.max_hp);
    p.barrier_decays = true;
    p.barrier_until = p.barrier_until.max(now + heal_barrier_life_ms());
}

/// Legacy `expireBoosts` system: a barrier ends on time or with its holder, and a heal-made one decays
/// `BARRIER_DECAY_SHARE_PER_SECOND` of max hp a second. A barrier seeded without a timer is left alone.
pub(crate) fn expire(cx: &mut crate::systems::Cx) {
    let now = cx.w.server_time;
    for p in cx.w.players.iter_mut() {
        if !(p.barrier_until > 0.) {
            continue;
        }
        if now >= p.barrier_until
            || p.status != Status::Alive
            || (p.barrier_decays && !(p.vitals.barrier > 0.))
        {
            p.barrier_until = 0.;
            p.barrier_decays = false;
            p.vitals.barrier = 0.;
        } else if p.barrier_decays {
            p.vitals.barrier = decay(p.vitals.barrier, p.vitals.max_hp, TICK_MS / 1000.);
        }
    }
}

#[cfg(test)]
mod replay_tests;

#[cfg(test)]
mod tests {
    use crate::status_runtime::StatView;
    use crate::{
        arenas::practice_arena, cards::CardId, systems::heal, FactionId, Placement, PlayerId,
        Secrets, Sim, SimConfig, Vec2,
    };

    fn sim() -> Sim {
        let placements: Vec<Placement> = (0..2)
            .map(|i| Placement {
                profile: format!("p{i}"),
                faction: if i == 0 {
                    FactionId::Holy
                } else {
                    FactionId::Fire
                },
                bot: false,
                at: Vec2::new(400.0 + 56.0 * i as f64, 320.0),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect();
        Sim::reset_active(
            SimConfig::default(),
            practice_arena(),
            Secrets::from_seed(7),
            &placements,
        )
    }

    fn grant_second_skin(sim: &mut Sim) {
        assert!(crate::cards::grant(
            &sim.k,
            &mut sim.w,
            PlayerId(1),
            CardId::Leech1
        ));
        assert!(crate::cards::grant(
            &sim.k,
            &mut sim.w,
            PlayerId(1),
            CardId::SecondSkin
        ));
    }

    #[test]
    fn the_folded_heal_barrier_grants_adds_and_extends_the_source_way() {
        let mut sim = sim();
        grant_second_skin(&mut sim);
        let now = sim.w.server_time;
        {
            let p = &mut sim.w.players[0];
            p.vitals.max_hp = 500.0;
            p.vitals.hp = 200.0;
            p.vitals.barrier = 0.0;
            p.barrier_until = 0.0;
            p.barrier_decays = false;
        }
        let mut ev = Vec::new();
        let gained = heal::apply(&mut sim.w, &mut ev, 0, 100.0, heal::Kind::Ordinary);
        assert_eq!(gained, 100.0);
        let p = &sim.w.players[0];
        assert!(
            (p.vitals.barrier - 30.0).abs() < 1e-9,
            "{}% of the heal",
            p.vitals.barrier
        );
        assert!(p.barrier_decays, "a heal-made barrier decays");
        assert_eq!(p.barrier_until, now + 5000.0);

        // A later heal adds to the barrier but never past 25% of the then-current max hp, and extends the deadline to
        // max(previous, now+5000).
        sim.w.server_time = now + 1000.0;
        sim.w.players[0].vitals.hp = sim.w.players[0].vitals.max_hp;
        let gained = heal::apply(&mut sim.w, &mut ev, 0, 1000.0, heal::Kind::Ordinary);
        assert_eq!(gained, 0.0, "overheal still stands as barrier");
        let p = &sim.w.players[0];
        assert_eq!(p.vitals.barrier, 125.0);
        assert_eq!(p.barrier_until, now + 1000.0 + 5000.0);

        // The next grant clamps to the CURRENT max hp only; a max-hp decrease does not retroactively shrink.
        sim.w.players[0].vitals.max_hp = 400.0;
        sim.w.players[0].vitals.hp = 100.0;
        sim.w.server_time += 1000.0;
        heal::apply(&mut sim.w, &mut ev, 0, 1000.0, heal::Kind::Ordinary);
        let p = &sim.w.players[0];
        assert_eq!(p.vitals.barrier, 100.0, "clamped on grant to 25% of 400");
        assert_eq!(p.barrier_until, sim.w.server_time + 5000.0);
    }

    #[test]
    fn the_grant_uses_the_post_scaling_heal_and_counts_overheal_lifesteal() {
        let mut sim = sim();
        let i = 0;
        sim.w.players[i].vitals.hp = sim.w.players[i].vitals.max_hp;
        let stats = StatView {
            heal_barrier: 0.3,
            heal_taken_mult: 0.5,
            ..Default::default()
        };
        let mut ev = Vec::new();
        let gained = heal::apply_with(&mut sim.w, &mut ev, i, 10.0, heal::Kind::Ordinary, stats);
        assert_eq!(gained, 0.0, "overheal gains no hp");
        assert!(
            (sim.w.players[i].vitals.barrier - 1.5).abs() < 1e-9,
            "30% of the scaled 5"
        );

        // Lifesteal is exempt from the heal-taken scaling but still stands as barrier.
        sim.w.players[i].vitals.barrier = 0.0;
        sim.w.players[i].barrier_until = 0.0;
        sim.w.players[i].barrier_decays = false;
        heal::apply_with(&mut sim.w, &mut ev, i, 10.0, heal::Kind::Lifesteal, stats);
        assert!((sim.w.players[i].vitals.barrier - 3.0).abs() < 1e-9);

        // The regen caller is the source's noBarrier heal.
        sim.w.players[i].vitals.barrier = 0.0;
        sim.w.players[i].barrier_until = 0.0;
        sim.w.players[i].barrier_decays = false;
        heal::apply_with(&mut sim.w, &mut ev, i, 10.0, heal::Kind::QuietRegen, stats);
        assert_eq!(sim.w.players[i].vitals.barrier, 0.0);

        // A refused heal (lockout) and a zero heal never grant.
        sim.w.players[i].vitals.barrier = 0.0;
        sim.w.players[i].barrier_until = 0.0;
        sim.w.players[i].barrier_decays = false;
        sim.w.players[i].signature.combat_at = Some(sim.w.server_time);
        heal::apply_with(&mut sim.w, &mut ev, i, 10.0, heal::Kind::Ordinary, stats);
        assert_eq!(sim.w.players[i].vitals.barrier, 0.0);
        sim.w.players[i].signature.combat_at = None;
        sim.w.players[i].vitals.hp = 100.0;
        heal::apply_with(&mut sim.w, &mut ev, i, 0.0, heal::Kind::Ordinary, stats);
        assert_eq!(sim.w.players[i].vitals.barrier, 0.0);
    }

    #[test]
    fn the_expiry_system_decays_clears_and_spares_a_timerless_barrier() {
        let mut sim = sim();
        let now = sim.w.server_time;
        {
            let p = &mut sim.w.players[0];
            p.vitals.barrier = 100.0;
            p.vitals.max_hp = 500.0;
            p.vitals.hp = 500.0;
            p.barrier_until = now + 5000.0;
            p.barrier_decays = true;
        }
        sim.step();
        // One fixed 20 Hz tick: 5% of max hp a second.
        assert!((sim.w.players[0].vitals.barrier - (100.0 - 0.05 * 500.0 * 0.05)).abs() < 1e-9);

        // Decay can reach zero while the deadline and flag remain set until the next expiry pass (a reachable tuple).
        sim.w.players[0].vitals.barrier = 0.5;
        sim.w.players[0].barrier_until = sim.w.server_time + 5000.0;
        sim.w.players[0].barrier_decays = true;
        sim.step();
        assert_eq!(sim.w.players[0].vitals.barrier, 0.0);
        assert!(sim.w.players[0].barrier_until > 0.0);
        assert!(sim.w.players[0].barrier_decays);
        sim.step();
        assert_eq!(sim.w.players[0].barrier_until, 0.0);
        assert!(!sim.w.players[0].barrier_decays);

        // Death clears it in the same tick's systems phase.
        sim.w.players[0].vitals.barrier = 60.0;
        sim.w.players[0].barrier_until = sim.w.server_time + 5000.0;
        sim.w.players[0].barrier_decays = true;
        sim.w.players[0].status = crate::state::Status::Dead;
        sim.step();
        assert_eq!(sim.w.players[0].vitals.barrier, 0.0);
        assert_eq!(sim.w.players[0].barrier_until, 0.0);
        assert!(!sim.w.players[0].barrier_decays);

        // A barrier seeded without a timer (the source proof fixtures) is left alone.
        sim.w.players[1].vitals.barrier = 60.0;
        sim.w.players[1].barrier_until = 0.0;
        sim.w.players[1].barrier_decays = false;
        for _ in 0..10 {
            sim.step();
        }
        assert_eq!(sim.w.players[1].vitals.barrier, 60.0);
    }

    #[test]
    fn timerless_and_over_cap_restore_forms_continue_identically_and_malformed_ones_are_refused() {
        let forms: [fn(&mut crate::state::Player); 4] = [
            |p| {
                p.vitals.barrier = 100.0;
                p.barrier_until = 50_000.0;
                p.barrier_decays = true;
            },
            |p| {
                // Decay reached zero while the timer and flag stand until the next pass.
                p.vitals.barrier = 0.0;
                p.barrier_until = 50_000.0;
                p.barrier_decays = true;
            },
            |p| {
                // Timerless seeded barrier.
                p.vitals.barrier = 60.0;
                p.barrier_until = 0.0;
                p.barrier_decays = false;
            },
            |p| {
                // Over the grant cap after a max-hp decrease: valid until decay or the next grant.
                p.vitals.max_hp = 100.0;
                p.vitals.barrier = 60.0;
                p.barrier_until = 50_000.0;
                p.barrier_decays = true;
            },
        ];
        for form in forms {
            let mut a = sim();
            form(&mut a.w.players[0]);
            let cp = serde_json::to_value(&a).unwrap();
            let mut b = Sim::restore(&cp).expect("a reachable private barrier form restores");
            assert_eq!(a.state_hash(), b.state_hash());
            for _ in 0..3 {
                a.step();
                b.step();
                assert_eq!(a.state_hash(), b.state_hash(), "continued behavior");
            }
        }

        let mut a = sim();
        let good = serde_json::to_value(&a).unwrap();
        for (key, bad) in [
            ("barrier_until", serde_json::json!(-1.0)),
            ("barrier_until", serde_json::json!("soon")),
        ] {
            let mut cp = good.clone();
            cp["world"]["players"][0][key] = bad;
            assert!(Sim::restore(&cp).is_err(), "{key} must be validated");
        }
        let mut cp = good.clone();
        cp["world"]["players"][0]["barrier_decays"] = serde_json::json!(true);
        cp["world"]["players"][0]["barrier_until"] = serde_json::json!(0.0);
        assert!(Sim::restore(&cp).is_err(), "decay without a deadline");
        let mut cp = good.clone();
        cp["world"]["players"][0]["core"]["vitals"]["barrier"] = serde_json::json!(-1.0);
        assert!(Sim::restore(&cp).is_err(), "negative barrier");
        let _ = &mut a;
    }

    #[test]
    fn the_training_clear_resets_the_barrier_and_both_private_fields() {
        let mut sim = crate::Sim::new(
            crate::SimConfig {
                min_players: 1,
                lobby_seconds: 0.,
                fill_seconds: 0.,
                training: true,
                dummies: true,
                pvp_rules: false,
                ..Default::default()
            },
            crate::arenas::practice_arena(),
            crate::Secrets::from_seed(7),
        );
        sim.add_player("p0", Some(FactionId::Holy), false).unwrap();
        sim.step();
        assert!(crate::cards::grant(
            &sim.k,
            &mut sim.w,
            PlayerId(1),
            CardId::Leech1
        ));
        assert!(crate::cards::grant(
            &sim.k,
            &mut sim.w,
            PlayerId(1),
            CardId::SecondSkin
        ));
        sim.w.players[0].vitals.hp = 100.;
        let mut ev = Vec::new();
        heal::apply(&mut sim.w, &mut ev, 0, 200., heal::Kind::Ordinary);
        assert!(sim.w.players[0].vitals.barrier > 0.);
        assert!(sim.w.players[0].barrier_until > 0.);
        assert!(sim.w.players[0].barrier_decays);
        let raw = crate::input::RawCommand::Train(crate::input::TrainRaw {
            command: 5,
            id: 0,
            count: 0,
            options: [0; 3],
            option_count: 0,
        });
        sim.submit(PlayerId(1), crate::input::validate(raw).unwrap())
            .unwrap();
        sim.step();
        assert_eq!(sim.w.players[0].vitals.barrier, 0.);
        assert_eq!(sim.w.players[0].barrier_until, 0.);
        assert!(!sim.w.players[0].barrier_decays);
    }

    #[test]
    fn equal_public_facts_with_different_private_timers_observe_equal() {
        let mut a = sim();
        let mut b = sim();
        a.w.players[0].barrier_until = 50_000.0;
        a.w.players[0].barrier_decays = true;
        b.w.players[0].barrier_until = 1.0;
        b.w.players[0].barrier_decays = false;
        assert_eq!(
            crate::observe::observe(&a, PlayerId(2), &[]),
            crate::observe::observe(&b, PlayerId(2), &[])
        );
        assert_eq!(
            crate::observe::public_snapshot(&a),
            crate::observe::public_snapshot(&b)
        );
    }
}
