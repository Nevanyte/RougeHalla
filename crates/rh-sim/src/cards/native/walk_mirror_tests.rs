//! P-AUG-NATIVE-3c oracle: Hazard Walker on ice, and Pathfinder's share in the owner's speed mirror.
//!
//! Loose proof (owner direction 2026-11-10; brief `docs/backlog/packets/P-AUG-NATIVE-3c.md`):
//! - Hazard Walker on ice follows the bog/ember rule NATIVE-3 pinned: each stack takes 4% of the hazard's effect (the
//!   ice's effect is its slip time, 400 ms to reach full speed), and 20 s on the ice (mark bit 2) removes it: the holder
//!   walks on ice as on ground, and the walk hint treats the ice as ground;
//! - Pathfinder's share reaches the owner block the client predicts with (`speed_milli`), the owner readout
//!   (`build_summary`) and a Plague zombie's pace; the server's walk of a holder is exactly the published speed, and the
//!   golden vector `protocol/fixtures/pathfinder_walk_v1.json` (replayed by the C# `PathfinderWalkPredictionTests`)
//!   is the current server's;
//! - a non-holder, a holder of another native card and a Legacy world are untouched.
//!
//! Every comparison is between worlds that differ only in the native state under test (same seed, same commands).
use super::exemplars_tests::{give, seat, send, slot_mut, world};
use crate::cards::CardId;
use crate::constants::{PLAYER_SPEED, TICK_MS};
use crate::fighter::FighterIx;
use crate::{
    AugmentRule, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, Vec2,
};
use serde_json::{json, Value};

#[allow(non_snake_case)]
fn P1() -> PlayerId {
    PlayerId(1)
}

// ---------------------------------------------------------------------------------------------------------------------
// Hazard Walker on ice: a long ice run of the seed-1 map (row 139, tiles 120..=142 are ice on open ground).
// ---------------------------------------------------------------------------------------------------------------------

fn seed1() -> crate::Arena {
    let map: crate::mapdata::MapExport =
        serde_json::from_str(include_str!("../../mapdata/fixtures/seed1.map.json")).unwrap();
    map.validate().unwrap().into_arena().unwrap()
}

fn tile_centre(tx: u32, ty: u32) -> Vec2 {
    Vec2::new(f64::from(tx) * 32. + 16., f64::from(ty) * 32. + 16.)
}

/// The walk's start (tile 122, 139) and goal (tile 140, 139): 576 u of straight ice.
fn ice_from() -> Vec2 {
    tile_centre(122, 139)
}
fn ice_to() -> Vec2 {
    tile_centre(140, 139)
}
/// Ticks measured: 0.8 s, twice the unresisted slip time, and before the walk's own ice time earns a stack.
fn ice_ticks() -> u32 {
    16
}

/// Player 1 (Holy) at rest on the ice run, player 2 at a spawn; hazards on the map, no mobs. `cards` are granted to
/// player 1; `setup` edits its Hazard Walker slot (if held) before the walk order.
fn ice_world(rule: AugmentRule, cards: &[CardId], setup: impl FnOnce(&mut Sim)) -> Sim {
    let arena = seed1();
    let at = ice_from();
    let seats: Vec<Placement> = (0..2)
        .map(|i| Placement {
            profile: format!("p{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: if i == 0 { at } else { arena.spawns[i] },
            hp: Some(500.),
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let mut sim = Sim::reset_active(
        SimConfig {
            augments: rule,
            quests: false,
            hazards: crate::terrain::Mode::Map,
            mob_mode: crate::mob_runtime::MobMode::Off,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(5),
        &seats,
    );
    for card in cards {
        give(&mut sim, P1(), *card);
    }
    setup(&mut sim);
    sim
}

/// A Hazard Walker holder with `stacks` stacks (their time on the ember meter, so the ice meter starts at `ice_ms`) and
/// `marks`.
fn hazard_walker(stacks: f64, ice_ms: f64, marks: u32) -> impl FnOnce(&mut Sim) {
    move |sim: &mut Sim| {
        let s = slot_mut(sim, P1(), CardId::HazardWalker);
        s.counter = stacks;
        s.meters = [(stacks * 1000.).min(20_000.), 0., ice_ms];
        s.marks = marks;
    }
}

/// Orders player 1 along the ice and returns, per tick, its position, whether it holds a slip state, and the world's ice
/// exposure seconds.
fn ice_walk(mut sim: Sim) -> Vec<(Vec2, bool, f64)> {
    let goal = ice_to();
    send(
        &mut sim,
        P1(),
        RawCommand::Move {
            x: goal.x,
            y: goal.y,
            seq: Some(1),
        },
    );
    (0..ice_ticks())
        .map(|_| {
            sim.step();
            let p = sim.w.player(P1()).unwrap();
            (p.pos(), p.motion.slip.is_some(), sim.w.terrain.seconds[2])
        })
        .collect()
}

/// How far the walk trails a full-speed walk over the measured ticks (the slip's lag: half the full speed times the slip
/// time once full speed is reached).
fn lag(walk: &[(Vec2, bool, f64)]) -> f64 {
    let from = ice_from();
    let walked = walk.last().unwrap().0.x - from.x;
    PLAYER_SPEED * (TICK_MS / 1000.) * f64::from(ice_ticks()) - walked
}

/// Each stack shortens the ice slip by 4% (the bog's slow and the ember's burn shrink the same way): the lag behind a
/// full-speed walk is the slip time's, so 5, 10 and 15 stacks trail by 80%, 60% and 40% of a non-holder's lag. A holder
/// with no stacks, and a holder immune only to the ember and the bog, are not spared.
#[test]
fn hazard_walker_stacks_shorten_the_ice_slip() {
    let bare = ice_walk(ice_world(AugmentRule::Rework, &[], |_| {}));
    let base = lag(&bare);
    assert!(
        base > 20. && base < 45.,
        "a non-holder slips on ice: lag {base} u (half of 170 u/s x 0.4 s is 34 u)"
    );
    assert!(
        bare.iter().all(|t| t.1),
        "a non-holder holds a slip state on the ice"
    );
    let held = |stacks: f64, marks: u32| {
        ice_walk(ice_world(
            AugmentRule::Rework,
            &[CardId::HazardWalker],
            hazard_walker(stacks, 0., marks),
        ))
    };
    assert_eq!(
        held(0., 0),
        bare,
        "a holder with no stacks slips exactly as a non-holder"
    );
    for stacks in [5., 10., 15.] {
        let r = lag(&held(stacks, 0)) / base;
        let want = 1. - 0.04 * stacks;
        assert!(
            (r - want).abs() < 0.03,
            "{stacks} stacks: lag {r} of a non-holder's, want {want}"
        );
    }
    let r = lag(&held(15., 0b011)) / base;
    assert!(
        (r - 0.4).abs() < 0.03,
        "immunity to the ember and the bog is no immunity to the ice: lag {r}, want 0.4 (15 stacks)"
    );
}

/// Twenty seconds on the ice (mark bit 2) make the holder immune: it walks the ice at full speed from the first tick, as
/// on ground, holds no slip state, and (as for the bog and the ember) its ice exposure stops counting. The ice meter
/// stays at its cap.
#[test]
fn hazard_walker_is_immune_to_the_ice_after_20_seconds_on_it() {
    let mut sim = ice_world(
        AugmentRule::Rework,
        &[CardId::HazardWalker],
        hazard_walker(15., 20_000., 0b100),
    );
    let before = sim.w.terrain.seconds[2];
    sim.step();
    assert_eq!(
        sim.w.terrain.seconds[2], before,
        "an idle immune holder's ice time does not count"
    );
    let walk = ice_walk(sim);
    let l = lag(&walk);
    assert!(
        l.abs() < 0.5,
        "immune: walks the ice at full speed (lag {l} u)"
    );
    assert!(
        walk.iter().all(|t| !t.1),
        "immune: never holds a slip state"
    );
    assert!(
        walk.iter().all(|t| t.2 == before),
        "immune: the ice exposure stops counting"
    );
    // The meter stayed at its cap, so the card state is what it was.
    let mut sim = ice_world(
        AugmentRule::Rework,
        &[CardId::HazardWalker],
        hazard_walker(15., 20_000., 0b100),
    );
    for _ in 0..20 {
        sim.step();
    }
    let s = *sim
        .w
        .player(P1())
        .unwrap()
        .build
        .native()
        .slot(CardId::HazardWalker)
        .unwrap();
    assert_eq!(s.meters[2], 20_000., "the ice meter stays at its cap");
    assert_eq!(s.marks, 0b100);
}

/// The ice is ground for an ice-immune holder's walk hint too: on the ice with a path along it, a non-holder (and a
/// resisted holder) gets no hint, an immune holder gets one.
#[test]
fn an_ice_immune_holder_gets_a_walk_hint_on_the_ice() {
    let hint = |cards: &[CardId], marks: u32| {
        let mut sim = ice_world(
            AugmentRule::Rework,
            cards,
            hazard_walker_if(!cards.is_empty(), marks),
        );
        let goal = ice_to();
        let i = sim.w.idx(P1()).unwrap();
        sim.w.players[i].core.motion.path.set_from(&[goal]);
        crate::systems::walk_hint::walk_hint_of(
            &sim.k,
            &sim.w,
            Default::default(),
            FighterIx::of_slot(i),
        )
    };
    assert_eq!(
        hint(&[], 0),
        crate::systems::walk_hint::WalkHint::default(),
        "no hint on ice"
    );
    assert_eq!(
        hint(&[CardId::HazardWalker], 0b011),
        crate::systems::walk_hint::WalkHint::default(),
        "a resisted holder still slips: no hint"
    );
    let h = hint(&[CardId::HazardWalker], 0b100);
    assert!(h.ticks > 0, "an ice-immune holder walks: hint {h:?}");
}

fn hazard_walker_if(held: bool, marks: u32) -> impl FnOnce(&mut Sim) {
    move |sim: &mut Sim| {
        if held {
            hazard_walker(15., 20_000., marks)(sim);
        }
    }
}

/// The new ice and speed reads cost a non-holder nothing: a Legacy world, a Rework world without native cards and a
/// Rework world whose walker holds another native card (Overflow) walk the ice, and publish the owner's speed, alike.
#[test]
fn the_ice_walk_and_the_owner_speed_of_a_non_holder_are_unchanged() {
    let run = |rule: AugmentRule, cards: &[CardId]| {
        let mut sim = ice_world(rule, cards, |_| {});
        let goal = ice_to();
        send(
            &mut sim,
            P1(),
            RawCommand::Move {
                x: goal.x,
                y: goal.y,
                seq: Some(1),
            },
        );
        let mut log = Vec::new();
        for _ in 0..40 {
            let events = sim.step();
            let obs = crate::observe::observe(&sim, P1(), &events);
            let p = sim.w.player(P1()).unwrap();
            log.push((
                events,
                p.pos(),
                p.motion.slip.is_some(),
                obs.owner_combat.map(|o| o.speed_milli.to_bits()),
                (p.walk_dir, p.walk_ticks),
            ));
        }
        (log, sim.w.terrain.seconds)
    };
    let legacy = run(AugmentRule::Legacy, &[]);
    assert_eq!(legacy, run(AugmentRule::Rework, &[]));
    assert_eq!(legacy, run(AugmentRule::Rework, &[CardId::Overflow]));
}

// ---------------------------------------------------------------------------------------------------------------------
// Pathfinder: the owner block, the readout, the zombie's pace and the published walk.
// ---------------------------------------------------------------------------------------------------------------------

/// A holder (Holy, practice arena) with Pathfinder at `counter` and `boost` MoveSpeed chest picks (a folded speed mirror
/// other than 1, so the share's product with it is pinned).
fn pathfinder_world(counter: Option<f64>, boost: u8) -> Sim {
    let mut sim = world(
        AugmentRule::Rework,
        &[
            seat("walker", Vec2::new(100., 272.), None, None),
            seat("other", Vec2::new(100., 600.), None, None),
        ],
    );
    if let Some(c) = counter {
        give(&mut sim, P1(), CardId::Pathfinder);
        set_pathfinder(&mut sim, c);
    }
    if boost > 0 {
        let i = sim.w.idx(P1()).unwrap();
        sim.w.players[i].build.boosts[crate::reward_chests::BoostId::MoveSpeed.index()] = boost;
        crate::modifiers::recompute(&sim.k, &mut sim.w, FighterIx::of_slot(i));
    }
    sim
}

/// Pathfinder at `counter` with the marks that pay for it (`counter / 0.012` normal types), as `check_world` demands.
fn set_pathfinder(sim: &mut Sim, counter: f64) {
    let s = slot_mut(sim, P1(), CardId::Pathfinder);
    s.counter = counter;
    let n = (counter / 0.012).round() as u32;
    s.marks = mask_of_lowest(
        crate::cards::native::rule(CardId::Pathfinder)
            .unwrap()
            .marks,
        n,
    );
}

/// The lowest `n` set bits of `bits`.
fn mask_of_lowest(bits: u32, n: u32) -> u32 {
    let mut out = 0;
    let mut left = n;
    for b in 0..32 {
        if left == 0 {
            break;
        }
        if bits & (1 << b) != 0 {
            out |= 1 << b;
            left -= 1;
        }
    }
    out
}

fn owner_speed_milli(sim: &Sim) -> f64 {
    crate::observe::observe(sim, P1(), &[])
        .owner_combat
        .expect("the owner block")
        .speed_milli
}

/// The owner block publishes the walk speed with the share in it: `encode_mult(mirror x (1 + share))`, 1120 and 1240
/// milli on an unboosted holder at 0.12 and 0.24, and the product with a boosted mirror. A non-holder's (and a holder's
/// at share 0) is the cached wire value bit for bit. The owner readout's `move_speed` is the same speed minus 1.
#[test]
fn pathfinder_share_is_in_the_owner_speed_mirror_and_the_readout() {
    for boost in [0u8, 2] {
        let bare = pathfinder_world(None, boost);
        let p = bare.w.player(P1()).unwrap();
        let mirror = p.modifiers.mirrors().speed_mult;
        if boost > 0 {
            assert!(mirror > 1., "the boost moves the mirror ({mirror})");
        }
        assert_eq!(
            owner_speed_milli(&bare).to_bits(),
            p.modifiers.owner_combat_mirrors()[2].to_bits(),
            "boost {boost}: a non-holder's owner block is the cached wire value"
        );
        for counter in [0., 0.12, 0.24] {
            let sim = pathfinder_world(Some(counter), boost);
            let p = sim.w.player(P1()).unwrap();
            assert_eq!(p.modifiers.mirrors().speed_mult, mirror, "same fold");
            let got = owner_speed_milli(&sim);
            if counter == 0. {
                assert_eq!(
                    got.to_bits(),
                    p.modifiers.owner_combat_mirrors()[2].to_bits(),
                    "boost {boost}: share 0 publishes the cached wire value"
                );
            }
            let want = crate::stat_fold::encode_mult(mirror * (1. + counter));
            assert_eq!(
                got, want,
                "boost {boost}, counter {counter}: owner speed_milli {got}, want {want}"
            );
            if boost == 0 {
                assert_eq!(got, (1000. * (1. + counter)).round());
            }
            let summary = crate::build_summary::build_summary(&sim, P1()).unwrap();
            let want = mirror * (1. + counter) - 1.;
            assert!(
                (summary.move_speed - want).abs() < 1e-12,
                "boost {boost}, counter {counter}: readout move_speed {}, want {want}",
                summary.move_speed
            );
        }
    }
}

/// The server's walk of a holder in the open is the speed its owner block publishes: each tick moves
/// `PLAYER_SPEED x speed_milli / 1000 x 50 ms` within half the C# prediction tolerance (`WalkTol` 0.01 u).
#[test]
fn the_server_walk_of_a_pathfinder_holder_is_its_published_speed() {
    for counter in [0.12, 0.24] {
        let mut sim = pathfinder_world(Some(counter), 0);
        send(
            &mut sim,
            P1(),
            RawCommand::Move {
                x: 700.,
                y: 272.,
                seq: Some(1),
            },
        );
        let mut x = sim.w.player(P1()).unwrap().pos().x;
        let mut checked = 0;
        for tick in 0..30 {
            let milli = owner_speed_milli(&sim);
            sim.step();
            let p = sim.w.player(P1()).unwrap();
            let moved = p.pos().x - x;
            x = p.pos().x;
            if tick == 0 || p.motion.path.is_empty() {
                continue;
            }
            let want = PLAYER_SPEED * (milli / 1000.) * (TICK_MS / 1000.);
            assert!(
                (moved - want).abs() < 0.005,
                "counter {counter}, tick {tick}: moved {moved} u, the published {milli} milli says {want}"
            );
            checked += 1;
        }
        assert!(
            checked >= 20,
            "the straight leg was measured ({checked} ticks)"
        );
    }
}

/// A Plague holder's zombie keeps pace with it: the zombie's follow multiplier carries the owner's share.
#[test]
fn a_plague_holders_zombie_keeps_pace_with_the_share() {
    let pace = |counter: Option<f64>| {
        let mut sim = world(
            AugmentRule::Rework,
            &[Placement {
                faction: FactionId::Plague,
                ..seat("plague", Vec2::new(300., 272.), None, None)
            }],
        );
        if let Some(c) = counter {
            give(&mut sim, P1(), CardId::Pathfinder);
            set_pathfinder(&mut sim, c);
        }
        crate::systems::plague_zombies::raise_or_grow(&sim.k, &mut sim.w, P1());
        let z = crate::systems::plague_zombies::zombie_of(&sim.w, P1()).expect("a zombie");
        let core = &sim.w.mobs.get(z).unwrap().core;
        crate::systems::plague_zombies::movement(&sim.w, core, 0., Default::default())
    };
    let bare = pace(None);
    assert!(
        bare >= 1.,
        "the zombie follows at its owner's pace ({bare})"
    );
    assert_eq!(pace(Some(0.)), bare, "share 0 changes nothing");
    let r = pace(Some(0.24)) / bare;
    assert!(
        (r - 1.24).abs() < 1e-9,
        "the zombie of a holder at 0.24 follows {r}x, want 1.24x"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// The golden vector the C# prediction replays: protocol/fixtures/pathfinder_walk_v1.json.
// ---------------------------------------------------------------------------------------------------------------------

fn repo(relative: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

fn read_json(relative: &str) -> Value {
    let path = repo(relative);
    serde_json::from_str(
        &std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display())),
    )
    .unwrap()
}

/// One corner walk of `server_walk_v2.json` (the same map, Archetypes, Fire hero walker, seed 11, one Move order, 240
/// steps) in a Rework world whose walker holds Pathfinder at `counter`; each row carries the owner block's
/// `speedMilli` as `observe` delivers it.
fn walk_case(map: &crate::TileMap, spawns: &[Vec2], case: &Value, counter: f64) -> Value {
    let at = |v: &Value| Vec2::new(v[0].as_f64().unwrap(), v[1].as_f64().unwrap());
    let (start, goal) = (at(&case["start"]), at(&case["goal"]));
    let mut sim = Sim::reset_active(
        SimConfig {
            hitboxes: crate::archetype::HitboxMode::Archetypes,
            augments: AugmentRule::Rework,
            ..SimConfig::default()
        },
        crate::Arena {
            map: map.clone(),
            spawns: spawns.to_vec(),
        },
        Secrets::from_seed(11),
        &[Placement {
            profile: "walker".into(),
            faction: FactionId::Fire,
            bot: false,
            at: start,
            hp: None,
            weapon0: None,
            weapon1: None,
        }],
    );
    give(&mut sim, P1(), CardId::Pathfinder);
    set_pathfinder(&mut sim, counter);
    send(
        &mut sim,
        P1(),
        RawCommand::Move {
            x: goal.x,
            y: goal.y,
            seq: Some(1),
        },
    );
    let row = |sim: &Sim, events: &[crate::Event]| {
        let p = sim.player(P1()).unwrap();
        let o = crate::observe::observe(sim, P1(), events)
            .owner_combat
            .expect("the owner block");
        json!({"t": sim.server_time(), "tick": sim.tick(), "x": p.body.x, "y": p.body.y,
               "moveSeq": p.motion.move_seq, "speedMilli": o.speed_milli})
    };
    let mut ticks = vec![row(&sim, &[])];
    for _ in 0..240 {
        let events = sim.step();
        ticks.push(row(&sim, &events));
    }
    json!({
        "name": case["name"],
        "queryIndex": case["queryIndex"],
        "start": case["start"],
        "goal": case["goal"],
        "counter": counter,
        "ticks": ticks,
    })
}

fn pathfinder_walk_v1_json() -> String {
    let v1 = read_json("protocol/fixtures/server_walk_v1.json");
    let paths = read_json("parity/fixtures/pathfinding_seed1.json");
    let rows: Vec<&str> = paths["map"]["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r.as_str().unwrap())
        .collect();
    let map = crate::TileMap::from_rows(&rows).unwrap();
    let seed = read_json(v1["map"].as_str().unwrap());
    let spawns: Vec<Vec2> = seed["spawns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| Vec2::new(p[0].as_f64().unwrap(), p[1].as_f64().unwrap()))
        .collect();
    let corners = v1["cases"].as_array().unwrap();
    let mut cases: Vec<Value> = corners
        .iter()
        .map(|c| walk_case(&map, &spawns, c, 0.24))
        .collect();
    cases.push(walk_case(&map, &spawns, &corners[0], 0.12));
    let mut text = serde_json::to_string_pretty(&json!({
        "format": "rh-pathfinder-walk/1",
        "source": "crates/rh-sim cards::native::walk_mirror_tests: the server_walk_v2 corner walks (SimConfig::hitboxes = Archetypes, a Fire hero walker, seed-1 map, one Move order, 20 Hz) in a Rework world whose walker holds Pathfinder at `counter`; speedMilli is the owner block observe delivers",
        "map": v1["map"],
        "playerSpeed": v1["playerSpeed"],
        "tickMs": v1["tickMs"],
        "archetype": crate::archetype::ArchetypeId::HERO.0,
        "footprint": {"kind": "box", "hx": 10.0, "hy": 6.0},
        "cases": cases,
    }))
    .unwrap();
    text.push('\n');
    text
}

/// The vector is what the current server produces, byte for byte (`RH_WRITE_FIXTURES=1` writes it), and it says what
/// the C# replay relies on: every row's `speedMilli` is `1000 x (1 + counter)` (the Fire hero's folded mirror is 1), and
/// the holder walks faster than the published speed of a non-holder would carry it.
#[test]
fn pathfinder_walk_v1_is_the_current_server() {
    let text = pathfinder_walk_v1_json();
    let v: Value = serde_json::from_str(&text).unwrap();
    let base = read_json("protocol/fixtures/server_walk_v2.json");
    for case in v["cases"].as_array().unwrap() {
        let counter = case["counter"].as_f64().unwrap();
        let want = (1000. * (1. + counter)).round();
        for row in case["ticks"].as_array().unwrap() {
            assert_eq!(
                row["speedMilli"].as_f64().unwrap(),
                want,
                "{} tick {}: the owner block publishes the holder's speed",
                case["name"],
                row["tick"]
            );
        }
        // The holder reaches the corner walk's goal sooner than the non-holder walk of server_walk_v2.
        let arrive = |ticks: &Value| {
            let rows = ticks.as_array().unwrap();
            let last = rows.last().unwrap();
            rows.iter()
                .position(|r| r["x"] == last["x"] && r["y"] == last["y"])
                .unwrap()
        };
        let plain = base["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == case["name"])
            .unwrap();
        let (fast, slow) = (arrive(&case["ticks"]), arrive(&plain["ticks"]));
        assert!(
            (fast as f64) < (slow as f64) / (1. + counter) * 1.05 && fast < slow,
            "{} at {counter}: arrives at tick {fast}, the non-holder at {slow}",
            case["name"]
        );
    }
    let path = repo("protocol/fixtures/pathfinder_walk_v1.json");
    if std::env::var_os("RH_WRITE_FIXTURES").is_some() {
        std::fs::write(&path, &text).unwrap();
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(
        committed == text,
        "protocol/fixtures/pathfinder_walk_v1.json is not what the current server produces (RH_WRITE_FIXTURES=1 cargo test -p rh-sim --lib \
         cards::native::walk_mirror_tests::pathfinder_walk_v1_is_the_current_server writes it)"
    );
}
