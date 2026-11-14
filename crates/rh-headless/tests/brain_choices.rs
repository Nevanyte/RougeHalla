//! P-BOT-BRAIN-CHOICES-1 oracle: a learning tournament with Brain seats records the choices legacy's Brain records, so
//! the ported learner has something to learn from.
//!
//! What legacy records (packages/server/src/bots/): the Brain records a goal decision's `choice` when it adopts a new
//! goal (`brain/brain.ts:240-246`), and only three producers exist: `opener|<own faction>|<mob faction>` when it first
//! farms a mob (`brain/strategy.ts:487-488`), `opener|<own faction>|<camp zone>` when it first roams to a camp
//! (`:659`, `:696`), both only while no opener is recorded, and `second|<own faction>|<weapon>` when it goes to loot a
//! known weapon while carrying exactly one (`:626-635`, every such adoption). The manager appends
//! `faction|<persona>|<faction>` at the result (`BotManager.ts:480`). `spawn|…` and `boon|…` are only READ as biases
//! (`brain/modules/planning.ts:107`, `:117`) and never recorded; `skill`, `relic`, `camp` are declared domains
//! (`brain/types.ts:1102`) that no legacy code produces. So legacy's store holds three domains and so must ours.
//!
//! Why the port records none today: the Brain does record them (the `parity/policy/bot-private-brain` capture pins
//! `opener|fire|sentenced` and `second|fire|bow` in its memory and `end()` summary, field for field), but the
//! tournament seats it on the practice arena with the headless config: no mobs, no camps, no loot. Legacy's tournament
//! plays a generated map with mobs on (`tournament/headlessRoom.ts:26-34`, `:110`). The seam is
//! [`tournament_world`]: the world a tournament with a given policy plays.
//!
//! Loose proof (AGENTS.md): kinds of keys and sane counts, not exact counts. Release only (a few seconds a run):
//!   cargo test --locked --release -p rh-headless --test brain_choices
use rh_headless::tournament::{sim_config_for, TournamentPlan};
use rh_headless::tournament_cli::default_arena;
use rh_headless::tournament_learning::{
    learning_file, play_learning, tournament_world, LearnStore, LearnedGame, SeatPolicy,
};
use rh_policy::bots::learning::valid_key;
use rh_policy::bots::TierId;
use rh_sim::mob_runtime::MobMode;
use std::collections::BTreeMap;
use std::process::Command;

/// Legacy `FACTION_IDS` (`packages/shared/src/factions.ts:74`).
const FACTIONS: [&str; 5] = ["fire", "sentenced", "plague", "frost", "holy"];
/// Legacy `WEAPON_IDS` (`packages/shared/src/weapons.ts:21`).
const WEAPONS: [&str; 5] = ["sword", "bow", "wand", "shield", "axe"];
/// The only domains legacy ever records (see the module comment).
const RECORDED_DOMAINS: [&str; 3] = ["faction", "opener", "second"];

/// Three seats, two games, 3 simulated minutes at most, patience 60 s, sudden death 20 s. On the content world this
/// resolves every seat (measured 2026-11-13 with the intended world: ~3.5 s release for both games; 6 of 6 seats record
/// an opener, 2 of 6 a second).
fn plan() -> TournamentPlan {
    let mut plan = TournamentPlan::with_tiers(
        2,
        8, // seed 8: a `second` choice is recorded under both hitbox modes (7 only under LegacyCircle)
        vec![TierId::Easy, TierId::Normal, TierId::Hard],
        3. * 60_000.,
    );
    plan.patience_seconds = Some(60.);
    plan.sudden_death_seconds = Some(20.);
    plan
}

fn learn(plan: &TournamentPlan) -> (Vec<LearnedGame>, LearnStore) {
    let (arena, sim) = tournament_world(plan, SeatPolicy::Brain);
    let mut store = LearnStore::new();
    let games = play_learning(plan, &arena, &sim, SeatPolicy::Brain, &mut store);
    (games, store)
}

fn domain(key: &str) -> &str {
    key.split('|').next().unwrap_or("")
}

#[test]
fn the_brain_tournament_world_has_mobs_loot_and_camps_and_keeps_the_plans_timers() {
    let plan = plan();
    let (arena, sim) = tournament_world(&plan, SeatPolicy::Brain);
    let base = sim_config_for(&plan);
    assert_eq!(
        sim.mob_mode,
        MobMode::Pve,
        "legacy HEADLESS_CONFIG has mobs on (headlessRoom.ts:34): the opener is a choice of mobs and camps"
    );
    assert!(
        sim.initial_loot,
        "the world has weapons on the ground and in chests: `second` is a choice of loot"
    );
    assert!(
        rh_policy::bots::brain_features(&sim, &arena).camps,
        "the Brain's camps feature is on for this world (the map has camps)"
    );
    // The plan's timers and the lobby still come from the plan, as for every other tournament.
    assert_eq!(
        sim.lifecycle, base.lifecycle,
        "--patience/--sudden reach the sim"
    );
    assert_eq!(sim.min_players, base.min_players);
    assert_eq!(sim.lobby_seconds, base.lobby_seconds);
    assert_eq!(sim.fill_seconds, base.fill_seconds);
}

#[test]
fn guard_the_default_seats_play_todays_world() {
    // HumanBot tournaments (the default, and every golden) keep the practice arena and the headless config.
    let plan = plan();
    let (arena, sim) = tournament_world(&plan, SeatPolicy::Human);
    assert_eq!(arena, default_arena());
    assert_eq!(sim, sim_config_for(&plan));
}

#[test]
fn a_learning_brain_tournament_records_legacys_choice_kinds_in_sane_numbers() {
    let plan = plan();
    let (games, store) = learn(&plan);

    let mut records = 0usize;
    let mut with_opener = 0usize;
    let mut seconds = 0usize;
    for game in &games {
        for record in &game.records {
            records += 1;
            let seat = &game.summary.lineup[record.index];
            let own = seat.faction.as_str();
            let mut per_domain: BTreeMap<&str, usize> = BTreeMap::new();
            for key in &record.choices {
                assert!(
                    valid_key(key),
                    "game {}: {key} is not a choice key",
                    game.index
                );
                let parts: Vec<&str> = key.split('|').collect();
                let d = parts[0];
                assert!(
                    RECORDED_DOMAINS.contains(&d),
                    "game {}: {key}: legacy records only {RECORDED_DOMAINS:?} (spawn/boon are read, never recorded; \
                     skill/relic/camp are never produced)",
                    game.index
                );
                *per_domain.entry(d).or_default() += 1;
                match d {
                    "opener" => {
                        assert_eq!(
                            parts[1], own,
                            "{key}: the opener's context is the seat's own faction"
                        );
                        assert!(
                            FACTIONS.contains(&parts[2]),
                            "{key}: an opener names a faction (mob or camp zone)"
                        );
                    }
                    "second" => {
                        assert_eq!(
                            parts[1], own,
                            "{key}: the second's context is the seat's own faction"
                        );
                        assert!(
                            WEAPONS.contains(&parts[2]),
                            "{key}: a second names a weapon"
                        );
                    }
                    _ => {}
                }
            }
            // Legacy: one opener at most per run (strategy.ts:487, :659 stop once one is recorded); the faction key
            // once, last (BotManager.ts:480).
            let openers = per_domain.get("opener").copied().unwrap_or(0);
            assert!(
                openers <= 1,
                "game {} seat {}: {openers} openers",
                game.index,
                record.index
            );
            assert_eq!(per_domain.get("faction").copied(), Some(1));
            // A second is recorded at every adoption of a loot goal for a known weapon while one is carried (legacy
            // records duplicates; the store counts a key once per run). Loose bound against a runaway: a seat adopts
            // a handful of such goals in a 3-minute game, not dozens.
            let s = per_domain.get("second").copied().unwrap_or(0);
            assert!(
                s <= 10,
                "game {} seat {}: {s} seconds in one short run",
                game.index,
                record.index
            );
            with_opener += usize::from(openers == 1);
            seconds += s;
        }
    }
    assert!(
        records >= 4,
        "most seats resolve in this plan ({records} records)"
    );
    assert!(
        with_opener * 2 >= records,
        "most seats make an opener choice (they farm or walk to a camp first): {with_opener} of {records}"
    );
    assert!(
        seconds >= 1,
        "at least one seat makes a second-weapon choice in this run"
    );

    // The store: non-faction keys, each a legacy domain.
    let keys: Vec<&String> = store.stats().entries().keys().collect();
    assert!(
        keys.iter().any(|k| domain(k) == "opener"),
        "the learner's store holds opener keys, not only faction keys: {keys:?}"
    );
    assert!(
        keys.iter().any(|k| domain(k) == "second"),
        "the learner's store holds second keys: {keys:?}"
    );
    assert!(keys.iter().all(|k| RECORDED_DOMAINS.contains(&domain(k))));
}

#[test]
fn two_seeded_brain_learning_runs_write_byte_identical_stores_with_choices() {
    let plan = plan();
    let (_, a) = learn(&plan);
    let (_, b) = learn(&plan);
    let file_a =
        serde_json::to_string_pretty(&learning_file(&plan, SeatPolicy::Brain, &a)).unwrap();
    let file_b =
        serde_json::to_string_pretty(&learning_file(&plan, SeatPolicy::Brain, &b)).unwrap();
    assert!(
        a.stats().entries().keys().any(|k| domain(k) == "opener"),
        "the compared stores hold the Brain's own choices"
    );
    assert_eq!(file_a, file_b, "same plan and seed, same store bytes");
}

#[test]
fn the_tournament_binary_learns_from_brain_choices_on_the_brain_world() {
    let path = std::env::temp_dir().join(format!("rh-brain-choices-{}.json", std::process::id()));
    let output = Command::new(env!("CARGO_BIN_EXE_tournament"))
        .args([
            "--games",
            "2",
            "--lineup",
            "E,N,H",
            "--seed",
            "8",
            "--max-minutes",
            "3",
            "--patience",
            "60",
            "--sudden",
            "20",
            "--policy",
            "brain",
            "--learn",
            "on",
            "--quiet",
            "--learn-out",
        ])
        .arg(&path)
        .output()
        .expect("the tournament binary runs");
    assert!(
        output.status.success(),
        "the tournament binary exited {:?}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    let text = std::fs::read_to_string(&path).expect("the learning store is written");
    let _ = std::fs::remove_file(&path);
    let file: serde_json::Value = serde_json::from_str(&text).expect("the store parses");
    let entries = file["store"]["entries"].as_object().expect("entries");
    assert!(
        entries.keys().any(|k| domain(k) == "opener"),
        "the binary's store holds the Brain's opener choices: {:?}",
        entries.keys().collect::<Vec<_>>()
    );
    // The binary plays the same world as the library: the same store.
    let (_, store) = learn(&plan());
    assert_eq!(
        file["store"],
        store.to_json(),
        "the binary plays tournament_world(plan, Brain)"
    );
}
