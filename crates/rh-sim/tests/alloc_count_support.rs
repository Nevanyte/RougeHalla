//! P-TEST-HARDEN-1: the shared allocation counter counts the measuring thread only. Other threads allocate
//! continuously while a section is measured; the section's own count must not move. This is the mechanism that makes
//! `terrain_no_alloc` fail rarely under load when it counts process-wide (dhat's `total_blocks`).
use rh_sim::{terrain::Mode, Arena, FactionId, Placement, Secrets, Sim, SimConfig, Vec2};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[path = "support/alloc_count.rs"]
mod alloc_count;

#[global_allocator]
static ALLOC: alloc_count::CountingAlloc = alloc_count::CountingAlloc;

/// Four threads that allocate and free as fast as they can until dropped.
struct Noise {
    stop: Arc<AtomicBool>,
    threads: Vec<std::thread::JoinHandle<()>>,
}

impl Noise {
    fn start() -> Noise {
        let stop = Arc::new(AtomicBool::new(false));
        let threads = (0..4)
            .map(|_| {
                let stop = stop.clone();
                std::thread::spawn(move || {
                    while !stop.load(Ordering::Relaxed) {
                        let v: Vec<u64> = Vec::with_capacity(16);
                        std::hint::black_box(&v);
                    }
                })
            })
            .collect();
        Noise { stop, threads }
    }
}

impl Drop for Noise {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        for t in self.threads.drain(..) {
            t.join().unwrap();
        }
    }
}

#[test]
fn a_section_that_allocates_nothing_counts_zero_while_other_threads_allocate() {
    let mut warm = vec![0u64; 1024];
    let _noise = Noise::start();
    // Let the noise threads get going before the window opens.
    std::thread::sleep(std::time::Duration::from_millis(50));
    let ((), blocks) = alloc_count::blocks_on_this_thread(|| {
        for round in 0..2000u64 {
            for (i, w) in warm.iter_mut().enumerate() {
                *w = w.wrapping_add(round ^ i as u64);
            }
            std::thread::yield_now();
        }
    });
    assert_eq!(blocks, 0, "only this thread's blocks are counted");
    std::hint::black_box(&warm);
}

#[test]
fn a_section_counts_exactly_its_own_blocks_while_other_threads_allocate() {
    let _noise = Noise::start();
    std::thread::sleep(std::time::Duration::from_millis(50));
    let (kept, blocks) = alloc_count::blocks_on_this_thread(|| {
        let a = Box::new([1u64; 8]);
        let b: Vec<u32> = Vec::with_capacity(10);
        let c = vec![0u8; 100];
        std::thread::yield_now();
        (a, b, c)
    });
    assert_eq!(blocks, 3, "three sized allocations, nothing else");
    std::hint::black_box(&kept);
    // Growing a vector past its capacity is a realloc: one block per call.
    let (v, blocks) = alloc_count::blocks_on_this_thread(|| {
        let mut v: Vec<u64> = Vec::with_capacity(1);
        v.push(1);
        v.push(2);
        v
    });
    assert_eq!(blocks, 2, "alloc plus one realloc");
    drop(v);
}

#[test]
fn blocks_requested_by_a_thread_the_section_spawns_are_not_counted() {
    fn spawn_and_join(child_vecs: usize) -> u64 {
        let ((), blocks) = alloc_count::blocks_on_this_thread(|| {
            let h = std::thread::spawn(move || {
                for _ in 0..child_vecs {
                    std::hint::black_box(vec![7u64; 64]);
                }
            });
            h.join().unwrap();
        });
        blocks
    }
    spawn_and_join(0); // first-use statics of std's spawn path
    let idle_child = spawn_and_join(0);
    let busy_child = spawn_and_join(100);
    assert_eq!(
        busy_child, idle_child,
        "the child's 100 vecs belong to the child's thread"
    );
}

/// The measured section of `terrain_no_alloc::warmed_terrain_passes_allocate_nothing` (one terrain kind), counted through
/// the helper while other threads allocate. It allocates nothing on its own thread.
#[test]
fn the_warmed_terrain_section_counts_zero_while_other_threads_allocate() {
    let export: rh_sim::mapdata::MapExport =
        serde_json::from_str(include_str!("../src/mapdata/fixtures/seed1.map.json")).unwrap();
    let arena: Arc<Arena> = export.validate().unwrap().into_arena().unwrap().into();
    let kind = 4;
    let i = arena
        .map
        .layers()
        .unwrap()
        .data()
        .terrain
        .iter()
        .position(|k| *k == kind)
        .unwrap();
    let at = Vec2::new(
        (i % arena.map.w as usize) as f64 * 32. + 16.,
        (i / arena.map.w as usize) as f64 * 32. + 16.,
    );
    let ps = (0..3)
        .map(|i| Placement {
            profile: format!("p{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: if i == 0 { at } else { arena.spawns[i] },
            hp: Some(500.),
            weapon0: None,
            weapon1: None,
        })
        .collect::<Vec<_>>();
    let mut sim = Sim::reset_active(
        SimConfig {
            quests: false,
            consumables: true,
            lifecycle: rh_sim::ArenaMode::Off,
            hazards: Mode::All,
            ..Default::default()
        },
        arena.clone(),
        Secrets::from_seed(4),
        &ps,
    );
    let mut events = vec![];
    for _ in 0..40 {
        events.clear();
        sim.step_into(&mut events);
        #[cfg(feature = "schedule-trace")]
        sim.clear_schedule_trace();
    }
    let _noise = Noise::start();
    std::thread::sleep(std::time::Duration::from_millis(50));
    let ((), blocks) = alloc_count::blocks_on_this_thread(|| {
        for _ in 0..120 {
            events.clear();
            sim.step_into(&mut events);
            #[cfg(feature = "schedule-trace")]
            sim.clear_schedule_trace();
        }
    });
    assert_eq!(blocks, 0, "terrain kind {kind}");
}
