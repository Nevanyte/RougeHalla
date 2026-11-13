//! The damage ledger: every hit of the tick lands at once (legacy combat.ts `applyLedger`, arena.ts `applyHits`).
//!
//! Touches: the victims' vitals and kill fields, the attackers' damage lists and credit, the event log and the tick's
//! downed list; reads the ledger, the action-order ranks and the tick-start bounties from the tick scratch.

use crate::constants::*;
use crate::content::{mitigate_shares, pvp_factor, DamageShares, WeaponId};
use crate::events::Event;
use crate::fighter::FighterIx;
use crate::results::Outcome;
use crate::scratch::{TickScratch, NONE};
use crate::state::{Packet, PlayerId, World};
use crate::statics::MatchStatic;
use crate::systems::{credit, settle, weapons, Cx};

/// One hit of the tick ledger. Ordinary weapon rows retain IDs; status rows additionally
/// retain the immutable source snapshot through shared handles, without cloning string bytes.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct Entry {
    pub(crate) terrain: bool,
    pub(crate) dot: bool,
    pub(crate) ability: Option<crate::status_runtime::AbilityId>,
    pub(crate) arena: bool,
    /// Full immutable status source snapshot; by is checked equal to source.id at restore.
    pub(crate) source: Option<crate::status_runtime::StatusSource>,
    pub(crate) critical: bool,
    pub(crate) critical_mult: Option<f64>,
    pub(crate) sig: Option<crate::factions::SignatureKind>,
    pub(crate) execute: bool,
    pub(crate) victim: PlayerId,
    /// Who dealt it; `None` for damage no fighter dealt (legacy `SUDDEN_DEATH_KILLER`: the arena's own damage). Such a hit takes
    /// no PvP factor, gives no damage credit and no rival credit, and a kill by it credits nobody (legacy: sudden death is
    /// the arena's own). Its canonical fx `by`, `weapon` and result `killedBy` ("sudden death") are fixed by the packet that
    /// ports sudden death.
    pub(crate) by: Option<PlayerId>,
    pub(crate) packet: Packet,
    /// What dealt it; `None` for damage no weapon dealt (an ability, a field).
    pub(crate) weapon: Option<WeaponId>,
    pub(crate) stagger: bool,
    pub(crate) projectile: Option<u32>,
    pub(crate) scale: f64,
    pub(crate) derived: bool,
    #[serde(default)]
    pub(crate) passive: bool,
}

impl Entry {
    pub(crate) fn is_dot(&self) -> bool {
        self.dot || self.sig.is_some_and(crate::factions::SignatureKind::is_dot)
    }
    pub(crate) fn credit_id(&self) -> Option<PlayerId> {
        self.source.as_ref().and_then(|s| s.owner_id).or(self.by)
    }
}
/// The source Overkill predicate arithmetic: total damage, then what a player barrier absorbed, then what actually
/// applied. The hook fires only when the result is strictly greater than 1e-9.
pub(crate) fn overkill_excess(total: f64, absorbed: f64, applied: f64) -> f64 {
    total - absorbed - applied
}

/// The runtime predicate also participates in the content identity probes.
pub(crate) fn overkill_fires(excess: f64) -> bool {
    excess > OVERKILL_EPS
}

/// One entry that hit a victim the pass killed with damage to spare (source `OverkillHit`): the entry and its applied share.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct OverkillHit {
    pub(crate) entry: Entry,
    /// The actual mitigated/capped/denied amount for this entry.
    pub(crate) amount: f64,
    /// The source pre-mitigation raw from this pass, after scaling/settlement multiplication and before mitigation,
    /// caps and denials. The existing Overkill splash consumes this value unchanged.
    pub(crate) raw: f64,
}

#[derive(Clone, Debug)]
pub(crate) struct Hit {
    pub(crate) terrain: bool,
    pub(crate) amount: f64,
    pub(crate) by: Option<PlayerId>,
    pub(crate) name: Option<std::sync::Arc<str>>,
}
/// What a payout does when it is paid (legacy `payLater(world, () => ...)`, as typed data). The slice has one: a kill's
/// credit. A packet whose legacy code calls `payLater` adds its variant here and its arm to [`PayLater::pay`]; it never
/// puts the effect in `World::deferred`, which is the NEXT tick's ledger.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum PayLater {
    MobWakes,
    CampCleared {
        camp: u32,
    },
    /// legacy camps.ts `practiceMobDied`: a training console camp's last mob died; its clear reward is paid (no fx, no hook).
    PracticeCampCleared {
        camp_ref: u32,
    },
    MobKill {
        award: super::mob_life::Award,
    },
    #[cfg(feature = "trusted-status-probes")]
    ProbeNested {
        victim: PlayerId,
        source: crate::status_runtime::StatusSource,
    },
    ApplyStatus {
        victim: PlayerId,
        apply: crate::status_runtime::StatusApply,
        quiet: bool,
    },
    RemoveStatuses {
        victim: PlayerId,
        selector: crate::status_runtime::Selector,
    },
    ExecuteDenied {
        owner: PlayerId,
        denied: super::sentenced::Denied,
    },
    ClearStatuses {
        victim: PlayerId,
    },
    /// legacy arena.ts `creditKill`: the kill's GV, bounty and rampage, after every victim took their damage.
    CreditKill {
        by: PlayerId,
        victim: PlayerId,
        outcome: Outcome,
        victim_bot: bool,
        bounty: u32,
    },
}

// Inline queue payloads preserve warmed allocation-free application/removal; source strings are shared handles.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Payout {
    Ordinary(PayLater),
    #[cfg_attr(not(any(test, feature = "trusted-status-probes")), allow(dead_code))]
    // P-ABIL production caller remains pending.
    Displace(super::displace::Request),
}

impl PayLater {
    fn pay(
        self,
        k: &MatchStatic,
        w: &mut World,
        ev: &mut Vec<Event>,
        stats: crate::status_runtime::stats::Inputs,
    ) {
        match self {
            PayLater::MobWakes => super::mob_life::settle_wakes(k, w),
            PayLater::CampCleared { camp } => {
                // Source order: the fx first, then the hook chain (campHeal's reward among its links).
                ev.push(Event::CampCleared { camp });
                crate::hooks::fire(
                    &mut crate::hooks::Hx {
                        stats,
                        k,
                        w,
                        ev,
                        fx: None,
                    },
                    crate::hooks::HookArgs::CampCleared { camp },
                );
            }
            PayLater::PracticeCampCleared { camp_ref } => {
                super::camp_heal::pay_practice(k, w, ev, camp_ref)
            }
            PayLater::MobKill { award } => super::mob_life::pay(k, w, ev, award),
            #[cfg(feature = "trusted-status-probes")]
            PayLater::ProbeNested { victim, source } => {
                crate::status_runtime::probe::pay_nested(k, w, ev, victim, source, stats)
            }
            PayLater::ApplyStatus {
                victim,
                apply,
                quiet,
            } => {
                super::status::operations::apply_with(k, w, ev, victim, apply, quiet, stats);
            }
            PayLater::RemoveStatuses { victim, selector } => {
                super::status::operations::remove_discard_with(k, w, victim, selector, stats)
            }
            PayLater::ClearStatuses { victim } => {
                super::status::clear_fighter_with(k, w, ev, victim, stats)
            }
            PayLater::ExecuteDenied { owner, denied } => crate::hooks::fire(
                &mut crate::hooks::Hx {
                    stats,
                    k,
                    w,
                    ev,
                    fx: None,
                },
                crate::hooks::HookArgs::ExecuteDenied { owner, denied },
            ),
            PayLater::CreditKill {
                by,
                victim,
                outcome,
                victim_bot,
                bounty,
            } => credit::credit_kill(
                k,
                w,
                ev,
                by,
                credit::KillVictim {
                    id: victim,
                    outcome,
                    bot: victim_bot,
                },
                bounty,
            ),
        }
    }
}

/// Legacy `payLater`: queues `p` while the ledger pass runs and pays it at once otherwise (a hook fired outside the pass:
/// `remove_player`, the lobby, the run's end).
pub(crate) fn pay_later(k: &MatchStatic, w: &mut World, ev: &mut Vec<Event>, p: PayLater) {
    pay_later_with(k, w, ev, p, crate::status_runtime::stats::Inputs::default())
}
pub(crate) fn pay_later_with(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    p: PayLater,
    stats: crate::status_runtime::stats::Inputs,
) {
    if w.pay.collecting {
        w.pay.items.push(Payout::Ordinary(p));
    } else {
        p.pay(k, w, ev, stats);
    }
}

/// Ends the pass: everyone has taken their damage, so the queued payouts go out in the order they were queued. A payout
/// that itself calls `pay_later` pays at once, as in legacy (`collecting` is off by then).
#[cfg(test)]
pub(crate) fn pay_all(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    pf: &mut crate::pathfind::Pathfinder,
) {
    pay_all_with(
        k,
        w,
        ev,
        pf,
        crate::status_runtime::stats::Inputs::default(),
    )
}
pub(crate) fn pay_all_with(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    pf: &mut crate::pathfind::Pathfinder,
    stats: crate::status_runtime::stats::Inputs,
) {
    w.pay.collecting = false;
    // Index, not take: the queue keeps its capacity, and a payout cannot queue another (it pays at once now).
    let mut i = 0;
    while i < w.pay.items.len() {
        let p = w.pay.items[i].clone();
        i += 1;
        match p {
            Payout::Ordinary(p) => p.pay(k, w, ev, stats),
            Payout::Displace(request) => request.execute(k, w, pf),
        }
    }
    w.pay.items.clear();
    w.pay.mark_denied_amounts.clear();
    w.pay.mob_wakes.clear();
    w.pay.mob_deaths.clear();
    w.pay.mob_settled.clear();
    w.pay.mob_feeds.clear();
    w.pay.median_feed = 0.;
}

/// What applying one victim's hits touches: everything but the ledger, which it only reads.
struct Pass<'a> {
    #[cfg(feature = "trusted-status-probes")]
    standalone: bool,
    stats: crate::status_runtime::stats::Inputs<'a>,
    #[cfg(feature = "trusted-status-probes")]
    probe: Option<&'a mut crate::status_runtime::probe::HurtRecipe>,
    denies: &'a [(PlayerId, PlayerId)],
    k: &'a MatchStatic,
    w: &'a mut World,
    ev: &'a mut Vec<Event>,
    bounty_at_tick_start: &'a [u32],
    downed: &'a mut Vec<PlayerId>,
    landed: &'a mut Vec<crate::systems::signatures::LandedHit>,
    /// The pass-start canonical camps count per player slot (see [`TickScratch::camps_at_pass_start`]).
    camps_at_pass_start: &'a [u16],
}

/// One victim's working lists (tick scratch, reused for every victim of the pass).
struct Bufs<'a> {
    idxs: &'a mut Vec<usize>,
    amounts: &'a mut Vec<f64>,
    raws: &'a mut Vec<f64>,
    order: &'a mut Vec<(usize, usize)>,
    hits: &'a mut Vec<Hit>,
    dot_sums: &'a mut Vec<(PlayerId, f64)>,
}

/// System (legacy step.ts, the ledger's opening): the entries a hook link deferred last tick (returned damage, Overkill's
/// splash: `World::deferred`, legacy `combat.deferred`; not `payLater`, which is paid inside its own tick, see
/// [`pay_later`]) open this tick's ledger, in the order they were queued, and the melee queue starts empty. The scratch
/// buffers are already empty at the end of every step; this keeps the opening explicit. The slice has no link that
/// defers, so the queue is empty until P-CARDS-1.
pub(crate) fn open(cx: &mut Cx) {
    let Cx { w, s, .. } = cx;
    s.ledger_diagnostics.clear();
    s.blocks.clear();
    s.landed.clear();
    s.ledger.clear();
    s.ledger.append(&mut w.deferred.hits);
    s.melee.clear();
}

/// System (legacy ledger.applyLedger): every hit of the tick lands at once. Outgoing multipliers are fixed before any
/// victim takes damage, each victim's hits are mitigated, capped and applied together (ranked by the secret action order
/// for kill credit), and kill spoils are paid only after every victim took its damage, so no reward decides who survives
/// the pass. The ledger is empty afterwards.
pub(crate) fn apply(cx: &mut Cx) {
    #[cfg(feature = "trusted-status-probes")]
    let mut borrowed = cx.probe.take();
    apply_inner(
        cx,
        #[cfg(feature = "trusted-status-probes")]
        borrowed.as_deref_mut(),
        #[cfg(feature = "trusted-status-probes")]
        false,
    );
    #[cfg(feature = "trusted-status-probes")]
    {
        cx.probe = borrowed;
    }
}
#[cfg(feature = "trusted-status-probes")]
pub(crate) fn apply_probed(cx: &mut Cx, probe: &mut crate::status_runtime::probe::HurtRecipe) {
    // A declared standalone diagnostic opens its own pass without the ordinary signature phase.
    super::sentenced::freeze_denials(cx.k, cx.w, &mut cx.s.mark_denials);
    apply_inner(cx, Some(probe), true);
}
fn apply_inner(
    cx: &mut Cx,
    #[cfg(feature = "trusted-status-probes")] probe: Option<
        &mut crate::status_runtime::probe::HurtRecipe,
    >,
    #[cfg(feature = "trusted-status-probes")] standalone: bool,
) {
    let Cx {
        k,
        w,
        s,
        ev,
        pf,
        stats,
        ..
    } = cx;
    s.ledger_diagnostics.extend(
        s.ledger
            .iter()
            .cloned()
            .map(crate::factions::DamageView::from),
    );
    let TickScratch {
        ledger,
        landed,
        rank,
        bounty_at_tick_start,
        downed_this_tick,
        victims,
        ledger_mults: mults,
        ledger_races: races,
        deny_parts,
        slot_head,
        slot_tail,
        entry_next,
        entry_rank,
        idxs,
        amounts,
        ledger_raws: raws,
        order,
        hits,
        dot_sums,
        mark_denials,
        camps_at_pass_start,
        ..
    } = &mut **s;
    // Freeze the canonical per-player camps count ONCE for this pass, before any victim or deferred payout can increment it:
    // outgoing damage AND execute/full-versus-without queries all read this same snapshot by stable player slot.
    camps_at_pass_start.clear();
    debug_assert!(
        camps_at_pass_start.capacity() >= w.players.len(),
        "camps pass-start scratch capacity is prepared by reserve_actors"
    );
    camps_at_pass_start.extend(w.players.iter().map(|p| p.camps_cleared));
    if ledger.is_empty() {
        camps_at_pass_start.clear();
        return;
    }
    let camps = camps_at_pass_start.as_slice();
    // Group by victim in order of first appearance (legacy Map insertion order): each entry is chained on its victim's
    // slot, so a pass costs O(entries + victims) however many fighters there are. A victim who is no longer present has no
    // slot and nothing to apply to.
    victims.clear();
    entry_next.clear();
    entry_rank.clear();
    if slot_head.len() < w.fighter_count() {
        slot_head.resize(w.fighter_count(), NONE);
        slot_tail.resize(w.fighter_count(), NONE);
    }
    mults.clear();
    races.clear();
    for (n, e) in ledger.iter().enumerate() {
        let vix = w.fighter_idx(e.victim);
        let bix = e.credit_id().and_then(|b| w.fighter_idx(b));
        entry_next.push(NONE);
        // The hit's place in the action order (anyone not in it, such as a leaver, after everyone), looked up once here.
        entry_rank.push(
            bix.and_then(|b| rank.get(b.slot()))
                .map_or(u32::MAX, |&r| r),
        );
        if let Some(v) = vix.map(FighterIx::slot) {
            if slot_head[v] == NONE {
                victims.push(v as u32);
                slot_head[v] = n as u32;
            } else {
                entry_next[slot_tail[v] as usize] = n as u32;
            }
            slot_tail[v] = n as u32;
        }
        // The PvP factor is for a player hitting a player: a mob on either side, or no attacker, takes none.
        let farm_mult = if !e.arena && e.ability.is_none() {
            bix.map_or(1., |i| {
                let kind = if e.is_dot() {
                    crate::modifiers::OutgoingKind::Dot
                } else if e.passive {
                    crate::modifiers::OutgoingKind::Returned
                } else if e.sig.is_none() && e.ability.is_none() && e.weapon.is_some() {
                    crate::modifiers::OutgoingKind::Hit
                } else {
                    crate::modifiers::OutgoingKind::Other
                };
                let victim_id = vix.map(|v| w.core(v).id);
                let frac = vix.map_or(1., |v| {
                    let core = w.core(v);
                    core.vitals.hp / core.vitals.max_hp.max(1e-9)
                });
                let streak = if w.is_player(i) {
                    let p = &w.players[i.slot()];
                    p.card_streak
                        .filter(|s| {
                            Some(s.target) == victim_id
                                && w.server_time - s.last < crate::constants::STREAK_GAP_MS
                        })
                        .map_or(0, |s| s.count)
                } else {
                    0
                };
                let probe = vix.map_or(crate::modifiers::VsProbe::default(), |v| {
                    let core = w.core(v);
                    let player = w.is_player(v);
                    let slowed = core.statuses.instances.iter().any(|s| {
                        matches!(
                            s.kind,
                            crate::status_runtime::StatusKind::SlowMove
                                | crate::status_runtime::StatusKind::SlowAttack
                        ) && s.until > w.server_time
                    });
                    let elite = !player && w.mobs.iter().any(|m| m.core.id == core.id && m.elite);
                    let higher_power = player
                        && w.is_player(i)
                        && w.players[v.slot()].build.power() > w.players[i.slot()].build.power();
                    // Witness: the victim's weapon lock or its last signature target is someone other than the attacker.
                    let attacker = w.core(i).id;
                    let third_party = [core.weapon.targeting.target, core.signature.target]
                        .into_iter()
                        .flatten()
                        .any(|t| t != attacker);
                    crate::modifiers::VsProbe {
                        slowed,
                        elite,
                        higher_power,
                        player,
                        third_party,
                    }
                });
                let build = if w.is_player(i) {
                    w.players[i.slot()].build
                } else {
                    Default::default()
                };
                crate::modifiers::outgoing_damage(
                    w.core(i),
                    &build,
                    frac,
                    kind,
                    e.critical_mult.unwrap_or(1.),
                    if w.is_player(i) {
                        camps.get(i.slot()).copied().unwrap_or(0)
                    } else {
                        0
                    },
                    streak,
                    probe,
                    false,
                )
            })
        } else {
            1.
        };
        let gambler = if !e.arena && e.ability.is_none() {
            bix.filter(|i| {
                w.is_player(*i)
                    && w.players[i.slot()]
                        .build
                        .has_flag(crate::stat_fold::EffectFlag::Gambler)
            })
            .and_then(|_| e.credit_id())
            .map_or(1., |by| {
                let index = ledger[..n]
                    .iter()
                    .filter(|p| p.credit_id() == Some(by) && p.victim == e.victim)
                    .count() as u32;
                crate::cards::gambler_factor(k, w, by, e.victim, index)
            })
        } else {
            1.
        };
        let dealt = bix.map_or(1., |i| {
            let core = w.core(i);
            let cap = crate::modifiers::hp_race_cap(core);
            if cap > 1. {
                crate::modifiers::hp_race_mult(core.vitals.hp / core.vitals.max_hp.max(1e-9), cap)
            } else {
                1.
            }
        });
        let taken = vix.map_or(1., |v| {
            let core = w.core(v);
            let cap = crate::modifiers::hp_race_cap(core);
            if cap > 1. {
                crate::modifiers::hp_race_mult(core.vitals.hp / core.vitals.max_hp.max(1e-9), cap)
            } else {
                1.
            }
        });
        // Already multiplied entries (returned damage, a splash) only take the victim's Race to 0 (G4).
        let final_entry = e.passive || e.derived;
        races.push(if final_entry { taken } else { dealt * taken });
        let credited = e.by.and_then(|id| w.credited_player(id));
        mults.push(
            farm_mult
                * gambler
                * (if final_entry { taken } else { dealt * taken })
                * (if k.config.pvp_rules
                    && !e.arena
                    && e.ability.is_none()
                    && vix
                        .zip(credited)
                        .is_some_and(|(v, b)| w.is_player(v) && w.player(b).is_some())
                {
                    pvp_factor(
                        w.players[w.idx(credited.expect("checked player attacker")).unwrap()]
                            .build
                            .power(),
                    )
                } else {
                    1.0
                }),
        );
    }
    w.pay.items.clear();
    super::mob_life::open(w);
    w.pay.collecting = true;
    // The signature pass already froze source-order owner/member edges before any victim or payout can mutate actors.
    // The independently borrowed scratch slice cannot be rewritten while this Pass is alive.
    let denies = mark_denials.as_slice();
    debug_assert!(w.pay.mark_denied_amounts.is_empty());
    let mut pass = Pass {
        #[cfg(feature = "trusted-status-probes")]
        standalone,
        stats: *stats,
        #[cfg(feature = "trusted-status-probes")]
        probe,
        denies,
        k,
        w,
        ev,
        bounty_at_tick_start,
        downed: downed_this_tick,
        landed,
        camps_at_pass_start: camps,
    };
    let mut bufs = Bufs {
        idxs,
        amounts,
        raws,
        order,
        hits,
        dot_sums,
    };
    for &vi in victims.iter() {
        let vi = vi as usize;
        bufs.idxs.clear();
        let mut n = slot_head[vi];
        while n != NONE {
            bufs.idxs.push(n as usize);
            n = entry_next[n as usize];
        }
        slot_head[vi] = NONE;
        slot_tail[vi] = NONE;
        // The slots were taken before the pass; an earlier victim's death can remove a mob mid-pass (a downed Plague
        // owner's zombie leaves with it, plague_zombies::fighter_out), shifting every later mob slot down. Reacquire the
        // slot by the victim's id (legacy groups by id); a victim no longer present has nothing to apply to. Without a
        // removal this is the same slot.
        let Some(vi) = pass
            .w
            .fighter_idx(ledger[bufs.idxs[0]].victim)
            .map(FighterIx::slot)
        else {
            continue;
        };
        apply_victim(
            &mut pass, &mut bufs, vi, ledger, mults, races, deny_parts, entry_rank,
        );
    }
    pay_all_with(pass.k, pass.w, pass.ev, pf, pass.stats);
    ledger.clear();
    camps_at_pass_start.clear();
}

#[allow(clippy::too_many_arguments)]
fn apply_victim(
    pass: &mut Pass,
    b: &mut Bufs,
    vi: usize,
    ledger: &[Entry],
    mults: &[f64],
    races: &[f64],
    deny_parts: &mut Vec<f64>,
    entry_rank: &[u32],
) {
    let ix = FighterIx::of_slot(vi);
    let player = pass.w.is_player(ix);
    let v = pass.w.core(ix).id;
    if !pass.w.standing(ix) {
        return;
    }
    let defense = pass.w.defense(ix);
    // The armor mirror was folded after last tick's damage pass. A shred reaching
    // its boundary now still affects this hit; an axe in this pass takes effect afterwards.
    let (armor, shield) = defense.map_or((0., 0.), |(base_armor, base_shield)| {
        (
            (base_armor + pass.w.core(ix).modifiers.mirrors().armor_bonus).max(0.),
            base_shield + pass.w.core(ix).modifiers.mirrors().shield_bonus,
        )
    });
    let Bufs {
        idxs,
        amounts,
        raws,
        order,
        hits,
        dot_sums,
    } = b;
    amounts.clear();
    raws.clear();
    amounts.extend(idxs.iter().map(|&k| {
        let e = &ledger[k];
        let attacker =
            e.by.and_then(|id| pass.w.actor(id))
                .map(|p| p.statuses.instances.as_slice())
                .unwrap_or(&[]);
        let factor = crate::status_runtime::settlement_factor(
            attacker,
            &pass.w.core(ix).statuses.instances,
            e.by,
            pass.w.server_time,
            e.arena,
            e.by.and_then(|id| pass.w.actor(id))
                .and_then(|p| pass.stats.view(p).mark_suppression),
        );
        let friendly_mobs = !player && e.by.is_some_and(|id| pass.w.mobs.contains(id));
        let raw_source = if e.scale > 0. {
            e.packet.raw * e.scale * mults[k] * factor
        } else {
            0.
        };
        raws.push(raw_source);
        let raw_damage = if friendly_mobs { 0. } else { raw_source };
        let s = DamageShares {
            phys: e.packet.phys,
            magic: e.packet.magic,
            true_: e.packet.true_,
        };
        mitigate_shares(raw_damage, &s, armor, shield)
    }));
    if player && pass.k.config.pvp_rules {
        let cap = PVP_HIT_CAP_SHARE * pass.w.core(ix).vitals.max_hp;
        let budget = PVP_DOT_CAP_SHARE * pass.w.core(ix).vitals.max_hp * (TICK_MS / 1000.0);
        dot_sums.clear();
        for (j, &index) in idxs.iter().enumerate() {
            let e = &ledger[index];
            let Some(by) = e.by.filter(|id| pass.w.roster.name(*id).is_some()) else {
                continue;
            };
            if e.arena || !(amounts[j] > 0.0) {
                continue;
            }
            if e.is_dot() {
                if let Some((_, sum)) = dot_sums.iter_mut().find(|(id, _)| *id == by) {
                    *sum += amounts[j]
                } else {
                    dot_sums.push((by, amounts[j]));
                }
            } else if amounts[j] > cap {
                amounts[j] = cap;
            }
        }
        for (j, &index) in idxs.iter().enumerate() {
            let e = &ledger[index];
            if e.arena || !e.is_dot() {
                continue;
            }
            if let Some((_, sum)) = dot_sums.iter().find(|(id, _)| Some(*id) == e.by) {
                if *sum > budget {
                    amounts[j] *= budget / *sum;
                }
            }
        }
    }
    // A tier-4 mark denies the execute part of the foe's entries: the whole of an execute entry, or the share the attacker's
    // vs-hpBelow rows add (R7). The execute total cannot take the victim below 1 hp.
    if pass.denies.iter().any(|(owner, _)| *owner == v) {
        let total: f64 = amounts.iter().sum();
        let victim_frac = pass.w.core(ix).vitals.hp_frac_at_tick_start;

        deny_parts.clear();
        let mut x = 0.;
        for (j, &index) in idxs.iter().enumerate() {
            let e = &ledger[index];
            let share = if e.by.is_some_and(|foe| pass.denies.contains(&(v, foe))) {
                let foe_ix = e.by.and_then(|foe| pass.w.fighter_idx(foe));
                if e.execute {
                    1.
                } else {
                    foe_ix.map_or(0., |bix| {
                        let build = if pass.w.is_player(bix) {
                            pass.w.players[bix.slot()].build
                        } else {
                            Default::default()
                        };
                        let kind = if e.is_dot() {
                            crate::modifiers::OutgoingKind::Dot
                        } else if e.passive {
                            crate::modifiers::OutgoingKind::Returned
                        } else if e.sig.is_none() && e.ability.is_none() && e.weapon.is_some() {
                            crate::modifiers::OutgoingKind::Hit
                        } else {
                            crate::modifiers::OutgoingKind::Other
                        };
                        crate::modifiers::execute_share(
                            pass.w.core(bix),
                            &build,
                            victim_frac,
                            kind,
                            e.critical_mult.unwrap_or(1.),
                            if pass.w.is_player(bix) {
                                pass.camps_at_pass_start
                                    .get(bix.slot())
                                    .copied()
                                    .unwrap_or(0)
                            } else {
                                0
                            },
                        )
                    })
                }
            } else {
                0.
            };
            let part = amounts[j] * share;
            deny_parts.push(part);
            x += part;
        }
        let pool = pass.w.core(ix).vitals.hp + pass.w.core(ix).vitals.barrier;
        let allowed = x.min(pool - 1. - (total - x)).max(0.);
        let held = x - allowed;
        if x > 0. && held > MARK_EXECUTE_EPS {
            let mut denied = super::sentenced::Denied::begin(pass.w);
            let keep = allowed / x;
            for j in 0..idxs.len() {
                let part = deny_parts[j];
                if part > 0. {
                    let cut = part * (1. - keep);
                    amounts[j] -= cut;
                    denied.add(
                        pass.w,
                        ledger[idxs[j]].by.expect("frozen denial source"),
                        cut,
                    );
                }
            }
            if denied.any() {
                pay_later(
                    pass.k,
                    pass.w,
                    pass.ev,
                    PayLater::ExecuteDenied { owner: v, denied },
                );
            }
        }
    }
    // The hits land in action-order rank (anyone not in the order, such as a leaver, after everyone). Ties keep the
    // entries' own order: the key (rank, position) is total, so an unstable sort gives the stable sort's order and needs no
    // merge buffer however many hits a victim takes.
    order.clear();
    order.extend((0..idxs.len()).map(|j| (entry_rank[idxs[j]] as usize, j)));
    if player {
        order.sort_unstable();
    }
    hits.clear();
    hits.extend(order.iter().map(|&(_, j)| {
        let e = &ledger[idxs[j]];
        Hit {
            terrain: e.terrain,
            amount: amounts[j],
            by: e.credit_id(),
            name: e.source.as_ref().map(|s| s.name.clone()),
        }
    }));
    let hp_before = pass.w.core(ix).vitals.hp;
    let barrier_before = pass.w.core(ix).vitals.barrier;
    let total: f64 = amounts.iter().sum();
    let applied = if player {
        apply_hits(pass, vi, hits)
    } else {
        super::mob_life::hurt(pass.k, pass.w, pass.ev, ix, hits)
    };
    if !(applied > 0.0) {
        return;
    }
    if pass.w.standing(ix) {
        crate::hooks::fire(
            &mut crate::hooks::Hx {
                stats: pass.stats,
                k: pass.k,
                w: pass.w,
                ev: pass.ev,
                fx: None,
            },
            crate::hooks::HookArgs::Hurt {
                id: v,
                amount: applied,
                before: hp_before,
            },
        );
        #[cfg(feature = "trusted-status-probes")]
        if let Some(probe) = pass.probe.as_deref_mut() {
            probe.fire(pass.k, pass.w, pass.ev, v, pass.stats);
        }
    }
    let landed_share = if !player && total > applied {
        applied / total
    } else if total > 0.0 {
        (1.0 - (barrier_before - pass.w.core(ix).vitals.barrier) / total).max(0.0)
    } else {
        0.0
    };
    if total > 0. {
        for (j, &index) in idxs.iter().enumerate() {
            let e = &ledger[index];
            if e.arena && amounts[j] > 0. {
                crate::hooks::fire(
                    &mut crate::hooks::Hx {
                        stats: pass.stats,
                        k: pass.k,
                        w: pass.w,
                        ev: pass.ev,
                        fx: None,
                    },
                    crate::hooks::HookArgs::ArenaHurt {
                        terrain: e.terrain,
                        victim: v,
                        by: e.by,
                        source: e.source.clone(),
                        amount: (amounts[j] * applied) / total,
                    },
                );
            }
        }
    }
    for (j, &k) in idxs.iter().enumerate() {
        if amounts[j] > 0.0 && !ledger[k].arena {
            let e = &ledger[k];
            {
                pass.landed.push(crate::systems::signatures::LandedHit {
                    critical: e.critical,
                    cut: e.by.and_then(|id| pass.w.actor(id)).map_or(1., |p| {
                        crate::status_runtime::suppression_cut(
                            &p.statuses.instances,
                            pass.w.server_time,
                            pass.stats.view(p).mark_suppression,
                        )
                    }),
                    sig: e.sig,
                    ability: e.ability,
                    dot: e.dot,
                    weapon: e.weapon,
                    victim: v,
                    by: e.by,
                    amount: amounts[j] * landed_share,
                    race: races[k],
                    passive: e.passive,
                    derived: e.derived,
                });
            }
            if let Some(sig) = e.sig.filter(|sig| !sig.is_dot()) {
                if let Some(by) = e.by {
                    pass.ev.push(Event::SignatureHit {
                        victim: v,
                        by,
                        sig,
                        weapon: e.weapon,
                        amount: amounts[j],
                    });
                }
            } else if !e.is_dot() && e.sig.is_none() {
                pass.ev.push(Event::Hit {
                    victim: v,
                    by: e.by,
                    amount: amounts[j],
                    weapon: e.weapon,
                    passive: e.passive,
                    critical: e.critical,
                });
            }
            crate::hooks::fire(
                &mut crate::hooks::Hx {
                    stats: pass.stats,
                    fx: None,
                    k: pass.k,
                    w: pass.w,
                    ev: pass.ev,
                },
                crate::hooks::HookArgs::HitLanded {
                    entry: e.clone(),
                    amount: amounts[j],
                },
            );
        }
    }
    if pass.w.standing(ix)
        && idxs
            .iter()
            .enumerate()
            .any(|(j, &k)| ledger[k].stagger && amounts[j] > 0.0)
    {
        let now = pass.w.server_time;
        let id = pass.w.core(ix).id;
        if weapons::stagger_immunity(pass.w.core_mut(ix), now) {
            // Legacy weapons.stagger fires world.hooks.staggered after the immunity clock, before the cancel.
            crate::hooks::fire(
                &mut crate::hooks::Hx {
                    stats: pass.stats,
                    fx: None,
                    k: pass.k,
                    w: pass.w,
                    ev: pass.ev,
                },
                crate::hooks::HookArgs::Staggered { id },
            );
            weapons::stagger_cancel(pass.w.core_mut(ix), now, pass.ev);
        }
    }
    // Source ledger: every hitLanded and stagger callback precedes overkilled. What a player's barrier swallowed was
    // never aimed at hp; the excess uses the source operation order total, absorbed, applied. Entries are included in
    // their original ledger order, filtered to positive non-arena amounts, each with its own applied amount and raw.
    if !pass.w.standing(ix) {
        let absorbed = if player {
            (barrier_before - pass.w.core(ix).vitals.barrier).max(0.0)
        } else {
            0.0
        };
        let overkill = overkill_excess(total, absorbed, applied);
        if overkill_fires(overkill) {
            let hits: Vec<OverkillHit> = idxs
                .iter()
                .enumerate()
                .filter(|(j, &index)| amounts[*j] > 0.0 && !ledger[index].arena)
                .map(|(j, &index)| OverkillHit {
                    entry: ledger[index].clone(),
                    amount: amounts[j],
                    raw: raws[j],
                })
                .collect();
            crate::hooks::fire(
                &mut crate::hooks::Hx {
                    stats: pass.stats,
                    k: pass.k,
                    w: pass.w,
                    ev: pass.ev,
                    fx: None,
                },
                crate::hooks::HookArgs::Overkilled {
                    victim: v,
                    hits,
                    overkill,
                    total,
                },
            );
        }
    }
}

#[cfg(test)]
mod camps_tests;

#[cfg(all(test, feature = "trusted-status-probes"))]
mod overkill_source_tests;

/// Legacy `applyHits` for a player victim: the hits land together; the kill goes to the largest rival hit.
fn apply_hits(pass: &mut Pass, vi: usize, hits: &[Hit]) -> f64 {
    let w = &mut *pass.w;
    let now = w.server_time;
    {
        let v = &w.players[vi];
        if !v.standing() || v.vitals.hp <= 0.0 || now < v.vitals.immune_until {
            return 0.0;
        }
    }
    let victim_id = w.players[vi].id;
    let victim_bot = w.players[vi].seat.bot;
    let mut total = 0.0;
    let mut top: Option<usize> = None;
    let mut top_rival: Option<usize> = None;
    for (h, hit) in hits.iter().enumerate() {
        let (amount, by) = (&hit.amount, &hit.by);
        if !(*amount > 0.0) {
            continue;
        }
        total += amount;
        if top.is_none_or(|t| *amount > hits[t].amount) {
            top = Some(h);
        }
        // A source still in the run (not resolved) is an attacker; anyone else is a name only.
        if let Some((si, by)) = by.and_then(|b| w.idx(b).map(|si| (si, b))) {
            if !w.players[si].resolved && by != victim_id {
                let src = &mut w.players[si];
                if !src.credit.damaged.contains(&victim_id) {
                    src.credit.damaged.push(victim_id);
                }
                if !victim_bot && !src.credit.damaged_humans.contains(&victim_id) {
                    src.credit.damaged_humans.push(victim_id);
                }
                if top_rival.is_none_or(|t| *amount > hits[t].amount) {
                    top_rival = Some(h);
                }
            }
        }
    }
    let Some(top) = top else { return 0.0 };
    if let Some(r) = top_rival {
        w.players[vi].credit.last_hit = hits[r].by.map(|b| (b, now));
    }
    let v = &mut w.players[vi];
    if v.vitals.barrier > 0.0 {
        let taken = v.vitals.barrier.min(total);
        v.vitals.barrier = if v.vitals.barrier - taken < BARRIER_EPS {
            0.0
        } else {
            v.vitals.barrier - taken
        };
        total -= taken;
    }
    if !(total > 0.0) {
        return 0.0;
    }
    let before = v.vitals.hp;
    let unheld = (before - total).max(0.0);
    v.vitals.hp = crate::status_runtime::floor_hp(&mut v.statuses.instances, now, before, total);
    if v.vitals.hp > 0.0 {
        return if v.vitals.hp > unheld {
            total
        } else {
            before - v.vitals.hp
        };
    }
    let killer = top_rival.unwrap_or(top);
    let kid = hits[killer].by;
    let killer_idx = kid
        .and_then(|k| w.idx(k))
        .filter(|&k| !w.players[k].resolved);
    let killer_bot = killer_idx.map(|k| w.players[k].seat.bot).unwrap_or(false);
    let killer_label = kid.and_then(|id| w.actor_label(id));
    // A death fx names its killer only when a PLAYER landed the fatal damage (legacy: by is the combatant object id;
    // a mob's source is a tag string, so a mob-caused death carries no by).
    let killer_present = kid.is_some_and(|id| w.player(id).is_some());
    let (vx, vy) = (w.players[vi].body.x, w.players[vi].body.y);
    {
        let v = &mut w.players[vi];
        // The killer, by id: the roster names it when the result is built (legacy: the attacker's name, or the source
        // name of one who already left).
        v.fate.killed_by = kid;
        v.fate.killed_by_name = if killer_idx.is_none() {
            hits[killer].name.clone().or(killer_label)
        } else {
            None
        };
        if killer_bot {
            v.fate.killed_by_bot = true;
        }
    }
    pass.ev.push(Event::Death {
        id: victim_id,
        x: vx,
        y: vy,
        by: if killer_present { kid } else { None },
    });
    let credited = match top_rival {
        Some(r) => hits[r].by,
        // Legacy arena.ts: a kill whose top hit is the arena's own (sudden death) credits nobody; only a sourced top hit
        // falls back to the recent rival. A self-hit (the attacker is the victim) credits nobody either.
        None if hits[top].terrain => credit::recent_rival(w, vi, now),
        None => hits[top]
            .by
            .filter(|b| *b != victim_id)
            .and_then(|_| credit::recent_rival(w, vi, now)),
    };
    if let Some(c) = credited {
        let bounty = credit::owed_bounty(w, pass.bounty_at_tick_start, vi);
        pay_later(
            pass.k,
            w,
            pass.ev,
            PayLater::CreditKill {
                by: c,
                victim: victim_id,
                outcome: Outcome::Died,
                victim_bot,
                bounty,
            },
        );
    }
    #[cfg(feature = "trusted-status-probes")]
    if pass.standalone {
        settle::down_player(pass.k, w, pass.ev, None, vi, Outcome::Died);
        return before;
    }
    settle::down_player(pass.k, w, pass.ev, Some(pass.downed), vi, Outcome::Died);
    before
}

/// Test-only: the real player-damage path for a declared, already-mitigated hit (the pinned capture's declared
/// `applyDamage` producer). No kill credit or PvP factor: a declared source is the arena's own damage. The caller keeps
/// the hit non-lethal (the captured damage cases are), so the downed list must stay empty.
#[cfg(test)]
pub(crate) fn apply_declared_hit(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    vi: usize,
    amount: f64,
) -> f64 {
    let mut downed = Vec::new();
    let mut landed = Vec::new();
    let mut pass = Pass {
        #[cfg(feature = "trusted-status-probes")]
        standalone: true,
        stats: crate::status_runtime::stats::Inputs::default(),
        #[cfg(feature = "trusted-status-probes")]
        probe: None,
        denies: &[],
        k,
        w,
        ev,
        bounty_at_tick_start: &[],
        downed: &mut downed,
        landed: &mut landed,
        camps_at_pass_start: &[],
    };
    let hit = Hit {
        terrain: false,
        amount,
        by: None,
        name: None,
    };
    let applied = apply_hits(&mut pass, vi, &[hit]);
    assert!(downed.is_empty(), "a declared non-lethal hit never downs");
    applied
}
/// Source recordHit, before a later melee interception may reduce the stored projectile scale.
pub(crate) fn record_hit(w: &mut World, ledger: &mut Vec<Entry>, mut entry: Entry) {
    if entry.by.is_some_and(|id| w.mobs.contains(id)) && w.mobs.contains(entry.victim) {
        entry.scale = 0.;
    }
    if entry.scale > 0. && w.players.contains(entry.victim) {
        let now = w.server_time;
        if let Some(m) = entry.by.and_then(|id| w.mobs.get_mut(id)) {
            if let Some(brain) = &mut m.brain {
                brain.last_combat_at = now;
            }
        }
    }
    ledger.push(entry);
}
