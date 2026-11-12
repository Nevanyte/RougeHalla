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
    // Legacy `refill`: once the queue (with maps already asked for) is down to `refill_at`, ask up to `target`. Depending
    // on when the supervisor sees the takes, that settles at `refill_at + 1` or `target`, never below.
    eventually("refilled", || p.size() >= 2);
    let calls = maker.calls.load(Ordering::SeqCst);
    assert!((5..=6).contains(&calls), "{calls} maps made");
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
    let a = StyledMaker::default()
        .make(1)
        .unwrap()
        .expect("seed 1 certifies");
    let b = StyledMaker::default()
        .make(2)
        .unwrap()
        .expect("seed 2 certifies");
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

// ---- P-MAP-3-fix: no generation on the caller, a cap on abandoned workers, the served map's identity ----

use std::sync::atomic::AtomicUsize;
use std::thread::ThreadId;

/// A generator that blocks until released. The pool's worker thread blocks for up to three seconds; any other thread
/// (a caller generating inline) for 40 ms, so a pool that still generates on the caller fails an assertion instead of
/// hanging the test.
struct Blocking {
    entered: AtomicU32,
    threads: Mutex<Vec<ThreadId>>,
    release: AtomicBool,
    live: AtomicUsize,
    max_live: AtomicUsize,
}

impl Blocking {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            entered: AtomicU32::new(0),
            threads: Mutex::new(Vec::new()),
            release: AtomicBool::new(false),
            live: AtomicUsize::new(0),
            max_live: AtomicUsize::new(0),
        })
    }
}

impl MapMaker for Blocking {
    fn make(&self, _seed: u32) -> Result<Option<Arena>, String> {
        self.threads.lock().unwrap().push(thread::current().id());
        self.entered.fetch_add(1, Ordering::SeqCst);
        let live = self.live.fetch_add(1, Ordering::SeqCst) + 1;
        self.max_live.fetch_max(live, Ordering::SeqCst);
        let on_worker = thread::current().name() == Some("map-worker");
        let limit = if on_worker {
            Duration::from_secs(3)
        } else {
            Duration::from_millis(40)
        };
        let t0 = Instant::now();
        while !self.release.load(Ordering::SeqCst) && t0.elapsed() < limit {
            thread::sleep(Duration::from_millis(2));
        }
        self.live.fetch_sub(1, Ordering::SeqCst);
        Err("released".into())
    }
}

/// Polls for at most `bound`; true if `ok` held.
fn within(bound: Duration, ok: impl Fn() -> bool) -> bool {
    let t0 = Instant::now();
    while !ok() {
        if t0.elapsed() >= bound {
            return false;
        }
        thread::sleep(Duration::from_millis(2));
    }
    true
}

fn long_hang(target: usize, refill_at: usize) -> MapPoolOptions {
    MapPoolOptions {
        hang: Duration::from_secs(5),
        ..opts(target, refill_at)
    }
}

/// Finding 1: `take` runs under the director lock, so an empty pool must hand out the configured map at once. (A pool
/// with `target` 0 has no worker at all and keeps certifying on the caller; that test-only mode stays.)
#[test]
fn an_empty_pool_serves_the_configured_map_without_generating_on_the_caller() {
    let maker = Blocking::new();
    let p = pool(maker.clone(), long_hang(2, 1));
    assert!(
        within(Duration::from_secs(1), || maker
            .entered
            .load(Ordering::SeqCst)
            >= 1),
        "the worker never started"
    );
    let t0 = Instant::now();
    let map = p.take();
    let took = t0.elapsed();
    maker.release.store(true, Ordering::SeqCst);
    let me = thread::current().id();
    assert!(
        !maker.threads.lock().unwrap().contains(&me),
        "take called the generator on the calling thread"
    );
    assert!(took < Duration::from_millis(30), "take waited {took:?}");
    assert!(Arc::ptr_eq(&map.arena, &p.shared.configured.arena));
    assert_eq!(p.stats().fallbacks, 1);
}

/// Finding 2: a generator that hangs on every call. Hang 50 ms, restart 10..40 ms: the cap is reached in well under a
/// second, and from then on no new worker starts.
#[test]
fn abandoned_workers_are_capped_and_the_pool_degrades_to_the_configured_map() {
    let maker = Blocking::new();
    let o = MapPoolOptions {
        hang: Duration::from_millis(50),
        ..opts(2, 1)
    };
    let p = pool(maker.clone(), o);
    let degraded = within(Duration::from_millis(1500), || p.stats().degraded);
    // Time for any uncapped restarts to show up.
    thread::sleep(Duration::from_millis(300));
    let stats = p.stats();
    let started = maker.entered.load(Ordering::SeqCst);
    let max_live = maker.max_live.load(Ordering::SeqCst);
    let t0 = Instant::now();
    let map = p.take();
    let took = t0.elapsed();
    maker.release.store(true, Ordering::SeqCst);
    assert!(degraded, "never reported degraded: {stats:?}");
    assert_eq!(stats.abandoned, MAP_ABANDONED_CAP as u64, "{stats:?}");
    // The cap counts abandoned threads; one more may be the current worker.
    assert!(
        max_live <= MAP_ABANDONED_CAP + 1,
        "{max_live} generator calls were live at once"
    );
    // One call per worker (the first request of each); a capped pool starts no further worker.
    assert!(
        started as usize <= MAP_ABANDONED_CAP + 1,
        "{started} workers started"
    );
    assert!(took < Duration::from_millis(30), "take waited {took:?}");
    assert!(Arc::ptr_eq(&map.arena, &p.shared.configured.arena));
}

/// Finding 3: the value the director logs. A pooled map names its seed and its map hash.
#[test]
fn a_pooled_map_is_described_by_its_seed_and_hash() {
    struct Recording {
        seeds: Mutex<Vec<u32>>,
        arena: Arena,
    }
    impl MapMaker for Recording {
        fn make(&self, seed: u32) -> Result<Option<Arena>, String> {
            self.seeds.lock().unwrap().push(seed);
            Ok(Some(self.arena.clone()))
        }
    }
    let arena = StyledMaker::default()
        .make(1)
        .unwrap()
        .expect("seed 1 certifies");
    let hash = arena
        .map
        .layers()
        .expect("a certified map has layers")
        .legacy_map_hash_u32();
    let maker = Arc::new(Recording {
        seeds: Mutex::new(Vec::new()),
        arena,
    });
    let p = pool(maker.clone(), opts(2, 1));
    eventually("a queued map", || p.size() >= 1);
    let (map, served) = p.take_served();
    assert!(!Arc::ptr_eq(&map.arena, &p.shared.configured.arena));
    assert!(!served.configured, "{served:?}");
    let seed = served.seed.expect("a pooled map has a seed");
    assert!(maker.seeds.lock().unwrap().contains(&seed));
    assert_eq!(served.hash, Some(hash));
    let line = served.to_string();
    assert!(line.contains(&seed.to_string()), "{line}");
    assert!(line.contains(&format!("{hash:08x}")), "{line}");
    assert!(!line.contains("configured"), "{line}");
}

/// Finding 3, the other half: the configured map says so.
#[test]
fn the_configured_map_is_described_as_configured() {
    let maker = Blocking::new();
    let p = pool(maker.clone(), long_hang(2, 1));
    let (map, served) = p.take_served();
    maker.release.store(true, Ordering::SeqCst);
    assert!(Arc::ptr_eq(&map.arena, &p.shared.configured.arena));
    assert!(served.configured, "{served:?}");
    assert_eq!(served.seed, None);
    assert!(served.to_string().contains("configured"), "{served}");
}

/// P-MAPGEN-SIG-FROST-1: with all five zones' landmarks in the generator (`rh_sim::mapgen::landmarks::signature`),
/// `--signature-landmarks` sets the generator's signature option and nothing else. The maker's options are the
/// server's (no decor) with and without the flag; with it, a served map (seeds 1-2) holds the generator's one volcano,
/// church, bog tree and cave, and is exactly the generator's own map, exported (no post-pass touches it); the
/// server's post-pass module (`src/signature.rs`, `src/signature/tests.rs`) is gone.
#[test]
fn signature_landmarks_only_set_the_generator_option() {
    use rh_sim::mapdata::{FeatureKind, MapExport, Zone};
    use rh_sim::mapgen::{coliseum, map_hash, pipeline};
    assert_eq!(
        StyledMaker::default().options(),
        pipeline::Options {
            decor: false,
            ..pipeline::Options::default()
        }
    );
    let maker = StyledMaker { signature: true };
    assert_eq!(
        maker.options(),
        pipeline::Options {
            decor: false,
            signature: true,
            ..pipeline::Options::default()
        },
        "the maker does not pass the signature option"
    );
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    for seed in 1..=2u32 {
        let served = maker.make(seed).unwrap().expect("a served map");
        let data = served.map.layers().expect("map layers").data();
        for (kind, zone) in [
            (FeatureKind::Volcano, Zone::Fire),
            (FeatureKind::Church, Zone::Sentenced),
            (FeatureKind::BogTree, Zone::Plague),
            (FeatureKind::Cave, Zone::Frost),
        ] {
            let n = data
                .features
                .iter()
                .filter(|f| f.kind == kind && f.zone == zone)
                .count();
            assert_eq!(n, 1, "seed {seed}: the served map has {n} {kind:?}");
        }
        let generated = generator
            .certified_styled(i64::from(seed), maker.options())
            .unwrap()
            .expect("certified");
        let hash = u32::from_str_radix(&map_hash::map_hash(&generated), 16).unwrap();
        let direct = MapExport {
            format: "rh-map/2".into(),
            legacy_map_hash_u32: hash,
            map: generated,
        }
        .validate()
        .unwrap()
        .into_arena()
        .unwrap();
        assert!(
            served == direct,
            "seed {seed}: the served map is not the generator's own map"
        );
    }
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    assert!(
        !src.join("signature.rs").exists() && !src.join("signature").exists(),
        "the post-pass module src/signature.rs is still in the tree"
    );
    let lib = std::fs::read_to_string(src.join("lib.rs")).unwrap();
    assert!(
        !lib.lines().any(|l| l.trim() == "pub mod signature;"),
        "lib.rs still declares the signature module"
    );
}
