//! P-DRESS-SENTENCED-RINGS-1: the Sentenced landmark's decoration rings are measured from the church BUILDING, not from
//! the whole 29 x 29 churchyard (the anchor's footprint). A landmark block may name a ring `origin`
//! (`{ "feature": <kind>, "inside": <band>, "outside": <band> }`); without it the anchor's footprint is the origin, so
//! every other zone is dressed as before. Tests marked GUARD pass on the stub and must keep passing.
//!
//! The rule the tests restate independently of the crate (`effective_band`): the origin box is the bounding box of the
//! zone's largest map feature of kind `origin.feature` (first on a tie); `b` is the generator's `signature::band` of the
//! tile from that box. A tile strictly inside the anchor's footprint (footprint inset by one tile, so its edge ring, the
//! fence line and its gates, is NOT inside) takes `b` when `b` is core or `inside` is absent, else `inside`; any other
//! tile takes the farther of `b` and `outside` (`b` when `outside` is absent). With no feature of that kind in the zone
//! the whole origin is ignored and the zone is dressed from the anchor's footprint.
mod common;
use common::*;
use rh_mapdress::rules::{Band, RingOrigin, Rules};
use rh_mapdress::{dress, Dressing};
use rh_sim::mapdata::{FeatureKind, GameMapData, TileRect, Zone, ZoneAnchor};
use rh_sim::mapgen::landmarks::signature::band;
use rh_sim::mapgen::{coliseum, map_hash, pipeline};
use serde_json::{json, Value};
use std::sync::OnceLock;

const STARTER: &str = include_str!("../rules/zones.json");

/// Seeds 1..=8 with `signature` on (the blueprint church stands in each).
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

fn starter_json() -> Value {
    serde_json::from_str(STARTER).unwrap()
}

fn rules_from(v: &Value) -> Rules {
    Rules::from_json(&v.to_string()).expect("the rule file parses")
}

fn refused(v: &Value) -> String {
    match Rules::from_json(&v.to_string()) {
        Ok(_) => panic!("a malformed rule file was accepted"),
        Err(e) => e,
    }
}

/// The shipped file with `zone`'s landmark `origin` set to `origin` (removed when `Value::Null`).
fn with_origin(zone: &str, origin: Value) -> Value {
    let mut v = starter_json();
    let lm = &mut v["zones"][zone]["signature"]["landmark"];
    if origin.is_null() {
        lm.as_object_mut().unwrap().remove("origin");
    } else {
        lm["origin"] = origin;
    }
    v
}

/// The shipped file as it is without the new field in any zone.
fn shipped_without_origin() -> &'static Rules {
    static R: OnceLock<Rules> = OnceLock::new();
    R.get_or_init(|| rules_from(&with_origin("sentenced", Value::Null)))
}

fn fnv(d: &Dressing) -> u64 {
    let mut h = 0xcbf2_9ce4_8422_2325u64;
    for b in bytes(d) {
        h = (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

fn anchor_of(map: &GameMapData, zone: Zone) -> &ZoneAnchor {
    map.anchors
        .iter()
        .find(|a| a.zone == zone)
        .unwrap_or_else(|| panic!("the signature map has an anchor for {zone:?}"))
}

/// Bounding box of the zone's largest feature of `kind` (first on a tie).
fn feature_box(map: &GameMapData, zone: Zone, kind: FeatureKind) -> Option<TileRect> {
    let mut best: Option<&rh_sim::mapdata::MapFeature> = None;
    for f in &map.features {
        if f.kind == kind && f.zone == zone && best.is_none_or(|b| f.tiles > b.tiles) {
            best = Some(f);
        }
    }
    best.map(|f| f.bbox)
}

/// Strictly inside the footprint: the footprint inset by one tile.
fn interior(f: TileRect, tx: usize, ty: usize) -> bool {
    let (x, y) = (tx as i32, ty as i32);
    x > f.x && y > f.y && x < f.x + f.w as i32 - 1 && y < f.y + f.h as i32 - 1
}

fn cheb(r: TileRect, tx: usize, ty: usize) -> i32 {
    let (x, y) = (tx as i32, ty as i32);
    (r.x - x)
        .max(x - (r.x + r.w as i32 - 1))
        .max(r.y - y)
        .max(y - (r.y + r.h as i32 - 1))
        .max(0)
}

/// The band a tile of `zone` is dressed by, restated from the header.
fn effective_band(
    map: &GameMapData,
    zone: Zone,
    origin: Option<&RingOrigin>,
    tx: usize,
    ty: usize,
) -> Band {
    let a = anchor_of(map, zone);
    let from_anchor = band(a, tx as i32, ty as i32);
    let Some(o) = origin else { return from_anchor };
    let Some(rect) = feature_box(map, zone, o.feature) else {
        return from_anchor;
    };
    let mut moved = a.clone();
    moved.footprint = rect;
    let b = band(&moved, tx as i32, ty as i32);
    if interior(a.footprint, tx, ty) {
        match o.inside {
            Some(inside) if b != Band::Core => inside,
            _ => b,
        }
    } else {
        o.outside.map_or(b, |out| b.max(out))
    }
}

fn kind_codes(rules: &Rules, names: &[&str]) -> Vec<u8> {
    names
        .iter()
        .map(|n| rules.kind_code(n).unwrap_or_else(|| panic!("kind {n}")))
        .collect()
}

fn sentenced_origin() -> &'static RingOrigin {
    rules()
        .zone(Zone::Sentenced)
        .and_then(|z| z.landmark.as_ref())
        .and_then(|l| l.origin.as_ref())
        .expect("rules/zones.json: sentenced.signature.landmark has no \"origin\"")
}

// ---- the premise: what the church packet builds ----------------------------------------------------------------------

/// GUARD: the church feature is the building (23 x 14, either way round) strictly inside the 29 x 29 anchor footprint.
#[test]
fn the_church_feature_is_the_building_inside_the_churchyard_anchor() {
    for c in sig_cases() {
        let a = anchor_of(&c.map, Zone::Sentenced);
        assert_eq!(a.kind, FeatureKind::Church, "seed {}", c.seed);
        assert_eq!((a.footprint.w, a.footprint.h), (29, 29), "seed {}", c.seed);
        let b = feature_box(&c.map, Zone::Sentenced, FeatureKind::Church).expect("a church");
        let dims = (b.w.min(b.h), b.w.max(b.h));
        assert_eq!(dims, (14, 23), "seed {}: the building's box", c.seed);
        assert!(
            interior(a.footprint, b.x as usize, b.y as usize)
                && interior(
                    a.footprint,
                    (b.x + b.w as i32 - 1) as usize,
                    (b.y + b.h as i32 - 1) as usize
                ),
            "seed {}: the building lies inside the fence",
            c.seed
        );
    }
}

// ---- the rule file ------------------------------------------------------------------------------------------------------

#[test]
fn the_shipped_file_measures_sentenced_from_the_church_building_and_no_other_zone_has_an_origin() {
    let o = sentenced_origin();
    assert_eq!(o.feature, FeatureKind::Church);
    assert_eq!(o.inside, Some(Band::Near), "the yard's graves ring");
    assert_eq!(o.outside, Some(Band::Mid), "dead grass begins at the fence");
    for z in &rules().zones {
        if z.zone != Zone::Sentenced {
            let lm = z.landmark.as_ref().expect("every zone has a landmark");
            assert!(lm.origin.is_none(), "{:?} names an origin", z.zone);
        }
    }
    // The ring bands and ground variants are the ones the art decision keeps.
    let lm = rules()
        .zone(Zone::Sentenced)
        .unwrap()
        .landmark
        .as_ref()
        .unwrap();
    let by_band = |b: Band| lm.rings.iter().find(|r| r.band == b).unwrap();
    assert_eq!(by_band(Band::Core).name, "sent-core-flagstone");
    assert_eq!(by_band(Band::Near).name, "sent-near-graves");
    assert_eq!(by_band(Band::Mid).name, "sent-mid-deadgrass");
    assert_eq!(by_band(Band::Far).name, "sent-far-deadtrees");
}

#[test]
fn a_malformed_origin_is_refused_naming_the_zone_and_the_value() {
    let e = refused(&with_origin(
        "sentenced",
        json!({ "feature": "church", "inside": "inner" }),
    ));
    assert!(e.contains("sentenced") && e.contains("inner"), "{e}");
    let e = refused(&with_origin(
        "fire",
        json!({ "feature": "volcano", "outside": "beyond" }),
    ));
    assert!(e.contains("fire") && e.contains("beyond"), "{e}");
}

/// GUARD: the shared serde path refuses an unknown feature name, a missing feature and a stray key.
#[test]
fn an_origin_without_a_known_feature_or_with_a_stray_key_is_refused() {
    let e = refused(&with_origin("sentenced", json!({ "feature": "nonesuch" })));
    assert!(e.contains("nonesuch"), "{e}");
    refused(&with_origin("sentenced", json!({ "inside": "near" })));
    let e = refused(&with_origin(
        "sentenced",
        json!({ "feature": "church", "radius": 3 }),
    ));
    assert!(e.contains("radius"), "{e}");
}

/// GUARD: `origin` is optional, and a file with only a feature (no inside or outside) parses to exactly that.
#[test]
fn an_origin_may_name_only_a_feature_and_the_field_is_optional() {
    let r = rules_from(&with_origin("sentenced", json!({ "feature": "graveyard" })));
    let o = r
        .zone(Zone::Sentenced)
        .unwrap()
        .landmark
        .as_ref()
        .unwrap()
        .origin
        .unwrap();
    assert_eq!(
        o,
        RingOrigin {
            feature: FeatureKind::Graveyard,
            inside: None,
            outside: None
        }
    );
    assert!(shipped_without_origin()
        .zone(Zone::Sentenced)
        .unwrap()
        .landmark
        .as_ref()
        .unwrap()
        .origin
        .is_none());
}

// ---- the properties on real maps ------------------------------------------------------------------------------------------

/// The art decision, item 3: loose graves and fence props stand inside the churchyard fence and on open floor only
/// (not on a headstone, a fence tile, the building, the fence line with its gates, or the church door).
#[test]
fn graves_and_fence_props_stand_inside_the_churchyard_fence_and_on_open_floor() {
    let kinds = kind_codes(rules(), &["sent.grave", "sent.fence"]);
    let mut total = 0;
    for c in sig_cases() {
        let a = anchor_of(&c.map, Zone::Sentenced);
        let d = dress(&c.map, c.hash, rules());
        for p in placed(&d).iter().filter(|p| kinds.contains(&p.kind)) {
            total += 1;
            let (tx, ty) = tile_of(p.x, p.y);
            let i = idx(&c.map, tx, ty);
            assert!(
                interior(a.footprint, tx, ty),
                "seed {}: grave/fence prop {p:?} at ({tx},{ty}) is not inside the churchyard {:?}",
                c.seed,
                a.footprint
            );
            assert_eq!(
                c.map.tiles[i], 0,
                "seed {}: prop {p:?} stands on a wall or fence tile",
                c.seed
            );
            assert!(
                !a.entrance
                    .iter()
                    .any(|t| (t.x, t.y) == (tx as i32, ty as i32)),
                "seed {}: prop {p:?} stands in the church door",
                c.seed
            );
        }
    }
    assert!(total >= 40, "only {total} grave/fence props on seeds 1-8");
}

/// Item 2: flagstone (ground variant 3 and `sent.flag`) only in the building's apron (the generator's core band: 2
/// tiles) and inside the churchyard; and the whole apron is flagstone.
#[test]
fn flagstone_covers_the_buildings_apron_and_nothing_else() {
    let flag = kind_codes(rules(), &["sent.flag"])[0];
    let mut flags = 0;
    for c in sig_cases() {
        let a = anchor_of(&c.map, Zone::Sentenced);
        let church = feature_box(&c.map, Zone::Sentenced, FeatureKind::Church).unwrap();
        let d = dress(&c.map, c.hash, rules());
        for ty in 0..c.map.h as usize {
            for tx in 0..c.map.w as usize {
                let i = idx(&c.map, tx, ty);
                if zone_at(&c.map, i) != Some(Zone::Sentenced) || c.map.tiles[i] != 0 {
                    continue;
                }
                let near_building = cheb(church, tx, ty) <= 2;
                let flagged = d.ground_variants[i] == 3;
                assert_eq!(
                    flagged,
                    near_building,
                    "seed {}: tile ({tx},{ty}) is {} tiles from the building, ground variant {}",
                    c.seed,
                    cheb(church, tx, ty),
                    d.ground_variants[i]
                );
                if near_building {
                    assert!(interior(a.footprint, tx, ty), "seed {}", c.seed);
                }
            }
        }
        for p in placed(&d).iter().filter(|p| p.kind == flag) {
            flags += 1;
            let (tx, ty) = tile_of(p.x, p.y);
            assert!(
                cheb(church, tx, ty) <= 2 && interior(a.footprint, tx, ty),
                "seed {}: sent.flag {p:?} at ({tx},{ty}), {} tiles from the building",
                c.seed,
                cheb(church, tx, ty)
            );
        }
    }
    assert!(flags >= 20, "only {flags} sent.flag props on seeds 1-8");
}

/// Item 4: the dead-grass and dead-tree rings (ground variants 5 and 6; props `sent.lamp` and `sent.stump`) lie at or
/// beyond the fence line: none strictly inside the churchyard; and the graves ring's ground (variant 4) lies only inside.
#[test]
fn the_dead_grass_and_dead_tree_rings_begin_at_the_fence() {
    let outer = kind_codes(rules(), &["sent.lamp", "sent.stump"]);
    let mut lamps = 0;
    let lamp = outer[0];
    for c in sig_cases() {
        let a = anchor_of(&c.map, Zone::Sentenced);
        let d = dress(&c.map, c.hash, rules());
        for ty in 0..c.map.h as usize {
            for tx in 0..c.map.w as usize {
                let i = idx(&c.map, tx, ty);
                if zone_at(&c.map, i) != Some(Zone::Sentenced) || c.map.tiles[i] != 0 {
                    continue;
                }
                let v = d.ground_variants[i];
                let inside = interior(a.footprint, tx, ty);
                assert!(
                    !(inside && (v == 5 || v == 6)),
                    "seed {}: dead ground {v} inside the churchyard at ({tx},{ty})",
                    c.seed
                );
                assert!(
                    !(!inside && v == 4),
                    "seed {}: graves ground outside the churchyard at ({tx},{ty})",
                    c.seed
                );
            }
        }
        for p in placed(&d).iter().filter(|p| outer.contains(&p.kind)) {
            let (tx, ty) = tile_of(p.x, p.y);
            assert!(
                !interior(a.footprint, tx, ty),
                "seed {}: dead-grass/tree ring prop {p:?} inside the churchyard",
                c.seed
            );
            lamps += usize::from(p.kind == lamp);
        }
    }
    assert!(lamps >= 20, "only {lamps} sent.lamp props on seeds 1-8");
}

/// GUARD (item 4, dead trees): no tall prop of any stage (cluster `sent.deadtree`, ring `sent.stump`) stands inside the
/// churchyard. Today the whole yard is the core band, which bars tall props; with the bands measured from the building
/// the yard beyond the apron is no longer core, so the implementer must keep tall props out of it by another means.
#[test]
fn no_tall_prop_of_the_zone_stands_inside_the_churchyard() {
    for c in sig_cases() {
        let a = anchor_of(&c.map, Zone::Sentenced);
        let d = dress(&c.map, c.hash, rules());
        for p in placed(&d)
            .iter()
            .filter(|p| p.flags & rh_mapdress::FLAG_TALL != 0)
        {
            let (tx, ty) = tile_of(p.x, p.y);
            assert!(
                zone_at(&c.map, idx(&c.map, tx, ty)) != Some(Zone::Sentenced)
                    || !interior(a.footprint, tx, ty),
                "seed {}: tall prop {p:?} inside the churchyard",
                c.seed
            );
        }
    }
}

/// The rings still follow `band`: every Sentenced floor tile shows its effective band's ground variant, and every ring
/// prop stands in its ring's effective band (the mapping restated in the header, from the shipped origin).
#[test]
fn sentenced_ground_and_ring_props_follow_the_band_from_the_origin() {
    let origin = sentenced_origin();
    check_zone(rules(), Zone::Sentenced, Some(origin));
}

/// The origin works for any zone: Fire's volcano with an invented `inside`/`outside` pair, hand-built rules.
#[test]
fn any_zone_may_name_an_origin_and_its_rings_follow_it() {
    let v = with_origin(
        "fire",
        json!({ "feature": "volcano", "inside": "core", "outside": "near" }),
    );
    let r = rules_from(&v);
    let o = *r
        .zone(Zone::Fire)
        .unwrap()
        .landmark
        .as_ref()
        .unwrap()
        .origin
        .as_ref()
        .expect("the hand-built origin parses");
    check_zone(&r, Zone::Fire, Some(&o));
}

/// Shared check of `sentenced_ground_and_ring_props_follow_the_band_from_the_origin`.
fn check_zone(r: &Rules, zone: Zone, origin: Option<&RingOrigin>) {
    let lm = r.zone(zone).unwrap().landmark.as_ref().unwrap();
    for c in sig_cases() {
        let d = dress(&c.map, c.hash, r);
        for ty in 0..c.map.h as usize {
            for tx in 0..c.map.w as usize {
                let i = idx(&c.map, tx, ty);
                if zone_at(&c.map, i) != Some(zone) || c.map.tiles[i] != 0 {
                    continue;
                }
                let b = effective_band(&c.map, zone, origin, tx, ty);
                let want = lm
                    .rings
                    .iter()
                    .find(|x| x.band == b)
                    .unwrap()
                    .ground_variant;
                assert_eq!(
                    d.ground_variants[i], want,
                    "seed {}: {zone:?} tile ({tx},{ty}) band {b:?}",
                    c.seed
                );
            }
        }
        for ring in &lm.rings {
            let kinds: Vec<u8> = ring.props.iter().map(|p| p.kind).collect();
            for p in placed(&d).iter().filter(|p| kinds.contains(&p.kind)) {
                let (tx, ty) = tile_of(p.x, p.y);
                assert_eq!(
                    effective_band(&c.map, zone, origin, tx, ty),
                    ring.band,
                    "seed {}: {} prop {p:?} at ({tx},{ty})",
                    c.seed,
                    ring.name
                );
            }
        }
    }
}

/// Measured with no remap: an origin naming only the church feature moves the bands to the building and nothing else.
#[test]
fn an_origin_with_only_a_feature_measures_the_bands_from_that_features_box() {
    let v = with_origin("sentenced", json!({ "feature": "church" }));
    let r = rules_from(&v);
    let o = *r
        .zone(Zone::Sentenced)
        .unwrap()
        .landmark
        .as_ref()
        .unwrap()
        .origin
        .as_ref()
        .unwrap();
    assert_eq!((o.inside, o.outside), (None, None));
    check_zone(&r, Zone::Sentenced, Some(&o));
}

// ---- nothing else moves -------------------------------------------------------------------------------------------------

/// GUARD: with no `origin` anywhere the dressing is today's: seeds 1-4 (signature on), FNV-1a 64 of the whole output,
/// measured on the stub (behaviour unchanged) with the shipped file minus the field. Not captured from legacy.
const NO_ORIGIN_GOLDEN: [u64; 4] = [
    0x6659_4a56_c8ca_70ea,
    0x6ae4_1d91_65be_4ac1,
    0xea7b_f622_c438_5c44,
    0x2e07_4093_5dd4_9b2f,
];

/// Re-pin helper, not a check: prints `NO_ORIGIN_GOLDEN` as it comes out on this tree, ready to paste over the constant
/// above. Only inside a packet whose brief says these maps move, in its own `re-pin:` commit:
/// `cargo test -p rh-mapdress --test sentenced_rings -- --ignored --nocapture print_goldens`
#[test]
#[ignore = "re-pin helper: prints the golden constants"]
fn print_goldens() {
    println!("const NO_ORIGIN_GOLDEN: [u64; 4] = [");
    for c in sig_cases().iter().take(4) {
        println!(
            "    {:#018x},",
            fnv(&dress(&c.map, c.hash, shipped_without_origin()))
        );
    }
    println!("];");
}

#[test]
fn a_file_without_origin_dresses_signature_maps_exactly_as_today() {
    for (c, want) in sig_cases().iter().zip(NO_ORIGIN_GOLDEN) {
        assert_eq!(
            fnv(&dress(&c.map, c.hash, shipped_without_origin())),
            want,
            "seed {}",
            c.seed
        );
    }
}

/// GUARD: with the option off there is no anchor, so the shipped file (origin and all) dresses byte for byte as the
/// file without the field (`marsh.rs` `OFF_GOLDEN` pins the absolute values).
#[test]
fn option_off_maps_are_dressed_identically_with_or_without_the_origin() {
    for c in cases() {
        assert!(c.map.anchors.is_empty(), "seed {}: option off", c.seed);
        assert_eq!(
            dress(&c.map, c.hash, rules()),
            dress(&c.map, c.hash, shipped_without_origin()),
            "seed {}",
            c.seed
        );
    }
}

/// GUARD: an origin that names a feature the zone's map does not have is ignored (the anchor's footprint is used, and
/// `inside` and `outside` are not applied): the dressing equals the file's without the field.
#[test]
fn an_origin_naming_a_feature_the_zone_lacks_is_ignored() {
    let v = with_origin(
        "sentenced",
        json!({ "feature": "cave", "inside": "far", "outside": "far" }),
    );
    let r = rules_from(&v);
    for c in sig_cases() {
        assert_eq!(
            feature_box(&c.map, Zone::Sentenced, FeatureKind::Cave),
            None,
            "seed {}",
            c.seed
        );
        assert_eq!(
            dress(&c.map, c.hash, &r),
            dress(&c.map, c.hash, shipped_without_origin()),
            "seed {}",
            c.seed
        );
    }
}

/// GUARD: the ground of every tile outside Sentenced is what the file without the field gives, on all eight maps (the
/// per-zone hashes in `marsh.rs` `SIG_GOLDEN` pin Fire, Frost and Holy props and ground on seeds 1-4).
#[test]
fn no_other_zones_ground_moves() {
    for c in sig_cases() {
        let with = dress(&c.map, c.hash, rules());
        let without = dress(&c.map, c.hash, shipped_without_origin());
        for i in 0..with.ground_variants.len() {
            if zone_at(&c.map, i) != Some(Zone::Sentenced) {
                assert_eq!(
                    with.ground_variants[i], without.ground_variants[i],
                    "seed {}: tile {i}",
                    c.seed
                );
            }
        }
    }
}
