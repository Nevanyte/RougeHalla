//! State identity by construction (docs/CONTRACTS.md C-DET): the state hash is derived from the serialized state, so every
//! serialized leaf must change it. This audits real matches and explicitly labelled coupled serialization seeds rather than
//! trusting a field list (the seeds are not gameplay-producer evidence): it serializes a
//! checkpoint, perturbs every leaf one at a time (numbers one ulp or one unit, bools flipped, strings changed, sequences
//! shortened, optional values removed or filled), restores the perturbed checkpoint and demands a different `state_hash`.
//! The allowlist of unhashed leaves is EMPTY, with one deliberate exclusion that is asserted rather than skipped: only the
//! statics secrets (`statics.secrets`) are held out of the hash. `World.spawn_rng` (derived from `spawn_seed`) is hashed
//! on purpose, so the hash itself is server-private (see ADR 0007).
//!
//! A perturbation the restore refuses (a map whose shape no longer fits, a middle id that collides in the ordered store)
//! is validated input, not an unhashed leaf; each such pattern must be in `VALIDATED`.

use rh_sim::arenas::practice_arena;
use rh_sim::{
    validate, Command, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, Vec2,
};

/// A command through the one door in (C-INPUT): these tests only use valid ones.
fn cmd(raw: RawCommand) -> Command {
    validate(raw).expect("a valid test command")
}
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

fn crowded_8() -> Sim {
    let factions = [
        FactionId::Holy,
        FactionId::Fire,
        FactionId::Frost,
        FactionId::Holy,
        FactionId::Fire,
        FactionId::Frost,
        FactionId::Holy,
        FactionId::Fire,
    ];
    let ps: Vec<Placement> = factions
        .iter()
        .enumerate()
        .map(|(i, &faction)| Placement {
            profile: format!("p{i}"),
            faction,
            bot: i % 3 == 2,
            at: Vec2::new(400.0 + 28.0 * (i % 4) as f64, 400.0 + 28.0 * (i / 4) as f64),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(9),
        &ps,
    )
}

fn drive(sim: &mut Sim, ticks: u32) {
    for t in 0..ticks {
        for i in 1..=8u32 {
            let a = (t as f64 * 0.05) + i as f64;
            let _ = sim.submit(PlayerId(i), cmd(RawCommand::Aim { a }));
            if t % 7 == 0 {
                let _ = sim.submit(PlayerId(i), cmd(RawCommand::Attack { a, t: None }));
            }
            if t % 7 == 3 {
                let _ = sim.submit(PlayerId(i), cmd(RawCommand::Release { a, t: None }));
            }
            if t % 11 == 5 {
                let _ = sim.submit(
                    PlayerId(i),
                    cmd(RawCommand::Move {
                        x: 300.0 + 40.0 * i as f64,
                        y: 500.0,
                        seq: Some((t % 200) as u8),
                    }),
                );
            }
        }
        sim.step();
    }
}

/// A lobby with named joiners, mid-lobby (a different phase and a roster of join names).
fn lobby_with_names() -> Sim {
    let mut s = Sim::new(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(21),
    );
    for (name, f) in [
        ("Ann", FactionId::Holy),
        ("Bo", FactionId::Fire),
        ("Cyrus The Long Named One", FactionId::Frost),
    ] {
        s.add_player(name, Some(f), false).unwrap();
    }
    s.add_player("bot-1", None, true).unwrap();
    for _ in 0..3 {
        s.step();
    }
    s
}

/// A leaver whose result waits between steps (`pending_events`), and a dropped connection.
fn lobby_after_leave() -> Sim {
    let mut s = lobby_with_names();
    s.mark_dropped(PlayerId(2), true);
    s.remove_player(PlayerId(3));
    s
}

/// Everyone nearly dead and in reach of a neighbour: kills, a winner and a finished run within the drive.
fn short_fuse() -> Sim {
    let ps: Vec<Placement> = (0..8)
        .map(|i| Placement {
            profile: format!("f{i}"),
            faction: [FactionId::Holy, FactionId::Fire, FactionId::Frost][i % 3],
            bot: i % 4 == 3,
            at: Vec2::new(400.0 + 20.0 * (i % 4) as f64, 400.0 + 20.0 * (i / 4) as f64),
            hp: Some(3.0),
            weapon0: None,
            weapon1: None,
        })
        .collect();
    Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(31),
        &ps,
    )
}

/// Commands accepted but not yet stepped: the input queues hold contents at hash time.
fn with_queued_inputs() -> Sim {
    let mut s = crowded_8();
    drive(&mut s, 25);
    for i in 1..=4u32 {
        let _ = s.submit(
            PlayerId(i),
            cmd(RawCommand::Move {
                x: 500.0 + i as f64,
                y: 450.0,
                seq: Some(i as u8),
            }),
        );
        let _ = s.submit(PlayerId(i), cmd(RawCommand::Aim { a: 0.25 * i as f64 }));
        let _ = s.submit(
            PlayerId(i),
            cmd(RawCommand::Attack {
                a: 0.5,
                t: Some(1.0),
            }),
        );
    }
    s
}

fn item_fight() -> Sim {
    let ps = (0..3)
        .map(|i| Placement {
            profile: format!("fighter{i}"),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(400.0 + 32.0 * i as f64, 400.0),
            hp: None,
            weapon0: Some(rh_sim::WeaponId::Axe),
            weapon1: Some(rh_sim::WeaponId::Shield),
        })
        .collect::<Vec<_>>();
    let mut sim = Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(2),
        &ps,
    );
    sim.seed_weapon_container(
        rh_sim::ContainerKind::Chest,
        ps[0].at,
        &[rh_sim::WeaponId::Wand, rh_sim::WeaponId::Bow],
    )
    .unwrap();
    sim.submit(PlayerId(1), cmd(RawCommand::Attack { a: 0.0, t: None }))
        .unwrap();
    sim.step();
    sim.submit(PlayerId(1), cmd(RawCommand::Swap { slot: Some(1) }))
        .unwrap();
    sim.submit(PlayerId(1), cmd(RawCommand::Pickup { container_id: 1 }))
        .unwrap();
    sim
}

fn locked_attack() -> Sim {
    let p = Placement {
        profile: "wand".into(),
        faction: FactionId::Holy,
        bot: false,
        at: Vec2::new(100., 272.),
        hp: None,
        weapon0: Some(rh_sim::WeaponId::Wand),
        weapon1: None,
    };
    let rival = Placement {
        profile: "rival".into(),
        at: Vec2::new(700., 272.),
        ..p.clone()
    };
    let distant = Placement {
        profile: "distant".into(),
        at: Vec2::new(1280., 272.),
        ..rival.clone()
    };
    let mut sim = Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(5),
        &[p, rival, distant],
    );
    sim.submit(
        PlayerId(1),
        cmd(RawCommand::AttackMove {
            x: 640.,
            y: 272.,
            seq: Some(5),
        }),
    )
    .unwrap();
    sim.step();
    assert_eq!(
        sim.player(PlayerId(1))
            .unwrap()
            .weapon
            .action
            .unwrap()
            .target,
        Some(PlayerId(2))
    );
    assert!(sim
        .player(PlayerId(1))
        .unwrap()
        .weapon
        .targeting
        .goal
        .is_some());
    sim
}

fn holy_engaged() -> Sim {
    let ps: Vec<_> = (0..3)
        .map(|i| Placement {
            profile: format!("h{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400.0 + 28.0 * i as f64, 320.0),
            hp: Some(500.0),
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let mut sim = Sim::reset_active(
        SimConfig {
            quests: false,
            consumables: true,
            faction_mode: rh_sim::FactionMode::EngagementHoly,
            ..Default::default()
        },
        practice_arena(),
        Secrets::from_seed(9),
        &ps,
    );
    for i in 1..=2 {
        sim.submit(PlayerId(i), cmd(RawCommand::Attack { a: 0.0, t: None }))
            .unwrap();
    }
    for _ in 0..4 {
        sim.step();
    }
    assert!(sim.players()[0].signature.engaged);
    sim
}

fn plague_window() -> Sim {
    let mut sim = holy_engaged();
    let mut cp = serde_json::to_value(&sim).unwrap();
    cp["statics"]["config"]["faction_mode"] = serde_json::json!("EngagementHolyPlague");
    cp["world"]["players"][0]["core"]["vitals"]["faction"] = serde_json::json!("Plague");
    sim = Sim::restore(cp).unwrap();
    sim.step();
    assert!(!sim.faction_runtime().dot.is_empty());
    sim
}

fn frost_window() -> Sim {
    let s = holy_engaged();
    let mut cp = serde_json::to_value(&s).unwrap();
    cp["statics"]["config"]["faction_mode"] = serde_json::json!("EngagementHolyPlagueFireFrost");
    cp["world"]["players"][1]["core"]["vitals"]["faction"] = serde_json::json!("Frost");
    let mut s = Sim::restore(cp).unwrap();
    for _ in 0..5 {
        s.step();
    }
    assert!(s.players().iter().any(|p| p.signature.chill < 1.));
    s
}

// Trusted representative Mark checkpoint: counter and optional-clock leaves must also perturb.
fn sentenced_window() -> Sim {
    let s = holy_engaged();
    let mut cp = serde_json::to_value(&s).unwrap();
    cp["statics"]["config"]["faction_mode"] =
        serde_json::json!("EngagementHolyPlagueFireFrostSentenced");
    cp["world"]["players"][0]["core"]["vitals"]["faction"] = serde_json::json!("Sentenced");
    let mut s = Sim::restore(cp).unwrap();
    for _ in 0..10 {
        s.step();
    }
    assert!(s.players()[0].signature.mark.tier > 0);
    let mut cp = serde_json::to_value(&s).unwrap();
    let now = s.server_time();
    cp["world"]["players"][0]["core"]["signature"]["mark"]["far_since"] = serde_json::json!(now);
    cp["world"]["players"][0]["core"]["signature"]["mark"]["amp_until"] =
        serde_json::json!(now + 1000.);
    Sim::restore(cp).unwrap()
}

/// Two bounded ordinary PvE states: real NPC decisions/signatures and a real cleared camp.
/// The admitted map and commands are the existing source-backed three-mob fixture.
fn mob_audit_states() -> (Sim, Sim) {
    let data = serde_json::from_str(include_str!("fixtures/mob-pve-map.json")).unwrap();
    let arena = rh_sim::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map: data,
    }
    .validate()
    .unwrap()
    .into_arena()
    .unwrap();
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/mob-pve-source.json")).unwrap();
    let case = &fixture["cases"][2];
    let placements: Vec<_> = case["input"]["players"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(i, p)| Placement {
            profile: format!("mob-audit-{i}"),
            faction: FactionId::parse(p["faction"].as_str().unwrap()).unwrap(),
            bot: false,
            at: Vec2::new(p["x"].as_f64().unwrap(), p["y"].as_f64().unwrap()),
            hp: None,
            weapon0: rh_sim::WeaponId::parse(p["weapon"].as_str().unwrap()),
            weapon1: None,
        })
        .collect();
    let mut secrets = Secrets::from_seed(1);
    secrets.spawn_seed = 12;
    secrets.reward_salt = [1, 2, 3, 4];
    let config = SimConfig {
        quests: false,
        consumables: true,
        mob_mode: rh_sim::mob_runtime::MobMode::Pve,
        ..Default::default()
    };
    let mut cleared = Sim::reset_active(config.clone(), arena.clone(), secrets, &placements);
    let mut engaged = Sim::reset_active(
        SimConfig {
            quests: false,
            consumables: true,
            faction_mode: rh_sim::FactionMode::EngagementHolyPlagueFire,
            ..config
        },
        arena,
        secrets,
        &placements,
    );
    let mut have_pending_attack = false;
    for frame in case["frames"].as_array().unwrap() {
        for c in frame["commands"].as_array().unwrap() {
            let player = PlayerId(c["actor"].as_str().unwrap()[1..].parse::<u32>().unwrap() + 1);
            let target = c["id"].as_str().unwrap();
            let target =
                PlayerId(3 + u32::from_str_radix(target.strip_prefix("mob").unwrap(), 36).unwrap());
            let command = cmd(RawCommand::Target { id: target });
            cleared.submit(player, command).unwrap();
            if !have_pending_attack {
                engaged.submit(player, command).unwrap();
            }
        }
        cleared.step();
        if !have_pending_attack {
            engaged.step();
            have_pending_attack = engaged.tick() >= 40
                && engaged
                    .mobs()
                    .iter()
                    .any(|m| m.core.weapon.action.is_some());
        }
        if cleared.camp_rosters()[0].state == 2 {
            break;
        }
    }
    assert!(have_pending_attack);
    assert_eq!(engaged.mobs().len(), 3);
    assert_eq!(cleared.camp_rosters()[0].state, 2);
    assert!(serde_json::to_value(&engaged).unwrap()["world"]["mobs"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| !m["brain"]["target"].is_null()));
    assert!(
        !serde_json::to_value(&cleared).unwrap()["world"]["mob_runtime"]["life"][0]["ward_owner"]
            .is_null()
    );
    (engaged, cleared)
}

/// Real native producer for the global optional slide audit; keep the large map's
/// already-covered grid out of the per-leaf perturbation campaign below.
fn native_ice_slide() -> Sim {
    let export: rh_sim::mapdata::MapExport =
        serde_json::from_str(include_str!("../src/mapdata/fixtures/seed1.map.json")).unwrap();
    let arena = export.validate().unwrap().into_arena().unwrap();
    let index = arena
        .map
        .layers()
        .unwrap()
        .data()
        .terrain
        .iter()
        .position(|v| *v == 6)
        .unwrap();
    let at = Vec2::new(
        (index % arena.map.w as usize) as f64 * 32. + 16.,
        (index / arena.map.w as usize) as f64 * 32. + 16.,
    );
    let ps = [
        Placement {
            profile: "ice-a".into(),
            faction: FactionId::Holy,
            bot: false,
            at,
            hp: None,
            weapon0: None,
            weapon1: None,
        },
        Placement {
            profile: "ice-b".into(),
            faction: FactionId::Holy,
            bot: false,
            at: arena.spawns[1],
            hp: None,
            weapon0: None,
            weapon1: None,
        },
    ];
    let mut sim = Sim::reset_active(
        SimConfig {
            quests: false,
            consumables: true,
            lifecycle: rh_sim::ArenaMode::Off,
            hazards: rh_sim::terrain::Mode::Map,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(1),
        &ps,
    );
    sim.submit(
        PlayerId(1),
        cmd(RawCommand::Move {
            x: at.x + 32.,
            y: at.y,
            seq: Some(1),
        }),
    )
    .unwrap();
    sim.step();
    assert!(sim.players()[0].motion.slip.is_some());
    sim
}

fn source_lifecycle_states() -> (Sim, Sim, Sim) {
    let mut sim = Sim::new(
        SimConfig {
            quests: false,
            consumables: true,
            lifecycle: rh_sim::ArenaMode::Source(rh_sim::ArenaRules {
                plan_seconds: 0.2,
                first_patience_seconds: Some(0.1),
                coliseum_schedule: Some(rh_sim::ColiseumSchedule {
                    first_seconds: 0.1,
                    second_seconds: 0.5,
                    repeat_seconds: 0.5,
                    min_gap_seconds: 0.1,
                }),
                ..Default::default()
            }),
            min_players: 2,
            fill_seconds: 0.,
            hazards: rh_sim::terrain::Mode::Off,
            ..Default::default()
        },
        practice_arena(),
        Secrets::from_seed(12),
    );
    for name in ["a", "b", "c", "d"] {
        sim.add_player(name, Some(FactionId::Holy), false).unwrap();
    }
    sim.step();
    sim.submit(
        PlayerId(1),
        cmd(RawCommand::Plan {
            spawn: Some(0),
            boon: Some(0),
            ready: Some(true),
        }),
    )
    .unwrap();
    let planning = sim.clone();
    for _ in 0..4 {
        sim.step();
    }
    let active = sim.clone();
    for _ in 0..2 {
        sim.step();
    }
    assert!(rh_sim::public_snapshot(&active)
        .arena
        .unwrap()
        .patience_ends_at
        .is_some());
    assert!(rh_sim::public_snapshot(&sim).arena.unwrap().gates_locked);
    (planning, active, sim)
}

/// Real Full producers populate the optional cast/card/stock/effect branches. Zero-time
/// Blaze/LastStand casts have already landed at the first ordinary checkpoint.
fn wish_states() -> Vec<(&'static str, Sim)> {
    let mut out = Vec::new();
    for (faction, accepted_name, landed_name) in [
        (FactionId::Frost, "Freeze pending", "Freeze landed"),
        (FactionId::Plague, "Swarm pending", "Swarm landed"),
        (FactionId::Sentenced, "Trial pending", "Trial landed"),
        (FactionId::Fire, "Blaze first charge", "Blaze trail"),
        (FactionId::Holy, "LastStand paid", "LastStand active"),
    ] {
        let placements = [
            (faction, 300.),
            (FactionId::Holy, 440.),
            (FactionId::Frost, 900.),
        ]
        .into_iter()
        .enumerate()
        .map(|(i, (faction, x))| Placement {
            profile: format!("wish{i}"),
            faction,
            bot: false,
            at: Vec2::new(x, 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect::<Vec<_>>();
        let mut sim = Sim::reset_active(
            SimConfig {
                quests: false,
                consumables: true,
                abilities: rh_sim::abilities::Mode::Full,
                lifecycle: rh_sim::ArenaMode::Source(rh_sim::ArenaRules {
                    plan_seconds: 0.,
                    first_patience_seconds: None,
                    coliseum_schedule: None,
                    patience_seconds: 3600.,
                    patience_min_seconds: 3600.,
                    sudden_death_seconds: 60.,
                }),
                wish_lock_ms: 0.,
                ..Default::default()
            },
            practice_arena(),
            Secrets::from_seed(3),
            &placements,
        );
        let target =
            matches!(faction, FactionId::Frost | FactionId::Sentenced).then_some(PlayerId(2));
        sim.submit(
            PlayerId(1),
            cmd(RawCommand::Cast {
                slot: rh_sim::abilities::Slot::Wish,
                x: 600.,
                y: 320.,
                id: target,
                t: None,
                seq: None,
            }),
        )
        .unwrap();
        sim.step();
        let cp = serde_json::to_value(&sim).unwrap();
        let p = &cp["world"]["players"][0];
        assert!(p["card_runtime"]["wish_cast"].is_object());
        assert!(p["stocks"]["wish_full_at"].is_number());
        if matches!(faction, FactionId::Fire | FactionId::Holy) {
            assert!(p["core"]["statuses"]["cast"].is_null());
        } else {
            assert!(p["core"]["statuses"]["cast"]["producer"].is_object());
        }
        assert_eq!(Sim::restore(&cp).unwrap().state_hash(), sim.state_hash());
        if faction == FactionId::Frost {
            let mut cancelled = sim.clone();
            cancelled.remove_player(PlayerId(1));
            let cp = serde_json::to_value(&cancelled).unwrap();
            assert!(cp["world"]["pending_events"]
                .as_array()
                .unwrap()
                .iter()
                .any(|event| event["CastEnded"]["event_time"].as_f64()
                    == Some(cancelled.server_time())));
            out.push(("Freeze between-step cancellation", cancelled));
        }
        out.push((accepted_name, sim.clone()));
        for _ in 0..7 {
            sim.step();
        }
        assert!(
            serde_json::to_value(&sim).unwrap()["world"]["players"][0]["core"]["statuses"]["cast"]
                .is_null()
        );
        out.push((landed_name, sim));
    }
    out
}

/// The measurement-only `SimConfig::mob_spacing = Off` (ADR0024 addendum "Mob spacing"): the one config value that
/// serializes as a string; restoring it as `null` (`Auto`) must change the hash, so an A/B run never passes for a live one.
fn mob_spacing_off_state() -> (&'static str, Sim) {
    let mut sim = Sim::reset_active(
        SimConfig {
            mob_spacing: rh_sim::archetype::MobSpacing::Off,
            ..Default::default()
        },
        practice_arena(),
        Secrets::from_seed(73),
        &[Placement {
            profile: "hash-spacing".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400., 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        }],
    );
    sim.step();
    assert_eq!(
        serde_json::to_value(&sim).unwrap()["statics"]["config"]["mob_spacing"],
        serde_json::json!("off")
    );
    ("mob spacing off (measurement A/B)", sim)
}

/// `SimConfig::regen_in_combat = Off` (P-REGEN-COMBAT-1, the live profiles): serializes as a string like `mob_spacing = Off`;
/// restoring it as `null` (`Legacy`) must change the hash, so a live run never passes for a legacy-regen one.
fn regen_in_combat_off_state() -> (&'static str, Sim) {
    let mut sim = Sim::reset_active(
        SimConfig {
            regen: true,
            regen_in_combat: rh_sim::RegenInCombat::Off,
            ..Default::default()
        },
        practice_arena(),
        Secrets::from_seed(74),
        &[Placement {
            profile: "hash-regen".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400., 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        }],
    );
    sim.step();
    assert_eq!(
        serde_json::to_value(&sim).unwrap()["statics"]["config"]["regen_in_combat"],
        serde_json::json!("off")
    );
    ("regen in combat off (live profiles)", sim)
}

/// `SimConfig::camp_buffs = Themed` (P-CAMP-BUFF-THEMES-1, the live profiles), config only (no camps on the practice
/// arena): serializes as `"themed"`; restoring it as `null` (`Legacy`) must change the hash.
fn camp_buffs_themed_state() -> (&'static str, Sim) {
    let mut sim = Sim::reset_active(
        SimConfig {
            camp_buffs: rh_sim::CampBuffRule::Themed,
            ..Default::default()
        },
        practice_arena(),
        Secrets::from_seed(78),
        &[Placement {
            profile: "hash-camp-buffs".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400., 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        }],
    );
    sim.step();
    assert_eq!(
        serde_json::to_value(&sim).unwrap()["statics"]["config"]["camp_buffs"],
        serde_json::json!("themed")
    );
    ("camp buffs themed (live profiles, config only)", sim)
}

/// `SimConfig::camp_buffs = Themed` on the one-camp PvE fixture (P-CAMP-BUFF-THEMES-1): the world carries
/// `world.mob_runtime.buffs`, one entry per camp, stepped into the active raid, here with an off-theme buff (a `Some`
/// leaf) so the campaign perturbs an entry.
fn camp_buffs_themed_mob_state() -> (&'static str, Sim) {
    let data = serde_json::from_str(include_str!("fixtures/mob-pve-map.json")).unwrap();
    let arena = rh_sim::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map: data,
    }
    .validate()
    .unwrap()
    .into_arena()
    .unwrap();
    let mut sim = Sim::reset_active(
        SimConfig {
            quests: false,
            consumables: true,
            mob_mode: rh_sim::mob_runtime::MobMode::Pve,
            camp_buffs: rh_sim::CampBuffRule::Themed,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(79),
        &[Placement {
            profile: "hash-camp-buffs-mob".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400., 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        }],
    );
    sim.step();
    // A lone camp always ends on its zone's theme (below nine camps the repair only gains theme), so the checkpoint is
    // restored with the Fire camp paying the Sentenced Pardoner's stat, an off-theme buff `check_world` admits.
    assert_eq!(
        sim.camp_buffs(),
        &[None],
        "a lone camp rolls on its zone's theme"
    );
    let mut cp = serde_json::to_value(&sim).unwrap();
    cp["world"]["mob_runtime"]["buffs"][0] = serde_json::json!("pardoner");
    let sim = Sim::restore(&cp).expect("an off-theme buff of another zone is admitted");
    assert!(sim.camp_buffs()[0].is_some());
    ("camp buffs themed (one PvE camp, off theme)", sim)
}

/// Admitted Training worlds produce their hints through ordinary validated movement.
/// None inherits Training's enabled preset; explicit false and true remain distinct config tags.
fn produced_walk_hint_states() -> Vec<(&'static str, Sim)> {
    [None, Some(false), Some(true)]
        .into_iter()
        .map(|mode| {
            let mut sim = Sim::reset_active(
                SimConfig {
                    training: true,
                    quests: false,
                    walk_hints: mode,
                    ..Default::default()
                },
                practice_arena(),
                Secrets::from_seed(71),
                &[Placement {
                    profile: "hash-hint".into(),
                    faction: FactionId::Holy,
                    bot: false,
                    at: Vec2::new(400., 320.),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                }],
            );
            sim.submit(
                PlayerId(1),
                cmd(RawCommand::Move {
                    x: 600.,
                    y: 320.,
                    seq: Some(1),
                }),
            )
            .unwrap();
            sim.step();
            let cp = serde_json::to_value(&sim).unwrap();
            assert_eq!(
                cp["statics"]["config"]["walk_hints"],
                serde_json::json!(mode)
            );
            let ticks = cp["world"]["players"][0]["walk_ticks"].as_u64().unwrap();
            if mode == Some(false) {
                assert_eq!(ticks, 0);
            } else {
                assert!(
                    (1..=3).contains(&ticks),
                    "ordinary movement produces a positive hint"
                );
            }
            (
                match mode {
                    None => "produced hint with inherited Training preset",
                    Some(false) => "disabled hint with explicit config",
                    Some(true) => "produced hint with explicit config",
                },
                sim,
            )
        })
        .collect()
}

/// DECLARED serialization seed for the practice camps' contributors (P-TRAINING-CAMPS-1, `world.practice.contributors`):
/// an admitted Training world with two (practice camp ref, seated player) pairs. The producer oracle is
/// `systems/training/camps_tests.rs` (a real hit on a console camp); this only lets the audit reach the leaves.
fn practice_contributors_state() -> (&'static str, Sim) {
    let (_, sim) = produced_walk_hint_states().swap_remove(0);
    let mut cp = serde_json::to_value(&sim).unwrap();
    assert_eq!(cp["world"]["practice"]["contributors"], serde_json::json!([]));
    let first = rh_sim::constants::PRACTICE_CAMP_FIRST;
    cp["world"]["practice"]["contributors"] = serde_json::json!([[first, 1], [first + 2, 1]]);
    (
        "DECLARED practice camp contributors",
        Sim::restore(cp).expect("practice refs paired with the seated player"),
    )
}

/// Declared serialization controls, NOT earned cards, Mark application, or produced hints.
/// The source-component tests remain the producer oracle. These coupled seeds let the
/// generic serde audit reach private fields without a new gameplay/testing input door.
fn declared_native29_states(wish_seed: &Sim) -> Vec<(&'static str, Sim)> {
    fn fight_seed(sim: &Sim) -> Sim {
        let mut chosen = sim.clone();
        // The supplied Wish checkpoint may still be casting. Let that real cast
        // finish before Choose; its public action door correctly refuses Busy.
        let initial = serde_json::to_value(&chosen).unwrap();
        if let Some(lands_at) =
            initial["world"]["players"][0]["core"]["statuses"]["cast"]["lands_at"].as_f64()
        {
            let steps = ((lands_at - chosen.server_time()).max(0.) / rh_sim::constants::TICK_MS)
                .ceil() as usize
                + 1;
            for _ in 0..steps {
                if serde_json::to_value(&chosen).unwrap()["world"]["players"][0]["core"]["statuses"]
                    ["cast"]
                    .is_null()
                {
                    break;
                }
                chosen.step();
            }
        }
        let mut cp = serde_json::to_value(&chosen).unwrap();
        assert!(cp["world"]["players"][0]["core"]["statuses"]["cast"].is_null());
        let retained_wish = cp["world"]["players"][0]["card_runtime"]["wish_cast"].clone();
        let card = rh_sim::cards::CardId::SlowStarter;
        assert_eq!(
            cp["world"]["players"][0]["build"]["counts"][card.index()],
            0
        );
        let chest_id = u32::try_from(cp["world"]["entity_counter"].as_u64().unwrap())
            .unwrap()
            .checked_add(1)
            .unwrap();
        let owner = chosen.player(PlayerId(1)).unwrap();
        // Declared already-available chest, as in card_choices(); not an earned
        // reward or a widened Training whitelist. The real grant owns ALL folds,
        // including SlowStarter's unconditional -30% damage before its while row.
        let chest = serde_json::json!({
            "id": chest_id, "at": {"x": owner.body.x, "y": owner.body.y},
            "expires_at": chosen.server_time() + rh_sim::reward_chests::DEFINITION.lifetime_ms,
            "held_until_tick": 0, "options": [{"Card": card.as_str()}, null, null],
            "taken": [null, null, null], "pickers": [], "camp": null, "owner": null
        });
        cp["world"]["reward_chests"]
            .as_array_mut()
            .unwrap()
            .push(chest);
        cp["world"]["entity_counter"] = chest_id.into();
        chosen = Sim::restore(cp).expect("declared available chest with unchanged valid sheet");
        chosen
            .submit(
                PlayerId(1),
                cmd(RawCommand::Choose {
                    chest_id: Some(chest_id),
                    pick: 0,
                }),
            )
            .unwrap();
        let events = chosen.step();
        assert!(
            events.iter().any(|event| matches!(event,
            rh_sim::Event::ChestTaken { chest, by: PlayerId(1), pick: 0 }
                if *chest == chest_id)),
            "real Choose must grant the declared card"
        );
        let mut cp = serde_json::to_value(&chosen).unwrap();
        let now = chosen.server_time();
        assert!(now >= rh_sim::constants::TICK_MS);
        let p = &mut cp["world"]["players"][0];
        assert_eq!(p["build"]["counts"][card.index()], 1);
        assert_eq!(p["card_runtime"]["wish_cast"], retained_wish);
        // Only the historical fight tuple is a serialization seed. Keep it below
        // the real three-second condition; do not edit a cached sum or wire mirror.
        p["card_runtime"] = serde_json::json!({
            "wish_cast": retained_wish,
            "fight": {"start": now - rh_sim::constants::TICK_MS, "last": now}
        });
        Sim::restore(cp).expect("declared watched fight clock after genuine grant/refold")
    }

    fn tax_seed(public: bool) -> Sim {
        let mut cp = serde_json::to_value(crowded_8()).unwrap();
        cp["statics"]["config"]["faction_mode"] =
            serde_json::json!("EngagementHolyPlagueFireFrostSentenced");
        // Historical player ids are valid marker identities without inventing a
        // current-faction or live-nearby requirement. The last binding is not public,
        // so shortening this ordered index remains independently restore-valid.
        cp["world"]["factions"]["taxed"] = serde_json::json!([
            {"victim": 2, "by": 5}, {"victim": 4, "by": 6}, {"victim": 6, "by": 7}
        ]);
        if public {
            cp["world"]["factions"]["public_tax"] = serde_json::json!([
                {"victim": 2, "percent": 48}, {"victim": 4, "percent": 23}
            ]);
            for i in [1usize, 3] {
                let bits = &mut cp["world"]["players"][i]["core"]["signature"]["bits"];
                *bits = (bits.as_u64().unwrap() | u64::from(rh_sim::constants::SIG_TAXED)).into();
            }
        }
        Sim::restore(cp)
            .expect("declared historical tax index/public percentages and matching bits")
    }

    let mut cp = serde_json::to_value(crowded_8()).unwrap();
    cp["world"]["players"][0]["walk_dir"] = 255.into();
    cp["world"]["players"][0]["walk_ticks"] = 3.into();
    let walk = Sim::restore(cp.clone()).expect("declared private Player hint shape");
    cp["world"]["players"][0]["walk_ticks"] = 0.into();
    let retained_dir = Sim::restore(cp).expect("zero ticks retains all direction bytes");
    vec![
        (
            "DECLARED fight-only serialization",
            fight_seed(&crowded_8()),
        ),
        (
            "DECLARED fight-plus-Wish serialization",
            fight_seed(wish_seed),
        ),
        ("DECLARED tax index serialization", tax_seed(false)),
        ("DECLARED public tax serialization", tax_seed(true)),
        ("DECLARED Player hint serialization", walk),
        ("DECLARED retained hint dir serialization", retained_dir),
    ]
}

fn scenarios() -> Vec<(&'static str, Sim)> {
    let (mob_engaged, mob_cleared) = mob_audit_states();
    let (source_planning, source_active, source_locked) = source_lifecycle_states();
    let mut mid = crowded_8();
    drive(&mut mid, 40);
    let mut late = crowded_8();
    drive(&mut late, 700);
    let mut fuse = short_fuse();
    drive(&mut fuse, 400);
    let mut states = wish_states();
    let declared = declared_native29_states(
        &states
            .iter()
            .find(|(label, _)| *label == "Freeze pending")
            .unwrap()
            .1,
    );
    states.extend(declared);
    states.extend(produced_walk_hint_states());
    states.push(practice_contributors_state());
    states.push(mob_spacing_off_state());
    states.push(regen_in_combat_off_state());
    states.push(camp_buffs_themed_state());
    states.push(camp_buffs_themed_mob_state());
    states.extend([
        ("source planning", source_planning),
        ("source active timer", source_active),
        ("source locked", source_locked),
        ("mob engaged with pending attack", mob_engaged),
        ("mob camp cleared", mob_cleared),
        ("card choices", card_choices()),
        ("Sentenced window", sentenced_window()),
        ("Frost window", frost_window()),
        ("Plague window", plague_window()),
        ("Holy engaged", holy_engaged()),
        ("item fight", item_fight()),
        ("wand attack-move", locked_attack()),
        ("crowded_8 @40", mid),
        ("crowded_8 @700", late),
        ("short fuse @400", fuse),
        ("queued inputs", with_queued_inputs()),
        ("lobby with names", lobby_with_names()),
        ("lobby after a leave", lobby_after_leave()),
    ]);
    states
}

/// What a perturbation is: a scalar replaced, an array shortened by its last element, or an optional subtree removed.
#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Leaf,
    Len,
    Subtree,
}

struct Item {
    path: Vec<String>,
    kind: Kind,
    value: Value,
}

/// What happened to the perturbations of one or more checkpoints.
#[derive(Default)]
struct Tally {
    leaves: usize,
    changed: usize,
    unhashed: Vec<String>,
    validated: Vec<String>,
    /// Patterns of the null leaves no candidate could fill, and of every leaf that was perturbed.
    null_left: Vec<String>,
    optional_seen: Vec<String>,
    validated_optional: Vec<String>,
    perturbed: Vec<String>,
    secrets_checked: usize,
}

fn path_of(p: &[String]) -> String {
    p.join(".")
}

/// `world.players.3.core.id` -> `world.players.*.core.id`.
fn pattern(p: &str) -> String {
    p.split('.')
        .map(|k| if k.parse::<usize>().is_ok() { "*" } else { k })
        .collect::<Vec<_>>()
        .join(".")
}

fn walk(v: &Value, path: &mut Vec<String>, out: &mut Vec<Item>) {
    fn push(out: &mut Vec<Item>, path: &[String], kind: Kind, value: Value) {
        out.push(Item {
            path: path.to_vec(),
            kind,
            value,
        })
    }
    match v {
        Value::Object(m) => {
            for (k, v) in m {
                path.push(k.clone());
                if v.is_object() || v.is_array() {
                    push(out, path, Kind::Subtree, v.clone());
                }
                walk(v, path, out);
                path.pop();
            }
        }
        Value::Array(a) => {
            if !a.is_empty() {
                path.push("#len".into());
                push(out, path, Kind::Len, Value::from(a.len()));
                path.pop();
            }
            for (i, v) in a.iter().enumerate() {
                path.push(i.to_string());
                if v.is_object() || v.is_array() {
                    push(out, path, Kind::Subtree, v.clone());
                }
                walk(v, path, out);
                path.pop();
            }
        }
        leaf => push(out, path, Kind::Leaf, leaf.clone()),
    }
}

/// Every non-null value of the checkpoints, by path pattern: the `Some` values a `None` leaf can be given.
fn harvest(v: &Value, path: &mut Vec<String>, pool: &mut BTreeMap<String, Vec<Value>>) {
    if !v.is_null() && !path.is_empty() {
        let e = pool.entry(pattern(&path_of(path))).or_default();
        if e.len() < 4 && !e.contains(v) {
            e.push(v.clone());
        }
    }
    match v {
        Value::Object(m) => {
            for (k, x) in m {
                path.push(k.clone());
                harvest(x, path, pool);
                path.pop();
            }
        }
        Value::Array(a) => {
            for (i, x) in a.iter().enumerate() {
                path.push(i.to_string());
                harvest(x, path, pool);
                path.pop();
            }
        }
        _ => {}
    }
}

fn at_mut<'a>(v: &'a mut Value, p: &[String]) -> &'a mut Value {
    let mut cur = v;
    for k in p {
        cur = match cur {
            Value::Object(m) => m.get_mut(k).unwrap(),
            Value::Array(a) => &mut a[k.parse::<usize>().unwrap()],
            _ => unreachable!(),
        };
    }
    cur
}

/// Candidate replacements for a scalar leaf (all tried until the restore accepts one): the natural neighbour first, `null`
/// last (it is accepted only by an optional field: a `Some` becoming `None`).
fn candidates(leaf: &Value, strings: &[String]) -> Vec<Value> {
    let mut v = match leaf {
        Value::Bool(b) => vec![Value::Bool(!b)],
        Value::Number(n) => {
            if n.is_f64() {
                let f = n.as_f64().unwrap();
                [
                    f64::from_bits(f.to_bits() + 1),
                    f64::from_bits(f.to_bits().wrapping_sub(1)),
                ]
                .into_iter()
                .filter(|x| x.is_finite() && x.to_bits() != f.to_bits())
                .map(|x| serde_json::json!(x))
                .collect()
            } else if let Some(u) = n.as_u64() {
                vec![
                    serde_json::json!(u + 1),
                    serde_json::json!(u.saturating_sub(1)),
                ]
            } else {
                let i = n.as_i64().unwrap();
                vec![serde_json::json!(i + 1), serde_json::json!(i - 1)]
            }
        }
        Value::String(s) => {
            // Free text first, then every other string in the checkpoint (a different enum variant).
            let mut v = vec![
                Value::String(format!("{s}x")),
                Value::String(format!("{s}x{s}")),
            ];
            v.extend(
                strings
                    .iter()
                    .filter(|o| *o != s)
                    .map(|o| Value::String(o.clone())),
            );
            v
        }
        _ => vec![],
    };
    v.push(Value::Null);
    v
}

/// Patterns whose perturbation the restore may refuse, and why. Any other refusal fails the test.
const VALIDATED: &[(&str, &str)] = &[
    ("world.players.*.core.modifiers.holds", "changing a used while-row hold bit alone changes the exact re-folded sums and invalidates their cached mirrors; inert bits remain restore-valid and must change the hash"),
    // Exact coupled restore constraints, not unhashed-field exceptions. The tax-only
    // seed separately permits independent taxed.victim edits; accepted edits here
    // still always have to change the hash. Public victim identity/order is also
    // checked by a valid whole-row permutation below.
    ("world.factions.taxed.*.victim", "a public percentage must retain a binding for its exact victim; changing that indexed victim alone can orphan the public row"),
    ("world.factions.public_tax.*.victim", "public victim identity is coupled to the exact per-actor SIG_TAXED bits and a retained tax binding"),
    ("world.factions.public_tax.#len", "removing a positive public row alone leaves that victim's SIG_TAXED bit without its required public percentage"),
    ("world.pending_events.*.CastEnded.event_time", "a required producer timestamp must be finite and between zero and the checkpoint server clock"),
    ("world.pending_events.*.CastEnded.reason", "CastEndReason is a closed enum: Fizzle, Interrupted or Cancelled"),
    (
        "world.mobs.*.kind",
        "a mob's kind is coupled to its retained birth origin (regional vs practice vs dummy) and the training-world admission; flipping it alone is refused by the matching validator",
    ),
    (
        "world.mobs.*.mob_type",
        "a non-dummy mob's catalog type is required and coupled to its retained birth origin; only a training dummy has none, so flipping it is refused",
    ),
    (
        "world.practice",
        "the practice-console counters exist only in a training world; filling them in an arena checkpoint is refused by the arena actor validators",
    ),
    (
        "world.practice.contributors.*.*",
        "a practice contributor pair is (camp ref 101..=255, a player the run seated: its retained Player origin), each pair once (training.rs `validate_actors`); an accepted edit still has to change the hash",
    ),
    (
        "world.practice.contributors.*.#len",
        "a practice contributor is a (camp ref, player) pair",
    ),
    (
        "statics.config.training",
        "a training config is admitted only with the training actor runtime (empty map-camp rosters) and training-only actor origins; flipping the flag on an arena/registry checkpoint is refused by the training validator",
    ),
    // A Sentenced target is a living other player or the 0 sentinel; a raw id that names self or a
    // non-player is refused by the checkpoint validator rather than hashed.
    ("world.players.*.hunt_target", "hunt target is 0 or a living other player's id"),
    ("world.players.*.hunt_stacks", "completed hunts cannot exceed the number of players who ever joined"),
    ("world.players.*.farm.corpse_stacks", "corpse stacks fold a flat max-hp row and must agree with the serialized mirror"),
    ("world.mobs.*.display_name", "only a raised Plague zombie carries a display name; regional mobs leave it None"),
    ("world.mobs.*.zombie", "only a raised Plague companion carries zombie runtime; regional mobs leave it None"),

    // Full Wish producer tuples are coupled. Accepted edits still always have to change the hash.
    ("world.abilities.fields.#len", "a live refreshed Swarm Hidden status must retain its exact source-owned cloud through its current end; removing that cloud is refused by abilities/effect_checkpoint.rs"),
    ("world.abilities.fields.*.owner.owner_id", "ordinary player Wish fields have no secondary/summoner owner; Full producer source requires None"),
    ("world.players.*.core.statuses.instances.*.data.shares.phys", "Full Blaze Dot payload is the exact pure true-damage shares tuple"),
    ("world.players.*.core.statuses.instances.*.data.shares.magic", "Full Blaze Dot payload is the exact pure true-damage shares tuple"),
    ("world.players.*.core.statuses.instances.*.data.shares.true_", "Full Blaze Dot payload is the exact pure true-damage shares tuple"),

    ("world.abilities.fields.*.exit_stun_ms", "Trial Zone exit stun is fixed by its producer; other admitted fields require None"),
    ("world.players.*.core.statuses.instances.*.data.dealt_mult", "Trial Zoned payload requires the exact outgoing damage multiplier"),
    ("world.players.*.core.statuses.instances.*.data.field_id", "Zoned payload references the actual retained Trial field id"),
    ("world.players.*.core.statuses.instances.*.data.move_mult", "Trial Zoned payload requires the exact movement multiplier"),
    ("world.players.*.core.statuses.instances.*.data.taken_from_source_mult", "Trial Zoned payload requires the exact incoming source multiplier"),
    ("world.players.*.core.statuses.instances.*.data.floor_hp", "LastStand DeathFloor payload requires the exact minimum health"),
    ("world.players.*.core.statuses.instances.*.data.heal_share", "LastStand DeathFloor payload requires the exact stored healing share"),
    ("world.players.*.core.statuses.cast.producer", "Full requires complete producer details; Off forbids them and only admits trusted bare cast facts"),
    ("world.players.*.card_runtime", "Wish spend requires Full and produced stocks; fight memory requires a watched row, and a lazy runtime cannot be empty"),
    ("world.players.*.card_streak", "the card-state streak exists only after the after-damage system records weapon hits; a fresh or no-hit state is legitimately None"),
    ("world.players.*.card_trims", "Wishful Thinking trims exist only after a Wish cast and landed hits inside the source window; a fresh state is legitimately empty"),
    ("world.players.*.card_hots", "heal-over-time runs exist only after a trigger heal starts one; a fresh state is legitimately empty"),
    ("world.players.*.card_fired", "the once-trigger fired set exists only after a trigger fires; a fresh state is legitimately empty"),
    ("world.players.*.card_runtime.wish_cast", "Wish spend requires Full and matching stocks; removing the sole spend from a runtime without a fight clock would leave it empty"),

    ("world.abilities.fields.*.ability", "Full field ability is coupled to its Cloud/Trail/Zone kind and typed definition"),
    ("world.abilities.fields.*.ends_at", "Full field end equals started_at plus its exact ability duration"),
    ("world.abilities.fields.*.id", "field identity is a unique positive allocated id below next_field_id and referenced by owned statuses"),
    ("world.abilities.fields.*.kind", "Full field kind is coupled to its ability definition"),
    ("world.abilities.fields.*.owner.id", "Full field owner has stable matching roster identity and name"),
    ("world.abilities.fields.*.owner.name", "Full field owner name matches its stable roster identity"),
    ("world.abilities.fields.*.r", "Full field radius is fixed by its actual ability definition"),
    ("world.abilities.fields.*.vx", "Full Wish fields have zero horizontal drift"),
    ("world.abilities.fields.*.vy", "Full Wish fields have zero vertical drift"),
    ("world.abilities.fields.*.x2", "Cloud/Zone fields have zero second endpoint; Trail endpoints remain separately perturbable"),
    ("world.abilities.fields.*.y2", "Cloud/Zone fields have zero second endpoint; Trail endpoints remain separately perturbable"),

    ("world.players.*.core.statuses.instances.*.data.undefined_fields", "Full Wish payload must equal its typed producer shape; no arbitrary undefined-field mask is produced"),
    ("world.players.*.core.statuses.instances.*.kind", "Full Wish status kind is coupled to its ability definition"),
    ("world.players.*.core.statuses.instances.*.source.id", "Full Wish source must have stable matching player roster identity and source name"),
    ("world.players.*.core.statuses.instances.*.source.name", "Full Wish source name must match its stable player roster identity"),
    ("world.players.*.core.statuses.instances.*.until", "Full Wish status deadline is coupled to its exact duration or current refreshed Blaze tail"),
    ("world.players.*.core.statuses.instances.*.value", "Full Wish value is fixed by its ability/status producer tuple"),

    ("statics.config.lifecycle.Source.plan_seconds", "changing disabled planning to enabled requires its actual retained deal/phase history"),
    ("world.players.*.card_runtime.wish_cast.at", "canonical last spend is fixed-step aligned and agrees with pending cast or attainable completed stock clocks"),
    ("world.players.*.card_runtime.wish_cast.cooldown_ms", "canonical accepted cooldown equals the admitted faction Wish definition and current supported modifier"),
    ("world.players.*.core.statuses.cast.ability", "Full pending ability must be the player faction Wish and agree with duration/stock/producer"),
    ("world.players.*.core.statuses.cast.lands_at", "Full landing clock equals started_at plus the exact timed definition and remains future unless voided"),
    ("world.players.*.core.statuses.cast.started_at", "Full start equals canonical WishSpend and its spent stock clocks"),
    ("world.players.*.core.statuses.cast.producer.previous_full_at", "timed Wish rollback tuple must be Some(previous_ready_at) and an attainable opening/prior-spend clock"),
    ("world.players.*.core.statuses.cast.producer.previous_ready_at", "timed Wish rollback tuple is coupled and must be an attainable opening/prior-spend clock"),
    ("world.players.*.core.statuses.cast.producer.rank", "admitted ordinary player Wish producer has rank one"),
    ("world.players.*.core.statuses.cast.producer.slot", "admitted ordinary player producer equips the Wish slot only"),
    ("world.players.*.stocks.wish_full_at", "Full stock must be initialized and satisfy its ready/spend/refund equation; Off forbids Some"),
    ("world.players.*.core.statuses.cast.cancelled_by.root", "Full producer cancel mask equals the executable Wish definition"),
    ("world.players.*.core.statuses.cast.cancelled_by.silence", "Full producer cancel mask equals the executable Wish definition"),
    ("world.players.*.core.statuses.cast.cancelled_by.stagger", "Full producer cancel mask equals the executable Wish definition"),
    ("world.players.*.core.statuses.cast.cancelled_by.stun", "Full producer cancel mask equals the executable Wish definition"),

    ("statics.config.abilities", "closed Off/Full domain; Full requires initialized stock/cast producers, Off forbids their persistent state"),
    ("world.players.*.stocks.e_ready_at", "no equipped E producer: clock must remain zero"),
    ("world.players.*.stocks.q_ready_at", "no equipped Q producer: clock must remain zero"),
    ("world.players.*.stocks.wish_ready_at", "Off requires default stocks; Full ready clock is coupled to opening lock, canonical spend/full clock or a valid teleport refund"),
    ("world.planning", "enabled planning requires retained history after Lobby; Off and disabled planning forbid the history"),
    ("world.rt.voided", "disabled lifecycle only permits abandon-produced void state during Active; Source Lobby cannot be voided"),
    ("statics.config.lifecycle.Source.sudden_death_seconds", "locked deadline must exactly equal the actual teleport hook time plus configured sudden-death duration"),
    ("world.abilities.teleported_at", "locked Source worlds require this actual hook clock to agree with their sudden-death deadline"),

    ("statics.secrets.order_salt", "Source lifecycle pins action-order salt to the first actual constructor main draw"),
    ("statics.secrets.spawn_seed", "Source core Lobby/Planning requires main stream to equal the actual one-draw constructor prefix"),
    ("world.spawn_rng.state", "Source core Lobby/Planning requires main stream to equal the actual one-draw constructor prefix"),
    ("world.tick", "Source server time must equal tick times the fixed 50ms step"),
    ("world.players.#len", "Planning live player count must equal retained deals and ordered identities"),
    ("world.rt.started_humans", "Source pre-raid has zero startedHumans and running counts are bounded by starters"),
    ("world.rt.started_with", "Source starters must agree with planning history and phase"),
    ("world.planning.deals.#len", "Planning requires one deal for every current player"),
    ("world.planning.deals.*.#len", "Each planning deal is a typed identity and payload pair"),
    ("world.planning.deals.*.*", "Deal identities are ordered known roster members and live during Planning"),
    ("world.planning.starters", "Planning starters bound retained deal count and equal arena startedWith"),
    ("world.planning.deals.*.*.boon", "Planning typed two-option deal, selection/reservation reciprocity, empty normal boon domain and exact sent owner snapshot are validated"),
    ("world.planning.deals.*.*.pick", "Planning typed two-option deal, selection/reservation reciprocity, empty normal boon domain and exact sent owner snapshot are validated"),
    ("world.planning.deals.*.*.sent.boon", "Planning typed two-option deal, selection/reservation reciprocity, empty normal boon domain and exact sent owner snapshot are validated"),
    ("world.planning.deals.*.*.sent.endsAt", "Planning typed two-option deal, selection/reservation reciprocity, empty normal boon domain and exact sent owner snapshot are validated"),
    ("world.planning.deals.*.*.sent.pick", "Planning typed two-option deal, selection/reservation reciprocity, empty normal boon domain and exact sent owner snapshot are validated"),
    ("world.planning.deals.*.*.sent.spawns.#len", "Planning typed two-option deal, selection/reservation reciprocity, empty normal boon domain and exact sent owner snapshot are validated"),
    ("world.planning.deals.*.*.sent.spawns.*", "Planning typed two-option deal, selection/reservation reciprocity, empty normal boon domain and exact sent owner snapshot are validated"),
    ("world.planning.deals.*.*.sent.taken.#len", "Planning typed two-option deal, selection/reservation reciprocity, empty normal boon domain and exact sent owner snapshot are validated"),
    ("world.planning.deals.*.*.sent.taken.*", "Planning typed two-option deal, selection/reservation reciprocity, empty normal boon domain and exact sent owner snapshot are validated"),
    ("world.planning.deals.*.*.spawns.#len", "Planning typed two-option deal, selection/reservation reciprocity, empty normal boon domain and exact sent owner snapshot are validated"),
    ("world.planning.deals.*.*.spawns.*", "Planning typed two-option deal, selection/reservation reciprocity, empty normal boon domain and exact sent owner snapshot are validated"),
    ("world.planning.report.pairs", "Planning report counts and rule must agree with the admitted pool and starter count"),
    ("world.planning.report.rule", "Planning report counts and rule must agree with the admitted pool and starter count"),
    ("world.planning.report.sameZonePairs", "Planning report counts and rule must agree with the admitted pool and starter count"),
    ("world.planning.report.shared", "Planning report counts and rule must agree with the admitted pool and starter count"),
    ("world.planning.report.tierPairs", "Planning report counts and rule must agree with the admitted pool and starter count"),

    ("statics.config.lifecycle", "ArenaMode enum and Source payload must parse; changing to Source requires actual phase/clock state"),
    ("world.plan_ends_at", "disabled lifecycle requires zero; Planning requires its bounded deadline and sent owner plans to agree"),
    ("world.players.*.plan_ready", "ready latch is forbidden without an enabled planning producer"),
    ("world.players.*.kill_stats.values.#len", "the killStats store is exactly the nine readable investment totals; serde fixes the array length"),
    ("world.players.*.kill_stats.values.*", "a kill-augment grant is non-negative and finite; negative or non-finite totals are refused"),
    ("world.reward_chests.*.owner", "an owner-bound Trophy is produced only by a credited player kill; a non-null owner must name a roster member, and these corpora have no player kill"),
    ("world.quests", "the quest runtime is absent in these corpora (config.quests off); when it is present its offers, carriers, timers and containers are validated and every nested leaf is hashed"),
    ("world.traders", "the trader runtime is absent in these corpora (traders ride the quests live-content switch, config.quests off); when it is present its actors, walkers and barter cooldowns are validated and every nested leaf is hashed (the pinned trade replay covers the present state), and the per-player tradeUsed/tradeOffers/tradeStats leaves are hashed here"),
    ("world.players.*.vision.reveals.*.ordinal", "first retained reveal is ordinal zero; same-tick successors increment exactly once"),
    ("world.players.*.vision.reveals.*.variant", "locked history requires admitted Source raid producer; repeated origins coalesce only for equal variants"),
    ("world.rt.in_coliseum", "disabled lifecycle forbids coliseum state; Source locked phase requires matching in-coliseum flag"),
    ("world.rt.sudden_death_at", "disabled lifecycle requires zero; locked Source deadline must match exact teleport hook clock plus configured duration"),

    ("statics.config.hazards", "terrain mode is a closed Off/Map/All enum"),
    ("statics.config.hitboxes", "ADR0024: every fighter's archetype must equal archetype::assign(mode, identity), so flipping the mode alone leaves mismatched rows"),
    ("world.players.*.core.archetype", "ADR0024: the id must be known and equal archetype::assign(config.hitboxes, faction identity)"),
    ("world.mobs.*.core.archetype", "ADR0024: the id must be known and equal archetype::assign(config.hitboxes, mob identity); births are also re-derived by the expected-birth comparisons"),
    ("world.players.*.core.motion.path.#len", "path checkpoint is exactly the generation/points pair"),
    ("world.mobs.*.core.motion.path.#len", "path checkpoint is exactly the generation/points pair"),
    ("world.rt.gates_locked", "no ordinary arena gate producer is admitted yet; true requires that future stage"),
    ("world.terrain.seconds.#len", "exact four source surface counters"),
    ("world.terrain.seconds.*", "terrain counters must be nonnegative finite and zero when hazards are Off"),
    ("world.deferred.hits.*.terrain", "terrain hits are applied within the burn pass, never deferred; imported terrain entries are refused"),
    ("world.mobs.*.core.weapon.action.kind", "mob pending action kind must match its held weapon (Bow Draw, Wand Cast, otherwise Swing)"),
    ("world.mobs.*.core.weapon.action.weapon", "mob pending action weapon must equal its catalog-derived active weapon"),
    ("world.mobs.*.core.weapon.action.target", "mob_checkpoint rejects player lock targets on mob pending attacks; NPC aim is resolved through its brain"),
    ("world.mobs.*.core.card_dot_crit", "mob_checkpoint requires no player card DotCrit runtime on mobs"),
    ("world.mobs.*.core.motion.slip", "terrain validation rejects slip when hazards are Off; admitted Map/All ice states are covered by the dedicated terrain leaf audit"),
    ("world.mobs.*.core.signature.ap_hits.target", "mob_checkpoint requires the complete player-only AP hit history remain default"),
    ("world.mobs.*.core.signature.mark.far_since", "mob_checkpoint requires the complete unsupported Mark runtime remain default"),
    ("world.mobs.*.core.statuses.cast", "mob_checkpoint rejects ability cast state on mobs"),
    ("world.mobs.*.core.weapon.weapon1", "mob_checkpoint requires catalog weapon0 and no secondary slot"),
    ("world.mobs.*.core.signature.exposure_started_at", "validate_basic requires default Frost runtime in the supported basic Holy/Fire/Plague PvE domain"),
    ("world.mobs.*.core.signature.last_near_at", "validate_basic requires default Frost runtime in the supported basic Holy/Fire/Plague PvE domain"),
    ("world.mobs.*.core.signature.ranged_chill_until", "validate_basic requires default Frost runtime in the supported basic Holy/Fire/Plague PvE domain"),
    ("world.mobs.*.core.weapon.targeting.attack_move", "mob_checkpoint requires player weapon-targeting state remain default; mob decisions use their separate validated brain"),
    ("world.mobs.*.core.weapon.targeting.goal", "mob_checkpoint requires player weapon-targeting state remain default; mob decisions use their separate validated brain"),
    ("world.mobs.*.core.weapon.targeting.lost_at", "mob_checkpoint requires player weapon-targeting state remain default; mob decisions use their separate validated brain"),
    ("world.mobs.*.core.weapon.targeting.plan_at", "mob_checkpoint requires player weapon-targeting state remain default; mob decisions use their separate validated brain"),
    ("world.mobs.*.core.weapon.targeting.search_at", "mob_checkpoint requires player weapon-targeting state remain default; mob decisions use their separate validated brain"),
    ("world.mobs.*.core.weapon.targeting.target", "mob_checkpoint requires player weapon-targeting state remain default; mob decisions use their separate validated brain"),
    ("world.mob_runtime.camps.*.state", "cleared camp state must agree with nonzero clear/respawn clocks and zero alive count"),
    ("world.mobs.*.core.signature.dot_paused_until", "signature pause is finite and bounded; gate-off requires default signature"),
    ("world.mobs.*.core.signature.engaged", "engagement requires target and reach timestamp; gate-off requires default signature"),
    ("world.mobs.*.core.signature.hp_frac", "signature fraction is finite; gate-off requires default signature"),
    ("world.mobs.*.core.signature.in_reach", "reach requires target and reach timestamp; gate-off requires default signature"),
    ("world.mobs.*.core.vitals.hp", "mob HP is finite in 0..max_hp and positive exactly when status is Alive"),
    ("world.mobs.*.core.weapon.held", "dead mobs must have no held attack or pending action"),
    // Exact coupled constraints exposed by the admitted three-mob corpus. No accepted edit is skipped.
    ("statics.arena.map.layers.data.camps.#len", "mapdata camp identity, zone, centre and ordered spots must match region mirrors, territory and retained mob births"),
    ("statics.arena.map.layers.data.camps.*.area", "mapdata::collision recomputes camp area from territory floor cells"),
    ("statics.arena.map.layers.data.camps.*.chest.x", "mapdata::camp_record requires chest equal camp centre and on floor"),
    ("statics.arena.map.layers.data.camps.*.chest.y", "mapdata::camp_record requires chest equal camp centre and on floor"),
    ("statics.arena.map.layers.data.camps.*.eliteSpot", "map elite spot must agree with region mirror and retained typed mob births"),
    ("statics.arena.map.layers.data.camps.*.id", "mapdata camp identity, zone, centre and ordered spots must match region mirrors, territory and retained mob births"),
    ("statics.arena.map.layers.data.camps.*.r", "mapdata camp identity, zone, centre and ordered spots must match region mirrors, territory and retained mob births"),
    ("statics.arena.map.layers.data.camps.*.spots.#len", "mapdata camp identity, zone, centre and ordered spots must match region mirrors, territory and retained mob births"),
    ("statics.arena.map.layers.data.camps.*.spots.*.x", "mapdata camp identity, zone, centre and ordered spots must match region mirrors, territory and retained mob births"),
    ("statics.arena.map.layers.data.camps.*.spots.*.y", "mapdata camp identity, zone, centre and ordered spots must match region mirrors, territory and retained mob births"),
    ("statics.arena.map.layers.data.camps.*.x", "mapdata camp identity, zone, centre and ordered spots must match region mirrors, territory and retained mob births"),
    ("statics.arena.map.layers.data.camps.*.y", "mapdata camp identity, zone, centre and ordered spots must match region mirrors, territory and retained mob births"),
    ("statics.arena.map.layers.data.camps.*.zone", "mapdata camp identity, zone, centre and ordered spots must match region mirrors, territory and retained mob births"),
    ("statics.arena.map.layers.data.coliseum.centre.x", "mapdata requires the coliseum centre and all coliseum cells/gates to agree with its rectangle and floor"),
    ("statics.arena.map.layers.data.coliseum.centre.y", "mapdata requires the coliseum centre and all coliseum cells/gates to agree with its rectangle and floor"),
    ("statics.arena.map.layers.data.coliseum.gates.#len", "mapdata requires four ordered sides with distinct contiguous boundary tiles and matching gate centres"),
    ("statics.arena.map.layers.data.coliseum.gates.*.side", "mapdata requires four ordered sides with distinct contiguous boundary tiles and matching gate centres"),
    ("statics.arena.map.layers.data.coliseum.gates.*.tiles.#len", "mapdata requires four ordered sides with distinct contiguous boundary tiles and matching gate centres"),
    ("statics.arena.map.layers.data.coliseum.gates.*.tiles.*.x", "mapdata requires four ordered sides with distinct contiguous boundary tiles and matching gate centres"),
    ("statics.arena.map.layers.data.coliseum.gates.*.tiles.*.y", "mapdata requires four ordered sides with distinct contiguous boundary tiles and matching gate centres"),
    ("statics.arena.map.layers.data.coliseum.gates.*.x", "mapdata requires four ordered sides with distinct contiguous boundary tiles and matching gate centres"),
    ("statics.arena.map.layers.data.coliseum.gates.*.y", "mapdata requires four ordered sides with distinct contiguous boundary tiles and matching gate centres"),
    ("statics.arena.map.layers.data.coliseum.innerSpawns.#len", "mapdata requires at least MAX_PLAYERS distinct coliseum floor spawns"),
    ("statics.arena.map.layers.data.coliseum.innerSpawns.*.x", "mapdata requires at least MAX_PLAYERS distinct coliseum floor spawns"),
    ("statics.arena.map.layers.data.coliseum.innerSpawns.*.y", "mapdata requires at least MAX_PLAYERS distinct coliseum floor spawns"),
    ("statics.arena.map.layers.data.coliseum.rect.h", "mapdata requires the coliseum centre and all coliseum cells/gates to agree with its rectangle and floor"),
    ("statics.arena.map.layers.data.coliseum.rect.w", "mapdata requires the coliseum centre and all coliseum cells/gates to agree with its rectangle and floor"),
    ("statics.arena.map.layers.data.coliseum.rect.x", "mapdata requires the coliseum centre and all coliseum cells/gates to agree with its rectangle and floor"),
    ("statics.arena.map.layers.data.coliseum.rect.y", "mapdata requires the coliseum centre and all coliseum cells/gates to agree with its rectangle and floor"),
    ("statics.arena.map.layers.data.featureGrid.#len", "mapdata grid lengths and collision dimensions must equal w*h"),
    ("statics.arena.map.layers.data.featureGrid.*", "mapdata feature cells must reference existing features; this admitted map has none"),
    ("statics.arena.map.layers.data.h", "mapdata grid lengths and collision dimensions must equal w*h"),
    ("statics.arena.map.layers.data.regionGrid.#len", "mapdata grid lengths and collision dimensions must equal w*h"),
    ("statics.arena.map.layers.data.regionGrid.*", "mapdata region cells must agree with areas, coliseum footprint, camps and declared destinations"),
    ("statics.arena.map.layers.data.regions.#len", "mapdata requires exactly five regions in faction order"),
    ("statics.arena.map.layers.data.regions.*.area", "mapdata::region_record recomputes region area from regionGrid"),
    ("statics.arena.map.layers.data.regions.*.id", "mapdata requires exactly five regions in faction order"),
    ("statics.arena.map.layers.data.regions.*.mobCamps.#len", "mapdata::region_record requires the exact ordered camp mirror and faction default weapon"),
    ("statics.arena.map.layers.data.regions.*.mobCamps.*.elite", "mapdata::region_record requires the exact ordered camp mirror and faction default weapon"),
    ("statics.arena.map.layers.data.regions.*.mobCamps.*.id", "mapdata::region_record requires the exact ordered camp mirror and faction default weapon"),
    ("statics.arena.map.layers.data.regions.*.mobCamps.*.r", "mapdata::region_record requires the exact ordered camp mirror and faction default weapon"),
    ("statics.arena.map.layers.data.regions.*.mobCamps.*.region", "mapdata::region_record requires the exact ordered camp mirror and faction default weapon"),
    ("statics.arena.map.layers.data.regions.*.mobCamps.*.spots.#len", "mapdata::region_record requires the exact ordered camp mirror and faction default weapon"),
    ("statics.arena.map.layers.data.regions.*.mobCamps.*.spots.*.x", "mapdata::region_record requires the exact ordered camp mirror and faction default weapon"),
    ("statics.arena.map.layers.data.regions.*.mobCamps.*.spots.*.y", "mapdata::region_record requires the exact ordered camp mirror and faction default weapon"),
    ("statics.arena.map.layers.data.regions.*.mobCamps.*.weapon", "mapdata::region_record requires the exact ordered camp mirror and faction default weapon"),
    ("statics.arena.map.layers.data.regions.*.mobCamps.*.x", "mapdata::region_record requires the exact ordered camp mirror and faction default weapon"),
    ("statics.arena.map.layers.data.regions.*.mobCamps.*.y", "mapdata::region_record requires the exact ordered camp mirror and faction default weapon"),
    ("statics.arena.map.layers.data.regions.*.pole.x", "mapdata requires faction poles on floor in their declared zone"),
    ("statics.arena.map.layers.data.regions.*.pole.y", "mapdata requires faction poles on floor in their declared zone"),
    ("statics.arena.map.layers.data.regions.*.spawns.#len", "mapdata requires each region spawn list equal its ordered spawnPool view"),
    ("statics.arena.map.layers.data.regions.*.spawns.*.x", "mapdata requires each region spawn list equal its ordered spawnPool view"),
    ("statics.arena.map.layers.data.regions.*.spawns.*.y", "mapdata requires each region spawn list equal its ordered spawnPool view"),
    ("statics.arena.map.layers.data.spawnPool.#len", "mapdata requires region spawns, spawnPool and ordered interleaved spawns to agree and name floor in the declared zone"),
    ("statics.arena.map.layers.data.spawnPool.*.x", "mapdata requires region spawns, spawnPool and ordered interleaved spawns to agree and name floor in the declared zone"),
    ("statics.arena.map.layers.data.spawnPool.*.y", "mapdata requires region spawns, spawnPool and ordered interleaved spawns to agree and name floor in the declared zone"),
    ("statics.arena.map.layers.data.spawnPool.*.zone", "mapdata requires region spawns, spawnPool and ordered interleaved spawns to agree and name floor in the declared zone"),
    ("statics.arena.map.layers.data.spawns.#len", "mapdata requires region spawns, spawnPool and ordered interleaved spawns to agree and name floor in the declared zone"),
    ("statics.arena.map.layers.data.spawns.*.x", "mapdata requires region spawns, spawnPool and ordered interleaved spawns to agree and name floor in the declared zone"),
    ("statics.arena.map.layers.data.spawns.*.y", "mapdata requires region spawns, spawnPool and ordered interleaved spawns to agree and name floor in the declared zone"),
    ("statics.arena.map.layers.data.terrain.#len", "mapdata grid lengths and collision dimensions must equal w*h"),
    ("statics.arena.map.layers.data.terrain.*", "mapdata terrain must agree with collision; outer border is unowned plain wall"),
    ("statics.arena.map.layers.data.territoryGrid.#len", "mapdata grid lengths and collision dimensions must equal w*h"),
    ("statics.arena.map.layers.data.territoryGrid.*", "mapdata territory cells must reference their camp/zone and reproduce its floor area"),
    ("statics.arena.map.layers.data.w", "mapdata grid lengths and collision dimensions must equal w*h"),
    ("statics.arena.map.tiles.*", "layered map collision must preserve border walls, destination floor and territory area"),
    ("world.actor_history.*.origin.Mob.birth_serial", "mob_checkpoint verifies typed camp/spot/type/elite provenance, initial serial order and raid birth tick against actual actors"),
    ("world.actor_history.*.origin.Mob.born_tick", "mob_checkpoint verifies typed camp/spot/type/elite provenance, initial serial order and raid birth tick against actual actors"),
    ("world.actor_history.*.origin.Mob.camp", "mob_checkpoint verifies typed camp/spot/type/elite provenance, initial serial order and raid birth tick against actual actors"),
    ("world.actor_history.*.origin.Mob.elite", "mob_checkpoint verifies typed camp/spot/type/elite provenance, initial serial order and raid birth tick against actual actors"),
    ("world.actor_history.*.origin.Mob.mob_type", "mob_checkpoint verifies typed camp/spot/type/elite provenance, initial serial order and raid birth tick against actual actors"),
    ("world.actor_history.*.origin.Mob.spot", "mob_checkpoint verifies typed camp/spot/type/elite provenance, initial serial order and raid birth tick against actual actors"),
    ("world.mob_runtime.camps.#len", "mob runtime camp and life arrays must match admitted map camp count"),
    ("world.mob_runtime.camps.*.alive", "camp alive count must equal actual standing mobs in that camp"),
    ("world.mob_runtime.camps.*.cleared_at", "uncleared camp clocks are zero; cleared camp expiry equals cleared_at plus CAMP_RESPAWN_MS"),
    ("world.mob_runtime.camps.*.elite", "published roster must match camp faction/elite spot and every retained typed birth"),
    ("world.mob_runtime.camps.*.mob_type", "published roster must match camp faction/elite spot and every retained typed birth"),
    ("world.mob_runtime.camps.*.respawn_at", "uncleared camp clocks are zero; cleared camp expiry equals cleared_at plus CAMP_RESPAWN_MS"),
    ("world.mob_runtime.combat", "supported PvE runtime requires combat enabled"),
    ("world.mob_runtime.buffs", "check_world ties the camp buff row to statics.config.camp_buffs: Legacy carries none (null), Themed one entry per camp"),
    ("world.mob_runtime.buffs.#len", "check_world ties the camp buff row to statics.config.camp_buffs: Themed carries one entry per camp, no fewer"),
    ("statics.config.camp_buffs", "a closed null/\"themed\" domain whose value must match the world's camp buff row (check_world): flipping it alone on a world with camps is refused; the config-only scenario perturbs it"),
    ("world.mob_runtime.life.#len", "mob runtime camp and life arrays must match admitted map camp count"),
    ("world.mob_runtime.life.*.contributors.*", "contributors are unique retained player identities, never future ids or mobs"),
    ("world.mob_runtime.life.*.ward_expires_at", "ward expiry is zero without owner, otherwise cleared_at plus CAMP_WARD_MS"),
    ("world.mobs.#len", "camp alive count and typed current birth cycle must agree with actual mob store"),
    ("world.mobs.*.brain", "actor class requires a brain exactly for non-zombie Regional/Practice NPCs; removing it there or adding one to a Training dummy is refused, while every nested brain leaf is still audited"),
    ("world.mobs.*.brain.mode", "target requires Fight mode; a dead mob must be Idle"),
    ("world.mobs.*.brain.threat.*.#len", "threat rows are exact (retained player id, finite nonnegative amount) pairs with unique ids"),
    ("world.mobs.*.brain.threat.*.*", "threat rows are exact (retained player id, finite nonnegative amount) pairs with unique ids"),
    ("world.mobs.*.camp", "mob identity/home/facing/phase must equal its retained typed camp birth and source-derived spawn"),
    ("world.mobs.*.core.body.history.*.t", "mob rewind times must be nonnegative, past and at least TICK_MS apart"),
    ("world.mobs.*.core.id", "mob identity/home/facing/phase must equal its retained typed camp birth and source-derived spawn"),
    ("world.mobs.*.core.modifiers.farm.#len", "mob mirrors must validate against empty player Build/Farm and catalog-derived max HP; arrays have canonical fixed lengths"),
    ("world.mobs.*.core.modifiers.farm.*", "mob mirrors must validate against empty player Build/Farm and catalog-derived max HP; arrays have canonical fixed lengths"),
    ("world.mobs.*.core.modifiers.max_hp_mult", "mob mirrors must validate against empty player Build/Farm and catalog-derived max HP; arrays have canonical fixed lengths"),
    ("world.mobs.*.core.modifiers.mults.#len", "mob mirrors must validate against empty player Build/Farm and catalog-derived max HP; arrays have canonical fixed lengths"),
    ("world.mobs.*.core.modifiers.mults.*", "mob mirrors must validate against empty player Build/Farm and catalog-derived max HP; arrays have canonical fixed lengths"),
    ("world.mobs.*.core.modifiers.sums.#len", "mob mirrors must validate against empty player Build/Farm and catalog-derived max HP; arrays have canonical fixed lengths"),
    ("world.mobs.*.core.modifiers.sums.*", "mob mirrors must validate against empty player Build/Farm and catalog-derived max HP; arrays have canonical fixed lengths"),
    ("world.mobs.*.core.modifiers.wire.#len", "mob mirrors must validate against empty player Build/Farm and catalog-derived max HP; arrays have canonical fixed lengths"),
    ("world.mobs.*.core.modifiers.wire.*", "mob mirrors must validate against empty player Build/Farm and catalog-derived max HP; arrays have canonical fixed lengths"),
    ("world.mobs.*.core.signature.bits", "signature bit domain and enabled faction mode are checked; unsupported bits are rejected"),
    ("world.mobs.*.core.signature.chill", "basic PvE excludes Frost; validate_basic requires default Frost runtime and canonical chiller storage"),
    ("world.mobs.*.core.signature.frost_move_mult", "basic PvE excludes Frost; validate_basic requires default Frost runtime and canonical chiller storage"),
    ("world.mobs.*.core.signature.mark.amp_until", "supported mob domain requires the complete Mark runtime remain default"),
    ("world.mobs.*.core.signature.mark.denied", "supported mob domain requires the complete Mark runtime remain default"),
    ("world.mobs.*.core.signature.mark.hits", "supported mob domain requires the complete Mark runtime remain default"),
    ("world.mobs.*.core.signature.mark.progress", "supported mob domain requires the complete Mark runtime remain default"),
    ("world.mobs.*.core.signature.mark.swaps", "supported mob domain requires the complete Mark runtime remain default"),
    ("world.mobs.*.core.signature.mark.tier", "supported mob domain requires the complete Mark runtime remain default"),
    ("world.mobs.*.core.vitals.barrier", "supported mob vitals require zero barrier and immunity clock"),
    ("world.mobs.*.core.vitals.faction", "mob vitals faction and max HP must equal its catalog-derived birth facts"),
    ("world.mobs.*.core.vitals.immune_until", "supported mob vitals require zero barrier and immunity clock"),
    ("world.mobs.*.core.vitals.max_hp", "mob vitals faction and max HP must equal its catalog-derived birth facts"),
    ("world.mobs.*.core.weapon.slot", "mob gear is its catalog weapon in slot zero with no player targeting state"),
    ("world.mobs.*.core.weapon.targeting.seen", "mob gear is its catalog weapon in slot zero with no player targeting state"),
    ("world.mobs.*.core.weapon.weapon0", "mob gear is its catalog weapon in slot zero with no player targeting state"),
    ("world.mobs.*.elite", "mob identity/home/facing/phase must equal its retained typed camp birth and source-derived spawn"),
    ("world.mobs.*.home.x", "mob identity/home/facing/phase must equal its retained typed camp birth and source-derived spawn"),
    ("world.mobs.*.home.y", "mob identity/home/facing/phase must equal its retained typed camp birth and source-derived spawn"),
    ("world.mobs.*.home_facing", "mob identity/home/facing/phase must equal its retained typed camp birth and source-derived spawn"),
    ("world.mobs.*.mob_type", "mob identity/home/facing/phase must equal its retained typed camp birth and source-derived spawn"),
    ("world.mobs.*.repath_phase", "mob identity/home/facing/phase must equal its retained typed camp birth and source-derived spawn"),
    ("world.mobs.*.status", "mob status is Alive or Dead and must agree with positive HP and dead brain/action constraints"),
    ("world.raid_started_at", "mob_checkpoint requires initial typed birth tick times TICK_MS equal raid_started_at"),
    ("world.mob_runtime", "PvE requires Some runtime; Off rejects it, so optional presence cannot change independently of mode and typed births"),
    ("world.containers.*.stat_offer", "initial crate entitlement must match the constructor replay; other props cannot retain one"),
    ("world.players.*.barrier_decays", "G6 decay flag is only valid with a positive private deadline; it is a bool, not a gameplay number"),
    ("world.players.*.healing_until", "expiry mirror must equal the active Small potion queue or zero when absent"),
    ("world.players.*.potions_healing", "active-count mirror must equal the actual Small potion queue length"),
    ("statics.config.mob_mode", "mode requires matching admitted camp layers and typed runtime/provenance"),
    ("statics.config.initial_loot", "constructor mode must match the replayed initial item storage and RNG prefix"),
    ("world.containers.*.ready_at", "only a travel cannon carries a reload clock; every other kind must keep zero and a cannon must stay a finite u32"),
    ("world.containers.*.target", "only a travel cannon carries a destination; every other kind must keep none and the constructor's link is immutable"),
    ("statics.config.consumables", "the travel producer must match the replayed constructor's consumables module profile"),
    ("world.initial_birth_serial", "constructor boundary must equal the real initial allocations"),
    ("world.next_id", "next allocation must follow the complete contiguous typed actor history"),
    ("world.actor_history.#len", "retained provenance must account for every player and mob allocation"),
    ("world.actor_history.*.id", "retained history ids are contiguous and agree with roster and runtime stores"),
    ("world.actor_history.*.origin.Player.join_ordinal", "player provenance ordinal must agree with retained roster order"),
    ("world.reward_chests.*.options.*.Card","closed supported card domain and distinct option ids"),
    ("world.reward_chests.*.options.*.Boost","closed source boost domain and distinct option ids"),
    ("world.reward_chests.*.pickers.#len","a taken option retains its picker"),
    ("world.reward_chests.*.pickers.*","retained roster identity and matching taken slot"),
    ("world.reward_chests.*.id","allocated monotonic entity id, distinct from props/projectiles/fields"),
    ("world.reward_rng.words.#len","source private RNG is exactly four words"),
    ("statics.secrets.reward_salt.#len","source private RNG seed is exactly four words"),
    ("world.players.*.build.counts.#len","the source card count map has exactly one count per card (80)"),
    ("world.players.*.build.counts.*","source counts are u8; unique cards have at most one, and a grant must update the folded facts"),
    ("world.players.*.build.boosts.#len","eight source boost counts"),
    ("world.players.*.build.boosts.*","at most three picks; a grant must update the canonical fold"),
    ("world.players.*.farm.counts.#len","exact twenty normal-type facts"),
    ("world.players.*.farm.counts.*","safe integer reward counts; a grant must update the canonical farm fold"),
    ("world.players.*.core.modifiers.sums.#len","canonical fixed stat keys"),
    ("world.players.*.core.modifiers.sums.*","cached sums must match actual card/boost facts"),
    ("world.players.*.core.modifiers.farm.#len","canonical fixed stat keys"),
    ("world.players.*.core.modifiers.farm.*","cached farm sums must match actual earned facts"),
    ("world.players.*.core.modifiers.mults.#len","canonical fixed product keys"),
    ("world.players.*.core.modifiers.mults.*","products must match the actual selected rows"),
    ("world.players.*.core.modifiers.wire.#len","exact seven encoded source mirrors"),
    ("world.players.*.core.modifiers.wire.*","integral codecs and fact-derived ranges preserve quiet status timing"),
    ("world.players.*.core.modifiers.max_hp_mult","max HP multiplier matches the actual row/farm sums"),
    ("world.reward_chests.*.options.#len","three closed offer slots"),
    ("world.reward_chests.*.taken.#len","taken slots align with three offers"),
    ("world.reward_chests.*.taken.*","picker provenance and one option per picker"),

    ("world.players.*.core.statuses.initialized", "a nonempty status table or cast requires initialized runtime; empty runtime presence is separately perturbed"),
    ("world.players.*.core.vitals.faction","nondefault Mark runtime is owned only by a Sentenced faction"),
    ("world.players.*.core.signature.mark.tier","trusted singleton Mark requires its mode/faction, legal progress/tier/counters, target and bounded clocks"),
    ("world.players.*.core.signature.mark.hits","trusted singleton Mark requires its mode/faction, legal progress/tier/counters, target and bounded clocks"),
    ("world.players.*.core.signature.mark.progress","trusted singleton Mark requires its mode/faction, legal progress/tier/counters, target and bounded clocks"),
    ("world.players.*.core.signature.mark.swaps","trusted singleton Mark requires its mode/faction, legal progress/tier/counters, target and bounded clocks"),
    ("world.players.*.core.signature.mark.denied","trusted singleton Mark requires its mode/faction, legal progress/tier/counters, target and bounded clocks"),
    ("world.players.*.core.signature.mark.far_since","trusted singleton Mark requires its mode/faction, legal progress/tier/counters, target and bounded clocks"),
    ("world.players.*.core.signature.mark.amp_until","trusted singleton Mark requires its mode/faction, legal progress/tier/counters, target and bounded clocks"),
    ("world.players.*.core.signature.mark.group_size","sentenced::validate_actor requires size one for an absent/Fighter group; a Camp group's retained size is positive and bounded by its admitted camp; accepted historical sizes must still change the hash"),
    ("world.players.*.core.signature.mark.group","Sentenced group presence is coupled to retained tier and historical target identity; removing or replacing it alone can violate validate_actor"),
    ("world.players.*.core.signature.mark.group.Fighter","a Fighter Mark group must match the retained target's historical group; changing its actor id alone violates validate_actor"),
    ("world.players.*.core.signature.mark.group.Camp","a Camp Mark group must match the retained target's historical camp and admitted camp domain; changing the camp alone violates validate_actor"),
    ("world.mobs.*.core.signature.mark.group_size","NPC Mark state is absent or a human Fighter singleton with size exactly one; changing size alone is refused by Sentenced checkpoint validation"),
    ("world.mobs.*.core.signature.mark.group","nondefault NPC Mark state requires an admitted typed Sentenced source and a matching historical human target; removing its group alone can violate validate_actor"),
    ("world.mobs.*.core.signature.mark.group.Fighter","an NPC Fighter Mark group must match the retained human target and roster origin; changing the id alone violates validate_actor"),
    ("statics.config.quests","quests::giver::validate and trader runtime validation require the installed quest/giver/trader state to match its enabled profile; toggling the config alone can leave an invalid installed runtime"),
    ("world.players.*.credit.sentence","Sentenced-only persistent stacks require the final mode and cap at five"),
    ("world.players.*.core.signature.chill","trusted Frost domain, mode, canonical source storage and episode constraints"),
    ("world.players.*.core.signature.exposure_started_at","trusted Frost domain, mode, canonical source storage and episode constraints"),
    ("world.players.*.core.signature.last_near_at","trusted Frost domain, mode, canonical source storage and episode constraints"),
    ("world.players.*.core.signature.ranged_chill_until","trusted Frost domain, mode, canonical source storage and episode constraints"),
    ("world.players.*.core.signature.frost_move_mult","trusted Frost domain, mode, canonical source storage and episode constraints"),

    ("world.deferred.hits.*.execute","execute requires a signature-qualified entry"),
    ("world.deferred.hits.*.sig","signature entries require the explicit Plague producer mode"),
    ("world.factions.dot_since","flush clock is finite and no later than server time; gate-off runtime must be default"),
    ("world.players.*.core.signature.dot_paused_until","pause is finite and bounded by the maximum weapon windup; gate-off state is default"),
    ("world.players.*.core.signature.bits","only Disease/Execute bits exist in the Plague mode"),
    ("world.factions.dot.*.sig","only delayed Disease/Burn signatures are valid; Backlash is instantaneous"),
    ("world.factions.dot.*.by","private source identity belongs to retained roster and differs from victim"),
    ("world.factions.dot.*.victim","private victim identity belongs to retained roster and differs from source"),
    ("statics.config.faction_mode","nondefault signature state requires its partial foundation gate"),
    ("world.players.*.core.signature.target","signature targets name another actor in the roster"),
    ("world.players.*.core.signature.in_reach","reach requires a target and reach timestamp; gate-off state is default"),
    ("world.players.*.core.signature.engaged","engagement requires a target and reach timestamp; gate-off state is default"),
    ("world.players.*.core.signature.reach_at","finite past timestamp only; gate-off state is default"),
    ("world.players.*.core.signature.contact_at","targets require a finite contact timestamp; gate-off state is default"),
    ("world.players.*.core.signature.combat_at","finite past timestamp only; gate-off state is default"),
    ("world.players.*.core.signature.hp_frac","pre-ledger fraction must be finite; gate-off state is default"),

    ("world.players.*.resolved", "a live target lock requires an unresolved standing owner; resolved also changes the hash in unlocked matches"),
    ("world.players.*.status", "a live target lock requires a standing owner; status also changes the hash in unlocked matches"),
    ("world.players.*.core.weapon.weapon0", "a live target lock requires its active slot to hold a wand; carried weapons are separately perturbed in unlocked matches"),
    ("world.players.*.core.weapon.slot", "a live target lock cannot switch its active slot to fists; slot is separately perturbed in unlocked matches"),
    ("world.players.*.core.weapon.action.kind","kind must agree with the held weapon"),
    ("world.players.*.core.weapon.action.weapon","pending weapon must be the held one"),

    ("world.players.*.core.weapon.targeting.seen","a lock must exist to mark prior direct sight"),
    ("world.players.*.core.weapon.targeting.target","the holder must name another joined actor and retain a lock while seen"),

    ("world.players.*.vision.reveals.*.tick","vision samples are at least one refresh interval apart, in tick order"),
    ("world.phase","settled live flights belong only to an active world"),
    ("world.server_time","settled projectile clock equals the world clock"),
    ("world.projectiles.*.launch.kind", "flight kind and catalog speed agree"),
    ("world.projectiles.*.launch.id","run entity ids are allocated, distinct and monotone"),
    ("world.projectiles.*.launch.reflected", "reflected requires a return count and a shield arrow"),
    ("world.projectiles.*.launch.height", "ADR0024: exactly 0 under LegacyCircle, a table chest value under Archetypes (archetype::valid_height)"),
    ("world.projectiles.*.reflections", "return count agrees with the launch"),
    ("world.projectiles.*.halved","only a ball can be intercepted by a sword"),
    ("world.projectiles.*.time","settled projectiles end exactly at the simulation clock"),
    ("world.item_counter", "item identities are bounded by actual weapon/potion capacity of allocated entities"),
    ("world.containers.*.items.#len", "typed item storage is bounded by two weapons plus capped potion stock"),
    ("world.containers.*.opened", "only chests can be opened"),
    ("world.containers.*.id", "container ids are unique and cannot exceed the allocated counter"),
    ("world.containers.*.items.*.uid", "item ids must be unique, nonzero and allocated"),
    (
        "statics.arena.map.w",
        "TileMap::new checks w*h == tiles.len()",
    ),
    (
        "statics.arena.map.h",
        "TileMap::new checks w*h == tiles.len()",
    ),
    (
        "statics.arena.map.tiles.#len",
        "TileMap::new checks w*h == tiles.len()",
    ),
    (
        "world.players.*.core.id",
        "a store is strictly ordered by id: a middle id moved by one collides (the last player's id is perturbed)",
    ),
    (
        "world.players.*.credit.last_hit.#len",
        "a tuple (attacker, time) has no shorter form",
    ),
    (
        "world.roster.names.*.*",
        "the roster is strictly ordered by id like the store, and below next_id: a neighbour's id collides",
    ),
    (
        "world.players.*.core.body.history.*.t",
        "samples are at least a tick apart and not after the clock (checkpoint.rs `check_world`)",
    ),
    (
        "world.roster.names.#len",
        "kills, joined and downs are bounded by the roster length (checkpoint.rs `check_world`)",
    ),
    (
        "world.roster.names.*.#len",
        "a roster entry is a (id, name) pair",
    ),
    (
        "world.players.*.core.weapon.action.roam_armed",
        "only a Fire seat's armed attack carries the mark; an unarmed action or another faction's flag is refused (checkpoint.rs)",
    ),
    (
        "world.projectiles.*.roam_armed",
        "the armed mark only launches from a Fire seat's armed attack; a reflected or other-owner flight is refused (checkpoint.rs)",
    ),
    (
        "world.players.*.frost_guard.active",
        "only a live Frost seat in an active run may hold the guard; every other seat's flag is refused (checkpoint.rs)",
    ),
];

/// `Some` values for optional leaves that no scripted match produces between steps (an item slot has no flow in the slice,
/// a swing is finished or cancelled by the step that ends it, a kill announcement is sent within its step).
fn seeds(pat: &str) -> Vec<Value> {
    match pat {
        "world.abilities" => {
            vec![serde_json::json!({"fields":[],"teleported_at":null,"dot":[],"dot_since":0.0})]
        }
        "world.players.*.core.card_dot_crit" => {
            vec![serde_json::json!({"accumulator":0.0,"roll_tick":0,"critical":false})]
        }
        "world.players.*.core.statuses.cast" => vec![
            serde_json::json!({"ability":"freeze","started_at":0.0,"lands_at":10000.0,"cancelled_by":{"stun":true,"silence":true,"root":false,"stagger":false}}),
        ],
        "world.players.*.core.motion.slip" => vec![
            serde_json::json!({"vx":0.0,"vy":0.0,"ax":0.0,"ay":0.0,"path":null,"replan_at":null,"stuck_x":null,"stuck_y":null,"stuck_n":null,"stuck_best":null,"stuck_at":null,"grip_until":null}),
        ],
        "world.players.*.fate.killed_by_name" => {
            vec![serde_json::json!("departed source snapshot")]
        }
        "world.players.*.core.statuses.instances.*.ability" | "world.deferred.hits.*.ability" => {
            vec![serde_json::json!("freeze")]
        }
        "world.players.*.core.statuses.instances.*.data.shares" => {
            vec![serde_json::json!({"phys":0.0,"magic":0.0,"true_":1.0})]
        }
        "world.deferred.hits.*.source" => {
            vec![serde_json::json!({"id":1,"name":"retained source","owner_id":null})]
        }
        "world.players.*.core.weapon.weapon0" | "world.players.*.core.weapon.weapon1" => {
            vec![serde_json::json!("Axe"), serde_json::json!("Bow")]
        }
        "world.players.*.core.weapon.action" => vec![serde_json::json!({
            "kind": "Swing", "weapon": "Fists", "started_at": 1.0, "lands_at": 2.0, "a": 0.5,
            "packet": {"raw": 1.0, "phys": 1.0, "magic": 0.0, "true_": 0.0}
        })],
        "world.players.*.core.weapon.targeting.goal" => {
            vec![serde_json::json!({"x":360.0,"y":272.0})]
        }
        "world.players.*.credit.announce" => vec![serde_json::json!([1.0, 1])],
        // A real between-step MIA cancellation also queues Resolved. These optional result leaves are None for MIA;
        // declared serialization perturbations prove their hash coverage without inventing a gameplay outcome.
        "world.pending_events.*.Resolved.result.killed_by" => {
            vec![serde_json::json!("hash sensitivity source")]
        }
        "world.pending_events.*.Resolved.result.weapon" => {
            vec![serde_json::json!("Sword")]
        }
        "world.pending_events.*.Resolved.result.win_bonus_why" => {
            vec![serde_json::json!("Starters")]
        }
        _ => vec![],
    }
}

fn perturb_all(sim: &Sim, pool: &BTreeMap<String, Vec<Value>>, tally: &mut Tally) {
    let mut undocumented = BTreeSet::new();
    let base = serde_json::to_value(sim).unwrap();
    let h0 = sim.state_hash();
    assert_eq!(
        Sim::restore(&base)
            .expect("the checkpoint restores")
            .state_hash(),
        h0,
        "restore is hash-exact"
    );
    let mut items = Vec::new();
    walk(&base, &mut Vec::new(), &mut items);
    let strings: Vec<String> = {
        let mut s: Vec<String> = items
            .iter()
            .filter_map(|i| i.value.as_str().map(str::to_owned))
            .collect();
        // Enum variants that may not appear in the checkpoint (a string leaf is tried as each of them).
        for extra in [
            "Lobby",
            "Active",
            "Ended",
            "Alive",
            "Dead",
            "Mia",
            "Holy",
            "Fire",
            "Frost",
            "Sentenced",
            "Plague",
            "Fists",
            "Sword",
            "Bow",
            "Wand",
            "Shield",
            "Axe",
            "Swing",
            "Cast",
            "Draw",
            "Won",
            "Died",
            "Chest",
            "Ground",
            "Arrow",
            "Ball",
            "stun",
            "root",
            "silence",
            "slowMove",
            "slowAttack",
            "antiHeal",
            "dot",
            "invulnerable",
            "untargetable",
            "hidden",
            "zoned",
            "deathFloor",
            "haste",
            "shred",
            "freeze",
            "swarm",
            "trial",
            "blaze",
            "lastStand",
        ] {
            s.push(extra.into());
        }
        s.sort();
        s.dedup();
        s
    };
    for item in &items {
        let (path, leaf) = (&item.path, &item.value);
        if matches!(
            path.first().map(String::as_str),
            Some("format" | "content_hash" | "build")
        ) {
            continue; // the tag and the content/build header are checked by `restore`, not hashed
        }
        let p = path_of(path);
        let pat = pattern(&p);
        if item.kind == Kind::Leaf && leaf.is_null() {
            tally.optional_seen.push(pat.clone());
        }
        if item.kind != Kind::Subtree {
            tally.leaves += 1;
        }
        let secret = p.starts_with("statics.secrets");
        let tries: Vec<Value> = match item.kind {
            Kind::Leaf
                if matches!(
                    pat.as_str(),
                    "world.players.*.card_runtime.fight.start"
                        | "world.players.*.card_runtime.fight.last"
                ) =>
            {
                // Source clocks live on the fixed-step grid: one ULP would be a
                // restore refusal rather than a useful accepted hash perturbation.
                let at = leaf.as_f64().unwrap();
                vec![
                    serde_json::json!(at + rh_sim::constants::TICK_MS),
                    serde_json::json!(at - rh_sim::constants::TICK_MS),
                ]
            }
            Kind::Leaf if p.ends_with(".core.modifiers.wire.0") => {
                vec![serde_json::json!(800.0), serde_json::json!(900.0)]
            }
            Kind::Leaf if p.ends_with(".core.modifiers.wire.3") => {
                vec![serde_json::json!(-30.0), serde_json::json!(-60.0)]
            }
            Kind::Leaf if pat == "world.players.*.core.statuses.instances.*.value" => {
                vec![serde_json::json!(if leaf == &serde_json::json!(3.0) {
                    6.0
                } else {
                    3.0
                })]
            }
            Kind::Len | Kind::Subtree => vec![Value::Null],
            Kind::Leaf if pat == "world.players.*.bush.pending" && leaf.is_null() => {
                vec![serde_json::json!(
                    sim.tick() as f64 * rh_sim::constants::TICK_MS + 1000.0
                )]
            }
            Kind::Leaf if leaf.is_null() => {
                let mut v = pool.get(&pat).cloned().unwrap_or_default();
                v.extend(seeds(&pat));
                // Shared FighterCore option types reuse real player examples, while the
                // mob restore still enforces its stricter supported recipient/gear domain.
                if let Some(tail) = pat.strip_prefix("world.mobs.*.core.") {
                    let player = format!("world.players.*.core.{tail}");
                    v.extend(pool.get(&player).cloned().unwrap_or_default());
                    v.extend(seeds(&player));
                }
                v.extend([serde_json::json!(1), serde_json::json!(1.5)]);
                v
            }
            Kind::Leaf if pat == "world.containers.*.kind" => {
                vec![serde_json::json!({"Body": 1}), serde_json::json!("Chest")]
            }
            Kind::Leaf => candidates(leaf, &strings),
        };
        // `bot_kills` may not exceed `kills` (checkpoint.rs `check_world`) and no scripted match has kills at this moment:
        // perturb it from a base where the fighter has some, and compare against that base's hash.
        let (base, h0) = if pat == "world.players.*.credit.bot_kills" {
            let mut b = base.clone();
            let mut at = path.clone();
            at.pop();
            let kills = at_mut(&mut b, &[&at[..], &["kills".to_string()]].concat());
            // A solo Training world has only one retained player. Keep the probe
            // inside that roster bound and never lower already-recorded credit.
            let room_for_probe = sim.players().len().min(3) as u64;
            *kills = kills.as_u64().unwrap().max(room_for_probe).into();
            let h = Sim::restore(&b)
                .expect("kills within the roster restore")
                .state_hash();
            (b, h)
        } else {
            (base.clone(), h0)
        };
        let mut result = None;
        for cand in tries {
            if item.kind == Kind::Leaf && cand == *leaf {
                continue;
            }
            let mut v = base.clone();
            match item.kind {
                Kind::Len => {
                    // Shorten the array: drop its last element.
                    let arr = at_mut(&mut v, &path[..path.len() - 1]);
                    arr.as_array_mut().unwrap().pop();
                }
                _ => *at_mut(&mut v, path) = cand,
            }
            if let Ok(s) = Sim::restore(&v) {
                result = Some(s.state_hash());
                break;
            }
        }
        match (item.kind, result) {
            // A subtree is only perturbed where it is optional; a required one legitimately refuses to vanish.
            (Kind::Subtree, None) => {
                if VALIDATED.iter().any(|(v, _)| *v == pat) {
                    tally.validated_optional.push(pat);
                }
            }
            (Kind::Subtree, Some(h)) => {
                assert_ne!(
                    h, h0,
                    "`{p}`: removing an optional subtree must change the hash"
                );
                tally.changed += 1;
                tally.perturbed.push(pat);
            }
            (_, None) if leaf.is_null() => {
                if VALIDATED.iter().any(|(v, _)| *v == pat) {
                    tally.validated_optional.push(pat);
                } else {
                    tally.null_left.push(pat);
                }
            }
            (_, None) => {
                if !VALIDATED.iter().any(|(v, _)| *v == pat) {
                    undocumented.insert(pat.clone());
                }
                tally.validated.push(pat);
            }
            (_, Some(h)) if secret => {
                assert_eq!(
                    h, h0,
                    "`{p}`: the secrets must stay out of the state hash (C-RNG)"
                );
                tally.secrets_checked += 1;
            }
            (_, Some(h)) if h != h0 => {
                tally.changed += 1;
                tally.perturbed.push(pat);
            }
            (_, Some(_)) => tally.unhashed.push(p),
        }
    }
    assert!(
        undocumented.is_empty(),
        "restore-refused paths need exact documented validation: {undocumented:#?}"
    );
}

fn report(name: &str, t: &Tally) {
    eprintln!(
        "{name}: {} leaves, {} perturbations changed the hash, {} unhashed, {} validated-refused, {} null left, {} secret leaves held out",
        t.leaves,
        t.changed,
        t.unhashed.len(),
        t.validated.len(),
        t.null_left.len(),
        t.secrets_checked
    );
}

fn pool_of(sims: &[(&str, Sim)]) -> BTreeMap<String, Vec<Value>> {
    let mut pool = BTreeMap::new();
    for (_, s) in sims {
        harvest(
            &serde_json::to_value(s).unwrap(),
            &mut Vec::new(),
            &mut pool,
        );
    }
    pool
}

#[test]
fn every_serialized_leaf_of_a_match_changes_the_state_hash() {
    let sims = scenarios();
    let pool = pool_of(&sims);
    for path in [
        "world.players.*.core.statuses.cast.producer",
        "world.players.*.card_runtime",
        "world.players.*.card_runtime.wish_cast",
        "world.players.*.stocks.wish_full_at",
    ] {
        assert!(
            pool.get(path)
                .is_some_and(|values| values.iter().any(|v| !v.is_null())),
            "actual Wish producer must populate {path}"
        );
    }
    for path in [
        "world.players.*.core.modifiers.holds",
        "statics.config.walk_hints",
        "world.players.*.card_runtime.fight.start",
        "world.players.*.card_runtime.fight.last",
        "world.factions.taxed.*.victim",
        "world.factions.taxed.*.by",
        "world.factions.public_tax.*.victim",
        "world.factions.public_tax.*.percent",
        "world.players.*.walk_dir",
        "world.players.*.walk_ticks",
    ] {
        assert!(
            pool.get(path)
                .is_some_and(|values| values.iter().any(|v| !v.is_null())),
            "declared native29 serialization seed must populate {path}"
        );
    }
    for path in ["world.players.*.walk_dir", "world.players.*.walk_ticks"] {
        assert!(
            pool[path]
                .iter()
                .any(|value| value.as_u64().is_some_and(|v| v > 0)),
            "nonzero declared Player hint must remain present: {path}"
        );
    }
    let mut all = Tally::default();
    for (name, sim) in &sims {
        let mut t = Tally::default();
        perturb_all(sim, &pool, &mut t);
        report(name, &t);
        all.leaves += t.leaves;
        all.changed += t.changed;
        all.unhashed
            .extend(t.unhashed.iter().map(|p| format!("{name}: {p}")));
        all.null_left.extend(t.null_left);
        all.optional_seen.extend(t.optional_seen);
        all.validated_optional.extend(t.validated_optional);
        all.perturbed.extend(t.perturbed);
    }
    assert!(
        all.leaves > 5000,
        "real matches have many leaves: {}",
        all.leaves
    );
    assert!(
        all.unhashed.is_empty(),
        "serialized leaves the state hash does not see: {:#?}",
        all.unhashed
    );
    // A certified map supplies the optional layers. Exercise that root on its matching
    // collision map; independently perturbing every one of its 25,600 tiles is unnecessary.
    let file: rh_sim::mapdata::MapExport =
        serde_json::from_str(include_str!("../src/mapdata/fixtures/seed1.map.json")).unwrap();
    let layered = Sim::new(
        SimConfig::default(),
        file.validate().unwrap().into_arena().unwrap(),
        Secrets::from_seed(1),
    );
    let mut cp = serde_json::to_value(&layered).unwrap();
    let path = ["statics", "arena", "map", "layers"].map(String::from);
    let layers = at_mut(&mut cp, &path);
    assert!(layers.is_object());
    *layers = Value::Null;
    assert_ne!(
        Sim::restore(&cp).unwrap().state_hash(),
        layered.state_hash()
    );
    all.perturbed.push(path_of(&path));
    // An actual map-ice producer supplies Some, rather than inventing Off-state slip.
    let sliding = native_ice_slide();
    let mut checkpoint = serde_json::to_value(&sliding).unwrap();
    assert_eq!(
        Sim::restore(&checkpoint).unwrap().state_hash(),
        sliding.state_hash()
    );
    assert!(checkpoint["world"]["players"][0]["core"]["motion"]["slip"].is_object());
    checkpoint["world"]["players"][0]["core"]["motion"]["slip"] = Value::Null;
    assert_ne!(
        Sim::restore(&checkpoint).unwrap().state_hash(),
        sliding.state_hash()
    );
    all.optional_seen
        .push("world.players.*.core.motion.slip".into());
    all.perturbed
        .push("world.players.*.core.motion.slip".into());
    // Every optional pattern must either accept a hash-changing edit somewhere in the corpus
    // or have an exact documented restore refusal (including role-forbidden Some values).
    // Accepted edits are always checked, even for patterns listed in VALIDATED.
    let perturbed: BTreeSet<&String> = all.perturbed.iter().collect();
    for path in [
        "world.players.*.core.modifiers.holds",
        "statics.config.walk_hints",
        "world.players.*.card_runtime.fight.start",
        "world.players.*.card_runtime.fight.last",
        "world.factions.taxed.*.victim",
        "world.factions.taxed.*.by",
        "world.factions.public_tax.*.percent",
        "world.players.*.walk_dir",
        "world.players.*.walk_ticks",
    ] {
        assert!(
            perturbed.iter().any(|actual| actual.as_str() == path),
            "native29 leaf needs an accepted hash-changing edit: {path}"
        );
    }
    let validated_optional: BTreeSet<&String> = all.validated_optional.iter().collect();
    let never: BTreeSet<&String> = all
        .null_left
        .iter()
        .filter(|p| !perturbed.contains(p) && !validated_optional.contains(p))
        .collect();
    assert!(
        never.is_empty(),
        "optional leaves neither perturbed nor documented as restore-validated (extend a scenario so they are Some): {never:#?}"
    );
    let optional_seen: BTreeSet<_> = all.optional_seen.iter().collect();
    let some_count = optional_seen
        .iter()
        .filter(|p| pool.get(**p).is_some_and(|v| !v.is_empty()))
        .count();
    eprintln!("OPTIONALS: {some_count} patterns have actual Some values in the corpus; {} exact restore-validated optional patterns", validated_optional.len());
    eprintln!(
        "TOTAL: {} leaves, {} perturbations changed the hash, {} unhashed",
        all.leaves,
        all.changed,
        all.unhashed.len()
    );
}

/// The checkpoint of a sim with a hit queued for the next tick (`world.deferred`), written as JSON because the queue has
/// no producer in the slice yet. Its leaves are perturbed like any other.
#[test]
fn a_deferred_queue_and_every_roster_name_are_hashed() {
    let mut sim = crowded_8();
    drive(&mut sim, 10);
    let mut cp = serde_json::to_value(&sim).unwrap();
    cp["world"]["deferred"]["hits"] = serde_json::json!([{
        "victim": 2, "by": 1,
        "terrain":false,"dot":false,"ability":null,"arena":false,"source":null,"critical":false,"critical_mult":null,
        "sig": null,"execute": false,
            "packet": {"raw": 5.0, "phys": 4.0, "magic": 1.0, "true_": 0.0},
        "weapon": "Fists", "stagger": true, "scale": 1.0, "derived":false, "projectile":null
    }]);
    let queued = Sim::restore(&cp).expect("a checkpoint with a queued hit restores");
    assert_ne!(
        queued.state_hash(),
        sim.state_hash(),
        "a queued hit is state"
    );
    let mut t = Tally::default();
    perturb_all(&queued, &BTreeMap::new(), &mut t);
    report("queued hit", &t);
    assert!(t.unhashed.is_empty(), "{:?}", t.unhashed);
    assert!(
        t.changed > 0
            && t.validated
                .iter()
                .filter(|p| p.contains("deferred"))
                .all(|p| p.ends_with("execute") || p.ends_with("sig") || p.ends_with("terrain")),
        "the queued hit's own leaves were perturbed and hashed"
    );
    // The new optional signature and execute qualification are independently hash-covered
    // on a valid qualified queue; the Off queue above must refuse them.
    cp["statics"]["config"]["faction_mode"] = serde_json::json!("EngagementHolyPlague");
    cp["world"]["deferred"]["hits"][0]["sig"] = serde_json::json!("Disease");
    cp["world"]["deferred"]["hits"][0]["execute"] = serde_json::json!(false);
    let qualified = Sim::restore(&cp).unwrap();
    let mut q = Tally::default();
    perturb_all(&qualified, &BTreeMap::new(), &mut q);
    assert!(q.unhashed.is_empty());
    assert!(q.perturbed.iter().any(|p| p == "world.deferred.hits.*.sig"));
    assert!(q
        .perturbed
        .iter()
        .any(|p| p == "world.deferred.hits.*.execute"));
    // The roster (the join names) is deliberately covered: a name is outcome (killed_by, the winner).
    let mut renamed = serde_json::to_value(&sim).unwrap();
    renamed["world"]["roster"]["names"][0][1] = "someone else".into();
    assert_ne!(
        Sim::restore(&renamed).unwrap().state_hash(),
        sim.state_hash(),
        "a roster name is hashed"
    );
}

#[test]
fn in_flight_projectile_leaves_are_hashed_or_validated() {
    for weapon in [rh_sim::WeaponId::Bow, rh_sim::WeaponId::Wand] {
        let p = Placement {
            profile: "shooter".into(),
            faction: FactionId::Holy,
            at: Vec2::new(100., 272.),
            hp: None,
            weapon0: Some(weapon),
            weapon1: None,
            bot: false,
        };
        let target = Placement {
            profile: "target".into(),
            at: Vec2::new(980., 272.),
            ..p.clone()
        };
        let mut sim = Sim::reset_active(
            SimConfig::default(),
            practice_arena(),
            Secrets::from_seed(3),
            &[
                p,
                target.clone(),
                Placement {
                    profile: "third".into(),
                    ..target.clone()
                },
                Placement {
                    profile: "fourth".into(),
                    ..target
                },
            ],
        );
        sim.submit(PlayerId(1), cmd(RawCommand::Attack { a: 0., t: None }))
            .unwrap();
        while !sim
            .step()
            .iter()
            .any(|e| matches!(e, rh_sim::Event::ProjectileLaunched(_)))
        {}
        sim.step();
        let mut tally = Tally::default();
        perturb_all(&sim, &BTreeMap::new(), &mut tally);
        report("in flight", &tally);
        assert!(tally.unhashed.is_empty(), "{:?}", tally.unhashed);
        assert!(tally
            .perturbed
            .iter()
            .any(|p| p == "world.projectiles.*.packet.raw"));
        assert!(tally
            .perturbed
            .iter()
            .any(|p| p == "world.projectiles.*.launch.origin.x"));
    }
}

#[test]
fn the_layout_check_accepts_real_matches() {
    for sim in [
        {
            let mut s = crowded_8();
            drive(&mut s, 300);
            s
        },
        lobby_after_leave(),
    ] {
        assert_eq!(
            sim.check_layout(),
            Ok(()),
            "no non-finite float, skipped or flattened field anywhere in a checkpoint"
        );
    }
}

/// A `#[serde(skip)]` field is outside the checkpoint AND the hash (by construction it cannot be in one and not the
/// other), so every one is a decision. This pins the complete list; adding one means editing it here, with its reason.
#[test]
fn the_serde_skips_are_exactly_the_documented_ones() {
    let documented: &[(&str, usize, &str)] = &[
        (
            "map.rs",
            3,
            "TileMap: derived tables (components, A* step mask, padded tile grid), rebuilt by TileMap::new while decoding",
        ),
        (
            "state.rs",
            3,
            "World: the same-tick payout queue (empty at every step boundary), the schedule trace (tests only) and the Overkill splash requests (recorded during the pass and drained by the after-damage system)",
        ),
        (
            "statics.rs",
            7,
            "MatchStatic: the digest and hazard flags are rebuilt from stored fields; terrain source is rebuilt from hashed EMBER_NAME and typed terrain attribution; locked collision and all its query caches derive from admitted open map gate coordinates; planning distances derive from the same canonical map and enabled configuration; arena source derives from hashed SUDDEN_DEATH_NAME and typed arena attribution; cloned blink_ring is rebuilt by StaticRepr→MatchStatic::new→Ring::new solely from canonical map dimensions and coliseum layer geometry",
        ),
        (
            "systems/signatures.rs",
            2,
            "LandedHit (per-tick scratch and the derived fx report, never World state): the source's passive/derived flags, read only by the card weapon-hit test inside the tick that recorded them",
        ),
        (
            "systems/card_bleed_feedback.rs",
            1,
            "CardBleedReport: the derived trusted pair index (arena AVL row ordinals) is rebuilt from the serialized ordered rows by cold construction/clone/restore preparation; it is never stored or hashed",
        ),
    ];
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut found: BTreeMap<String, usize> = BTreeMap::new();
    let mut stack = vec![dir.clone()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().is_some_and(|x| x == "rs") {
                let n = std::fs::read_to_string(&p)
                    .unwrap()
                    .lines()
                    .filter(|l| is_serde_skip(l))
                    .count();
                if n > 0 {
                    found.insert(p.strip_prefix(&dir).unwrap().display().to_string(), n);
                }
            }
        }
    }
    let want: BTreeMap<String, usize> = documented
        .iter()
        .map(|(f, n, _)| (f.to_string(), *n))
        .collect();
    assert_eq!(
        found, want,
        "a `#[serde(skip...)]` was added or removed: it is outside the checkpoint and the state hash; document it here"
    );
}

/// A serde attribute line that skips a field in any spelling (`skip`, `skip, default`, `skip_serializing`, ...), but not
/// `skip_serializing_if` (refused separately by `Sim::check_layout`).
fn is_serde_skip(line: &str) -> bool {
    let t = line.trim_start();
    if !t.starts_with("#[serde(") {
        return false;
    }
    let body = t.split(")]").next().unwrap_or(t);
    body.split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .any(|w| w == "skip" || w == "skip_serializing" || w == "skip_deserializing")
}

fn card_choices() -> Sim {
    let ps = [
        Placement {
            profile: "card-a".into(),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(400., 400.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
        Placement {
            profile: "card-b".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(456., 400.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
    ];
    let mut ps = ps.to_vec();
    for i in 0..2 {
        ps.push(Placement {
            profile: format!("card-extra-{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(800. + f64::from(i) * 70., 700.),
            hp: None,
            weapon0: None,
            weapon1: None,
        });
    }
    let sim = Sim::reset_active(
        SimConfig::default(),
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(55),
        &ps,
    );
    let mut cp = serde_json::to_value(sim).unwrap();
    cp["world"]["reward_chests"] = serde_json::json!([{"id":1,"at":{"x":400.,"y":400.},"expires_at":15000.,"held_until_tick":0,"options":[{"Card":"slowBurn"},{"Card":"pocketSand"},{"Card":"siphon"}],"taken":[null,null,null],"pickers":[],"camp":null,"owner":null}]);
    cp["world"]["entity_counter"] = serde_json::json!(1);
    let mut sim = Sim::restore(&cp).unwrap();
    sim.submit(
        PlayerId(1),
        cmd(RawCommand::Choose {
            chest_id: Some(1),
            pick: 1,
        }),
    )
    .unwrap();
    sim.step();
    sim
}

/// MatchStatic clones its immutable ring and reconstructs it via StaticRepr::from.
/// Real locked Blaze inputs must have identical landings and continuation after both paths.
#[test]
fn derived_blink_ring_clone_and_restore_preserve_actual_locked_casts() {
    let file: rh_sim::mapdata::MapExport =
        serde_json::from_str(include_str!("../src/mapdata/fixtures/seed1.map.json")).unwrap();
    let mut original = Sim::new(
        SimConfig {
            quests: false,
            consumables: true,
            abilities: rh_sim::abilities::Mode::Full,
            wish_lock_ms: 0.,
            min_players: 2,
            lobby_seconds: 0.,
            fill_seconds: 0.,
            lifecycle: rh_sim::ArenaMode::Source(rh_sim::ArenaRules {
                plan_seconds: 0.,
                first_patience_seconds: Some(0.1),
                coliseum_schedule: None,
                ..Default::default()
            }),
            ..Default::default()
        },
        file.validate().unwrap().into_arena().unwrap(),
        Secrets::from_seed(12),
    );
    original
        .add_player("blinker", Some(FactionId::Fire), false)
        .unwrap();
    original
        .add_player("rival", Some(FactionId::Holy), false)
        .unwrap();
    for _ in 0..3 {
        original.step();
    }
    assert!(
        rh_sim::public_snapshot(&original)
            .arena
            .unwrap()
            .gates_locked
    );
    // The real teleport producer forbids casts for300ms; advance ordinary steps past it.
    for _ in 0..6 {
        original.step();
    }
    let snapshot = serde_json::to_value(&original).unwrap();
    assert!(snapshot["statics"].get("blink_ring").is_none());
    let cloned = original.clone();
    let restored = Sim::restore(&snapshot).unwrap();
    let actor = original.player(PlayerId(1)).unwrap();
    let from = Vec2::new(actor.body.x, actor.body.y);
    let ring = rh_sim::abilities::blink::Ring::new(&original.arena().map);
    // Exercise all cardinal directions, including an actual closed ring crossing.
    let mut crossing = false;
    for delta in [
        Vec2::new(300., 0.),
        Vec2::new(-300., 0.),
        Vec2::new(0., 300.),
        Vec2::new(0., -300.),
    ] {
        let at = Vec2::new(from.x + delta.x, from.y + delta.y);
        crossing |= ring.crosses(original.collision_map(), from, at);
        let mut a = original.clone();
        let mut b = cloned.clone();
        let mut c = restored.clone();
        for sim in [&mut a, &mut b, &mut c] {
            sim.submit(
                PlayerId(1),
                cmd(RawCommand::Cast {
                    slot: rh_sim::abilities::Slot::Wish,
                    x: at.x,
                    y: at.y,
                    id: None,
                    t: None,
                    seq: None,
                }),
            )
            .unwrap();
        }
        for _ in 0..3 {
            let ea = a.step();
            let eb = b.step();
            let ec = c.step();
            assert_eq!(ea, eb);
            assert_eq!(ea, ec);
            assert_eq!(a.state_hash(), b.state_hash());
            assert_eq!(a.state_hash(), c.state_hash());
        }
        let cp = serde_json::to_value(&a).unwrap();
        assert!(cp["world"]["players"][0]["card_runtime"]["wish_cast"].is_object());
    }
    assert!(
        crossing,
        "the clone/restore control must exercise an actual closed coliseum boundary"
    );
}

#[test]
fn native29_declared_seeds_roundtrip_and_ordered_tax_vectors_change_hash() {
    let wish = wish_states();
    let declared = declared_native29_states(
        &wish
            .iter()
            .find(|(label, _)| *label == "Freeze pending")
            .unwrap()
            .1,
    );
    for (label, sim) in &declared {
        let cp = serde_json::to_value(sim).unwrap();
        assert_eq!(
            Sim::restore(&cp).unwrap().state_hash(),
            sim.state_hash(),
            "{label}"
        );
        assert_eq!(sim.clone().state_hash(), sim.state_hash(), "{label}");
        if label.contains("fight") {
            let p = &cp["world"]["players"][0];
            assert_eq!(
                p["build"]["counts"][rh_sim::cards::CardId::SlowStarter.index()],
                1
            );
            assert!(p["card_runtime"]["fight"]["start"].is_number());
            assert!(p["card_runtime"]["fight"]["last"].is_number());
            assert_eq!(
                p["card_runtime"]["wish_cast"].is_object(),
                label.contains("plus-Wish")
            );
        }
        if label.contains("tax") {
            assert_eq!(
                cp["world"]["factions"]["taxed"].as_array().unwrap().len(),
                3
            );
            assert_eq!(
                cp["world"]["factions"]["public_tax"]
                    .as_array()
                    .unwrap()
                    .len(),
                if label.contains("public") { 2 } else { 0 }
            );
        }
    }
    let (_, sim) = declared
        .iter()
        .find(|(label, _)| *label == "DECLARED public tax serialization")
        .unwrap();
    for field in ["taxed", "public_tax"] {
        let mut cp = serde_json::to_value(sim).unwrap();
        cp["world"]["factions"][field]
            .as_array_mut()
            .unwrap()
            .swap(0, 1);
        let swapped = Sim::restore(cp).expect("historical tax vectors preserve valid source order");
        assert_ne!(
            sim.state_hash(),
            swapped.state_hash(),
            "ordered {field} is canonical"
        );
    }
    // Produced hints and all three optional config tags have their separate ordinary-input control.
}

/// Cached while bits are coupled inputs, not unhashed leaves. This uses the
/// declared chest/real grant seed; it is not evidence of earned fight history.
#[test]
fn native29_used_hold_bit_requires_its_fold_but_inert_bit_is_hashed() {
    let wish = wish_states();
    let states = declared_native29_states(
        &wish
            .iter()
            .find(|(label, _)| *label == "Freeze pending")
            .unwrap()
            .1,
    );
    let (_, sim) = states
        .iter()
        .find(|(label, _)| *label == "DECLARED fight-only serialization")
        .unwrap();
    let cp = serde_json::to_value(sim).unwrap();
    let p = &cp["world"]["players"][0];
    assert_eq!(
        p["build"]["counts"][rh_sim::cards::CardId::SlowStarter.index()],
        1
    );
    assert_eq!(p["core"]["modifiers"]["holds"], 0);
    assert!(p["card_runtime"]["fight"].is_object());
    // SlowStarter is the only card: its sole while row receives bit zero.
    // Activating its +0.65 row without changing the real grant's cached fold
    // must fail validation, not be silently omitted from identity coverage.
    let mut active = cp.clone();
    active["world"]["players"][0]["core"]["modifiers"]["holds"] = 1.into();
    let err = Sim::restore(active).expect_err("used while bit requires matching cached fold");
    assert!(err.to_string().contains("invalid armor mirror"), "{err}");
    // Bit one is beyond this build's sole while row. It buys no stat, so the
    // validator admits it; serialized inert bits must still affect identity.
    let mut inert = cp;
    inert["world"]["players"][0]["core"]["modifiers"]["holds"] = 2.into();
    let restored = Sim::restore(inert).expect("inert hold bit is a valid state");
    assert_ne!(sim.state_hash(), restored.state_hash());
    assert_eq!(
        serde_json::to_value(restored).unwrap()["world"]["players"][0]["core"]["modifiers"]
            ["holds"],
        2
    );
}

/// Real source-backed PvE birth/Target/wake states already populate the brain.
/// Its optional shape is actor-class coupled, not a missing or unhashed subtree.
#[test]
fn native29_real_pve_brain_roundtrips_and_role_presence_is_validated() {
    let (engaged, cleared) = mob_audit_states();
    for sim in [&engaged, &cleared] {
        let cp = serde_json::to_value(sim).unwrap();
        assert_eq!(Sim::restore(&cp).unwrap().state_hash(), sim.state_hash());
        assert_eq!(sim.clone().state_hash(), sim.state_hash());
        assert!(cp["world"]["mobs"]
            .as_array()
            .unwrap()
            .iter()
            .all(|m| m["brain"].is_object()));
    }
    let cp = serde_json::to_value(&engaged).unwrap();
    let mobs = cp["world"]["mobs"].as_array().unwrap();
    let i = mobs
        .iter()
        .position(|m| m["brain"]["target"].is_number())
        .expect("real NPC wake selects target");
    assert!(
        mobs.iter()
            .any(|m| m["core"]["weapon"]["action"].is_object()),
        "real pending NPC attack"
    );
    assert!(
        mobs.iter().any(|m| m["brain"]["goal"].is_object()),
        "real NPC movement goal"
    );
    assert!(
        mobs.iter()
            .any(|m| !m["brain"]["threat"].as_array().unwrap().is_empty()),
        "real threat history"
    );
    let mut missing = cp.clone();
    missing["world"]["mobs"][i]["brain"] = Value::Null;
    let err = Sim::restore(missing).expect_err("regional NPC requires brain");
    assert!(
        err.to_string().contains("actor brain capability mismatch"),
        "{err}"
    );
    // Counterfactual accepted scalar edit: it is not a produced NPC decision.
    let mut changed = cp.clone();
    let moving = changed["world"]["mobs"][i]["brain"]["moving"]
        .as_bool()
        .unwrap();
    changed["world"]["mobs"][i]["brain"]["moving"] = (!moving).into();
    let changed = Sim::restore(changed).expect("independent brain scalar is restore-valid");
    assert_ne!(engaged.state_hash(), changed.state_hash());
    let training = produced_walk_hint_states();
    let mut dummy = serde_json::to_value(&training[0].1).unwrap();
    let dummy_i = dummy["world"]["mobs"]
        .as_array()
        .unwrap()
        .iter()
        .position(|m| m["brain"].is_null())
        .expect("actual Training dummy has no regional brain");
    dummy["world"]["mobs"][dummy_i]["brain"] = mobs[i]["brain"].clone();
    let err = Sim::restore(dummy).expect_err("dummy cannot acquire regional brain");
    assert!(
        err.to_string().contains("actor brain capability mismatch"),
        "{err}"
    );
}

#[test]
fn native29_produced_hints_and_all_three_config_tags_roundtrip() {
    let states = produced_walk_hint_states();
    for (_, sim) in &states {
        let cp = serde_json::to_value(sim).unwrap();
        assert_eq!(Sim::restore(&cp).unwrap().state_hash(), sim.state_hash());
        assert_eq!(sim.clone().state_hash(), sim.state_hash());
    }
    // Hold every World byte fixed while changing only the optional static config.
    // Hints may be retained in a disabled checkpoint; no new gate/phase invariant is invented.
    let base = serde_json::to_value(&states[2].1).unwrap();
    let mut hashes = BTreeSet::new();
    for mode in [None, Some(false), Some(true)] {
        let mut cp = base.clone();
        cp["statics"]["config"]["walk_hints"] = serde_json::json!(mode);
        let sim = Sim::restore(cp).unwrap();
        let restored = serde_json::to_value(&sim).unwrap();
        assert_eq!(restored["world"], base["world"]);
        assert_eq!(
            restored["statics"]["config"]["walk_hints"],
            serde_json::json!(mode)
        );
        hashes.insert(sim.state_hash());
    }
    assert_eq!(
        hashes.len(),
        3,
        "None, explicit false and explicit true are separate identities"
    );
}

/// P-REGEN-COMBAT-1-fix: the two config switches whose default folds nothing into the statics digest. A sim built under
/// the defaults, stepped once; the tests below change only its statics config and hold every World byte fixed.
fn spacing_regen_base() -> Value {
    let mut sim = Sim::reset_active(
        SimConfig {
            regen: true,
            ..Default::default()
        },
        practice_arena(),
        Secrets::from_seed(75),
        &[Placement {
            profile: "hash-spacing-regen".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400., 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        }],
    );
    sim.step();
    serde_json::to_value(&sim).unwrap()
}

/// The same checkpoint restored under `mob_spacing = spacing, regen_in_combat = regen` (through their own serde
/// encoding, whatever it is). Only the statics config changes, so a different state hash is a different statics digest.
fn with_spacing_regen(
    base: &Value,
    spacing: rh_sim::archetype::MobSpacing,
    regen: rh_sim::RegenInCombat,
) -> Sim {
    let mut cp = base.clone();
    cp["statics"]["config"]["mob_spacing"] = serde_json::to_value(spacing).unwrap();
    cp["statics"]["config"]["regen_in_combat"] = serde_json::to_value(regen).unwrap();
    let sim = Sim::restore(cp).unwrap();
    assert_eq!(serde_json::to_value(&sim).unwrap()["world"], base["world"]);
    sim
}

#[test]
fn mob_spacing_and_regen_in_combat_are_four_separate_statics_identities() {
    use rh_sim::archetype::MobSpacing;
    use rh_sim::RegenInCombat;
    let base = spacing_regen_base();
    let mut seen: BTreeMap<u64, String> = BTreeMap::new();
    for spacing in [MobSpacing::Auto, MobSpacing::Off] {
        for regen in [RegenInCombat::Legacy, RegenInCombat::Off] {
            let name = format!("mob_spacing = {spacing:?}, regen_in_combat = {regen:?}");
            let h = with_spacing_regen(&base, spacing, regen).state_hash();
            if let Some(other) = seen.insert(h, name.clone()) {
                panic!("`{other}` and `{name}` share the statics digest (state hash {h:#018x})");
            }
        }
    }
    assert_eq!(seen.len(), 4);
}

#[test]
fn a_regen_off_replay_does_not_verify_under_spacing_off() {
    use rh_sim::replay::{run_replay, Recorder, ReplayError, ReplayStart};
    let live = SimConfig {
        regen: true,
        regen_in_combat: rh_sim::RegenInCombat::Off,
        ..Default::default()
    };
    let placements = vec![Placement {
        profile: "hash-regen-replay".into(),
        faction: FactionId::Holy,
        bot: false,
        at: Vec2::new(400., 320.),
        hp: None,
        weapon0: None,
        weapon1: None,
    }];
    let mut sim = Sim::reset_active(
        live.clone(),
        practice_arena(),
        Secrets::from_seed(76),
        &placements,
    );
    let mut rec = Recorder::new(
        &sim,
        live.clone(),
        ReplayStart::Active {
            placements: placements.clone(),
        },
    );
    for _ in 0..20 {
        sim.step();
        rec.stepped(&sim);
    }
    let replay = rec.replay;
    run_replay(&replay).expect("the replay verifies under its own config");

    // The other rule set: spacing off, legacy regen. Its replay identity must not accept the live run's hashes.
    let mut other = replay.clone();
    other.config = SimConfig {
        regen: true,
        mob_spacing: rh_sim::archetype::MobSpacing::Off,
        regen_in_combat: rh_sim::RegenInCombat::Legacy,
        ..Default::default()
    };
    match run_replay(&other) {
        Err(ReplayError::Diverged { step: 0, .. }) => {}
        r => panic!(
            "a replay recorded under regen_in_combat = Off must diverge at step 0 under mob_spacing = Off, \
             regen_in_combat = Legacy; got {:?}",
            r.map(|(s, _)| s.state_hash())
        ),
    }

    // The same for a checkpoint: the live run restored under the other config is a different state.
    let mut cp = serde_json::to_value(&sim).unwrap();
    cp["statics"]["config"] = serde_json::to_value(&other.config).unwrap();
    assert_ne!(
        Sim::restore(cp).unwrap().state_hash(),
        sim.state_hash(),
        "a regen_in_combat = Off checkpoint passes for mob_spacing = Off, regen_in_combat = Legacy"
    );
}

#[test]
fn the_default_spacing_and_regen_still_fold_nothing() {
    // Guard (passes before and after the fix): `Auto` + `Legacy` hash exactly like a config written before either
    // field existed, so every pre-existing state hash, checkpoint, replay and parity fixture keeps its value.
    let base = spacing_regen_base();
    let h = Sim::restore(base.clone()).unwrap().state_hash();
    let mut old = base.clone();
    let config = old["statics"]["config"].as_object_mut().unwrap();
    config.remove("mob_spacing");
    config.remove("regen_in_combat");
    assert_eq!(Sim::restore(old).unwrap().state_hash(), h);
    assert_eq!(
        with_spacing_regen(
            &base,
            rh_sim::archetype::MobSpacing::Auto,
            rh_sim::RegenInCombat::Legacy
        )
        .state_hash(),
        h
    );
}
