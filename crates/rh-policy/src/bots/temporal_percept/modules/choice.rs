//! Complete source card-choice leaves (`bots/chestHunt.ts` costsSomething/activeWeapon/cardScore/optionScore/
//! chooseOption) over the admitted immutable static card/kill-augment/boost format leaves.
//!
//! Source-exact: the catalog is the admitted `rh-sim` static 80-card table (never mutated), a boost id resolves through
//! the admitted `BoostId` spellings, a trophy id through the admitted `kill_augments::parse`, unknown ids score 0 and
//! unusable ids `-Infinity` (bit-preserved). No PlayerRefs, no world read, no state: every leaf is a pure function of
//! the declared source input.

use super::types::{CardCounts, ChestSelf, CHEST_BOOST_MAX_PICKS, DANGER_RISK, TRADEOFF_RISK};
use rh_sim::cards::{BaseStatId, CardDef, CardId, CardKind, CardRow, MechanicTag};
use rh_sim::kill_augments::{self, KillStatKey};
use rh_sim::reward_chests::BoostId;
use rh_sim::stat_fold::{EffectFlag, EffectKind, EffectStat, MultKey};
use rh_sim::WeaponId;

/// The three catalog-tier card ids of a base stat (source `baseCardId`), in tier order.
pub(crate) fn base_card_ids(base: &str) -> [String; 3] {
    [format!("{base}1"), format!("{base}2"), format!("{base}3")]
}

/// Source `BaseStatId` -> the source spelling `baseFit`/`ownsBase` key on.
fn base_name(base: BaseStatId) -> &'static str {
    match base {
        BaseStatId::Ad => "ad",
        BaseStatId::Ap => "ap",
        BaseStatId::Haste => "haste",
        BaseStatId::Vitality => "vitality",
        BaseStatId::Armor => "armor",
        BaseStatId::Mr => "mr",
        BaseStatId::Leech => "leech",
        BaseStatId::Fleet => "fleet",
    }
}

/// Source `chestBoostStat` over the admitted boost spellings: the source suffix (`ad`, `shield`, ...).
fn boost_stat(id: &str) -> Option<BoostId> {
    BoostId::ALL.into_iter().find(|boost| boost.as_str() == id)
}

/// Source `cardDef(id)` over the admitted static catalog: `undefined` becomes `None`, no catalog mutation.
fn card_def(id: &str) -> Option<&'static CardDef> {
    CardId::ALL
        .into_iter()
        .map(CardId::definition)
        .find(|def| def.id.as_str() == id)
}

/// Source `KILL_BASE[key] ?? "ad"`.
fn kill_base_name(key: KillStatKey) -> &'static str {
    match key {
        KillStatKey::Ad => "ad",
        KillStatKey::Ap => "ap",
        KillStatKey::Damage => "ad",
        KillStatKey::Health => "vitality",
        KillStatKey::AttackSpeed => "haste",
        KillStatKey::Armor => "armor",
        KillStatKey::Mr => "mr",
        KillStatKey::Speed => "fleet",
        KillStatKey::Leech => "leech",
    }
}

/// The boost's `baseFit` key: a shield boost resembles Soul Defense (`boost === "shield" ? "mr" : boost`).
fn boost_base_name(boost: BoostId) -> &'static str {
    match boost {
        BoostId::Ad => "ad",
        BoostId::Ap => "ap",
        BoostId::Armor => "armor",
        // Handled explicitly by the caller before this spelling is used.
        BoostId::Shield => "mr",
        BoostId::MaxHp => "maxHp",
        BoostId::AttackSpeed => "attackSpeed",
        BoostId::MoveSpeed => "moveSpeed",
        BoostId::Lifesteal => "lifesteal",
    }
}

/// Source `AD_WEAPONS`: weapons whose hits scale with attack damage.
const AD_WEAPONS: [WeaponId; 3] = [WeaponId::Sword, WeaponId::Axe, WeaponId::Bow];
/// Source `MELEE_WEAPONS`.
const MELEE_WEAPONS: [WeaponId; 4] = [
    WeaponId::Sword,
    WeaponId::Axe,
    WeaponId::Shield,
    WeaponId::Fists,
];
/// Source `DOT_FACTIONS`: AP feeds their signature damage over time whatever the weapon.
const DOT_FACTIONS: [&str; 3] = ["fire", "sentenced", "plague"];

/// Does the card give up something for its power (a stat row that hurts, a multiplier under 1, a cost flag)?
pub(crate) fn costs_something(id: &str) -> bool {
    card_def(id).is_some_and(costs_something_def)
}

fn costs_something_def(def: &CardDef) -> bool {
    def.rows.iter().any(|row| match row {
        CardRow::Fold(EffectKind::Stat { stat, v }) => match stat {
            EffectStat::Windup | EffectStat::DamageTaken | EffectStat::Cooldown => *v > 0.,
            _ => *v < 0.,
        },
        CardRow::Fold(EffectKind::Mult { key, v }) => {
            *v < 1. || matches!(key, MultKey::WishCooldown | MultKey::HpRace)
        }
        CardRow::Fold(EffectKind::Flag { flag }) => matches!(
            flag,
            EffectFlag::LockSecondSlot | EffectFlag::NoCrit | EffectFlag::Gambler
        ),
        _ => false,
    })
}

/// Source `activeWeapon`: the slot in hand, fists for an empty one.
pub(crate) fn active_weapon(self_: &ChestSelf) -> WeaponId {
    self_
        .weapons
        .get(usize::from(self_.slot_or_zero()))
        .copied()
        .flatten()
        .unwrap_or(WeaponId::Fists)
}

/// Source `baseFit`: how well a base stat suits the weapon in hand (and the faction, for AP).
fn base_fit(base: &str, weapon: WeaponId, faction: &str) -> f64 {
    match base {
        "ad" => {
            if AD_WEAPONS.contains(&weapon) {
                1.
            } else if weapon == WeaponId::Fists {
                0.5
            } else if weapon == WeaponId::Wand {
                -0.5
            } else {
                -1.
            }
        }
        "ap" => {
            if weapon == WeaponId::Wand {
                1.
            } else if weapon == WeaponId::Fists {
                0.5
            } else if DOT_FACTIONS.contains(&faction) {
                0.
            } else {
                -1.
            }
        }
        "armor" | "mr" => {
            if weapon == WeaponId::Shield {
                1.
            } else {
                0.
            }
        }
        // Fleet is off while shooting: the ranged weapons get little from it.
        "fleet" if weapon == WeaponId::Bow || weapon == WeaponId::Wand => -0.5,
        "fleet" => 0.,
        _ => 0.,
    }
}

/// Source `ruleFit`: how well an augment or conditional suits the weapon in hand and the faction.
fn rule_fit(def: &CardDef, weapon: WeaponId, faction: &str, carried: f64) -> f64 {
    let mut fit = 0.;
    for tag in def.tags {
        match tag {
            MechanicTag::Physical => {
                fit += if AD_WEAPONS.contains(&weapon) {
                    0.5
                } else if weapon == WeaponId::Wand {
                    -0.5
                } else {
                    0.
                };
            }
            MechanicTag::Magic => {
                fit += if weapon == WeaponId::Wand {
                    0.5
                } else if weapon == WeaponId::Fists {
                    0.25
                } else {
                    -0.25
                };
            }
            MechanicTag::Block => {
                fit += if weapon == WeaponId::Shield { 1. } else { -1. };
            }
            MechanicTag::Ramping => {
                // Only the mark ramps.
                fit += if faction == "sentenced" { 1. } else { -2. };
            }
            MechanicTag::Slow => {
                fit += if faction == "frost" { 1. } else { 0. };
            }
            _ => {}
        }
    }
    if def.id == CardId::FistsOfFury {
        fit += if weapon == WeaponId::Fists { 2. } else { -3. };
    }
    if def.id == CardId::Quickdraw {
        fit += if MELEE_WEAPONS.contains(&weapon) {
            1.
        } else {
            -1.
        };
    }
    if def.id == CardId::Committed && carried > 1. {
        // It locks the second slot the bot is using.
        fit -= 2.;
    }
    fit
}

/// Source `cardBlock`: a conditional without its base, or a unique card already held, cannot be picked.
fn card_block(def: &CardDef, build: Option<&CardCounts>) -> bool {
    if def.kind == CardKind::Conditional {
        if let Some(requires) = def.requires {
            let owned = build.is_some_and(|counts| counts.owns_base(base_name(requires)));
            if !owned {
                return true;
            }
        }
    }
    if def.unique {
        let held = build.map_or(0., |counts| counts.count_in(def.id.as_str()));
        if held > 0. {
            return true;
        }
    }
    false
}

/// Source `Math.min(1, Math.max(0, risk))`: `f64::clamp` keeps the JavaScript NaN propagation (a NaN input is NaN).
fn clamp_risk(risk: f64) -> f64 {
    risk.clamp(0., 1.)
}

/// Source `cardScore`: how much a free option is worth to this bot (`-Infinity` unusable, 0 for an unknown id).
pub(crate) fn card_score(id: &str, self_: &ChestSelf) -> f64 {
    if let Some(boost) = boost_stat(id) {
        // The raw source build count is compared, never a floored count: a fourth pick is refused.
        let picks = self_.build.as_ref().map_or(0., |build| build.count(id));
        if picks >= CHEST_BOOST_MAX_PICKS {
            return f64::NEG_INFINITY;
        }
        let base = if boost == BoostId::Shield {
            "mr"
        } else {
            boost_base_name(boost)
        };
        return 2.5 + base_fit(base, active_weapon(self_), &self_.faction);
    }
    let def = card_def(id);
    let kill = kill_augments::parse(id);
    if def.is_none() {
        if let Some(kill) = kill {
            // A victim's stat beats a chest card.
            return 3.
                + base_fit(
                    kill_base_name(kill.key),
                    active_weapon(self_),
                    &self_.faction,
                );
        }
        // An id the catalog does not know (newer server content): still takeable.
        return 0.;
    }
    let def = def.expect("checked above");
    if card_block(def, self_.build.as_ref()) {
        return f64::NEG_INFINITY;
    }
    let weapon = active_weapon(self_);
    let risk = self_.risk.unwrap_or(0.5);
    let carried = self_.weapons.iter().filter(|slot| slot.is_some()).count() as f64;
    match def.kind {
        CardKind::Base => {
            let owned = def.base.is_some_and(|base| {
                self_
                    .build
                    .as_ref()
                    .is_some_and(|build| build.owns_base(base_name(base)))
            });
            let fit = def
                .base
                .map_or(0., |base| base_fit(base_name(base), weapon, &self_.faction));
            if owned {
                3. + f64::from(def.tier) + fit
            } else {
                1.5 + f64::from(def.tier) + fit
            }
        }
        CardKind::Conditional => {
            4. + f64::from(def.tier) + rule_fit(def, weapon, &self_.faction, carried)
        }
        CardKind::Augment => {
            let dangerous = matches!(def.id, CardId::RaceToZero | CardId::GlassCannon);
            // Source `!(risk > DANGER_RISK)`: a NaN risk is not greater, so the dangerous card stays refused.
            if dangerous && risk.partial_cmp(&DANGER_RISK) != Some(std::cmp::Ordering::Greater) {
                return f64::NEG_INFINITY;
            }
            if costs_something_def(def) && risk < TRADEOFF_RISK {
                return f64::NEG_INFINITY;
            }
            f64::from(def.tier)
                + 1.
                + 2. * clamp_risk(risk)
                + rule_fit(def, weapon, &self_.faction, carried)
        }
    }
}

/// Source `optionScore` (the first version's name; the same function).
pub(crate) fn option_score(id: &str, self_: &ChestSelf) -> f64 {
    card_score(id, self_)
}

/// Source `chooseOption`: the best-scoring free usable option index, first of equals; -1 to skip.
pub(crate) fn choose_option(options: &[String], taken_by: &[String], self_: &ChestSelf) -> i64 {
    let mut best: i64 = -1;
    let mut best_score = f64::NEG_INFINITY;
    for (index, id) in options.iter().enumerate() {
        if !taken_by
            .get(index)
            .map_or("", |taken| taken.as_str())
            .is_empty()
        {
            continue;
        }
        let score = card_score(id, self_);
        if score == f64::NEG_INFINITY {
            continue;
        }
        if score > best_score {
            best = index as i64;
            best_score = score;
        }
    }
    best
}

/// The source boost cap as an exact f64 compare (raw build count, not floored).
pub(crate) const BOOST_CAP: f64 = CHEST_BOOST_MAX_PICKS;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bots::temporal_percept::modules::types::CardCounts;

    fn self_() -> ChestSelf {
        ChestSelf {
            faction: "fire".into(),
            weapons: [Some(WeaponId::Sword), None],
            slot: None,
            risk: None,
            build: Some(CardCounts::default()),
        }
    }

    fn build(entries: &[(&str, f64)]) -> CardCounts {
        let mut counts = CardCounts::default();
        for (id, count) in entries {
            counts.set(*id, *count);
        }
        counts
    }

    #[test]
    fn base_cards_deepen_and_new_stats_keep_the_source_weights() {
        // Sword fits AD (+1): a new tier-I base scores 1.5 + 1 + 1.
        assert_eq!(card_score("ad1", &self_()), 3.5);
        // Haste does not fit a sword: 1.5 + 1 + 0.
        assert_eq!(card_score("haste1", &self_()), 2.5);
        // Owning any tier deepens: +3 instead of +1.5.
        let mut own = self_();
        own.build = Some(build(&[("ad2", 1.)]));
        assert_eq!(card_score("ad1", &own), 5.);
        // An off-hand weapon in slot 1 is the active one (fists there: 1.5 + 1 + 0.5).
        let mut slot = self_();
        slot.weapons = [Some(WeaponId::Sword), None];
        slot.slot = Some(1);
        assert_eq!(active_weapon(&slot), WeaponId::Fists);
        assert_eq!(card_score("ad1", &slot), 3.);
    }

    #[test]
    fn option_score_is_the_old_name_of_card_score() {
        let me = self_();
        for id in ["ad1", "committed", "glassCannon", "unknown-card"] {
            assert_eq!(option_score(id, &me), card_score(id, &me));
        }
    }

    #[test]
    fn costs_something_reads_the_actual_catalog_rows() {
        // A cost flag, a hurting stat row and a doubled Wish cooldown.
        assert!(costs_something("committed"));
        assert!(costs_something("glassCannon"));
        assert!(costs_something("thickSkull"));
        assert!(costs_something("raceToZero"));
        // A plain base card and an unknown id give nothing up.
        assert!(!costs_something("ad1"));
        assert!(!costs_something("unknown-card"));
    }

    #[test]
    fn tradeoff_risk_boundary_is_strict() {
        // Committed gives something up: refused below 0.5, taken at exactly 0.5.
        let mut below = self_();
        below.risk = Some(0.499999);
        assert_eq!(card_score("committed", &below), f64::NEG_INFINITY);
        let mut at = self_();
        at.risk = Some(0.5);
        // tier 3 + 1 + 2 * 0.5 + fit (LockSecondSlot is not a tag: fit 0).
        assert_eq!(card_score("committed", &at), 5.);
    }

    #[test]
    fn danger_risk_boundary_is_strict() {
        // Glass Cannon is refused at or below 0.7 and taken above it.
        let mut at = self_();
        at.risk = Some(0.7);
        assert_eq!(card_score("glassCannon", &at), f64::NEG_INFINITY);
        let mut above = self_();
        above.risk = Some(0.700001);
        let score = card_score("glassCannon", &above);
        assert!(score.is_finite(), "{score}");
        // A Race to 0 is the second dangerous card.
        let mut race = self_();
        race.risk = Some(0.7);
        assert_eq!(card_score("raceToZero", &race), f64::NEG_INFINITY);
    }

    #[test]
    fn boost_picks_are_capped_on_the_raw_build_count() {
        let with = |picks: f64| {
            let mut me = self_();
            me.build = Some(build(&[("boost:ad", picks)]));
            me
        };
        // boost:ad is a stat boost: 2.5 + baseFit("ad", sword, fire) = 3.5.
        assert_eq!(card_score("boost:ad", &with(0.)), 3.5);
        assert_eq!(card_score("boost:ad", &with(2.)), 3.5);
        assert_eq!(card_score("boost:ad", &with(2.999999)), 3.5);
        assert_eq!(card_score("boost:ad", &with(3.)), f64::NEG_INFINITY);
        // A shield boost resembles mr: a sword gets nothing (2.5 + 0).
        assert_eq!(card_score("boost:shield", &self_()), 2.5);
    }

    #[test]
    fn kill_augments_map_to_the_source_base_fits() {
        // damage -> ad: 3 + 1 (sword); health -> vitality: 3 + 0; speed -> fleet: 3 + 0 on a sword.
        assert_eq!(card_score("kill:damage:10", &self_()), 4.);
        assert_eq!(card_score("kill:health:10", &self_()), 3.);
        assert_eq!(card_score("kill:speed:1", &self_()), 3.);
        // Unknown id: takeable for 0.
        assert_eq!(card_score("kill:notAStat:1", &self_()), 0.);
        assert_eq!(card_score("not-a-card", &self_()), 0.);
    }

    #[test]
    fn choose_option_first_of_equals_and_skips_taken_or_unusable() {
        let me = self_();
        // Equal scores: the first one wins.
        assert_eq!(choose_option(&["ad1".into(), "ad1".into()], &[], &me), 0);
        // A taken option is skipped by its index (empty string = free).
        assert_eq!(
            choose_option(&["ad1".into(), "ad2".into()], &["me".into()], &me),
            1
        );
        assert_eq!(
            choose_option(&["ad2".into(), "ad1".into()], &["".into()], &me),
            0
        );
        assert_eq!(
            choose_option(&["ad2".into(), "ad1".into()], &["x".into()], &me),
            1
        );
        // An unknown id (0) beats nothing and loses to a real card.
        assert_eq!(choose_option(&["future".into(), "ad1".into()], &[], &me), 1);
        // Empty and all-refused options skip.
        assert_eq!(choose_option(&[], &[], &me), -1);
        assert_eq!(choose_option(&["?".into()], &["x".into()], &me), -1);
    }
}
