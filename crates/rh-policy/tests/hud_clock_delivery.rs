//! P-WIRE17-HUD-3 oracle (delivery side): the projection carries the owner's two end times from the observed inventory
//! into State key 1 unchanged (server ms, `None` stays absent), and the room's minimum players from the arena view into
//! State key 9; a non-finite or negative time, or a minimum past the wire bound, is refused, never clamped. A clock change
//! re-sends key 1 alone.
#![allow(clippy::field_reassign_with_default)]
use rh_policy::delivery::collections::CollectionPublisher;
use rh_protocol::state::{WireArena, MAX_MIN_PLAYERS};
use rh_protocol::{ServerMsg, StateItem, WireInventory};
use rh_sim::{ArenaView, Inventory, Observation};

fn items(frame: &[u8]) -> Vec<StateItem> {
    let ServerMsg::State { items, .. } = ServerMsg::decode(frame).expect("state frame") else {
        panic!("not a state frame")
    };
    items
}

fn owner_obs(healing_until: Option<f64>, speed_boost_until: Option<f64>) -> Observation {
    let mut obs = Observation::default();
    obs.inventory = Some(Inventory {
        active_slot: 0,
        potion_small: 1,
        potion_large: 0,
        potions_healing: u8::from(healing_until.is_some()),
        slots: [None, None],
        healing_until,
        speed_boost_until,
    });
    obs
}

fn arena_obs(min_players: u32) -> Observation {
    let mut obs = Observation::default();
    obs.arena = Some(ArenaView {
        lobby_ends_at: 30_000.,
        plan_ends_at: 0.,
        raid_started_at: 0.,
        patience_ends_at: None,
        in_coliseum: false,
        gates_locked: false,
        sudden_death_at: 0.,
        started_with: 0,
        min_players,
    });
    obs
}

fn full_state(obs: &Observation) -> Vec<StateItem> {
    let pending = CollectionPublisher::default()
        .prepare(obs, false, false, false)
        .expect("encodes");
    items(pending.frame.as_ref().expect("full state"))
}

fn inventory_of(items: &[StateItem]) -> Option<WireInventory> {
    items.iter().find_map(|i| match i {
        StateItem::Inventory(v) => *v,
        _ => None,
    })
}

fn arena_of(items: &[StateItem]) -> Option<WireArena> {
    items.iter().find_map(|i| match i {
        StateItem::Arena(v) => *v,
        _ => None,
    })
}

#[test]
fn identities_move_for_the_clocks_and_the_minimum() {
    assert_eq!(
        rh_sim::OBSERVATION_VERSION,
        28,
        "Inventory gains the owner's end times, ArenaView the room minimum (P-WIRE17-HUD-3)"
    );
    assert_eq!(
        rh_policy::POLICY_CONTRACT_VERSION,
        22,
        "the projected inventory and arena view carry them (P-WIRE17-HUD-3)"
    );
}

#[test]
fn the_owner_clocks_ride_in_key_1_unchanged() {
    for (h, s) in [
        (None, None),
        (Some(5_100.), None),
        (None, Some(5_150.)),
        (Some(6_100.), Some(9_000.5)),
    ] {
        let inv = inventory_of(&full_state(&owner_obs(h, s))).expect("the owner's inventory");
        assert_eq!(
            (inv.healing_until, inv.speed_boost_until),
            (h, s),
            "server ms, bit for bit; absent stays absent"
        );
        assert_eq!(inv.potion_small, 1, "the rest of key 1 as before");
    }
}

#[test]
fn a_bad_clock_is_refused_not_clamped() {
    for bad in [f64::NAN, f64::INFINITY, -1.] {
        for obs in [owner_obs(Some(bad), None), owner_obs(None, Some(bad))] {
            assert!(
                CollectionPublisher::default()
                    .prepare(&obs, false, false, false)
                    .is_err(),
                "{bad} is an encode error"
            );
        }
    }
}

#[test]
fn a_clock_change_resends_the_inventory_alone() {
    let mut obs = owner_obs(None, None);
    let mut publisher = CollectionPublisher::default();
    publisher
        .prepare(&obs, false, false, false)
        .expect("encodes")
        .commit(&mut publisher);
    obs.tick = 1;
    let quiet = publisher
        .prepare(&obs, false, false, false)
        .expect("encodes");
    assert!(quiet.frame.is_none(), "nothing changed, nothing sent");
    quiet.commit(&mut publisher);
    obs.tick = 2;
    obs.inventory.as_mut().unwrap().speed_boost_until = Some(5_150.);
    let pending = publisher
        .prepare(&obs, false, false, false)
        .expect("encodes");
    let items = items(pending.frame.as_ref().expect("the boost started"));
    assert_eq!(items.len(), 1, "only key 1 is re-sent");
    assert_eq!(
        inventory_of(&items).expect("inventory").speed_boost_until,
        Some(5_150.)
    );
}

#[test]
fn the_rooms_minimum_rides_in_key_9() {
    for min in [0u32, 1, 2, 8, u32::from(MAX_MIN_PLAYERS)] {
        let arena = arena_of(&full_state(&arena_obs(min))).expect("the arena view");
        assert_eq!(u32::from(arena.min_players), min, "minimum {min}");
        assert_eq!(arena.lobby_ends_at, 30_000., "the rest of key 9 as before");
    }
    for over in [u32::from(MAX_MIN_PLAYERS) + 1, 256, u32::MAX] {
        assert!(
            CollectionPublisher::default()
                .prepare(&arena_obs(over), false, false, false)
                .is_err(),
            "a minimum of {over} is refused, never clamped or wrapped"
        );
    }
}
