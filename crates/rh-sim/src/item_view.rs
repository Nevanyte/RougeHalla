//! Seat-local item offers. The simulation never knows which ticks an observer sampled.
//! A batch changes only on publicly distinguishable cues or a scheduled renewal.
use crate::constants::{INTERACT_RANGE, MASK_MOVE, MASK_SIGHT, VISION_RADIUS};
use crate::geometry::ray_blocked;
use crate::{
    Command, ContainerKind, Event, Observation, PickupRefusal, PlayerId, PublicCommand, Reject,
    SightCache, Sim, TileMap, Vec2, WeaponId,
};
use std::{num::NonZeroU32, sync::Arc};

pub const MAX_VISIBLE_PROPS: usize = 512;
const GRACE: u32 = 20;

/// Zero is malformed on every public intake.
#[derive(
    Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, serde::Serialize, serde::Deserialize,
)]
#[serde(transparent)]
pub struct PickupHandle(NonZeroU32);
impl PickupHandle {
    pub fn new(value: u32) -> Option<Self> {
        NonZeroU32::new(value).map(Self)
    }
    pub fn get(self) -> u32 {
        self.0.get()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Inventory {
    pub active_slot: u8,
    pub slots: [Option<WeaponId>; 2],
}

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, serde::Serialize, serde::Deserialize)]
pub enum PropKind {
    Ground(WeaponId),
    Chest { open: bool },
    Body { label: Arc<str> },
}

/// Position is already encoded on the public 1/8-unit grid. Field order is the canonical sort key.
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, serde::Serialize, serde::Deserialize)]
pub struct PropCue {
    pub x: u16,
    pub y: u16,
    pub kind: PropKind,
    pub focused: bool,
    pub body_hint: Option<WeaponId>,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct VisibleProp {
    pub handle: PickupHandle,
    pub cue: PropCue,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OfferError {
    TooManyProps,
    PositionOutOfRange,
    InvalidBodyLabel,
    InvalidGround,
    HandlesExhausted,
    EarlierTick,
    UnknownExternalSeat,
}

pub(crate) fn point_visible(map: &TileMap, from: Vec2, at: Vec2) -> bool {
    let (dx, dy) = (at.x - from.x, at.y - from.y);
    dx * dx + dy * dy <= VISION_RADIUS * VISION_RADIUS
        && !ray_blocked(map, from.x, from.y, at.x, at.y, MASK_SIGHT)
}

/// The same authoritative hand reach decides whether F offers the item and whether the action lands.
pub(crate) fn pickup_reach(map: &TileMap, from: Vec2, at: Vec2) -> Result<(), PickupRefusal> {
    if crate::math::hypot(from.x - at.x, from.y - at.y) > INTERACT_RANGE {
        return Err(PickupRefusal::TooFar);
    }
    if ray_blocked(map, from.x, from.y, at.x, at.y, MASK_MOVE) {
        return Err(PickupRefusal::Unreachable);
    }
    Ok(())
}

fn position(v: f64) -> Result<u16, OfferError> {
    // Same checked f32 domain and half-away rounding as rh_protocol::quant.
    let v = v as f32;
    if !(0.0..=65535.0 / 8.0).contains(&v) {
        return Err(OfferError::PositionOutOfRange);
    }
    Ok((f64::from(v) * 8.0 + 0.5) as u16)
}

#[derive(Default)]
struct Bindings {
    first: u32,
    ids: Vec<u32>,
}
impl Bindings {
    fn lookup(&self, h: PickupHandle) -> Option<u32> {
        let i = h.get().checked_sub(self.first)?;
        self.ids.get(i as usize).copied()
    }
}

#[derive(Default)]
struct Retired {
    tick: u32,
    bindings: Bindings,
}

struct Candidate {
    cue: PropCue,
    id: u32,
}

/// Private adapter state for exactly one viewer and one match. Keep one per connection or external/policy seat.
pub struct ItemObserver {
    viewer: PlayerId,
    next: u64, // one past u32::MAX means permanently exhausted
    sampled: Option<u32>,
    issued: u32,
    current: Bindings,
    rows: Vec<VisibleProp>,
    retired: Vec<Retired>,
    scratch: Vec<Candidate>,
}

impl ItemObserver {
    pub fn new(viewer: PlayerId) -> Self {
        Self {
            viewer,
            next: 1,
            sampled: None,
            issued: 0,
            current: Bindings::default(),
            rows: Vec::new(),
            retired: Vec::new(),
            scratch: Vec::new(),
        }
    }

    pub fn viewer(&self) -> PlayerId {
        self.viewer
    }

    /// Reconnect in this match: invalidate every prior binding but never reuse a handle.
    pub fn reconnect(&mut self) {
        let next = self.next;
        *self = Self::new(self.viewer);
        self.next = next;
    }

    fn candidates(&mut self, sim: &Sim) -> Result<(), OfferError> {
        self.scratch.clear();
        let Some(me) = sim.player(self.viewer) else {
            return Ok(());
        };
        let from = me.pos();
        let map = &sim.arena().map;
        let mut best: Option<(usize, f64, Option<WeaponId>)> = None;
        for c in sim.containers() {
            if !point_visible(map, from, c.at) {
                continue;
            }
            if self.scratch.len() == MAX_VISIBLE_PROPS {
                return Err(OfferError::TooManyProps);
            }
            let first = c.items[0].map(|item| item.weapon);
            let kind = match c.kind {
                ContainerKind::Ground => PropKind::Ground(first.ok_or(OfferError::InvalidGround)?),
                ContainerKind::Chest => PropKind::Chest {
                    open: c.opened || first.is_none(),
                },
                ContainerKind::Body(id) => {
                    let label = sim
                        .w
                        .roster
                        .label(id)
                        .filter(|s| s.len() <= u8::MAX as usize)
                        .ok_or(OfferError::InvalidBodyLabel)?;
                    PropKind::Body {
                        label: label.clone(),
                    }
                }
            };
            let cue = PropCue {
                x: position(c.at.x)?,
                y: position(c.at.y)?,
                kind,
                focused: false,
                body_hint: None,
            };
            // Birth is a private execution guard. The legacy F prompt uses present contents and reach.
            if me.standing() && first.is_some() && pickup_reach(map, from, c.at).is_ok() {
                let dx = from.x - f64::from(cue.x) / 8.0;
                let dy = from.y - f64::from(cue.y) / 8.0;
                let distance = dx * dx + dy * dy;
                let hint = match cue.kind {
                    PropKind::Body { .. } => first,
                    _ => None,
                };
                // Equal base faces may still show different F prompts. Compare only the prospective
                // focused hint; private item identity and every concealed second weapon stay out.
                if best.is_none_or(|(prev, d, previous_hint)| {
                    distance < d
                        || (distance == d
                            && (&cue, hint) < (&self.scratch[prev].cue, previous_hint))
                }) {
                    best = Some((self.scratch.len(), distance, hint));
                }
            }
            self.scratch.push(Candidate { cue, id: c.id });
        }
        if let Some((i, _, hint)) = best {
            self.scratch[i].cue.focused = true;
            self.scratch[i].cue.body_hint = hint;
        }
        // Only identical published rows can tie; their physical order has no public meaning.
        self.scratch.sort_unstable_by(|a, b| a.cue.cmp(&b.cue));
        Ok(())
    }

    /// Prepare a complete observation without changing the issued handles. Drop the guard if delivery
    /// fails; commit it after successful delivery. The staged observation belongs to this seat only.
    pub fn prepare_into<'a>(
        &'a mut self,
        sim: &Sim,
        events: &[Event],
        out: &mut Observation,
        cache: Option<&mut SightCache>,
    ) -> Result<PreparedOffer<'a>, OfferError> {
        let tick = sim.tick();
        if self.sampled.is_some_and(|t| t > tick) {
            return Err(OfferError::EarlierTick);
        }
        let mut changed = false;
        let absent = sim.player(self.viewer).is_none();
        if absent {
            self.scratch.clear();
            changed = !self.rows.is_empty();
        } else if self.sampled != Some(tick) {
            self.candidates(sim)?;
            changed = !self
                .scratch
                .iter()
                .map(|c| &c.cue)
                .eq(self.rows.iter().map(|r| &r.cue))
                || (!self.scratch.is_empty() && tick - self.issued >= GRACE);
        }
        if changed && self.next + self.scratch.len() as u64 > u32::MAX as u64 + 1 {
            return Err(OfferError::HandlesExhausted);
        }
        crate::observe::observe_with(sim, self.viewer, events, out, cache);
        out.inventory = sim.player(self.viewer).map(|me| Inventory {
            active_slot: me.weapon.slot,
            slots: [me.weapon.weapon0, me.weapon.weapon1],
        });
        if changed {
            out.props.clear();
            out.props
                .extend(self.scratch.iter().enumerate().map(|(i, c)| VisibleProp {
                    handle:
                        PickupHandle::new((self.next + i as u64) as u32).expect("checked block"),
                    cue: c.cue.clone(),
                }));
        } else {
            out.props.clone_from(&self.rows);
        }
        Ok(PreparedOffer {
            observer: self,
            tick,
            changed,
            absent,
        })
    }

    /// Complete observation accepted synchronously by a policy or caller.
    pub fn observe_into(
        &mut self,
        sim: &Sim,
        events: &[Event],
        out: &mut Observation,
        cache: Option<&mut SightCache>,
    ) -> Result<(), OfferError> {
        self.prepare_into(sim, events, out, cache)?.commit();
        Ok(())
    }

    /// Return exactly the command to submit and record, including a normal budgeted miss for an absent,
    /// expired or now-invisible target. A handle cannot resolve outside this viewer's bindings.
    pub fn resolve(&self, sim: &Sim, proposal: PublicCommand) -> Result<Command, Reject> {
        proposal.resolve(|handle| {
            let id = self.current.lookup(handle).or_else(|| {
                self.retired
                    .iter()
                    .filter(|b| {
                        sim.tick()
                            .checked_sub(b.tick)
                            .is_some_and(|age| age < GRACE)
                    })
                    .find_map(|b| b.bindings.lookup(handle))
            })?;
            let me = sim.player(self.viewer)?;
            let i = sim.containers().binary_search_by_key(&id, |c| c.id).ok()?;
            point_visible(&sim.arena().map, me.pos(), sim.containers()[i].at).then_some(id)
        })
    }
}

#[must_use = "commit after delivering the observation, or drop to discard it"]
pub struct PreparedOffer<'a> {
    observer: &'a mut ItemObserver,
    tick: u32,
    changed: bool,
    absent: bool,
}
impl PreparedOffer<'_> {
    /// Whether the public prop rows (including renewed handles) need a reliable update.
    pub fn props_changed(&self) -> bool {
        self.changed
    }

    pub fn commit(self) {
        let s = self.observer;
        if self.absent {
            // A permanently removed viewer may be sampled again in the departure tick. No handle is
            // issued for this clear, and no prior target may survive the departure.
            s.sampled = Some(self.tick);
            s.rows.clear();
            s.current.ids.clear();
            s.retired.clear();
            return;
        }
        if s.sampled != Some(self.tick) {
            for old in &mut s.retired {
                if self.tick - old.tick >= GRACE {
                    old.bindings.ids.clear();
                }
            }
        }
        s.sampled = Some(self.tick);
        if !self.changed {
            return;
        }
        if !s.current.ids.is_empty() {
            // At most one retirement per observed tick; recycle expired storage for the next batch.
            let retired = &mut s.retired;
            let slot = retired
                .iter()
                .position(|r| r.bindings.ids.is_empty())
                .unwrap_or_else(|| {
                    retired.push(Retired::default());
                    retired.len() - 1
                });
            let old = &mut retired[slot];
            old.tick = self.tick;
            std::mem::swap(&mut old.bindings, &mut s.current);
        }
        s.current.ids.clear();
        s.current.first = s.next as u32;
        s.rows.clear();
        for c in &s.scratch {
            s.current.ids.push(c.id);
            s.rows.push(VisibleProp {
                handle: PickupHandle::new(s.next as u32).expect("checked block"),
                cue: c.cue.clone(),
            });
            s.next += 1;
        }
        s.issued = self.tick;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        arenas::practice_arena, FactionId, PickupRefusal, Placement, Secrets, SeenEvent, SimConfig,
    };
    use WeaponId::{Axe, Bow, Shield, Sword, Wand};

    fn world(x: f64, y: f64) -> Sim {
        let place = |name: &str, at, faction| Placement {
            profile: name.into(),
            at,
            faction,
            bot: false,
            hp: None,
            weapon0: None,
            weapon1: None,
        };
        Sim::reset_active(
            SimConfig::default(),
            practice_arena(),
            Secrets::from_seed(4),
            &[
                place("viewer", Vec2::new(x, y), FactionId::Holy),
                place("Ása", Vec2::new(1400.0, 272.0), FactionId::Fire),
            ],
        )
    }
    fn sample(s: &Sim, observer: &mut ItemObserver) -> Observation {
        let mut obs = Observation::default();
        observer.observe_into(s, &[], &mut obs, None).unwrap();
        obs
    }
    fn pick(s: &mut Sim, observer: &ItemObserver, handle: PickupHandle) -> Vec<Event> {
        let command = observer
            .resolve(s, PublicCommand::Pickup { handle })
            .unwrap();
        s.submit(observer.viewer(), command).unwrap();
        s.step()
    }
    fn rack(s: &mut Sim, kind: ContainerKind, x: f64, y: f64, items: &[WeaponId]) -> u32 {
        s.seed_weapon_container(kind, Vec2::new(x, y), items)
            .unwrap()
    }
    fn focus(obs: &Observation) -> &VisibleProp {
        let mut rows = obs.props.iter().filter(|r| r.cue.focused);
        let first = rows.next().expect("a focus");
        assert!(rows.next().is_none());
        first
    }

    #[test]
    fn hidden_insertion_contents_order_and_lookalike_replacement_do_not_change_offers() {
        let (mut a, mut b) = (world(100.0, 272.0), world(100.0, 272.0));
        for _ in 0..4 {
            rack(&mut b, ContainerKind::Ground, 1300.0, 272.0, &[Sword]);
        }
        let orig_a = rack(&mut a, ContainerKind::Chest, 100.02, 272.0, &[Axe]);
        let orig_b = rack(&mut b, ContainerKind::Chest, 100.04, 272.0, &[Wand, Shield]);
        // Different order for publicly distinct rows mixed with identical unfocused bodies.
        for (s, weapons) in [(&mut a, [Axe, Bow]), (&mut b, [Shield, Wand])] {
            for (i, w) in weapons.into_iter().enumerate() {
                rack(
                    s,
                    ContainerKind::Body(PlayerId(2)),
                    180.0,
                    272.0,
                    &[w, Sword],
                );
                if i == 0 && w == Shield {
                    rack(s, ContainerKind::Ground, 1320.0, 272.0, &[Bow]);
                }
            }
        }
        // Privileged model: reserve an identical replacement in B while it is outside vision.
        let repl = rack(&mut b, ContainerKind::Chest, 1360.0, 272.0, &[Bow]);
        let (mut oa, mut ob) = (
            ItemObserver::new(PlayerId(1)),
            ItemObserver::new(PlayerId(1)),
        );
        let start = a.tick();
        for age in 0..=20 {
            if age == 1 {
                b.w.containers
                    .retain(|c| c.id != orig_b && c.at.x != 1320.0);
                b.w.containers.iter_mut().find(|c| c.id == repl).unwrap().at =
                    Vec2::new(100.03, 272.0);
            }
            let va = sample(&a, &mut oa);
            let vb = sample(&b, &mut ob);
            assert_eq!(
                serde_json::to_vec(&va).unwrap(),
                serde_json::to_vec(&vb).unwrap(),
                "age {age}"
            );
            assert_eq!(va, sample(&a, &mut oa));
            assert_eq!(va.props.len(), 3);
            assert_eq!(focus(&va).handle.get(), if age < 20 { 1 } else { 4 });
            assert_eq!(a.tick(), start + age);
            if age < 20 {
                a.step();
                b.step();
            }
        }
        let h = PickupHandle::new(1).unwrap();
        assert_eq!(orig_a, 1);
        assert_ne!(orig_b, 1);
        pick(&mut a, &oa, h);
        let ev = pick(&mut b, &ob, h);
        assert_eq!(
            sample(&a, &mut oa).inventory.unwrap().slots,
            [Some(Axe), None]
        );
        assert_eq!(sample(&b, &mut ob).inventory.unwrap().slots, [None, None]);
        assert_eq!(
            crate::observe(&b, PlayerId(1), &ev).events,
            [SeenEvent::PickupRefused {
                reason: PickupRefusal::NothingThere
            }]
        );
        assert!(crate::observe(&b, PlayerId(2), &ev).events.is_empty());
    }

    #[test]
    fn silhouettes_open_flags_labels_inventory_and_the_single_reachable_hint() {
        let mut s = world(100.0, 272.0);
        s.w.players[0].weapon.weapon1 = Some(Wand);
        rack(
            &mut s,
            ContainerKind::Body(PlayerId(2)),
            110.0,
            272.0,
            &[Axe, Shield],
        );
        rack(
            &mut s,
            ContainerKind::Body(PlayerId(1)),
            120.0,
            272.0,
            &[Bow],
        );
        rack(&mut s, ContainerKind::Chest, 150.0, 272.0, &[]);
        rack(&mut s, ContainerKind::Ground, 160.0, 272.0, &[Sword]);
        rack(&mut s, ContainerKind::Ground, 1000.0, 272.0, &[Axe]); // exact sight edge
        rack(&mut s, ContainerKind::Ground, 1000.001, 272.0, &[Shield]);
        let mut seat = ItemObserver::new(PlayerId(1));
        let view = sample(&s, &mut seat);
        assert_eq!(view.me.unwrap().weapon, WeaponId::Fists);
        assert_eq!(
            view.inventory,
            Some(Inventory {
                active_slot: 0,
                slots: [None, Some(Wand)]
            })
        );
        assert_eq!(view.props.len(), 5);
        assert_eq!(
            view.props[0].cue.kind,
            PropKind::Body {
                label: "Ása".into()
            }
        );
        assert_eq!(view.props[0].cue.body_hint, Some(Axe));
        assert!(view.props[1..]
            .iter()
            .all(|r| !r.cue.focused && r.cue.body_hint.is_none()));
        assert_eq!(view.props[2].cue.kind, PropKind::Chest { open: true });
        assert_eq!(view.props[3].cue.kind, PropKind::Ground(Sword));
        s.w.players[1].weapon.weapon1 = Some(Bow);
        s.w.players[0].weapon.weapon1 = None;
        let absent = sample(&s, &mut ItemObserver::new(PlayerId(99)));
        assert!(absent.inventory.is_none() && absent.props.is_empty());
        let next = sample(&s, &mut seat);
        assert_eq!(next.inventory.unwrap().slots, [None, None]);
        assert_eq!(next.props, view.props);
    }

    #[test]
    fn tied_body_prompts_ignore_private_creation_order_and_concealed_second_weapons() {
        let mut a = world(100., 272.);
        let mut b = a.clone();
        for (s, gear) in [
            (&mut a, [[Axe, Sword], [Bow, Shield]]),
            (&mut b, [[Bow, Wand], [Axe, Bow]]),
        ] {
            for items in gear {
                rack(s, ContainerKind::Body(PlayerId(2)), 110., 272., &items);
            }
        }
        let va = sample(&a, &mut ItemObserver::new(PlayerId(1)));
        let vb = sample(&b, &mut ItemObserver::new(PlayerId(1)));
        assert_eq!(va.props, vb.props);
        assert_eq!(focus(&va).cue.body_hint, Some(Bow));
        assert_eq!(
            va.props
                .iter()
                .filter(|r| r.cue.body_hint.is_some())
                .count(),
            1
        );
    }

    #[test]
    fn departure_between_same_tick_samples_clears_all_self_and_item_state() {
        let mut s = world(100., 272.);
        rack(&mut s, ContainerKind::Ground, 100., 272., &[Axe]);
        let mut seat = ItemObserver::new(PlayerId(1));
        let h = focus(&sample(&s, &mut seat)).handle;
        s.remove_player(PlayerId(1));
        let after = sample(&s, &mut seat);
        assert!(after.inventory.is_none() && after.me.is_none() && after.props.is_empty());
        assert_eq!(seat.next, 2);
        assert_eq!(
            seat.resolve(&s, PublicCommand::Pickup { handle: h })
                .unwrap(),
            crate::validate(crate::RawCommand::MissingPickup).unwrap()
        );
    }

    #[test]
    fn fence_wall_birth_and_lost_sight_are_rechecked_on_execution() {
        for (x, y, target, visible, reason) in [
            (756., 400., 812., true, PickupRefusal::Unreachable),
            (181., 176., 228., false, PickupRefusal::NothingThere),
        ] {
            let mut s = world(x, y);
            rack(&mut s, ContainerKind::Ground, target, y, &[Axe]);
            let mut seat = ItemObserver::new(PlayerId(1));
            let view = sample(&s, &mut seat);
            assert_eq!(view.props.len(), usize::from(visible));
            assert!(view.props.iter().all(|r| !r.cue.focused));
            let ev = pick(&mut s, &seat, PickupHandle::new(1).unwrap());
            assert_eq!(
                crate::observe(&s, PlayerId(1), &ev).events,
                [SeenEvent::PickupRefused { reason }]
            );
        }
        let mut s = world(100., 272.);
        rack(&mut s, ContainerKind::Ground, 100., 272., &[Axe]);
        let mut seat = ItemObserver::new(PlayerId(1));
        let h = focus(&sample(&s, &mut seat)).handle;
        s.w.containers[0].born_tick = s.tick() + 1;
        let ev = pick(&mut s, &seat, h);
        assert_eq!(
            crate::observe(&s, PlayerId(1), &ev).events,
            [SeenEvent::PickupRefused {
                reason: PickupRefusal::NothingThere
            }]
        );
        let exact = seat
            .resolve(&s, PublicCommand::Pickup { handle: h })
            .unwrap();
        s.submit(PlayerId(1), exact).unwrap();
        s.w.containers[0].at = Vec2::new(1300., 272.);
        let ev = s.step();
        assert_eq!(
            crate::observe(&s, PlayerId(1), &ev).events,
            [SeenEvent::PickupRefused {
                reason: PickupRefusal::NothingThere
            }]
        );
        assert_eq!(sample(&s, &mut seat).inventory.unwrap().slots, [None, None]);
        assert!(sample(&s, &mut seat).props.is_empty());
        let counter = seat.next;
        for _ in 0..22 {
            s.step();
            assert!(sample(&s, &mut seat).props.is_empty());
        }
        assert_eq!(seat.next, counter);
    }

    #[test]
    fn failed_delivery_exhaustion_and_retired_batches_never_rebind() {
        let mut s = world(100., 272.);
        rack(&mut s, ContainerKind::Chest, 100., 272., &[Sword]);
        let mut seat = ItemObserver::new(PlayerId(1));
        let mut out = Observation::default();
        let staged = seat.prepare_into(&s, &[], &mut out, None).unwrap();
        drop(staged);
        let h = out.props[0].handle;
        assert_eq!(
            seat.resolve(&s, PublicCommand::Pickup { handle: h })
                .unwrap(),
            crate::validate(crate::RawCommand::MissingPickup).unwrap()
        );
        assert_eq!(focus(&sample(&s, &mut seat)).handle, h);
        let exact = seat
            .resolve(&s, PublicCommand::Pickup { handle: h })
            .unwrap();
        for age in 1..=24 {
            s.step();
            s.w.containers[0].at.x += 0.25;
            sample(&s, &mut seat);
            assert_eq!(
                seat.resolve(&s, PublicCommand::Pickup { handle: h })
                    .unwrap()
                    == exact,
                age <= 20
            );
            assert!(seat.retired.len() <= GRACE as usize);
        }
        let last = focus(&sample(&s, &mut seat)).handle;
        seat.reconnect();
        assert_ne!(focus(&sample(&s, &mut seat)).handle, last);
        assert_eq!(
            seat.resolve(&s, PublicCommand::Pickup { handle: last })
                .unwrap(),
            crate::validate(crate::RawCommand::MissingPickup).unwrap()
        );
        seat.reconnect();
        seat.next = u32::MAX as u64;
        assert_eq!(focus(&sample(&s, &mut seat)).handle.get(), u32::MAX);
        s.step();
        s.w.containers[0].at.x += 0.25;
        assert_eq!(
            seat.observe_into(&s, &[], &mut out, None),
            Err(OfferError::HandlesExhausted)
        );
        assert_eq!(seat.next, u32::MAX as u64 + 1);
        assert!(serde_json::from_str::<PublicCommand>(r#"{"Pickup":{"handle":0}}"#).is_err());
    }

    #[test]
    fn same_number_can_only_bind_to_the_submitting_seats_own_target() {
        let mut s = world(100., 272.);
        rack(&mut s, ContainerKind::Ground, 100., 272., &[Axe]);
        rack(&mut s, ContainerKind::Ground, 1400., 272., &[Bow]);
        let (mut a, mut b) = (
            ItemObserver::new(PlayerId(1)),
            ItemObserver::new(PlayerId(2)),
        );
        let first = focus(&sample(&s, &mut a)).handle;
        let second = focus(&sample(&s, &mut b)).handle;
        assert_eq!(first, second);
        pick(&mut s, &b, first);
        assert_eq!(
            sample(&s, &mut b).inventory.unwrap().slots,
            [Some(Bow), None]
        );
        assert_eq!(sample(&s, &mut a).inventory.unwrap().slots, [None, None]);
    }
}
