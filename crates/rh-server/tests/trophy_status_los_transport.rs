use rh_protocol::{
    RewardChestHandle as WireRewardChestHandle, ServerMsg, StateItem, WireCommand, WireRewardChest,
    WireRewardId,
};
use rh_server::{
    wire::{command as wire_command, Publisher},
    wire_state::CollectionPublisher,
};
use rh_sim::{FactionId, ItemObserver, Observation, PlayerId, Secrets, Sim, SimConfig, Vec2};

#[path = "support/trophy_fixture.rs"]
mod trophy_fixture;

const OWNER: PlayerId = PlayerId(1);
const FROST: PlayerId = PlayerId(3);

#[derive(Clone, Copy)]
struct TrophyFact {
    id: u32,
    at: Vec2,
    held_until_tick: u32,
    expires_at: f64,
}

fn source_trophy(sim: &Sim) -> TrophyFact {
    let state = serde_json::to_value(sim).unwrap();
    let row = state["world"]["reward_chests"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["owner"].as_u64() == Some(u64::from(OWNER.0)))
        .expect("the actual credited kill leaves one owner Trophy");
    TrophyFact {
        id: row["id"].as_u64().unwrap() as u32,
        at: serde_json::from_value(row["at"].clone()).unwrap(),
        held_until_tick: row["held_until_tick"].as_u64().unwrap() as u32,
        expires_at: row["expires_at"].as_f64().unwrap(),
    }
}

fn advance_to_trophy_ready(sim: &mut Sim, fact: TrophyFact, last: &mut Vec<rh_sim::Event>) {
    while sim.tick() <= fact.held_until_tick {
        *last = sim.step();
    }
    assert!(sim.tick() > fact.held_until_tick);
    assert!(
        sim.server_time() < fact.expires_at,
        "source Trophy has not expired"
    );
}

fn deliver_owner_trophy(
    sim: &Sim,
    observer: &mut ItemObserver,
    last_step: &[rh_sim::Event],
) -> WireRewardChest {
    let mut publisher = Publisher::default();
    let mut collections = CollectionPublisher::default();
    let (frames, offer) = publisher
        .frames_prepared(
            observer,
            None,
            sim,
            0,
            last_step,
            &mut Vec::new(),
            last_step,
        )
        .unwrap();
    assert!(frames.snapshot.is_ok() && frames.refused.is_none());
    let pending = collections
        .prepare(
            publisher.observation(),
            offer.props_changed(),
            offer.rewards_changed(),
            false,
        )
        .unwrap();
    let frame = pending
        .frame
        .as_deref()
        .expect("full reliable state is due");
    let ServerMsg::State { items, .. } = ServerMsg::decode(frame).unwrap() else {
        panic!("reliable reward state must decode as State");
    };
    let row = items
        .into_iter()
        .find_map(|item| match item {
            StateItem::RewardChests(rows) => rows.into_iter().find(|row| {
                row.options
                    .iter()
                    .any(|o| matches!(o.id, WireRewardId::Kill { .. }))
            }),
            _ => None,
        })
        .expect("the actual owner row carries the complete Trophy");
    pending.commit(&mut collections);
    offer.commit();
    assert!(row.can_choose);
    row
}

fn wire_choose(
    sim: &mut Sim,
    observer: &ItemObserver,
    handle: WireRewardChestHandle,
    pick: i8,
) -> Vec<rh_sim::Event> {
    let public = wire_command(WireCommand::Choose { handle, pick });
    let command = observer
        .resolve(sim, public)
        .expect("observer resolves delivered handle");
    sim.submit(OWNER, command).unwrap();
    sim.step()
}

fn trophy_pick(row: &WireRewardChest) -> i8 {
    row.options
        .iter()
        .position(|option| matches!(option.id, WireRewardId::Kill { .. }))
        .expect("real Trophy option") as i8
}

fn remaining_source_trophy(sim: &Sim, chest_id: u32) -> serde_json::Value {
    let state = serde_json::to_value(sim).unwrap();
    state["world"]["reward_chests"]
        .as_array()
        .unwrap()
        .iter()
        .find(|chest| chest["id"].as_u64() == Some(u64::from(chest_id)))
        .expect("refused Choose leaves source Trophy in the world")
        .clone()
}

fn owner_at_source_chest_arena() -> rh_sim::Arena {
    let mut export: rh_sim::mapdata::MapExport =
        serde_json::from_slice(include_bytes!("../../../maps/first-playable.json")).unwrap();
    let base = export.clone().validate().unwrap().into_arena().unwrap();
    let config = SimConfig {
        initial_loot: true,
        consumables: false,
        quests: false,
        regen: false,
        ..SimConfig::default()
    };
    let specimen = Sim::new(config, base, Secrets::from_seed(7));
    let source = serde_json::to_value(specimen).unwrap();
    let chest_at: Vec2 = serde_json::from_value(
        source["world"]["containers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|chest| chest["stat_offer"] == true)
            .expect("same real source stat chest as the kill fixture")["at"]
            .clone(),
    )
    .unwrap();
    // The credited killer starts 32u west of this source chest. Put one static sight wall one
    // tile north of that legal position. A later ordinary path to two tiles north stays within
    // the actual Trophy range while its direct ray crosses this wall.
    let origin = Vec2::new(chest_at.x - 32.0, chest_at.y);
    let tile = rh_sim::constants::TILE;
    let (tx, ty) = (
        (origin.x / tile).floor() as usize,
        (origin.y / tile).floor() as usize + 1,
    );
    assert!(tx < export.map.w as usize && ty < export.map.h as usize);
    let index = ty * export.map.w as usize + tx;
    assert_eq!(
        export.map.tiles[index],
        rh_sim::map::TILE_FLOOR,
        "wall cell must be open"
    );
    let territory = export.map.territory_grid[index];
    if territory > 0 {
        export.map.camps[territory as usize - 1].area -= 1;
    }
    export.map.tiles[index] = rh_sim::map::TILE_WALL;
    export.validate().unwrap().into_arena().unwrap()
}

#[test]
fn real_trophy_choose_while_frozen_refuses_busy_without_grant() {
    let config = SimConfig {
        abilities: rh_sim::abilities::Mode::Full,
        ..SimConfig::default()
    };
    // Seat 3 has a genuine Frost Wish. The fixture warms 900 normal 20 Hz ticks before the kill,
    // so this uses the ordinary 45s stock lock rather than an injected or shortened clock.
    let (mut sim, mut last_step) = trophy_fixture::four_seat_validated_pvp_kill_with(
        config,
        [
            FactionId::Fire,
            FactionId::Fire,
            FactionId::Frost,
            FactionId::Fire,
        ],
        None,
        900,
    );
    let fact = source_trophy(&sim);
    advance_to_trophy_ready(&mut sim, fact, &mut last_step);
    assert_eq!(sim.player(OWNER).unwrap().status, rh_sim::Status::Alive);
    assert_eq!(sim.player(FROST).unwrap().status, rh_sim::Status::Alive);
    assert_eq!(
        sim.player(PlayerId(4)).unwrap().status,
        rh_sim::Status::Alive
    );
    assert!(sim.server_time() >= rh_sim::abilities::WISH_LOCK_MS);
    assert!(
        sim.player(FROST).unwrap().stocks.wish_ready_at <= sim.server_time(),
        "Frost stock is ready by its ordinary clock before the kill"
    );

    let before = sim.player(OWNER).unwrap().kill_stats;
    let mut owner_observer = ItemObserver::new(OWNER);
    let row = deliver_owner_trophy(&sim, &mut owner_observer, &last_step);
    let pick = trophy_pick(&row);

    let owner_at = sim.player(OWNER).unwrap().pos();
    let mut frost_observer = ItemObserver::new(FROST);
    let mut frost_view = Observation::default();
    frost_observer
        .observe_into(&sim, &[], &mut frost_view, None)
        .unwrap();
    assert!(frost_view.visible.iter().any(|actor| actor.id == OWNER));
    let cast = wire_command(WireCommand::Cast {
        slot: 0,
        x: owner_at.x as f32,
        y: owner_at.y as f32,
        actor: Some(OWNER.0),
        t: None,
        seq: None,
    });
    let cast = frost_observer.resolve(&sim, cast).unwrap();
    sim.submit(FROST, cast).unwrap();
    for _ in 0..10 {
        sim.step();
        let target = sim.player(OWNER).unwrap();
        if rh_sim::status_runtime::action_blocked(&target.statuses, sim.server_time()) {
            break;
        }
    }
    let target = sim.player(OWNER).unwrap();
    assert!(rh_sim::status_runtime::action_blocked(
        &target.statuses,
        sim.server_time()
    ));
    assert!(rh_sim::status_runtime::has(
        &target.statuses.instances,
        rh_sim::status_runtime::StatusKind::Stun,
        sim.server_time()
    ));
    assert!(sim.player(FROST).unwrap().statuses.cast.is_none());

    let events = wire_choose(&mut sim, &owner_observer, row.handle, pick);
    assert!(
        events.iter().any(|event| matches!(
            event,
            rh_sim::Event::ChestRefused {
                id: OWNER,
                reason: rh_sim::reward_chests::Refusal::Busy
            }
        )),
        "Frozen owner receives native Busy refusal: {events:?}"
    );
    assert!(!events.iter().any(|event| matches!(
        event,
        rh_sim::Event::ChestTaken { chest, by: OWNER, .. } if *chest == fact.id
    )));
    assert_eq!(sim.player(OWNER).unwrap().kill_stats, before);
    assert!(remaining_source_trophy(&sim, fact.id)["taken"]
        .as_array()
        .unwrap()
        .iter()
        .all(serde_json::Value::is_null));
}

#[test]
fn real_trophy_choose_behind_static_sight_wall_refuses_blocked_without_grant() {
    let arena = owner_at_source_chest_arena();
    let (mut sim, mut last_step) = trophy_fixture::four_seat_validated_pvp_kill_with(
        SimConfig::default(),
        [FactionId::Fire; 4],
        Some(arena),
        0,
    );
    let fact = source_trophy(&sim);
    advance_to_trophy_ready(&mut sim, fact, &mut last_step);
    let before = sim.player(OWNER).unwrap().kill_stats;
    let mut observer = ItemObserver::new(OWNER);
    let row = deliver_owner_trophy(&sim, &mut observer, &last_step);
    let pick = trophy_pick(&row);
    let destination = Vec2::new(fact.at.x, fact.at.y + 64.0);
    assert!(
        rh_sim::math::hypot(destination.x - fact.at.x, destination.y - fact.at.y)
            <= rh_sim::reward_chests::DEFINITION.range,
        "the blocked-control remains within source chest range"
    );

    let move_command = wire_command(WireCommand::Move {
        x: destination.x as f32,
        y: destination.y as f32,
        seq: Some(1),
    });
    let move_command = observer.resolve(&sim, move_command).unwrap();
    sim.submit(OWNER, move_command).unwrap();
    let mut reached = false;
    for _ in 0..120 {
        sim.step();
        let pos = sim.player(OWNER).unwrap().pos();
        if rh_sim::math::hypot(pos.x - destination.x, pos.y - destination.y) <= 4.0 {
            reached = true;
            break;
        }
    }
    assert!(
        reached,
        "owner traverses the declared arena path behind the wall"
    );
    let owner_at = sim.player(OWNER).unwrap().pos();
    let distance = rh_sim::math::hypot(owner_at.x - fact.at.x, owner_at.y - fact.at.y);
    assert!(distance <= rh_sim::reward_chests::DEFINITION.range);
    assert!(
        !rh_sim::geometry::has_line_of_sight(
            sim.collision_map(),
            owner_at,
            fact.at,
            rh_sim::constants::MASK_SIGHT,
        ),
        "real admitted arena wall blocks the Trophy ray"
    );

    let events = wire_choose(&mut sim, &observer, row.handle, pick);
    assert!(
        events.iter().any(|event| matches!(
            event,
            rh_sim::Event::ChestRefused {
                id: OWNER,
                reason: rh_sim::reward_chests::Refusal::Blocked
            }
        )),
        "within-range owner receives native Blocked refusal: {events:?}"
    );
    assert!(!events.iter().any(|event| matches!(
        event,
        rh_sim::Event::ChestTaken { chest, by: OWNER, .. } if *chest == fact.id
    )));
    assert_eq!(sim.player(OWNER).unwrap().kill_stats, before);
    assert!(remaining_source_trophy(&sim, fact.id)["taken"]
        .as_array()
        .unwrap()
        .iter()
        .all(serde_json::Value::is_null));
}
