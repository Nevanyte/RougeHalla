//! Source cardHooks / onHit / cardState, stored on the single card runtime.
use super::catalog::{self, CardEffect, OnHitStatus, TriggerAction, TriggerOn};
use super::runtime::{self, Streak, Trim};
use crate::constants::*;
use crate::content::{DamageShares, WeaponId};
use crate::hooks::{HookArgs, Hx};
use crate::stat_fold::EffectFlag;
use crate::state::{PlayerId, World};
use crate::status_runtime::{AddValue, Payload, StatusApply, StatusKind, StatusSource, StatusTag};
use crate::systems::ledger::{Entry, PayLater};
use crate::Vec2;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct OverkillHit {
    pub by: Option<PlayerId>,
    pub raw: f64,
    pub phys: f64,
    pub magic: f64,
    pub true_: f64,
    pub weapon: Option<WeaponId>,
    pub derived: bool,
    pub final_hit: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Hit,
    Returned,
    Other,
}

pub(crate) fn on_hit_landed(hx: &mut Hx, args: &HookArgs) {
    crate::systems::items::hit_landed(hx, args);
    let HookArgs::HitLanded { entry, amount } = args else {
        return;
    };
    if entry.arena || entry.derived {
        return;
    }
    let kind = kind_of(entry);
    if kind == Kind::Other {
        return;
    }
    let Some(attacker_id) = entry.by else { return };
    let Some(attacker) = hx.w.fighter_idx(attacker_id) else {
        return;
    };
    let Some(victim) = hx.w.fighter_idx(entry.victim) else {
        return;
    };
    if kind == Kind::Hit && hx.w.is_player(victim) && hx.w.standing(victim) {
        hit_taken(hx, entry.victim, attacker_id, entry, *amount);
    }
    if !hx.w.standing(victim) || !hx.w.standing(attacker) {
        return;
    }
    let eye = player_flag(hx.w, attacker_id, EffectFlag::EyeForAnEye);
    if kind == Kind::Hit || eye {
        run_on_hit(hx, attacker_id, entry.victim, entry, kind == Kind::Hit);
    }
}

pub(crate) fn on_blocked(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::Blocked {
        holder,
        attacker,
        prevented,
        ..
    } = *args
    else {
        return;
    };
    let Some(ix) = hx.w.fighter_idx(holder) else {
        return;
    };
    if !hx.w.is_player(ix) {
        return;
    }
    let faction = hx.w.core(ix).vitals.faction;
    let build = hx.w.players[ix.slot()].build;
    for effect in catalog::triggers(&build, faction, TriggerOn::Block) {
        let CardEffect::Trigger { action, .. } = *effect else {
            continue;
        };
        match action {
            TriggerAction::Fortify { per, cap } => {
                let (armor, shield) = defense(hx.w, ix);
                let kept = crate::content::mitigate_shares(
                    prevented.raw,
                    &DamageShares {
                        phys: prevented.phys,
                        magic: prevented.magic,
                        true_: prevented.true_,
                    },
                    armor,
                    shield,
                );
                let mem = runtime::memory_mut(&mut hx.w.players[ix.slot()]);
                mem.prevented += kept;
                let earned = cap.min(mem.prevented * per);
                if earned > mem.tank_hp + 1e-9 {
                    mem.tank_hp = earned;
                    crate::modifiers::sync_max_hp(&mut hx.w.players[ix.slot()]);
                }
            }
            TriggerAction::Status {
                to_self,
                kind,
                ms,
                value,
            } => {
                apply_status(
                    hx,
                    if to_self { holder } else { attacker },
                    holder,
                    kind,
                    ms,
                    value,
                    None,
                    StatusTag::Block,
                );
            }
            _ => {}
        }
    }
    if build.has_flag(faction, EffectFlag::BlockHits) && hx.w.standing(ix) {
        let weapon = hx.w.core(ix).active_weapon();
        let packet = crate::modifiers::packet(hx.w.core(ix), weapon);
        let fake = bare_entry(attacker, holder, packet, Some(weapon), false);
        run_on_hit(hx, holder, attacker, &fake, true);
        hx.w.pay.card_blocks.push((holder, attacker));
    }
}

pub(crate) fn on_overkilled(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::Overkilled {
        victim,
        overkill,
        total,
        hits,
    } = args
    else {
        return;
    };
    if !(*total > 0.) {
        return;
    }
    let at =
        hx.w.fighter_idx(*victim)
            .map(|ix| hx.w.core(ix).pos())
            .unwrap_or(Vec2::new(0., 0.));
    for hit in hits {
        if hit.derived || hit.final_hit {
            continue;
        }
        let Some(holder) = hit.by else { continue };
        let Some(ix) = hx.w.fighter_idx(holder) else {
            continue;
        };
        if !hx.w.is_player(ix) {
            continue;
        }
        let faction = hx.w.core(ix).vitals.faction;
        let build = hx.w.players[ix.slot()].build;
        for effect in catalog::triggers(&build, faction, TriggerOn::Kill) {
            let CardEffect::Trigger {
                action: TriggerAction::Splash { radius },
                ..
            } = *effect
            else {
                continue;
            };
            let raw = hit.raw * (*overkill / *total);
            if raw > 0. {
                hx.pay_later(PayLater::CardSplash {
                    holder,
                    victim: *victim,
                    at,
                    radius,
                    raw,
                    phys: hit.phys,
                    magic: hit.magic,
                    true_: hit.true_,
                    weapon: hit.weapon,
                });
            }
        }
    }
}

pub(crate) fn after_damage(cx: &mut crate::systems::Cx) {
    let mut by = [PlayerId(0); MAX_PLAYERS];
    let mut n = 0usize;
    let mut damage = [[0f64; MAX_PLAYERS]; MAX_PLAYERS];
    let mut counts = [[0u32; MAX_PLAYERS]; MAX_PLAYERS];
    let mut victims = [[PlayerId(0); MAX_PLAYERS]; MAX_PLAYERS];
    let mut vn = [0usize; MAX_PLAYERS];
    let note = |by: &mut [PlayerId; MAX_PLAYERS],
                n: &mut usize,
                victims: &mut [[PlayerId; MAX_PLAYERS]; MAX_PLAYERS],
                vn: &mut [usize; MAX_PLAYERS],
                damage: &mut [[f64; MAX_PLAYERS]; MAX_PLAYERS],
                counts: &mut [[u32; MAX_PLAYERS]; MAX_PLAYERS],
                attacker: PlayerId,
                victim: PlayerId,
                amount: f64| {
        let slot = if let Some(i) = by[..*n].iter().position(|id| *id == attacker) {
            i
        } else if *n < MAX_PLAYERS {
            by[*n] = attacker;
            *n += 1;
            *n - 1
        } else {
            return;
        };
        let row = &mut victims[slot];
        let at = if let Some(i) = row[..vn[slot]].iter().position(|id| *id == victim) {
            i
        } else if vn[slot] < MAX_PLAYERS {
            row[vn[slot]] = victim;
            vn[slot] += 1;
            vn[slot] - 1
        } else {
            return;
        };
        damage[slot][at] += amount;
        counts[slot][at] += 1;
    };
    for hit in &cx.s.landed {
        let Some(attacker) = hit.by else { continue };
        if hit.dot && hit.ability.is_none() && hit.sig.is_none() {
            continue;
        }
        if hit.weapon.is_some()
            && hit.sig.is_none()
            && hit.ability.is_none()
            && !hit.dot
            && !hit.passive
            && !hit.derived
        {
            note(
                &mut by,
                &mut n,
                &mut victims,
                &mut vn,
                &mut damage,
                &mut counts,
                attacker,
                hit.victim,
                hit.amount,
            );
        }
    }
    for &(attacker, victim) in &cx.w.pay.card_blocks {
        note(
            &mut by,
            &mut n,
            &mut victims,
            &mut vn,
            &mut damage,
            &mut counts,
            attacker,
            victim,
            0.,
        );
    }
    cx.w.pay.card_blocks.clear();
    let now = cx.w.server_time;
    for i in 0..n {
        let id = by[i];
        let Some(ix) = cx.w.idx(id) else { continue };
        let hits = vn[i];
        note_streak(
            cx.w,
            ix,
            &victims[i][..hits],
            &counts[i][..hits],
            &damage[i][..hits],
            now,
        );
        let total_hits: u32 = counts[i][..hits].iter().sum();
        wishful(cx, ix, total_hits, now);
    }
    stillness(cx.w, now);
}

pub(crate) fn reset_fight(hx: &mut Hx, args: &HookArgs) {
    if !matches!(args, HookArgs::Teleported) {
        return;
    }
    for p in &mut hx.w.players {
        if let Some(mem) = p.card_runtime.as_mut().and_then(|rt| rt.memory.as_mut()) {
            mem.streak = None;
            if mem.boost_until > 0. {
                mem.boost_until = 0.;
            }
        }
    }
    hx.w.pay.card_blocks.clear();
}

pub(crate) fn drop_deferred(hx: &mut Hx, args: &HookArgs) {
    if matches!(args, HookArgs::Teleported | HookArgs::RunEnded) {
        hx.w.deferred.hits.clear();
    }
}

pub(crate) fn flush_bleeds(_hx: &mut Hx, _args: &HookArgs) {}

#[allow(clippy::too_many_arguments)]
pub(crate) fn splash(
    w: &mut World,
    holder: PlayerId,
    victim: PlayerId,
    at: Vec2,
    radius: f64,
    raw: f64,
    phys: f64,
    magic: f64,
    true_: f64,
    weapon: Option<WeaponId>,
) {
    let Some(holder_ix) = w.fighter_idx(holder) else {
        return;
    };
    let mut best: Option<(PlayerId, f64, u32)> = None;
    for i in 0..w.fighter_count() {
        let ix = crate::fighter::FighterIx::of_slot(i);
        let id = w.core(ix).id;
        if id == holder || id == victim || !w.standing(ix) {
            continue;
        }
        if w.mobs.contains(holder) && w.mobs.contains(id) {
            continue;
        }
        let pos = w.core(ix).pos();
        let d = crate::math::hypot(pos.x - at.x, pos.y - at.y);
        if d > radius {
            continue;
        }
        let rank = w
            .actor_origin(id)
            .map(|o| crate::rng::tie_rank_origin(0, w.tick, o))
            .unwrap_or(u32::MAX);
        let replace =
            best.is_none_or(|(_, bd, br)| d < bd - 1e-9 || ((d - bd).abs() <= 1e-9 && rank < br));
        if replace {
            best = Some((id, d, rank));
        }
    }
    let Some((id, _, _)) = best else { return };
    w.deferred.defer_hit(Entry {
        terrain: false,
        dot: false,
        ability: None,
        arena: false,
        source: None,
        critical: false,
        critical_mult: None,
        sig: None,
        execute: false,
        victim: id,
        by: Some(holder),
        packet: crate::state::Packet {
            raw,
            phys,
            magic,
            true_,
        },
        weapon,
        stagger: false,
        projectile: None,
        scale: 1.,
        derived: true,
        passive: true,
    });
    let _ = holder_ix;
}

fn hit_taken(hx: &mut Hx, victim: PlayerId, attacker: PlayerId, entry: &Entry, applied: f64) {
    let Some(ix) = hx.w.fighter_idx(victim) else {
        return;
    };
    let faction = hx.w.core(ix).vitals.faction;
    let build = hx.w.players[ix.slot()].build;
    let max_hp = hx.w.core(ix).vitals.max_hp;
    for effect in catalog::triggers(&build, faction, TriggerOn::HitTaken) {
        let CardEffect::Trigger { arg, action, .. } = *effect else {
            continue;
        };
        if arg > 0. && !(max_hp > 0. && applied >= arg * max_hp - 1e-9) {
            continue;
        }
        match action {
            TriggerAction::Boost {
                attack_speed,
                movement,
                ms,
            } => {
                hx.pay_later(PayLater::CardBoost {
                    id: victim,
                    attack_speed,
                    movement,
                    ms,
                });
            }
            TriggerAction::Return { share, melee } => {
                if melee && !entry.weapon.is_some_and(swings) {
                    continue;
                }
                let mult = returned_mult(hx.w, ix);
                hx.w.deferred.defer_hit(bare_entry(
                    attacker,
                    victim,
                    crate::state::Packet {
                        raw: share * applied * mult,
                        phys: 1.,
                        magic: 0.,
                        true_: 0.,
                    },
                    Some(hx.w.core(ix).active_weapon()),
                    true,
                ));
            }
            TriggerAction::Status {
                to_self,
                kind,
                ms,
                value,
            } => {
                apply_status(
                    hx,
                    if to_self { victim } else { attacker },
                    victim,
                    kind,
                    ms,
                    value,
                    None,
                    StatusTag::from("hitTaken"),
                );
            }
            _ => {}
        }
    }
}

fn run_on_hit(hx: &mut Hx, attacker: PlayerId, victim: PlayerId, entry: &Entry, streak: bool) {
    let Some(ix) = hx.w.fighter_idx(attacker) else {
        return;
    };
    let Some(vx) = hx.w.fighter_idx(victim) else {
        return;
    };
    if !hx.w.standing(vx) {
        return;
    }
    let weapon = entry.weapon;
    let power = weapon.map(on_hit_power).unwrap_or(1.);
    let apps = applications(hx.w, attacker, victim, streak);
    let k = power * apps;
    let faction = hx.w.core(ix).vitals.faction;
    if !hx.w.is_player(ix) {
        return;
    }
    let build = hx.w.players[ix.slot()].build;
    for effect in catalog::on_hits(&build, faction) {
        let CardEffect::OnHit {
            status,
            per,
            cap,
            ms,
        } = *effect
        else {
            continue;
        };
        if status == OnHitStatus::Dot {
            let hit_mult = if streak {
                mult_of(hx.w, ix, crate::stat_fold::MultKey::Hit)
            } else {
                1.
            };
            let raw = (entry.packet.raw / if hit_mult > 0. { hit_mult } else { 1. })
                * entry.scale
                * entry.packet.phys
                * per
                * k;
            if !(raw > 0.) || !(ms > 0.) {
                continue;
            }
            let tag = StatusTag::Text(std::sync::Arc::from(format!("bleed:{}", hx.w.tick)));
            apply_status(
                hx,
                victim,
                attacker,
                status,
                ms,
                None,
                Some(AddValue {
                    per: raw / (ms / 1000.),
                    cap: f64::MAX,
                }),
                tag,
            );
        } else {
            apply_status(
                hx,
                victim,
                attacker,
                status,
                ms,
                None,
                Some(AddValue { per: per * k, cap }),
                StatusTag::from("onHit"),
            );
        }
    }
}

pub(crate) fn start_boost(w: &mut World, id: PlayerId, attack_speed: f64, movement: f64, ms: f64) {
    let Some(ix) = w.idx(id) else { return };
    if !w.players[ix].standing() {
        return;
    }
    let now = w.server_time;
    let mem = runtime::memory_mut(&mut w.players[ix]);
    let running = mem.boost_until > now;
    mem.boost_as = (if running { mem.boost_as } else { 1. }).max(1. + attack_speed);
    mem.boost_move = (if running { mem.boost_move } else { 1. }).max(1. + movement);
    mem.boost_until = mem.boost_until.max(now + ms);
}

fn note_streak(
    w: &mut World,
    ix: usize,
    victims: &[PlayerId],
    counts: &[u32],
    damage: &[f64],
    now: f64,
) {
    let gap = STREAK_GAP_SECONDS * 1000.;
    let existing = w.players[ix]
        .card_runtime
        .as_ref()
        .and_then(|rt| rt.memory.as_ref())
        .and_then(|m| m.streak);
    if let Some(streak) = existing {
        if now - streak.last < gap {
            if let Some(i) = victims.iter().position(|v| *v == streak.target) {
                runtime::memory_mut(&mut w.players[ix]).streak = Some(Streak {
                    target: streak.target,
                    count: streak.count + counts[i],
                    last: now,
                });
                return;
            }
        }
    }
    if victims.is_empty() {
        return;
    }
    let tick = w.tick;
    let rank = |w: &World, id: PlayerId| {
        w.actor_origin(id)
            .map(|o| crate::rng::tie_rank_origin(0, tick, o))
            .unwrap_or(u32::MAX)
    };
    let mut best_i = 0;
    for i in 1..victims.len() {
        let better = damage[i] > damage[best_i]
            || (damage[i] == damage[best_i] && rank(w, victims[i]) < rank(w, victims[best_i]));
        if better {
            best_i = i;
        }
    }
    runtime::memory_mut(&mut w.players[ix]).streak = Some(Streak {
        target: victims[best_i],
        count: counts[best_i],
        last: now,
    });
}

fn wishful(cx: &mut crate::systems::Cx, ix: usize, hits: u32, now: f64) {
    if hits == 0 {
        return;
    }
    let faction = cx.w.players[ix].vitals.faction;
    let build = cx.w.players[ix].build;
    let mut per = 0.;
    for effect in catalog::triggers(&build, faction, TriggerOn::Hit) {
        if let CardEffect::Trigger {
            action: TriggerAction::Cooldown { ms },
            ..
        } = *effect
        {
            per += ms;
        }
    }
    if !(per > 0.) {
        return;
    }
    let Some(cast) = cx.w.players[ix]
        .card_runtime
        .as_ref()
        .and_then(|rt| rt.wish_cast)
    else {
        return;
    };
    let ready = cx.w.players[ix].stocks.wish_ready_at;
    let full = cx.w.players[ix].stocks.wish_full_at.unwrap_or(0.);
    let on_cooldown = ready > now;
    let clock_end = if on_cooldown { ready } else { full };
    if !(clock_end > now) {
        return;
    }
    let mem = runtime::memory_mut(&mut cx.w.players[ix]);
    let mut kept = [Trim { at: 0., ms: 0. }; 16];
    let mut len = 0u8;
    let mut used = 0.;
    for t in &mem.trims[..mem.trim_len as usize] {
        if now - t.at < WISHFUL_WINDOW_MS {
            kept[len as usize] = *t;
            used += t.ms;
            len += 1;
        }
    }
    mem.trims = kept;
    mem.trim_len = len;
    let floor_at = now.max(cast.at + WISHFUL_FLOOR_SHARE * cast.cooldown_ms);
    let cut = (f64::from(hits) * per)
        .min(WISHFUL_BUDGET_MS - used)
        .min(clock_end - floor_at);
    if !(cut > 0.) {
        return;
    }
    if on_cooldown {
        cx.w.players[ix].stocks.wish_ready_at -= cut;
    }
    if let Some(full_at) = cx.w.players[ix].stocks.wish_full_at.as_mut() {
        *full_at = (*full_at - cut).max(0.);
    }
    let mem = runtime::memory_mut(&mut cx.w.players[ix]);
    if (mem.trim_len as usize) < mem.trims.len() {
        mem.trims[mem.trim_len as usize] = Trim { at: now, ms: cut };
        mem.trim_len += 1;
    }
}

fn stillness(w: &mut World, now: f64) {
    for i in 0..w.players.len() {
        let faction = w.players[i].vitals.faction;
        if !w.players[i].build.has_flag(faction, EffectFlag::PlantFeet) {
            continue;
        }
        let (x, y, alive) = {
            let p = &w.players[i];
            (p.body.x, p.body.y, p.standing())
        };
        let mem = runtime::memory_mut(&mut w.players[i]);
        let same = mem.still_known
            && (x - mem.still_x).abs() <= 0.01
            && (y - mem.still_y).abs() <= 0.01
            && alive;
        if !same {
            mem.still_since = now;
            mem.still_x = x;
            mem.still_y = y;
            mem.still_known = true;
        }
    }
}

fn applications(w: &World, attacker: PlayerId, victim: PlayerId, streak: bool) -> f64 {
    let Some(ix) = w.idx(attacker) else { return 1. };
    let faction = w.players[ix].vitals.faction;
    let build = w.players[ix].build;
    let mut n = 1.;
    if build.has_flag(faction, EffectFlag::TwiceUnarmed) && hand_empty(&w.players[ix]) {
        n += 1.;
    }
    if streak && build.has_flag(faction, EffectFlag::ThirdCharm) {
        let before = w.players[ix]
            .card_runtime
            .as_ref()
            .and_then(|rt| rt.memory.as_ref())
            .and_then(|m| m.streak)
            .filter(|s| s.target == victim && w.server_time - s.last < STREAK_GAP_SECONDS * 1000.)
            .map(|s| s.count)
            .unwrap_or(0);
        if (before + 1) % 3 == 0 {
            n += 1.;
        }
    }
    n
}

fn player_flag(w: &World, id: PlayerId, flag: EffectFlag) -> bool {
    w.idx(id).is_some_and(|i| {
        w.players[i]
            .build
            .has_flag(w.players[i].vitals.faction, flag)
    })
}

fn kind_of(e: &Entry) -> Kind {
    if e.is_dot() {
        return Kind::Other;
    }
    if e.passive {
        return Kind::Returned;
    }
    if e.sig.is_none() && e.ability.is_none() && e.weapon.is_some() {
        Kind::Hit
    } else {
        Kind::Other
    }
}

fn swings(w: WeaponId) -> bool {
    matches!(
        crate::content::weapon(w).shape,
        crate::content::Shape::Arc { .. }
    )
}

fn on_hit_power(w: WeaponId) -> f64 {
    match w {
        WeaponId::Sword => SWORD_ON_HIT_POWER,
        WeaponId::Fists => FISTS_ON_HIT_POWER,
        _ => 1.,
    }
}

fn hand_empty(p: &crate::state::Player) -> bool {
    p.weapon.weapon0.is_none() && p.weapon.weapon1.is_none()
}

fn defense(w: &World, ix: crate::fighter::FighterIx) -> (f64, f64) {
    let sheet = w.base_sheet(ix);
    let m = w.core(ix).modifiers.mirrors();
    (
        (sheet.armor + m.armor_bonus).max(0.),
        sheet.shield + m.shield_bonus,
    )
}

fn returned_mult(w: &World, ix: crate::fighter::FighterIx) -> f64 {
    mult_of(w, ix, crate::stat_fold::MultKey::Returned)
}

fn mult_of(w: &World, ix: crate::fighter::FighterIx, key: crate::stat_fold::MultKey) -> f64 {
    w.core(ix).modifiers.mult(key)
}

fn bare_entry(
    victim: PlayerId,
    by: PlayerId,
    packet: crate::state::Packet,
    weapon: Option<WeaponId>,
    passive: bool,
) -> Entry {
    Entry {
        terrain: false,
        dot: false,
        ability: None,
        arena: false,
        source: None,
        critical: false,
        critical_mult: None,
        sig: None,
        execute: false,
        victim,
        by: Some(by),
        packet,
        weapon,
        stagger: false,
        projectile: None,
        scale: 1.,
        derived: false,
        passive,
    }
}

#[allow(clippy::too_many_arguments)]
fn apply_status(
    hx: &mut Hx,
    target: PlayerId,
    source: PlayerId,
    kind: OnHitStatus,
    ms: f64,
    value: Option<f64>,
    add: Option<AddValue>,
    tag: StatusTag,
) {
    let Some(name) = hx.w.actor_label(source) else {
        return;
    };
    let status = match kind {
        OnHitStatus::SlowMove => StatusKind::SlowMove,
        OnHitStatus::SlowAttack => StatusKind::SlowAttack,
        OnHitStatus::AntiHeal => StatusKind::AntiHeal,
        OnHitStatus::Dot => StatusKind::Dot,
    };
    let data = (status == StatusKind::Dot).then_some(Payload {
        shares: Some(DamageShares {
            phys: 1.,
            magic: 0.,
            true_: 0.,
        }),
        ..Payload::default()
    });
    crate::systems::status::operations::apply_with(
        hx.k,
        hx.w,
        hx.ev,
        target,
        StatusApply {
            kind: status,
            source: StatusSource {
                id: Some(source),
                name,
                owner_id: None,
            },
            ms,
            ability: None,
            tag: Some(tag),
            value,
            add,
            data,
        },
        true,
        hx.stats,
    );
}

#[allow(dead_code)] // weapon-phase consumer lands with the next combat packet
pub(crate) fn plant_armed(w: &World, id: PlayerId) -> bool {
    let Some(ix) = w.idx(id) else { return false };
    if !w.players[ix]
        .build
        .has_flag(w.players[ix].vitals.faction, EffectFlag::PlantFeet)
    {
        return false;
    }
    w.players[ix]
        .card_runtime
        .as_ref()
        .and_then(|rt| rt.memory.as_ref())
        .is_some_and(|m| w.server_time - m.still_since >= PLANT_FEET_MS)
}
