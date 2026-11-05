use super::*;
use serde::Deserialize;
fn raw(seed: i64) -> MapExport {
    serde_json::from_str(match seed {
        1 => include_str!("fixtures/seed1.map.json"),
        2 => include_str!("fixtures/seed2.map.json"),
        _ => panic!("unknown fixture seed"),
    })
    .unwrap()
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Oracle {
    format: String,
    node: String,
    platform: String,
    arch: String,
    maps: Vec<MapOracle>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MapOracle {
    seed: i64,
    attempt: u64,
    legacy_map_hash_u32: u32,
    region_query: Vec<u8>,
    bush_query: Vec<u16>,
    edge_queries: Vec<EdgeQuery>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EdgeQuery {
    x: f64,
    y: f64,
    region: u8,
    bush: u16,
}
#[test]
fn both_actual_generated_maps_validate_and_roundtrip_every_field() {
    for seed in [1, 2] {
        let original = raw(seed);
        let before = serde_json::to_value(&original).unwrap();
        let admitted = original.validate().unwrap();
        assert_eq!(admitted.layers().dimensions(), (160, 160));
        assert_eq!(admitted.layers().data().seed, seed);
        assert_eq!(admitted.layers().data().camps.len(), 50);
        assert!(!admitted.layers().data().features.is_empty());
        assert!(admitted
            .layers()
            .data()
            .features
            .iter()
            .any(|f| f.kind == FeatureKind::Bush));
        assert!(admitted.layers().data().props.is_empty());
        let layers_json = serde_json::to_string(admitted.layers()).unwrap();
        let layers: MapLayers = serde_json::from_str(&layers_json).unwrap();
        assert_eq!(&layers, admitted.layers());
        layers.validate_for_tiles(admitted.tiles()).unwrap();
        assert_eq!(
            serde_json::to_value(layers.to_export(admitted.tiles()).unwrap()).unwrap(),
            before
        );
        assert_eq!(
            serde_json::to_value(admitted.into_export()).unwrap(),
            before
        );
    }
}
#[test]
fn bush_and_region_queries_match_real_legacy_for_every_tile_and_edge_samples() {
    let o: Oracle = serde_json::from_str(include_str!("fixtures/oracle.json")).unwrap();
    assert_eq!(o.format, "rh-map-data-oracle/1");
    assert_eq!(
        (o.node.as_str(), o.platform.as_str(), o.arch.as_str()),
        ("v22.23.4", "linux", "x64")
    );
    assert_eq!(o.maps.len(), 2);
    for m in o.maps {
        let admitted = raw(m.seed).validate().unwrap();
        let layers = admitted.layers();
        assert_eq!(layers.legacy_map_hash_u32(), m.legacy_map_hash_u32);
        assert_eq!(layers.data().attempt, m.attempt);
        let (w, h) = layers.dimensions();
        assert_eq!(m.region_query.len(), (w * h) as usize);
        assert_eq!(m.bush_query.len(), (w * h) as usize);
        for i in 0..(w * h) as usize {
            let (x, y) = (
                (i % w as usize) as f64 * 32.0 + 16.0,
                (i / w as usize) as f64 * 32.0 + 16.0,
            );
            assert_eq!(
                layers.region_at_world(x, y).code(),
                m.region_query[i],
                "seed {} tile {i}",
                m.seed
            );
            assert_eq!(layers.is_coliseum_at_world(x, y), m.region_query[i] == 6);
            assert_eq!(
                layers.bush_at_world(x, y),
                m.bush_query[i],
                "seed {} tile {i}",
                m.seed
            );
        }
        for q in m.edge_queries {
            assert_eq!(layers.region_at_world(q.x, q.y).code(), q.region);
            assert_eq!(layers.bush_at_world(q.x, q.y), q.bush);
        }
        for v in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(layers.region_at_world(v, 0.0), RegionId::None);
            assert_eq!(layers.region_at_world(0.0, v), RegionId::None);
            assert_eq!(layers.bush_at_world(v, 0.0), 0);
        }
        // Chamfered footprint's bounding-box corners are not arena membership.
        let r = layers.coliseum().rect;
        assert!(!layers
            .is_coliseum_at_world(f64::from(r.x) * 32.0 + 16.0, f64::from(r.y) * 32.0 + 16.0));
    }
}
fn reject(label: &str, change: impl FnOnce(&mut MapExport)) {
    let mut document = raw(1);
    change(&mut document);
    assert!(document.validate().is_err(), "admitted malformed {label}");
}
#[test]
fn admission_rejects_shape_domain_and_reference_corruption() {
    reject("format", |m| m.format = "rh-map/3".into());
    reject("equal-area transposed dimensions", |m| {
        m.map.w = 40;
        m.map.h = 640;
    });
    reject("zero width", |m| m.map.w = 0);
    reject("overflow dimensions", |m| {
        m.map.w = u32::MAX;
        m.map.h = u32::MAX;
    });
    reject("short tiles", |m| {
        m.map.tiles.pop();
    });
    reject("short terrain", |m| {
        m.map.terrain.pop();
    });
    reject("short regionGrid", |m| {
        m.map.region_grid.pop();
    });
    reject("short territoryGrid", |m| {
        m.map.territory_grid.pop();
    });
    reject("short featureGrid", |m| {
        m.map.feature_grid.pop();
    });
    reject("collision domain", |m| m.map.tiles[0] = 4);
    reject("terrain domain", |m| m.map.terrain[0] = 8);
    reject("region domain", |m| m.map.region_grid[0] = 7);
    reject("camp reference", |m| m.map.territory_grid[0] = 255);
    reject("feature reference", |m| m.map.feature_grid[0] = 255);
    reject("terrain class mismatch", |m| m.map.terrain[0] = 4);
    reject("duplicate camp ID", |m| {
        m.map.camps[1].id = m.map.camps[0].id.clone()
    });
    reject("camp elite spot reference", |m| {
        m.map.camps[0].elite_spot = 100
    });
    reject("nonfinite camp radius", |m| {
        m.map.camps[0].radius = f64::INFINITY
    });
    reject("nonfinite coordinate", |m| m.map.camps[0].x = f64::NAN);
    reject("negative radius", |m| m.map.camps[0].r = -1.0);
    reject("out-of-map spawn", |m| m.map.spawn_pool[0].x = 5120.0);
    reject("fractional gameplay centre", |m| {
        m.map.ground_spots[0].x += 0.25
    });
    reject("territory floor area", |m| m.map.camps[0].area += 1);
    reject("region area", |m| m.map.regions[0].area += 1);
    reject("region order", |m| m.map.regions.swap(0, 1));
    reject("mob camp view", |m| {
        m.map.regions[0].mob_camps[0].elite = !m.map.regions[0].mob_camps[0].elite
    });
    reject("crate view", |m| {
        m.map.crate_spots.pop();
    });
    reject("spawn ordering", |m| m.map.spawns.swap(0, 1));
    reject("spawn view", |m| {
        m.map.spawns.pop();
    });
    reject("coliseum centre region", |m| {
        m.map.coliseum.centre = m.map.camps[0].chest
    });
    reject("coliseum rect overflow", |m| {
        m.map.coliseum.rect.w = u32::MAX
    });
    reject("gate order", |m| m.map.coliseum.gates.swap(0, 1));
    reject("gate mean coordinate", |m| m.map.coliseum.gates[0].x += 1.0);
    reject("gate tile reference", |m| {
        m.map.coliseum.gates[0].tiles[0].x = -1
    });
    reject("duplicate inner spawn", |m| {
        m.map.coliseum.inner_spawns[1] = m.map.coliseum.inner_spawns[0]
    });
    reject("feature ownership count", |m| m.map.features[0].tiles += 1);
    reject("feature bbox", |m| m.map.features[0].bbox.x = -1);
    reject("building landmark reference", |m| m.map.buildings[0].x += 1);
    reject("feature anchor", |m| m.map.features[0].ax = 160);
    reject("landmark payload", |m| m.map.features[0].p[0] = 4);
    reject("landmark door reference", |m| {
        m.map.features[0].p[2] = 25600
    });
    reject("bush camp reference", |m| {
        let f = m
            .map
            .features
            .iter_mut()
            .find(|f| f.kind == FeatureKind::Bush)
            .unwrap();
        f.p[0] = 1000;
    });
    reject("bush nonelite camp", |m| {
        let f = m
            .map
            .features
            .iter_mut()
            .find(|f| f.kind == FeatureKind::Bush)
            .unwrap();
        f.p[0] = 0;
    });
    reject("feature variant", |m| {
        m.map.features[0].variant = "futureLandmark".into()
    });
    reject("empty jobs", |m| m.map.features[0].jobs.clear());
    reject("nonfinite cosmetic", |m| {
        m.map.props.push(MapProp {
            kind: 0,
            x: f64::INFINITY,
            y: 16.0,
            v: 0,
        })
    });
    reject("cosmetic domain", |m| {
        m.map.props.push(MapProp {
            kind: 999,
            x: 16.0,
            y: 16.0,
            v: 0,
        })
    });
}
#[test]
fn unknown_fields_and_noninteger_payloads_are_not_silently_dropped() {
    let original = serde_json::to_value(raw(1)).unwrap();
    for pointer in [
        "",
        "/map",
        "/map/camps/0",
        "/map/camps/0/chest",
        "/map/coliseum",
        "/map/coliseum/rect",
        "/map/coliseum/gates/0",
        "/map/coliseum/gates/0/tiles/0",
        "/map/regions/0",
        "/map/regions/0/mobCamps/0",
        "/map/spawnPool/0",
        "/map/buildings/0",
        "/map/features/0",
        "/map/features/0/bbox",
    ] {
        let mut v = original.clone();
        v.pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unknownFutureField".into(), serde_json::json!(1));
        assert!(
            serde_json::from_value::<MapExport>(v).is_err(),
            "ignored unknown field at {pointer}"
        );
    }
    for (pointer, value) in [
        ("/map/features/0/p/0", serde_json::json!(0.5)),
        ("/map/features/0/kind", serde_json::json!("futureKind")),
        ("/map/camps/0/zone", serde_json::json!("futureZone")),
        ("/map/seed", serde_json::json!(0.5)),
        ("/map/terrain/0", serde_json::json!(256)),
    ] {
        let mut v = original.clone();
        *v.pointer_mut(pointer).unwrap() = value;
        assert!(
            serde_json::from_value::<MapExport>(v).is_err(),
            "accepted invalid type at {pointer}"
        );
    }
}
#[test]
fn deserialized_layers_revalidate_and_cannot_be_attached_to_incompatible_tiles() {
    let admitted = raw(1).validate().unwrap();
    let original = serde_json::to_value(admitted.layers()).unwrap();
    let mut invalid = original.clone();
    invalid["data"]["featureGrid"][0] = serde_json::json!(255);
    assert!(serde_json::from_value::<MapLayers>(invalid).is_err());
    let mut unknown = original;
    unknown["ignored"] = serde_json::json!(0);
    assert!(serde_json::from_value::<MapLayers>(unknown).is_err());
    let mut tiles = admitted.tiles().to_vec();
    let p = admitted.layers().coliseum().centre;
    let i = (p.y / 32.0).floor() as usize * 160 + (p.x / 32.0).floor() as usize;
    tiles[i] = 1;
    assert!(admitted.layers().validate_for_tiles(&tiles).is_err());
    assert!(admitted
        .layers()
        .validate_for_tiles(&tiles[..tiles.len() - 1])
        .is_err());
}

#[test]
fn actual_producer_signed_and_large_integer_metadata_roundtrips_losslessly() {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct DomainMaps {
        maps: Vec<MapExport>,
    }
    let captured: DomainMaps =
        serde_json::from_str(include_str!("fixtures/domain-maps.json")).unwrap();
    assert_eq!(captured.maps.len(), 3);
    for (map, expected) in
        captured
            .maps
            .into_iter()
            .zip([(-1, 0), (4294967297, 0), (1, 4294967296)])
    {
        assert_eq!((map.map.seed, map.map.attempt), expected);
        let before = serde_json::to_value(&map).unwrap();
        let admitted = map.validate().unwrap();
        assert_eq!(
            serde_json::to_value(admitted.into_export()).unwrap(),
            before
        );
    }
    // Encoding-domain checks are independent of the captured, unverified legacy hash.
    for seed in [-9_007_199_254_740_991, 9_007_199_254_740_991] {
        let mut document = raw(1);
        document.map.seed = seed;
        document.validate().unwrap();
    }
    for seed in [
        i64::MIN,
        -9_007_199_254_740_992,
        9_007_199_254_740_992,
        i64::MAX,
    ] {
        reject("unsafe JS seed integer", |m| m.map.seed = seed);
    }
    reject("unsafe JS attempt integer", |m| {
        m.map.attempt = 9_007_199_254_740_992
    });
    reject("overflow JS attempt integer", |m| m.map.attempt = u64::MAX);
    let mut document = raw(1);
    document.map.attempt = 9_007_199_254_740_991;
    document.validate().unwrap();
}

#[test]
fn canonical_admission_rejects_open_border_fake_gate_and_mislinked_features() {
    reject("open outside border", |m| m.map.tiles[0] = 0);
    reject("owned border wall", |m| m.map.region_grid[0] = 1);
    reject("interior tile substituted for north gate", |m| {
        let point = m.map.coliseum.inner_spawns[0];
        let gate = &mut m.map.coliseum.gates[0];
        gate.tiles = vec![TilePt {
            x: (point.x / crate::constants::TILE).floor() as i32,
            y: (point.y / crate::constants::TILE).floor() as i32,
        }];
        gate.x = point.x;
        gate.y = point.y;
    });
    reject("noncontiguous gate", |m| {
        let gate = &mut m.map.coliseum.gates[0];
        gate.tiles[2].x += 3;
        gate.x = gate
            .tiles
            .iter()
            .map(|p| f64::from(p.x) * 32.0 + 16.0)
            .sum::<f64>()
            / gate.tiles.len() as f64;
    });
    reject("crater points at wrong same-zone camp", |m| {
        let f = m
            .map
            .features
            .iter_mut()
            .find(|f| f.kind == FeatureKind::Crater)
            .unwrap();
        f.p[0] = m
            .map
            .camps
            .iter()
            .enumerate()
            .find(|(i, c)| c.zone == f.zone && *i != f.p[0] as usize)
            .unwrap()
            .0 as i32;
    });
    reject("bush points at wrong same-zone elite", |m| {
        let f = m
            .map
            .features
            .iter_mut()
            .find(|f| f.kind == FeatureKind::Bush)
            .unwrap();
        f.p[0] = m
            .map
            .camps
            .iter()
            .enumerate()
            .find(|(i, c)| c.zone == f.zone && c.elite_spot >= 0 && *i != f.p[0] as usize)
            .unwrap()
            .0 as i32;
    });
    reject("bush on nonplain terrain", |m| {
        let fi = m
            .map
            .features
            .iter()
            .position(|f| f.kind == FeatureKind::Bush)
            .unwrap();
        let i = m
            .map
            .feature_grid
            .iter()
            .position(|&id| id as usize == fi + 1)
            .unwrap();
        m.map.terrain[i] = 4;
    });
    reject("bush on wall with adjusted territory area", |m| {
        let fi = m
            .map
            .features
            .iter()
            .position(|f| f.kind == FeatureKind::Bush)
            .unwrap();
        let i = m
            .map
            .feature_grid
            .iter()
            .position(|&id| id as usize == fi + 1)
            .unwrap();
        m.map.tiles[i] = 1;
        let camp = m.map.territory_grid[i] as usize - 1;
        m.map.camps[camp].area -= 1;
    });
}
