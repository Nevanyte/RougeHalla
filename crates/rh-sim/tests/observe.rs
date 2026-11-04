//! Observation leak tests (docs/CONTRACTS.md C-OBS): hidden state must not change what a player is shown.

use rh_sim::arenas::practice_arena;
use rh_sim::{observe, Command, FactionId, Placement, Secrets, Sim, SimConfig, Vec2};

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
            Command::Move {
                x: mv,
                y: 176.0,
                seq: Some(9),
            },
        )
        .unwrap();
        sim.submit(
            rh_sim::PlayerId(3),
            Command::Move {
                x: 160.0,
                y: 600.0,
                seq: None,
            },
        )
        .unwrap();
    }
    for _ in 0..20 {
        let ea = a.step();
        let eb = b.step();
        let oa = observe(&a, viewer, &ea);
        let ob = observe(&b, viewer, &eb);
        assert_eq!(oa, ob, "tick {}", a.tick);
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
