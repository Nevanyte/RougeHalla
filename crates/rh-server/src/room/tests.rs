//! Unit tests of the room task, with the helpers the sibling test files share (`cfg`, `drain`, `source_arena`).

use super::*;

mod bot_fill;
mod pickups;
mod tick_rate;
mod training;
mod transport;
mod trophy;

mod trophy_fixture {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/support/trophy_fixture.rs"
    ));
}

/// Protocol 8 admits the source lifecycle transport; constructing a direct room must not panic and keeps the lobby
/// phase until the first steps close it (the Wish profile remains refused).
#[test]
fn arena_profile_direct_room_construction_is_admitted_transport() {
    let mut config = cfg(Duration::from_millis(50));
    config.sim.lifecycle = rh_sim::ArenaMode::Source(Default::default());
    config.fixed_secrets = None;
    let (tx, _) = mpsc::unbounded_channel();
    let room = Room::new([0; 16], config, tx, Instant::now());
    assert_eq!(room.sim.phase(), Phase::Lobby);
}

/// The admitted rh-map/2 export the arena capture uses: spawn pool, coliseum and planning walks. The map is copied
/// without modification (never generated here), exactly as the parity harness attaches it to its Arena.
pub(super) fn source_arena() -> rh_sim::Arena {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/arena/source.json"
    ))
    .expect("parity/arena/source.json");
    let source: serde_json::Value = serde_json::from_str(&text).expect("arena capture json");
    let export: rh_sim::mapdata::MapExport =
        serde_json::from_value(source["map"]["export"].clone()).expect("rh-map/2 export");
    let (w, h, tiles, layers) = export.validate().expect("admitted map layers").into_parts();
    let spawns = layers
        .data()
        .spawns
        .iter()
        .map(|p| rh_sim::Vec2::new(p.x, p.y))
        .collect();
    rh_sim::Arena {
        map: rh_sim::TileMap::new(w, h, tiles)
            .expect("map tiles")
            .with_layers(layers)
            .expect("layers fit the tiles"),
        spawns,
    }
}

fn arena_room(
    lobby_seconds: f64,
    plan_seconds: f64,
) -> (Room, mpsc::UnboundedReceiver<RoomReport>) {
    let mut config = cfg(Duration::from_millis(50));
    let assets = MapAssets::new(source_arena()).unwrap();
    config.arena = assets.arena;
    config.welcome_map = assets.welcome_map;
    config.sim.lifecycle = rh_sim::ArenaMode::Source(rh_sim::ArenaRules {
        plan_seconds,
        ..Default::default()
    });
    config.sim.lobby_seconds = lobby_seconds;
    let (tx, rx) = mpsc::unbounded_channel();
    (Room::new([7; 16], config, tx, Instant::now()), rx)
}

pub(super) fn drain(out: &Outbox) -> Vec<ServerMsg> {
    let mut frames = Vec::new();
    assert_eq!(out.drain_into(&mut frames).close, None);
    frames
        .iter()
        .map(|f| ServerMsg::decode(f).unwrap())
        .collect()
}

/// The last complete-replacement Plan item across the frames (whether it carried a plan or cleared it).
fn latest_plan_item(messages: &[ServerMsg]) -> Option<Option<rh_protocol::WirePlan>> {
    let mut found = None;
    for message in messages {
        let ServerMsg::State { items, .. } = message else {
            continue;
        };
        for item in items {
            if let rh_protocol::StateItem::Plan(plan) = item {
                found = Some(plan.clone());
            }
        }
    }
    found
}

#[test]
fn explicitly_configured_full_wish_room_construction_is_admitted() {
    let mut config = cfg(Duration::from_millis(50));
    config.sim.abilities = rh_sim::abilities::Mode::Full;
    config.sim.lifecycle = rh_sim::ArenaMode::Off;
    config.fixed_secrets = None;
    let (tx, _) = mpsc::unbounded_channel();
    let room = Room::new([0; 16], config, tx, Instant::now());
    assert_eq!(room.sim.config().abilities, rh_sim::abilities::Mode::Full);
}

pub(super) fn cfg(tick: Duration) -> RoomConfig {
    let assets = MapAssets::new(rh_sim::arenas::practice_arena()).unwrap();
    RoomConfig {
        sim: SimConfig {
            walk_hints: None,
            hitboxes: Default::default(),
            mob_spacing: Default::default(),
            regen_in_combat: rh_sim::RegenInCombat::Legacy,
            camp_buffs: rh_sim::CampBuffRule::Legacy,
            frost_wish: rh_sim::FrostWish::Freeze,
            augments: rh_sim::AugmentRule::Legacy,
            elites: rh_sim::EliteRule::Legacy,
            regen: false,
            training: false,
            dummies: false,
            consumables: true,
            abilities: rh_sim::abilities::Mode::Off,
            wish_lock_ms: rh_sim::abilities::WISH_LOCK_MS,
            hazards: rh_sim::terrain::Mode::Off,
            lifecycle: rh_sim::ArenaMode::Off,
            mob_mode: rh_sim::mob_runtime::MobMode::Off,
            initial_loot: false,
            min_players: 2,
            lobby_seconds: 30.0,
            fill_seconds: 0.0,
            pvp_rules: true,
            weapon_specials: true,
            faction_mode: rh_sim::FactionMode::Off,
            // Off until the coordinator-owned quest transport packet lands; the lifecycle has its own config switch.
            quests: false,
            tick_ms: 50,
        },
        arena: assets.arena,
        welcome_map: assets.welcome_map,
        fill_bots_to: 0,
        tick,
        record: false,
        fixed_secrets: Some(Secrets::from_seed(7)),
        fixed_bot_seed: Some(7),
        reconnect_grace: RECONNECT_GRACE,
        linger: LINGER,
    }
}

fn decoded(out: &Outbox) -> Vec<rh_protocol::ServerMsg> {
    let mut raw = Vec::new();
    let _ = out.drain_into(&mut raw);
    raw.iter()
        .map(|f| rh_protocol::ServerMsg::decode(f).unwrap())
        .collect()
}
