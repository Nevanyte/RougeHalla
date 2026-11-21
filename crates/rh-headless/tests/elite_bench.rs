//! Oracle for packet P-ELITE-BENCH-1 (docs/backlog/packets/P-ELITE-BENCH-1.md): the elite mode of `camp_bench` and the
//! minute-5 build sample it fights with.
//!
//! The elite code lives in `src/elite_bench.rs` and is compiled into this test through `#[path]` (rh-sim's
//! `trusted-build-setup` comes from this crate's dev-dependency features), so it runs in process under a plain
//! `cargo test -p rh-headless`. Nothing here asserts a balance number: the bench is evidence for the owner checkpoint
//! (target: an average minute-5 build dies 10-20% soloing an elite camp), not a gate on today's numbers. What is pinned
//! is that the report is complete, consistent, deterministic, honest about its caveats, and that the builds are real.
#[path = "../src/elite_bench.rs"]
mod elite_bench;

use elite_bench::{
    banked_camp_build, run, sample_builds, SampleFile, BANKED_CAMPS, BOT_COLUMN, CAMP_STACKS,
    MINUTE5_TICK, REFERENCE_CAMPS, SAMPLE_PATH,
};
use rh_headless::load_arena;
use rh_sim::mob_catalog::{elites_of, normal_types_of};
use rh_sim::trusted_build::apply;
use rh_sim::{ArenaMode, FactionId, Placement, Secrets, Sim, SimConfig, WeaponId};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, OnceLock};

const MAP_REL: &str = "crates/rh-sim/src/mapdata/fixtures/seed1.map.json";
/// Fight cap for the data tests: small enough for a debug build, large enough to walk 10 tiles and swing.
const TEST_TICKS: &str = "400";

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn args(a: &[&str]) -> Vec<String> {
    a.iter().map(|s| s.to_string()).collect()
}
fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str()
        .unwrap_or_else(|| panic!("field {k} missing or not a string in {v}"))
}
fn u(v: &Value, k: &str) -> u64 {
    v[k].as_u64()
        .unwrap_or_else(|| panic!("field {k} missing or not an integer in {v}"))
}
fn num(v: &Value, k: &str) -> f64 {
    let x = v[k]
        .as_f64()
        .unwrap_or_else(|| panic!("field {k} missing or not a number in {v}"));
    assert!(x.is_finite(), "field {k} is not finite in {v}");
    x
}

// ---- the sample -----------------------------------------------------------------------------------------------

fn sample() -> &'static SampleFile {
    static S: OnceLock<SampleFile> = OnceLock::new();
    S.get_or_init(|| {
        let text = std::fs::read_to_string(root().join(SAMPLE_PATH))
            .unwrap_or_else(|e| panic!("the checked-in sample {SAMPLE_PATH} must exist: {e}"));
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("{SAMPLE_PATH} must parse: {e}"))
    })
}

#[test]
fn the_checked_in_sample_is_well_formed() {
    let f = sample();
    assert_eq!(f.version, 1);
    assert_eq!(f.tick, MINUTE5_TICK, "minute 5 at 20 Hz is tick 6000");
    assert_eq!(MINUTE5_TICK, 6000);
    assert_eq!(
        f.map, MAP_REL,
        "the map is the one source_soak and camp_bench use"
    );
    assert!(f.seeds[0] < f.seeds[1], "a non-empty seed range");
    // Every seed of the range either reached minute 5 and contributed builds, or is listed as ended early.
    let with_builds: BTreeSet<u64> = f.builds.iter().map(|b| b.seed).collect();
    let early: BTreeSet<u64> = f.ended_early.iter().copied().collect();
    for seed in f.seeds[0]..f.seeds[1] {
        assert!(
            with_builds.contains(&seed) != early.contains(&seed),
            "seed {seed} is either sampled or listed in ended_early, not both and not neither"
        );
    }
    assert!(with_builds
        .iter()
        .all(|s| (f.seeds[0]..f.seeds[1]).contains(s)));
    // Floors (coordinator 2026-11-19): the bot sample is one extra column of the report, so it needs enough builds from
    // enough matches to be an average. 56 builds from 22 seeds were measured over seeds 1..81.
    assert!(
        f.builds.len() >= 40,
        "at least 40 sampled builds, got {}",
        f.builds.len()
    );
    assert!(
        with_builds.len() >= 10,
        "builds from at least 10 matches, got {}",
        with_builds.len()
    );
    let keys: Vec<(u64, u32)> = f.builds.iter().map(|b| (b.seed, b.bot)).collect();
    let mut sorted = keys.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(keys, sorted, "(seed, bot) order, each once");
    assert!(f.builds.iter().all(|b| b.bot < 8), "8 bots per soak match");
    let factions: BTreeSet<&str> = FactionId::ALL.iter().map(|f| f.as_str()).collect();
    assert!(f
        .builds
        .iter()
        .all(|b| factions.contains(b.faction.as_str())));
    // Minute-5 bot builds hold NO cards on today's rules (cards come only from elite chests, so a player's first elite
    // fight has none: measured, 0 of 56) and many hold no stacks (39 of 56): the sample may hold zero cards. Some build
    // holds a stat stack, every listed stack is positive, and the file is generated (regeneration tests below).
    assert!(
        f.builds.iter().any(|b| !b.build.stacks.is_empty()),
        "some sampled build holds normal-mob stat stacks"
    );
    assert!(f
        .builds
        .iter()
        .all(|b| b.build.stacks.iter().all(|&(_, n)| n > 0)));
}

/// A lone fighter in the live world. The one override beyond `live_content()` that the oracle needs: the Source lifecycle
/// makes `Sim::reset_active` panic ("reset_active cannot bypass source planning; start from a lobby", sim.rs:211), so
/// `lifecycle: ArenaMode::Off` (the bench does the same). The bench's other overrides (regen, quests) are its own choice
/// and are not needed to build a world or apply a build.
fn fighter_sim_seeded(faction: FactionId, seed: u64) -> Sim {
    let arena = Arc::new(load_arena(root().join(MAP_REL).to_str().unwrap()).unwrap());
    let cfg = SimConfig {
        lifecycle: ArenaMode::Off,
        min_players: 1,
        lobby_seconds: 5.,
        fill_seconds: 3.,
        ..SimConfig::live_content()
    };
    let placement = [Placement {
        profile: "fighter".into(),
        faction,
        bot: false,
        at: arena.centre(),
        hp: None,
        weapon0: Some(WeaponId::Sword),
        weapon1: None,
    }];
    Sim::reset_active(cfg, arena, Secrets::from_seed(seed), &placement)
}
fn fighter_sim(faction: FactionId) -> Sim {
    fighter_sim_seeded(faction, 1)
}

#[test]
fn every_sampled_build_is_accepted_by_trusted_build_apply_for_every_faction() {
    let f = sample();
    for b in &f.builds {
        for faction in FactionId::ALL {
            let mut sim = fighter_sim(faction);
            let me = sim.players()[0].id;
            let before = sim.players()[0].build.counts();
            apply(&mut sim, me, &b.build).unwrap_or_else(|e| {
                panic!(
                    "seed {} bot {} refused for {}: {e:?}",
                    b.seed,
                    b.bot,
                    faction.as_str()
                )
            });
            // The fighter really holds what the sample says: the requested copies were added on top of what it had.
            let p = &sim.players()[0];
            for &(card, n) in &b.build.cards {
                assert_eq!(
                    p.build.counts()[card.index()],
                    before[card.index()] + n,
                    "card {card:?} of seed {} bot {}",
                    b.seed,
                    b.bot
                );
            }
            for &(mob, n) in &b.build.stacks {
                assert_eq!(p.farm.count(mob), n, "stacks of {mob:?}");
            }
        }
    }
}

#[test]
fn the_sample_regenerates_identically_for_its_first_sampled_seed() {
    // One 6000-tick live match (seconds): the sampler is a pure function of (map, seed, tick).
    let f = sample();
    let seed = f.builds[0].seed;
    let again = sample_builds(
        root().join(MAP_REL).to_str().unwrap(),
        seed..seed + 1,
        f.tick,
    )
    .expect("the sampler runs");
    let theirs: Vec<_> = f
        .builds
        .iter()
        .filter(|b| b.seed == seed)
        .cloned()
        .collect();
    assert!(!theirs.is_empty());
    assert_eq!(again.builds, theirs, "same seed, same minute-5 builds");
    assert_eq!(again.tick, f.tick);
    assert!(
        again.ended_early.is_empty(),
        "the first sampled seed reaches minute 5"
    );
}

#[test]
#[ignore = "slow: replays every match of the sample (cargo test -p rh-headless --test elite_bench -- --ignored)"]
fn the_whole_sample_regenerates_identically() {
    let f = sample();
    let again = sample_builds(
        root().join(MAP_REL).to_str().unwrap(),
        f.seeds[0]..f.seeds[1],
        f.tick,
    )
    .expect("the sampler runs");
    assert_eq!(
        &again, f,
        "the checked-in file is exactly what the sampler writes"
    );
}

// ---- the banked-camp build ------------------------------------------------------------------------------------

/// The stat types the normal (non-elite) camps of this world pay: under `camp_buffs = Themed` a camp's kills pay its buff
/// type's stat, else its own type's.
fn paid_by_normal_camps(sim: &Sim) -> BTreeSet<&'static str> {
    let buffs = sim.camp_buffs();
    sim.camp_rosters()
        .iter()
        .enumerate()
        .filter(|(_, r)| r.elite.is_none())
        .map(|(i, r)| {
            buffs
                .get(i)
                .copied()
                .flatten()
                .unwrap_or(r.mob_type)
                .as_str()
        })
        .collect()
}
fn total_stacks(b: &rh_sim::trusted_build::TrustedBuild) -> u64 {
    b.stacks.iter().map(|&(_, n)| n).sum()
}

#[test]
fn a_banked_camp_build_holds_n_times_12_stat_stacks_of_what_normal_camps_pay_and_nothing_else() {
    assert_eq!(
        CAMP_STACKS, 12,
        "workbook Augment_Value: one camp = 12 stacks"
    );
    assert_eq!(BANKED_CAMPS, [0, 6, 12, 18]);
    assert_eq!(REFERENCE_CAMPS, 12);
    let normal: BTreeSet<&'static str> = FactionId::ALL
        .into_iter()
        .flat_map(|z| normal_types_of(z).map(|t| t.id.as_str()))
        .collect();
    let mut seen_two_stats = false;
    for seed in 1..=6u64 {
        let probe = fighter_sim_seeded(FactionId::Frost, seed);
        let paid = paid_by_normal_camps(&probe);
        assert!(!paid.is_empty(), "the world has normal camps");
        for n in [0u32, 1, 6, 12, 18] {
            let b = banked_camp_build(&probe, seed, n);
            assert_eq!(
                total_stacks(&b),
                u64::from(n) * 12,
                "seed {seed}: {n} camps hold exactly {n} x 12 stacks"
            );
            assert!(b.cards.is_empty(), "no cards");
            assert!(b.boosts.is_empty(), "no boosts");
            assert!(
                b.stacks.iter().all(|&(_, k)| k > 0),
                "no empty stack entries"
            );
            let mobs: Vec<&'static str> = b.stacks.iter().map(|&(m, _)| m.as_str()).collect();
            let distinct: BTreeSet<&'static str> = mobs.iter().copied().collect();
            assert_eq!(distinct.len(), mobs.len(), "one entry per stat type");
            for m in &mobs {
                assert!(normal.contains(m), "{m} is a normal mob type");
                assert!(
                    paid.contains(m),
                    "seed {seed}: {m} is paid by no normal camp of this world"
                );
            }
            if n == 12 && mobs.len() >= 2 {
                seen_two_stats = true;
            }
            // The trusted seam takes it, and the fighter then holds exactly those stacks and no new card.
            let mut sim = fighter_sim_seeded(FactionId::Holy, seed);
            let me = sim.players()[0].id;
            let cards_before = sim.players()[0].build.counts();
            apply(&mut sim, me, &b).expect("the seam accepts a banked-camp build");
            let p = &sim.players()[0];
            for &(m, k) in &b.stacks {
                assert_eq!(p.farm.count(m), k);
            }
            assert_eq!(p.build.counts(), cards_before, "no card granted");
        }
    }
    assert!(
        seen_two_stats,
        "a 12-camp build draws camps of more than one stat on some seed"
    );
}

#[test]
fn a_banked_camp_build_is_a_pure_function_of_seed_and_world_and_seeds_draw_different_camps() {
    let mut builds = Vec::new();
    for seed in 1..=8u64 {
        let probe = fighter_sim_seeded(FactionId::Frost, seed);
        let a = banked_camp_build(&probe, seed, 12);
        let again = banked_camp_build(&fighter_sim_seeded(FactionId::Frost, seed), seed, 12);
        assert_eq!(a, again, "same seed, same build");
        // The draw seed matters on its own, not only through the world.
        builds.push((a, banked_camp_build(&probe, seed + 1000, 12)));
    }
    let distinct: BTreeSet<String> = builds.iter().map(|(a, _)| format!("{a:?}")).collect();
    assert!(
        distinct.len() >= 2,
        "different seeds give different camp draws somewhere in seeds 1..=8"
    );
    assert!(
        builds.iter().any(|(a, b)| a != b),
        "a different draw seed on the same world gives a different draw somewhere in 8 worlds"
    );
}

// ---- the elite run --------------------------------------------------------------------------------------------

/// The first zone's elites, as the quick run uses them.
fn quick_kinds() -> Vec<String> {
    elites_of(FactionId::ALL[0])
        .map(|t| t.id.as_str().to_string())
        .collect()
}
fn all_elite_ids() -> BTreeSet<String> {
    FactionId::ALL
        .into_iter()
        .flat_map(|z| elites_of(z).map(|t| t.id.as_str().to_string()))
        .collect()
}

const QUICK_SEEDS: u64 = 2;

fn quick_args(extra: &[&str]) -> Vec<String> {
    let mut a = args(&[
        "--quick",
        "--seed",
        "1",
        "--seeds",
        "2",
        "--max-ticks",
        TEST_TICKS,
    ]);
    a.extend(args(extra));
    a
}

/// The shared quick run: (json text, parsed json, table).
fn quick() -> &'static (String, Value, String) {
    static Q: OnceLock<(String, Value, String)> = OnceLock::new();
    Q.get_or_init(|| {
        let out =
            run(&quick_args(&[])).unwrap_or_else(|e| panic!("the quick elite run reports: {e}"));
        let v = serde_json::from_str(&out.json).expect("the report is one JSON document");
        (out.json, v, out.table)
    })
}

#[test]
fn the_quick_run_reports_a_complete_elite_inventory() {
    let (_, r, _) = quick();
    assert_eq!(r["version"], json!(1));
    assert_eq!(r["mode"], json!("elite"));
    assert_eq!(r["quick"], json!(true));
    assert_eq!(u(r, "max_ticks"), 400);
    // Quick = Frost,Holy x Sword,Wand x the first zone's 2 elites x 2 seeds; a seed that rolls no such camp is listed
    // in `skipped`, never silently dropped.
    let kinds = quick_kinds();
    assert_eq!(kinds.len(), 2, "catalog: 2 elites per zone");
    let expected = 2 * 2 * kinds.len() as u64 * QUICK_SEEDS;
    let cells = r["cells"].as_array().expect("cells");
    let skipped = r["skipped"].as_array().expect("skipped");
    // Every faction x weapon x elite x seed is skipped (listed once) or fought once per column (4 banked + bot sample).
    assert_eq!(
        cells.len() as u64,
        (expected - skipped.len() as u64) * 5,
        "5 build columns per fought cell"
    );
    assert!(!cells.is_empty(), "floor: at least one fight ran");
    // Order: faction, weapon, kind, seed (seed innermost), each exactly once.
    let key = |c: &Value| {
        (
            s(c, "faction").to_string(),
            s(c, "weapon").to_string(),
            s(c, "kind").to_string(),
            u(c, "seed"),
            c["column"].as_str().unwrap_or("").to_string(),
        )
    };
    let keys: Vec<_> = cells.iter().chain(skipped.iter()).map(key).collect();
    let mut sorted = keys.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted.len(), keys.len(), "each cell exactly once");
    let all = all_elite_ids();
    for c in cells {
        assert!(
            all.contains(s(c, "kind")),
            "{} is a catalog elite",
            s(c, "kind")
        );
        assert!(
            kinds.contains(&s(c, "kind").to_string()),
            "quick kinds only"
        );
        assert_eq!(c["elite"], json!(true));
        assert!(["died", "cleared", "truncated"].contains(&s(c, "outcome")));
        assert!(u(c, "ticks") <= 400);
        assert!(num(c, "hp_start") > 0.);
        let died = s(c, "outcome") == "died";
        assert_eq!(num(c, "hp_remaining") == 0., died, "hp 0 exactly when died");
        // A normal camp kind is never reported here.
        assert!(normal_types_of(FactionId::ALL[0]).all(|t| t.id.as_str() != s(c, "kind")));
    }
}

#[test]
fn the_report_states_the_rules_the_build_source_and_the_brawler_caveat() {
    let (_, r, table) = quick();
    assert_eq!(
        r["config"],
        json!("live_content"),
        "SimConfig::live_content()"
    );
    assert_eq!(r["rules"]["elites"], json!("rework"));
    assert_eq!(r["rules"]["augments"], json!("rework"));
    assert_eq!(
        r["builds"]["source"],
        json!(SAMPLE_PATH),
        "the default build source is the checked-in minute-5 sample"
    );
    assert_eq!(u(&r["builds"], "tick"), 6000);
    assert!(
        u(&r["builds"], "count") >= 40,
        "builds describes the bot sample column"
    );
    assert_eq!(
        r["reference"],
        json!("banked_12"),
        "the reference column is 12 banked camps (workbook Augment_Value, assumption banked)"
    );
    let caveat = s(r, "caveat");
    assert!(
        caveat.contains("Brawler"),
        "plan decision 8: the report notes its fighter is the scripted Brawler, which may skew death rates"
    );
    assert!(
        table.contains("Brawler"),
        "the readable table carries the same note"
    );
    // The elite bench builds its world from live_content (the file is the proof of which config it asks for).
    let src = include_str!("../src/elite_bench.rs");
    assert!(
        src.contains("SimConfig::live_content()"),
        "elite mode starts from SimConfig::live_content()"
    );
}

#[test]
fn death_rates_are_consistent_per_camp_overall_and_in_the_table() {
    let (_, r, table) = quick();
    let cells = r["cells"].as_array().unwrap();
    let per_camp = r["per_camp"].as_array().expect("per_camp");
    let kinds = quick_kinds();
    assert_eq!(
        per_camp.len(),
        kinds.len(),
        "one row per elite camp kind, in catalog order"
    );
    let (mut samples, mut deaths) = (0u64, 0u64);
    for (row, kind) in per_camp.iter().zip(&kinds) {
        assert_eq!(s(row, "kind"), kind);
        // The row's own samples/deaths are the reference column (12 banked camps); the columns carry the rest.
        let mine: Vec<&Value> = cells
            .iter()
            .filter(|c| s(c, "kind") == kind && s(c, "column") == "banked_12")
            .collect();
        let n = u(row, "samples");
        let d = u(row, "deaths");
        assert_eq!(n, mine.len() as u64, "samples counts the fights of {kind}");
        assert_eq!(
            d,
            mine.iter().filter(|c| s(c, "outcome") == "died").count() as u64
        );
        assert!(d <= n);
        if n > 0 {
            assert!((num(row, "death_rate") - d as f64 / n as f64).abs() < 1e-12);
        } else {
            assert!(row["death_rate"].is_null(), "no samples, no rate");
        }
        samples += n;
        deaths += d;
        // The table has a line for the camp with its sample count and its rate as a percentage.
        let line = table
            .lines()
            .find(|l| l.contains(kind.as_str()))
            .unwrap_or_else(|| panic!("the table names {kind}:\n{table}"));
        assert!(
            line.split_whitespace().any(|w| w == n.to_string()),
            "table line for {kind} carries its sample count {n}: {line}"
        );
        if n > 0 {
            let pct = format!("{:.1}%", 100. * d as f64 / n as f64);
            assert!(
                line.contains(&pct),
                "table line for {kind} carries {pct}: {line}"
            );
        }
    }
    let o = &r["overall"];
    assert_eq!(u(o, "samples"), samples);
    assert_eq!(u(o, "deaths"), deaths);
    assert_eq!(
        samples * 5,
        cells.len() as u64,
        "5 columns of the same cells"
    );
    assert!(samples >= 1);
    let pct = format!("{:.1}%", 100. * deaths as f64 / samples as f64);
    let overall = table
        .lines()
        .find(|l| l.to_lowercase().contains("overall"))
        .unwrap_or_else(|| panic!("the table has an overall line:\n{table}"));
    assert!(
        overall.contains(&pct) && overall.contains(&samples.to_string()),
        "{overall}"
    );
    // Solo: one fighter per fight.
    assert_eq!(r["solo"], json!(true), "every sample is a solo fight");
}

#[test]
fn the_run_is_deterministic() {
    let again = run(&quick_args(&[])).expect("runs");
    let (json, _, table) = quick();
    assert_eq!(&again.json, json, "same seed and flags give identical JSON");
    assert_eq!(&again.table, table);
}

#[test]
fn builds_are_applied_before_the_first_step_and_the_fighter_walks_to_the_camp() {
    // Trap (coordinator, integration review): `trusted_build::apply` leaves Plant Your Feet's stillness clock
    // (`card_still_since`) at 0, so a holder granted the card right before a fight would plant its first swing at once.
    // The chosen design: apply at tick 0 and let the fighter walk the approach (the walk resets the clock every moving
    // tick, cards/mod.rs:167), so the opening swing is the same as in a played match. The report pins the pieces.
    let (_, r, _) = quick();
    for c in r["cells"].as_array().unwrap() {
        assert_eq!(u(c, "build_applied_tick"), 0, "applied before any step");
        let d = num(c, "start_dist");
        assert!(
            (128. ..=320.).contains(&d),
            "the fighter starts 4 to 10 tiles away and walks in (camp_bench START_DIST 320, fallbacks 256/192/128): {d}"
        );
        match c["first_hit_tick"].as_u64() {
            Some(t) => assert!(
                t >= 1,
                "no hit on the very first tick: the approach comes first"
            ),
            None => assert!(c["first_hit_tick"].is_null()),
        }
    }
}

const COLUMNS: [&str; 5] = ["banked_0", "banked_6", "banked_12", "banked_18", BOT_COLUMN];

#[test]
fn each_cell_uses_the_documented_build_of_its_column() {
    let (_, r, _) = quick();
    let n = u(&r["builds"], "count");
    let cells = r["cells"].as_array().unwrap();
    // The bot-sample column's build is a pure function of the cell's place in the inventory (faction, weapon, kind, seed
    // order, skips included): ordinal % count. Rebuild the ordinal from the same listing. Banked columns carry their
    // camp count and no sample index.
    let mut places: Vec<&Value> = cells
        .iter()
        .filter(|c| s(c, "column") == BOT_COLUMN)
        .chain(r["skipped"].as_array().unwrap().iter())
        .collect();
    let order = |v: &&Value| {
        let f = FactionId::ALL
            .iter()
            .position(|f| f.as_str() == s(v, "faction"))
            .unwrap();
        let w = WeaponId::ALL
            .iter()
            .position(|w| w.as_str() == s(v, "weapon"))
            .unwrap();
        let k = quick_kinds()
            .iter()
            .position(|k| k == s(v, "kind"))
            .unwrap();
        (f, w, k, u(v, "seed"))
    };
    places.sort_by_key(order);
    for (ordinal, c) in places.iter().enumerate() {
        if c.get("column").is_some() {
            assert_eq!(
                u(c, "build_index"),
                ordinal as u64 % n,
                "bot-sample build of cell {ordinal}"
            );
        }
    }
    for c in cells {
        let col = s(c, "column");
        assert!(COLUMNS.contains(&col), "column {col}");
        if col == BOT_COLUMN {
            assert!(c["camps"].is_null());
        } else {
            assert_eq!(
                col,
                format!("banked_{}", u(c, "camps")),
                "a banked column names its camp count"
            );
            assert!(
                c["build_index"].is_null(),
                "a banked build has no sample index"
            );
        }
    }
}

#[test]
fn the_report_has_a_column_per_build_for_every_elite_camp_and_overall() {
    let (_, r, table) = quick();
    let cells = r["cells"].as_array().unwrap();
    let check = |row: &Value, filter: &dyn Fn(&&Value) -> bool, what: &str| {
        let cols = row["columns"]
            .as_array()
            .unwrap_or_else(|| panic!("{what} has columns"));
        let names: Vec<&str> = cols.iter().map(|c| s(c, "column")).collect();
        assert_eq!(
            names, COLUMNS,
            "{what}: banked 0, 6, 12, 18, then the bot sample"
        );
        for (c, name) in cols.iter().zip(COLUMNS) {
            let mine: Vec<&Value> = cells
                .iter()
                .filter(|x| s(x, "column") == name)
                .filter(filter)
                .collect();
            let n = u(c, "samples");
            let d = u(c, "deaths");
            assert_eq!(n, mine.len() as u64, "{what} {name}: samples");
            assert_eq!(
                d,
                mine.iter().filter(|x| s(x, "outcome") == "died").count() as u64
            );
            if n > 0 {
                let rate = num(c, "death_rate");
                assert!((rate - d as f64 / n as f64).abs() < 1e-12);
                // A 95% interval on each death rate (the owner reads rates with their uncertainty).
                let ci = c["ci95"]
                    .as_array()
                    .unwrap_or_else(|| panic!("{what} {name}: ci95"));
                let (lo, hi) = (ci[0].as_f64().unwrap(), ci[1].as_f64().unwrap());
                assert!(
                    0. <= lo && lo <= rate + 1e-12 && rate <= hi + 1e-12 && hi <= 1.,
                    "{what} {name}: {lo} <= {rate} <= {hi}"
                );
                assert!(
                    hi - lo > 1e-9,
                    "{what} {name}: a few samples cannot give a point interval"
                );
            } else {
                assert!(c["death_rate"].is_null() && c["ci95"].is_null());
            }
        }
    };
    let per_camp = r["per_camp"].as_array().unwrap();
    assert_eq!(per_camp.len(), quick_kinds().len());
    for row in per_camp {
        let kind = s(row, "kind").to_string();
        check(row, &|c: &&Value| s(c, "kind") == kind, &kind);
        // The table line of the camp shows one percentage per column.
        let line = table.lines().find(|l| l.contains(kind.as_str())).unwrap();
        for c in row["columns"].as_array().unwrap() {
            if u(c, "samples") > 0 {
                let pct = format!("{:.1}%", 100. * num(c, "death_rate"));
                assert!(line.contains(&pct), "{kind} line carries {pct}: {line}");
            }
        }
    }
    check(&r["overall"], &|_c: &&Value| true, "overall");
    // The header names every column.
    for name in COLUMNS {
        assert!(
            table.contains(name),
            "the table names column {name}:\n{table}"
        );
    }
    // The reference column (12 camps banked) is what per_camp and overall report as their own rate.
    for row in per_camp.iter().chain(std::iter::once(&r["overall"])) {
        let refc = &row["columns"][2];
        assert_eq!(row["samples"], refc["samples"]);
        assert_eq!(row["deaths"], refc["deaths"]);
        assert_eq!(row["death_rate"], refc["death_rate"]);
    }
    assert!(
        table.to_lowercase().contains("bots bank far fewer camps"),
        "the table says bots bank far fewer camps than the workbook player"
    );
}

/// Margin of the negative control. Measured on the prototype (quick run, seeds 1..=2, 400 ticks, 16 paired fights):
/// damage dealt 31428 bare, 39220 at 6 camps, 49412 at 12 camps (x1.57), 53373 at 18 camps; deaths 11, 7, 6, 1 of 16.
/// The floor is x1.25: well below the measured x1.57, well above noise (a build that is ignored gives exactly x1.00).
const CONTROL_DEALT_RATIO: f64 = 1.25;

#[test]
fn twelve_banked_camps_beat_the_bare_fighter_on_the_same_fight_seed() {
    // Negative control (replaces the bare-run flag): banked_0 IS the bare fighter. On each fought cell (same faction,
    // weapon, elite, seed, so the same fight seed and camp), the 12-camp build must deal more damage and die no more.
    let (_, r, _) = quick();
    let cells = r["cells"].as_array().unwrap();
    let get =
        |col: &str| -> Vec<&Value> { cells.iter().filter(|c| s(c, "column") == col).collect() };
    let (bare, full) = (get("banked_0"), get("banked_12"));
    assert_eq!(bare.len(), full.len());
    assert!(bare.len() >= 8, "floor: at least 8 paired fights");
    // Cells are listed faction, weapon, kind, seed, column: the k-th banked_0 and banked_12 are the same fight.
    for (b, f) in bare.iter().zip(&full) {
        for k in ["faction", "weapon", "kind"] {
            assert_eq!(b[k], f[k]);
        }
        assert_eq!(b["seed"], f["seed"]);
    }
    let sum = |v: &[&Value], k: &str| v.iter().map(|c| num(c, k)).sum::<f64>();
    let (dealt0, dealt12) = (sum(&bare, "damage_dealt"), sum(&full, "damage_dealt"));
    let deaths = |v: &[&Value]| v.iter().filter(|c| s(c, "outcome") == "died").count();
    let (d0, d12) = (deaths(&bare), deaths(&full));
    assert!(
        dealt12 >= dealt0 * CONTROL_DEALT_RATIO,
        "damage dealt with 12 banked camps {dealt12} vs bare {dealt0}: needs x{CONTROL_DEALT_RATIO}"
    );
    assert!(
        d12 < d0,
        "12 banked camps die less than the bare fighter: {d12} vs {d0} deaths"
    );
    let better = bare
        .iter()
        .zip(&full)
        .filter(|(b, f)| num(f, "damage_dealt") > num(b, "damage_dealt"))
        .count();
    assert!(
        better * 4 >= bare.len() * 3,
        "at least three quarters of the paired fights deal more with the build: {better} of {}",
        bare.len()
    );
    // More camps never mean less damage in total (0 < 6 < 12 < 18).
    let by_col: Vec<f64> = COLUMNS[..4]
        .iter()
        .map(|c| sum(&get(c), "damage_dealt"))
        .collect();
    assert!(
        by_col.windows(2).all(|w| w[0] < w[1]),
        "damage dealt rises with banked camps: {by_col:?}"
    );
}

#[test]
fn a_run_that_reports_exits_ok_even_when_nothing_finishes() {
    // One tick: every fight is cut off. The bench is evidence, not a gate: it still reports.
    let out = run(&args(&["--quick", "--seeds", "1", "--max-ticks", "1"]))
        .expect("Ok whenever it reported");
    let r: Value = serde_json::from_str(&out.json).unwrap();
    assert!(r["cells"]
        .as_array()
        .unwrap()
        .iter()
        .all(|c| s(c, "outcome") == "truncated"));
    assert_eq!(u(&r["overall"], "deaths"), 0);
    // Bad arguments are the one refusal.
    assert!(run(&args(&["--quick", "--seeds", "x"])).is_err());
    assert!(run(&args(&["--quick", "--builds", "/no/such/file.json"])).is_err());
}

#[test]
fn the_binary_exits_zero_with_the_feature_and_says_so_without_it() {
    let out = Command::new(env!("CARGO_BIN_EXE_camp_bench"))
        .args(["--elite", "--quick", "--seeds", "1", "--max-ticks", "50"])
        .current_dir(root())
        .output()
        .expect("camp_bench starts");
    if cfg!(feature = "elite-bench") {
        assert!(
            out.status.success(),
            "exit 0 once it reported: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let v: Value = serde_json::from_slice(&out.stdout).expect("stdout is one JSON report");
        assert_eq!(v["mode"], json!("elite"));
        assert!(!out.stderr.is_empty(), "the readable table goes to stderr");
    } else {
        assert_eq!(out.status.code(), Some(2));
        assert!(String::from_utf8_lossy(&out.stderr).contains("elite-bench"));
    }
}

// ---- measurement only: today's non-elite output is unchanged ---------------------------------------------------

#[test]
fn the_non_elite_camp_bench_output_is_byte_identical_to_before() {
    // Goldens produced by the camp_bench of the integration head ec6d2c2a9 (before this packet).
    let run_raw = |a: &[&str]| {
        let out = Command::new(env!("CARGO_BIN_EXE_camp_bench"))
            .args(a)
            .output()
            .expect("camp_bench starts");
        assert!(out.status.success());
        String::from_utf8(out.stdout).unwrap()
    };
    let fx = |n: &str| {
        std::fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures")
                .join(n),
        )
        .unwrap()
    };
    assert_eq!(
        run_raw(&["--list", "--quick", "--seed", "1"]),
        fx("camp_bench_quick_list.json")
    );
    assert_eq!(
        run_raw(&["--quick", "--seed", "1", "--max-ticks", "400"]),
        fx("camp_bench_quick_400.json"),
        "the quick fights (legacy and archetypes, no build) are unchanged by the elite mode"
    );
}
