//! The wire cost of a Snapshot with many remote actors against protocol v1's fixed layout (a v1 Snapshot was
//! 18 + (1 or 37 for the self) + 2 + 22 bytes per actor). Deterministic byte counts, no timing.
use rh_protocol::*;

fn v1_len(me: bool, actors: usize) -> usize {
    18 + if me { 37 } else { 1 } + 2 + 22 * actors
}

/// `n` remote actors with the field mix the 8-bot slice shows: a faction on 4 of 5, damaged, alive or dead, a weapon, no
/// bounty; ids ascend with gaps of 2 (a mob-style id space); positions spread over the 5120 u world.
fn slice_actors(n: u32, tick: u32) -> Vec<WireActor> {
    (0..n)
        .map(|k| WireActor {
            id: 1000 + k * 2,
            faction: (k % 5) as u8,
            x: (k * 25 + tick) as f32 % 5120.0,
            y: (k * 17 + tick * 3) as f32 % 5120.0,
            facing: -3.0 + 0.03 * ((k + tick) % 200) as f32,
            hp_pct: ((k + tick) % 100) as u8,
            status: 1 + (k % 2) as u8,
            weapon: 1 + (k % 5) as u8,
            bounty: 0,
        })
        .collect()
}

fn snapshot(n: u32, tick: u32) -> ServerMsg {
    ServerMsg::Snapshot {
        tick,
        phase: 1,
        ack_input: tick * 2,
        me: Some(WireSelf {
            id: 3,
            faction: 2,
            x: 400.0,
            y: 320.5,
            facing: 1.5,
            hp: 1000.25,
            max_hp: 1145.0,
            status: 1,
            weapon: 5,
            ready_in_ms: 250,
            kills: 2,
            bounty: 0,
            gv: 0,
            move_seq: 7,
        }),
        actors: slice_actors(n, tick),
    }
}

#[test]
fn v2_costs_at_most_half_of_v1_with_204_remote_actors() {
    let (mut v1, mut v2) = (0usize, 0usize);
    for tick in 2000..2064 {
        let m = snapshot(204, tick);
        v1 += v1_len(true, 204);
        v2 += m.encode().len();
    }
    let ratio = v2 as f64 / v1 as f64;
    assert!(ratio <= 0.5, "v2 {v2} B vs v1 {v1} B = {ratio:.3}");
    // Per actor: the empty-actor frame is the fixed part.
    let fixed = snapshot(0, 2000).encode().len();
    let per_actor = (snapshot(204, 2000).encode().len() - fixed) as f64 / 204.0;
    assert!(per_actor <= 10.1, "{per_actor} B per actor (v1: 22)");
}

#[test]
fn the_most_the_wire_allows_still_decodes_and_every_actor_is_at_least_8_bytes() {
    let m = snapshot(MAX_ACTORS as u32, 5);
    let b = m.encode();
    assert!(b.len() <= MAX_SERVER_FRAME);
    let ServerMsg::Snapshot { actors, .. } = ServerMsg::decode(&b).unwrap() else {
        panic!("a snapshot")
    };
    assert_eq!(actors.len(), MAX_ACTORS);
    let fixed = snapshot(0, 5).encode().len();
    assert!((b.len() - fixed) >= 8 * MAX_ACTORS);
}
