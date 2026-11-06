use crate::WeaponId;
/// Sole owner of initial loot/travel policy; the coordinator registers this actual visitor.
pub struct Definition {
    pub ground_chance: f64,
    pub chest_weights: [f64; 5],
    pub stat_crates: usize,
    pub cannon_search_tiles: i32,
    pub gamble_tag: u32,
    pub crate_tag: u32,
}
pub static DEFINITION: Definition = Definition {
    ground_chance: 0.25,
    chest_weights: [1.0; 5],
    stat_crates: 3,
    cannon_search_tiles: 4,
    gamble_tag: 0x4741_4d42,
    crate_tag: 0x4352_4154,
};
pub fn visit_content(mut word: impl FnMut(u64)) {
    word(DEFINITION.ground_chance.to_bits());
    word(DEFINITION.stat_crates as u64);
    word(DEFINITION.cannon_search_tiles as u64);
    word(u64::from(DEFINITION.gamble_tag));
    word(u64::from(DEFINITION.crate_tag));
    for (weapon, weight) in WeaponId::ALL[..5].iter().zip(DEFINITION.chest_weights) {
        word(u64::from(weapon.code()));
        word(weight.to_bits());
    }
}
