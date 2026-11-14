//! P-FROST-WALL-3 oracle (rh-server): the live server plays Frost Wall. The live profiles, through the server's own
//! argument parsing (`Settings::from_args`, then `Settings::sim` / `Settings::arena`), select the wall; in a live
//! source-arena room on the admitted seed-1 map (the live content world with the server's own timers; the practice room
//! seats one human, `room.rs:913-915`) a Frost player's Wish cast at a ground point raises a wall that a SECOND
//! connected client receives in its State (field kind 3 with its tiles), and that client's Welcome says Frost's Wish is
//! the wall (HUD term 23 = 1). The practice room's Welcome says so too.
//!
//! Under today's `Freeze` the same cast is refused (Freeze needs a unit), so no wall reaches anyone and the Welcome says
//! 0. The room is driven by hand on the 50 ms grid (`Room::handle` / `Room::wake`, as `publish.rs` and
//! `frost_wall_welcome.rs` do); positions and the aim are read from the room's own simulation and map.
use rh_protocol::state::FIELD_KIND_WALL;
use rh_protocol::{HudTerm, ServerMsg, StateItem, WireCommand, WireField, WireHudContent};
use rh_server::outbox::Outbox;
use rh_server::room::{JoinOk, MapAssets, Room, RoomCmd, RoomConfig};
use rh_server::runtime::Settings;
use rh_sim::{FactionId, FrostWish, Phase, PlayerId, Secrets, TileMap, Vec2};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;

const TICK: Duration = Duration::from_millis(50);

fn args(s: &str) -> Vec<String> {
    s.split_whitespace().map(str::to_owned).collect()
}

fn settings(s: &str) -> Settings {
    Settings::from_args(&args(s))
        .unwrap_or_else(|e| panic!("{s}: {e}"))
        .unwrap_or_else(|| panic!("{s}: not a runtime profile"))
}

#[test]
fn the_live_profiles_select_frost_wall() {
    for flags in [
        "--runtime source-arena --map x",
        "--runtime source-arena --map x --hitboxes legacy",
        "--runtime source-arena --map x --map-pool --signature-landmarks",
        "--runtime source-arena --map x --lobby-timing matchmaking",
        "--runtime training",
        "--runtime training --hitboxes legacy",
    ] {
        assert_eq!(settings(flags).sim().frost_wish, FrostWish::Wall, "{flags}");
    }
}

/// A seated client of the hand-driven room.
struct Client {
    player: PlayerId,
    welcome: Vec<u8>,
    out: Arc<Outbox>,
    conn: u64,
    seq: u32,
}

struct LiveRoom {
    room: Room,
    now: Instant,
    _reports: mpsc::UnboundedReceiver<rh_server::room::RoomReport>,
}

impl LiveRoom {
    /// A room exactly as the live server configures it for `flags` (its `Settings::sim` and `Settings::arena`), with
    /// fixed secrets and no fill bots.
    fn live(flags: &str) -> Self {
        let live = settings(flags);
        let assets = MapAssets::new(live.arena().expect("the profile's arena")).expect("assets");
        let (tx, reports) = mpsc::unbounded_channel();
        let now = Instant::now();
        let cfg = RoomConfig {
            sim: live.sim(),
            arena: assets.arena.clone(),
            welcome_map: assets.welcome_map.clone(),
            fill_bots_to: 0,
            tick: TICK,
            record: false,
            fixed_secrets: Some(Secrets::from_seed(3)),
            fixed_bot_seed: Some(5),
            reconnect_grace: Duration::from_secs(10),
            linger: Duration::from_secs(3600),
        };
        Self {
            room: Room::new([3; 16], cfg, tx, now),
            now,
            _reports: reports,
        }
    }

    fn join(&mut self, profile: &str, faction: FactionId, conn: u64) -> Client {
        let out = Arc::new(Outbox::default());
        let (reply, mut rx) = oneshot::channel();
        self.room.handle(
            RoomCmd::Join {
                profile: profile.into(),
                faction: Some(faction),
                outbox: out.clone(),
                conn,
                fence: 1,
                reply,
            },
            self.now,
        );
        let ok: JoinOk = rx.try_recv().expect("replied").expect("seated");
        Client {
            player: ok.player,
            welcome: ok.welcome,
            out,
            conn,
            seq: 0,
        }
    }

    fn send(&mut self, c: &mut Client, cmd: WireCommand) {
        c.seq += 1;
        self.room.handle(
            RoomCmd::Input {
                received: std::time::Instant::now(),
                player: c.player,
                conn: c.conn,
                seq: c.seq,
                commands: vec![cmd],
            },
            self.now,
        );
    }

    fn wake(&mut self) {
        self.now += TICK;
        assert!(self.room.wake(self.now), "the room stays open");
    }

    fn pos(&self, p: PlayerId) -> Vec2 {
        self.room.sim().player(p).expect("seated").pos()
    }
}

fn dist(a: Vec2, b: Vec2) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

/// Every wall row in the State frames waiting in `c`'s outbox (drained).
fn walls_told(c: &Client) -> Vec<WireField> {
    let mut frames = Vec::new();
    c.out.drain_into(&mut frames);
    frames
        .iter()
        .filter_map(|f| match ServerMsg::decode(f) {
            Ok(ServerMsg::State { items, .. }) => Some(items),
            _ => None,
        })
        .flatten()
        .filter_map(|item| match item {
            StateItem::Fields(fields) => Some(fields),
            _ => None,
        })
        .flatten()
        .filter(|f| f.kind == FIELD_KIND_WALL)
        .collect()
}

fn welcome_frost_wish(c: &Client) -> Option<f64> {
    let ServerMsg::Welcome { hud, .. } = ServerMsg::decode(&c.welcome).expect("a Welcome") else {
        panic!("not a Welcome")
    };
    let hud: WireHudContent = hud;
    hud.terms
        .iter()
        .find(|t| t.code == HudTerm::FrostWish as u8)
        .map(|t| t.value)
}

/// The source-arena flags of the live server with the lobby shortened (the timers are the server's own fields, which
/// `crates/rh-server/tests/live_content.rs` shows change nothing else) on the admitted seed-1 map.
fn source_flags() -> String {
    format!(
        "--runtime source-arena --map {}/../rh-sim/src/mapdata/fixtures/seed1.map.json --min-players 2 \
         --lobby-seconds 0 --fill-seconds 0",
        env!("CARGO_MANIFEST_DIR")
    )
}

fn tile_of(map: &TileMap, p: Vec2) -> u32 {
    (p.y / 32.).floor() as u32 * map.w + (p.x / 32.).floor() as u32
}

/// A ground point 160 u from `from` (inside the wall's 64..=450 reach) whose wall, by the sim's own rule
/// (`rh_sim::barriers::wall_segment_for` / `wall_cells` on the static map), stands on open floor across its whole
/// length and on the aim point's own tile, and is well clear of `viewer`.
fn open_aim(map: &TileMap, from: Vec2, viewer: Vec2) -> Option<Vec2> {
    let full = (rh_sim::abilities::FROST_WALL_LENGTH / 32.).floor() as usize;
    (0..16).find_map(|k| {
        let a = f64::from(k) * std::f64::consts::PI / 8.;
        let at = Vec2::new(from.x + 160. * a.cos(), from.y + 160. * a.sin());
        let seg = rh_sim::barriers::wall_segment_for(
            from,
            at,
            rh_sim::abilities::FROST_WALL_RANGE,
            rh_sim::abilities::FROST_WALL_MIN_RANGE,
            rh_sim::abilities::FROST_WALL_LENGTH,
            0.,
        );
        let mut cells = Vec::new();
        rh_sim::barriers::wall_cells(map, &seg, &mut cells);
        (cells.len() >= full && cells.contains(&tile_of(map, at)) && dist(viewer, at) > 160.)
            .then_some(at)
    })
}

#[test]
fn a_live_frost_wish_cast_at_the_ground_raises_a_wall_that_a_second_client_receives() {
    let mut r = LiveRoom::live(&source_flags());
    let mut caster = r.join("alpha", FactionId::Frost, 1);
    let mut viewer = r.join("bravo", FactionId::Holy, 2);
    // Lobby (0 s with two humans), then planning: both ready at once.
    let mut planning = false;
    for _ in 0..200 {
        r.wake();
        if r.room.sim().phase() == Phase::Planning {
            planning = true;
            break;
        }
    }
    assert!(planning, "setup: the room reaches planning");
    for c in [&mut caster, &mut viewer] {
        r.send(
            c,
            WireCommand::Plan {
                spawn: Some(0),
                boon: None,
                ready: Some(true),
            },
        );
    }
    let mut active = false;
    for _ in 0..1200 {
        r.wake();
        let _ = walls_told(&viewer);
        let _ = walls_told(&caster);
        if r.room.sim().phase() == Phase::Active {
            active = true;
            break;
        }
    }
    assert!(active, "setup: the raid starts");
    assert_eq!(
        r.room.sim().player(caster.player).unwrap().faction_id(),
        Some(FactionId::Frost),
        "setup: the caster plays Frost"
    );
    // The viewer walks to the caster while the Wish lock runs out (WISH_LOCK_MS = 45 s on the live profile).
    let mut ready = false;
    for n in 0..2400 {
        if n % 20 == 0 {
            let c = r.pos(caster.player);
            r.send(
                &mut viewer,
                WireCommand::Move {
                    x: (c.x + 48.) as f32,
                    y: c.y as f32,
                    seq: None,
                },
            );
        }
        r.wake();
        let _ = walls_told(&viewer);
        let _ = walls_told(&caster);
        let wish_ready = r
            .room
            .sim()
            .player(caster.player)
            .unwrap()
            .stocks
            .wish_ready_at
            <= r.room.sim().server_time();
        if wish_ready && dist(r.pos(viewer.player), r.pos(caster.player)) < 200. {
            ready = true;
            break;
        }
    }
    let (c, v) = (r.pos(caster.player), r.pos(viewer.player));
    assert!(
        ready,
        "setup: the caster's Wish is ready with the viewer beside it (caster {c:?}, viewer {v:?})"
    );
    let map = &r.room.sim().shared_arena().map;
    let aim = open_aim(map, c, v)
        .unwrap_or_else(|| panic!("setup: open ground for a wall near the caster at {c:?}"));
    let aim_tile = tile_of(map, aim);

    r.send(
        &mut caster,
        WireCommand::Cast {
            slot: 0, // the Wish
            x: aim.x as f32,
            y: aim.y as f32,
            actor: None,
            t: None,
            seq: None,
        },
    );
    let mut told = Vec::new();
    for _ in 0..20 {
        r.wake();
        told.extend(walls_told(&viewer));
    }
    let wall = told.iter().find(|f| !f.tiles.is_empty());
    assert!(
        wall.is_some(),
        "the second client's State carries the Frost Wall (field kind {FIELD_KIND_WALL} with its tiles); told {told:?}"
    );
    let wall = wall.unwrap();
    assert!(
        wall.tiles.contains(&aim_tile),
        "the wall stands across the aim point's tile {aim_tile} ({:?})",
        wall.tiles
    );
    assert_eq!(wall.owner, Some(caster.player.0), "the caster owns it");
    assert_eq!(
        welcome_frost_wish(&viewer),
        Some(1.0),
        "the second client's Welcome says Frost's Wish is the wall"
    );
}

#[test]
fn the_practice_rooms_welcome_says_frost_wall() {
    let mut r = LiveRoom::live("--runtime training");
    let c = r.join("alpha", FactionId::Holy, 1);
    assert_eq!(
        welcome_frost_wish(&c),
        Some(1.0),
        "a live practice room's Welcome (HUD term 23) says Frost's Wish is the wall (0 Freeze, 1 Frost Wall)"
    );
}
