//! P-DRESS-MARSH-1 review note: a zone with terrain rings round two classes bars tall props on the nearest ring of
//! each class only.
mod common;
use common::*;
use rh_mapdress::rules::TileClass;
use rh_mapdress::{dress, Rules, FLAG_TALL};
use rh_sim::mapdata::Zone;
use serde_json::{json, Value};

#[test]
fn tall_props_keep_off_the_nearest_ring_of_each_class_only() {
    let mut v: Value = serde_json::from_str(include_str!("../rules/zones.json")).unwrap();
    v["zones"]["plague"]["terrainRings"] = json!([
        { "name": "t-bog-1", "around": "bog", "reach": 1, "groundVariant": 7 },
        { "name": "t-bog-3", "around": "bog", "reach": 3, "groundVariant": 8 },
        { "name": "t-ember-1", "around": "ember", "reach": 1, "groundVariant": 9 },
        { "name": "t-ember-3", "around": "ember", "reach": 3, "groundVariant": 10 }
    ]);
    let custom = Rules::from_json(&v.to_string()).expect("two classes parse");
    let mut far_ring_tall = 0;
    for c in &cases()[..4] {
        let mut map = c.map.clone();
        let (w, h) = (map.w as usize, map.h as usize);
        // Scatter ember tiles on a lattice of Plague floor.
        for ty in (2..h - 2).step_by(6) {
            for tx in (2..w - 2).step_by(6) {
                let i = idx(&map, tx, ty);
                if zone_at(&map, i) == Some(Zone::Plague) && class_of(&map, i) == TileClass::Floor {
                    map.terrain[i] = 4;
                }
            }
        }
        let d = dress(&map, c.hash, &custom);
        let sources = |class: TileClass| -> Vec<(i64, i64)> {
            (0..w * h)
                .filter(|&i| zone_at(&map, i) == Some(Zone::Plague) && class_of(&map, i) == class)
                .map(|i| ((i % w) as i64, (i / w) as i64))
                .collect()
        };
        let (ember, bog) = (sources(TileClass::Ember), sources(TileClass::Bog));
        let near1 = |s: &[(i64, i64)], x: i64, y: i64| {
            s.iter()
                .any(|&(sx, sy)| (sx - x).abs().max((sy - y).abs()) <= 1)
        };
        for p in placed(&d).into_iter().filter(|p| p.flags & FLAG_TALL != 0) {
            let (tx, ty) = tile_of(p.x, p.y);
            let i = idx(&map, tx, ty);
            if zone_at(&map, i) != Some(Zone::Plague) || class_of(&map, i) != TileClass::Floor {
                continue;
            }
            let (x, y) = (tx as i64, ty as i64);
            assert!(
                !near1(&ember, x, y),
                "seed {}: tall prop on ember water ({tx},{ty})",
                c.seed
            );
            assert!(
                !near1(&bog, x, y),
                "seed {}: tall prop on bog water ({tx},{ty})",
                c.seed
            );
            if d.ground_variants[i] == 8 || d.ground_variants[i] == 10 {
                far_ring_tall += 1;
            }
        }
    }
    assert!(
        far_ring_tall > 0,
        "tall props may still stand on the farther rings"
    );
}
