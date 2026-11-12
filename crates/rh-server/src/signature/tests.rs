use super::*;
use rh_sim::mapgen::{coliseum, pipeline};

fn styled(seed: i64) -> GameMapData {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    let options = pipeline::Options {
        decor: false,
        ..pipeline::Options::default()
    };
    generator
        .certified_styled(seed, options)
        .unwrap()
        .expect("certified")
}

fn count(m: &GameMapData, zone: Zone, tile: u8, terrain: u8) -> usize {
    (0..m.tiles.len())
        .filter(|&i| {
            m.region_grid[i] == zone.code() && m.tiles[i] == tile && m.terrain[i] == terrain
        })
        .count()
}

/// The loose proof (owner rule 9; no legacy oracle): over eight generated maps every landmark is placed at least once,
/// every placed landmark leaves the strict certifier with no new failure and the map still admits as a playable arena,
/// and a placed volcano, tree and cave carry their terrain in their own zone.
#[test]
fn signature_landmarks_land_on_real_maps_and_keep_them_certified() {
    let mut placed = std::collections::BTreeMap::<&str, usize>::new();
    for seed in 1..=8 {
        let mut m = styled(seed);
        let before = failures(&m).unwrap();
        let (lava, ember, bog, ice) = (
            count(&m, Zone::Fire, T_LOW, LAVA),
            count(&m, Zone::Fire, T_FLOOR, EMBER),
            count(&m, Zone::Plague, T_FLOOR, BOG),
            count(&m, Zone::Frost, T_FLOOR, ICE),
        );
        let report = apply(&mut m);
        let after = failures(&m).unwrap();
        assert!(
            after.iter().all(|f| before.contains(f)),
            "seed {seed}: {after:?}"
        );
        for name in &report.placed {
            *placed.entry(name).or_default() += 1;
        }
        if report.placed.contains(&"volcano") {
            assert!(count(&m, Zone::Fire, T_LOW, LAVA) > lava, "seed {seed}");
            assert!(count(&m, Zone::Fire, T_FLOOR, EMBER) > ember, "seed {seed}");
        }
        if report.placed.contains(&"bog tree") {
            assert!(
                count(&m, Zone::Plague, T_FLOOR, BOG) >= bog + 12,
                "seed {seed}"
            );
        }
        if report.placed.contains(&"frozen cave") {
            assert!(count(&m, Zone::Frost, T_FLOOR, ICE) >= ice, "seed {seed}");
        }
        let hash = u32::from_str_radix(&rh_sim::mapgen::map_hash::map_hash(&m), 16).unwrap();
        let arena = rh_sim::mapdata::MapExport {
            format: "rh-map/2".into(),
            legacy_map_hash_u32: hash,
            map: m,
        }
        .validate()
        .unwrap_or_else(|e| panic!("seed {seed}: {e}"))
        .into_arena()
        .unwrap();
        let assets = crate::map_pool::admit(arena).unwrap();
        if seed == 1 {
            // The live source-arena rules build and step a match on the signed map.
            let args: Vec<String> = "--runtime source-arena --map signed"
                .split_whitespace()
                .map(str::to_owned)
                .collect();
            let settings = crate::runtime::Settings::from_args(&args).unwrap().unwrap();
            let mut sim = rh_sim::Sim::new(
                settings.sim(),
                assets.arena.clone(),
                rh_sim::Secrets {
                    order_salt: 1,
                    spawn_seed: 2,
                    reward_salt: [3, 4, 5, 6],
                },
            );
            for _ in 0..100 {
                sim.step();
            }
        }
        eprintln!(
            "seed {seed}: placed {:?} skipped {:?}",
            report.placed, report.skipped
        );
    }
    for name in ["volcano", "church", "bog tree", "frozen cave"] {
        assert!(
            placed.get(name).copied().unwrap_or(0) >= 1,
            "{name} never placed: {placed:?}"
        );
    }
}

/// The pass is a pure function of the map: the same map gives the same result.
#[test]
fn the_pass_is_deterministic() {
    let mut a = styled(3);
    let mut b = a.clone();
    assert_eq!(apply(&mut a), apply(&mut b));
    assert_eq!(a, b);
}

/// The eight seeds' certified base maps and the pass's result on each, generated once per test binary (a certified map
/// takes about 60 ms).
struct Placed {
    seed: i64,
    base: GameMapData,
    map: GameMapData,
    report: Report,
}

fn placed_maps() -> &'static Vec<Placed> {
    static MAPS: std::sync::OnceLock<Vec<Placed>> = std::sync::OnceLock::new();
    MAPS.get_or_init(|| {
        (1..=8)
            .map(|seed| {
                let base = styled(seed);
                let mut map = base.clone();
                let report = apply(&mut map);
                Placed {
                    seed,
                    base,
                    map,
                    report,
                }
            })
            .collect()
    })
}

/// Tiles reachable from `starts` over floor tiles (not wall, not LOW), 4-connected.
fn flood(m: &GameMapData, starts: &[(i32, i32)]) -> Vec<bool> {
    let (w, h) = (m.w as i32, m.h as i32);
    let mut seen = vec![false; (w * h) as usize];
    let mut stack = Vec::new();
    for &(x, y) in starts {
        if x >= 0 && y >= 0 && x < w && y < h && m.tiles[(y * w + x) as usize] == T_FLOOR {
            seen[(y * w + x) as usize] = true;
            stack.push((x, y));
        }
    }
    while let Some((x, y)) = stack.pop() {
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let (u, v) = (x + dx, y + dy);
            if u >= 0 && v >= 0 && u < w && v < h {
                let i = (v * w + u) as usize;
                if !seen[i] && m.tiles[i] == T_FLOOR {
                    seen[i] = true;
                    stack.push((u, v));
                }
            }
        }
    }
    seen
}

fn first_spawn(m: &GameMapData) -> (i32, i32) {
    let s = &m.spawns[0];
    ((s.x / TILE).floor() as i32, (s.y / TILE).floor() as i32)
}

/// Finding 1: the grave stones are 2x3 blocks laid on a 3-tile pitch, so neighbours touch and form solid rows.
/// Every church must be recorded (the report names it), no two stones touch orthogonally (a stone is one 4-connected
/// piece of exactly STONE tiles), and every floor tile of the yard (the stones' box plus a margin that was reachable
/// from the first spawn before the pass) is reachable from the church door without crossing a stone.
#[test]
fn graveyard_stones_keep_walkable_gaps_and_the_yard_stays_reachable() {
    let mut churches = 0;
    for p in placed_maps() {
        let placed = p.report.placed.contains(&"church");
        assert_eq!(
            p.report.churches.len(),
            usize::from(placed),
            "seed {}: report names the placed church",
            p.seed
        );
        for church in &p.report.churches {
            churches += 1;
            let piece_size = (STONE.0 * STONE.1) as usize;
            let stones = &church.stones;
            // 4-connected components of stone tiles.
            let mut comp = vec![usize::MAX; stones.len()];
            for s in 0..stones.len() {
                if comp[s] != usize::MAX {
                    continue;
                }
                let mut stack = vec![s];
                let mut members = 0;
                comp[s] = s;
                while let Some(i) = stack.pop() {
                    members += 1;
                    for (j, c) in stones.iter().enumerate() {
                        let d = (c.0 - stones[i].0).abs() + (c.1 - stones[i].1).abs();
                        if comp[j] == usize::MAX && d == 1 {
                            comp[j] = s;
                            stack.push(j);
                        }
                    }
                }
                assert_eq!(
                    members, piece_size,
                    "seed {}: stones touch and form a wall of {members} tiles at {:?}",
                    p.seed, stones[s]
                );
            }
            if stones.is_empty() {
                continue;
            }
            let (x0, x1) = (
                stones.iter().map(|c| c.0).min().unwrap() - 1,
                stones.iter().map(|c| c.0).max().unwrap() + 1,
            );
            let (y0, y1) = (
                stones.iter().map(|c| c.1).min().unwrap() - 1,
                stones.iter().map(|c| c.1).max().unwrap() + 1,
            );
            let before = flood(&p.base, &[first_spawn(&p.base)]);
            let after = flood(&p.map, &church.door);
            let w = p.map.w as i32;
            for y in y0..=y1 {
                for x in x0..=x1 {
                    let i = (y * w + x) as usize;
                    if before[i] && p.map.tiles[i] == T_FLOOR {
                        assert!(
                            after[i],
                            "seed {}: yard tile ({x},{y}) cannot be reached from the door",
                            p.seed
                        );
                    }
                }
            }
        }
    }
    assert!(churches >= 1, "no church placed on seeds 1-8");
}

/// Finding 2: the door is three ring tiles left as they were; nothing checks them. Every placed church needs a door
/// tile that is floor and joined to the walkable region reached from the first spawn.
#[test]
fn every_church_has_an_open_door_joined_to_the_map() {
    let mut churches = 0;
    for p in placed_maps() {
        let reach = flood(&p.map, &[first_spawn(&p.map)]);
        let w = p.map.w as i32;
        for church in &p.report.churches {
            churches += 1;
            let open = church.door.iter().any(|&(x, y)| {
                let i = (y * w + x) as usize;
                p.map.tiles[i] == T_FLOOR && reach[i]
            });
            assert!(open, "seed {}: door {:?} is sealed", p.seed, church.door);
        }
    }
    assert!(churches >= 1, "no church placed on seeds 1-8");
}

/// A certified map made to carry a certifier failure: one camp's clearing is walled solid.
fn broken(seed: i64) -> GameMapData {
    let mut m = styled(seed);
    let c = m.camps[0].clone();
    let w = m.w as i32;
    for (x, y) in disk(c.x / TILE, c.y / TILE, c.r / TILE + 1.) {
        m.tiles[(y * w + x) as usize] = T_WALL;
    }
    m
}

/// Finding 3: `apply` keeps a landmark when every failure after is already in the baseline's list, so a base map that
/// already fails is still edited. A base map with a failure must come back byte-identical with nothing placed; a clean
/// base map's kept landmarks leave zero failures.
#[test]
fn a_failing_base_map_is_left_alone_and_kept_landmarks_certify_clean() {
    for seed in 1..=8 {
        let m = broken(seed);
        let before = failures(&m).expect("certifier accepts the edited map");
        assert!(
            !before.is_empty(),
            "seed {seed}: the edit must fail the certifier"
        );
        let mut after = m.clone();
        let report = apply(&mut after);
        assert!(report.placed.is_empty(), "seed {seed}: {:?}", report.placed);
        assert_eq!(after, m, "seed {seed}: map changed");
    }
    for p in placed_maps() {
        assert!(failures(&p.base).unwrap().is_empty(), "seed {}", p.seed);
        let after = failures(&p.map).unwrap();
        assert!(after.is_empty(), "seed {}: {after:?}", p.seed);
    }
}
