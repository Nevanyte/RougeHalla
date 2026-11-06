//! Borrowed modifier inputs. The card/stat owner supplies these; the status table never owns a second modifier store.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StatView {
    pub slow_resist: f64,
    pub buff_move: f64,
    pub dot_mult: f64,
    pub crit_chance: f64,
    pub dot_crit: bool,
    pub lifesteal_rows: f64,
    pub lifesteal_mult: f64,
    pub lifesteal_dot: f64,
    pub farm_lifesteal_rows: f64,
    pub heal_taken_mult: f64,
    pub mark_suppression: Option<f64>,
}
impl Default for StatView {
    fn default() -> Self {
        Self {
            slow_resist: 0.,
            buff_move: 1.,
            dot_mult: 1.,
            crit_chance: 0.,
            dot_crit: false,
            lifesteal_rows: 0.,
            lifesteal_mult: 1.,
            lifesteal_dot: 0.,
            farm_lifesteal_rows: 0.,
            heal_taken_mult: 1.,
            mark_suppression: None,
        }
    }
}
/// Current ordinary producer domain has no cards/buffs. P-CARDS replaces the provider, not status arithmetic.
pub(crate) fn view(_p: &crate::fighter::FighterCore) -> StatView {
    StatView::default()
}
/// Card-owned per-player mutable critical roll state. The source uses no PRNG draw.
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DotCritState {
    pub accumulator: f64,
    pub roll_tick: Option<u32>,
    pub critical: bool,
}
pub const CRIT_EPSILON: f64 = 1e-9;
pub const CRIT_MULT: f64 = 1.5;
pub const CRIT_CHANCE_MAX: f64 = 0.5;
pub fn roll_dot_crit(
    state: &mut Option<DotCritState>,
    tick: u32,
    is_player: bool,
    stats: StatView,
) -> bool {
    if !is_player || !stats.dot_crit || !(stats.crit_chance > 0.) {
        return false;
    }
    let c = state.get_or_insert_with(DotCritState::default);
    if c.roll_tick == Some(tick) {
        return c.critical;
    }
    let next = c.accumulator + stats.crit_chance;
    c.critical = next >= 1. - CRIT_EPSILON;
    c.accumulator = if c.critical { next - 1. } else { next };
    c.roll_tick = Some(tick);
    c.critical
}
/// Source critChanceOf boundary; roll_dot_crit itself consumes its already-capped answer.
pub fn crit_chance(sum: f64, no_crit: bool) -> f64 {
    if no_crit || !(sum > 0.) {
        0.
    } else {
        sum.min(CRIT_CHANCE_MAX)
    }
}

/// Borrowed reads from the sole modifier owner. Test overrides exist only with the explicit harness feature.
#[derive(Clone, Copy, Default)]
pub(crate) struct Inputs<'a> {
    #[cfg(feature = "trusted-status-probes")]
    overrides: Option<&'a [(crate::PlayerId, StatView)]>,
    marker: std::marker::PhantomData<&'a ()>,
}
impl Inputs<'_> {
    pub(crate) fn view(self, p: &crate::fighter::FighterCore) -> StatView {
        #[cfg(feature = "trusted-status-probes")]
        if let Some((_, v)) = self
            .overrides
            .and_then(|rows| rows.iter().find(|v| v.0 == p.id))
        {
            return *v;
        }
        view(p)
    }
}
#[cfg(feature = "trusted-status-probes")]
impl<'a> Inputs<'a> {
    pub(crate) fn supplied(rows: &'a [(crate::PlayerId, StatView)]) -> Self {
        Self {
            overrides: Some(rows),
            marker: std::marker::PhantomData,
        }
    }
}

/// shared/mods.ts lifestealTotal; rows are capped before multiplication and farm rows stay outside the total cap.
pub fn lifesteal_total(own: f64, rows: f64, mult: f64, on_dot: f64, farm_rows: f64) -> f64 {
    let from_rows = if rows > 0. {
        rows.min(crate::stat_fold::default_definition().lifesteal_cap) * mult.max(0.)
    } else {
        0.
    };
    LIFESTEAL_MAX
        .min(if own > 0. { own } else { 0. } + from_rows + if on_dot > 0. { on_dot } else { 0. })
        + farm_rows.max(0.) * mult.max(0.)
}
pub const LIFESTEAL_MAX: f64 = 0.85;
pub const HOLY_LEECH_ROW_MULT: f64 = 2.7;
