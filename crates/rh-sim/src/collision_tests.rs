use super::*;
use crate::{
    geometry,
    map::{MASK_MOVE, MASK_SIGHT},
    pathfind::Pathfinder,
    Vec2,
};
use serde_json::Value;
pub(crate) fn fixture() -> Value {
    serde_json::from_str(include_str!("../../../parity/arena/source.json")).unwrap()
}
pub(crate) fn fixture_map(v: &Value) -> TileMap {
    let export: crate::mapdata::MapExport =
        serde_json::from_value(v["map"]["export"].clone()).unwrap();
    let (w, h, tiles, layers) = export.validate().unwrap().into_parts();
    TileMap::new(w, h, tiles)
        .unwrap()
        .with_layers(layers)
        .unwrap()
}
pub(crate) fn point(v: &Value) -> Vec2 {
    Vec2::new(v["x"].as_f64().unwrap(), v["y"].as_f64().unwrap())
}
#[test]
fn source_open_and_locked_gate_geometry_share_only_static_metadata() {
    let source = fixture();
    let open = fixture_map(&source);
    let locked = open.closed_gates().unwrap();
    assert!(std::ptr::eq(
        open.layers().unwrap(),
        locked.layers().unwrap()
    ));
    // Closed runtime geometry is deliberately not a canonical admitted map export.
    assert!(serde_json::from_value::<TileMap>(serde_json::to_value(&locked).unwrap()).is_err());
    for expected in source["sourceReconstructedGeometry"].as_array().unwrap() {
        let map = if expected["variant"] == "locked" {
            &locked
        } else {
            &open
        };
        let input = &expected["input"];
        let (a, b, gate, radius) = (
            point(&input["a"]),
            point(&input["b"]),
            point(&input["gate"]),
            input["radius"].as_f64().unwrap(),
        );
        assert_eq!(
            geometry::circle_clear(map, gate, radius, MASK_MOVE),
            expected["circle"]
        );
        assert_eq!(
            geometry::segment_clear(map, a, b, radius, MASK_MOVE),
            expected["segment"]
        );
        assert_eq!(
            geometry::has_line_of_sight(map, a, b, MASK_SIGHT),
            expected["los"]
        );
        let path = Pathfinder::default().find_path(map, a, b, radius);
        assert_eq!(
            path,
            expected["path"]
                .as_array()
                .unwrap()
                .iter()
                .map(point)
                .collect::<Vec<_>>()
        );
        let ray = geometry::raycast(map, a.x, a.y, b.x, b.y, MASK_SIGHT);
        assert_eq!(ray.hit, expected["ray"]["hit"].as_bool().unwrap());
        assert_eq!(ray.x, expected["ray"]["x"].as_f64().unwrap());
        assert_eq!(ray.y, expected["ray"]["y"].as_f64().unwrap());
        assert_eq!(ray.dist, expected["ray"]["dist"].as_f64().unwrap());
        assert_eq!(
            !crate::vision::scene_line_blocked(map, a.x, a.y, b.x, b.y),
            expected["currentVision"]
        );
        for side in expected["gateTiles"].as_array().unwrap() {
            for tile in side["tiles"].as_array().unwrap() {
                let (x, y) = (tile["x"].as_i64().unwrap(), tile["y"].as_i64().unwrap());
                let i = y as usize * open.w as usize + x as usize;
                assert_eq!(
                    open.tile(x, y).unwrap(),
                    tile["base"].as_u64().unwrap() as u8
                );
                assert_eq!(
                    map.tile(x, y).unwrap(),
                    tile["active"].as_u64().unwrap() as u8
                );
                assert_eq!(
                    map.layers().unwrap().data().terrain[i],
                    tile["terrain"].as_u64().unwrap() as u8
                );
            }
        }
    }
}
