//! Derived quest payout plan and narrow application through the existing authoritative GV/farm paths. The plan does not
//! grant historical reward cards, introduce deferred payouts or change exact event order.
use super::catalog::Def;
use super::rules;
use crate::events::Event;
use crate::mob_catalog::MobTypeId;
use crate::state::{PlayerId, World};
use crate::statics::MatchStatic;

#[derive(Clone, Copy, Debug)]
pub(crate) struct Plan {
    pub(crate) gv: u16,
    pub(crate) stat: MobTypeId,
    pub(crate) stacks: u64,
}

impl Plan {
    pub(crate) fn lower(def: &Def) -> Self {
        let (stat, stacks) = rules::reward_stats(def);
        Self {
            gv: def.reward_gv,
            stat,
            stacks,
        }
    }
}

/// Apply exactly the existing two reward channels in source order: capped quest GV, then the actual mob-stat grant and
/// its gain notice when any stacks were gained. Completion/retirement and the completion notices remain in live.rs.
pub(crate) fn apply(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    player_i: usize,
    id: PlayerId,
    plan: Plan,
) {
    if !crate::schedule::Gates::of(k).training {
        let room = crate::constants::QUEST_GV_CAP
            .saturating_sub(w.players[player_i].credit.gv_parts.quest);
        let amount = u32::from(plan.gv).min(room);
        if amount > 0 {
            let p = &mut w.players[player_i];
            p.credit.gv_parts.quest = p.credit.gv_parts.quest.saturating_add(amount);
            p.credit.gv = p
                .credit
                .gv_parts
                .kills
                .saturating_add(p.credit.gv_parts.mobs)
                .saturating_add(p.credit.gv_parts.bounty)
                .saturating_add(p.credit.gv_parts.quest);
            ev.push(Event::Gv {
                id,
                amount,
                reason: crate::results::GvReason::Quest,
            });
        }
    }
    let gained = crate::modifiers::grant_mob_stat(k, w, id, plan.stat, plan.stacks);
    if gained > 0 {
        super::notices::owner(
            ev,
            id,
            crate::modifiers::farm_text::grant_notice(
                plan.stat,
                gained,
                w.players[player_i].farm.count(plan.stat),
            ),
        );
    }
}
