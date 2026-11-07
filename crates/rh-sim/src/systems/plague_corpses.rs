//! Plague corpse harvest (legacy `plagueCorpses.ts`): one marker per real player death, F/auto consumption.
use crate::constants::*;
use crate::content::FactionId;
use crate::events::{Event, PlagueNotice};
use crate::fighter::FighterIx;
use crate::geometry::has_line_of_sight;
use crate::hooks::{HookArgs, Hx, OutCause};
use crate::input::ActionCmd;
use crate::map::MASK_MOVE;
use crate::math::hypot;
use crate::state::{Phase, PlayerId, Status, World};
use crate::statics::MatchStatic;
use crate::systems::{heal, plague_zombies, Cx};

fn toast(w: &mut World, ev: &mut Vec<Event>, to: PlayerId, notice: PlagueNotice) {
    ev.push(Event::PlagueNotice {
        recipient: to,
        notice,
    });
    let _ = (w,);
}

/// One marker for a real death; MIA/removal and training leave none.
pub(crate) fn leave_corpse(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::FighterOut { id, cause } = *args else {
        return;
    };
    if cause != OutCause::Down || hx.w.phase != Phase::Active {
        return;
    }
    let Some(p) = hx.w.player(id) else {
        return;
    };
    if p.status != Status::Dead {
        return;
    }
    if hx.w.plague_corpses.iter().any(|c| c.player == id) {
        return;
    }
    let (x, y) = (p.body.x, p.body.y);
    hx.w.plague_corpses
        .push(crate::state::PlagueCorpse { player: id, x, y });
}

pub(crate) fn run_ended(hx: &mut Hx, _args: &HookArgs) {
    hx.w.plague_corpses.clear();
}

fn consume(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    owner_id: PlayerId,
    corpse_player: PlayerId,
    auto: bool,
) -> bool {
    let Some(ix) = w.idx(owner_id) else {
        return false;
    };
    let p = &w.players[ix];
    if !p.standing() {
        if !auto {
            toast(w, ev, owner_id, PlagueNotice::OnlyLiving);
        }
        return false;
    }
    if p.vitals.faction != FactionId::Plague {
        if !auto {
            toast(w, ev, owner_id, PlagueNotice::OnlyPlague);
        }
        return false;
    }
    if crate::status_runtime::action_blocked(&p.statuses, w.server_time) {
        if !auto {
            toast(w, ev, owner_id, PlagueNotice::Blocked);
        }
        return false;
    }
    let Some(ci) = w
        .plague_corpses
        .iter()
        .position(|c| c.player == corpse_player)
    else {
        if !auto {
            toast(w, ev, owner_id, PlagueNotice::Gone);
        }
        return false;
    };
    let at = (w.plague_corpses[ci].x, w.plague_corpses[ci].y);
    let reach = if auto {
        PLAGUE_CORPSE_AUTO_RANGE
    } else {
        PLAGUE_CORPSE_INTERACT_RANGE
    };
    if hypot(at.0 - p.body.x, at.1 - p.body.y) > reach {
        if !auto {
            toast(w, ev, owner_id, PlagueNotice::Far);
        }
        return false;
    }
    if !has_line_of_sight(
        k.collision_map(w.rt.gates_locked),
        p.pos(),
        crate::Vec2::new(at.0, at.1),
        MASK_MOVE,
    ) {
        if !auto {
            toast(w, ev, owner_id, PlagueNotice::Unreachable);
        }
        return false;
    }
    // Remove first: simultaneous attempts have one winner in the shuffled action order.
    w.plague_corpses.remove(ci);
    let stacks = w.players[ix].farm.corpse_stacks().saturating_add(1);
    w.players[ix].farm.set_corpse_stacks(stacks);
    let hp_before = w.players[ix].vitals.hp;
    crate::modifiers::recompute(k, w, FighterIx::of_slot(ix));
    crate::modifiers::sync_max_hp(&mut w.players[ix]);
    w.players[ix].vitals.hp = hp_before.min(w.players[ix].vitals.max_hp);
    let amount = crate::content::faction(FactionId::Plague).hp * PLAGUE_CORPSE_HEAL_SHARE;
    heal::apply(w, ev, ix, amount, heal::Kind::Ordinary);
    plague_zombies::raise_or_grow(k, w, owner_id);
    toast(
        w,
        ev,
        owner_id,
        PlagueNotice::Consumed {
            player: corpse_player,
        },
    );
    true
}

pub(crate) fn consume_action(cx: &mut Cx, ix: FighterIx, cmd: &ActionCmd) {
    let ActionCmd::ConsumeCorpse { corpse } = *cmd else {
        return;
    };
    let owner = cx.w.core(ix).id;
    consume(cx.k, cx.w, cx.ev, owner, corpse, false);
}

/// Auto-harvest after movement and damage, in the tick's secret action order.
pub(crate) fn system(cx: &mut Cx) {
    if cx.w.phase != Phase::Active || cx.w.plague_corpses.is_empty() {
        return;
    }
    let order = cx.s.action_order.clone();
    for slot in order {
        let owner = cx.w.players[slot as usize].id;
        if cx.w.players[slot as usize].vitals.faction != FactionId::Plague {
            continue;
        }
        let corpses: Vec<_> = cx.w.plague_corpses.iter().map(|c| c.player).collect();
        for corpse in corpses {
            if !cx.w.plague_corpses.iter().any(|c| c.player == corpse) {
                continue;
            }
            consume(cx.k, cx.w, cx.ev, owner, corpse, true);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{FactionMode, Placement, Secrets, Sim, SimConfig, Vec2, WeaponId};

    fn scene() -> Sim {
        Sim::reset_active(
            SimConfig {
                consumables: true,
                faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentenced,
                ..Default::default()
            },
            crate::arenas::practice_arena(),
            Secrets::from_seed(12),
            &[
                Placement {
                    profile: "plague".into(),
                    faction: FactionId::Plague,
                    bot: false,
                    at: Vec2::new(400., 320.),
                    hp: None,
                    weapon0: Some(WeaponId::Sword),
                    weapon1: None,
                },
                Placement {
                    profile: "victim".into(),
                    faction: FactionId::Holy,
                    bot: false,
                    at: Vec2::new(420., 320.),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                },
                Placement {
                    profile: "other".into(),
                    faction: FactionId::Holy,
                    bot: false,
                    at: Vec2::new(500., 320.),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                },
            ],
        )
    }

    #[test]
    fn a_real_death_leaves_one_corpse_and_mia_leaves_none() {
        let mut s = scene();
        let mut ev = Vec::new();
        crate::systems::settle::down_player(&s.k, &mut s.w, &mut ev, None, 1, crate::Outcome::Died);
        assert_eq!(s.w.plague_corpses.len(), 1);
        assert_eq!(s.w.plague_corpses[0].player, PlayerId(2));
        let mut s = scene();
        let mut ev = Vec::new();
        crate::systems::settle::down_player(&s.k, &mut s.w, &mut ev, None, 1, crate::Outcome::Mia);
        assert!(s.w.plague_corpses.is_empty());
    }

    #[test]
    fn a_consumed_corpse_raises_one_owned_zombie_and_friendly_fire_is_off() {
        let mut s = scene();
        let mut ev = Vec::new();
        crate::systems::settle::down_player(&s.k, &mut s.w, &mut ev, None, 1, crate::Outcome::Died);
        s.w.plague_corpses[0].x = 400.;
        s.w.plague_corpses[0].y = 320.;
        assert!(consume(
            &s.k,
            &mut s.w,
            &mut ev,
            PlayerId(1),
            PlayerId(2),
            false
        ));
        let zombie =
            s.w.mobs
                .as_slice()
                .iter()
                .find(|m| m.owner == Some(PlayerId(1)))
                .expect("raised");
        assert!(zombie.zombie.is_some());
        assert!((zombie.core.vitals.max_hp - 108.528).abs() < 1e-6);
        assert_eq!(s.w.credited_player(zombie.core.id), Some(PlayerId(1)));
        assert!(!plague_zombies::hostile(&s.w, PlayerId(1), zombie.core.id));
        assert!(plague_zombies::hostile(&s.w, zombie.core.id, PlayerId(3)));
        let zid = zombie.core.id;
        let before = zombie.core.vitals.hp;
        assert_eq!(plague_zombies::hurt(&s.k, &mut s.w, &mut ev, zid, 10.), 10.);
        assert!(s.w.mobs.get(zid).unwrap().core.vitals.hp < before);
        let start_x = s.w.mobs.get(zid).unwrap().core.body.x;
        s.w.players[0].weapon.weapon0 = Some(WeaponId::Wand);
        s.w.players[0].weapon.targeting.target = Some(PlayerId(3));
        for _ in 0..10 {
            s.step();
        }
        assert!(s.w.mobs.get(zid).unwrap().status == Status::Alive);
        assert!(s.w.mobs.get(zid).unwrap().core.body.x != start_x);
        let json = serde_json::to_value(&s).unwrap();
        let restored = Sim::restore(&json).expect("zombie checkpoint restores");
        assert!(restored
            .w
            .mobs
            .as_slice()
            .iter()
            .any(|m| m.owner == Some(PlayerId(1))));
    }

    #[test]
    fn consume_grants_a_stack_and_changes_max_hp() {
        let mut s = scene();
        let mut ev = Vec::new();
        crate::systems::settle::down_player(&s.k, &mut s.w, &mut ev, None, 1, crate::Outcome::Died);
        ev.clear();
        let before = s.players()[0].vitals.max_hp;
        let hp_before = s.players()[0].vitals.hp;
        s.w.plague_corpses[0].x = 400.;
        s.w.plague_corpses[0].y = 320.;
        assert!(consume(
            &s.k,
            &mut s.w,
            &mut ev,
            PlayerId(1),
            PlayerId(2),
            false
        ));
        assert!(s.w.plague_corpses.is_empty());
        assert_eq!(s.players()[0].farm.corpse_stacks(), 1);
        assert!(s.players()[0].vitals.max_hp > before);
        assert!(s.players()[0].vitals.hp > hp_before);
        assert!(s
            .w
            .mobs
            .as_slice()
            .iter()
            .any(|m| m.owner == Some(PlayerId(1))));
    }
}
