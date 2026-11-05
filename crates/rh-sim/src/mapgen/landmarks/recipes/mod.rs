//! Live immutable recipe data; faction implementations and stage admission are separate leaves.
use super::templates::LandmarkTemplate;
use crate::mapdata::FeatureJob;
pub mod direct_family;
pub mod search_family;
use super::recipe_support::RecipeInputs;
use super::runtime::LandmarkRuntime;
use super::templates::TemplateError;
use direct_family::{rime, sanctum, warren};
use search_family::{gallows, scorch};

/// Borrowed source template data, parsed once by a recipe's off-tick constructor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TemplateDefinition<'a> {
    pub key: &'a str,
    pub rows: &'a [&'a str],
    pub jobs: &'a [FeatureJob],
}

/// The source registry's fixed declaration order; execution still follows each attempt's shuffled zones.
#[derive(Clone, Copy, Debug)]
pub struct Definitions<'a> {
    pub scorch: scorch::Definition<'a>,
    pub gallows: gallows::Definition<'a>,
    pub warren: warren::Definition<'a>,
    pub rime: rime::Definition<'a>,
    pub sanctum: sanctum::Definition<'a>,
}
pub fn default_definitions() -> Definitions<'static> {
    Definitions {
        scorch: scorch::default_definition(),
        gallows: gallows::default_definition(),
        warren: warren::default_definition(),
        rime: rime::default_definition(),
        sanctum: sanctum::default_definition(),
    }
}
pub fn visit_content(d: &Definitions<'_>, mut word: impl FnMut(u64)) {
    scorch::visit_content(&d.scorch, &mut word);
    gallows::visit_content(&d.gallows, &mut word);
    warren::visit_content(&d.warren, &mut word);
    rime::visit_content(&d.rime, &mut word);
    sanctum::visit_content(&d.sanctum, &mut word);
}

/// Parsed once off tick and reusable across attempts. All planning state belongs to an individual callback.
pub struct Recipes<'a> {
    scorch: scorch::Recipe<'a>,
    gallows: gallows::Recipe<'a>,
    warren: warren::Recipe<'a>,
    rime: rime::Recipe<'a>,
    sanctum: sanctum::Recipe<'a>,
}
impl Default for Recipes<'static> {
    fn default() -> Self {
        Self::from_definitions(&default_definitions()).expect("live source templates are valid")
    }
}
impl<'a> Recipes<'a> {
    pub fn from_definitions(d: &Definitions<'a>) -> Result<Self, TemplateError> {
        Ok(Self {
            scorch: scorch::Recipe::from_definition(&d.scorch)?,
            gallows: gallows::Recipe::from_definition(&d.gallows)?,
            warren: warren::Recipe::from_definition(&d.warren)?,
            rime: rime::Recipe::from_definition(&d.rime)?,
            sanctum: sanctum::Recipe::from_definition(&d.sanctum)?,
        })
    }
    pub fn apply(&self, rt: &mut LandmarkRuntime<'_>, inputs: &RecipeInputs<'_>) {
        use crate::mapdata::Zone;
        match rt.geometry().info.faction {
            Zone::Fire => self.scorch.apply(rt, inputs),
            Zone::Sentenced => self.gallows.apply(rt, inputs),
            Zone::Plague => self.warren.apply(rt, inputs),
            Zone::Frost => self.rime.apply(rt, inputs),
            Zone::Holy => self.sanctum.apply(rt, inputs),
        }
    }
}

impl TemplateDefinition<'_> {
    pub fn build(&self) -> LandmarkTemplate {
        LandmarkTemplate {
            key: self.key.to_owned(),
            rows: self.rows.iter().map(|row| (*row).to_owned()).collect(),
            jobs: self.jobs.to_vec(),
        }
    }

    /// Length-delimited UTF-16 words and declaration-order jobs, without allocation.
    pub fn visit_content(&self, mut word: impl FnMut(u64)) {
        word(self.key.encode_utf16().count() as u64);
        for unit in self.key.encode_utf16() {
            word(u64::from(unit));
        }
        word(self.rows.len() as u64);
        for row in self.rows {
            word(row.encode_utf16().count() as u64);
            for unit in row.encode_utf16() {
                word(u64::from(unit));
            }
        }
        word(self.jobs.len() as u64);
        for job in self.jobs {
            word(*job as u64);
        }
    }
}
