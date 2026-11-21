//! P-AUG-NATIVE-1b oracle: the two exemplars through the real hooks, the own-only readout rows, and a restore taken
//! mid-count.
//!
//! Loose proof (owner direction 2026-11-10; brief `docs/backlog/packets/P-AUG-NATIVE-1b.md` sections 1.3-1.5):
//! - Marksman's Tally (workbook Augment_Tuning row 11, "0.3%, cap 30%"; Augments row 37, "beyond 80% of max range",
//!   bow and wand): +0.003 per long-range hit, capped at 0.30, and the share multiplies the holder's hits;
//! - Bastion (Augment_Tuning row 27, "35%"; Augments row 53, "Blocked damage fills a meter"): a block fills the meter by
//!   what Tank Engine counts for it, capped at the registered meter cap (250, brief decision), and the holder's next
//!   landed hit deals 35% of the meter more, after mitigation, emptying it.
//!
//! Every world is `AugmentRule::Rework` on the practice arena; comparisons are between two runs that differ only in the
//! native state under test (same seed, same commands, same cards held), so the RNG draws and the PvP factor cancel.
use crate::cards::native::{readouts, rule, NativeSlot, Readout, ReadoutKind};
use crate::cards::CardId;
use crate::constants::{ContentVal, REGISTRY};
use crate::content::{weapon, Shape};
use crate::{
    arenas, observe, validate, AugmentRule, Event, FactionId, Placement, PlayerId, RawCommand,
    Secrets, Sim, SimConfig, Vec2, WeaponId,
};

// ---------------------------------------------------------------------------------------------------------------------
// Harness (shared with hooks_tests.rs).
// ---------------------------------------------------------------------------------------------------------------------

pub(super) fn registered(name: &str) -> Option<f64> {
    REGISTRY
        .iter()
        .find(|e| e.name == name)
        .map(|e| match e.val {
            ContentVal::F64(v) => v,
            ContentVal::U64(v) => v as f64,
            ContentVal::I64(v) => v as f64,
        })
}

/// A Holy seat (the faction of every test fighter here).
pub(super) fn seat(
    profile: &str,
    at: Vec2,
    weapon: Option<WeaponId>,
    hp: Option<f64>,
) -> Placement {
    Placement {
        profile: profile.into(),
        faction: FactionId::Holy,
        bot: false,
        at,
        hp,
        weapon0: weapon,
        weapon1: None,
    }
}

pub(super) fn world(rule: AugmentRule, seats: &[Placement]) -> Sim {
    Sim::reset_active(
        SimConfig {
            augments: rule,
            ..SimConfig::default()
        },
        arenas::practice_arena(),
        Secrets::from_seed(5),
        seats,
    )
}

pub(super) fn give(sim: &mut Sim, id: PlayerId, card: CardId) {
    assert!(
        crate::cards::grant(&sim.k, &mut sim.w, id, card),
        "{id:?} takes {card:?}"
    );
}

pub(super) fn slot(sim: &Sim, id: PlayerId, card: CardId) -> NativeSlot {
    *sim.w.player(id).unwrap().build.native().slot(card).unwrap()
}

pub(super) fn slot_mut(sim: &mut Sim, id: PlayerId, card: CardId) -> &mut NativeSlot {
    let i = sim.w.idx(id).unwrap();
    sim.w.players[i].build.native.slot_mut(card).unwrap()
}

pub(super) fn send(sim: &mut Sim, id: PlayerId, raw: RawCommand) {
    let _ = sim.submit(id, validate(raw).unwrap());
}

/// Steps until `id`'s weapon can start an attack on the next step.
pub(super) fn wait_ready(sim: &mut Sim, id: PlayerId) {
    let i = sim.w.idx(id).unwrap();
    for _ in 0..400 {
        if sim.w.players[i].core.weapon.ready_at <= sim.w.server_time + crate::constants::TICK_MS {
            return;
        }
        sim.step();
    }
    panic!("{id:?}'s weapon never got ready");
}

/// Presses `id`'s trigger toward `a` on the next step, lets go the step after, and returns the events of `ticks` steps.
pub(super) fn attack(sim: &mut Sim, id: PlayerId, a: f64, ticks: u32) -> Vec<Event> {
    let mut out = Vec::new();
    send(sim, id, RawCommand::Attack { a, t: None });
    for t in 0..ticks {
        if t == 1 {
            send(sim, id, RawCommand::Release { a, t: None });
        }
        out.extend(sim.step());
    }
    out
}

/// The amounts of the weapon hits `by` landed on `victim`.
pub(super) fn hits(events: &[Event], by: PlayerId, victim: PlayerId) -> Vec<f64> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::Hit {
                victim: v,
                by: Some(b),
                amount,
                weapon: Some(_),
                passive: false,
                ..
            } if *v == victim && *b == by => Some(*amount),
            _ => None,
        })
        .collect()
}

pub(super) fn flight_range(w: WeaponId) -> f64 {
    match weapon(w).shape {
        Shape::Projectile { range, .. } => range,
        Shape::Arc { .. } => unreachable!("{w:?} is not a ranged weapon"),
    }
}

/// The shooter's spot: tile row 8 of the practice arena, clear of pillars and the fence to the east.
pub(super) fn lane() -> Vec2 {
    Vec2::new(100.0, 272.0)
}

fn tally_cap() -> f64 {
    crate::constants::REWORK_MARKSMANS_TALLY_CAP
}

fn tally_per() -> f64 {
    crate::constants::REWORK_MARKSMANS_TALLY_PER
}

/// A Tally holder (player 1, `w` at `lane()`) and a target (player 2) at `share` of `w`'s range (centre to centre).
fn tally_world(w: WeaponId, target_at: Vec2, counter: f64) -> Sim {
    let mut sim = world(
        AugmentRule::Rework,
        &[
            seat("holder", lane(), Some(w), None),
            seat("target", target_at, Some(WeaponId::Sword), None),
        ],
    );
    give(&mut sim, PlayerId(1), CardId::MarksmansTally);
    slot_mut(&mut sim, PlayerId(1), CardId::MarksmansTally).counter = counter;
    sim
}

fn east_of_lane(d: f64) -> Vec2 {
    Vec2::new(lane().x + d, lane().y)
}

// ---------------------------------------------------------------------------------------------------------------------
// Marksman's Tally.
// ---------------------------------------------------------------------------------------------------------------------

/// Bow and wand: every hit that lands from far (target at 0.92 of the range) earns +0.003; a hit from 0.5 of the range
/// earns nothing, nor does a sword hit.
#[test]
fn marksmans_tally_earns_its_workbook_share_per_long_range_hit_only() {
    assert_eq!(registered("REWORK_MARKSMANS_TALLY_PER"), Some(0.003));
    assert_eq!(registered("REWORK_MARKSMANS_TALLY_CAP"), Some(0.30));
    let cases = [
        (WeaponId::Bow, flight_range(WeaponId::Bow) * 0.92, true),
        (WeaponId::Bow, flight_range(WeaponId::Bow) * 0.5, false),
        (WeaponId::Wand, flight_range(WeaponId::Wand) * 0.92, true),
        (WeaponId::Wand, flight_range(WeaponId::Wand) * 0.5, false),
        (WeaponId::Sword, 40., false),
    ];
    for (w, d, long) in cases {
        let mut sim = tally_world(w, east_of_lane(d), 0.);
        let mut landed = 0;
        for _ in 0..3 {
            wait_ready(&mut sim, PlayerId(1));
            let ev = attack(&mut sim, PlayerId(1), 0., 60);
            landed += hits(&ev, PlayerId(1), PlayerId(2)).len();
        }
        assert_eq!(landed, 3, "{w:?} at {d}: each attack lands once");
        let want = if long { 3. * tally_per() } else { 0. };
        let got = slot(&sim, PlayerId(1), CardId::MarksmansTally).counter;
        assert!(
            (got - want).abs() < 1e-12,
            "{w:?} at {d} (long {long}): counter {got}, want {want}"
        );
    }
}

/// The counter stops at the cap (30%) exactly.
#[test]
fn marksmans_tally_stops_at_its_cap() {
    let start = tally_cap() - tally_per() / 2.;
    let mut sim = tally_world(
        WeaponId::Bow,
        east_of_lane(flight_range(WeaponId::Bow) * 0.92),
        start,
    );
    wait_ready(&mut sim, PlayerId(1));
    let ev = attack(&mut sim, PlayerId(1), 0., 60);
    assert_eq!(
        hits(&ev, PlayerId(1), PlayerId(2)).len(),
        1,
        "the long shot lands"
    );
    assert_eq!(
        slot(&sim, PlayerId(1), CardId::MarksmansTally).counter,
        tally_cap(),
        "min(cap, counter + per)"
    );
    wait_ready(&mut sim, PlayerId(1));
    attack(&mut sim, PlayerId(1), 0., 60);
    assert_eq!(
        slot(&sim, PlayerId(1), CardId::MarksmansTally).counter,
        tally_cap()
    );
}

/// The counter is a damage share: a holder at the cap hits (1 + 0.30) times as hard as the same holder at 0 (a short
/// shot, which earns nothing, so the comparison is clean). Loose: within 2%.
#[test]
fn marksmans_tally_share_multiplies_the_holders_hits() {
    let near = east_of_lane(flight_range(WeaponId::Bow) * 0.5);
    let shot = |counter: f64| {
        let mut sim = tally_world(WeaponId::Bow, near, counter);
        wait_ready(&mut sim, PlayerId(1));
        let ev = attack(&mut sim, PlayerId(1), 0., 60);
        let h = hits(&ev, PlayerId(1), PlayerId(2));
        assert_eq!(h.len(), 1, "counter {counter}: the shot lands once");
        h[0]
    };
    let full = shot(tally_cap());
    let none = shot(0.);
    let r = full / none;
    let want = 1. + tally_cap();
    assert!(
        (r - want).abs() <= 0.02 * want,
        "at the cap {full} / at 0 {none} = {r}, want {want}"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Bastion.
// ---------------------------------------------------------------------------------------------------------------------

/// The Bastion world: the holder (player 1, shield, also holding Tank Engine) at (300, 272) facing east, a shield
/// attacker (player 2) 60 u east facing west, and a sword victim (player 3) 60 u south of the holder.
fn bastion_world() -> Sim {
    let holder = Vec2::new(300., 272.);
    let mut sim = world(
        AugmentRule::Rework,
        &[
            seat("holder", holder, Some(WeaponId::Shield), None),
            seat(
                "attacker",
                Vec2::new(holder.x + 60., holder.y),
                Some(WeaponId::Shield),
                None,
            ),
            seat(
                "victim",
                Vec2::new(holder.x, holder.y + 60.),
                Some(WeaponId::Sword),
                None,
            ),
        ],
    );
    give(&mut sim, PlayerId(1), CardId::Bastion);
    give(&mut sim, PlayerId(1), CardId::TankEngine);
    send(&mut sim, PlayerId(1), RawCommand::Aim { a: 0. });
    send(
        &mut sim,
        PlayerId(2),
        RawCommand::Aim {
            a: std::f64::consts::PI,
        },
    );
    sim.step();
    sim
}

/// Player 2 attacks the holder `n` times; returns how many of those the holder's shield blocked.
fn blocked_attacks(sim: &mut Sim, n: u32) -> usize {
    let mut blocks = 0;
    for _ in 0..n {
        wait_ready(sim, PlayerId(2));
        let ev = attack(sim, PlayerId(2), std::f64::consts::PI, 20);
        blocks += ev
            .iter()
            .filter(|e| matches!(e, Event::Block { id, by, .. } if *id == PlayerId(1) && *by == PlayerId(2)))
            .count();
    }
    blocks
}

fn bastion_meter(sim: &Sim) -> f64 {
    slot(sim, PlayerId(1), CardId::Bastion).meters[0]
}

fn bastion_cap() -> f64 {
    rule(CardId::Bastion).unwrap().meter_caps[0]
}

/// The meter cap is a registered row (250, brief decision: the workbook says only "Meter cap") and the only cap Bastion
/// uses; a checkpoint at the cap restores, one past it is refused.
#[test]
fn bastion_meter_cap_is_its_registered_row() {
    let cap = registered("REWORK_BASTION_METER_CAP");
    assert_eq!(
        cap,
        Some(250.),
        "REWORK_BASTION_METER_CAP: a hashed content! row"
    );
    let r = rule(CardId::Bastion).unwrap();
    assert_eq!(
        r.meter_caps,
        [250., 0., 0.],
        "meters[0] is the stored blocks"
    );
    assert_eq!(
        (r.counter_cap, r.marks),
        (0., 0),
        "counter and marks unused"
    );
    let mut sim = bastion_world();
    slot_mut(&mut sim, PlayerId(1), CardId::Bastion).meters[0] = 250.;
    let cp = serde_json::to_value(&sim).unwrap();
    assert!(Sim::restore(&cp).is_ok(), "a meter at the cap restores");
    let mut over = cp.clone();
    over["world"]["players"][0]["build"]["native"][0]["meters"][0] =
        serde_json::json!(f64::from_bits(250f64.to_bits() + 1));
    assert!(
        Sim::restore(&over).is_err(),
        "a meter past the cap is refused"
    );
}

/// Each block fills the meter by exactly what Tank Engine counted for it (`card_prevented`, legacy
/// `cardHooks.ts:192`), and the meter stops at the cap.
#[test]
fn bastion_fills_with_what_each_block_kept_up_to_its_cap() {
    let mut sim = bastion_world();
    assert_eq!(
        blocked_attacks(&mut sim, 3),
        3,
        "the holder blocks all three"
    );
    let kept = sim.w.player(PlayerId(1)).unwrap().card_prevented;
    assert!(kept > 0., "Tank Engine counted the blocks");
    let m = bastion_meter(&sim);
    assert!(
        (m - kept).abs() <= 1e-9 * kept,
        "meter {m} = what the blocks kept {kept}"
    );
    assert!(m < bastion_cap(), "three blocks stay under the cap");

    let mut sim = bastion_world();
    slot_mut(&mut sim, PlayerId(1), CardId::Bastion).meters[0] = bastion_cap() - 0.5;
    assert_eq!(blocked_attacks(&mut sim, 1), 1);
    assert!(sim.w.player(PlayerId(1)).unwrap().card_prevented > 0.5);
    assert_eq!(bastion_meter(&sim), bastion_cap(), "min(cap, meter + kept)");
}

/// What one run of the Bastion world gives: the meter before the bash, the damage the bash dealt the victim, the
/// meter after it, and the damage of a second bash.
struct Burst {
    meter: f64,
    first: f64,
    after: f64,
    second: f64,
}

fn burst_run(keep_meter: bool) -> Burst {
    let mut sim = bastion_world();
    assert_eq!(
        blocked_attacks(&mut sim, 3),
        3,
        "the holder blocks all three"
    );
    if !keep_meter {
        slot_mut(&mut sim, PlayerId(1), CardId::Bastion).meters[0] = 0.;
    }
    let meter = bastion_meter(&sim);
    let south = std::f64::consts::FRAC_PI_2;
    wait_ready(&mut sim, PlayerId(1));
    let first: f64 = hits(
        &attack(&mut sim, PlayerId(1), south, 20),
        PlayerId(1),
        PlayerId(3),
    )
    .iter()
    .sum();
    let after = bastion_meter(&sim);
    wait_ready(&mut sim, PlayerId(1));
    let second: f64 = hits(
        &attack(&mut sim, PlayerId(1), south, 20),
        PlayerId(1),
        PlayerId(3),
    )
    .iter()
    .sum();
    Burst {
        meter,
        first,
        after,
        second,
    }
}

/// The holder's next landed hit deals 35% of the meter more (after mitigation and the outgoing multipliers: stored
/// blocks are already mitigated damage) and empties the meter; the hit after it deals what a holder with an empty
/// meter deals.
#[test]
fn bastion_spends_the_meter_on_the_next_landed_hit_at_35_percent() {
    assert_eq!(registered("REWORK_BASTION_SHARE"), Some(0.35));
    let with = burst_run(true);
    let without = burst_run(false);
    assert!(with.meter > 0., "the blocks filled the meter");
    assert!(
        without.first > 0. && with.second > 0.,
        "the bashes land on the victim"
    );
    let burst = with.first - without.first;
    let want = crate::constants::REWORK_BASTION_SHARE * with.meter;
    assert!(
        (burst - want).abs() <= 1e-6 * want.max(1.),
        "burst {burst} = 0.35 x meter {} = {want}",
        with.meter
    );
    assert_eq!(with.after, 0., "the burst empties the meter");
    assert!(
        (with.second - without.second).abs() <= 1e-9 * without.second,
        "the next hit carries no burst: {} vs {}",
        with.second,
        without.second
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Readouts (C-OBS) and restore.
// ---------------------------------------------------------------------------------------------------------------------

/// The owner sees its own native cards' rows (card, kind, value, max) in native order; another player sees only its
/// own; a non-player and a Legacy world see none. Observations carry exactly these rows and nothing else native
/// (P-WIRE19-B).
#[test]
fn readouts_show_each_owner_its_own_native_cards_only() {
    let seats = [
        seat("a", Vec2::new(300., 272.), Some(WeaponId::Bow), None),
        seat("b", Vec2::new(360., 272.), Some(WeaponId::Shield), None),
        seat("c", Vec2::new(300., 400.), Some(WeaponId::Sword), None),
    ];
    let mut sim = world(AugmentRule::Rework, &seats);
    let plain = world(AugmentRule::Rework, &seats);
    give(&mut sim, PlayerId(1), CardId::MarksmansTally);
    give(&mut sim, PlayerId(1), CardId::Bastion);
    give(&mut sim, PlayerId(2), CardId::Bastion);
    slot_mut(&mut sim, PlayerId(1), CardId::MarksmansTally).counter = 0.12;
    slot_mut(&mut sim, PlayerId(1), CardId::Bastion).meters[0] = 40.;
    slot_mut(&mut sim, PlayerId(2), CardId::Bastion).meters[0] = 7.;
    let tally_cap = rule(CardId::MarksmansTally).unwrap().counter_cap;
    let meter_cap = registered("REWORK_BASTION_METER_CAP").unwrap_or(f64::NAN);
    assert_eq!(
        readouts(&sim, PlayerId(1)).rows(),
        &[
            Readout {
                card: CardId::MarksmansTally,
                kind: ReadoutKind::Counter,
                value: 0.12,
                max: tally_cap,
            },
            Readout {
                card: CardId::Bastion,
                kind: ReadoutKind::Meter,
                value: 40.,
                max: meter_cap,
            },
        ],
        "the owner's rows, in native order"
    );
    assert_eq!(
        readouts(&sim, PlayerId(2)).rows(),
        &[Readout {
            card: CardId::Bastion,
            kind: ReadoutKind::Meter,
            value: 7.,
            max: meter_cap,
        }],
        "player 2 sees its own Bastion, never player 1's"
    );
    assert!(
        readouts(&sim, PlayerId(3)).rows().is_empty(),
        "a non-holder has none"
    );
    assert!(
        readouts(&sim, PlayerId(99)).rows().is_empty(),
        "a non-player has none"
    );
    let legacy = world(AugmentRule::Legacy, &seats);
    for v in [PlayerId(1), PlayerId(2), PlayerId(3)] {
        assert!(readouts(&legacy, v).rows().is_empty());
        assert!(readouts(&plain, v).rows().is_empty());
    }
    // P-WIRE19-B (oracle-amend): the observation carries the viewer's own rows (`readouts`) and no other native state:
    // apart from them it equals the native-free world's.
    for v in [PlayerId(1), PlayerId(2), PlayerId(3)] {
        let o = observe(&sim, v, &[]);
        assert_eq!(o.readouts, readouts(&sim, v).rows(), "{v:?}: own rows");
        assert_eq!(
            crate::Observation {
                readouts: Vec::new(),
                ..o
            },
            observe(&plain, v, &[]),
            "{v:?}"
        );
    }
}

/// A checkpoint taken at any tick of a running count (arrows in flight under a nearly full Tally, a filling and spent
/// Bastion meter) restores hash-exact and plays on identically.
#[test]
fn a_checkpoint_mid_count_restores_hash_exact_and_plays_on() {
    let far = east_of_lane(flight_range(WeaponId::Bow) * 0.92);
    let holder = Vec2::new(300., 400.);
    let mut sim = world(
        AugmentRule::Rework,
        &[
            seat("tally", lane(), Some(WeaponId::Bow), None),
            seat("target", far, Some(WeaponId::Sword), None),
            seat("bastion", holder, Some(WeaponId::Shield), None),
            seat(
                "attacker",
                Vec2::new(holder.x + 60., holder.y),
                Some(WeaponId::Shield),
                None,
            ),
        ],
    );
    give(&mut sim, PlayerId(1), CardId::MarksmansTally);
    give(&mut sim, PlayerId(3), CardId::Bastion);
    let start = tally_cap() - 2.5 * tally_per();
    slot_mut(&mut sim, PlayerId(1), CardId::MarksmansTally).counter = start;
    let (p3, p4) = (PlayerId(3), PlayerId(4));
    send(&mut sim, p3, RawCommand::Aim { a: 0. });
    let mut filled = 0f64;
    for t in 0..240u32 {
        // Player 1 shoots east every 20 ticks; player 4 bashes the Bastion holder every 16; the holder bashes the
        // attacker back every 60 (spending the meter).
        let cp = serde_json::to_value(&sim).unwrap();
        let mut copy = Sim::restore(&cp).unwrap_or_else(|e| panic!("tick {t}: {e:?}"));
        assert_eq!(copy.state_hash(), sim.state_hash(), "tick {t}: restore");
        let cmds = [
            (PlayerId(1), t % 20 == 0, t % 20 == 1, 0.),
            (p4, t % 16 == 0, t % 16 == 1, std::f64::consts::PI),
            (p3, t % 60 == 59, t % 60 == 0 && t > 0, 0.),
        ];
        for s in [&mut sim, &mut copy] {
            for (id, press, release, a) in cmds {
                if press {
                    send(s, id, RawCommand::Attack { a, t: None });
                }
                if release {
                    send(s, id, RawCommand::Release { a, t: None });
                }
            }
        }
        let a = sim.step();
        let b = copy.step();
        assert_eq!(a, b, "tick {t}: events after restore");
        assert_eq!(copy.state_hash(), sim.state_hash(), "tick {t}: one step on");
        filled = filled.max(slot(&sim, p3, CardId::Bastion).meters[0]);
    }
    assert_eq!(
        slot(&sim, PlayerId(1), CardId::MarksmansTally).counter,
        tally_cap(),
        "the run reached the Tally cap from {start}"
    );
    assert!(filled > 0., "the Bastion meter filled during the run");
}
