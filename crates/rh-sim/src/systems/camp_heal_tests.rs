//! The camp-clear reward: contributor eligibility, the large-potion grant, the bag-full notice and the clear counter.
use super::*;
use crate::hooks::{HookArgs, Hx};
use crate::math::hypot;
use crate::mob_runtime::MobMode;
use crate::potions::DEFINITION;
use crate::{Event, FactionId, PlayerId, Secrets, Sim, SimConfig, Vec2};

fn arena() -> crate::Arena {
    let data: crate::mapdata::GameMapData = serde_json::from_str(include_str!(
        "../../../../parity/initial-loot/input-map.json"
    ))
    .unwrap();
    let hash = u32::from_str_radix(&crate::mapgen::map_hash::map_hash(&data), 16).unwrap();
    let v = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: hash,
        map: data,
    }
    .validate()
    .unwrap();
    let (w, h, t, l) = v.into_parts();
    let spawns = l
        .data()
        .spawns
        .iter()
        .map(|p| crate::Vec2::new(p.x, p.y))
        .collect();
    crate::Arena {
        map: crate::TileMap::new(w, h, t)
            .unwrap()
            .with_layers(std::sync::Arc::new(l))
            .unwrap(),
        spawns,
    }
}

fn sim() -> Sim {
    let mut sim = Sim::new(
        SimConfig {
            initial_loot: true,
            mob_mode: MobMode::Pve,
            min_players: 3,
            fill_seconds: 0.0,
            ..Default::default()
        },
        arena(),
        Secrets::from_seed(3),
    );
    for i in 0..3 {
        sim.add_player(&format!("p{i}"), Some(FactionId::Fire), false);
    }
    let _ = sim.step();
    assert!(sim.w.mob_runtime.is_some(), "the PvE world publishes camps");
    sim.w.server_time = 1000.0;
    sim
}

fn centre(sim: &Sim, camp: u32) -> Vec2 {
    let c = &sim
        .k
        .arena
        .map
        .layers()
        .expect("layered arena")
        .data()
        .camps[camp as usize];
    Vec2::new(c.x, c.y)
}

/// A point outside camp `camp`'s territory and beyond `CAMP_HEAL_RANGE` of its centre, and inside the map.
fn far_point(sim: &Sim, camp: u32, centre: Vec2) -> Vec2 {
    let w = sim.k.arena.map.w as f64 * crate::constants::TILE;
    let h = sim.k.arena.map.h as f64 * crate::constants::TILE;
    for step in 1..80 {
        let d = CAMP_HEAL_RANGE + 60.0 * step as f64;
        for (dx, dy) in [(1.0, 0.0), (-1.0, 0.0), (0.0, 1.0), (0.0, -1.0)] {
            let at = Vec2::new(centre.x + dx * d, centre.y + dy * d);
            if at.x < 40.0 || at.y < 40.0 || at.x > w - 40.0 || at.y > h - 40.0 {
                continue;
            }
            if hypot(at.x - centre.x, at.y - centre.y) <= CAMP_HEAL_RANGE {
                continue;
            }
            if mob_ai::territory(&sim.k, at) != camp + 1 {
                return at;
            }
        }
    }
    panic!("no far point on this map");
}

fn place(sim: &mut Sim, i: usize, at: Vec2) {
    sim.w.players[i].body.x = at.x;
    sim.w.players[i].body.y = at.y;
}

fn fire(sim: &mut Sim, camp: u32, ev: &mut Vec<Event>) {
    let k = &sim.k;
    let w = &mut sim.w;
    let mut hx = Hx {
        stats: Default::default(),
        fx: None,
        k,
        w,
        ev,
    };
    crate::hooks::fire(&mut hx, HookArgs::CampCleared { camp });
}

#[test]
fn a_clear_pays_a_camp_potion_and_counts_only_the_contributors_at_the_camp() {
    let mut sim = sim();
    let camp = 0u32;
    let at_centre = centre(&sim, camp);
    let far = far_point(&sim, camp, at_centre);
    let ids: Vec<PlayerId> = sim.w.players.iter().map(|p| p.id).collect();
    place(&mut sim, 0, at_centre);
    place(&mut sim, 1, far);
    place(&mut sim, 2, at_centre);
    sim.w.players[2].potion_large = DEFINITION.cap;
    sim.w
        .mob_runtime
        .as_mut()
        .unwrap()
        .life[camp as usize]
        .contributors = ids.clone();
    let mut ev = Vec::new();
    fire(&mut sim, camp, &mut ev);
    // Every standing contributor gets the potion; only the ones still at the camp count the clear.
    assert_eq!(sim.w.players[0].potion_large, 1);
    assert_eq!(sim.w.players[0].camps_cleared, 1);
    assert_eq!(sim.w.players[1].potion_large, 1);
    assert_eq!(sim.w.players[1].camps_cleared, 0);
    // A full bag keeps its stock, still counts the clear, and is told why.
    assert_eq!(sim.w.players[2].potion_large, DEFINITION.cap);
    assert_eq!(sim.w.players[2].camps_cleared, 1);
    assert!(ev.iter().any(|e| matches!(
        e,
        Event::PotionNotice { id, notice: crate::potions::Notice::LargeStored } if *id == ids[0]
    )));
    assert!(ev.iter().any(|e| matches!(
        e,
        Event::PotionNotice { id, notice: crate::potions::Notice::CampBagFull } if *id == ids[2]
    )));
    assert!(sim.w.mob_runtime.as_ref().unwrap().life[camp as usize]
        .contributors
        .is_empty());
}

#[test]
fn a_clear_with_no_contributors_pays_nothing() {
    let mut sim = sim();
    let before: Vec<(u8, u16)> = sim
        .w
        .players
        .iter()
        .map(|p| (p.potion_large, p.camps_cleared))
        .collect();
    let mut ev = Vec::new();
    fire(&mut sim, 0, &mut ev);
    assert!(ev.is_empty());
    assert_eq!(
        sim.w
            .players
            .iter()
            .map(|p| (p.potion_large, p.camps_cleared))
            .collect::<Vec<_>>(),
        before
    );
}

#[test]
fn a_down_contributor_gets_neither_a_potion_nor_the_clear() {
    let mut sim = sim();
    let camp = 0u32;
    let at_centre = centre(&sim, camp);
    let ids: Vec<PlayerId> = sim.w.players.iter().map(|p| p.id).collect();
    place(&mut sim, 0, at_centre);
    place(&mut sim, 1, at_centre);
    sim.w.players[0].status = crate::Status::Dead;
    sim.w.players[0].vitals.hp = 0.0;
    sim.w
        .mob_runtime
        .as_mut()
        .unwrap()
        .life[camp as usize]
        .contributors = ids;
    let mut ev = Vec::new();
    fire(&mut sim, camp, &mut ev);
    assert_eq!(sim.w.players[0].potion_large, 0);
    assert_eq!(sim.w.players[0].camps_cleared, 0);
    assert_eq!(sim.w.players[1].potion_large, 1);
    assert_eq!(sim.w.players[1].camps_cleared, 1);
}
