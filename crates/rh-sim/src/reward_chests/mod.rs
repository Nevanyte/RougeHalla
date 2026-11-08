//! Source chest transaction. Producers call these narrow crate-only functions; no public spawn/grant command.
mod rules;
mod view;
pub use rules::{visit_content, Definition, DEFINITION};
pub(crate) mod observer;
use crate::{cards::CardId, state::World, statics::MatchStatic, Event, PlayerId, Vec2};
pub use observer::*;
pub use view::*;
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Refusal {
    Busy,
    Gone,
    Far,
    Blocked,
    Picked,
    Taken,
    Owned,
    Maxed,
    NotYours,
}
impl Refusal {
    pub fn message(self) -> &'static str {
        match self {
            Self::Busy => "Can't do that now",
            Self::Gone => "Chest gone",
            Self::Far => "Too far away",
            Self::Blocked => "Can't reach that",
            Self::Picked => "You already picked",
            Self::Taken => "Already taken",
            Self::Owned => "Already yours",
            Self::Maxed => "Stat maxed",
            Self::NotYours => "Not yours",
        }
    }
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Chest {
    pub id: u32,
    pub at: Vec2,
    pub expires_at: f64,
    pub held_until_tick: u32,
    pub options: [Option<OptionId>; 3],
    pub taken: [Option<PlayerId>; 3],
    pub pickers: Vec<PlayerId>,
    pub camp: Option<u16>,
    pub owner: Option<PlayerId>,
}
fn insert(w: &mut World, at: Vec2, options: [Option<OptionId>; 3], camp: Option<u16>) -> u32 {
    let id = w.next_entity_id();
    w.reward_chests.push(Chest {
        id,
        at,
        expires_at: w.server_time + DEFINITION.lifetime_ms,
        held_until_tick: w.tick + DEFINITION.birth_hold_ticks,
        options,
        taken: [None; 3],
        pickers: Vec::with_capacity(crate::constants::MAX_PLAYERS),
        camp,
        owner: None,
    });
    id
}
/// Exact three distinct source boost choices, one actual reward draw per slot.
#[allow(dead_code)] // serial integration: actual first-open stat-crate producer
pub(crate) fn drop_stat(w: &mut World, at: Vec2) -> u32 {
    let mut pool = BoostId::ALL;
    let mut n = pool.len();
    let options = std::array::from_fn(|_| {
        let i = ((w.reward_rng.next_f64() * n as f64).floor() as usize).min(n - 1);
        let id = pool[i];
        pool.copy_within(i + 1..n, i);
        n -= 1;
        Some(OptionId::Boost(id))
    });
    insert(w, at, options, None)
}
fn tiered(rng: &mut crate::private_rng::Sfc32, pool: &[CardId], elite: bool) -> Option<CardId> {
    if pool.is_empty() {
        return None;
    }
    let weights = DEFINITION.tier_weights[usize::from(elite)];
    let r = rng.next_f64() * weights.iter().sum::<f64>();
    let want = if r < weights[0] {
        1u8
    } else if r < weights[0] + weights[1] {
        2
    } else {
        3
    };
    let tier = pool
        .iter()
        .map(|v| v.tier())
        .min_by_key(|v| (v.abs_diff(want), *v))?;
    let mut matching = [CardId::SlowBurn; 3];
    let mut n = 0;
    for id in pool {
        if id.tier() == tier {
            matching[n] = *id;
            n += 1
        }
    }
    Some(matching[((rng.next_f64() * n as f64).floor() as usize).min(n - 1)])
}
/// Supported availability intersects source interactive eligibility; callers supply real eligible contributor IDs.
#[allow(dead_code)] // serial integration: actual credited elite-death producer
pub(crate) fn drop_augment(
    w: &mut World,
    at: Vec2,
    camp: Option<u16>,
    zone: crate::FactionId,
    elite: bool,
    eligible: &[PlayerId],
) -> u32 {
    let mut pool = [CardId::SlowBurn; 3];
    let mut n = 0;
    for id in CardId::OFFER {
        let held_all = !eligible.is_empty()
            && eligible
                .iter()
                .all(|pid| w.player(*pid).is_some_and(|p| p.build.owns(id)));
        if !held_all {
            pool[n] = id;
            n += 1
        }
    }
    let theme = DEFINITION.themed_first[zone.code() as usize];
    let mut options = [None; 3];
    let themed = theme.filter(|id| pool[..n].contains(id));
    options[0] = tiered(
        &mut w.reward_rng,
        themed
            .as_ref()
            .map(std::slice::from_ref)
            .unwrap_or(&pool[..n]),
        elite,
    )
    .map(OptionId::Card);
    for i in 1..3 {
        let mut available = [CardId::SlowBurn; 3];
        let mut count = 0;
        for id in &pool[..n] {
            if !options[..i].contains(&Some(OptionId::Card(*id))) {
                available[count] = *id;
                count += 1
            }
        }
        options[i] = tiered(&mut w.reward_rng, &available[..count], elite).map(OptionId::Card);
    }
    insert(w, at, options, camp)
}
pub(crate) fn grant_boost(k: &MatchStatic, w: &mut World, id: PlayerId, boost: BoostId) -> bool {
    let Some(i) = w.idx(id) else { return false };
    let count = &mut w.players[i].build.boosts[boost.index()];
    if u32::from(*count) >= crate::stat_fold::default_definition().chest_boost_max_picks {
        return false;
    }
    *count += 1;
    crate::modifiers::recompute(k, w, crate::fighter::FighterIx::of_slot(i));
    crate::modifiers::sync_max_hp(&mut w.players[i]);
    true
}
fn reach(k: &MatchStatic, locked: bool, from: Vec2, at: Vec2) -> Result<(), Refusal> {
    if crate::math::hypot(from.x - at.x, from.y - at.y) > DEFINITION.range {
        return Err(Refusal::Far);
    }
    if !crate::geometry::has_line_of_sight(
        k.collision_map(locked),
        from,
        at,
        crate::constants::MASK_SIGHT,
    ) {
        return Err(Refusal::Blocked);
    }
    Ok(())
}
pub(crate) fn choose(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    who: PlayerId,
    chest: Option<u32>,
    pick: i8,
) -> Result<(), Refusal> {
    let Some(pi) = w.idx(who).filter(|i| w.players[*i].standing()) else {
        return Ok(());
    };
    if crate::status_runtime::action_blocked(&w.players[pi].statuses, w.server_time) {
        return Err(Refusal::Busy);
    }
    let ci = chest
        .and_then(|id| w.reward_chests.iter().position(|c| c.id == id))
        .ok_or(Refusal::Gone)?;
    let c = &w.reward_chests[ci];
    if c.held_until_tick >= w.tick || w.server_time >= c.expires_at {
        return Err(Refusal::Gone);
    }
    if c.owner.is_some_and(|owner| owner != who) {
        return Err(Refusal::NotYours);
    }
    reach(k, w.rt.gates_locked, w.players[pi].pos(), c.at)?;
    if c.pickers.contains(&who) {
        return Err(Refusal::Picked);
    }
    if pick == -1 {
        let pays = c.owner.is_none() && c.camp.is_some();
        w.reward_chests[ci].pickers.push(who);
        if pays
            && crate::systems::heal::apply(
                w,
                ev,
                pi,
                w.players[pi].vitals.max_hp * DEFINITION.skip_heal_share,
                crate::systems::heal::Kind::Ordinary,
            ) <= 0.
            && !crate::schedule::Gates::of(k).training
        {
            crate::systems::credit::award_skip(w, ev, pi);
        }
    } else {
        let Some(i) = usize::try_from(pick).ok().filter(|i| *i < 3) else {
            return Ok(());
        };
        let Some(option) = c.options[i] else {
            return Ok(());
        };
        if c.taken[i].is_some() {
            return Err(Refusal::Taken);
        }
        // Source owner-bound trophy options use killAugments, outside this Card/Boost subset.
        if c.owner.is_some() && matches!(option, OptionId::Card(_)) {
            return Ok(());
        }
        match option {
            OptionId::Card(id) if w.players[pi].build.owns(id) => return Err(Refusal::Owned),
            OptionId::Boost(id)
                if u32::from(w.players[pi].build.boosts[id.index()])
                    >= crate::stat_fold::default_definition().chest_boost_max_picks =>
            {
                return Err(Refusal::Maxed)
            }
            _ => {}
        }
        w.reward_chests[ci].taken[i] = Some(who);
        w.reward_chests[ci].pickers.push(who);
        match option {
            OptionId::Card(id) => {
                crate::cards::grant(k, w, who, id);
            }
            OptionId::Boost(id) => {
                grant_boost(k, w, who, id);
            }
        }
    }
    ev.push(Event::ChestTaken {
        chest: chest.expect("resolved chest"),
        by: who,
        pick,
    });
    Ok(())
}
pub(crate) fn on_choose(
    cx: &mut crate::systems::Cx,
    ix: crate::fighter::FighterIx,
    cmd: &crate::input::ActionCmd,
) {
    let crate::input::ActionCmd::Choose { chest_id, pick } = *cmd else {
        return;
    };
    if !cx.w.is_player(ix) {
        return;
    }
    let id = cx.w.core(ix).id;
    if let Err(reason) = choose(cx.k, cx.w, cx.ev, id, chest_id, pick) {
        cx.ev.push(Event::ChestRefused { id, reason });
    }
}
pub(crate) fn expire(cx: &mut crate::systems::Cx) {
    let now = cx.w.server_time;
    cx.w.reward_chests.retain(|c| now < c.expires_at);
}
pub(crate) fn clear(hx: &mut crate::hooks::Hx, _: &crate::hooks::HookArgs) {
    hx.w.reward_chests.clear();
}
pub(crate) fn validate_world(w: &World, near: impl Fn(f64, f64) -> bool) -> Result<(), String> {
    for (i, c) in w.reward_chests.iter().enumerate() {
        let n = c.options.iter().flatten().count();
        if c.id == 0
            || c.id > w.entity_counter
            || w.reward_chests[..i].iter().any(|old| old.id >= c.id)
            || w.containers.iter().any(|v| v.id == c.id)
            || w.projectiles.iter().any(|v| v.launch.id == c.id)
            || w.abilities
                .as_ref()
                .is_some_and(|a| a.fields.iter().any(|v| v.id == c.id))
            || !near(c.at.x, c.at.y)
            || !c.expires_at.is_finite()
            || c.expires_at < 0.
            || c.expires_at > w.server_time + DEFINITION.lifetime_ms
            || c.held_until_tick > w.tick.saturating_add(DEFINITION.birth_hold_ticks)
            || c.owner.is_some_and(|id| w.roster.name(id).is_none())
            || c.options[..n].iter().any(Option::is_none)
            || c.options[n..].iter().any(Option::is_some)
            || c.options
                .iter()
                .enumerate()
                .any(|(j, o)| o.is_some() && c.options[..j].contains(o))
            || c.pickers.len() > w.roster.len()
            || c.pickers
                .iter()
                .enumerate()
                .any(|(j, id)| w.roster.name(*id).is_none() || c.pickers[..j].contains(id))
            || c.taken.iter().enumerate().any(|(j, id)| {
                id.is_some_and(|id| {
                    c.options[j].is_none()
                        || !c.pickers.contains(&id)
                        || c.taken[..j].contains(&Some(id))
                })
            })
        {
            return Err("invalid reward chest".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
