//! Source `shared/quests.ts` placement: where the twenty givers, collect tokens and fetch parcels lie on any map that
//! honors the map contract (camps, spawnPool, region poles, the coliseum, tiles and terrain). Every position comes from
//! the private quest stream the caller hands in; the known and hidden passes draw from their own passes.
use super::catalog::{self, Kind, Tokens};
use super::roster::RosterEntry;
use crate::constants::{
    PLAYER_RADIUS, QUEST_COUNT, QUEST_HIDDEN_MIN_SPOTS_PER_OFFER, QUEST_NPC_GAP_TILES,
    QUEST_NPC_SPAWN_MIN_TILES, QUEST_REVEAL_RADIUS, QUEST_SPOT_OVERSAMPLE, TILE,
};
use crate::map::{tile_to_world_center, world_to_tile, TileMap, MASK_MOVE};
use crate::mapdata::{LayerData, Zone};
use crate::math::Vec2;
use std::collections::BTreeSet;

/// Source `QUEST_HIDDEN_START_CLEARANCES`: reveal radius plus two tiles, then the reveal radius, half, and none.
fn hidden_start_clearances() -> [f64; 4] {
    [
        QUEST_REVEAL_RADIUS + 2. * TILE,
        QUEST_REVEAL_RADIUS,
        QUEST_REVEAL_RADIUS / 2.,
        0.,
    ]
}

/// One placed offer (source `QuestPlacement`): the giver spot plus its tokens or parcel. `def` indexes [`DEFINITION`].
#[derive(Clone, Debug, PartialEq)]
pub struct Placement {
    pub def: usize,
    pub known: bool,
    pub at: Vec2,
    pub tokens: Vec<Vec2>,
    pub parcel: Option<Vec2>,
}

fn zone_faction(zone: Zone) -> crate::FactionId {
    crate::FactionId::parse(zone.as_str()).expect("zone names match faction ids")
}

fn layers(map: &TileMap) -> Option<&LayerData> {
    map.layers().map(|l| l.data())
}

/// The source `distance` helper: plain f64 hypot.
fn distance(a: Vec2, b: Vec2) -> f64 {
    crate::math::hypot(a.x - b.x, a.y - b.y)
}

/// Flat tile index of a world point, or -1 off the map (source `indexAt`).
fn index_at(map: &TileMap, at: Vec2) -> i64 {
    let tx = world_to_tile(at.x);
    let ty = world_to_tile(at.y);
    if tx < 0 || ty < 0 || tx >= i64::from(map.w) || ty >= i64::from(map.h) {
        -1
    } else {
        ty * i64::from(map.w) + tx
    }
}

fn component_at(map: &TileMap, at: Vec2) -> i32 {
    let index = index_at(map, at);
    if index < 0 {
        -1
    } else {
        map.comp(index as usize)
    }
}

/// Source `questHomeComponent`: the component holding the coliseum centre, else the one with most spawn starts, else none.
pub fn home_component(map: &TileMap) -> i32 {
    let Some(data) = layers(map) else {
        return -1;
    };
    let centre = Vec2::new(data.coliseum.centre.x, data.coliseum.centre.y);
    let home = component_at(map, centre);
    if home >= 0 {
        return home;
    }
    let mut votes: Vec<(i32, usize)> = Vec::new();
    for start in &data.spawn_pool {
        let c = component_at(map, Vec2::new(start.x, start.y));
        if c < 0 {
            continue;
        }
        match votes.iter_mut().find(|(id, _)| *id == c) {
            Some((_, n)) => *n += 1,
            None => votes.push((c, 1)),
        }
    }
    let mut best = -1;
    let mut most = 0usize;
    for (c, n) in votes {
        if n > most || (n == most && (best < 0 || c < best)) {
            best = c;
            most = n;
        }
    }
    best
}

/// Source `terrainAt(map, x, y) !== TERRAIN_NONE`: the tile under the point carries no admitted hazard overlay.
fn terrain_none(map: &TileMap, at: Vec2) -> bool {
    let Some(data) = layers(map) else {
        return true;
    };
    let tx = world_to_tile(at.x);
    let ty = world_to_tile(at.y);
    if tx < 0 || ty < 0 || tx >= i64::from(map.w) || ty >= i64::from(map.h) {
        return true;
    }
    data.terrain
        .get(ty as usize * map.w as usize + tx as usize)
        .copied()
        .unwrap_or(0)
        == 0
}

fn circle_clear(map: &TileMap, at: Vec2, radius: f64) -> bool {
    crate::geometry::circle_clear(map, at, radius, MASK_MOVE)
}

/// Source `outsideColiseum`: outside the coliseum tile rect by `margin` tiles.
fn outside_coliseum(data: &LayerData, tx: i64, ty: i64, margin: i64) -> bool {
    let r = data.coliseum.rect;
    let (rx, ry) = (i64::from(r.x), i64::from(r.y));
    let (rw, rh) = (i64::from(r.w), i64::from(r.h));
    tx < rx - margin || tx >= rx + rw + margin || ty < ry - margin || ty >= ry + rh + margin
}

/// Source `markDisc`: set every tile whose centre lies within `radius` of `at`.
fn mark_disc(mask: &mut [u8], map: &TileMap, at: Vec2, radius: f64) {
    let reach = (radius / TILE).ceil() as i64 + 1;
    let cx = world_to_tile(at.x);
    let cy = world_to_tile(at.y);
    let y0 = (cy - reach).max(0);
    let y1 = (cy + reach).min(i64::from(map.h) - 1);
    let x0 = (cx - reach).max(0);
    let x1 = (cx + reach).min(i64::from(map.w) - 1);
    for ty in y0..=y1 {
        for tx in x0..=x1 {
            let centre = Vec2::new(tile_to_world_center(tx), tile_to_world_center(ty));
            if distance(centre, at) < radius {
                mask[ty as usize * map.w as usize + tx as usize] = 1;
            }
        }
    }
}

fn tile_dist(a: Vec2, b: Vec2) -> i64 {
    (world_to_tile(a.x) - world_to_tile(b.x))
        .abs()
        .max((world_to_tile(a.y) - world_to_tile(b.y)).abs())
}

/// Source `scanFreeTile`: the first clear plain-floor tile in a ring search that is unused, in `component` (when given),
/// no hazard and with `radius` clear. Nothing is claimed.
fn scan_free_tile(
    map: &TileMap,
    want: Vec2,
    used: &BTreeSet<usize>,
    component: Option<i32>,
    max_tiles: i64,
    radius: f64,
) -> Option<(Vec2, usize)> {
    if let Some(c) = component {
        if c < 0 {
            return None;
        }
    }
    let cx = world_to_tile(want.x);
    let cy = world_to_tile(want.y);
    for r in 0..=max_tiles {
        for dy in -r..=r {
            for dx in -r..=r {
                if dx.abs().max(dy.abs()) != r {
                    continue;
                }
                let tx = cx + dx;
                let ty = cy + dy;
                if tx < 0 || ty < 0 || tx >= i64::from(map.w) || ty >= i64::from(map.h) {
                    continue;
                }
                let index = ty as usize * map.w as usize + tx as usize;
                if used.contains(&index) {
                    continue;
                }
                if let Some(c) = component {
                    if map.comp(index) != c {
                        continue;
                    }
                }
                let at = Vec2::new(tile_to_world_center(tx), tile_to_world_center(ty));
                if !terrain_none(map, at) || !circle_clear(map, at, radius) {
                    continue;
                }
                return Some((at, index));
            }
        }
    }
    None
}

/// Source `freeTileNear`: a clear plain-floor tile near `want`, reachable from `origin` when one is given, claimed in
/// `used`.
pub fn free_tile_near(
    map: &TileMap,
    want: Vec2,
    used: &mut BTreeSet<usize>,
    origin: Option<Vec2>,
    max_tiles: i64,
    radius: f64,
) -> Option<Vec2> {
    let component = origin.map(|o| component_at(map, o));
    let found = scan_free_tile(map, want, used, component, max_tiles, radius)?;
    used.insert(found.1);
    Some(found.0)
}

/// Source `campItemExclusions`: a halo round every camp's chest (1 tile) and mob rest spots (2 tiles).
fn camp_item_exclusions(map: &TileMap) -> BTreeSet<usize> {
    let mut used = BTreeSet::new();
    let Some(data) = layers(map) else {
        return used;
    };
    let w = map.w as i64;
    let h = map.h as i64;
    let mut exclude = |at: Vec2, halo: i64| {
        let cx = world_to_tile(at.x);
        let cy = world_to_tile(at.y);
        for dy in -halo..=halo {
            for dx in -halo..=halo {
                let tx = cx + dx;
                let ty = cy + dy;
                if tx >= 0 && ty >= 0 && tx < w && ty < h {
                    used.insert(ty as usize * map.w as usize + tx as usize);
                }
            }
        }
    };
    for camp in &data.camps {
        exclude(Vec2::new(camp.chest.x, camp.chest.y), 1);
        for spot in &camp.spots {
            exclude(Vec2::new(spot.x, spot.y), 2);
        }
    }
    used
}

fn unique_sites(sites: &[Vec2]) -> Vec<Vec2> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for p in sites {
        let key = (world_to_tile(p.x), world_to_tile(p.y));
        if seen.insert(key) {
            out.push(*p);
        }
    }
    out
}

/// Source `npcCandidates`: every tile a giver may stand on (plain floor, outside the coliseum, away from camps and starts,
/// in the home component). Dense maps relax the start clearance only.
pub fn npc_candidates(map: &TileMap) -> Vec<Vec2> {
    let Some(data) = layers(map) else {
        return Vec::new();
    };
    if data.camps.is_empty() && data.spawn_pool.is_empty() && data.regions.is_empty() {
        return Vec::new();
    }
    let home = home_component(map);
    let margin = 3. * TILE;
    let mut camps_mask = vec![0u8; map.w as usize * map.h as usize];
    for c in &data.camps {
        mark_disc(&mut camps_mask, map, Vec2::new(c.x, c.y), c.r + margin);
        mark_disc(
            &mut camps_mask,
            map,
            Vec2::new(c.chest.x, c.chest.y),
            margin,
        );
        for spot in &c.spots {
            mark_disc(&mut camps_mask, map, Vec2::new(spot.x, spot.y), margin);
        }
    }
    let scan = |spawn_min_tiles: f64| -> Vec<Vec2> {
        let mut starts = vec![0u8; map.w as usize * map.h as usize];
        for s in &data.spawn_pool {
            mark_disc(
                &mut starts,
                map,
                Vec2::new(s.x, s.y),
                spawn_min_tiles * TILE,
            );
        }
        let mut out = Vec::new();
        for ty in 0..i64::from(map.h) {
            for tx in 0..i64::from(map.w) {
                let index = ty as usize * map.w as usize + tx as usize;
                if camps_mask[index] != 0
                    || starts[index] != 0
                    || !outside_coliseum(data, tx, ty, 2)
                    || map.blocked(tx, ty, MASK_MOVE)
                {
                    continue;
                }
                if home >= 0 && map.comp(index) != home {
                    continue;
                }
                let at = Vec2::new(tile_to_world_center(tx), tile_to_world_center(ty));
                if !terrain_none(map, at) || !circle_clear(map, at, PLAYER_RADIUS) {
                    continue;
                }
                out.push(at);
            }
        }
        out
    };
    let strict = scan(f64::from(QUEST_NPC_SPAWN_MIN_TILES));
    if strict.len() >= QUEST_COUNT as usize * 4 {
        return strict;
    }
    let seen: BTreeSet<(i64, i64)> = strict
        .iter()
        .map(|p| (world_to_tile(p.x), world_to_tile(p.y)))
        .collect();
    let relaxed = scan((QUEST_NPC_SPAWN_MIN_TILES / 2) as f64);
    let mut out = strict;
    for p in relaxed {
        if !seen.contains(&(world_to_tile(p.x), world_to_tile(p.y))) {
            out.push(p);
        }
    }
    out
}

/// Source `shuffled`: Fisher-Yates on a copy, drawing `floor(random() * (i + 1))`.
pub fn shuffled<T: Clone>(xs: &[T], random: &mut impl FnMut() -> f64) -> Vec<T> {
    let mut out = xs.to_vec();
    for i in (1..out.len()).rev() {
        let j = (random() * (i + 1) as f64).floor() as usize;
        out.swap(i, j);
    }
    out
}

/// Source `spreadSpots`: up to `n` spots from the privately shuffled candidates, taken greedily against the gap to
/// `avoid` and to each other, relaxing the gap tile by tile down to half.
pub fn spread_spots(
    candidates: &[Vec2],
    n: usize,
    random: &mut impl FnMut() -> f64,
    avoid: &[Vec2],
) -> Vec<Vec2> {
    if candidates.is_empty() || n == 0 {
        return Vec::new();
    }
    let target = n.min(candidates.len());
    let order = shuffled(candidates, random);
    let mut best: Vec<Vec2> = Vec::new();
    let mut gap = f64::from(QUEST_NPC_GAP_TILES) * TILE;
    let floor_gap = (QUEST_NPC_GAP_TILES / 2) as f64 * TILE;
    while gap >= floor_gap {
        let mut taken: Vec<Vec2> = Vec::new();
        for candidate in &order {
            if avoid.iter().any(|s| distance(*s, *candidate) < gap)
                || taken.iter().any(|s| distance(*s, *candidate) < gap)
            {
                continue;
            }
            taken.push(*candidate);
            if taken.len() >= target {
                break;
            }
        }
        if taken.len() > best.len() {
            best = taken;
        }
        if best.len() >= target {
            break;
        }
        gap -= TILE;
    }
    best
}

fn world_pt(p: &crate::mapdata::WorldPt) -> Vec2 {
    Vec2::new(p.x, p.y)
}

fn camp_tokens(
    map: &TileMap,
    data: &LayerData,
    region: crate::FactionId,
    giver: Vec2,
    spawns: usize,
    random: &mut impl FnMut() -> f64,
    used: &mut BTreeSet<usize>,
) -> Vec<Vec2> {
    let camps: Vec<&crate::mapdata::CampDef> = data
        .camps
        .iter()
        .filter(|c| zone_faction(c.zone) == region)
        .collect();
    if camps.is_empty() {
        return Vec::new();
    }
    let camp = camps.iter().copied().reduce(|a, b| {
        if distance(Vec2::new(a.x, a.y), giver) >= distance(Vec2::new(b.x, b.y), giver) {
            a
        } else {
            b
        }
    });
    let Some(camp) = camp else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let tries = spawns * 6;
    let mut add = |want: Vec2, out: &mut Vec<Vec2>| {
        if let Some(at) = free_tile_near(map, want, used, Some(giver), 8, PLAYER_RADIUS) {
            out.push(at);
        }
    };
    for _ in 0..tries {
        if out.len() >= spawns {
            break;
        }
        let a = random() * std::f64::consts::PI * 2.;
        let d = camp.r * (0.3 + 0.9 * random());
        add(
            Vec2::new(
                camp.x + crate::math::cos(a) * d,
                camp.y + crate::math::sin(a) * d,
            ),
            &mut out,
        );
    }
    for i in 0..16 {
        if out.len() >= spawns {
            break;
        }
        let a = (i as f64 / 16.) * std::f64::consts::PI * 2.;
        add(
            Vec2::new(
                camp.x + crate::math::cos(a) * camp.r,
                camp.y + crate::math::sin(a) * camp.r,
            ),
            &mut out,
        );
    }
    out
}

fn site_tokens(
    map: &TileMap,
    data: &LayerData,
    giver: Vec2,
    rim: bool,
    spawns: usize,
    random: &mut impl FnMut() -> f64,
    used: &mut BTreeSet<usize>,
) -> Vec<Vec2> {
    let centre = Vec2::new(data.coliseum.centre.x, data.coliseum.centre.y);
    let by_centre = |a: Vec2, b: Vec2| distance(a, centre).total_cmp(&distance(b, centre));
    let mut sites: Vec<Vec2> = Vec::new();
    if rim {
        let mut starts: Vec<Vec2> = data
            .spawn_pool
            .iter()
            .map(|s| Vec2::new(s.x, s.y))
            .collect();
        starts.sort_by(|a, b| by_centre(*b, *a));
        let mut poles: Vec<Vec2> = data.regions.iter().map(|r| world_pt(&r.pole)).collect();
        poles.sort_by(|a, b| by_centre(*b, *a));
        sites.extend(starts);
        sites.extend(poles);
        sites = unique_sites(&sites);
    } else {
        let mut camps: Vec<Vec2> = data.camps.iter().map(|c| Vec2::new(c.x, c.y)).collect();
        camps.sort_by(|a, b| by_centre(*a, *b));
        let from = camps.len() / 3;
        let to = (from + 1).max((camps.len() * 2).div_ceil(3));
        let to = to.min(camps.len());
        sites = unique_sites(&camps[from.min(camps.len())..to]);
    }
    if sites.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let start = (random() * sites.len() as f64).floor() as usize;
    for i in 0..spawns * 4 {
        if out.len() >= spawns {
            break;
        }
        let site = sites[(start + i) % sites.len()];
        if let Some(at) = free_tile_near(map, site, used, Some(giver), 10, PLAYER_RADIUS) {
            out.push(at);
        }
    }
    out
}

fn parcel_spot(
    map: &TileMap,
    data: &LayerData,
    giver: Vec2,
    region: Option<crate::FactionId>,
    random: &mut impl FnMut() -> f64,
    used: &mut BTreeSet<usize>,
) -> Option<Vec2> {
    let zone_ok = |zone: Zone| region.is_none_or(|r| zone_faction(zone) == r);
    let mut sites: Vec<Vec2> = Vec::new();
    for c in &data.camps {
        if zone_ok(c.zone) {
            sites.push(Vec2::new(c.x, c.y));
        }
    }
    for s in &data.spawn_pool {
        if zone_ok(s.zone) {
            sites.push(Vec2::new(s.x, s.y));
        }
    }
    for r in &data.regions {
        if region.is_none_or(|want| zone_faction(r.id) == want) {
            sites.push(world_pt(&r.pole));
        }
    }
    let sites = unique_sites(&sites);
    let source = component_at(map, giver);
    if sites.is_empty() || source < 0 {
        return None;
    }
    let start = (random() * sites.len() as f64).floor() as usize;
    let mut best: Option<(Vec2, usize)> = None;
    let mut best_d = -1i64;
    for i in 0..sites.len() {
        let site = sites[(start + i) % sites.len()];
        let Some(found) = scan_free_tile(map, site, used, Some(source), 12, PLAYER_RADIUS) else {
            continue;
        };
        let d = tile_dist(found.0, giver);
        if d > best_d {
            best = Some(found);
            best_d = d;
        }
    }
    if let Some((at, index)) = best {
        used.insert(index);
        Some(at)
    } else {
        None
    }
}

fn hidden_spots(
    data: &LayerData,
    open: &[Vec2],
    offers: usize,
    random: &mut impl FnMut() -> f64,
    avoid: &[Vec2],
) -> Vec<Vec2> {
    let want = offers * QUEST_SPOT_OVERSAMPLE as usize;
    let enough = want.min(offers * QUEST_HIDDEN_MIN_SPOTS_PER_OFFER as usize);
    let mut best: Vec<Vec2> = Vec::new();
    for clearance in hidden_start_clearances() {
        let pool: Vec<Vec2> = if clearance > 0. {
            open.iter()
                .copied()
                .filter(|c| {
                    data.spawn_pool
                        .iter()
                        .all(|s| distance(*c, Vec2::new(s.x, s.y)) >= clearance)
                })
                .collect()
        } else {
            open.to_vec()
        };
        let spots = spread_spots(&pool, want, random, avoid);
        if spots.len() >= enough {
            return spots;
        }
        if spots.len() > best.len() {
            best = spots;
        }
    }
    best
}

/// Source `placeQuests`: lays the roster out in two passes (known offers first, then the hidden ones), each pass
/// shuffling the candidate tiles with the stream and taking spots greedily; a region-themed quest takes the pass's spot
/// farthest from its region pole, and its pieces follow. A quest whose pieces will not place is dropped. The returned
/// order is privately shuffled, so a quest's position reveals neither its theme nor its pass.
pub fn place_quests(
    map: &TileMap,
    roster: &[RosterEntry],
    random: &mut impl FnMut() -> f64,
) -> Vec<Placement> {
    let Some(data) = layers(map) else {
        return Vec::new();
    };
    let candidates = npc_candidates(map);
    if candidates.is_empty() || roster.is_empty() {
        return Vec::new();
    }
    let mut used = camp_item_exclusions(map);
    let mut givers: Vec<Vec2> = Vec::new();
    let mut out: Vec<Placement> = Vec::new();
    for known in [true, false] {
        let group: Vec<RosterEntry> = roster
            .iter()
            .copied()
            .filter(|e| e.known == known)
            .collect();
        if group.is_empty() {
            continue;
        }
        let open: Vec<Vec2> = candidates
            .iter()
            .copied()
            .filter(|c| {
                let index = index_at(map, *c);
                index < 0 || !used.contains(&(index as usize))
            })
            .collect();
        let mut remaining = if known {
            spread_spots(
                &open,
                group.len() * QUEST_SPOT_OVERSAMPLE as usize,
                random,
                &givers,
            )
        } else {
            hidden_spots(data, &open, group.len(), random, &givers)
        };
        let mut ordered = group;
        ordered.sort_by_key(|e| {
            let d = &catalog::DEFINITION[e.def];
            std::cmp::Reverse(d.region.is_some())
        });
        let mut placed: Vec<Placement> = Vec::new();
        for entry in ordered {
            if remaining.is_empty() {
                break;
            }
            let def = &catalog::DEFINITION[entry.def];
            let at = if let Some(region) = def.region {
                let pole = data
                    .regions
                    .iter()
                    .find(|r| zone_faction(r.id) == region)
                    .map(|r| world_pt(&r.pole))
                    .unwrap_or_else(|| Vec2::new(data.coliseum.centre.x, data.coliseum.centre.y));
                let mut best_i = 0;
                let mut best_d = -1.;
                for (i, spot) in remaining.iter().enumerate() {
                    let d = distance(*spot, pole);
                    if d > best_d {
                        best_d = d;
                        best_i = i;
                    }
                }
                remaining.remove(best_i)
            } else {
                remaining.remove(0)
            };
            givers.push(at);
            let index = index_at(map, at);
            if index >= 0 {
                used.insert(index as usize);
            }
            placed.push(Placement {
                def: entry.def,
                known,
                at,
                tokens: Vec::new(),
                parcel: None,
            });
        }
        for placement in &mut placed {
            let def = &catalog::DEFINITION[placement.def];
            match def.kind {
                Kind::Collect => {
                    let spawns = if def.token_spawns == 0 {
                        def.count as usize
                    } else {
                        def.token_spawns as usize
                    };
                    let tokens = match (def.tokens, def.region) {
                        (Some(Tokens::Camp), Some(region)) => {
                            camp_tokens(map, data, region, placement.at, spawns, random, &mut used)
                        }
                        (tokens, _) => site_tokens(
                            map,
                            data,
                            placement.at,
                            tokens == Some(Tokens::Rim),
                            spawns,
                            random,
                            &mut used,
                        ),
                    };
                    if tokens.len() < def.count as usize {
                        continue;
                    }
                    placement.tokens = tokens;
                }
                Kind::Fetch => {
                    let Some(parcel) =
                        parcel_spot(map, data, placement.at, def.region, random, &mut used)
                    else {
                        continue;
                    };
                    placement.parcel = Some(parcel);
                }
                Kind::Kill => {}
            }
            out.push(placement.clone());
        }
    }
    shuffled(&out, random)
}
