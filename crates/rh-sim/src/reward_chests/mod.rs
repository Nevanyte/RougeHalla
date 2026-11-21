//! Source chest transaction. Producers call these narrow crate-only functions; no public spawn/grant command.
mod pools;
mod rules;
mod view;
pub use pools::*;
pub use rules::{visit_content, Definition, DEFINITION};
pub(crate) mod observer;
use crate::{state::World, statics::MatchStatic, Event, PlayerId, Vec2};
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
    /// A conditional card whose base the picker does not hold (source "Needs <Base>").
    Needs(crate::cards::BaseStatId),
}
impl Refusal {
    pub fn message(self) -> std::borrow::Cow<'static, str> {
        match self {
            Self::Busy => "Can't do that now".into(),
            Self::Gone => "Chest gone".into(),
            Self::Far => "Too far away".into(),
            Self::Blocked => "Can't reach that".into(),
            Self::Picked => "You already picked".into(),
            Self::Taken => "Already taken".into(),
            Self::Owned => "Already yours".into(),
            Self::Maxed => "Stat maxed".into(),
            Self::NotYours => "Not yours".into(),
            Self::Needs(base) => format!("Needs {}", base.label()).into(),
        }
    }
}
/// Source `loot.bornThisTick` in the one shared form both Choose and `RewardChestObserver` read: a reward container
/// is available only once its birth hold has passed (`held_until_tick` is stored as birth tick + birth_hold ticks).
/// The same predicate in both places is what keeps the command and the observer from disagreeing (P-TROPHY-BIRTH-HOLD-REPAIR).
pub(crate) const fn birth_available(held_until_tick: u32, tick: u32) -> bool {
    held_until_tick < tick
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
    /// P-ELITE-PICK-1 (owner 2026-11-18, "Killer first pick"): under `SimConfig::elites == Rework`, the credited killer
    /// of an elite camp (the player with the most damage, `systems/mob_life.rs` `hurt`) and the end of their first-pick
    /// window. `None` on every other chest, and on every chest of a `Legacy` world. `#[serde(default)]`: a declared
    /// chest without the key (test JSON) reads `None`.
    #[serde(default)]
    pub first_pick: Option<FirstPick>,
}
/// P-ELITE-PICK-1: whose first pick a chest holds, and until when (server time, ms; open while `server_time < until`).
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FirstPick {
    pub killer: PlayerId,
    pub until: f64,
}
/// P-ELITE-PICK-1: the length of the killer's first-pick window, in ms (owner 2026-11-18: 5 s), read from its registered
/// content row.
pub(crate) fn first_pick_window_ms() -> f64 {
    crate::constants::REWORK_ELITE_FIRST_PICK_MS
}
/// P-ELITE-PICK-1: whether `chest`'s first-pick window keeps `who` from choosing there now. True while the window is
/// open (`server_time < until`) for anyone but its killer, and only while the killer is still a standing player: a
/// killer who dies, is downed, resolves or leaves ends the window at once (a player who stops standing never stands
/// again inside a match), and one who was not standing at the drop never had it. The one predicate both `choose` and
/// the observer's `can_choose` read (as [`birth_available`]), so the command and the observation never disagree.
pub(crate) fn first_pick_blocks(w: &World, chest: &Chest, who: PlayerId) -> bool {
    first_pick_open(w, chest).is_some_and(|f| f.killer != who)
}
/// P-WIRE19-A: `chest`'s first-pick window while it is in force (open, `server_time < until`, and its killer still a
/// standing player), else `None`. The facts [`first_pick_blocks`] reads, so the observed window and the refusal of
/// `choose` start and end on the same tick.
pub(crate) fn first_pick_open(w: &World, chest: &Chest) -> Option<FirstPick> {
    chest
        .first_pick
        .filter(|f| w.server_time < f.until && w.player(f.killer).is_some_and(|p| p.standing()))
}
pub(crate) fn insert(
    w: &mut World,
    at: Vec2,
    options: [Option<OptionId>; 3],
    camp: Option<u16>,
) -> u32 {
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
        first_pick: None,
    });
    id
}
/// Exact three distinct source boost choices, one actual reward draw per slot (the first-open stat-crate producer).
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
/// [`drop_augment_in`] under the legacy card table (the capture tests' form).
#[cfg(test)]
pub(crate) fn drop_augment(
    w: &mut World,
    at: Vec2,
    camp: Option<u16>,
    zone: crate::FactionId,
    elite: bool,
    eligible: &[PlayerId],
) -> u32 {
    drop_augment_in(
        crate::cards::Tuning::legacy(),
        w,
        at,
        camp,
        zone,
        elite,
        eligible,
    )
}

/// Source chest drop: the interactive augment pool of the eligible pickers under the world's card table (`k.cards`,
/// [`crate::cards::Tuning::offer_pool`]: the legacy `rewardAugmentPool` under `Legacy`), rolled with the reward RNG
/// (exact draw order).
pub(crate) fn drop_augment_in(
    tuning: &crate::cards::Tuning,
    w: &mut World,
    at: Vec2,
    camp: Option<u16>,
    zone: crate::FactionId,
    elite: bool,
    eligible: &[PlayerId],
) -> u32 {
    let pickers: Vec<Picker> = eligible
        .iter()
        .filter_map(|pid| {
            w.player(*pid).map(|p| Picker {
                build: p.build,
                faction: p.faction(),
            })
        })
        .collect();
    let pool = tuning.offer_pool(&pickers);
    let mut options = [None; 3];
    if !pool.is_empty() {
        let mut draw = || w.reward_rng.next_f64();
        let rolled = roll_with(&mut draw, &pool, elite, Some(zone));
        for (i, id) in rolled.into_iter().enumerate() {
            options[i] = Some(OptionId::Card(id));
        }
    }
    insert(w, at, options, camp)
}
/// Source `chests.dropRewardChest` with an owner (legacy `killAugments.onPlayerKilled`: a private Trophy reward
/// container at the killer's feet). The options are kill-augment ids, the owner is the killer alone, and the container
/// outlives a chest (`KILL_AUG_SECONDS`); it rides the one `choose` action like every other reward container.
pub(crate) fn drop_trophy(
    w: &mut World,
    at: Vec2,
    owner: PlayerId,
    options: &[crate::kill_augments::KillAugment],
) -> u32 {
    let mut slots = [None; 3];
    for (i, a) in options.iter().take(3).enumerate() {
        slots[i] = Some(OptionId::Kill(*a));
    }
    let id = w.next_entity_id();
    w.reward_chests.push(Chest {
        id,
        at,
        expires_at: w.server_time + crate::constants::KILL_AUG_SECONDS * 1000.,
        held_until_tick: w.tick + DEFINITION.birth_hold_ticks,
        options: slots,
        taken: [None; 3],
        pickers: Vec::with_capacity(crate::constants::MAX_PLAYERS),
        camp: None,
        owner: Some(owner),
        first_pick: None,
    });
    id
}

/// Source `chests.onMobKilled` (legacy `chainHook(world, "mobKilled", ...)`): a credited elite's death drops its
/// camp's shared augment chest at the camp's chest spot (the centre when that tile is solid), with the source's eligible
/// pickers and exact reward draw order; a campless elite drops one at its body for the killer alone. The snapshot set
/// arrives on the hook arguments because a clear forgets its contributors before the pass pays.
pub(crate) fn on_mob_killed(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    let crate::hooks::HookArgs::MobKilled {
        killer,
        camp,
        elite,
        zone,
        at,
        contributors,
        ..
    } = args
    else {
        return;
    };
    if !*elite {
        return;
    }
    let k = hx.k;
    if *camp >= 0 {
        let camp = *camp as u32;
        let Some(spot) = camp_chest_spot(k, camp) else {
            return; // source rollChest: a camp the map does not have
        };
        let eligible: Vec<PlayerId> = contributors
            .iter()
            .copied()
            .filter(|id| {
                hx.w.player(*id)
                    .is_some_and(|p| p.standing() && near_camp(k, camp, p.pos()))
            })
            .collect();
        let id = drop_augment_in(
            k.cards,
            &mut *hx.w,
            spot,
            Some(camp as u16),
            *zone,
            true,
            &eligible,
        );
        // P-ELITE-PICK-1 (Rework only, no draw): the credited killer, if standing, holds the first pick for the window,
        // wherever they stand (eligibility near the camp shapes only the cards rolled).
        if k.config.elites == crate::EliteRule::Rework
            && hx.w.player(*killer).is_some_and(|p| p.standing())
        {
            let until = hx.w.server_time + first_pick_window_ms();
            if let Some(c) = hx.w.reward_chests.iter_mut().rev().find(|c| c.id == id) {
                c.first_pick = Some(FirstPick {
                    killer: *killer,
                    until,
                });
            }
        }
    } else {
        // Source: an elite without a camp (a training/dummy death) drops at its body with no eligible pickers, so the
        // conditional pool is empty and no card is held by all.
        drop_augment_in(k.cards, &mut *hx.w, *at, None, *zone, true, &[]);
    }
}

fn camp_def(k: &MatchStatic, camp: u32) -> Option<&crate::mapdata::CampDef> {
    k.arena
        .map
        .layers()
        .and_then(|l| l.data().camps.get(camp as usize))
}

/// Source `chests.chestSpot`: the camp's chest tile, or its centre when that tile is solid.
fn camp_chest_spot(k: &MatchStatic, camp: u32) -> Option<Vec2> {
    let c = camp_def(k, camp)?;
    let chest = Vec2::new(c.chest.x, c.chest.y);
    let solid = k.arena.map.is_solid(
        (chest.x / crate::constants::TILE).floor() as i64,
        (chest.y / crate::constants::TILE).floor() as i64,
    );
    Some(if solid { Vec2::new(c.x, c.y) } else { chest })
}

/// Source `campHeal.nearCamp`: inside the camp's territory or within `CAMP_HEAL_RANGE` of its centre.
fn near_camp(k: &MatchStatic, camp: u32, at: Vec2) -> bool {
    if crate::systems::mob_ai::territory(k, at) == camp + 1 {
        return true;
    }
    let Some(c) = camp_def(k, camp) else {
        return true; // source: a camp with no centre counts everyone who fought it
    };
    crate::math::hypot(at.x - c.x, at.y - c.y) <= crate::constants::CAMP_HEAL_RANGE
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
    // Source bornThisTick: the birth tick and the held tick both refuse; the hold is shared with the observer.
    if !birth_available(c.held_until_tick, w.tick) || w.server_time >= c.expires_at {
        return Err(Refusal::Gone);
    }
    // P-ELITE-PICK-1: another player's first-pick window refuses like another player's Trophy (card and skip alike).
    if c.owner.is_some_and(|owner| owner != who) || first_pick_blocks(w, c, who) {
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
        // Source: a boost option is checked first, then an owner-bound container's option is a kill augment (the
        // parse failing is silent and uses up nothing); ordinary card checks come last.
        if c.owner.is_some() && !matches!(option, OptionId::Kill(_)) {
            return Ok(());
        }
        match option {
            OptionId::Card(id) if w.players[pi].build.owns(id) => return Err(Refusal::Owned),
            OptionId::Card(id)
                if k.cards.def(id).requires.is_some_and(|req| {
                    !crate::cards::CardId::ALL.iter().any(|base| {
                        k.cards.def(*base).base == Some(req) && w.players[pi].build.owns(*base)
                    })
                }) =>
            {
                return Err(Refusal::Needs(k.cards.def(id).requires.expect("checked")));
            }
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
            OptionId::Kill(a) => {
                crate::kill_augments::grant(k, w, who, a);
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
/// `cards`: the world's card table; its chest pool is [`crate::cards::Tuning::in_pool`] (the catalog pool and, under
/// `Rework`, the native pool cards). A camp chest (`camp: Some`, rolled by [`drop_augment_in`]) offers
/// only its cards; a camp-less chest (a campless elite's, the console's, or one a test declares) is not pool-checked.
///
/// `elites`: the world's elite rule (`k.config.elites`). A first-pick window (P-ELITE-PICK-1) stands only on a shared
/// camp chest of a `Rework` world, held by a player who joined, and ends no later than its drop
/// (`expires_at - lifetime_ms`) plus the window. A past end is valid (the window closed while the chest stands).
pub(crate) fn validate_world(
    w: &World,
    cards: &crate::cards::Tuning,
    elites: crate::EliteRule,
    near: impl Fn(f64, f64) -> bool,
) -> Result<(), String> {
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
            || c.expires_at
                > w.server_time
                    + if c.owner.is_some() {
                        crate::constants::KILL_AUG_SECONDS * 1000.
                    } else {
                        DEFINITION.lifetime_ms
                    }
            || c.held_until_tick > w.tick.saturating_add(DEFINITION.birth_hold_ticks)
            || c.owner.is_some_and(|id| w.roster.name(id).is_none())
            || (c.owner.is_some() && c.camp.is_some())
            || c.options
                .iter()
                .flatten()
                .any(|o| matches!(o, OptionId::Kill(_)) != c.owner.is_some())
            || c.options
                .iter()
                .flatten()
                .any(|o| matches!(o, OptionId::Kill(a) if !(a.gain.is_finite() && a.gain > 0.)))
            || (c.camp.is_some()
                && c.options
                    .iter()
                    .flatten()
                    .any(|o| matches!(o, OptionId::Card(id) if !cards.in_pool(*id))))
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
            || c.first_pick.is_some_and(|f| {
                elites != crate::EliteRule::Rework
                    || c.camp.is_none()
                    || c.owner.is_some()
                    || w.roster.name(f.killer).is_none()
                    || !f.until.is_finite()
                    || f.until > c.expires_at - DEFINITION.lifetime_ms + first_pick_window_ms()
            })
        {
            return Err("invalid reward chest".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod chest_runtime_tests;
#[cfg(test)]
mod first_pick_tests;
#[cfg(test)]
mod first_pick_view_tests;
#[cfg(test)]
mod native_pool_tests;
#[cfg(test)]
mod pool_tests;
#[cfg(test)]
mod tests;
