#![cfg(test)]
use super::*;
use crate::{Arena, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};
use serde_json::json;
fn arena() -> Arena {
    let map: crate::mapdata::MapExport =
        serde_json::from_str(include_str!("../../mapdata/fixtures/seed1.map.json")).unwrap();
    map.validate().unwrap().into_arena().unwrap()
}
fn centre(arena: &Arena, kind: u8) -> Vec2 {
    let i = arena
        .map
        .layers()
        .unwrap()
        .data()
        .terrain
        .iter()
        .position(|k| *k == kind)
        .unwrap();
    Vec2::new(
        (i % arena.map.w as usize) as f64 * 32. + 16.,
        (i / arena.map.w as usize) as f64 * 32. + 16.,
    )
}
fn setup(mode: Mode, mobs: bool, kind: u8) -> Sim {
    let arena = arena();
    let at = centre(&arena, kind);
    let placements = (0..3)
        .map(|i| Placement {
            profile: format!("p{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: if i == 0 { at } else { arena.spawns[i] },
            hp: Some(500.),
            weapon0: None,
            weapon1: None,
        })
        .collect::<Vec<_>>();
    Sim::reset_active(
        SimConfig {
            quests: false,
            initial_loot: mobs,
            consumables: true,
            hazards: mode,
            mob_mode: if mobs {
                crate::mob_runtime::MobMode::Pve
            } else {
                crate::mob_runtime::MobMode::Off
            },
            ..Default::default()
        },
        arena,
        Secrets::from_seed(5),
        &placements,
    )
}
fn run(sim: &mut Sim, ev: &mut Vec<Event>, f: impl FnOnce(&mut Cx)) {
    f(&mut Cx {
        stats: Default::default(),
        #[cfg(feature = "trusted-status-probes")]
        probe: None,
        k: &sim.k,
        w: &mut sim.w,
        s: &mut sim.s,
        ev,
        pf: &mut sim.pf,
    });
}
fn restored(sim: &Sim) -> Sim {
    Sim::restore(serde_json::to_value(sim).unwrap()).unwrap()
}
#[test]
fn terrain_native_players_restore_continue_and_keep_private_memory_private() {
    for mode in [Mode::Map, Mode::All] {
        for kind in [4, 5, 6, 7] {
            let mut sim = setup(mode, false, kind);
            let id = PlayerId(1);
            let at = sim.players()[0].pos();
            let cmd = crate::validate(crate::RawCommand::Move {
                x: at.x + 32.,
                y: at.y,
                seq: Some(1),
            })
            .unwrap();
            sim.submit(id, cmd).unwrap();
            for _ in 0..24 {
                sim.step();
                let mut replay = restored(&sim);
                assert_eq!(sim.state_hash(), replay.state_hash());
                assert_eq!(sim.step(), replay.step());
                assert_eq!(sim.state_hash(), replay.state_hash());
            }
            let before = crate::observe(&sim, id, &[]);
            let hash = sim.state_hash();
            let now = sim.w.server_time;
            terrain::stamp(&mut sim.w.terrain.combat_at, id, now);
            terrain::add(&mut sim.w.terrain.light_acc, id, 0.25);
            assert_ne!(hash, sim.state_hash());
            assert_eq!(before, crate::observe(&sim, id, &[]));
        }
    }
}
#[test]
fn terrain_native_born_mobs_burn_ice_death_and_return_restore() {
    for mode in [Mode::Map, Mode::All] {
        let mut sim = setup(mode, true, 4);
        let mut ev = Vec::new();
        let ember = centre(&sim.k.arena, 4);
        let ice = centre(&sim.k.arena, 6);
        let index = sim
            .w
            .mobs
            .iter()
            .position(|m| m.core.vitals.faction == FactionId::Holy)
            .unwrap();
        let ix = FighterIx::of_slot(sim.w.players.len() + index);
        {
            let m = &mut sim.w.mobs[index];
            m.core.body.x = ember.x;
            m.core.body.y = ember.y;
            m.core.body.history.reset(crate::state::Sample {
                t: sim.w.server_time,
                x: ember.x,
                y: ember.y,
            });
        }
        let before = sim.w.core(ix).vitals.hp;
        run(&mut sim, &mut ev, |cx| {
            super::super::settle::mark_tick_start(cx);
            burn(cx);
            super::super::ledger::apply(cx);
        });
        assert!(sim.w.core(ix).vitals.hp < before);
        let mut resumed = restored(&sim);
        assert_eq!(sim.step(), resumed.step());
        assert_eq!(sim.state_hash(), resumed.state_hash());
        {
            let m = &mut sim.w.mobs[index];
            m.core.body.x = ice.x;
            m.core.body.y = ice.y;
            m.core
                .motion
                .path
                .set_from(&[Vec2::new(ice.x + 32., ice.y)]);
            m.core.body.history.reset(crate::state::Sample {
                t: sim.w.server_time,
                x: ice.x,
                y: ice.y,
            });
        }
        super::super::movement::walk_one(&sim.k, &mut sim.w, ix, &mut sim.pf, TICK_MS, None, 1.);
        assert!(sim.w.core(ix).motion.slip.is_some());
        let mut resumed = restored(&sim);
        assert_eq!(sim.step(), resumed.step());
        assert_eq!(sim.state_hash(), resumed.state_hash());
        {
            let m = &mut sim.w.mobs[index];
            m.core.body.x = ember.x;
            m.core.body.y = ember.y;
            m.brain.mode = crate::mob_runtime::BrainMode::Return;
        }
        let before = sim.w.core(ix).vitals.hp;
        run(&mut sim, &mut ev, burn);
        assert!(sim.s.ledger.iter().all(|e| e.victim != sim.w.core(ix).id));
        assert_eq!(sim.w.core(ix).vitals.hp, before);
        let mut resumed = restored(&sim);
        assert_eq!(sim.step(), resumed.step());
        assert_eq!(sim.state_hash(), resumed.state_hash());
        {
            let m = &mut sim.w.mobs[index];
            m.core.body.x = ember.x;
            m.core.body.y = ember.y;
            m.brain.mode = crate::mob_runtime::BrainMode::Idle;
            m.core.vitals.hp = 0.001;
            m.core.motion.slip = None;
        }
        run(&mut sim, &mut ev, |cx| {
            super::super::settle::mark_tick_start(cx);
            burn(cx);
            super::super::ledger::apply(cx);
        });
        assert_eq!(sim.w.mobs[index].status, crate::Status::Dead);
        let mut resumed = restored(&sim);
        assert_eq!(sim.step(), resumed.step());
        assert_eq!(sim.state_hash(), resumed.state_hash());
    }
}
#[test]
fn terrain_checkpoint_rejects_malformed_clocks_identity_and_slips() {
    let mut sim = setup(Mode::Map, false, 6);
    let ix = FighterIx::of_slot(0);
    super::super::movement::walk_one(&sim.k, &mut sim.w, ix, &mut sim.pf, TICK_MS, None, 1.);
    let base = serde_json::to_value(&sim).unwrap();
    assert!(Sim::restore(&base).is_ok());
    for (pointer, value) in [
        ("/world/players/0/core/motion/path/0", json!(u64::MAX)),
        (
            "/world/players/0/core/motion/path/0",
            json!(u64::MAX - 4096),
        ),
        (
            "/world/players/0/core/motion/path/0",
            json!(terrain::path_generation_limit(sim.w.tick) + 1),
        ),
        (
            "/world/players/0/core/motion/slip/grip_until",
            json!(sim.w.server_time),
        ),
        (
            "/world/players/0/core/motion/slip/replan_at",
            json!(sim.w.server_time),
        ),
        ("/statics/config/hazards", json!("Off")),
        ("/world/players/0/core/motion/slip/vx", json!(1e100)),
        ("/world/players/0/core/motion/slip/path", json!(u64::MAX)),
        ("/world/players/0/core/motion/slip/stuck_x", json!(100.)),
        (
            "/world/players/0/core/motion/slip/replan_at",
            json!(sim.w.server_time + 251.),
        ),
        (
            "/world/players/0/core/motion/slip/grip_until",
            json!(sim.w.server_time + 1001.),
        ),
        ("/world/terrain/light_since", json!(sim.w.server_time + 1.)),
        ("/world/terrain/light_acc", json!([[999, 2.]])),
        ("/world/terrain/combat_at", json!([[1, 0.], [1, 0.]])),
        ("/world/terrain/damage", json!([[1, -1.]])),
        ("/world/rt/gates_locked", json!(true)),
    ] {
        let mut v = base.clone();
        *v.pointer_mut(pointer).unwrap() = value;
        assert!(Sim::restore(&v).is_err(), "admitted {pointer}");
    }
    let mut config = SimConfig {
        quests: false,
        initial_loot: true,
        consumables: true,
        hazards: Mode::Map,
        mob_mode: crate::mob_runtime::MobMode::SpawnFoundation,
        ..Default::default()
    };
    assert!(Sim::try_new(config.clone(), arena(), Secrets::from_seed(5)).is_err());
    config.hazards = Mode::Off;
    assert!(Sim::try_new(config, arena(), Secrets::from_seed(5)).is_ok());
}
#[test]
fn terrain_raid_and_teleport_hooks_reset_only_source_owned_memory() {
    let mut sim = setup(Mode::Map, true, 6);
    let now = sim.w.server_time;
    for i in 0..sim.w.fighter_count() {
        let p = sim.w.core_mut(FighterIx::of_slot(i));
        p.motion.slip = Some(walk::new_slip(p.pos(), Vec2::new(30., 40.)));
    }
    terrain::add(&mut sim.w.terrain.light_acc, PlayerId(1), 2.);
    terrain::stamp(&mut sim.w.terrain.combat_at, PlayerId(1), now);
    sim.w.terrain.light_since = 0.;
    let mut ev = vec![];
    {
        let mut hx = Hx {
            stats: Default::default(),
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut ev,
            fx: None,
        };
        crate::hooks::fire(&mut hx, HookArgs::Teleported);
    }
    assert!((0..sim.w.fighter_count()).all(|i| sim
        .w
        .core(FighterIx::of_slot(i))
        .motion
        .slip
        .is_none()));
    assert!(!sim.w.terrain.light_acc.is_empty());
    assert!(!sim.w.terrain.combat_at.is_empty());
    // Invoke the terrain link itself: the real RaidStarted chain also births fresh NPCs.
    raid_started(
        &mut Hx {
            stats: Default::default(),
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut ev,
            fx: None,
        },
        &HookArgs::RaidStarted,
    );
    assert!(sim.w.terrain.light_acc.is_empty());
    assert!(sim.w.terrain.combat_at.is_empty());
    assert_eq!(sim.w.terrain.light_since, now);
}
#[test]
fn terrain_every_serialized_leaf_is_hashed() {
    let mut sim = setup(Mode::Map, true, 6);
    let ix = FighterIx::of_slot(0);
    let at = sim.players()[0].pos();
    sim.w
        .core_mut(ix)
        .motion
        .path
        .set_from(&[Vec2::new(at.x + 32., at.y)]);
    super::super::movement::walk_one(&sim.k, &mut sim.w, ix, &mut sim.pf, TICK_MS, None, 1.);
    sim.w.terrain.light_acc = vec![(PlayerId(1), 0.5)];
    sim.w.terrain.combat_at = vec![(PlayerId(1), sim.w.server_time)];
    sim.w.terrain.damage = vec![(PlayerId(1), 1.)];
    sim.w.terrain.heal = vec![(PlayerId(1), 2.)];
    sim.w.terrain.seconds = [1., 2., 3., 4.];
    let slip = sim.w.core_mut(ix).motion.slip.as_mut().unwrap();
    slip.replan_at = Some(250.);
    slip.stuck_x = Some(at.x + 32.);
    slip.stuck_y = Some(at.y);
    slip.stuck_n = Some(2.);
    slip.stuck_best = Some(32.);
    slip.stuck_at = Some(0.);
    slip.grip_until = Some(500.);
    let ice = sim.w.core(ix).pos();
    let copied = sim.w.core(ix).motion.slip.clone();
    let path = sim.w.core(ix).motion.path.clone();
    let m = &mut sim.w.mobs[0];
    m.core.body.x = ice.x;
    m.core.body.y = ice.y;
    m.core.motion.path = path;
    m.core.motion.slip = copied;
    fn leaves(v: &serde_json::Value, path: String, out: &mut Vec<(String, serde_json::Value)>) {
        match v {
            serde_json::Value::Object(o) => {
                for (k, v) in o {
                    leaves(v, format!("{path}/{k}"), out)
                }
            }
            serde_json::Value::Array(a) => {
                for (i, v) in a.iter().enumerate() {
                    leaves(v, format!("{path}/{i}"), out)
                }
            }
            serde_json::Value::Null => (),
            _ => out.push((path, v.clone())),
        }
    }
    let base = serde_json::to_value(&sim.w).unwrap();
    let hash = sim.state_hash();
    let mut all = vec![];
    for root in [
        "/terrain",
        "/players/0/core/motion/path",
        "/players/0/core/motion/slip",
        "/rt/gates_locked",
        "/mobs/0/core/motion/path",
        "/mobs/0/core/motion/slip",
    ] {
        leaves(base.pointer(root).unwrap(), root.into(), &mut all);
    }
    assert_eq!(
        all.len(),
        44,
        "complete populated terrain/path/slide leaf inventory"
    );
    for (path, old) in all {
        let mut value = base.clone();
        *value.pointer_mut(&path).unwrap() = match old {
            serde_json::Value::Bool(b) => json!(!b),
            serde_json::Value::Number(n) if n.is_u64() => json!(n.as_u64().unwrap() + 1),
            serde_json::Value::Number(n) => json!(n.as_f64().unwrap() + 0.125),
            _ => panic!("unexpected terrain leaf {path}"),
        };
        let mut other = sim.clone();
        other.w = serde_json::from_value(value).unwrap();
        assert_ne!(hash, other.state_hash(), "unhashed {path}");
    }
}

#[test]
fn path_epoch_lifetime_bound_cannot_overflow() {
    let max = terrain::path_generation_limit(u32::MAX);
    assert!(max < u64::MAX / 2);
    for tick in [0, 1, 1000, u32::MAX - 1] {
        let accepted = terrain::path_generation_limit(tick);
        let per_tick = terrain::path_generation_limit(0);
        assert_eq!(accepted + u64::from(u32::MAX - tick) * per_tick, max);
    }
}
