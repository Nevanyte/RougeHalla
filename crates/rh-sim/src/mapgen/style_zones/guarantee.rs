//! P-MAPGEN-GUARANTEES-1 (architecture review 2026-11-13, finding 4): the end-of-attempt guarantees of each zone's
//! styler, written beside the styler (`style_rime::guarantees`, `style_warren::guarantees`) and looked up here. With the
//! signature option on, the pipeline runs them after `SignatureContext::intact` and the strict certifier, once per
//! landmark frame of the attempt in placement order (`signature::reserved_zones`), each zone's list in order; the first
//! that fails refuses the attempt as `pipeline::Refusal::Guarantee { zone, rule }`. A guarantee is a pure read of the
//! finished map and the zone's frame: no draw, nothing written. Generator rules, not content: nothing here is folded into
//! the content hash (`visit_content`).
//!
//! Lookups are functions, not `pub const` items: `tests/content.rs` reads every `pub const` as a tunable.
use crate::constants::TILE;
use crate::mapdata::{GameMapData, Zone};
use crate::mapgen::landmarks::signature::frame::LandmarkFrame;

/// One end-of-attempt rule of a zone's styler: its name (reported in `Refusal::Guarantee`) and its check, `true` when
/// the finished map keeps the rule.
#[derive(Clone, Copy, Debug)]
pub struct Guarantee {
    pub rule: &'static str,
    pub check: fn(&GameMapData, &LandmarkFrame) -> bool,
}

/// The guarantees of `zone`'s styler, in the order they run (STUB: every list is empty; the implementer fills Frost
/// and Plague from `style_rime::guarantees` and `style_warren::guarantees`).
pub fn guarantees(zone: Zone) -> &'static [Guarantee] {
    match zone {
        Zone::Frost => crate::mapgen::style_rime::guarantees(),
        Zone::Plague => crate::mapgen::style_warren::guarantees(),
        Zone::Fire | Zone::Sentenced | Zone::Holy => &[],
    }
}

/// Per spawn of `zone` in `m.spawn_pool`, in pool order, whose walk reaches the coliseum with every floor tile allowed:
/// the steps of its walk with the `forbidden` tiles avoided, less the steps with them allowed; `i32::MAX` when the
/// forbidden ground cuts the spawn off. A spawn whose walk does not reach the coliseum at all is left out.
///
/// A walk is counted in 4-connected steps over floor (tile 0), from a spawn to the coliseum: the centre tile and every
/// gate tile of `m.coliseum` that is floor. Reads only `w`, `h`, `tiles`, `spawn_pool` and `coliseum` (centre and gate
/// tiles) besides what `forbidden` reads, so a hand-built map of any size works. With `zone` = Plague and `forbidden` =
/// styler bog (`style_warren::is_styler_bog`) this is the Plague pools' walk check (P-LAND-PLAGUE-1-fix-2).
pub fn walk_growth(m: &GameMapData, zone: Zone, forbidden: impl Fn(usize) -> bool) -> Vec<i32> {
    // One field from the coliseum with the forbidden ground allowed and one without serve every spawn.
    let open = walk_field(m, |i| m.tiles[i] == 0);
    let dry = walk_field(m, |i| m.tiles[i] == 0 && !forbidden(i));
    m.spawn_pool
        .iter()
        .filter(|s| s.zone == zone)
        .filter_map(|s| at(m, world_tile(s.x), world_tile(s.y)))
        .filter(|&i| open[i] != i32::MAX)
        .map(|i| {
            if dry[i] == i32::MAX {
                i32::MAX
            } else {
                dry[i] - open[i]
            }
        })
        .collect()
}

/// The tile column or row of a world coordinate.
fn world_tile(v: f64) -> i32 {
    (v / TILE).floor() as i32
}

/// The index of tile `(x, y)`, if it lies on the map.
fn at(m: &GameMapData, x: i32, y: i32) -> Option<usize> {
    let (w, h) = (m.w as i32, m.h as i32);
    (x >= 0 && y >= 0 && x < w && y < h).then(|| (y * w + x) as usize)
}

/// Breadth-first steps from the coliseum (its centre tile and every gate tile, each only if `ground`) over `ground`
/// tiles, 4-connected, on the whole map; `i32::MAX` where no walk reaches.
fn walk_field(m: &GameMapData, ground: impl Fn(usize) -> bool) -> Vec<i32> {
    let mut dist = vec![i32::MAX; m.tiles.len()];
    let mut queue = Vec::new();
    let centre = (
        world_tile(m.coliseum.centre.x),
        world_tile(m.coliseum.centre.y),
    );
    let gates = m
        .coliseum
        .gates
        .iter()
        .flat_map(|g| g.tiles.iter().map(|t| (t.x, t.y)));
    for (x, y) in std::iter::once(centre).chain(gates) {
        if let Some(i) = at(m, x, y).filter(|&i| ground(i) && dist[i] == i32::MAX) {
            dist[i] = 0;
            queue.push(i);
        }
    }
    let w = m.w as usize;
    let mut head = 0;
    while let Some(&i) = queue.get(head) {
        head += 1;
        let (x, y) = ((i % w) as i32, (i / w) as i32);
        for (dx, dy) in [(0, -1), (1, 0), (0, 1), (-1, 0)] {
            if let Some(j) = at(m, x + dx, y + dy).filter(|&j| ground(j) && dist[j] == i32::MAX) {
                dist[j] = dist[i] + 1;
                queue.push(j);
            }
        }
    }
    dist
}
