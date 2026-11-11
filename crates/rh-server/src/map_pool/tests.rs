use super::*;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::thread;
use std::time::Instant;

const FIRST_PLAYABLE: &[u8] = include_bytes!("../../../../maps/first-playable.json");

fn small() -> Arena {
    crate::runtime::source_map(FIRST_PLAYABLE).unwrap()
}

fn configured() -> MapAssets {
    MapAssets::new(small()).unwrap()
}

/// Test generator: answers each call with whatever `answer` returns for the call's number (0, 1, ...).
struct Fake<F> {
    calls: AtomicU32,
    answer: F,
}

impl<F: Fn(u32) -> Result<Option<Arena>, String> + Send + Sync + 'static> MapMaker for Fake<F> {
    fn make(&self, _seed: u32) -> Result<Option<Arena>, String> {
        let n = self.calls.fetch_add(1, Ordering::SeqCst);
        (self.answer)(n)
    }
}

fn fake<F: Fn(u32) -> Result<Option<Arena>, String> + Send + Sync + 'static>(
    answer: F,
) -> Arc<Fake<F>> {
    Arc::new(Fake {
        calls: AtomicU32::new(0),
        answer,
    })
}

fn opts(target: usize, refill_at: usize) -> MapPoolOptions {
    MapPoolOptions {
        target,
        refill_at,
        restart: Duration::from_millis(10),
        restart_max: Duration::from_millis(40),
        hang: Duration::from_millis(100),
    }
}

fn pool(maker: Arc<dyn MapMaker>, o: MapPoolOptions) -> MapPool {
    let next = AtomicU32::new(1);
    MapPool::with(
        configured(),
        maker,
        Box::new(move || next.fetch_add(1, Ordering::SeqCst)),
        o,
    )
}

/// Polls until `ok` holds, failing after twenty seconds.
fn eventually(what: &str, ok: impl Fn() -> bool) {
    let t0 = Instant::now();
    while !ok() {
        assert!(t0.elapsed() < Duration::from_secs(20), "timed out: {what}");
        thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn the_worker_fills_the_queue_and_refills_it_after_takes() {
    let maker = fake(|_| Ok(Some(small())));
    let p = pool(maker.clone(), opts(3, 1));
    eventually("full queue", || p.size() == 3);
    for _ in 0..3 {
        p.take();
    }
    let s = p.stats();
    assert_eq!((s.served, s.fallbacks, s.configured), (3, 0, 0));
    eventually("refilled", || p.size() == 3);
    assert_eq!(maker.calls.load(Ordering::SeqCst), 6);
}

#[test]
fn an_empty_queue_certifies_on_the_caller() {
    let p = pool(fake(|_| Ok(Some(small()))), opts(0, 0));
    let map = p.take();
    assert_eq!(map.arena.spawns.len(), small().spawns.len());
    let s = p.stats();
    assert_eq!((s.served, s.fallbacks, s.configured), (0, 1, 0));
}

#[test]
fn every_fallback_seed_failing_serves_the_configured_map() {
    let maker = fake(|n| {
        if n % 2 == 0 {
            Ok(None)
        } else {
            Err("boom".into())
        }
    });
    let p = pool(maker.clone(), opts(0, 0));
    let map = p.take();
    assert!(Arc::ptr_eq(&map.arena, &p.shared.configured.arena));
    let s = p.stats();
    assert_eq!((s.fallbacks, s.configured, s.discards), (0, 1, 8));
    assert_eq!(
        maker.calls.load(Ordering::SeqCst),
        MAP_FALLBACK_SEEDS as u32
    );
}

#[test]
fn a_panicking_fallback_seed_is_a_discard_not_a_failed_room() {
    let maker = fake(|n| {
        if n == 0 {
            panic!("styler bug");
        }
        Ok(Some(small()))
    });
    let p = pool(maker, opts(0, 0));
    p.take();
    let s = p.stats();
    assert_eq!((s.fallbacks, s.configured, s.discards), (1, 0, 1));
}

#[test]
fn a_generator_error_replaces_the_worker_and_the_pool_recovers() {
    let p = pool(
        fake(|n| {
            if n == 0 {
                Err("generator bug".into())
            } else {
                Ok(Some(small()))
            }
        }),
        opts(2, 1),
    );
    eventually("recovered", || p.size() == 2);
    assert_eq!(p.stats().crashes, 1);
}

#[test]
fn a_panicking_worker_is_replaced() {
    let p = pool(
        fake(|n| {
            if n == 0 {
                panic!("worker bug");
            }
            Ok(Some(small()))
        }),
        opts(2, 1),
    );
    eventually("recovered", || p.size() == 2);
    assert!(p.stats().crashes >= 1);
}

#[test]
fn a_hung_worker_is_abandoned_and_replaced() {
    let release = Arc::new(AtomicBool::new(false));
    let hold = release.clone();
    let p = pool(
        fake(move |n| {
            if n == 0 {
                // The first map never comes back while the test watches.
                while !hold.load(Ordering::SeqCst) {
                    thread::sleep(Duration::from_millis(5));
                }
            }
            Ok(Some(small()))
        }),
        opts(2, 1),
    );
    eventually("recovered", || p.size() == 2);
    let s = p.stats();
    assert_eq!((s.hangs, s.crashes), (1, 1));
    release.store(true, Ordering::SeqCst);
}

#[test]
fn maps_that_fail_admission_are_never_served_and_three_in_a_row_replace_the_worker() {
    let p = pool(
        fake(|n| {
            let mut a = small();
            if n < MAP_REJECT_LIMIT {
                a.spawns.truncate(2);
            }
            Ok(Some(a))
        }),
        opts(1, 0),
    );
    eventually("recovered", || p.size() == 1);
    let s = p.stats();
    assert_eq!(s.rejected, u64::from(MAP_REJECT_LIMIT));
    assert_eq!(s.crashes, 1);
    assert!(p.take().arena.spawns.len() >= rh_sim::constants::MAX_PLAYERS);
}

#[test]
fn the_restart_delay_doubles_and_is_capped() {
    let t0 = Instant::now();
    let p = pool(fake(|_| Err("always".into())), opts(1, 0));
    eventually("several failures", || p.stats().crashes >= 4);
    thread::sleep(Duration::from_millis(400));
    // Delays of 10, 20, then 40 ms each: at most one failure per 40 ms once capped, never a spin.
    let bound = t0.elapsed().as_millis() as u64 / 40 + 4;
    assert!(p.stats().crashes <= bound, "{:?} > {bound}", p.stats());
}

/// The loose proof that a pooled map is a real playable map: the real generator certifies two seeds, both pass admission,
/// they differ, and the source-arena profile builds a match on one and steps it.
#[test]
fn the_real_generator_serves_distinct_playable_maps() {
    let a = StyledMaker.make(1).unwrap().expect("seed 1 certifies");
    let b = StyledMaker.make(2).unwrap().expect("seed 2 certifies");
    assert_ne!(a.map.layers(), b.map.layers());
    let a = admit(a).unwrap();
    admit(b).unwrap();
    assert!(crate::public_ground::matches_static_map(
        &a.welcome_map,
        &a.arena.map
    ));
    let args: Vec<String> = "--runtime source-arena --map pooled"
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    let settings = crate::runtime::Settings::from_args(&args).unwrap().unwrap();
    let mut sim = rh_sim::Sim::new(
        settings.sim(),
        a.arena.clone(),
        rh_sim::Secrets {
            order_salt: 1,
            spawn_seed: 2,
            reward_salt: [3, 4, 5, 6],
        },
    );
    for _ in 0..100 {
        sim.step();
    }
}
