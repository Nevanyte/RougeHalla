//! Zone-themed camp buffs (P-CAMP-BUFF-THEMES-1): unreleased legacy a7b5c4ce `packages/shared/src/rosters.ts`
//! `rollCampRosters` (:232), with caller-supplied draws. Used only under `SimConfig::camp_buffs = Themed`; the default
//! keeps [`super::rosters::roll_camp_types`].
use super::MobTypeId;
use crate::FactionId;

/// What the roll reads of a camp (legacy `CampSite`, rosters.ts:36): its zone and its centre in world units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CampSite {
    pub zone: FactionId,
    pub x: f64,
    pub y: f64,
}

/// One camp's roll (legacy `CampRoll`, rosters.ts:39-44).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CampRoll {
    /// The camp's normal mob type: always one of its own zone's four.
    pub mob_type: MobTypeId,
    /// The normal type whose stat its normal kills pay when that is not `mob_type` (an off-theme buff); `None` when it
    /// is (legacy `buff: ""`).
    pub buff: Option<MobTypeId>,
}

/// Every camp's roll, in camp order (legacy `rollCampRosters`): draws exactly `2n - 1` numbers for `n` camps (`n - 1`
/// for the shuffle of the camp order, one buff draw a camp), none for a map without camps. Draws must obey the source
/// Rng contract: finite in [0, 1).
pub fn roll_camp_rosters(camps: &[CampSite], rng: &mut impl FnMut() -> f64) -> Vec<CampRoll> {
    // STUB (P-CAMP-BUFF-THEMES-1): the in-repo legacy bag roll and no buffs. The implementer ports rosters.ts:61-297.
    let zones: Vec<FactionId> = camps.iter().map(|c| c.zone).collect();
    super::rosters::roll_camp_types(&zones, rng)
        .into_iter()
        .map(|mob_type| CampRoll {
            mob_type,
            buff: None,
        })
        .collect()
}
