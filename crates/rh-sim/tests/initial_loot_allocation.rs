//! Focused active-Hot tick allocation check, after input/construction allocations are warmed.
use rh_sim::{
    Arena, FactionId, ItemObserver, Observation, Placement, PlayerId, PublicCommand, Secrets, Sim,
    SimConfig, Vec2,
};
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;
#[test]
fn active_potion_payments_do_not_allocate_in_the_steady_tick() {
    let data: rh_sim::mapdata::GameMapData =
        serde_json::from_str(include_str!("../../../parity/initial-loot/input-map.json")).unwrap();
    let hash = u32::from_str_radix(&rh_sim::mapgen::map_hash::map_hash(&data), 16).unwrap();
    let v = rh_sim::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: hash,
        map: data,
    }
    .validate()
    .unwrap();
    let (w, h, t, l) = v.into_parts();
    let arena = Arena {
        map: rh_sim::TileMap::new(w, h, t)
            .unwrap()
            .with_layers(std::sync::Arc::new(l))
            .unwrap(),
        spawns: Vec::new(),
    };
    let placements = [
        Placement {
            profile: "p0".into(),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(112., 112.),
            hp: Some(350.),
            weapon0: None,
            weapon1: None,
        },
        Placement {
            profile: "p1".into(),
            faction: FactionId::Sentenced,
            bot: false,
            at: Vec2::new(624., 112.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
    ];
    let mut s = Sim::reset_active(
        SimConfig {
            quests: false,
            consumables: true,
            initial_loot: true,
            ..Default::default()
        },
        arena,
        Secrets {
            spawn_seed: 12,
            reward_salt: [1, 2, 3, 4],
            ..Secrets::from_seed(1)
        },
        &placements,
    );
    let mut observer = ItemObserver::new(PlayerId(1));
    let mut observation = Observation::default();
    observer
        .observe_into(&s, &[], &mut observation, None)
        .unwrap();
    let handle = observation
        .props
        .iter()
        .find(|p| p.cue.focused)
        .unwrap()
        .handle;
    let command = observer
        .resolve(&s, PublicCommand::Pickup { handle })
        .unwrap();
    s.submit(PlayerId(1), command).unwrap();
    let mut events = Vec::with_capacity(64);
    s.step_into(&mut events);
    let command = observer.resolve(&s, PublicCommand::UseConsumable).unwrap();
    s.submit(PlayerId(1), command).unwrap();
    s.step_into(&mut events);
    for _ in 0..20 {
        // Keep the optional conformance trace to one warmed tick, as in no_alloc.
        // Accumulating an unread trace measures test instrumentation growth.
        #[cfg(feature = "schedule-trace")]
        s.clear_schedule_trace();
        s.step_into(&mut events)
    }
    let hp = s.player(PlayerId(1)).unwrap().vitals.hp;
    let profiler = dhat::Profiler::builder().testing().build();
    for _ in 0..40 {
        #[cfg(feature = "schedule-trace")]
        s.clear_schedule_trace();
        s.step_into(&mut events)
    }
    let stats = dhat::HeapStats::get();
    assert_eq!(
        stats.total_blocks, 0,
        "steady Hot tick allocations: {}",
        stats.total_blocks
    );
    drop(profiler);
    assert!(s.player(PlayerId(1)).unwrap().vitals.hp > hp);
    assert_eq!(s.player(PlayerId(1)).unwrap().potions_healing, 1);
}
