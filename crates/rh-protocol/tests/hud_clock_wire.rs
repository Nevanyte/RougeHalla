//! P-WIRE17-HUD-3 oracle (wire side): State key 1 (the owner's inventory) appends the owner's healing-potion and
//! wind-emblem end times, each an optional f64 (flag byte, then the server ms when 1); State key 9 (the public arena
//! view) appends the room's minimum players as a u8 after `started_with`. Still protocol 17; `v17.json` regenerated
//! (docs/backlog/packets/P-WIRE17-HUD-3.md, "Wire layout" and "Vector names").
use rh_protocol::samples::{malformed_server, server_samples};
use rh_protocol::state::{WireArena, MAX_MIN_PLAYERS, MAX_ROSTER};
use rh_protocol::*;

fn inv(healing_until: Option<f64>, speed_boost_until: Option<f64>) -> WireInventory {
    WireInventory {
        active_slot: 1,
        slots: [Some(0), None],
        potion_small: 2,
        potion_large: 1,
        potions_healing: 1,
        healing_until,
        speed_boost_until,
    }
}

fn inv_state(value: WireInventory) -> ServerMsg {
    ServerMsg::State {
        tick: 5,
        items: vec![StateItem::Inventory(Some(value))],
    }
}

/// T_STATE, tick 5, one item, key 1, present, slot 1, Sword (code 0 + 1), empty, 2 small, 1 large, 1 healing: the
/// protocol-17 key-1 bytes before this packet.
fn inv_prefix() -> Vec<u8> {
    vec![0x88, 5, 1, 1, 1, 1, 1, 0, 2, 1, 1]
}

fn clock(b: &mut Vec<u8>, v: Option<f64>) {
    match v {
        None => b.push(0),
        Some(v) => {
            b.push(1);
            b.extend_from_slice(&v.to_le_bytes());
        }
    }
}

fn inv_frame(h: Option<f64>, s: Option<f64>) -> Vec<u8> {
    let mut b = inv_prefix();
    clock(&mut b, h);
    clock(&mut b, s);
    b
}

fn arena(min_players: u8) -> WireArena {
    WireArena {
        lobby_ends_at: 30_000.,
        plan_ends_at: 0.,
        raid_started_at: 0.,
        patience_ends_at: None,
        in_coliseum: false,
        gates_locked: false,
        sudden_death_at: 0.,
        started_with: 0,
        min_players,
    }
}

fn arena_state(value: WireArena) -> ServerMsg {
    ServerMsg::State {
        tick: 5,
        items: vec![StateItem::Arena(Some(value))],
    }
}

/// T_STATE, tick 5, one item, key 9, present, lobby 30000, plan 0, raid 0, no patience, two clear flags, sudden death
/// 0, started_with 0: the protocol-17 key-9 bytes before this packet.
fn arena_prefix() -> Vec<u8> {
    let mut b = vec![0x88, 5, 1, 9, 1];
    b.extend_from_slice(&30_000f64.to_le_bytes());
    b.extend_from_slice(&0f64.to_le_bytes());
    b.extend_from_slice(&0f64.to_le_bytes());
    b.extend_from_slice(&[0, 0, 0]);
    b.extend_from_slice(&0f64.to_le_bytes());
    b.push(0);
    b
}

#[test]
fn key_1_appends_the_owner_clocks_after_the_potion_counts() {
    for (h, s) in [
        (None, None),
        (Some(15_050.), None),
        (None, Some(17_000.)),
        (Some(15_050.), Some(17_000.)),
        (Some(0.), Some(f64::MAX)),
    ] {
        let msg = inv_state(inv(h, s));
        let bytes = msg.try_encode().expect("a legal inventory");
        assert_eq!(bytes, inv_frame(h, s), "layout for {h:?} {s:?}");
        assert_eq!(ServerMsg::decode(&bytes), Ok(msg), "round trip {h:?} {s:?}");
    }
}

#[test]
fn key_1_refuses_a_non_finite_or_negative_clock() {
    for bad in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        -50.,
        -f64::MIN_POSITIVE,
    ] {
        for (h, s) in [(Some(bad), None), (None, Some(bad)), (Some(1.), Some(bad))] {
            assert_eq!(
                inv_state(inv(h, s)).try_encode(),
                Err(EncodeError::BadValue("inventory clock")),
                "encoder refuses {h:?} {s:?}, never clamps"
            );
            assert_eq!(
                ServerMsg::decode(&inv_frame(h, s)),
                Err(DecodeError::BadField("inventory clock")),
                "decoder refuses {h:?} {s:?}"
            );
        }
    }
}

#[test]
fn key_1_without_its_clocks_is_truncated() {
    // The layout before this packet (no clock flags) is not misread as "nothing running".
    assert_eq!(
        ServerMsg::decode(&inv_prefix()),
        Err(DecodeError::Truncated)
    );
    let mut one_flag = inv_prefix();
    one_flag.push(0);
    assert_eq!(ServerMsg::decode(&one_flag), Err(DecodeError::Truncated));
    let mut half = inv_prefix();
    half.push(1);
    half.extend_from_slice(&15_050f64.to_le_bytes()[..4]);
    assert_eq!(ServerMsg::decode(&half), Err(DecodeError::Truncated));
}

#[test]
fn key_9_appends_the_rooms_minimum_players() {
    assert_eq!(MAX_MIN_PLAYERS as usize, MAX_ROSTER, "the roster bound");
    assert_eq!(MAX_MIN_PLAYERS, 32);
    for min in [0u8, 1, 2, 8, MAX_MIN_PLAYERS] {
        let msg = arena_state(arena(min));
        let bytes = msg.try_encode().expect("a legal arena view");
        let mut want = arena_prefix();
        want.push(min);
        assert_eq!(bytes, want, "layout for min {min}");
        assert_eq!(ServerMsg::decode(&bytes), Ok(msg), "round trip {min}");
    }
    for over in [MAX_MIN_PLAYERS + 1, u8::MAX] {
        assert_eq!(
            arena_state(arena(over)).try_encode(),
            Err(EncodeError::BadValue("arena")),
            "encoder refuses {over}"
        );
        let mut bytes = arena_prefix();
        bytes.push(over);
        assert_eq!(
            ServerMsg::decode(&bytes),
            Err(DecodeError::BadField("arena")),
            "decoder refuses {over}"
        );
    }
    assert_eq!(
        ServerMsg::decode(&arena_prefix()),
        Err(DecodeError::Truncated),
        "the layout before this packet is refused, not read as minimum 0"
    );
}

fn server(name: &str) -> ServerMsg {
    server_samples()
        .into_iter()
        .find_map(|(n, m)| (n == name).then_some(m))
        .unwrap_or_else(|| panic!("server vector {name} (brief, Vector names)"))
}

fn inventory_of(msg: &ServerMsg) -> Option<WireInventory> {
    let ServerMsg::State { items, .. } = msg else {
        panic!("not a state frame")
    };
    items.iter().find_map(|i| match i {
        StateItem::Inventory(v) => *v,
        _ => None,
    })
}

fn arena_of(msg: &ServerMsg) -> Option<WireArena> {
    let ServerMsg::State { items, .. } = msg else {
        panic!("not a state frame")
    };
    items.iter().find_map(|i| match i {
        StateItem::Arena(v) => *v,
        _ => None,
    })
}

#[test]
fn the_new_server_vectors_carry_the_clocks() {
    let both = WireInventory {
        active_slot: 1,
        slots: [Some(0), Some(2)],
        potion_small: 3,
        potion_large: 1,
        potions_healing: 2,
        healing_until: Some(15_050.),
        speed_boost_until: Some(17_000.),
    };
    assert_eq!(
        server("state_inventory_clocks"),
        ServerMsg::State {
            tick: 216,
            items: vec![StateItem::Inventory(Some(both))],
        }
    );
    assert_eq!(
        server("state_inventory_speed_boost"),
        ServerMsg::State {
            tick: 216,
            items: vec![StateItem::Inventory(Some(WireInventory {
                potions_healing: 0,
                healing_until: None,
                ..both
            }))],
        }
    );
}

#[test]
fn the_existing_vectors_take_the_new_fields() {
    let all = inventory_of(&server("state_all")).expect("state_all inventory");
    assert_eq!(
        (all.healing_until, all.speed_boost_until),
        (None, None),
        "state_all: nothing running"
    );
    assert_eq!(
        arena_of(&server("state_planning"))
            .expect("state_planning arena")
            .min_players,
        2,
        "state_planning: legacy MIN_PLAYERS_TO_START (shared/src/constants.ts:130)"
    );
    let max = server("state_all_max_budget");
    let inv = inventory_of(&max).expect("max inventory");
    assert_eq!(
        (inv.healing_until, inv.speed_boost_until),
        (Some(f64::MAX), Some(f64::MAX))
    );
    assert_eq!(
        arena_of(&max).expect("max arena").min_players,
        MAX_MIN_PLAYERS
    );
    assert_eq!(
        max.try_encode().expect("encodes").len(),
        247_696,
        "the prop-label padding absorbs the new bytes"
    );
}

/// Malformed vectors, byte for byte. Inventory base = `88 00 01 01 01` + slot 0, two empty slots, zero potions (as
/// `state_bad_potion_count`); arena base = `88 00 01 09 01` + four zero f64 timers around `00 00 00` + started_with 0.
fn inv_base() -> Vec<u8> {
    vec![0x88, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0]
}

fn arena_base() -> Vec<u8> {
    let mut b = vec![0x88, 0, 1, 9, 1];
    b.extend_from_slice(&[0; 24]);
    b.extend_from_slice(&[0, 0, 0]);
    b.extend_from_slice(&[0; 8]);
    b.push(0);
    b
}

fn with(mut base: Vec<u8>, tail: &[u8]) -> Vec<u8> {
    base.extend_from_slice(tail);
    base
}

fn f(v: f64) -> Vec<u8> {
    v.to_le_bytes().to_vec()
}

#[test]
fn the_refusal_vectors_are_committed_with_their_reasons() {
    let committed = malformed_server();
    let find = |name: &str| {
        committed
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, b)| b.clone())
            .unwrap_or_else(|| panic!("malformed vector {name} (brief, Vector names)"))
    };
    let cases: Vec<(&str, Vec<u8>, DecodeError)> = vec![
        (
            "state_inventory_healing_nan",
            with(inv_base(), &[[1].as_slice(), &f(f64::NAN), &[0]].concat()),
            DecodeError::BadField("inventory clock"),
        ),
        (
            "state_inventory_healing_negative",
            with(inv_base(), &[[1].as_slice(), &f(-50.), &[0]].concat()),
            DecodeError::BadField("inventory clock"),
        ),
        (
            "state_inventory_boost_infinite",
            with(inv_base(), &[[0, 1].as_slice(), &f(f64::INFINITY)].concat()),
            DecodeError::BadField("inventory clock"),
        ),
        (
            "state_inventory_clock_truncated",
            with(inv_base(), &[[1].as_slice(), &f(1.)[..4]].concat()),
            DecodeError::Truncated,
        ),
        (
            "state_arena_min_players_over",
            with(arena_base(), &[MAX_MIN_PLAYERS + 1]),
            DecodeError::BadField("arena"),
        ),
        (
            "state_arena_min_players_missing",
            arena_base(),
            DecodeError::Truncated,
        ),
    ];
    for (name, bytes, why) in cases {
        assert_eq!(find(name), bytes, "{name} bytes");
        assert_eq!(ServerMsg::decode(&bytes), Err(why), "{name} reason");
    }
}
