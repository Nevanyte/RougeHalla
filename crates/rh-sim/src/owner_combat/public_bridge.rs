//! Prepared-scene bridge. No canonical target survives current-scene entitlement or mapping.
use super::{project_where, Lock, OwnerCombat};
use crate::{Observation, OfferError, PlayerId, Sim};

/// A lock may be held while its target is not currently entitled to this viewer.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum OwnerLockView {
    Clear,
    Held { target: Option<PlayerId> },
}

/// Exact source uint32 clocks and encoded f64 multiplier mirrors. References use the same
/// presented PlayerId domain as ActorView, not canonical NPC identity or an action capability.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct OwnerCombatView {
    pub lock: OwnerLockView,
    pub draw_started_at: u32,
    pub ready_at: u32,
    pub as_milli: f64,
    pub windup_milli: f64,
    pub speed_milli: f64,
}

pub(crate) fn prepare(
    sim: &Sim,
    viewer: PlayerId,
    out: &Observation,
) -> Result<Option<OwnerCombat>, OfferError> {
    let Some(owner) = out
        .me
        .as_ref()
        .filter(|me| me.id == viewer)
        .and_then(|_| sim.player(viewer))
    else {
        return Ok(None);
    };
    project_where(owner, |id| {
        out.visible.iter().any(|a| {
            a.id == id
                && (a.kind != crate::observe::ActorKind::Player || sim.w.roster.name(id).is_some())
        })
    })
    .map(Some)
    .map_err(|_| OfferError::UnrepresentableOwnerCombat)
}

pub(crate) fn map_current(
    raw: OwnerCombat,
    map: impl Fn(PlayerId) -> Option<PlayerId>,
) -> OwnerCombatView {
    OwnerCombatView {
        lock: match raw.lock {
            Lock::Clear => OwnerLockView::Clear,
            Lock::Held { target } => OwnerLockView::Held {
                target: target.and_then(map),
            },
        },
        draw_started_at: raw.draw_started_at,
        ready_at: raw.ready_at,
        as_milli: raw.as_milli,
        windup_milli: raw.windup_milli,
        speed_milli: raw.speed_milli,
    }
}
