//! P-ELITE-PICK-1 oracle: the elite camp killer's first pick (owner 2026-11-18, "Killer first pick"; the workbook's chest
//! rule: "the killer gets a 5 s first-pick window"), live world only (`SimConfig::elites == Rework`).
//!
//! Plan of record `docs/backlog/AUGMENT_ELITE_REWORK.md` (decisions 1 and 6, packet row and details P-ELITE-PICK-1);
//! brief `docs/backlog/packets/P-ELITE-PICK-1.md`. Loose proof (owner direction 2026-11-10): one rough test per claim.
//!
//! 1. Under Rework an elite camp's chest holds the credited killer (most damage, decision 6) and `drop + 5 s`.
//! 2. Inside the window only the killer may choose (a card or the skip); the others are refused `NotYours`, and their
//!    observation says `can_choose: false`. From `server_time >= until` it is first-come as today.
//! 3. The window ends early when the killer stops standing (dies, is downed, resolves) or leaves the match; a killer who
//!    is not standing at the drop gets none.
//! 4. No window under Legacy (the chest and the reward draws are the Rework drop's, minus the window), none on a campless
//!    elite's chest, a stat crate or a Trophy.
//! 5. A checkpoint mid-window and after it restores and hashes equal; the field is hashed; forged windows are refused.
//! 6. Observations: the killer's and another player's rows differ in `can_choose` and `mine` alone (P-WIRE19-A amend).
use super::*;
use crate::fighter::FighterIx;
use crate::systems::ledger::Hit;
use crate::{Arena, EliteRule, FactionId, Placement, Secrets, Sim, SimConfig, Status, TileMap};

/// The owner's number (5 s), in ms. A fn, not a const: `tests/content.rs` scans every const.
fn owner_window_ms() -> f64 {
    5000.
}

fn seed1_arena() -> Arena {
    let import: crate::mapdata::MapExport =
        serde_json::from_str(include_str!("../mapdata/fixtures/seed1.map.json")).unwrap();
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

/// seed1 with three Holy players (ids 1, 2, 3). `mobs`: the PvE camps (only the real-death test needs them; without
/// them nothing fights the players standing at a camp's chest).
fn world(elites: EliteRule, mobs: bool) -> Sim {
    let arena = seed1_arena();
    let places: Vec<Placement> = (0..3)
        .map(|i| Placement {
            profile: format!("PICK{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: arena.spawns[i % arena.spawns.len()],
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    Sim::reset_active(
        SimConfig {
            mob_mode: if mobs {
                crate::mob_runtime::MobMode::Pve
            } else {
                crate::mob_runtime::MobMode::Off
            },
            // The PvE camps need the initial loot and its storage (as `mob_life/share_tests.rs`).
            initial_loot: mobs,
            consumables: true,
            pvp_rules: false,
            quests: false,
            elites,
            ..Default::default()
        },
        arena,
        Secrets {
            reward_salt: [3, 1, 4, 1],
            ..Secrets::from_seed(23)
        },
        &places,
    )
}

fn ids(s: &Sim) -> Vec<PlayerId> {
    s.players().iter().map(|p| p.id).collect()
}

/// The first elite camp of the map (`elite_spot >= 0`).
fn elite_camp(s: &Sim) -> u32 {
    let camps = &s.k.arena.map.layers().expect("seed1 layers").data().camps;
    camps
        .iter()
        .position(|c| c.elite_spot >= 0)
        .expect("seed1 has an elite camp") as u32
}

fn teleport(s: &mut Sim, id: PlayerId, at: Vec2) {
    let i = s.w.idx(id).expect("player");
    s.w.players[i].body.x = at.x;
    s.w.players[i].body.y = at.y;
}

/// Every player at the camp's chest spot (in reach, in sight, eligible).
fn gather(s: &mut Sim, camp: u32) -> Vec2 {
    let spot = camp_chest_spot(&s.k, camp).expect("the camp has a chest spot");
    for id in ids(s) {
        teleport(s, id, spot);
    }
    spot
}

/// The `mobKilled` chest link for an elite of `camp` (`-1`: a campless elite), credited to `killer`, every player in the
/// contributor snapshot. Returns the dropped chest's id.
fn kill_elite(s: &mut Sim, camp: i32, killer: PlayerId) -> u32 {
    let contributors = ids(s);
    let before = s.w.reward_chests.len();
    let at = s.players()[1].pos();
    let mut ev = Vec::new();
    on_mob_killed(
        &mut crate::hooks::Hx {
            stats: Default::default(),
            fx: None,
            k: &s.k,
            w: &mut s.w,
            ev: &mut ev,
        },
        &crate::hooks::HookArgs::MobKilled {
            killer,
            mob_type: crate::mob_catalog::MobTypeId::ALL[0],
            zone: FactionId::Holy,
            camp,
            elite: true,
            at,
            contributors,
        },
    );
    assert_eq!(
        s.w.reward_chests.len(),
        before + 1,
        "an elite death drops one chest"
    );
    s.w.reward_chests.last().unwrap().id
}

fn chest(s: &Sim, id: u32) -> &Chest {
    s.w.reward_chests
        .iter()
        .find(|c| c.id == id)
        .expect("the chest stands")
}

fn chest_mut(s: &mut Sim, id: u32) -> &mut Chest {
    s.w.reward_chests
        .iter_mut()
        .find(|c| c.id == id)
        .expect("the chest stands")
}

/// The time the chest dropped (a shared chest lives `lifetime_ms` from its drop).
fn dropped_at(c: &Chest) -> f64 {
    c.expires_at - DEFINITION.lifetime_ms
}

/// Steps past the chest's birth hold.
fn past_hold(s: &mut Sim, id: u32) {
    while !birth_available(chest(s, id).held_until_tick, s.w.tick) {
        s.step();
    }
}

/// `viewer`'s one observed chest row.
fn row(s: &Sim, viewer: PlayerId) -> RewardChestView {
    let mut observer = RewardChestObserver::new(viewer);
    let (mut rows, mut build) = (Vec::new(), None);
    let _ = observer.prepare_into(s, &mut rows, &mut build).unwrap();
    assert_eq!(rows.len(), 1, "{viewer:?} sees the chest");
    rows.pop().unwrap()
}

/// Submits each `(who, pick)` through `validate` + `submit` and steps once; returns each one's outcome, in order.
fn picks(s: &mut Sim, chest: u32, each: &[(PlayerId, i8)]) -> Vec<Option<Result<i8, Refusal>>> {
    for (who, pick) in each {
        let cmd = crate::validate(crate::RawCommand::Choose {
            chest_id: Some(chest),
            pick: *pick,
        })
        .unwrap();
        s.submit(*who, cmd).unwrap();
    }
    let ev = s.step();
    each.iter()
        .map(|(who, _)| {
            ev.iter().find_map(|e| match e {
                Event::ChestTaken { by, pick, .. } if by == who => Some(Ok(*pick)),
                Event::ChestRefused { id, reason } if id == who => Some(Err(*reason)),
                _ => None,
            })
        })
        .collect()
}

fn card(c: &Chest, i: usize) -> crate::cards::CardId {
    match c.options[i] {
        Some(OptionId::Card(id)) => id,
        other => panic!("option {i} of an elite chest is {other:?}"),
    }
}

fn owns(s: &Sim, who: PlayerId, id: crate::cards::CardId) -> bool {
    s.player(who).is_some_and(|p| p.build.owns(id))
}

fn restore(s: &Sim) -> Result<Sim, String> {
    serde_json::from_value::<Sim>(serde_json::to_value(s).unwrap()).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. The window and who holds it.
// ---------------------------------------------------------------------------------------------------------------------

#[test]
fn the_window_is_the_owners_five_seconds_read_from_its_content_row() {
    assert_eq!(first_pick_window_ms(), owner_window_ms());
    assert!(
        crate::constants::REGISTRY
            .iter()
            .any(|e| e.name.contains("FIRST_PICK")
                && e.unit == "ms"
                && e.val == crate::constants::ContentVal::F64(owner_window_ms())),
        "the window is a registered content row (`*FIRST_PICK*`, 5000 ms)"
    );
}

#[test]
fn a_rework_elite_camp_chest_holds_the_killer_and_drop_plus_the_window() {
    let mut s = world(EliteRule::Rework, false);
    let camp = elite_camp(&s);
    gather(&mut s, camp);
    let ps = ids(&s);
    let now = s.server_time();
    let id = kill_elite(&mut s, camp as i32, ps[1]);
    let c = chest(&s, id);
    assert_eq!(c.camp, Some(camp as u16));
    assert_eq!(dropped_at(c), now);
    assert_eq!(
        c.first_pick,
        Some(FirstPick {
            killer: ps[1],
            until: now + owner_window_ms(),
        }),
        "the credited killer's window, from the drop"
    );
}

#[test]
fn the_window_goes_to_the_credited_killer_with_the_most_damage_not_the_last_hit() {
    // Decision 6 through the real path: hits land on a camp's elite, its death queues the payout, the payout fires the
    // chest link. The second player does most of the damage; the first lands the killing blow.
    let mut s = world(EliteRule::Rework, true);
    let ps = ids(&s);
    let camp = s
        .camp_rosters()
        .iter()
        .position(|r| r.elite.is_some())
        .expect("an elite camp");
    let elite = s
        .mobs()
        .iter()
        .find(|m| m.camp as usize == camp && m.elite)
        .expect("the camp's elite")
        .core
        .id;
    let slot = s.w.mobs.iter().position(|m| m.core.id == elite).unwrap();
    let ix = FighterIx::of_slot(s.w.players.len() + slot);
    let hp = s.w.mobs.get(elite).unwrap().core.vitals.hp;
    let hit = |by: PlayerId, amount: f64| Hit {
        terrain: false,
        amount,
        by: Some(by),
        name: None,
    };
    let chests = s.w.reward_chests.len();
    let now = s.server_time();
    let mut ev = vec![];
    s.w.pay.collecting = true;
    crate::systems::mob_life::hurt(&s.k, &mut s.w, &mut ev, ix, &[hit(ps[1], hp * 0.6)]);
    assert_eq!(s.w.mobs.get(elite).unwrap().status, Status::Alive);
    crate::systems::mob_life::hurt(&s.k, &mut s.w, &mut ev, ix, &[hit(ps[0], hp * 0.5)]);
    assert_eq!(s.w.mobs.get(elite).unwrap().status, Status::Dead);
    crate::systems::ledger::pay_all(&s.k, &mut s.w, &mut ev, &mut s.pf);
    assert_eq!(
        s.w.reward_chests.len(),
        chests + 1,
        "the elite dropped its chest"
    );
    let c = s.w.reward_chests.last().unwrap();
    assert_eq!(c.camp, Some(camp as u16));
    assert_eq!(
        c.first_pick,
        Some(FirstPick {
            killer: ps[1],
            until: now + owner_window_ms(),
        }),
        "the most-damage player (60%) holds the window, not the last hitter (40% after overkill)"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Inside the window only the killer picks; after it, first-come.
// ---------------------------------------------------------------------------------------------------------------------

#[test]
fn inside_the_window_only_the_killer_can_pick_and_after_it_anyone_eligible_can() {
    let mut s = world(EliteRule::Rework, false);
    let camp = elite_camp(&s);
    gather(&mut s, camp);
    let [killer, second, third] = ids(&s)[..] else {
        unreachable!()
    };
    let id = kill_elite(&mut s, camp as i32, killer);
    let until = dropped_at(chest(&s, id)) + owner_window_ms();
    past_hold(&mut s, id);

    // The observation agrees with the command: the killer may, the others may not.
    assert!(row(&s, killer).can_choose, "the killer can choose");
    assert!(
        !row(&s, second).can_choose && !row(&s, third).can_choose,
        "inside the window the others cannot choose"
    );

    // A card pick and a skip from the others are refused as any ineligible pick is (no new refusal code).
    assert_eq!(
        picks(&mut s, id, &[(second, 0), (third, -1)]),
        vec![Some(Err(Refusal::NotYours)), Some(Err(Refusal::NotYours))],
        "inside the window"
    );
    let c = chest(&s, id);
    assert_eq!(c.taken, [None; 3], "a refused pick takes nothing");
    assert!(
        c.pickers.is_empty(),
        "a refused pick or skip is not recorded"
    );
    let (first, other, last) = (card(c, 0), card(c, 1), card(c, 2));
    assert!(!owns(&s, second, first));

    // The killer picks inside the window; the others are still refused while it lasts.
    assert_eq!(picks(&mut s, id, &[(killer, 0)]), vec![Some(Ok(0))]);
    assert!(owns(&s, killer, first));
    assert_eq!(
        picks(&mut s, id, &[(second, 1)]),
        vec![Some(Err(Refusal::NotYours))],
        "the window lasts after the killer's pick"
    );
    assert!(
        s.server_time() < until,
        "all of the above inside the window"
    );

    // From `until` on, first-come as today.
    while s.server_time() < until {
        s.step();
    }
    assert!(row(&s, second).can_choose && row(&s, third).can_choose);
    assert_eq!(
        picks(&mut s, id, &[(second, 1), (third, 2)]),
        vec![Some(Ok(1)), Some(Ok(2))],
        "after the window"
    );
    assert!(owns(&s, second, other) && owns(&s, third, last));
}

#[test]
fn the_window_is_open_while_server_time_is_before_its_end_for_the_command_and_the_observer_alike() {
    // The gate alone, on a declared window (the drop is pinned above): the same predicate in `choose` and `can_choose`,
    // exclusive at the end as the chest's own expiry is.
    for ahead in [-50., -1., 0., 1., 50.] {
        let mut s = world(EliteRule::Rework, false);
        let camp = elite_camp(&s);
        gather(&mut s, camp);
        let [killer, second, _] = ids(&s)[..] else {
            unreachable!()
        };
        let id = kill_elite(&mut s, camp as i32, killer);
        past_hold(&mut s, id);
        let now = s.server_time();
        chest_mut(&mut s, id).first_pick = Some(FirstPick {
            killer,
            until: now + ahead,
        });
        let open = ahead > 0.;
        assert!(row(&s, killer).can_choose, "ahead {ahead}: the killer");
        assert_eq!(
            row(&s, second).can_choose,
            !open,
            "ahead {ahead}: the observer"
        );
        let mut ev = Vec::new();
        let got = choose(&s.k, &mut s.w, &mut ev, second, Some(id), 0);
        assert_eq!(
            got,
            if open { Err(Refusal::NotYours) } else { Ok(()) },
            "ahead {ahead}: the command"
        );
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. The killer leaves the window early.
// ---------------------------------------------------------------------------------------------------------------------

#[test]
fn the_window_ends_early_when_the_killer_dies_or_leaves_and_a_fallen_killer_gets_none() {
    for how in [
        "dead",
        "downed",
        "resolved",
        "left",
        "fallen before the drop",
    ] {
        let mut s = world(EliteRule::Rework, false);
        let camp = elite_camp(&s);
        gather(&mut s, camp);
        let [killer, second, _] = ids(&s)[..] else {
            unreachable!()
        };
        let fall = |s: &mut Sim| {
            let i = s.w.idx(killer).unwrap();
            match how {
                "dead" | "fallen before the drop" => s.w.players[i].status = Status::Dead,
                "downed" => s.w.players[i].down = Some(crate::results::Outcome::Mia),
                "resolved" => s.w.players[i].resolved = true,
                "left" => s.remove_player(killer),
                _ => unreachable!(),
            }
        };
        if how == "fallen before the drop" {
            fall(&mut s);
        }
        let id = kill_elite(&mut s, camp as i32, killer);
        let until = dropped_at(chest(&s, id)) + owner_window_ms();
        past_hold(&mut s, id);
        if how != "fallen before the drop" {
            assert!(!row(&s, second).can_choose, "{how}: the window is open");
            fall(&mut s);
        }
        s.step();
        assert!(row(&s, second).can_choose, "{how}: the window has ended");
        assert_eq!(
            picks(&mut s, id, &[(second, 0)]),
            vec![Some(Ok(0))],
            "{how}: another player picks inside the original five seconds"
        );
        assert!(s.server_time() < until, "{how}: before the window's end");
        let restored =
            restore(&s).unwrap_or_else(|e| panic!("{how}: the checkpoint restores: {e}"));
        assert_eq!(restored.state_hash(), s.state_hash(), "{how}");
    }
}

#[test]
fn a_killer_away_from_the_camp_still_holds_the_window() {
    // Eligibility near the camp shapes only the cards rolled; the window is the credited killer's wherever they stand.
    let mut s = world(EliteRule::Rework, false);
    let camp = elite_camp(&s);
    gather(&mut s, camp);
    let [killer, second, _] = ids(&s)[..] else {
        unreachable!()
    };
    let far = s.k.arena.spawns[0];
    teleport(&mut s, killer, far);
    let id = kill_elite(&mut s, camp as i32, killer);
    assert_eq!(chest(&s, id).first_pick.map(|f| f.killer), Some(killer));
    past_hold(&mut s, id);
    assert_eq!(
        picks(&mut s, id, &[(second, 0)]),
        vec![Some(Err(Refusal::NotYours))]
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. No window under Legacy or on any other chest.
// ---------------------------------------------------------------------------------------------------------------------

#[test]
fn legacy_has_no_window_and_the_rework_drop_differs_from_it_by_the_window_alone() {
    let mut legacy = world(EliteRule::Legacy, false);
    let mut rework = world(EliteRule::Rework, false);
    let camp = elite_camp(&legacy);
    for s in [&mut legacy, &mut rework] {
        gather(s, camp);
    }
    let killer = ids(&legacy)[0];
    let a = kill_elite(&mut legacy, camp as i32, killer);
    let b = kill_elite(&mut rework, camp as i32, killer);
    assert_eq!(chest(&legacy, a).first_pick, None, "Legacy: no window");
    let mut windowless = chest(&rework, b).clone();
    windowless.first_pick = None;
    assert_eq!(
        chest(&legacy, a),
        &windowless,
        "the window changes no option, spot or time"
    );
    assert_eq!(
        legacy.w.reward_rng.next_f64(),
        rework.w.reward_rng.next_f64(),
        "the window draws nothing"
    );
    // Legacy: first-come at once.
    past_hold(&mut legacy, a);
    let second = ids(&legacy)[1];
    assert!(row(&legacy, second).can_choose);
    assert_eq!(picks(&mut legacy, a, &[(second, 0)]), vec![Some(Ok(0))]);
}

#[test]
fn no_window_on_a_campless_elite_a_stat_crate_or_a_trophy_and_no_chest_from_a_normal_mob() {
    let mut s = world(EliteRule::Rework, false);
    let [killer, ..] = ids(&s)[..] else {
        unreachable!()
    };
    let campless = kill_elite(&mut s, -1, killer);
    assert_eq!(chest(&s, campless).camp, None);
    assert_eq!(chest(&s, campless).first_pick, None, "a campless elite");
    let at = s.players()[0].pos();
    let crate_ = drop_stat(&mut s.w, at);
    assert_eq!(chest(&s, crate_).first_pick, None, "a stat crate");
    let trophy = drop_trophy(
        &mut s.w,
        at,
        killer,
        &[crate::kill_augments::KillAugment {
            key: crate::kill_augments::KillStatKey::Ad,
            gain: 6.,
        }],
    );
    assert_eq!(chest(&s, trophy).first_pick, None, "a Trophy");
    // A normal mob drops no chest at all.
    let camp = elite_camp(&s);
    let before = s.w.reward_chests.len();
    on_mob_killed(
        &mut crate::hooks::Hx {
            stats: Default::default(),
            fx: None,
            k: &s.k,
            w: &mut s.w,
            ev: &mut Vec::new(),
        },
        &crate::hooks::HookArgs::MobKilled {
            killer,
            mob_type: crate::mob_catalog::MobTypeId::ALL[0],
            zone: FactionId::Holy,
            camp: camp as i32,
            elite: false,
            at,
            contributors: Vec::new(),
        },
    );
    assert_eq!(s.w.reward_chests.len(), before);
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. Checkpoint, hash and forged states.
// ---------------------------------------------------------------------------------------------------------------------

#[test]
fn a_checkpoint_mid_window_restores_hashes_equal_and_plays_the_window_out() {
    let mut s = world(EliteRule::Rework, false);
    let camp = elite_camp(&s);
    gather(&mut s, camp);
    let [killer, second, _] = ids(&s)[..] else {
        unreachable!()
    };
    let id = kill_elite(&mut s, camp as i32, killer);
    let until = dropped_at(chest(&s, id)) + owner_window_ms();
    past_hold(&mut s, id);
    s.step();
    let json = serde_json::to_value(&s).unwrap();
    assert_eq!(json["format"], crate::checkpoint::CHECKPOINT_FORMAT);
    let mut restored = restore(&s).expect("a mid-window checkpoint restores");
    assert_eq!(restored.state_hash(), s.state_hash());
    assert_eq!(chest(&restored, id).first_pick, chest(&s, id).first_pick);
    assert!(chest(&restored, id).first_pick.is_some());
    for sim in [&mut s, &mut restored] {
        assert_eq!(
            picks(sim, id, &[(second, 0)]),
            vec![Some(Err(Refusal::NotYours))],
            "the restored window holds"
        );
    }
    assert_eq!(restored.state_hash(), s.state_hash());
    while s.server_time() < until {
        assert_eq!(s.step(), restored.step());
    }
    // After the window: the ended window restores too (its end is in the past while the chest stands).
    let mut after = restore(&s).expect("a checkpoint after the window restores");
    assert_eq!(after.state_hash(), s.state_hash());
    for sim in [&mut s, &mut restored, &mut after] {
        assert_eq!(picks(sim, id, &[(second, 0)]), vec![Some(Ok(0))]);
    }
    assert_eq!(restored.state_hash(), s.state_hash());
    assert_eq!(after.state_hash(), s.state_hash());
}

#[test]
fn the_window_is_hashed() {
    let mut s = world(EliteRule::Rework, false);
    let camp = elite_camp(&s);
    gather(&mut s, camp);
    let [killer, second, _] = ids(&s)[..] else {
        unreachable!()
    };
    let id = kill_elite(&mut s, camp as i32, killer);
    let until = dropped_at(chest(&s, id)) + owner_window_ms();
    chest_mut(&mut s, id).first_pick = Some(FirstPick { killer, until });
    let base = s.state_hash();
    for (what, window) in [
        ("none", None),
        (
            "killer",
            Some(FirstPick {
                killer: second,
                until,
            }),
        ),
        (
            "until",
            Some(FirstPick {
                killer,
                until: until - 50.,
            }),
        ),
    ] {
        let mut t = s.clone();
        chest_mut(&mut t, id).first_pick = window;
        assert_ne!(t.state_hash(), base, "{what}");
    }
}

#[test]
fn check_world_refuses_forged_windows() {
    // A valid Rework window restores; each forgery of it is refused.
    let mut s = world(EliteRule::Rework, false);
    let camp = elite_camp(&s);
    gather(&mut s, camp);
    let [killer, ..] = ids(&s)[..] else {
        unreachable!()
    };
    let id = kill_elite(&mut s, camp as i32, killer);
    let campless = kill_elite(&mut s, -1, killer);
    let end = dropped_at(chest(&s, id)) + owner_window_ms();
    let fine = Some(FirstPick { killer, until: end });
    chest_mut(&mut s, id).first_pick = fine;
    chest_mut(&mut s, campless).first_pick = None;
    restore(&s).expect("a Rework camp chest with its killer and drop + 5 s restores");

    let forged = |what: &str, at: u32, window: Option<FirstPick>| {
        let mut t = s.clone();
        chest_mut(&mut t, at).first_pick = window;
        assert!(restore(&t).is_err(), "restored {what}");
    };
    forged("a killer on a campless chest", campless, fine);
    forged(
        "a window ending after drop + 5 s",
        id,
        Some(FirstPick {
            killer,
            until: end + 1.,
        }),
    );
    forged(
        "a killer who is not a player",
        id,
        Some(FirstPick {
            killer: PlayerId(99),
            until: end,
        }),
    );

    // Legacy: no window on any chest.
    let mut legacy = world(EliteRule::Legacy, false);
    gather(&mut legacy, camp);
    let id = kill_elite(&mut legacy, camp as i32, killer);
    restore(&legacy).expect("a Legacy camp chest without a window restores");
    chest_mut(&mut legacy, id).first_pick = fine;
    assert!(
        restore(&legacy).is_err(),
        "Legacy restored a camp chest with a window"
    );
}

#[test]
fn the_checkpoint_format_is_bumped_past_the_base() {
    // The base of this packet is `rh-checkpoint/33` (`feature/unity-rework` 7673f8a02). Read the constant, not a
    // number: P-AUG-NATIVE-1a may bump it first, and the coordinator merges the two serially (each bumps once).
    let n: u32 = crate::checkpoint::CHECKPOINT_FORMAT
        .strip_prefix("rh-checkpoint/")
        .and_then(|n| n.parse().ok())
        .expect("rh-checkpoint/<n>");
    assert!(
        n > 33,
        "the Chest gained a field: bump CHECKPOINT_FORMAT ({})",
        crate::checkpoint::CHECKPOINT_FORMAT
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. Observations carry nothing new.
// ---------------------------------------------------------------------------------------------------------------------

#[test]
fn the_window_shows_in_the_viewers_own_facts_and_the_row_carries_its_public_end() {
    let mut s = world(EliteRule::Rework, false);
    let camp = elite_camp(&s);
    gather(&mut s, camp);
    let [killer, second, _] = ids(&s)[..] else {
        unreachable!()
    };
    let id = kill_elite(&mut s, camp as i32, killer);
    past_hold(&mut s, id);
    let (mine, theirs) = (row(&s, killer), row(&s, second));
    assert!(mine.can_choose && !theirs.can_choose);
    // P-WIRE19-A (oracle-amend): the row carries the window's public end and an own-only `mine` flag; the killer's row
    // differs from another's in those own facts alone.
    let until = chest(&s, id).first_pick.expect("the window").until;
    assert_eq!(
        RewardChestView {
            can_choose: true,
            first_pick: Some(FirstPickView { until, mine: true }),
            ..theirs.clone()
        },
        mine,
        "the rows differ in can_choose and mine alone"
    );
    let mut keys: Vec<String> = serde_json::to_value(&theirs)
        .unwrap()
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    keys.sort();
    assert_eq!(
        keys,
        [
            "at",
            "can_choose",
            "expires_at",
            "first_pick",
            "handle",
            "options",
            "picked"
        ],
        "RewardChestView's fields"
    );
}
