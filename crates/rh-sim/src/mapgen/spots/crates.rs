//! Ordered landmark nooks, exclusions, per-zone spacing and open-floor fallback.
use super::*;
pub struct CrateInput<'a> {
    pub fixed: &'a FixedLayout,
    pub tiles: &'a [u8],
    pub terrain: &'a [u8],
    pub zone: &'a [u8],
    pub feature_owner: &'a [u16],
    pub features: &'a [MapFeature],
    pub pool: &'a [usize],
    pub camps: &'a [CampSite],
    pub styled: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoneTrace {
    pub nooks: Vec<usize>,
    pub cands: Vec<usize>,
    pub open: Option<Vec<usize>>,
    pub want: usize,
    pub chosen: Vec<usize>,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrateOutput {
    pub door_near: Vec<u8>,
    pub nooks_by_zone: Vec<Vec<usize>>,
    pub initial_no: Vec<u8>,
    pub crate_no: Vec<u8>,
    pub zones: Vec<ZoneTrace>,
    pub refusal: Option<Refusal>,
}
fn against(tiles: &[u8], i: usize) -> bool {
    NB4.iter()
        .any(|&o| tiles.get((i as i32 + o) as usize) == Some(&TILE_WALL))
}
fn take(chosen: &mut Vec<usize>, ordered: &[usize], wanted: usize, d: &Definition) {
    for sep in [d.crate_first_gap, d.crate_gap] {
        for &c in ordered {
            if chosen.len() >= wanted {
                break;
            }
            if !chosen.contains(&c) && chosen.iter().all(|&o| cheb(o, c) >= sep) {
                chosen.push(c)
            }
        }
    }
}
pub fn weapon_crates(
    input: CrateInput<'_>,
    rng: &mut impl FnMut() -> f64,
    d: &Definition,
) -> Result<CrateOutput, Error> {
    check(d)?;
    let CrateInput {
        fixed,
        tiles,
        terrain,
        zone,
        feature_owner,
        features,
        pool,
        camps,
        styled,
    } = input;
    lengths(&[tiles, terrain, zone, &fixed.ring])?;
    if feature_owner.len() != N {
        return Err(Error::Length);
    }
    indices(pool)?;
    if zone.iter().any(|&z| z as usize > ZONES) {
        return Err(Error::Index);
    }
    for c in camps {
        indices(&[c.site])?;
        indices(&c.spots)?;
    }
    for f in features {
        if f.kind == FeatureKind::Landmark {
            let b = &f.bbox;
            if b.x < 0
                || b.y < 0
                || i64::from(b.x) + i64::from(b.w) > W as i64
                || i64::from(b.y) + i64::from(b.h) > H as i64
            {
                return Err(Error::FeatureBounds);
            }
            if f.p.iter().skip(2).any(|&i| i < 0 || i as usize >= N) {
                return Err(Error::Index);
            }
        }
    }
    let mut door_near = vec![0; N];
    let mut nooks_by_zone = vec![Vec::new(); ZONES + 1];
    for f in features {
        if f.kind == FeatureKind::Landmark {
            for &t in f.p.iter().skip(2) {
                mark(&mut door_near, t as usize, d.door_margin)
            }
        }
    }
    for (fi, f) in features.iter().enumerate() {
        if f.kind != FeatureKind::Landmark {
            continue;
        }
        let b = &f.bbox;
        for y in b.y..b.y + b.h as i32 {
            for x in b.x..b.x + b.w as i32 {
                let i = y as usize * W + x as usize;
                if feature_owner[i] as usize != fi + 1
                    || tiles[i] != TILE_FLOOR
                    || door_near[i] != 0
                {
                    continue;
                }
                let walls = NB4
                    .iter()
                    .filter(|&&o| {
                        let j = (i as i32 + o) as usize;
                        tiles.get(j) == Some(&TILE_WALL)
                            && feature_owner.get(j).is_some_and(|&v| v as usize == fi + 1)
                    })
                    .count();
                if walls >= 2 && zone[i] != 0 {
                    nooks_by_zone[zone[i] as usize].push(i)
                }
            }
        }
    }
    let mut crate_no = vec![0; N];
    for &t in pool {
        mark(&mut crate_no, t, d.crate_pool_margin)
    }
    for c in camps {
        mark(&mut crate_no, c.site, d.crate_camp_margin);
        for &t in &c.spots {
            mark(&mut crate_no, t, d.crate_spot_margin)
        }
    }
    for i in 0..N {
        if door_near[i] != 0 {
            crate_no[i] = 1
        }
    }
    let initial_no = crate_no.clone();
    let mut zones = Vec::new();
    let mut refusal = None;
    for (z, all_nooks) in nooks_by_zone.iter().enumerate().skip(1) {
        let free = |i: usize| {
            zone[i] as usize == z
                && tiles[i] == TILE_FLOOR
                && fixed.ring[i] == 0
                && crate_no[i] == 0
                && (!styled
                    || (-1..=1).all(|dy| {
                        (-1..=1).all(|dx| {
                            let x = (i % W) as i32 + dx;
                            let y = (i / W) as i32 + dy;
                            x < 0
                                || y < 0
                                || x >= W as i32
                                || y >= H as i32
                                || terrain[y as usize * W + x as usize] == 0
                        })
                    }))
        };
        let nooks: Vec<_> = all_nooks
            .iter()
            .copied()
            .filter(|&i| against(tiles, i) && free(i))
            .collect();
        let mut cands = Vec::new();
        for y in 2..H - 2 {
            for x in 2..W - 2 {
                let i = y * W + x;
                if against(tiles, i) && free(i) && !nooks.contains(&i) {
                    cands.push(i)
                }
            }
        }
        let wanted = want(rng, d.crate_min, d.crate_max);
        shuffle(rng, &mut cands);
        let mut ordered = nooks.clone();
        ordered.extend_from_slice(&cands);
        let mut chosen = Vec::new();
        take(&mut chosen, &ordered, wanted, d);
        let mut open = None;
        if chosen.len() < d.crate_min {
            let mut a = Vec::new();
            for y in 2..H - 2 {
                for x in 2..W - 2 {
                    let i = y * W + x;
                    if !against(tiles, i) && open3(tiles, i) && free(i) {
                        a.push(i)
                    }
                }
            }
            shuffle(rng, &mut a);
            take(&mut chosen, &a, wanted, d);
            open = Some(a);
        }
        if chosen.len() < d.crate_min {
            refusal = Some(Refusal::Crates)
        } else {
            for &c in &chosen {
                mark(&mut crate_no, c, d.crate_gap - 1)
            }
        }
        zones.push(ZoneTrace {
            nooks,
            cands,
            open,
            want: wanted,
            chosen,
        });
        if refusal.is_some() {
            break;
        }
    }
    Ok(CrateOutput {
        door_near,
        nooks_by_zone,
        initial_no,
        crate_no,
        zones,
        refusal,
    })
}
