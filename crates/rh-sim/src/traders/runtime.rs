//! Source `server/src/sim/traders.ts`: the trader world actors (spawn at the raid start, wander between the installation
//! destinations), the stat-offer roll on a nearby broker, and the trade action with the source's check order and effects.
//!
//! The source toast lines are presentation (coordinator-owned transport), so a refusal is observably a no-op state change
//! here; the capture corpus compares the state effects, not the wording.
use super::{barter_weapons, roll_stat_trades, Kind, Trader, Traders};
use crate::constants::*;
use crate::input::ActionCmd;
use crate::math::Vec2;
use crate::state::{Phase, PlayerId, World};
use crate::statics::MatchStatic;
use crate::systems::Cx;

/// The live-content switch the traders ride on (the same family as the quests/live modules): the source installs traders
/// for every non-training world, which matches the capture worlds; pure combat corpora keep their recorded reward streams.
fn enabled(k: &MatchStatic) -> bool {
    crate::schedule::Gates::of(k).quests && !crate::schedule::Gates::of(k).training
}

/// Source `install`'s destination grid: every fourth tile centre from two tiles in, where a 12-u disc is clear.
fn destinations(map: &crate::TileMap) -> Vec<Vec2> {
    let mut out = Vec::new();
    let mut y = u32::from(TRADER_DEST_EDGE_TILES as u16);
    while y < map
        .h
        .saturating_sub(u32::from(TRADER_DEST_EDGE_TILES as u16))
    {
        let mut x = u32::from(TRADER_DEST_EDGE_TILES as u16);
        while x < map
            .w
            .saturating_sub(u32::from(TRADER_DEST_EDGE_TILES as u16))
        {
            let point = Vec2::new(tile_center(i64::from(x)), tile_center(i64::from(y)));
            if crate::geometry::circle_clear(map, point, PLAYER_RADIUS, crate::map::MASK_MOVE) {
                out.push(point);
            }
            x += TRADER_DEST_STEP_TILES;
        }
        y += TRADER_DEST_STEP_TILES;
    }
    out
}

fn tile_center(t: i64) -> f64 {
    crate::map::tile_to_world_center(t)
}

fn shuffled<T: Clone>(items: &[T], random: &mut impl FnMut() -> f64) -> Vec<T> {
    let mut out = items.to_vec();
    for i in (1..out.len()).rev() {
        let j = (random() * (i + 1) as f64).floor() as usize;
        out.swap(i, j);
    }
    out
}

/// Source `spawnTraders` (the `raidStarted` hook): the two villagers at the shuffled installation destinations.
pub(crate) fn spawn(hx: &mut crate::hooks::Hx, _: &crate::hooks::HookArgs) {
    let k = hx.k;
    if !enabled(k) || hx.w.traders.is_some() || hx.w.phase == Phase::Lobby {
        return;
    }
    let dests = destinations(k.collision_map(hx.w.rt.gates_locked));
    let mut rng = hx.w.reward_rng.clone();
    let mut random = || rng.next_f64();
    let sites = shuffled(&dests, &mut random);
    let mut traders = Vec::with_capacity(Kind::ALL.len());
    for (index, kind) in Kind::ALL.into_iter().enumerate() {
        let spot = if kind == Kind::Stats {
            sites
                .get(sites.len() / 2)
                .copied()
                .or_else(|| coliseum_centre(k))
        } else {
            sites.first().copied().or_else(|| coliseum_centre(k))
        };
        let Some(spot) = spot else { continue };
        traders.push(Trader {
            kind,
            at: spot,
            path: Vec::new(),
            next_walk_at: hx.w.server_time + TRADER_STOP_MS + index as f64 * 1000.,
        });
    }
    hx.w.reward_rng = rng;
    if !traders.is_empty() {
        hx.w.traders = Some(Traders {
            traders,
            destinations: dests,
            barter_at: Vec::new(),
        });
    }
}

fn coliseum_centre(k: &MatchStatic) -> Option<Vec2> {
    let data = k.arena.map.layers()?.data();
    Some(Vec2::new(data.coliseum.centre.x, data.coliseum.centre.y))
}

fn line_of_sight(k: &MatchStatic, w: &World, from: Vec2, to: Vec2) -> bool {
    crate::geometry::has_line_of_sight(
        k.collision_map(w.rt.gates_locked),
        from,
        to,
        crate::map::MASK_MOVE,
    )
}

fn near(k: &MatchStatic, w: &World, player: &crate::state::Player, trader: &Trader) -> bool {
    crate::math::hypot(player.body.x - trader.at.x, player.body.y - trader.at.y) <= TRADER_RANGE
        && line_of_sight(k, w, player.pos(), trader.at)
}

/// Source `updateTraders` (the system): visitors freeze a villager and roll the broker's fixed stat offers; otherwise the
/// villager walks toward a shuffled installation destination.
pub(crate) fn update(cx: &mut Cx) {
    let Cx { k, w, pf, .. } = cx;
    let Some(mut rt) = w.traders.take() else {
        return;
    };
    if w.phase != Phase::Active {
        w.traders = Some(rt);
        return;
    }
    let map = k.collision_map(w.rt.gates_locked);
    let now = w.server_time;
    let dt = TICK_MS;
    let mut rng = w.reward_rng.clone();
    let mut random = || rng.next_f64();
    for ti in 0..rt.traders.len() {
        let kind = rt.traders[ti].kind;
        let trader_at = rt.traders[ti].at;
        let mut visitor = false;
        let mut idle: Vec<PlayerId> = Vec::new();
        for p in &w.players {
            if !p.standing() || !near(k, w, p, &rt.traders[ti]) {
                continue;
            }
            visitor = true;
            if kind == Kind::Stats && !p.trade_used && p.trade_offers.is_empty() {
                idle.push(p.id);
            }
        }
        if visitor {
            rt.traders[ti].next_walk_at = now + TRADER_STOP_MS;
            for id in idle {
                let Some(i) = w.idx(id) else { continue };
                crate::modifiers::recompute(k, w, crate::fighter::FighterIx::of_slot(i));
                let offers = roll_stat_trades(&w.players[i], &mut random);
                w.players[i].trade_offers = offers;
            }
            continue;
        }
        if rt.traders[ti].path.is_empty() && now >= rt.traders[ti].next_walk_at {
            let goals = shuffled(&rt.destinations, &mut random);
            for goal in goals.into_iter().take(TRADER_GOAL_COUNT as usize) {
                if crate::math::hypot(trader_at.x - goal.x, trader_at.y - goal.y)
                    < TILE * f64::from(TRADER_GOAL_MIN_TILES)
                {
                    continue;
                }
                let path = pf.find_path(map, trader_at, goal, TRADER_PATH_RADIUS);
                if !path.is_empty() {
                    rt.traders[ti].path = path;
                    break;
                }
            }
            rt.traders[ti].next_walk_at = now + TRADER_STOP_MS;
        }
        let mut walk = TRADER_SPEED * dt / 1000.;
        while walk > 0. {
            let Some(point) = rt.traders[ti].path.first().copied() else {
                break;
            };
            let dx = point.x - rt.traders[ti].at.x;
            let dy = point.y - rt.traders[ti].at.y;
            let distance = crate::math::hypot(dx, dy);
            let step = walk.min(distance);
            let next = if distance > 0. {
                Vec2::new(
                    rt.traders[ti].at.x + dx / distance * step,
                    rt.traders[ti].at.y + dy / distance * step,
                )
            } else {
                point
            };
            // The source keeps a trader's synced x/y as float32; every tick's assignment quantizes the walker.
            let next = Vec2::new(next.x as f32 as f64, next.y as f32 as f64);
            if !crate::geometry::segment_clear(
                map,
                rt.traders[ti].at,
                next,
                PLAYER_RADIUS,
                crate::map::MASK_MOVE,
            ) {
                rt.traders[ti].path.clear();
                break;
            }
            rt.traders[ti].at = next;
            walk -= step;
            if distance <= step {
                rt.traders[ti].path.remove(0);
            }
        }
    }
    w.reward_rng = rng;
    w.traders = Some(rt);
}

fn slot_item(p: &crate::state::Player, slot: u8) -> Option<crate::content::WeaponId> {
    if slot == 0 {
        p.weapon.weapon0
    } else {
        p.weapon.weapon1
    }
}

/// Source `handleTrade`: the action's check order and effects; the presentation toasts are transport-owned.
pub(crate) fn handle_trade(cx: &mut Cx, ix: crate::fighter::FighterIx, cmd: &ActionCmd) {
    let ActionCmd::Trade { trader, pick } = *cmd else {
        return;
    };
    if !cx.w.is_player(ix) {
        return;
    }
    let id = cx.w.core(ix).id;
    if cx.w.phase != Phase::Active || !cx.w.players[ix.slot()].standing() {
        return;
    }
    let Some(kind) = Kind::from_code(trader) else {
        return;
    };
    let Some(rt) = cx.w.traders.as_ref() else {
        return;
    };
    let Some(trader) = rt.traders.iter().find(|t| t.kind == kind) else {
        return;
    };
    if crate::status_runtime::action_blocked(&cx.w.core(ix).statuses, cx.w.server_time) {
        return;
    }
    let from = cx.w.players[ix.slot()].pos();
    if crate::math::hypot(from.x - trader.at.x, from.y - trader.at.y) > TRADER_RANGE
        || !crate::geometry::has_line_of_sight(
            cx.k.collision_map(cx.w.rt.gates_locked),
            from,
            trader.at,
            crate::map::MASK_MOVE,
        )
    {
        return;
    }
    if !(0..=2).contains(&pick) {
        return;
    }
    let at = trader.at;
    let now = cx.w.server_time;
    if kind == Kind::Stats {
        if cx.w.players[ix.slot()].trade_used {
            return;
        }
        let Some(offer) = cx.w.players[ix.slot()]
            .trade_offers
            .get(pick as usize)
            .cloned()
        else {
            return;
        };
        let p = &mut cx.w.players[ix.slot()];
        add_trade_stat(p, offer.cost, -offer.cost_value);
        add_trade_stat(p, offer.gain, offer.gain_value);
        p.trade_used = true;
        let hp_before = p.vitals.hp;
        crate::modifiers::recompute(cx.k, cx.w, ix);
        crate::modifiers::sync_max_hp(&mut cx.w.players[ix.slot()]);
        let p = &mut cx.w.players[ix.slot()];
        p.vitals.hp = hp_before.min(p.vitals.max_hp);
        return;
    }
    // The barter villager.
    let ready_at =
        cx.w.traders
            .as_ref()
            .and_then(|rt| {
                rt.barter_at
                    .iter()
                    .find(|(who, _)| *who == id)
                    .map(|(_, at)| *at)
            })
            .unwrap_or(0.);
    if now < ready_at {
        return;
    }
    let held = slot_item(
        &cx.w.players[ix.slot()],
        cx.w.players[ix.slot()].weapon.slot,
    );
    let [first, second] = barter_weapons(held);
    if pick == 2 {
        let p = &mut cx.w.players[ix.slot()];
        if p.potion_small < 1 {
            return;
        }
        if held == Some(second) {
            return;
        }
        // Source traders.ts:87: the second slot is only a target while the folded `lockSecondSlot` flag is off. The
        // flag is the existing owned-card accessor (`Build::has_flag`), which equals the folded FlagSet for every
        // player: LockSecondSlot's only producer is the ungated Committed catalog row (no other row type makes flags).
        let empty = if slot_item(p, p.weapon.slot).is_none() {
            Some(p.weapon.slot)
        } else if p.weapon.weapon0.is_none() {
            Some(0)
        } else if p.weapon.weapon1.is_none()
            && !p
                .build
                .has_flag(crate::stat_fold::EffectFlag::LockSecondSlot)
        {
            Some(1)
        } else {
            None
        };
        let Some(empty) = empty else {
            return;
        };
        p.potion_small -= 1;
        if empty == 0 {
            p.weapon.weapon0 = Some(second);
        } else {
            p.weapon.weapon1 = Some(second);
        }
        if p.weapon.slot == empty {
            crate::systems::items::weapon_changed(p, now);
        }
    } else {
        let Some(held) = held else {
            return;
        };
        if held == crate::content::WeaponId::Fists {
            return;
        }
        if pick == 1
            && !crate::systems::potions::grant(cx.w, cx.ev, id, crate::potions::Size::Small)
        {
            return;
        }
        let p = &mut cx.w.players[ix.slot()];
        let slot = p.weapon.slot;
        if slot == 0 {
            p.weapon.weapon0 = if pick == 0 { Some(first) } else { None };
        } else {
            p.weapon.weapon1 = if pick == 0 { Some(first) } else { None };
        }
        crate::systems::items::weapon_changed(p, now);
    }
    if let Some(rt) = cx.w.traders.as_mut() {
        match rt.barter_at.iter_mut().find(|(who, _)| *who == id) {
            Some((_, at)) => *at = now + TRADER_BARTER_COOLDOWN_MS,
            None => rt.barter_at.push((id, now + TRADER_BARTER_COOLDOWN_MS)),
        }
    }
    let _ = at;
}

fn add_trade_stat(p: &mut crate::state::Player, stat: super::Stat, delta: f64) {
    match p.trade_stats.iter_mut().find(|(s, _)| *s == stat) {
        Some((_, v)) => *v += delta,
        None => p.trade_stats.push((stat, delta)),
    }
}

/// Checkpoint validation for the trader runtime and the player trade state.
pub(crate) fn validate(k: &MatchStatic, w: &World) -> Result<(), String> {
    let _ = k;
    let Some(rt) = w.traders.as_ref() else {
        return Ok(());
    };
    for trader in &rt.traders {
        if !trader.at.x.is_finite() || !trader.at.y.is_finite() {
            return Err("invalid trader position".into());
        }
        if trader
            .path
            .iter()
            .any(|p| !p.x.is_finite() || !p.y.is_finite())
        {
            return Err("invalid trader path".into());
        }
    }
    if rt
        .destinations
        .iter()
        .any(|p| !p.x.is_finite() || !p.y.is_finite())
    {
        return Err("invalid trader destination".into());
    }
    for (who, at) in &rt.barter_at {
        if w.player(*who).is_none() || !at.is_finite() {
            return Err("invalid barter cooldown".into());
        }
    }
    for p in &w.players {
        if p.trade_stats.len() > super::Stat::ALL.len()
            || p.trade_stats.iter().any(|(_, v)| !v.is_finite())
        {
            return Err("invalid trade stats".into());
        }
        if p.trade_offers.len() > 3 || p.trade_offers.iter().any(|offer| !offer.valid()) {
            return Err("invalid trade offers".into());
        }
    }
    Ok(())
}
