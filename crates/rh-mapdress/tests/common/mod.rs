//! Shared helpers: the eight certified maps (generated once per test binary) and independent re-statements of the
//! geometry the brief defines. These helpers deliberately do not call the crate under test.
#![allow(dead_code)]
use rh_mapdress::rules::{Rules, TileClass};
use rh_sim::mapdata::{FeatureKind, GameMapData, Zone};
use rh_sim::mapgen::{coliseum, map_hash, pipeline};
use std::sync::OnceLock;

pub const TILE: f64 = 32.0;
pub const ZONES: [Zone; 5] = [
    Zone::Fire,
    Zone::Sentenced,
    Zone::Plague,
    Zone::Frost,
    Zone::Holy,
];

pub struct Case {
    pub seed: i64,
    pub map: GameMapData,
    pub hash: u64,
}

/// Seeds 1..=8 through `Pipeline::certified_styled` with the default options (decor on, so `props` is non-empty).
pub fn cases() -> &'static Vec<Case> {
    static CASES: OnceLock<Vec<Case>> = OnceLock::new();
    CASES.get_or_init(|| {
        let fixed = coliseum::fixed_layout();
        let generator = pipeline::Pipeline::new(&fixed);
        (1..=8i64)
            .map(|seed| {
                let map = generator
                    .certified_styled(seed, pipeline::Options::default())
                    .expect("generator runs")
                    .unwrap_or_else(|| panic!("seed {seed} certifies"));
                let hash = u64::from_str_radix(&map_hash::map_hash(&map), 16).expect("hex hash");
                Case { seed, map, hash }
            })
            .collect()
    })
}

pub fn rules() -> &'static Rules {
    static RULES: OnceLock<Rules> = OnceLock::new();
    RULES.get_or_init(Rules::starter)
}

pub fn w(map: &GameMapData) -> usize {
    map.w as usize
}
pub fn idx(map: &GameMapData, tx: usize, ty: usize) -> usize {
    ty * w(map) + tx
}
/// The tile a world-unit position belongs to.
pub fn tile_of(x: u16, y: u16) -> (usize, usize) {
    (x as usize / 32, y as usize / 32)
}
pub fn centre(tx: usize, ty: usize) -> (f64, f64) {
    (tx as f64 * TILE + 16.0, ty as f64 * TILE + 16.0)
}
pub fn dist(a: (f64, f64), b: (f64, f64)) -> f64 {
    ((a.0 - b.0) * (a.0 - b.0) + (a.1 - b.1) * (a.1 - b.1)).sqrt()
}

pub fn class_of(map: &GameMapData, i: usize) -> TileClass {
    match map.tiles[i] {
        1 => TileClass::Wall,
        2 => TileClass::Low,
        _ => match map.terrain[i] {
            4 => TileClass::Ember,
            5 => TileClass::Bog,
            6 => TileClass::Ice,
            7 => TileClass::Light,
            _ => TileClass::Floor,
        },
    }
}

pub fn zone_at(map: &GameMapData, i: usize) -> Option<Zone> {
    ZONES
        .iter()
        .copied()
        .find(|z| z.code() == map.region_grid[i])
}

/// Tiles the keep-clear mask must cover, from the brief and the doc comment of `keep_clear`.
pub fn required_clear(map: &GameMapData, rules: &Rules) -> Vec<bool> {
    let (mw, mh) = (map.w as i64, map.h as i64);
    let mut out = vec![false; map.w as usize * map.h as usize];
    let mark_box = |out: &mut Vec<bool>, x0: i64, y0: i64, x1: i64, y1: i64| {
        for y in y0.max(0)..=y1.min(mh - 1) {
            for x in x0.max(0)..=x1.min(mw - 1) {
                out[(y * mw + x) as usize] = true;
            }
        }
    };
    let k = &rules.keep_clear;
    for camp in &map.camps {
        let reach = camp.r + f64::from(k.camp_margin) * TILE;
        for ty in 0..map.h as usize {
            for tx in 0..map.w as usize {
                if dist(centre(tx, ty), (camp.x, camp.y)) <= reach {
                    out[idx(map, tx, ty)] = true;
                }
            }
        }
    }
    let point = |out: &mut Vec<bool>, x: f64, y: f64| {
        let (tx, ty) = ((x / TILE).floor() as i64, (y / TILE).floor() as i64);
        if (0..mw).contains(&tx) && (0..mh).contains(&ty) {
            out[(ty * mw + tx) as usize] = true;
        }
    };
    for p in map
        .spawns
        .iter()
        .chain(&map.crate_spots)
        .chain(&map.ground_spots)
    {
        point(&mut out, p.x, p.y);
    }
    let m = i64::from(k.coliseum_margin);
    let r = map.coliseum.rect;
    mark_box(
        &mut out,
        i64::from(r.x) - m,
        i64::from(r.y) - m,
        i64::from(r.x) + i64::from(r.w) - 1 + m,
        i64::from(r.y) + i64::from(r.h) - 1 + m,
    );
    for g in &map.coliseum.gates {
        for t in &g.tiles {
            mark_box(
                &mut out,
                i64::from(t.x) - m,
                i64::from(t.y) - m,
                i64::from(t.x) + m,
                i64::from(t.y) + m,
            );
        }
    }
    for (i, slot) in out.iter_mut().enumerate() {
        let f = map.feature_grid[i] as usize;
        if f > 0
            && map
                .features
                .get(f - 1)
                .is_some_and(|f| f.kind == FeatureKind::Bush)
        {
            *slot = true;
        }
    }
    out
}

/// The nearest coliseum gate centre of `camp` (squared world distance on `GateDef.x/y`, first on a tie).
pub fn nearest_gate(map: &GameMapData, x: f64, y: f64) -> (f64, f64) {
    let mut best: Option<(f64, (f64, f64))> = None;
    for g in &map.coliseum.gates {
        let d = (g.x - x) * (g.x - x) + (g.y - y) * (g.y - y);
        if best.is_none_or(|(b, _)| d < b) {
            best = Some((d, (g.x, g.y)));
        }
    }
    best.expect("a coliseum has gates").1
}

/// The ring anchor of `zone` in world units: the bbox centre of the largest feature of the signature kind (first on a
/// tie), else the integer-division mean of the zone's tile centres.
pub fn anchor(map: &GameMapData, zone: Zone, feature: FeatureKind) -> (f64, f64) {
    let mut best: Option<&rh_sim::mapdata::MapFeature> = None;
    for f in &map.features {
        if f.kind == feature && f.zone == zone && best.is_none_or(|b| f.tiles > b.tiles) {
            best = Some(f);
        }
    }
    if let Some(f) = best {
        let b = f.bbox;
        return (
            ((i64::from(b.x) * 2 + i64::from(b.w)) * 16) as f64,
            ((i64::from(b.y) * 2 + i64::from(b.h)) * 16) as f64,
        );
    }
    centroid(map, zone)
}

pub fn centroid(map: &GameMapData, zone: Zone) -> (f64, f64) {
    let (mut sx, mut sy, mut n) = (0i64, 0i64, 0i64);
    for ty in 0..map.h as usize {
        for tx in 0..map.w as usize {
            if map.region_grid[idx(map, tx, ty)] == zone.code() {
                sx += tx as i64 * 32 + 16;
                sy += ty as i64 * 32 + 16;
                n += 1;
            }
        }
    }
    assert!(n > 0, "zone {zone:?} has tiles");
    ((sx / n) as f64, (sy / n) as f64)
}

/// A rule's kinds per stage for one zone, each as its own list (rule order).
pub struct ZoneKinds {
    pub rings: Vec<Vec<u8>>,
    pub clusters: Vec<Vec<u8>>,
    pub edges: Vec<Vec<u8>>,
    pub fillers: Vec<Vec<u8>>,
}
pub fn zone_kinds(rules: &Rules, zone: Zone) -> ZoneKinds {
    let z = rules.zone(zone).expect("starter has every zone");
    ZoneKinds {
        rings: z
            .rings
            .iter()
            .map(|r| r.props.iter().map(|p| p.kind).collect())
            .collect(),
        clusters: z.clusters.iter().map(|r| r.kinds.clone()).collect(),
        edges: z.edges.iter().map(|r| r.kinds.clone()).collect(),
        fillers: z.fillers.iter().map(|r| r.kinds.clone()).collect(),
    }
}
impl ZoneKinds {
    pub fn all(&self) -> Vec<u8> {
        self.rings
            .iter()
            .chain(&self.clusters)
            .chain(&self.edges)
            .chain(&self.fillers)
            .flatten()
            .copied()
            .collect()
    }
}

/// The legacy prop as `dress` must carry it: kind clamped to 255, world-unit position rounded and clamped, variant kept,
/// flags `FLAG_LEGACY` only.
pub fn legacy_row(p: &rh_sim::mapdata::MapProp) -> rh_mapdress::DressProp {
    let q = |v: f64| v.round().clamp(0.0, 65535.0) as u16;
    rh_mapdress::DressProp {
        kind: p.kind.min(255) as u8,
        x: q(p.x),
        y: q(p.y),
        variant: p.v,
        flags: rh_mapdress::FLAG_LEGACY,
    }
}

pub fn bytes(d: &rh_mapdress::Dressing) -> Vec<u8> {
    let mut out = Vec::new();
    for p in &d.props {
        out.extend_from_slice(&[p.kind]);
        out.extend_from_slice(&p.x.to_le_bytes());
        out.extend_from_slice(&p.y.to_le_bytes());
        out.extend_from_slice(&[p.variant, p.flags]);
    }
    out.extend_from_slice(&d.ground_variants);
    out
}

/// Non-legacy props only.
pub fn placed(d: &rh_mapdress::Dressing) -> Vec<rh_mapdress::DressProp> {
    d.props
        .iter()
        .copied()
        .filter(|p| p.flags & rh_mapdress::FLAG_LEGACY == 0)
        .collect()
}
