//! Public facts only; handles are issued per observer and never expose a world entity serial.
use crate::{cards::CardId, PlayerId, Vec2};
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
#[serde(transparent)]
pub struct RewardChestHandle(std::num::NonZeroU32);
impl RewardChestHandle {
    pub const fn from_wire(value: u32) -> Option<Self> {
        match std::num::NonZeroU32::new(value) {
            Some(v) => Some(Self(v)),
            None => None,
        }
    }
    pub const fn wire(self) -> u32 {
        self.0.get()
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BoostId {
    Ad,
    Ap,
    Armor,
    Shield,
    MaxHp,
    AttackSpeed,
    MoveSpeed,
    Lifesteal,
}
impl BoostId {
    pub const ALL: [Self; 8] = [
        Self::Ad,
        Self::Ap,
        Self::Armor,
        Self::Shield,
        Self::MaxHp,
        Self::AttackSpeed,
        Self::MoveSpeed,
        Self::Lifesteal,
    ];
    pub const fn index(self) -> usize {
        self as usize
    }
    pub fn source(self) -> crate::stat_fold::ChestBoostStat {
        crate::stat_fold::ChestBoostStat::source_order()[self.index()]
    }
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ad => "boost:ad",
            Self::Ap => "boost:ap",
            Self::Armor => "boost:armor",
            Self::Shield => "boost:shield",
            Self::MaxHp => "boost:maxHp",
            Self::AttackSpeed => "boost:attackSpeed",
            Self::MoveSpeed => "boost:moveSpeed",
            Self::Lifesteal => "boost:lifesteal",
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum OptionId {
    Card(CardId),
    Boost(BoostId),
}
impl OptionId {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Card(v) => v.as_str(),
            Self::Boost(v) => v.as_str(),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RewardOptionView {
    pub id: OptionId,
    pub taken: bool,
    pub taken_by: Option<PlayerId>,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RewardChestView {
    pub handle: RewardChestHandle,
    pub at: Vec2,
    pub expires_at: f64,
    pub options: Vec<RewardOptionView>,
    pub picked: bool,
    pub can_choose: bool,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct BuildView {
    pub cards: crate::cards::Counts,
    pub boosts: [u8; 8],
}
impl From<&crate::cards::Build> for BuildView {
    fn from(b: &crate::cards::Build) -> Self {
        Self {
            cards: b.counts,
            boosts: b.boosts(),
        }
    }
}
