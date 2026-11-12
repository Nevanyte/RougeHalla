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
    // The church and the bog tree are the generator's (P-MAPGEN-SIGNATURE-CORE-1); the pass keeps Fire and Frost.
    for name in ["volcano", "frozen cave"] {
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
}

fn placed_maps() -> &'static Vec<Placed> {
    static MAPS: std::sync::OnceLock<Vec<Placed>> = std::sync::OnceLock::new();
    MAPS.get_or_init(|| {
        (1..=8)
            .map(|seed| {
                let base = styled(seed);
                let mut map = base.clone();
                apply(&mut map);
                Placed { seed, base, map }
            })
            .collect()
    })
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

// ---------------------------------------------------------------------------------------------------------------
// P-MAPGEN-SIGNATURE-CORE-1: the generator places the church and the bog tree (owner rules G1-G2, 2026-11-12); the pass
// keeps only Fire and Frost until their packets land.
// ---------------------------------------------------------------------------------------------------------------

/// With `--signature-landmarks` the pool's maker passes the generator option, the pass neither places nor tries a church
/// or a bog tree and leaves the Sentenced and Plague zones exactly as the generator made them, the served map holds
/// the generator's one church and one bog tree, and the generator's map keeps its anchors.
#[test]
fn the_generator_owns_the_church_and_the_bog_tree() {
    use crate::map_pool::{MapMaker, StyledMaker};
    assert_eq!(
        StyledMaker::default().options(),
        pipeline::Options {
            decor: false,
            ..pipeline::Options::default()
        }
    );
    let maker = StyledMaker { signature: true };
    assert_eq!(
        maker.options(),
        pipeline::Options {
            decor: false,
            signature: true,
            ..pipeline::Options::default()
        },
        "the maker does not pass the signature option"
    );
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    for seed in 1..=3u32 {
        let generated = generator
            .certified_styled(i64::from(seed), maker.options())
            .unwrap()
            .expect("certified");
        let mut after = generated.clone();
        let report = apply(&mut after);
        for name in ["church", "bog tree"] {
            assert!(
                !report.placed.contains(&name) && !report.skipped.iter().any(|(n, _)| *n == name),
                "seed {seed}: the pass still runs the {name}: {report:?}"
            );
        }
        for zone in [Zone::Plague, Zone::Sentenced] {
            let features = |m: &GameMapData| -> Vec<MapFeature> {
                m.features
                    .iter()
                    .filter(|f| f.zone == zone)
                    .cloned()
                    .collect()
            };
            assert_eq!(
                features(&after),
                features(&generated),
                "seed {seed}: the pass changed {zone:?} features"
            );
            for i in 0..generated.tiles.len() {
                if generated.region_grid[i] == zone.code() {
                    assert!(
                        after.tiles[i] == generated.tiles[i]
                            && after.terrain[i] == generated.terrain[i],
                        "seed {seed}: the pass changed {zone:?} tile {i}"
                    );
                }
            }
        }
        let arena = maker.make(seed).unwrap().expect("a served map");
        let data = arena.map.layers().expect("map layers").data();
        for (kind, zone) in [
            (FeatureKind::BogTree, Zone::Plague),
            (FeatureKind::Church, Zone::Sentenced),
        ] {
            let n = data
                .features
                .iter()
                .filter(|f| f.kind == kind && f.zone == zone)
                .count();
            assert_eq!(n, 1, "seed {seed}: the served map has {n} {kind:?}");
        }
        // The anchors live on the generator's map (`GameMapData`), where the decoration bake reads them at pool-build
        // time. They are NOT on the sim's `LayerData`: that is checkpointed state, and the checkpoint layout rule
        // (`Sim::check_layout`) forbids a field that is skipped when empty (coordinator amendment, 2026-11-12).
        assert!(
            !generated.anchors.is_empty() && after.anchors == generated.anchors,
            "seed {seed}: the pass lost the generator's anchors"
        );
    }
}
