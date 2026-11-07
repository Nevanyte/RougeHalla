//! Lazy player card memory. P-CARDS extends this owner; casts never keep a second spend timestamp.
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Runtime {
    pub wish_cast: Option<WishSpend>,
}
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WishSpend {
    pub at: f64,
    pub cooldown_ms: f64,
}
pub(crate) fn reset_all(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    if *args == crate::hooks::HookArgs::RaidStarted {
        for p in &mut hx.w.players {
            p.card_runtime = None;
            p.card_streak = None;
            p.card_trims.clear();
            p.card_hots.clear();
            p.card_fired.clear();
            p.card_prevented = 0.;
            p.card_tank_hp = 0.;
            p.card_boost = crate::cards::Boost::default();
        }
    }
}
