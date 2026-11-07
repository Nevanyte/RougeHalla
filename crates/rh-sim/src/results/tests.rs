use super::*;
use crate::systems::{settle, Cx};
use crate::{validate, Event, FactionId, PlayerId, RawCommand, Secrets, Sim, SimConfig, WeaponId};
#[path = "../../../../parity/persistence/cases.rs"]
mod cases;

fn setup(c: &cases::Input) -> Sim {
    let mut s = Sim::new(
        SimConfig {
            consumables: true,
            min_players: 3,
            fill_seconds: 0.,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        Secrets::from_seed(2),
    );
    s.add_player(
        "Subject",
        c.faction.as_deref().map(|s| FactionId::parse(s).unwrap()),
        false,
    )
    .unwrap();
    s.add_player("OtherB", None, false).unwrap();
    s.add_player("OtherC", None, false).unwrap();
    s.step();
    let p = &mut s.w.players[0];
    p.weapon.weapon0 = c.weapon0.as_deref().map(|s| WeaponId::parse(s).unwrap());
    p.weapon.weapon1 = c.weapon1.as_deref().map(|s| WeaponId::parse(s).unwrap());
    p.weapon.slot = c.slot;
    if c.qualified {
        p.credit.damaged_humans = vec![PlayerId(2), PlayerId(3)];
    }
    p.credit.gv_parts.quest = c.earned;
    p.credit.gv = c.earned;
    p.seat.bot = c.bot;
    if c.swap {
        s.submit(
            PlayerId(1),
            validate(RawCommand::Swap { slot: Some(1) }).unwrap(),
        )
        .unwrap();
        s.step();
    }
    s
}

fn finish(s: &mut Sim, kind: &str) -> Vec<Event> {
    if kind == "mia" {
        s.remove_player(PlayerId(1));
        return s.take_events();
    }
    if matches!(kind, "posthumous" | "draw") {
        for p in &mut s.w.players {
            p.vitals.hp = p.vitals.max_hp
                * if p.id == PlayerId(1) || kind == "draw" {
                    1.
                } else {
                    0.5
                };
        }
    }
    let mut events = Vec::new();
    let mut cx = Cx {
        stats: crate::status_runtime::stats::Inputs::default(),
        #[cfg(feature = "trusted-status-probes")]
        probe: None,
        k: &s.k,
        w: &mut s.w,
        s: &mut s.s,
        pf: &mut s.pf,
        ev: &mut events,
    };
    settle::mark_tick_start(&mut cx);
    let downs: &[usize] = match kind {
        "died" => &[0],
        "won" => &[1, 2],
        "posthumous" | "draw" => &[0, 1, 2],
        _ => panic!("unsupported {kind}"),
    };
    for &i in downs {
        settle::down_player(
            cx.k,
            cx.w,
            cx.ev,
            Some(&mut cx.s.downed_this_tick),
            i,
            Outcome::Died,
        );
    }
    settle::settle(&mut cx);
    events
}
fn result(events: &[Event]) -> &RunResult {
    events
        .iter()
        .find_map(|e| match e {
            Event::Resolved {
                id: PlayerId(1),
                result,
                ..
            } => Some(result),
            _ => None,
        })
        .unwrap()
}

#[test]
fn ending_metadata_matches_actual_legacy_room_adapter() {
    for c in cases::capture().cases {
        if c.input.finish == "void" {
            continue;
        } // Void is a store/adapter contract; the Rust live lifecycle drains.
        let mut s = setup(&c.input);
        let events = finish(&mut s, &c.input.finish);
        let r = result(&events);
        let legacy = c.result.as_ref().unwrap();
        // Explicit canonical projection: legacy's sim result has no ending metadata.
        // Compare every legacy field here; the actual Room.recordRun capture below is the metadata oracle.
        let projection = cases::LegacyResult {
            outcome: match r.outcome {
                Outcome::Won => "won",
                Outcome::Died => "died",
                Outcome::Mia => "mia",
                Outcome::Draw => "draw",
            }
            .into(),
            profile: r.profile.clone(),
            duration_sec: r.duration_sec,
            kills: r.kills,
            killed_by: r.killed_by.clone(),
            killed_by_bot: r.killed_by_bot,
            place: r.place,
            players: r.players,
            gv: cases::Gv {
                kills: r.gv.kills,
                mobs: r.gv.mobs,
                bounty: r.gv.bounty,
                quest: r.gv.quest,
                win: r.gv.win,
                total: r.gv.total,
            },
            win_bonus_withheld: r.win_bonus_withheld,
            win_bonus_why: r.win_bonus_why.map(|w| {
                match w {
                    WinBonusWhy::Starters => "starters",
                    WinBonusWhy::Opponents => "opponents",
                }
                .into()
            }),
        };
        assert_eq!(&projection, legacy, "{}", c.input.name);
        if let Some(record) = c.record {
            assert_eq!(
                r.faction.map(FactionId::as_str),
                record.faction.as_deref(),
                "{}",
                c.input.name
            );
            assert_eq!(
                r.weapon.map(WeaponId::as_str),
                record.weapon.as_deref(),
                "{}",
                c.input.name
            );
        } else {
            assert!(c.input.bot || c.input.training);
        }
    }
}

#[test]
fn chosen_faction_and_pending_mia_metadata_survive_restore_and_change_hash() {
    let capture = cases::capture();
    let c = &capture
        .cases
        .iter()
        .find(|c| c.input.name == "active-mia")
        .unwrap()
        .input;
    let mut s = setup(c);
    let hash = s.state_hash();
    s.w.players[0].seat.picked_faction = None;
    assert_ne!(hash, s.state_hash());
    s.w.players[0].seat.picked_faction = Some(FactionId::Frost);
    s.remove_player(PlayerId(1));
    let json = serde_json::to_string(&s).unwrap();
    let mut restored: Sim = serde_json::from_str(&json).unwrap();
    assert_eq!(s.state_hash(), restored.state_hash());
    let hash = restored.state_hash();
    let Event::Resolved { result, .. } = restored
        .w
        .pending_events
        .iter_mut()
        .find(|e| matches!(e, Event::Resolved { .. }))
        .unwrap()
    else {
        unreachable!()
    };
    assert_eq!(result.faction, Some(FactionId::Frost));
    assert_eq!(result.weapon, None);
    result.faction = Some(FactionId::Holy);
    assert_ne!(hash, restored.state_hash());
    restored = serde_json::from_str(&json).unwrap();
    let Event::Resolved { result, .. } = restored
        .w
        .pending_events
        .iter_mut()
        .find(|e| matches!(e, Event::Resolved { .. }))
        .unwrap()
    else {
        unreachable!()
    };
    result.weapon = Some(WeaponId::Wand);
    assert_ne!(hash, restored.state_hash());
    restored = serde_json::from_str(&json).unwrap();
    assert_eq!(s.step(), restored.step());
    assert_eq!(s.state_hash(), restored.state_hash());
}

#[test]
fn private_choice_and_result_metadata_do_not_change_observations() {
    let capture = cases::capture();
    let mut s = setup(&capture.cases[0].input);
    let events = finish(&mut s, "won");
    let mut altered = events.clone();
    for e in &mut altered {
        if let Event::Resolved { result, .. } = e {
            result.faction = Some(FactionId::Holy);
            result.weapon = Some(WeaponId::Axe);
        }
    }
    // Use identical worlds, varying only private provenance and raw private result payloads.
    let mut other = s.clone();
    other.w.players[0].seat.picked_faction = None;
    assert_eq!(crate::public_snapshot(&s), crate::public_snapshot(&other));
    for id in [PlayerId(1), PlayerId(2)] {
        assert_eq!(
            crate::observe::observe(&s, id, &events),
            crate::observe::observe(&other, id, &altered)
        );
    }
}

#[test]
fn replay_keeps_explicit_choice_and_between_tick_result() {
    use crate::replay::{apply_input, run_replay, Recorder, ReplayInput, ReplayStart};
    let config = SimConfig {
        consumables: true,
        min_players: 3,
        fill_seconds: 0.,
        ..Default::default()
    };
    let mut sim = Sim::new(
        config.clone(),
        crate::arenas::practice_arena(),
        Secrets::from_seed(4),
    );
    let mut rec = Recorder::new(&sim, config, ReplayStart::Lobby);
    for (profile, faction) in [
        ("Subject", Some(FactionId::Holy)),
        ("OtherB", None),
        ("OtherC", None),
    ] {
        let input = ReplayInput::Join {
            profile: profile.into(),
            faction,
            bot: false,
            policy: None,
        };
        apply_input(&mut sim, &input);
        rec.record(input);
    }
    sim.step();
    rec.stepped(&sim);
    let leave = ReplayInput::Leave {
        player: PlayerId(1),
    };
    apply_input(&mut sim, &leave);
    rec.record(leave);
    let events = sim.step();
    rec.stepped(&sim);
    assert_eq!(result(&events).faction, Some(FactionId::Holy));
    assert_eq!(result(&events).weapon, None);
    let (replayed, revents) = run_replay(&rec.replay).unwrap();
    assert_eq!(result(&events), result(&revents));
    assert_eq!(sim.state_hash(), replayed.state_hash());
    assert_eq!(replayed.w.players[0].seat.picked_faction, None);
    let mut old = rec.replay;
    old.format = "rh-replay/7".into();
    assert!(run_replay(&old).is_err());
    let mut checkpoint = serde_json::to_value(&sim).unwrap();
    checkpoint["format"] = "rh-checkpoint/9".into();
    assert!(serde_json::from_value::<Sim>(checkpoint).is_err());
}
