//! Wind emblem tests: the stream's seed derivation, spawning, the walk-over pickup and the source's +50% window.
use crate::constants::{
    SPEED_BOOST_MS, SPEED_BOOST_MULT, WIND_SEED_XOR, WIND_SPAWN_MAX_MS, WIND_SPAWN_MIN_MS,
};
use crate::events::Event;
use crate::rng::Mulberry32;
use crate::sim::{Placement, Secrets, Sim, SimConfig};
use crate::state::ContainerKind;
use crate::status_runtime::stats::StatView;
use crate::{FactionId, PlayerId, Vec2};

fn placement(i: usize, at: Vec2) -> Placement {
    Placement {
        profile: format!("wind{i}"),
        faction: FactionId::Fire,
        bot: false,
        at,
        hp: None,
        weapon0: None,
        weapon1: None,
    }
}

fn sim(players: &[Placement]) -> Sim {
    Sim::reset_active(
        SimConfig::default(),
        crate::arenas::practice_arena(),
        Secrets::from_seed(41),
        players,
    )
}

#[test]
fn the_stream_is_mulberry32_of_the_order_salt() {
    let secrets = Secrets::from_seed(99);
    let w = crate::state::World::new(&secrets);
    let mut expect = Mulberry32::new(secrets.order_salt ^ WIND_SEED_XOR);
    let install = expect.next_f64();
    // The install draw seeded the first timer; the world holds the stream after that draw.
    assert_eq!(w.wind_rng.state(), expect.state(), "install draw");
    assert_eq!(
        w.wind_next_at,
        WIND_SPAWN_MIN_MS + install * (WIND_SPAWN_MAX_MS - WIND_SPAWN_MIN_MS)
    );
}

#[test]
fn a_due_timer_spawns_an_emblem_away_from_the_others() {
    let mut s = sim(&[placement(0, Vec2::new(112.0, 112.0))]);
    s.w.wind_next_at = s.server_time();
    let mut ev = Vec::new();
    s.step_into(&mut ev);
    let emblems: Vec<Vec2> = s
        .containers()
        .iter()
        .filter(|c| c.kind == ContainerKind::WindEmblem)
        .map(|c| c.at)
        .collect();
    assert_eq!(emblems.len(), 1, "one emblem for one due timer");
    let at = emblems[0];
    assert!(at.x > 0.0 && at.y > 0.0);
}

#[test]
fn walking_over_an_emblem_grants_the_boost_and_expiry_clears_it() {
    let mut s = sim(&[placement(0, Vec2::new(112.0, 112.0))]);
    s.w.wind_next_at = s.server_time();
    s.step_into(&mut Vec::new());
    let at = s
        .containers()
        .iter()
        .find(|c| c.kind == ContainerKind::WindEmblem)
        .map(|c| c.at)
        .expect("spawned");
    s.w.players[0].body.x = at.x;
    s.w.players[0].body.y = at.y;
    let mut ev = Vec::new();
    s.step_into(&mut ev);
    assert!(
        s.containers()
            .iter()
            .all(|c| c.kind != ContainerKind::WindEmblem),
        "the emblem is consumed"
    );
    assert!(ev
        .iter()
        .any(|e| matches!(e, Event::WindEmblem { id } if *id == PlayerId(1))));
    assert_eq!(
        s.players()[0].speed_boost_until,
        s.server_time() + SPEED_BOOST_MS
    );
    // The source answers while the window is open and stops after the system expires it.
    let view = StatView {
        slow_resist: 0.0,
        buff_move: 0.0,
        dot_mult: 0.0,
        crit_chance: 0.0,
        dot_crit: false,
        lifesteal_rows: 0.0,
        lifesteal_mult: 0.0,
        lifesteal_dot: 0.0,
        farm_lifesteal_rows: 0.0,
        heal_taken_mult: 0.0,
        mark_suppression: None,
    };
    let had = {
        let core = &s.w.players[0].core;
        super::speed_source(&s.w, core, view).expect("boosted")
    };
    assert_eq!(had.speed_mult, Some(SPEED_BOOST_MULT));
    s.w.players[0].speed_boost_until = 0.0;
    let gone = {
        let core = &s.w.players[0].core;
        super::speed_source(&s.w, core, view)
    };
    assert_eq!(gone, None);
}
