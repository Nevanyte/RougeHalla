//! ADR0024 client goldens (protocol 16): protocol/fixtures/archetypes_v1.json, pathfinding_v2.json (foot box Box(10, 6))
//! and server_walk_v2.json (Archetypes mode, hero walker) must be exactly what the current core produces. The v1 files
//! stay the Disc(12) oracle (tests/pnet1_goldens.rs). Regenerate with `cargo run -p rh-parity --bin hitbox-fixtures`.

use rh_parity::hitbox_goldens::{all, FOOT};
use rh_sim::geometry::Footprint;
use rh_sim::map::MASK_MOVE;

fn repo(relative: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(relative)
}

#[test]
fn committed_hitbox_goldens_are_the_current_core() {
    for (path, want) in all() {
        let got = std::fs::read_to_string(repo(path)).unwrap_or_else(|e| panic!("{path}: {e}"));
        assert!(
            got == want,
            "{path} differs from the current core: run cargo run -p rh-parity --bin hitbox-fixtures"
        );
    }
}

#[test]
fn pathfinding_v2_differs_from_v1_and_every_waypoint_fits_the_foot_box() {
    let v1: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(repo("protocol/fixtures/pathfinding_v1.json")).unwrap()).unwrap();
    let v2: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(repo("protocol/fixtures/pathfinding_v2.json")).unwrap()).unwrap();
    assert_eq!(v1["mapBlob"], v2["mapBlob"], "the same map");
    let (q1, q2) = (v1["queries"].as_array().unwrap(), v2["queries"].as_array().unwrap());
    assert_eq!(q1.len(), 300);
    assert_eq!(q2.len(), 300);
    let (_, map) = rh_parity::load_paths(&repo("parity/fixtures/pathfinding_seed1.json"));
    let mut differ = 0;
    for (a, b) in q1.iter().zip(q2) {
        assert_eq!((&a["from"], &a["to"]), (&b["from"], &b["to"]));
        differ += (a["path"] != b["path"]) as u32;
        let path = b["path"].as_array().unwrap();
        // Every waypoint but a snapped fallback (a tile centre) leaves the foot box clear.
        for p in &path[..path.len().saturating_sub(1)] {
            let at = rh_sim::Vec2::new(p[0].as_f64().unwrap(), p[1].as_f64().unwrap());
            assert!(FOOT.clear(&map, at, MASK_MOVE), "waypoint {at:?} overlaps a wall");
        }
    }
    assert!(differ > 0, "the foot box changes some paths");
    assert_eq!(FOOT, Footprint::Box { hx: 10.0, hy: 6.0 });
}
