//! Oracle of P-MAPGEN-SIG-SCALE-1: the Frost cave is a lot larger, "a little smaller than the temple" (owner direction
//! 2026-11-12 late: "I want most of them (except holy temple) to be a lot larger, maybe just a little smaller than the
//! temple"), with an ice floor, still closed but for one mouth round the far elite camp, its lake still at the mouth
//! (P-MAPGEN-SIG-FROST-2) and every map still certified (core rules G1-G8, ADR 0028). No legacy counterpart (DEV-020).
//! Seeds 1-32, option on, each seed's first accepted attempt, generated once per test binary. The size rule and the
//! numbers are the brief's (`docs/backlog/packets/P-MAPGEN-SIG-SCALE-1.md`, "Measurements" and "The rule").
//!
//! Definitions (tile units; a tile's point is its centre, x + 0.5; "floor" is tile value 0, walkable 4-connected):
//! * cave: the one feature of kind `Cave` (zone Frost); footprint: its bbox (the Frost anchor's `footprint`); side: the
//!   footprint's width or height; mouth: the Frost anchor's `entrance` tiles.
//! * hall side: the smaller side of the Holy anchor's footprint (the temple hall, 38-39 today).
//! * far elite camp: the Frost camp with `elite_spot >= 0` at the Frost anchor's centre (amended after
//!   P-MAPGEN-SIG-RESERVE-1; was: farthest from the map centre); its tile: the tile of the camp point.
//!
//! Amended 2026-11-12 (coordinator decision): this packet depends on P-MAPGEN-SIG-RESERVE-1 (each landmark's site
//! reserved before the camps); the size floor and target are 28 and 30 (were 20 and 28); the bounds marked
//! "RE-MEASURE AFTER RESERVE-1" are provisional until the next oracle amendment measures them on the real
//! implementation.
//! * interior: the floor tiles reached by a 4-connected flood over floor from the far elite camp's tile with the mouth
//!   tiles blocked; enclosed: the interior lies inside the footprint and every mouth tile touches it.
//! * box floor: every floor tile strictly inside the footprint (off its edge rows and columns).
//! * certifier halo of a camp (`certify` "protected", the generator's `mark_halo`): the tiles (camp tile + (dx, dy)),
//!   |dx|, |dy| <= `R.protection_span`, for which some (ox, oy) with |ox|, |oy| <= `R.halo` has
//!   (dx + ox)^2 + (dy + oy)^2 <= `R.clearing`^2.
//! * cave ice: interior tiles with terrain ice (6) owned by the cave; ice share: cave ice / interior tiles.
//! * mouth rows: the box-floor tiles whose distance from the footprint edge that holds the mouth is 1 to
//!   `mouth_rows_dry()` (the first rows a fighter walks through the mouth), across the whole width of the cave.
//! * wide way: tiles whose 3x3 square (the tile and its eight neighbours) is all floor; the mouth's middle tile reaches
//!   the camp tile by 4-connected steps over wide-way tiles (a 3-wide path, the mouth's own width).
use rh_sim::mapdata::{FeatureKind, GameMapData, Zone, ZoneAnchor};
use rh_sim::mapgen::certify::rules::R;
use rh_sim::mapgen::{certify, coliseum, pipeline};
use std::collections::{BTreeSet, VecDeque};
use std::sync::OnceLock;

type Cell = (i32, i32);

// ---------------------------------------------------------------------------------------------------------------------
// The numbers (the brief's "Rule"; functions, not consts: `tests/content.rs` reads consts as unregistered tunables).
// ---------------------------------------------------------------------------------------------------------------------

/// The rule's floor: the fewest tiles on each side of the cave's footprint (amended 2026-11-12 after
/// P-MAPGEN-SIG-RESERVE-1's measurements: 28, was 20). The cave stands inside its reserved 34-tile site, which keeps
/// off the map border, so no side leans on the border.
fn floor_side() -> u32 {
    28
}

/// The rule's target: the size the cave takes in its reserved site (each side; 30, was 28): the site less its apron.
fn target_side() -> u32 {
    30
}

/// The least mean of the footprint's smaller side over seeds 1-32. RE-MEASURE AFTER RESERVE-1: provisional, the floor
/// (the brief's prototype of the adaptive cave without reserved sites gave 23.7; today 11.3).
fn mean_side_min() -> f64 {
    28.0
}

/// The largest side of the cave's footprint is at most the hall side minus this ("a little smaller than the temple").
fn below_hall() -> u32 {
    2
}

/// The least ice share of the interior, percent. RE-MEASURE AFTER RESERVE-1 (the prototype without reserved sites:
/// at least 50, mean 64).
fn ice_share_min() -> usize {
    45
}

/// The rows inside the mouth that stay dry.
fn mouth_rows_dry() -> i32 {
    3
}

/// The attempts `certified_styled` may use (`pipeline` rules, `certified_attempts`).
fn attempt_limit() -> u64 {
    16
}

/// The worst attempt index over seeds 1-32 allowed. RE-MEASURE AFTER RESERVE-1 (provisional: RESERVE-1's prototype
/// at today's sizes 4, the adaptive cave without reserved sites 5; today 3).
fn worst_attempt_allowed() -> u64 {
    8
}

/// The most attempts seeds 1-32 may use in all, accepted ones included. RE-MEASURE AFTER RESERVE-1 (provisional:
/// RESERVE-1's prototype at today's sizes 54; the adaptive cave without reserved sites 66, 119 without its territory
/// rule; today 43).
fn attempts_allowed() -> u64 {
    80
}

// ---------------------------------------------------------------------------------------------------------------------
// Maps.
// ---------------------------------------------------------------------------------------------------------------------

fn on_options() -> pipeline::Options {
    pipeline::Options {
        decor: false,
        signature: true,
        ..pipeline::Options::default()
    }
}

/// One seed's outcome with the option on: the attempt that gave the map, and the map.
struct Landed {
    seed: i64,
    attempt: u64,
    map: GameMapData,
}

/// Seeds 1-32 with the option on (the server's options: no decor), the first attempt of each that gives a map,
/// generated once per test binary.
fn on_maps() -> &'static Vec<(i64, Option<Landed>)> {
    static MAPS: OnceLock<Vec<(i64, Option<Landed>)>> = OnceLock::new();
    MAPS.get_or_init(|| {
        let fixed = coliseum::fixed_layout();
        let generator = pipeline::Pipeline::new(&fixed);
        (1..=32)
            .map(|seed| {
                let landed = (0..attempt_limit()).find_map(|n| {
                    generator
                        .styled_attempt(seed, n, on_options())
                        .expect("generator error")
                        .map(|map| Landed {
                            seed,
                            attempt: n,
                            map,
                        })
                });
                (seed, landed)
            })
            .collect()
    })
}

/// Every seed must give a map within the attempt limit (G2, G5: a landmark is never a reason to lose a seed).
fn maps() -> impl Iterator<Item = &'static Landed> {
    on_maps().iter().map(|(seed, l)| {
        l.as_ref().unwrap_or_else(|| {
            panic!(
                "seed {seed}: no map in {} attempts with the option on",
                attempt_limit()
            )
        })
    })
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------------------------------------------------

fn at(m: &GameMapData, c: Cell) -> Option<usize> {
    (c.0 >= 0 && c.1 >= 0 && c.0 < m.w as i32 && c.1 < m.h as i32)
        .then(|| (c.1 * m.w as i32 + c.0) as usize)
}

fn floor(m: &GameMapData, c: Cell) -> bool {
    at(m, c).is_some_and(|i| m.tiles[i] == 0)
}

fn world_cell(x: f64, y: f64) -> Cell {
    ((x / R.tile).floor() as i32, (y / R.tile).floor() as i32)
}

fn of_kind(m: &GameMapData, kind: FeatureKind) -> Vec<usize> {
    (0..m.features.len())
        .filter(|&k| m.features[k].kind == kind)
        .collect()
}

/// The single feature of `kind`, which must stand in `zone`.
fn single(seed: i64, m: &GameMapData, kind: FeatureKind, zone: Zone) -> usize {
    let ks = of_kind(m, kind);
    assert_eq!(ks.len(), 1, "seed {seed}: {} {kind:?} features", ks.len());
    assert_eq!(m.features[ks[0]].zone, zone, "seed {seed}: {kind:?} zone");
    ks[0]
}

fn anchor(seed: i64, m: &GameMapData, zone: Zone) -> &ZoneAnchor {
    m.anchors
        .iter()
        .find(|a| a.zone == zone)
        .unwrap_or_else(|| panic!("seed {seed}: no {zone:?} anchor"))
}

/// The cave's camp tile: the Frost elite camp at the Frost anchor's centre (amended after P-MAPGEN-SIG-RESERVE-1,
/// whose inside camp need not be the elite farthest from the map centre); without a Frost anchor, the farthest elite
/// (doubled integer distance from the map centre; the last in camp order on a tie).
fn far_elite(seed: i64, m: &GameMapData) -> Cell {
    let d = |c: Cell| {
        i64::from(2 * c.0 + 1 - m.w as i32).pow(2) + i64::from(2 * c.1 + 1 - m.h as i32).pow(2)
    };
    let anchored = m
        .anchors
        .iter()
        .find(|a| a.zone == Zone::Frost)
        .map(|a| (a.centre.x, a.centre.y));
    m.camps
        .iter()
        .filter(|c| c.zone == Zone::Frost && c.elite_spot >= 0)
        .filter(|c| anchored.is_none_or(|t| world_cell(c.x, c.y) == t))
        .map(|c| world_cell(c.x, c.y))
        .fold(None, |best: Option<Cell>, c| match best {
            Some(b) if d(b) > d(c) => Some(b),
            _ => Some(c),
        })
        .unwrap_or_else(|| panic!("seed {seed}: no Frost elite camp"))
}

/// The certifier halo (header definition) of the camp on tile `t`.
fn halo_of(m: &GameMapData, t: Cell) -> Vec<Cell> {
    let s = R.protection_span;
    let mut out = Vec::new();
    for dy in -s..=s {
        for dx in -s..=s {
            let near = (-R.halo..=R.halo).any(|oy| {
                (-R.halo..=R.halo).any(|ox| {
                    f64::from((dx + ox).pow(2) + (dy + oy).pow(2)) <= R.clearing * R.clearing
                })
            });
            if near && at(m, (t.0 + dx, t.1 + dy)).is_some() {
                out.push((t.0 + dx, t.1 + dy));
            }
        }
    }
    out
}

/// Every camp's certifier halo.
fn halos(m: &GameMapData) -> BTreeSet<Cell> {
    m.camps
        .iter()
        .flat_map(|c| halo_of(m, world_cell(c.x, c.y)))
        .collect()
}

/// 4-connected flood over tiles `ok` from `starts`.
fn flood(m: &GameMapData, starts: &[Cell], ok: &dyn Fn(Cell) -> bool) -> BTreeSet<Cell> {
    let mut seen = BTreeSet::new();
    let mut queue: VecDeque<Cell> = VecDeque::new();
    for &s in starts {
        if ok(s) && seen.insert(s) {
            queue.push_back(s);
        }
    }
    while let Some((x, y)) = queue.pop_front() {
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let n = (x + dx, y + dy);
            if at(m, n).is_some() && ok(n) && seen.insert(n) {
                queue.push_back(n);
            }
        }
    }
    seen
}

/// The cave of an option-on map: feature index, footprint (x0, y0, x1, y1), mouth, far elite camp tile, interior.
struct Cave {
    k: usize,
    fp: (i32, i32, i32, i32),
    mouth: Vec<Cell>,
    camp: Cell,
    interior: BTreeSet<Cell>,
}

fn cave(seed: i64, m: &GameMapData) -> Cave {
    let k = single(seed, m, FeatureKind::Cave, Zone::Frost);
    let a = anchor(seed, m, Zone::Frost);
    let r = a.footprint;
    let fp = (r.x, r.y, r.x + r.w as i32 - 1, r.y + r.h as i32 - 1);
    let mouth: Vec<Cell> = a.entrance.iter().map(|p| (p.x, p.y)).collect();
    assert!(!mouth.is_empty(), "seed {seed}: the cave has no mouth");
    let camp = far_elite(seed, m);
    let blocked: BTreeSet<Cell> = mouth.iter().copied().collect();
    let interior = flood(m, &[camp], &|c| floor(m, c) && !blocked.contains(&c));
    Cave {
        k,
        fp,
        mouth,
        camp,
        interior,
    }
}

fn inside(fp: (i32, i32, i32, i32), c: Cell) -> bool {
    c.0 >= fp.0 && c.0 <= fp.2 && c.1 >= fp.1 && c.1 <= fp.3
}

/// The distance of `c` from the footprint edge that holds the mouth (0 on that edge): the mouth's tiles share that
/// edge's column (a west or east mouth) or row (a north or south mouth).
fn from_mouth_edge(cv: &Cave, c: Cell) -> i32 {
    let m = cv.mouth[0];
    let on_column = cv.mouth.iter().all(|t| t.0 == m.0) && (m.0 == cv.fp.0 || m.0 == cv.fp.2);
    if on_column {
        (c.0 - m.0).abs()
    } else {
        (c.1 - m.1).abs()
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The size (red today: caves are 9-15 tiles a side).
// ---------------------------------------------------------------------------------------------------------------------

/// Every cave's footprint has both sides at least `floor_side()` and at most the hall side minus
/// `below_hall()`, and none exceeds `target_side()`; the mean smaller side over seeds 1-32 is at least `mean_side_min()`.
/// Red today: footprints of 9 to 15 tiles a side, mean 11.3.
#[test]
fn the_cave_is_a_lot_larger_but_smaller_than_the_hall() {
    let mut off = Vec::new();
    let mut sides = Vec::new();
    for l in maps() {
        let (seed, m) = (l.seed, &l.map);
        let c = cave(seed, m);
        let (w, h) = ((c.fp.2 - c.fp.0 + 1) as u32, (c.fp.3 - c.fp.1 + 1) as u32);
        let hall = anchor(seed, m, Zone::Holy).footprint;
        let ceiling = (hall.w.min(hall.h) - below_hall()).min(target_side());
        if w.min(h) < floor_side() || w.max(h) > ceiling {
            off.push(format!(
                "seed {seed}: {w}x{h} (hall side {})",
                hall.w.min(hall.h)
            ));
        }
        sides.push(w.min(h));
    }
    assert!(
        off.is_empty(),
        "caves outside [{}, min({}, hall side - {})] a side: {off:?}",
        floor_side(),
        target_side(),
        below_hall()
    );
    let mean = f64::from(sides.iter().sum::<u32>()) / sides.len() as f64;
    assert!(
        mean >= mean_side_min(),
        "mean smaller side {mean:.1} below {} (sides {sides:?})",
        mean_side_min()
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// The room (guards today, the shape the larger cave keeps).
// ---------------------------------------------------------------------------------------------------------------------

/// Enclosed with exactly one opening: the mouth is one straight run of 3 floor tiles on the footprint's edge, opening
/// onto floor outside; the interior stays inside the footprint and touches every mouth tile; the far elite camp's whole
/// halo is interior.
#[test]
fn the_cave_is_enclosed_with_one_mouth_and_the_elite_camp_inside() {
    for l in maps() {
        let (seed, m) = (l.seed, &l.map);
        let c = cave(seed, m);
        let n = c.mouth.len();
        let straight = c.mouth.iter().all(|t| t.0 == c.mouth[0].0)
            || c.mouth.iter().all(|t| t.1 == c.mouth[0].1);
        assert!(n == 3 && straight, "seed {seed}: mouth {:?}", c.mouth);
        let edge = |t: Cell| {
            inside(c.fp, t) && (t.0 == c.fp.0 || t.0 == c.fp.2 || t.1 == c.fp.1 || t.1 == c.fp.3)
        };
        let n4 = |t: Cell| [(1, 0), (-1, 0), (0, 1), (0, -1)].map(|(dx, dy)| (t.0 + dx, t.1 + dy));
        for &t in &c.mouth {
            assert!(floor(m, t) && edge(t), "seed {seed}: mouth tile {t:?}");
            assert!(
                n4(t).iter().any(|q| c.interior.contains(q)),
                "seed {seed}: mouth tile {t:?} does not touch the interior"
            );
        }
        assert!(
            c.mouth
                .iter()
                .any(|&t| n4(t).iter().any(|&q| !inside(c.fp, q) && floor(m, q))),
            "seed {seed}: the mouth opens onto no floor outside"
        );
        assert!(
            c.interior.contains(&c.camp),
            "seed {seed}: the far elite camp {:?} is not floor",
            c.camp
        );
        if let Some(out) = c.interior.iter().find(|&&t| !inside(c.fp, t)) {
            panic!(
                "seed {seed}: the cave is open at {out:?} (footprint {:?})",
                c.fp
            );
        }
        if let Some(t) = halo_of(m, c.camp)
            .into_iter()
            .find(|t| !c.interior.contains(t))
        {
            panic!("seed {seed}: halo tile {t:?} of the far elite camp is not inside the cave");
        }
    }
}

/// Every floor tile inside the footprint is reached from the mouth without leaving the footprint: no sealed pocket.
#[test]
fn every_floor_tile_inside_the_cave_is_reached_from_the_mouth() {
    for l in maps() {
        let (seed, m) = (l.seed, &l.map);
        let c = cave(seed, m);
        let reach = flood(m, &c.mouth, &|t| inside(c.fp, t) && floor(m, t));
        for y in c.fp.1 + 1..c.fp.3 {
            for x in c.fp.0 + 1..c.fp.2 {
                assert!(
                    !floor(m, (x, y)) || reach.contains(&(x, y)),
                    "seed {seed}: floor tile ({x}, {y}) inside the cave is sealed off from the mouth"
                );
            }
        }
    }
}

/// Fairness: a 3-wide way (header definition) leads from the mouth's middle tile to the far elite camp.
#[test]
fn a_three_wide_way_leads_from_the_mouth_to_the_camp() {
    for l in maps() {
        let (seed, m) = (l.seed, &l.map);
        let c = cave(seed, m);
        let wide = |t: Cell| (-1..=1).all(|dy| (-1..=1).all(|dx| floor(m, (t.0 + dx, t.1 + dy))));
        let mut mouth = c.mouth.clone();
        mouth.sort();
        let mid = mouth[mouth.len() / 2];
        let reach = flood(m, &[mid], &|t| inside(c.fp, t) && wide(t));
        assert!(
            reach.contains(&c.camp),
            "seed {seed}: no 3-wide way from the mouth {mid:?} to the camp {:?}",
            c.camp
        );
    }
}

/// The ice floor: at least `ice_share_min()` percent of the interior is the cave's ice; no ice in any camp's certifier
/// halo; no ice in the first `mouth_rows_dry()` rows inside the mouth. Red today: about 20 ice tiles in stripes along
/// the walls of a 90-tile interior.
#[test]
fn the_cave_has_an_ice_floor_dry_at_the_camp_and_the_mouth() {
    let mut bad = Vec::new();
    for l in maps() {
        let (seed, m) = (l.seed, &l.map);
        let c = cave(seed, m);
        let halo = halos(m);
        let ice: Vec<Cell> = c
            .interior
            .iter()
            .copied()
            .filter(|&t| {
                let i = at(m, t).unwrap();
                m.terrain[i] == 6 && usize::from(m.feature_grid[i]) == c.k + 1
            })
            .collect();
        let share = 100 * ice.len() / c.interior.len().max(1);
        if share < ice_share_min() {
            bad.push(format!(
                "seed {seed}: ice {}/{} interior tiles ({share}%)",
                ice.len(),
                c.interior.len()
            ));
        }
        if let Some(t) = ice.iter().find(|t| halo.contains(t)) {
            bad.push(format!("seed {seed}: ice at {t:?} in a camp's halo"));
        }
        if let Some(t) = ice
            .iter()
            .find(|&&t| (1..=mouth_rows_dry()).contains(&from_mouth_edge(&c, t)))
        {
            bad.push(format!(
                "seed {seed}: ice at {t:?} in the mouth's first rows"
            ));
        }
    }
    assert!(bad.is_empty(), "{bad:#?}");
}

// ---------------------------------------------------------------------------------------------------------------------
// Guards: pass today, must keep passing.
// ---------------------------------------------------------------------------------------------------------------------

/// Every seed 1-32 still places all four signature landmarks and the Holy anchor, and certifies with zero failures
/// under the strictest settings (every zone strict: spawn-walk ratio, route and camp rules included).
#[test]
fn every_zone_keeps_its_landmark_and_every_map_certifies_clean() {
    for l in maps() {
        let (seed, m) = (l.seed, &l.map);
        single(seed, m, FeatureKind::Volcano, Zone::Fire);
        single(seed, m, FeatureKind::Church, Zone::Sentenced);
        single(seed, m, FeatureKind::Graveyard, Zone::Sentenced);
        single(seed, m, FeatureKind::BogTree, Zone::Plague);
        single(seed, m, FeatureKind::Cave, Zone::Frost);
        anchor(seed, m, Zone::Holy);
        let c = certify::certify(
            m,
            &certify::Options {
                styled: true,
                zone: true,
                strict: certify::Strict::All,
            },
        )
        .unwrap_or_else(|e| panic!("seed {seed}: certifier refused the map: {e:?}"));
        let failures: Vec<String> = c
            .failures
            .iter()
            .map(|f| format!("{}/{}", f.rule, f.subject))
            .collect();
        assert!(failures.is_empty(), "seed {seed}: {failures:?}");
    }
}

/// The worst attempt index over seeds 1-32 stays within `worst_attempt_allowed()`, far from the limit of 16.
#[test]
fn the_worst_attempt_stays_within_the_bound() {
    let worst = maps()
        .map(|l| (l.attempt, l.seed))
        .max()
        .expect("seeds generated");
    assert!(
        worst.0 <= worst_attempt_allowed(),
        "seed {}: attempt {} (allowed {})",
        worst.1,
        worst.0,
        worst_attempt_allowed()
    );
}

/// The attempts seeds 1-32 use in all stay within `attempts_allowed()`: a larger cave that cuts camp territories or
/// misses its site is not paid for in refused attempts.
#[test]
fn the_attempts_used_stay_within_the_bound() {
    let used: u64 = maps().map(|l| l.attempt + 1).sum();
    assert!(
        used <= attempts_allowed(),
        "{used} attempts over seeds 1-32 (allowed {})",
        attempts_allowed()
    );
}

/// The report the brief asks for (not a gate check; run with `--ignored --nocapture`, and `time` the run: the wall
/// clock is not allowed in rh-sim tests' assertions): seeds 1-64, the attempt each lands on, the cave's size and ice.
#[test]
#[ignore]
fn report_seeds_1_to_64() {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    let mut worst = (0, 0);
    for seed in 1..=64 {
        let (n, m) = (0..attempt_limit())
            .find_map(|n| {
                generator
                    .styled_attempt(seed, n, on_options())
                    .expect("generator error")
                    .map(|m| (n, m))
            })
            .unwrap_or_else(|| panic!("seed {seed}: no map"));
        let c = cave(seed, &m);
        let ice = c
            .interior
            .iter()
            .filter(|&&t| {
                let i = at(&m, t).unwrap();
                m.terrain[i] == 6 && usize::from(m.feature_grid[i]) == c.k + 1
            })
            .count();
        eprintln!(
            "seed {seed}: attempt {n}, cave {}x{}, ice {ice}/{}",
            c.fp.2 - c.fp.0 + 1,
            c.fp.3 - c.fp.1 + 1,
            c.interior.len()
        );
        worst = worst.max((n, seed));
    }
    eprintln!("worst attempt: {} (seed {})", worst.0, worst.1);
}
