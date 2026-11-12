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

/// The first reason a decoder would refuse this block (see the module doc for the order).
pub fn content_fault(_c: &WireHudContent) -> Option<&'static str> {
    // STUB (P-WIRE17-HUD-2b): the implementer writes the checks.
    None
}

/// Encoded size of the block.
pub fn content_len(_c: &WireHudContent) -> usize {
    // STUB (P-WIRE17-HUD-2b).
    0
}

pub(crate) fn write_content(_w: &mut Writer, _c: &WireHudContent) {
    // STUB (P-WIRE17-HUD-2b): nothing is written yet.
}

pub(crate) fn read_content(_r: &mut Reader) -> Result<WireHudContent, DecodeError> {
    // STUB (P-WIRE17-HUD-2b): nothing is read yet.
    Ok(WireHudContent::default())
}

/// Writes a block without checking it (for decoder refusal vectors).
pub fn write_hud_content_for_tests(w: &mut Writer, c: &WireHudContent) {
    write_content(w, c);
}
