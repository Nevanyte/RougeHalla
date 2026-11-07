//! Actual-source camp-ward comparison (`parity/vision/ward-sight.json`, captured in the pinned Linux x64
//! Node 22.23.4 container by `tools/vision-fixtures/ward-sight.ts`).
//!
//! The fixture's ward is produced by the unchanged source chain (`mobLife.hurtMob` -> `killMob` ->
//! `camps.campMobDied`) and every verdict is the exported `canPlayerSee` / `canPlayerSeeActor` answer. The test
//! replays the same kills through the ported regional producer (the actual `mob_life::hurt` path), compares the
//! published camp/ward fields after every kill, then compares every probe. A ward-visible actor probe additionally
//! pins the actor path (bush concealment after point visibility). Public sampling must leave authoritative state
//! identical, so the clock/gates a probe moves are restored and the state hash re-checked.
use super::*;
use crate::mob_runtime::MobMode;
use crate::systems::ledger::Hit;
use crate::{Arena, FactionId, Placement, Secrets, SimConfig};
use serde_json::{json, Value};

fn fixture() -> Value {
    serde_json::from_str(include_str!("../../../parity/vision/ward-sight.json"))
        .expect("the captured camp-ward fixture parses")
}

fn pid(name: &str) -> PlayerId {
    PlayerId(name[1..].parse::<u32>().expect("pN name") + 1)
}

fn label(id: PlayerId) -> String {
    format!("p{}", id.0 - 1)
}

fn seed1_arena() -> Arena {
    let import: crate::mapdata::MapExport =
        serde_json::from_str(include_str!("mapdata/fixtures/seed1.map.json"))
            .expect("the certified seed1 map parses");
    let actual = import
        .validate()
        .expect("the certified seed1 layers validate");
    let spawns = actual
        .layers()
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    let (w, h, tiles, layers) = actual.into_parts();
    Arena {
        map: TileMap::new(w, h, tiles)
            .expect("unchanged certified dimensions")
            .with_layers(layers)
            .expect("validated layers attach"),
        spawns,
    }
}

fn status(name: &str) -> Status {
    match name {
        "alive" => Status::Alive,
        "dead" => Status::Dead,
        other => panic!("unsupported captured status {other}"),
    }
}

fn sim_for(case: &Value) -> Sim {
    let players = case["players"].as_array().expect("captured players");
    let placements: Vec<Placement> = players
        .iter()
        .map(|p| Placement {
            profile: p["id"].as_str().expect("id").to_string(),
            faction: FactionId::parse(p["faction"].as_str().expect("faction"))
                .expect("known faction"),
            bot: false,
            at: Vec2::new(p["x"].as_f64().expect("x"), p["y"].as_f64().expect("y")),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let mut secrets = Secrets::from_seed(1);
    secrets.reward_salt = [1, 2, 3, 4];
    let mut sim = Sim::reset_active(
        SimConfig {
            mob_mode: MobMode::Pve,
            // The certified seed1 map carries the real initial crate/ground spots; the MVP sink is the admitted
            // storage mode for them (the camp/world state the probes read is independent of it).
            initial_loot: true,
            ..Default::default()
        },
        seed1_arena(),
        secrets,
        &placements,
    );
    // The capture dropped every raid-start memory before its probes; the ward is authoritative camp state, never a
    // remembered tile, so the ported trail starts empty too.
    for player in &mut sim.w.players {
        player.vision = VisionTrail::default();
    }
    for p in players {
        let id = pid(p["id"].as_str().expect("id"));
        let want = status(p["status"].as_str().expect("status"));
        sim.w
            .players
            .iter_mut()
            .find(|player| player.id == id)
            .expect("captured seat")
            .status = want;
    }
    sim.w.tick = case["tick"].as_u64().expect("tick") as u32;
    sim.w.server_time = case["serverTime"].as_f64().expect("serverTime");
    sim.w.rt.gates_locked = case["gatesLocked"].as_bool().expect("gatesLocked");
    sim
}

fn num(x: f64) -> Value {
    if x.fract() == 0.0 {
        json!(x as i64)
    } else {
        json!(x)
    }
}

fn camp_fields(sim: &Sim, camp: u32) -> Value {
    let rt = sim.w.mob_runtime.as_ref().expect("mob runtime");
    let c = &rt.camps[camp as usize];
    let life = &rt.life[camp as usize];
    json!({
        "alive": c.alive,
        "state": c.state,
        "clearedAt": num(c.cleared_at),
        "respawnAt": num(c.respawn_at),
        "wardOwner": life.ward_owner.map(label).unwrap_or_default(),
        "wardExpiresAt": num(life.ward_expires_at),
    })
}

/// The ported actual producer: lethal ledger entries for every living mob of the camp, in spawn order, attributed to
/// the captured killer. The last one clears the camp and hands the ward over inside `mob_life::hurt`.
fn run_kills(sim: &mut Sim, case: &Value) {
    let Some(kills) = case["kills"].as_array() else {
        return;
    };
    for kill in kills {
        let camp = kill["camp"].as_u64().expect("camp") as u32;
        let killer = pid(kill["killer"].as_str().expect("killer"));
        let states = kill["states"].as_array().expect("kill states");
        let ids: Vec<PlayerId> = sim
            .w
            .mobs
            .iter()
            .filter(|mob| mob.camp == camp && mob.status == Status::Alive)
            .map(|mob| mob.core.id)
            .collect();
        assert_eq!(
            ids.len(),
            states.len(),
            "camp {camp}: the certified spot count is the captured kill count"
        );
        for (n, id) in ids.into_iter().enumerate() {
            let ix = sim.w.fighter_idx(id).expect("camp mob slot");
            let hp = sim.w.core(ix).vitals.hp;
            let hits = [Hit {
                terrain: false,
                amount: hp,
                by: Some(killer),
                name: sim.player_name(killer).map(std::sync::Arc::from),
            }];
            let mut ev = Vec::new();
            crate::systems::mob_life::hurt(&sim.k, &mut sim.w, &mut ev, ix, &hits);
            assert_eq!(
                camp_fields(sim, camp),
                states[n],
                "camp {camp}: producer state after kill {}",
                n + 1
            );
        }
    }
}

/// One captured verdict through the ported consumer. `point` is `canPlayerSee`, `actor` is the private actor
/// projection (`canPlayerSeeActor`), and `trail` is the source's private memory (which a ward must never write).
fn measure(sim: &mut Sim, probe: &Value) -> bool {
    let server_time = probe["serverTime"].as_f64().expect("probe serverTime");
    sim.w.server_time = server_time;
    sim.w.tick = (server_time / crate::constants::TICK_MS) as u32;
    sim.w.rt.gates_locked = probe["gatesLocked"].as_bool().expect("probe gatesLocked");
    let at = Vec2::new(
        probe["x"].as_f64().expect("probe x"),
        probe["y"].as_f64().expect("probe y"),
    );
    let viewer_name = probe["viewer"].as_str().expect("probe viewer");
    // "missing" is the source's absent-seat boundary: no seat, so nothing is visible.
    let Some(viewer) = (viewer_name != "missing").then(|| pid(viewer_name)) else {
        return false;
    };
    // A probe may pin the status of the seat it asks about (the source's dead-viewer boundary); everything else uses
    // the case's seated statuses.
    let override_status = probe["status"].as_str().map(status);
    let previous = override_status.map(|want| {
        let player = sim
            .w
            .players
            .iter_mut()
            .find(|player| player.id == viewer)
            .expect("an overridden probe seat");
        let previous = player.status;
        player.status = want;
        previous
    });
    let verdict = match probe["kind"].as_str().expect("probe kind") {
        "point" => sim.can_see_point(viewer, at),
        "actor" => {
            let target = pid(probe["target"].as_str().expect("probe target"));
            crate::observe(sim, viewer, &[])
                .visible
                .iter()
                .any(|row| row.id == target)
        }
        "trail" => sim.player(viewer).is_some_and(|player| {
            player
                .vision
                .remembers(sim.collision_view(), at, sim.w.tick)
        }),
        other => panic!("unsupported captured probe kind {other}"),
    };
    if let Some(previous) = previous {
        sim.w
            .players
            .iter_mut()
            .find(|player| player.id == viewer)
            .expect("the overridden seat")
            .status = previous;
    }
    verdict
}

#[test]
fn captured_camp_ward_producer_and_sight_match_the_source() {
    let f = fixture();
    assert_eq!(f["format"], json!("rh-vision-ward/1"));
    assert_eq!(
        f["map"]["fixture"],
        json!("crates/rh-sim/src/mapdata/fixtures/seed1.map.json")
    );
    let arena = seed1_arena();
    assert_eq!(arena.map.w, f["map"]["w"].as_u64().expect("w") as u32);
    assert_eq!(arena.map.h, f["map"]["h"].as_u64().expect("h") as u32);
    assert_eq!(
        arena
            .map
            .layers()
            .expect("certified layers")
            .legacy_map_hash_u32(),
        f["map"]["hash"].as_u64().expect("map hash") as u32,
        "the captured map is the admitted certified seed1 map"
    );
    let mut compared = 0usize;
    let mut owner_visible = 0usize;
    for case in f["cases"].as_array().expect("cases") {
        let mut sim = sim_for(case);
        run_kills(&mut sim, case);
        let hash = sim.state_hash();
        for probe in case["probes"].as_array().expect("probes") {
            let expected = probe["expected"].as_bool().expect("expected");
            let actual = measure(&mut sim, probe);
            assert_eq!(
                actual, expected,
                "{}: captured verdict {:?}",
                case["name"], probe
            );
            compared += 1;
            if expected && probe["kind"] == json!("point") {
                owner_visible += 1;
            }
        }
        // A public read may move the frozen clock a probe names, never authoritative state.
        sim.w.tick = case["tick"].as_u64().expect("tick") as u32;
        sim.w.server_time = case["serverTime"].as_f64().expect("serverTime");
        sim.w.rt.gates_locked = case["gatesLocked"].as_bool().expect("gatesLocked");
        assert_eq!(
            sim.state_hash(),
            hash,
            "{}: public sampling changed authoritative state",
            case["name"]
        );
    }
    assert!(compared >= 1350, "every captured probe is compared");
    assert!(
        owner_visible > 100,
        "the live-ward grid carries real positive verdicts"
    );
}

#[test]
fn the_comparison_is_bound_to_the_ward_owner_and_expiry() {
    let f = fixture();
    let case = f["cases"]
        .as_array()
        .expect("cases")
        .iter()
        .find(|case| case["name"] == json!("producer_and_two_camps"))
        .expect("the producer case");
    let mut sim = sim_for(case);
    run_kills(&mut sim, case);
    let probe = case["probes"]
        .as_array()
        .expect("probes")
        .iter()
        .find(|probe| probe["viewer"] == json!("p0") && probe["expected"] == json!(true))
        .expect("a point only the owner's ward reveals");
    assert!(measure(&mut sim, probe));
    let camp = case["kills"][0]["camp"].as_u64().expect("camp") as usize;
    let saved = sim.w.mob_runtime.as_ref().expect("mob runtime").life[camp].clone();
    // An expired timestamp closes the sight even while the camp still publishes the owner.
    sim.w.mob_runtime.as_mut().expect("mob runtime").life[camp].ward_expires_at = 0.;
    assert!(
        !measure(&mut sim, probe),
        "an expired ward cannot leak sight"
    );
    // Ownership is exact: another player never inherits the source's ward.
    let expiry = saved.ward_expires_at;
    let life = &mut sim.w.mob_runtime.as_mut().expect("mob runtime").life[camp];
    life.ward_expires_at = expiry;
    life.ward_owner = Some(PlayerId(99));
    assert!(!measure(&mut sim, probe), "a foreign owner must not see");
    sim.w.mob_runtime.as_mut().expect("mob runtime").life[camp] = saved;
    assert!(measure(&mut sim, probe), "the captured owner sees again");
}
