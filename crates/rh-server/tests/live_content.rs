//! P-SIM-LIVE-CONTENT-1 oracle (rh-server half). Two parts:
//!
//! 1. CHARACTERISATION (green before and after the packet): the `SimConfig` the live server builds today, field by field,
//!    through the server's own argument parsing (`Settings::from_args` then `Settings::sim`), for the default
//!    source-arena runtime, every operator flag that changes a `SimConfig` field (`--hitboxes`, `--min-players`,
//!    `--lobby-seconds`, `--fill-seconds`, `--lobby-timing` through `BotFillConfig::apply_lobby_timing`), the flags that
//!    must change nothing (`--map-pool`, `--signature-landmarks`, `--fill-bots`, `--max-rooms`), and the practice room
//!    (`--runtime training`). The expected configs are written as exhaustive struct literals (no `..Default`), so a new
//!    `SimConfig` field does not compile here until someone states what the live server plays for it.
//!    No `--frost-wish`, camp-buff or regen flag exists in `runtime.rs` (they are fixed in `Settings::sim`).
//!    P-FROST-WALL-3 amended the stated live `frost_wish` from `Freeze` to `Wall` in both tables (coordinator-approved).
//!    The core runtime (no `--runtime`, `--runtime core`, `--first-playable`) builds its `SimConfig` inline in
//!    `src/main.rs` and is not reachable from a test; what is reachable (`from_args` declines it, `core_hitboxes`) is
//!    pinned here, and `main.rs` is outside the packet's write scope.
//! 2. THE NEW STRUCTURE (red until the packet lands): `SimConfig::live_content()` is the source-arena world minus the
//!    server's own fields, compared as whole structs so a new field is compared by default.
use rh_server::bot_fill::{BotFillConfig, LobbyTiming};
use rh_server::runtime::{core_hitboxes, Settings, LIVE_DEFAULT_HITBOXES};
use rh_sim::archetype::{HitboxMode, MobSpacing};
use rh_sim::{
    abilities, mob_runtime::MobMode, terrain, ArenaMode, ArenaRules, CampBuffRule, FactionMode,
    FrostWish, RegenInCombat, SimConfig,
};

fn args(s: &str) -> Vec<String> {
    s.split_whitespace().map(str::to_owned).collect()
}

/// The server's real parsing. `--map x` is enough: `from_args` records the path, only `Settings::arena` reads it.
fn settings(s: &str) -> Settings {
    Settings::from_args(&args(s))
        .unwrap_or_else(|e| panic!("{s}: {e}"))
        .unwrap_or_else(|| panic!("{s}: not a runtime profile"))
}

fn sim(s: &str) -> SimConfig {
    settings(s).sim()
}

/// The source-arena lifecycle the live server plays today (`ArenaMode::Source(ArenaRules::default())`), spelled out.
fn source_lifecycle() -> ArenaMode {
    ArenaMode::Source(ArenaRules {
        plan_seconds: 45.,
        first_patience_seconds: None,
        coliseum_schedule: Some(rh_sim::ColiseumSchedule {
            first_seconds: 600.,
            second_seconds: 900.,
            repeat_seconds: 120.,
            min_gap_seconds: 30.,
        }),
        patience_seconds: 300.,
        patience_min_seconds: 120.,
        sudden_death_seconds: 60.,
    })
}

/// `--runtime source-arena` today (runtime.rs `Settings::sim`), every field written out.
fn expected_source(
    min_players: usize,
    lobby_seconds: f64,
    fill_seconds: f64,
    hitboxes: HitboxMode,
) -> SimConfig {
    SimConfig {
        abilities: abilities::Mode::Full,
        wish_lock_ms: abilities::WISH_LOCK_MS,
        lifecycle: source_lifecycle(),
        hazards: terrain::Mode::Map,
        initial_loot: true,
        consumables: true,
        min_players,
        lobby_seconds,
        fill_seconds,
        pvp_rules: true,
        weapon_specials: true,
        faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
        mob_mode: MobMode::Pve,
        regen: true,
        quests: true,
        training: false,
        dummies: false,
        walk_hints: Some(true),
        hitboxes,
        mob_spacing: MobSpacing::Auto,
        regen_in_combat: RegenInCombat::Off,
        camp_buffs: CampBuffRule::Themed,
        // P-FROST-WALL-3: the live profiles play Frost Wall (owner decision 2, 2026-11-10).
        frost_wish: FrostWish::Wall,
    }
}

/// `--runtime training` today (the practice room), every field written out.
fn expected_training(hitboxes: HitboxMode) -> SimConfig {
    SimConfig {
        abilities: abilities::Mode::Full,
        wish_lock_ms: abilities::WISH_LOCK_MS,
        lifecycle: ArenaMode::Off,
        hazards: terrain::Mode::Off,
        initial_loot: false,
        consumables: true,
        min_players: 1,
        lobby_seconds: 0.,
        fill_seconds: 0.,
        pvp_rules: true,
        weapon_specials: true,
        faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
        mob_mode: MobMode::Off,
        regen: true,
        quests: false,
        training: true,
        dummies: true,
        walk_hints: Some(true),
        hitboxes,
        mob_spacing: MobSpacing::Auto,
        regen_in_combat: RegenInCombat::Off,
        camp_buffs: CampBuffRule::Themed,
        // P-FROST-WALL-3: the live profiles play Frost Wall (owner decision 2, 2026-11-10).
        frost_wish: FrostWish::Wall,
    }
}

const SOURCE: &str = "--runtime source-arena --map x";

// ---------------------------------------------------------------------------------------------------------------------
// 1. Characterisation (green today; must stay green).
// ---------------------------------------------------------------------------------------------------------------------

#[test]
fn guard_the_live_default_hitbox_mode_is_archetypes() {
    assert_eq!(LIVE_DEFAULT_HITBOXES, HitboxMode::Archetypes);
}

#[test]
fn guard_the_source_arena_runtime_config_field_by_field() {
    let table: &[(&str, SimConfig)] = &[
        (SOURCE, expected_source(2, 30., 5., HitboxMode::Archetypes)),
        (
            "--runtime source-arena --map x --hitboxes archetypes",
            expected_source(2, 30., 5., HitboxMode::Archetypes),
        ),
        (
            "--runtime source-arena --map x --hitboxes legacy",
            expected_source(2, 30., 5., HitboxMode::LegacyCircle),
        ),
        (
            "--runtime source-arena --map x --min-players 3 --lobby-seconds 12.5 --fill-seconds 4",
            expected_source(3, 12.5, 4., HitboxMode::Archetypes),
        ),
        (
            "--runtime source-arena --map x --min-players 1 --lobby-seconds 0 --fill-seconds 0 --hitboxes legacy",
            expected_source(1, 0., 0., HitboxMode::LegacyCircle),
        ),
        // Flags that change rooms, maps or seats but not the rules.
        (
            "--runtime source-arena --map x --map-pool",
            expected_source(2, 30., 5., HitboxMode::Archetypes),
        ),
        (
            "--runtime source-arena --map x --map-pool --signature-landmarks",
            expected_source(2, 30., 5., HitboxMode::Archetypes),
        ),
        (
            "--runtime source-arena --map x --fill-bots 7 --max-rooms 3",
            expected_source(2, 30., 5., HitboxMode::Archetypes),
        ),
        // `--lobby-timing` is applied by the director at room build, not by `Settings::sim`.
        (
            "--runtime source-arena --map x --lobby-timing matchmaking",
            expected_source(2, 30., 5., HitboxMode::Archetypes),
        ),
    ];
    for (flags, expected) in table {
        assert_eq!(&sim(flags), expected, "{flags}");
    }
}

#[test]
fn guard_the_lobby_timing_flag_as_the_director_applies_it() {
    // director.rs `spawn_room`: `fill.apply_lobby_timing(&mut sim)` on a clone of `Settings::sim()`.
    let room = |flags: &str| {
        let timing = rh_server::runtime::lobby_timing_flag(&args(flags)).unwrap();
        let fill = BotFillConfig {
            lobby_timing: timing,
            ..BotFillConfig::default()
        };
        let mut s = sim(flags);
        fill.apply_lobby_timing(&mut s);
        s
    };
    assert_eq!(
        room(SOURCE),
        expected_source(2, 30., 5., HitboxMode::Archetypes)
    );
    assert_eq!(
        rh_server::runtime::lobby_timing_flag(&args(&format!(
            "{SOURCE} --lobby-timing matchmaking"
        )))
        .unwrap(),
        LobbyTiming::Matchmaking {
            lobby_seconds: 15.,
            bots_at_seconds: 13.,
        }
    );
    assert_eq!(
        room(&format!("{SOURCE} --lobby-timing matchmaking")),
        expected_source(8, 15., 0., HitboxMode::Archetypes),
        "matchmaking: 15 s lobby, the human minimum unreachable (MAX_PLAYERS = 8), no fill countdown"
    );
}

#[test]
fn guard_the_practice_room_config_field_by_field() {
    assert_eq!(
        sim("--runtime training"),
        expected_training(HitboxMode::Archetypes)
    );
    assert_eq!(
        sim("--runtime training --hitboxes archetypes"),
        expected_training(HitboxMode::Archetypes)
    );
    assert_eq!(
        sim("--runtime training --hitboxes legacy"),
        expected_training(HitboxMode::LegacyCircle)
    );
    assert_eq!(
        sim("--runtime training --max-rooms 2"),
        expected_training(HitboxMode::Archetypes)
    );
}

#[test]
fn guard_what_is_reachable_of_the_core_runtime() {
    // The core path (bare binary, `--runtime core`, `--first-playable`) is not a `Settings` profile: main.rs builds its
    // config inline. Its hitbox default is the only part reachable from here.
    for core in ["", "--runtime core", "--first-playable"] {
        assert!(
            Settings::from_args(&args(core)).unwrap().is_none(),
            "{core}"
        );
    }
    assert_eq!(core_hitboxes(&args("")), Ok(HitboxMode::LegacyCircle));
    assert_eq!(
        core_hitboxes(&args("--runtime core")),
        Ok(HitboxMode::LegacyCircle)
    );
    assert_eq!(
        core_hitboxes(&args("--first-playable")),
        Ok(HitboxMode::Archetypes)
    );
    assert_eq!(
        core_hitboxes(&args("--first-playable --hitboxes legacy")),
        Ok(HitboxMode::LegacyCircle)
    );
    assert_eq!(
        core_hitboxes(&args("--hitboxes archetypes")),
        Ok(HitboxMode::Archetypes)
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. The new structure (red until P-SIM-LIVE-CONTENT-1 lands).
// ---------------------------------------------------------------------------------------------------------------------

/// The server's own fields on the source-arena runtime: the lobby timers (`--min-players`, `--lobby-seconds`,
/// `--fill-seconds`) and the arena lifecycle. Everything else `Settings::sim` returns under default flags is the live
/// content world. `hitboxes` is NOT on this list: under default flags the server plays `LIVE_DEFAULT_HITBOXES`, and
/// `live_content()` carries it.
fn with_server_fields(mut content: SimConfig, server: &SimConfig) -> SimConfig {
    content.min_players = server.min_players;
    content.lobby_seconds = server.lobby_seconds;
    content.fill_seconds = server.fill_seconds;
    content.lifecycle = server.lifecycle.clone();
    content
}

#[test]
fn live_content_is_the_source_arena_world_minus_the_servers_named_fields() {
    let server = sim(SOURCE);
    assert_eq!(
        with_server_fields(SimConfig::live_content(), &server),
        server,
        "SimConfig::live_content() must equal `--runtime source-arena` (default flags) in every field except \
         min_players, lobby_seconds, fill_seconds and lifecycle"
    );
}

#[test]
fn live_content_carries_the_live_default_hitbox_mode() {
    assert_eq!(SimConfig::live_content().hitboxes, LIVE_DEFAULT_HITBOXES);
}

#[test]
fn the_operator_flags_override_live_content_only_in_their_own_fields() {
    // `--hitboxes legacy` changes `hitboxes` and nothing else; the timer flags change the timers and nothing else.
    let mut expected = with_server_fields(SimConfig::live_content(), &sim(SOURCE));
    expected.hitboxes = HitboxMode::LegacyCircle;
    assert_eq!(sim(&format!("{SOURCE} --hitboxes legacy")), expected);

    let flags = format!("{SOURCE} --min-players 3 --lobby-seconds 12.5 --fill-seconds 4");
    let timed = sim(&flags);
    assert_eq!(
        with_server_fields(SimConfig::live_content(), &timed),
        timed,
        "{flags}"
    );
}

/// The practice-room overrides `Settings::sim` applies over the live content (runtime.rs: `training`, `dummies`,
/// `quests`, `hazards`, `lifecycle`, `mob_mode`, `initial_loot`) plus the timers. Every other field is the live world.
#[test]
fn the_practice_room_is_live_content_plus_the_named_practice_overrides() {
    let training = sim("--runtime training");
    let mut expected = with_server_fields(SimConfig::live_content(), &training);
    expected.training = training.training;
    expected.dummies = training.dummies;
    expected.quests = training.quests;
    expected.hazards = training.hazards;
    expected.mob_mode = training.mob_mode;
    expected.initial_loot = training.initial_loot;
    assert_eq!(training, expected);
}
