//! P-BOT-BRAIN-LIVE-1 composer oracles: composed percepts keep the source grammar (the frozen-corpus validators in
//! `source_input.rs`), carry `undefined` only at the documented degraded leaves, and depend on nothing the viewer is not
//! sent (two worlds that differ only in a hidden actor compose identical records and identical commands).
use super::super::super::modules::source_reader::SVal;
use super::super::source_input::build_percept;
use super::super::trace::BVal;
use super::test_support::seed1_arena;
use crate::bots::brain_bot::Tap;
use crate::bots::{BrainBot, PersonaId, TierId};
use crate::{drive_seats, scripted, MatchStart, Seat};
use rh_sim::{
    abilities, mob_runtime::MobMode, terrain, ArenaMode, Event, FactionId, FactionMode, Placement,
    PublicCommand, Secrets, Sim, SimConfig, Vec2,
};
use std::sync::{Arc, Mutex};

fn source_arena_config() -> SimConfig {
    SimConfig {
        walk_hints: Some(true),
        regen: true,
        quests: true,
        hazards: terrain::Mode::All,
        abilities: abilities::Mode::Full,
        faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
        lifecycle: ArenaMode::Source(Default::default()),
        mob_mode: MobMode::Pve,
        initial_loot: true,
        consumables: true,
        min_players: 1,
        lobby_seconds: 5.,
        fill_seconds: 3.,
        ..SimConfig::default()
    }
}

fn to_sval(value: &BVal) -> SVal {
    match value {
        BVal::Undefined => SVal::Undefined,
        BVal::Null => SVal::Null,
        BVal::Bool(v) => SVal::Bool(*v),
        BVal::Num(v) => SVal::Num(*v),
        BVal::Str(v) => SVal::Str(v.clone()),
        BVal::Arr(rows) => SVal::Arr(rows.iter().map(to_sval).collect()),
        BVal::Map(rows) => SVal::Map(rows.iter().map(|(k, v)| (to_sval(k), to_sval(v))).collect()),
        BVal::Set(rows) => SVal::Set(rows.iter().map(to_sval).collect()),
        BVal::U8(bytes) => SVal::U8(bytes.clone()),
        BVal::Obj(fields) => SVal::Obj(
            fields
                .iter()
                .map(|(k, v)| (k.clone(), to_sval(v)))
                .collect(),
        ),
        BVal::Instance { name, entries } => SVal::Instance {
            name: name.clone(),
            entries: entries
                .iter()
                .map(|(k, v)| (k.clone(), to_sval(v)))
                .collect(),
        },
        BVal::Callable => SVal::Callable,
    }
}

/// The documented degraded leaves (module doc of compose14.rs) and a placeholder of the declared type for each, plus the
/// leaves where the source itself declares `undefined` (`mobs[].type`, `containers[].weapon`).
fn placeholder(path: &str) -> Option<BVal> {
    let generic = path
        .split('.')
        .map(|part| part.split('[').next().unwrap_or(part))
        .collect::<Vec<_>>()
        .join(".");
    Some(match generic.as_str() {
        "self.attackTarget" => BVal::Null,
        "self.immuneUntil" | "hud.alive" | "hud.minPlayers" | "minimap.t" => BVal::num(0.),
        "self.name" | "fighters.name" | "projectiles.id" | "extras.fields.id" => BVal::text(""),
        "fighters.bot" => BVal::flag(false),
        "fighters.drawStartedAt" | "mobs.drawStartedAt" => BVal::num(0.),
        "projectiles.x0" | "projectiles.y0" | "projectiles.t0" | "projectiles.range" => {
            BVal::num(0.)
        }
        "events.weapon" => BVal::text("fists"),
        // P-BOT-BRAIN-RECONCILE-1 (brief 6.1, 6.2): a zombie's or a quest giver's name is not on the wire, and the
        // Wish rank is not either (2a's `extras.wish`); both are unknown, never a guessed "" or 1.
        "mobs.name" => BVal::text(""),
        "extras.wish.rank" => BVal::num(1.),
        // Source-declared optional `undefined` (kept as is).
        "mobs.type" | "containers.weapon" => BVal::Undefined,
        _ => return None,
    })
}

/// Replace every `undefined` at a documented leaf; any other `undefined` is a composer bug.
fn substitute(value: &BVal, path: &str, strays: &mut Vec<String>) -> BVal {
    match value {
        BVal::Undefined => placeholder(path).unwrap_or_else(|| {
            strays.push(path.to_string());
            BVal::Undefined
        }),
        BVal::Arr(rows) => BVal::Arr(
            rows.iter()
                .enumerate()
                .map(|(i, row)| substitute(row, &format!("{path}[{i}]"), strays))
                .collect(),
        ),
        BVal::Obj(fields) => BVal::Obj(
            fields
                .iter()
                .map(|(k, v)| {
                    let child = if path.is_empty() {
                        k.clone()
                    } else {
                        format!("{path}.{k}")
                    };
                    (k.clone(), substitute(v, &child, strays))
                })
                .collect(),
        ),
        other => other.clone(),
    }
}

/// Plays `players` Brain seats (one tapped per seat) from the lobby for `ticks` ticks.
fn tapped_match(seed: u64, players: usize, ticks: u32) -> Vec<Tap> {
    let arena = seed1_arena();
    let config = source_arena_config();
    let mut sim = Sim::new(config.clone(), arena.clone(), Secrets::from_seed(seed));
    let features = crate::bots::brain_features(&config, &arena);
    let mut taps = Vec::new();
    let mut seats = Vec::new();
    for i in 0..players {
        let id = sim
            .add_player(&format!("bot{i}"), Some(FactionId::ALL[i % 5]), true)
            .expect("seat");
        let tap: Tap = Arc::new(Mutex::new(Vec::new()));
        let policy = BrainBot::new(TierId::ALL[i % 3], PersonaId::ALL[i % 4], features.clone())
            .with_tap(tap.clone());
        let mut seat = Seat::new(
            &MatchStart::of(&sim, id, seed * 31 + i as u64),
            Box::new(policy),
            Box::new(scripted::Idle),
        );
        seat.bind_fx(&sim).expect("unbound");
        seats.push(seat);
        taps.push(tap);
    }
    let mut events: Vec<Event> = Vec::new();
    for _ in 0..ticks {
        drive_seats(&mut sim, &mut seats, &events);
        events.clear();
        sim.step_into(&mut events);
    }
    for seat in &seats {
        assert_eq!(seat.fault, None, "no Brain seat faults");
    }
    taps
}

#[test]
fn composed_percepts_keep_the_source_grammar_and_undefined_only_at_degraded_leaves() {
    let taps = tapped_match(5, 4, 900);
    let mut checked = 0;
    let mut phases = Vec::new();
    for tap in &taps {
        for (raw, _) in tap.lock().unwrap().iter() {
            let mut strays = Vec::new();
            let substituted = substitute(raw, "", &mut strays);
            assert!(
                strays.is_empty(),
                "undefined outside the degraded profile: {strays:?}"
            );
            let percept = build_percept(&to_sval(&substituted), "percept")
                .unwrap_or_else(|e| panic!("composed percept fails the source validators: {e}"));
            if !phases.contains(&percept.hud_phase) {
                phases.push(percept.hud_phase.clone());
            }
            checked += 1;
        }
    }
    assert!(
        checked > 1000,
        "every seat composed its decisions: {checked}"
    );
    for phase in ["lobby", "planning", "active"] {
        assert!(
            phases.iter().any(|p| p == phase),
            "the run reached {phase}: {phases:?}"
        );
    }
}

#[test]
fn composed_percepts_mark_every_unpublished_fact_undefined() {
    let taps = tapped_match(9, 2, 600);
    let (raw, _) = taps[0]
        .lock()
        .unwrap()
        .iter()
        .rev()
        .find(|(raw, _)| {
            raw.get("hud")
                .and_then(|h| h.get("phase"))
                .and_then(BVal::as_str)
                == Some("active")
        })
        .cloned()
        .expect("an active percept");
    let me = raw.get("self").unwrap();
    assert_eq!(me.get("immuneUntil"), Some(&BVal::Undefined));
    assert!(
        matches!(me.get("mobKills"), Some(BVal::Num(_))),
        "derived, never undefined"
    );
    let hud = raw.get("hud").unwrap();
    assert_eq!(hud.get("alive"), Some(&BVal::Undefined));
    assert_eq!(hud.get("minPlayers"), Some(&BVal::Undefined));
    let minimap = raw.get("minimap").unwrap();
    assert_eq!(minimap.get("t"), Some(&BVal::Undefined));
    assert_eq!(minimap.get("mobs"), Some(&BVal::Arr(Vec::new())));
    // P-BOT-BRAIN-RECONCILE-1 (brief 6.2): the seat composes with 2a's pinned world delay (INTERP_DELAY_MS).
    assert_eq!(
        raw.get("now").and_then(BVal::as_num).map(|now| now - 100.),
        raw.get("viewT").and_then(BVal::as_num),
        "the world delay is pinned to 100 ms"
    );
}

/// Two worlds that differ only in where a player this viewer cannot see stands: the viewer's composed records and its
/// commands are identical, tick for tick.
#[test]
fn a_hidden_state_twin_composes_identical_percepts_and_commands() {
    let arena = seed1_arena();
    // The source lifecycle without a planning phase, so the match starts active on the given placements.
    let config = SimConfig {
        abilities: abilities::Mode::Full,
        lifecycle: ArenaMode::Source(rh_sim::ArenaRules {
            plan_seconds: 0.,
            ..Default::default()
        }),
        ..SimConfig::default()
    };
    let features = crate::bots::brain_features(&config, &arena);
    let near = arena.spawns[0];
    let run = |hidden_at: Vec2| {
        let placements = [
            ("viewer", near),
            ("rival", Vec2::new(near.x + 96., near.y)),
            ("hidden", hidden_at),
        ]
        .map(|(profile, at)| Placement {
            profile: profile.into(),
            faction: FactionId::Fire,
            bot: true,
            at,
            hp: None,
            weapon0: None,
            weapon1: None,
        });
        let mut sim = Sim::reset_active(
            config.clone(),
            arena.clone(),
            Secrets::from_seed(4),
            &placements,
        );
        let viewer = sim.players()[0].id;
        let tap: Tap = Arc::new(Mutex::new(Vec::new()));
        let mut seats = vec![Seat::new(
            &MatchStart::of(&sim, viewer, 77),
            Box::new(
                BrainBot::new(TierId::Hard, PersonaId::Hunter, features.clone())
                    .with_tap(tap.clone()),
            ),
            Box::new(scripted::Idle),
        )];
        seats[0].bind_fx(&sim).expect("unbound");
        let mut events = Vec::new();
        for _ in 0..300 {
            drive_seats(&mut sim, &mut seats, &events);
            events.clear();
            sim.step_into(&mut events);
        }
        assert_eq!(seats[0].fault, None);
        let out: Vec<(BVal, Vec<PublicCommand>)> = tap.lock().unwrap().clone();
        out
    };
    // Two far spawns, well outside the viewer's sight radius and camera box.
    let w = f64::from(arena.map.w) * 32.;
    let h = f64::from(arena.map.h) * 32.;
    let corner = |x: f64, y: f64| {
        let mut best = arena.spawns[0];
        for s in &arena.spawns {
            if (s.x - x).abs() + (s.y - y).abs() < (best.x - x).abs() + (best.y - y).abs() {
                best = *s;
            }
        }
        best
    };
    let a = corner(w, h);
    let b = corner(w, 0.);
    assert!(rh_sim::math::hypot(a.x - near.x, a.y - near.y) > 1500.);
    assert!(rh_sim::math::hypot(b.x - near.x, b.y - near.y) > 1500.);
    assert_ne!(a, b);
    let one = run(a);
    let two = run(b);
    assert!(one.len() > 250, "the viewer decided every tick");
    assert!(
        one.iter().any(|(_, cmds)| !cmds.is_empty()),
        "the viewer acted, so equal commands are evidence"
    );
    assert_eq!(one.len(), two.len());
    for (tick, (x, y)) in one.iter().zip(&two).enumerate() {
        assert_eq!(x.0, y.0, "decision {tick}: the composed records differ");
        assert_eq!(x.1, y.1, "decision {tick}: the commands differ");
    }
}

/// Diagnostics: where a Brain seat's decision time goes (composer vs Brain tick), eight seats on the source arena.
/// Run in release: `cargo test --release -p rh-policy --lib profile_brain_seats -- --ignored --nocapture`.
#[test]
#[ignore = "profiling diagnostic"]
fn profile_brain_seats() {
    struct Timed(Arc<Mutex<BrainBot>>);
    impl crate::Policy for Timed {
        fn spec(&self) -> crate::PolicySpec {
            crate::Policy::spec(&*self.0.lock().unwrap())
        }
        fn input_kind(&self) -> crate::InputKind {
            crate::InputKind::Delivered14
        }
        fn reset(&mut self, m: &MatchStart) {
            crate::Policy::reset(&mut *self.0.lock().unwrap(), m)
        }
        fn check_input(&self, i: crate::InputPreview<'_>) -> Result<(), crate::InputRefusal> {
            crate::Policy::check_input(&*self.0.lock().unwrap(), i)
        }
        fn decide_input_into(
            &mut self,
            i: crate::PolicyInput<'_>,
            out: &mut Vec<PublicCommand>,
        ) -> Result<(), crate::InputRefusal> {
            crate::Policy::decide_input_into(&mut *self.0.lock().unwrap(), i, out)
        }
        fn decide(&mut self, _: &rh_sim::Observation) -> Vec<PublicCommand> {
            Vec::new()
        }
    }
    let ticks: u32 = std::env::var("BRAIN_PROFILE_TICKS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(2400);
    let arena = seed1_arena();
    let config = source_arena_config();
    let mut sim = Sim::new(config.clone(), arena.clone(), Secrets::from_seed(3));
    let features = crate::bots::brain_features(&config, &arena);
    let mut bots = Vec::new();
    let mut seats = Vec::new();
    for i in 0..8 {
        let id = sim
            .add_player(&format!("bot{i}"), Some(FactionId::ALL[i % 5]), true)
            .unwrap();
        let bot = Arc::new(Mutex::new(
            BrainBot::new(TierId::ALL[i % 3], PersonaId::ALL[i % 4], features.clone())
                .with_decision_timing(),
        ));
        let mut seat = Seat::new(
            &MatchStart::of(&sim, id, 31 + i as u64),
            Box::new(Timed(bot.clone())),
            Box::new(scripted::Idle),
        );
        seat.bind_fx(&sim).unwrap();
        seats.push(seat);
        bots.push(bot);
    }
    let mut events = Vec::new();
    for _ in 0..ticks {
        drive_seats(&mut sim, &mut seats, &events);
        events.clear();
        sim.step_into(&mut events);
    }
    for (i, bot) in bots.iter().enumerate() {
        let bot = bot.lock().unwrap();
        let mut all = bot.decision_ns().to_vec();
        let compose: u64 = bot.compose_ns().iter().sum();
        let total: u64 = all.iter().sum();
        all.sort_unstable();
        let p = |q: f64| {
            all.get(((all.len() as f64 - 1.) * q) as usize)
                .copied()
                .unwrap_or(0) as f64
                / 1e6
        };
        eprintln!(
            "seat {i}: {} decisions, mean {:.3} ms, p50 {:.3}, p99 {:.3}, max {:.3}; composer {:.0}% of the time",
            all.len(),
            total as f64 / all.len().max(1) as f64 / 1e6,
            p(0.5),
            p(0.99),
            p(1.0),
            100. * compose as f64 / total.max(1) as f64
        );
    }
}
