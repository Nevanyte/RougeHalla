//! P-BOT-BRAIN-CONTINUITY-1 oracle, composer side: on a live seat (`Composer14::track_mobs`) a mob keeps its percept key
//! while it stays in view although the sim renews its reference, its velocity comes from that track, and the percept
//! does not depend on the references' values or the rows' order (R-ML-4).
use super::{Composer14, Setup14};
use crate::bots::temporal_percept::brain::trace::BVal;
use crate::bots::view::Features;
use crate::delivery::DeliverySession;
use rh_sim::mob_catalog::MobTypeId;
use rh_sim::observe::ActorKind;
use rh_sim::{
    FactionId, ItemObserver, Observation, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2,
    WeaponId,
};

const OWNER: PlayerId = PlayerId(1);
const OTHER: PlayerId = PlayerId(2);
const EFFECT_HIDDEN: u16 = crate::bots::wish::EFFECT_HIDDEN;

fn sim() -> Sim {
    let at = |profile: &str, faction, x: f64| Placement {
        profile: profile.into(),
        faction,
        bot: false,
        at: Vec2::new(x, 272.),
        hp: None,
        weapon0: Some(WeaponId::Wand),
        weapon1: None,
    };
    Sim::reset_active(
        SimConfig {
            consumables: false,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(7),
        &[
            at("owner", FactionId::Fire, 300.),
            at("other", FactionId::Holy, 440.),
        ],
    )
}

fn composer(sim: &Sim, tracked: bool) -> Composer14 {
    let mut c = Composer14::new(Setup14::public(
        sim.shared_arena(),
        Features {
            message_types: ["move", "stop", "target", "attack"]
                .map(String::from)
                .to_vec(),
            status_effects: true,
            ..Features::default()
        },
        0.6,
    ));
    if tracked {
        c.track_mobs();
    }
    c
}

/// One NPC row: (reference, x, y, type, hidden).
type Npc = (u32, f64, f64, usize, bool);

/// The owner's scene at `time` with `npcs` drawn in the given row order.
fn scene(sim: &Sim, time: f64, tick: u32, npcs: &[Npc]) -> Observation {
    let mut obs = Observation::default();
    ItemObserver::new(OWNER)
        .prepare_into(sim, &[], &mut obs, None)
        .expect("owner scene")
        .commit();
    obs.tick = tick;
    obs.server_time = time;
    obs.arena = Some(rh_sim::ArenaView {
        lobby_ends_at: 0.,
        plan_ends_at: 0.,
        raid_started_at: 500.,
        patience_ends_at: Some(60_000.),
        in_coliseum: false,
        gates_locked: false,
        sudden_death_at: 0.,
        started_with: 2,
        min_players: 2,
    });
    let template = obs
        .visible
        .iter()
        .find(|a| a.id == OTHER)
        .expect("the other player is visible")
        .clone();
    for &(id, x, y, ty, hidden) in npcs {
        let mut mob = template.clone();
        mob.kind = ActorKind::Regional;
        mob.mob_type = Some(MobTypeId::ALL[ty]);
        mob.id = PlayerId(id);
        mob.x = x;
        mob.y = y;
        mob.effects = if hidden { EFFECT_HIDDEN } else { 0 };
        obs.visible.push(mob);
    }
    // The wire carries rows in ascending reference order: the row order a seat sees is the order of the references.
    obs.visible.sort_by_key(|a| a.id.0);
    obs
}

fn mobs(raw: &BVal) -> Vec<&BVal> {
    match raw
        .as_obj()
        .and_then(|o| o.iter().find(|(k, _)| k == "mobs"))
    {
        Some((_, BVal::Arr(rows))) => rows.iter().collect(),
        other => panic!("no mobs list: {other:?}"),
    }
}

fn field<'a>(row: &'a BVal, key: &str) -> &'a BVal {
    row.as_obj()
        .and_then(|o| o.iter().find(|(k, _)| k == key))
        .map(|(_, v)| v)
        .unwrap_or_else(|| panic!("no {key} in {row:?}"))
}

fn num(row: &BVal, key: &str) -> f64 {
    field(row, key).as_num().expect("number")
}

/// (key, x, y, vx) of every composed mob, in percept order.
fn mob_rows(raw: &BVal) -> Vec<(String, f64, f64, f64)> {
    mobs(raw)
        .into_iter()
        .map(|m| {
            (
                field(m, "id").as_str().expect("key").to_string(),
                num(m, "x"),
                num(m, "y"),
                num(m, "vx"),
            )
        })
        .collect()
}

/// Ten samples of two same-type mobs walking right 4 u a tick, and one of another type standing still. `renumber`
/// renews every reference each sample (the sim renews a block when the visible set changes); `shuffle` hands the
/// references out in reverse on odd samples, which reverses the rows (the wire orders rows by reference).
fn frames(renumber: bool, shuffle: bool) -> Vec<Observation> {
    let sim = sim();
    (0..10u32)
        .map(|i| {
            let x = f64::from(i) * 4.;
            let base = if renumber {
                0x8000_0000 + 100 * i
            } else {
                0x8000_0000
            };
            let mut refs = [base + 1, base + 2, base + 3];
            if shuffle && i % 2 == 1 {
                refs.reverse();
            }
            let npcs = [
                (refs[0], 360. + x, 240., 0, false),
                (refs[1], 360. + x, 300., 0, false),
                (refs[2], 420., 330., 1, false),
            ];
            scene(&sim, 1000. + 50. * f64::from(i), 20 + i, &npcs)
        })
        .collect()
}

fn compose_all(tracked: bool, obs: &[Observation]) -> Vec<BVal> {
    let sim = sim();
    let mut session = DeliverySession::new(OWNER);
    let mut c = composer(&sim, tracked);
    obs.iter()
        .map(|o| {
            let prepared = session.prepare(o, false, false, &[]).expect("frame");
            let frame = session.commit(prepared);
            c.compose(frame.frame()).expect("composed").percept.raw
        })
        .collect()
}

#[test]
fn a_tracked_mob_keeps_its_key_across_renewed_references_and_carries_its_velocity() {
    let raws = compose_all(true, &frames(true, true));
    let first = mob_rows(&raws[0]);
    assert_eq!(first.len(), 3);
    let key_at = |rows: &[(String, f64, f64, f64)], y: f64| {
        rows.iter()
            .find(|r| r.2 == y)
            .map(|r| (r.0.clone(), r.3))
            .expect("row")
    };
    for (i, raw) in raws.iter().enumerate() {
        let rows = mob_rows(raw);
        for y in [240., 300., 330.] {
            assert_eq!(
                key_at(&rows, y).0,
                key_at(&first, y).0,
                "sample {i}: the mob on y={y} keeps its key"
            );
        }
        for (key, ..) in &rows {
            assert!(
                !key.starts_with('n'),
                "sample {i}: no reference-derived key ({key})"
            );
        }
        let walker = key_at(&rows, 240.).1;
        if i == 0 {
            assert_eq!(walker, 0., "a new track has no velocity");
        } else {
            assert!(
                (walker - 80.).abs() < 1.,
                "sample {i}: 4 u per 50 ms is 80 u/s, got {walker}"
            );
        }
        assert_eq!(key_at(&rows, 330.).1, 0., "the standing mob does not move");
    }
}

#[test]
fn renumbered_references_and_shuffled_rows_compose_identical_percepts() {
    let plain = compose_all(true, &frames(false, false));
    let renewed = compose_all(true, &frames(true, true));
    assert_eq!(
        plain, renewed,
        "neither the references' values nor the row order reach the percept"
    );
}

#[test]
fn a_row_the_seat_cannot_see_changes_no_track() {
    let sim = sim();
    let visible = frames(true, false);
    let with_hidden: Vec<Observation> = (0..10u32)
        .map(|i| {
            let mut o = visible[i as usize].clone();
            let mut extra = scene(
                &sim,
                o.server_time,
                o.tick,
                &[(0x8000_0050 + i, 362., 242., 0, true)],
            );
            o.visible.push(extra.visible.pop().expect("the hidden row"));
            o.visible.sort_by_key(|a| a.id.0);
            o
        })
        .collect();
    assert_eq!(
        compose_all(true, &visible),
        compose_all(true, &with_hidden),
        "a hidden mob next to a tracked one changes nothing"
    );
}

#[test]
fn an_untracked_composer_keeps_reference_keys() {
    let raws = compose_all(false, &frames(true, false));
    for raw in &raws {
        for (key, _, _, vx) in mob_rows(raw) {
            assert!(key.starts_with('n'), "frozen-corpus keying: {key}");
            assert_eq!(vx, 0.);
        }
    }
}
