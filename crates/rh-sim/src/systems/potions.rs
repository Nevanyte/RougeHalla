//! Source Small potion pickup/use/Hot subresponsibility at existing source schedule positions.
use super::Cx;
use crate::{
    potions::{Healing, Hot, Notice, Size, DEFINITION},
    Event, PlayerId,
};
fn notice(ev: &mut Vec<Event>, id: PlayerId, kind: Notice) {
    ev.push(Event::PotionNotice { id, notice: kind });
}
/// Stores one potion of `size` (legacy `grantConsumable`): false when the fighter is not standing or that stock is full.
pub(crate) fn grant(
    w: &mut crate::state::World,
    ev: &mut Vec<Event>,
    id: PlayerId,
    size: Size,
) -> bool {
    let Some(i) = w.idx(id) else { return false };
    if !w.players[i].standing() {
        return false;
    }
    let stock = match size {
        Size::Small => &mut w.players[i].potion_small,
        Size::Large => &mut w.players[i].potion_large,
    };
    if *stock >= DEFINITION.cap {
        return false;
    }
    *stock += 1;
    notice(
        ev,
        id,
        match size {
            Size::Small => Notice::Stored,
            Size::Large => Notice::LargeStored,
        },
    );
    true
}
pub(crate) fn use_potion(
    cx: &mut Cx,
    ix: crate::fighter::FighterIx,
    cmd: &crate::input::ActionCmd,
) {
    if !matches!(cmd, crate::input::ActionCmd::UseConsumable)
        || !cx.w.is_player(ix)
        || !cx.w.standing(ix)
    {
        return;
    }
    let i = ix.slot();
    let p = &cx.w.players[i];
    let id = p.id;
    let now = cx.w.server_time;
    let active = cx.w.potion_healing.iter().position(|e| e.id == id);
    let count = active.map_or(0, |j| cx.w.potion_healing[j].hots.len());
    let large = p.potion_large > 0;
    let refusal = if crate::status_runtime::action_blocked(&p.statuses, now) {
        Some(Notice::Blocked)
    } else if count >= usize::from(DEFINITION.concurrent) {
        Some(Notice::Busy)
    } else if p.vitals.hp >= p.vitals.max_hp {
        Some(Notice::Full)
    } else if p.potion_large == 0 && p.potion_small == 0 {
        Some(Notice::Empty)
    } else {
        None
    };
    if let Some(reason) = refusal {
        notice(cx.ev, id, reason);
        return;
    }
    // The camp potion is preferred when both are stored (legacy `const large = s.potionLarge > 0`).
    let share = if large {
        DEFINITION.large_share
    } else {
        DEFINITION.small_share
    };
    let amount = p.vitals.max_hp * share / (DEFINITION.heal_ms / DEFINITION.step_ms);
    if large {
        cx.w.players[i].potion_large -= 1;
    } else {
        cx.w.players[i].potion_small -= 1;
    }
    cx.w.players[i].healing_until = now + DEFINITION.heal_ms;
    let at = active.unwrap_or_else(|| {
        let j = cx.w.potion_healing.len();
        cx.w.potion_healing.push(Healing {
            id,
            hots: Vec::with_capacity(usize::from(DEFINITION.concurrent)),
        });
        j
    });
    cx.w.potion_healing[at].hots.push(Hot {
        next: now + DEFINITION.step_ms,
        left: (DEFINITION.heal_ms / DEFINITION.step_ms) as u8,
        amount,
    });
    cx.w.players[i].potions_healing = cx.w.potion_healing[at].hots.len() as u8;
    notice(
        cx.ev,
        id,
        if large {
            Notice::LargeUsed
        } else {
            Notice::Used
        },
    );
}
pub(crate) fn update(cx: &mut Cx) {
    let now = cx.w.server_time;
    let mut i = 0;
    while i < cx.w.potion_healing.len() {
        let id = cx.w.potion_healing[i].id;
        let slot = cx.w.idx(id);
        if slot.is_none_or(|s| !cx.w.players[s].standing()) {
            if let Some(s) = slot {
                cx.w.players[s].healing_until = 0.;
                cx.w.players[s].potions_healing = 0;
            }
            cx.w.potion_healing.remove(i);
            continue;
        }
        let s = slot.unwrap();
        for j in 0..cx.w.potion_healing[i].hots.len() {
            while cx.w.potion_healing[i].hots[j].left > 0
                && now >= cx.w.potion_healing[i].hots[j].next
            {
                let amount = cx.w.potion_healing[i].hots[j].amount;
                super::heal::apply(cx.w, cx.ev, s, amount, super::heal::Kind::IgnoreLockout);
                cx.w.potion_healing[i].hots[j].left -= 1;
                cx.w.potion_healing[i].hots[j].next += DEFINITION.step_ms;
            }
        }
        cx.w.potion_healing[i].hots.retain(|h| h.left > 0);
        let len = cx.w.potion_healing[i].hots.len();
        cx.w.players[s].potions_healing = len as u8;
        if len == 0 {
            cx.w.players[s].healing_until = 0.;
            cx.w.potion_healing.remove(i);
        } else {
            i += 1
        }
    }
}
pub(crate) fn fighter_out(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    if let crate::hooks::HookArgs::FighterOut { id, .. } = *args {
        if let Some(j) = hx.w.potion_healing.iter().position(|e| e.id == id) {
            hx.w.potion_healing.remove(j);
        }
        if let Some(i) = hx.w.idx(id) {
            hx.w.players[i].healing_until = 0.;
            hx.w.players[i].potions_healing = 0;
        }
    }
}
pub(crate) fn validate(w: &crate::state::World) -> Result<(), String> {
    for (j, e) in w.potion_healing.iter().enumerate() {
        let i = w.idx(e.id).ok_or("potion owner missing")?;
        if e.hots.is_empty()
            || e.hots.len() > usize::from(DEFINITION.concurrent)
            || w.potion_healing[..j].iter().any(|p| p.id == e.id)
            || (!w.players[i].standing()
                && !(w.phase == crate::Phase::Ended && w.players[i].status == crate::Status::Alive))
        {
            return Err("invalid potion owner/order".into());
        }
        for h in &e.hots {
            if h.left == 0
                || f64::from(h.left) > DEFINITION.heal_ms / DEFINITION.step_ms
                || !h.next.is_finite()
                || (w.phase != crate::Phase::Ended && h.next <= w.server_time)
                || h.next < 0.
                || h.next > w.server_time + DEFINITION.step_ms
                || !h.amount.is_finite()
                || h.amount <= 0.
                || h.amount
                    > w.players[i].vitals.max_hp
                        * DEFINITION.large_share.max(DEFINITION.small_share)
                        / (DEFINITION.heal_ms / DEFINITION.step_ms)
            {
                return Err("invalid potion Hot".into());
            }
        }
        let p = &w.players[i];
        if usize::from(p.potions_healing) != e.hots.len()
            || p.healing_until
                != e.hots.last().unwrap().next
                    + f64::from(e.hots.last().unwrap().left - 1) * DEFINITION.step_ms
        {
            return Err("potion mirror mismatch".into());
        }
    }
    for p in &w.players {
        if p.potion_small > DEFINITION.cap
            || p.potion_large > DEFINITION.cap
            || (!w.potion_healing.iter().any(|e| e.id == p.id)
                && (p.potions_healing != 0 || p.healing_until != 0.))
        {
            return Err("invalid potion inventory/mirrors".into());
        }
    }
    Ok(())
}
#[cfg(test)]
#[path = "potions_tests.rs"]
mod tests;
