//! First-playable smoke: `cargo run -p rh-headless --example first_playable -- maps/first-playable.json /tmp/first-playable-report.json`.
//! This is a proof-only public policy wrapper around Brawler, not live bot content.
//! Outputs/replay are private synthetic-server evidence; no private observation feeds policy decisions.
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_policy::{scripted::Brawler, MatchStart, Policy, PolicySpec};
use rh_sim::{
    mapdata::MapExport, Arena, FactionId, FactionMode, Observation, PublicCommand, SimConfig,
    TileMap, Vec2,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex},
};

type Builds = Arc<Mutex<BTreeMap<u32, serde_json::Value>>>;
struct LootBrawler {
    base: Brawler,
    builds: Builds,
    centre: Vec2,
    tried: BTreeSet<(u16, u16)>,
}
impl Policy for LootBrawler {
    fn spec(&self) -> PolicySpec {
        let mut s = self.base.spec();
        s.name = "public-loot-brawler-proof".into();
        s
    }
    fn reset(&mut self, start: &MatchStart) {
        self.base.reset(start);
        self.centre = start.arena.centre();
        self.tried.clear();
    }
    fn decide(&mut self, obs: &Observation) -> Vec<PublicCommand> {
        let Some(me) = &obs.me else { return vec![] };
        if let Some(b) = &obs.build {
            self.builds
                .lock()
                .unwrap()
                .insert(me.id.0, serde_json::to_value(b).unwrap());
        }
        if let Some(chest) = obs.reward_chests.iter().find(|c| c.can_choose && !c.picked) {
            return vec![PublicCommand::Choose {
                handle: chest.handle,
                pick: 0,
            }];
        }
        if let Some(prop) = obs
            .props
            .iter()
            .find(|p| p.cue.focused && !self.tried.contains(&(p.cue.x, p.cue.y)))
        {
            self.tried.insert((prop.cue.x, prop.cue.y));
            return vec![PublicCommand::Pickup {
                handle: prop.handle,
            }];
        }
        if obs
            .inventory
            .is_some_and(|i| i.potion_small > 0 && i.potions_healing < 3)
            && me.hp < me.max_hp * 0.7
        {
            return vec![PublicCommand::UseConsumable];
        }
        // Only public, typed weapon ground cues guide a genuinely empty-handed seat to loot.
        if obs
            .inventory
            .is_some_and(|i| i.slots.iter().all(Option::is_none))
        {
            if let Some(p) = obs
                .props
                .iter()
                .filter(|p| matches!(p.cue.kind, rh_sim::item_view::PropKind::Ground(_)))
                .min_by(|a, b| {
                    let dist = |p: &rh_sim::VisibleProp| {
                        let dx = f64::from(p.cue.x) / 8. - me.x;
                        let dy = f64::from(p.cue.y) / 8. - me.y;
                        dx * dx + dy * dy
                    };
                    dist(a).total_cmp(&dist(b))
                })
            {
                return vec![PublicCommand::Move {
                    x: f64::from(p.cue.x) / 8.,
                    y: f64::from(p.cue.y) / 8.,
                    seq: None,
                }];
            }
        }
        if !obs
            .visible
            .iter()
            .any(|a| a.status == rh_sim::Status::Alive)
        {
            return vec![PublicCommand::Move {
                x: self.centre.x,
                y: self.centre.y,
                seq: None,
            }];
        }
        self.base.decide(obs)
    }
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    assert_eq!(args.len(), 3, "map export and report path required");
    let export: MapExport = serde_json::from_slice(&std::fs::read(&args[1]).unwrap()).unwrap();
    assert_eq!(
        export.legacy_map_hash_u32, 0x0252_d18b,
        "exact first-playable map required"
    );
    assert_eq!(rh_sim::mapgen::map_hash::map_hash(&export.map), "0252d18b");
    let spawns = export
        .map
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    let (w, h, tiles, layers) = export.validate().unwrap().into_parts();
    let arena = Arena {
        map: TileMap::new(w, h, tiles)
            .unwrap()
            .with_layers(Arc::new(layers))
            .unwrap(),
        spawns,
    };
    let sim = SimConfig {
        consumables: true,
        initial_loot: true,
        mob_mode: rh_sim::mob_runtime::MobMode::Pve,
        faction_mode: FactionMode::EngagementHolyPlagueFire,
        ..Default::default()
    };
    let builds: Builds = Arc::new(Mutex::new(BTreeMap::new()));
    let agents = (0..6)
        .map(|i| AgentSpec {
            profile: format!("map-proof-{i}"),
            faction: [FactionId::Fire, FactionId::Plague, FactionId::Holy][i % 3],
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(LootBrawler {
                    base: Brawler::new(2),
                    builds: builds.clone(),
                    centre: Vec2::new(0., 0.),
                    tried: BTreeSet::new(),
                }),
            },
        })
        .collect();
    let mut env = Env::new(
        EnvConfig {
            arena,
            sim,
            max_ticks: 3600,
            record: true,
        },
        agents,
        1,
    );
    let initial_hash = env.sim.state_hash();
    let initial = serde_json::to_value(&env.sim).unwrap();
    let constructor = serde_json::json!({"containers":initial["world"]["containers"],"entityCounter":initial["world"]["entity_counter"],"itemCounter":initial["world"]["item_counter"],"initialBirthSerial":initial["world"]["initial_birth_serial"]});
    let initial_actors = env.sim.players().len() + env.sim.mobs().len();
    let mob_ids: Vec<_> = env.sim.mobs().iter().map(|m| m.core.id).collect();
    let mut pve_kills = 0;
    let mut counts: BTreeMap<String, u64> = BTreeMap::new();
    let mut potion_due_evidence = Vec::new();
    let final_progress = loop {
        let before = serde_json::to_value(&env.sim).unwrap();
        let due: Vec<_> = before["world"]["potion_healing"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|h| {
                h["hots"].as_array().unwrap().iter().any(|v| {
                    v["left"].as_u64().unwrap() > 0
                        && v["next"].as_f64().unwrap() <= env.sim.server_time() + 50.
                })
            })
            .cloned()
            .collect();
        let step = env.try_step(&[]).expect("public headless step");
        for e in &step.events {
            if let rh_sim::Event::Death { id, .. } = e {
                if mob_ids.contains(id) {
                    pve_kills += 1;
                }
            }
            let value = serde_json::to_value(e).unwrap();
            let kind = value
                .as_object()
                .and_then(|o| o.keys().next())
                .cloned()
                .unwrap_or_else(|| value.to_string());
            *counts.entry(kind.clone()).or_default() += 1;
            if kind == "PotionNotice" {
                *counts
                    .entry(format!("PotionNotice/{}", value["PotionNotice"]["notice"]))
                    .or_default() += 1;
            }
        }
        if !due.is_empty() {
            let heal: Vec<_> = step
                .events
                .iter()
                .filter(|e| matches!(e, rh_sim::Event::Heal { .. }))
                .collect();
            let after = serde_json::to_value(&env.sim).unwrap();
            potion_due_evidence.push(serde_json::json!({"tick":step.tick,"before":due,"after":after["world"]["potion_healing"],"actualHealEvents":heal}));
        }
        if step.terminated || step.truncated {
            break (step.tick, step.terminated, step.truncated);
        }
    };
    let faults = env
        .seat_stats()
        .iter()
        .filter(|(_, _, f)| f.is_some())
        .count();
    let final_hash = env.sim.state_hash();
    let final_checkpoint = serde_json::to_vec(&env.sim).unwrap();
    let restore_result: Result<rh_sim::Sim, _> = serde_json::from_slice(&final_checkpoint);
    let restore = match restore_result {
        Ok(restored) => {
            assert_eq!(restored.state_hash(), final_hash);
            serde_json::json!(true)
        }
        Err(e) => serde_json::json!({"error":e.to_string()}),
    };
    let replay = env.into_replay().unwrap();
    let (replayed, _) = rh_sim::replay::run_replay(&replay).expect("recorded public inputs replay");
    assert_eq!(replayed.state_hash(), final_hash);
    std::fs::write(
        std::path::Path::new(&args[2]).with_file_name("match-replay.private.json"),
        serde_json::to_vec(&replay).unwrap(),
    )
    .unwrap();
    let report = serde_json::json!({"map":"0252d18b","seed":1,"seats":6,"initialActors":initial_actors,"initialStateHash":format!("{initial_hash:016x}"),"finalStateHash":format!("{:016x}",final_hash),"constructor":constructor,"checkpointRestore":restore,"potionDueEvidence":potion_due_evidence,"publicBuildSnapshots":*builds.lock().unwrap(),"pveKills":pve_kills,"inputReplay":true,"tick":final_progress.0,"terminated":final_progress.1,"truncated":final_progress.2,"seatFaults":faults,"events":counts});
    std::fs::write(&args[2], serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    println!("{report}");
    assert!(
        final_progress.1 && !final_progress.2,
        "smoke must finish by match rules"
    );
    assert_eq!(faults, 0, "policy seat fault");
    assert_eq!(
        report["checkpointRestore"],
        serde_json::json!(true),
        "terminal checkpoint must restore"
    );
}
