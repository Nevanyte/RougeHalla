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
        reward_salt: [0x12345678, 0x9abcdef0, 0x31415926, 0x27182818],
    };
    let config = SimConfig {
        quests: false,
        consumables: false,
        faction_mode: if fx["legacyConfig"]["rustSlice"]
            == "player-engagement-holy-plague-fire-frost/1"
        {
            rh_sim::FactionMode::EngagementHolyPlagueFireFrost
        } else if fx["legacyConfig"]["rustSlice"] == "player-engagement-holy-plague-fire/1" {
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
        regen: fx["legacyConfig"]["options"]["regen"]
            .as_bool()
            .unwrap_or(false),
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
            quests: false,
            consumables: false,
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

/// Eight-player Frost, ongoing Draws/Casts and repeated exposure departures/returns, every retained observer feed.
fn frost_crowded() {
    let ps: Vec<_> = (0..8)
        .map(|i| Placement {
            profile: format!("f{i}"),
            faction: if i % 4 == 0 {
                FactionId::Frost
            } else {
                FactionId::Holy
            },
            bot: false,
            at: Vec2::new(400. + (i % 4) as f64 * 25., 320. + (i / 4) as f64 * 25.),
            hp: Some(8000.),
            weapon0: Some(if i % 2 == 0 {
                rh_sim::WeaponId::Bow
            } else {
                rh_sim::WeaponId::Wand
            }),
            weapon1: None,
        })
        .collect();
    let mut sim = Sim::reset_active(
        SimConfig {
            quests: false,
            consumables: false,
            faction_mode: rh_sim::FactionMode::EngagementHolyPlagueFireFrost,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(31),
        &ps,
    );
    let mut out = Vec::with_capacity(256);
    let mut projectors: Vec<_> = (1..=8)
        .map(|i| rh_sim::FxProjector::attach(&sim, PlayerId(i)))
        .collect();
    let mut observers: Vec<_> = (1..=8)
        .map(|i| rh_sim::ItemObserver::new(PlayerId(i)))
        .collect();
    let mut views: Vec<_> = (0..8).map(|_| rh_sim::Observation::default()).collect();
    let mut caches: Vec<_> = (0..8).map(|_| rh_sim::SightCache::default()).collect();
    let (mut allocations, mut measured, mut draws) = (0, 0, 0);
    for t in 0..660 {
        if t % 25 == 0 {
            for i in 1..=8 {
                sim.submit(
                    PlayerId(i),
                    validate(RawCommand::Attack {
                        a: if i % 2 == 0 { std::f64::consts::PI } else { 0. },
                        t: None,
                    })
                    .unwrap(),
                )
                .unwrap();
            }
        }
        if t % 200 == 30 || t % 200 == 180 {
            let x = if t % 200 == 30 { 800. } else { 475. };
            sim.submit(
                PlayerId(2),
                validate(RawCommand::Move {
                    x,
                    y: 345.,
                    seq: None,
                })
                .unwrap(),
            )
            .unwrap();
        }
        #[cfg(feature = "schedule-trace")]
        sim.clear_schedule_trace();
        out.clear();
        let before = dhat::HeapStats::get().total_blocks;
        sim.step_into(&mut out);
        for i in 0..8 {
            projectors[i].feed(sim.fx_report()).unwrap();
            observers[i]
                .observe_into(&sim, &out, &mut views[i], Some(&mut caches[i]))
                .unwrap();
        }
        let used = dhat::HeapStats::get().total_blocks - before;
        if t >= 200
            && !out
                .iter()
                .any(|e| matches!(e, Event::Resolved { .. } | Event::Victory { .. }))
        {
            allocations += used;
            measured += 1;
        }
        if sim.players().iter().any(|p| {
            p.signature.chill < 1.
                && p.weapon
                    .action
                    .is_some_and(|a| a.kind == rh_sim::state::ActionKind::Draw)
        }) {
            draws += 1;
        }
    }
    assert!(measured >= 400 && draws > 100);
    assert_eq!(
        allocations, 0,
        "eight-player Frost allocations over {measured} steps"
    );
}

/// Eight-player real command production, Mark tiers/swaps, mixed signatures and every retained feed.
fn sentenced_crowded() {
    let ps: Vec<_> = (0..8)
        .map(|i| Placement {
            profile: format!("f{i}"),
            faction: [
                FactionId::Sentenced,
                FactionId::Fire,
                FactionId::Plague,
                FactionId::Frost,
                FactionId::Holy,
                FactionId::Sentenced,
                FactionId::Fire,
                FactionId::Plague,
            ][i],
            bot: false,
            at: Vec2::new(400. + (i % 4) as f64 * 25., 320. + (i / 4) as f64 * 25.),
            hp: Some(24000.),
            weapon0: Some(if i % 2 == 0 {
                rh_sim::WeaponId::Bow
            } else {
                rh_sim::WeaponId::Wand
            }),
            weapon1: Some(rh_sim::WeaponId::Sword),
        })
        .collect();
    let mut sim = Sim::reset_active(
        SimConfig {
            quests: false,
            consumables: false,
            faction_mode: rh_sim::FactionMode::EngagementHolyPlagueFireFrostSentenced,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(31),
        &ps,
    );
    let mut out = Vec::with_capacity(256);
    let mut projectors: Vec<_> = (1..=8)
        .map(|i| rh_sim::FxProjector::attach(&sim, PlayerId(i)))
        .collect();
    let mut observers: Vec<_> = (1..=8)
        .map(|i| rh_sim::ItemObserver::new(PlayerId(i)))
        .collect();
    let mut views: Vec<_> = (0..8).map(|_| rh_sim::Observation::default()).collect();
    let mut caches: Vec<_> = (0..8).map(|_| rh_sim::SightCache::default()).collect();
    let (mut allocations, mut measured, mut draws, mut pulses, mut top_tiers) = (0, 0, 0, 0, 0);
    let (mut max_raw, mut max_instant, mut max_keys) = (0, 0, 0);
    for t in 0..1060 {
        if t % 25 == 0 {
            for i in 1..=8 {
                sim.submit(
                    PlayerId(i),
                    validate(RawCommand::Attack {
                        a: if i % 2 == 0 { std::f64::consts::PI } else { 0. },
                        t: None,
                    })
                    .unwrap(),
                )
                .unwrap();
            }
        }
        if t % 80 == 60 {
            for i in 1..=8 {
                sim.submit(
                    PlayerId(i),
                    validate(RawCommand::Swap { slot: None }).unwrap(),
                )
                .unwrap();
            }
        }
        if t % 200 == 30 || t % 200 == 180 {
            let x = if t % 200 == 30 { 800. } else { 475. };
            sim.submit(
                PlayerId(2),
                validate(RawCommand::Move {
                    x,
                    y: 345.,
                    seq: None,
                })
                .unwrap(),
            )
            .unwrap();
        }
        #[cfg(feature = "schedule-trace")]
        sim.clear_schedule_trace();
        out.clear();
        let before = dhat::HeapStats::get().total_blocks;
        sim.step_into(&mut out);
        for i in 0..8 {
            projectors[i].feed(sim.fx_report()).unwrap();
            observers[i]
                .observe_into(&sim, &out, &mut views[i], Some(&mut caches[i]))
                .unwrap();
        }
        let used = dhat::HeapStats::get().total_blocks - before;
        max_raw = max_raw.max(out.len());
        let mut keys = [None; 16];
        let mut nkeys = 0;
        let mut instant = 0;
        for e in &out {
            if let Event::SignatureHit {
                victim, by, sig, ..
            } = *e
            {
                if !sig.is_dot() {
                    instant += 1;
                    let key = (victim, by, sig);
                    if !keys[..nkeys].contains(&Some(key)) {
                        keys[nkeys] = Some(key);
                        nkeys += 1;
                    }
                }
            }
        }
        max_instant = max_instant.max(instant);
        max_keys = max_keys.max(nkeys);
        pulses += sim
            .damage_entries()
            .iter()
            .filter(|e| e.sig == Some(rh_sim::factions::SignatureKind::Mark))
            .count();
        top_tiers += sim
            .players()
            .iter()
            .filter(|p| p.signature.mark.tier == 4)
            .count();
        if t >= 400
            && !out
                .iter()
                .any(|e| matches!(e, Event::Resolved { .. } | Event::Victory { .. }))
        {
            allocations += used;
            measured += 1;
        }
        if sim.players().iter().any(|p| {
            p.signature.chill < 1.
                && p.weapon
                    .action
                    .is_some_and(|a| a.kind == rh_sim::state::ActionKind::Draw)
        }) {
            draws += 1;
        }
    }
    assert!(
        measured >= 600 && draws > 10 && pulses > 50 && top_tiers > 50,
        "measured={measured} draws={draws} pulses={pulses} top_tiers={top_tiers}"
    );
    eprintln!("Sentenced crowded: {measured} measured zeroalloc steps; rawmax={max_raw}, instantmax={max_instant}, namedkeymax={max_keys}, pulses={pulses}, top-tierframes={top_tiers}");
    assert!(max_keys <= 8);
    assert_eq!(
        allocations, 0,
        "eight-player mixed Sentenced allocations over {measured} steps"
    );
}

/// Helper-only legal trusted tier-four/low-HP setup. Restore/refill happens outside each measured
/// denial pass; this isolates the same-tick payout and index rebuild from ordinary reachability.
fn sentenced_denial_refills() {
    let ps: Vec<_> = (0..3)
        .map(|i| Placement {
            profile: format!("d{i}"),
            faction: if i == 0 {
                FactionId::Sentenced
            } else if i == 1 {
                FactionId::Plague
            } else {
                FactionId::Holy
            },
            bot: false,
            at: Vec2::new(400. + i as f64 * 56., 320.),
            hp: None,
            weapon0: if i == 2 {
                Some(rh_sim::WeaponId::Axe)
            } else {
                None
            },
            weapon1: None,
        })
        .collect();
    let sim = Sim::reset_active(
        SimConfig {
            quests: false,
            consumables: false,
            faction_mode: rh_sim::FactionMode::EngagementHolyPlagueFireFrostSentenced,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(12),
        &ps,
    );
    let mut cp = serde_json::to_value(&sim).unwrap();
    let now = sim.server_time();
    cp["world"]["players"][0]["core"]["vitals"]["hp"] = serde_json::json!(20.);
    cp["world"]["players"][0]["core"]["vitals"]["barrier"] = serde_json::json!(60.);
    for (i, target) in [(0, 2), (1, 1)] {
        let sig = &mut cp["world"]["players"][i]["core"]["signature"];
        sig["target"] = serde_json::json!(target);
        sig["engaged"] = serde_json::json!(true);
        sig["in_reach"] = serde_json::json!(true);
        sig["contact_at"] = serde_json::json!(now);
        sig["reach_at"] = serde_json::json!(now);
    }
    // A singleton Mark now carries its typed historical target group, including trusted helper setups.
    cp["world"]["players"][0]["core"]["signature"]["mark"]["group"] =
        serde_json::json!({"Fighter": 2});
    cp["world"]["players"][0]["core"]["signature"]["mark"]["group_size"] = serde_json::json!(1);
    cp["world"]["players"][0]["core"]["signature"]["mark"]["tier"] = serde_json::json!(4);
    cp["world"]["players"][0]["core"]["signature"]["mark"]["hits"] = serde_json::json!(9);
    cp["world"]["players"][0]["core"]["signature"]["mark"]["progress"] = serde_json::json!(9.);
    let mut allocations = 0;
    for _ in 0..32 {
        let mut sim = Sim::restore(&cp).unwrap();
        let mut out = Vec::with_capacity(512);
        let mut projector = rh_sim::FxProjector::attach(&sim, PlayerId(1));
        let mut observer = rh_sim::ItemObserver::new(PlayerId(1));
        let mut view = rh_sim::Observation::default();
        let mut cache = rh_sim::SightCache::default();
        sim.submit(
            PlayerId(3),
            validate(RawCommand::Attack {
                a: std::f64::consts::PI,
                t: None,
            })
            .unwrap(),
        )
        .unwrap();
        let mut measured = false;
        for _ in 0..100 {
            out.clear();
            #[cfg(feature = "schedule-trace")]
            sim.clear_schedule_trace();
            let before = dhat::HeapStats::get().total_blocks;
            sim.step_into(&mut out);
            projector.feed(sim.fx_report()).unwrap();
            observer
                .observe_into(&sim, &out, &mut view, Some(&mut cache))
                .unwrap();
            let used = dhat::HeapStats::get().total_blocks - before;
            if sim.players()[0].signature.mark.denied {
                assert!(sim.players()[0].standing());
                assert_eq!(sim.players()[0].credit.sentence, 1);
                allocations += used;
                measured = true;
                break;
            }
        }
        assert!(
            measured,
            "warm normal DoT/shred passes precede the measured denial"
        );
    }
    assert_eq!(
        allocations, 0,
        "restored/refilled helper-only denial payout passes"
    );
}

#[test]
fn a_steady_state_step_allocates_nothing() {
    let _profiler = dhat::Profiler::builder().testing().build();
    holy_crowded();
    wind_hot();
    potion_hot_ticks();
    frost_crowded();
    sentenced_crowded();
    sentenced_denial_refills();
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
        "frost_weapon_bow",
        "frost_weapon_wand",
        "frost_multisource_thaw",
        "frost_ranged_splash",
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
        // The passive regeneration share: a quiet heal every tick once a fighter is below max hp.
        "regen_clock",
    ] {
        // These movement fixtures first exercise path search at tick100/tick66.
        let warm = match name {
            "frost_multisource_thaw" => 110,
            "frost_ranged_splash" => 90,
            _ => 40,
        };
        let (steady, allocs, bad) = run(name, warm, u32::MAX);
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

/// Wind emblems: one natural spawn and a real walk-over in setup, then 100 steady boost/expiry steps with the system live.
fn wind_hot() {
    let ps = vec![
        Placement {
            profile: "wind0".into(),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(320., 320.),
            hp: Some(300.),
            weapon0: None,
            weapon1: None,
        },
        Placement {
            profile: "wind1".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(1400., 272.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
    ];
    let mut sim = Sim::reset_active(
        SimConfig {
            consumables: true,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(77),
        &ps,
    );
    let mut at = None;
    for _ in 0..600 {
        sim.step();
        if let Some(c) = sim
            .containers()
            .iter()
            .find(|c| c.kind == rh_sim::state::ContainerKind::WindEmblem)
        {
            at = Some(c.at);
            break;
        }
    }
    let at = at.expect("a wind emblem spawns");
    sim.submit(
        PlayerId(1),
        validate(RawCommand::Move {
            x: at.x,
            y: at.y,
            seq: None,
        })
        .unwrap(),
    )
    .unwrap();
    let mut ev = Vec::new();
    let mut walked = 0u32;
    while sim.players()[0].speed_boost_until == 0. && walked < 400 {
        sim.step_into(&mut ev);
        walked += 1;
    }
    assert!(
        sim.players()[0].speed_boost_until > 0.,
        "walked over an emblem in {walked} steps"
    );
    sim.submit(
        PlayerId(1),
        validate(RawCommand::Stop { seq: None }).unwrap(),
    )
    .unwrap();
    sim.step_into(&mut ev);
    let mut out = Vec::with_capacity(64);
    let (mut measured, mut allocations) = (0u32, 0u64);
    for _ in 0..120 {
        #[cfg(feature = "schedule-trace")]
        sim.clear_schedule_trace();
        out.clear();
        let before = dhat::HeapStats::get().total_blocks;
        sim.step_into(&mut out);
        allocations += dhat::HeapStats::get().total_blocks - before;
        measured += 1;
    }
    assert_eq!(sim.players()[0].speed_boost_until, 0., "the boost expired");
    eprintln!("wind emblem: {measured} measured steps, {allocations} allocations");
    assert_eq!(allocations, 0, "wind emblem allocations");
}

/// A potion's Hot ticks: three potions are drunk in setup (the use action allocates its Hot vector by design), then every
/// 500 ms step heals; the warmed steps after the use must allocate nothing.
fn potion_hot_ticks() {
    let ps: Vec<_> = (0..2)
        .map(|i| Placement {
            profile: format!("hot{i}"),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(320.0 + 64.0 * i as f64, 320.0),
            hp: Some(300.0),
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let sim = Sim::reset_active(
        SimConfig::default(),
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(41),
        &ps,
    );
    // The checkpoint JSON is the documented world layout: seed both stocks and restore (setup, outside the measurement).
    let mut json = serde_json::to_value(&sim).unwrap();
    json["world"]["players"][0]["potion_large"] = 5.into();
    json["world"]["players"][0]["potion_small"] = 5.into();
    let mut sim = Sim::restore(&json).unwrap();
    for _ in 0..3 {
        sim.submit(PlayerId(1), validate(RawCommand::UseConsumable).unwrap())
            .unwrap();
    }
    let _ = sim.step();
    assert_eq!(sim.players()[0].potions_healing, 3, "three Hot stacks");
    let mut out = Vec::with_capacity(128);
    let (mut measured, mut allocations, mut heals) = (0u32, 0u64, 0u32);
    for _ in 0..100 {
        out.clear();
        // The schedule trace (a test-only feature) is a growing log: keep it bounded so it is not counted as the tick's.
        #[cfg(feature = "schedule-trace")]
        sim.clear_schedule_trace();
        let before = dhat::HeapStats::get().total_blocks;
        sim.step_into(&mut out);
        let used = dhat::HeapStats::get().total_blocks - before;
        heals += out
            .iter()
            .filter(|e| matches!(e, Event::Heal { .. }))
            .count() as u32;
        measured += 1;
        allocations += used;
    }
    eprintln!("potion Hot: {measured} measured steps, {heals} heals, {allocations} allocations");
    assert!(heals >= 17, "the three Hots ticked until the pool filled");
    assert_eq!(allocations, 0, "potion Hot ticks allocate nothing");
}
