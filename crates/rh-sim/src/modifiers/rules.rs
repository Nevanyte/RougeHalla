//! Previously-unwired source scaling policy. The accepted fold definition remains its sole owner.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Definition {
    /// Weapon order: sword,bow,wand,shield,axe,fists. Columns: AD,AP,bonusHP,bonusDefense,dominant.
    pub weapon_scaling: [[f64; 5]; 6],
    pub ap_hit_window_ms: f64,
    pub ap_dot_ratio: f64,
    pub fire_ad_ratio: f64,
    pub fire_defense_ratio: f64,
    pub plague_ap_per_hit: f64,
    pub frost_sd: f64,
    pub frost_as: f64,
    pub frost_cap: f64,
    pub mark_bonus: f64,
    pub mark_ap_weight: f64,
    pub mark_as_efficiency: f64,
}
pub const DEFINITION: Definition = Definition {
    weapon_scaling: [
        [1., 1., 0., 0., 1.],
        [1., 0., 0., 0., 0.],
        [0.3, 1., 0., 0., 0.],
        [0., 0.3, 0., 0.4, 0.],
        [1., 0., 0.02, 0., 0.],
        [0.6, 0.6, 0., 0., 0.],
    ],
    ap_hit_window_ms: 1000.,
    ap_dot_ratio: 0.6,
    fire_ad_ratio: 0.5,
    fire_defense_ratio: 0.0015,
    plague_ap_per_hit: 0.8,
    frost_sd: 0.007,
    frost_as: 0.45,
    frost_cap: 0.2,
    mark_bonus: 0.0035,
    mark_ap_weight: 1.,
    mark_as_efficiency: 1.,
};
pub fn visit_content(d: &Definition, mut word: impl FnMut(u64)) {
    for row in d.weapon_scaling {
        for v in row {
            word(v.to_bits());
        }
    }
    for v in [
        d.ap_hit_window_ms,
        d.ap_dot_ratio,
        d.fire_ad_ratio,
        d.fire_defense_ratio,
        d.plague_ap_per_hit,
        d.frost_sd,
        d.frost_as,
        d.frost_cap,
        d.mark_bonus,
        d.mark_ap_weight,
        d.mark_as_efficiency,
    ] {
        word(v.to_bits());
    }
}
