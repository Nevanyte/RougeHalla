//! Every live spot-placement tuning field participates in aggregate content identity.
use rh_sim::content::{content_hash, content_hash_of_spot_definition, REGISTRY, STAGGER_WEAPONS};
use rh_sim::mapgen::spots::{default_definition, Definition};

fn hash(definition: &Definition) -> u64 {
    content_hash_of_spot_definition(REGISTRY, STAGGER_WEAPONS, definition)
}

#[test]
fn spot_identity_covers_every_scalar_and_ordered_gap() {
    let base = default_definition();
    let baseline = hash(&base);
    assert_eq!(baseline, content_hash());
    // Adding a live policy field requires an explicit probe below.
    let Definition {
        camp_min: _,
        camp_max: _,
        camp_gap: _,
        crate_min: _,
        crate_max: _,
        crate_gap: _,
        crate_first_gap: _,
        crate_pool_margin: _,
        crate_camp_margin: _,
        crate_spot_margin: _,
        door_margin: _,
        ground_open_min: _,
        ground_min: _,
        ground_max: _,
        ground_spawn_margin: _,
        ground_crate_margin: _,
        ground_hazard_margin: _,
        ground_gaps: _,
    } = base;
    macro_rules! probe {
        ($($field:ident),+ $(,)?) => {
            $({
                let mut changed = base;
                changed.$field += 1;
                assert_ne!(baseline, hash(&changed), "omitted {}", stringify!($field));
            })+
        };
    }
    probe!(
        camp_min,
        camp_max,
        camp_gap,
        crate_min,
        crate_max,
        crate_gap,
        crate_first_gap,
        crate_pool_margin,
        crate_camp_margin,
        crate_spot_margin,
        door_margin,
        ground_open_min,
        ground_min,
        ground_max,
        ground_spawn_margin,
        ground_crate_margin,
        ground_hazard_margin,
    );
    assert_eq!(base.ground_gaps.len(), 3);
    for index in 0..base.ground_gaps.len() {
        let mut changed = base;
        changed.ground_gaps[index] += 1;
        assert_ne!(baseline, hash(&changed), "omitted ground gap {index}");
    }
    let mut changed = base;
    changed.ground_gaps.swap(0, 1);
    assert_ne!(baseline, hash(&changed), "omitted ground gap ordering");
}
