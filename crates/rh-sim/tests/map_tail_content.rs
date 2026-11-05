use rh_sim::content::{content_hash, content_hash_of_tail_definition, REGISTRY, STAGGER_WEAPONS};
use rh_sim::mapgen::tail::{default_definition, Definition};

#[test]
fn both_tail_policies_move_aggregate_identity() {
    let base = default_definition();
    let hash = |d: &Definition| content_hash_of_tail_definition(REGISTRY, STAGGER_WEAPONS, d);
    let baseline = hash(&base);
    assert_eq!(baseline, content_hash());
    let Definition {
        wall_piece_min: _,
        loot_margin: _,
    } = base;
    assert_ne!(
        baseline,
        hash(&Definition {
            wall_piece_min: base.wall_piece_min + 1,
            ..base
        })
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            loot_margin: base.loot_margin + 1,
            ..base
        })
    );
}
