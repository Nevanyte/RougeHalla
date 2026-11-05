use super::*;
#[test]
fn fixed_boundaries() {
    assert_eq!(dir_index16(0.0, 0.0), 0);
    assert!(pseudo_angle(0.0, 0.0).is_nan());
    assert!(disc_offsets(-1).is_empty());
    assert_eq!(
        disc_offsets(4),
        vec![[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]]
    );
    assert!(!in_beam(0.0, 0.0, 1.0, 0.0, 4.0));
    assert_eq!(seg_dist2(1.0, 1.0, 0.0, 0.0, 2.0, 0.0), 1.0);
}
use serde_json::{json, Value};
fn fixture() -> Value {
    let raw = include_str!("../fixtures/style-features.json");
    let value = serde_json::from_str(raw).unwrap();
    validate_fixture(&value).unwrap();
    assert_eq!(
        fixture_digest(raw.as_bytes()),
        FIXTURE_DIGEST,
        "canonical fixture bytes changed; recapture and review"
    );
    value
}
fn ints(v: &Value) -> Vec<i32> {
    serde_json::from_value(v.clone()).unwrap()
}
fn bytes(v: &Value) -> Vec<u8> {
    serde_json::from_value(v.clone()).unwrap()
}
fn num(v: &Value) -> f64 {
    v.as_f64().unwrap()
}
fn signed(v: &Value) -> isize {
    isize::try_from(v.as_i64().unwrap()).unwrap()
}
fn usize_(v: &Value) -> usize {
    usize::try_from(v.as_u64().unwrap()).unwrap()
}
#[test]
fn complete_source_cases() {
    let f = fixture();
    let r = default_definition();
    let cases = f["cases"].as_array().unwrap();
    let mut counts = std::collections::BTreeMap::new();
    for c in cases {
        let name = c["name"].as_str().unwrap();
        *counts.entry(name).or_insert(0) += 1;
        let a = c["input"].as_array().unwrap();
        let mut mutation = Value::Null;
        let output = match name {
            "dirIndex16" => json!(dir_index16(num(&a[0]), num(&a[1]))),
            "segDist2" => json!(seg_dist2(
                num(&a[0]),
                num(&a[1]),
                num(&a[2]),
                num(&a[3]),
                num(&a[4]),
                num(&a[5])
            )),
            "discOffsets" => json!(disc_offsets(i32_(&a[0]))),
            "inBeam" => json!(in_beam(
                num(&a[0]),
                num(&a[1]),
                num(&a[2]),
                num(&a[3]),
                num(&a[4])
            )),
            "pseudoAngle" => json!(pseudo_angle(num(&a[0]), num(&a[1]))),
            "primMST" => json!(prim_mst(
                &serde_json::from_value::<Vec<Node>>(a[0].clone()).unwrap(),
                signed(&a[1])
            )),
            "rngEdges" => json!(rng_edges(
                &serde_json::from_value::<Vec<Node>>(a[0].clone()).unwrap()
            )),
            "addShortcuts" => {
                let nodes: Vec<Node> = serde_json::from_value(a[0].clone()).unwrap();
                let mut edges: Vec<Edge> = serde_json::from_value(a[1].clone()).unwrap();
                let out = add_shortcuts(&nodes, &mut edges, usize_(&a[2]), num(&a[3]), num(&a[4]));
                mutation = json!(edges);
                json!(out)
            }
            "cyclomatic" => json!(cyclomatic(
                usize_(&a[0]),
                &serde_json::from_value::<Vec<Edge>>(a[1].clone()).unwrap()
            )),
            "chamferFrom" => json!(chamfer_from(&ints(&a[0]), usize_(&a[1]), usize_(&a[2]), &r)),
            "majoritySmooth" => json!(majority_smooth(
                &bytes(&a[0]),
                &bytes(&a[1]),
                usize_(&a[2]),
                usize_(&a[3]),
                usize_(&a[4]),
                if a[5].is_null() {
                    None
                } else {
                    Some(i32_(&a[5]))
                },
                &r
            )),
            "componentsOf" => {
                let out = components_of(
                    &bytes(&a[0]),
                    usize_(&a[1]),
                    usize_(&a[2]),
                    a[3].as_bool().unwrap(),
                );
                json!({"label":out.label,"sizes":out.sizes})
            }
            "pruneSmall" => {
                let mut set = bytes(&a[0]);
                let out = prune_small(
                    &mut set,
                    usize_(&a[1]),
                    usize_(&a[2]),
                    usize_(&a[3]),
                    a[4].as_bool().unwrap(),
                );
                mutation = json!(set);
                json!(out)
            }
            "floodAbove" => {
                let out = flood_above(
                    &ints(&a[0]),
                    i32_(&a[1]),
                    signed(&a[2]),
                    &bytes(&a[3]),
                    usize_(&a[4]),
                    usize_(&a[5]),
                );
                json!({"set":out.set,"size":out.size})
            }
            "tauForArea" => json!(tau_for_area(
                &ints(&a[0]),
                signed(&a[1]),
                &bytes(&a[2]),
                usize_(&a[3]),
                usize_(&a[4]),
                usize_(&a[5])
            )),
            "viterbiRows" => json!(viterbi_rows(
                &ints(&a[0]),
                i32_(&a[1]),
                i32_(&a[2]),
                i32_(&a[3]),
                i32_(&a[4]),
                num(&a[5])
            )),
            _ => panic!("unknown case {name}"),
        };
        if let Some(bits) = c["outputBits"].as_str() {
            let n = output.as_f64().unwrap();
            assert_eq!(format!("{:016x}", n.to_bits()), bits, "scalar bits {name}");
        }
        assert!(
            same(&output, &c["output"]),
            "{name} {a:?}: {output} != {}",
            c["output"]
        );
        assert_eq!(mutation, c["mutation"], "mutation {name}");
    }
    assert_eq!(counts.len(), 16);
}
#[test]
fn complete_noise_search_and_callback_order() {
    let f = fixture();
    let r = default_definition();
    for c in f["noises"].as_array().unwrap() {
        let noise = Noise {
            stream_seed: u32_(&c["stream"]),
        };
        let a = c["args"].as_array().unwrap();
        let q = noise_q(&noise, num(&a[0]), num(&a[1]), num(&a[2]), num(&a[4]));
        let fbm = fbm_q(
            &noise,
            num(&a[0]),
            num(&a[1]),
            num(&a[2]),
            u32_(&a[3]),
            num(&a[4]),
        );
        assert!(same(&json!(q), &c["q"]));
        assert!(same(&json!(fbm), &c["fbm"]))
    }
    for c in f["paths"].as_array().unwrap() {
        let mask = bytes(&c["mask"]);
        let hard = bytes(&c["hard"]);
        let tiles = bytes(&c["tiles"]);
        let costs = ints(&c["costs"]);
        let noise = Noise {
            stream_seed: u32_(&c["stream"]),
        };
        let ctx = PathSource {
            w: usize_(&c["w"]),
            h: usize_(&c["h"]),
            mask: &mask,
            hard: &hard,
            tiles: &tiles,
            noise: &noise,
        };
        let mut calls = Vec::new();
        let mut callback = |i| {
            calls.push(i);
            costs[i]
        };
        let p = noisy_path(
            &ctx,
            usize_(&c["a"]),
            usize_(&c["b"]),
            num(&c["salt"]),
            PathCost::Callback(&mut callback),
            &r,
        );
        assert_eq!(json!(p), c["output"]);
        assert_eq!(json!(calls), c["calls"]);
        let p = noisy_path(
            &ctx,
            usize_(&c["a"]),
            usize_(&c["b"]),
            num(&c["salt"]),
            PathCost::Map(&costs),
            &r,
        );
        assert_eq!(json!(p), c["output"]);
        let plain = noisy_path(
            &ctx,
            usize_(&c["a"]),
            usize_(&c["b"]),
            num(&c["salt"]),
            PathCost::None,
            &r,
        );
        assert_eq!(json!(plain), c["plainOutput"]);
    }
    for c in f["viterbi"].as_array().unwrap() {
        let n = usize_(&c["n"]);
        let half = i8_(&c["half"]);
        let cost = ints(&c["cost"]);
        let mut calls = Vec::new();
        let p = viterbi_path(
            n,
            half,
            |s, dt| {
                calls.push([s as i32, i32::from(dt)]);
                cost[s * (2 * half as usize + 1) + (i32::from(dt) + i32::from(half)) as usize]
            },
            num(&c["jog"]),
        );
        assert_eq!(json!(p), c["output"]);
        assert_eq!(json!(calls), c["calls"]);
    }
}

fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            a.as_f64().unwrap().to_bits() == b.as_f64().unwrap().to_bits()
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len() && a.iter().all(|(k, a)| b.get(k).is_some_and(|b| same(a, b)))
        }
        _ => a == b,
    }
}
#[test]
fn sole_numeric_definition_is_complete_and_drives_default() {
    let r = default_definition();
    let f = fixture();
    let d = &f["definitions"];
    assert_eq!(json!(DIR8), f["dir8"]);
    assert_eq!(CHAMFER_FAR, r.chamfer_far);
    assert_eq!(json!(r.chamfer_far), d["chamferFar"]);
    assert_eq!(json!(r.chamfer_orthogonal), d["chamferOrthogonal"]);
    assert_eq!(json!(r.chamfer_diagonal), d["chamferDiagonal"]);
    assert_eq!(json!(r.majority_threshold), d["majorityThreshold"]);
    assert_eq!(json!(r.path_far), d["pathFar"]);
    assert_eq!(json!(r.hard_radius), d["hardRadius"]);
    assert!(same(&json!(r.noise_cell), &d["noiseCell"]));
    assert!(same(&json!(r.noise_scale), &d["noiseScale"]));
    assert_eq!(json!(r.path_orthogonal), d["pathOrthogonal"]);
    assert_eq!(json!(r.path_diagonal), d["pathDiagonal"]);
    assert_eq!(json!(r.hard_penalty), d["hardPenalty"]);
    let words = |d: &Definition| {
        let mut words = Vec::new();
        visit_content(d, |w| words.push(w));
        words
    };
    assert_eq!(words(&r).len(), 11);
    macro_rules! sensitivity{($($field:ident),+)=>{$({let mut changed=r;changed.$field+=1;assert_ne!(words(&changed),words(&r),stringify!($field));})+}}
    sensitivity!(
        chamfer_far,
        chamfer_orthogonal,
        chamfer_diagonal,
        majority_threshold,
        path_far,
        hard_radius,
        path_orthogonal,
        path_diagonal,
        hard_penalty
    );
    for d in [
        Definition {
            noise_cell: r.noise_cell + 1.0,
            ..r
        },
        Definition {
            noise_scale: r.noise_scale + 1.0,
            ..r
        },
    ] {
        assert_ne!(words(&d), words(&r))
    }
    let set = [1, 1, 0, 1, 1, 0, 0, 0, 0];
    let allow = [1; 9];
    let changed = Definition {
        majority_threshold: 4,
        ..r
    };
    assert_ne!(
        majority_smooth(&set, &allow, 3, 3, 1, None, &r),
        majority_smooth(&set, &allow, 3, 3, 1, None, &changed)
    );
}

fn i32_(v: &Value) -> i32 {
    i32::try_from(v.as_i64().unwrap()).unwrap()
}
fn i8_(v: &Value) -> i8 {
    i8::try_from(v.as_i64().unwrap()).unwrap()
}
fn u32_(v: &Value) -> u32 {
    u32::try_from(v.as_u64().unwrap()).unwrap()
}
fn fixture_digest(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |h, &b| {
        (h ^ u64::from(b)).wrapping_mul(0x100000001b3)
    })
}
fn exact_keys(v: &Value, expected: &[&str]) -> Result<(), String> {
    let Some(object) = v.as_object() else {
        return Err("expected object".into());
    };
    let keys: std::collections::BTreeSet<_> = object.keys().map(String::as_str).collect();
    if keys != expected.iter().copied().collect() {
        return Err(format!("unknown/missing keys {keys:?}"));
    }
    Ok(())
}
fn validate_fixture(f: &Value) -> Result<(), String> {
    macro_rules! require {
        ($ok:expr,$message:expr) => {
            if !$ok {
                return Err($message.into());
            }
        };
    }
    exact_keys(
        f,
        &[
            "schema",
            "node",
            "platform",
            "arch",
            "scope",
            "sources",
            "inventory",
            "reused",
            "owned",
            "definitions",
            "dir8",
            "cases",
            "repeatedObservedInputs",
            "noises",
            "paths",
            "viterbi",
            "realCases",
        ],
    )?;
    require!(
        f["schema"] == 1
            && f["node"] == "v22.23.4"
            && f["platform"] == "linux"
            && f["arch"] == "x64",
        "provenance"
    );
    require!(f["repeatedObservedInputs"] == 0, "repeated observations");
    let expected = [
        "dirIndex16",
        "dirSep16",
        "isqrt",
        "dist2",
        "segDist2",
        "discOffsets",
        "inBeam",
        "pseudoAngle",
        "noiseQ",
        "fbmQ",
        "campNodes",
        "primMST",
        "gabrielEdges",
        "rngEdges",
        "addShortcuts",
        "cyclomatic",
        "chamferFrom",
        "argmaxIn",
        "majoritySmooth",
        "componentsOf",
        "pruneSmall",
        "floodAbove",
        "tauForArea",
        "noisyPath",
        "viterbiRows",
        "viterbiPath",
    ];
    require!(f["inventory"] == json!(expected), "function inventory");
    require!(
        f["reused"]
            == json!([
                "dirSep16",
                "isqrt",
                "dist2",
                "campNodes",
                "gabrielEdges",
                "argmaxIn",
                "pseudoAngle"
            ]),
        "reused inventory"
    );
    require!(
        f["owned"]
            == json!([
                "dirIndex16",
                "segDist2",
                "discOffsets",
                "inBeam",
                "noiseQ",
                "fbmQ",
                "primMST",
                "rngEdges",
                "addShortcuts",
                "cyclomatic",
                "chamferFrom",
                "majoritySmooth",
                "componentsOf",
                "pruneSmall",
                "floodAbove",
                "tauForArea",
                "noisyPath",
                "viterbiRows",
                "viterbiPath"
            ]),
        "owned inventory"
    );
    let Some(sources) = f["sources"].as_object() else {
        return Err("sources".into());
    };
    require!(sources.len() == 39, "source inventory");
    for value in sources.values() {
        let Some(hash) = value.as_str() else {
            return Err("source hash type".into());
        };
        require!(
            hash.len() == 64
                && hash
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)),
            "source hash"
        );
    }
    exact_keys(
        &f["definitions"],
        &[
            "chamferFar",
            "chamferOrthogonal",
            "chamferDiagonal",
            "majorityThreshold",
            "pathFar",
            "hardRadius",
            "noiseCell",
            "noiseScale",
            "pathOrthogonal",
            "pathDiagonal",
            "hardPenalty",
        ],
    )?;
    let sections = [
        (
            "cases",
            232,
            &["name", "kind", "input", "output", "outputBits", "mutation"][..],
        ),
        ("noises", 12, &["stream", "args", "q", "fbm"][..]),
        (
            "paths",
            14,
            &[
                "w",
                "h",
                "mask",
                "hard",
                "tiles",
                "stream",
                "costs",
                "a",
                "b",
                "salt",
                "output",
                "plainOutput",
                "calls",
            ][..],
        ),
        (
            "viterbi",
            26,
            &["n", "half", "jog", "cost", "output", "calls"][..],
        ),
        (
            "realCases",
            3,
            &["seed", "attempt", "completeFinalOutputEquality", "hash"][..],
        ),
    ];
    for (section, count, keys) in sections {
        let Some(cases) = f[section].as_array() else {
            return Err(format!("section {section}"));
        };
        require!(cases.len() == count, "section inventory");
        let mut seen = std::collections::BTreeSet::new();
        for case in cases {
            exact_keys(case, keys)?;
            let key = match section {
                "cases" => json!([case["name"], case["kind"], case["input"]]),
                "noises" => json!([case["stream"], case["args"]]),
                "paths" => json!([case["stream"], case["a"], case["b"], case["costs"]]),
                "viterbi" => json!([case["n"], case["half"], case["jog"], case["cost"]]),
                _ => json!([case["seed"], case["attempt"]]),
            };
            require!(seen.insert(key.to_string()), "duplicate fixture entry");
        }
    }
    let cases = f["cases"].as_array().unwrap();
    let mut boundary = 0;
    let mut observed = 0;
    for c in cases {
        match c["kind"].as_str() {
            Some("labelled-boundary") => boundary += 1,
            Some("observed-real-caller") => observed += 1,
            _ => return Err("unknown origin".into()),
        }
        let (name, len) = match c["name"].as_str() {
            Some(name @ ("dirIndex16" | "pseudoAngle")) => (name, 2),
            Some(name @ ("segDist2" | "floodAbove" | "tauForArea" | "viterbiRows")) => (name, 6),
            Some(name @ ("discOffsets" | "rngEdges")) => (name, 1),
            Some(name @ ("inBeam" | "addShortcuts" | "pruneSmall")) => (name, 5),
            Some(name @ ("primMST" | "cyclomatic")) => (name, 2),
            Some(name @ "chamferFrom") => (name, 3),
            Some(name @ "majoritySmooth") => (name, 6),
            Some(name @ "componentsOf") => (name, 4),
            _ => return Err("unknown helper".into()),
        };
        require!(
            c["input"].as_array().is_some_and(|a| a.len() == len),
            "helper input shape"
        );
        if ["primMST", "rngEdges", "addShortcuts"].contains(&name) {
            let Some(nodes) = c["input"][0].as_array() else {
                return Err("nodes".into());
            };
            for n in nodes {
                exact_keys(n, &["x", "y", "kind", "camp", "elite"])?;
            }
        }
    }
    require!(boundary == 205 && observed == 27, "origin inventory");
    for c in f["realCases"].as_array().unwrap() {
        require!(c["completeFinalOutputEquality"] == true, "observer control");
    }
    Ok(())
}
#[test]
fn fixture_inventory_refuses_deletions_duplicates_unknowns() {
    let good = fixture();
    for section in ["cases", "noises", "paths", "viterbi", "realCases"] {
        let mut bad = good.clone();
        bad[section].as_array_mut().unwrap().pop();
        assert!(validate_fixture(&bad).is_err(), "deleted {section}");
        let mut bad = good.clone();
        bad[section][1] = bad[section][0].clone();
        assert!(validate_fixture(&bad).is_err(), "duplicate {section}");
    }
    let mut bad = good.clone();
    bad["cases"][0]["name"] = json!("unknown");
    assert!(validate_fixture(&bad).is_err());
    let mut bad = good.clone();
    bad["cases"][0]["unknown"] = json!(1);
    assert!(validate_fixture(&bad).is_err());
    let mut bad = good.clone();
    bad["cases"][0]["kind"] = json!("unlabelled");
    assert!(validate_fixture(&bad).is_err());
    let mut bad = good;
    bad["unknown"] = json!(0);
    assert!(validate_fixture(&bad).is_err());
    for v in [json!(2147483648_i64), json!(-2147483649_i64)] {
        assert!(std::panic::catch_unwind(|| i32_(&v)).is_err())
    }
    assert!(std::panic::catch_unwind(|| i8_(&json!(128))).is_err());
    assert!(std::panic::catch_unwind(|| u32_(&json!(4294967296_u64))).is_err());
}
const FIXTURE_DIGEST: u64 = 0xb2920835d1411c77;
