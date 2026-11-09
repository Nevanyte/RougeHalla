//! Leaf mutations with ledger freeze and the real hook boundary.
use super::super::ledger::{pay_later_with, PayLater};
use crate::status_runtime::stats::Inputs;
use crate::{
    events::Event,
    hooks::{self, HookArgs, Hx},
    state::{PlayerId, World},
    statics::MatchStatic,
    status_runtime::{
        self as rt, Applied, Recipient, Selector, StatusApply, StatusInstance, StatusKind,
    },
};

#[cfg(test)]
pub(crate) fn apply(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    id: PlayerId,
    a: StatusApply,
    quiet: bool,
) -> Option<Applied> {
    apply_with(k, w, ev, id, a, quiet, Inputs::default())
}
pub(crate) fn apply_with(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    id: PlayerId,
    a: StatusApply,
    quiet: bool,
    stats: Inputs,
) -> Option<Applied> {
    let i = w.fighter_idx(id)?;
    if !rt::admits(
        &a,
        if w.is_player(i) {
            Recipient::Player
        } else if crate::quests::giver::is_giver(w, id) {
            Recipient::QuestGiver
        } else {
            Recipient::Mob
        },
        w.standing(i),
    ) {
        return None;
    }
    if w.pay.collecting {
        pay_later_with(
            k,
            w,
            ev,
            PayLater::ApplyStatus {
                victim: id,
                apply: a,
                quiet,
            },
            stats,
        );
        return None;
    }
    let now = w.server_time;
    let kind = a.kind;
    let by = a.source.id;
    let result = rt::apply(&mut w.core_mut(i).statuses, now, a);
    let until = w.core(i).statuses.instances[result.index].until;
    if kind == StatusKind::Invulnerable {
        w.core_mut(i).vitals.immune_until = w.core(i).vitals.immune_until.max(until);
    }
    if result.fresh && !quiet {
        ev.push(Event::StatusApplied {
            id,
            kind,
            ms: until - now,
            by,
        });
    }
    hooks::fire(
        &mut Hx {
            stats,
            k,
            w,
            ev,
            fx: None,
        },
        HookArgs::StatusApplied {
            id,
            kind,
            fresh: result.fresh,
            index: result.index,
        },
    );
    Some(result)
}

/// The caller owns its reusable result buffer. Queued removals return no new rows.
#[cfg(test)]
pub(crate) fn remove_into(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    id: PlayerId,
    selector: Selector,
    out: &mut Vec<StatusInstance>,
) {
    remove_into_with(k, w, ev, id, selector, out, Inputs::default())
}
pub(crate) fn remove_into_with(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    id: PlayerId,
    selector: Selector,
    out: &mut Vec<StatusInstance>,
    stats: Inputs,
) {
    if w.pay.collecting {
        pay_later_with(
            k,
            w,
            ev,
            PayLater::RemoveStatuses {
                victim: id,
                selector,
            },
            stats,
        );
        return;
    }
    let now = w.server_time;
    let Some(i) = w.fighter_idx(id) else { return };
    let slow = rt::remove_into(&mut w.core_mut(i).statuses, now, selector, out);
    if slow {
        super::refold_attack_with(k, w, i.slot(), stats);
    }
}
/// A queued bare removal has no consumer for the source's returned rows.
pub(crate) fn remove_discard_with(
    k: &MatchStatic,
    w: &mut World,
    id: PlayerId,
    selector: Selector,
    stats: Inputs,
) {
    if w.pay.collecting {
        w.pay.items.push(super::super::ledger::Payout::Ordinary(
            PayLater::RemoveStatuses {
                victim: id,
                selector,
            },
        ));
        return;
    }
    let now = w.server_time;
    let Some(i) = w.fighter_idx(id) else { return };
    let p = w.core_mut(i);
    let mut slow = false;
    let mut removed = false;
    p.statuses.instances.retain(|st| {
        let hit = selector.matches(st);
        if hit {
            removed = true;
            slow |= st.kind == StatusKind::SlowAttack
        }
        !hit
    });
    if removed {
        p.statuses.refresh_effects(now)
    }
    if slow {
        super::refold_attack_with(k, w, i.slot(), stats);
    }
}
