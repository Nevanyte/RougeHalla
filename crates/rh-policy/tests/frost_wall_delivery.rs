//! P-FROST-WALL-2 oracle (delivery): State key 3, built by `CollectionPublisher` (the publisher the server's rooms and the
//! bot seats share) from a real observation, carries a standing wall as field kind 3 with the sim's tiles; the decoded
//! view a fair seat receives (`CollectionView`) holds the same row. The Welcome's HUD block names Frost's Wish
//! (`wire_hud_for`). The identities move: the observation and the projected key 3 gain the wall.
use rh_policy::delivery::collections::CollectionPublisher;
use rh_policy::delivery::projection::{wire_hud, wire_hud_for};
use rh_policy::delivery::CollectionView;
use rh_protocol::{HudTerm, ServerMsg, StateItem, WireField, WireHudContent, HUD_TERM_COUNT};
use rh_sim::abilities::{Mode, Slot};
use rh_sim::{
    observe, validate, Arena, FactionId, FrostWish, Placement, RawCommand, Secrets, Sim, SimConfig,
    TileMap, Vec2,
};

#[test]
fn identities_move_for_the_wall() {
    assert_eq!(
        rh_sim::OBSERVATION_VERSION,
        30,
        "the observation carries standing walls with their tiles (P-FROST-WALL-2)"
    );
    assert_eq!(
        rh_policy::POLICY_CONTRACT_VERSION,
        24,
        "the projected State key 3 carries field kind 3 and its tile list (P-FROST-WALL-2)"
    );
}

fn tc(t: u32) -> f64 {
    f64::from(t) * 32. + 16.
}

/// The legacy frostWall.test.ts room (40 x 20, a wall border): Frost at (5, 10), a bot-seated Fire viewer at (20, 10).
/// Frost aims at (12, 10): the wall takes column 12, rows 7..=13.
fn run(wish: FrostWish) -> (Sim, Vec<rh_sim::Observation>) {
    let (w, h) = (40u32, 20u32);
    let mut tiles = vec![0u8; (w * h) as usize];
    for y in 0..h {
        for x in 0..w {
            if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                tiles[(y * w + x) as usize] = 1;
            }
        }
    }
    let at = [Vec2::new(tc(5), tc(10)), Vec2::new(tc(20), tc(10))];
    let placements: Vec<Placement> = [(FactionId::Frost, false), (FactionId::Fire, true)]
        .into_iter()
        .zip(at)
        .enumerate()
        .map(|(i, ((faction, bot), at))| Placement {
            profile: format!("p{i}"),
            faction,
            bot,
            at,
            hp: Some(1e9),
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let config = SimConfig {
        abilities: Mode::Full,
        wish_lock_ms: 0.,
        frost_wish: wish,
        quests: false,
        consumables: false,
        ..Default::default()
    };
    let arena = Arena {
        map: TileMap::new(w, h, tiles).unwrap(),
        spawns: at.to_vec(),
    };
    let mut s = Sim::reset_active(config, arena, Secrets::from_seed(7), &placements);
    s.step();
    let caster = s.players()[0].id;
    let viewer = s.players()[1].id;
    let cmd = validate(RawCommand::Cast {
        slot: Slot::Wish,
        x: tc(12),
        y: tc(10),
        id: None,
        t: None,
        seq: None,
    })
    .unwrap();
    let _ = s.submit(caster, cmd);
    let obs = (0..8)
        .map(|_| {
            let events = s.step();
            observe(&s, viewer, &events)
        })
        .collect();
    (s, obs)
}

fn delivered(obs: &rh_sim::Observation) -> (Vec<WireField>, CollectionView) {
    let pending = CollectionPublisher::default()
        .prepare(obs, false, false, false)
        .expect("the observation encodes");
    let frame = pending.frame.expect("a first, full State");
    let msg = ServerMsg::decode(&frame).expect("a State frame every decoder accepts");
    let ServerMsg::State { items, .. } = &msg else {
        panic!("not a State frame")
    };
    let fields = items
        .iter()
        .find_map(|i| match i {
            StateItem::Fields(f) => Some(f.clone()),
            _ => None,
        })
        .expect("key 3 in a full State");
    let mut view = CollectionView::default();
    view.apply(&msg).expect("the seat's view accepts it");
    (fields, view)
}

#[test]
fn a_standing_wall_reaches_the_seat_as_key_3_kind_3_with_its_tiles() {
    let (_, obs) = run(FrostWish::Wall);
    let last = obs.last().unwrap();
    let want: Vec<u32> = (7..=13).map(|y| y * 40 + 12).collect();
    let (fields, view) = delivered(last);
    let walls: Vec<&WireField> = fields.iter().filter(|f| f.kind == 3).collect();
    assert_eq!(walls.len(), 1, "one wall row in key 3: {fields:?}");
    assert_eq!(walls[0].tiles, want, "the sim's barrier tiles, ascending");
    assert_eq!(walls[0].ability, 0, "Frost's Wish keeps ability code 0");
    assert_eq!(walls[0].ends_at - walls[0].started_at, 4000.);
    assert_eq!(
        view.fields(),
        &fields[..],
        "the fair seat's decoded view holds the same rows as the wire"
    );
}

/// Guard (green today): under Freeze no key 3 row is a wall and none carries tiles.
#[test]
fn guard_with_freeze_key_3_has_no_wall() {
    let (_, obs) = run(FrostWish::Freeze);
    for o in &obs {
        let (fields, _) = delivered(o);
        assert!(fields.iter().all(|f| f.kind != 3 && f.tiles.is_empty()));
    }
}

fn term(h: &WireHudContent, code: HudTerm) -> f64 {
    h.terms
        .iter()
        .find(|t| t.code == code as u8)
        .unwrap_or_else(|| panic!("the block carries {code:?}"))
        .value
}

#[test]
fn the_welcome_block_names_frost_s_wish_and_carries_the_wall_s_numbers() {
    let freeze = wire_hud_for(FrostWish::Freeze);
    let wall = wire_hud_for(FrostWish::Wall);
    assert_eq!(wire_hud(), freeze, "the default block is the Freeze room's");
    for h in [&freeze, &wall] {
        let codes: Vec<u8> = h.terms.iter().map(|t| t.code).collect();
        assert_eq!(
            codes,
            (0..HUD_TERM_COUNT).collect::<Vec<_>>(),
            "every code once"
        );
        // Legacy 78dd8bd4 constants.ts (FROST_WALL_*) and barriers.ts (WALL_CELL_REACH 0.75 tile, WALL_END_SLACK 0.25).
        assert_eq!(term(h, HudTerm::FrostWallRange), 450.);
        assert_eq!(term(h, HudTerm::FrostWallMinRange), 64.);
        assert_eq!(term(h, HudTerm::FrostWallLength), 224.);
        assert_eq!(term(h, HudTerm::FrostWallMs), 4000.);
        assert_eq!(term(h, HudTerm::FrostWallCellReach), 24.);
        assert_eq!(term(h, HudTerm::FrostWallEndSlack), 8.);
    }
    assert_eq!(term(&freeze, HudTerm::FrostWish), 0.);
    assert_eq!(term(&wall, HudTerm::FrostWish), 1.);
    rh_protocol::ServerMsg::Welcome {
        protocol: rh_protocol::PROTOCOL_VERSION,
        content_hash: 0,
        match_id: [0; 16],
        player_id: 1,
        session: [0; 16],
        tick_rate: 20,
        tick: 0,
        server_ms: 0.,
        archetypes: Vec::new(),
        vision: Default::default(),
        weapons: Vec::new(),
        hud: wall,
        map: rh_protocol::map::MapBlob::new(1, 1, vec![0]),
    }
    .try_encode()
    .expect("the block passes the encoder's checks");
}
