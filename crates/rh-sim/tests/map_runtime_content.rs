use rh_sim::content::{
    content_hash, content_hash_of_certify_definition, content_hash_of_style_runtime_definition,
    REGISTRY, STAGGER_WEAPONS,
};
use rh_sim::mapgen::{certify::rules as certify, style_runtime as style};

#[test]
fn plain_orchestration_limits_move_aggregate_identity() {
    use rh_sim::content::content_hash_of_pipeline_definition;
    use rh_sim::mapgen::pipeline::{Definition, DEFAULT_DEFINITION};
    let base = DEFAULT_DEFINITION;
    let hash = |d: &Definition| content_hash_of_pipeline_definition(REGISTRY, STAGGER_WEAPONS, d);
    let baseline = hash(&base);
    assert_eq!(baseline, content_hash());
    let Definition {
        certified_attempts: _,
        generate_attempts: _,
        features_max: _,
    } = base;
    assert_ne!(
        baseline,
        hash(&Definition {
            certified_attempts: base.certified_attempts + 1,
            ..base
        })
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            generate_attempts: base.generate_attempts + 1,
            ..base
        })
    );
    assert_ne!(
        baseline,
        hash(&Definition {
            features_max: base.features_max + 1,
            ..base
        })
    );
}

#[test]
fn each_independent_certifier_threshold_moves_aggregate_identity() {
    let base = certify::R;
    let hash =
        |d: &certify::Definition| content_hash_of_certify_definition(REGISTRY, STAGGER_WEAPONS, d);
    let baseline = hash(&base);
    assert_eq!(baseline, content_hash());
    let certify::Definition {
        size: _,
        tile: _,
        auto_strict: _,
        eps: _,
        gates: _,
        gate_width: _,
        gate_lane: _,
        players: _,
        area_spread: _,
        floor_share: _,
        ring: _,
        ring_contact: _,
        slivers: _,
        camps: _,
        elites: _,
        elite_sep: _,
        camp_gap: _,
        clearing: _,
        territory_radius: _,
        radius_eps: _,
        spots_min: _,
        spots_max: _,
        pool_min: _,
        pool_max: _,
        pool_zones: _,
        spawn_sep: _,
        spawn_camp: _,
        spawn_safe: _,
        walk_ratio: _,
        walk_hazards: _,
        crates_min: _,
        crates_max: _,
        ground_min: _,
        ground_max: _,
        features: _,
        piece_min: _,
        landmark_floor: _,
        landmark_gap: _,
        camp_span: _,
        halo: _,
        protection_span: _,
        clearing_cover_span: _,
        spawn_pad: _,
        spawn_hazard: _,
        crate_pad: _,
        ground_hazard: _,
        crate_spawn_gap: _,
        crate_spot_gap: _,
        crate_camp_gap: _,
        crate_pair_gap: _,
        ground_spawn_gap: _,
        ground_crate_gap: _,
        border_margin: _,
        landmark_margin: _,
        jobs_max: _,
        square_side: _,
        direction_count: _,
        hall_pitch: _,
        rotation_count: _,
        ice: _,
        fence_kind: _,
        max_metadata: _,
        max_strict_codes: _,
        max_camp_radius_tiles: _,
        fence_reach: _,
        fence_detour: _,
        fence_run: _,
        fence_search: _,
        snap: _,
    } = base;
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            size: base.size + 1,
            ..base
        }),
        "size"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            tile: base.tile + 1.0,
            ..base
        }),
        "tile"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            auto_strict: base.auto_strict + 1,
            ..base
        }),
        "auto_strict"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            eps: base.eps + 1.0,
            ..base
        }),
        "eps"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            gates: base.gates + 1,
            ..base
        }),
        "gates"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            gate_width: base.gate_width + 1,
            ..base
        }),
        "gate_width"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            gate_lane: base.gate_lane + 1,
            ..base
        }),
        "gate_lane"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            players: base.players + 1,
            ..base
        }),
        "players"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            area_spread: base.area_spread + 1,
            ..base
        }),
        "area_spread"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            floor_share: base.floor_share + 1.0,
            ..base
        }),
        "floor_share"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            ring: base.ring + 1,
            ..base
        }),
        "ring"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            ring_contact: base.ring_contact + 1,
            ..base
        }),
        "ring_contact"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            slivers: base.slivers + 1,
            ..base
        }),
        "slivers"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            camps: base.camps + 1,
            ..base
        }),
        "camps"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            elites: base.elites + 1,
            ..base
        }),
        "elites"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            elite_sep: base.elite_sep + 1.0,
            ..base
        }),
        "elite_sep"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            camp_gap: base.camp_gap + 1.0,
            ..base
        }),
        "camp_gap"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            clearing: base.clearing + 1.0,
            ..base
        }),
        "clearing"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            territory_radius: base.territory_radius + 1.0,
            ..base
        }),
        "territory_radius"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            radius_eps: base.radius_eps + 1.0,
            ..base
        }),
        "radius_eps"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            spots_min: base.spots_min + 1,
            ..base
        }),
        "spots_min"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            spots_max: base.spots_max + 1,
            ..base
        }),
        "spots_max"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            pool_min: base.pool_min + 1,
            ..base
        }),
        "pool_min"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            pool_max: base.pool_max + 1,
            ..base
        }),
        "pool_max"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            pool_zones: base.pool_zones + 1,
            ..base
        }),
        "pool_zones"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            spawn_sep: base.spawn_sep + 1.0,
            ..base
        }),
        "spawn_sep"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            spawn_camp: base.spawn_camp + 1.0,
            ..base
        }),
        "spawn_camp"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            spawn_safe: base.spawn_safe + 1.0,
            ..base
        }),
        "spawn_safe"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            walk_ratio: base.walk_ratio + 1.0,
            ..base
        }),
        "walk_ratio"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            walk_hazards: base.walk_hazards + 1,
            ..base
        }),
        "walk_hazards"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            crates_min: base.crates_min + 1,
            ..base
        }),
        "crates_min"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            crates_max: base.crates_max + 1,
            ..base
        }),
        "crates_max"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            ground_min: base.ground_min + 1,
            ..base
        }),
        "ground_min"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            ground_max: base.ground_max + 1,
            ..base
        }),
        "ground_max"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            features: base.features + 1,
            ..base
        }),
        "features"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            piece_min: base.piece_min + 1,
            ..base
        }),
        "piece_min"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            landmark_floor: base.landmark_floor + 1.0,
            ..base
        }),
        "landmark_floor"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            landmark_gap: base.landmark_gap + 1,
            ..base
        }),
        "landmark_gap"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            camp_span: base.camp_span + 1,
            ..base
        }),
        "camp_span"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            halo: base.halo + 1,
            ..base
        }),
        "halo"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            protection_span: base.protection_span + 1,
            ..base
        }),
        "protection_span"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            clearing_cover_span: base.clearing_cover_span + 1,
            ..base
        }),
        "clearing_cover_span"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            spawn_pad: base.spawn_pad + 1,
            ..base
        }),
        "spawn_pad"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            spawn_hazard: base.spawn_hazard + 1,
            ..base
        }),
        "spawn_hazard"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            crate_pad: base.crate_pad + 1,
            ..base
        }),
        "crate_pad"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            ground_hazard: base.ground_hazard + 1,
            ..base
        }),
        "ground_hazard"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            crate_spawn_gap: base.crate_spawn_gap + 1,
            ..base
        }),
        "crate_spawn_gap"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            crate_spot_gap: base.crate_spot_gap + 1,
            ..base
        }),
        "crate_spot_gap"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            crate_camp_gap: base.crate_camp_gap + 1,
            ..base
        }),
        "crate_camp_gap"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            crate_pair_gap: base.crate_pair_gap + 1,
            ..base
        }),
        "crate_pair_gap"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            ground_spawn_gap: base.ground_spawn_gap + 1.0,
            ..base
        }),
        "ground_spawn_gap"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            ground_crate_gap: base.ground_crate_gap + 1,
            ..base
        }),
        "ground_crate_gap"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            border_margin: base.border_margin + 1,
            ..base
        }),
        "border_margin"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            landmark_margin: base.landmark_margin + 1,
            ..base
        }),
        "landmark_margin"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            jobs_max: base.jobs_max + 1,
            ..base
        }),
        "jobs_max"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            square_side: base.square_side + 1,
            ..base
        }),
        "square_side"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            direction_count: base.direction_count + 1,
            ..base
        }),
        "direction_count"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            hall_pitch: base.hall_pitch + 1,
            ..base
        }),
        "hall_pitch"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            rotation_count: base.rotation_count + 1,
            ..base
        }),
        "rotation_count"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            ice: base.ice + 1,
            ..base
        }),
        "ice"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            fence_kind: base.fence_kind + 1,
            ..base
        }),
        "fence_kind"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            max_metadata: base.max_metadata + 1,
            ..base
        }),
        "max_metadata"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            max_strict_codes: base.max_strict_codes + 1,
            ..base
        }),
        "max_strict_codes"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            max_camp_radius_tiles: base.max_camp_radius_tiles + 1.0,
            ..base
        }),
        "max_camp_radius_tiles"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            fence_reach: base.fence_reach + 1,
            ..base
        }),
        "fence_reach"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            fence_detour: base.fence_detour + 1,
            ..base
        }),
        "fence_detour"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            fence_run: base.fence_run + 1,
            ..base
        }),
        "fence_run"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            fence_search: base.fence_search + 1,
            ..base
        }),
        "fence_search"
    );
    assert_ne!(
        baseline,
        hash(&certify::Definition {
            snap: base.snap + 1,
            ..base
        }),
        "snap"
    );
}

#[test]
fn each_style_runtime_policy_moves_aggregate_identity() {
    let base = style::DEFAULT_DEFINITION;
    let hash = |d: &style::Definition| {
        content_hash_of_style_runtime_definition(REGISTRY, STAGGER_WEAPONS, d)
    };
    let baseline = hash(&base);
    assert_eq!(baseline, content_hash());
    let style::Definition {
        join_checks: _,
        footprint_percent: _,
        rim_tiles: _,
        fence_detour: _,
        wall_cost: _,
        low_cost: _,
        prop_percent: _,
        min_piece: _,
        min_share_permille: _,
        min_groups: _,
        shape_stream: _,
        decor_stream: _,
        surface_stream: _,
        noise_stream_offset: _,
        route_cut_off: _,
        route_stretch_max: _,
    } = base;
    assert_ne!(
        baseline,
        hash(&style::Definition {
            join_checks: base.join_checks + 1,
            ..base
        }),
        "join_checks"
    );
    assert_ne!(
        baseline,
        hash(&style::Definition {
            footprint_percent: base.footprint_percent + 1.0,
            ..base
        }),
        "footprint_percent"
    );
    assert_ne!(
        baseline,
        hash(&style::Definition {
            rim_tiles: base.rim_tiles + 1.0,
            ..base
        }),
        "rim_tiles"
    );
    assert_ne!(
        baseline,
        hash(&style::Definition {
            fence_detour: base.fence_detour + 1,
            ..base
        }),
        "fence_detour"
    );
    assert_ne!(
        baseline,
        hash(&style::Definition {
            wall_cost: base.wall_cost + 1,
            ..base
        }),
        "wall_cost"
    );
    assert_ne!(
        baseline,
        hash(&style::Definition {
            low_cost: base.low_cost + 1,
            ..base
        }),
        "low_cost"
    );
    assert_ne!(
        baseline,
        hash(&style::Definition {
            prop_percent: base.prop_percent + 1,
            ..base
        }),
        "prop_percent"
    );
    assert_ne!(
        baseline,
        hash(&style::Definition {
            min_piece: base.min_piece + 1,
            ..base
        }),
        "min_piece"
    );
    assert_ne!(
        baseline,
        hash(&style::Definition {
            min_share_permille: base.min_share_permille + 1,
            ..base
        }),
        "min_share_permille"
    );
    assert_ne!(
        baseline,
        hash(&style::Definition {
            min_groups: base.min_groups + 1,
            ..base
        }),
        "min_groups"
    );
    assert_ne!(
        baseline,
        hash(&style::Definition {
            shape_stream: base.shape_stream + 1,
            ..base
        }),
        "shape_stream"
    );
    assert_ne!(
        baseline,
        hash(&style::Definition {
            decor_stream: base.decor_stream + 1,
            ..base
        }),
        "decor_stream"
    );
    assert_ne!(
        baseline,
        hash(&style::Definition {
            surface_stream: base.surface_stream + 1,
            ..base
        }),
        "surface_stream"
    );
    assert_ne!(
        baseline,
        hash(&style::Definition {
            noise_stream_offset: base.noise_stream_offset + 1,
            ..base
        }),
        "noise_stream_offset"
    );
    assert_ne!(
        baseline,
        hash(&style::Definition {
            route_cut_off: base.route_cut_off + 1,
            ..base
        }),
        "route_cut_off"
    );
    assert_ne!(
        baseline,
        hash(&style::Definition {
            route_stretch_max: base.route_stretch_max + 1,
            ..base
        }),
        "route_stretch_max"
    );
}
