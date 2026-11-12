//! The HUD content block a Welcome carries (protocol 17, P-WIRE17-HUD-2b): public content numbers the legacy champion
//! panel and weapon slots print, sent once per connection from the server's Rust content (never a hand-kept client copy).
//! Every value is a public content constant, the same for every viewer, so the block raises no C-OBS concern.
//!
//! Wire layout, right after the weapon table and before the map (all integers little-endian, f64 IEEE-754 LE):
//!
//! * `scaling count u8` (<= [`MAX_SCALING_ROWS`]), then per row a fixed [`SCALING_ROW_LEN`] = 34 bytes: `id u8` (the
//!   weapon's wire code), `ad f64, ap f64, bonus_hp f64, bonus_defense f64`, `dominant u8` (0 or 1). Ids strictly ascend.
//!   Legacy `WEAPONS[w].scaling` / `.dominant` (`packages/shared/src/weapons.ts:96-124`); Rust
//!   `rh_sim::modifiers::rules::DEFINITION.weapon_scaling`.
//! * `term count u8` (<= [`MAX_HUD_TERMS`]), then per row [`HUD_TERM_ROW_LEN`] = 9 bytes: `code u8` (a [`HudTerm`],
//!   < [`HUD_TERM_COUNT`]), `value f64`. Codes strictly ascend.
//!
//! Every f64 is finite and lies in `0..=`[`MAX_HUD_VALUE`]. A decoder refuses, with `DecodeError::BadField(reason)`:
//! a scaling count over the cap before reading rows ("scaling count"); a dominant byte above 1 as soon as it is read
//! ("scaling dominant"); after the rows, a value out of range ("scaling"), then ids not strictly ascending
//! ("scaling order"); a term count over the cap before reading rows ("hud term count"); a code >= [`HUD_TERM_COUNT`] as soon
//! as it is read ("hud term code"); after the rows, a value out of range ("hud term"), then codes not strictly ascending
//! ("hud term order"). The encoder refuses the same tables with `EncodeError::BadValue(reason)`, checked in the order:
//! scaling count, scaling values, scaling order, term count, term code, term values, term order.

use crate::codec::{Reader, Writer};
use crate::DecodeError;

/// Most scaling rows a block may carry (one per weapon, as the weapon table).
pub const MAX_SCALING_ROWS: usize = crate::weapon::MAX_WEAPONS;
/// Encoded size of one scaling row.
pub const SCALING_ROW_LEN: usize = 1 + 8 * 4 + 1;
/// Encoded size of one term row.
pub const HUD_TERM_ROW_LEN: usize = 1 + 8;
/// Largest value any field may hold.
pub const MAX_HUD_VALUE: f64 = 1.0e6;

/// The public HUD constants a Welcome carries, by code (append-only: a later packet adds codes at the end, never reuses
/// one). Values are the raw legacy constants (ms, world units, multipliers); a client formats them (e.g. "20% less
/// dealt" is `(1 - TrialDealtMult) x 100`) and never computes a rule from them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum HudTerm {
    /// Freeze stun, ms (legacy `FREEZE_STUN_MS`, abilities.ts:141).
    FreezeStunMs = 0,
    /// Freeze cast range, world units (`FREEZE_RANGE`, abilities.ts:140).
    FreezeRange = 1,
    /// Swarm hidden time, ms (`SWARM_MS`, :143).
    SwarmHiddenMs = 2,
    /// Swarm cloud radius, world units (`SWARM_CLOUD_RADIUS`, :145).
    SwarmCloudRadius = 3,
    /// Trial zone time, ms (`TRIAL_MS`, :150).
    TrialZoneMs = 4,
    /// Trial target's dealt multiplier (`TRIAL_DEALT_MULT`, :151).
    TrialDealtMult = 5,
    /// Trial target's move multiplier (`TRIAL_MOVE_MULT`, :153).
    TrialMoveMult = 6,
    /// Trial target's taken multiplier (`TRIAL_TAKEN_MULT`, :152).
    TrialTakenMult = 7,
    /// Trial exit stun, ms (`TRIAL_EXIT_STUN_MS`, :154).
    TrialExitStunMs = 8,
    /// Trial ring radius, world units (`TRIAL_RADIUS`, :147; tooltip).
    TrialRadius = 9,
    /// Trial ring radius on a convicted mark (`TRIAL_CONVICTED_RADIUS`, :149; tooltip).
    TrialConvictedRadius = 10,
    /// Blaze trail burn, true damage per second (`BLAZE_BURN_DPS`, :162).
    BlazeBurnDps = 11,
    /// Blaze burn duration, ms (`BLAZE_BURN_MS`, :163; the panel prints it as the "trail" seconds).
    BlazeBurnMs = 12,
    /// Blaze blink minimum distance, world units (`BLAZE_MIN_DIST`, :157).
    BlazeMinDist = 13,
    /// Blaze blink maximum distance, world units (`BLAZE_RANGE`, :156).
    BlazeMaxDist = 14,
    /// Last Stand duration, ms (`LAST_STAND_MS`, :164).
    LastStandMs = 15,
    /// Last Stand move speed bonus, fraction (`LAST_STAND_SPEED_BONUS`, :166).
    LastStandSpeedBonus = 16,
    /// Last Stand share of held damage healed back, fraction (`LAST_STAND_HEAL_SHARE`, :167).
    LastStandHealShare = 17,
    /// Last Stand health floor, hit points (`LAST_STAND_FLOOR_HP`, :165; the panel prints "1 HP").
    LastStandFloorHp = 18,
}

/// Number of [`HudTerm`] codes: a code at or above it is refused.
pub const HUD_TERM_COUNT: u8 = 19;
/// Most term rows a block may carry (each code at most once).
pub const MAX_HUD_TERMS: usize = HUD_TERM_COUNT as usize;

/// One weapon's damage scaling: the points of raw damage each bonus point adds (legacy `WeaponSpec.scaling`), and whether
/// the terms are alternatives (`dominant`: the higher one applies; legacy joins them with " or ", else " + ").
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WireWeaponScaling {
    /// The weapon's wire code (`rh_sim::WeaponId::code`), as in the weapon table.
    pub id: u8,
    /// Per bonus Offense point (legacy `scaling.ad`).
    pub ad: f64,
    /// Per bonus SO point (legacy `scaling.ap`).
    pub ap: f64,
    /// Per bonus max HP point (legacy `scaling.hp`).
    pub bonus_hp: f64,
    /// Per bonus Defense + SD point (legacy `scaling.def`).
    pub bonus_defense: f64,
    /// Legacy `dominant`: the terms are alternatives (the higher applies), not a sum.
    pub dominant: bool,
}

/// One public HUD constant: a [`HudTerm`] code and its value.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WireHudTerm {
    pub code: u8,
    pub value: f64,
}

/// The block: scaling rows by ascending weapon id, then term rows by ascending code.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WireHudContent {
    pub scaling: Vec<WireWeaponScaling>,
    pub terms: Vec<WireHudTerm>,
}

fn value_ok(v: f64) -> bool {
    v.is_finite() && (0.0..=MAX_HUD_VALUE).contains(&v)
}

impl WireWeaponScaling {
    fn values_ok(&self) -> bool {
        [self.ad, self.ap, self.bonus_hp, self.bonus_defense]
            .into_iter()
            .all(value_ok)
    }
}

/// The scaling rows' first fault once they are read: values, then order.
fn scaling_rows_fault(rows: &[WireWeaponScaling]) -> Option<&'static str> {
    if !rows.iter().all(WireWeaponScaling::values_ok) {
        return Some("scaling");
    }
    if rows.windows(2).any(|w| w[1].id <= w[0].id) {
        return Some("scaling order");
    }
    None
}

/// The term rows' first fault once they are read: values, then order.
fn term_rows_fault(rows: &[WireHudTerm]) -> Option<&'static str> {
    if !rows.iter().all(|t| value_ok(t.value)) {
        return Some("hud term");
    }
    if rows.windows(2).any(|w| w[1].code <= w[0].code) {
        return Some("hud term order");
    }
    None
}

/// The first reason a decoder would refuse this block (see the module doc for the order).
pub fn content_fault(c: &WireHudContent) -> Option<&'static str> {
    if c.scaling.len() > MAX_SCALING_ROWS {
        return Some("scaling count");
    }
    if let Some(why) = scaling_rows_fault(&c.scaling) {
        return Some(why);
    }
    if c.terms.len() > MAX_HUD_TERMS {
        return Some("hud term count");
    }
    if c.terms.iter().any(|t| t.code >= HUD_TERM_COUNT) {
        return Some("hud term code");
    }
    term_rows_fault(&c.terms)
}

/// Encoded size of the block.
pub fn content_len(c: &WireHudContent) -> usize {
    1 + c.scaling.len() * SCALING_ROW_LEN + 1 + c.terms.len() * HUD_TERM_ROW_LEN
}

pub(crate) fn write_content(w: &mut Writer, c: &WireHudContent) {
    w.u8(c.scaling.len() as u8);
    for s in &c.scaling {
        w.u8(s.id);
        w.f64(s.ad);
        w.f64(s.ap);
        w.f64(s.bonus_hp);
        w.f64(s.bonus_defense);
        w.u8(u8::from(s.dominant));
    }
    w.u8(c.terms.len() as u8);
    for t in &c.terms {
        w.u8(t.code);
        w.f64(t.value);
    }
}

pub(crate) fn read_content(r: &mut Reader) -> Result<WireHudContent, DecodeError> {
    let n = r.u8()? as usize;
    if n > MAX_SCALING_ROWS {
        return Err(DecodeError::BadField("scaling count"));
    }
    let mut scaling = Vec::with_capacity(n);
    for _ in 0..n {
        let id = r.u8()?;
        let ad = r.f64()?;
        let ap = r.f64()?;
        let bonus_hp = r.f64()?;
        let bonus_defense = r.f64()?;
        let dominant = match r.u8()? {
            0 => false,
            1 => true,
            _ => return Err(DecodeError::BadField("scaling dominant")),
        };
        scaling.push(WireWeaponScaling {
            id,
            ad,
            ap,
            bonus_hp,
            bonus_defense,
            dominant,
        });
    }
    if let Some(why) = scaling_rows_fault(&scaling) {
        return Err(DecodeError::BadField(why));
    }
    let n = r.u8()? as usize;
    if n > MAX_HUD_TERMS {
        return Err(DecodeError::BadField("hud term count"));
    }
    let mut terms = Vec::with_capacity(n);
    for _ in 0..n {
        let code = r.u8()?;
        if code >= HUD_TERM_COUNT {
            return Err(DecodeError::BadField("hud term code"));
        }
        terms.push(WireHudTerm {
            code,
            value: r.f64()?,
        });
    }
    if let Some(why) = term_rows_fault(&terms) {
        return Err(DecodeError::BadField(why));
    }
    Ok(WireHudContent { scaling, terms })
}

/// Writes a block without checking it (for decoder refusal vectors).
pub fn write_hud_content_for_tests(w: &mut Writer, c: &WireHudContent) {
    write_content(w, c);
}
