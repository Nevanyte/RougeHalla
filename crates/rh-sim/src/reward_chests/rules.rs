//! Source reward option odds, range, expiry and skip policy. Boost math stays in stat_fold.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Definition {
    pub tier_weights: [[f64; 3]; 2],
    pub range: f64,
    pub lifetime_ms: f64,
    pub skip_heal_share: f64,
    pub birth_hold_ticks: u32,
    pub skip_gv: u32,
    pub mob_gv_cap: u32,
    pub themed_first: [Option<crate::cards::CardId>; 5],
}
pub const DEFINITION: Definition = Definition {
    tier_weights: [[50., 45., 5.], [10., 60., 30.]],
    range: 96.,
    lifetime_ms: 15000.,
    skip_heal_share: 0.15,
    birth_hold_ticks: 1,
    skip_gv: 3,
    mob_gv_cap: 90,
    themed_first: [
        Some(crate::cards::CardId::SlowBurn),
        None,
        Some(crate::cards::CardId::Siphon),
        Some(crate::cards::CardId::PocketSand),
        Some(crate::cards::CardId::Siphon),
    ],
};
pub fn visit_content(d: &Definition, mut word: impl FnMut(u64)) {
    for row in d.tier_weights {
        for v in row {
            word(v.to_bits())
        }
    }
    for v in [d.range, d.lifetime_ms, d.skip_heal_share] {
        word(v.to_bits())
    }
    word(u64::from(d.birth_hold_ticks));
    word(u64::from(d.skip_gv));
    word(u64::from(d.mob_gv_cap));
    for id in d.themed_first {
        word(id.map_or(0, |id| id.index() as u64 + 1));
    }
}
