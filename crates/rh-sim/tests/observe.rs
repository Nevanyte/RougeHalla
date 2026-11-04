//! Observation leak tests (docs/CONTRACTS.md C-OBS): hidden state must not change what a player is shown.

use rh_sim::arenas::practice_arena;
use rh_sim::{
    observe, observe_into, validate, Command, FactionId, Placement, RawCommand, Secrets, Sim,
    SimConfig, Vec2,
};

/// A command through the one door in (C-INPUT): these tests only use valid ones.
fn cmd(raw: RawCommand) -> Command {
    validate(raw).expect("a valid test command")
}

fn place(profile: &str, faction: FactionId, x: f64, y: f64, hp: Option<f64>) -> Placement {
    Placement {
        profile: profile.into(),
        faction,
        bot: false,
        at: Vec2::new(x, y),
        hp,
    }
}

/// The practice arena: pillars at tile column 6 (x 192..224) rows 4..6 (y 128..224). A viewer west of the pillar and a
/// hidden player east of it, both at y = 176, cannot see each other; a third player stands in plain view.
fn world(hidden_x: f64, hidden_hp: f64, salt: u32) -> Sim {
    let ps = [
        place("viewer", FactionId::Holy, 100.0, 176.0, None),
        place("hidden", FactionId::Fire, hidden_x, 176.0, Some(hidden_hp)),
        place("plain", FactionId::Frost, 100.0, 600.0, None),
    ];
    Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets {
            order_salt: salt,
            spawn_seed: 1,
        },
        &ps,
    )
}

#[test]
fn hidden_actors_change_nothing_the_viewer_is_shown() {
    let viewer = rh_sim::PlayerId(1);
    let mut a = world(300.0, 950.0, 1);
    let mut b = world(330.0, 400.0, 1);
    // The hidden player acts differently in the two worlds; the visible one acts the same.
    for (sim, mv) in [(&mut a, 340.0), (&mut b, 360.0)] {
        sim.submit(
            rh_sim::PlayerId(2),
            cmd(RawCommand::Move {
                x: mv,
                y: 176.0,
                seq: Some(9),
            }),
        )
        .unwrap();
        sim.submit(
            rh_sim::PlayerId(3),
            cmd(RawCommand::Move {
                x: 160.0,
                y: 600.0,
                seq: None,
            }),
        )
        .unwrap();
    }
    for _ in 0..20 {
        let ea = a.step();
        let eb = b.step();
        let oa = observe(&a, viewer, &ea);
        let ob = observe(&b, viewer, &eb);
        assert_eq!(oa, ob, "tick {}", a.tick());
        assert!(
            oa.visible.iter().all(|v| v.id != rh_sim::PlayerId(2)),
            "the pillar hides player 2"
        );
        assert!(
            oa.visible.iter().any(|v| v.id == rh_sim::PlayerId(3)),
            "player 3 is in plain view"
        );
    }
}

#[test]
fn the_secret_order_salt_is_not_observable() {
    // Same match under two secret salts, with no same-tick contest whose outcome the order decides: identical observations.
    let viewer = rh_sim::PlayerId(1);
    let mut a = world(300.0, 950.0, 0xdead_beef);
    let mut b = world(300.0, 950.0, 0x0bad_f00d);
    for _ in 0..40 {
        let (ea, eb) = (a.step(), b.step());
        assert_eq!(observe(&a, viewer, &ea), observe(&b, viewer, &eb));
    }
}

#[test]
fn visible_actors_are_sorted_by_public_id_and_counted_only_when_seen() {
    let ps = [
        place("a", FactionId::Holy, 400.0, 400.0, None),
        place("b", FactionId::Fire, 500.0, 420.0, None),
        place("c", FactionId::Frost, 450.0, 380.0, None),
        place("d", FactionId::Plague, 1400.0, 900.0, None),
    ];
    let mut sim = Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(3),
        &ps,
    );
    let ev = sim.step();
    let o = observe(&sim, rh_sim::PlayerId(1), &ev);
    let ids: Vec<u32> = o.visible.iter().map(|v| v.id.0).collect();
    assert_eq!(ids, vec![2, 3], "d is beyond the vision radius (900 u)");
    assert!(o.me.is_some());
}

// ---- observe_into, the per-step filter and the declared event classes -----------------------------------------------------

use rh_sim::{Event, Observation, PlayerId, SeenEvent};

/// A small deterministic stream (the test's own, never a match secret).
fn lcg(s: &mut u64) -> f64 {
    *s = s
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    (*s >> 11) as f64 / (1u64 << 53) as f64
}

/// Six fighters in the practice arena, steered at random and swinging fists, so a match produces swings, hits, deaths and
/// bounties for every viewer to filter.
fn brawl(seed: u64) -> Sim {
    let at = [
        (200.0, 272.0),
        (330.0, 300.0),
        (460.0, 250.0),
        (600.0, 700.0),
        (640.0, 740.0),
        (1300.0, 272.0),
    ];
    let ps: Vec<Placement> = at
        .iter()
        .enumerate()
        .map(|(i, &(x, y))| place(&format!("p{i}"), FactionId::ALL[i % 5], x, y, Some(40.0)))
        .collect();
    Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(seed),
        &ps,
    )
}

fn steer(sim: &mut Sim, rng: &mut u64) {
    for i in 1..=6u32 {
        if lcg(rng) < 0.35 {
            let (x, y) = (150.0 + lcg(rng) * 700.0, 150.0 + lcg(rng) * 700.0);
            let _ = sim.submit(PlayerId(i), cmd(RawCommand::Move { x, y, seq: None }));
        }
        if lcg(rng) < 0.5 {
            let a = lcg(rng) * std::f64::consts::TAU;
            let _ = sim.submit(PlayerId(i), cmd(RawCommand::Attack { a, t: None }));
        }
    }
}

#[test]
fn observe_into_equals_observe_on_every_viewer_tick_with_one_reused_buffer() {
    let mut sim = brawl(1);
    let mut rng = 7u64;
    let mut buf: Vec<Observation> = vec![Observation::default(); 7];
    let mut lazy: Vec<SeenEvent> = Vec::new();
    let (mut checked, mut events_seen, mut actors_seen) = (0u32, 0usize, 0usize);
    for _ in 0..600 {
        steer(&mut sim, &mut rng);
        let ev = sim.step();
        // Viewer 0 is nobody (an unknown id), so the no-viewer path is covered too.
        for v in 0..=6u32 {
            let fresh = observe(&sim, PlayerId(v), &ev);
            let reused = &mut buf[v as usize];
            observe_into(&sim, PlayerId(v), &ev, reused);
            assert_eq!(*reused, fresh, "viewer {v} tick {}", sim.tick());
            // The per-step filter, on the same sim and events, shows exactly the observation's events.
            lazy.clear();
            rh_sim::observe_events_into(&sim, PlayerId(v), &ev, &mut lazy);
            assert_eq!(lazy, fresh.events, "viewer {v} tick {}", sim.tick());
            checked += 1;
            events_seen += fresh.events.len();
            actors_seen += fresh.visible.len();
        }
    }
    assert_eq!(checked, 600 * 7);
    assert!(
        events_seen > 50,
        "the brawl must produce events: {events_seen}"
    );
    assert!(actors_seen > 1000, "and sightings: {actors_seen}");
}

#[test]
fn a_buffer_holding_an_earlier_observation_leaks_nothing_into_the_next() {
    let mut sim = brawl(2);
    let mut rng = 11u64;
    let mut buf = Observation::default();
    for _ in 0..200 {
        steer(&mut sim, &mut rng);
        let ev = sim.step();
        // Alternate viewers through ONE buffer, so each refill follows another viewer's content.
        for v in [1u32, 6, 3, 0, 2] {
            observe_into(&sim, PlayerId(v), &ev, &mut buf);
            assert_eq!(buf, observe(&sim, PlayerId(v), &ev));
        }
    }
}

/// The catch-up rule (C-OBS): a wake that runs several steps judges each step's events against the line of sight of THAT
/// step. Two fighters stand 880 u apart (inside the 900 u vision radius, in the open) or 920 u (outside); one swings and
/// the viewer walks away (or toward it) at 8.5 u a step, so a 3-step wake ends on the other side of the radius. Judging the swing against the last step's sight, as the room used to, drops it in
/// the first case and reveals it in the second.
#[test]
fn per_step_filtering_judges_each_steps_events_against_that_steps_sight() {
    let viewer = PlayerId(1);
    let swung = |ev: &[SeenEvent]| {
        ev.iter()
            .any(|e| matches!(e, SeenEvent::Swing { by, .. } if *by == PlayerId(2)))
    };
    // (gap, where the viewer walks to, whether the viewer sees the swing when it happens)
    for (gap, to_x, sees_it_then) in [(880.0, 0.0, true), (920.0, 400.0, false)] {
        let ps = [
            place("viewer", FactionId::Holy, 100.0, 272.0, None),
            place("swinger", FactionId::Fire, 100.0 + gap, 272.0, None),
        ];
        let mut sim = Sim::reset_active(
            SimConfig::default(),
            practice_arena(),
            Secrets::from_seed(5),
            &ps,
        );
        sim.submit(PlayerId(2), cmd(RawCommand::Attack { a: 0.0, t: None }))
            .unwrap();
        sim.submit(
            viewer,
            cmd(RawCommand::Move {
                x: to_x,
                y: 272.0,
                seq: None,
            }),
        )
        .unwrap();
        let mut at_its_step = Vec::new();
        let mut all: Vec<Event> = Vec::new();
        let mut swing_steps = 0;
        // A "wake" of the steps that follow the order: the room observes each step but the last as it runs.
        for _ in 0..3 {
            let ev = sim.step();
            let has_swing = ev
                .iter()
                .any(|e| matches!(e, Event::Swing { by, .. } if *by == PlayerId(2)));
            if has_swing {
                swing_steps += 1;
                // Only the first swing is the one the walk straddles; later ones may be in or out of sight either way.
                if swing_steps == 1 {
                    rh_sim::observe_events_into(&sim, viewer, &ev, &mut at_its_step);
                }
            }
            all.extend(ev);
        }
        assert!(swing_steps >= 1, "gap {gap}: the swinger swung");
        assert_eq!(
            swung(&at_its_step),
            sees_it_then,
            "gap {gap}: judged at its own step"
        );
        // What the room did before: the whole wake's events against the LAST step's sight (the viewer has walked about 25 u
        // by then, across the vision edge).
        let late = observe(&sim, viewer, &all).events;
        assert_ne!(
            swung(&late),
            sees_it_then,
            "gap {gap}: judged against the last step's sight the verdict flips"
        );
    }
}
