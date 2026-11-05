//! Server-owned catalog and validated look words, exported from the legacy shared catalog.
//! This is off-tick profile/presentation data; it never changes simulation stats.

use crate::Cosmetics;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

pub const SLOTS: [&str; 14] = [
    "skin",
    "outline",
    "trail",
    "title",
    "gold-fire",
    "gold-sentenced",
    "gold-plague",
    "gold-frost",
    "gold-holy",
    "gold-sword",
    "gold-axe",
    "gold-bow",
    "gold-wand",
    "gold-shield",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cosmetic {
    pub id: String,
    pub slot: String,
    pub name: String,
    pub code: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
}

impl Cosmetic {
    pub fn for_sale(&self) -> bool {
        self.price.is_some_and(|p| p > 0 && p <= crate::MAX_SAFE)
    }
}

pub fn catalog() -> &'static [Cosmetic] {
    static CATALOG: OnceLock<Vec<Cosmetic>> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../data/cosmetics.json"))
            .expect("the embedded, checked cosmetic catalog")
    })
}

pub fn by_id(id: &str) -> Option<&'static Cosmetic> {
    catalog().iter().find(|c| c.id == id)
}

/// Unknown, mismatched and unowned profile entries cannot grant a visible cosmetic.
pub fn pack_look(cosmetics: &Cosmetics) -> u32 {
    let mut word = 0;
    for (index, slot) in SLOTS.iter().enumerate() {
        let Some(id) = cosmetics.equipped.get(*slot) else {
            continue;
        };
        let Some(c) = by_id(id).filter(|c| c.slot == *slot) else {
            continue;
        };
        if !cosmetics.owned.contains(id) {
            continue;
        }
        if index >= 4 {
            word |= 1 << (21 + index - 4);
        } else {
            let (shift, bits) = [(0, 6), (6, 4), (10, 4), (14, 7)][index];
            word |= (c.code & ((1 << bits) - 1)) << shift;
        }
    }
    word
}

pub fn equipped_title(cosmetics: &Cosmetics) -> Option<&str> {
    let id = cosmetics.equipped.get("title")?;
    (cosmetics.owned.contains(id) && by_id(id).is_some_and(|c| c.slot == "title"))
        .then_some(id.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeMap, HashSet};

    #[test]
    fn catalog_is_complete_and_wire_codes_fit_their_slots() {
        let mut ids = HashSet::new();
        let mut codes = HashSet::new();
        for c in catalog() {
            assert!(ids.insert(&c.id));
            assert!(codes.insert((&c.slot, c.code)));
            let i = SLOTS.iter().position(|slot| *slot == c.slot).unwrap();
            let max = if i < 4 { [64, 16, 16, 128][i] } else { 16 };
            assert!(c.code > 0 && c.code < max);
            if i >= 4 {
                assert_eq!(c.target.as_deref(), c.slot.strip_prefix("gold-"));
                assert_eq!(c.code, (i - 3) as u32);
            }
        }
        assert_eq!(catalog().len(), 57);
        assert!(by_id("__proto__").is_none());
    }

    #[test]
    fn look_matches_real_legacy_observations() {
        #[derive(Deserialize)]
        struct Cases {
            cases: Vec<Case>,
        }
        #[derive(Deserialize)]
        struct Case {
            label: String,
            equipped: BTreeMap<String, String>,
            owned: Vec<String>,
            expected: u32,
        }
        let cases: Cases =
            serde_json::from_str(include_str!("../tests/fixtures/cosmetics.json")).unwrap();
        for c in cases.cases {
            let cosmetics = Cosmetics {
                equipped: c.equipped,
                owned: c.owned,
                ..Cosmetics::default()
            };
            assert_eq!(pack_look(&cosmetics), c.expected, "{}", c.label);
        }
    }

    #[test]
    fn public_title_requires_matching_ownership_and_catalog_slot() {
        let mut c = Cosmetics::default();
        c.equipped.insert("title".into(), "title-rookie".into());
        assert_eq!(equipped_title(&c), None);
        c.owned.push("title-rookie".into());
        assert_eq!(equipped_title(&c), Some("title-rookie"));
        c.equipped.insert("title".into(), "skin-crimson".into());
        c.owned.push("skin-crimson".into());
        assert_eq!(equipped_title(&c), None);
    }
}
