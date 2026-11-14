//! P-FROST-WALL-BOTS-1 oracle (rh-headless, release only): in a live-world match, Frost bots raise their wall between
//! themselves and an enemy that is coming at them, as legacy's bots do (`78dd8bd4` abilityPolicy.ts:97-101, :164-174:
//! 70% of the way to a chaser 56..=260 u away), and the matches still play without a stall.
//!
//! Measurement, at every tick a Frost seat starts its Wish (a `CastStarted` of Frost's Wish in a Wall world):
//! - the caster `C` and the nearest other living player `E` now, and both 10 ticks (0.5 s) before;
//! - `E` was approaching: the distance closed by at least `CLOSING` over those 10 ticks;
//! - the aim `A` lies between them: its projection on `C -> E` is in `(0.2, 1.0)` of the way and at most `OFF_LINE` u off
//!   the line (the humanizer's ground scatter and the bot's reaction time move it a little).
//!
//! Such a cast is a "peel wall". Before this packet the bots aim at the enemy itself (projection about 1.0).
//!
//! Loose proof (owner direction 2026-11-10): at least one peel wall over three seeded Brain matches; the no-stall criteria
//! are P-FROST-WALL-3's (`tests/frost_wall_live.rs`). Walls toward a mob (an escape while fighting one, legacy's
//! `s.threat ?? s.foe`) are counted as walls, not as peel walls.
//!
//!   cargo test --locked --release -p rh-headless --test frost_wall_bots
use rh_headless::{AgentSpec, BotKind, Env, EnvConfig};
use rh_sim::status_runtime::AbilityId;
use rh_sim::{Event, FactionId, PlayerId, SimConfig, Status, Vec2};
use std::collections::VecDeque;

/// Ticks looked back to judge "approaching" (0.5 s).
const LOOKBACK: usize = 10;
/// The distance an approaching enemy closed over `LOOKBACK` ticks (a walking step is about 8.5 u a tick).
const CLOSING: f64 = 20.;
/// How far off the caster-enemy line the aim may be.
const OFF_LINE: f64 = 48.;
/// An aim this close to another living player is aimed at that player.
const ON_PLAYER: f64 = 24.;
/// Ticks (10 s) after a wall in which its living caster must have a command accepted.
const ACT_WINDOW: u32 = 200;

#[derive(Debug, Default)]
struct Walls {
    ticks: u32,
    /// Frost Wish casts started.
    walls: u32,
    /// Of those, the ones dropped between the caster and an approaching enemy.
    peel_walls: u32,
    /// Walls aimed within `ON_PLAYER` of another living player (diagnostic only: a third player can stand there).
    on_player: u32,
    faults: usize,
    self_kills: u32,
    caster_moved_on_landing: f64,
    idle_after_wall: u32,
}

fn arena() -> rh_sim::Arena {
    rh_headless::load_arena(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../rh-sim/src/mapdata/fixtures/seed1.map.json"
    ))
    .expect("admitted seed1 map")
}

fn dist(a: Vec2, b: Vec2) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

/// Is `aim` between `c` and `e` (projection in (0.2, 1.0), within `OFF_LINE` of the line)?
fn between(c: Vec2, e: Vec2, aim: Vec2) -> bool {
    let (dx, dy) = (e.x - c.x, e.y - c.y);
    let len2 = dx * dx + dy * dy;
    if len2 < 1. {
        return false;
    }
    let (ax, ay) = (aim.x - c.x, aim.y - c.y);
    let t = (ax * dx + ay * dy) / len2;
    let off = (ax * dy - ay * dx).abs() / len2.sqrt();
    t > 0.2 && t < 1.0 && off <= OFF_LINE
}

/// Eight bots of `kind` in the LIVE content world (short lobby timers only), factions dealt as
/// `tests/frost_wall_live.rs` deals them.
fn run(kind: BotKind, seed: u64, max_ticks: u32) -> Walls {
    let arena = arena();
    let sim = SimConfig {
        min_players: 1,
        lobby_seconds: 5.,
        fill_seconds: 3.,
        ..SimConfig::live_content()
    };
    assert_eq!(
        sim.frost_wish,
        rh_sim::FrostWish::Wall,
        "the live world plays the wall"
    );
    let agents = (0..8)
        .map(|i| AgentSpec {
            profile: format!("bot{i}"),
            faction: FactionId::ALL[(i + seed as usize) % 5],
            bot: true,
            agent: rh_headless::Agent::Policy {
                policy: kind.policy(&arena, &sim, 8, seed, i),
            },
        })
        .collect();
    let mut env = Env::new(
        EnvConfig {
            arena,
            sim,
            max_ticks,
            record: false,
        },
        agents,
        seed,
    );
    let accepted = |env: &Env, id: PlayerId| {
        env.seat_stats()
            .iter()
            .find(|s| s.0 == id)
            .map_or(0, |s| s.1.accepted)
    };
    let mut out = Walls::default();
    // The last LOOKBACK + 1 ticks' positions of the living players.
    let mut history: VecDeque<Vec<(PlayerId, Vec2)>> = VecDeque::new();
    let mut watch: Vec<(PlayerId, u32, u64)> = Vec::new();
    loop {
        let before: Vec<(PlayerId, Vec2)> =
            env.sim.players().iter().map(|p| (p.id, p.pos())).collect();
        let progress = env.advance(&[]);
        out.ticks += 1;
        let living: Vec<(PlayerId, Vec2)> = env
            .sim
            .players()
            .iter()
            .filter(|p| p.status == Status::Alive)
            .map(|p| (p.id, p.pos()))
            .collect();
        history.push_back(living.clone());
        if history.len() > LOOKBACK + 1 {
            history.pop_front();
        }
        let is_frost = |env: &Env, id: PlayerId| {
            env.sim
                .player(id)
                .is_some_and(|p| p.faction_id() == Some(FactionId::Frost))
        };
        let mut landed = Vec::new();
        for e in env.last_events() {
            match e {
                Event::CastStarted {
                    id,
                    ability: AbilityId::Freeze,
                    x,
                    y,
                    ..
                } if is_frost(&env, *id) => {
                    out.walls += 1;
                    let aim = Vec2::new(*x, *y);
                    if living
                        .iter()
                        .any(|(p, at)| p != id && dist(*at, aim) <= ON_PLAYER)
                    {
                        out.on_player += 1;
                    }
                    let Some(&(_, c)) = living.iter().find(|(p, _)| p == id) else {
                        continue;
                    };
                    let Some(&(enemy, e_now)) = living
                        .iter()
                        .filter(|(p, _)| p != id)
                        .min_by(|a, b| dist(a.1, c).total_cmp(&dist(b.1, c)))
                    else {
                        continue;
                    };
                    let then = history.front().expect("history");
                    let (Some(&(_, c0)), Some(&(_, e0))) = (
                        then.iter().find(|(p, _)| p == id),
                        then.iter().find(|(p, _)| *p == enemy),
                    ) else {
                        continue;
                    };
                    let approaching = dist(e0, c0) - dist(e_now, c) >= CLOSING;
                    eprintln!(
                        "tick {}: Frost {id:?} walls at ({x:.0}, {y:.0}); enemy {enemy:?} {:.0} u away (was {:.0}), between: {}",
                        out.ticks,
                        dist(e_now, c),
                        dist(e0, c0),
                        between(c, e_now, aim)
                    );
                    if approaching && between(c, e_now, aim) {
                        out.peel_walls += 1;
                    }
                }
                Event::CastLanded {
                    id,
                    ability: AbilityId::Freeze,
                    ..
                } if is_frost(&env, *id) => landed.push(*id),
                Event::Death { id, by, .. } if *by == Some(*id) => out.self_kills += 1,
                _ => {}
            }
        }
        for id in landed {
            let was = before.iter().find(|(p, _)| *p == id).expect("caster").1;
            let now = env.sim.player(id).expect("caster").pos();
            out.caster_moved_on_landing = out.caster_moved_on_landing.max(dist(now, was));
            watch.push((id, out.ticks, accepted(&env, id)));
        }
        let ticks = out.ticks;
        let mut idle = 0;
        watch.retain(|&(id, at, then)| {
            if ticks < at + ACT_WINDOW {
                return true;
            }
            let alive = env
                .sim
                .player(id)
                .is_some_and(|p| p.status == Status::Alive);
            if alive && accepted(&env, id) == then {
                idle += 1;
            }
            false
        });
        out.idle_after_wall += idle;
        if progress.terminated || progress.truncated {
            break;
        }
    }
    out.faults = env.seat_stats().iter().filter(|s| s.2.is_some()).count();
    out
}

/// P-FROST-WALL-3's no-stall criteria (`tests/frost_wall_live.rs`).
fn assert_no_stall(kind: &str, w: &Walls) {
    assert_eq!(w.faults, 0, "{kind}: no seat faulted ({w:?})");
    assert_eq!(w.self_kills, 0, "{kind}: nobody killed itself ({w:?})");
    assert!(
        w.caster_moved_on_landing < 20.,
        "{kind}: no Frost caster was set down by its own wall ({w:?})"
    );
    assert_eq!(
        w.idle_after_wall, 0,
        "{kind}: every living caster kept acting after its wall ({w:?})"
    );
}

/// The Brain (the learner's and the tuner's bot) in three live matches cut off at 3,600 ticks: at least one Frost wall
/// between its caster and an enemy coming at it, and no stall. Measured with a throw-away implementation (the brief's
/// baseline): seeds 2, 3 and 6 raise 3, 2 and 3 walls, one peel wall each.
///
/// HumanBot is not measured here: in its live matches (seeds 1-30, the brief's baseline) a Frost HumanBot is never
/// chased by a player inside the 56-260 u window; its walls are escapes from mobs. Its peel is pinned at the seat level
/// (`crates/rh-policy/src/bots/frost_wall_bots_tests.rs`), its live smoke in `tests/frost_wall_live.rs`.
#[test]
#[cfg_attr(
    debug_assertions,
    ignore = "full-map 8-Brain matches: run with `cargo test --release -p rh-headless --test frost_wall_bots`"
)]
fn live_brains_wall_off_the_enemies_coming_at_them() {
    let mut peel_walls = 0;
    for seed in [2, 3, 6] {
        let w = run(BotKind::Brain, seed, 3600);
        eprintln!("Brain seed {seed}: {w:?}");
        assert_no_stall(&format!("Brain seed {seed}"), &w);
        peel_walls += w.peel_walls;
    }
    assert!(
        peel_walls >= 1,
        "a Frost Brain raised a wall between itself and an enemy coming at it ({peel_walls} over seeds 2, 3, 6)"
    );
}
