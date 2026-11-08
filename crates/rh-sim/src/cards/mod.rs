//! Authoritative card facts. Hook memory stays on [`runtime::Runtime`]; there is no second runtime.
pub(crate) mod catalog;
mod rules;
use crate::stat_fold::EffectFlag;
pub use catalog::CardId;
pub use rules::{visit_content, Definition, DEFINITION};

pub const MAX_STACK: u8 = 12;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Build {
    counts_a: [u8; 32],
    counts_b: [u8; 32],
    counts_c: [u8; 16],
    pub(crate) boosts: [u8; 8],
}

impl Build {
    pub fn owns(&self, id: CardId) -> bool {
        self.count(id) > 0
    }

    pub fn count(&self, id: CardId) -> u8 {
        let i = id.index();
        if i < 32 {
            self.counts_a[i]
        } else if i < 64 {
            self.counts_b[i - 32]
        } else {
            self.counts_c[i - 64]
        }
    }

    pub fn power(&self) -> f64 {
        CardId::ALL
            .into_iter()
            .map(|id| f64::from(id.tier()) * f64::from(self.count(id)))
            .sum()
    }

    pub fn cards(&self) -> impl Iterator<Item = CardId> + '_ {
        CardId::ALL
            .into_iter()
            .flat_map(|id| std::iter::repeat_n(id, usize::from(self.count(id))))
    }

    pub fn boosts(&self) -> [u8; 8] {
        self.boosts
    }

    pub(crate) fn add(&mut self, id: CardId) -> bool {
        let i = id.index();
        let slot = if i < 32 {
            &mut self.counts_a[i]
        } else if i < 64 {
            &mut self.counts_b[i - 32]
        } else {
            &mut self.counts_c[i - 64]
        };
        if *slot >= MAX_STACK || (id.unique() && *slot > 0) {
            return false;
        }
        *slot += 1;
        true
    }

    /// The previous three-card envelope: every supported offer at one copy, max boosts.
    pub(crate) fn offer_envelope() -> Self {
        let mut build = Self::default();
        for id in CardId::OFFER {
            build.add(id);
        }
        build.boosts = [crate::stat_fold::default_definition().chest_boost_max_picks as u8; 8];
        build
    }

    pub(crate) fn valid(&self) -> bool {
        CardId::ALL.into_iter().all(|id| {
            let n = self.count(id);
            n <= MAX_STACK && (!id.unique() || n <= 1)
        }) && self
            .boosts
            .iter()
            .all(|n| u32::from(*n) <= crate::stat_fold::default_definition().chest_boost_max_picks)
    }

    pub(crate) fn has_flag(&self, faction: crate::FactionId, flag: EffectFlag) -> bool {
        catalog::has_flag(self, faction, flag)
    }
}

pub(crate) fn grant(
    k: &crate::statics::MatchStatic,
    w: &mut crate::state::World,
    id: crate::PlayerId,
    card: CardId,
) -> bool {
    let Some(i) = w.idx(id) else { return false };
    if !w.players[i].build.add(card) {
        return false;
    }
    crate::modifiers::recompute(k, w, crate::fighter::FighterIx::of_slot(i));
    crate::modifiers::sync_max_hp(&mut w.players[i]);
    true
}

pub(crate) fn on_blocked(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    hooks::on_blocked(hx, args);
}

pub(crate) fn on_hit_landed(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    hooks::on_hit_landed(hx, args);
}

pub(crate) fn on_overkilled(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    hooks::on_overkilled(hx, args);
}

pub(crate) fn after_damage(cx: &mut crate::systems::Cx) {
    hooks::after_damage(cx);
}

pub(crate) fn reset_fight(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    hooks::reset_fight(hx, args);
}

pub(crate) fn drop_deferred(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    hooks::drop_deferred(hx, args);
}

pub(crate) fn flush_bleeds(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    hooks::flush_bleeds(hx, args);
}

pub(crate) mod hooks;
pub mod runtime;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stat_fold::{EffectFlag, MultKey, MultSums};

    #[test]
    fn catalog_keeps_the_supported_offer_numbers() {
        assert_eq!(CardId::ALL.len(), 80);
        assert_eq!(CardId::SlowBurn.tier(), 1);
        assert_eq!(CardId::PocketSand.tier(), 1);
        assert_eq!(CardId::Siphon.tier(), 2);
        let mut build = Build::default();
        assert!(build.add(CardId::SlowBurn));
        assert!(build.add(CardId::Siphon));
        assert!(!build.add(CardId::SlowBurn));
        let mut rows = [crate::stat_fold::EffectRow::new(crate::stat_fold::EffectKind::Flag {
            flag: EffectFlag::NoCrit,
        }); 16];
        let rows = catalog::write_fold_rows(&build, crate::FactionId::Holy, &mut rows);
        let folded = crate::stat_fold::fold_rows(rows, &Default::default());
        assert_eq!(folded.mults.get(MultKey::Linger), 2.);
        assert_eq!(folded.mults.get(MultKey::Dot), 0.7);
        assert_eq!(
            folded.sums.get(crate::stat_fold::StatKey::LifestealDot),
            0.2
        );
        assert!(!build.has_flag(crate::FactionId::Holy, EffectFlag::NoCrit));
        let _ = MultSums::default();
    }

    #[test]
    fn bases_stack_and_power_uses_tier_times_count() {
        let mut build = Build::default();
        for _ in 0..5 {
            assert!(build.add(CardId::Vitality3));
        }
        assert_eq!(build.count(CardId::Vitality3), 5);
        assert_eq!(build.power(), f64::from(CardId::Vitality3.tier()) * 5.);
        assert_eq!(build.cards().count(), 5);
    }

    #[test]
    fn gallows_patience_is_a_flag_on_the_same_build() {
        let mut build = Build::default();
        build.add(CardId::GallowsPatience);
        assert!(build.has_flag(crate::FactionId::Sentenced, EffectFlag::GallowsPatience));
    }
}
