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
    /// A placed effect (Frost Wall, legacy `{ kind: "point", range, minRange }` without a blink): the aim point is
    /// clamped to `[min_range, range]` from the caster at the cast, and again (with [`RANGE_SLACK`]) at the landing.
    Placed {
        range: f64,
        min_range: f64,
    },
}
/// Which pass of a landing applies an effect (legacy `effectSide`): all self effects of the tick's due casts run first.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Self_,
    Target,
}

/// One effect step: a closed verb plus its row numbers (legacy `AbilityEffect`). The prose is the definition; the
/// interpreter in `systems/abilities/effects.rs` is the ONLY place a verb is executed.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Effect {
    Status {
        to: Side,
        kind: crate::status_runtime::StatusKind,
        ms: f64,
        value: Option<f64>,
    },
    DeathFloor {
        ms: f64,
        floor_hp: f64,
        heal_back: f64,
    },
    Zone {
        ms: f64,
        radius: f64,
        /// The radius instead when the target carries the caster's mark at tier 3 or more as the area lands.
        convicted_radius: Option<f64>,
        dealt_mult: f64,
        taken_from_source_mult: f64,
        move_mult: f64,
        exit_stun_ms: Option<f64>,
    },
    Cloud {
        ms: f64,
        radius: f64,
    },
    Blink,
    Trail {
        ms: f64,
        half_width: f64,
    },
    /// At the (clamped) aim point: a barrier square to the aim, `length` long, standing `ms` (`crate::barriers`). Its
    /// tiles stop bodies and melee swings, not sight or shots.
    Wall {
        ms: f64,
        length: f64,
    },
}

/// The pass an effect belongs to (legacy `effectSide`); the interpreter filters on it, not on the ability.
pub const fn effect_side(e: Effect) -> Side {
    match e {
        Effect::Status { to, .. } => to,
        Effect::Zone { .. } | Effect::Wall { .. } => Side::Target,
        Effect::DeathFloor { .. } | Effect::Cloud { .. } | Effect::Blink | Effect::Trail { .. } => {
            Side::Self_
        }
    }
}

/// A sixth, test-only ability row: no production table entry, made only of existing verbs. The id is a placeholder key
/// (the row is never registered), which is the point: new content is a row, not system code.
#[cfg(test)]
pub(crate) mod sample {
    use super::*;

    /// Built on demand so the content scanner sees no extra declaration; it is a test-only row, never in the table.
    pub(crate) fn row() -> Definition {
        Definition {
            id: AbilityId::Freeze,
            slot: Slot::Q,
            cast_ms: 0.,
            cooldown_ms: 1000.,
            charges: 1,
            target: Target::Self_,
            own_order: false,
            drops_lock: false,
            effects: &[
                Effect::Status {
                    to: Side::Self_,
                    kind: crate::status_runtime::StatusKind::Haste,
                    ms: 1000.,
                    value: Some(0.2),
                },
                Effect::Cloud {
                    ms: 1000.,
                    radius: 40.,
                },
            ],
        }
    }
}

/// Generic row validity: every number finite and in range, every reference a real verb field. Used by the harness for
/// the production rows and any test-only row.
#[cfg(test)]
pub(crate) fn validate_row(def: Definition) -> Result<(), &'static str> {
    if !AbilityId::ALL.contains(&def.id) {
        return Err("row id is not a real ability id");
    }
    if !def.cast_ms.is_finite() || def.cast_ms < 0. || def.cast_ms > 60000. {
        return Err("row cast time");
    }
    if !def.cooldown_ms.is_finite() || def.cooldown_ms < 0. || def.charges == 0 {
        return Err("row cooldown/charges");
    }
    match def.target {
        Target::Unit(range) if !range.is_finite() || range <= 0. => Err("row unit range"),
        Target::Placed { range, min_range }
            if !range.is_finite()
                || !min_range.is_finite()
                || min_range < 0.
                || range < min_range =>
        {
            Err("row placed range")
        }
        Target::Self_ | Target::Point | Target::Unit(_) | Target::Placed { .. } => Ok(()),
    }?;
    for e in def.effects {
        match *e {
            Effect::Status { ms, value, .. } => {
                if !ms.is_finite() || ms < 0. || value.is_some_and(|v| !v.is_finite()) {
                    return Err("row status numbers");
                }
            }
            Effect::DeathFloor {
                ms,
                floor_hp,
                heal_back,
            } => {
                if !ms.is_finite()
                    || ms < 0.
                    || !floor_hp.is_finite()
                    || !heal_back.is_finite()
                    || !(0. ..=1.).contains(&heal_back)
                {
                    return Err("row death floor numbers");
                }
            }
            Effect::Zone {
                ms,
                radius,
                convicted_radius,
                dealt_mult,
                taken_from_source_mult,
                move_mult,
                exit_stun_ms,
            } => {
                if !ms.is_finite()
                    || ms < 0.
                    || !radius.is_finite()
                    || radius <= 0.
                    || convicted_radius.is_some_and(|r| !r.is_finite() || r <= 0.)
                    || !dealt_mult.is_finite()
                    || !taken_from_source_mult.is_finite()
                    || !move_mult.is_finite()
                    || exit_stun_ms.is_some_and(|v| !v.is_finite() || v < 0.)
                {
                    return Err("row zone numbers");
                }
            }
            Effect::Cloud { ms, radius } => {
                if !ms.is_finite() || ms < 0. || !radius.is_finite() || radius <= 0. {
                    return Err("row cloud numbers");
                }
            }
            Effect::Blink => {}
            Effect::Trail { ms, half_width } => {
                if !ms.is_finite() || ms < 0. || !half_width.is_finite() || half_width <= 0. {
                    return Err("row trail numbers");
                }
            }
            Effect::Wall { ms, length } => {
                if !ms.is_finite() || ms < 0. || !length.is_finite() || length <= 0. {
                    return Err("row wall numbers");
                }
            }
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Definition {
    pub id: AbilityId,
    pub slot: Slot,
    pub cast_ms: f64,
    pub cooldown_ms: f64,
    pub charges: u8,
    pub target: Target,
    pub own_order: bool,
    pub drops_lock: bool,
    /// The ordered effect steps. Numbers reference the registered constants, so `content_hash` does not change.
    pub effects: &'static [Effect],
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
// Frost Wall (unreleased legacy 78dd8bd4 `shared/src/abilities.ts`, `constants.ts`; P-FROST-WALL-1). Read only under
// `SimConfig::frost_wish = Wall`. The numbers are content registry rows (`constants.rs`, P-FROST-WALL-2a), folded into
// content_hash there; the catalog row with the frostWall id comes in P-FROST-WALL-2.
pub use crate::constants::{
    FROST_WALL_CAST_MS, FROST_WALL_COOLDOWN_MS, FROST_WALL_LENGTH, FROST_WALL_MIN_RANGE,
    FROST_WALL_MS, FROST_WALL_RANGE,
};
pub const fn wish(faction: FactionId) -> AbilityId {
    match faction {
        FactionId::Frost => AbilityId::Freeze,
        FactionId::Plague => AbilityId::Swarm,
        FactionId::Sentenced => AbilityId::Trial,
        FactionId::Fire => AbilityId::Blaze,
        FactionId::Holy => AbilityId::LastStand,
    }
}
/// The definition row for an id. A row holds everything that varies; the match only selects the row.
pub fn definition(id: AbilityId) -> Definition {
    let (cast_ms, cooldown_ms, charges, target, own_order, drops_lock, effects) = match id {
        AbilityId::Freeze => (
            250.,
            45000.,
            1,
            Target::Unit(450.),
            false,
            false,
            &[Effect::Status {
                to: Side::Target,
                kind: crate::status_runtime::StatusKind::Stun,
                ms: FREEZE_STUN_MS,
                value: None,
            }] as &[Effect],
        ),
        AbilityId::Swarm => (
            250.,
            120000.,
            1,
            Target::Self_,
            false,
            true,
            &[
                Effect::Status {
                    to: Side::Self_,
                    kind: crate::status_runtime::StatusKind::Hidden,
                    ms: SWARM_MS,
                    value: None,
                },
                Effect::Cloud {
                    ms: SWARM_MS,
                    radius: SWARM_RADIUS,
                },
            ] as &[Effect],
        ),
        AbilityId::Trial => (
            350.,
            180000.,
            1,
            Target::Unit(400.),
            false,
            false,
            &[Effect::Zone {
                ms: TRIAL_MS,
                radius: TRIAL_RADIUS,
                convicted_radius: Some(TRIAL_CONVICTED_RADIUS),
                dealt_mult: TRIAL_DEALT_MULT,
                taken_from_source_mult: TRIAL_TAKEN_MULT,
                move_mult: TRIAL_MOVE_MULT,
                exit_stun_ms: crate::status_runtime::TRIAL_FIELD_POLICY.exit_stun_ms,
            }] as &[Effect],
        ),
        AbilityId::Blaze => (
            0.,
            30000.,
            2,
            Target::Point,
            true,
            false,
            &[
                Effect::Blink,
                Effect::Trail {
                    ms: BLAZE_TRAIL_MS,
                    half_width: BLAZE_HALF_WIDTH,
                },
            ] as &[Effect],
        ),
        AbilityId::LastStand => (
            0.,
            150000.,
            1,
            Target::Self_,
            false,
            false,
            &[
                Effect::DeathFloor {
                    ms: LAST_STAND_MS,
                    floor_hp: LAST_STAND_FLOOR,
                    heal_back: LAST_STAND_HEAL,
                },
                Effect::Status {
                    to: Side::Self_,
                    kind: crate::status_runtime::StatusKind::Haste,
                    ms: LAST_STAND_MS,
                    value: Some(LAST_STAND_HASTE),
                },
            ] as &[Effect],
        ),
    };
    Definition {
        id,
        slot: Slot::Wish,
        cast_ms,
        cooldown_ms,
        charges,
        target,
        own_order,
        drops_lock,
        effects,
    }
}

/// The definition row a world casts for an id: the catalog's, except that under `SimConfig::frost_wish = Wall` Frost's
/// Wish (staged under Freeze's id until P-FROST-WALL-2 gives it its own) is Frost Wall.
pub fn definition_for(config: &crate::SimConfig, id: AbilityId) -> Definition {
    if id == AbilityId::Freeze && config.frost_wish == crate::FrostWish::Wall {
        frost_wall_definition()
    } else {
        definition(id)
    }
}

/// The Frost Wall row (legacy 78dd8bd4 `frostWall`, rank 1).
pub fn frost_wall_definition() -> Definition {
    Definition {
        id: AbilityId::Freeze,
        slot: Slot::Wish,
        cast_ms: FROST_WALL_CAST_MS,
        cooldown_ms: FROST_WALL_COOLDOWN_MS,
        charges: 1,
        target: Target::Placed {
            range: FROST_WALL_RANGE,
            min_range: FROST_WALL_MIN_RANGE,
        },
        own_order: false,
        drops_lock: false,
        effects: &[Effect::Wall {
            ms: FROST_WALL_MS,
            length: FROST_WALL_LENGTH,
        }],
    }
}

/// The ability a slot casts for a faction; Q/E have none until a later packet's rows add them. Data, not a branch on an
/// ability id.
pub const fn ability_in_slot(slot: Slot, faction: FactionId) -> Option<AbilityId> {
    match slot {
        Slot::Wish => Some(wish(faction)),
        Slot::Q | Slot::E => None,
    }
}
/// The Wish multiplier a player's next cast spends ([`cooldown_for`]'s `wish_mult`): the folded `wish_cooldown_mult()`
/// (Arcane Overload's lever) times `1 - share`, Wish Engine's earned share (`cards::native::wish_engine_share`, 0 for a
/// non-holder, for whom the product is bit-identical to the folded multiplier). The one reader of both levers: the cast
/// producer, the Wish restore validator (`checkpoint.rs`) and the owner view ([`OwnerView::of`]) call it.
pub(crate) fn wish_mult(p: &crate::state::Player) -> f64 {
    p.modifiers.wish_cooldown_mult() * (1. - crate::cards::native::wish_engine_share(&p.build))
}

/// P-AUG-NATIVE-3b: Wish Engine's share lattice for one Wish row: after `n` landed casts the share is
/// `min(CAP, n x step)`, `step = CAP x row cooldown / CAP_MS`, computed from the integer `n` every time (never
/// accumulated, so Fire reaches the cap exactly on its tenth cast). The handler (`cards::native::zone`), the counter rule
/// (`cards::native::check`) and the restore envelope (`checkpoint.rs`) all read it.
#[derive(Clone, Copy, Debug)]
pub(crate) struct WishEngineGrid {
    step: f64,
    top: u32,
}
impl WishEngineGrid {
    /// The lattice of the Wish row whose cooldown is `row_cooldown_ms` (`definition_for(..).cooldown_ms`; `None` for a
    /// row with no positive cooldown, which cannot step).
    pub(crate) fn of(row_cooldown_ms: f64) -> Option<Self> {
        use crate::constants::{REWORK_WISH_ENGINE_CAP, REWORK_WISH_ENGINE_CAP_MS};
        let step = REWORK_WISH_ENGINE_CAP * row_cooldown_ms / REWORK_WISH_ENGINE_CAP_MS;
        if !(step > 0. && step.is_finite()) {
            return None;
        }
        // The first `n` whose `n x step` reaches the cap: the cap's index.
        let mut top = 0u32;
        while f64::from(top) * step < REWORK_WISH_ENGINE_CAP {
            top += 1;
        }
        Some(Self { step, top })
    }
    /// The index of the cap (the last point of the lattice).
    pub(crate) fn top(self) -> u32 {
        self.top
    }
    /// The share after `n` landed casts.
    pub(crate) fn share(self, n: u32) -> f64 {
        crate::constants::REWORK_WISH_ENGINE_CAP.min(f64::from(n) * self.step)
    }
    /// The lattice index of `share`, bit-exact (`None` off the lattice).
    pub(crate) fn index_of(self, share: f64) -> Option<u32> {
        if share == crate::constants::REWORK_WISH_ENGINE_CAP {
            return Some(self.top);
        }
        let n = (share / self.step).round();
        if !(0. ..f64::from(self.top)).contains(&n) {
            return None;
        }
        let n = n as u32;
        (self.share(n) == share).then_some(n)
    }
    /// The share after one more landed cast from `share`: `n = round(share / step)`, then `min(CAP, (n + 1) x step)`.
    pub(crate) fn next(self, share: f64) -> f64 {
        let n = (share / self.step).round();
        let n = if n > 0. && n.is_finite() {
            n.min(f64::from(self.top)) as u32
        } else {
            0
        };
        self.share((n + 1).min(self.top))
    }
}

/// The catalog row's cooldown ([`definition`]), for readers that know no world (bots, tools). A world's own spend, and
/// the restore that judges it, read [`cooldown_for`].
pub fn cooldown(id: AbilityId, training: bool, wish_mult: Option<f64>) -> f64 {
    scaled_cooldown(definition(id).cooldown_ms, training, wish_mult)
}
/// The cooldown a world spends for `id`: the row it casts ([`definition_for`]: Frost Wall's under `frost_wish = Wall`)
/// under its training rule and the Wish multiplier ([`wish_mult`]: Arcane Overload's lever times Wish Engine's `1 - share`,
/// floored at `WISH_MULT_MIN`). The cast producer and the Wish restore validator both read this one function, so neither
/// can judge a config-selected row by another row's numbers.
pub fn cooldown_for(config: &crate::SimConfig, id: AbilityId, wish_mult: Option<f64>) -> f64 {
    scaled_cooldown(
        definition_for(config, id).cooldown_ms,
        config.training,
        wish_mult,
    )
}
fn scaled_cooldown(base: f64, training: bool, wish_mult: Option<f64>) -> f64 {
    if training {
        return TRAINING_COOLDOWN_MS;
    }
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
    pub recharge_ms: f64,
    pub charges: u8,
    pub next_charge_at: Option<f64>,
    pub cast: Option<CastView>,
}
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CastView {
    pub ability: AbilityId,
    pub started_at: f64,
    pub lands_at: f64,
}
impl OwnerView {
    pub(crate) fn of(p: &crate::state::Player, now: f64, training: bool) -> Self {
        let ability = wish(p.faction());
        // The cooldown the next cast will spend (both levers, `wish_mult`).
        let recharge_ms = cooldown(ability, training, Some(wish_mult(p)));
        // Legacy abilitySlot reads `fullAt ?? 0`; preserve that fallback during the pre-raid interval.
        let full_at = p.stocks.wish_full_at.unwrap_or(0.);
        let max_charges = definition(ability).charges;
        // The stock clocks were built by the last spend's cooldown (`card_runtime.wish_cast`), which differs from
        // `recharge_ms` once a lever moved after that spend (Wish Engine's landing step, an Arcane Overload grant).
        // Count and time the charges by the clocks' own cooldown; with no recorded spend the two agree.
        let clock_ms = p
            .card_runtime
            .and_then(|r| r.wish_cast)
            .map_or(recharge_ms, |spend| spend.cooldown_ms);
        let charges = charges_at(full_at, now, max_charges, clock_ms);
        Self {
            ability,
            ready_at: p.stocks.wish_ready_at,
            full_at: p.stocks.wish_full_at,
            max_charges,
            recharge_ms,
            charges,
            // Fire's two spends can carry two cooldowns (a mixed full clock), so the missing count can exceed
            // `max_charges`: clamped, no charge up returns at `wish_ready_at` and one of two up at `wish_full_at`.
            next_charge_at: (charges < max_charges).then(|| {
                let missing = ((full_at - now) / clock_ms.max(1.)).ceil();
                if missing > f64::from(max_charges) {
                    full_at - f64::from(max_charges - 1) * clock_ms
                } else {
                    next_charge_at(full_at, now, clock_ms)
                }
            }),
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
mod frost_restore_tests;
#[cfg(test)]
mod owner_view_tests;
#[cfg(test)]
mod source_tests;
#[cfg(test)]
mod wish_lever_tests;

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
            // No catalog row is placed until P-FROST-WALL-2 (the wall row is config-selected; its numbers are already
            // registry rows, folded through REGISTRY).
            Target::Placed { range, min_range } => {
                word(3);
                word(range.to_bits());
                word(min_range.to_bits());
            }
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
        || config.wish_lock_ms > f64::from(u32::MAX) * f64::from(config.tick_ms)
    {
        return Err("invalid Wish lock");
    }
    Ok(())
}
