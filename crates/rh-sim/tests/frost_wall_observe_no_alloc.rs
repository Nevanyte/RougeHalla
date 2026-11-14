//! P-FROST-WALL-PUBLIC-1 guard: a warmed observation with a Frost Wall standing allocates nothing, for every seated
//! viewer: the caster, a viewer in sight of the wall, and a viewer behind a rock screen who sees none of it (which,
//! once a standing wall is public, is sent the wall too). P-FROST-WALL-NOWALL-1 made the tile copy reuse the
//! observation's buffer (`status_runtime/observe.rs` `project`) without a test; this pins it. Green today and after.
//! Measured through the live path (a persistent `ItemObserver`, buffer and `SightCache` per seat, as
//! `barrier_observe_no_alloc.rs`): the uncached free `observe_into` takes one block per observation for a viewer who
//! sees another fighter, with or without a wall (20/20/0 on the base, the same before the cast), which is not a wall cost.
use rh_sim::{
    abilities::{Mode, Slot, FROST_WALL_CAST_MS},
    status_runtime::FieldKind,
    Arena, FactionId, FrostWish, ItemObserver, Observation, Placement, RawCommand, Secrets,
    SightCache, Sim, SimConfig, TileMap, Vec2,
};
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;

fn tc(t: u32) -> f64 {
    f64::from(t) * 32. + 16.
}

#[test]
fn warmed_observations_with_a_frost_wall_standing_allocate_no_blocks_for_any_viewer() {
    let _profiler = dhat::Profiler::builder().testing().build();
    let (w, h) = (40u32, 20u32);
    let mut tiles = vec![0u8; (w * h) as usize];
    for y in 0..h {
        for x in 0..w {
            if x == 0 || y == 0 || x == w - 1 || y == h - 1 || (20..=21).contains(&x) {
                tiles[(y * w + x) as usize] = 1;
            }
        }
    }
    let at = [
        (FactionId::Frost, Vec2::new(tc(5), tc(10))),
        (FactionId::Fire, Vec2::new(tc(8), tc(4))),
        (FactionId::Holy, Vec2::new(tc(30), tc(10))),
    ];
    let placements: Vec<Placement> = at
        .iter()
        .enumerate()
        .map(|(i, &(faction, at))| Placement {
            profile: format!("p{i}"),
            faction,
            bot: false,
            at,
            hp: Some(1e9),
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let mut sim = Sim::reset_active(
        SimConfig {
            abilities: Mode::Full,
            wish_lock_ms: 0.,
            frost_wish: FrostWish::Wall,
            quests: false,
            consumables: false,
            ..Default::default()
        },
        Arena {
            map: TileMap::new(w, h, tiles).unwrap(),
            spawns: placements.iter().map(|p| p.at).collect(),
        },
        Secrets::from_seed(11),
        &placements,
    );
    for _ in 0..640 {
        sim.step();
    }
    let caster = sim.players()[0].id;
    let cmd = rh_sim::validate(RawCommand::Cast {
        slot: Slot::Wish,
        x: tc(12),
        y: tc(10),
        id: None,
        t: None,
        seq: None,
    })
    .unwrap();
    sim.submit(caster, cmd).unwrap();
    let end = sim.server_time() + FROST_WALL_CAST_MS + 100.;
    while sim.server_time() < end {
        sim.step();
    }
    assert!(
        rh_sim::public_snapshot(&sim)
            .fields
            .iter()
            .any(|f| f.kind == FieldKind::Wall),
        "the wall stands"
    );
    let viewers: Vec<_> = sim.players().iter().map(|p| p.id).collect();
    // One persistent observer, buffer and sight cache per seat, as the server's rooms and the bot seats hold them.
    let mut seats: Vec<(ItemObserver, Observation, SightCache)> = viewers
        .iter()
        .map(|&v| {
            (
                ItemObserver::new(v),
                Observation::default(),
                SightCache::new(),
            )
        })
        .collect();
    let mut look = |seats: &mut Vec<(ItemObserver, Observation, SightCache)>, i: usize| {
        let (observer, out, cache) = &mut seats[i];
        observer.observe_into(&sim, &[], out, Some(cache)).unwrap();
    };
    for _ in 0..2 {
        for i in 0..seats.len() {
            look(&mut seats, i);
        }
    }
    let walls = |o: &Observation| {
        o.fields
            .iter()
            .filter(|f| f.kind == FieldKind::Wall)
            .count()
    };
    assert_eq!(walls(&seats[0].1), 1, "the caster is sent its wall");
    assert_eq!(
        walls(&seats[1].1),
        1,
        "the viewer in sight is sent the wall"
    );
    let mut used = Vec::new();
    for i in 0..seats.len() {
        let before = dhat::HeapStats::get().total_blocks;
        for _ in 0..20 {
            look(&mut seats, i);
        }
        used.push(dhat::HeapStats::get().total_blocks - before);
    }
    eprintln!(
        "20 warmed observations each with a wall standing, blocks per viewer [caster, in sight, behind the screen \
         (sent {} wall(s))]: {used:?}",
        walls(&seats[2].1)
    );
    assert_eq!(
        used,
        vec![0, 0, 0],
        "a warmed observation with a wall standing allocates nothing, whoever views it"
    );
}
