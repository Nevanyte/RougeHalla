use rh_sim::content::{content_hash, content_hash_of_repair_definition, REGISTRY, STAGGER_WEAPONS};
use rh_sim::mapgen::{repair, terrain_gate};

#[test]
fn repair_policy_and_borrowed_classification_move_aggregate_identity() {
    let base = repair::default_definition(&terrain_gate::GENERATOR_TILE_CLASSES);
    let hash = |d: &repair::Definition<'_>| {
        content_hash_of_repair_definition(REGISTRY, STAGGER_WEAPONS, d)
    };
    let baseline = hash(&base);
    assert_eq!(baseline, content_hash());
    let repair::Definition {
        floor_share_max: _,
        stray_max: _,
        wall_up_max: _,
        territory_rounds: _,
        zone_rounds: _,
        wall_sweeps: _,
        terrain_on: _,
    } = base;
    let mut changed = base;
    changed.floor_share_max += 0.01;
    assert_ne!(baseline, hash(&changed));
    macro_rules! probe {
        ($($field:ident),+ $(,)?) => { $({
            let mut changed = base;
            changed.$field += 1;
            assert_ne!(baseline, hash(&changed), "omitted {}", stringify!($field));
        })+ };
    }
    probe!(
        stray_max,
        wall_up_max,
        territory_rounds,
        zone_rounds,
        wall_sweeps
    );
    assert_eq!(base.terrain_on.len(), 8);
    for index in 0..base.terrain_on.len() {
        let mut classes = base.terrain_on.to_vec();
        classes[index] = if classes[index] == 0 { 2 } else { 0 };
        assert_ne!(
            baseline,
            hash(&repair::Definition {
                terrain_on: &classes,
                ..base
            })
        );
    }
    assert_ne!(
        baseline,
        hash(&repair::Definition {
            terrain_on: &base.terrain_on[..7],
            ..base
        })
    );
    let mut classes = base.terrain_on.to_vec();
    classes.swap(1, 4);
    assert_ne!(
        baseline,
        hash(&repair::Definition {
            terrain_on: &classes,
            ..base
        })
    );
}
