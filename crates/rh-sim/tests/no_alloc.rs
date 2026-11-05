//! The allocation-free tick (P7a), as a permanent gate: after warm-up a steady-state `Sim::step_into` allocates nothing, on
//! the legacy-captured crowded fight and on the two chase duels (which exercise the path search).
//!
//! A step is steady when it is past the warm-up (every reused buffer has reached its working size) and ends no one's run: a
//! result is a `String`-carrying event by design (it is banked), so the steps that resolve a player are not counted. Every
//! other step must show zero allocations, so a new per-tick `Vec`, `collect()` or `String` in a system fails this test
//! instead of waiting for a profile.

use rh_sim::events::Event;
use rh_sim::sim::{Arena, Placement, PlayerId, Secrets, Sim, SimConfig};
use rh_sim::{validate, Command, FactionId, RawCommand, TileMap, Vec2};
use serde_json::Value;
use std::path::Path;

#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;

/// Ticks run before anything is counted: the reused buffers (event log, ledger, path scratch, the path search arrays) have
/// all met their largest need by then on these fixtures.
const WARM_UP_TICKS: u32 = 100;

struct Scenario {
    sim: Sim,
    /// `by_tick[t]`: the commands fed before step `t + 1`, in fixture order.
    by_tick: Vec<Vec<(PlayerId, Command)>>,
    ticks: u32,
}

fn load(name: &str) -> Scenario {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../parity/fixtures/{name}.json"));
    let fx: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let rows: Vec<&str> = fx["map"]["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r.as_str().unwrap())
        .collect();
    let arena = Arena {
        map: TileMap::from_rows(&rows).unwrap(),
        spawns: Vec::new(),
    };
    let f = |v: &Value, k: &str| v[k].as_f64().unwrap();
    let placements: Vec<Placement> = fx["players"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| Placement {
            profile: p["id"].as_str().unwrap().to_uppercase(),
            faction: FactionId::parse(p["faction"].as_str().unwrap()).unwrap(),
            bot: false,
            at: Vec2::new(f(p, "x"), f(p, "y")),
            hp: Some(f(p, "hp")),
            weapon0: p["weapon0"].as_str().and_then(rh_sim::WeaponId::parse),
            weapon1: p["weapon1"].as_str().and_then(rh_sim::WeaponId::parse),
        })
        .collect();
    let secrets = Secrets {
        order_salt: fx["legacyConfig"]["orderSalt"].as_u64().unwrap() as u32,
        spawn_seed: 0,
    };
    let config = SimConfig {
        faction_mode: if fx["legacyConfig"]["rustSlice"] == "player-engagement-holy-plague-fire/1" {
            rh_sim::FactionMode::EngagementHolyPlagueFire
        } else if fx["legacyConfig"]["rustSlice"] == "player-engagement-holy-plague/1" {
            rh_sim::FactionMode::EngagementHolyPlague
        } else if fx["packet"] == "P-FACTION-1" && fx["parity"] == "slice" {
            rh_sim::FactionMode::EngagementHoly
        } else {
            rh_sim::FactionMode::Off
        },
        weapon_specials: fx["legacyConfig"]["options"]["weaponSpecials"]
            .as_bool()
            .unwrap_or(true),
        ..Default::default()
    };
    let mut sim = Sim::reset_active(config, arena, secrets, &placements);
    if let Some(drops) = fx["legacyConfig"]["setup"]["containers"].as_array() {
        for drop in drops {
            sim.seed_weapon_container(
                rh_sim::ContainerKind::Ground,
                Vec2::new(f(&drop["at"], "x"), f(&drop["at"], "y")),
                &[rh_sim::WeaponId::parse(drop["weapon"].as_str().unwrap()).unwrap()],
            )
            .unwrap();
        }
    }
    let ticks = fx["ticks"].as_array().unwrap().len() as u32;
    let mut by_tick: Vec<Vec<(PlayerId, Command)>> = vec![Vec::new(); ticks as usize + 2];
    for i in fx["inputs"].as_array().unwrap() {
        let m = &i["msg"];
        let g = |k: &str| m.get(k).and_then(Value::as_f64);
        let seq = m.get("seq").and_then(Value::as_u64).map(|v| v as u8);
        let raw = match i["type"].as_str().unwrap() {
            "target" => RawCommand::Target {
                id: PlayerId(m["id"].as_str().unwrap()[1..].parse::<u32>().unwrap() + 1),
            },
            "attackMove" => RawCommand::AttackMove {
                x: g("x").unwrap(),
                y: g("y").unwrap(),
                seq,
            },
            "move" => RawCommand::Move {
                x: g("x").unwrap(),
                y: g("y").unwrap(),
                seq,
            },
            "stop" => RawCommand::Stop { seq },
            "aim" => RawCommand::Aim { a: g("a").unwrap() },
            "attack" => RawCommand::Attack {
                a: g("a").unwrap(),
                t: g("t"),
            },
            "release" => RawCommand::Release {
                a: g("a").unwrap(),
                t: g("t"),
            },
            "swap" => RawCommand::Swap {
                slot: m["slot"].as_u64().map(|n| n as u8),
            },
            "pickup" => RawCommand::Pickup {
                container_id: u32::from_str_radix(
                    m["containerId"]
                        .as_str()
                        .unwrap()
                        .strip_prefix('c')
                        .unwrap(),
                    36,
                )
                .unwrap(),
            },
            other => panic!("input type {other}"),
        };
        let who = i["player"].as_str().unwrap();
        let id = PlayerId(who.trim_start_matches('p').parse::<u32>().unwrap() + 1);
        let tick = (i["tick"].as_u64().unwrap() as usize).min(by_tick.len() - 1);
        by_tick[tick].push((id, validate(raw).unwrap()));
    }
    Scenario {
        sim,
        by_tick,
        ticks,
    }
}

/// Runs the scenario, returning (steady steps counted, allocations in them, the first offending tick).
fn run(name: &str, warm_up: u32, end: u32) -> (u32, u64, Option<u32>) {
    let mut sc = load(name);
    let mut out: Vec<Event> = Vec::with_capacity(64);
    let mut projectors: Vec<_> = sc
        .sim
        .players()
        .iter()
        .map(|p| rh_sim::FxProjector::attach(&sc.sim, p.id))
        .collect();
    let (mut steady, mut allocs, mut first_bad) = (0u32, 0u64, None);
    for n in 0..sc.ticks.min(end) {
        let tick = sc.sim.tick() + 1;
        for (id, cmd) in &sc.by_tick[tick as usize] {
            let _ = sc.sim.submit_unbudgeted(*id, *cmd);
        }
        out.clear();
        // The schedule trace (a test-only feature) is a growing log: keep it bounded so it is not counted as the tick's.
        #[cfg(feature = "schedule-trace")]
        sc.sim.clear_schedule_trace();
        let before = dhat::HeapStats::get().total_blocks;
        sc.sim.step_into(&mut out);
        for projector in &mut projectors {
            projector.feed(sc.sim.fx_report()).unwrap();
        }
        let used = dhat::HeapStats::get().total_blocks - before;
        let ends_a_run = out
            .iter()
            .any(|e| matches!(e, Event::Resolved { .. } | Event::Victory { .. }));
        if n >= warm_up && !ends_a_run {
            steady += 1;
            allocs += used;
            if used > 0 && first_bad.is_none() {
                first_bad = Some(tick);
            }
        }
    }
    (steady, allocs, first_bad)
}

/// Eight real Holy sword users in one melee arc cluster. Each contacts several victims per pass.
fn holy_crowded() {
    let ps: Vec<_> = (0..8)
        .map(|i| {
            let a = i as f64 * std::f64::consts::TAU / 8.0;
            Placement {
                profile: format!("h{i}"),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(
                    400. + 30. * rh_sim::math::cos(a),
                    400. + 30. * rh_sim::math::sin(a),
                ),
                hp: None,
                weapon0: Some(rh_sim::WeaponId::Sword),
                weapon1: None,
            }
        })
        .collect();
    let mut sim = Sim::reset_active(
        SimConfig {
            faction_mode: rh_sim::FactionMode::EngagementHoly,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(19),
        &ps,
    );
    for (i, p) in ps.iter().enumerate() {
        sim.submit(
            PlayerId(i as u32 + 1),
            validate(RawCommand::Attack {
                a: rh_sim::math::atan2(400. - p.at.y, 400. - p.at.x),
                t: None,
            })
            .unwrap(),
        )
        .unwrap();
    }
    let mut out = Vec::with_capacity(512);
    let (mut measured, mut allocations, mut heals) = (0, 0, 0);
    for n in 0..120 {
        out.clear();
        #[cfg(feature = "schedule-trace")]
        sim.clear_schedule_trace();
        let before = dhat::HeapStats::get().total_blocks;
        sim.step_into(&mut out);
        let used = dhat::HeapStats::get().total_blocks - before;
        heals += out
            .iter()
            .filter(|e| matches!(e, Event::Heal { .. }))
            .count();
        if n >= 12
            && !out
                .iter()
                .any(|e| matches!(e, Event::Resolved { .. } | Event::Victory { .. }))
        {
            measured += 1;
            allocations += used;
        }
        if sim.phase() == rh_sim::Phase::Ended {
            break;
        }
    }
    eprintln!(
        "Holy crowded: {measured} measured steps, {heals} real heals, {allocations} allocations"
    );
    assert!(heals >= 8);
    assert!(measured >= 10);
    assert_eq!(
        allocations, 0,
        "crowded Holy allocations over {measured} measured steps"
    );
}

#[test]
fn a_steady_state_step_allocates_nothing() {
    let _profiler = dhat::Profiler::builder().testing().build();
    holy_crowded();
    for name in [
        "crowded_8",
        "duel_chase",
        "fists_duel",
        "axe_shred_stack",
        "shield_block_riposte",
        "pickup_replace_drop",
    ] {
        let (steady, allocs, first_bad) = run(name, WARM_UP_TICKS, u32::MAX);
        assert!(
            steady >= 100,
            "{name}: only {steady} steady steps were counted"
        );
        assert_eq!(
            allocs, 0,
            "{name}: {allocs} allocations over {steady} steady steps (first at tick {first_bad:?})"
        );
    } // These short, frozen pressure cases contain 96 steps. Warm the reusable swept/stretches
      // and ledger buffers through both missile types, then count each remaining complete step.
    for name in [
        "bow_duel",
        "wand_duel",
        "ball_vs_arrow",
        "shield_arrow_reflect",
        "sword_swing_ball",
        "wand_splash_group",
    ] {
        let (steady, allocs, bad) = run(name, 40, u32::MAX);
        assert_eq!(steady, 56, "{name}");
        assert_eq!(allocs, 0, "{name}: first allocation at {bad:?}");
    }
    for name in [
        "fire_whiff_thirdparty",
        "fire_wand_pause",
        "fire_projectile_requests",
        "plague_thresholds_swap",
        "plague_wand_pause",
        "holy_lifesteal_low_hp",
        "holy_sword_shield",
        "holy_arrow_reflection",
        "holy_wand_splash",
        "holy_contact_forget",
        "holy_contact_tie_12",
    ] {
        let (steady, allocs, bad) = run(name, 40, u32::MAX);
        eprintln!("{name}: {steady} measured steps, {allocs} allocations");
        assert!(steady >= 25, "{name}");
        assert_eq!(allocs, 0, "{name}: allocation at {bad:?}");
    }
    // Track repeated accepted/rejected wall searches and the live LOS-grace chase before
    // the first flight of those scenarios grows its own independent projectile buffers.
    for (name, warm, end) in [
        ("bow_wand_lock_combat", 200, u32::MAX),
        ("wand_path_search_throttle", 6, 24),
        ("wand_lock_los_grace", 18, 37),
        ("wand_attack_move_id_tie", 35, u32::MAX),
    ] {
        let (steady, allocs, bad) = run(name, warm, end);
        assert!(steady > 10, "{name}");
        assert_eq!(allocs, 0, "{name}: first allocation at {bad:?}");
    }
}
