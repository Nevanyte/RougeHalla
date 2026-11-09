//! Entitled quest text from native catalog/reward/Farm facts. Never an input capability or canonical state.
use super::{Error, RowState};
use crate::{
    mob_catalog::MobTypeId,
    modifiers::Farm,
    quests::{
        catalog::{Def, Kind},
        rules,
    },
    FactionId,
};
pub(super) struct Presentation {
    pub name: String,
    pub giver_label: String,
    pub brief: String,
    pub objective: String,
    pub reward: String,
}
impl Presentation {
    fn checked(self) -> Result<Self, Error> {
        if [
            &self.name,
            &self.giver_label,
            &self.brief,
            &self.objective,
            &self.reward,
        ]
        .into_iter()
        .any(|text| text.len() > u8::MAX as usize)
        {
            return Err(Error::InvalidLabel);
        }
        Ok(self)
    }
}
pub(super) fn for_row(def: &Def, state: RowState, farm: &Farm) -> Result<Presentation, Error> {
    // Closed history never reads a later owner's Farm count. Caller has already selected an entitled human row.
    let award = match state {
        RowState::Done | RowState::Expired => None,
        RowState::Preview | RowState::Open => {
            let (stat, stacks) = rules::reward_stats(def);
            Some((stat, stacks, farm.count(stat)))
        }
    };
    build(def, award)
}
fn build(def: &Def, award: Option<(MobTypeId, u64, u64)>) -> Result<Presentation, Error> {
    let reward = match award {
        None => rules::reward_text(def),
        Some((stat, stacks, current)) => {
            let name =
                crate::mob_catalog::mob_type_by_id(stat.as_str()).map_or(stat.as_str(), |m| m.name);
            // Source questReward uses Number addition/template conversion, including sums above MAX_SAFE_INTEGER.
            let after = rules::js_number(current as f64 + stacks as f64);
            format!(
                "{stacks} {name} stacks ({}; {after} total after this quest) and {} GV",
                rules::mob_stat_text(stat, stacks),
                def.reward_gv
            )
        }
    };
    Presentation {
        name: def.name.into(),
        giver_label: def.giver.into(),
        brief: def.text.into(),
        objective: objective(def),
        reward,
    }
    .checked()
}
fn objective(def: &Def) -> String {
    let count = def.count;
    match def.kind {
        Kind::Fetch => format!("Find the parcel and return it to {}", def.giver),
        Kind::Collect => format!("Collect {count} quest tokens, then return to {}", def.giver),
        Kind::Kill if def.players => {
            format!("Defeat {count} player{}", if count == 1 { "" } else { "s" })
        }
        Kind::Kill if def.elite => {
            format!("Defeat {count} elite{}", if count == 1 { "" } else { "s" })
        }
        Kind::Kill if def.tour > 0 => format!("Kill mobs in {count} different regions"),
        Kind::Kill => match def.region {
            None => format!("Kill {count} mobs"),
            Some(region) => format!("Kill {count} mobs in {}", region_name(region)),
        },
    }
}
fn region_name(region: FactionId) -> &'static str {
    match region {
        FactionId::Fire => "Fire",
        FactionId::Sentenced => "Sentenced",
        FactionId::Plague => "Plague",
        FactionId::Frost => "Frost",
        FactionId::Holy => "Holy",
    }
}
#[cfg(test)]
#[path = "presentation_source_tests.rs"]
mod source_tests;
