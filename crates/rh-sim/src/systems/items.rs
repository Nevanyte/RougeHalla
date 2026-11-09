//! The two weapon slots, swaps and run-only loot (legacy weapons.ts and loot.ts).
use super::{weapons, Cx};
use crate::constants::SWAP_SECONDS;
use crate::events::{Event, PickupRefusal};
use crate::fighter::{FighterCore, FighterIx};
use crate::hooks::{HookArgs, Hx};
use crate::input::ActionCmd;
use crate::item_view::pickup_reach;
use crate::math::Vec2;
use crate::state::{Container, ContainerKind, WeaponRt, World};
use crate::vision::point_visible;
use crate::{Sim, WeaponId};

/// The axe component of legacy cardHooks.cardSource. Generic status state is its sole owner.
pub(crate) fn shred_source(
    w: &World,
    p: &FighterCore,
    _: crate::schedule::ModSourceInputs,
) -> Option<crate::schedule::ModContribution> {
    let shred = crate::status_runtime::value(
        &p.statuses.instances,
        crate::status_runtime::StatusKind::Shred,
        w.server_time,
    );
    (shred > 0.0).then(|| crate::schedule::ModContribution {
        armor: Some(-shred),
        ..Default::default()
    })
}

pub(crate) fn fold_armor(cx: &mut Cx) {
    #[cfg(test)]
    super::sentenced::mark_tax::record_phase(cx.w, "before-mods");
    crate::cards::fight_clock::note_fights(cx.w, &cx.s.landed);
    for i in 0..cx.w.fighter_count() {
        crate::modifiers::recompute_end_with(cx.k, cx.w, FighterIx::of_slot(i), cx.stats);
    }
    #[cfg(test)]
    super::sentenced::mark_tax::record_phase(cx.w, "after-mods");
}
/// Current mirror owner: every source recompute refreshes all registered current sources together.
pub(crate) fn refold_modifiers_with(
    k: &crate::statics::MatchStatic,
    w: &mut World,
    i: usize,
    stats: crate::status_runtime::stats::Inputs,
) {
    crate::modifiers::recompute_with(k, w, FighterIx::of_slot(i), stats);
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

/// The legacy hitLanded hook: the axe shred first, then the owned cards' on-hit rows.
pub(crate) fn hit_landed(hx: &mut Hx, args: &HookArgs) {
    axe_shred(hx, args);
    crate::cards::on_hit::apply(hx, args);
}

/// Axe shred is the first effect of the legacy hitLanded hook. Returned hits
/// do not proc it; the status is paid after every victim in the pass.
fn axe_shred(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::HitLanded { ref entry, .. } = *args else {
        return;
    };
    if !hx.k.config.weapon_specials
        || entry.passive
        || entry.derived
        || entry.sig.is_some()
        || entry.weapon != Some(WeaponId::Axe)
    {
        return;
    }
    let Some(source) = entry.by.filter(|id| hx.w.fighter_idx(*id).is_some()) else {
        return;
    };
    if hx
        .w
        .fighter_idx(entry.victim)
        .is_some_and(|i| hx.w.standing(i))
    {
        let source = crate::status_runtime::StatusSource {
            id: Some(source),
            name: hx.w.actor_label(source).expect("present axe owner"),
            owner_id: None,
        };
        super::status::operations::apply_with(
            hx.k,
            hx.w,
            hx.ev,
            entry.victim,
            crate::status_runtime::StatusApply {
                kind: crate::status_runtime::StatusKind::Shred,
                source,
                ms: crate::constants::AXE_SHRED_MS,
                ability: None,
                tag: Some(crate::status_runtime::StatusTag::Axe),
                value: None,
                add: Some(crate::status_runtime::AddValue {
                    per: crate::constants::AXE_SHRED_ARMOR,
                    cap: crate::constants::AXE_SHRED_CAP,
                }),
                data: None,
            },
            true,
            hx.stats,
        );
    }
}

pub(crate) fn weapon_changed(p: &mut FighterCore, now: f64) {
    weapons::cancel_action(p, now);
    p.weapon.ready_at = p.weapon.ready_at.max(now) + SWAP_SECONDS * 1000.0;
    if p.active_weapon() != WeaponId::Wand {
        super::targeting::drop_lock(p);
    }
}

pub(crate) fn swap(cx: &mut Cx, ix: FighterIx, cmd: &ActionCmd) {
    if !cx.w.is_player(ix) {
        return;
    }
    let ActionCmd::Swap { slot } = *cmd else {
        return;
    };
    let now = cx.w.server_time;
    // P-STATUS-1 supplies actionBlocked (stun/ability cast), P-CARDS-1 supplies lockSecondSlot: legacy
    // weapons.ts handleSwap reads the Committed flag through the same shared swap rule the client predicts.
    let second_locked = cx.w.players[ix.slot()]
        .build
        .has_flag(crate::stat_fold::EffectFlag::LockSecondSlot);
    let p = cx.w.core_mut(ix);
    let target = slot.unwrap_or(1 - p.weapon.slot);
    if !crate::status_runtime::action_blocked(&p.statuses, now)
        && p.weapon.can_swap(target, second_locked)
    {
        p.weapon.slot = target;
        weapon_changed(p, now);
        let id = p.id;
        crate::hooks::fire(
            &mut crate::hooks::Hx {
                stats: cx.stats,
                k: cx.k,
                w: cx.w,
                ev: cx.ev,
                fx: None,
            },
            crate::hooks::HookArgs::WeaponSwapped(id),
        );
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

/// A walk-over wind emblem (legacy `addContainer(world, "consumable", at, "Wind emblem · walk over it", [windEmblem])`).
/// The emblem holds no inventory item; the wind system consumes it. No allocation: the container list is reserved for
/// the emblem cap, and an empty item list never allocates.
pub(crate) fn add_wind_emblem(w: &mut World, at: Vec2, tick: u32) -> u32 {
    let id = w.next_entity_id();
    w.containers.push(Container {
        id,
        kind: ContainerKind::WindEmblem,
        ready_at: 0.,
        target: None,
        at,
        opened: false,
        items: Vec::new(),
        stat_offer: false,
        born_tick: tick,
    });
    id
}

pub(crate) fn add_container(
    w: &mut World,
    kind: ContainerKind,
    at: Vec2,
    weapons: [Option<WeaponId>; 2],
    tick: u32,
    between_ticks: bool,
) -> u32 {
    let items = weapons
        .into_iter()
        .flatten()
        .map(|weapon| {
            w.item_counter += 1;
            crate::initial_world::Item {
                uid: w.item_counter,
                def: crate::initial_world::ItemDef::Weapon(weapon),
            }
        })
        .collect();
    add_items(w, kind, at, items, tick, between_ticks)
}
fn add_items(
    w: &mut World,
    kind: ContainerKind,
    at: Vec2,
    items: Vec<crate::initial_world::Item>,
    tick: u32,
    between_ticks: bool,
) -> u32 {
    let id = w.next_entity_id();
    w.containers.push(Container {
        id,
        kind,
        at,
        opened: false,
        items,
        target: None,
        ready_at: 0.,
        stat_offer: false,
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
    if hx.k.config.lifecycle.rules().is_some() && !hx.k.config.initial_loot {
        super::loot::clear_player_slots(hx.w, victim);
        return;
    }
    let Some(i) = hx.w.idx(victim) else { return };
    let p = &mut hx.w.players[i];
    let at = p.pos();
    let gear = [p.weapon.weapon0.take(), p.weapon.weapon1.take()];
    let small = std::mem::take(&mut p.potion_small);
    let mut items = Vec::with_capacity(gear.iter().flatten().count() + usize::from(small));
    for def in gear
        .into_iter()
        .flatten()
        .map(crate::initial_world::ItemDef::Weapon)
        .chain((0..small).map(|_| crate::initial_world::ItemDef::PotionSmall))
    {
        hx.w.item_counter += 1;
        items.push(crate::initial_world::Item {
            uid: hx.w.item_counter,
            def,
        });
    }
    add_items(
        hx.w,
        ContainerKind::Body(victim),
        at,
        items,
        hx.w.tick,
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
    pickup_reach(cx.k.collision_map(cx.w.rt.gates_locked), p, c.at)?;
    if !point_visible(
        cx.k.collision_view(cx.w.rt.gates_locked),
        &cx.w.players[ix.slot()],
        c.at,
        cx.w.tick,
        crate::vision::WardSight::of(cx.k, cx.w),
    ) {
        return Err(PickupRefusal::NothingThere);
    }
    Ok(i)
}

pub(crate) fn pickup(cx: &mut Cx, ix: FighterIx, cmd: &ActionCmd) {
    if !cx.w.is_player(ix) {
        return;
    }
    let id = match *cmd {
        ActionCmd::Pickup { container_id } => Some(container_id),
        ActionCmd::MissingPickup => None,
        _ => return,
    };
    // P-STATUS-1: stun/ability cast refuses before even looking up the requested id.
    let result = pickup_check(
        cx,
        ix,
        id,
        !cx.w.standing(ix)
            || crate::status_runtime::action_blocked(&cx.w.core(ix).statuses, cx.w.server_time),
    )
    .and_then(|i| take(cx, ix, i));
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
                let viewer = &cx.w.players[ix.slot()];
                let at = cx.w.containers[i].at;
                point_visible(
                    cx.k.collision_view(cx.w.rt.gates_locked),
                    viewer,
                    at,
                    cx.w.tick,
                    crate::vision::WardSight::of(cx.k, cx.w),
                )
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
    // Source loot.handlePickup: a quest token or parcel is handed to the quest runtime (which uses the item up or refuses
    // silently); it never becomes a weapon or potion pickup.
    if cx.w.containers[i].kind == ContainerKind::Quest {
        crate::quests::live::pickup(cx, ix, i);
        return Ok(());
    }
    // Source: the cannon branch sits after the pickup admission and before the chest/consumable/weapon branches.
    if cx.w.containers[i].kind == ContainerKind::Cannon {
        super::cannons::use_cannon(cx, ix, i);
        return Ok(());
    }
    if cx.w.containers[i].kind == ContainerKind::Chest {
        if !cx.w.containers[i].opened && cx.w.containers[i].stat_offer {
            let at = cx.w.containers[i].at;
            crate::reward_chests::drop_stat(cx.w, at); // Actual reward producer BEFORE opened=true.
        }
        cx.w.containers[i].opened = true;
    }
    let item = *cx.w.containers[i]
        .items
        .first()
        .ok_or(PickupRefusal::NothingToTake)?;
    let potion = match item.def {
        crate::initial_world::ItemDef::PotionSmall => Some(crate::potions::Size::Small),
        crate::initial_world::ItemDef::PotionLarge => Some(crate::potions::Size::Large),
        crate::initial_world::ItemDef::Weapon(_) | crate::initial_world::ItemDef::Quest(_) => None,
    };
    if let Some(size) = potion {
        let id = cx.w.core(ix).id;
        // A full bag refuses the pickup without consuming the item (legacy `pickConsumable`).
        if !super::potions::grant(cx.w, cx.ev, id, size) {
            cx.ev.push(Event::PotionNotice {
                id,
                notice: crate::potions::Notice::BagFull,
            });
            return Ok(());
        }
        cx.w.containers[i].items.remove(0);
        return Ok(());
    }
    let crate::initial_world::ItemDef::Weapon(weapon) = item.def else {
        unreachable!()
    };
    if weapon == WeaponId::Fists {
        return Err(PickupRefusal::NothingToTake);
    }
    cx.w.containers[i].items.remove(0);
    let vanished =
        cx.w.containers[i].kind == ContainerKind::Ground && cx.w.containers[i].items.is_empty();
    let now = cx.w.server_time;
    // Legacy loot.ts handlePickup: Committed's lockSecondSlot keeps an empty second slot empty; the
    // weapon replaces the hand's instead (and drops what it held).
    let second_locked = cx.w.players[ix.slot()]
        .build
        .has_flag(crate::stat_fold::EffectFlag::LockSecondSlot);
    let p = cx.w.core_mut(ix);
    let slot = p.weapon.pickup_slot(second_locked);
    let old = if slot == 0 {
        p.weapon.weapon0.replace(weapon)
    } else {
        p.weapon.weapon1.replace(weapon)
    };
    let changed = slot == p.weapon.slot;
    if changed {
        weapon_changed(p, now);
    }
    let id = p.id;
    let at = p.pos();
    if changed {
        crate::hooks::fire(
            &mut crate::hooks::Hx {
                stats: cx.stats,
                k: cx.k,
                w: cx.w,
                ev: cx.ev,
                fx: None,
            },
            crate::hooks::HookArgs::WeaponSwapped(id),
        );
    }
    if vanished {
        cx.w.containers.remove(i);
    }
    if let Some(old) = old {
        drop_weapon(cx.w, at, old, cx.w.tick, false);
    }
    Ok(())
}

pub(crate) fn drop_weapon(
    w: &mut World,
    at: Vec2,
    weapon: WeaponId,
    tick: u32,
    between_ticks: bool,
) -> u32 {
    add_container(
        w,
        ContainerKind::Ground,
        at,
        [Some(weapon), None],
        tick,
        between_ticks,
    )
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
            stats: crate::status_runtime::stats::Inputs::default(),
            #[cfg(feature = "trusted-status-probes")]
            probe: None,
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
