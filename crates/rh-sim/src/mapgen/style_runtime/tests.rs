const OPERATIONS: [&str; 26] = [
    "at",
    "block",
    "canBlock",
    "canSurface",
    "context",
    "corridorOf",
    "featureParam",
    "fenceDetourOk",
    "finishShape",
    "finishZone",
    "guardState",
    "isOwned",
    "isReserved",
    "noise",
    "open",
    "placeFeature",
    "prop",
    "release",
    "reserve",
    "rng",
    "routeGuard",
    "surface",
    "touches",
    "worstMember",
    "worstStretch",
    "zoneFeatures",
];
use super::*;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
fn fields(v: &Value, expected: &[&str]) {
    let got: BTreeSet<_> = v
        .as_object()
        .expect("object")
        .keys()
        .map(String::as_str)
        .collect();
    let expected: BTreeSet<_> = expected.iter().copied().collect();
    assert_eq!(got, expected, "unknown/missing fields");
}
fn eq(a: &Value, b: &Value, label: &str) {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => assert_eq!(a.as_f64(), b.as_f64(), "{label}"),
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{label} length");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                eq(a, b, &format!("{label}[{i}]"));
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len(), "{label} keys");
            for (k, a) in a {
                eq(
                    a,
                    b.get(k).unwrap_or_else(|| panic!("missing {label}.{k}")),
                    &format!("{label}.{k}"),
                );
            }
        }
        _ => assert_eq!(a, b, "{label}"),
    }
}
fn expanded(v: &Value, n: usize) -> Vec<i64> {
    let mut out = Vec::new();
    for pair in v.as_array().expect("RLE") {
        let p = pair.as_array().expect("run");
        assert_eq!(p.len(), 2);
        let val = p[0].as_i64().expect("integer");
        let count = usize::try_from(p[1].as_u64().expect("count")).unwrap();
        assert!(
            out.last().is_none_or(|&prior| prior != val),
            "noncanonical RLE"
        );
        assert!(count > 0 && count <= n - out.len());
        out.extend(std::iter::repeat_n(val, count));
    }
    assert_eq!(out.len(), n);
    out
}
fn bytes(v: &Value, n: usize) -> Vec<u8> {
    expanded(v, n)
        .into_iter()
        .map(|v| u8::try_from(v).unwrap())
        .collect()
}
fn ints(v: &Value, n: usize) -> Vec<i32> {
    expanded(v, n)
        .into_iter()
        .map(|v| i32::try_from(v).unwrap())
        .collect()
}
fn snap(rt: &Runtime<'_>) -> Value {
    json!({"tiles":rt.state.tiles,"terrain":rt.state.terrain,"featureOwner":rt.state.feature_owner,"wrote":rt.state.wrote,"reserved":rt.reserved,"mark":rt.state.scratch.mark,"qa":rt.state.scratch.qa,"qb":rt.state.scratch.qb,"depth":rt.state.scratch.depth,"epoch":rt.state.scratch.epoch,"counters":rt.counters,"features":rt.state.features,"props":rt.state.props})
}
const ARRAYS: [&str; 9] = [
    "tiles",
    "terrain",
    "featureOwner",
    "wrote",
    "reserved",
    "mark",
    "qa",
    "qb",
    "depth",
];
fn unpack(v: &Value, n: usize) -> Value {
    fields(
        v,
        &[
            "tiles",
            "terrain",
            "featureOwner",
            "wrote",
            "reserved",
            "mark",
            "qa",
            "qb",
            "depth",
            "epoch",
            "counters",
            "features",
            "props",
        ],
    );
    let mut out = v.clone();
    for k in ARRAYS {
        out[k] = json!(expanded(&v[k], n));
    }
    out
}
fn patch(expected: &mut Value, p: &Value, n: usize) {
    for (k, v) in p.as_object().unwrap() {
        if ARRAYS.contains(&k.as_str()) {
            let rows = v.as_array().unwrap();
            assert!(!rows.is_empty());
            let mut previous_end = None;
            for row in rows {
                let row = row.as_array().unwrap();
                assert_eq!(row.len(), 2);
                let start = usize::try_from(row[0].as_u64().unwrap()).unwrap();
                let len = row[1]
                    .as_array()
                    .unwrap()
                    .iter()
                    .try_fold(0usize, |sum, p| {
                        let count = usize::try_from(p[1].as_u64()?).ok()?;
                        sum.checked_add(count).filter(|&total| total <= n)
                    })
                    .expect("bounded patch runs");
                assert!(len > 0 && start.checked_add(len).is_some_and(|end| end <= n));
                assert!(
                    previous_end.is_none_or(|end| start > end),
                    "overlapping/adjacent patches"
                );
                previous_end = Some(start + len);
                for (i, x) in expanded(&row[1], len).into_iter().enumerate() {
                    assert_ne!(expected[k][start + i], json!(x), "unchanged patch cell");
                    expected[k][start + i] = json!(x);
                }
            }
        } else {
            assert!(["epoch", "counters", "features", "props"].contains(&k.as_str()));
            expected[k] = v.clone();
        }
    }
}
fn guard_snap(g: &RouteGuard) -> Value {
    let s = serde_json::to_value(g).unwrap();
    let mut s = s.as_object().unwrap().clone();
    for k in ["w", "h", "mask", "cutOff"] {
        assert!(s.remove(k).is_some());
    }
    Value::Object(s)
}
fn unpack_guard(v: &Value, n: usize) -> Value {
    if v.is_null() {
        return Value::Null;
    }
    fields(
        v,
        &[
            "members",
            "base",
            "corridor",
            "perMember",
            "seedTiles",
            "seedValues",
            "worstK",
            "probe",
        ],
    );
    let mut out = v.clone();
    out["corridor"] = json!(expanded(&v["corridor"], n));
    if !v["probe"].is_null() {
        out["probe"] = json!(expanded(&v["probe"], n));
    }
    out
}
fn phase(p: i64) -> Phase {
    match p {
        0 => Phase::Shape,
        1 => Phase::Decor,
        2 => Phase::Surface,
        _ => panic!("unknown stream"),
    }
}
fn replay_zone(
    z: &Value,
    prior: Option<State>,
    meta: Metadata<'_>,
    counts: &mut BTreeMap<String, usize>,
) -> State {
    let unit = z.get("name").is_some();
    fields(
        z,
        if unit {
            &[
                "name", "init", "initial", "events", "final", "report", "guard", "streams",
            ]
        } else {
            &[
                "init", "initial", "events", "final", "report", "guard", "streams",
            ]
        },
    );
    let i = &z["init"];
    fields(
        i,
        &[
            "w",
            "h",
            "seed",
            "attempt",
            "info",
            "mask",
            "hard",
            "noBlock",
            "noProp",
            "edgeDist",
            "territory",
            "camps",
            "spawns",
            "centreWalk",
            "caps",
        ],
    );
    let (w, h) = (
        usize::try_from(i["w"].as_u64().unwrap()).unwrap(),
        usize::try_from(i["h"].as_u64().unwrap()).unwrap(),
    );
    let n = grid_size(w, h).expect("admitted oracle dimensions");
    let initial = unpack(&z["initial"], n);
    let mut expected = initial.clone();
    let mut state = prior.unwrap_or_else(|| {
        State::new(
            w,
            h,
            serde_json::from_value(initial["tiles"].clone()).unwrap(),
            serde_json::from_value(initial["terrain"].clone()).unwrap(),
            serde_json::from_value(initial["props"].clone()).unwrap(),
            serde_json::from_value(initial["features"].clone()).unwrap(),
            serde_json::from_value(initial["featureOwner"].clone()).unwrap(),
        )
        .unwrap()
    });
    let info: crate::mapgen::landmarks::runtime::ZoneInfo =
        serde_json::from_value(i["info"].clone()).unwrap();
    let mask = bytes(&i["mask"], n);
    let zones: Vec<_> = mask
        .iter()
        .map(|&m| if m == 1 { info.index } else { 0 })
        .collect();
    for (index, c) in i["camps"].as_array().unwrap().iter().enumerate() {
        fields(c, &["x", "y", "r", "territory", "elite", "index"]);
        assert_eq!(c["index"], index);
    }
    let camps: Vec<crate::mapgen::landmarks::runtime::CampInfo> =
        serde_json::from_value(i["camps"].clone()).unwrap();
    let camps: Vec<_> = camps
        .iter()
        .map(|c| StyleCamp {
            site: usize::try_from(c.y)
                .unwrap()
                .checked_mul(w)
                .unwrap()
                .checked_add(usize::try_from(c.x).unwrap())
                .unwrap(),
            r: c.r,
            territory: c.territory,
            elite: c.elite,
        })
        .collect();
    let geometry =
        Geometry::new(info.index, info.faction, &zones, &state.tiles, w, h, &camps).unwrap();
    eq(
        &serde_json::to_value(&geometry.info).unwrap(),
        &i["info"],
        "geometry",
    );
    eq(
        &json!(geometry.edge_dist),
        &json!(ints(&i["edgeDist"], n)),
        "edge",
    );
    let hard = bytes(&i["hard"], n);
    let nb = bytes(&i["noBlock"], n);
    let np = bytes(&i["noProp"], n);
    if !unit {
        assert_eq!(nb, no_block(&hard, None).unwrap());
        assert_eq!(np, hard);
    }
    let territory = if i["territory"].is_null() {
        None
    } else {
        Some(bytes(&i["territory"], n))
    };
    let walk = if i["centreWalk"].is_null() {
        None
    } else {
        Some(ints(&i["centreWalk"], n))
    };
    let spawns: Vec<i32> = serde_json::from_value(i["spawns"].clone()).unwrap();
    fields(
        &i["caps"],
        &["joinChecks", "footprintPct", "rimTiles", "fenceDetour"],
    );
    let mut d = DEFAULT_DEFINITION;
    d.join_checks = u32::try_from(i["caps"]["joinChecks"].as_u64().unwrap()).unwrap();
    d.footprint_percent = i["caps"]["footprintPct"].as_f64().unwrap();
    d.rim_tiles = i["caps"]["rimTiles"].as_f64().unwrap();
    d.fence_detour = u16::try_from(i["caps"]["fenceDetour"].as_u64().unwrap()).unwrap();
    let mut rt = Runtime::new(
        &mut state,
        Inputs {
            geometry: &geometry,
            hard: &hard,
            no_block: &nb,
            no_prop: &np,
            territory: territory.as_deref(),
            spawns: &spawns,
            centre_walk: walk.as_deref(),
            seed: i["seed"].as_i64().unwrap(),
            attempt: i["attempt"].as_u64().unwrap(),
        },
        meta,
        &d,
    )
    .unwrap();
    eq(&snap(&rt), &initial, "shared initial");
    let mut streams: [Option<Streams>; 3] = [None, None, None];
    let mut reported_repaired = 0;
    for (event_index, e) in z["events"].as_array().unwrap().iter().enumerate() {
        let row = e.as_array().unwrap();
        assert!(row.len() == 3 || row.len() == 4);
        let op = OPERATIONS[usize::try_from(row[0].as_u64().unwrap()).unwrap()];
        let mut event = json!({"op":op,"args":row[1],"result":row[2]});
        if row.len() == 4 {
            event["patch"] = row[3].clone();
        }
        let e = &event;
        *counts.entry(op.into()).or_default() += 1;
        fields(
            e,
            if e.get("patch").is_some() {
                &["op", "args", "result", "patch"]
            } else {
                &["op", "args", "result"]
            },
        );
        let a = e["args"].as_array().unwrap();
        let arity = match op {
            "at" | "canBlock" | "block" | "canSurface" | "surface" => 2,
            "prop" => 4,
            "featureParam" => 3,
            "context" | "open" | "isOwned" | "isReserved" | "reserve" | "release"
            | "fenceDetourOk" | "placeFeature" | "rng" | "corridorOf" | "touches"
            | "finishShape" => 1,
            "noise" => match a[1].as_str().unwrap() {
                "hash" => 5,
                "value" => 6,
                "fbm" => 7,
                _ => panic!("unknown noise"),
            },
            "worstStretch" => {
                assert!(a.len() <= 1);
                a.len()
            }
            "routeGuard" | "zoneFeatures" | "worstMember" | "guardState" | "finishZone" => 0,
            _ => panic!("unknown operation"),
        };
        assert_eq!(a.len(), arity, "operation argument inventory {op}");
        assert_eq!(
            e.get("patch").is_some(),
            [
                "canBlock",
                "block",
                "release",
                "fenceDetourOk",
                "placeFeature",
                "featureParam",
                "finishShape",
                "finishZone"
            ]
            .contains(&op)
        );

        let iv = |k: usize| i32::try_from(a[k].as_i64().unwrap()).unwrap();
        let fv = |k: usize| a[k].as_f64().unwrap();
        let veci = |k: usize| serde_json::from_value::<Vec<i32>>(a[k].clone()).unwrap();
        let got = match op {
            "context" => {
                assert_eq!(a.len(), 1);
                let p = usize::try_from(iv(0)).unwrap();
                assert!(streams[p].is_none());
                streams[p] = Some(rt.streams(phase(p as i64)));
                json!({"camps":geometry.camps,"spawns":spawns})
            }
            "at" => {
                assert_eq!(a.len(), 2);
                json!(rt.at(iv(0), iv(1)))
            }
            "open" => json!(rt.open(iv(0))),
            "isOwned" => json!(rt.is_owned(iv(0))),
            "isReserved" => json!(rt.is_reserved(iv(0))),
            "reserve" => {
                rt.reserve(iv(0));
                Value::Null
            }
            "canBlock" => json!(rt.can_block(iv(0), serde_json::from_value(a[1].clone()).unwrap())),
            "block" => json!(rt.block(iv(0), serde_json::from_value(a[1].clone()).unwrap())),
            "release" => json!(rt.release(iv(0))),
            "fenceDetourOk" => json!(rt.fence_detour_ok(iv(0))),
            "placeFeature" => json!(rt
                .place_feature(&serde_json::from_value::<FeatureSpec>(a[0].clone()).unwrap())
                .unwrap()),
            "canSurface" => {
                json!(rt.can_surface(iv(0), serde_json::from_value(a[1].clone()).unwrap()))
            }
            "surface" => json!(rt.surface(iv(0), serde_json::from_value(a[1].clone()).unwrap())),
            "prop" => json!(rt.prop(iv(0), iv(1), iv(2), u8::try_from(iv(3)).unwrap())),
            "rng" => json!(streams[usize::try_from(iv(0)).unwrap()]
                .as_mut()
                .unwrap()
                .rng
                .next_f64()),
            "noise" => {
                let noise = streams[usize::try_from(iv(0)).unwrap()]
                    .as_ref()
                    .unwrap()
                    .noise;
                match a[1].as_str().unwrap() {
                    "value" => json!(noise.value(fv(2), fv(3), fv(4), fv(5))),
                    "hash" => json!(noise_hash(noise, fv(2), fv(3), fv(4))),
                    "fbm" => json!(noise_fbm(
                        noise,
                        fv(2),
                        fv(3),
                        fv(4),
                        u32::try_from(iv(5)).unwrap(),
                        fv(6)
                    )),
                    _ => panic!("unknown noise"),
                }
            }
            "zoneFeatures" => json!(rt.zone_features().collect::<Vec<_>>()),
            "featureParam" => {
                {
                    assert_eq!(iv(1), 3);
                    rt.set_hall_pier_count(
                        usize::try_from(iv(0)).unwrap(),
                        u32::try_from(iv(2)).unwrap(),
                    )
                }
                .unwrap();
                Value::Null
            }
            "routeGuard" => {
                let got = guard_snap(rt.route_guard());
                eq(&got, &unpack_guard(&e["result"], n), "guard build");
                e["result"].clone()
            }
            "worstStretch" => json!(rt.worst_stretch(&if a.is_empty() { vec![] } else { veci(0) })),
            "worstMember" => json!(rt.route_guard().worst_member()),
            "touches" => json!(rt.route_guard().touches(&veci(0))),
            "corridorOf" => json!(rt.route_guard().corridor_of(iv(0))),
            "guardState" => {
                eq(
                    &guard_snap(rt.route_guard()),
                    &unpack_guard(&e["result"], n),
                    "guard state",
                );
                e["result"].clone()
            }
            "finishShape" => {
                let out = rt.finish_shape(usize::try_from(iv(0)).unwrap());
                reported_repaired = out.1;
                json!(out)
            }
            "finishZone" => Value::Null,
            _ => panic!("unknown operation {op}"),
        };
        eq(
            &got,
            &e["result"],
            &format!("zone {} event {event_index} {op}", info.index),
        );
        if let Some(p) = e.get("patch") {
            patch(&mut expected, p, n);
            eq(
                &snap(&rt),
                &expected,
                &format!("state zone {} event {event_index} {op}", info.index),
            );
        }
    }
    let records = z["streams"].as_array().unwrap();
    assert_eq!(
        records.len(),
        streams.iter().filter(|s| s.is_some()).count()
    );
    let mut seen_streams = BTreeSet::new();
    for record in records {
        fields(record, &["stream", "seed", "noiseSeed", "draws", "next"]);
        let p = usize::try_from(record["stream"].as_u64().unwrap()).unwrap();
        assert!(p < 3 && seen_streams.insert(p), "stream inventory");
        let stream = streams[p].as_mut().unwrap();
        let seed = hash_seed(
            i["seed"].as_i64().unwrap() as u32,
            i["attempt"].as_u64().unwrap() as u32,
            u32::from(info.index),
            p as u32,
        );
        assert_eq!(record["seed"], seed);
        assert_eq!(record["noiseSeed"], stream.noise.stream_seed);
        let draws = z["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| OPERATIONS[e[0].as_u64().unwrap() as usize] == "rng" && e[1][0] == p)
            .count();
        assert_eq!(record["draws"], draws);
        let next: Vec<_> = (0..4).map(|_| stream.rng.next_f64()).collect();
        eq(&json!(next), &record["next"], "RNG continuation");
    }
    assert_eq!(
        seen_streams,
        streams
            .iter()
            .enumerate()
            .filter_map(|(p, s)| s.as_ref().map(|_| p))
            .collect()
    );
    eq(&snap(&rt), &unpack(&z["final"], n), "final");
    if !z["guard"].is_null() {
        eq(
            &guard_snap(rt.route_guard()),
            &unpack_guard(&z["guard"], n),
            "final guard",
        );
    }
    if unit {
        assert!(z["report"].is_null());
    } else {
        let report = &z["report"];
        fields(
            report,
            &[
                "index",
                "faction",
                "blocked",
                "walls",
                "low",
                "kept",
                "refused",
                "joinChecks",
                "surfaced",
                "props",
                "repaired",
                "features",
                "plan",
            ],
        );
        let mut actual = report.as_object().unwrap().clone();
        actual.remove("plan");
        let c = rt.counters();
        eq(
            &Value::Object(actual),
            &json!({"index":info.index,"faction":info.faction,"blocked":c.walls+c.lows,"walls":c.walls,"low":c.lows,"kept":0,"refused":c.refused,"joinChecks":c.join_used,"surfaced":c.surfaced,"props":c.props_added,"repaired":reported_repaired,"features":c.features_added}),
            "native style report excluding captured-only plan",
        );
    }
    state
}
fn fixture() -> Value {
    let raw = include_str!("../fixtures/style-runtime.json");
    // Byte identity also pins captured-only plans, source final hashes/provenance, and JSON spelling.
    // This is an integrity regression check, not a cryptographic authenticity claim.
    let digest = raw.bytes().fold(0xcbf29ce484222325u64, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x100000001b3)
    });
    assert_eq!(
        digest, 0x3852e508f865d09f,
        "exact source fixture byte inventory"
    );
    serde_json::from_str::<UniqueValue>(raw).unwrap().0
}
#[test]
fn actual_operations_reexecute_on_shared_initial_arrays() {
    let f = fixture();
    assert_eq!(f["operations"], json!(OPERATIONS));
    fields(
        &f,
        &[
            "operations",
            "eventCounts",
            "format",
            "node",
            "platform",
            "arch",
            "sourceSha256",
            "omittedTelemetry",
            "metadata",
            "cases",
            "units",
            "repairCases",
        ],
    );
    assert_eq!(f["format"], "rh-style-runtime/1");
    assert_eq!(f["node"], "v22.23.4");
    assert_eq!(f["platform"], "linux");
    assert_eq!(f["arch"], "x64");
    assert_eq!(f["omittedTelemetry"], json!(["StyleResult.ms"]));
    assert_eq!(f["sourceSha256"].as_object().unwrap().len(), 75);
    fields(&f["metadata"], &["tile", "terrain", "props"]);
    let base = crate::mapgen::terrain_gate::default_definition();
    assert_eq!(
        f["metadata"]["props"].as_array().unwrap().len(),
        base.props.len()
    );
    for (p, r) in f["metadata"]["props"]
        .as_array()
        .unwrap()
        .iter()
        .zip(base.props)
    {
        fields(p, &["key", "on", "home"]);
        assert_eq!(p["key"], r.key);
        assert_eq!(p["on"], r.on);
        assert_eq!(
            serde_json::from_value::<Option<Zone>>(p["home"].clone()).unwrap(),
            r.home
        );
    }
    assert_eq!(
        f["metadata"]["terrain"].as_array().unwrap().len(),
        base.kinds.len()
    );
    for (t, r) in f["metadata"]["terrain"]
        .as_array()
        .unwrap()
        .iter()
        .zip(base.kinds)
    {
        fields(t, &["key", "tile", "home"]);
        assert_eq!(t["key"], r.key);
        assert_eq!(t["tile"], json!(r.tile));
        let home: Option<Zone> = serde_json::from_value(t["home"].clone()).unwrap();
        assert_eq!(home.map(Zone::code), r.home);
    }
    let meta = Metadata {
        terrain: base.kinds,
        props: base.props,
        tile_size: crate::constants::TILE,
    };
    assert_eq!(f["metadata"]["tile"], 32);
    let mut counts: BTreeMap<String, usize> =
        OPERATIONS.iter().map(|s| (s.to_string(), 0)).collect();
    let cases = f["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 4);
    let inventory: [(i64, u64, bool); 4] = [
        (1, 0, true),
        (-1, 0, false),
        (17, 1, true),
        (4294967297, 4294967296, false),
    ];
    let sizes = [
        [7703, 10479, 16364, 12583, 33931],
        [6588, 8457, 14151, 13330, 20233],
        [16344, 14189, 7776, 12765, 30121],
        [6732, 15764, 14181, 6559, 17298],
    ];
    for (case_index, (c, (seed, attempt, decor))) in cases.iter().zip(inventory).enumerate() {
        fields(
            c,
            &[
                "seed",
                "attempt",
                "decor",
                "completeFinalOutputEquality",
                "finalHash",
                "zones",
            ],
        );
        assert_eq!(c["seed"], seed);
        assert_eq!(c["attempt"], attempt);
        assert_eq!(c["decor"], decor);
        assert_eq!(c["completeFinalOutputEquality"], true);
        let zones = c["zones"].as_array().unwrap();
        assert_eq!(zones.len(), 5);
        let mut prior = None;
        for (index, z) in zones.iter().enumerate() {
            assert_eq!(
                z["events"].as_array().unwrap().len(),
                sizes[case_index][index]
            );
            assert_eq!(z["init"]["info"]["index"], index + 1);
            assert_eq!(z["init"]["seed"], seed);
            assert_eq!(z["init"]["attempt"], attempt);
            prior = Some(replay_zone(z, prior, meta, &mut counts));
        }
    }
    let units = f["units"].as_array().unwrap();
    assert_eq!(units.len(), 14);
    let names = [
        "whole-rollback-budget-territory",
        "groups-first-appearance-and-minimum",
        "trim-duplicate-low-wall-giveback",
        "trim-duplicate-piece-removed-while-feature-commits",
        "low-promotion-bypass-and-release",
        "written-low-promotion-refund-release",
        "surface-ice-ember-landmark-and-margins",
        "prop-home-class-protection-and-cap",
        "thin-low-and-fence-detour",
        "route-baseline-extra-wall-cutoff-and-null",
        "route-finite-ratio-above-i32",
        "trim-share-exact-six-of-ten",
        "low-support-stranding",
        "floor-only-whole-and-empty-groups",
    ];
    for ((u, name), count) in units
        .iter()
        .zip(names)
        .zip([7, 5, 6, 5, 9, 10, 15, 11, 21, 17, 8, 5, 6, 7])
    {
        assert_eq!(u["events"].as_array().unwrap().len(), count);
        assert_eq!(u["name"], name);
        replay_zone(u, None, meta, &mut counts);
    }
    let expected = [
        56162, 19, 3, 1, 88, 222, 4, 51, 20, 34, 45, 36371, 0, 68649, 110968, 222, 1725, 5, 548,
        1220, 42, 9161, 41, 4, 45, 30,
    ];
    for (op, n) in OPERATIONS.into_iter().zip(expected) {
        assert_eq!(counts[op], n, "exact operation count {op}");
    }
    eprintln!("operation inventory: {counts:?}");
    assert_eq!(json!(counts), f["eventCounts"]);
    assert_eq!(counts.values().sum::<usize>(), 285680);
}
#[test]
fn connectivity_source_boundaries() {
    let f = fixture();
    let rows = f["repairCases"].as_array().unwrap();
    assert_eq!(rows.len(), 3);
    for (c, name) in rows.iter().zip([
        "two-pieces-owned-bridge",
        "three-pieces-stale-labels",
        "unowned-barrier",
    ]) {
        fields(
            c,
            &[
                "name",
                "w",
                "h",
                "before",
                "components",
                "repaired",
                "after",
            ],
        );
        assert_eq!(c["name"], name);
        let (w, h) = (
            usize::try_from(c["w"].as_u64().unwrap()).unwrap(),
            usize::try_from(c["h"].as_u64().unwrap()).unwrap(),
        );
        let n = grid_size(w, h).expect("admitted oracle dimensions");
        let mut t = bytes(&c["before"]["tiles"], n);
        let mut tr = bytes(&c["before"]["terrain"], n);
        let mut wr = bytes(&c["before"]["wrote"], n);
        let (comp, sizes) = floor_components(&t, w, h).unwrap();
        assert_eq!(comp, ints(&c["components"]["comp"], n));
        assert_eq!(json!(sizes), c["components"]["sizes"]);
        assert_eq!(
            json!(repair_connectivity(&mut t, &mut tr, &mut wr, w, h).unwrap()),
            c["repaired"]
        );
        assert_eq!(t, bytes(&c["after"]["tiles"], n));
        assert_eq!(tr, bytes(&c["after"]["terrain"], n));
        assert_eq!(wr, bytes(&c["after"]["wrote"], n));
    }
}
fn small_runtime<'a>(
    s: &'a mut State,
    g: &'a Geometry,
    zero: &'a [u8],
    meta: Metadata<'a>,
    d: &Definition,
) -> Result<Runtime<'a>, Error> {
    Runtime::new(
        s,
        Inputs {
            geometry: g,
            hard: zero,
            no_block: zero,
            no_prop: zero,
            territory: None,
            spawns: &[],
            centre_walk: None,
            seed: 1,
            attempt: 0,
        },
        meta,
        d,
    )
}
#[test]
fn malformed_inputs_refuse_before_any_write() {
    let n = 17 * 17;
    let base = crate::mapgen::terrain_gate::default_definition();
    let meta = Metadata {
        terrain: base.kinds,
        props: base.props,
        tile_size: crate::constants::TILE,
    };
    let zero = vec![0; n];
    let mut s = State::new(
        17,
        17,
        zero.clone(),
        zero.clone(),
        vec![],
        vec![],
        vec![0; n],
    )
    .unwrap();
    let g = Geometry::new(1, Zone::Fire, &vec![1; n], s.tiles(), 17, 17, &[]).unwrap();
    let original = s.clone();
    assert!(matches!(
        State::new(usize::MAX, 2, vec![], vec![], vec![], vec![], vec![]),
        Err(Error::Dimensions)
    ));
    assert!(matches!(
        State::new(2097153, 1, vec![], vec![], vec![], vec![], vec![]),
        Err(Error::Dimensions)
    ));
    assert!(matches!(
        State::new(17, 17, vec![3; n], zero.clone(), vec![], vec![], vec![0; n]),
        Err(Error::Layer)
    ));
    assert!(matches!(
        State::new(
            17,
            17,
            zero.clone(),
            zero.clone(),
            vec![],
            vec![],
            vec![1; n]
        ),
        Err(Error::Ownership)
    ));
    for mutator in [
        |d: &mut Definition| d.footprint_percent = f64::NAN,
        |d: &mut Definition| d.rim_tiles = f64::INFINITY,
        |d: &mut Definition| d.fence_detour = 32762,
        |d: &mut Definition| d.join_checks = u32::MAX,
        |d: &mut Definition| d.wall_cost = 0,
        |d: &mut Definition| d.low_cost = u32::MAX,
        |d: &mut Definition| d.min_piece = 0,
        |d: &mut Definition| d.prop_percent = 101,
        |d: &mut Definition| d.shape_stream = u32::MAX,
        |d: &mut Definition| d.route_cut_off = 999,
        |d: &mut Definition| d.route_stretch_max = 999,
        |d: &mut Definition| d.route_stretch_max = 1_000_001,
    ] {
        let mut d = DEFAULT_DEFINITION;
        mutator(&mut d);
        assert!(matches!(
            small_runtime(&mut s, &g, &zero, meta, &d),
            Err(Error::Definition)
        ));
        assert_eq!(s, original);
    }
    assert!(matches!(
        small_runtime(&mut s, &g, &zero[..n - 1], meta, &DEFAULT_DEFINITION),
        Err(Error::Layer)
    ));
    assert_eq!(s, original);
    let wrong = Geometry::new(1, Zone::Fire, &vec![1; n], s.tiles(), 1, n, &[]).unwrap();
    assert!(matches!(
        small_runtime(&mut s, &wrong, &zero, meta, &DEFAULT_DEFINITION),
        Err(Error::Dimensions)
    ));
    assert_eq!(s, original);
    let mut swapped = base.kinds.to_vec();
    swapped.swap(0, 1);
    let reordered = Metadata {
        terrain: &swapped,
        ..meta
    };
    assert!(matches!(
        small_runtime(&mut s, &g, &zero, reordered, &DEFAULT_DEFINITION),
        Err(Error::Metadata)
    ));
    assert_eq!(s, original);
    let mut invalid_props = base.props.to_vec();
    invalid_props[0].on = u8::MAX;
    let invalid_prop_class = Metadata {
        props: &invalid_props,
        ..meta
    };
    assert!(matches!(
        small_runtime(&mut s, &g, &zero, invalid_prop_class, &DEFAULT_DEFINITION),
        Err(Error::Metadata)
    ));
    assert_eq!(s, original);
    let badwalk = vec![i32::MAX; n];
    let i = Inputs {
        geometry: &g,
        hard: &zero,
        no_block: &zero,
        no_prop: &zero,
        territory: None,
        spawns: &[],
        centre_walk: Some(&badwalk),
        seed: 1,
        attempt: 0,
    };
    assert!(matches!(
        Runtime::new(&mut s, i, meta, &DEFAULT_DEFINITION),
        Err(Error::Route)
    ));
    assert_eq!(s, original);
    let mut rt = small_runtime(&mut s, &g, &zero, meta, &DEFAULT_DEFINITION).unwrap();
    let baseline = snap(&rt);
    let spec = FeatureSpec {
        kind: FeatureKind::Crater,
        variant: None,
        jobs: vec![FeatureJob::Pen],
        anchor: [8, 8],
        params: None,
        blocks: vec![(144, BlockKind::Lava), (145, BlockKind::Wall)],
        groups: None,
        floor: None,
        mode: Mode::Whole,
        min_piece: None,
        min_share_permille: None,
        min_groups: None,
    };
    for mutator in [
        |s: &mut FeatureSpec| s.groups = Some(vec![0]),
        |s: &mut FeatureSpec| s.min_piece = Some(u32::MAX),
        |s: &mut FeatureSpec| s.min_share_permille = Some(u32::MAX),
        |s: &mut FeatureSpec| s.min_groups = Some(u32::MAX),
    ] {
        let mut spec = spec.clone();
        mutator(&mut spec);
        assert_eq!(rt.place_feature(&spec), Err(Error::Feature));
        assert_eq!(snap(&rt), baseline);
    }
    let mut v = serde_json::to_value(&spec).unwrap();
    v["unknown"] = json!(1);
    assert!(serde_json::from_value::<FeatureSpec>(v).is_err());
    assert_eq!(rt.set_hall_pier_count(0, 1), Err(Error::Feature));
    assert_eq!(snap(&rt), baseline);
    drop(rt);
    let holy = Geometry::new(1, Zone::Holy, &vec![1; n], s.tiles(), 17, 17, &[]).unwrap();
    for (kind, zone, params, count) in [
        (FeatureKind::Crater, Zone::Holy, vec![0; 4], 1),
        (FeatureKind::Hall, Zone::Fire, vec![0; 4], 1),
        (FeatureKind::Hall, Zone::Holy, vec![0; 3], 1),
        (FeatureKind::Hall, Zone::Holy, vec![0; 4], u32::MAX),
    ] {
        s.features = vec![MapFeature {
            kind,
            variant: String::new(),
            zone,
            jobs: vec![],
            ax: 0,
            ay: 0,
            p: params,
            bbox: TileRect {
                x: 0,
                y: 0,
                w: 0,
                h: 0,
            },
            tiles: 0,
        }];
        let mut rt = small_runtime(&mut s, &holy, &zero, meta, &DEFAULT_DEFINITION).unwrap();
        let before = snap(&rt);
        assert_eq!(rt.set_hall_pier_count(0, count), Err(Error::Feature));
        assert_eq!(snap(&rt), before);
    }
}

#[test]
fn prop_home_comes_from_the_shared_kind_including_unrestricted_kinds() {
    let base = crate::mapgen::terrain_gate::default_definition();
    let kind = base.props.iter().position(|p| p.key == "altar").unwrap();
    for (home, expected) in [
        (Some(Zone::Holy), false),
        (None, true),
        (Some(Zone::Fire), true),
    ] {
        let n = 5 * 5;
        let zero = vec![0; n];
        let mut state =
            State::new(5, 5, zero.clone(), zero.clone(), vec![], vec![], vec![0; n]).unwrap();
        let geometry = Geometry::new(1, Zone::Fire, &vec![1; n], state.tiles(), 5, 5, &[]).unwrap();
        let mut props = base.props.to_vec();
        props[kind].home = home;
        let metadata = Metadata {
            terrain: base.kinds,
            props: &props,
            tile_size: crate::constants::TILE,
        };
        let mut runtime =
            small_runtime(&mut state, &geometry, &zero, metadata, &DEFAULT_DEFINITION).unwrap();
        let before = snap(&runtime);
        assert_eq!(
            runtime.prop(kind as i32, 2, 2, 0),
            expected,
            "home {home:?}"
        );
        if expected {
            assert_eq!(runtime.state().props().len(), 1);
            assert_eq!(runtime.state().props()[0].kind, kind as u16);
        } else {
            assert_eq!(snap(&runtime), before);
        }
    }
}
#[test]
fn owner_capacity_and_repair_malformed_are_atomic() {
    let n = 25;
    let zero = vec![0; n];
    let f = MapFeature {
        kind: FeatureKind::Crater,
        variant: String::new(),
        zone: Zone::Fire,
        jobs: vec![],
        ax: 0,
        ay: 0,
        p: vec![],
        bbox: TileRect {
            x: 0,
            y: 0,
            w: 0,
            h: 0,
        },
        tiles: 0,
    };
    let mut s = State::new(
        5,
        5,
        zero.clone(),
        zero.clone(),
        vec![],
        vec![f; u16::MAX as usize],
        vec![0; n],
    )
    .unwrap();
    let g = Geometry::new(1, Zone::Fire, &vec![1; n], s.tiles(), 5, 5, &[]).unwrap();
    let base = crate::mapgen::terrain_gate::default_definition();
    let meta = Metadata {
        terrain: base.kinds,
        props: base.props,
        tile_size: 32.0,
    };
    let mut rt = small_runtime(&mut s, &g, &zero, meta, &DEFAULT_DEFINITION).unwrap();
    let before = snap(&rt);
    let spec:FeatureSpec=serde_json::from_value(json!({"kind":"hall","variant":null,"jobs":[],"anchor":[2,2],"params":null,"blocks":[],"groups":null,"floor":[12],"mode":"whole","minPiece":null,"minSharePermille":null,"minGroups":null})).unwrap();
    assert_eq!(rt.place_feature(&spec), Err(Error::Capacity));
    assert_eq!(snap(&rt), before);
    let mut tiles = vec![1; n];
    let mut terrain = vec![3; n];
    let mut wrote = vec![1; n - 1];
    assert_eq!(
        repair_connectivity(&mut tiles, &mut terrain, &mut wrote, 5, 5),
        Err(Error::Layer)
    );
    assert_eq!(tiles, vec![1; n]);
    assert_eq!(terrain, vec![3; n]);
    assert_eq!(wrote, vec![1; n - 1]);
}
#[test]
fn every_definition_word_participates() {
    let words = |d: &Definition| {
        let mut v = vec![];
        visit_content(d, |w| v.push(w));
        v
    };
    let base = words(&DEFAULT_DEFINITION);
    assert_eq!(base.len(), 16);
    for edit in [
        |d: &mut Definition| d.join_checks += 1,
        |d: &mut Definition| d.footprint_percent += 1.0,
        |d: &mut Definition| d.rim_tiles += 1.0,
        |d: &mut Definition| d.fence_detour += 1,
        |d: &mut Definition| d.wall_cost += 1,
        |d: &mut Definition| d.low_cost += 1,
        |d: &mut Definition| d.prop_percent += 1,
        |d: &mut Definition| d.min_piece += 1,
        |d: &mut Definition| d.min_share_permille += 1,
        |d: &mut Definition| d.min_groups += 1,
        |d: &mut Definition| d.shape_stream += 1,
        |d: &mut Definition| d.decor_stream += 1,
        |d: &mut Definition| d.surface_stream += 1,
        |d: &mut Definition| d.noise_stream_offset += 1,
        |d: &mut Definition| d.route_cut_off += 1,
        |d: &mut Definition| d.route_stretch_max += 1,
    ] {
        let mut d = DEFAULT_DEFINITION;
        edit(&mut d);
        assert_ne!(words(&d), base);
    }
}
/// serde_json::Value ordinarily overwrites duplicate object keys. The oracle refuses them at every depth.
struct UniqueValue(Value);
impl<'de> serde::Deserialize<'de> for UniqueValue {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = UniqueValue;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("JSON with unique object keys")
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Self::Value, E> {
                Ok(UniqueValue(json!(v)))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Self::Value, E> {
                Ok(UniqueValue(json!(v)))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Self::Value, E> {
                Ok(UniqueValue(json!(v)))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Self::Value, E> {
                serde_json::Number::from_f64(v)
                    .map(|v| UniqueValue(Value::Number(v)))
                    .ok_or_else(|| E::custom("nonfinite"))
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(UniqueValue(json!(v)))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(UniqueValue(Value::Null))
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<Self::Value, A::Error> {
                let mut values = vec![];
                while let Some(v) = seq.next_element::<UniqueValue>()? {
                    values.push(v.0);
                }
                Ok(UniqueValue(Value::Array(values)))
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> Result<Self::Value, A::Error> {
                let mut values = serde_json::Map::new();
                while let Some((k, v)) = map.next_entry::<String, UniqueValue>()? {
                    if values.insert(k, v.0).is_some() {
                        return Err(serde::de::Error::custom("duplicate object key"));
                    }
                }
                Ok(UniqueValue(Value::Object(values)))
            }
        }
        d.deserialize_any(Visitor)
    }
}
#[test]
fn corrupt_fixture_encodings_are_rejected() {
    assert!(serde_json::from_str::<UniqueValue>(r#"{"op":1,"op":2}"#).is_err());
    assert!(serde_json::from_str::<UniqueValue>(r#"{"nested":{"x":1,"x":2}}"#).is_err());
    for bad in [
        json!([[0, 1], [0, 1]]),
        json!([[0, 0], [1, 2]]),
        json!([[0, 3]]),
        json!([[256, 1]]),
    ] {
        let result = std::panic::catch_unwind(|| bytes(&bad, 2));
        assert!(result.is_err());
    }
    for p in [
        json!({"tiles":[]}),
        json!({"tiles":[[0,[]]]}),
        json!({"tiles":[[0,[[1,2]]],[1,[[2,1]]]]}),
        json!({"tiles":[[0,[[1,1]]],[1,[[2,1]]]]}),
        json!({"tiles":[[0,[[0,1]]]]}),
        json!({"unknown":0}),
        json!({"tiles":[[0,[[1,u64::MAX],[2,2]]]]}),
    ] {
        let result = std::panic::catch_unwind(|| {
            let mut v = json!({"tiles":[0,0,0]});
            patch(&mut v, &p, 3);
        });
        assert!(result.is_err());
    }
}
