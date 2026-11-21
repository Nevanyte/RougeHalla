//! P-ELITE-SHARE-1 oracle: under `EliteRule::Rework` an elite kill pays every standing player in the camp's contributor
//! snapshot (the credited killer included) `REWORK_ELITE_SHARE_STACKS` stat stacks of the stat the camp's NORMAL kills
//! pay, through the ordinary farm path. Under `Legacy` an elite kill pays no stacks (`mobLife.ts:265`: stacks go to normal
//! mobs only).
//!
//! The paid stat is the camp's buff row when it has one, else the camp's normal mob type (`CampRoster::mob_type`). It is
//! never the elite's own type: an elite carries an elite catalog type (`rosters.rs camp_mobs`), which has no farm row, so
//! paying by `Award::mob_type` pays nobody. Every award here is built from a real elite mob of a real camp, so that
//! mistake fails the oracle. One test drives a real elite death through `hurt` and the payout queue.
use super::*;
use crate::mob_catalog::MobTypeId;
use crate::{
    Arena, CampBuffRule, EliteRule, FactionId, Placement, Secrets, Sim, SimConfig, TileMap,
};

fn share() -> u64 {
    u64::from(crate::constants::REWORK_ELITE_SHARE_STACKS)
}
fn kill_stacks() -> u64 {
    crate::modifiers::farm::DEFINITION.kill_stacks
}

fn seed1_arena() -> Arena {
    let import: crate::mapdata::MapExport =
        serde_json::from_str(include_str!("../../mapdata/fixtures/seed1.map.json")).unwrap();
    let actual = import.validate().unwrap();
    let spawns = actual
        .layers()
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    let (w, h, tiles, layers) = actual.into_parts();
    Arena {
        map: TileMap::new(w, h, tiles)
            .unwrap()
            .with_layers(layers)
            .unwrap(),
        spawns,
    }
}

/// A seed1 world with three seated players and the given rules; `salt` picks the camp buff roll.
fn world(camps: CampBuffRule, elites: EliteRule, salt: u32) -> Sim {
    let arena = seed1_arena();
    let places: Vec<Placement> = (0..3)
        .map(|i| Placement {
            profile: format!("p{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: arena.spawns[i % arena.spawns.len()],
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let mut secrets = Secrets::from_seed(41);
    secrets.reward_salt = [
        0x5eed_0000 + salt,
        17 * salt + 3,
        0xa5a5_0000 ^ salt,
        7 + salt,
    ];
    Sim::reset_active(
        SimConfig {
            mob_mode: crate::mob_runtime::MobMode::Pve,
            initial_loot: true,
            consumables: true,
            camp_buffs: camps,
            elites,
            ..Default::default()
        },
        arena,
        secrets,
        &places,
    )
}
fn ids(s: &Sim) -> Vec<PlayerId> {
    s.players().iter().map(|p| p.id).collect()
}
/// The stat the camp's normal kills pay: its buff, else its normal mob type (never the elite's type).
fn camp_stat(s: &Sim, camp: usize) -> MobTypeId {
    s.camp_buffs()
        .get(camp)
        .copied()
        .flatten()
        .unwrap_or(s.camp_rosters()[camp].mob_type)
}
fn elite_camps(s: &Sim) -> Vec<usize> {
    (0..s.camp_rosters().len())
        .filter(|&c| s.camp_rosters()[c].elite.is_some())
        .collect()
}
/// The award of the camp's real mob (its elite or one of its normal mobs), as `hurt` builds it.
fn award_at(
    s: &Sim,
    camp: usize,
    elite: bool,
    killer: PlayerId,
    contributors: &[PlayerId],
) -> Award {
    let m = s
        .mobs()
        .iter()
        .find(|m| m.camp as usize == camp && m.elite == elite)
        .unwrap_or_else(|| panic!("camp {camp} has a mob (elite {elite})"));
    Award {
        mob: m.core.id,
        serial: 1,
        killer: Some(killer),
        camp: camp as u32,
        weapon: m.core.active_weapon(),
        at: m.core.pos(),
        elite,
        mob_type: m.mob_type.unwrap(),
        zone: m.core.faction_id().unwrap(),
        mult: 1.,
        contributors: contributors.to_vec(),
    }
}
/// Every farm count of every player, in `MobTypeId::ALL` order.
fn counts(s: &Sim) -> Vec<Vec<u64>> {
    s.players()
        .iter()
        .map(|p| MobTypeId::ALL.iter().map(|&t| p.farm.count(t)).collect())
        .collect()
}
/// What the kill added for each player, per stat type.
fn deltas(before: &[Vec<u64>], after: &[Vec<u64>]) -> Vec<Vec<u64>> {
    before
        .iter()
        .zip(after)
        .map(|(b, a)| a.iter().zip(b).map(|(a, b)| a - b).collect())
        .collect()
}
fn at(t: MobTypeId) -> usize {
    MobTypeId::ALL.iter().position(|&x| x == t).unwrap()
}
/// A delta row paying `n` stacks of `t` and nothing else.
fn only(t: MobTypeId, n: u64) -> Vec<u64> {
    let mut row = vec![0; MobTypeId::ALL.len()];
    row[at(t)] = n;
    row
}
fn nothing() -> Vec<u64> {
    vec![0; MobTypeId::ALL.len()]
}
fn pay_award(s: &mut Sim, a: Award) -> Vec<Event> {
    let mut events = vec![];
    pay(&s.k, &mut s.w, &mut events, a);
    // The end of a tick forgets the per-tick settled set; a checkpoint refuses an unsettled queue.
    s.w.pay.mob_settled.clear();
    events
}
/// The worlds the sweep visits: both buff rules, several rolls. Returns (world, elite camp) pairs.
fn sweep() -> Vec<(CampBuffRule, u32)> {
    vec![
        (CampBuffRule::Themed, 1),
        (CampBuffRule::Themed, 2),
        (CampBuffRule::Themed, 3),
        (CampBuffRule::Themed, 4),
        (CampBuffRule::Legacy, 1),
    ]
}

#[test]
fn the_share_is_one_camps_worth() {
    assert_eq!(share(), 12);
}

#[test]
fn an_elite_award_carries_the_elite_type_which_pays_no_farm_stat() {
    // The trap the oracle guards: the elite's own type is not the camp's stat and has no farm row.
    let s = world(CampBuffRule::Themed, EliteRule::Rework, 1);
    let ps = ids(&s);
    for c in elite_camps(&s) {
        let a = award_at(&s, c, true, ps[0], &ps);
        assert_eq!(Some(a.mob_type), s.camp_rosters()[c].elite, "camp {c}");
        assert_ne!(a.mob_type, s.camp_rosters()[c].mob_type, "camp {c}");
        assert!(
            !crate::modifiers::farm::DEFINITION
                .rows
                .iter()
                .any(|r| r.mob == a.mob_type),
            "camp {c}: an elite type has a farm row"
        );
    }
}

#[test]
fn rework_elite_kill_pays_every_standing_contributor_the_camps_normal_stat_killer_included() {
    let (mut on_theme, mut off_theme) = (0, 0);
    for (rule, salt) in sweep() {
        let mut s = world(rule, EliteRule::Rework, salt);
        let ps = ids(&s);
        for c in elite_camps(&s) {
            let want = camp_stat(&s, c);
            if s.camp_buffs().get(c).copied().flatten().is_some() {
                off_theme += 1;
            } else {
                on_theme += 1;
            }
            let before = counts(&s);
            let a = award_at(&s, c, true, ps[0], &ps);
            pay_award(&mut s, a);
            // Each exactly once: the killer is not paid a second time for being the killer.
            let got = deltas(&before, &counts(&s));
            assert_eq!(
                got,
                vec![only(want, share()); 3],
                "{rule:?} salt {salt} camp {c}: paid {want:?}"
            );
        }
    }
    // The sweep covers a camp with a buff row and one without (every Legacy-rule camp is without).
    assert!(on_theme >= 1 && off_theme >= 1, "{on_theme} / {off_theme}");
}

#[test]
fn snapshot_order_does_not_matter() {
    let mut s = world(CampBuffRule::Themed, EliteRule::Rework, 1);
    let ps = ids(&s);
    let c = elite_camps(&s)[0];
    let want = camp_stat(&s, c);
    let before = counts(&s);
    let a = award_at(&s, c, true, ps[0], &[ps[2], ps[1], ps[0]]);
    pay_award(&mut s, a);
    assert_eq!(deltas(&before, &counts(&s)), vec![only(want, share()); 3]);
}

#[test]
fn a_contributor_who_is_not_standing_is_not_paid() {
    for kind in ["dead", "resolved", "downed"] {
        let mut s = world(CampBuffRule::Themed, EliteRule::Rework, 1);
        let ps = ids(&s);
        let c = elite_camps(&s)[0];
        let want = camp_stat(&s, c);
        match kind {
            "dead" => s.w.players[1].status = Status::Dead,
            "resolved" => s.w.players[1].resolved = true,
            _ => s.w.players[1].down = Some(crate::results::Outcome::Died),
        }
        let before = counts(&s);
        let a = award_at(&s, c, true, ps[0], &ps);
        pay_award(&mut s, a);
        assert_eq!(
            deltas(&before, &counts(&s)),
            vec![only(want, share()), nothing(), only(want, share())],
            "{kind}"
        );
    }
}

#[test]
fn only_the_snapshot_is_paid_not_every_player_in_the_match() {
    let mut s = world(CampBuffRule::Themed, EliteRule::Rework, 1);
    let ps = ids(&s);
    let c = elite_camps(&s)[0];
    let want = camp_stat(&s, c);
    let before = counts(&s);
    let a = award_at(&s, c, true, ps[0], &[ps[0], ps[2]]);
    pay_award(&mut s, a);
    assert_eq!(
        deltas(&before, &counts(&s)),
        vec![only(want, share()), nothing(), only(want, share())]
    );
}

#[test]
fn the_share_is_elite_only_a_normal_kill_still_pays_the_killer_alone() {
    for (rule, salt) in sweep() {
        let mut s = world(rule, EliteRule::Rework, salt);
        let ps = ids(&s);
        let c = elite_camps(&s)[0];
        let want = camp_stat(&s, c);
        let before = counts(&s);
        // A normal mob's award with a three-player list: only the killer is paid, three stacks.
        let a = award_at(&s, c, false, ps[0], &ps);
        pay_award(&mut s, a);
        assert_eq!(
            deltas(&before, &counts(&s)),
            vec![only(want, kill_stacks()), nothing(), nothing()],
            "{rule:?} salt {salt}"
        );
    }
}

#[test]
fn legacy_elite_kill_pays_no_stacks_to_anyone() {
    for (rule, salt) in sweep() {
        let mut s = world(rule, EliteRule::Legacy, salt);
        let ps = ids(&s);
        let c = elite_camps(&s)[0];
        let before = counts(&s);
        let a = award_at(&s, c, true, ps[0], &ps);
        let events = pay_award(&mut s, a);
        assert_eq!(counts(&s), before, "{rule:?} salt {salt}");
        // What it pays today: GV to the killer, and no stack notice.
        assert!(events.iter().any(|e| matches!(e, Event::Gv { .. })));
        assert!(!events.iter().any(|e| matches!(e, Event::Toast { .. })));
    }
}

#[test]
fn the_share_survives_a_checkpoint_and_hashes_equal_including_a_max_hp_stat() {
    let mut paid_max_hp = false;
    for (rule, salt) in sweep() {
        let mut s = world(rule, EliteRule::Rework, salt);
        let ps = ids(&s);
        // Pay every elite camp: the stats cover the camp types of the whole map, MaxHp rows among them.
        let mut want = vec![nothing(); 3];
        for c in elite_camps(&s) {
            let t = camp_stat(&s, c);
            let max_hp_row = crate::modifiers::farm::DEFINITION.rows.iter().any(|r| {
                r.mob == t
                    && r.stat
                        == crate::modifiers::farm::RewardStat::Stat(
                            crate::stat_fold::EffectStat::MaxHp,
                        )
            });
            paid_max_hp |= max_hp_row;
            let a = award_at(&s, c, true, ps[0], &ps);
            pay_award(&mut s, a);
            for row in &mut want {
                row[at(t)] += share();
            }
        }
        assert_eq!(counts(&s), want, "{rule:?} salt {salt}");
        let back = Sim::restore(serde_json::to_value(&s).unwrap()).unwrap();
        assert_eq!(counts(&back), want, "{rule:?} salt {salt}");
        assert_eq!(back.state_hash(), s.state_hash(), "{rule:?} salt {salt}");
        for (a, b) in s.players().iter().zip(back.players()) {
            assert_eq!(a.vitals.max_hp, b.vitals.max_hp, "max hp round-trips");
        }
    }
    assert!(paid_max_hp, "the sweep pays at least one MaxHp stat");
}

#[test]
fn a_real_elite_death_through_hurt_and_the_payout_queue_pays_both_contributors() {
    // The path the direct `pay` tests bypass: hits land on the elite mob, its death queues `PayLater::MobKill`, and the
    // end of the pass pays it. Two players damage the elite; the one with most damage is the credited killer.
    for (rule, salt) in [
        (CampBuffRule::Themed, 1),
        (CampBuffRule::Themed, 2),
        (CampBuffRule::Legacy, 1),
    ] {
        let mut s = world(rule, EliteRule::Rework, salt);
        let ps = ids(&s);
        let c = elite_camps(&s)[0];
        let want = camp_stat(&s, c);
        let id = s
            .mobs()
            .iter()
            .find(|m| m.camp as usize == c && m.elite)
            .unwrap()
            .core
            .id;
        let slot = s.w.mobs.iter().position(|m| m.core.id == id).unwrap();
        let ix = FighterIx::of_slot(s.w.players.len() + slot);
        let hp = s.w.mobs.get(id).unwrap().core.vitals.hp;
        let hit = |by: PlayerId, amount: f64| Hit {
            terrain: false,
            amount,
            by: Some(by),
            name: None,
        };
        let before = counts(&s);
        let mut ev = vec![];
        s.w.pay.collecting = true;
        // Pass one: a wound from the second player. The elite lives, and the snapshot holds the wounder.
        hurt(&s.k, &mut s.w, &mut ev, ix, &[hit(ps[1], 1.)]);
        assert_eq!(s.w.mobs.get(id).unwrap().status, Status::Alive);
        // Pass two: the first player lands the killing blow, with the most damage.
        hurt(&s.k, &mut s.w, &mut ev, ix, &[hit(ps[0], hp + 1000.)]);
        assert_eq!(s.w.mobs.get(id).unwrap().status, Status::Dead, "{rule:?}");
        super::super::ledger::pay_all(&s.k, &mut s.w, &mut ev, &mut s.pf);
        let got = deltas(&before, &counts(&s));
        assert_eq!(
            got,
            vec![only(want, share()), only(want, share()), nothing()],
            "{rule:?} salt {salt} camp {c}: both contributors, not the bystander"
        );
    }
}
