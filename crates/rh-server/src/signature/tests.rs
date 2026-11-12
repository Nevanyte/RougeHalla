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
