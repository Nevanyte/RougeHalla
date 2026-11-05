use super::*;
use serde::Deserialize;
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Capture {
    format: String,
    node: String,
    platform: String,
    arch: String,
    input_unchanged: bool,
    source_seed_count: usize,
    oracle_sha256: String,
    provenance: Vec<Provenance>,
    hard_rules: Vec<String>,
    inventory: Vec<String>,
    cases: Vec<Case>,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct Provenance {
    path: String,
    sha256: String,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Case {
    name: String,
    origin: String,
    #[serde(deserialize_with = "packed_map")]
    map: GameMapData,
    options: SourceOptions,
    failures: Vec<String>,
    strict_zones: Vec<u8>,
    #[serde(default, deserialize_with = "present_nonnull")]
    expect: Option<String>,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceOptions {
    #[serde(default, deserialize_with = "present_nonnull")]
    styled: Option<bool>,
    #[serde(default, deserialize_with = "present_nonnull")]
    zone: Option<bool>,
    #[serde(default, deserialize_with = "present_nonnull")]
    strict: Option<SourceStrict>,
}
#[derive(Clone, Deserialize)]
#[serde(untagged)]
enum SourceStrict {
    Bool(bool),
    Zones(Vec<Zone>),
}
fn present_nonnull<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    de: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(de).map(Some)
}
impl SourceOptions {
    fn native(&self) -> Options {
        Options {
            zone: self.zone.unwrap_or(false),
            styled: self.styled.unwrap_or(false),
            strict: match &self.strict {
                None => Strict::Auto,
                Some(SourceStrict::Bool(false)) => Strict::None,
                Some(SourceStrict::Bool(true)) => Strict::All,
                Some(SourceStrict::Zones(z)) => Strict::Zones(z.clone()),
            },
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PackedGrid {
    rle: Vec<[u64; 2]>,
}
fn unpack_grid(value: serde_json::Value) -> Result<Vec<u8>, String> {
    let packed: PackedGrid = serde_json::from_value(value).map_err(|e| e.to_string())?;
    let n = R.size * R.size;
    if packed.rle.is_empty() || packed.rle.len() > n {
        return Err("bounded nonempty RLE runs".into());
    }
    let mut out = Vec::with_capacity(n);
    let mut previous = None;
    for [value, count] in packed.rle {
        if value > 255 || count == 0 || count > n as u64 || previous == Some(value) {
            return Err("canonical byte RLE run".into());
        }
        let end = out
            .len()
            .checked_add(count as usize)
            .ok_or("RLE overflow")?;
        if end > n {
            return Err("RLE exceeds grid".into());
        }
        out.resize(end, value as u8);
        previous = Some(value);
    }
    if out.len() != n {
        return Err("RLE expanded length".into());
    }
    Ok(out)
}
// Preserve typed DTO duplicate-field rejection while expanding the five fixture grids.
struct UniqueValue(serde_json::Value);
impl<'de> Deserialize<'de> for UniqueValue {
    fn deserialize<D: serde::Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        use serde::de::{Error, MapAccess, SeqAccess, Visitor};
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = UniqueValue;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("bounded JSON with unique object keys")
            }
            fn visit_unit<E: Error>(self) -> Result<Self::Value, E> {
                Ok(UniqueValue(serde_json::Value::Null))
            }
            fn visit_bool<E: Error>(self, v: bool) -> Result<Self::Value, E> {
                Ok(UniqueValue(v.into()))
            }
            fn visit_i64<E: Error>(self, v: i64) -> Result<Self::Value, E> {
                Ok(UniqueValue(v.into()))
            }
            fn visit_u64<E: Error>(self, v: u64) -> Result<Self::Value, E> {
                Ok(UniqueValue(v.into()))
            }
            fn visit_f64<E: Error>(self, v: f64) -> Result<Self::Value, E> {
                serde_json::Number::from_f64(v)
                    .map(|n| UniqueValue(n.into()))
                    .ok_or_else(|| E::custom("finite JSON number"))
            }
            fn visit_str<E: Error>(self, v: &str) -> Result<Self::Value, E> {
                self.visit_string(v.into())
            }
            fn visit_string<E: Error>(self, v: String) -> Result<Self::Value, E> {
                if v.len() > 4096 {
                    return Err(E::custom("bounded fixture string"));
                }
                Ok(UniqueValue(v.into()))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
                let mut out = Vec::new();
                while let Some(v) = a.next_element::<UniqueValue>()? {
                    if out.len() >= R.size * R.size {
                        return Err(A::Error::custom("bounded fixture sequence"));
                    }
                    out.push(v.0);
                }
                Ok(UniqueValue(out.into()))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
                let mut out = serde_json::Map::new();
                while let Some(k) = a.next_key::<String>()? {
                    if out.len() >= 64 || k.len() > 256 || out.contains_key(&k) {
                        return Err(A::Error::custom("bounded unique fixture object keys"));
                    }
                    let v = a.next_value::<UniqueValue>()?;
                    out.insert(k, v.0);
                }
                Ok(UniqueValue(out.into()))
            }
        }
        de.deserialize_any(V)
    }
}
fn packed_map<'de, D: serde::Deserializer<'de>>(de: D) -> Result<GameMapData, D::Error> {
    use serde::de::Error;
    let mut value = UniqueValue::deserialize(de)?.0;
    for key in [
        "tiles",
        "terrain",
        "regionGrid",
        "territoryGrid",
        "featureGrid",
    ] {
        let layer = value
            .get_mut(key)
            .ok_or_else(|| D::Error::custom(format!("missing {key}")))?;
        let bytes = unpack_grid(layer.take()).map_err(D::Error::custom)?;
        *layer = serde_json::json!(bytes);
    }
    serde_json::from_value(value).map_err(D::Error::custom)
}
#[test]
fn packed_layers_reject_malformed_or_ambiguous_runs() {
    use serde_json::json;
    let n = R.size * R.size;
    assert_eq!(unpack_grid(json!({"rle":[[0,n]]})).unwrap(), vec![0; n]);
    for invalid in [
        json!({"rle":[]}),
        json!({"rle":[[0,n]],"ignored":true}),
        json!({"rle":[[0,0],[1,n]]}),
        json!({"rle":[[256,n]]}),
        json!({"rle":[[0,n+1]]}),
        json!({"rle":[[0,n-1]]}),
        json!({"rle":[[0,n],[1,1]]}),
        json!({"rle":[[0,1],[0,n-1]]}),
        json!({"rle":[[0,n,9]]}),
        json!({"rle":[[-1,n]]}),
        json!({"rle":[[0,1.5]]}),
        json!({"rle":[[0,u64::MAX]]}),
        json!(null),
        json!([0]),
    ] {
        assert!(unpack_grid(invalid.clone()).is_err(), "{invalid}");
    }
}
fn fixture() -> Capture {
    serde_json::from_str(include_str!("../fixtures/map-certify.json")).unwrap()
}
fn structure(f: &Capture) -> Result<(), String> {
    let names: Vec<String> = (0..200)
        .map(|seed| format!("generated-{seed}-strict"))
        .chain(super::inventory::CONTROLS.iter().map(|s| s.to_string()))
        .collect();
    if f.format != "rh-map-certify/1"
        || f.node != "v22.23.4"
        || f.platform != "linux"
        || f.arch != "x64"
        || !f.input_unchanged
        || f.source_seed_count != 200
    {
        return Err("runtime/scope".into());
    }
    if f.inventory != names || f.cases.iter().map(|c| c.name.clone()).collect::<Vec<_>>() != names {
        return Err("exact case inventory".into());
    }
    if f.hard_rules
        != labels::LABELS
            .iter()
            .map(|(id, _)| id.to_string())
            .collect::<Vec<_>>()
    {
        return Err("exact rule inventory".into());
    }
    let sha = |s: &str| {
        s.len() == 64
            && s.bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    };
    if !sha(&f.oracle_sha256)
        || f.provenance.is_empty()
        || f.provenance.iter().any(|p| !sha(&p.sha256))
        || f.provenance
            .iter()
            .map(|p| p.path.as_str())
            .collect::<Vec<_>>()
            != super::inventory::SOURCES
        || ![
            "packages/shared/src/mapgen.ts",
            "packages/shared/src/terrain.ts",
            "packages/shared/test/mapCertify.ts",
        ]
        .iter()
        .all(|name| f.provenance.iter().any(|p| p.path == *name))
    {
        return Err("source provenance".into());
    }
    let mut covered = vec![false; labels::LABELS.len()];
    for c in &f.cases {
        for failure in &c.failures {
            let mut recognized = false;
            for (k, (_, label)) in labels::LABELS.iter().enumerate() {
                let labels: Vec<String> = if label.contains("{subject}") {
                    c.map
                        .camps
                        .iter()
                        .map(|c| c.id.as_str())
                        .chain(ZONES.iter().map(|z| z.as_str()))
                        .map(|subject| label.replace("{subject}", subject))
                        .collect()
                } else {
                    vec![label.to_string()]
                };
                if labels
                    .iter()
                    .any(|label| failure == label || failure.starts_with(&format!("{label}: ")))
                {
                    covered[k] = true;
                    recognized = true;
                }
            }
            if !recognized {
                return Err(format!("unknown source diagnostic {failure}"));
            }
        }
    }
    for (k, (id, _)) in labels::LABELS.iter().enumerate() {
        if *id != "grid-layers" && !covered[k] {
            return Err(format!("unexercised hard rule {id}"));
        }
    }
    for rule in [
        "T2 ", "T3 ", "T4 ", "T5 ", "T6 ", "T7 ", "T8 ", "T9 ", "T10 ", "T11 ",
    ] {
        if !f
            .cases
            .iter()
            .flat_map(|c| &c.failures)
            .any(|f| f.starts_with("terrain: validateTerrain clean") && f.contains(rule))
        {
            return Err(format!("unexercised terrain rule {rule}"));
        }
    }
    for (i, c) in f.cases.iter().enumerate() {
        let origin = if i < 200 {
            "actual-certifiedMap"
        } else if c.name.starts_with("mode-fault-") {
            "controlled-fire-ownership-fault-mode-comparison"
        } else if c.name.starts_with("mode-") {
            "actual-certifiedMap-0-option-control"
        } else {
            "controlled-mutation-of-actual-certifiedMap-0"
        };
        if c.origin != origin {
            return Err(format!("origin {}", c.name));
        }
        if i < 200
            && (c.map.seed != i as i64
                || !c.failures.is_empty()
                || c.strict_zones != [1, 2, 3, 4, 5]
                || c.expect.is_some())
        {
            return Err("nonempty genuine seed inventory".into());
        }
        if let Some(target) = &c.expect {
            if target.is_empty() || !c.failures.iter().any(|f| f.starts_with(target)) {
                return Err(format!("ineffective fault {}", c.name));
            }
        } else if i >= 200 && !c.name.starts_with("mode-") {
            return Err("missing fault target".into());
        }
    }
    Ok(())
}
fn compare(c: &Case, got: &Certificate) -> Result<(), String> {
    let actual: Vec<_> = got.failures.iter().map(|f| f.message.clone()).collect();
    if got.strict_zones != c.strict_zones || actual != c.failures {
        return Err(format!(
            "{}\nnative {:?}\nsource {:?}",
            c.name, actual, c.failures
        ));
    }
    Ok(())
}
#[test]
fn source_maps_and_controlled_faults() {
    let f = fixture();
    structure(&f).unwrap();
    for c in &f.cases {
        let before = c.map.clone();
        let got = certify(&c.map, &c.options.native()).unwrap();
        assert_eq!(c.map, before, "read-only certificate input");
        compare(c, &got).unwrap();
    }
}
#[test]
fn fixture_inventories_and_full_diagnostics_reject_tampering() {
    let mut f = fixture();
    structure(&f).unwrap();
    let saved = f.inventory.pop().unwrap();
    assert!(structure(&f).is_err());
    f.inventory.push(saved);
    let saved = f.cases.pop().unwrap();
    assert!(structure(&f).is_err());
    f.cases.push(saved);
    f.cases.swap(0, 1);
    assert!(structure(&f).is_err());
    f.cases.swap(0, 1);
    let saved = f.hard_rules.pop().unwrap();
    assert!(structure(&f).is_err());
    f.hard_rules.push(saved);
    f.cases[1].map.seed = 0;
    assert!(structure(&f).is_err());
    f.cases[1].map.seed = 1;
    structure(&f).unwrap();
    let original = f
        .cases
        .iter()
        .find(|c| c.name == "camp-multiple-distinct-areas")
        .unwrap();
    let got = certify(&original.map, &original.options.native()).unwrap();
    compare(original, &got).unwrap();
    let mut case = original.clone();
    case.failures.clear();
    assert!(compare(&case, &got).is_err());
    case = original.clone();
    case.failures.remove(0);
    assert!(compare(&case, &got).is_err());
    case = original.clone();
    case.failures.push(case.failures[0].clone());
    assert!(compare(&case, &got).is_err());
    case = original.clone();
    case.failures.swap(0, 1);
    assert!(compare(&case, &got).is_err());
    case = original.clone();
    case.failures[0] = case.failures[0].replace(" vs ", " vs 9");
    assert!(compare(&case, &got).is_err());
    case = original.clone();
    case.failures[0] = case.failures[1].clone();
    assert!(compare(&case, &got).is_err());
    let mut unknown = serde_json::to_value(&original.map).unwrap();
    unknown["ignored"] = true.into();
    assert!(serde_json::from_value::<GameMapData>(unknown).is_err());
    let mut null: serde_json::Value =
        serde_json::from_str(include_str!("../fixtures/map-certify.json")).unwrap();
    null["cases"][0]["failures"] = serde_json::Value::Null;
    assert!(serde_json::from_value::<Capture>(null).is_err());
}
#[test]
fn malformed_inputs_are_bounded_and_typed() {
    let base: MapExport =
        serde_json::from_str(include_str!("../../mapdata/fixtures/seed1.map.json")).unwrap();
    let base = base.map;
    let o = Options {
        zone: true,
        strict: Strict::All,
        styled: true,
    };
    let mut excessive = o.clone();
    excessive.strict = Strict::Zones(vec![Zone::Fire; R.max_strict_codes + 1]);
    assert_eq!(certify(&base, &excessive), Err(Refusal::Budget));
    let mut m = base.clone();
    m.w = u32::MAX;
    assert_eq!(certify(&m, &o), Err(Refusal::Dimensions));
    let mut m = base.clone();
    m.feature_grid.pop();
    assert_eq!(certify(&m, &o), Err(Refusal::Layers));
    let mut m = base.clone();
    m.coliseum.centre.x = f64::NAN;
    assert_eq!(certify(&m, &o), Err(Refusal::Coordinates));
    let mut m = base.clone();
    m.camps[0].r = R.tile * (R.max_camp_radius_tiles + 1.0);
    assert_eq!(certify(&m, &o), Err(Refusal::Coordinates));
    let mut m = base.clone();
    m.features[0].bbox.w = u32::MAX;
    assert_eq!(certify(&m, &o), Err(Refusal::Rectangle));
    let mut m = base.clone();
    m.camps.resize(256, m.camps[0].clone());
    assert_eq!(certify(&m, &o), Err(Refusal::Budget));
    let mut m = base.clone();
    m.coliseum.gates[0].tiles[0].x = i32::MIN;
    assert_eq!(certify(&m, &o), Err(Refusal::Coordinates));
    // Inputs the JS certifier cannot survive still produce bounded diagnostic results here.
    let mut m = base.clone();
    m.coliseum.gates[0].tiles.clear();
    assert!(certify(&m, &o)
        .unwrap()
        .failures
        .iter()
        .any(|f| f.rule == "gates"));
    let mut m = base.clone();
    m.features[0].p = vec![0, 0, i32::MAX, i32::MIN];
    assert!(certify(&m, &o)
        .unwrap()
        .failures
        .iter()
        .any(|f| f.rule == "feature-landmark"));
    let mut m = base.clone();
    m.terrain[1000] = 255;
    assert!(certify(&m, &o)
        .unwrap()
        .failures
        .iter()
        .any(|f| f.rule == "terrain-validator"));
    let mut m = base;
    m.ground_spots[0] = point(16.0, 16.0);
    assert!(certify(&m, &o)
        .unwrap()
        .failures
        .iter()
        .any(|f| f.rule == "ground"));
}
#[test]
fn rule_content_visitation_is_stable_nonempty_and_uses_runtime_tables() {
    let mut a = Vec::new();
    rules::visit_content(|w| a.push(w));
    let mut b = Vec::new();
    rules::visit_content(|w| b.push(w));
    assert_eq!(a, b);
    assert!(a.len() > 200);
    assert_eq!(rules::KINDS.len(), 13);
    assert_eq!(rules::TERRAIN.len(), 8);
    assert_eq!(rules::PROP_CLASSES.len(), 34);
    assert_eq!(rules::LANDMARKS.len(), 5);
    let mut count = 0;
    let mut fold = 0u64;
    rules::visit_content(|w| {
        count += 1;
        fold = fold.wrapping_mul(31) ^ w;
    });
    assert_eq!(count, a.len());
    assert_ne!(fold, 0);
}

#[test]
fn diagnostic_fixed_decimal_uses_ecmascript_ties() {
    for (x, d, want) in [
        (1.125, 2, "1.13"),
        (-1.125, 2, "-1.13"),
        (2.675, 2, "2.67"),
        (-0.0, 2, "0.00"),
        (f64::INFINITY, 4, "Infinity"),
        (f64::NAN, 4, "NaN"),
    ] {
        assert_eq!(diagnostics::fixed(x, d), want);
    }
}

#[test]
fn packed_map_preserves_recursive_duplicate_field_rejection() {
    for text in [
        r#"{"tiles":{"rle":[[0,25600]]},"tiles":{"rle":[[1,25600]]}}"#,
        r#"{"tiles":{"rle":[[0,25600]],"rle":[[1,25600]]}}"#,
        r#"{"pole":{"x":1,"x":2,"y":3}}"#,
    ] {
        assert!(serde_json::from_str::<UniqueValue>(text).is_err());
    }
    assert!(serde_json::from_str::<UniqueValue>(r#"{"pole":{"x":1,"y":3}}"#).is_ok());
}

#[test]
fn independent_partial_scope_and_decimal_review_controls() {
    let f = fixture();
    let base = &f.cases[0].map;
    for (name, expected) in super::review_expected::EXPECTED {
        let mut m = base.clone();
        let mut strict = Strict::All;
        let find = |m: &GameMapData, kind| m.features.iter().position(|f| f.kind == kind).unwrap();
        let owned = |m: &GameMapData, k| {
            m.feature_grid
                .iter()
                .enumerate()
                .filter_map(|(i, v)| (*v as usize == k + 1).then_some(i))
                .collect::<Vec<_>>()
        };
        match *name {
            "kind-class-partial-cross-zone" => {
                let k = find(&m, FeatureKind::Mere);
                let cells = owned(&m, k);
                m.tiles[cells[0]] = 1;
                m.tiles[cells[1]] = 1;
                m.region_grid[cells[0]] = 1;
                strict = Strict::Zones(vec![Zone::Frost]);
            }
            "kind-terrain-partial-cross-zone" => {
                let k = find(&m, FeatureKind::FenceRow);
                let cells = owned(&m, k)
                    .into_iter()
                    .filter(|i| m.tiles[*i] == 2)
                    .collect::<Vec<_>>();
                m.terrain[cells[0]] = 1;
                m.terrain[cells[1]] = 1;
                m.region_grid[cells[0]] = 1;
                strict = Strict::Zones(vec![Zone::Sentenced]);
            }
            "whole-partial-cross-zone" => {
                let k = find(&m, FeatureKind::Gallows);
                let i = owned(&m, k).into_iter().find(|i| m.tiles[*i] == 1).unwrap();
                m.region_grid[i] = 1;
                strict = Strict::Zones(vec![Zone::Sentenced]);
            }
            "mere-ice-partial-cross-zone" => {
                let k = find(&m, FeatureKind::Mere);
                let i = owned(&m, k)
                    .into_iter()
                    .find(|i| m.terrain[*i] == 6)
                    .unwrap();
                m.region_grid[i] = 1;
                strict = Strict::Zones(vec![Zone::Frost]);
            }
            "camp-spacing-half-round" => {
                m.camps[1].x = m.camps[0].x + 36.0;
                m.camps[1].y = m.camps[0].y;
            }
            "spawn-spacing-half-round" => {
                m.spawn_pool[1].x = m.spawn_pool[0].x + 36.0;
                m.spawn_pool[1].y = m.spawn_pool[0].y;
            }
            "duplicate-strict-failing-pieces" => {
                m.tiles[tile(cp(&m.camps[0]))] = 1;
                strict = Strict::Zones(vec![Zone::Fire, Zone::Holy, Zone::Fire]);
            }
            "sixth-region-area-diagnostic" => {
                let mut r = m.regions[0].clone();
                r.pole = m.coliseum.centre;
                r.area = 0;
                m.regions.push(r);
                m.spawns.clear();
                for n in 0..m.spawn_pool.len() {
                    if m.spawns.len() >= m.spawn_pool.len() {
                        break;
                    }
                    for r in &m.regions {
                        if let Some(p) = r.spawns.get(n) {
                            m.spawns.push(*p);
                        }
                    }
                }
                m.crate_spots = m
                    .regions
                    .iter()
                    .flat_map(|r| r.chest_spots.iter().copied())
                    .collect();
            }
            "fifth-gate-tile-widening" => {
                let first = m.coliseum.gates[0].tiles[0];
                m.coliseum.gates[0].tiles.push(first);
                m.tiles[at(first.x - 1, first.y - 1).unwrap()] = 1;
            }
            "empty-pool-ratio" => m.spawn_pool.clear(),
            _ => panic!("unknown review case"),
        }
        let got = certify(
            &m,
            &Options {
                zone: true,
                styled: false,
                strict,
            },
        )
        .unwrap();
        assert_eq!(
            got.failures
                .iter()
                .map(|f| f.message.as_str())
                .collect::<Vec<_>>(),
            *expected,
            "{name}"
        );
    }
}

#[test]
fn source_options_refuse_null_instead_of_silently_defaulting() {
    for input in [
        r#"{"zone":null}"#,
        r#"{"styled":null}"#,
        r#"{"strict":null}"#,
        r#"{"strict":[null]}"#,
        r#"{"strict":"all"}"#,
        r#"{"zone":true,"ignored":false}"#,
    ] {
        assert!(serde_json::from_str::<SourceOptions>(input).is_err());
    }
    assert!(serde_json::from_str::<SourceOptions>("{}").is_ok());
}
