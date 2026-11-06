use super::*;
use crate::{Placement, Secrets, Sim, SimConfig, Vec2, WeaponId};
fn scene() -> Sim {
    Sim::reset_active(
        SimConfig {
            faction_mode: crate::FactionMode::EngagementHolyPlagueFireFrostSentenced,
            pvp_rules: false,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        Secrets::from_seed(12),
        &(0..3)
            .map(|i| Placement {
                profile: format!("p{i}"),
                faction: if i == 0 {
                    FactionId::Sentenced
                } else {
                    FactionId::Holy
                },
                bot: false,
                at: Vec2::new(400. + i as f64 * 60., 320.),
                hp: None,
                weapon0: Some(WeaponId::Bow),
                weapon1: Some(WeaponId::Wand),
            })
            .collect::<Vec<_>>(),
    )
}
fn hit() -> Entry {
    Entry {
        terrain: false,
        dot: false,
        ability: None,
        arena: false,
        source: None,
        critical: false,
        critical_mult: None,
        victim: PlayerId(2),
        by: Some(PlayerId(1)),
        packet: Packet {
            raw: 1.,
            phys: 1.,
            magic: 0.,
            true_: 0.,
        },
        weapon: Some(WeaponId::Bow),
        sig: None,
        execute: false,
        stagger: false,
        projectile: Some(1),
        scale: 1.,
        derived: false,
        passive: false,
    }
}
fn cx<'a>(s: &'a mut Sim, ev: &'a mut Vec<crate::Event>) -> super::super::Cx<'a> {
    super::super::Cx {
        stats: crate::status_runtime::stats::Inputs::default(),
        #[cfg(feature = "trusted-status-probes")]
        probe: None,
        k: &s.k,
        w: &mut s.w,
        s: &mut s.s,
        ev,
        pf: &mut s.pf,
    }
}
#[test]
fn helper_batch_hits_promote_once_before_all_pulses_and_filter() {
    let mut s = scene();
    s.w.players[0].signature.set_target(PlayerId(2), 0.);
    let mut ledger = vec![hit(); 6];
    for field in 0..5 {
        let mut e = hit();
        match field {
            0 => e.passive = true,
            1 => e.derived = true,
            2 => e.scale = 0.,
            3 => e.weapon = None,
            _ => e.sig = Some(SignatureKind::Burn),
        }
        ledger.push(e);
    }
    let mut ev = vec![];
    before_damage(&s.k, &mut s.w, &mut ledger, &mut ev);
    assert_eq!(
        (
            s.w.players[0].signature.mark.hits,
            s.w.players[0].signature.mark.tier
        ),
        (6, 3)
    );
    let pulses = &ledger[11..];
    assert_eq!(pulses.len(), 6);
    assert!(pulses
        .windows(2)
        .all(|a| a[0].packet.raw == a[1].packet.raw));
    assert!(pulses.iter().all(|e| e.sig == Some(SignatureKind::Mark)
        && !e.sig.unwrap().is_dot()
        && !e.stagger
        && !e.execute
        && e.projectile.is_none()));
    assert_eq!(
        ev,
        vec![crate::Event::MarkNotice {
            recipient: PlayerId(2),
            notice: crate::events::MarkNotice::Marked
        }]
    );
}
#[test]
fn helper_progress_uses_prior_chill_no_stagger_pause_and_leash_boundaries() {
    let mut s = scene();
    s.w.players[0].signature.set_target(PlayerId(2), 0.);
    s.w.players[0].signature.chill = 1. - FROST_SLOW;
    s.w.players[0].signature.dot_paused_until = 1000.;
    let mut ledger = vec![hit(); 3];
    let mut ev = vec![];
    before_damage(&s.k, &mut s.w, &mut ledger, &mut ev);
    assert_eq!(
        s.w.players[0].signature.mark.progress,
        3. / (1. - FROST_SLOW)
    );
    assert_eq!(ledger.len(), 6);
    s.w.players[1].body.x = 1040.;
    ledger.clear();
    before_damage(&s.k, &mut s.w, &mut ledger, &mut ev);
    assert_eq!(s.w.players[0].signature.mark.far_since, None);
    s.w.players[1].body.x = 1040.000001;
    before_damage(&s.k, &mut s.w, &mut ledger, &mut ev);
    assert_eq!(s.w.players[0].signature.mark.far_since, Some(50.));
    s.w.server_time = 50. + TARGET_LOS_GRACE_MS;
    before_damage(&s.k, &mut s.w, &mut ledger, &mut ev);
    assert_eq!(s.w.players[0].signature.target, None);
}
#[test]
fn ordinary_same_type_slot_swaps_count_but_same_slot_noop_does_not() {
    let mut s = scene();
    s.w.players[0].signature.set_target(PlayerId(2), 0.);
    let mut ledger = vec![hit()];
    let mut ev = vec![];
    for slot in [1, 0] {
        super::super::items::swap(
            &mut cx(&mut s, &mut ev),
            crate::fighter::FighterIx(1),
            &crate::input::ActionCmd::Swap { slot: Some(slot) },
        );
    }
    assert_eq!(
        s.w.players[0].signature.mark.swaps, 0,
        "pre-mark swaps do not count retroactively"
    );
    before_damage(&s.k, &mut s.w, &mut ledger, &mut ev);
    s.w.players[1].weapon.weapon1 = Some(WeaponId::Bow);
    for slot in [0, 1, 1, 0] {
        super::super::items::swap(
            &mut cx(&mut s, &mut ev),
            crate::fighter::FighterIx(1),
            &crate::input::ActionCmd::Swap { slot: Some(slot) },
        );
    }
    assert_eq!(s.w.players[0].signature.mark.swaps, 2);
    let mut ledger = vec![];
    before_damage(&s.k, &mut s.w, &mut ledger, &mut ev);
    assert_eq!(s.w.players[0].signature.mark.tier, 3);
    s.w.players[1].weapon.weapon1 = None;
    super::super::items::swap(
        &mut cx(&mut s, &mut ev),
        crate::fighter::FighterIx(1),
        &crate::input::ActionCmd::Swap { slot: Some(1) },
    );
    assert_eq!(s.w.players[1].active_weapon(), WeaponId::Fists);
    assert_eq!(s.w.players[0].signature.mark.swaps, 3);
    before_damage(&s.k, &mut s.w, &mut ledger, &mut ev);
    assert_eq!(s.w.players[0].signature.mark.tier, 4);
}
#[test]
fn helper_execute_denial_pays_after_pass_and_sentence_survives_reset() {
    let mut s = scene();
    s.w.players[0].signature.set_target(PlayerId(2), 0.);
    s.w.players[0].signature.mark.tier = 4;
    s.w.players[0].signature.mark.hits = 9;
    s.w.players[0].signature.mark.progress = 9.;
    s.w.players[0].vitals.hp = 20.;
    let mut e = hit();
    e.victim = PlayerId(1);
    e.by = Some(PlayerId(2));
    e.sig = Some(SignatureKind::Disease);
    e.execute = true;
    e.packet.raw = 100.;
    e.packet.phys = 0.;
    e.packet.true_ = 1.;
    s.s.ledger.push(e);
    let mut ev = vec![];
    super::super::ledger::apply(&mut cx(&mut s, &mut ev));
    assert_eq!(s.w.players[0].vitals.hp, 1.);
    assert_eq!(s.w.players[0].credit.sentence, 1);
    assert!(s.w.players[0].signature.mark.denied);
    assert_eq!(s.w.players[0].signature.mark.amp_until, 2050.);
    s.w.players[0].signature.clear_target();
    assert_eq!(s.w.players[0].signature.mark.amp_until, 2050.);
    assert_eq!(s.w.players[0].credit.sentence, 1);
}

#[test]
fn trusted_restored_old_volley_exceeds_request_count_without_changing_damage_or_bucket_cap() {
    for count in [40, 200] {
        let mut s = scene();
        s.w.players[1].body.x = 800.;
        s.w.players[2].body.y = 600.;
        s.submit(
            PlayerId(1),
            crate::validate(crate::RawCommand::Attack { a: 0., t: None }).unwrap(),
        )
        .unwrap();
        for _ in 0..40 {
            s.step();
            if !s.w.projectiles.is_empty() {
                break;
            }
        }
        assert_eq!(
            s.w.projectiles.len(),
            1,
            "one genuine producer flight seeds this separately labelled trusted volley"
        );
        let projectile = s.w.projectiles[0];
        s.w.projectiles.clear();
        for id in 1..=count {
            let mut p = projectile;
            p.launch.id = id;
            s.w.projectiles.push(p);
        }
        s.w.entity_counter = count;
        let now = s.w.server_time;
        let victim = &mut s.w.players[1];
        victim.body.x = projectile.pos.x + 35.;
        victim.vitals.hp = 1000000.;
        let sample = crate::state::Sample {
            t: now,
            x: victim.body.x,
            y: victim.body.y,
        };
        victim.body.history.reset(sample);
        let encoded = serde_json::to_value(&s).unwrap();
        let mut s = crate::Sim::restore(encoded)
            .expect("dense volley is admitted, not claimed ordinary-intake reachable");
        let mut p = crate::FxProjector::attach(&s, PlayerId(2));
        s.submit(
            PlayerId(1),
            crate::validate(crate::RawCommand::Stop { seq: None }).unwrap(),
        )
        .unwrap();
        let before = s.w.players[1].vitals.hp;
        let events = s.step();
        let raw = events
            .iter()
            .filter(|e| {
                matches!(
                    e,
                    crate::Event::SignatureHit {
                        sig: SignatureKind::Mark,
                        ..
                    }
                )
            })
            .count();
        assert_eq!(raw, count as usize);
        assert!(s.performed_attacks().len() <= 1);
        assert_eq!(s.w.players[0].signature.mark.hits, u64::from(count));
        assert!(s.w.players[1].vitals.hp < before);
        if count == 40 {
            p.feed(s.fx_report()).unwrap();
            assert_eq!(
                p.events()
                    .iter()
                    .filter(|e| matches!(
                        e,
                        crate::SeenEvent::SignatureHit {
                            sig: SignatureKind::Mark,
                            ..
                        }
                    ))
                    .count(),
                1
            );
        } else {
            assert!(events.len() > crate::fx_report::FX_REPORT_EVENTS_MAX);
            assert_eq!(
                p.feed(s.fx_report()),
                Err(crate::FxError::UnsupportedBounds)
            );
        }
    }
}

#[test]
fn source_kill_hook_counts_died_unresolved_dead_killer_and_caps_without_paying_mia() {
    let mut s = scene();
    let mut ev = vec![];
    s.w.players[0].status = crate::Status::Dead;
    for outcome in [
        crate::Outcome::Mia,
        crate::Outcome::Died,
        crate::Outcome::Died,
        crate::Outcome::Died,
        crate::Outcome::Died,
        crate::Outcome::Died,
        crate::Outcome::Died,
    ] {
        crate::systems::credit::credit_kill(
            &s.k,
            &mut s.w,
            &mut ev,
            PlayerId(1),
            crate::systems::credit::KillVictim {
                id: PlayerId(2),
                outcome,
                bot: true,
            },
            0,
        );
    }
    assert_eq!(s.w.players[0].credit.sentence, MARK_KILL_STACK_CAP);
    s.w.players[0].resolved = true;
    crate::systems::credit::credit_kill(
        &s.k,
        &mut s.w,
        &mut ev,
        PlayerId(1),
        crate::systems::credit::KillVictim {
            id: PlayerId(2),
            outcome: crate::Outcome::Died,
            bot: true,
        },
        0,
    );
    assert_eq!(s.w.players[0].credit.sentence, MARK_KILL_STACK_CAP);
}
