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
    collections::BTreeSet,
    sync::Arc,
};

struct LootBrawler {
    base: Brawler,
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

fn make_env(map_path: &str, record: bool) -> Env {
    let export: MapExport = serde_json::from_slice(&std::fs::read(map_path).unwrap()).unwrap();
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
        initial_loot: true,
        mob_mode: rh_sim::mob_runtime::MobMode::Pve,
        faction_mode: FactionMode::EngagementHolyPlagueFire,
        ..Default::default()
    };
    let agents = (0..6)
        .map(|i| AgentSpec {
            profile: format!("map-proof-{i}"),
            faction: [FactionId::Fire, FactionId::Plague, FactionId::Holy][i % 3],
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(LootBrawler {
                    base: Brawler::new(2),
                    centre: Vec2::new(0., 0.),
                    tried: BTreeSet::new(),
                }),
            },
        })
        .collect();
    Env::new(
        EnvConfig {
            arena,
            sim,
            max_ticks: 3600,
            record,
        },
        agents,
        1,
    )
}

fn stats(samples: &[f64]) -> serde_json::Value {
    let mut v = samples.to_vec(); v.sort_by(f64::total_cmp);
    let n=v.len();
    serde_json::json!({"samples":n,"mean_us":v.iter().sum::<f64>()/n as f64,"p50_us":v[(n-1)/2],"p99_us":v[((n as f64*0.99).ceil() as usize).saturating_sub(1)],"max_us":v[n-1],"percentile":"nearest-rank"})
}
fn main() {
    let args:Vec<_>=std::env::args().collect(); assert_eq!(args.len(),3);
    let accepted:serde_json::Value=serde_json::from_slice(&std::fs::read(&args[2]).unwrap()).unwrap();
    let expected=u64::from_str_radix(accepted["finalStateHash"].as_str().unwrap(),16).unwrap();
    let mut recorder=make_env(&args[1],true);
    loop {let p=recorder.advance(&[]); if p.terminated || p.truncated {assert!(p.terminated&&!p.truncated);assert_eq!(p.tick,688);break;}}
    assert_eq!(recorder.sim.state_hash(),expected);
    let replay=recorder.into_replay().unwrap();
    assert!(replay.ticks.iter().flat_map(|t|&t.inputs).all(|i|matches!(i,rh_sim::replay::ReplayInput::Command{..})));
    let (verified,_)=rh_sim::replay::run_replay(&replay).unwrap();assert_eq!(verified.state_hash(),expected);
    let mut rows=Vec::new();
    // One untimed full replay above warms code and validates every tick. Three bounded matches per mode follow.
    for trial in 1..=3 {
      let mut env=make_env(&args[1],false);let mut samples=Vec::with_capacity(replay.hashes.len());
      let wall=std::time::Instant::now();
      loop {let t=std::time::Instant::now();let p=env.advance(&[]);samples.push(t.elapsed().as_secs_f64()*1e6);if p.terminated||p.truncated {assert!(p.terminated&&!p.truncated);assert_eq!(p.tick,688);break;}}
      let wall_s=wall.elapsed().as_secs_f64();
      assert_eq!(env.sim.state_hash(),expected);assert!(env.seat_stats().iter().all(|(_,_,f)|f.is_none()));
      rows.push(serde_json::json!({"scope":"Env::advance/public-policy-observation-validation-submit-sim-feed","trial":trial,"timing":stats(&samples),"wall_s":wall_s,"ticks_per_s":replay.hashes.len() as f64/wall_s,"terminal_tick":688,"terminated":true,"truncated":false,"fingerprint":format!("{expected:016x}")}));
      let mut sim=rh_sim::replay::start_sim(&replay);let mut events=Vec::new();let mut next=0;let mut samples=Vec::with_capacity(replay.hashes.len());
      let wall=std::time::Instant::now();
      for _ in 0..replay.hashes.len() {
        let target=sim.tick()+1;
        if let Some(t)=replay.ticks.get(next) {if t.tick==target {for i in &t.inputs {rh_sim::replay::apply_input(&mut sim,i);}next+=1;}}
        events.clear();let t=std::time::Instant::now();sim.step_into(&mut events);samples.push(t.elapsed().as_secs_f64()*1e6);
      }
      let wall_s=wall.elapsed().as_secs_f64();assert_eq!(next,replay.ticks.len());assert_eq!(sim.state_hash(),expected);assert_eq!(sim.phase(),rh_sim::Phase::Ended);
      rows.push(serde_json::json!({"scope":"Sim::step_into-only/recorded-ordinary-validated-public-inputs","trial":trial,"timing":stats(&samples),"wall_s_including_replay_submit_and_timer":wall_s,"ticks_per_s_including_replay_submit_and_timer":replay.hashes.len() as f64/wall_s,"terminal_tick":688,"terminated":true,"truncated":false,"fingerprint":format!("{expected:016x}")}));
    }
    println!("{}",serde_json::to_string_pretty(&serde_json::json!({"map":"0252d18b","content_hash":format!("{:016x}",rh_sim::content::content_hash()),"seed":1,"seats":6,"sim_hz":20,"initial_tick":1,"measured_advances":replay.hashes.len(),"measured_simulated_seconds":replay.hashes.len() as f64/20.0,"trials":3,"allocation_scope":"not measured","construction_hashing_checkpoint_report_json_io":"outside timed regions","timers":"Instant per tick; distributions include timer observation overhead; end-to-end wall includes sample collection","rows":rows})).unwrap());
}
