//! ADR0024 geometry kernels (P-HB-2) against dense sampling, with the seeded `rh_sim::rng` stream:
//!
//! * `box_clear` equals a dense sample of the box's open interior (exact on a 1/4-unit lattice);
//! * `segment_box_clear` is sound: when it says clear, every box along the segment is clear;
//! * `segment_box_entry` matches the first sampled contact of the segment with the closed box;
//! * `arc_hits_box` finds every sampled contact of the box with the wedge, and never hits a box that a dense polar sample
//!   of the wedge misses by more than its sampling gap;
//! * `Footprint::Disc` is exactly the legacy disc functions.

use rh_sim::arenas::{practice_arena, MapFile};
use rh_sim::constants::{PLAYER_RADIUS, TILE};
use rh_sim::geometry::{
    arc_hits_box, box_clear, circle_clear, segment_box_clear, segment_box_entry, segment_clear,
    Aabb, Footprint,
};
use rh_sim::map::{MASK_MELEE, MASK_MOVE, MASK_SIGHT};
use rh_sim::math::{angle_between, atan2, cos, hypot, sin, Vec2, PI};
use rh_sim::rng::Mulberry32;
use rh_sim::TileMap;

struct R(Mulberry32);
impl R {
    fn new(seed: u32) -> Self {
        R(Mulberry32::new(seed))
    }
    fn unit(&mut self) -> f64 {
        self.0.next_f64()
    }
    fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.unit()
    }
    fn below(&mut self, n: u32) -> u32 {
        self.0.next_u32() % n
    }
    /// A value on the 1/4-unit lattice in [lo, hi).
    fn quarter(&mut self, lo: f64, hi: f64) -> f64 {
        (self.range(lo, hi) * 4.0).floor() / 4.0
    }
}

fn seed1_map() -> TileMap {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../parity/maps/seed1.map.json");
    let text = std::fs::read_to_string(path).expect("parity/maps/seed1.map.json");
    let file: MapFile = serde_json::from_str(&text).expect("map json");
    file.into_arena().expect("seed1 arena").map
}

fn maps() -> Vec<(&'static str, TileMap)> {
    vec![("seed1", seed1_map()), ("practice", practice_arena().map)]
}

const MASKS: [u8; 3] = [MASK_SIGHT, MASK_MOVE, MASK_MELEE];
/// The foot box of every boxed archetype and a few other shapes.
const BOXES: [(f64, f64); 4] = [(10.0, 6.0), (6.0, 10.0), (12.0, 12.0), (3.0, 1.0)];

/// Is a world point inside a blocked tile (out of bounds is blocked)?
fn point_blocked(map: &TileMap, x: f64, y: f64, mask: u8) -> bool {
    map.blocked((x / TILE).floor() as i64, (y / TILE).floor() as i64, mask)
}

/// The box's open interior sampled at the centres of a 1/4-unit grid: exact for a box whose edges are on the 1/4 lattice.
fn dense_box_clear(map: &TileMap, p: Vec2, hx: f64, hy: f64, mask: u8) -> bool {
    let nx = (2.0 * hx * 4.0).round() as i64;
    let ny = (2.0 * hy * 4.0).round() as i64;
    for j in 0..ny {
        let y = p.y - hy + (j as f64 + 0.5) / 4.0;
        for i in 0..nx {
            let x = p.x - hx + (i as f64 + 0.5) / 4.0;
            if point_blocked(map, x, y, mask) {
                return false;
            }
        }
    }
    true
}

#[test]
fn box_clear_equals_a_dense_sample_of_the_open_box() {
    for (name, map) in maps() {
        let (ww, wh) = map.world_size();
        let mut r = R::new(0x4842_0001);
        let (mut clear, mut blocked) = (0, 0);
        for k in 0..20_000u32 {
            let (hx, hy) = BOXES[(k % 4) as usize];
            let mask = MASKS[(k % 3) as usize];
            // Half the points sit exactly on tile edges +/- a box half-extent, where "touching" decides.
            let p = if k % 2 == 0 {
                Vec2::new(r.quarter(-TILE, ww + TILE), r.quarter(-TILE, wh + TILE))
            } else {
                let tx = r.below((ww / TILE) as u32) as f64 * TILE;
                let ty = r.below((wh / TILE) as u32) as f64 * TILE;
                let sx = [hx, -hx, 0.0, TILE / 2.0][r.below(4) as usize];
                let sy = [hy, -hy, 0.0, TILE / 2.0][r.below(4) as usize];
                Vec2::new(tx + sx, ty + sy)
            };
            let want = dense_box_clear(&map, p, hx, hy, mask);
            assert_eq!(
                box_clear(&map, p, hx, hy, mask),
                want,
                "{name}: box ({hx},{hy}) at {p:?} mask {mask}"
            );
            assert_eq!(Footprint::Box { hx, hy }.clear(&map, p, mask), want);
            if want {
                clear += 1;
            } else {
                blocked += 1;
            }
        }
        assert!(clear > 2_000 && blocked > 2_000, "{name}: {clear} clear, {blocked} blocked");
        for bad in [f64::NAN, f64::INFINITY] {
            assert!(!box_clear(&map, Vec2::new(bad, 40.0), 10.0, 6.0, MASK_MOVE));
        }
    }
}

#[test]
fn a_box_touching_a_wall_is_clear_and_one_overlapping_it_is_not() {
    let map = practice_arena().map;
    // Find a floor tile whose north neighbour is solid.
    let (w, h) = (map.w as i64, map.h as i64);
    let (tx, ty) = (1..h)
        .flat_map(|ty| (0..w).map(move |tx| (tx, ty)))
        .find(|&(tx, ty)| {
            map.is_floor(tx, ty)
                && map.is_solid(tx, ty - 1)
                && map.is_floor(tx - 1, ty)
                && map.is_floor(tx + 1, ty)
                && map.is_floor(tx, ty + 1)
        })
        .expect("a floor tile under a wall");
    let face = ty as f64 * TILE;
    let x = tx as f64 * TILE + TILE / 2.0;
    assert!(box_clear(&map, Vec2::new(x, face + 6.0), 10.0, 6.0, MASK_MOVE));
    assert!(!box_clear(&map, Vec2::new(x, face + 5.999), 10.0, 6.0, MASK_MOVE));
    // The legacy disc stops 12 u from the same face.
    assert!(circle_clear(&map, Vec2::new(x, face + 12.0), PLAYER_RADIUS, MASK_MOVE));
    assert!(!circle_clear(&map, Vec2::new(x, face + 6.0), PLAYER_RADIUS, MASK_MOVE));
}

#[test]
fn segment_box_clear_is_sound_against_dense_sampling() {
    for (name, map) in maps() {
        let (ww, wh) = map.world_size();
        let mut r = R::new(0x4842_0002);
        let (mut clear, mut tested) = (0, 0);
        for k in 0..6_000u32 {
            let (hx, hy) = BOXES[(k % 4) as usize];
            let mask = MASKS[(k % 3) as usize];
            let a = Vec2::new(r.range(0.0, ww), r.range(0.0, wh));
            let reach = [8.0, 40.0, 120.0][r.below(3) as usize];
            let b = match r.below(4) {
                0 => Vec2::new(a.x + r.range(-reach, reach), a.y),
                1 => Vec2::new(a.x, a.y + r.range(-reach, reach)),
                _ => Vec2::new(a.x + r.range(-reach, reach), a.y + r.range(-reach, reach)),
            };
            tested += 1;
            if !segment_box_clear(&map, a, b, hx, hy, mask) {
                continue;
            }
            clear += 1;
            let len = hypot(b.x - a.x, b.y - a.y);
            let n = (len / 0.25).ceil().max(1.0) as u32;
            for i in 0..=n {
                let u = f64::from(i) / f64::from(n);
                let p = Vec2::new(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
                // The box minus a hair on each side: a sampled box that only touches a wall face is clear by definition.
                assert!(
                    box_clear(&map, p, hx - 1e-7, hy - 1e-7, mask),
                    "{name}: segment {a:?}->{b:?} box ({hx},{hy}) mask {mask} is clear but the box at u={u} is not"
                );
            }
        }
        assert!(clear > tested / 5, "{name}: only {clear} of {tested} clear");
    }
}

#[test]
fn footprint_disc_is_exactly_the_legacy_disc() {
    for (_, map) in maps() {
        let (ww, wh) = map.world_size();
        let mut r = R::new(0x4842_0003);
        for k in 0..20_000u32 {
            let mask = MASKS[(k % 3) as usize];
            let a = Vec2::new(r.range(-TILE, ww + TILE), r.range(-TILE, wh + TILE));
            let b = Vec2::new(a.x + r.range(-100.0, 100.0), a.y + r.range(-100.0, 100.0));
            let rad = [PLAYER_RADIUS, 4.0, 0.0, 20.0][(k % 4) as usize];
            let fp = Footprint::from(rad);
            assert_eq!(fp, Footprint::Disc(rad));
            assert_eq!(fp.clear(&map, a, mask), circle_clear(&map, a, rad, mask));
            assert_eq!(
                fp.segment_clear(&map, a, b, mask),
                segment_clear(&map, a, b, rad, mask)
            );
        }
    }
}

fn random_box(r: &mut R) -> Aabb {
    let c = Vec2::new(r.range(-60.0, 60.0), r.range(-60.0, 60.0));
    Aabb::centred(c, r.range(0.5, 25.0), r.range(0.5, 40.0))
}

#[test]
fn segment_box_entry_matches_the_first_sampled_contact() {
    let mut r = R::new(0x4842_0004);
    let mut hits = 0;
    for _ in 0..20_000 {
        let bx = random_box(&mut r);
        let a = Vec2::new(r.range(-100.0, 100.0), r.range(-100.0, 100.0));
        let b = match r.below(3) {
            0 => Vec2::new(r.range(-100.0, 100.0), a.y),
            1 => Vec2::new(a.x, r.range(-100.0, 100.0)),
            _ => Vec2::new(r.range(-100.0, 100.0), r.range(-100.0, 100.0)),
        };
        let got = segment_box_entry(a, b, bx);
        if bx.contains(a) {
            let c = bx.centre();
            let away = (a.x - c.x) * (b.x - a.x) + (a.y - c.y) * (b.y - a.y) > 0.0;
            assert_eq!(got, (!away).then_some(0.0), "inside start {a:?}->{b:?} {bx:?}");
            continue;
        }
        const N: u32 = 4_000;
        let first = (0..=N).map(|i| f64::from(i) / f64::from(N)).find(|&u| {
            bx.contains(Vec2::new(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u))
        });
        match (got, first) {
            (Some(u), Some(s)) => {
                hits += 1;
                assert!(u <= s + 1e-12 && s - u <= 1.0 / f64::from(N) + 1e-12, "{u} vs {s}");
            }
            (None, None) => {}
            // A contact shorter than the sample step: the exact entry exists and lies on the box.
            (Some(u), None) => {
                let p = Vec2::new(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
                assert!(bx.grown(1e-9).contains(p), "{a:?}->{b:?} {bx:?} u={u}");
            }
            (None, Some(s)) => panic!("missed a sampled contact at {s}: {a:?}->{b:?} {bx:?}"),
        }
    }
    assert!(hits > 2_000, "{hits}");
}

/// Is `p` in the closed wedge (origin, aim, reach, half arc)?
fn in_wedge(o: Vec2, a: f64, reach: f64, half_arc: f64, p: Vec2) -> bool {
    let dx = p.x - o.x;
    let dy = p.y - o.y;
    if dx * dx + dy * dy > reach * reach {
        return false;
    }
    (dx == 0.0 && dy == 0.0) || angle_between(atan2(dy, dx), a) <= half_arc
}

#[test]
fn arc_hits_box_agrees_with_dense_sampling_both_ways() {
    let mut r = R::new(0x4842_0005);
    let (mut hit, mut miss) = (0, 0);
    for k in 0..1_500u32 {
        let bx = random_box(&mut r);
        let o = Vec2::new(r.range(-90.0, 90.0), r.range(-90.0, 90.0));
        let a = r.range(-PI, PI);
        let reach = r.range(5.0, 70.0);
        let half_arc = [0.3, 0.8, 1.2, PI / 2.0, 2.5][(k % 5) as usize];
        let got = arc_hits_box(o, a, reach, half_arc, bx);
        // No false miss: any sampled box point inside the wedge is a hit.
        let step = 0.25;
        let nx = ((bx.x1 - bx.x0) / step).ceil() as u32;
        let ny = ((bx.y1 - bx.y0) / step).ceil() as u32;
        let sampled_hit = (0..=ny).any(|j| {
            (0..=nx).any(|i| {
                let p = Vec2::new(
                    (bx.x0 + f64::from(i) * step).min(bx.x1),
                    (bx.y0 + f64::from(j) * step).min(bx.y1),
                );
                in_wedge(o, a, reach, half_arc, p)
            })
        });
        if sampled_hit {
            assert!(got, "missed: o {o:?} a {a} reach {reach} half {half_arc} {bx:?}");
        }
        // No false hit: a polar sample of the closed wedge (radial step dr, angular step dt, both ends included) lands
        // within the sampling gap of any true contact, so a hit must have a polar sample in the slightly grown box.
        if got {
            let (dr, dt): (f64, f64) = (0.25, 0.004);
            let gap = dr.max(reach * dt) + 1e-9;
            let grown = bx.grown(gap);
            let nr = (reach / dr).ceil() as u32;
            let nt = (2.0 * half_arc / dt).ceil() as u32;
            let polar_hit = grown.contains(o)
                || (0..=nt).any(|t| {
                    let th = a - half_arc + 2.0 * half_arc * f64::from(t) / f64::from(nt);
                    let (c, s) = (cos(th), sin(th));
                    (0..=nr).any(|i| {
                        let d = reach * f64::from(i) / f64::from(nr);
                        grown.contains(Vec2::new(o.x + c * d, o.y + s * d))
                    })
                });
            assert!(polar_hit, "false hit: o {o:?} a {a} reach {reach} half {half_arc} {bx:?}");
        }
        if got {
            hit += 1;
        } else {
            miss += 1;
        }
    }
    assert!(hit > 150 && miss > 150, "{hit} hits, {miss} misses");
}

#[test]
fn arc_hits_box_edge_cases() {
    let bx = Aabb::centred(Vec2::new(0.0, -30.0), 16.0, 35.0);
    // Origin inside the box hits whatever the aim.
    assert!(arc_hits_box(Vec2::new(0.0, -30.0), 0.0, 1.0, 0.1, bx));
    // A wedge pointing away from a box beside it misses; turned towards it, hits.
    let o = Vec2::new(40.0, -30.0);
    assert!(!arc_hits_box(o, 0.0, 30.0, 0.5, bx));
    assert!(arc_hits_box(o, PI, 30.0, 0.5, bx));
    // Just out of reach of the near face (x = 16): 24 away.
    assert!(!arc_hits_box(o, PI, 23.99, 0.5, bx));
    assert!(arc_hits_box(o, PI, 24.0, 0.5, bx));
    // The closest point is outside the wedge but a boundary ray crosses the box (box corner case).
    let o = Vec2::new(30.0, 20.0);
    let a = atan2(-1.0, -0.2);
    assert!(arc_hits_box(o, a, 60.0, 0.4, bx));
}
