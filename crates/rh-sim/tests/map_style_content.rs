use rh_sim::content::{
    content_hash, content_hash_of_style_features_definition,
    content_hash_of_style_sanctum_definition, REGISTRY, STAGGER_WEAPONS,
};
#[test]
fn style_features_policies_move_aggregate_identity() {
    use rh_sim::mapgen::style_features::{Definition, DEFAULT_DEFINITION};
    let base = DEFAULT_DEFINITION;
    let hash =
        |d: &Definition| content_hash_of_style_features_definition(REGISTRY, STAGGER_WEAPONS, d);
    let baseline = hash(&base);
    assert_eq!(baseline, content_hash());
    let Definition {
        chamfer_far: _,
        chamfer_orthogonal: _,
        chamfer_diagonal: _,
        majority_threshold: _,
        path_far: _,
        hard_radius: _,
        noise_cell: _,
        noise_scale: _,
        path_orthogonal: _,
        path_diagonal: _,
        hard_penalty: _,
    } = base;
    assert_ne!(
        baseline,
        hash(&Definition {
            chamfer_far: base.chamfer_far + 1,
            ..base
        }),
        "chamfer_far"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            chamfer_orthogonal: base.chamfer_orthogonal + 1,
            ..base
        }),
        "chamfer_orthogonal"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            chamfer_diagonal: base.chamfer_diagonal + 1,
            ..base
        }),
        "chamfer_diagonal"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            majority_threshold: base.majority_threshold + 1,
            ..base
        }),
        "majority_threshold"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            path_far: base.path_far + 1,
            ..base
        }),
        "path_far"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            hard_radius: base.hard_radius + 1,
            ..base
        }),
        "hard_radius"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            noise_cell: base.noise_cell + 1.0,
            ..base
        }),
        "noise_cell"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            noise_scale: base.noise_scale + 1.0,
            ..base
        }),
        "noise_scale"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            path_orthogonal: base.path_orthogonal + 1,
            ..base
        }),
        "path_orthogonal"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            path_diagonal: base.path_diagonal + 1,
            ..base
        }),
        "path_diagonal"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            hard_penalty: base.hard_penalty + 1,
            ..base
        }),
        "hard_penalty"
    );
}
#[test]
fn style_sanctum_policies_move_aggregate_identity() {
    use rh_sim::mapgen::style_sanctum::{Definition, DEFAULT_DEFINITION};
    let base = DEFAULT_DEFINITION;
    let hash =
        |d: &Definition| content_hash_of_style_sanctum_definition(REGISTRY, STAGGER_WEAPONS, d);
    let baseline = hash(&base);
    assert_eq!(baseline, content_hash());
    let Definition {
        line_bonus: _,
        line_width_squared: _,
        outer_bay_radius_min: _,
        stretch_tries: _,
        stretch_budget: _,
        variant_salt: _,
        variant_count: _,
        glass_salt: _,
        glass_chance: _,
    } = base;
    assert_ne!(
        baseline,
        hash(&Definition {
            line_bonus: base.line_bonus + 1.0,
            ..base
        }),
        "line_bonus"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            line_width_squared: base.line_width_squared + 1.0,
            ..base
        }),
        "line_width_squared"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            outer_bay_radius_min: base.outer_bay_radius_min + 1,
            ..base
        }),
        "outer_bay_radius_min"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            stretch_tries: base.stretch_tries + 1,
            ..base
        }),
        "stretch_tries"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            stretch_budget: base.stretch_budget + 1,
            ..base
        }),
        "stretch_budget"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            variant_salt: base.variant_salt + 1.0,
            ..base
        }),
        "variant_salt"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            variant_count: base.variant_count + 1,
            ..base
        }),
        "variant_count"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            glass_salt: base.glass_salt + 1.0,
            ..base
        }),
        "glass_salt"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            glass_chance: base.glass_chance + 0.01,
            ..base
        }),
        "glass_chance"
    );
}
