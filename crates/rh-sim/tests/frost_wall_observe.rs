//! P-FROST-WALL-2 oracle (observation): a standing Frost Wall reaches every viewer who may see it. Amended by
//! P-FROST-WALL-NOWALL-1 (coordinator-approved; proposed DEV-036): its owner always, and any other viewer to whom at
//! least one of its tiles is visible (`status_runtime/observe.rs` `project`). P-FROST-WALL-2 pinned legacy's drawing rule,
//! the one every non-trail field keeps: its first point `(x, y)` visible. A wall field's `(x, y)` is its segment's first end (`seg.x1, seg.y1`,
//! `systems/abilities/effects.rs` wall landing), as in legacy, whose client and bots tested `canSee` on the field's
//! `(x, y)` for every kind but a trail (78dd8bd4 `client/src/render/FieldView.ts` `update`; in-repo
//! `server/src/bots/brain/perception.ts:816` `seeFields`). The wall carries its tiles: the barrier row the sim blocks on.
//! The landing cue's centre follows its own point rule (`observe.rs` `to_seen`, `wish_point_permissions`).
//! Amended by P-FROST-WALL-PUBLIC-1 (owner decision 2026-11-14: a standing wall is temporary terrain, public like the
//! map): every seated viewer is sent every standing wall, whole; the owner is named only to a viewer who sees it, and
//! the landing centre keeps its own rule. The far viewer below now receives the wall.
//!
//! Scene: a 40 x 80 open room with a wall border. Frost at tile (5, 40) aims east at tile (12, 40): the wall stands
//! across column 12, rows 37..=43 (indices `y * 40 + 12`), its first end at (400, 1408), its second at (400, 1184), its
//! centre at (400, 1296). Vision radius 900 (`constants.rs` `VISION_RADIUS`), no sight blocker near the wall.
use rh_sim::abilities::{Mode, Slot};
use rh_sim::status_runtime::{AbilityId, FieldKind, FieldView};
use rh_sim::{
    observe, public_snapshot, validate, Arena, Event, FactionId, FrostWish, Observation, Placement,
    PlayerId, RawCommand, Secrets, SeenEvent, Sim, SimConfig, TileMap, Vec2,
};

const W: u32 = 40;
const H: u32 = 80;

fn tc(t: u32) -> f64 {
    f64::from(t) * 32. + 16.
}

fn config(wish: FrostWish) -> SimConfig {
    SimConfig {
        abilities: Mode::Full,
        wish_lock_ms: 0.,
        frost_wish: wish,
        quests: false,
        consumables: false,
        ..Default::default()
    }
}

/// Each fighter spawns where it is placed (spawns are dealt round-robin before placements apply, and a spawn's first
/// reveal is remembered for 30 s: one shared spawn would let every viewer remember the caster's surroundings).
fn arena(spawns: Vec<Vec2>) -> Arena {
    let mut tiles = vec![0u8; (W * H) as usize];
    for y in 0..H {
        for x in 0..W {
            if x == 0 || y == 0 || x == W - 1 || y == H - 1 {
                tiles[(y * W + x) as usize] = 1;
            }
        }
    }
    Arena {
        map: TileMap::new(W, H, tiles).unwrap(),
        spawns,
    }
}

/// The caster and four viewers (slot order = `Sim::players()` order):
/// 0 Frost caster at (176, 1296);
/// 1 `near` (656, 1296): sees the whole wall, the centre and the caster;
/// 2 `far` (656, 2512): more than 900 from every point of the wall and from the caster;
/// 3 `first_end` (400, 2240): 832 from the first end, 1056 from the second, 944 from the centre, 970 from the caster;
/// 4 `second_end` (400, 360): 824 from the second end, 1048 from the first, 936 from the centre, 962 from the caster.
fn rig(wish: FrostWish) -> Sim {
    let at = [
        (FactionId::Frost, Vec2::new(tc(5), tc(40))),
        (FactionId::Fire, Vec2::new(656., 1296.)),
        (FactionId::Holy, Vec2::new(656., 2512.)),
        (FactionId::Plague, Vec2::new(400., 2240.)),
        (FactionId::Sentenced, Vec2::new(400., 360.)),
    ];
    let placements: Vec<Placement> = at
        .into_iter()
        .enumerate()
        .map(|(i, (faction, at))| Placement {
            profile: format!("p{i}"),
            faction,
            bot: false,
            at,
            hp: Some(1e9),
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let spawns = placements.iter().map(|p| p.at).collect();
    let mut s = Sim::reset_active(
        config(wish),
        arena(spawns),
        Secrets::from_seed(7),
        &placements,
    );
    // Past the 30 s sight memory (`VISION_TRAIL_MS`), so each viewer sees only from where it stands.
    for _ in 0..640 {
        s.step();
    }
    s
}

fn id(s: &Sim, i: usize) -> PlayerId {
    s.players()[i].id
}

const CASTER: usize = 0;
const NEAR: usize = 1;
const FAR: usize = 2;
const FIRST_END: usize = 3;
const SECOND_END: usize = 4;

fn the_tiles() -> Vec<u32> {
    (37..=43).map(|y| y * W + 12).collect()
}

/// Casts the Wish at tile (12, 40) and steps until the cast has landed; returns every step's events, and the observation
/// of each slot taken right after each step (`obs[step][slot]`).
fn cast_and_watch(s: &mut Sim, steps: usize) -> Vec<Vec<Observation>> {
    let who = id(s, CASTER);
    let cmd = validate(RawCommand::Cast {
        slot: Slot::Wish,
        x: tc(12),
        y: tc(40),
        id: None,
        t: None,
        seq: None,
    })
    .unwrap();
    // Freeze needs a unit: under Freeze the cast is refused, which is what the Freeze guard wants.
    let _ = s.submit(who, cmd);
    let viewers: Vec<PlayerId> = (0..5).map(|i| id(s, i)).collect();
    (0..steps)
        .map(|_| {
            let events: Vec<Event> = s.step();
            viewers.iter().map(|&v| observe(s, v, &events)).collect()
        })
        .collect()
}

fn walls(o: &Observation) -> Vec<&FieldView> {
    o.fields
        .iter()
        .filter(|f| f.kind == FieldKind::Wall)
        .collect()
}

fn landing_points(o: &Observation) -> Vec<Option<Vec2>> {
    o.events
        .iter()
        .filter_map(|e| match e {
            SeenEvent::CastLanded { at, .. } => Some(*at),
            _ => None,
        })
        .collect()
}

/// 250 ms cast plus a margin: the wall stands from the landing step.
const LANDED: usize = 8;

#[test]
fn a_viewer_in_sight_of_the_wall_receives_it_with_its_tiles_owner_and_end_time() {
    let mut s = rig(FrostWish::Wall);
    let obs = cast_and_watch(&mut s, LANDED);
    let last = &obs[LANDED - 1];
    let caster = id(&s, CASTER);
    for slot in [CASTER, NEAR] {
        let got = walls(&last[slot]);
        assert_eq!(got.len(), 1, "slot {slot} sees the standing wall: {got:?}");
        let w = got[0];
        assert_eq!(
            w.tiles,
            the_tiles(),
            "the wall's tiles, ascending row-major (column 12, rows 37..=43)"
        );
        assert_eq!(
            w.ability,
            AbilityId::Freeze,
            "Frost's Wish keeps the id Freeze under Wall (P-FROST-WALL-1)"
        );
        assert_eq!(
            w.owner,
            Some(caster),
            "the caster is seen, so the owner is named"
        );
        assert_eq!(
            (w.x, w.y, w.x2, w.y2),
            (400., 1408., 400., 1184.),
            "the segment's two ends"
        );
        assert_eq!(
            w.ends_at - w.started_at,
            4000.,
            "it stands for FROST_WALL_MS"
        );
    }
    // The wall's ice is the sim's own barrier: the observed tiles are exactly the tiles bodies stop on.
    assert_eq!(walls(&last[NEAR])[0].tiles.len(), 7);
}

/// Amended by P-FROST-WALL-PUBLIC-1: the far viewer (out of sight of the wall and of the caster) receives the whole
/// wall, unnamed, and still never the landing centre.
#[test]
fn a_viewer_out_of_sight_receives_the_wall_but_neither_its_owner_nor_its_landing_centre() {
    let mut s = rig(FrostWish::Wall);
    let obs = cast_and_watch(&mut s, LANDED);
    // The wall did stand, and the near viewer was told where it landed: the test is not vacuous.
    assert!(
        obs.iter()
            .flat_map(|o| landing_points(&o[NEAR]))
            .any(|p| p == Some(Vec2::new(400., 1296.))),
        "the near viewer receives the landing centre"
    );
    assert!(
        !walls(&obs[LANDED - 1][NEAR]).is_empty(),
        "the wall stands for the near viewer"
    );
    let far = walls(&obs[LANDED - 1][FAR]);
    assert_eq!(
        far.len(),
        1,
        "the far viewer receives the standing wall: it is public like the map"
    );
    assert_eq!(far[0].tiles, the_tiles(), "with all its tiles");
    assert_eq!(
        (far[0].x, far[0].y, far[0].x2, far[0].y2),
        (400., 1408., 400., 1184.),
        "and both ends"
    );
    assert_eq!(
        far[0].owner, None,
        "the caster is out of its sight: no owner"
    );
    for o in &obs {
        assert!(
            landing_points(&o[FAR]).iter().all(Option::is_none),
            "the far viewer never receives the landing centre: {:?}",
            landing_points(&o[FAR])
        );
    }
}

/// Amended by P-FROST-WALL-NOWALL-1 (coordinator-approved, flagged to the owner; proposed DEV-036). P-FROST-WALL-2 pinned
/// legacy's drawing rule here: a wall shown only when its FIRST end is visible. Now a viewer other than the owner is sent
/// the whole wall when ANY of its tiles is visible to it. The first-end viewer (its first end and the two tiles beside
/// it in sight) still receives the whole wall; the second-end viewer (rows 37 and 38 in sight, the first end not) now
/// receives it too. Neither sees the wall's centre, so neither receives the landing centre (its own point rule).
#[test]
fn the_wall_is_shown_to_a_viewer_who_sees_any_of_its_tiles() {
    let mut s = rig(FrostWish::Wall);
    let obs = cast_and_watch(&mut s, LANDED);
    let last = &obs[LANDED - 1];
    let first = walls(&last[FIRST_END]);
    assert_eq!(first.len(), 1, "sees the first end: receives the wall");
    assert_eq!(first[0].tiles, the_tiles(), "with all its tiles");
    assert_eq!(
        first[0].owner, None,
        "the caster is out of its sight: no owner"
    );
    let second = walls(&last[SECOND_END]);
    assert_eq!(
        second.len(),
        1,
        "sees the second end and two of its tiles, not the first end: receives the wall"
    );
    assert_eq!(second[0].tiles, the_tiles(), "with all its tiles");
    assert_eq!(
        second[0].owner, None,
        "the caster is out of its sight: no owner"
    );
    // Neither sees the centre, so neither receives the landing centre.
    for slot in [FIRST_END, SECOND_END] {
        for o in &obs {
            assert!(
                landing_points(&o[slot]).iter().all(Option::is_none),
                "slot {slot}: no landing centre"
            );
        }
    }
}

#[test]
fn an_unseated_viewer_receives_no_wall_and_no_landing_centre() {
    let mut s = rig(FrostWish::Wall);
    let who = id(&s, CASTER);
    let cmd = validate(RawCommand::Cast {
        slot: Slot::Wish,
        x: tc(12),
        y: tc(40),
        id: None,
        t: None,
        seq: None,
    })
    .unwrap();
    s.submit(who, cmd).unwrap();
    let nobody = PlayerId(9_999);
    let mut stood = false;
    for _ in 0..LANDED {
        let events = s.step();
        let o = observe(&s, nobody, &events);
        assert!(o.fields.is_empty(), "an unseated viewer sees no field");
        assert!(landing_points(&o).iter().all(Option::is_none));
        stood |= !walls(&observe(&s, id(&s, NEAR), &events)).is_empty();
    }
    assert!(stood, "the wall stood for a seated viewer");
}

#[test]
fn the_public_snapshot_carries_the_standing_wall() {
    let mut s = rig(FrostWish::Wall);
    cast_and_watch(&mut s, LANDED);
    let snap = public_snapshot(&s);
    let got: Vec<_> = snap
        .fields
        .iter()
        .filter(|f| f.kind == FieldKind::Wall)
        .collect();
    assert_eq!(
        got.len(),
        1,
        "the public view (spectators, replays) shows the wall"
    );
    assert_eq!(got[0].tiles, the_tiles());
}

#[test]
fn the_wall_leaves_every_observation_when_it_falls() {
    let mut s = rig(FrostWish::Wall);
    // 250 ms cast + 4000 ms standing = 85 steps; watch to 100.
    let obs = cast_and_watch(&mut s, 100);
    let standing: Vec<usize> = (0..obs.len())
        .filter(|&i| !walls(&obs[i][NEAR]).is_empty())
        .collect();
    assert!(!standing.is_empty(), "the wall was observed standing");
    let fell = *standing.last().unwrap() + 1;
    assert!(fell < obs.len(), "and then fell");
    let ends_at = walls(&obs[fell - 1][NEAR])[0].ends_at;
    for o in &obs[fell..] {
        for (slot, v) in o.iter().enumerate() {
            assert!(
                walls(v).is_empty(),
                "slot {slot}: a fallen wall is in no observation"
            );
        }
    }
    assert!(s.server_time() >= ends_at, "it fell at its end time");
    assert!(
        standing.windows(2).all(|p| p[1] == p[0] + 1),
        "it was seen on every step it stood"
    );
}

/// Guard (green today): under the default Wish nothing is a wall, in any observation or the public snapshot.
#[test]
fn guard_with_freeze_no_observation_contains_a_wall() {
    let mut s = rig(FrostWish::Freeze);
    let obs = cast_and_watch(&mut s, 100);
    for o in &obs {
        for v in o {
            assert!(walls(v).is_empty());
            assert!(
                v.fields.iter().all(|f| f.tiles.is_empty()),
                "no field carries tiles"
            );
        }
    }
    assert!(public_snapshot(&s)
        .fields
        .iter()
        .all(|f| f.kind != FieldKind::Wall));
}

#[test]
fn the_observation_identity_moves_for_the_wall() {
    assert_eq!(
        rh_sim::OBSERVATION_VERSION,
        30,
        "Observation.fields carries standing walls (FieldKind::Wall) and FieldView gains their tiles (P-FROST-WALL-2)"
    );
}
