//! Exact source post-hook diagnostics and T8 original-pool cleanup. Test-only input reconstruction.
use super::style_contract::{self, Input};
use super::{Error, H, W};
use crate::map::{TILE_FLOOR, TILE_LOW, TILE_WALL};
use crate::mapdata::{MapFeature, Zone};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
const RAW: &str = include_str!("../fixtures/style-contract.json");
fn required_option<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    format: String,
    node: String,
    platform: String,
    arch: String,
    w: usize,
    h: usize,
    source_sha256: BTreeMap<String, String>,
    statement_sha256: BTreeMap<String, String>,
    metadata: Metadata,
    cases: Vec<Case>,
    t8: Vec<PoolCase>,
    matrix: Vec<MatrixCase>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Metadata {
    tile: TileKinds,
    terrain: Vec<TerrainKind>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TileKinds {
    floor: u8,
    wall: u8,
    low: u8,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TerrainKind {
    key: String,
    #[serde(deserialize_with = "required_option")]
    tile: Option<u8>,
    #[serde(deserialize_with = "required_option")]
    home: Option<Zone>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Case {
    name: String,
    input: HookInput,
    expected: HookOutput,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HookInput {
    gates: bool,
    order: Vec<Zone>,
    before_tiles: Vec<(usize, u8)>,
    zone: Vec<(usize, u8)>,
    protect: Vec<(usize, u8)>,
    feature_owner: Vec<(usize, u16)>,
    features: Vec<MapFeature>,
    hook: HookEdits,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HookEdits {
    tiles: Vec<(usize, u8)>,
    terrain: Vec<(usize, u8)>,
    feature_owner: Vec<(usize, u16)>,
    features: Vec<MapFeature>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HookOutput {
    #[serde(deserialize_with = "required_option")]
    diagnostic: Option<String>,
    tiles: Vec<(usize, u8)>,
    terrain: Vec<(usize, u8)>,
    feature_owner: Vec<(usize, u16)>,
    features: Vec<MapFeature>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PoolCase {
    name: String,
    input: PoolInput,
    expected: PoolOutput,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PoolInput {
    pool: Vec<usize>,
    surviving_pool: Vec<usize>,
    terrain: Vec<(usize, u8)>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PoolOutput {
    pool5: Vec<(usize, u8)>,
    terrain: Vec<(usize, u8)>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MatrixCase {
    before: u8,
    after: u8,
    terrain: u8,
    zone: u8,
    protected_tile: u8,
    gates: bool,
    owner: u16,
    #[serde(deserialize_with = "required_option")]
    breach: Option<String>,
}
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
const CASES: &[&str] = &[
    "unchanged-empty",
    "floor-to-owned-wall",
    "floor-to-owned-low",
    "second-feature-owner",
    "gates-off-unowned-wall",
    "gates-off-unowned-surface",
    "floor-kind-4",
    "floor-kind-5",
    "floor-kind-6",
    "floor-kind-7",
    "low-kind-1-tile-2",
    "low-kind-1-tile-1",
    "low-kind-2-tile-2",
    "low-kind-2-tile-1",
    "low-kind-3-tile-2",
    "low-kind-3-tile-1",
    "existing-wall-low-decor",
    "terrain-home-is-later-contract",
    "wall-cannot-become-floor",
    "low-cannot-become-wall",
    "invalid-new-tile-byte",
    "protected-transition",
    "unpainted-transition",
    "missing-owner-transition",
    "wrong-zone-owner",
    "zone-outside-order",
    "zone-outside-order-gates-off",
    "unpainted-surface",
    "protected-surface",
    "floor-kind-on-wall",
    "low-kind-on-floor",
    "unknown-kind-byte",
    "transition-before-owner-and-class",
    "owner-before-class",
    "lower-owner-before-higher-transition",
    "lower-class-before-higher-transition",
    "last-cell-diagnostic",
];
const POOL_CASES: &[&str] = &[
    "no-original-pool",
    "all-floor-kinds-cleared-low-kinds-retained",
    "five-by-five-not-three-by-three",
    "original-dropped-member-still-cleared",
    "overlapping-original-halos",
    "clipped-map-corners",
];
const SOURCES: &[&str] = &[
    "abilities.ts",
    "achievements.ts",
    "blink.ts",
    "bushes.ts",
    "cards.ts",
    "championPassives.ts",
    "chestBoosts.ts",
    "coliseum.ts",
    "combatReadability.ts",
    "constants.ts",
    "consumables.ts",
    "cosmetics.ts",
    "detMath.ts",
    "effectText.ts",
    "effects.ts",
    "factions.ts",
    "fireRoam.ts",
    "fxCodec.ts",
    "geometry.ts",
    "glossary.ts",
    "gridOps.ts",
    "gridTopology.ts",
    "hpView.ts",
    "index.ts",
    "interactions.ts",
    "interp.ts",
    "killAugments.ts",
    "map.ts",
    "mapWire.ts",
    "mapgen.ts",
    "mark.ts",
    "messages.ts",
    "mobStats.ts",
    "mobs.ts",
    "mods.ts",
    "pathfind.ts",
    "plagueCorpses.ts",
    "planning.ts",
    "policies.ts",
    "propKinds.ts",
    "quests.ts",
    "rewards.ts",
    "rng.ts",
    "rosters.ts",
    "rules.ts",
    "schema.ts",
    "sentencedHunt.ts",
    "signatureShares.ts",
    "signatures.ts",
    "status.ts",
    "styler.ts",
    "telemetry.ts",
    "terrain.ts",
    "traders.ts",
    "training.ts",
    "vision.ts",
    "walk.ts",
    "weapons.ts",
    "wheel.ts",
    "zoneStyle/context.ts",
    "zoneStyle/features.ts",
    "zoneStyle/gallows.ts",
    "zoneStyle/hook.ts",
    "zoneStyle/index.ts",
    "zoneStyle/kit.ts",
    "zoneStyle/landmarks.ts",
    "zoneStyle/propKinds.ts",
    "zoneStyle/rime.ts",
    "zoneStyle/sanctum.ts",
    "zoneStyle/scale.ts",
    "zoneStyle/scorch.ts",
    "zoneStyle/styleZones.ts",
    "zoneStyle/types.ts",
    "zoneStyle/warren.ts",
    "zones.ts",
];
const STATEMENTS: &[(&str, &str)] = &[
    (
        "applyStyleHook",
        "02de34ec3eae0ac370ba1ab6db10c49fff3b7e2264d7732e314e67b8b5579ede",
    ),
    (
        "poolMasks",
        "6a6234120d0c1a4338fe712a6a9ef2f1ca50718d5de705f04bc4a3506e016580",
    ),
    (
        "t8Clear",
        "649064e696dae8201c3ec61855255e28750a66868c03b53b74e90d0b94011912",
    ),
];

fn require(ok: bool, message: &str) -> Result<(), String> {
    if ok {
        Ok(())
    } else {
        Err(message.to_owned())
    }
}
fn sparse<T: Copy + Default + PartialEq>(
    cells: &[(usize, T)],
    canonical: bool,
) -> Result<(), String> {
    let mut seen = BTreeSet::new();
    let mut last = None;
    for &(i, v) in cells {
        require(i < W * H, "cell range")?;
        require(seen.insert(i), "duplicate sparse cell")?;
        if canonical {
            require(v != T::default(), "explicit zero output")?;
            require(last.is_none_or(|p| p < i), "output sparse order")?;
        }
        last = Some(i);
    }
    Ok(())
}
fn read(raw: &str) -> Result<Fixture, String> {
    let unique = serde_json::from_str::<UniqueValue>(raw).map_err(|e| e.to_string())?;
    let f: Fixture = serde_json::from_value(unique.0).map_err(|e| e.to_string())?;
    require(
        f.format == "rh-style-contract/1"
            && f.node == "v22.23.4"
            && f.platform == "linux"
            && f.arch == "x64"
            && f.w == W
            && f.h == H,
        "format/platform/dimensions",
    )?;
    require(
        f.source_sha256.len() == SOURCES.len()
            && f.source_sha256
                .keys()
                .map(String::as_str)
                .eq(SOURCES.iter().copied()),
        "source inventory",
    )?;
    require(
        f.source_sha256.values().all(|h| {
            h.len() == 64
                && h.bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        }),
        "source digest",
    )?;
    require(
        f.statement_sha256.len() == STATEMENTS.len()
            && STATEMENTS
                .iter()
                .all(|&(k, v)| f.statement_sha256.get(k).is_some_and(|s| s == v)),
        "source statement binding",
    )?;
    require(
        f.metadata.tile.floor == TILE_FLOOR
            && f.metadata.tile.wall == TILE_WALL
            && f.metadata.tile.low == TILE_LOW,
        "tile metadata",
    )?;
    let catalog = crate::mapgen::terrain_gate::default_definition();
    require(
        f.metadata.terrain.len() == catalog.kinds.len(),
        "terrain metadata inventory",
    )?;
    require(
        f.metadata
            .terrain
            .iter()
            .zip(catalog.kinds)
            .all(|(a, b)| a.key == b.key && a.tile == b.tile && a.home.map(Zone::code) == b.home),
        "sole terrain catalog",
    )?;
    require(
        f.cases.len() == CASES.len()
            && f.cases
                .iter()
                .map(|c| c.name.as_str())
                .eq(CASES.iter().copied()),
        "case inventory",
    )?;
    for c in &f.cases {
        let i = &c.input;
        let o = &c.expected;
        require(
            i.order.len() == 5
                && i.order
                    .iter()
                    .enumerate()
                    .all(|(k, z)| !i.order[..k].contains(z)),
            "faction order",
        )?;
        for v in [
            &i.before_tiles,
            &i.zone,
            &i.protect,
            &i.hook.tiles,
            &i.hook.terrain,
        ] {
            sparse(v, false)?;
        }
        sparse(&i.feature_owner, false)?;
        sparse(&i.hook.feature_owner, false)?;
        sparse(&o.tiles, true)?;
        sparse(&o.terrain, true)?;
        sparse(&o.feature_owner, true)?;
        require(
            i.before_tiles
                .iter()
                .all(|&(_, t)| [TILE_FLOOR, TILE_WALL, TILE_LOW].contains(&t)),
            "initial tile class",
        )?;
        let feature_count = i.features.len() + i.hook.features.len();
        require(
            i.feature_owner
                .iter()
                .chain(&i.hook.feature_owner)
                .all(|&(_, o)| usize::from(o) <= feature_count),
            "typed owner reference",
        )?;
    }
    require(
        f.t8.len() == POOL_CASES.len()
            && f.t8
                .iter()
                .map(|c| c.name.as_str())
                .eq(POOL_CASES.iter().copied()),
        "T8 inventory",
    )?;
    for c in &f.t8 {
        for v in [&c.input.pool, &c.input.surviving_pool] {
            require(
                v.iter().all(|&i| i < W * H) && v.iter().collect::<BTreeSet<_>>().len() == v.len(),
                "pool admission",
            )?;
        }
        require(
            c.input
                .surviving_pool
                .iter()
                .all(|i| c.input.pool.contains(i)),
            "pool survivor subset",
        )?;
        sparse(&c.input.terrain, false)?;
        sparse(&c.expected.terrain, true)?;
        sparse(&c.expected.pool5, true)?;
        require(
            c.input
                .terrain
                .iter()
                .all(|&(_, k)| usize::from(k) < catalog.kinds.len()),
            "T8 terrain kind",
        )?;
        require(
            c.expected.pool5.iter().all(|&(_, v)| v == 1),
            "T8 mask byte",
        )?;
    }
    require(f.matrix.len() == 1944, "matrix inventory")?;
    let mut index = 0;
    for before in 0..3 {
        for after in 0..3 {
            for terrain in 0..9 {
                for zone in 0..2 {
                    for protected_tile in 0..2 {
                        for gates in [false, true] {
                            for owner in 0..3 {
                                let m = &f.matrix[index];
                                require(
                                    (
                                        m.before,
                                        m.after,
                                        m.terrain,
                                        m.zone,
                                        m.protected_tile,
                                        m.gates,
                                        m.owner,
                                    ) == (
                                        before,
                                        after,
                                        terrain,
                                        zone,
                                        protected_tile,
                                        gates,
                                        owner,
                                    ),
                                    "matrix exact ordered inputs",
                                )?;
                                index += 1;
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(f)
}
fn apply<T: Copy>(out: &mut [T], cells: &[(usize, T)]) {
    for &(i, v) in cells {
        out[i] = v;
    }
}
fn expand<T: Copy + Default>(cells: &[(usize, T)]) -> Vec<T> {
    let mut out = vec![T::default(); W * H];
    apply(&mut out, cells);
    out
}
#[test]
fn captured_contract_diagnostics_and_hook_layers_match() {
    let f = read(RAW).unwrap();
    let kinds = crate::mapgen::terrain_gate::default_definition();
    for c in &f.cases {
        let i = &c.input;
        let before = expand(&i.before_tiles);
        let mut tiles = before.clone();
        apply(&mut tiles, &i.hook.tiles);
        let terrain = expand(&i.hook.terrain);
        let zone = expand(&i.zone);
        let protect = expand(&i.protect);
        let mut owner = expand(&i.feature_owner);
        apply(&mut owner, &i.hook.feature_owner);
        let mut features = i.features.clone();
        features.extend(i.hook.features.clone());
        // All native inputs above derive solely from the declared hook edits. Expectations are read only here.
        assert_eq!(
            tiles,
            expand(&c.expected.tiles),
            "{} source hook tiles",
            c.name
        );
        assert_eq!(
            terrain,
            expand(&c.expected.terrain),
            "{} source hook terrain",
            c.name
        );
        assert_eq!(
            owner,
            expand(&c.expected.feature_owner),
            "{} source hook owners",
            c.name
        );
        assert_eq!(
            features, c.expected.features,
            "{} source hook features",
            c.name
        );
        let input = Input {
            before: &before,
            tiles: &tiles,
            terrain: &terrain,
            zone: &zone,
            protect: &protect,
            order: &i.order,
            features: &features,
            feature_owner: &owner,
            gates: i.gates,
        };
        assert_eq!(
            style_contract::check(&input, &kinds).unwrap(),
            c.expected.diagnostic,
            "{} first breach",
            c.name
        );
    }
}
#[test]
fn captured_t8_uses_original_pool_and_preserves_low_kinds() {
    let f = read(RAW).unwrap();
    let kinds = crate::mapgen::terrain_gate::default_definition();
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let context = crate::mapgen::spawns::SpawnContext::new(&fixed);
    for c in &f.t8 {
        let pool5 = context.pool_masks(&c.input.pool).pool5;
        assert_eq!(
            pool5,
            expand(&c.expected.pool5),
            "{} source pool mask",
            c.name
        );
        let mut terrain = expand(&c.input.terrain);
        style_contract::clear_pool_hazards(&mut terrain, &pool5, &kinds).unwrap();
        assert_eq!(terrain, expand(&c.expected.terrain), "{} T8", c.name);
    }
}
#[test]
fn captured_contract_cartesian_matrix_matches() {
    let f = read(RAW).unwrap();
    let kinds = crate::mapgen::terrain_gate::default_definition();
    let feature = f.cases[1].input.hook.features[0].clone();
    let mut wrong = feature.clone();
    wrong.zone = Zone::Frost;
    let features = vec![feature, wrong];
    let order = [
        Zone::Fire,
        Zone::Sentenced,
        Zone::Plague,
        Zone::Frost,
        Zone::Holy,
    ];
    let i = W + 1;
    for (index, m) in f.matrix.iter().enumerate() {
        let mut before = vec![0; W * H];
        before[i] = m.before;
        let mut tiles = before.clone();
        tiles[i] = m.after;
        let mut terrain = vec![0; W * H];
        terrain[i] = m.terrain;
        let mut zone = vec![0; W * H];
        zone[i] = m.zone;
        let mut protect = vec![0; W * H];
        protect[i] = m.protected_tile;
        let mut owner = vec![0; W * H];
        owner[i] = m.owner;
        let input = Input {
            before: &before,
            tiles: &tiles,
            terrain: &terrain,
            zone: &zone,
            protect: &protect,
            order: &order,
            features: &features,
            feature_owner: &owner,
            gates: m.gates,
        };
        assert_eq!(
            style_contract::check(&input, &kinds).unwrap(),
            m.breach,
            "matrix {index}"
        );
    }
}
#[test]
fn fixture_admission_rejects_unknown_missing_duplicate_and_overflow() {
    read(RAW).unwrap();
    assert!(read(&RAW.replacen("{", "{\"format\":\"duplicate\",", 1)).is_err());
    assert!(read(&RAW.replacen("\"gates\":true", "\"gates\":true,\"gates\":true", 1)).is_err());
    let original: Value = serde_json::from_str(RAW).unwrap();
    for which in 0..17 {
        let mut f = original.clone();
        match which {
            0 => f["cases"] = json!([]),
            1 => {
                f["cases"].as_array_mut().unwrap().pop();
            }
            2 => f["cases"][1] = f["cases"][0].clone(),
            3 => f["unknown"] = json!(1),
            4 => {
                f["cases"][0]["expected"]
                    .as_object_mut()
                    .unwrap()
                    .remove("diagnostic");
            }
            5 => f["cases"][0]["input"]["hook"]["unknown"] = json!(1),
            6 => f["cases"][1]["input"]["hook"]["tiles"][0][1] = json!(256),
            7 => f["cases"][1]["input"]["hook"]["featureOwner"][0][1] = json!(65536),
            8 => f["cases"][1]["input"]["hook"]["tiles"][0][0] = json!(-1),
            9 => f["cases"][1]["input"]["hook"]["tiles"][0][0] = json!(u64::MAX),
            10 => f["matrix"] = json!([]),
            11 => f["matrix"][1] = f["matrix"][0].clone(),
            12 => f["t8"] = json!([]),
            13 => f["t8"][1]["input"]["terrain"][0][1] = json!(255),
            14 => f["t8"][1]["input"]["pool"][0] = json!(W * H),
            15 => {
                f["metadata"]["terrain"][0]
                    .as_object_mut()
                    .unwrap()
                    .remove("tile");
            }
            _ => {
                let sources = f["sourceSha256"].as_object_mut().unwrap();
                let digest = sources.remove("bushes.ts").unwrap();
                sources.insert("unknown.ts".into(), digest);
            }
        }
        assert!(
            read(&serde_json::to_string(&f).unwrap()).is_err(),
            "malformed fixture {which}"
        );
    }
}
#[test]
fn malformed_layers_refuse_before_pool_writes() {
    let zero = vec![0; W * H];
    let owner = vec![0; W * H];
    let kinds = crate::mapgen::terrain_gate::default_definition();
    for which in 0..6 {
        let short = &zero[..W * H - 1];
        let mut input = Input {
            before: &zero,
            tiles: &zero,
            terrain: &zero,
            zone: &zero,
            protect: &zero,
            order: &[],
            features: &[],
            feature_owner: &owner,
            gates: true,
        };
        match which {
            0 => input.before = short,
            1 => input.tiles = short,
            2 => input.terrain = short,
            3 => input.zone = short,
            4 => input.protect = short,
            _ => input.feature_owner = &owner[..W * H - 1],
        }
        assert!(matches!(
            style_contract::check(&input, &kinds),
            Err(Error::Leaf(_))
        ));
    }
    for short_terrain in [false, true] {
        let mut terrain = vec![4; W * H - usize::from(short_terrain)];
        let before = terrain.clone();
        let mask = vec![1; W * H - usize::from(!short_terrain)];
        assert!(matches!(
            style_contract::clear_pool_hazards(&mut terrain, &mask, &kinds),
            Err(Error::Leaf(_))
        ));
        assert_eq!(terrain, before);
    }
}

#[test]
fn fixture_bytes_remain_bound_to_canonical_capture() {
    let hash = RAW.bytes().fold(0xcbf29ce484222325_u64, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x100000001b3)
    });
    assert_eq!(hash, 13660785364692428664_u64);
}
