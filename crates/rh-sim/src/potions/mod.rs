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
}
pub static DEFINITION: Definition = Definition {
    cap: 5,
    concurrent: 3,
    heal_ms: 5000.,
    step_ms: 500.,
    small_share: 0.25,
};
pub fn visit_content(mut word: impl FnMut(u64)) {
    word(u64::from(DEFINITION.cap));
    word(u64::from(DEFINITION.concurrent));
    word(DEFINITION.heal_ms.to_bits());
    word(DEFINITION.step_ms.to_bits());
    word(DEFINITION.small_share.to_bits());
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
        }
    }
}
