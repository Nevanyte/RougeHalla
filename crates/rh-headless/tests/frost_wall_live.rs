//! P-FROST-WALL-3 oracle (rh-headless): the Brain tournament world and every "as live" tool play Frost Wall, and the
//! live fill bots (HumanBot) and the Brain finish a live match with Frost seats under the wall.
//!
//! Bots and the wall (measured by the oracle author, 2026-11-14; the brief's "Bot evidence"): both bot stacks still
//! plan Frost's Wish as Freeze (a unit cast at a foe or chaser, `crates/rh-policy/src/bots/wish.rs:152-168`), and the
//! sim reads it as a point cast at the target's position, so the wall rises on or next to the target and sets it down
//! on its own side. Legacy's bots (`78dd8bd4` `packages/server/src/bots/abilityPolicy.ts:54-58`, `:97-101`, `:164-167`)
//! instead drop it 70% of the way to a chasing enemy. The cast is wasted, not harmful: no stall, no self-push, no
//! fault. Porting legacy's aim is a follow-up bot packet; this file only pins that a live match under the wall
//! finishes.
//!
//! The smoke matches take a few seconds in release and minutes in debug, so a debug build skips them:
//!   cargo test --locked --release -p rh-headless --test frost_wall_live
use rh_headless::tournament::{sim_config_for, TournamentPlan};
use rh_headless::tournament_learning::{tournament_world, SeatPolicy};
use rh_headless::{AgentSpec, BotKind, Env, EnvConfig};
use rh_policy::bots::TierId;
use rh_sim::status_runtime::AbilityId;
use rh_sim::{Event, FactionId, FrostWish, PlayerId, SimConfig, Status};

fn plan() -> TournamentPlan {
    let mut plan = TournamentPlan::with_tiers(
        2,
        7,
        vec![TierId::Easy, TierId::Normal, TierId::Hard],
        3. * 60_000.,
    );
    plan.patience_seconds = Some(60.);
    plan.sudden_death_seconds = Some(20.);
    plan
}

#[test]
fn the_brain_tournament_world_plays_frost_wall() {
    let (_, sim) = tournament_world(&plan(), SeatPolicy::Brain);
    assert_eq!(
        sim.frost_wish,
        FrostWish::Wall,
        "the learner and the tuner play the Wish the live server plays"
    );
}

#[test]
fn guard_the_human_tournament_world_keeps_the_default_freeze() {
    // The Human/Brawler tournament world is `sim_config_for(plan)` (the headless default world), not the live one: its
    // goldens stay byte-identical (P-SIM-LIVE-CONTENT-1, `brain_choices::guard_the_default_seats_play_todays_world`).
    assert_eq!(sim_config_for(&plan()).frost_wish, FrostWish::Freeze);
    let (_, human) = tournament_world(&plan(), SeatPolicy::Human);
    assert_eq!(human.frost_wish, FrostWish::Freeze);
}

/// The two examples that said "the live source-arena rules" in a literal (`source_soak.rs`, `full_map_cost.rs`) build
/// on the constructor, so the next live switch reaches them. The widened source scan in `tests/live_content.rs` catches
/// the literal; this catches an example that drops the literal for `SimConfig::default()` instead.
#[test]
fn the_live_examples_build_on_live_content() {
    for name in ["source_soak.rs", "full_map_cost.rs"] {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/examples/").to_owned() + name;
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
        assert!(
            text.contains("..SimConfig::live_content()"),
            "examples/{name} builds its live world on ..SimConfig::live_content()"
        );
        assert!(
            !text.contains("FrostWish::Freeze"),
            "examples/{name} states no Frost Wish of its own"
        );
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The release smoke: a live match with Frost seats under the wall.
// ---------------------------------------------------------------------------------------------------------------------

/// What one smoke match did.
#[derive(Debug, Default)]
struct Smoke {
    ticks: u32,
    terminated: bool,
    /// Frost Wishes that landed as a wall (the sim raised a barrier: a `CastLanded` of Frost's Wish in a Wall world).
    walls: u32,
    /// Seats with a policy fault (the runner's own stall/fault signal).
    faults: usize,
    /// Deaths a fighter caused to itself.
    self_kills: u32,
    /// The largest distance a Frost caster moved on the tick its own wall rose (a walking step is about 8.5 u; a caster
    /// set down by its own wall would move tens of units).
    caster_moved_on_landing: f64,
    /// Frost casters alive `ACT_WINDOW` ticks after their wall rose that had no command accepted in that window.
    idle_after_wall: u32,
}

/// Ticks (10 s) after a wall in which its living caster must have a command accepted (a stuck bot has none).
const ACT_WINDOW: u32 = 200;

fn arena() -> rh_sim::Arena {
    rh_headless::load_arena(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../rh-sim/src/mapdata/fixtures/seed1.map.json"
    ))
    .expect("admitted seed1 map")
}

/// Eight bots of `kind` on the admitted full map in the LIVE content world (short lobby timers only), factions dealt as
/// `examples/source_soak.rs` and `tests/brain_bots.rs` deal them, so seat `i` of seed `s` is Frost when `(i + s) % 5`
/// names Frost.
fn smoke(kind: BotKind, seed: u64, max_ticks: u32) -> Smoke {
    let arena = arena();
    let sim = SimConfig {
        min_players: 1,
        lobby_seconds: 5.,
        fill_seconds: 3.,
        ..SimConfig::live_content()
    };
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
    assert!(
        env.sim
            .players()
            .iter()
            .any(|p| p.faction_id() == Some(FactionId::Frost)),
        "the smoke seats a Frost bot"
    );
    let accepted = |env: &Env, id: PlayerId| {
        env.seat_stats()
            .iter()
            .find(|s| s.0 == id)
            .map_or(0, |s| s.1.accepted)
    };
    let mut out = Smoke::default();
    // (caster, tick the wall rose, accepted count then)
    let mut watch: Vec<(PlayerId, u32, u64)> = Vec::new();
    loop {
        let before: Vec<(PlayerId, rh_sim::Vec2)> =
            env.sim.players().iter().map(|p| (p.id, p.pos())).collect();
        let progress = env.advance(&[]);
        out.ticks += 1;
        let mut landed = Vec::new();
        for e in env.last_events() {
            match e {
                Event::CastLanded {
                    id,
                    ability: AbilityId::Freeze,
                    ..
                } if env
                    .sim
                    .player(*id)
                    .is_some_and(|p| p.faction_id() == Some(FactionId::Frost)) =>
                {
                    landed.push(*id);
                }
                Event::Death { id, by, .. } if *by == Some(*id) => out.self_kills += 1,
                _ => {}
            }
        }
        for id in landed {
            out.walls += 1;
            let was = before.iter().find(|(p, _)| *p == id).expect("caster").1;
            let now = env.sim.player(id).expect("caster").pos();
            out.caster_moved_on_landing = out
                .caster_moved_on_landing
                .max(((now.x - was.x).powi(2) + (now.y - was.y).powi(2)).sqrt());
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
            out.terminated = progress.terminated;
            break;
        }
    }
    out.faults = env.seat_stats().iter().filter(|s| s.2.is_some()).count();
    out
}

fn assert_no_stall(kind: &str, s: &Smoke) {
    eprintln!("{kind}: {s:?}");
    assert!(
        s.walls >= 1,
        "{kind}: a Frost bot raised at least one wall in the live world ({s:?})"
    );
    assert_eq!(s.faults, 0, "{kind}: no seat faulted ({s:?})");
    assert_eq!(s.self_kills, 0, "{kind}: nobody killed itself ({s:?})");
    assert!(
        s.caster_moved_on_landing < 20.,
        "{kind}: no Frost caster was set down by its own wall ({s:?})"
    );
    assert_eq!(
        s.idle_after_wall, 0,
        "{kind}: every living caster kept acting after its wall ({s:?})"
    );
}

/// HumanBot (the live fill bot), seed 6: Frost seats 2 and 7. Measured 2026-11-14 with the wall selected: the match
/// ends by its own rules at tick 3,738 (a Holy winner) after 3 walls; under Freeze the same seed is cut off at 9,000
/// ticks.
#[test]
#[cfg_attr(
    debug_assertions,
    ignore = "a full-map 8-bot match: run with `cargo test --release -p rh-headless --test frost_wall_live`"
)]
fn a_live_humanbot_match_with_frost_seats_finishes_under_the_wall() {
    let s = smoke(BotKind::Human, 6, 9000);
    assert!(
        s.terminated,
        "HumanBot: the match ends by its own rules within 9,000 ticks ({s:?})"
    );
    assert_no_stall("HumanBot", &s);
}

/// The Brain, seed 2: Frost seats 1 and 6. The Brain's matches last past 14,000 ticks, so this one is cut off at 3,600.
/// Measured 2026-11-14 with the wall selected: the first wall rises at tick 2,917 (11 over 14,000 ticks).
#[test]
#[cfg_attr(
    debug_assertions,
    ignore = "a full-map 8-Brain match: run with `cargo test --release -p rh-headless --test frost_wall_live`"
)]
fn a_live_brain_match_with_frost_seats_keeps_playing_under_the_wall() {
    let s = smoke(BotKind::Brain, 2, 3600);
    assert_no_stall("Brain", &s);
}
