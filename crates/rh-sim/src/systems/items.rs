//! The two weapon slots, swaps and run-only loot (legacy weapons.ts and loot.ts).
use super::{weapons, Cx};
use crate::constants::SWAP_SECONDS;
use crate::events::{Event, PickupRefusal};
use crate::fighter::{FighterCore, FighterIx};
use crate::hooks::{HookArgs, Hx};
use crate::input::ActionCmd;
use crate::item_view::{pickup_reach, point_visible};
use crate::math::Vec2;
use crate::state::{Container, ContainerKind, WeaponItem, WeaponRt, World};
use crate::{Sim, WeaponId};

// P-STATUS-1 extends expiry to the other statuses. The armor mirror used by the
// current ledger still holds the previous tick's fold.
pub(crate) fn expire_shred(cx: &mut Cx) {
    let now = cx.w.server_time;
    for p in &mut cx.w.players {
        p.weapon.shreds.retain(|s| s.until > now);
    }
}

/// The axe component of legacy cardHooks.cardSource. Future card sources join the same fold.
pub(crate) fn shred_source(_: &World, p: &FighterCore) -> Option<crate::schedule::ModContribution> {
    let shred = p.weapon.shreds.iter().map(|s| s.value).sum::<f64>();
    (shred > 0.0).then(|| crate::schedule::ModContribution {
        armor: Some(-shred.min(crate::constants::AXE_SHRED_CAP)),
        ..Default::default()
    })
}

pub(crate) fn fold_armor(cx: &mut Cx) {
    let sources = crate::schedule::Plan::of(cx.k).mod_sources.live();
    for i in 0..cx.w.players.len() {
        let armor = sources
            .iter()
            .filter_map(|(_, source)| source(cx.w, &cx.w.players[i]))
            .filter_map(|m| m.armor)
            .fold(0.0, |total, part| total + part);
        cx.w.players[i].weapon.armor_shred = (-armor).max(0.0);
    }
}

impl WeaponRt {
    fn slot_item(&self, slot: u8) -> Option<WeaponId> {
        if slot == 0 {
            self.weapon0
        } else {
            self.weapon1
        }
    }

    fn pickup_slot(&self, second_locked: bool) -> u8 {
        if self.slot_item(self.slot).is_none() {
            self.slot
        } else if self.weapon0.is_none() {
            0
        } else if self.weapon1.is_none() && !second_locked {
            1
        } else {
            self.slot
        }
    }

    fn can_swap(&self, target: u8, second_locked: bool) -> bool {
        target <= 1
            && target != self.slot
            && !(target == 1 && second_locked)
            && (self.weapon0.is_some() || self.weapon1.is_some())
    }
}

/// Axe shred is the first effect of the legacy hitLanded hook. Returned hits
/// do not proc it; the status is paid after every victim in the pass.
pub(crate) fn hit_landed(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::HitLanded { entry, .. } = *args else {
        return;
    };
    if !hx.k.config.weapon_specials || entry.passive || entry.weapon != Some(WeaponId::Axe) {
        return;
    }
    let Some(source) = entry.by.filter(|id| hx.w.idx(*id).is_some()) else {
        return;
    };
    if hx.w.player(entry.victim).is_some_and(|p| p.standing()) {
        hx.pay_later(crate::systems::ledger::PayLater::AxeShred {
            victim: entry.victim,
            source,
        });
    }
}

fn weapon_changed(p: &mut FighterCore, now: f64) {
    weapons::cancel_action(p, now);
    p.weapon.ready_at = p.weapon.ready_at.max(now) + SWAP_SECONDS * 1000.0;
    // P-COMBAT-3: changing to a weapon other than wand drops an existing targeting lock.
}

pub(crate) fn swap(cx: &mut Cx, ix: FighterIx, cmd: &ActionCmd) {
    let ActionCmd::Swap { slot } = *cmd else {
        return;
    };
    let now = cx.w.server_time;
    let p = cx.w.core_mut(ix);
    let target = slot.unwrap_or(1 - p.weapon.slot);
    // P-STATUS-1 supplies actionBlocked (stun/ability cast), P-CARDS-1 supplies lockSecondSlot.
    if p.weapon.can_swap(target, false) {
        p.weapon.slot = target;
        weapon_changed(p, now);
    }
}

/// Pre-existing rack items are visible as the active run starts. During-step drops wait
/// through that tick. Between-step drops and held chests wait through publication.
fn blocked_through(tick: u32, wait_for_publication: bool) -> u32 {
    if tick == 0 || !wait_for_publication {
        tick
    } else {
        tick.saturating_add(1)
    }
}

fn add_container(
    w: &mut World,
    kind: ContainerKind,
    at: Vec2,
    weapons: [Option<WeaponId>; 2],
    tick: u32,
    between_ticks: bool,
) -> u32 {
    w.container_counter += 1;
    let id = w.container_counter;
    let items = weapons.map(|weapon| {
        weapon.map(|weapon| {
            w.item_counter += 1;
            WeaponItem {
                uid: w.item_counter,
                weapon,
            }
        })
    });
    w.containers.push(Container {
        id,
        kind,
        at,
        opened: false,
        items,
        born_tick: blocked_through(tick, between_ticks || kind == ContainerKind::Chest),
    });
    id
}

impl Sim {
    /// A weapon rack placed at scenario creation, before the first active input. Like legacy tick-zero
    /// containers, the first published rack can be picked from on the first active tick.
    pub fn seed_weapon_container(
        &mut self,
        kind: ContainerKind,
        at: Vec2,
        weapons: &[WeaponId],
    ) -> Result<u32, &'static str> {
        if self.w.tick > 1
            || weapons.len() > 2
            || weapons.contains(&WeaponId::Fists)
            || !at.x.is_finite()
            || !at.y.is_finite()
            || at.x < 0.0
            || at.y < 0.0
            || at.x >= self.k.arena.map.w as f64 * crate::constants::TILE
            || at.y >= self.k.arena.map.h as f64 * crate::constants::TILE
            || matches!(kind, ContainerKind::Body(id) if self.w.roster.name(id).is_none())
            || (kind == ContainerKind::Ground && weapons.len() != 1)
        {
            return Err("invalid scenario weapon container");
        }
        let items = [weapons.first().copied(), weapons.get(1).copied()];
        Ok(add_container(&mut self.w, kind, at, items, 0, false))
    }

    /// Authoritative state for a capture or replay. Observations filter the containers separately.
    pub fn containers(&self) -> &[Container] {
        &self.w.containers
    }
}

pub(crate) fn drop_body(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::DropBody {
        victim,
        between_ticks,
    } = *args
    else {
        return;
    };
    let Some(i) = hx.w.idx(victim) else { return };
    let p = &mut hx.w.players[i];
    let at = p.pos();
    let mut gear = [p.weapon.weapon0.take(), p.weapon.weapon1.take()];
    if gear[0].is_none() {
        gear.swap(0, 1);
    }
    let tick = hx.w.tick;
    add_container(
        hx.w,
        ContainerKind::Body(victim),
        at,
        gear,
        tick,
        between_ticks,
    );
}

fn pickup_check(
    cx: &Cx,
    ix: FighterIx,
    id: Option<u32>,
    blocked: bool,
) -> Result<usize, PickupRefusal> {
    if blocked {
        return Err(PickupRefusal::Blocked);
    }
    let id = id.ok_or(PickupRefusal::NothingThere)?;
    let i =
        cx.w.containers
            .binary_search_by_key(&id, |c| c.id)
            .map_err(|_| PickupRefusal::NothingThere)?;
    let c = &cx.w.containers[i];
    if c.born_tick != 0 && c.born_tick >= cx.w.tick {
        return Err(PickupRefusal::NothingThere);
    }
    let p = cx.w.core(ix).pos();
    pickup_reach(&cx.k.arena.map, p, c.at)?;
    if !point_visible(&cx.k.arena.map, p, c.at) {
        return Err(PickupRefusal::NothingThere);
    }
    Ok(i)
}

pub(crate) fn pickup(cx: &mut Cx, ix: FighterIx, cmd: &ActionCmd) {
    let id = match *cmd {
        ActionCmd::Pickup { container_id } => Some(container_id),
        ActionCmd::MissingPickup => None,
        _ => return,
    };
    // P-STATUS-1: stun/ability cast refuses before even looking up the requested id.
    let result = pickup_check(cx, ix, id, !cx.w.standing(ix)).and_then(|i| take(cx, ix, i));
    if let Err(reason) = result {
        // A client can guess run-local ids. Only a visible prop can give it a
        // distance, reach or empty-container hint. A blocked order still reports
        // the player's own status without inspecting the target.
        let target_visible = match reason {
            PickupRefusal::NothingThere | PickupRefusal::Blocked => false,
            PickupRefusal::TooFar | PickupRefusal::Unreachable | PickupRefusal::NothingToTake => {
                let i =
                    cx.w.containers
                        .binary_search_by_key(&id.expect("present target"), |c| c.id)
                        .expect("target of refused pickup still present");
                let from = cx.w.core(ix).pos();
                let at = cx.w.containers[i].at;
                point_visible(&cx.k.arena.map, from, at)
            }
        };
        cx.ev.push(Event::PickupRefused {
            id: cx.w.core(ix).id,
            reason,
            target_visible,
        });
    }
}

fn take(cx: &mut Cx, ix: FighterIx, i: usize) -> Result<(), PickupRefusal> {
    let c = &mut cx.w.containers[i];
    if c.kind == ContainerKind::Chest {
        c.opened = true;
    }
    let item = c.items[0]
        .filter(|it| it.weapon != WeaponId::Fists)
        .ok_or(PickupRefusal::NothingToTake)?;
    c.items[0] = c.items[1].take();
    let vanished = c.kind == ContainerKind::Ground && c.items[0].is_none();
    let now = cx.w.server_time;
    let p = cx.w.core_mut(ix);
    let slot = p.weapon.pickup_slot(false);
    let old = if slot == 0 {
        p.weapon.weapon0.replace(item.weapon)
    } else {
        p.weapon.weapon1.replace(item.weapon)
    };
    if slot == p.weapon.slot {
        weapon_changed(p, now);
    }
    let at = p.pos();
    if vanished {
        cx.w.containers.remove(i);
    }
    if let Some(old) = old {
        add_container(
            cx.w,
            ContainerKind::Ground,
            at,
            [Some(old), None],
            cx.w.tick,
            false,
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::arenas::practice_arena;
    use crate::{FactionId, Placement, PlayerId, Secrets, SimConfig};
    use WeaponId::{Axe, Sword};

    #[test]
    fn free_slot_and_committed_hand_rules() {
        for (hand, slots, locked, destination, can_swap) in [
            (0, [None, None], false, 0, false),
            (1, [None, None], false, 1, false),
            (0, [Some(Sword), None], false, 1, true),
            (0, [Some(Sword), None], true, 0, false),
            (1, [None, Some(Axe)], true, 0, true),
            (1, [Some(Sword), None], true, 1, true),
            (1, [Some(Sword), Some(Axe)], false, 1, true),
        ] {
            let w = WeaponRt {
                slot: hand,
                weapon0: slots[0],
                weapon1: slots[1],
                ..Default::default()
            };
            assert_eq!(w.pickup_slot(locked), destination);
            assert_eq!(w.can_swap(1 - hand, locked), can_swap);
            assert!(!w.can_swap(hand, locked));
            assert!(!w.can_swap(2, locked));
        }
    }

    #[test]
    fn a_held_chest_waits_for_publication_and_blocked_precedes_unknown_or_born() {
        let at = Vec2::new(400.0, 400.0);
        let ps = [Placement {
            profile: "p".into(),
            faction: FactionId::Fire,
            bot: false,
            at,
            hp: None,
            weapon0: None,
            weapon1: None,
        }];
        let mut sim = Sim::reset_active(
            SimConfig::default(),
            practice_arena(),
            Secrets::from_seed(2),
            &ps,
        );
        let tick = sim.tick();
        let chest = add_container(
            &mut sim.w,
            ContainerKind::Chest,
            at,
            [Some(Axe), None],
            tick,
            false,
        );
        let mut events = Vec::new();
        let cx = Cx {
            k: &sim.k,
            w: &mut sim.w,
            s: &mut sim.s,
            pf: &mut sim.pf,
            ev: &mut events,
        };
        let ix = cx.w.fighter_idx(PlayerId(1)).unwrap();
        assert_eq!(
            pickup_check(&cx, ix, Some(chest + 1), true),
            Err(PickupRefusal::Blocked)
        );
        assert_eq!(
            pickup_check(&cx, ix, Some(chest), true),
            Err(PickupRefusal::Blocked)
        );
        assert_eq!(
            pickup_check(&cx, ix, Some(chest), false),
            Err(PickupRefusal::NothingThere)
        );
        cx.w.tick += 1;
        assert_eq!(
            pickup_check(&cx, ix, Some(chest), false),
            Err(PickupRefusal::NothingThere)
        );
        cx.w.tick += 1;
        assert_eq!(pickup_check(&cx, ix, Some(chest), false), Ok(0));
    }
}
