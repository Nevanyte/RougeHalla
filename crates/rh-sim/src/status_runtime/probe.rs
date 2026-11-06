//! Explicit trusted-helper harness. This module is absent from production builds.
//! Recipes and modifier inputs are owned by the harness, never by World or a checkpoint.
#![cfg(feature = "trusted-status-probes")]
use super::*;
use crate::state::{Packet, Player};
use crate::{
    hooks::{HookArgs, Hx},
    state::World,
    statics::MatchStatic,
    systems::{self, ledger, Cx},
};
use crate::{Event, PlayerId, RawCommand, Sim, Vec2};

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub enum HookRecord {
    CastAccepted {
        actor: Box<Player>,
        ability: AbilityId,
    },
    CastLanded {
        actor: Box<Player>,
        ability: AbilityId,
    },
    StatusApplied {
        actor: Box<Player>,
        status: StatusInstance,
        fresh: bool,
    },
    Hurt {
        actor: Box<Player>,
        amount: f64,
        before: f64,
    },
    ArenaHurt {
        victim: PlayerId,
        by: Option<PlayerId>,
        source: Option<StatusSource>,
        amount: f64,
    },
    HitLanded {
        hit: ProbeHit,
        amount: f64,
    },
    FighterOut {
        id: PlayerId,
        removed: bool,
    },
    AttackStarted {
        actor: Box<Player>,
    },
    CastEnded {
        actor: Box<Player>,
        ability: AbilityId,
        reason: CastEndReason,
    },
    Healed {
        actor: Box<Player>,
        amount: f64,
        source: HealSource,
    },
    Teleported,
    RunEnded,
}
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
pub enum HealSource {
    Ordinary,
    Lifesteal,
    IgnoreLockout,
    DeathFloor,
}
#[derive(Debug, Default)]
pub(crate) struct ProbeLog {
    pub enabled: bool,
    pub records: Vec<HookRecord>,
    pub callbacks: Vec<CallbackRecord>,
}
pub(crate) fn record_hook(w: &mut World, args: &HookArgs) {
    if !w.trace.1.enabled {
        return;
    }
    let record = match args {
        HookArgs::StatusApplied {
            id, index, fresh, ..
        } => w.player(*id).and_then(|p| {
            p.statuses
                .instances
                .get(*index)
                .map(|st| HookRecord::StatusApplied {
                    actor: Box::new(p.clone()),
                    status: st.clone(),
                    fresh: *fresh,
                })
        }),
        HookArgs::Hurt { id, amount, before } => w.player(*id).map(|p| HookRecord::Hurt {
            actor: Box::new(p.clone()),
            amount: *amount,
            before: *before,
        }),
        HookArgs::ArenaHurt {
            victim,
            by,
            source,
            amount,
            ..
        } => Some(HookRecord::ArenaHurt {
            victim: *victim,
            by: *by,
            source: source.clone(),
            amount: *amount,
        }),
        HookArgs::HitLanded { entry, amount } => Some(HookRecord::HitLanded {
            hit: {
                let mut h: ProbeHit = entry.clone().into();
                if entry.source.is_none() {
                    if let Some(name) = entry.by.and_then(|id| w.roster.label(id)) {
                        h.source.name = name.clone();
                    }
                }
                h
            },
            amount: *amount,
        }),
        HookArgs::FighterOut { id, cause } => Some(HookRecord::FighterOut {
            id: *id,
            removed: *cause == crate::hooks::OutCause::Removed,
        }),
        HookArgs::AttackStarted(id) => w.player(*id).map(|p| HookRecord::AttackStarted {
            actor: Box::new(p.clone()),
        }),
        HookArgs::Teleported => Some(HookRecord::Teleported),
        HookArgs::RunEnded => Some(HookRecord::RunEnded),
        _ => None,
    };
    if let Some(r) = record {
        w.trace.1.records.push(r);
    }
}
pub(crate) fn record_cast(w: &mut World, id: PlayerId, ability: AbilityId, reason: CastEndReason) {
    if w.trace.1.enabled {
        if let Some(p) = w.player(id) {
            let r = HookRecord::CastEnded {
                actor: Box::new(p.clone()),
                ability,
                reason,
            };
            w.trace.1.records.push(r);
        }
    }
}
pub(crate) fn record_heal(w: &mut World, i: usize, amount: f64, kind: systems::heal::Kind) {
    if w.trace.1.enabled {
        let source = match kind {
            systems::heal::Kind::Ordinary => HealSource::Ordinary,
            systems::heal::Kind::Lifesteal => HealSource::Lifesteal,
            systems::heal::Kind::IgnoreLockout => HealSource::IgnoreLockout,
            systems::heal::Kind::DeathFloor => HealSource::DeathFloor,
            systems::heal::Kind::QuietRegen | systems::heal::Kind::QuietOrdinary => return,
        };
        w.trace.1.records.push(HookRecord::Healed {
            actor: Box::new(w.players[i].clone()),
            amount,
            source,
        });
    }
}

/// Closed hit input. Source identity has one owner; the private ledger by field is derived from it.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProbeHit {
    pub sig: Option<crate::factions::SignatureKind>,
    pub source: StatusSource,
    pub victim: PlayerId,
    pub packet: Packet,
    pub weapon: Option<crate::WeaponId>,
    pub dot: bool,
    pub ability: Option<AbilityId>,
    pub arena: bool,
    pub stagger: bool,
    pub critical: bool,
    pub critical_mult: Option<f64>,
}
impl From<ProbeHit> for ledger::Entry {
    fn from(h: ProbeHit) -> Self {
        Self {
            terrain: false,
            by: h.source.id,
            source: Some(h.source),
            victim: h.victim,
            packet: h.packet,
            weapon: h.weapon,
            dot: h.dot,
            ability: h.ability,
            arena: h.arena,
            stagger: h.stagger,
            critical: h.critical,
            critical_mult: h.critical_mult,
            sig: h.sig,
            execute: false,
            projectile: None,
            scale: 1.,
            derived: false,
            passive: false,
        }
    }
}
impl From<ledger::Entry> for ProbeHit {
    fn from(h: ledger::Entry) -> Self {
        Self {
            sig: h.sig,
            source: h.source.unwrap_or(StatusSource {
                id: h.by,
                name: "".into(),
                owner_id: None,
            }),
            victim: h.victim,
            packet: h.packet,
            weapon: h.weapon,
            dot: h.dot,
            ability: h.ability,
            arena: h.arena,
            stagger: h.stagger,
            critical: h.critical,
            critical_mult: h.critical_mult,
        }
    }
}
#[derive(Clone, Debug, serde::Serialize)]
pub enum Reaction {
    Nested {
        id: PlayerId,
        source: StatusSource,
    },
    Apply {
        id: PlayerId,
        apply: StatusApply,
        quiet: bool,
    },
    Remove {
        id: PlayerId,
        selector: Selector,
    },
    Displace {
        id: PlayerId,
        to: Vec2,
    },
    DeferHit(ProbeHit),
}
#[derive(Clone, Debug, serde::Serialize)]
pub enum CallbackReturn {
    Undefined,
    Status(Option<StatusInstance>),
    Statuses(Vec<StatusInstance>),
    Hit(ProbeHit),
}
#[derive(Clone, Debug, serde::Serialize)]
pub struct CallbackRecord {
    pub victim: PlayerId,
    pub operation: Reaction,
    pub returned: CallbackReturn,
    pub collecting: bool,
    pub statuses: Vec<StatusInstance>,
}
#[derive(Clone, Debug, Default)]
pub struct HurtRecipe {
    pub victim: Option<PlayerId>,
    pub operations: Vec<Reaction>,
}
impl HurtRecipe {
    pub(crate) fn fire(
        &mut self,
        k: &MatchStatic,
        w: &mut World,
        ev: &mut Vec<Event>,
        victim: PlayerId,
        stats: stats::Inputs,
    ) {
        if self.victim.is_some_and(|v| v != victim) {
            return;
        }
        for op in &self.operations {
            let returned =
                match op {
                    Reaction::Nested { id, source } => {
                        ledger::pay_later_with(
                            k,
                            w,
                            ev,
                            ledger::PayLater::ProbeNested {
                                victim: *id,
                                source: source.clone(),
                            },
                            stats,
                        );
                        CallbackReturn::Undefined
                    }
                    Reaction::Apply { id, apply, quiet } => {
                        let applied = systems::status::operations::apply_with(
                            k,
                            w,
                            ev,
                            *id,
                            apply.clone(),
                            *quiet,
                            stats,
                        );
                        CallbackReturn::Status(applied.and_then(|a| {
                            w.player(*id).map(|p| p.statuses.instances[a.index].clone())
                        }))
                    }
                    Reaction::Remove { id, selector } => {
                        let mut removed = Vec::new();
                        systems::status::operations::remove_into_with(
                            k,
                            w,
                            ev,
                            *id,
                            *selector,
                            &mut removed,
                            stats,
                        );
                        CallbackReturn::Statuses(removed)
                    }
                    Reaction::Displace { id, to } => {
                        systems::displace::queue_probe(w, *id, *to)
                            .expect("Hurt executes while ledger collects");
                        CallbackReturn::Undefined
                    }
                    Reaction::DeferHit(hit) => {
                        w.deferred.defer_hit(hit.clone().into());
                        CallbackReturn::Hit(hit.clone())
                    }
                };
            if w.trace.1.enabled {
                let id = match op {
                    Reaction::Nested { id, .. }
                    | Reaction::Apply { id, .. }
                    | Reaction::Remove { id, .. }
                    | Reaction::Displace { id, .. } => *id,
                    Reaction::DeferHit(_) => victim,
                };
                let statuses = w
                    .player(id)
                    .map(|p| p.statuses.instances.clone())
                    .unwrap_or_default();
                w.trace.1.callbacks.push(CallbackRecord {
                    victim,
                    operation: op.clone(),
                    returned,
                    collecting: w.pay.collecting,
                    statuses,
                });
            }
        }
    }
}
#[derive(Clone, Debug, Default)]
pub struct ActorPatch {
    pub hp: Option<f64>,
    pub max_hp: Option<f64>,
    pub barrier: Option<f64>,
    pub immune_until: Option<f64>,
    pub position: Option<Vec2>,
    pub cast: Option<Option<CastFact>>,
    pub path: Option<Vec<Vec2>>,
    pub status: Option<crate::Status>,
    pub combat_at: Option<Option<f64>>,
    pub down: Option<Option<crate::results::Outcome>>,
    pub weapon0: Option<Option<crate::WeaponId>>,
    pub signature_bits: Option<u8>,
    pub history: Option<Vec<crate::state::Sample>>,
    pub slip: Option<Option<crate::fighter::SlipState>>,
    pub targeting: Option<crate::state::Targeting>,
    pub displace_seq: Option<u8>,
}
/// Closed, feature-only commands stay inline so allocation probes can reuse caller-owned handles.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug)]
pub enum Operation {
    ReplaceMap(crate::map::TileMap),
    Clock {
        at: f64,
        tick: u32,
    },
    Actor {
        id: PlayerId,
        patch: ActorPatch,
    },
    Apply {
        id: PlayerId,
        apply: StatusApply,
        quiet: bool,
    },
    Remove {
        id: PlayerId,
        selector: Selector,
    },
    Reveal {
        id: PlayerId,
        until: f64,
    },
    Nested {
        id: PlayerId,
        source: StatusSource,
    },
    Collect(bool),
    Drain,
    Displace {
        id: PlayerId,
        to: Vec2,
    },
    AddField(Field),
    RemoveField(u32),
    RemoveFields(FieldSelector),
    UpdateAbilities,
    Hit(ProbeHit),
    DeferHit(ProbeHit),
    ApplyLedger,
    ClearLedger,
    StatusDamage {
        dt_ms: f64,
    },
    AbilityDotFx,
    Heal {
        id: PlayerId,
        amount: f64,
        source: HealSource,
    },
    ClearAll {
        teleport: bool,
    },
    Teleported,
    RunEnded,
    Input {
        id: PlayerId,
        raw: RawCommand,
    },
    Step,
    RemovePlayer(PlayerId),
}
#[derive(Clone, Debug, PartialEq)]
pub enum Returned {
    Undefined,
    Status(Option<StatusInstance>),
    Statuses(Vec<StatusInstance>),
    Field(Option<Field>),
    Fields(Vec<Field>),
    Amount(f64),
    Events(Vec<Event>),
}
#[derive(Clone, Debug, serde::Serialize)]
pub struct Snapshot {
    pub time: f64,
    pub tick: u32,
    pub players: Vec<Player>,
    pub abilities: Option<AbilityRuntime>,
    pub events: Vec<Event>,
    pub ledger: Vec<ProbeHit>,
    pub deferred: Vec<ProbeHit>,
    pub collecting: bool,
    pub payouts: usize,
    pub entity_counter: u32,
    pub landed: Vec<crate::LandedHit>,
    pub hooks: Vec<HookRecord>,
    pub callbacks: Vec<CallbackRecord>,
    pub spawn_rng: crate::rng::Mulberry32,
    pub suppressed: Vec<(PlayerId, f64)>,
}
pub struct Harness {
    sim: Sim,
    events: Vec<Event>,
    recipe: HurtRecipe,
    stats: Vec<(PlayerId, StatView)>,
}
impl Harness {
    pub fn new(mut sim: Sim) -> Self {
        sim.w.trace.1.enabled = true;
        Self {
            sim,
            events: Vec::new(),
            recipe: HurtRecipe::default(),
            stats: Vec::new(),
        }
    }
    /// The disabled path is used to prove that observations do not change simulation work.
    pub fn clear_schedule_trace(&mut self) {
        self.sim.clear_schedule_trace();
    }
    pub fn set_observers(&mut self, enabled: bool) {
        self.sim.w.trace.1.enabled = enabled;
    }
    pub fn set_recipe(&mut self, recipe: HurtRecipe) {
        self.recipe = recipe;
    }
    pub fn set_stats(&mut self, id: PlayerId, view: StatView) {
        if let Some(v) = self.stats.iter_mut().find(|v| v.0 == id) {
            v.1 = view
        } else {
            self.stats.push((id, view))
        }
        if let Some(i) = self.sim.w.idx(id) {
            systems::items::refold_modifiers_with(
                &self.sim.k,
                &mut self.sim.w,
                i,
                stats::Inputs::supplied(&self.stats),
            );
        }
    }
    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            time: self.sim.w.server_time,
            tick: self.sim.w.tick,
            players: self.sim.w.players.iter().cloned().collect(),
            abilities: self.sim.w.abilities.clone(),
            events: self
                .events
                .iter()
                .chain(&self.sim.w.pending_events)
                .cloned()
                .collect(),
            ledger: self.sim.s.ledger.iter().cloned().map(Into::into).collect(),
            deferred: self
                .sim
                .w
                .deferred
                .hits
                .iter()
                .cloned()
                .map(Into::into)
                .collect(),
            collecting: self.sim.w.pay.collecting,
            payouts: self.sim.w.pay.items.len(),
            entity_counter: self.sim.w.entity_counter,
            landed: self.sim.s.landed.clone(),
            hooks: self.sim.w.trace.1.records.clone(),
            callbacks: self.sim.w.trace.1.callbacks.clone(),
            spawn_rng: self.sim.w.spawn_rng.clone(),
            suppressed: self
                .stats
                .iter()
                .filter_map(|(id, v)| v.mark_suppression.map(|n| (*id, n)))
                .collect(),
        }
    }
    /// Allocation probes reuse the same caller-owned event buffer as ordinary Sim::step_into.
    pub fn step_into(&mut self, out: &mut Vec<Event>) {
        out.append(&mut self.events);
        self.sim.step_into_with(
            out,
            stats::Inputs::supplied(&self.stats),
            Some(&mut self.recipe),
        );
    }
    pub fn sim(&self) -> &Sim {
        &self.sim
    }
    pub fn stat_view(&self, id: PlayerId) -> StatView {
        self.stats
            .iter()
            .find(|p| p.0 == id)
            .map_or_else(StatView::default, |p| p.1)
    }
    pub fn execute(&mut self, op: Operation) -> Result<Returned, &'static str> {
        if let Operation::ReplaceMap(map) = op {
            let mut arena = (*self.sim.k.arena).clone();
            arena.map = map;
            self.sim.k = MatchStatic::new(self.sim.k.config.clone(), arena, self.sim.k.secrets);
            return Ok(Returned::Undefined);
        }

        let Sim { k, w, s, pf, .. } = &mut self.sim;
        let ev = &mut self.events;
        let mut cx = Cx {
            stats: stats::Inputs::supplied(&self.stats),
            #[cfg(feature = "trusted-status-probes")]
            probe: None,
            k,
            w,
            s,
            pf,
            ev,
        };
        let result = match op {
            Operation::ReplaceMap(_) => unreachable!("handled before context borrowing"),
            Operation::Clock { at, tick } => {
                if !at.is_finite() || at < 0. {
                    return Err("invalid clock");
                };
                cx.w.server_time = at;
                cx.w.tick = tick;
                Returned::Undefined
            }
            Operation::Actor { id, patch } => {
                let i = cx.w.idx(id).ok_or("missing actor")?;
                let p = &mut cx.w.players[i];
                if let Some(v) = patch.hp {
                    p.vitals.hp = v;
                }
                if let Some(v) = patch.max_hp {
                    p.vitals.max_hp = v;
                }
                if let Some(v) = patch.barrier {
                    p.vitals.barrier = v;
                }
                if let Some(v) = patch.immune_until {
                    p.vitals.immune_until = v;
                }
                if let Some(v) = patch.position {
                    p.body.x = v.x;
                    p.body.y = v.y;
                }
                if let Some(v) = patch.cast {
                    p.statuses.cast = v;
                    p.statuses.refresh_effects(cx.w.server_time);
                }
                if let Some(v) = patch.path {
                    p.motion.path.set_from(&v);
                }
                if let Some(v) = patch.status {
                    p.status = v;
                }
                if let Some(v) = patch.combat_at {
                    p.signature.combat_at = v;
                }
                if let Some(v) = patch.down {
                    p.down = v;
                }
                if let Some(v) = patch.weapon0 {
                    p.weapon.weapon0 = v;
                }
                if let Some(v) = patch.signature_bits {
                    p.signature.bits = v;
                }
                if let Some(v) = patch.history {
                    p.body.history.clear();
                    for sample in v {
                        p.body.history.push(sample)
                    }
                }
                if let Some(v) = patch.slip {
                    p.motion.slip = v;
                }
                if let Some(v) = patch.targeting {
                    p.weapon.targeting = v;
                }
                if let Some(v) = patch.displace_seq {
                    p.motion.displace_seq = v;
                }
                Returned::Undefined
            }
            Operation::Apply { id, apply, quiet } => {
                let r = systems::status::operations::apply_with(
                    cx.k, cx.w, cx.ev, id, apply, quiet, cx.stats,
                );
                Returned::Status(r.and_then(|r| {
                    cx.w.player(id)
                        .and_then(|p| p.statuses.instances.get(r.index))
                        .cloned()
                }))
            }
            Operation::Remove { id, selector } => {
                let mut out = Vec::new();
                systems::status::operations::remove_into_with(
                    cx.k, cx.w, cx.ev, id, selector, &mut out, cx.stats,
                );
                Returned::Statuses(out)
            }
            Operation::Reveal { id, until } => {
                let i = cx.w.idx(id).ok_or("missing actor")?;
                reveal(&mut cx.w.players[i].statuses, cx.w.server_time, until);
                Returned::Undefined
            }
            Operation::Nested { id, source } => {
                ledger::pay_later_with(
                    cx.k,
                    cx.w,
                    cx.ev,
                    ledger::PayLater::ProbeNested { victim: id, source },
                    cx.stats,
                );
                Returned::Undefined
            }
            Operation::Collect(v) => {
                cx.w.pay.collecting = v;
                Returned::Undefined
            }
            Operation::Drain => {
                ledger::pay_all_with(cx.k, cx.w, cx.ev, cx.pf, cx.stats);
                Returned::Undefined
            }
            Operation::Displace { id, to } => {
                systems::displace::apply(cx.k, cx.w, cx.pf, id, to);
                Returned::Undefined
            }
            Operation::AddField(f) => {
                let id = systems::fields::add(cx.w, f);
                Returned::Field(
                    cx.w.abilities
                        .as_ref()
                        .and_then(|a| a.fields.iter().find(|f| f.id == id))
                        .cloned(),
                )
            }
            Operation::RemoveField(id) => Returned::Field(systems::fields::remove(cx.w, id)),
            Operation::RemoveFields(selector) => {
                let mut out = Vec::new();
                systems::fields::remove_into(cx.w, selector, &mut out);
                Returned::Fields(out)
            }
            Operation::UpdateAbilities => {
                systems::status::expire(&mut cx);
                systems::abilities::land(&mut cx);
                systems::status::finish(&mut cx);
                Returned::Undefined
            }
            Operation::Hit(h) => {
                cx.s.ledger.push(h.into());
                Returned::Undefined
            }
            Operation::DeferHit(h) => {
                cx.w.deferred.defer_hit(h.into());
                Returned::Undefined
            }
            Operation::ApplyLedger => {
                systems::settle::mark_tick_start(&mut cx);
                ledger::apply_probed(&mut cx, &mut self.recipe);
                Returned::Undefined
            }
            Operation::ClearLedger => {
                cx.s.ledger.clear();
                cx.s.landed.clear();
                Returned::Undefined
            }
            Operation::StatusDamage { dt_ms } => {
                if !dt_ms.is_finite() || dt_ms < 0. {
                    return Err("invalid damage delta");
                };
                systems::status::dot::damage_with(&mut cx, dt_ms, |p| {
                    self.stats
                        .iter()
                        .find(|x| x.0 == p.id)
                        .map_or_else(|| stats::view(p), |x| x.1)
                });
                Returned::Undefined
            }
            Operation::AbilityDotFx => {
                systems::status::dot::report(&mut cx);
                Returned::Undefined
            }
            Operation::Heal { id, amount, source } => {
                let i = cx.w.idx(id).ok_or("missing actor")?;
                let kind = match source {
                    HealSource::Ordinary => systems::heal::Kind::Ordinary,
                    HealSource::Lifesteal => systems::heal::Kind::Lifesteal,
                    HealSource::IgnoreLockout => systems::heal::Kind::IgnoreLockout,
                    HealSource::DeathFloor => systems::heal::Kind::DeathFloor,
                };
                Returned::Amount({
                    let view = cx.stats.view(&cx.w.players[i]);
                    systems::heal::apply_with(cx.w, cx.ev, i, amount, kind, view)
                })
            }
            Operation::ClearAll { teleport } => {
                systems::status::clear_all(
                    &mut Hx {
                        stats: cx.stats,
                        k: cx.k,
                        w: cx.w,
                        ev: cx.ev,
                        fx: Some(&mut cx.s.fx),
                    },
                    teleport,
                );
                Returned::Undefined
            }
            Operation::Teleported | Operation::RunEnded => {
                let hook = if matches!(op, Operation::Teleported) {
                    HookArgs::Teleported
                } else {
                    HookArgs::RunEnded
                };
                crate::hooks::fire(
                    &mut Hx {
                        stats: cx.stats,
                        k: cx.k,
                        w: cx.w,
                        ev: cx.ev,
                        fx: Some(&mut cx.s.fx),
                    },
                    hook,
                );
                Returned::Undefined
            }
            Operation::Input { id, raw } => {
                let cmd = crate::validate(raw).map_err(|_| "invalid command")?;
                self.sim.submit(id, cmd).map_err(|_| "rejected command")?;
                Returned::Undefined
            }
            Operation::Step => {
                self.sim.step_into_with(
                    &mut self.events,
                    stats::Inputs::supplied(&self.stats),
                    Some(&mut self.recipe),
                );
                Returned::Events(std::mem::take(&mut self.events))
            }
            Operation::RemovePlayer(id) => {
                self.sim.remove_player(id);
                self.events.extend(self.sim.take_events());
                Returned::Undefined
            }
        };
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn make() -> Sim {
        let players: Vec<_> = (0..3)
            .map(|i| crate::Placement {
                profile: format!("p{i}"),
                faction: crate::FactionId::Fire,
                bot: false,
                at: Vec2::new(200. + 60. * i as f64, 320.),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect();
        Sim::reset_active(
            crate::SimConfig {
                pvp_rules: false,
                ..Default::default()
            },
            crate::arenas::practice_arena(),
            crate::Secrets::from_seed(11),
            &players,
        )
    }
    fn status(kind: StatusKind) -> StatusApply {
        StatusApply {
            kind,
            source: StatusSource {
                id: Some(PlayerId(1)),
                name: "P0".into(),
                owner_id: None,
            },
            ms: 1000.,
            ability: None,
            tag: None,
            value: Some(100.),
            add: None,
            data: None,
        }
    }
    fn hit(victim: PlayerId) -> ProbeHit {
        ProbeHit {
            sig: None,
            source: status(StatusKind::Dot).source,
            victim,
            packet: Packet {
                raw: 10.,
                phys: 0.,
                magic: 0.,
                true_: 1.,
            },
            weapon: None,
            dot: false,
            ability: None,
            arena: false,
            stagger: false,
            critical: false,
            critical_mult: None,
        }
    }
    #[test]
    fn observers_do_not_change_state_checkpoint_events_or_ordinary_continuation() {
        let sim = make();
        let mut a = Harness::new(sim.clone());
        let mut b = Harness::new(sim);
        b.sim.w.trace.1.enabled = false;
        for op in [
            Operation::Apply {
                id: PlayerId(2),
                apply: status(StatusKind::Dot),
                quiet: false,
            },
            Operation::StatusDamage { dt_ms: 50. },
            Operation::ApplyLedger,
            Operation::AbilityDotFx,
            Operation::Step,
        ] {
            assert_eq!(a.execute(op.clone()).unwrap(), b.execute(op).unwrap());
            assert_eq!(a.sim.w, b.sim.w);
            assert_eq!(a.events, b.events);
        }
        assert_eq!(a.sim.state_hash(), b.sim.state_hash());
        assert_eq!(
            serde_json::to_value(&a.sim).unwrap(),
            serde_json::to_value(&b.sim).unwrap()
        );
        assert!(!a.snapshot().hooks.is_empty());
        assert!(b.snapshot().hooks.is_empty());
        let mut restored = Sim::restore(serde_json::to_value(&a.sim).unwrap()).unwrap();
        for _ in 0..5 {
            assert_eq!(a.sim.step(), restored.step());
            assert_eq!(a.sim.state_hash(), restored.state_hash());
        }
    }
    #[test]
    fn real_hurt_recipe_shares_fifo_and_next_tick_hit_queue_stays_distinct() {
        let mut h = Harness::new(make());
        let mut apply = status(StatusKind::SlowAttack);
        apply.value = Some(0.3);
        h.set_recipe(HurtRecipe {
            victim: Some(PlayerId(2)),
            operations: vec![
                Reaction::Apply {
                    id: PlayerId(3),
                    apply: apply.clone(),
                    quiet: false,
                },
                Reaction::Remove {
                    id: PlayerId(3),
                    selector: Selector::Kind(StatusKind::SlowAttack),
                },
                Reaction::Displace {
                    id: PlayerId(3),
                    to: Vec2::new(400., 400.),
                },
                Reaction::DeferHit(hit(PlayerId(3))),
            ],
        });
        h.execute(Operation::Hit(hit(PlayerId(2)))).unwrap();
        h.execute(Operation::ApplyLedger).unwrap();
        let snap = h.snapshot();
        assert!(snap.players[2].statuses.instances.is_empty());
        assert_eq!(snap.players[2].pos(), Vec2::new(400., 400.));
        assert_eq!(snap.players[2].modifiers.attack_rate_wire(), 1000.);
        assert_eq!(snap.deferred.len(), 1);
        assert_eq!(snap.payouts, 0);
        assert!(matches!(snap.hooks[0], HookRecord::Hurt { .. }));
        let hp = snap.players[2].vitals.hp;
        h.execute(Operation::Step).unwrap();
        assert_eq!(h.snapshot().players[2].vitals.hp, hp - 10.);
        assert!(h.snapshot().deferred.is_empty());
    }
    #[test]
    fn supplied_card_view_uses_player_tick_cache_without_rng_draws() {
        let mut h = Harness::new(make());
        let before = h.sim.w.spawn_rng.clone();
        h.set_stats(
            PlayerId(1),
            StatView {
                dot_mult: 1.25,
                crit_chance: 0.5,
                dot_crit: true,
                ..Default::default()
            },
        );
        h.execute(Operation::Apply {
            id: PlayerId(2),
            apply: status(StatusKind::Dot),
            quiet: true,
        })
        .unwrap();
        h.execute(Operation::Apply {
            id: PlayerId(3),
            apply: status(StatusKind::Dot),
            quiet: true,
        })
        .unwrap();
        h.execute(Operation::StatusDamage { dt_ms: 50. }).unwrap();
        assert!(h
            .snapshot()
            .ledger
            .iter()
            .all(|e| e.packet.raw == 6.25 && !e.critical));
        assert_eq!(
            h.snapshot().players[0].card_dot_crit.unwrap().accumulator,
            0.5
        );
        h.execute(Operation::ClearLedger).unwrap();
        h.execute(Operation::Clock { at: 100., tick: 2 }).unwrap();
        h.execute(Operation::StatusDamage { dt_ms: 50. }).unwrap();
        assert!(h
            .snapshot()
            .ledger
            .iter()
            .all(|e| e.packet.raw == 9.375 && e.critical));
        assert_eq!(
            h.snapshot().players[0].card_dot_crit.unwrap().accumulator,
            0.
        );
        assert_eq!(h.sim.w.spawn_rng, before);
    }
}

#[cfg(test)]
mod scheduled_view_tests {
    use super::*;
    fn make() -> Sim {
        let players: Vec<_> = (0..3)
            .map(|i| crate::Placement {
                profile: format!("p{i}"),
                faction: crate::FactionId::Fire,
                bot: false,
                at: Vec2::new(200. + 60. * i as f64, 320.),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect();
        Sim::reset_active(
            crate::SimConfig {
                pvp_rules: false,
                faction_mode: crate::FactionMode::EngagementHoly,
                ..Default::default()
            },
            crate::arenas::practice_arena(),
            crate::Secrets::from_seed(11),
            &players,
        )
    }
    fn dot() -> StatusApply {
        StatusApply {
            kind: StatusKind::Dot,
            source: StatusSource {
                id: Some(PlayerId(1)),
                name: "p0".into(),
                owner_id: None,
            },
            ms: 1000.,
            ability: None,
            tag: None,
            value: Some(100.),
            add: None,
            data: None,
        }
    }
    #[test]
    fn neutral_scheduled_views_equal_ordinary_steps_and_restored_continuation() {
        let mut h = Harness::new(make());
        h.execute(Operation::Apply {
            id: PlayerId(2),
            apply: dot(),
            quiet: true,
        })
        .unwrap();
        let mut ordinary = h.sim.clone();
        for id in [PlayerId(1), PlayerId(2), PlayerId(3)] {
            h.set_stats(id, StatView::default());
        }
        for _ in 0..4 {
            let events = ordinary.step();
            assert_eq!(
                h.execute(Operation::Step).unwrap(),
                Returned::Events(events)
            );
            assert_eq!(h.sim.state_hash(), ordinary.state_hash());
        }
        let mut restored = Sim::restore(serde_json::to_value(&h.sim).unwrap()).unwrap();
        for _ in 0..4 {
            assert_eq!(ordinary.step(), restored.step());
            assert_eq!(ordinary.state_hash(), restored.state_hash());
        }
    }
    #[test]
    fn scheduled_dot_lifesteal_uses_real_after_damage_heal_and_antiheal() {
        let mut h = Harness::new(make());
        h.set_stats(
            PlayerId(1),
            StatView {
                lifesteal_rows: 0.2,
                lifesteal_mult: 2.,
                lifesteal_dot: 0.1,
                ..Default::default()
            },
        );
        h.execute(Operation::Actor {
            id: PlayerId(1),
            patch: ActorPatch {
                hp: Some(20.),
                ..Default::default()
            },
        })
        .unwrap();
        let mut anti = dot();
        anti.kind = StatusKind::AntiHeal;
        anti.value = Some(0.5);
        h.execute(Operation::Apply {
            id: PlayerId(1),
            apply: anti,
            quiet: true,
        })
        .unwrap();
        h.execute(Operation::Apply {
            id: PlayerId(2),
            apply: dot(),
            quiet: true,
        })
        .unwrap();
        h.execute(Operation::Step).unwrap();
        assert_eq!(h.sim.w.players[0].vitals.hp, 21.25);
        assert!(h.sim.w.trace.1.records.iter().any(|r|matches!(r,HookRecord::Healed{actor,amount,source:HealSource::Lifesteal} if actor.id==PlayerId(1)&&*amount==1.25)));
    }
    #[test]
    fn scheduled_hurt_queued_refold_reads_current_borrow_and_preserves_shred_timing() {
        let mut h = Harness::new(make());
        h.set_stats(
            PlayerId(3),
            StatView {
                slow_resist: 0.5,
                ..Default::default()
            },
        );
        let mut slow = dot();
        slow.kind = StatusKind::SlowAttack;
        slow.value = Some(0.4);
        h.set_recipe(HurtRecipe {
            victim: Some(PlayerId(2)),
            operations: vec![Reaction::Apply {
                id: PlayerId(3),
                apply: slow,
                quiet: true,
            }],
        });
        h.execute(Operation::Apply {
            id: PlayerId(2),
            apply: dot(),
            quiet: true,
        })
        .unwrap();
        h.execute(Operation::Step).unwrap();
        assert_eq!(h.sim.w.players[2].modifiers.attack_rate_wire(), 800.);
        let mut shred = dot();
        shred.kind = StatusKind::Shred;
        shred.value = Some(3.);
        h.execute(Operation::Apply {
            id: PlayerId(3),
            apply: shred,
            quiet: true,
        })
        .unwrap();
        assert_eq!(h.sim.w.players[2].modifiers.mirrors().armor_bonus, 0.);
        h.execute(Operation::Remove {
            id: PlayerId(3),
            selector: Selector::Kind(StatusKind::SlowAttack),
        })
        .unwrap();
        assert_eq!(h.sim.w.players[2].modifiers.attack_rate_wire(), 1000.);
        assert_eq!(h.sim.w.players[2].modifiers.mirrors().armor_bonus, -3.);
    }
    #[test]
    fn source_visible_removal_events_precede_step_without_duplication() {
        let mut h = Harness::new(make());
        h.execute(Operation::RemovePlayer(PlayerId(1))).unwrap();
        let pending = h.snapshot().events;
        assert!(!pending.is_empty());
        assert!(h.sim.w.pending_events.is_empty());
        let Returned::Events(step) = h.execute(Operation::Step).unwrap() else {
            panic!("step result")
        };
        assert_eq!(&step[..pending.len()], &pending);
        assert!(h.snapshot().events.is_empty());
    }
}

/// The one admitted synthetic source closure: root, then a nested immediate silence payout.
/// Fixed shape and depth; there is no recursive sequence input or persisted recipe configuration.
pub(crate) fn pay_nested(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    id: PlayerId,
    source: StatusSource,
    stats: stats::Inputs,
) {
    let first = StatusApply {
        kind: StatusKind::Root,
        source: source.clone(),
        ms: 1000.,
        ability: None,
        tag: Some("outer".into()),
        value: None,
        add: None,
        data: None,
    };
    systems::status::operations::apply_with(k, w, ev, id, first, false, stats);
    let second = StatusApply {
        kind: StatusKind::Silence,
        source,
        ms: 1000.,
        ability: None,
        tag: Some("nested".into()),
        value: None,
        add: None,
        data: None,
    };
    ledger::pay_later_with(
        k,
        w,
        ev,
        ledger::PayLater::ApplyStatus {
            victim: id,
            apply: second,
            quiet: false,
        },
        stats,
    );
}

pub(crate) fn record_cast_accepted(w: &mut World, id: PlayerId, ability: AbilityId) {
    if w.trace.1.enabled {
        if let Some(p) = w.player(id) {
            let record = HookRecord::CastAccepted {
                actor: Box::new(p.clone()),
                ability,
            };
            w.trace.1.records.push(record);
        }
    }
}
pub(crate) fn record_cast_landed(w: &mut World, id: PlayerId, ability: AbilityId) {
    if w.trace.1.enabled {
        if let Some(p) = w.player(id) {
            let record = HookRecord::CastLanded {
                actor: Box::new(p.clone()),
                ability,
            };
            w.trace.1.records.push(record);
        }
    }
}
