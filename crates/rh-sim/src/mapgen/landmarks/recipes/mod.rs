//! Live immutable recipe data; faction implementations and stage admission are separate leaves.
use super::templates::LandmarkTemplate;
use crate::mapdata::FeatureJob;

/// Borrowed source template data, parsed once by a recipe's off-tick constructor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TemplateDefinition<'a> {
    pub key: &'a str,
    pub rows: &'a [&'a str],
    pub jobs: &'a [FeatureJob],
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
