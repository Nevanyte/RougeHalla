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

#[test]
fn warren_policies_and_candidate_orders_move_aggregate_identity() {
    use rh_sim::content::content_hash_of_style_warren_definition;
    use rh_sim::mapgen::style_warren::{default_definition, Definition};
    let base = default_definition();
    let hash =
        |d: &Definition<'_>| content_hash_of_style_warren_definition(REGISTRY, STAGGER_WEAPONS, d);
    let baseline = hash(&base);
    assert_eq!(baseline, content_hash());
    let Definition {
        barrows_per_ref: _,
        tunnels_per_ref: _,
        road_min2: _,
        r4_min: _,
        r4_max: _,
        r4_tunnel: _,
        pad_camp10: _,
        pad_door10: _,
        t_permille: _,
        across: _,
        accept_permille: _,
        member_gap4: _,
        clip_max: _,
        bog_min_piece: _,
        bog_camp_gap: _,
        burrow_road_near2: _,
        route_tries: _,
        radius_length: _,
        radius_shrink: _,
        jitter_cell: _,
        jitter_salt: _,
        jitter_scale: _,
        jitter_divisor: _,
        wet_cell: _,
        wet_salt: _,
        wet_threshold: _,
        camp_window: _,
        crescent_inner20: _,
        crescent_outer20: _,
        crescent_along4: _,
        slot_width_squared: _,
        score_across: _,
        score_along_divisor: _,
        variants: _,
        wall_variant_salt: _,
        wall_salt: _,
        fungus_chance: _,
        drip_chance: _,
        reed_salt: _,
        reed_chance: _,
        reed_variant_salt: _,
        rubble_salt: _,
        rubble_chance: _,
        rubble_variant_salt: _,
    } = base;
    assert_ne!(
        baseline,
        hash(&Definition {
            barrows_per_ref: base.barrows_per_ref + 1.0,
            ..base
        }),
        "barrows_per_ref"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            tunnels_per_ref: base.tunnels_per_ref + 1.0,
            ..base
        }),
        "tunnels_per_ref"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            road_min2: base.road_min2 + 1.0,
            ..base
        }),
        "road_min2"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            r4_min: base.r4_min + 1,
            ..base
        }),
        "r4_min"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            r4_max: base.r4_max + 1,
            ..base
        }),
        "r4_max"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            r4_tunnel: base.r4_tunnel + 1,
            ..base
        }),
        "r4_tunnel"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            pad_camp10: base.pad_camp10 + 1.0,
            ..base
        }),
        "pad_camp10"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            pad_door10: base.pad_door10 + 1.0,
            ..base
        }),
        "pad_door10"
    );
    {
        let mut list = base.t_permille.to_vec();
        for i in 0..list.len() {
            let original = list[i];
            list[i] = original + 1;
            assert_ne!(
                baseline,
                hash(&Definition {
                    t_permille: &list,
                    ..base
                }),
                "t_permille element"
            );
            list[i] = original;
        }
        list.swap(0, 1);
        assert_ne!(
            baseline,
            hash(&Definition {
                t_permille: &list,
                ..base
            }),
            "t_permille order"
        );
        assert_ne!(
            baseline,
            hash(&Definition {
                t_permille: &base.t_permille[..base.t_permille.len() - 1],
                ..base
            }),
            "t_permille length"
        );
    }
    {
        let mut list = base.across.to_vec();
        for i in 0..list.len() {
            let original = list[i];
            list[i] = original + 1;
            assert_ne!(
                baseline,
                hash(&Definition {
                    across: &list,
                    ..base
                }),
                "across element"
            );
            list[i] = original;
        }
        list.swap(0, 1);
        assert_ne!(
            baseline,
            hash(&Definition {
                across: &list,
                ..base
            }),
            "across order"
        );
        assert_ne!(
            baseline,
            hash(&Definition {
                across: &base.across[..base.across.len() - 1],
                ..base
            }),
            "across length"
        );
    }
    assert_ne!(
        baseline,
        hash(&Definition {
            accept_permille: base.accept_permille + 1,
            ..base
        }),
        "accept_permille"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            member_gap4: base.member_gap4 + 1,
            ..base
        }),
        "member_gap4"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            clip_max: base.clip_max + 1,
            ..base
        }),
        "clip_max"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            bog_min_piece: base.bog_min_piece + 1,
            ..base
        }),
        "bog_min_piece"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            bog_camp_gap: base.bog_camp_gap + 1.0,
            ..base
        }),
        "bog_camp_gap"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            burrow_road_near2: base.burrow_road_near2 + 1.0,
            ..base
        }),
        "burrow_road_near2"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            route_tries: base.route_tries + 1,
            ..base
        }),
        "route_tries"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            radius_length: base.radius_length + 1.0,
            ..base
        }),
        "radius_length"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            radius_shrink: base.radius_shrink + 1,
            ..base
        }),
        "radius_shrink"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            jitter_cell: base.jitter_cell + 1.0,
            ..base
        }),
        "jitter_cell"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            jitter_salt: base.jitter_salt + 1.0,
            ..base
        }),
        "jitter_salt"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            jitter_scale: base.jitter_scale + 1.0,
            ..base
        }),
        "jitter_scale"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            jitter_divisor: base.jitter_divisor + 1.0,
            ..base
        }),
        "jitter_divisor"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            wet_cell: base.wet_cell + 1.0,
            ..base
        }),
        "wet_cell"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            wet_salt: base.wet_salt + 1.0,
            ..base
        }),
        "wet_salt"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            wet_threshold: base.wet_threshold + 1.0,
            ..base
        }),
        "wet_threshold"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            camp_window: base.camp_window + 1,
            ..base
        }),
        "camp_window"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            crescent_inner20: base.crescent_inner20 + 1,
            ..base
        }),
        "crescent_inner20"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            crescent_outer20: base.crescent_outer20 + 1,
            ..base
        }),
        "crescent_outer20"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            crescent_along4: base.crescent_along4 + 1,
            ..base
        }),
        "crescent_along4"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            slot_width_squared: base.slot_width_squared + 1.0,
            ..base
        }),
        "slot_width_squared"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            score_across: base.score_across + 1,
            ..base
        }),
        "score_across"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            score_along_divisor: base.score_along_divisor + 1,
            ..base
        }),
        "score_along_divisor"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            variants: base.variants + 1,
            ..base
        }),
        "variants"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            wall_variant_salt: base.wall_variant_salt + 1.0,
            ..base
        }),
        "wall_variant_salt"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            wall_salt: base.wall_salt + 1.0,
            ..base
        }),
        "wall_salt"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            fungus_chance: base.fungus_chance + 0.01,
            ..base
        }),
        "fungus_chance"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            drip_chance: base.drip_chance + 0.01,
            ..base
        }),
        "drip_chance"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            reed_salt: base.reed_salt + 1.0,
            ..base
        }),
        "reed_salt"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            reed_chance: base.reed_chance + 0.01,
            ..base
        }),
        "reed_chance"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            reed_variant_salt: base.reed_variant_salt + 1.0,
            ..base
        }),
        "reed_variant_salt"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            rubble_salt: base.rubble_salt + 1.0,
            ..base
        }),
        "rubble_salt"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            rubble_chance: base.rubble_chance + 0.01,
            ..base
        }),
        "rubble_chance"
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            rubble_variant_salt: base.rubble_variant_salt + 1.0,
            ..base
        }),
        "rubble_variant_salt"
    );
}

/// Produce one independent numeric change at every nested serialized policy leaf.
fn numeric_policy_mutations(value: &serde_json::Value) -> Vec<(String, serde_json::Value)> {
    use serde_json::{Number, Value};
    match value {
        Value::Number(n) => {
            let changed = if n.is_i64() {
                Number::from(n.as_i64().unwrap() + 1)
            } else if n.is_u64() {
                Number::from(n.as_u64().unwrap() + 1)
            } else {
                let v = n.as_f64().unwrap();
                Number::from_f64(if v == 1.0 { 0.99 } else { v + 0.01 }).unwrap()
            };
            vec![(String::new(), Value::Number(changed))]
        }
        Value::Object(fields) => fields
            .iter()
            .flat_map(|(key, child)| {
                numeric_policy_mutations(child)
                    .into_iter()
                    .map(|(path, changed)| {
                        let mut full = value.clone();
                        full[key] = changed;
                        (format!(".{key}{path}"), full)
                    })
                    .collect::<Vec<_>>()
            })
            .collect(),
        Value::Array(items) => items
            .iter()
            .enumerate()
            .flat_map(|(index, child)| {
                numeric_policy_mutations(child)
                    .into_iter()
                    .map(|(path, changed)| {
                        let mut full = value.clone();
                        full[index] = changed;
                        (format!("[{index}]{path}"), full)
                    })
                    .collect::<Vec<_>>()
            })
            .collect(),
        _ => vec![],
    }
}
#[test]
fn scorch_nested_policies_move_aggregate_identity() {
    use rh_sim::content::content_hash_of_style_scorch_definition;
    use rh_sim::mapgen::style_scorch::{default_definition, Definition};
    let base = default_definition();
    let hash =
        |d: &Definition| content_hash_of_style_scorch_definition(REGISTRY, STAGGER_WEAPONS, d);
    let baseline = hash(&base);
    assert_eq!(baseline, content_hash());
    let mutations = numeric_policy_mutations(&serde_json::to_value(base).unwrap());
    assert!(
        mutations.len() > 80,
        "empty or incomplete nested policy inventory"
    );
    for (path, value) in mutations {
        let changed: Definition = serde_json::from_value(value).unwrap();
        assert_ne!(baseline, hash(&changed), "policy {path}");
    }
}

#[test]
fn rime_scalar_and_radius_policies_move_aggregate_identity() {
    use rh_sim::mapgen::style_rime::{default_definition, Definition};
    let base = default_definition();
    let hash = |d: &Definition| {
        rh_sim::content::content_hash_of_style_rime_definition(REGISTRY, STAGGER_WEAPONS, d)
    };
    let baseline = hash(&base);
    assert_eq!(baseline, content_hash());
    let mutations = numeric_policy_mutations(&serde_json::to_value(base).unwrap());
    assert_eq!(
        mutations.len(),
        59,
        "every scalar and all three spire radii"
    );
    for (path, value) in mutations {
        let changed: Definition = serde_json::from_value(value).unwrap();
        assert_ne!(baseline, hash(&changed), "unhashed Rime policy {path}");
    }
}

#[test]
fn gallows_definitions_and_resolved_dials_move_aggregate_identity() {
    use rh_sim::mapgen::style_gallows::{
        default_definition, default_dials, Definition, Dials, Route,
    };
    let base = default_definition();
    let dials = default_dials();
    let hash = |d: &Definition<'_>, dial: &Dials| {
        rh_sim::content::content_hash_of_style_gallows_definition(
            REGISTRY,
            STAGGER_WEAPONS,
            d,
            dial,
        )
    };
    let baseline = hash(&base, &dials);
    assert_eq!(baseline, content_hash());
    let Definition {
        open_run_min: _,
        value_bias: _,
        wiggle: _,
        blocked_cost: _,
        deviation_cost: _,
        jog_cost: _,
        square_window: _,
        offsets_s: _,
        offsets_t: _,
        square_tries: _,
        min_piece: _,
        square_blocked_cost: _,
        route_checks: _,
        relax_rounds: _,
        plan_rounds: _,
        detour_reach: _,
        detour_pair_reach: _,
        repair_radius_max: _,
        variant_salt: _,
        variants: _,
        lantern_salt: _,
        lantern_chance: _,
        side_salt: _,
        side_threshold: _,
        chain_salt: _,
        chain_chance: _,
        banner_salt: _,
        banner_chance: _,
        banner_limit: _,
    } = base;
    assert_ne!(
        baseline,
        hash(
            &Definition {
                open_run_min: base.open_run_min + 1,
                ..base
            },
            &dials
        ),
        "open_run_min"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                value_bias: base.value_bias + 1,
                ..base
            },
            &dials
        ),
        "value_bias"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                wiggle: base.wiggle + 1,
                ..base
            },
            &dials
        ),
        "wiggle"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                blocked_cost: base.blocked_cost + 1,
                ..base
            },
            &dials
        ),
        "blocked_cost"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                deviation_cost: base.deviation_cost + 1,
                ..base
            },
            &dials
        ),
        "deviation_cost"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                jog_cost: base.jog_cost + 0.01,
                ..base
            },
            &dials
        ),
        "jog_cost"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                square_window: base.square_window + 1,
                ..base
            },
            &dials
        ),
        "square_window"
    );
    {
        let mut list = base.offsets_s.to_vec();
        for i in 0..list.len() {
            let old = list[i];
            list[i] += 1;
            assert_ne!(
                baseline,
                hash(
                    &Definition {
                        offsets_s: &list,
                        ..base
                    },
                    &dials
                ),
                "offsets_s element"
            );
            list[i] = old;
        }
        list.swap(0, 1);
        assert_ne!(
            baseline,
            hash(
                &Definition {
                    offsets_s: &list,
                    ..base
                },
                &dials
            ),
            "offsets_s order"
        );
        assert_ne!(
            baseline,
            hash(
                &Definition {
                    offsets_s: &base.offsets_s[..base.offsets_s.len() - 1],
                    ..base
                },
                &dials
            ),
            "offsets_s length"
        );
    }
    {
        let mut list = base.offsets_t.to_vec();
        for i in 0..list.len() {
            let old = list[i];
            list[i] += 1;
            assert_ne!(
                baseline,
                hash(
                    &Definition {
                        offsets_t: &list,
                        ..base
                    },
                    &dials
                ),
                "offsets_t element"
            );
            list[i] = old;
        }
        list.swap(0, 1);
        assert_ne!(
            baseline,
            hash(
                &Definition {
                    offsets_t: &list,
                    ..base
                },
                &dials
            ),
            "offsets_t order"
        );
        assert_ne!(
            baseline,
            hash(
                &Definition {
                    offsets_t: &base.offsets_t[..base.offsets_t.len() - 1],
                    ..base
                },
                &dials
            ),
            "offsets_t length"
        );
    }
    assert_ne!(
        baseline,
        hash(
            &Definition {
                square_tries: base.square_tries + 1,
                ..base
            },
            &dials
        ),
        "square_tries"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                min_piece: base.min_piece + 1,
                ..base
            },
            &dials
        ),
        "min_piece"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                square_blocked_cost: base.square_blocked_cost + 0.01,
                ..base
            },
            &dials
        ),
        "square_blocked_cost"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                route_checks: base.route_checks + 1,
                ..base
            },
            &dials
        ),
        "route_checks"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                relax_rounds: base.relax_rounds + 1,
                ..base
            },
            &dials
        ),
        "relax_rounds"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                plan_rounds: base.plan_rounds + 1,
                ..base
            },
            &dials
        ),
        "plan_rounds"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                detour_reach: base.detour_reach + 1,
                ..base
            },
            &dials
        ),
        "detour_reach"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                detour_pair_reach: base.detour_pair_reach + 1,
                ..base
            },
            &dials
        ),
        "detour_pair_reach"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                repair_radius_max: base.repair_radius_max + 1,
                ..base
            },
            &dials
        ),
        "repair_radius_max"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                variant_salt: base.variant_salt + 0.01,
                ..base
            },
            &dials
        ),
        "variant_salt"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                variants: base.variants + 1,
                ..base
            },
            &dials
        ),
        "variants"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                lantern_salt: base.lantern_salt + 0.01,
                ..base
            },
            &dials
        ),
        "lantern_salt"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                lantern_chance: base.lantern_chance + 0.01,
                ..base
            },
            &dials
        ),
        "lantern_chance"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                side_salt: base.side_salt + 0.01,
                ..base
            },
            &dials
        ),
        "side_salt"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                side_threshold: base.side_threshold + 0.01,
                ..base
            },
            &dials
        ),
        "side_threshold"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                chain_salt: base.chain_salt + 0.01,
                ..base
            },
            &dials
        ),
        "chain_salt"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                chain_chance: base.chain_chance + 0.01,
                ..base
            },
            &dials
        ),
        "chain_chance"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                banner_salt: base.banner_salt + 0.01,
                ..base
            },
            &dials
        ),
        "banner_salt"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                banner_chance: base.banner_chance + 0.01,
                ..base
            },
            &dials
        ),
        "banner_chance"
    );
    assert_ne!(
        baseline,
        hash(
            &Definition {
                banner_limit: base.banner_limit + 1,
                ..base
            },
            &dials
        ),
        "banner_limit"
    );
    let mutations = numeric_policy_mutations(&serde_json::to_value(&dials).unwrap());
    assert_eq!(
        mutations.len(),
        10,
        "all eight numeric scalar dials plus both phases"
    );
    for (path, value) in mutations {
        let changed: Dials = serde_json::from_value(value).unwrap();
        assert_ne!(
            baseline,
            hash(&base, &changed),
            "unhashed resolved Gallows dial {path}"
        );
    }
    let mut changed = dials.clone();
    changed.phases.swap(0, 1);
    assert_ne!(baseline, hash(&base, &changed), "resolved phase order");
    changed.phases.pop();
    assert_ne!(baseline, hash(&base, &changed), "resolved phase length");
    for route in [Route::Open, Route::None] {
        let mut changed = dials.clone();
        changed.route = route;
        assert_ne!(baseline, hash(&base, &changed), "resolved route policy");
    }
}

#[test]
fn each_style_registry_entry_and_phase_flag_moves_aggregate_identity() {
    use rh_sim::mapdata::Zone;
    use rh_sim::mapgen::style_zones::ENTRIES;
    let hash = |entries: &[rh_sim::mapgen::style_zones::Entry]| {
        rh_sim::content::content_hash_of_style_registry_entries(REGISTRY, STAGGER_WEAPONS, entries)
    };
    let baseline = hash(&ENTRIES);
    assert_eq!(baseline, content_hash());
    for i in 0..ENTRIES.len() {
        let mut changed = ENTRIES;
        changed[i].faction = if changed[i].faction == Zone::Fire {
            Zone::Holy
        } else {
            Zone::Fire
        };
        assert_ne!(baseline, hash(&changed), "entry faction {i}");
        let mut changed = ENTRIES;
        changed[i].id = "distinct-styler";
        assert_ne!(baseline, hash(&changed), "entry id {i}");
        let mut changed = ENTRIES;
        changed[i].version += 1;
        assert_ne!(baseline, hash(&changed), "entry version {i}");
        let mut changed = ENTRIES;
        changed[i].surface = !changed[i].surface;
        assert_ne!(baseline, hash(&changed), "entry surface {i}");
        let mut changed = ENTRIES;
        changed[i].props = !changed[i].props;
        assert_ne!(baseline, hash(&changed), "entry props {i}");
    }
    let mut reordered = ENTRIES;
    reordered.swap(0, 1);
    assert_ne!(baseline, hash(&reordered), "registry order");
    assert_ne!(baseline, hash(&ENTRIES[..4]), "registry length");
}
