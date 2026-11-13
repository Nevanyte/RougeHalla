//! Lazy player card memory. P-CARDS extends this owner; casts never keep a second spend timestamp.
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Runtime {
    #[serde(deserialize_with = "required_option")]
    pub wish_cast: Option<WishSpend>,
    #[serde(deserialize_with = "required_option")]
    pub fight: Option<FightClock>,
}
fn required_option<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    <Option<T> as serde::Deserialize>::deserialize(d)
}
/// Source mods' watched fight clock, independent of cardHooks' run/streak/Wish memory.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FightClock {
    pub start: f64,
    pub last: f64,
}
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WishSpend {
    pub at: f64,
    pub cooldown_ms: f64,
}
/// Resets cardHooks memory. Source mods owns its fight clock separately; a clear's no-row refold removes it.
pub(crate) fn reset_player(p: &mut crate::state::Player) {
    p.card_runtime = p.card_runtime.and_then(|r| {
        r.fight.map(|fight| Runtime {
            fight: Some(fight),
            ..Default::default()
        })
    });
    p.card_streak = None;
    p.card_trims.clear();
    p.card_hots.clear();
    p.card_fired.clear();
    p.card_prevented = 0.;
    p.card_tank_hp = 0.;
    p.card_boost = crate::cards::Boost::default();
    p.card_crit_acc = 0.;
    // Legacy `rt.cards = undefined` also drops the damage-over-time crit memory (critAccDot, dotRollTick, dotCrit;
    // cardState.ts:22-27).
    p.core.card_dot_crit = None;
    p.card_still_x = 0.;
    p.card_still_y = 0.;
    p.card_still_since = 0.;
}

pub(crate) fn reset_all(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    if *args == crate::hooks::HookArgs::RaidStarted {
        // Source cardHooks.resetAll also deletes the world's bleed report (GateAlways in the released core
        // profile; the legacy signature Reset is a different gate). It clears only the Card domain and records
        // the CardReset marker; teleport does not touch the report.
        crate::systems::card_bleed_feedback::reset(hx);
        for p in &mut hx.w.players {
            reset_player(p);
        }
    }
}
