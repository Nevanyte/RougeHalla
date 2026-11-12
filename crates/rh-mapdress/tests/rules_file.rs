//! The rule file: the starter parses and has the shape the property tests rely on; a malformed file is refused with a
//! message naming the rule.
use rh_mapdress::Rules;
use rh_sim::mapdata::Zone;
use serde_json::{json, Value};

const STARTER: &str = include_str!("../rules/zones.json");
const ZONES: [Zone; 5] = [
    Zone::Fire,
    Zone::Sentenced,
    Zone::Plague,
    Zone::Frost,
    Zone::Holy,
];

fn starter_json() -> Value {
    serde_json::from_str(STARTER).unwrap()
}

fn refused(v: &Value) -> String {
    match Rules::from_json(&v.to_string()) {
        Ok(_) => panic!("a malformed rule file was accepted"),
        Err(e) => e,
    }
}

#[test]
fn the_starter_file_parses_and_covers_every_stage_of_every_zone() {
    let r = Rules::starter();
    for zone in ZONES {
        let z = r.zone(zone).unwrap_or_else(|| panic!("{zone:?} has rules"));
        assert!(z.rings.len() >= 2, "{zone:?}: signature rings");
        assert!(!z.clusters.is_empty(), "{zone:?}: clusters");
        assert!(!z.edges.is_empty(), "{zone:?}: edges");
        assert!(!z.fillers.is_empty(), "{zone:?}: filler");
        for w in z.rings.windows(2) {
            assert!(w[0].outer <= w[1].inner, "{zone:?}: rings overlap");
        }
    }
}

#[test]
fn each_rule_owns_its_kinds_and_filler_is_flat() {
    let r = Rules::starter();
    let mut owner: Vec<(u8, String)> = Vec::new();
    for z in &r.zones {
        let mut claim = |kinds: Vec<u8>, rule: &str| {
            for k in kinds {
                if let Some((_, other)) = owner.iter().find(|(c, _)| *c == k) {
                    panic!("kind {k} is used by both {other} and {rule}");
                }
                owner.push((k, rule.to_string()));
            }
        };
        for x in &z.rings {
            claim(x.props.iter().map(|p| p.kind).collect(), &x.name);
        }
        for x in &z.clusters {
            claim(x.kinds.clone(), &x.name);
        }
        for x in &z.edges {
            claim(x.kinds.clone(), &x.name);
        }
        for x in &z.fillers {
            claim(x.kinds.clone(), &x.name);
            assert!(x.kinds.iter().all(|k| !r.is_tall(*k)), "{} is tall", x.name);
        }
    }
}

#[test]
fn tall_kinds_match_the_art_that_unity_fades() {
    // RegionProps.cs: pine, pine2, tree, palm, spire, stump, deadtree, scarecrow, column, pillar are tall.
    let r = Rules::starter();
    for k in &r.kinds {
        let tail = k.name.rsplit('.').next().unwrap();
        let tall = [
            "pine",
            "pine2",
            "tree",
            "palm",
            "spire",
            "stump",
            "deadtree",
            "scarecrow",
            "column",
            "pillar",
        ]
        .contains(&tail);
        assert_eq!(k.tall, tall, "{}", k.name);
    }
    assert_eq!(r.kind_code("fire.spire").map(|c| r.is_tall(c)), Some(true));
    assert_eq!(r.kind_code("fire.rocks").map(|c| r.is_tall(c)), Some(false));
    assert_eq!(r.kind_code("no.such.kind"), None);
}

#[test]
fn an_unknown_kind_is_refused_naming_the_rule_and_the_kind() {
    let mut v = starter_json();
    v["zones"]["fire"]["signature"]["rings"][0]["props"][0]["kind"] = json!("fire.nope");
    let e = refused(&v);
    assert!(
        e.contains("fire-ring-core") && e.contains("fire.nope"),
        "{e}"
    );
    let mut v = starter_json();
    v["zones"]["holy"]["clusters"][0]["kinds"] = json!(["holy.palm", "holy.missing"]);
    let e = refused(&v);
    assert!(
        e.contains("holy-palm-grove") && e.contains("holy.missing"),
        "{e}"
    );
}

#[test]
fn a_ring_with_inner_not_below_outer_is_refused_naming_the_rule() {
    for (inner, outer) in [(6.0, 6.0), (9.0, 4.0)] {
        let mut v = starter_json();
        v["zones"]["frost"]["signature"]["rings"][1]["inner"] = json!(inner);
        v["zones"]["frost"]["signature"]["rings"][1]["outer"] = json!(outer);
        let e = refused(&v);
        assert!(e.contains("frost-ring-field"), "{e}");
    }
}

#[test]
fn a_negative_density_is_refused_naming_the_rule() {
    let mut v = starter_json();
    v["zones"]["plague"]["signature"]["rings"][0]["props"][0]["density"] = json!(-0.5);
    assert!(refused(&v).contains("plague-ring-court"));
    let mut v = starter_json();
    v["zones"]["sentenced"]["edges"][0]["density"] = json!(-1);
    assert!(refused(&v).contains("sent-lantern-edge"));
    let mut v = starter_json();
    v["zones"]["fire"]["filler"][0]["density"] = json!(-3.0);
    assert!(refused(&v).contains("fire-ash-filler"));
}

#[test]
fn other_malformed_files_are_refused() {
    let mut v = starter_json();
    v["zones"]["fire"]["clusters"][0]["clearing"] = json!(1.5);
    assert!(refused(&v).contains("fire-rock-field"));
    let mut v = starter_json();
    v["zones"]["fire"]["clusters"][0]["radius"] = json!(0);
    assert!(refused(&v).contains("fire-rock-field"));
    let mut v = starter_json();
    v["zones"]["holy"]["filler"][0]["name"] = json!("holy-flower-edge");
    assert!(refused(&v).contains("holy-flower-edge"));
    let mut v = starter_json();
    v["kinds"]["fire.crystal"]["code"] = json!(1);
    assert!(refused(&v).contains("fire.crystal"));
    let mut v = starter_json();
    v["zones"]["swamp"] = v["zones"]["fire"].clone();
    assert!(refused(&v).contains("swamp"));
    assert!(Rules::from_json("{").is_err());
}
