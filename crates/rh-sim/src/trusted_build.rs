//! Trusted build setup for headless benches (feature `trusted-build-setup`, never in a server build): gives a seated
//! fighter cards, normal-mob stat stacks and chest stat boosts between steps, with the grant rules of legacy
//! `grantCard` (`packages/server/src/sim/chests.ts:189`). Not an input path (C-INPUT): no command reaches it.
//! No RNG draw, no event. Packet P-SIM-BENCH-SEAM-1.
use crate::cards::CardId;
use crate::mob_catalog::MobTypeId;
use crate::reward_chests::BoostId;
use crate::{PlayerId, Sim};

/// What to add to one fighter's build, in request order.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct TrustedBuild {
    /// Card copies to add (a unique card at most once in all).
    pub cards: Vec<(CardId, u8)>,
    /// Normal-mob stat stacks to add (`Player::farm`), by the mob type that pays them.
    pub stacks: Vec<(MobTypeId, u64)>,
    /// Chest stat boost picks to add (`Build::boosts`).
    pub boosts: Vec<(BoostId, u8)>,
}

/// Why a request was refused. A refused request changes nothing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BuildRefusal {
    /// No seated player has this id.
    NoSuchPlayer(PlayerId),
    /// The player is not standing (dead, down or resolved).
    NotStanding(PlayerId),
    /// A unique card already held, or asked for more than once.
    UniqueHeld(CardId),
    /// A conditional card without a base card of its `requires` held before it.
    NeedsBase(CardId),
    /// A card count past 255.
    CardCount(CardId),
    /// A mob type that pays no stat stacks (an elite, a quest giver).
    NotNormalMob(MobTypeId),
    /// A stack total past the farm's maximum count.
    StacksOverMax(MobTypeId),
    /// A boost total past the chest's pick cap.
    BoostOverCap(BoostId),
    /// P-AUG-NATIVE-1b: a native card (`CardId::NATIVE`) in a world whose card table is not `Rework`.
    NativeOutsideRework(CardId),
}

/// Adds `build` to the seated fighter `id`, between steps only: all or nothing, then one re-fold and max hp following.
pub fn apply(sim: &mut Sim, id: PlayerId, build: &TrustedBuild) -> Result<(), BuildRefusal> {
    let i = sim.w.idx(id).ok_or(BuildRefusal::NoSuchPlayer(id))?;
    if !sim.w.players[i].standing() {
        return Err(BuildRefusal::NotStanding(id));
    }
    // Check everything against copies; the world is written only once the whole request passes.
    let mut cards = sim.w.players[i].build;
    let mut farm = sim.w.players[i].farm;
    let mut changed = false;
    for &(card, add) in &build.cards {
        if add == 0 {
            continue;
        }
        // P-AUG-NATIVE-1b: a native card exists only under the Rework card table (`check_world` refuses it elsewhere).
        if crate::cards::native::is_native(card) && sim.k.cards.rule() != crate::AugmentRule::Rework
        {
            return Err(BuildRefusal::NativeOutsideRework(card));
        }
        let def = card.definition();
        // Legacy `cardBlock`: a unique card already held (or asked twice), then a conditional without its base.
        if def.unique && (cards.owns(card) || add > 1) {
            return Err(BuildRefusal::UniqueHeld(card));
        }
        if def.requires.is_some_and(|req| {
            !crate::cards::CardId::ALL
                .iter()
                .any(|base| base.definition().base == Some(req) && cards.owns(*base))
        }) {
            return Err(BuildRefusal::NeedsBase(card));
        }
        let count = cards
            .count(card)
            .checked_add(add)
            .ok_or(BuildRefusal::CardCount(card))?;
        cards.set(card, count);
        changed = true;
    }
    let max_count = crate::modifiers::farm::DEFINITION.max_count;
    for &(mob, add) in &build.stacks {
        if crate::modifiers::farm::Farm::reward_of(mob).is_none() {
            return Err(BuildRefusal::NotNormalMob(mob));
        }
        if add == 0 {
            continue;
        }
        let have = farm.count(mob);
        if add > max_count.saturating_sub(have) {
            return Err(BuildRefusal::StacksOverMax(mob));
        }
        farm.set(mob, have + add);
        changed = true;
    }
    let cap = crate::stat_fold::default_definition().chest_boost_max_picks;
    for &(boost, add) in &build.boosts {
        if add == 0 {
            continue;
        }
        let slot = &mut cards.boosts[boost.index()];
        let total = u32::from(*slot) + u32::from(add);
        if total > cap {
            return Err(BuildRefusal::BoostOverCap(boost));
        }
        *slot = u8::try_from(total).map_err(|_| BuildRefusal::BoostOverCap(boost))?;
        changed = true;
    }
    if !changed {
        return Ok(());
    }
    // The chest pick's and credited kill's order: counts, one re-fold, then max hp follows the fold.
    sim.w.players[i].build = cards;
    sim.w.players[i].farm = farm;
    crate::modifiers::recompute(&sim.k, &mut sim.w, crate::fighter::FighterIx::of_slot(i));
    crate::modifiers::sync_max_hp(&mut sim.w.players[i]);
    // The build-mark cache was exact as of the last step; its inputs just changed outside one.
    sim.projection.marks = Default::default();
    Ok(())
}
