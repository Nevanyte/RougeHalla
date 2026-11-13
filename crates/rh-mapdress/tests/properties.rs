//! Property tests of P-DRESS-ENGINE-1 (brief section 8) over seeds 1-8 of `Pipeline::certified_styled`.
//! Prop positions are world units (1 tile = 32 u); a prop is judged on the tile holding its position.
mod common;
use common::*;
use rh_mapdress::rules::{Against, TileClass};
use rh_mapdress::{
    cluster_sites, dress, keep_clear, tall_corridor, DressProp, FLAG_LEGACY, FLAG_TALL, MAX_PROPS,
};
use rh_sim::mapdata::{FeatureKind, GameMapData, Zone};

fn zone_of_prop(map: &GameMapData, p: &DressProp) -> Option<Zone> {
    let (tx, ty) = tile_of(p.x, p.y);
    zone_at(map, idx(map, tx, ty))
}

// ---- stage 1: keep-clear ---------------------------------------------------------------------------------------

#[test]
fn keep_clear_mask_covers_camps_points_coliseum_gates_and_bushes() {
    for c in cases() {
        let mask = keep_clear(&c.map, rules());
        assert_eq!(
            mask.len(),
            c.map.w as usize * c.map.h as usize,
            "seed {}",
            c.seed
        );
        let need = required_clear(&c.map, rules());
        assert!(
            need.iter().any(|b| *b),
            "seed {}: test helper found nothing to clear",
            c.seed
        );
        let bush_tiles = (0..need.len())
            .filter(|&i| {
                let f = c.map.feature_grid[i] as usize;
                f > 0
                    && c.map
                        .features
                        .get(f - 1)
                        .is_some_and(|f| f.kind == FeatureKind::Bush)
            })
            .count();
        assert!(
            bush_tiles > 0,
            "seed {}: map has concealment bushes",
            c.seed
        );
        let missing = need.iter().zip(&mask).filter(|(n, m)| **n && !**m).count();
        assert_eq!(
            missing, 0,
            "seed {}: {missing} required tiles are not in the keep-clear mask",
            c.seed
        );
        // The mask is not simply "everything".
        let set = mask.iter().filter(|b| **b).count();
        assert!(
            set < mask.len() / 2,
            "seed {}: mask covers {set} of {} tiles",
            c.seed,
            mask.len()
        );
    }
}

#[test]
fn tall_corridor_joins_every_camp_to_its_nearest_gate() {
    for c in cases() {
        let corridor = tall_corridor(&c.map, rules());
        assert_eq!(corridor.len(), c.map.w as usize * c.map.h as usize);
        assert!(!c.map.camps.is_empty());
        for camp in &c.map.camps {
            let gate = nearest_gate(&c.map, camp.x, camp.y);
            // Sample the segment; every sample tile (width >= 1 tile) is inside the corridor.
            for step in 0..=8 {
                let t = f64::from(step) / 8.0;
                let (x, y) = (
                    camp.x + (gate.0 - camp.x) * t,
                    camp.y + (gate.1 - camp.y) * t,
                );
                let (tx, ty) = ((x / TILE).floor() as usize, (y / TILE).floor() as usize);
                assert!(
                    corridor[idx(&c.map, tx, ty)],
                    "seed {}: camp {} corridor misses tile ({tx},{ty}) at t={t}",
                    c.seed,
                    camp.id
                );
            }
        }
        let set = corridor.iter().filter(|b| **b).count();
        assert!(
            set < corridor.len() / 2,
            "seed {}: corridor covers {set} tiles",
            c.seed
        );
    }
}

#[test]
fn no_prop_stands_in_the_keep_clear_mask_and_no_tall_prop_in_a_corridor() {
    for c in cases() {
        let d = dress(&c.map, c.hash, rules());
        assert!(
            !placed(&d).is_empty(),
            "seed {}: nothing was placed",
            c.seed
        );
        let clear = keep_clear(&c.map, rules());
        let corridor = tall_corridor(&c.map, rules());
        for p in placed(&d) {
            let (tx, ty) = tile_of(p.x, p.y);
            let i = idx(&c.map, tx, ty);
            assert!(
                !clear[i],
                "seed {}: prop {p:?} stands in the keep-clear mask",
                c.seed
            );
            if rules().is_tall(p.kind) {
                assert!(
                    !corridor[i],
                    "seed {}: tall prop {p:?} stands in a corridor",
                    c.seed
                );
            }
        }
    }
}

// ---- tile classes, kinds, flags -----------------------------------------------------------------------------------

#[test]
fn props_stand_only_on_tile_classes_their_rules_allow() {
    for c in cases() {
        let d = dress(&c.map, c.hash, rules());
        assert!(
            !placed(&d).is_empty(),
            "seed {}: nothing was placed",
            c.seed
        );
        for p in placed(&d) {
            let (tx, ty) = tile_of(p.x, p.y);
            assert!(
                tx < c.map.w as usize && ty < c.map.h as usize,
                "seed {}: {p:?} off the map",
                c.seed
            );
            let class = class_of(&c.map, idx(&c.map, tx, ty));
            let allowed = rules().allowed_classes(p.kind);
            assert!(
                allowed.contains(&class),
                "seed {}: {p:?} on {class:?}, rules allow {allowed:?}",
                c.seed
            );
        }
    }
}

#[test]
fn placed_props_use_rule_kinds_and_the_tall_flag_matches_the_kind() {
    for c in cases() {
        let d = dress(&c.map, c.hash, rules());
        assert!(
            !placed(&d).is_empty(),
            "seed {}: nothing was placed",
            c.seed
        );
        for p in placed(&d) {
            assert!(
                rules().kind_name(p.kind).is_some(),
                "seed {}: unknown kind code in {p:?}",
                c.seed
            );
            assert_eq!(
                p.flags & FLAG_TALL != 0,
                rules().is_tall(p.kind),
                "seed {}: {p:?}",
                c.seed
            );
            assert_eq!(
                p.flags & !FLAG_TALL,
                0,
                "seed {}: stray flags in {p:?}",
                c.seed
            );
        }
    }
}

#[test]
fn a_zone_rules_kinds_only_appear_inside_that_zone() {
    for c in cases() {
        let d = dress(&c.map, c.hash, rules());
        assert!(
            !placed(&d).is_empty(),
            "seed {}: nothing was placed",
            c.seed
        );
        for zone in ZONES {
            let kinds = zone_kinds(rules(), zone).all();
            for p in placed(&d).iter().filter(|p| kinds.contains(&p.kind)) {
                assert_eq!(
                    zone_of_prop(&c.map, p),
                    Some(zone),
                    "seed {}: {p:?} is outside {zone:?}",
                    c.seed
                );
            }
        }
    }
}

// ---- determinism ------------------------------------------------------------------------------------------------

#[test]
fn reruns_are_byte_identical_and_a_different_map_hash_dresses_differently() {
    for c in cases() {
        let a = dress(&c.map, c.hash, rules());
        let b = dress(&c.map, c.hash, rules());
        assert_eq!(bytes(&a), bytes(&b), "seed {}", c.seed);
        assert_eq!(
            cluster_sites(&c.map, c.hash, rules()),
            cluster_sites(&c.map, c.hash, rules())
        );
        assert!(
            !placed(&a).is_empty(),
            "seed {}: nothing was placed",
            c.seed
        );
        let other = dress(&c.map, c.hash ^ 0x9E37_79B9_7F4A_7C15, rules());
        assert_ne!(
            a.props, other.props,
            "seed {}: the map hash does not change the props",
            c.seed
        );
    }
}

#[test]
fn rules_from_a_reparsed_file_dress_identically() {
    let again = rh_mapdress::Rules::starter();
    let c = &cases()[0];
    let a = dress(&c.map, c.hash, rules());
    assert!(!placed(&a).is_empty());
    assert_eq!(bytes(&a), bytes(&dress(&c.map, c.hash, &again)));
}

// ---- legacy props, cap, plane -------------------------------------------------------------------------------------

#[test]
fn every_legacy_prop_is_kept_first_and_unchanged() {
    for c in cases() {
        let d = dress(&c.map, c.hash, rules());
        assert!(
            !c.map.props.is_empty(),
            "seed {}: generated with decor on",
            c.seed
        );
        let legacy: Vec<DressProp> = c.map.props.iter().map(legacy_row).collect();
        assert!(d.props.len() >= legacy.len(), "seed {}", c.seed);
        assert_eq!(&d.props[..legacy.len()], &legacy[..], "seed {}", c.seed);
        assert!(
            d.props[legacy.len()..]
                .iter()
                .all(|p| p.flags & FLAG_LEGACY == 0),
            "seed {}",
            c.seed
        );
        assert!(
            d.props.len() > legacy.len(),
            "seed {}: nothing was added to the legacy props",
            c.seed
        );
    }
}

#[test]
fn more_than_the_cap_of_legacy_props_is_cut_to_the_cap_in_order() {
    let mut map = cases()[0].map.clone();
    let floor: Vec<usize> = (0..map.tiles.len())
        .filter(|&i| map.tiles[i] == 0)
        .collect();
    map.props = (0..MAX_PROPS + 800)
        .map(|n| {
            let i = floor[(n * 7) % floor.len()];
            let (x, y) = centre(i % map.w as usize, i / map.w as usize);
            rh_sim::mapdata::MapProp {
                kind: (n % 300) as u16,
                x,
                y,
                v: (n % 5) as u8,
            }
        })
        .collect();
    let d = dress(&map, 7, rules());
    assert_eq!(d.props.len(), MAX_PROPS);
    let legacy: Vec<DressProp> = map.props.iter().take(MAX_PROPS).map(legacy_row).collect();
    assert_eq!(d.props, legacy);
    assert_eq!(legacy[299].kind, 255, "kinds above 255 clamp to 255");
}

#[test]
fn the_prop_count_never_passes_the_cap_even_when_densities_saturate() {
    let mut v: serde_json::Value =
        serde_json::from_str(include_str!("../rules/zones.json")).unwrap();
    fn saturate(v: &mut serde_json::Value) {
        match v {
            serde_json::Value::Object(m) => {
                for (k, x) in m.iter_mut() {
                    match k.as_str() {
                        "density" => *x = serde_json::json!(100.0),
                        "sites" => *x = serde_json::json!(500),
                        "members" => *x = serde_json::json!(60),
                        "minSpacing" => *x = serde_json::json!(0.0),
                        "clearing" => *x = serde_json::json!(0.0),
                        _ => saturate(x),
                    }
                }
            }
            serde_json::Value::Array(a) => a.iter_mut().for_each(saturate),
            _ => {}
        }
    }
    saturate(&mut v);
    let heavy = rh_mapdress::Rules::from_json(&v.to_string()).expect("saturated rules are valid");
    for c in cases().iter().take(3) {
        let d = dress(&c.map, c.hash, &heavy);
        assert!(
            d.props.len() <= MAX_PROPS,
            "seed {}: {} props",
            c.seed,
            d.props.len()
        );
        assert!(
            d.props.len() >= MAX_PROPS / 2,
            "seed {}: saturated densities placed only {}",
            c.seed,
            d.props.len()
        );
        assert_eq!(d.ground_variants.len(), c.map.w as usize * c.map.h as usize);
    }
}

#[test]
fn the_ground_variant_plane_is_width_times_height_and_follows_the_ring_bands() {
    for c in cases() {
        let d = dress(&c.map, c.hash, rules());
        assert_eq!(
            d.ground_variants.len(),
            c.map.w as usize * c.map.h as usize,
            "seed {}",
            c.seed
        );
        for zone in ZONES {
            let z = rules().zone(zone).unwrap();
            let a = anchor(&c.map, zone, z.signature_feature);
            let mut seen = vec![0usize; z.rings.len()];
            for ty in 0..c.map.h as usize {
                for tx in 0..c.map.w as usize {
                    let i = idx(&c.map, tx, ty);
                    let v = d.ground_variants[i];
                    if v == 0 || zone_at(&c.map, i) != Some(zone) {
                        continue;
                    }
                    // P-DRESS-MARSH-1: Plague's water (7) and mud (8) are not signature rings; `marsh.rs` pins them.
                    if zone == Zone::Plague && [7, 8].contains(&v) {
                        continue;
                    }
                    let dd = dist(centre(tx, ty), a) / TILE;
                    let k = z
                        .rings
                        .iter()
                        .position(|r| {
                            r.ground_variant == v && dd >= r.inner - 1e-9 && dd < r.outer + 1e-9
                        })
                        .unwrap_or_else(|| {
                            panic!(
                                "seed {}: tile ({tx},{ty}) variant {v} fits no ring of {zone:?}",
                                c.seed
                            )
                        });
                    seen[k] += 1;
                }
            }
            assert!(
                seen.iter().all(|n| *n > 0),
                "seed {}: {zone:?} ring variants never used: {seen:?}",
                c.seed
            );
        }
        // Variants outside every zone's tiles stay 0.
        for i in 0..d.ground_variants.len() {
            if zone_at(&c.map, i).is_none() {
                assert_eq!(
                    d.ground_variants[i], 0,
                    "seed {}: variant outside any zone",
                    c.seed
                );
            }
        }
    }
}

// ---- "dresses something": every stage of every zone, on at least 6 of the 8 seeds ---------------------------------------

#[test]
fn every_stage_of_every_zone_places_props_on_most_seeds() {
    let dressings: Vec<_> = cases()
        .iter()
        .map(|c| dress(&c.map, c.hash, rules()))
        .collect();
    for zone in ZONES {
        let k = zone_kinds(rules(), zone);
        let stages: [(&str, Vec<u8>); 4] = [
            ("rings", k.rings.concat()),
            ("clusters", k.clusters.concat()),
            ("edges", k.edges.concat()),
            ("filler", k.fillers.concat()),
        ];
        for (name, kinds) in stages {
            assert!(!kinds.is_empty(), "{zone:?} has no {name} rule");
            let seeds_with = cases()
                .iter()
                .zip(&dressings)
                .filter(|(c, d)| {
                    placed(d)
                        .iter()
                        .any(|p| kinds.contains(&p.kind) && zone_of_prop(&c.map, p) == Some(zone))
                })
                .count();
            assert!(
                seeds_with >= 6,
                "{zone:?} {name}: props on only {seeds_with} of 8 seeds"
            );
        }
    }
}

// ---- stage 3: signature rings -------------------------------------------------------------------------------------

/// Asserts every ring prop is inside its band; returns the number of props per zone and ring.
fn check_rings(
    map: &GameMapData,
    hash: u64,
    label: &str,
    anchor_of: &dyn Fn(Zone, FeatureKind) -> (f64, f64),
) -> Vec<Vec<usize>> {
    let d = dress(map, hash, rules());
    let mut counts = Vec::new();
    for zone in ZONES {
        counts.push(Vec::new());
        let z = rules().zone(zone).unwrap();
        let a = anchor_of(zone, z.signature_feature);
        for (ri, ring) in z.rings.iter().enumerate() {
            let kinds: Vec<u8> = ring.props.iter().map(|p| p.kind).collect();
            let mine: Vec<_> = placed(&d)
                .into_iter()
                .filter(|p| kinds.contains(&p.kind))
                .collect();
            counts.last_mut().unwrap().push(mine.len());
            let _ = ri;
            for p in mine {
                let (tx, ty) = tile_of(p.x, p.y);
                let dd = dist(centre(tx, ty), a) / TILE;
                assert!(
                    dd >= ring.inner - 1e-9 && dd < ring.outer + 1e-9,
                    "{label}: {zone:?} ring {} prop {p:?} at {dd:.2} tiles, band [{}, {})",
                    ring.name,
                    ring.inner,
                    ring.outer
                );
            }
        }
    }
    counts
}

#[test]
fn ring_props_lie_in_their_band_around_the_largest_signature_feature() {
    let mut seeds_with = vec![vec![0usize; 2]; ZONES.len()];
    for c in cases() {
        let counts = check_rings(&c.map, c.hash, &format!("seed {}", c.seed), &|zone, f| {
            anchor(&c.map, zone, f)
        });
        for (zi, rings) in counts.iter().enumerate() {
            assert_eq!(rings.len(), 2, "the starter file has two rings per zone");
            for (ri, n) in rings.iter().enumerate() {
                seeds_with[zi][ri] += usize::from(*n > 0);
            }
        }
    }
    for (zi, rings) in seeds_with.iter().enumerate() {
        for (ri, n) in rings.iter().enumerate() {
            assert!(
                *n >= 6,
                "{:?} ring {ri} placed props on only {n} of 8 seeds",
                ZONES[zi]
            );
        }
    }
}

#[test]
fn a_zone_without_its_signature_feature_rings_around_its_centroid() {
    for c in cases().iter().take(3) {
        let mut map = c.map.clone();
        for f in map.features.iter_mut() {
            // Re-kind (not remove) so `feature_grid` indexes stay valid; no rule uses `infill` as a signature.
            if rules()
                .zone(f.zone)
                .is_some_and(|z| z.signature_feature == f.kind)
            {
                f.kind = FeatureKind::Infill;
            }
        }
        for zone in ZONES {
            let z = rules().zone(zone).unwrap();
            assert!(!map
                .features
                .iter()
                .any(|f| f.zone == zone && f.kind == z.signature_feature));
        }
        let counts = check_rings(
            &map,
            c.hash,
            &format!("seed {} (no signature)", c.seed),
            &|zone, _| centroid(&map, zone),
        );
        for (zi, rings) in counts.iter().enumerate() {
            assert!(
                rings.iter().sum::<usize>() > 0,
                "seed {}: {:?} got no ring props without its feature",
                c.seed,
                ZONES[zi]
            );
        }
    }
}

// ---- stage 4: clusters with clearings -----------------------------------------------------------------------------

#[test]
fn clusters_keep_their_radius_spacing_and_clearing_share() {
    for c in cases() {
        let d = dress(&c.map, c.hash, rules());
        let sites = cluster_sites(&c.map, c.hash, rules());
        let clear = keep_clear(&c.map, rules());
        for zone in ZONES {
            let z = rules().zone(zone).unwrap();
            for (ri, rule) in z.clusters.iter().enumerate() {
                let mine: Vec<_> = sites
                    .iter()
                    .filter(|s| s.zone == zone && s.rule == ri)
                    .collect();
                assert!(
                    !mine.is_empty(),
                    "seed {}: {zone:?} {} has no sites",
                    c.seed,
                    rule.name
                );
                assert!(
                    mine.len() <= rule.sites as usize,
                    "seed {}: {} too many sites",
                    c.seed,
                    rule.name
                );
                // Site spacing.
                for (a, sa) in mine.iter().enumerate() {
                    for sb in &mine[a + 1..] {
                        let dd = dist(
                            (f64::from(sa.x), f64::from(sa.y)),
                            (f64::from(sb.x), f64::from(sb.y)),
                        ) / TILE;
                        assert!(
                            dd >= rule.min_spacing - 1e-9,
                            "seed {}: {} sites {dd:.2} tiles apart",
                            c.seed,
                            rule.name
                        );
                    }
                }
                // Members lie within the radius of a site.
                let members: Vec<_> = placed(&d)
                    .into_iter()
                    .filter(|p| rule.kinds.contains(&p.kind))
                    .collect();
                assert!(
                    !members.is_empty(),
                    "seed {}: {zone:?} {} placed nothing",
                    c.seed,
                    rule.name
                );
                assert!(
                    members.len() <= (rule.sites * rule.members) as usize,
                    "seed {}: {}",
                    c.seed,
                    rule.name
                );
                for p in &members {
                    let near = mine.iter().any(|s| {
                        dist(
                            (f64::from(p.x), f64::from(p.y)),
                            (f64::from(s.x), f64::from(s.y)),
                        ) <= rule.radius * TILE + 1e-6
                    });
                    assert!(
                        near,
                        "seed {}: {} member {p:?} is outside every site's radius",
                        c.seed, rule.name
                    );
                }
                // Clearing share of the zone's free floor.
                let (mut free, mut open) = (0usize, 0usize);
                for ty in 0..c.map.h as usize {
                    for tx in 0..c.map.w as usize {
                        let i = idx(&c.map, tx, ty);
                        if zone_at(&c.map, i) != Some(zone) || c.map.tiles[i] != 0 || clear[i] {
                            continue;
                        }
                        free += 1;
                        let tc = centre(tx, ty);
                        let covered = mine.iter().any(|s| {
                            dist(tc, (f64::from(s.x), f64::from(s.y))) <= rule.radius * TILE
                        });
                        if !covered {
                            open += 1;
                        }
                    }
                }
                assert!(free > 0, "seed {}: {zone:?} has free floor", c.seed);
                let share = open as f64 / free as f64;
                assert!(
                    share >= rule.clearing,
                    "seed {}: {} clearing share {share:.3} < {}",
                    c.seed,
                    rule.name,
                    rule.clearing
                );
            }
        }
    }
}

// ---- stage 5: edges, stage 6: filler ------------------------------------------------------------------------------

fn is_against(map: &GameMapData, tx: i64, ty: i64, against: &[Against]) -> bool {
    if tx < 0 || ty < 0 || tx >= i64::from(map.w) || ty >= i64::from(map.h) {
        return false;
    }
    let i = idx(map, tx as usize, ty as usize);
    against.iter().any(|a| match a {
        Against::Wall => map.tiles[i] == 1,
        Against::Low => map.tiles[i] == 2,
        Against::Border => [(1, 0), (-1, 0), (0, 1), (0, -1)].iter().any(|(dx, dy)| {
            let (nx, ny) = (tx + dx, ty + dy);
            nx >= 0
                && ny >= 0
                && nx < i64::from(map.w)
                && ny < i64::from(map.h)
                && map.region_grid[idx(map, nx as usize, ny as usize)] != map.region_grid[i]
        }),
    })
}

#[test]
fn edge_props_stand_within_their_distance_of_what_they_hug() {
    for c in cases() {
        let d = dress(&c.map, c.hash, rules());
        for zone in ZONES {
            for rule in &rules().zone(zone).unwrap().edges {
                let mine: Vec<_> = placed(&d)
                    .into_iter()
                    .filter(|p| rule.kinds.contains(&p.kind))
                    .collect();
                assert!(
                    !mine.is_empty(),
                    "seed {}: {} placed nothing",
                    c.seed,
                    rule.name
                );
                for p in mine {
                    let (tx, ty) = tile_of(p.x, p.y);
                    let dd = i64::from(rule.distance);
                    let hugs = (-dd..=dd).any(|dy| {
                        (-dd..=dd).any(|dx| {
                            is_against(&c.map, tx as i64 + dx, ty as i64 + dy, &rule.against)
                        })
                    });
                    assert!(
                        hugs,
                        "seed {}: {} prop {p:?} is not within {dd} of {:?}",
                        c.seed, rule.name, rule.against
                    );
                }
            }
        }
    }
}

#[test]
fn filler_is_sparse_and_flat() {
    for c in cases() {
        let d = dress(&c.map, c.hash, rules());
        for zone in ZONES {
            let floor = (0..c.map.tiles.len())
                .filter(|&i| zone_at(&c.map, i) == Some(zone) && c.map.tiles[i] == 0)
                .count();
            for rule in &rules().zone(zone).unwrap().fillers {
                let n = placed(&d)
                    .iter()
                    .filter(|p| rule.kinds.contains(&p.kind))
                    .count();
                assert!(n > 0, "seed {}: {} placed nothing", c.seed, rule.name);
                let ceiling = (2.0 * rule.density / 100.0 * floor as f64) as usize + 10;
                assert!(
                    n <= ceiling,
                    "seed {}: {} placed {n} on {floor} floor tiles (ceiling {ceiling})",
                    c.seed,
                    rule.name
                );
                assert!(
                    rule.kinds.iter().all(|k| !rules().is_tall(*k)),
                    "{} uses a tall kind",
                    rule.name
                );
            }
        }
    }
}

#[test]
fn walls_low_and_hazard_tiles_stay_bare_unless_a_rule_names_them() {
    // The starter rules name only floor, ice and nothing else, so no prop stands on wall, low, ember, bog or light.
    for c in cases() {
        let d = dress(&c.map, c.hash, rules());
        assert!(
            !placed(&d).is_empty(),
            "seed {}: nothing was placed",
            c.seed
        );
        for p in placed(&d) {
            let (tx, ty) = tile_of(p.x, p.y);
            let class = class_of(&c.map, idx(&c.map, tx, ty));
            assert!(
                matches!(class, TileClass::Floor | TileClass::Ice),
                "seed {}: {p:?} on {class:?}",
                c.seed
            );
        }
    }
}
