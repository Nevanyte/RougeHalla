//! HAND-DERIVED unit tests, written from reading `packages/server/src/bots/brain/vision.ts` and
//! `packages/shared/src/vision.ts`. They are NOT parity evidence: no expectation here came from
//! an actual source run. They pin the reading of the source and act as privacy-shaped negative
//! controls (a fact outside the seat's own sight, trail, restore and wards never leaks).
use super::super::data::{num, object, text, MethodValue, Object};
use super::adapter::{percept, seed1};
use super::declared::UpdateInput;
use super::{js_key_order, BotVision};
use rh_sim::Vec2;

const SELF: &str = "p1";
const A: (f64, f64) = (784.1, 464.3);
const B: (f64, f64) = (816., 464.);
const N1: (f64, f64) = (720., 400.);
const N2: (f64, f64) = (848., 528.);
const F1: (f64, f64) = (3000., 3000.);
const BUSH: (f64, f64) = (560., 368.);
const CAMP0: (f64, f64) = (912., 1488.);

fn v((x, y): (f64, f64)) -> Vec2 {
    Vec2::new(x, y)
}
fn player((x, y): (f64, f64), status: &str, reveal: f64) -> MethodValue {
    object([
        ("x", num(x)),
        ("y", num(y)),
        ("status", text(status)),
        ("extra", object([("bushRevealUntil", num(reveal))])),
    ])
}
fn camps(owned: &[(usize, &str, f64)]) -> MethodValue {
    MethodValue::Arr(
        (0..50)
            .map(|i| match owned.iter().find(|(k, _, _)| *k == i) {
                Some((_, owner, end)) => {
                    object([("wardOwner", text(owner)), ("wardExpiresAt", num(*end))])
                }
                None => object([("wardOwner", text("")), ("wardExpiresAt", num(0.))]),
            })
            .collect(),
    )
}
struct In {
    t: f64,
    phase: &'static str,
    gates: bool,
    players: Vec<(String, MethodValue)>,
    camps: Option<MethodValue>,
    privates: Option<MethodValue>,
}
impl In {
    fn at(t: f64, me: (f64, f64)) -> Self {
        Self {
            t,
            phase: "active",
            gates: false,
            players: vec![(SELF.into(), player(me, "alive", 0.))],
            camps: Some(camps(&[])),
            privates: None,
        }
    }
    fn dead(t: f64) -> Self {
        let mut s = Self::at(t, A);
        s.players = vec![(SELF.into(), player(A, "dead", 0.))];
        s
    }
    fn read(self) -> Result<UpdateInput, super::super::Error> {
        let mut fields = vec![
            ("phase".to_owned(), text(self.phase)),
            ("serverTime".to_owned(), num(self.t)),
            ("training".to_owned(), MethodValue::Bool(false)),
            ("gatesLocked".to_owned(), MethodValue::Bool(self.gates)),
        ];
        if let Some(c) = self.camps {
            fields.push(("camps".to_owned(), c));
        }
        UpdateInput::read(&Object(fields), self.players, self.privates)
    }
}
fn run(vision: &mut BotVision, input: In) {
    vision
        .update(&input.read().expect("declared"), SELF)
        .expect("accepted");
}
fn vision() -> BotVision {
    BotVision::new(seed1()).expect("seed-1 map with layers")
}
fn field<'a>(value: &'a MethodValue, path: &[&str]) -> &'a MethodValue {
    path.iter().fold(value, |v, key| match v {
        MethodValue::Obj(f) => &f.iter().find(|(k, _)| k == key).expect(key).1,
        _ => panic!("{key}"),
    })
}
fn number(value: &MethodValue) -> f64 {
    match value {
        MethodValue::Num(n) => *n,
        other => panic!("{other:?}"),
    }
}
fn snapshot(seed: f64, cells: Vec<(f64, f64)>) -> MethodValue {
    object([
        ("type", text("vision")),
        (
            "msg",
            object([
                ("seed", num(seed)),
                ("w", num(160.)),
                ("h", num(160.)),
                ("at", num(0.)),
                (
                    "cells",
                    MethodValue::Arr(
                        cells
                            .into_iter()
                            .map(|(i, e)| MethodValue::Arr(vec![num(i), num(e)]))
                            .collect(),
                    ),
                ),
            ]),
        ),
    ])
}
fn tile_centre(index: usize) -> Vec2 {
    Vec2::new(
        (index % 160) as f64 * 32. + 16.,
        (index / 160) as f64 * 32. + 16.,
    )
}

#[test]
fn fround_origin_and_the_throttle_ignores_movement() {
    let mut vision = vision();
    run(&mut vision, In::at(5000., A));
    let first = vision.diagnostic();
    let last_x = number(field(&first, &["memory", "lastX"]));
    assert_eq!(last_x, f64::from(784.1f32));
    assert_ne!(last_x, 784.1);
    run(&mut vision, In::at(5050., B));
    assert_eq!(
        field(&vision.diagnostic(), &["memory"]),
        field(&first, &["memory"])
    );
    run(&mut vision, In::at(5100., B));
    assert_eq!(
        number(field(&vision.diagnostic(), &["memory", "lastX"])),
        816.
    );
}

#[test]
fn reuse_refreshes_only_the_previous_scan_and_expiry_is_exclusive() {
    let mut vision = vision();
    run(&mut vision, In::at(5000., A));
    run(&mut vision, In::at(5100., B));
    run(&mut vision, In::at(5200., B));
    let cells = vision.memory.cells();
    assert!(cells.iter().any(|(_, e)| *e == 35200.));
    assert!(
        cells.iter().any(|(_, e)| *e == 35000.),
        "A-only cells are not refreshed by reuse"
    );
    run(&mut vision, In::dead(35199.));
    assert!(vision.can_see(v(B)));
    run(&mut vision, In::dead(35200.));
    assert!(!vision.can_see(v(B)), "expiry is exclusive");
}

#[test]
fn restore_accepts_only_valid_cells_and_the_last_snapshot_wins() {
    let mut vision = vision();
    let mut input = In::dead(50000.);
    let ok = 14. * 160. + 24.;
    input.privates = Some(MethodValue::Arr(vec![snapshot(
        1.,
        vec![
            (ok, 60000.),
            (ok + 1., 50000.),
            (-1., 60000.),
            (25600., 60000.),
            (1.5, 60000.),
            (ok + 2., f64::INFINITY),
            (-0., 60000.),
        ],
    )]));
    run(&mut vision, input);
    assert_eq!(
        vision.memory.cells(),
        vec![(0, 60000.), (ok as usize, 60000.)]
    );
    let mut input = In::dead(50100.);
    input.privates = Some(MethodValue::Arr(vec![
        snapshot(2., vec![(5., 90000.)]),
        snapshot(1., vec![(7., 90000.)]),
        snapshot(1., vec![(9., 91000.)]),
    ]));
    run(&mut vision, input);
    assert_eq!(
        vision.memory.cells(),
        vec![(9, 91000.)],
        "each accepted snapshot clears first"
    );
    assert!(vision.can_see(tile_centre(9)));
    let mut input = In::dead(50200.);
    input.phase = "planning";
    input.privates = Some(MethodValue::Arr(vec![snapshot(1., vec![(11., 90000.)])]));
    run(&mut vision, input);
    run(&mut vision, In::dead(50300.));
    assert!(
        vision.memory.cells().is_empty(),
        "disabled clears and never reads privates"
    );
}

#[test]
fn foreign_seed_wards_and_reveals_grant_no_sight() {
    let mut vision = vision();
    let mut input = In::dead(1000.);
    input.privates = Some(MethodValue::Arr(vec![snapshot(2., vec![(5., 90000.)])]));
    input.camps = Some(camps(&[(0, "p2", 9000.)]));
    input
        .players
        .push(("p2".into(), player(BUSH, "alive", 5000.)));
    run(&mut vision, input);
    assert!(
        vision.memory.cells().is_empty(),
        "another map's trail is refused"
    );
    assert!(
        vision.wards.is_empty(),
        "another seat's ward is not this seat's sight"
    );
    assert!(!vision.can_see(v(CAMP0)) && !vision.can_see(tile_centre(5)));
}

#[test]
fn bush_concealment_boundary_and_reveal() {
    let mut vision = vision();
    let mut input = In::at(70000., (624., 368.));
    input.players.push(("p2".into(), player(BUSH, "alive", 0.)));
    input
        .players
        .push(("p3".into(), player(BUSH, "alive", 70300.)));
    run(&mut vision, input);
    let fighters = |self_x: f64| {
        let p = percept_at(
            70000.,
            (self_x, 368.),
            vec![fighter("p2", BUSH), fighter("p3", BUSH), fighter("p4", N1)],
            vec![],
        );
        ids(&vision.filter(&p).unwrap().fighters)
    };
    assert_eq!(
        fighters(624.),
        ["p2", "p3", "p4"],
        "exactly 64 is not concealed"
    );
    assert_eq!(
        fighters(624.5),
        ["p3", "p4"],
        "beyond 64 conceals unless revealed"
    );
    let mut input = In::at(70300., (624., 368.));
    input
        .players
        .push(("p3".into(), player(BUSH, "alive", 70300.)));
    run(&mut vision, input);
    let p = percept_at(70300., (800., 368.), vec![fighter("p3", BUSH)], vec![]);
    assert!(
        vision.filter(&p).unwrap().fighters.is_empty(),
        "reveal == now has expired"
    );
    assert_eq!(
        field(&vision.diagnostic(), &["bushReveal"]),
        &MethodValue::Arr(vec![]),
        "only reveals strictly after now are kept"
    );
}

#[test]
fn wards_follow_owner_expiry_index_and_map_identity() {
    let mut vision = vision();
    let mut input = In::at(20000., A);
    input.camps = Some(camps(&[(0, SELF, 26000.3)]));
    run(&mut vision, input);
    assert!(vision.can_see(v(CAMP0)));
    let first = vision.wards.clone();
    let mut input = In::at(20100., A);
    input.camps = Some(camps(&[(0, SELF, 26000.3)]));
    run(&mut vision, input);
    assert_eq!(vision.wards, first, "same end and map: kept, not rescanned");
    let mut input = In::at(20200., A);
    input.gates = true;
    input.camps = Some(camps(&[(0, SELF, 26000.3)]));
    run(&mut vision, input);
    assert_eq!(vision.wards[0].1.map, super::grid::Sight::Locked);
    let mut input = In::at(20300., A);
    input.camps = Some(camps(&[(0, SELF, 20300.), (3, SELF, 30000.)]));
    run(&mut vision, input);
    assert_eq!(
        vision.wards.iter().map(|(i, _)| *i).collect::<Vec<_>>(),
        [3]
    );
    let mut input = In::at(20400., A);
    input.camps = None;
    run(&mut vision, input);
    assert!(vision.wards.is_empty());
}

#[test]
fn locked_gates_block_sight_and_the_coliseum_reveals_its_rectangle() {
    let north = (2544.5, 2128.25);
    let inside = v((2576., 2400.));
    let mut locked = vision();
    let mut input = In::at(30000., north);
    input.gates = true;
    run(&mut locked, input);
    let mut open = vision();
    run(&mut open, In::at(30000., north));
    assert!(!locked.can_see(inside) && open.can_see(inside));
    let mut centre = vision();
    run(&mut centre, In::at(30000., (2576., 2576.)));
    assert!(
        centre.can_see(v((2830., 2830.))),
        "a rectangle wall corner is revealed"
    );
}

fn fighter(id: &str, (x, y): (f64, f64)) -> MethodValue {
    object([
        ("id", text(id)),
        ("x", num(x)),
        ("y", num(y)),
        ("status", text("alive")),
    ])
}
fn ids(rows: &[Object]) -> Vec<String> {
    rows.iter()
        .map(|r| r.string("id").unwrap().to_owned())
        .collect()
}
fn percept_at(
    t: f64,
    (x, y): (f64, f64),
    fighters: Vec<MethodValue>,
    mobs: Vec<MethodValue>,
) -> super::super::input::Percept {
    percept_with(t, (x, y), fighters, mobs, vec![], object([]))
}
fn percept_with(
    t: f64,
    (x, y): (f64, f64),
    fighters: Vec<MethodValue>,
    mobs: Vec<MethodValue>,
    events: Vec<MethodValue>,
    extras: MethodValue,
) -> super::super::input::Percept {
    let features = object([
        ("messageTypes", MethodValue::Arr(vec![])),
        ("wishes", MethodValue::Bool(true)),
        ("statusEffects", MethodValue::Bool(true)),
        ("fields", MethodValue::Bool(true)),
        ("planning", MethodValue::Bool(true)),
        ("chests", MethodValue::Bool(true)),
        ("skills", MethodValue::Bool(true)),
        ("relics", MethodValue::Bool(true)),
        ("camps", MethodValue::Bool(true)),
        ("hazards", MethodValue::Bool(true)),
    ]);
    percept(&object([
        ("now", num(t)),
        ("viewT", num(t)),
        (
            "self",
            object([("id", text(SELF)), ("x", num(x)), ("y", num(y))]),
        ),
        ("hud", object([])),
        ("fighters", MethodValue::Arr(fighters)),
        ("mobs", MethodValue::Arr(mobs)),
        ("containers", MethodValue::Arr(vec![])),
        ("projectiles", MethodValue::Arr(vec![])),
        (
            "minimap",
            object([("t", num(t)), ("mobs", MethodValue::Arr(vec![]))]),
        ),
        ("events", MethodValue::Arr(events)),
        ("extras", extras),
        ("features", features),
    ]))
    .expect("declared percept")
}

#[test]
fn filter_trails_need_both_ends_deaths_redact_and_effects_trim() {
    let mut vision = vision();
    run(&mut vision, In::at(60000., A));
    let at = |(x, y): (f64, f64)| object([("x", num(x)), ("y", num(y))]);
    let trail = |a: (f64, f64), b: (f64, f64)| {
        object([
            ("kind", text("trail")),
            ("x", num(a.0)),
            ("y", num(a.1)),
            ("x2", num(b.0)),
            ("y2", num(b.1)),
            ("r", num(12.)),
        ])
    };
    let events = vec![
        object([("kind", text("death")), ("at", at(F1)), ("id", text("p3"))]),
        object([("kind", text("hit")), ("at", at(F1)), ("by", text("p3"))]),
        object([("kind", text("hit")), ("at", MethodValue::Null)]),
    ];
    let extras = object([
        (
            "fields",
            MethodValue::Arr(vec![trail(N1, N2), trail(N1, F1), trail(F1, N1)]),
        ),
        (
            "effects",
            object([
                ("7", num(8.)),
                ("12", num(64.)),
                ("p1", num(1.)),
                ("p2", num(2.)),
                ("p3", num(4.)),
            ]),
        ),
    ]);
    let p = percept_with(
        60000.,
        A,
        vec![fighter("p2", N1), fighter("p3", F1)],
        vec![fighter("7", N2)],
        events,
        extras,
    );
    let out = vision.filter(&p).unwrap();
    assert_eq!(ids(&out.fighters), ["p2"]);
    assert_eq!(out.events.len(), 2);
    assert_eq!(out.events[0].get("at").unwrap(), &MethodValue::Null);
    assert_eq!(
        out.events[0].0.last().unwrap(),
        &("by".to_owned(), MethodValue::Null),
        "by is appended"
    );
    let MethodValue::Arr(fields) = out.extras.get("fields").unwrap() else {
        panic!()
    };
    assert_eq!(fields.len(), 1, "only the trail with both ends in sight");
    let MethodValue::Obj(effects) = out.extras.get("effects").unwrap() else {
        panic!()
    };
    assert_eq!(
        effects.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(),
        ["7", "p1", "p2"]
    );
}

#[test]
fn disabled_vision_is_unconditional_and_filter_is_identity() {
    let mut vision = vision();
    let mut input = In::at(1000., A);
    input.phase = "lobby";
    run(&mut vision, input);
    assert!(vision.can_see(v(F1)));
    let p = percept_at(1000., A, vec![fighter("p3", F1)], vec![]);
    assert_eq!(vision.filter(&p).unwrap(), p);
}

#[test]
fn refusals_happen_before_any_mutation() {
    let mut vision = vision();
    run(&mut vision, In::at(1000., A));
    let before = vision.clone();
    let mut nullish = In::at(1100., B);
    nullish.privates = Some(MethodValue::Arr(vec![MethodValue::Null]));
    assert!(vision.update(&nullish.read().unwrap(), SELF).is_err());
    let mut null_player = In::at(1100., B);
    null_player.players.push(("p2".into(), MethodValue::Null));
    assert!(vision.update(&null_player.read().unwrap(), SELF).is_err());
    let mut text_ward = In::at(1100., B);
    text_ward.camps = Some(MethodValue::Arr(vec![object([
        ("wardOwner", text(SELF)),
        ("wardExpiresAt", text("9000")),
    ])]));
    assert!(vision.update(&text_ward.read().unwrap(), SELF).is_err());
    let mut text_x = In::at(1100., B);
    text_x.players = vec![(
        SELF.into(),
        object([("x", text("1")), ("y", num(1.)), ("status", text("alive"))]),
    )];
    assert!(vision.update(&text_x.read().unwrap(), SELF).is_err());
    assert_eq!(vision, before);
    let mut duplicate = In::at(1100., B);
    duplicate
        .players
        .push((SELF.into(), player(B, "alive", 0.)));
    assert!(
        duplicate.read().is_err(),
        "a Map cannot hold duplicate keys"
    );
}

#[test]
fn effect_keys_follow_javascript_property_order() {
    let keys = |k: &[&str]| {
        js_key_order(
            k.iter()
                .map(|k| ((*k).to_owned(), MethodValue::Null))
                .collect(),
        )
        .into_iter()
        .map(|(k, _)| k)
        .collect::<Vec<_>>()
    };
    assert_eq!(
        keys(&["b", "10", "a", "2", "01", "4294967295", "4294967294"]),
        ["2", "10", "4294967294", "b", "a", "01", "4294967295"]
    );
}

#[test]
fn effects_order_is_canonical_even_from_a_native_visible_order() {
    // The native composer writes effects in self/fighters/mobs order; a JavaScript object
    // always enumerates array-index keys first, so the filtered object must too.
    let mut vision = vision();
    run(&mut vision, In::at(60000., A));
    let extras = object([(
        "effects",
        object([("p1", num(1.)), ("7", num(8.)), ("p3", num(4.))]),
    )]);
    let p = percept_with(60000., A, vec![], vec![fighter("7", N2)], vec![], extras);
    let out = vision.filter(&p).unwrap();
    let MethodValue::Obj(effects) = out.extras.get("effects").unwrap() else {
        panic!()
    };
    assert_eq!(
        effects.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(),
        ["7", "p1"]
    );
}
