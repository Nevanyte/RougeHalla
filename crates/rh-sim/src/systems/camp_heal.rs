//! The camp-clear reward (legacy `campHeal.ts`). A cleared camp pays every standing contributor one large ("Camp")
//! potion and counts the clear for the contributors who are still at the camp; the camp's contributor list is then
//! forgotten. The link runs inside the clear's payout, which happens after the ledger pass, with the fx already queued.
use crate::constants::CAMP_HEAL_RANGE;
use crate::hooks::{HookArgs, Hx};
use crate::math::{hypot, Vec2};
use crate::potions::{Notice, Size};
use crate::state::World;
use crate::statics::MatchStatic;
use crate::systems::{mob_ai, potions};
use crate::Event;

/// Legacy `campHeal.payCampHeal` (the `campCleared` link).
pub(crate) fn pay(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::CampCleared { camp } = *args else {
        return;
    };
    let Some(runtime) = hx.w.mob_runtime.as_mut() else {
        return;
    };
    let Some(life) = runtime.life.get_mut(camp as usize) else {
        return;
    };
    // Legacy deletes the list at the end; taking it now is the same for the links after this one (the chest/near-camp
    // consumers run before campHeal and no later link reads it), and it allocates nothing.
    let contributors = std::mem::take(&mut life.contributors);
    if contributors.is_empty() {
        return;
    }
    let centre = camp_centre(hx.k, hx.w, camp);
    for id in contributors {
        reward(hx.k, hx.w, hx.ev, camp, centre, id);
    }
}

/// Legacy `payCampHeal(world, ref - 1)` for a practice camp of the training console (`camps.ts` `practiceMobDied`, paid
/// after the pass): the same reward as a map camp's clear, from the camp's pairs in [`crate::state::PracticeRuntime`], with
/// no `campCleared` fx or hook. `camp_ref` is the practice mobs' `Mob::camp` (101..=255). A no-op for a camp nobody hit.
pub(crate) fn pay_practice(k: &MatchStatic, w: &mut World, ev: &mut Vec<Event>, camp_ref: u32) {
    let Some(run) = w.practice.as_mut() else {
        return;
    };
    if camp_ref == 0 || !run.contributors.iter().any(|&(c, _)| c == camp_ref) {
        return;
    }
    // Taken for the loop and put back without the camp's pairs (legacy `campContrib.delete(camp)` at the end; nothing the
    // reward does reads the list). The vector keeps its capacity.
    let mut pairs = std::mem::take(&mut run.contributors);
    let camp = camp_ref - 1;
    let centre = camp_centre(k, w, camp);
    for &(c, id) in &pairs {
        if c == camp_ref {
            reward(k, w, ev, camp, centre, id);
        }
    }
    pairs.retain(|&(c, _)| c != camp_ref);
    if let Some(run) = w.practice.as_mut() {
        run.contributors = pairs;
    }
}

/// One contributor's share of a clear (the body of legacy `payCampHeal`'s loop): a standing contributor near the camp counts
/// the clear, and every standing contributor stores one large potion.
fn reward(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    camp: u32,
    centre: Option<Vec2>,
    id: crate::PlayerId,
) {
    let Some(i) = w.idx(id) else { return };
    if !w.players[i].standing() {
        return;
    }
    let at = Vec2::new(w.players[i].body.x, w.players[i].body.y);
    if near_camp(k, camp, centre, at) {
        let p = &mut w.players[i];
        p.camps_cleared = p.camps_cleared.saturating_add(1);
    }
    // A contributor that finished the camp from outside still earns the potion (legacy's own rule).
    if !potions::grant(w, ev, id, Size::Large) {
        ev.push(Event::PotionNotice {
            id,
            notice: Notice::CampBagFull,
        });
    }
}

/// Legacy `campCentre`: the map camp's declared point, else the middle of its mobs' resting spots, else none (a camp a
/// hand-built map or the training room made up).
fn camp_centre(k: &MatchStatic, w: &World, camp: u32) -> Option<Vec2> {
    if let Some(def) = k
        .arena
        .map
        .layers()
        .and_then(|l| l.data().camps.get(camp as usize))
    {
        return Some(Vec2::new(def.x, def.y));
    }
    let mut n = 0u32;
    let (mut x, mut y) = (0.0, 0.0);
    for m in w.mobs.iter() {
        if m.camp != camp + 1 {
            continue;
        }
        x += m.home.x;
        y += m.home.y;
        n += 1;
    }
    (n > 0).then(|| Vec2::new(x / f64::from(n), y / f64::from(n)))
}

/// Legacy `nearCamp`: inside the camp's own territory, or within `CAMP_HEAL_RANGE` of its centre; a camp with no centre
/// counts everyone who fought it.
fn near_camp(k: &MatchStatic, camp: u32, centre: Option<Vec2>, at: Vec2) -> bool {
    if mob_ai::territory(k, at) == camp + 1 {
        return true;
    }
    match centre {
        None => true,
        Some(c) => hypot(at.x - c.x, at.y - c.y) <= CAMP_HEAL_RANGE,
    }
}

#[cfg(test)]
#[path = "camp_heal_tests.rs"]
mod tests;

/// P-TRAINING-CAMPS-1: the practice clear inside a ledger pass and from outside the camp's range.
#[cfg(test)]
mod practice_tests {
    use crate::input::TrainRaw;
    use crate::mob_runtime::MobKind;
    use crate::state::Status;
    use crate::systems::ledger::{self, Hit, PayLater, Payout};
    use crate::{FactionId, FactionMode, PlayerId, RawCommand, Secrets, Sim, SimConfig};

    /// The live practice room (`Profile::Training`) with one Holy player and one console camp of three Ember Imps.
    fn room_with_camp() -> (Sim, u32) {
        let config = SimConfig {
            min_players: 1,
            lobby_seconds: 0.,
            fill_seconds: 0.,
            training: true,
            dummies: true,
            consumables: true,
            faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
            ..Default::default()
        };
        let mut sim = Sim::new(
            config,
            crate::arenas::practice_arena(),
            Secrets::from_seed(7),
        );
        sim.add_player("p0", Some(FactionId::Holy), false).unwrap();
        sim.step();
        let raw = TrainRaw {
            command: 3,
            id: crate::mob_catalog::MobTypeId::EmberImp as u32,
            count: 0,
            options: [0; 3],
            option_count: 0,
        };
        let cmd = crate::input::validate(RawCommand::Train(raw)).unwrap();
        let pid = sim.w.players[0].id;
        sim.submit(pid, cmd).unwrap();
        sim.step();
        let camp = sim
            .w
            .mobs
            .iter()
            .filter(|m| m.kind == MobKind::Practice)
            .map(|m| m.camp)
            .max()
            .unwrap();
        (sim, camp)
    }

    fn alive(sim: &Sim, camp: u32) -> Vec<PlayerId> {
        sim.w
            .mobs
            .iter()
            .filter(|m| m.camp == camp && m.status == Status::Alive)
            .map(|m| m.core.id)
            .collect()
    }

    fn hit(sim: &mut Sim, victim: PlayerId, amount: f64, ev: &mut Vec<crate::Event>) {
        let ix = sim.w.fighter_idx(victim).unwrap();
        let by = Some(sim.w.players[0].id);
        crate::systems::mob_life::hurt(
            &sim.k,
            &mut sim.w,
            ev,
            ix,
            &[Hit {
                terrain: false,
                amount,
                by,
                name: None,
            }],
        );
    }

    /// Legacy `practiceMobDied` queues the reward with `payLater` only when no mob of the ref is alive: a whole camp dying
    /// in one pass queues one payout, paid after the pass (one clear, one potion), not one per mob.
    #[test]
    fn a_camp_dying_in_one_pass_pays_one_clear_after_the_pass() {
        let (mut sim, camp) = room_with_camp();
        let potions = sim.w.players[0].potion_large;
        let mut ev = Vec::new();
        sim.w.pay.collecting = true;
        for id in alive(&sim, camp) {
            hit(&mut sim, id, 1.0e6, &mut ev);
        }
        let queued = sim
            .w
            .pay
            .items
            .iter()
            .filter(|p| matches!(p, Payout::Ordinary(PayLater::PracticeCampCleared { .. })))
            .count();
        assert_eq!(queued, 1, "one practice clear queued for the whole camp");
        assert_eq!(
            sim.w.players[0].camps_cleared, 0,
            "nothing paid inside the pass"
        );
        let mut pf = crate::pathfind::Pathfinder::default();
        ledger::pay_all(&sim.k, &mut sim.w, &mut ev, &mut pf);
        assert_eq!(sim.w.players[0].camps_cleared, 1);
        assert_eq!(sim.w.players[0].potion_large, potions + 1);
        assert!(sim.w.practice.as_ref().unwrap().contributors.is_empty());
    }

    /// Legacy `payCampHeal`: a contributor who finished the camp from beyond `CAMP_HEAL_RANGE` still stores the potion but
    /// does not count the clear.
    #[test]
    fn a_contributor_out_of_range_gets_the_potion_but_not_the_clear() {
        let (mut sim, camp) = room_with_camp();
        let potions = sim.w.players[0].potion_large;
        let mut ev = Vec::new();
        let ids = alive(&sim, camp);
        hit(&mut sim, ids[0], 1., &mut ev);
        // The camp's centre is the middle of its mobs' homes; stand at the far end of the room from it.
        let n = ids.len() as f64;
        let cx = ids
            .iter()
            .map(|id| sim.w.mobs.get(*id).unwrap().home.x)
            .sum::<f64>()
            / n;
        let width = f64::from(sim.k.arena.map.w) * crate::constants::TILE;
        let x = if cx < width / 2. {
            width - 2. * crate::constants::TILE
        } else {
            2. * crate::constants::TILE
        };
        assert!((x - cx).abs() > crate::constants::CAMP_HEAL_RANGE);
        sim.w.players[0].body.x = x;
        for id in ids {
            hit(&mut sim, id, 1.0e6, &mut ev);
        }
        assert_eq!(sim.w.players[0].camps_cleared, 0, "too far to count");
        assert_eq!(
            sim.w.players[0].potion_large,
            potions + 1,
            "the potion still"
        );
        assert!(sim.w.practice.as_ref().unwrap().contributors.is_empty());
    }
}
