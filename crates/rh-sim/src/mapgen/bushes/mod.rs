//! Actual elite-bush placement over genuine pre-records layers. Not a complete map generator.
mod rules;
use crate::map::TILE_FLOOR;
use crate::mapdata::{FeatureJob, FeatureKind, MapFeature, TileRect, Zone};
use crate::mapgen::zones::camps::CampSite;
use crate::rng::{hash_seed, Mulberry32};
pub use rules::{default_definition, visit_content, BushDefinition, DEFAULT_DEFINITION};

/// Same shape as TS FeatureDraft = MapFeature. Its provisional counts/boxes and internal camp
/// references must be finalized by records before full-map admission.
pub type FeatureDraft = MapFeature;

pub struct BushInput<'a> {
    pub w: usize,
    pub h: usize,
    pub seed: i64,
    pub attempt: u64,
    pub tiles: &'a [u8],
    pub terrain: &'a [u8],
    pub zone: &'a [u8],
    pub territory_grid: &'a [u8],
    pub protect: &'a [u8],
    pub pool5: &'a [u8],
    pub avoid: Option<&'a [u8]>,
    /// Internal, pre-records order. CampSite.zone is 1-based, exactly as placeCamps and stage 11b.
    pub camps: &'a [CampSite],
    pub order: &'a [Zone],
    pub terrain_none: u8,
}

/// Appends provisional features and writes only ownership. The attempt RNG is neither accepted nor touched.
/// Requires matching arrays, valid camp/owner references and safe-integer seed metadata.
pub fn place_elite_bushes(
    rules: &BushDefinition,
    input: &BushInput<'_>,
    features: &mut Vec<FeatureDraft>,
    feature_owner: &mut [u16],
) -> usize {
    place_impl(rules, input, features, feature_owner, |_, rng| {
        rng.next_f64()
    })
}
fn place_impl(
    r: &BushDefinition,
    input: &BushInput<'_>,
    features: &mut Vec<FeatureDraft>,
    owner: &mut [u16],
    mut draw: impl FnMut(usize, &mut Mulberry32) -> f64,
) -> usize {
    let n = input.w.checked_mul(input.h).expect("grid area");
    assert!(input.w >= 3 && input.h >= 3 && n <= i32::MAX as usize);
    assert!([
        input.tiles,
        input.terrain,
        input.zone,
        input.territory_grid,
        input.protect,
        input.pool5
    ]
    .iter()
    .all(|a| a.len() == n));
    assert!(owner.len() == n && input.avoid.is_none_or(|a| a.len() == n));
    assert!(owner.iter().all(|&o| usize::from(o) <= features.len()));
    assert!(
        input.camps.len() <= u8::MAX as usize
            && input
                .camps
                .iter()
                .all(|c| c.site < n && c.zone > 0 && usize::from(c.zone) <= input.order.len())
    );
    assert!(
        (-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&input.seed)
            && input.attempt <= 9_007_199_254_740_991
    );
    assert!(
        r.patches_min <= r.patches_max
            && r.tiles_min > 0
            && r.tiles_min <= r.tiles_max
            && r.scan_radius >= 0
    );
    assert!(r.near_min_d2 >= 0 && r.near_max_d2 >= r.near_min_d2 && r.centre_sep_d2 >= 0);
    assert!(r.patches_max.checked_mul(r.tries_per_patch).is_some());
    assert!(r
        .patches_max
        .checked_sub(r.patches_min)
        .and_then(|n| n.checked_add(1))
        .is_some());
    assert!(r
        .tiles_max
        .checked_sub(r.tiles_min)
        .and_then(|n| n.checked_add(1))
        .is_some());
    let mut placed = 0;
    let w = input.w as i64;
    for (ci, c) in input.camps.iter().enumerate() {
        if !c.elite {
            continue;
        }
        let centre = c.site as i64;
        let cx = centre % w;
        let cy = centre / w;
        let mut rng = Mulberry32::new(hash_seed(
            input.seed as u32,
            input.attempt as u32,
            u32::from(c.zone - 1),
            r.stream
                .wrapping_add((ci as u32).wrapping_mul(r.camp_stream_stride)),
        ));
        let mut all = Vec::new();
        let mut hugging = Vec::new();
        for y in (cy - i64::from(r.scan_radius)).max(1)
            ..=(cy + i64::from(r.scan_radius)).min(input.h as i64 - 2)
        {
            for x in
                (cx - i64::from(r.scan_radius)).max(1)..=(cx + i64::from(r.scan_radius)).min(w - 2)
            {
                let t = y * w + x;
                if !ok(input, r, owner, features, ci, t) {
                    continue;
                }
                all.push(t);
                if lee(input, owner, features, t) > 0 {
                    hugging.push(t);
                }
            }
        }
        if all.is_empty() {
            continue;
        }
        let pool = if hugging.len() >= r.tiles_min {
            &hugging
        } else {
            &all
        };
        let want = r.patches_min
            + (draw(ci, &mut rng) * (r.patches_max - r.patches_min + 1) as f64).floor() as usize;
        let mut centres: Vec<i64> = Vec::new();
        let mut patch = 0;
        for _ in 0..want * r.tries_per_patch {
            if patch >= want {
                break;
            }
            let centre = pool[(draw(ci, &mut rng) * pool.len() as f64).floor() as usize];
            if !ok(input, r, owner, features, ci, centre)
                || centres
                    .iter()
                    .any(|&o| distance2(o, centre, w) < r.centre_sep_d2)
            {
                continue;
            }
            let target = r.tiles_min
                + (draw(ci, &mut rng) * (r.tiles_max - r.tiles_min + 1) as f64).floor() as usize;
            let mut piece = vec![centre];
            while piece.len() < target {
                let mut candidates = Vec::new();
                let mut seen = Vec::new();
                for &t in &piece {
                    for u in [t - 1, t + 1, t - w, t + w] {
                        if piece.contains(&u) || seen.contains(&u) {
                            continue;
                        }
                        seen.push(u);
                        if ok(input, r, owner, features, ci, u) {
                            candidates.push(u);
                        }
                    }
                }
                if candidates.is_empty() {
                    break;
                }
                let leaning: Vec<i64> = candidates
                    .iter()
                    .copied()
                    .filter(|&t| lee(input, owner, features, t) > 0)
                    .collect();
                let from = if leaning.is_empty() {
                    &candidates
                } else {
                    &leaning
                };
                piece.push(from[(draw(ci, &mut rng) * from.len() as f64).floor() as usize]);
            }
            if piece.len() < r.tiles_min {
                continue;
            }
            piece.sort_unstable();
            let ax = (piece[0] % w) as i32;
            let ay = (piece[0] / w) as i32;
            features.push(MapFeature {
                kind: FeatureKind::Bush,
                variant: String::new(),
                zone: input.order[usize::from(c.zone - 1)],
                jobs: vec![FeatureJob::Cover],
                ax,
                ay,
                p: vec![ci as i32, patch as i32],
                bbox: TileRect {
                    x: ax,
                    y: ay,
                    w: 0,
                    h: 0,
                },
                tiles: 0,
            });
            patch += 1;
            // JS Uint16Array assignment wraps, even for direct helper inputs beyond production feature caps.
            for t in piece {
                owner[t as usize] = features.len() as u16;
            }
            centres.push(centre);
            placed += 1;
        }
    }
    placed
}
fn distance2(a: i64, b: i64, w: i64) -> i64 {
    let dx = a % w - b % w;
    let dy = a / w - b / w;
    dx * dx + dy * dy
}
fn is_bush(owner: &[u16], features: &[FeatureDraft], t: i64) -> bool {
    usize::try_from(t)
        .ok()
        .and_then(|i| owner.get(i))
        .is_some_and(|&o| o > 0 && features[usize::from(o - 1)].kind == FeatureKind::Bush)
}
fn ok(
    input: &BushInput<'_>,
    r: &BushDefinition,
    owner: &[u16],
    features: &[FeatureDraft],
    ci: usize,
    t: i64,
) -> bool {
    let Some(i) = usize::try_from(t).ok().filter(|&i| i < input.tiles.len()) else {
        return false;
    };
    let c = &input.camps[ci];
    if input.tiles[i] != TILE_FLOOR
        || input.terrain[i] != input.terrain_none
        || input.zone[i] != c.zone
        || usize::from(input.territory_grid[i]) != ci + 1
        || owner[i] != 0
        || input.protect[i] != 0
        || input.pool5[i] != 0
        || input.avoid.is_some_and(|a| a[i] != 0)
    {
        return false;
    }
    let d2 = distance2(t, c.site as i64, input.w as i64);
    if d2 < r.near_min_d2 || d2 > r.near_max_d2 {
        return false;
    }
    let w = input.w as i64;
    ![t - 1, t + 1, t - w, t + w]
        .into_iter()
        .any(|u| is_bush(owner, features, u))
}
fn lee(input: &BushInput<'_>, owner: &[u16], features: &[FeatureDraft], t: i64) -> usize {
    let mut count = 0;
    for dy in -1..=1 {
        for dx in -1..=1 {
            if dx == 0 && dy == 0 {
                continue;
            }
            let u = t + dy * input.w as i64 + dx;
            let i = usize::try_from(u).ok().filter(|&i| i < input.tiles.len());
            if i.is_none_or(|i| {
                input.tiles[i] != TILE_FLOOR
                    || input.terrain[i] != input.terrain_none
                    || (owner[i] > 0 && !is_bush(owner, features, u))
            }) {
                count += 1;
            }
        }
    }
    count
}
#[cfg(test)]
mod tests;
