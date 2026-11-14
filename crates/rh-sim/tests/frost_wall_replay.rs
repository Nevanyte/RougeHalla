//! P-FROST-WALL-1b guard: a recorded match under `frost_wish = Wall` in which the wall sets a fighter down, re-plans a
//! walk under way and stops a blink replays to every step's hash (the recorder and `run_replay`, as
//! `tests/step_event_window.rs` uses them). The witness keeps the run from being vacuous: a wall stood, and the fighter it
//! landed on (with no order of its own) was moved off the ice in the landing step.
use rh_sim::abilities::{Mode, Slot, FROST_WALL_CAST_MS};
use rh_sim::replay::{apply_input, run_replay, Recorder, Replay, ReplayInput, ReplayStart};
use rh_sim::{
    validate, Arena, Command, FactionId, FrostWish, Placement, PlayerId, RawCommand, Secrets, Sim,
    SimConfig, TileMap, Vec2,
};

/// Tile centre in world units (32 u tiles).
fn tc(t: u32) -> f64 {
    f64::from(t) * 32. + 16.
}

fn config() -> SimConfig {
    SimConfig {
        abilities: Mode::Full,
        wish_lock_ms: 0.,
        frost_wish: FrostWish::Wall,
        quests: false,
        consumables: false,
        ..Default::default()
    }
}

/// The legacy frostWall.test.ts room: 40 x 20, open, with a wall border.
fn arena(spawns: &[Vec2]) -> Arena {
    let (w, h) = (40usize, 20usize);
    let mut tiles = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                tiles[y * w + x] = 1;
            }
        }
    }
    Arena {
        map: TileMap::new(w as u32, h as u32, tiles).unwrap(),
        spawns: spawns.to_vec(),
    }
}

/// Frost at (3, 16); a Fire walker at (8, 10); a Holy fighter standing on the wall's line at (13, 10); a Fire blinker
/// at (8, 4).
fn placements() -> Vec<Placement> {
    [
        (FactionId::Frost, Vec2::new(tc(3), tc(16))),
        (FactionId::Fire, Vec2::new(tc(8), tc(10))),
        (FactionId::Holy, Vec2::new(tc(13), tc(10))),
        (FactionId::Fire, Vec2::new(tc(8), tc(4))),
    ]
    .into_iter()
    .enumerate()
    .map(|(i, (faction, at))| Placement {
        profile: format!("p{i}"),
        faction,
        bot: false,
        at,
        hp: Some(1e9),
        weapon0: None,
        weapon1: None,
    })
    .collect()
}

fn cmd(raw: RawCommand) -> Command {
    validate(raw).expect("a valid scenario command")
}

fn cast(x: f64, y: f64) -> Command {
    cmd(RawCommand::Cast {
        slot: Slot::Wish,
        x,
        y,
        id: None,
        t: None,
        seq: None,
    })
}

/// The scenario's inputs before step `n` (0-based), as (player index, command).
fn inputs(n: usize) -> Vec<(usize, Command)> {
    let ticks_to_landing = (FROST_WALL_CAST_MS / 50.) as usize + 2;
    match n {
        1 => vec![(
            1,
            cmd(RawCommand::Move {
                x: tc(20),
                y: tc(10),
                seq: None,
            }),
        )],
        // Frost aims at (13, 10): a diagonal across the walk, on the Holy fighter.
        2 => vec![(0, cast(tc(13), tc(10)))],
        // The second Fire player blinks at the wall's centre once it stands.
        n if n == 2 + ticks_to_landing + 2 => vec![(3, cast(tc(13), tc(10)))],
        _ => Vec::new(),
    }
}

fn steps() -> usize {
    140
}

fn walls(sim: &Sim) -> bool {
    serde_json::to_value(sim).unwrap()["world"]["abilities"]["barriers"].is_array()
}

fn recorded() -> Replay {
    let p = placements();
    let mut sim = Sim::reset_active(
        config(),
        arena(&p.iter().map(|p| p.at).collect::<Vec<_>>()),
        Secrets::from_seed(11),
        &p,
    );
    let mut rec = Recorder::new(&sim, config(), ReplayStart::Active { placements: p });
    let ids: Vec<PlayerId> = sim.players().iter().map(|p| p.id).collect();
    let mut stood = false;
    let mut set_down = false;
    for n in 0..steps() {
        for (who, c) in inputs(n) {
            let input = ReplayInput::Command {
                player: ids[who],
                cmd: c,
            };
            apply_input(&mut sim, &input);
            rec.record(input);
        }
        let before = sim.players()[2].pos();
        let had = walls(&sim);
        sim.step();
        rec.stepped(&sim);
        if !had && walls(&sim) {
            stood = true;
            let after = sim.players()[2].pos();
            let moved = rh_sim::math::hypot(after.x - before.x, after.y - before.y);
            set_down = moved >= 8.;
        }
    }
    assert!(stood, "a wall stood in the recording");
    assert!(
        set_down,
        "the fighter on the wall's line was set down off the ice in the landing step"
    );
    rec.replay
}

#[test]
fn a_recorded_match_with_a_frost_wall_replays_to_every_hash() {
    let r = recorded();
    let back: Replay = serde_json::from_str(&serde_json::to_string(&r).unwrap()).unwrap();
    let (sim, _) = run_replay(&back).expect("the recording verifies at every step");
    assert_eq!(Some(&sim.state_hash()), r.hashes.last(), "the final hash");
}
