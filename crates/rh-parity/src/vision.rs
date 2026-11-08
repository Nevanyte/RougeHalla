//! Private sight probes in installed-module scenarios. For a generated map, validate the actual
//! collision grid, seed, map identity and shuffled raid starts before comparing any view.
use crate::{
    fid, pid, Arena, Fixture, Placement, PlayerId, Report, Secrets, Sim, SimConfig, TileMap, Vec2,
};
use serde::Deserialize;

pub(super) const LAYER_MODULES: &[&str] =
    &["weapons", "targeting", "projectiles", "abilities", "vision"];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VisionPlan {
    pub viewers: Vec<String>,
    pub points: Vec<ProbePoint>,
    pub map: Option<SourceMap>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SourceMap {
    pub seed: u32,
    pub hash: u32,
    pub spawn_seed: u32,
    pub bootstrap: Vec<Spawn>,
}
#[derive(Deserialize, PartialEq, Debug)]
#[serde(deny_unknown_fields)]
pub struct Spawn {
    pub id: String,
    pub x: f64,
    pub y: f64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProbePoint {
    pub x: f64,
    pub y: f64,
}
#[derive(Deserialize, serde::Serialize, PartialEq, Debug)]
#[serde(deny_unknown_fields)]
pub struct VisionView {
    pub viewer: String,
    pub points: Vec<bool>,
    pub actors: Vec<String>,
}

pub(super) fn source(fx: &Fixture) -> Option<&SourceMap> {
    fx.vision_plan.as_ref().and_then(|p| p.map.as_ref())
}
pub(super) fn arena(fx: &Fixture, map: TileMap) -> Result<Arena, String> {
    let Some(meta) = source(fx) else {
        return Ok(Arena {
            map,
            spawns: vec![],
        });
    };
    if fx.packet.as_deref() != Some("P-VISION-1")
        || ![1, 2].contains(&meta.seed)
        || fx.legacy_config.map_seed != Some(meta.seed)
    {
        return Err("unrecognized installed-vision map provenance".into());
    }
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
        "../rh-sim/src/mapdata/fixtures/seed{}.map.json",
        meta.seed
    ));
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let import: rh_sim::mapdata::MapExport =
        serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let actual = import.validate().map_err(|e| e.to_string())?;
    if actual.tiles() != map.tiles
        || actual.layers().data().seed != i64::from(meta.seed)
        || actual.layers().legacy_map_hash_u32() != meta.hash
    {
        return Err("vision map collision/seed/hash differs from the certified source".into());
    }
    let spawns = actual
        .layers()
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    let (_, _, _, layers) = actual.into_parts();
    Ok(Arena {
        map: map.with_layers(layers).map_err(|e| e.to_string())?,
        spawns,
    })
}

pub(super) fn verify_bootstrap(
    meta: &SourceMap,
    arena: &Arena,
    ps: &[Placement],
    config: &SimConfig,
    secrets: Secrets,
) -> Result<(), String> {
    let mut s = Sim::new(
        SimConfig {
            quests: false,
            min_players: ps.len(),
            fill_seconds: 0.,
            ..config.clone()
        },
        arena.clone(),
        secrets,
    );
    for p in ps {
        s.add_player(&p.profile, Some(p.faction), p.bot);
    }
    s.step();
    let actual: Vec<_> = s
        .players()
        .iter()
        .map(|p| Spawn {
            id: fid(p.id),
            x: p.body.x,
            y: p.body.y,
        })
        .collect();
    if actual != meta.bootstrap {
        return Err(format!(
            "vision raid starts: rust {actual:?} vs legacy {:?}",
            meta.bootstrap
        ));
    }
    Ok(())
}

pub(super) fn compare(rep: &mut Report, sim: &Sim, fx: &Fixture, t: &crate::FixTick) -> bool {
    let Some(plan) = &fx.vision_plan else {
        if t.vision.is_some() || fx.packet.as_deref() == Some("P-VISION-1") {
            rep.fail(format!("tick {}: missing vision capture plan", t.tick));
        }
        return false;
    };
    if t.tick < fx.legacy_config.start_tick + 3 {
        if t.vision.is_some() {
            rep.fail(format!("tick {}: unexpected early vision sample", t.tick));
        }
        return false;
    }
    let expected: Vec<_> = plan
        .viewers
        .iter()
        .map(|name| {
            let viewer: PlayerId = pid(name);
            let obs = rh_sim::observe(sim, viewer, &[]);
            VisionView {
                viewer: name.clone(),
                points: plan
                    .points
                    .iter()
                    .map(|p| sim.can_see_point(viewer, Vec2::new(p.x, p.y)))
                    .collect(),
                actors: obs.visible.iter().map(|a| fid(a.id)).collect(),
            }
        })
        .collect();
    if t.vision.as_ref() != Some(&expected) {
        rep.fail(format!(
            "tick {}: vision: rust {expected:?} vs legacy {:?}",
            t.tick, t.vision
        ));
    }
    true
}
