//! Pure owner trade facts and visible noncombat merchant positions. No offer producer runs here.
use super::{Kind, Stat, StatTrade};
use crate::{PlayerId, Sim, Vec2};
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct MerchantView {
    pub kind: Kind,
    pub at: Vec2,
}
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TradeView {
    pub trade_used: bool,
    pub offers: Vec<StatTrade>,
    pub stats: Vec<(Stat, f64)>,
    pub barter_ready_at: Option<f64>,
    pub merchants: Vec<MerchantView>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ViewError {
    InvalidOwnerState,
}
pub(crate) fn project_into(
    sim: &Sim,
    viewer: PlayerId,
    out: &mut Option<TradeView>,
) -> Result<(), ViewError> {
    let Some(p) = sim
        .player(viewer)
        .filter(|_| super::runtime::enabled(&sim.k))
    else {
        *out = None;
        return Ok(());
    };
    let Some(rt) = &sim.w.traders else {
        *out = None;
        return Ok(());
    };
    // Select this owner before inspecting values. Foreign offers/deltas/deadlines never affect delivery.
    let ready_at = rt
        .barter_at
        .iter()
        .find(|(who, _)| *who == viewer)
        .map(|(_, at)| *at);
    if p.trade_offers.len() > crate::constants::TRADE_OFFER_COUNT as usize
        || p.trade_offers.iter().any(|o| !o.valid())
        || p.trade_stats.iter().any(|(_, v)| !v.is_finite())
        || ready_at.is_some_and(|t| !t.is_finite() || t < 0.)
    {
        return Err(ViewError::InvalidOwnerState);
    }
    let view = out.get_or_insert_with(TradeView::default);
    view.trade_used = p.trade_used;
    view.barter_ready_at = ready_at;
    view.stats.clone_from(&p.trade_stats);
    view.offers.truncate(p.trade_offers.len());
    for (i, offer) in p.trade_offers.iter().enumerate() {
        if let Some(row) = view.offers.get_mut(i) {
            row.cost = offer.cost;
            row.cost_value = offer.cost_value;
            row.gain = offer.gain;
            row.gain_value = offer.gain_value;
            row.label.clone_from(&offer.label);
        } else {
            view.offers.push(offer.clone());
        }
    }
    view.merchants.clear();
    let wards = crate::vision::WardSight::of_sim(sim);
    for trader in &rt.traders {
        if crate::vision::point_visible(sim.collision_view(), p, trader.at, sim.tick(), wards) {
            view.merchants.push(MerchantView {
                kind: trader.kind,
                at: trader.at,
            });
        }
    }
    Ok(())
}
