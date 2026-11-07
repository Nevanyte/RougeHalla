//! Minimal Small-potion state and source policy. Not cannon/wind/large-potion behavior.
use crate::PlayerId;
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Hot {
    pub(crate) next: f64,
    pub(crate) left: u8,
    pub(crate) amount: f64,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Healing {
    pub(crate) id: PlayerId,
    pub(crate) hots: Vec<Hot>,
}
pub struct Definition {
    pub cap: u8,
    pub concurrent: u8,
    pub heal_ms: f64,
    pub step_ms: f64,
    pub small_share: f64,
    pub large_share: f64,
}
pub static DEFINITION: Definition = Definition {
    cap: 5,
    concurrent: 3,
    heal_ms: 5000.,
    step_ms: 500.,
    small_share: 0.25,
    large_share: 0.4,
};
pub fn visit_content(mut word: impl FnMut(u64)) {
    word(u64::from(DEFINITION.cap));
    word(u64::from(DEFINITION.concurrent));
    word(DEFINITION.heal_ms.to_bits());
    word(DEFINITION.step_ms.to_bits());
    word(DEFINITION.small_share.to_bits());
    word(DEFINITION.large_share.to_bits());
}

/// Which potion stock a grant or a use is about (legacy `ConsumableId` without the emblem).
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Size {
    Small,
    Large,
}

impl Size {
    /// The share of max hp this potion heals over its whole duration.
    pub fn share(self) -> f64 {
        match self {
            Self::Small => DEFINITION.small_share,
            Self::Large => DEFINITION.large_share,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Notice {
    Stored,
    BagFull,
    Used,
    Blocked,
    Busy,
    Full,
    Empty,
    /// Legacy "Camp potion stored" (a camp-clear reward arriving).
    LargeStored,
    /// Legacy "Camp potion · healing over 5s".
    LargeUsed,
    /// Legacy `payCampHeal`'s bag-full line: the clear is still counted, the potion is not stored.
    CampBagFull,
}
impl Notice {
    pub fn message(self) -> &'static str {
        match self {
            Self::Stored => "Small potion stored · Heal 25% HP over 5s",
            Self::BagFull => "Consumable bag full (5 of each)",
            Self::Used => "Small potion · healing over 5s",
            Self::Blocked => "Can't use an item now",
            Self::Busy => "Already drinking 3 potions",
            Self::Full => "Already at full health",
            Self::Empty => "No potion stored",
            Self::LargeStored => "Camp potion stored · Heal 40% HP over 5s",
            Self::LargeUsed => "Camp potion · healing over 5s",
            Self::CampBagFull => "Camp cleared · camp potion bag full (5)",
        }
    }
}
