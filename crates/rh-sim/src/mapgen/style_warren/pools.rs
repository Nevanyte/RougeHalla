//! Signature mode (P-LAND-PLAGUE-1, no legacy counterpart): the Plague styler lays its bog as free pools arranged by
//! band round the bog tree instead of a crescent beside each barrow. Reached only when the Landmarks phase placed the
//! zone's `BogTree` (`pipeline::Options::signature`); option off never calls this file.
//!
//! A pool is two to four overlapping discs of one size (small, medium, large), each disc's rim roughened by stateless
//! noise (the core is never eaten), laid as one `BogPool` feature. Each pool keeps a ring of plain floor round it,
//! reserved so no barrow rock or floor claim lands there (`rh-mapdress` lays water and mud in it). Two pools are merged
//! (one body) or `gap` tiles apart. Pools keep off the route guard's corridor, the camp clearings and halos, the spawn
//! pads, the tree's apron and, where they can, the rock of the barrows today's rule would site. Bands are filled
//! nearest first, each with its own sizes; while the zone holds less than its bog budget, pools of two to four more
//! discs are then laid merged onto the pools already standing, each of them a `BogPool` of its own: a merged body has
//! several owners, so a reader finds a pool as a 4-connected piece of styler bog, not as one feature.
//!
//! Pools keep the spawns' walks (P-LAND-PLAGUE-1-fix, `walk.rs`): a pool, or discs merged onto one, that would make some
//! spawn's walk to the coliseum more than `walk_detour` steps longer with bog avoided is not laid; after the barrows,
//! `walk::give_way` gives back whole bodies, last laid first, while a walk is still past its limit.
//!
//! Draws: only the styler's own shape stream (`c.streams.rng`), nine per pool slot (disc count, then four
//! parent/direction pairs), in laying order; candidate order and rough rims are stateless noise.
use super::walk::Walk;
use super::*;
use crate::mapdata::ZoneAnchor;
use crate::mapgen::certify::rules::R;
use crate::mapgen::landmarks::signature::{band, Band};
use crate::mapgen::style_features::noise_q;
use crate::mapgen::style_runtime::BaseContext;

/// One band's rule: which sizes (indices into `Pools::across`) it tries, in order, and how many pools it may hold.
#[derive(Clone, Copy, Debug)]
pub struct BandRule {
    pub band: Band,
    pub sizes: &'static [usize],
    pub most: usize,
}

/// The pool tunables. Not folded into `content_hash` (option off by default; `tests/content.rs` NON_GAMEPLAY).
#[derive(Clone, Copy, Debug)]
pub struct Pools {
    /// The bog budget: styler bog per mille of the zone's free ground (Plague floor outside the tree's apron).
    pub share_permille: usize,
    /// Disc sizes, tiles across: small, medium, large (owner: about 5, 8 and 12).
    pub across: [i32; 3],
    /// Per size: the number of discs in a pool (inclusive range, within two to four).
    pub discs: [(usize, usize); 3],
    /// Per size: the rim roughness, the least and most change of a rim tile's disc diameter (tiles). The small disc
    /// may only grow, so its 5-across core stays whole.
    pub rim: [(i32, i32); 3],
    /// The bands, filled in this order.
    pub bands: [BandRule; 3],
    /// Per size: the squared radius of the whole disc a pool of that size holds (the nominal disc less its rough rim)
    /// and the next size's does not: small 5 (the whole 5-across disc), medium 9 (7 across), large 25 (11 across).
    pub class_r2: [i32; 3],
    /// The most tiles one body of merged pools holds.
    pub body_most: usize,
    /// Of how many fitting centres (in candidate order) a slot takes the largest pool.
    pub best_of: usize,
    /// Distance between the centres of two overlapping discs, per mille of the diameter (diagonals scaled by 707/1000).
    pub step_permille: i32,
    /// Two distinct pools are at least this many tiles apart (Chebyshev).
    pub gap: i32,
    /// The ring of plain floor kept round every pool (Chebyshev width).
    pub ring: i32,
    /// Tiles kept between a pool and a camp's clearing (the camp's radius), beyond its halo.
    pub camp_gap: f64,
    /// Barrow sites (per mille of the zone's sites, rounded down) the pools may take where they fit nowhere else; those
    /// barrows are sited again by today's rule on what the pools leave.
    pub give_way_permille: usize,
    /// Rough rims: value-noise cell (tiles) and salt; candidate order: hash salt.
    pub rough_cell: f64,
    pub rough_salt: f64,
    pub order_salt: f64,
    /// The most steps a pool may add to a spawn's walk to the coliseum (4-connected, bog avoided).
    pub walk_detour: i32,
}

pub const POOLS: Pools = Pools {
    share_permille: 80,
    across: [5, 8, 12],
    discs: [(3, 4), (3, 4), (3, 4)],
    rim: [(0, 1), (-1, 1), (-1, 1)],
    bands: [
        BandRule {
            band: Band::Near,
            sizes: &[2],
            most: 2,
        },
        BandRule {
            band: Band::Mid,
            sizes: &[2, 1, 0],
            most: 3,
        },
        BandRule {
            band: Band::Far,
            sizes: &[1, 0],
            most: 64,
        },
    ],
    class_r2: [5, 9, 25],
    body_most: 500,
    best_of: 16,
    step_permille: 600,
    gap: 8,
    ring: 2,
    camp_gap: 1.5,
    give_way_permille: 200,
    rough_cell: 3.0,
    rough_salt: 401.0,
    order_salt: 402.0,
    walk_detour: 2,
};

/// Plague's anchor as the styler sees it: the bog tree's frame's anchor (`BaseContext::landmark`,
/// P-MAPGEN-LANDMARK-FRAME-1; present only with the option on), the finished map's anchor. Only its footprint is read
/// (`signature::band`): the drawing's box, which is the `BogTree` feature's.
pub(super) fn tree(b: BaseContext<'_>) -> Option<ZoneAnchor> {
    b.landmark.map(|f| f.anchor.clone())
}

/// The ground the pools read, fixed before the first pool is laid.
struct Ground {
    w: i32,
    h: i32,
    pool_ok: Vec<bool>,
    ring_ok: Vec<bool>,
    rough: Vec<f64>,
    /// The barrow site (index + 1) whose rock covers the tile, 0 for none.
    site: Vec<usize>,
}

impl Ground {
    fn at(&self, x: i32, y: i32) -> Option<usize> {
        (x >= 0 && y >= 0 && x < self.w && y < self.h).then(|| (y * self.w + x) as usize)
    }
}

/// The pools laid so far: per tile, the body (pool index + 1) it belongs to and the one body whose spacing covers it
/// (`many()` when two do); per body, its size, band and disc centres.
struct Laid {
    body: Vec<u16>,
    near: Vec<u16>,
    pools: Vec<Body>,
}

/// One body of pools: the size of its discs, its band and its disc centres.
#[derive(Clone)]
struct Body {
    size: usize,
    band: Band,
    centres: Vec<(i32, i32)>,
}

/// `Laid::near` of a tile within the spacing of two bodies.
fn many() -> u16 {
    u16::MAX
}

/// Where a pool may lie beyond its ground: within the spacing of no body but `own` (the body it merges onto, 0 for a
/// new pool), off the barrows' sites except those already given way or up to `room` more, and, for a new pool, not of
/// size `not`.
struct Free<'a> {
    laid: &'a Laid,
    own: u16,
    dropped: &'a [bool],
    room: usize,
}

impl Free<'_> {
    fn spaced(&self, i: usize) -> bool {
        self.laid.near[i] == 0 || self.laid.near[i] == self.own
    }
    fn site_ok(&self, g: &Ground, i: usize) -> bool {
        g.site[i] == 0 || self.dropped[g.site[i] - 1] || self.room > 0
    }
    /// Notes the barrow site under `i` that the pool would take.
    fn take(&self, g: &Ground, i: usize, drops: &mut Vec<usize>) {
        let k = g.site[i];
        if k != 0 && !self.dropped[k - 1] && !drops.contains(&(k - 1)) {
            drops.push(k - 1);
        }
    }
}

/// A grown pool: the body's tiles (row order, the merged body when merging), its ring, and the barrow sites it takes.
struct Grown {
    centres: Vec<(i32, i32)>,
    tiles: Vec<i32>,
    ring: Vec<i32>,
    drops: Vec<usize>,
}

/// Lays the pools, nearest band first, and returns their tiles (each pool's new tiles in row order, in laying order)
/// with the body (1-based) each belongs to. Every pool tile is owned by its `BogPool` feature; every ring tile is
/// reserved for the rest of the zone's shape. No pool lengthens a spawn's walk past `walk_detour` (`walk.rs`).
pub(super) fn lay(
    c: &mut ShapeContext<'_, '_>,
    tree: &ZoneAnchor,
    corridor: &[u8],
    sites: &[Vec<i32>],
    fixed: &FixedLayout,
    d: &Pools,
) -> Result<(Vec<i32>, Vec<u16>), Error> {
    let (w, h) = (c.base().w, c.base().h);
    let n = w * h;
    let (wi, hi) = (w as i32, h as i32);
    let noise = c.streams.noise;
    let mut halo = vec![false; n];
    let mut keep = vec![false; n];
    let mut halo_offsets = Vec::new();
    for dy in -R.protection_span..=R.protection_span {
        for dx in -R.protection_span..=R.protection_span {
            let near = (-R.halo..=R.halo).any(|oy| {
                (-R.halo..=R.halo).any(|ox| {
                    f64::from((dx + ox) * (dx + ox) + (dy + oy) * (dy + oy))
                        <= R.clearing * R.clearing
                })
            });
            if near {
                halo_offsets.push((dx, dy));
            }
        }
    }
    let b = c.base();
    let mut bushes = vec![false; n];
    // Bushes are laid after the stylers and own the floor they stand on: unprotected floor of an elite camp's territory
    // within `near_max_d2` of it (`bushes::ok`). The ring keeps out of their reach.
    let reach = crate::mapgen::bushes::DEFAULT_DEFINITION.near_max_d2;
    let span = (1..).find(|r: &i64| r * r > reach).unwrap_or(0) as i32;
    for k in b.camps {
        // The camp's clearing grown by `camp_gap` (the certifier keeps hazards a tile off the clearing).
        let r2 = (k.r + d.camp_gap) * (k.r + d.camp_gap);
        let cs = (k.r + d.camp_gap).ceil() as i32;
        for dy in -cs..=cs {
            for dx in -cs..=cs {
                let i = b.at(k.x + dx, k.y + dy);
                if i >= 0 && f64::from(dx * dx + dy * dy) <= r2 {
                    keep[i as usize] = true;
                }
            }
        }
        for &(dx, dy) in &halo_offsets {
            let i = b.at(k.x + dx, k.y + dy);
            if i >= 0 {
                halo[i as usize] = true;
            }
        }
        if k.elite {
            for dy in -span..=span {
                for dx in -span..=span {
                    let i = b.at(k.x + dx, k.y + dy);
                    if i >= 0
                        && i64::from(dx * dx + dy * dy) <= reach
                        && b.hard[i as usize] == 0
                        && b.territory.is_none_or(|t| t[i as usize] == k.territory)
                    {
                        bushes[i as usize] = true;
                    }
                }
            }
        }
    }
    // The spawn pads (the certifier's hazard square) and the route guard's corridor (a bog surface refuses it).
    for &s in b.spawns {
        let (sx, sy) = (s % wi, s / wi);
        for y in sy - R.spawn_hazard..=sy + R.spawn_hazard {
            for x in sx - R.spawn_hazard..=sx + R.spawn_hazard {
                let i = b.at(x, y);
                if i >= 0 {
                    keep[i as usize] = true;
                }
            }
        }
    }
    for (i, &v) in corridor.iter().enumerate().take(n) {
        if v == 1 {
            keep[i] = true;
        }
    }
    let mut ground = Ground {
        w: wi,
        h: hi,
        pool_ok: vec![false; n],
        ring_ok: vec![false; n],
        rough: vec![0.0; n],
        site: vec![0; n],
    };
    for (k, rock) in sites.iter().enumerate() {
        for &i in rock {
            if let Some(i) = usize::try_from(i).ok().filter(|&i| i < n) {
                if ground.site[i] == 0 {
                    ground.site[i] = k + 1;
                }
            }
        }
    }
    let mut free = 0usize;
    let mut order = Vec::new();
    for i in 0..n {
        if b.mask[i] == 0 {
            continue;
        }
        let (x, y) = (i as i32 % wi, i as i32 / wi);
        let core = band(tree, x, y) == Band::Core;
        let floor = b.tiles[i] == TILE_FLOOR;
        if floor && !core {
            free += 1;
        }
        let plain = floor && b.terrain[i] == 0 && !b.is_owned(i as i32) && !halo[i];
        ground.ring_ok[i] = plain && !bushes[i];
        // The ground a bog surface may take (`style_runtime` `can_surface`), off the map's edge. Unlike blocking, bog
        // keeps no rim from the zone's edge: the ring keeps the pool inside the zone.
        ground.pool_ok[i] = plain
            && !core
            && !keep[i]
            && b.hard[i] == 0
            && b.no_block[i] == 0
            && !c.is_reserved(i as i32)
            && x > 0
            && y > 0
            && x < wi - 1
            && y < hi - 1;
        ground.rough[i] = noise_q(&noise, x as f64, y as f64, d.rough_cell, d.rough_salt);
        order.push((noise_hash(noise, x as f64, y as f64, d.order_salt), i));
    }
    order.sort_by(|p, q| p.0.total_cmp(&q.0).then_with(|| p.1.cmp(&q.1)));
    let target = free * d.share_permille / 1000;
    let mut laid = Laid {
        body: vec![0; n],
        near: vec![0; n],
        pools: Vec::new(),
    };
    let mut walk = Walk::new(&c.base(), fixed, d.walk_detour);
    let mut out = Vec::new();
    let mut owner = Vec::new();
    let mut total = 0;
    // Barrow sites the pools may take (today's rule then sites those barrows again on what is left).
    let most = sites.len() * d.give_way_permille / 1000;
    let mut dropped = vec![false; sites.len()];
    let mut gone = 0;
    // New pools, band by band.
    for rule in &d.bands {
        let mut count = 0;
        while count < rule.most && total < target {
            let (kd, links) = recipe(c);
            // Size variance: once two pools stand and both are of one size, a third is of another size or none is laid.
            let mut sizes: Vec<usize> = rule.sizes.to_vec();
            if let Some(s0) = laid.pools.first().map(|p| p.size) {
                if laid.pools.len() >= 2 && laid.pools.iter().all(|p| p.size == s0) {
                    sizes.retain(|&s| s != s0);
                }
            }
            let mut found: Option<(usize, Grown)> = None;
            // The drawn disc count in the band's sizes, in order; of the first `best_of` centres (in noise order) that
            // grow a pool of at least two discs, the largest that keeps the spawns' walks (when none of them does, the
            // first further one that does). Off the barrows' sites first; where no pool fits, over at most `most` of
            // them in all.
            for room in rooms(most, gone) {
                if found.is_some() {
                    break;
                }
                let free = Free {
                    laid: &laid,
                    own: 0,
                    dropped: &dropped,
                    room,
                };
                for &s in &sizes {
                    let (lo, hi) = d.discs[s];
                    let k = lo + ((kd * (hi - lo + 1) as f64).floor() as usize).min(hi - lo);
                    let mut seen = 0;
                    for &(_, i) in &order {
                        if seen >= d.best_of && found.is_some() {
                            break;
                        }
                        if !ground.pool_ok[i] || laid.near[i] != 0 {
                            continue;
                        }
                        let at = (i as i32 % wi, i as i32 / wi);
                        let base = [at];
                        if !core_fits(&ground, &free, d, s, at) {
                            continue;
                        }
                        let grown = grow(
                            &ground,
                            &free,
                            tree,
                            d,
                            s,
                            &base,
                            k - 1,
                            1,
                            &links,
                            rule.band,
                        );
                        if let Some(p) = grown {
                            seen += 1;
                            if found
                                .as_ref()
                                .is_none_or(|q| p.tiles.len() > q.1.tiles.len())
                                && walk.keeps(&p.tiles)
                            {
                                found = Some((s, p));
                            }
                        }
                    }
                    if found.is_some() {
                        break;
                    }
                }
            }
            let Some((s, p)) = found else {
                break;
            };
            laid.pools.push(Body {
                size: s,
                band: rule.band,
                centres: Vec::new(),
            });
            let id = laid.pools.len();
            let from = out.len();
            total += place(c, &mut laid, id, p, d, &mut dropped, &mut gone, &mut out)?;
            walk.refresh(&out[from..]);
            owner.resize(out.len(), id as u16);
            count += 1;
        }
    }
    // Merged pools: while the budget is not met, two to four more discs onto a standing pool, each pool in turn.
    let mut stuck = vec![false; laid.pools.len()];
    while total < target && stuck.iter().any(|s| !s) {
        for (p, done) in stuck.iter_mut().enumerate() {
            if total >= target {
                break;
            }
            if *done {
                continue;
            }
            let (kd, links) = recipe(c);
            let Body {
                size: s,
                band: want,
                centres: base,
            } = laid.pools[p].clone();
            let (lo, hi) = d.discs[s];
            let k = lo + ((kd * (hi - lo + 1) as f64).floor() as usize).min(hi - lo);
            let mut found = None;
            for room in rooms(most, gone) {
                if found.is_some() {
                    break;
                }
                let free = Free {
                    laid: &laid,
                    own: (p + 1) as u16,
                    dropped: &dropped,
                    room,
                };
                found = grow(&ground, &free, tree, d, s, &base, k, 2, &links, want)
                    .filter(|g| walk.keeps(&g.tiles));
            }
            match found {
                Some(grown) if grown.tiles.iter().any(|&i| laid.body[i as usize] == 0) => {
                    let from = out.len();
                    total += place(
                        c,
                        &mut laid,
                        p + 1,
                        grown,
                        d,
                        &mut dropped,
                        &mut gone,
                        &mut out,
                    )?;
                    walk.refresh(&out[from..]);
                    owner.resize(out.len(), (p + 1) as u16);
                }
                _ => *done = true,
            }
        }
    }
    Ok((out, owner))
}

/// A pool slot's draws: the disc count, then four (parent, direction) pairs.
fn recipe(c: &mut ShapeContext<'_, '_>) -> (f64, [(f64, f64); 4]) {
    let kd = c.streams.rng.next_f64();
    let mut links = [(0.0, 0.0); 4];
    for l in &mut links {
        *l = (c.streams.rng.next_f64(), c.streams.rng.next_f64());
    }
    (kd, links)
}

/// The barrow sites a search may take: none, then, when some are left, up to all that are left.
fn rooms(most: usize, gone: usize) -> Vec<usize> {
    if most > gone {
        vec![0, most - gone]
    } else {
        vec![0]
    }
}

/// Lays a grown pool as body `id`: one `BogPool` feature owning its new tiles, its ring reserved, its spacing marked.
/// Returns the number of new tiles.
// Explicit inputs keep the laying state visible at the call.
#[allow(clippy::too_many_arguments)]
fn place(
    c: &mut ShapeContext<'_, '_>,
    laid: &mut Laid,
    id: usize,
    p: Grown,
    d: &Pools,
    dropped: &mut [bool],
    gone: &mut usize,
    out: &mut Vec<i32>,
) -> Result<usize, Error> {
    let w = c.base().w as i32;
    let h = c.base().h as i32;
    let fresh: Vec<i32> = p
        .tiles
        .iter()
        .copied()
        .filter(|&i| laid.body[i as usize] == 0)
        .collect();
    let anchor = p.centres.last().copied().unwrap_or_default();
    let spec = FeatureSpec {
        kind: FeatureKind::BogPool,
        variant: None,
        jobs: vec![FeatureJob::Crossing],
        anchor: [anchor.0, anchor.1],
        params: None,
        blocks: Vec::new(),
        groups: None,
        floor: Some(fresh.clone()),
        mode: Mode::Whole,
        min_piece: None,
        min_share_permille: None,
        min_groups: None,
    };
    match c.place_feature(&spec)? {
        Some(f) if f.written.is_empty() => {}
        _ => return Err(Error::Feature),
    }
    for &i in &p.ring {
        c.reserve(i);
    }
    for k in p.drops {
        dropped[k] = true;
        *gone += 1;
    }
    let tag = id as u16;
    for &i in &fresh {
        laid.body[i as usize] = tag;
        let (x, y) = (i % w, i / w);
        for v in (y - d.gap + 1).max(0)..=(y + d.gap - 1).min(h - 1) {
            for u in (x - d.gap + 1).max(0)..=(x + d.gap - 1).min(w - 1) {
                let j = (v * w + u) as usize;
                if laid.near[j] == 0 {
                    laid.near[j] = tag;
                } else if laid.near[j] != tag {
                    laid.near[j] = many();
                }
            }
        }
    }
    laid.pools[id - 1].centres = p.centres;
    out.extend_from_slice(&fresh);
    Ok(fresh.len())
}

/// Grows discs of size `s` onto `base` (a new pool's first disc, or a standing pool's discs), one at a time up to
/// `add`: each stands one step from a disc already there in one of eight directions, the drawn parent and direction
/// first (`links`), then the others in turn. Returns the body once at least `need` discs were added.
// Explicit inputs keep the candidate test free of hidden state.
#[allow(clippy::too_many_arguments)]
fn grow(
    g: &Ground,
    free: &Free<'_>,
    tree: &ZoneAnchor,
    d: &Pools,
    s: usize,
    base: &[(i32, i32)],
    add: usize,
    need: usize,
    links: &[(f64, f64); 4],
    want: Band,
) -> Option<Grown> {
    let step = (d.across[s] * d.step_permille + 500) / 1000;
    let diag = (step * 707 + 500) / 1000;
    let dirs = [
        (1, 0),
        (1, 1),
        (0, 1),
        (-1, 1),
        (-1, 0),
        (-1, -1),
        (0, -1),
        (1, -1),
    ];
    let mut centres = base.to_vec();
    let mut best = None;
    for (j, &(pf, df)) in links.iter().enumerate().take(add) {
        let len = centres.len();
        let parent = ((pf * len as f64).floor() as usize).min(len - 1);
        let dir = ((df * 8.0).floor() as usize).min(7);
        let mut next = None;
        'try_disc: for p in 0..len {
            let from = centres[(parent + p) % len];
            for q in 0..dirs.len() {
                let (ux, uy) = dirs[(dir + q) % dirs.len()];
                let st = if ux != 0 && uy != 0 { diag } else { step };
                let c = (from.0 + ux * st, from.1 + uy * st);
                if centres.contains(&c) || !core_fits(g, free, d, s, c) {
                    continue;
                }
                centres.push(c);
                if let Some(pool) = build(g, free, tree, d, s, &centres, want) {
                    next = Some(pool);
                    break 'try_disc;
                }
                centres.pop();
            }
        }
        match next {
            Some(pool) => {
                if j + 1 >= need {
                    best = Some(pool);
                }
            }
            None => break,
        }
    }
    best
}

/// Whether the core of a disc of size `s` on `c` (the disc less its rim, never roughened away) lies on pool ground or
/// on the body it merges onto.
fn core_fits(g: &Ground, free: &Free<'_>, d: &Pools, s: usize, c: (i32, i32)) -> bool {
    let core = d.across[s] + d.rim[s].0;
    let r = core / 2 + 1;
    for dy in -r..=r {
        for dx in -r..=r {
            if 4 * (dx * dx + dy * dy) > core * core {
                continue;
            }
            match g.at(c.0 + dx, c.1 + dy) {
                Some(i) if free.own != 0 && free.laid.body[i] == free.own => {}
                Some(i) if g.pool_ok[i] && free.spaced(i) && free.site_ok(g, i) => {}
                _ => return false,
            }
        }
    }
    true
}

/// The body of discs of size `s` on `centres` (with the body it merges onto, if any): its tiles (row order), its ring
/// and the barrow sites it takes, or `None` when a new tile falls off the pool ground or the spacing, its nearest tile
/// is not in `want`, it does not keep its size class or outgrows `body_most`, it takes more sites than its room, or a
/// ring tile is not plain floor.
fn build(
    g: &Ground,
    free: &Free<'_>,
    tree: &ZoneAnchor,
    d: &Pools,
    s: usize,
    centres: &[(i32, i32)],
    want: Band,
) -> Option<Grown> {
    let across = d.across[s];
    let (rim_lo, rim_hi) = d.rim[s];
    let pad = (across + rim_hi) / 2 + 1 + d.ring;
    let x0 = centres.iter().map(|c| c.0).min()? - pad;
    let x1 = centres.iter().map(|c| c.0).max()? + pad;
    let y0 = centres.iter().map(|c| c.1).min()? - pad;
    let y1 = centres.iter().map(|c| c.1).max()? + pad;
    let (bw, bh) = (x1 - x0 + 1, y1 - y0 + 1);
    let local = |x: i32, y: i32| ((y - y0) * bw + (x - x0)) as usize;
    let within = |x: i32, y: i32| x >= x0 && y >= y0 && x <= x1 && y <= y1;
    let own = |i: usize| free.own != 0 && free.laid.body[i] == free.own;
    let mut inside = vec![0u8; (bw * bh) as usize];
    for y in y0 + d.ring..=y1 - d.ring {
        for x in x0 + d.ring..=x1 - d.ring {
            let rough = g.at(x, y).map_or(0.0, |i| g.rough[i]);
            let delta = rim_lo + ((rough * f64::from(rim_hi - rim_lo + 1)) / 1024.0).floor() as i32;
            let dia = across + delta.min(rim_hi);
            let hit = centres.iter().any(|&(cx, cy)| {
                let (ex, ey) = (x - cx, y - cy);
                4 * (ex * ex + ey * ey) <= dia * dia
            });
            if hit {
                let i = g.at(x, y)?;
                if !own(i) && (!g.pool_ok[i] || !free.spaced(i) || !free.site_ok(g, i)) {
                    return None;
                }
                inside[local(x, y)] = 1;
            }
        }
    }
    // One 4-connected body: the piece holding the first centre; rim tiles cut off from it stay plain floor. The body
    // it merges onto lies wholly in its own discs, so it is part of the piece.
    let first = centres[0];
    let mut body = vec![first];
    inside[local(first.0, first.1)] = 2;
    let mut head = 0;
    while head < body.len() {
        let (x, y) = body[head];
        head += 1;
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let (u, v) = (x + dx, y + dy);
            if within(u, v) && inside[local(u, v)] == 1 {
                inside[local(u, v)] = 2;
                body.push((u, v));
            }
        }
    }
    if body.len() > d.body_most || body.iter().map(|&(x, y)| band(tree, x, y)).min()? != want {
        return None;
    }
    // The size class it was laid as: it holds that class's whole disc and not the next one's.
    let holds = |r2: i32| {
        let r = (0..).find(|r: &i32| r * r > r2).unwrap_or(0);
        body.iter().any(|&(x, y)| {
            (-r..=r).all(|dy| {
                (-r..=r).all(|dx| {
                    let (u, v) = (x + dx, y + dy);
                    dx * dx + dy * dy > r2 || (within(u, v) && inside[local(u, v)] == 2)
                })
            })
        })
    };
    if !holds(d.class_r2[s]) || d.class_r2.get(s + 1).is_some_and(|&r2| holds(r2)) {
        return None;
    }
    let mut ring = Vec::new();
    let mut drops = Vec::new();
    for y in y0..=y1 {
        for x in x0..=x1 {
            if inside[local(x, y)] == 2 {
                continue;
            }
            let near = (-d.ring..=d.ring).any(|dy| {
                (-d.ring..=d.ring)
                    .any(|dx| within(x + dx, y + dy) && inside[local(x + dx, y + dy)] == 2)
            });
            if !near {
                continue;
            }
            let i = g.at(x, y)?;
            if own(i) || !g.ring_ok[i] || !free.site_ok(g, i) {
                return None;
            }
            ring.push(i as i32);
            free.take(g, i, &mut drops);
        }
    }
    let mut tiles: Vec<i32> = body.iter().map(|&(x, y)| y * g.w + x).collect();
    tiles.sort_unstable();
    for &i in &tiles {
        free.take(g, i as usize, &mut drops);
    }
    if drops.len() > free.room {
        return None;
    }
    drops.sort_unstable();
    Some(Grown {
        centres: centres.to_vec(),
        tiles,
        ring,
        drops,
    })
}
