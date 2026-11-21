//! P-AUG-NATIVE-3 oracle: Pathfinder, Hazard Walker and Overflow through the real hooks (the zone batch table).
//!
//! Loose proof (owner direction 2026-11-10; brief `docs/backlog/packets/P-AUG-NATIVE-3.md`):
//! - Pathfinder (workbook Augment_Tuning "+1.2% per type, cap 24%"; Augments "First kill of each of the 20 mob types"):
//!   the first kill of each NORMAL mob type is worth +0.012 move speed, capped at 0.24; elites and repeats pay nothing; the
//!   walk is that much faster;
//! - Hazard Walker ("Faster growth, cap 15; immunity after 20 s on each hazard"): each hazard second grows stacks
//!   (one per `REWORK_HAZARD_WALKER_STACK_MS`, cap 15), each stack resists the hazard and adds max HP, 20 s on one hazard
//!   makes the holder immune to it (ember and bog are pinned; the ice effect is P-AUG-NATIVE-3c's, see the brief);
//! - Overflow ("Fades over 8 s"): healing beyond max hp becomes a barrier that fades over 8 s instead of the G6 5 s.
//!
//! Every world is `AugmentRule::Rework`; comparisons are between two worlds that differ only in the native state under
//! test (same seed, same commands), so the RNG draws and every other term cancel.
use super::exemplars_tests::{give, registered, seat, slot, slot_mut, world};
use crate::cards::native::hooks::{fire, NativeEvent};
use crate::cards::native::{readouts, rule, ReadoutKind};
use crate::cards::CardId;
use crate::constants::{BARRIER_MAX_SHARE, TERRAIN_BOG, TICK_MS};
use crate::fighter::FighterIx;
use crate::mob_catalog::{MobTypeId, DEFINITION};
use crate::{
    AugmentRule, Event, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, Vec2,
    WeaponId,
};

#[allow(non_snake_case)]
fn P1() -> PlayerId {
    PlayerId(1)
}

fn num(name: &str) -> f64 {
    registered(name).unwrap_or_else(|| panic!("{name} is not a registered content row"))
}

// ---------------------------------------------------------------------------------------------------------------------
// Harness: a world on one hazard tile of the seed-1 map (the terrain tests' arena).
// ---------------------------------------------------------------------------------------------------------------------

fn ember() -> u8 {
    4
}
fn bog() -> u8 {
    5
}
fn ice() -> u8 {
    6
}

fn seed1() -> crate::Arena {
    let map: crate::mapdata::MapExport =
        serde_json::from_str(include_str!("../../mapdata/fixtures/seed1.map.json")).unwrap();
    map.validate().unwrap().into_arena().unwrap()
}

fn centre(arena: &crate::Arena, kind: u8) -> Vec2 {
    let i = arena
        .map
        .layers()
        .unwrap()
        .data()
        .terrain
        .iter()
        .position(|k| *k == kind)
        .unwrap();
    Vec2::new(
        (i % arena.map.w as usize) as f64 * 32. + 16.,
        (i / arena.map.w as usize) as f64 * 32. + 16.,
    )
}

/// Player 1 (Holy, 500 hp) stands on the first tile of `kind`; player 2 waits at a spawn. Hazards on the map, no mobs.
fn hazard_world(kind: u8, holder: &[CardId]) -> Sim {
    let arena = seed1();
    let at = centre(&arena, kind);
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
            augments: AugmentRule::Rework,
            quests: false,
            hazards: crate::terrain::Mode::Map,
            mob_mode: crate::mob_runtime::MobMode::Off,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(5),
        &seats,
    );
    for card in holder {
        give(&mut sim, P1(), *card);
    }
    sim
}

/// The hp player 1 lost over `ticks` steps, summed over the ticks that took hp (terrain damage makes no `Event::Hit`).
fn hp_lost(sim: &mut Sim, ticks: u32) -> f64 {
    let mut lost = 0.;
    for _ in 0..ticks {
        let before = sim.w.player(P1()).unwrap().vitals.hp;
        sim.step();
        lost += (before - sim.w.player(P1()).unwrap().vitals.hp).max(0.);
    }
    lost
}

fn run(sim: &mut Sim, ticks: u32) -> Vec<Event> {
    (0..ticks).flat_map(|_| sim.step()).collect()
}

/// The normal (non-elite) mob types, then the elite ones, as the card's marks see them.
fn types(elite: bool) -> Vec<MobTypeId> {
    MobTypeId::ALL
        .into_iter()
        .filter(|t| {
            DEFINITION
                .types
                .iter()
                .any(|d| d.id as usize == *t as usize && d.elite == elite)
        })
        .collect()
}

// ---------------------------------------------------------------------------------------------------------------------
// Pathfinder.
// ---------------------------------------------------------------------------------------------------------------------

/// The first kill of each normal mob type pays 0.012 up to 0.24 (20 types); a repeat, an elite and a non-holder pay
/// nothing. The kills go through the hook dispatcher (the call site in `mob_life` is 1b's, pinned by its source scan).
#[test]
fn pathfinder_pays_one_point_two_percent_per_new_normal_mob_type_up_to_its_cap() {
    assert_eq!(registered("REWORK_PATHFINDER_PER"), Some(0.012));
    assert_eq!(registered("REWORK_PATHFINDER_CAP"), Some(0.24));
    let normal = types(false);
    let elite = types(true);
    assert_eq!(
        (normal.len(), elite.len()),
        (20, 10),
        "the catalog has 20 normal and 10 elite types"
    );
    let mut sim = world(
        AugmentRule::Rework,
        &[
            seat("holder", Vec2::new(300., 272.), None, None),
            seat("other", Vec2::new(300., 400.), None, None),
        ],
    );
    give(&mut sim, P1(), CardId::Pathfinder);
    let kill = |sim: &mut Sim, who: PlayerId, t: MobTypeId| {
        let (k, w) = (&sim.k, &mut sim.w);
        fire(k, w, who, NativeEvent::MobKill { mob_type: t });
    };
    for (n, t) in normal.iter().enumerate() {
        kill(&mut sim, P1(), *t);
        let s = slot(&sim, P1(), CardId::Pathfinder);
        let want = (0.012 * (n + 1) as f64).min(0.24);
        assert!(
            (s.counter - want).abs() < 1e-9,
            "after {} types: counter {}, want {want}",
            n + 1,
            s.counter
        );
        assert_eq!(s.marks.count_ones() as usize, n + 1, "one mark per type");
        // The same type again, and a rival's kill of it, pay nothing more.
        kill(&mut sim, P1(), *t);
        kill(&mut sim, PlayerId(2), *t);
        assert_eq!(
            slot(&sim, P1(), CardId::Pathfinder),
            s,
            "a repeat pays nothing"
        );
    }
    let full = slot(&sim, P1(), CardId::Pathfinder);
    assert!((full.counter - 0.24).abs() < 1e-9, "20 types reach the cap");
    assert_eq!(full.marks, rule(CardId::Pathfinder).unwrap().marks);
    for t in elite {
        kill(&mut sim, P1(), t);
    }
    assert_eq!(
        slot(&sim, P1(), CardId::Pathfinder),
        full,
        "an elite type is no mark"
    );
}

/// A holder with the counter at 0.24 (and one at 0.12) walks that much farther in the same time than a holder at 0.
#[test]
fn pathfinder_speeds_the_holders_walk_by_its_counter() {
    let walked = |counter: f64| {
        let mut sim = world(
            AugmentRule::Rework,
            &[seat("walker", Vec2::new(100., 272.), None, None)],
        );
        give(&mut sim, P1(), CardId::Pathfinder);
        slot_mut(&mut sim, P1(), CardId::Pathfinder).counter = counter;
        super::exemplars_tests::send(
            &mut sim,
            P1(),
            RawCommand::Move {
                x: 700.,
                y: 272.,
                seq: Some(1),
            },
        );
        run(&mut sim, 30);
        sim.w.player(P1()).unwrap().pos().x - 100.
    };
    let base = walked(0.);
    assert!(base > 100., "the baseline walks ({base})");
    for counter in [0.12, 0.24] {
        let r = walked(counter) / base;
        assert!(
            (r - (1. + counter)).abs() < 0.02,
            "counter {counter}: walked {r}x the baseline, want {}",
            1. + counter
        );
    }
}

/// `check_world` ties the counter to the marks: `min(cap, 0.012 x marks)`.
#[test]
fn pathfinder_check_ties_its_counter_to_its_marks() {
    let mut sim = world(
        AugmentRule::Rework,
        &[seat("holder", Vec2::new(300., 272.), None, None)],
    );
    give(&mut sim, P1(), CardId::Pathfinder);
    let normal = types(false);
    for t in &normal[..3] {
        let (k, w) = (&sim.k, &mut sim.w);
        fire(k, w, P1(), NativeEvent::MobKill { mob_type: *t });
    }
    let good = serde_json::to_value(&sim).unwrap();
    assert!(Sim::restore(&good).is_ok(), "three marks and 0.036 restore");
    let row = |counter: f64| {
        let mut v = good.clone();
        v["world"]["players"][0]["build"]["native"][0]["counter"] = serde_json::json!(counter);
        v
    };
    for (why, c) in [
        ("a counter above its marks", 0.048),
        ("a counter below its marks", 0.024),
        ("no counter with marks", 0.),
    ] {
        assert!(Sim::restore(row(c)).is_err(), "admitted: {why}");
    }
    let mut no_marks = good.clone();
    no_marks["world"]["players"][0]["build"]["native"][0]["marks"] = serde_json::json!(0);
    assert!(
        Sim::restore(&no_marks).is_err(),
        "admitted: a counter with no marks"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Hazard Walker.
// ---------------------------------------------------------------------------------------------------------------------

/// The registered rows this packet appends (decisions of the brief, section 1) and the workbook's.
#[test]
fn hazard_walker_rows_are_registered() {
    assert_eq!(registered("REWORK_HAZARD_WALKER_CAP"), Some(15.));
    assert_eq!(registered("REWORK_HAZARD_WALKER_IMMUNE_MS"), Some(20_000.));
    assert_eq!(registered("REWORK_HAZARD_WALKER_STACK_MS"), Some(1_000.));
    assert_eq!(registered("REWORK_HAZARD_WALKER_RESIST_PER"), Some(0.04));
    assert_eq!(registered("REWORK_HAZARD_WALKER_HP_PER"), Some(0.005));
}

/// Standing on each hazard for two seconds fills that hazard's meter with the ms stood there, and the stacks are one per
/// second of hazard time (whole numbers) across the three hazards. Reads the hook sites as they are: ember in `burn_dt`,
/// bog and ice in the move-modifier read.
#[test]
fn hazard_walker_counts_each_hazard_second_into_its_meter_and_whole_stacks() {
    for (kind, meter) in [(ember(), 0usize), (bog(), 1), (ice(), 2)] {
        let mut sim = hazard_world(kind, &[CardId::HazardWalker]);
        run(&mut sim, 40);
        let s = slot(&sim, P1(), CardId::HazardWalker);
        let stood = sim.w.terrain.seconds[meter] * 1000.;
        assert!(
            stood >= 1900.,
            "kind {kind}: the world counted {stood} ms on the hazard"
        );
        assert!(
            (s.meters[meter] - stood).abs() < 1e-6,
            "kind {kind}: meter {} ms, the world counted {stood}",
            s.meters[meter]
        );
        for (m, v) in s.meters.iter().enumerate() {
            if m != meter {
                assert_eq!(*v, 0., "kind {kind}: only meter {meter} grows");
            }
        }
        assert_eq!(s.counter, (stood / 1000.).floor(), "kind {kind}: stacks");
        assert_eq!(s.marks, 0, "kind {kind}: 2 s is not immunity");
    }
}

/// A stack resists the ember by 4%: ten stacks take 60% of a non-holder's burn, and the stack count pays a max-HP share
/// of 0.5% each.
#[test]
fn hazard_walker_stacks_resist_the_ember_and_add_max_hp() {
    let burn = |stacks: f64| {
        let mut sim = hazard_world(ember(), &[CardId::HazardWalker]);
        if stacks > 0. {
            let s = slot_mut(&mut sim, P1(), CardId::HazardWalker);
            s.counter = stacks;
            s.meters[0] = stacks * 1000.;
        } else {
            let i = sim.w.idx(P1()).unwrap();
            sim.w.players[i].build.set(CardId::HazardWalker, 0);
        }
        hp_lost(&mut sim, 20)
    };
    let bare = burn(0.);
    assert!(bare > 5., "an unprotected holder burns ({bare})");
    let r = burn(10.) / bare;
    assert!(
        (r - 0.6).abs() < 0.03,
        "ten stacks take {r} of the burn, want 0.6"
    );

    // Max hp: two stacks earned on the ember are two 0.5% shares of the base.
    let mut sim = hazard_world(ember(), &[CardId::HazardWalker]);
    let base = sim.w.player(P1()).unwrap().vitals.max_hp;
    run(&mut sim, 40);
    let stacks = slot(&sim, P1(), CardId::HazardWalker).counter;
    assert_eq!(stacks, 2., "two seconds, two stacks");
    let got = sim.w.player(P1()).unwrap().vitals.max_hp / base;
    assert!(
        (got - (1. + 2. * 0.005)).abs() < 1e-9,
        "max hp x{got}, want x1.01"
    );
}

/// A stack resists the bog the same way (the slow shrinks by the stack share), and immunity (20 s on it) takes the slow
/// away: the walk multiplier is 1.
#[test]
fn hazard_walker_resists_the_bog_slow_and_20_seconds_make_it_immune() {
    let mult = |counter: f64, bog_ms: f64, marks: u32| {
        let mut sim = hazard_world(bog(), &[CardId::HazardWalker]);
        let s = slot_mut(&mut sim, P1(), CardId::HazardWalker);
        s.counter = counter;
        s.meters[1] = bog_ms;
        s.marks = marks;
        let ix = FighterIx::of_slot(0);
        let view = crate::modifiers::view(sim.w.core(ix));
        crate::systems::terrain::bog_value(&sim.k, &sim.w, ix, view)
    };
    assert!((mult(0., 0., 0) - TERRAIN_BOG).abs() < 1e-12, "no stacks");
    let want = 1. - (1. - TERRAIN_BOG) * (1. - 10. * 0.04);
    assert!(
        (mult(10., 10_000., 0) - want).abs() < 1e-9,
        "ten stacks: {} want {want}",
        mult(10., 10_000., 0)
    );
    assert_eq!(
        mult(15., 20_000., 0b010),
        1.,
        "immune to the bog: no slow at all"
    );
    assert!(
        mult(15., 20_000., 0b101) < 1.,
        "immunity to the other hazards is no immunity to the bog"
    );
}

/// Twenty seconds on the ember set its mark (bit 0, ember) and then the ember does nothing; the other two marks stay
/// clear. The mark is earned by the tick that fills the meter; that tick's damage is still resisted, not immune.
#[test]
fn hazard_walker_is_immune_to_the_ember_after_20_seconds_on_it() {
    let mut sim = hazard_world(ember(), &[CardId::HazardWalker]);
    let s = slot_mut(&mut sim, P1(), CardId::HazardWalker);
    s.counter = 15.;
    s.meters[0] = 19_900.;
    let first = hp_lost(&mut sim, 2);
    assert!(first > 0., "two ticks short of 20 s still burn ({first})");
    let s = slot(&sim, P1(), CardId::HazardWalker);
    assert_eq!(s.marks, 0b001, "20 s on the ember is the ember's mark");
    assert_eq!(s.meters[0], 20_000., "the meter stops at the cap");
    let after = hp_lost(&mut sim, 40);
    assert_eq!(after, 0., "immune: no burn at all");
    assert_eq!(
        slot(&sim, P1(), CardId::HazardWalker).meters,
        [20_000., 0., 0.]
    );
}

/// `check_world`: the stacks are whole numbers and no more than the hazard time allows (`floor(sum of the meters /
/// stack ms)`).
#[test]
fn hazard_walker_check_demands_whole_stacks_the_meters_pay_for() {
    let mut sim = hazard_world(ember(), &[CardId::HazardWalker]);
    let s = slot_mut(&mut sim, P1(), CardId::HazardWalker);
    s.counter = 3.;
    s.meters = [2_500., 700., 0.];
    let good = serde_json::to_value(&sim).unwrap();
    assert!(Sim::restore(&good).is_ok(), "3 stacks for 3.2 s restore");
    let with = |counter: f64| {
        let mut v = good.clone();
        let row = &mut v["world"]["players"][0]["build"]["native"][0];
        assert_eq!(row["card"], serde_json::json!("hazardWalker"));
        row["counter"] = serde_json::json!(counter);
        v
    };
    assert!(Sim::restore(with(2.)).is_ok(), "fewer stacks than earned");
    assert!(Sim::restore(with(3.5)).is_err(), "admitted: 3.5 stacks");
    assert!(
        Sim::restore(with(4.)).is_err(),
        "admitted: 4 stacks for 3.2 s"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Overflow.
// ---------------------------------------------------------------------------------------------------------------------

fn overflow_world(card: bool) -> Sim {
    let mut sim = world(
        AugmentRule::Rework,
        &[seat("holder", Vec2::new(300., 272.), None, None)],
    );
    if card {
        give(&mut sim, P1(), CardId::Overflow);
    }
    sim
}

fn heal(sim: &mut Sim, amount: f64) {
    let mut ev = Vec::new();
    let i = sim.w.idx(P1()).unwrap();
    crate::systems::heal::apply(
        &mut sim.w,
        &mut ev,
        i,
        amount,
        crate::systems::heal::Kind::IgnoreLockout,
    );
}

fn barrier(sim: &Sim) -> f64 {
    sim.w.player(P1()).unwrap().vitals.barrier
}

/// Healing past max hp turns the excess (not the whole heal) into a barrier, at most the G6 cap; a non-holder gets none.
#[test]
fn overflow_turns_only_the_overheal_into_a_barrier_up_to_the_g6_cap() {
    assert_eq!(registered("REWORK_OVERFLOW_FADE_MS"), Some(8_000.));
    let mut sim = overflow_world(true);
    let max = sim.w.player(P1()).unwrap().vitals.max_hp;
    sim.w.players[0].core.vitals.hp = max - 100.;
    heal(&mut sim, 150.);
    assert!(
        (barrier(&sim) - 50.).abs() < 1e-9,
        "100 of 150 healed, 50 over: barrier {}",
        barrier(&sim)
    );
    let mut sim = overflow_world(true);
    heal(&mut sim, 10_000.);
    let cap = BARRIER_MAX_SHARE * max;
    assert!(
        (barrier(&sim) - cap).abs() < 1e-9,
        "a huge overheal stops at the cap {cap}, got {}",
        barrier(&sim)
    );
    let mut bare = overflow_world(false);
    heal(&mut bare, 10_000.);
    assert_eq!(barrier(&bare), 0., "no card, no barrier");
}

/// The barrier fades linearly over 8 s (the G6 barrier fades over 5): half left at 4 s, gone by 8 s.
#[test]
fn overflow_barrier_fades_over_eight_seconds() {
    let mut sim = overflow_world(true);
    heal(&mut sim, 10_000.);
    let start = barrier(&sim);
    assert!(start > 0.);
    run(&mut sim, 80);
    let half = barrier(&sim) / start;
    assert!(
        (half - 0.5).abs() < 0.03,
        "{half} of the barrier left at 4 s, want 0.5"
    );
    run(&mut sim, 70);
    assert!(barrier(&sim) > 0., "still some at 7.5 s");
    run(&mut sim, 15);
    assert_eq!(barrier(&sim), 0., "gone after 8 s");
}

// ---------------------------------------------------------------------------------------------------------------------
// Readouts, restore, native-free worlds.
// ---------------------------------------------------------------------------------------------------------------------

/// Each owner sees its own Pathfinder collection (counter and marks) and Hazard Walker stacks and meters; Overflow has no
/// row; a rival sees none of it.
#[test]
fn readouts_show_pathfinder_and_hazard_walker_to_their_owner_only() {
    let mut sim = world(
        AugmentRule::Rework,
        &[
            seat("holder", Vec2::new(300., 272.), None, None),
            seat("other", Vec2::new(300., 400.), None, None),
        ],
    );
    for c in [CardId::Pathfinder, CardId::HazardWalker, CardId::Overflow] {
        give(&mut sim, P1(), c);
    }
    for t in &types(false)[..5] {
        let (k, w) = (&sim.k, &mut sim.w);
        fire(k, w, P1(), NativeEvent::MobKill { mob_type: *t });
    }
    let hw = slot_mut(&mut sim, P1(), CardId::HazardWalker);
    hw.counter = 4.;
    hw.meters = [4_000., 250., 0.];
    let immune = num("REWORK_HAZARD_WALKER_IMMUNE_MS");
    let rows: Vec<_> = readouts(&sim, P1())
        .rows()
        .iter()
        .map(|r| (r.card, r.kind, r.value, r.max))
        .collect();
    use ReadoutKind::{Counter, Marks, Meter};
    let want = [
        (CardId::Pathfinder, Counter, 0.06, 0.24),
        (CardId::Pathfinder, Marks, 5., 20.),
        (CardId::HazardWalker, Counter, 4., 15.),
        (CardId::HazardWalker, Meter, 4_000., immune),
        (CardId::HazardWalker, Meter, 250., immune),
        (CardId::HazardWalker, Meter, 0., immune),
    ];
    assert_eq!(rows.len(), want.len(), "rows {rows:?}");
    for (g, w) in rows.iter().zip(want) {
        assert!(
            g.0 == w.0 && g.1 == w.1 && (g.2 - w.2).abs() < 1e-9 && (g.3 - w.3).abs() < 1e-9,
            "row {g:?}, want {w:?}"
        );
    }
    assert!(readouts(&sim, PlayerId(2)).rows().is_empty());
}

/// A checkpoint taken every few ticks while a holder of all three cards stands on the ember (growing stacks, taking
/// kills, healing into a fading barrier) restores hash-exact and plays on identically.
#[test]
fn a_checkpoint_mid_count_restores_hash_exact_and_plays_on() {
    let mut sim = hazard_world(
        ember(),
        &[CardId::Pathfinder, CardId::HazardWalker, CardId::Overflow],
    );
    let normal = types(false);
    let mut copy: Option<Sim> = None;
    for t in 0..120u32 {
        if t % 4 == 0 {
            let cp = serde_json::to_value(&sim).unwrap();
            let c = Sim::restore(&cp).unwrap_or_else(|e| panic!("tick {t}: {e:?}"));
            assert_eq!(c.state_hash(), sim.state_hash(), "tick {t}: restore");
            copy = Some(c);
        }
        let mut sims = vec![&mut sim];
        if let Some(c) = copy.as_mut() {
            sims.push(c);
        }
        let mut events = Vec::new();
        for s in sims {
            if t % 10 == 3 {
                let (k, w) = (&s.k, &mut s.w);
                fire(
                    k,
                    w,
                    P1(),
                    NativeEvent::MobKill {
                        mob_type: normal[(t / 10) as usize],
                    },
                );
            }
            if t % 30 == 29 {
                heal(s, 400.);
            }
            events.push(s.step());
        }
        if events.len() == 2 {
            assert_eq!(events[0], events[1], "tick {t}: events after restore");
            assert_eq!(
                copy.as_ref().unwrap().state_hash(),
                sim.state_hash(),
                "tick {t}: one step on"
            );
        }
    }
    let pf = slot(&sim, P1(), CardId::Pathfinder);
    assert!(
        pf.marks.count_ones() >= 10 && pf.counter > 0.1,
        "marks were earned"
    );
    let hw = slot(&sim, P1(), CardId::HazardWalker);
    assert!(hw.counter >= 5., "6 s of ember made stacks ({hw:?})");
    assert!(sim.w.player(P1()).unwrap().vitals.max_hp > 0.);
}

/// A Rework world where nobody holds a zone card plays as a Legacy one over the same hazard run: the new terrain, walk,
/// max-hp and barrier reads cost a non-holder nothing.
#[test]
fn a_world_without_zone_cards_is_unchanged_by_the_new_reads() {
    let run_world = |rule: AugmentRule| {
        let arena = seed1();
        let at = centre(&arena, ember());
        let seats = [Placement {
            profile: "p0".into(),
            faction: FactionId::Holy,
            bot: false,
            at,
            hp: Some(500.),
            weapon0: Some(WeaponId::Sword),
            weapon1: None,
        }];
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
        let mut log = Vec::new();
        for t in 0..80u32 {
            if t == 40 {
                heal(&mut sim, 3_000.);
            }
            log.push((sim.step(), barrier(&sim), sim.w.player(P1()).unwrap().pos()));
        }
        let p = sim.w.player(P1()).unwrap();
        (log, p.vitals.hp, p.vitals.max_hp, TICK_MS)
    };
    assert_eq!(
        run_world(AugmentRule::Legacy),
        run_world(AugmentRule::Rework)
    );
}
