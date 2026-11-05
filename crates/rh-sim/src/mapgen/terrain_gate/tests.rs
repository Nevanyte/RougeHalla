use super::*;
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Corpus {
    #[serde(rename = "numericProbes")]
    numeric_probes: Vec<NumericProbe>,
    format: String,
    node: String,
    platform: String,
    arch: String,
    #[serde(rename = "inputUnchanged")]
    input_unchanged: bool,
    provenance: Vec<Source>,
    inventory: Vec<String>,
    rules: Vec<String>,
    cases: Vec<Case>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Source {
    path: String,
    sha256: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Case {
    name: String,
    origin: String,
    map: GameMapData,
    options: CaseOptions,
    problems: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CaseOptions {
    #[serde(default)]
    styled: bool,
    prop_kinds: Option<Vec<CaseProp>>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CaseProp {
    key: String,
    on: u8,
    home: Option<String>,
}
const FIXTURE: &str = include_str!("../fixtures/terrain-gate.json");
fn corpus() -> Corpus {
    serde_json::from_str(FIXTURE).unwrap()
}
#[test]
fn actual_source_ordered_problems() {
    let c = corpus();
    assert_eq!(c.format, "rh-terrain-gate/1");
    assert_eq!(c.node, "v22.23.4");
    assert_eq!(c.platform, "linux");
    assert_eq!(c.arch, "x64");
    assert!(c.input_unchanged);
    assert_eq!(c.cases.len(), 403);
    assert_eq!(
        c.inventory,
        c.cases.iter().map(|c| c.name.clone()).collect::<Vec<_>>()
    );
    assert_eq!(
        c.rules,
        (1..=11).map(|n| format!("T{n}")).collect::<Vec<_>>()
    );
    assert!(c.provenance.len() > 25);
    for p in c.provenance {
        assert!(p.path.starts_with("packages/shared/src/"));
        assert_eq!(p.sha256.len(), 64);
        assert!(p.sha256.bytes().all(|b| b.is_ascii_hexdigit()));
    }
    for case in c.cases {
        assert!(!case.origin.is_empty());
        let props = case.options.prop_kinds.as_ref().map(|p| {
            p.iter()
                .map(|p| {
                    assert!(p.home.is_none());
                    PropKind {
                        key: &p.key,
                        on: p.on,
                        home: None,
                    }
                })
                .collect::<Vec<_>>()
        });
        let options = Options {
            styled: case.options.styled,
            prop_kinds: props.as_deref(),
        };
        let before = case.map.clone();
        assert_eq!(
            validate(&case.map, &options),
            Ok(case.problems),
            "{}",
            case.name
        );
        assert_eq!(case.map, before);
    }
}
#[test]
fn no_stale_topology_or_layers() {
    let mut m = corpus()
        .cases
        .into_iter()
        .find(|c| c.name == "hand-built-accepted")
        .unwrap()
        .map;
    assert!(validate(&m, &Options::default()).unwrap().is_empty());
    m.tiles[10 * 21 + 10] = TILE_WALL;
    assert!(validate(&m, &Options::default())
        .unwrap()
        .iter()
        .any(|p| p == "T7 floor has 2 components with the gates open, expected 1"));
    m.tiles[10 * 21 + 10] = TILE_FLOOR;
    assert!(validate(&m, &Options::default()).unwrap().is_empty());
}
#[test]
fn malformed_inputs_refuse_without_panics() {
    let mut m = corpus().cases[0].map.clone();
    m.w = 0;
    assert_eq!(
        validate(&m, &Options::default()),
        Err(InputError::Dimensions)
    );
    m.w = u32::MAX;
    m.h = u32::MAX;
    assert_eq!(
        validate(&m, &Options::default()),
        Err(InputError::Dimensions)
    );
    let mut m = corpus().cases[0].map.clone();
    m.spawns.push(WorldPt {
        x: f64::NAN,
        y: 0.0,
    });
    assert_eq!(
        validate(&m, &Options::default()),
        Err(InputError::Coordinates)
    );
    let mut m = corpus().cases[0].map.clone();
    m.camps[0].r = f64::INFINITY;
    assert_eq!(
        validate(&m, &Options::default()),
        Err(InputError::Coordinates)
    );
    let mut m = corpus().cases[0].map.clone();
    m.terrain.clear();
    assert!(validate(&m, &Options::default()).unwrap()[0].starts_with("T1 terrain"));
}
#[test]
fn strict_fixture_schema() {
    let mut v: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
    v["cases"][0]["map"]["unexpected"] = true.into();
    assert!(serde_json::from_value::<Corpus>(v).is_err());
    let mut v: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
    v["cases"][0]["map"]
        .as_object_mut()
        .unwrap()
        .remove("terrain");
    assert!(serde_json::from_value::<Corpus>(v).is_err());
}
#[test]
fn definition_is_live_and_identity_is_complete() {
    let c = corpus();
    let m = &c
        .cases
        .iter()
        .find(|c| c.name == "spawn-hazard-5x5")
        .unwrap()
        .map;
    let original = validate(m, &Options::default()).unwrap();
    let mut d = default_definition();
    d.spawn_hazard_half = 1;
    assert_ne!(
        validate_with_definition(m, &Options::default(), &d).unwrap(),
        original
    );
    let mut a = Vec::new();
    visit_content(&default_definition(), |v| a.push(v));
    let mut b = Vec::new();
    visit_content(&d, |v| b.push(v));
    assert_ne!(a, b);
    let mut kinds = rules::KINDS;
    kinds[4].home = Some(5);
    d = default_definition();
    d.kinds = &kinds;
    let m = &c
        .cases
        .iter()
        .find(|c| c.name == "generated-0-styled")
        .unwrap()
        .map;
    assert_ne!(
        validate_with_definition(m, &Options::default(), &d).unwrap(),
        validate(m, &Options::default()).unwrap()
    );
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NumericProbe {
    x_bits: String,
    y_bits: String,
    problems: Vec<String>,
}
#[test]
fn numeric_edge_problems_match_exact_source_messages() {
    let c = corpus();
    assert_eq!(c.numeric_probes.len(), 9);
    let base = c
        .cases
        .iter()
        .find(|case| case.name == "hand-built-accepted")
        .unwrap()
        .map
        .clone();
    for n in c.numeric_probes {
        assert_eq!(n.x_bits.len(), 16);
        assert_eq!(n.y_bits.len(), 16);
        let x_bits = u64::from_str_radix(&n.x_bits, 16).unwrap();
        let y_bits = u64::from_str_radix(&n.y_bits, 16).unwrap();
        let mut map = base.clone();
        map.props.push(crate::mapdata::MapProp {
            kind: 65535,
            x: f64::from_bits(x_bits),
            y: f64::from_bits(y_bits),
            v: 0,
        });
        assert_eq!(
            validate(&map, &Options::default()),
            Ok(n.problems),
            "x={} y={}",
            n.x_bits,
            n.y_bits
        );
        assert_eq!(map.props[0].x.to_bits(), x_bits);
        assert_eq!(map.props[0].y.to_bits(), y_bits);
    }
}

const BASE_INVENTORY: &[&str] = &[
    "generated-0-plain",
    "generated-0-styled",
    "generated-0-decor",
    "generated-1-plain",
    "generated-1-styled",
    "generated-1-decor",
    "exported-1",
    "exported-2",
    "hand-built-accepted",
    "no-regions-accepted",
    "lengths-short-circuit",
    "codes-kinds-classes-count-order",
    "border-top-bottom-order",
    "border-left-right-order",
    "far-low",
    "snap-radius-inclusive",
    "ice-diagonal-orthogonal-edge-count",
    "ice-self-only-class",
    "ice-clear-neighbors",
    "region-and-home-order",
    "open-components",
    "closed-components-zero-gates",
    "closed-out-of-bounds-gates",
    "gate-first",
    "coliseum-low",
    "spawn-pool-region-duplicate-categories",
    "spawn-pool-only",
    "region-spawn-only",
    "inner-spawn-only",
    "spawn-hazard-5x5",
    "spawn-low-kind-hazard-allowed",
    "chest-crate-ground-hazards",
    "chest-out-of-bounds",
    "camp-clearing-and-margin",
    "mob-camp-clearing",
    "camp-fractional-boundary",
    "camp-chest-only",
    "prop-out-of-bounds-before-kind",
    "prop-unknown-kind",
    "prop-standing-class-first",
    "prop-custom-table",
    "prop-empty-table",
    "styled-last",
    "region-early-return-skips-props-styled",
];

#[test]
fn exact_case_and_source_inventory() {
    let c = corpus();
    let mut expected: Vec<String> = BASE_INVENTORY.iter().map(|s| s.to_string()).collect();
    for k in 0..8 {
        for tile in [0, 1, 2, 255] {
            for region in [0, 1, 2, 3, 4, 5, 6, 255] {
                expected.push(format!("matrix-kind-{k}-tile-{tile}-region-{region}"));
            }
        }
    }
    for k in 0..34 {
        for tile in [0, 1, 2] {
            expected.push(format!("matrix-prop-{k}-tile-{tile}"));
        }
    }
    expected.push("camp-fractional-one-ulp-below".into());
    assert_eq!(c.inventory, expected);
    let expected_sources: Vec<&str> = vec![
        "packages/shared/src/abilities.ts",
        "packages/shared/src/bushes.ts",
        "packages/shared/src/coliseum.ts",
        "packages/shared/src/constants.ts",
        "packages/shared/src/detMath.ts",
        "packages/shared/src/factions.ts",
        "packages/shared/src/geometry.ts",
        "packages/shared/src/gridOps.ts",
        "packages/shared/src/gridTopology.ts",
        "packages/shared/src/map.ts",
        "packages/shared/src/mapgen.ts",
        "packages/shared/src/mark.ts",
        "packages/shared/src/messages.ts",
        "packages/shared/src/mobs.ts",
        "packages/shared/src/pathfind.ts",
        "packages/shared/src/planning.ts",
        "packages/shared/src/propKinds.ts",
        "packages/shared/src/rng.ts",
        "packages/shared/src/signatures.ts",
        "packages/shared/src/signatureShares.ts",
        "packages/shared/src/status.ts",
        "packages/shared/src/styler.ts",
        "packages/shared/src/terrain.ts",
        "packages/shared/src/weapons.ts",
        "packages/shared/src/zones.ts",
        "packages/shared/src/zoneStyle/context.ts",
        "packages/shared/src/zoneStyle/features.ts",
        "packages/shared/src/zoneStyle/gallows.ts",
        "packages/shared/src/zoneStyle/hook.ts",
        "packages/shared/src/zoneStyle/kit.ts",
        "packages/shared/src/zoneStyle/landmarks.ts",
        "packages/shared/src/zoneStyle/propKinds.ts",
        "packages/shared/src/zoneStyle/rime.ts",
        "packages/shared/src/zoneStyle/sanctum.ts",
        "packages/shared/src/zoneStyle/scale.ts",
        "packages/shared/src/zoneStyle/scorch.ts",
        "packages/shared/src/zoneStyle/styleZones.ts",
        "packages/shared/src/zoneStyle/types.ts",
        "packages/shared/src/zoneStyle/warren.ts",
    ];
    assert_eq!(
        c.provenance
            .iter()
            .map(|p| p.path.as_str())
            .collect::<Vec<_>>(),
        expected_sources
    );
}

#[test]
fn every_definition_leaf_changes_visitor_identity() {
    fn words(d: &TerrainGateDefinition<'_>) -> Vec<u64> {
        let mut out = Vec::new();
        visit_content(d, |w| out.push(w));
        out
    }
    let original = words(&default_definition());
    for i in 0..rules::KINDS.len() {
        for field in 0..3 {
            let mut kinds = rules::KINDS;
            match field {
                0 => kinds[i].key = "mutated-key",
                1 => kinds[i].tile = Some(255),
                _ => kinds[i].home = Some(255),
            }
            let mut d = default_definition();
            d.kinds = &kinds;
            assert_ne!(words(&d), original, "terrain {i} field {field}");
        }
    }
    for i in 0..rules::PROPS.len() {
        for field in 0..2 {
            let mut props = rules::PROPS;
            if field == 0 {
                props[i].key = "mutated-prop";
            } else {
                props[i].on = 255;
            }
            let mut d = default_definition();
            d.props = &props;
            assert_ne!(words(&d), original, "prop {i} field {field}");
        }
    }
    for field in 0..4 {
        let mut d = default_definition();
        match field {
            0 => d.ice = 7,
            1 => d.spawn_hazard_half = 3,
            2 => d.loot_hazard_half = 2,
            _ => d.camp_hazard_half = 2,
        }
        assert_ne!(words(&d), original, "threshold {field}");
    }
}
