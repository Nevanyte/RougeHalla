//! Pure Wish definitions and stock clocks. Runtime effects live in systems/abilities.
pub mod blink;
use crate::{
    status_runtime::{AbilityId, CancelCauses},
    FactionId,
};
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Mode {
    #[default]
    Off,
    Full,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Slot {
    Wish,
    Q,
    E,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Stocks {
    pub wish_ready_at: f64,
    pub q_ready_at: f64,
    pub e_ready_at: f64,
    pub wish_full_at: Option<f64>,
}
impl Stocks {
    pub fn ready_at(self, slot: Slot) -> f64 {
        match slot {
            Slot::Wish => self.wish_ready_at,
            Slot::Q => self.q_ready_at,
            Slot::E => self.e_ready_at,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Target {
    Unit(f64),
    Self_,
    Point,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Definition {
    pub id: AbilityId,
    pub cast_ms: f64,
    pub cooldown_ms: f64,
    pub charges: u8,
    pub target: Target,
    pub own_order: bool,
    pub drops_lock: bool,
}
pub const CANCELLED_BY: CancelCauses = CancelCauses {
    stun: true,
    silence: true,
    root: false,
    stagger: false,
};
pub const RANGE_SLACK: f64 = 32.;
pub const TELEPORT_GRACE_MS: f64 = 300.;
pub const WISH_LOCK_MS: f64 = 45000.;
pub const TRAINING_COOLDOWN_MS: f64 = 5000.;
pub const WISH_MULT_MIN: f64 = 0.5;
pub const FREEZE_STUN_MS: f64 = 1250.;
pub const SWARM_MS: f64 = 8000.;
pub const SWARM_RADIUS: f64 = 72.;
pub const TRIAL_MS: f64 = 5000.;
pub const TRIAL_RADIUS: f64 = 300.;
pub const TRIAL_CONVICTED_RADIUS: f64 = 200.;
pub const TRIAL_DEALT_MULT: f64 = 0.8;
pub const TRIAL_TAKEN_MULT: f64 = 1.2;
pub const TRIAL_MOVE_MULT: f64 = 0.7;
pub const BLAZE_TRAIL_MS: f64 = 2500.;
pub const BLAZE_HALF_WIDTH: f64 = 20.;
pub const LAST_STAND_MS: f64 = 5000.;
pub const LAST_STAND_FLOOR: f64 = 1.;
pub const LAST_STAND_HASTE: f64 = 0.3;
pub const LAST_STAND_HEAL: f64 = 0.3;
pub const fn wish(faction: FactionId) -> AbilityId {
    match faction {
        FactionId::Frost => AbilityId::Freeze,
        FactionId::Plague => AbilityId::Swarm,
        FactionId::Sentenced => AbilityId::Trial,
        FactionId::Fire => AbilityId::Blaze,
        FactionId::Holy => AbilityId::LastStand,
    }
}
pub const fn definition(id: AbilityId) -> Definition {
    let (cast_ms, cooldown_ms, charges, target, own_order, drops_lock) = match id {
        AbilityId::Freeze => (250., 45000., 1, Target::Unit(450.), false, false),
        AbilityId::Swarm => (250., 120000., 1, Target::Self_, false, true),
        AbilityId::Trial => (350., 180000., 1, Target::Unit(400.), false, false),
        AbilityId::Blaze => (0., 30000., 2, Target::Point, true, false),
        AbilityId::LastStand => (0., 150000., 1, Target::Self_, false, false),
    };
    Definition {
        id,
        cast_ms,
        cooldown_ms,
        charges,
        target,
        own_order,
        drops_lock,
    }
}
pub fn cooldown(id: AbilityId, training: bool, wish_mult: Option<f64>) -> f64 {
    if training {
        return TRAINING_COOLDOWN_MS;
    }
    let base = definition(id).cooldown_ms;
    let mult = wish_mult
        .filter(|v| *v > 0.)
        .map_or(1., |v| v.max(WISH_MULT_MIN));
    if mult == 1. {
        base
    } else {
        crate::math::js_round(base * mult)
    }
}
pub fn charges_at(full: f64, now: f64, max: u8, recharge: f64) -> u8 {
    if full <= now {
        return max;
    }
    (f64::from(max) - ((full - now) / recharge.max(1.)).ceil()).max(0.) as u8
}
pub fn spend_charge(full: f64, now: f64, max: u8, recharge: f64) -> (f64, f64) {
    let full = full.max(now) + recharge;
    (full, (full - f64::from(max - 1) * recharge).max(0.))
}
pub fn next_charge_at(full: f64, now: f64, recharge: f64) -> f64 {
    if full <= now {
        return 0.;
    }
    let missing = ((full - now) / recharge.max(1.)).ceil();
    full - (missing - 1.) * recharge
}

/// Complete persistent producer detail. The due phase's landing/origin live only in scratch.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CastDetail {
    pub rank: u8,
    pub slot: Slot,
    pub target: Option<crate::PlayerId>,
    pub point: crate::Vec2,
    pub previous_ready_at: f64,
    pub previous_full_at: Option<f64>,
    pub lag_ms: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct OwnerView {
    pub ability: AbilityId,
    pub ready_at: f64,
    pub full_at: Option<f64>,
    pub max_charges: u8,
    pub cast: Option<CastView>,
}
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CastView {
    pub ability: AbilityId,
    pub started_at: f64,
    pub lands_at: f64,
}
impl OwnerView {
    pub(crate) fn of(p: &crate::state::Player) -> Self {
        let ability = wish(p.vitals.faction);
        Self {
            ability,
            ready_at: p.stocks.wish_ready_at,
            full_at: p.stocks.wish_full_at,
            max_charges: definition(ability).charges,
            cast: p
                .statuses
                .cast
                .filter(|c| c.producer.is_some())
                .map(|c| CastView {
                    ability: c.ability,
                    started_at: c.started_at,
                    lands_at: c.lands_at,
                }),
        }
    }
}
pub(crate) mod checkpoint;
mod effect_checkpoint;
#[cfg(test)]
mod source_tests;

/// The arena inventory delegates its genuine Wish prerequisite to the same source consumer.
#[cfg(test)]
pub(crate) fn assert_genuine_arena_refund() {
    source_tests::assert_genuine_arena_refund();
}
/// Executable catalog and tuning, shared by runtime and content identity.
pub fn visit_content(mut word: impl FnMut(u64)) {
    for id in AbilityId::ALL {
        let d = definition(id);
        word(id as u64);
        word(d.cast_ms.to_bits());
        word(d.cooldown_ms.to_bits());
        word(u64::from(d.charges));
        word(u64::from(d.own_order));
        word(u64::from(d.drops_lock));
        match d.target {
            Target::Unit(range) => {
                word(0);
                word(range.to_bits());
            }
            Target::Self_ => word(1),
            Target::Point => word(2),
        }
    }
    for v in [
        RANGE_SLACK,
        TELEPORT_GRACE_MS,
        WISH_LOCK_MS,
        TRAINING_COOLDOWN_MS,
        WISH_MULT_MIN,
        FREEZE_STUN_MS,
        SWARM_MS,
        SWARM_RADIUS,
        TRIAL_MS,
        TRIAL_RADIUS,
        TRIAL_CONVICTED_RADIUS,
        TRIAL_DEALT_MULT,
        TRIAL_TAKEN_MULT,
        TRIAL_MOVE_MULT,
        BLAZE_TRAIL_MS,
        BLAZE_HALF_WIDTH,
        LAST_STAND_MS,
        LAST_STAND_FLOOR,
        LAST_STAND_HASTE,
        LAST_STAND_HEAL,
        blink::MIN_DIST,
        blink::MAX_DIST,
        blink::STEP,
    ] {
        word(v.to_bits());
    }
    for v in [
        CANCELLED_BY.stun,
        CANCELLED_BY.silence,
        CANCELLED_BY.root,
        CANCELLED_BY.stagger,
    ] {
        word(u64::from(v));
    }
    for v in [
        Mode::Off as u64,
        Mode::Full as u64,
        Slot::Wish as u64,
        Slot::Q as u64,
        Slot::E as u64,
    ] {
        word(v);
    }
}

pub(crate) fn validate_config(config: &crate::SimConfig) -> Result<(), &'static str> {
    if !config.wish_lock_ms.is_finite()
        || config.wish_lock_ms < 0.
        || config.wish_lock_ms > f64::from(u32::MAX) * crate::constants::TICK_MS
    {
        return Err("invalid Wish lock");
    }
    Ok(())
}
