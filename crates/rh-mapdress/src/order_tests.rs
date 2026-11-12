//! Order rules: cluster moats and filler spacing, on seed 1 with the starter rules.
use super::*;
use rh_sim::mapgen::{coliseum, map_hash, pipeline};

/// Edge and filler props stay out of every cluster's `radius + moat` disk, and filler props keep their spacing.
#[test]
fn groves_have_open_ground_and_filler_is_spaced() {
    let fixed = coliseum::fixed_layout();
    let map = pipeline::Pipeline::new(&fixed)
        .certified_styled(1, pipeline::Options::default())
        .expect("generator runs")
        .expect("seed 1 certifies");
    let hash = u64::from_str_radix(&map_hash::map_hash(&map), 16).expect("hex hash");
    let rules = Rules::starter();
    let d = dress(&map, hash, &rules);
    let sites = cluster_sites(&map, hash, &rules);
    assert!(!sites.is_empty());
    let mut filler: Vec<(f64, f64)> = Vec::new();
    for z in &rules.zones {
        let edge: Vec<u8> = z.edges.iter().flat_map(|e| e.kinds.clone()).collect();
        let fill: Vec<u8> = z.fillers.iter().flat_map(|e| e.kinds.clone()).collect();
        for p in d.props.iter().filter(|p| p.flags & FLAG_LEGACY == 0) {
            let is_filler = fill.contains(&p.kind);
            if !is_filler && !edge.contains(&p.kind) {
                continue;
            }
            // Rules judge the tile, so measure from its centre.
            let (tx, ty) = (f64::from(p.x / 32), f64::from(p.y / 32));
            let (cx, cy) = (tx * 32.0 + 16.0, ty * 32.0 + 16.0);
            for s in &sites {
                let r = &rules.zone(s.zone).unwrap().clusters[s.rule];
                let c2 = sq(cx - f64::from(s.x)) + sq(cy - f64::from(s.y));
                assert!(c2 > sq((r.radius + r.moat) * TILE), "prop {p:?} in a moat");
            }
            if is_filler {
                filler.push((tx, ty));
            }
        }
    }
    assert!(filler.len() > 50);
    for (n, a) in filler.iter().enumerate() {
        for b in &filler[n + 1..] {
            assert!(sq(a.0 - b.0) + sq(a.1 - b.1) >= 4.0, "filler too close");
        }
    }
}
