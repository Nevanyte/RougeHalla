//! P-FROST-WALL-PUBLIC-1 oracle (delivery): a standing Frost Wall is temporary terrain, public like the map (owner
//! decision 2026-11-14). A bot-seated viewer behind a rock screen, who sees neither the wall nor its caster, receives the
//! wall in State key 3 (`CollectionPublisher`, the publisher the server's rooms and the bot seats share) as field kind 3
//! with every tile and no owner, and its decoded seat view (`CollectionView`) holds the same row. The identities do not
//! move: which walls a seat receives changes, not the shape of what it receives (`frost_wall_delivery.rs` pins 30 / 25).
use rh_policy::delivery::collections::CollectionPublisher;
use rh_policy::delivery::CollectionView;
use rh_protocol::{ServerMsg, StateItem, WireField};
use rh_sim::abilities::{Mode, Slot};
use rh_sim::{
    observe, validate, Arena, FactionId, FrostWish, Placement, RawCommand, Secrets, Sim, SimConfig,
    TileMap, Vec2,
};

fn tc(t: u32) -> f64 {
    f64::from(t) * 32. + 16.
}

/// The legacy 40 x 20 room with a full rock screen on columns 20..=21: Frost at (5, 10) aims at (12, 10), raising its
/// wall on column 12, rows 7..=13; a bot-seated Fire viewer stands at (30, 10), behind the screen.
fn run() -> (Sim, rh_sim::Observation) {
    let (w, h) = (40u32, 20u32);
    let mut tiles = vec![0u8; (w * h) as usize];
    for y in 0..h {
        for x in 0..w {
            if x == 0 || y == 0 || x == w - 1 || y == h - 1 || (20..=21).contains(&x) {
                tiles[(y * w + x) as usize] = 1;
            }
        }
    }
    let at = [Vec2::new(tc(5), tc(10)), Vec2::new(tc(30), tc(10))];
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
        frost_wish: FrostWish::Wall,
        quests: false,
        consumables: false,
        ..Default::default()
    };
    let arena = Arena {
        map: TileMap::new(w, h, tiles).unwrap(),
        spawns: at.to_vec(),
    };
    let mut s = Sim::reset_active(config, arena, Secrets::from_seed(7), &placements);
    // Past the 30 s sight memory of the dealt spawns.
    for _ in 0..640 {
        s.step();
    }
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
    s.submit(caster, cmd).unwrap();
    let mut last = None;
    for _ in 0..8 {
        let events = s.step();
        last = Some(observe(&s, viewer, &events));
    }
    (s, last.unwrap())
}

#[test]
fn a_bot_seat_behind_a_rock_screen_receives_the_standing_wall_in_key_3_without_its_owner() {
    let (s, obs) = run();
    let caster = s.players()[0].id;
    assert!(
        obs.visible.iter().all(|a| a.id != caster),
        "the scene: the viewer does not see the caster"
    );
    let want: Vec<u32> = (7..=13).map(|y| y * 40 + 12).collect();
    assert!(
        rh_sim::public_snapshot(&s)
            .fields
            .iter()
            .any(|f| f.tiles == want),
        "the scene: the wall stands on column 12, rows 7..=13"
    );
    let pending = CollectionPublisher::default()
        .prepare(&obs, false, false, false)
        .expect("the observation encodes");
    let frame = pending.frame.expect("a first, full State");
    let msg = ServerMsg::decode(&frame).expect("a State frame every decoder accepts");
    let ServerMsg::State { items, .. } = &msg else {
        panic!("not a State frame")
    };
    let fields: Vec<WireField> = items
        .iter()
        .find_map(|i| match i {
            StateItem::Fields(f) => Some(f.clone()),
            _ => None,
        })
        .expect("key 3 in a full State");
    let walls: Vec<&WireField> = fields.iter().filter(|f| f.kind == 3).collect();
    assert_eq!(
        walls.len(),
        1,
        "the seat behind the screen is sent the standing wall (public like the map): {fields:?}"
    );
    assert_eq!(walls[0].tiles, want, "every tile, ascending");
    assert_eq!(
        walls[0].owner, None,
        "the caster is out of the seat's sight: no owner (C-OBS)"
    );
    assert_eq!(walls[0].ends_at - walls[0].started_at, 4000.);
    let mut view = CollectionView::default();
    view.apply(&msg).expect("the seat's view accepts it");
    assert_eq!(
        view.fields(),
        &fields[..],
        "the fair seat's decoded view holds the same rows as the wire"
    );
}
