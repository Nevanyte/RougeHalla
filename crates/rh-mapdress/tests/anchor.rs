//! P-DRESS-ANCHOR-1: on a map made with `pipeline::Options::signature`, each zone's rings follow the generator's landmark
//! (`GameMapData.anchors`) in the generator's bands (`signature::band`, measured from the anchor's footprint rectangle).
//! A zone with no anchor, and every map made without the option, is dressed exactly as before. Tests marked GUARD pass
//! before the change and must keep passing.
mod common;
use common::*;
use rh_mapdress::{dress, tall_corridor, Dressing, FLAG_TALL};
use rh_sim::mapdata::{GameMapData, Zone, ZoneAnchor};
use rh_sim::mapgen::landmarks::signature::band;
use rh_sim::mapgen::{coliseum, map_hash, pipeline};
use std::sync::OnceLock;

/// Seeds 1..=8 with `signature` on (about 0.5 s each in a debug build, 4-5 s per test binary).
fn sig_cases() -> &'static Vec<Case> {
    static CASES: OnceLock<Vec<Case>> = OnceLock::new();
    CASES.get_or_init(|| {
        let fixed = coliseum::fixed_layout();
        let generator = pipeline::Pipeline::new(&fixed);
        let options = pipeline::Options {
            signature: true,
            ..pipeline::Options::default()
        };
        (1..=8i64)
            .map(|seed| {
                let map = generator
                    .certified_styled(seed, options)
                    .expect("generator runs")
                    .unwrap_or_else(|| panic!("signature seed {seed} certifies"));
                let hash = u64::from_str_radix(&map_hash::map_hash(&map), 16).expect("hex hash");
                Case { seed, map, hash }
            })
            .collect()
    })
}

fn anchor_of(map: &GameMapData, zone: Zone) -> &ZoneAnchor {
    map.anchors
        .iter()
        .find(|a| a.zone == zone)
        .unwrap_or_else(|| panic!("the signature map has an anchor for {zone:?}"))
}

fn landmark(zone: Zone) -> &'static rh_mapdress::rules::LandmarkRules {
    rules()
        .zone(zone)
        .and_then(|z| z.landmark.as_ref())
        .unwrap_or_else(|| panic!("{zone:?}: rules/zones.json has no signature.landmark block"))
}

fn tile_band(a: &ZoneAnchor, tx: usize, ty: usize) -> rh_mapdress::rules::Band {
    band(a, tx as i32, ty as i32)
}

#[test]
fn the_generator_gives_every_zone_an_anchor_of_the_kind_the_rules_name() {
    for c in sig_cases() {
        assert_eq!(c.map.anchors.len(), 5, "seed {}", c.seed);
        for zone in ZONES {
            assert_eq!(
                anchor_of(&c.map, zone).kind,
                landmark(zone).feature,
                "seed {}: {zone:?}",
                c.seed
            );
        }
    }
}

#[test]
fn every_ring_prop_stands_in_the_band_its_ring_declares_inside_its_own_zone() {
    for c in sig_cases() {
        let d = dress(&c.map, c.hash, rules());
        let props = placed(&d);
        for zone in ZONES {
            let a = anchor_of(&c.map, zone);
            for ring in &landmark(zone).rings {
                let kinds: Vec<u8> = ring.props.iter().map(|p| p.kind).collect();
                for p in props.iter().filter(|p| kinds.contains(&p.kind)) {
                    let (tx, ty) = tile_of(p.x, p.y);
                    assert_eq!(
                        zone_at(&c.map, idx(&c.map, tx, ty)),
                        Some(zone),
                        "seed {}: ring {} prop {p:?} lies outside {zone:?}",
                        c.seed,
                        ring.name
                    );
                    assert_eq!(
                        tile_band(a, tx, ty),
                        ring.band,
                        "seed {}: ring {} prop {p:?} at tile ({tx},{ty})",
                        c.seed,
                        ring.name
                    );
                }
            }
        }
    }
}

#[test]
fn the_ground_plane_follows_the_band_of_each_floor_tile() {
    for c in sig_cases() {
        let d = dress(&c.map, c.hash, rules());
        for ty in 0..c.map.h as usize {
            for tx in 0..c.map.w as usize {
                let i = idx(&c.map, tx, ty);
                // P-DRESS-MARSH-1: a Plague tile in a marsh ring shows the water or mud variant instead of its
                // band's (ids 7 and 8; `marsh.rs` pins where, and that the band variant shows everywhere else).
                if zone_at(&c.map, i) == Some(Zone::Plague)
                    && [7, 8].contains(&d.ground_variants[i])
                {
                    continue;
                }
                let expect = match zone_at(&c.map, i) {
                    Some(zone) if c.map.tiles[i] == 0 => {
                        let b = tile_band(anchor_of(&c.map, zone), tx, ty);
                        landmark(zone)
                            .rings
                            .iter()
                            .find(|r| r.band == b)
                            .map_or(0, |r| r.ground_variant)
                    }
                    _ => 0,
                };
                assert_eq!(
                    d.ground_variants[i], expect,
                    "seed {}: ground variant of tile ({tx},{ty})",
                    c.seed
                );
            }
        }
    }
}

#[test]
fn each_zone_has_ring_props_in_its_near_and_mid_bands_on_every_seed() {
    use rh_mapdress::rules::Band;
    for c in sig_cases() {
        let d = dress(&c.map, c.hash, rules());
        let props = placed(&d);
        for zone in ZONES {
            let a = anchor_of(&c.map, zone);
            let lm = landmark(zone);
            let kinds: Vec<u8> = lm
                .rings
                .iter()
                .flat_map(|r| r.props.iter().map(|p| p.kind))
                .collect();
            for wanted in [Band::Near, Band::Mid] {
                let n = props
                    .iter()
                    .filter(|p| kinds.contains(&p.kind))
                    .filter(|p| {
                        let (tx, ty) = tile_of(p.x, p.y);
                        tile_band(a, tx, ty) == wanted
                    })
                    .count();
                assert!(
                    n > 0,
                    "seed {}: {zone:?} has no {wanted:?} ring props",
                    c.seed
                );
            }
        }
    }
}

/// Every stage, not only the rings: the core band (the landmark and its apron) is kept free of tall props.
#[test]
fn no_tall_prop_of_any_stage_stands_in_the_core_band() {
    use rh_mapdress::rules::Band;
    for c in sig_cases() {
        let d = dress(&c.map, c.hash, rules());
        // Without a landmark block the check below would pass with nothing to anchor on; insist on the anchors.
        for zone in ZONES {
            let _ = landmark(zone);
        }
        for p in placed(&d).iter().filter(|p| p.flags & FLAG_TALL != 0) {
            let (tx, ty) = tile_of(p.x, p.y);
            let Some(zone) = zone_at(&c.map, idx(&c.map, tx, ty)) else {
                continue;
            };
            assert_ne!(
                tile_band(anchor_of(&c.map, zone), tx, ty),
                Band::Core,
                "seed {}: tall prop {p:?} in the core band of {zone:?}",
                c.seed
            );
        }
    }
}

/// GUARD: keep-clear outranks theme (G5) on signature maps too.
#[test]
fn keep_clear_and_the_tall_corridor_still_hold_on_signature_maps() {
    for c in sig_cases() {
        let d = dress(&c.map, c.hash, rules());
        let clear = required_clear(&c.map, rules());
        let corridor = tall_corridor(&c.map, rules());
        for p in placed(&d) {
            let (tx, ty) = tile_of(p.x, p.y);
            let i = idx(&c.map, tx, ty);
            assert!(!clear[i], "seed {}: prop {p:?} in keep-clear", c.seed);
            assert!(
                !(p.flags & FLAG_TALL != 0 && corridor[i]),
                "seed {}: tall prop {p:?} in a corridor",
                c.seed
            );
        }
        assert!(d.props.len() <= rh_mapdress::MAX_PROPS);
        assert_eq!(d.ground_variants.len(), c.map.w as usize * c.map.h as usize);
    }
}

/// GUARD: same map, hash and rules give the same bytes; another hash gives other bytes.
#[test]
fn signature_map_reruns_are_byte_identical() {
    for c in sig_cases() {
        let a = dress(&c.map, c.hash, rules());
        let b = dress(&c.map, c.hash, rules());
        assert_eq!(bytes(&a), bytes(&b), "seed {}", c.seed);
        let other = dress(&c.map, c.hash ^ 0x9e37_79b9, rules());
        assert_ne!(bytes(&a), bytes(&other), "seed {}", c.seed);
    }
}

/// The switch between the two paths is `GameMapData.anchors`, zone by zone: a zone without an anchor keeps the old
/// rings (`signature.feature`, `rings`), the others use the landmark path.
#[test]
fn a_zone_without_an_anchor_is_dressed_by_the_fallback_rings_alone() {
    let c = &sig_cases()[0];
    let full = dress(&c.map, c.hash, rules());
    let mut bare = c.map.clone();
    bare.anchors.clear();
    let legacy = dress(&bare, c.hash, rules());
    let mut no_holy = c.map.clone();
    no_holy.anchors.retain(|a| a.zone != Zone::Holy);
    let part = dress(&no_holy, c.hash, rules());

    let mut holy_changed = false;
    for i in 0..full.ground_variants.len() {
        match zone_at(&c.map, i) {
            Some(Zone::Holy) => {
                assert_eq!(
                    part.ground_variants[i], legacy.ground_variants[i],
                    "Holy tile {i}"
                );
                holy_changed |= full.ground_variants[i] != legacy.ground_variants[i];
            }
            Some(Zone::Fire) => {
                assert_eq!(
                    part.ground_variants[i], full.ground_variants[i],
                    "Fire tile {i}"
                );
            }
            _ => {}
        }
    }
    assert!(
        holy_changed,
        "the landmark path leaves Holy's ground as the fallback has it"
    );
    let holy_kinds: Vec<u8> = rules()
        .zone(Zone::Holy)
        .unwrap()
        .rings
        .iter()
        .flat_map(|r| r.props.iter().map(|p| p.kind))
        .collect();
    let fallback_rows = |d: &Dressing| -> Vec<_> {
        placed(d)
            .into_iter()
            .filter(|p| holy_kinds.contains(&p.kind))
            .collect()
    };
    assert!(!fallback_rows(&legacy).is_empty());
    assert_eq!(fallback_rows(&part), fallback_rows(&legacy));
    assert!(
        fallback_rows(&full).is_empty(),
        "with a Holy anchor the fallback rings place nothing"
    );
}

// ---- option off: today's dressing, byte for byte -------------------------------------------------------------------

/// FNV-1a 64 over the wire-shaped bytes of the dressing (props then ground plane).
fn fnv(d: &Dressing) -> u64 {
    let mut h = 0xcbf2_9ce4_8422_2325u64;
    for b in bytes(d) {
        h = (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// This packet's own golden values: the hash of `dress(map, map_hash, rules)` with the pre-packet `rules/zones.json`,
/// measured on the tree before the change (default options, seeds 1..=8). Not captured from legacy.
const OFF_GOLDEN: [u64; 8] = [
    0xad5c_1959_a782_d4da,
    0x490c_de1d_d67d_bb23,
    0x672c_b1eb_0d51_9aed,
    0x1aa4_aed5_1769_8641,
    0x02da_0bdf_d844_2d14,
    0x3b3e_1058_6c37_c2c7,
    0x6c94_dc6c_3c86_f481,
    0xf91e_e615_4dac_4426,
];
/// The same for signature maps (seeds 1..=4) once their anchors are removed: the fallback path on those maps.
const NO_ANCHOR_GOLDEN: [u64; 4] = [
    0x5086_6ec6_79aa_a2b5,
    0xace1_f5b9_69de_8b6a,
    0x138c_ea40_6f06_f3f2,
    0x4f81_cc79_d5eb_1506,
];

/// The shipped file without any `terrainRings` list (P-DRESS-MARSH-1): the marsh rings change Plague's ground, so the
/// pre-marsh golden values below are checked against the shipped file in this form.
fn shipped_without_marsh() -> rh_mapdress::Rules {
    let mut v: serde_json::Value =
        serde_json::from_str(include_str!("../rules/zones.json")).expect("shipped file is JSON");
    for z in v["zones"].as_object_mut().expect("zones").values_mut() {
        z.as_object_mut().expect("zone").remove("terrainRings");
    }
    rh_mapdress::Rules::from_json(&v.to_string())
        .expect("the shipped file minus terrainRings parses")
}

fn legacy_rules() -> rh_mapdress::Rules {
    rh_mapdress::Rules::from_json(include_str!("fixtures/zones_v1_legacy.json"))
        .expect("the pre-packet file parses")
}

/// GUARD
#[test]
fn with_the_option_off_the_dressing_is_todays_byte_for_byte() {
    let old = legacy_rules();
    let shipped = shipped_without_marsh();
    for (c, golden) in cases().iter().zip(OFF_GOLDEN) {
        assert!(c.map.anchors.is_empty(), "seed {}: option off", c.seed);
        assert_eq!(
            fnv(&dress(&c.map, c.hash, &old)),
            golden,
            "seed {} (old file)",
            c.seed
        );
        assert_eq!(
            fnv(&dress(&c.map, c.hash, &shipped)),
            golden,
            "seed {} (shipped file, no terrainRings)",
            c.seed
        );
    }
}

/// GUARD
#[test]
fn a_signature_map_stripped_of_its_anchors_is_dressed_as_today() {
    let old = legacy_rules();
    let shipped = shipped_without_marsh();
    for (c, golden) in sig_cases().iter().zip(NO_ANCHOR_GOLDEN) {
        let mut map = c.map.clone();
        map.anchors.clear();
        assert_eq!(
            fnv(&dress(&map, c.hash, &old)),
            golden,
            "seed {} (old file)",
            c.seed
        );
        assert_eq!(
            fnv(&dress(&map, c.hash, &shipped)),
            golden,
            "seed {} (shipped file, no terrainRings)",
            c.seed
        );
    }
}
