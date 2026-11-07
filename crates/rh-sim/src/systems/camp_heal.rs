//! The camp-clear reward (legacy `campHeal.ts`). A cleared camp pays every standing contributor one large ("Camp")
//! potion and counts the clear for the contributors who are still at the camp; the camp's contributor list is then
//! forgotten. The link runs inside the clear's payout, which happens after the ledger pass, with the fx already queued.
use crate::constants::CAMP_HEAL_RANGE;
use crate::hooks::{HookArgs, Hx};
use crate::math::{hypot, Vec2};
use crate::potions::{Notice, Size};
use crate::state::World;
use crate::statics::MatchStatic;
use crate::systems::{mob_ai, potions};
use crate::Event;

/// Legacy `campHeal.payCampHeal` (the `campCleared` link).
pub(crate) fn pay(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::CampCleared { camp } = *args else {
        return;
    };
    let Some(runtime) = hx.w.mob_runtime.as_mut() else {
        return;
    };
    let Some(life) = runtime.life.get_mut(camp as usize) else {
        return;
    };
    // Legacy deletes the list at the end; taking it now is the same for the links after this one (the chest/near-camp
    // consumers run before campHeal and no later link reads it), and it allocates nothing.
    let contributors = std::mem::take(&mut life.contributors);
    if contributors.is_empty() {
        return;
    }
    let centre = camp_centre(hx.k, hx.w, camp);
    for id in contributors {
        let Some(i) = hx.w.idx(id) else { continue };
        if !hx.w.players[i].standing() {
            continue;
        }
        let at = Vec2::new(hx.w.players[i].body.x, hx.w.players[i].body.y);
        if near_camp(hx.k, camp, centre, at) {
            let p = &mut hx.w.players[i];
            p.camps_cleared = p.camps_cleared.saturating_add(1);
        }
        // A contributor that finished the camp from outside still earns the potion (legacy's own rule).
        if !potions::grant(hx.w, hx.ev, id, Size::Large) {
            hx.ev.push(Event::PotionNotice {
                id,
                notice: Notice::CampBagFull,
            });
        }
    }
}

/// Legacy `campCentre`: the map camp's declared point, else the middle of its mobs' resting spots, else none (a camp a
/// hand-built map or the training room made up).
fn camp_centre(k: &MatchStatic, w: &World, camp: u32) -> Option<Vec2> {
    if let Some(def) = k
        .arena
        .map
        .layers()
        .and_then(|l| l.data().camps.get(camp as usize))
    {
        return Some(Vec2::new(def.x, def.y));
    }
    let mut n = 0u32;
    let (mut x, mut y) = (0.0, 0.0);
    for m in w.mobs.iter() {
        if m.camp != camp + 1 {
            continue;
        }
        x += m.home.x;
        y += m.home.y;
        n += 1;
    }
    (n > 0).then(|| Vec2::new(x / f64::from(n), y / f64::from(n)))
}

/// Legacy `nearCamp`: inside the camp's own territory, or within `CAMP_HEAL_RANGE` of its centre; a camp with no centre
/// counts everyone who fought it.
fn near_camp(k: &MatchStatic, camp: u32, centre: Option<Vec2>, at: Vec2) -> bool {
    if mob_ai::territory(k, at) == camp + 1 {
        return true;
    }
    match centre {
        None => true,
        Some(c) => hypot(at.x - c.x, at.y - c.y) <= CAMP_HEAL_RANGE,
    }
}

#[cfg(test)]
#[path = "camp_heal_tests.rs"]
mod tests;
