//! Stage-six-only policy. Shared clearance/seed thresholds and the watchtower belong to stage four.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Definition {
    pub lake_grow: usize,
    pub ice_want: usize,
    pub grow_max_percent: usize,
    pub salt_one: f64,
    pub salt_two: f64,
    pub lake_min: usize,
    pub lake_gap: i32,
    pub headlands: usize,
    pub head_tries: usize,
    pub head_look: usize,
    pub head_edge: i32,
    pub head_sep2: i32,
    pub spire_clearance: i32,
    pub spire_min_cells: usize,
    pub spire_tries: usize,
    pub spire_separation: i32,
    pub route_band: i32,
    pub route_near: i32,
    pub route_second: f64,
    pub gate_mouth_offset: f64,
    pub margin_spawn: i32,
    pub margin_corridor: i32,
    pub value_clearance: i32,
    pub value_noise: i32,
    pub value_centre: i32,
    pub noise_cell: f64,
    pub noise_octaves: u32,
    pub smooth_passes: usize,
    pub smooth_threshold: i32,
    pub smooth_window: i32,
    pub fill_share_min: usize,
    pub facet_diagonal_chance: f64,
    pub facet_axis_base: f64,
    pub facet_axis_range: f64,
    pub facet_diag_base: f64,
    pub facet_diag_range: f64,
    pub facet_reach: f64,
    pub head_radius_first: f64,
    pub head_radius_later: f64,
    pub head_outset: f64,
    pub causeway_min: usize,
    pub ring_extra: i32,
    pub variant_salt: f64,
    pub variant_count: u8,
    pub shelf_prop_salt: f64,
    pub spire_prop_chance: f64,
    pub icicle_chance: f64,
    pub drift_radius: i32,
    pub drift_salt: f64,
    pub drift_chance: f64,
    pub ice_prop_salt: f64,
    pub ice_prop_scale: f64,
    pub sparkle_bound: f64,
    pub crack_bound: f64,
    pub tower_prop_salt: f64,
    pub tower_chance: f64,
    pub spire_radii: [f64; 3],
}
pub fn default_definition() -> Definition {
    Definition {
        lake_grow: 400,
        ice_want: 820,
        grow_max_percent: 250,
        salt_one: 11.0,
        salt_two: 41.0,
        lake_min: 40,
        lake_gap: 2,
        headlands: 3,
        head_tries: 4,
        head_look: 48,
        head_edge: 18,
        head_sep2: 49,
        spire_clearance: 14,
        spire_min_cells: 8,
        spire_tries: 3,
        spire_separation: 4,
        route_band: 1,
        route_near: 5,
        route_second: 1080.0,
        gate_mouth_offset: 3.0,
        margin_spawn: 11,
        margin_corridor: 0,
        value_clearance: 1024,
        value_noise: 15,
        value_centre: 512,
        noise_cell: 9.0,
        noise_octaves: 3,
        smooth_passes: 2,
        smooth_threshold: 5,
        smooth_window: 2,
        fill_share_min: 300,
        facet_diagonal_chance: 0.75,
        facet_axis_base: 0.7,
        facet_axis_range: 0.6,
        facet_diag_base: 1.0,
        facet_diag_range: 0.7,
        facet_reach: 1.6,
        head_radius_first: 3.2,
        head_radius_later: 2.6,
        head_outset: 0.5,
        causeway_min: 3,
        ring_extra: 2,
        variant_salt: 90.0,
        variant_count: 3,
        shelf_prop_salt: 3.0,
        spire_prop_chance: 0.4,
        icicle_chance: 0.34,
        drift_radius: 5,
        drift_salt: 4.0,
        drift_chance: 0.07,
        ice_prop_salt: 1.0,
        ice_prop_scale: 12.0,
        sparkle_bound: 1.0,
        crack_bound: 2.0,
        tower_prop_salt: 5.0,
        tower_chance: 0.3,
        spire_radii: [1.6, 1.9, 2.2],
    }
}
pub fn visit_content(d: &Definition, mut word: impl FnMut(u64)) {
    // The same actual facet normals drive geometry and identity; do not shadow their topology.
    word(super::shape::NORMALS.len() as u64);
    for [x, y] in super::shape::NORMALS {
        word(x as u64);
        word(y as u64);
    }

    word(d.lake_grow as u64);
    word(d.ice_want as u64);
    word(d.grow_max_percent as u64);
    word(d.salt_one.to_bits());
    word(d.salt_two.to_bits());
    word(d.lake_min as u64);
    word(d.lake_gap as u64);
    word(d.headlands as u64);
    word(d.head_tries as u64);
    word(d.head_look as u64);
    word(d.head_edge as u64);
    word(d.head_sep2 as u64);
    word(d.spire_clearance as u64);
    word(d.spire_min_cells as u64);
    word(d.spire_tries as u64);
    word(d.spire_separation as u64);
    word(d.route_band as u64);
    word(d.route_near as u64);
    word(d.route_second.to_bits());
    word(d.gate_mouth_offset.to_bits());
    word(d.margin_spawn as u64);
    word(d.margin_corridor as u64);
    word(d.value_clearance as u64);
    word(d.value_noise as u64);
    word(d.value_centre as u64);
    word(d.noise_cell.to_bits());
    word(d.noise_octaves as u64);
    word(d.smooth_passes as u64);
    word(d.smooth_threshold as u64);
    word(d.smooth_window as u64);
    word(d.fill_share_min as u64);
    word(d.facet_diagonal_chance.to_bits());
    word(d.facet_axis_base.to_bits());
    word(d.facet_axis_range.to_bits());
    word(d.facet_diag_base.to_bits());
    word(d.facet_diag_range.to_bits());
    word(d.facet_reach.to_bits());
    word(d.head_radius_first.to_bits());
    word(d.head_radius_later.to_bits());
    word(d.head_outset.to_bits());
    word(d.causeway_min as u64);
    word(d.ring_extra as u64);
    word(d.variant_salt.to_bits());
    word(d.variant_count as u64);
    word(d.shelf_prop_salt.to_bits());
    word(d.spire_prop_chance.to_bits());
    word(d.icicle_chance.to_bits());
    word(d.drift_radius as u64);
    word(d.drift_salt.to_bits());
    word(d.drift_chance.to_bits());
    word(d.ice_prop_salt.to_bits());
    word(d.ice_prop_scale.to_bits());
    word(d.sparkle_bound.to_bits());
    word(d.crack_bound.to_bits());
    word(d.tower_prop_salt.to_bits());
    word(d.tower_chance.to_bits());
    for v in d.spire_radii {
        word(v.to_bits());
    }
}
impl Definition {
    pub(super) fn validate(&self) -> bool {
        let d = self;
        if !d.salt_one.is_finite() || d.salt_one.abs() > 1e6 {
            return false;
        }
        if !d.salt_two.is_finite() || d.salt_two.abs() > 1e6 {
            return false;
        }
        if !d.route_second.is_finite() || d.route_second.abs() > 1e6 {
            return false;
        }
        if !d.gate_mouth_offset.is_finite() || d.gate_mouth_offset.abs() > 1e6 {
            return false;
        }
        if !d.noise_cell.is_finite() || d.noise_cell.abs() > 1e6 {
            return false;
        }
        if !d.facet_diagonal_chance.is_finite() || d.facet_diagonal_chance.abs() > 1e6 {
            return false;
        }
        if !d.facet_axis_base.is_finite() || d.facet_axis_base.abs() > 1e6 {
            return false;
        }
        if !d.facet_axis_range.is_finite() || d.facet_axis_range.abs() > 1e6 {
            return false;
        }
        if !d.facet_diag_base.is_finite() || d.facet_diag_base.abs() > 1e6 {
            return false;
        }
        if !d.facet_diag_range.is_finite() || d.facet_diag_range.abs() > 1e6 {
            return false;
        }
        if !d.facet_reach.is_finite() || d.facet_reach.abs() > 1e6 {
            return false;
        }
        if !d.head_radius_first.is_finite() || d.head_radius_first.abs() > 1e6 {
            return false;
        }
        if !d.head_radius_later.is_finite() || d.head_radius_later.abs() > 1e6 {
            return false;
        }
        if !d.head_outset.is_finite() || d.head_outset.abs() > 1e6 {
            return false;
        }
        if !d.variant_salt.is_finite() || d.variant_salt.abs() > 1e6 {
            return false;
        }
        if !d.shelf_prop_salt.is_finite() || d.shelf_prop_salt.abs() > 1e6 {
            return false;
        }
        if !d.spire_prop_chance.is_finite() || d.spire_prop_chance.abs() > 1e6 {
            return false;
        }
        if !d.icicle_chance.is_finite() || d.icicle_chance.abs() > 1e6 {
            return false;
        }
        if !d.drift_salt.is_finite() || d.drift_salt.abs() > 1e6 {
            return false;
        }
        if !d.drift_chance.is_finite() || d.drift_chance.abs() > 1e6 {
            return false;
        }
        if !d.ice_prop_salt.is_finite() || d.ice_prop_salt.abs() > 1e6 {
            return false;
        }
        if !d.ice_prop_scale.is_finite() || d.ice_prop_scale.abs() > 1e6 {
            return false;
        }
        if !d.sparkle_bound.is_finite() || d.sparkle_bound.abs() > 1e6 {
            return false;
        }
        if !d.crack_bound.is_finite() || d.crack_bound.abs() > 1e6 {
            return false;
        }
        if !d.tower_prop_salt.is_finite() || d.tower_prop_salt.abs() > 1e6 {
            return false;
        }
        if !d.tower_chance.is_finite() || d.tower_chance.abs() > 1e6 {
            return false;
        }

        d.lake_grow > 0
            && d.lake_grow <= 20000
            && d.ice_want <= 40000
            && d.grow_max_percent <= 1000
            && d.lake_min > 0
            && d.lake_min <= 20000
            && (0..=16).contains(&d.lake_gap)
            && d.headlands <= 16
            && d.head_tries <= 256
            && d.head_look <= 1024
            && (0..=100000).contains(&d.head_edge)
            && (0..=1000000).contains(&d.head_sep2)
            && d.spire_tries <= 64
            && (0..=100).contains(&d.spire_separation)
            && d.spire_min_cells <= 1000
            && (0..=16).contains(&d.route_band)
            && (0..=64).contains(&d.route_near)
            && (-100000..=100000).contains(&d.margin_spawn)
            && (-100000..=100000).contains(&d.margin_corridor)
            && (0..=1024).contains(&d.value_clearance)
            && (0..=1000).contains(&d.value_noise)
            && (-1024..=1024).contains(&d.value_centre)
            && d.noise_cell > 0.0
            && d.noise_octaves > 0
            && d.noise_octaves <= 16
            && d.smooth_passes <= 16
            && (0..=16).contains(&d.smooth_window)
            && d.fill_share_min > 0
            && d.fill_share_min <= 1000
            && (0.0..=1.0).contains(&d.facet_diagonal_chance)
            && (0.0..=4.0).contains(&d.facet_axis_base)
            && (0.0..=4.0).contains(&d.facet_axis_range)
            && (0.0..=4.0).contains(&d.facet_diag_base)
            && (0.0..=4.0).contains(&d.facet_diag_range)
            && (0.0..=4.0).contains(&d.facet_reach)
            && (0.0..=12.0).contains(&d.head_radius_first)
            && (0.0..=12.0).contains(&d.head_radius_later)
            && (0.0..=2.0).contains(&d.head_outset)
            && d.causeway_min <= 20000
            && (0..=64).contains(&d.ring_extra)
            && d.variant_count > 0
            && (0..=32).contains(&d.drift_radius)
            && d.spire_radii
                .iter()
                .all(|r| r.is_finite() && (0.0..=12.0).contains(r))
    }
}
