//! P-FROST-WALL-2 oracle (server): a room's Welcome tells the client which Wish Frost has in that room (HUD term 23:
//! 0 Freeze, 1 Frost Wall), from the room's own `SimConfig::frost_wish`, and carries the wall's numbers in either room.
use rh_protocol::{HudTerm, ServerMsg, WireHudContent};
use rh_server::outbox::Outbox;
use rh_server::room::{MapAssets, Room, RoomCmd, RoomConfig};
use rh_sim::map::tile_to_world_center;
use rh_sim::{Arena, FrostWish, SimConfig, TileMap, Vec2};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;

fn arena() -> Arena {
    let rows: Vec<String> = (0..8)
        .map(|y| {
            (0..12)
                .map(|x| {
                    if x == 0 || y == 0 || x == 11 || y == 7 {
                        '#'
                    } else {
                        '.'
                    }
                })
                .collect()
        })
        .collect();
    Arena {
        map: TileMap::from_rows(&rows).unwrap(),
        spawns: vec![
            Vec2::new(tile_to_world_center(5), tile_to_world_center(4)),
            Vec2::new(tile_to_world_center(6), tile_to_world_center(4)),
        ],
    }
}

fn welcome_hud(wish: FrostWish) -> WireHudContent {
    let assets = MapAssets::new(arena()).unwrap();
    let (tx, _reports) = mpsc::unbounded_channel();
    let now = Instant::now();
    let cfg = RoomConfig {
        sim: SimConfig {
            abilities: rh_sim::abilities::Mode::Full,
            frost_wish: wish,
            min_players: 2,
            lobby_seconds: 30.0,
            ..Default::default()
        },
        arena: assets.arena.clone(),
        welcome_map: assets.welcome_map.clone(),
        fill_bots_to: 0,
        tick: Duration::from_millis(50),
        record: false,
        fixed_secrets: None,
        fixed_bot_seed: None,
        reconnect_grace: Duration::from_secs(10),
        linger: Duration::from_secs(5),
    };
    let mut room = Room::new([7; 16], cfg, tx, now);
    let (reply, mut rx) = oneshot::channel();
    room.handle(
        RoomCmd::Join {
            profile: "alpha".into(),
            faction: None,
            outbox: Arc::new(Outbox::default()),
            conn: 1,
            fence: 1,
            reply,
        },
        now,
    );
    let ok = rx.try_recv().expect("replied").expect("seated");
    let ServerMsg::Welcome { hud, .. } = ServerMsg::decode(&ok.welcome).expect("a Welcome") else {
        panic!("not a Welcome")
    };
    hud
}

fn term(h: &WireHudContent, code: HudTerm) -> Option<f64> {
    h.terms
        .iter()
        .find(|t| t.code == code as u8)
        .map(|t| t.value)
}

#[test]
fn the_welcome_names_the_room_s_frost_wish() {
    let freeze = welcome_hud(FrostWish::Freeze);
    let wall = welcome_hud(FrostWish::Wall);
    assert_eq!(
        term(&freeze, HudTerm::FrostWish),
        Some(0.0),
        "a Freeze room"
    );
    assert_eq!(
        term(&wall, HudTerm::FrostWish),
        Some(1.0),
        "a Frost Wall room"
    );
    for h in [&freeze, &wall] {
        assert_eq!(term(h, HudTerm::FrostWallRange), Some(450.0));
        assert_eq!(term(h, HudTerm::FrostWallLength), Some(224.0));
    }
    assert_eq!(
        freeze,
        rh_policy::delivery::projection::wire_hud_for(FrostWish::Freeze)
    );
    assert_eq!(
        wall,
        rh_policy::delivery::projection::wire_hud_for(FrostWish::Wall)
    );
}
