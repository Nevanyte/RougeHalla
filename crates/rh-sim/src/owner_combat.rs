//! Private owner display projection. No SelfView/public binding, state, retained identity or action capability.
//! The caller supplies CURRENT entitled membership from the same completed-step scene.
use crate::{stat_fold, PlayerId};

/// ECMAScript ToUint32 representation modulus, not a gameplay deadline or rule.
const SOURCE_U32_MODULUS: f64 = 4_294_967_296.;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Lock {
    Clear,
    Held { target: Option<PlayerId> },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct OwnerCombat {
    pub lock: Lock,
    pub draw_started_at: u32,
    pub ready_at: u32,
    pub as_milli: f64,
    pub windup_milli: f64,
    pub speed_milli: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Error {
    NonFiniteDrawClock,
    NonFiniteReadyClock,
    InvalidMirror,
}

/// Exact source/schema conversion, including declared nonfinite/negative boundary probes.
/// Native projection must validate its canonical clocks BEFORE calling this helper.
fn source_to_u32(value: f64) -> u32 {
    if !value.is_finite() || value == 0. {
        0
    } else {
        value.trunc().rem_euclid(SOURCE_U32_MODULUS) as u32
    }
}

fn checked_mirrors(values: [f64; 3]) -> Result<[f64; 3], Error> {
    let minimum = stat_fold::encode_mult(0.);
    if values
        .iter()
        .all(|v| v.is_finite() && *v >= minimum && v.fract() == 0.)
    {
        Ok(values)
    } else {
        Err(Error::InvalidMirror)
    }
}

/// Reads authoritative fields only; no now+remaining, action inference, refolding or allocation.
/// Hidden canonical target identities never enter the returned group. This is not ActorRef mapping.
pub(crate) fn project(
    owner: &crate::state::Player,
    current_entitled: &[PlayerId],
) -> Result<OwnerCombat, Error> {
    let draw = owner.weapon.draw_started_at;
    let ready = owner.weapon.ready_at;
    if !draw.is_finite() {
        return Err(Error::NonFiniteDrawClock);
    }
    if !ready.is_finite() {
        return Err(Error::NonFiniteReadyClock);
    }
    let [as_milli, windup_milli, speed_milli] =
        checked_mirrors(owner.modifiers.owner_combat_mirrors())?;
    let lock = match owner.weapon.targeting.target {
        None => Lock::Clear,
        Some(id) => Lock::Held {
            target: current_entitled.contains(&id).then_some(id),
        },
    };
    Ok(OwnerCombat {
        lock,
        draw_started_at: source_to_u32(draw),
        ready_at: source_to_u32(ready),
        as_milli,
        windup_milli,
        speed_milli,
    })
}

#[cfg(test)]
mod tests;
