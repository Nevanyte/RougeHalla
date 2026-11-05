//! Warren-only dials. Shared scale, route limits, template and prop IDs have existing owners.
#[derive(Clone, Copy, Debug)]
pub struct Definition<'a> {
    pub barrows_per_ref: f64,
    pub tunnels_per_ref: f64,
    pub road_min2: f64,
    pub r4_min: i32,
    pub r4_max: i32,
    pub r4_tunnel: i32,
    pub pad_camp10: f64,
    pub pad_door10: f64,
    pub t_permille: &'a [i32],
    pub across: &'a [i32],
    pub accept_permille: i32,
    pub member_gap4: i32,
    pub clip_max: usize,
    pub bog_min_piece: usize,
    pub bog_camp_gap: f64,
    pub burrow_road_near2: f64,
    pub route_tries: usize,
    pub radius_length: f64,
    pub radius_shrink: i32,
    pub jitter_cell: f64,
    pub jitter_salt: f64,
    pub jitter_scale: f64,
    pub jitter_divisor: f64,
    pub wet_cell: f64,
    pub wet_salt: f64,
    pub wet_threshold: f64,
    pub camp_window: i32,
    pub crescent_inner20: i32,
    pub crescent_outer20: i32,
    pub crescent_along4: i32,
    pub slot_width_squared: f64,
    pub score_across: i32,
    pub score_along_divisor: i32,
    pub variants: u8,
    pub wall_variant_salt: f64,
    pub wall_salt: f64,
    pub fungus_chance: f64,
    pub drip_chance: f64,
    pub reed_salt: f64,
    pub reed_chance: f64,
    pub reed_variant_salt: f64,
    pub rubble_salt: f64,
    pub rubble_chance: f64,
    pub rubble_variant_salt: f64,
}
pub fn default_definition() -> Definition<'static> {
    Definition {
        barrows_per_ref: 6.0,
        tunnels_per_ref: 2.0,
        road_min2: 225.0,
        r4_min: 11,
        r4_max: 18,
        r4_tunnel: 14,
        pad_camp10: 52.0,
        pad_door10: 20.0,
        t_permille: &[500, 450, 550, 400, 600, 350, 650],
        across: &[0, 1, -1, 2, -2, 3, -3],
        accept_permille: 620,
        member_gap4: 8,
        clip_max: 3,
        bog_min_piece: 8,
        bog_camp_gap: 3.0,
        burrow_road_near2: 25.0,
        route_tries: 4,
        radius_length: 0.8,
        radius_shrink: 2,
        jitter_cell: 4.0,
        jitter_salt: 310.0,
        jitter_scale: 13.0,
        jitter_divisor: 2560.0,
        wet_cell: 1.0,
        wet_salt: 301.0,
        wet_threshold: 512.0,
        camp_window: 12,
        crescent_inner20: 16,
        crescent_outer20: 90,
        crescent_along4: 6,
        slot_width_squared: 36.0,
        score_across: 20,
        score_along_divisor: 5,
        variants: 3,
        wall_variant_salt: 90.0,
        wall_salt: 1.0,
        fungus_chance: 0.16,
        drip_chance: 0.26,
        reed_salt: 3.0,
        reed_chance: 0.3,
        reed_variant_salt: 91.0,
        rubble_salt: 4.0,
        rubble_chance: 0.18,
        rubble_variant_salt: 92.0,
    }
}
pub fn visit_content(d: &Definition<'_>, mut word: impl FnMut(u64)) {
    for v in [d.barrows_per_ref, d.tunnels_per_ref, d.road_min2] {
        word(v.to_bits())
    }
    for v in [d.r4_min, d.r4_max, d.r4_tunnel] {
        word(v as u64)
    }
    for v in [d.pad_camp10, d.pad_door10] {
        word(v.to_bits())
    }
    for list in [d.t_permille, d.across] {
        word(list.len() as u64);
        for &v in list {
            word(v as u64)
        }
    }
    for v in [
        d.accept_permille as u64,
        d.member_gap4 as u64,
        d.clip_max as u64,
        d.bog_min_piece as u64,
    ] {
        word(v)
    }
    for v in [d.bog_camp_gap, d.burrow_road_near2] {
        word(v.to_bits())
    }
    word(d.route_tries as u64);
    word(d.radius_length.to_bits());
    word(d.radius_shrink as u64);
    for v in [
        d.jitter_cell,
        d.jitter_salt,
        d.jitter_scale,
        d.jitter_divisor,
        d.wet_cell,
        d.wet_salt,
        d.wet_threshold,
    ] {
        word(v.to_bits())
    }
    for v in [
        d.camp_window,
        d.crescent_inner20,
        d.crescent_outer20,
        d.crescent_along4,
    ] {
        word(v as u64)
    }
    word(d.slot_width_squared.to_bits());
    word(d.score_across as u64);
    word(d.score_along_divisor as u64);
    word(d.variants.into());
    for v in [
        d.wall_variant_salt,
        d.wall_salt,
        d.fungus_chance,
        d.drip_chance,
        d.reed_salt,
        d.reed_chance,
        d.reed_variant_salt,
        d.rubble_salt,
        d.rubble_chance,
        d.rubble_variant_salt,
    ] {
        word(v.to_bits())
    }
}
