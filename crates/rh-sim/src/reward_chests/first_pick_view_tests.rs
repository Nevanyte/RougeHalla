//! P-WIRE19-A oracle (observation): the killer first-pick window (P-ELITE-PICK-1) reaches every viewer of the chest as its
//! public end and an own-only `mine` flag, and nothing else (C-OBS). Brief `docs/backlog/packets/P-WIRE19-A.md`,
//! decisions 2 and 3.
//!
//! 1. While the window is in force every viewer's row carries `first_pick: Some { until, mine }` with the same `until`;
//!    `mine` (like `can_choose`) is true only in the killer's own row; the rows of two other viewers are equal; no row
//!    names the killer.
//! 2. The field leaves every row when the window runs out (`server_time >= until`) or its killer stops standing or leaves.
//! 3. The field is part of the row's public identity: the killer's row is republished on the tick its window ends, though
//!    the killer's `can_choose` does not change.
//! 4. A Legacy elite chest (no window) carries `None`.
use super::*;
use crate::{Arena, EliteRule, FactionId, Placement, Secrets, Sim, SimConfig, Status, TileMap};

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

/// seed1, no mobs, three Holy players (ids 1, 2, 3), as `first_pick_tests.rs`.
fn world(elites: EliteRule) -> Sim {
    let arena = seed1_arena();
    let places: Vec<Placement> = (0..3)
        .map(|i| Placement {
            profile: format!("VIEW{i}"),
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
            mob_mode: crate::mob_runtime::MobMode::Off,
            initial_loot: false,
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

/// Every player at the first elite camp's chest spot (in reach, in sight, eligible); returns the camp.
fn gather_at_elite_camp(s: &mut Sim) -> u32 {
    let camps = &s.k.arena.map.layers().expect("seed1 layers").data().camps;
    let camp = camps
        .iter()
        .position(|c| c.elite_spot >= 0)
        .expect("seed1 has an elite camp") as u32;
    let spot = camp_chest_spot(&s.k, camp).expect("the camp has a chest spot");
    for id in ids(s) {
        let i = s.w.idx(id).expect("player");
        s.w.players[i].body.x = spot.x;
        s.w.players[i].body.y = spot.y;
    }
    camp
}

/// The `mobKilled` chest link for an elite of `camp`, credited to `killer`; every player contributed. Returns the chest id.
fn kill_elite(s: &mut Sim, camp: u32, killer: PlayerId) -> u32 {
    let contributors = ids(s);
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
            camp: camp as i32,
            elite: true,
            at,
            contributors,
        },
    );
    s.w.reward_chests
        .last()
        .expect("an elite death drops a chest")
        .id
}

fn chest(s: &Sim, id: u32) -> &Chest {
    s.w.reward_chests
        .iter()
        .find(|c| c.id == id)
        .expect("the chest stands")
}

fn past_hold(s: &mut Sim, id: u32) {
    while !birth_available(chest(s, id).held_until_tick, s.w.tick) {
        s.step();
    }
}

/// `viewer`'s one observed chest row (a fresh observer).
fn row(s: &Sim, viewer: PlayerId) -> RewardChestView {
    let mut observer = RewardChestObserver::new(viewer);
    let (mut rows, mut build) = (Vec::new(), None);
    let _ = observer.prepare_into(s, &mut rows, &mut build).unwrap();
    assert_eq!(rows.len(), 1, "{viewer:?} sees the chest");
    rows.pop().unwrap()
}

/// A Rework elite camp chest past its birth hold, everyone at it; returns (sim, chest id, killer, the two others, until).
fn rework_window() -> (Sim, u32, PlayerId, [PlayerId; 2], f64) {
    let mut s = world(EliteRule::Rework);
    let camp = gather_at_elite_camp(&mut s);
    let [killer, second, third] = ids(&s)[..] else {
        unreachable!()
    };
    let id = kill_elite(&mut s, camp, killer);
    let until = chest(&s, id)
        .first_pick
        .expect("P-ELITE-PICK-1: a Rework elite camp chest holds the killer's window")
        .until;
    past_hold(&mut s, id);
    assert!(s.server_time() < until, "the window is still open");
    (s, id, killer, [second, third], until)
}

/// Every object key of a JSON value, recursively.
fn keys(v: &serde_json::Value, out: &mut Vec<String>) {
    match v {
        serde_json::Value::Object(m) => {
            for (k, v) in m {
                out.push(k.clone());
                keys(v, out);
            }
        }
        serde_json::Value::Array(a) => a.iter().for_each(|v| keys(v, out)),
        _ => {}
    }
}

#[test]
fn every_viewer_sees_the_windows_end_and_only_the_killer_sees_it_as_its_own() {
    let (s, _, killer, [second, third], until) = rework_window();
    let mine = row(&s, killer);
    let theirs = row(&s, second);
    assert_eq!(
        mine.first_pick,
        Some(FirstPickView { until, mine: true }),
        "the killer's row: the window's end, as its own"
    );
    assert_eq!(
        theirs.first_pick,
        Some(FirstPickView { until, mine: false }),
        "another viewer's row: the same end, not its own"
    );
    assert!(mine.can_choose && !theirs.can_choose);
    assert_eq!(
        row(&s, third),
        theirs,
        "two viewers who are not the killer see the same row"
    );
    assert_eq!(
        RewardChestView {
            can_choose: true,
            first_pick: Some(FirstPickView { until, mine: true }),
            ..theirs.clone()
        },
        mine,
        "the killer's row differs from another's in its own facts alone (can_choose, mine)"
    );
    // C-OBS: no row names the killer; the window is its end and an own-only flag.
    for r in [&mine, &theirs] {
        let json = serde_json::to_value(r).unwrap();
        let mut all = Vec::new();
        keys(&json, &mut all);
        assert!(
            !all.iter().any(|k| k.contains("killer")),
            "no key names the killer: {all:?}"
        );
        let mut window: Vec<&String> = json["first_pick"]
            .as_object()
            .expect("first_pick serializes as an object")
            .keys()
            .collect();
        window.sort();
        assert_eq!(window, ["mine", "until"], "the window's public shape");
    }
}

#[test]
fn the_window_leaves_every_row_when_it_runs_out_or_its_killer_falls() {
    // Runs out: still there 50 ms before the end, gone from the end on (open while server_time < until).
    let (mut s, _, killer, others, until) = rework_window();
    while s.server_time() + 50. < until {
        s.step();
    }
    for v in [killer, others[0], others[1]] {
        assert!(
            row(&s, v).first_pick.is_some(),
            "{v:?}: one tick before the end"
        );
    }
    s.step();
    assert!(s.server_time() >= until);
    for v in [killer, others[0], others[1]] {
        assert_eq!(row(&s, v).first_pick, None, "{v:?}: the window ran out");
    }
    // The killer stops standing or leaves: gone after one step, inside the original five seconds.
    for how in ["dead", "downed", "resolved", "left"] {
        let (mut s, _, killer, others, until) = rework_window();
        let i = s.w.idx(killer).unwrap();
        match how {
            "dead" => s.w.players[i].status = Status::Dead,
            "downed" => s.w.players[i].down = Some(crate::results::Outcome::Mia),
            "resolved" => s.w.players[i].resolved = true,
            "left" => s.remove_player(killer),
            _ => unreachable!(),
        }
        s.step();
        assert!(s.server_time() < until, "{how}: inside the original window");
        for v in others {
            assert_eq!(
                row(&s, v).first_pick,
                None,
                "{how}: {v:?} sees no window that gates nobody"
            );
        }
    }
}

#[test]
fn the_killers_row_is_republished_on_the_tick_its_window_ends() {
    let (mut s, id, killer, _, _) = rework_window();
    // End the window one tick from now, so the 20-tick refresh cannot be what republishes the row.
    let end = s.server_time() + 50.;
    s.w.reward_chests
        .iter_mut()
        .find(|c| c.id == id)
        .unwrap()
        .first_pick
        .as_mut()
        .unwrap()
        .until = end;
    let mut observer = RewardChestObserver::new(killer);
    let (mut rows, mut build) = (Vec::new(), None);
    let first = observer.prepare_into(&s, &mut rows, &mut build).unwrap();
    assert!(first.changed(), "the first offer is published");
    first.commit();
    assert_eq!(rows[0].first_pick.map(|f| f.mine), Some(true));
    s.step();
    assert!(s.server_time() >= end, "the window ended on this tick");
    let next = observer.prepare_into(&s, &mut rows, &mut build).unwrap();
    let changed = next.changed();
    next.commit();
    assert!(rows[0].can_choose, "the killer's can_choose did not change");
    assert_eq!(rows[0].first_pick, None);
    assert!(
        changed,
        "the window is part of the row's public identity: its end republishes the killer's row"
    );
}

#[test]
fn a_legacy_elite_chest_carries_no_window() {
    let mut s = world(EliteRule::Legacy);
    let camp = gather_at_elite_camp(&mut s);
    let [killer, second, _] = ids(&s)[..] else {
        unreachable!()
    };
    let id = kill_elite(&mut s, camp, killer);
    past_hold(&mut s, id);
    assert_eq!(row(&s, killer).first_pick, None);
    assert_eq!(row(&s, second).first_pick, None);
}

#[test]
fn the_observation_version_moved_past_30() {
    assert!(
        std::hint::black_box(crate::OBSERVATION_VERSION) > 30,
        "RewardChestView gains first_pick (P-WIRE19-A): OBSERVATION_VERSION moves past 30 (31, or the next number if \
         P-AUG-NATIVE-1b took 31 first)"
    );
}
