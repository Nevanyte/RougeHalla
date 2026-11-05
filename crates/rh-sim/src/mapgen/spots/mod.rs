//! Pure ordered stage-8 camp/crate placement and stage-11 ground placement.
//! The caller lends the advanced main stream (finite draws in [0,1)); normal refusals retain every draw.
mod crates;
mod ground;
mod rules;
use super::{
    coliseum::{FixedLayout, H, W},
    grid_ops::{NB4, RING_OFF},
    zones::{camps::CampSite, ZoneContext, ZONES},
};
use crate::{
    map::{TILE_FLOOR, TILE_WALL},
    mapdata::{FeatureKind, MapFeature},
};
pub use crates::{weapon_crates, CrateInput, CrateOutput, ZoneTrace};
pub use ground::{ground_spots, GroundInput, GroundOutput};
pub use rules::{default_definition, visit_content, Definition, DEFAULT_DEFINITION};
const N: usize = W * H;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    Length,
    Index,
    FeatureBounds,
    TerrainKind,
    Definition,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Refusal {
    Crates,
    Ground,
}
fn check(d: &Definition) -> Result<(), Error> {
    if d.camp_min > d.camp_max
        || d.crate_min > d.crate_max
        || d.ground_min > d.ground_max
        || d.crate_gap == 0
        || d.crate_max > N
        || d.ground_max > N
        || d.camp_max > N
        || [
            d.camp_gap,
            d.crate_gap,
            d.crate_first_gap,
            d.crate_pool_margin,
            d.crate_camp_margin,
            d.crate_spot_margin,
            d.door_margin,
            d.ground_spawn_margin,
            d.ground_crate_margin,
            d.ground_hazard_margin,
        ]
        .into_iter()
        .chain(d.ground_gaps)
        .any(|n| n >= W.min(H))
    {
        return Err(Error::Definition);
    }
    Ok(())
}
fn indices(a: &[usize]) -> Result<(), Error> {
    if a.iter().any(|&i| i >= N) {
        Err(Error::Index)
    } else {
        Ok(())
    }
}
fn lengths(a: &[&[u8]]) -> Result<(), Error> {
    if a.iter().any(|a| a.len() != N) {
        Err(Error::Length)
    } else {
        Ok(())
    }
}
fn mark(a: &mut [u8], i: usize, margin: usize) {
    let (x, y) = (i % W, i / W);
    for yy in y.saturating_sub(margin)..=(y + margin).min(H - 1) {
        for xx in x.saturating_sub(margin)..=(x + margin).min(W - 1) {
            a[yy * W + xx] = 1;
        }
    }
}
fn cheb(a: usize, b: usize) -> usize {
    (a % W).abs_diff(b % W).max((a / W).abs_diff(b / W))
}
fn d2(a: usize, b: usize) -> usize {
    let x = (a % W).abs_diff(b % W);
    let y = (a / W).abs_diff(b / W);
    x * x + y * y
}
fn shuffle(rng: &mut impl FnMut() -> f64, a: &mut [usize]) {
    for i in (1..a.len()).rev() {
        let j = (rng() * (i + 1) as f64).floor() as usize;
        a.swap(i, j);
    }
}
fn want(rng: &mut impl FnMut() -> f64, lo: usize, hi: usize) -> usize {
    lo + (rng() * (hi + 1 - lo) as f64).floor() as usize
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampTrace {
    pub around: Vec<usize>,
    pub want: usize,
    pub spots: Vec<usize>,
}
/// Internal input camp order and shared clearing order are preserved. No camp is mutated on malformed admission.
pub fn camp_spots(
    zones: &ZoneContext<'_>,
    camps: &mut [CampSite],
    rng: &mut impl FnMut() -> f64,
    d: &Definition,
) -> Result<Vec<CampTrace>, Error> {
    check(d)?;
    let mut all = Vec::new();
    for c in camps.iter() {
        indices(&[c.site])?;
        let mut a = Vec::new();
        for &off in zones.clearing_offsets() {
            if off != 0 {
                let i = c.site as i64 + i64::from(off);
                if !(0..N as i64).contains(&i) {
                    return Err(Error::Index);
                }
                // Reject row-wrap aliases as malformed geometry.
                if cheb(i as usize, c.site) > zones.camp_radius().ceil() as usize + 1 {
                    return Err(Error::Index);
                }
                a.push(i as usize);
            }
        }
        all.push(a);
    }
    let mut traces = Vec::new();
    for (c, mut around) in camps.iter_mut().zip(all) {
        shuffle(rng, &mut around);
        let wanted = want(rng, d.camp_min, d.camp_max);
        let mut spots = Vec::new();
        for &t in &around {
            if spots.len() >= wanted {
                break;
            }
            if spots.iter().all(|&o| cheb(o, t) >= d.camp_gap) {
                spots.push(t)
            }
        }
        for &t in &around {
            if spots.len() >= wanted {
                break;
            }
            if !spots.contains(&t) {
                spots.push(t)
            }
        }
        if c.elite {
            spots.sort_by_key(|&t| (d2(t, c.site), t));
        }
        c.spots = spots.clone();
        traces.push(CampTrace {
            around,
            want: wanted,
            spots,
        });
    }
    Ok(traces)
}
fn open3(tiles: &[u8], i: usize) -> bool {
    tiles[i] == TILE_FLOOR
        && RING_OFF
            .iter()
            .all(|&o| tiles.get((i as i32 + o) as usize) == Some(&TILE_FLOOR))
}
#[cfg(test)]
mod tests;
