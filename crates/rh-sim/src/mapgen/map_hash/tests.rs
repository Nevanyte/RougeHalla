use super::*;
use crate::mapdata::MapExport;
use serde_json::{json, Value};
use std::collections::BTreeSet;
const FIXTURE: &str = include_str!("../fixtures/map-hash.json");
fn fixture() -> Value {
    serde_json::from_str(FIXTURE).unwrap()
}
fn number_bits(v: &Value) -> f64 {
    f64::from_bits(u64::from_str_radix(v.as_str().unwrap(), 16).unwrap())
}
#[test]
fn actual_complete_maps_match_source_hash_and_remain_unchanged() {
    let f = fixture();
    assert_eq!(f["format"], "rh-map-hash/1");
    assert_eq!(f["node"], "v22.23.4");
    assert_eq!(f["platform"], "linux");
    assert_eq!(f["arch"], "x64");
    assert_eq!(
        f["sources"],
        serde_json::from_str::<Value>(SOURCE_INVENTORY).unwrap()
    );
    let cases = f["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 8);
    let expected: [(i64, u64, bool, bool); 8] = [
        (1, 0, false, false),
        (1, 0, false, true),
        (1, 0, true, false),
        (1, 0, true, true),
        (-1, 0, false, false),
        (4294967297, 4294967296, true, false),
        (17, 1, false, false),
        (9007199254740991, 1, true, false),
    ];
    for (case, (seed, attempt, plain, decor)) in cases.iter().zip(expected) {
        assert_eq!(case["seed"], seed);
        assert_eq!(case["attempt"], attempt);
        assert_eq!(case["plainStyle"], plain);
        assert_eq!(case["decor"], decor);
        assert_eq!(case["fullMapEquality"], true);
        assert_eq!(case["inputUnchanged"], true);
        let map: GameMapData = serde_json::from_value(case["map"].clone()).unwrap();
        let before = map.clone();
        assert_eq!(
            map_hash(&map),
            case["hash"].as_str().unwrap(),
            "{seed}/{attempt}/{plain}/{decor}"
        );
        assert_eq!(map, before);
        MapExport {
            format: "rh-map/2".into(),
            legacy_map_hash_u32: u32::from_str_radix(case["hash"].as_str().unwrap(), 16).unwrap(),
            map,
        }
        .validate()
        .unwrap();
    }
    assert_eq!(cases[0]["hash"], cases[1]["hash"]);
    assert_eq!(cases[2]["hash"], cases[3]["hash"]);
    assert_ne!(cases[0]["hash"], cases[2]["hash"]);
    assert!(cases[0]["map"]["props"].as_array().unwrap().is_empty());
    assert!(!cases[1]["map"]["props"].as_array().unwrap().is_empty());
}
#[test]
fn every_source_number_string_and_cumulative_hash_matches() {
    let f = fixture();
    let cases = f["numbers"].as_array().unwrap();
    assert_eq!(cases.len(), 122370);
    verify_helper_inventory(cases).unwrap();
    assert_eq!(
        f["probeInitialHash"].as_u64().unwrap(),
        u64::from(u32::from_str_radix(f["cases"][0]["hash"].as_str().unwrap(), 16).unwrap())
    );
    let mut h = Hash(f["probeInitialHash"].as_u64().unwrap() as u32);
    let mut seen = BTreeSet::new();
    for c in cases {
        let bits = c["bits"].as_str().unwrap();
        assert!(seen.insert(bits));
        let value = number_bits(&c["bits"]);
        assert_eq!(
            number_string(value),
            c["text"].as_str().unwrap(),
            "bits {bits}"
        );
        if value.is_finite() && value != 0.0 {
            assert_eq!(
                number_string(value).parse::<f64>().unwrap().to_bits(),
                value.to_bits(),
                "roundtrip {bits}"
            );
        }
        h.number(value);
        assert_eq!(
            u64::from(h.0),
            c["hash"].as_u64().unwrap(),
            "numeric FNV {bits}"
        );
    }
    for (value, text) in [
        (0.0, "0"),
        (-0.0, "0"),
        (f64::NAN, "NaN"),
        (f64::INFINITY, "Infinity"),
        (f64::NEG_INFINITY, "-Infinity"),
        (1e21, "1e+21"),
        (1e20, "100000000000000000000"),
        (1e-6, "0.000001"),
        (1e-7, "1e-7"),
        (1000000000000000128.0, "1000000000000000100"),
    ] {
        assert_eq!(number_string(value), text);
    }
    assert_eq!(f["audit"]["randomWords"], 100000);
    assert_eq!(f["radii"].as_array().unwrap().len(), 901);
    for (reach2, r) in f["radii"].as_array().unwrap().iter().enumerate() {
        assert_eq!(r["reach2"], reach2);
        assert!(seen.contains(r["bits"].as_str().unwrap()));
    }
}
#[test]
fn source_utf16_units_bytes_endian_delimiter_and_wrapping_match() {
    let f = fixture();
    let initial = f["probeInitialHash"].as_u64().unwrap() as u32;
    let mut h = Hash(initial);
    let strings = f["strings"].as_array().unwrap();
    assert_eq!(strings.len(), 275);
    let mut scalar = 0;
    let mut lone = 0;
    for c in strings {
        let units: Vec<u16> = serde_json::from_value(c["units"].clone()).unwrap();
        let before = h.0;
        h.units(units.iter().copied());
        assert_eq!(u64::from(h.0), c["hash"].as_u64().unwrap());
        match String::from_utf16(&units) {
            Ok(text) => {
                scalar += 1;
                assert_eq!(c["scalarString"], true);
                let mut text_hash = Hash(before);
                text_hash.string(&text);
                assert_eq!(text_hash.0, h.0);
            }
            Err(_) => {
                lone += 1;
                assert_eq!(c["scalarString"], false);
            }
        }
    }
    assert_eq!((scalar, lone), (272, 3));
    h = Hash(initial);
    let bytes = f["bytes"].as_array().unwrap();
    assert_eq!(bytes.len(), 2048);
    for (i, c) in bytes.iter().enumerate() {
        assert_eq!(c[0], i % 256);
        h.byte(c[0].as_u64().unwrap() as u8);
        assert_eq!(u64::from(h.0), c[1].as_u64().unwrap());
    }
    let mut combined = Hash(initial);
    combined.string("ab");
    let mut split = Hash(initial);
    split.string("a");
    split.string("b");
    assert_ne!(combined.0, split.0);
}
fn at_mut<'a>(value: &'a mut Value, path: &[Value]) -> &'a mut Value {
    let mut current = value;
    for key in path {
        current = if current.is_array() {
            let i = key
                .as_u64()
                .map(|v| v as usize)
                .or_else(|| key.as_str().and_then(|s| s.parse().ok()))
                .unwrap();
            &mut current[i]
        } else {
            &mut current[key.as_str().unwrap()]
        };
    }
    current
}
#[test]
fn individual_fields_orders_lengths_unicode_and_source_omissions_match() {
    let f = fixture();
    let base = &f["cases"][0]["map"];
    let expected_base = f["cases"][0]["hash"].as_str().unwrap();
    let cases = f["mutations"].as_array().unwrap();
    assert_eq!(cases.len(), 107);
    let mut paths = BTreeSet::new();
    let mut omitted = 0;
    for c in cases {
        let mut map = base.clone();
        let path = c["path"].as_array().unwrap();
        let target = at_mut(&mut map, path);
        match c["op"].as_str().unwrap() {
            "set" => *target = c["replacement"].clone(),
            "reverse" => target.as_array_mut().unwrap().reverse(),
            "dropLast" => {
                target.as_array_mut().unwrap().pop().unwrap();
            }
            _ => panic!("unknown mutation"),
        }
        let typed: GameMapData = serde_json::from_value(map).unwrap();
        let hash = map_hash(&typed);
        assert_eq!(hash, c["hash"].as_str().unwrap(), "{}", c["path"]);
        if c["omitted"] == true {
            omitted += 1;
            assert_eq!(hash, expected_base);
        } else {
            assert_ne!(hash, expected_base);
            paths.insert(
                path.iter()
                    .map(|x| {
                        x.as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| x.to_string())
                    })
                    .collect::<Vec<_>>()
                    .join("."),
            );
        }
    }
    assert_eq!(omitted, 3);
    for required in [
        "seed",
        "attempt",
        "w",
        "h",
        "tiles.0",
        "terrain.0",
        "regionGrid.0",
        "territoryGrid.0",
        "featureGrid.0",
        "camps.0.id",
        "camps.0.zone",
        "camps.0.x",
        "camps.0.y",
        "camps.0.r",
        "camps.0.spots.0.x",
        "camps.0.spots.0.y",
        "camps.0.eliteSpot",
        "camps.0.chest.x",
        "camps.0.chest.y",
        "camps.0.area",
        "camps.0.radius",
        "spawnPool.0.x",
        "spawnPool.0.y",
        "spawnPool.0.zone",
        "regions.0.id",
        "regions.0.pole.x",
        "regions.0.pole.y",
        "regions.0.area",
        "regions.0.spawns.0.x",
        "regions.0.spawns.0.y",
        "regions.0.chestSpots.0.x",
        "regions.0.chestSpots.0.y",
        "buildings.0.x",
        "buildings.0.y",
        "buildings.0.w",
        "buildings.0.h",
        "features.0.kind",
        "features.0.variant",
        "features.0.zone",
        "features.0.jobs.0",
        "features.0.ax",
        "features.0.ay",
        "features.0.p.0",
        "features.0.bbox.x",
        "features.0.bbox.y",
        "features.0.bbox.w",
        "features.0.bbox.h",
        "features.0.tiles",
        "spawns.0.x",
        "spawns.0.y",
        "crateSpots.0.x",
        "crateSpots.0.y",
        "groundSpots.0.x",
        "groundSpots.0.y",
    ] {
        assert!(
            paths.contains(required),
            "missing source mutation {required}"
        );
    }
}
#[test]
fn formatting_compatibility_and_nonfinite_domain_are_explicit() {
    // Demonstrates why ordinary Display and JSON serialization are not the contract.
    assert_ne!((1e21f64).to_string(), number_string(1e21));
    assert_ne!(serde_json::to_string(&1.0f64).unwrap(), number_string(1.0));
    assert_ne!(
        serde_json::to_string(&f64::NAN).unwrap(),
        number_string(f64::NAN)
    );
    let f = fixture();
    let mut map: GameMapData = serde_json::from_value(f["cases"][0]["map"].clone()).unwrap();
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        map.camps[0].radius = bad;
        assert!(MapExport {
            format: "rh-map/2".into(),
            legacy_map_hash_u32: 0,
            map: map.clone()
        }
        .validate()
        .is_err());
    }
    assert!(serde_json::from_str::<String>(r#""\ud800""#).is_err());
    // Exact enum encoding remains covered even when a corpus has no feature of a particular kind/job.
    for kind in [
        FeatureKind::Landmark,
        FeatureKind::Crater,
        FeatureKind::LavaRiver,
        FeatureKind::FenceRow,
        FeatureKind::Gallows,
        FeatureKind::Barrow,
        FeatureKind::Mere,
        FeatureKind::Headland,
        FeatureKind::Spire,
        FeatureKind::Causeway,
        FeatureKind::Hall,
        FeatureKind::Infill,
        FeatureKind::Bush,
    ] {
        assert_eq!(json!(kind), kind_name(kind));
    }
    for job in [
        FeatureJob::Landmark,
        FeatureJob::Pen,
        FeatureJob::Crossing,
        FeatureJob::Lane,
        FeatureJob::Fork,
        FeatureJob::Lee,
        FeatureJob::Choke,
        FeatureJob::Cover,
        FeatureJob::Rest,
        FeatureJob::Seal,
    ] {
        assert_eq!(json!(job), job_name(job));
    }
}

#[test]
fn finite_radius_domain_reaches_full_map_hash_without_json_normalization() {
    let f = fixture();
    let base: GameMapData = serde_json::from_value(f["cases"][0]["map"].clone()).unwrap();
    let cases = f["numericMaps"].as_array().unwrap();
    let inputs = input_bits(cases).unwrap();
    verify_exact_bits(&inputs, &required_numeric_map_bits()).unwrap();
    for c in cases {
        let mut map = base.clone();
        let expected_bits = u64::from_str_radix(c["bits"].as_str().unwrap(), 16).unwrap();
        map.camps[0].radius = f64::from_bits(expected_bits);
        assert_eq!(
            map.camps[0].radius.to_bits(),
            expected_bits,
            "map radius lost captured bits"
        );
        assert!(map.camps[0].radius.is_finite() && map.camps[0].radius >= 0.0);
        assert_eq!(
            map_hash(&map),
            c["hash"].as_str().unwrap(),
            "radius {}",
            c["bits"]
        );
        MapExport {
            format: "rh-map/2".into(),
            legacy_map_hash_u32: 0,
            map,
        }
        .validate()
        .unwrap();
    }
}

const SOURCE_INVENTORY: &str = r#"{"abilities.ts":"95ef39376a9d9f40cc529a0f7300700a97427050628941e801aaa1e299862518","bushes.ts":"ac64ce414134376d27b7b4819d59096e66edd01d82958e873d57348a79d85910","coliseum.ts":"48fc2fa156e70ff6520019605017939298144960d8871a748ef18aadbbf0c0e1","constants.ts":"51ce4dd800ec868abee525fb1ae375688066f336972a7da878644df1235924e7","detMath.ts":"a806636428155920a0c1c8675cd84d896057993d4d6ff7b9b4623daa5a312b15","factions.ts":"aa0cebf1c17af17b64bc1e020c4613ab10788ec66d82a72232aef8915d5403f3","geometry.ts":"b1a91a65281f8642b1779b81764768569311966ab493941101a2f988cfdc1f5d","gridOps.ts":"76587ddd597a2a6ecc05561427dd89b986b6f86026ffedc56848e1b03bb52493","gridTopology.ts":"deb2710d114cd669854a082c06bafe518f5ef750249722f89ede83a27d42d328","map.ts":"35caac04108a3bd0e1d880a9502f14bdccb3a9a17d262cba335c3d6436995eed","mapgen.ts":"975591aed836a345c4efd957ced95a478638e6e870fe8ea9bb8740526ef06d10","mark.ts":"44870381fa48b9c8f65f180ff74995725644d7264df5b069a3c43c2291540661","messages.ts":"f7f3b4eb6bb32c54bb97a7d3a8e2ba613b0aff0495a0f20c09fd6d36c797fe80","mobs.ts":"3b567c08363d8d4f1e9a897240b3d99d5b8ded7757b6809a4b534b63d72b5522","pathfind.ts":"300caa48788f84bdc780befe8c50db41c2c0b2be520d3fb43a7f91e16de424d9","planning.ts":"8d52b212f6fec391359787cf9d81b8fa31a067ea839a2b9ccadc58c059027cb2","propKinds.ts":"431d70881377a8059960f053dc9452946cc0e942d212c92765bacb8a063027ee","rng.ts":"412bdcee4a5adcb6163bff3561cb4a07eff423dc7e30e9ba0694cb41b05b1bec","signatureShares.ts":"e6996931487dde9d4e3f71481a9da996f7500fbcd2148f7924ed730a78eba1a4","signatures.ts":"0a6befbb5a6fe9870b13a540d72235085c491668c8cae3674fa8faf89816e191","status.ts":"98a0570d7620e424d9d522356fe378a6af049109d8af0342be0ecff970310df7","styler.ts":"314805a5a6cd9074763c9e555e48e7145c7ed7c87f265876c3712e4837abc51c","terrain.ts":"5ee4fe11e793f83f3d095720ba1156a186c5c7704e864f2cad74503ab13a07d6","weapons.ts":"2f22f037502fe63fae6b47f20408cfd35ebc72bfea081194ae8d18cfc21df99b","zoneStyle/context.ts":"8a87c8c930a11c2f1c83b3afe9384586a24f41690dd77a78f1c35b0f69a19dfb","zoneStyle/features.ts":"f0d987fc114394e514c0b9e194b219aa1f8f3429a0fa141c7b6181e6d87ee983","zoneStyle/gallows.ts":"0edb95a89d06fc6b0f60a6dc85da41613177362679c03e2073f2be24bbe186e4","zoneStyle/hook.ts":"56eeba0fb5019dc5dd02e8fd76059c6f82ede6cfa2aa46c763ecf63b619bc668","zoneStyle/kit.ts":"dc69161c080b9474a873d12ac194d876b78285a1ae2cdb7eb24cb86b30337e16","zoneStyle/landmarks.ts":"ad18e32099ceafc1b88fa33a2225ef2c02508ac6fa4a58c1a91473f0be4c6587","zoneStyle/propKinds.ts":"6a139d0727ab392512d427507ee3b027f67860734d56eea7db8085add24003b9","zoneStyle/rime.ts":"d25714c3b647392a03662b33082b48de2c7ec2933755501fe55260c2a1daa19a","zoneStyle/sanctum.ts":"dd2da40c09a1a5dc5fdbd6e45b568d2b4ada831a0e195e86fd0ab64f49b7babd","zoneStyle/scale.ts":"b8e055707f98dfa104233c1ceebd99358b9b3b5ae8e9fe001d9174806ca6a07e","zoneStyle/scorch.ts":"52b324dd4dfc9a77986a9ffdcb9704041a2d3608e6e61e9af98b0f697fd2f02a","zoneStyle/styleZones.ts":"9c328903541ae1e15ca473b288c788b5a2ebb55e8974a639c6215c7c804cbc36","zoneStyle/types.ts":"193b6f57c1e76ea6f8249a316fc8898191682937493fbbce7beb3a0ffb26c33e","zoneStyle/warren.ts":"bdb057ebaf226fbe803403cc338d38f50c154c276a30fcb652b5229741a9ddcc","zones.ts":"aa91d0c2b8d7b1957d6e28e29289c9dfa58ac6d4c8475b647445370fbcaeb814"}"#;

#[test]
fn every_dto_field_requires_an_explicit_hashing_decision() {
    use crate::mapdata::{CampDef, FactionRegionDef, MapFeature, ZoneSpawn};
    let f = fixture();
    let map: GameMapData = serde_json::from_value(f["cases"][0]["map"].clone()).unwrap();
    let GameMapData {
        tiles: _,
        seed: _,
        w: _,
        h: _,
        terrain: _,
        props: _,
        region_grid: _,
        attempt: _,
        territory_grid: _,
        coliseum: _,
        regions: _,
        camps: _,
        spawn_pool: _,
        buildings: _,
        spawns: _,
        crate_spots: _,
        ground_spots: _,
        features: _,
        feature_grid: _,
        // Not hashed: the anchors are derived from the generator's placement (the signature step's sites and landings,
        // the finished features); the map hash covers the tiles and features they describe, not the anchors themselves.
        anchors: _,
    } = &map;
    let CampDef {
        id: _,
        zone: _,
        x: _,
        y: _,
        r: _,
        spots: _,
        elite_spot: _,
        chest: _,
        area: _,
        radius: _,
    } = &map.camps[0];
    let FactionRegionDef {
        id: _,
        pole: _,
        area: _,
        spawns: _,
        chest_spots: _,
        mob_camps: _,
    } = &map.regions[0];
    let MapFeature {
        kind: _,
        variant: _,
        zone: _,
        jobs: _,
        ax: _,
        ay: _,
        p: _,
        bbox: _,
        tiles: _,
    } = &map.features[0];
    let ZoneSpawn {
        x: _,
        y: _,
        zone: _,
    } = &map.spawn_pool[0];
    let TileRect {
        x: _,
        y: _,
        w: _,
        h: _,
    } = &map.buildings[0];
    let WorldPt { x: _, y: _ } = &map.spawns[0];
}

#[test]
fn admitted_unicode_identifiers_and_omitted_mob_records_agree() {
    let f = fixture();
    let base: GameMapData = serde_json::from_value(f["cases"][0]["map"].clone()).unwrap();
    let mut count = 0;
    for c in f["mutations"].as_array().unwrap() {
        if c["path"] != json!(["camps", 0, "id"]) {
            continue;
        }
        let mut map = base.clone();
        let old = map.camps[0].id.clone();
        let id = c["replacement"].as_str().unwrap().to_owned();
        map.camps[0].id = id.clone();
        for region in &mut map.regions {
            for camp in &mut region.mob_camps {
                if camp.id == old {
                    camp.id = id.clone();
                }
            }
        }
        assert_eq!(map_hash(&map), c["hash"].as_str().unwrap());
        MapExport {
            format: "rh-map/2".into(),
            legacy_map_hash_u32: 0,
            map,
        }
        .validate()
        .unwrap();
        count += 1;
    }
    assert_eq!(count, 6);
}

// Required input inventories are generated without reading the expected case arrays.
// These fixed test inputs are the capture recipe's inputs, not hash/string answers.
fn named_number_bits() -> Vec<u64> {
    [
        0.0,
        -0.0,
        f64::from_bits(0x7ff8_0000_0000_0000),
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::from_bits(1),
        -f64::from_bits(1),
        f64::MAX,
        -f64::MAX,
        f64::EPSILON,
        0.1,
        0.3,
        1.0 / 3.0,
        1e-7,
        1e-6,
        1e-5,
        1e20,
        1e21,
        1e22,
        1000000000000000128.0,
        9007199254740991.0,
        9007199254740992.0,
        -9007199254740991.0,
    ]
    .into_iter()
    .map(f64::to_bits)
    .collect()
}
fn radius_input_bits() -> BTreeSet<u64> {
    (0..=900)
        .map(|reach2| ((reach2 as f64).sqrt() * 32.0).to_bits())
        .collect()
}
fn fuzz_words() -> impl Iterator<Item = u64> {
    let mut state = 0x243f_6a88_85a3_08d3u64;
    (0..100000).map(move |_| {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    })
}
fn required_numeric_map_bits() -> BTreeSet<u64> {
    let mut required = radius_input_bits();
    required.extend(named_number_bits().into_iter().filter(|&b| {
        let n = f64::from_bits(b);
        n.is_finite() && n >= 0.0
    }));
    // Fixed pre-fuzz selected inputs at corpus ordinals 18432 and 20480.
    // Their mathematical values are independent of numericMaps' captured contents.
    required.insert((49.0f64 / 128.0).to_bits());
    required.insert((9007199254740992.0f64 + 80.0).to_bits());
    // Capture has 22370 distinct pre-fuzz inputs. Exact class counts below enforce
    // that contract; each random word is unique in the fixed 100000-word audit.
    for (i, bits) in fuzz_words().enumerate() {
        let n = f64::from_bits(bits);
        if (22370 + i) % 2048 == 0 && n.is_finite() && n >= 0.0 {
            required.insert(bits);
        }
    }
    assert_eq!(
        required.len(),
        949,
        "independent numeric-map input recipe changed"
    );
    required
}
fn input_bits(cases: &[Value]) -> Result<Vec<u64>, String> {
    cases
        .iter()
        .map(|c| {
            let text = c["bits"].as_str().ok_or("missing bit input")?;
            if text.len() != 16
                || !text
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err("noncanonical bit input".into());
            }
            u64::from_str_radix(text, 16).map_err(|_| "invalid bit input".into())
        })
        .collect()
}
fn verify_exact_bits(actual: &[u64], required: &BTreeSet<u64>) -> Result<(), String> {
    if actual.len() != required.len() {
        return Err("numeric input count differs".into());
    }
    let unique: BTreeSet<_> = actual.iter().copied().collect();
    if unique.len() != actual.len() {
        return Err("duplicate numeric input".into());
    }
    if &unique != required {
        return Err("required numeric input inventory differs".into());
    }
    Ok(())
}
fn required_helper_bits() -> BTreeSet<u64> {
    let mut required: BTreeSet<_> = named_number_bits().into_iter().collect();
    required.extend(radius_input_bits());
    required.extend(fuzz_words());
    for exp in -1074..=1023 {
        let center = if exp < -1022 {
            1u64 << (exp + 1074)
        } else {
            ((exp + 1023) as u64) << 52
        };
        for bits in [center - 1, center, center + 1] {
            required.insert(bits);
            required.insert(bits ^ (1u64 << 63));
        }
    }
    // Parse exact decimal centers independently of JavaScript's exponentiation.
    // The capture's center +/-1 ulp class includes these correctly rounded values.
    // Pin the exact decimal-neighbor group size separately below.
    for exp in -323..=308 {
        let n = format!("1e{exp}").parse::<f64>().unwrap();
        required.insert(n.to_bits());
        required.insert((-n).to_bits());
    }
    for i in -1024..=1024 {
        required.insert((9007199254740991.0 + i as f64).to_bits());
        required.insert((-9007199254740991.0 - i as f64).to_bits());
        required.insert((1.0 + i as f64 / 1024.0).to_bits());
    }
    required
}
fn verify_required_bits(actual: &[u64], required: &BTreeSet<u64>) -> Result<(), String> {
    let unique: BTreeSet<_> = actual.iter().copied().collect();
    if unique.len() != actual.len() {
        return Err("duplicate helper input".into());
    }
    if !required.is_subset(&unique) {
        return Err("required helper class input absent".into());
    }
    Ok(())
}
fn verify_helper_inventory(cases: &[Value]) -> Result<(), String> {
    let bits = input_bits(cases)?;
    verify_required_bits(&bits, &required_helper_bits())?;
    let expected: std::collections::BTreeMap<_, _> = [
        ("named-boundary", 23usize),
        ("binary-power-neighbor", 12574),
        ("decimal-power-neighbor", 3772),
        ("camp-radius", 895),
        ("safe-integer-neighbor", 3070),
        ("binary-fraction", 2036),
        ("xorshift64", 100000),
    ]
    .into_iter()
    .collect();
    let mut actual = std::collections::BTreeMap::new();
    for c in cases {
        *actual
            .entry(c["group"].as_str().ok_or("missing helper group")?)
            .or_insert(0usize) += 1;
    }
    if actual != expected {
        return Err("helper class inventory differs".into());
    }
    Ok(())
}
#[test]
fn numeric_input_inventory_rejects_duplicate_drop_and_required_replacements() {
    let f = fixture();
    let actual = input_bits(f["numericMaps"].as_array().unwrap()).unwrap();
    let required = required_numeric_map_bits();
    assert!(verify_exact_bits(&actual, &required).is_ok());
    assert!(
        verify_exact_bits(&vec![actual[0]; actual.len()], &required).is_err(),
        "original all-radius-zero corruption survived"
    );
    let mut changed = actual.clone();
    changed.pop();
    assert!(
        verify_exact_bits(&changed, &required).is_err(),
        "dropped input survived"
    );
    for wanted in [
        ((2.0f64).sqrt() * 32.0).to_bits(),
        (-0.0f64).to_bits(),
        1u64,
        (1e-7f64).to_bits(),
        (1e21f64).to_bits(),
        f64::MAX.to_bits(),
    ] {
        let index = actual.iter().position(|&b| b == wanted).unwrap();
        let mut changed = actual.clone();
        changed[index] = (7.25f64).to_bits();
        assert!(!required.contains(&changed[index]));
        assert!(
            verify_exact_bits(&changed, &required).is_err(),
            "required radius/boundary replacement survived"
        );
    }
    assert!(verify_exact_bits(&actual, &required).is_ok());
    let helper = input_bits(f["numbers"].as_array().unwrap()).unwrap();
    let helper_required = required_helper_bits();
    assert!(verify_required_bits(&helper, &helper_required).is_ok());
    let mut changed = helper.clone();
    changed[1] = changed[0];
    assert!(verify_required_bits(&changed, &helper_required).is_err());
    for wanted in [
        (-0.0f64).to_bits(),
        1u64,
        (1e21f64).to_bits(),
        ((2.0f64).sqrt() * 32.0).to_bits(),
        fuzz_words().next().unwrap(),
    ] {
        let mut changed = helper.clone();
        changed.retain(|&b| b != wanted);
        assert!(
            verify_required_bits(&changed, &helper_required).is_err(),
            "required helper input removal survived"
        );
    }
    assert!(verify_required_bits(&helper, &helper_required).is_ok());
}
