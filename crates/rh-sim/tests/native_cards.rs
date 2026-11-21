//! P-AUG-NATIVE-1a oracle: the 14 native augment ids, their per-player capped state, its save/restore/hash path, the
//! `check_world` refusals, the registered workbook numbers, and that nothing of it is observed or offered yet.
//!
//! Loose proof (owner direction 2026-11-10; brief `docs/backlog/packets/P-AUG-NATIVE-1a.md`):
//! 1. ids 80..=93 outside `CardId::ALL`, each with a definition of its own (kind, tier, title; no rows yet);
//! 2. every workbook number (Augment_Tuning "Suggested change") is a registered `REWORK_*` row, and the caps read them;
//! 3. a `Rework` checkpoint holding native cards restores hash-exact and plays on; `Legacy` refuses one; the state hash
//!    sees the native state; observations do not;
//! 4. `check_world` refuses each cap and shape violation, and a `card_tank_hp` over the world's Tank Engine cap;
//! 5. no pool holds a native card; a Rework chest may offer one since P-WIRE19-A, a Legacy chest may not;
//! 6. the checkpoint format moved past `rh-checkpoint/33`; a Legacy world keeps its state hash and checkpoint bytes.
use rh_sim::arenas::practice_arena;
use rh_sim::cards::native::{rule, NATIVE_METERS};
use rh_sim::cards::{Build, CardId, CardKind, Tuning};
use rh_sim::constants::{ContentVal, REGISTRY};
use rh_sim::mob_catalog::{normal_types_of, MobTypeId};
use rh_sim::{
    observe, validate, AugmentRule, Command, Event, FactionId, Placement, PlayerId, RawCommand,
    Secrets, Sim, SimConfig, Vec2, WeaponId, CHECKPOINT_FORMAT,
};
use serde_json::{json, Value};

fn cmd(raw: RawCommand) -> Command {
    validate(raw).expect("a valid test command")
}

/// The 14 native ids in index order, with their serde names and titles (brief section 1, table).
const NATIVE: [(CardId, &str, &str); 14] = [
    (CardId::MarksmansTally, "marksmansTally", "Marksman's Tally"),
    (CardId::Bastion, "bastion", "Bastion"),
    (CardId::Calluses, "calluses", "Calluses"),
    (
        CardId::ExecutionersLedger,
        "executionersLedger",
        "Executioner's Ledger",
    ),
    (CardId::EighthStrike, "eighthStrike", "Eighth Strike"),
    (CardId::Pathfinder, "pathfinder", "Pathfinder"),
    (CardId::HazardWalker, "hazardWalker", "Hazard Walker"),
    (CardId::WishEngine, "wishEngine", "Wish Engine"),
    (CardId::Overflow, "overflow", "Overflow"),
    (CardId::CorpseHoarder, "corpseHoarder", "Corpse Hoarder"),
    (CardId::Stoked, "stoked", "Stoked"),
    (CardId::Glacier, "glacier", "Glacier"),
    (CardId::TrophyHunter, "trophyHunter", "Trophy Hunter"),
    (CardId::MarkedMan, "markedMan", "Marked Man"),
];

fn config(augments: AugmentRule) -> SimConfig {
    SimConfig {
        augments,
        ..SimConfig::default()
    }
}

/// Two seated players (a Fire bow at 400,400 and a Holy sword beside it), stepped twice.
fn world(augments: AugmentRule) -> Sim {
    let ps = [
        Placement {
            profile: "native-a".into(),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(400., 400.),
            hp: None,
            weapon0: Some(WeaponId::Bow),
            weapon1: None,
        },
        Placement {
            profile: "native-b".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(456., 400.),
            hp: None,
            weapon0: Some(WeaponId::Sword),
            weapon1: None,
        },
    ];
    let mut sim = Sim::reset_active(
        config(augments),
        practice_arena(),
        Secrets::from_seed(41),
        &ps,
    );
    sim.step();
    sim.step();
    sim
}

fn checkpoint(sim: &Sim) -> Value {
    serde_json::to_value(sim).unwrap()
}

/// One native row as the brief writes it: `{"card","count","counter","meters","marks"}`.
fn row(card: CardId, count: u64, counter: f64, meters: [f64; NATIVE_METERS], marks: u32) -> Value {
    json!({"card": card.as_str(), "count": count, "counter": counter, "meters": meters, "marks": marks})
}

/// The checkpoint with player slot `i`'s build holding these native rows.
fn with_native(cp: &Value, i: usize, rows: Value) -> Value {
    let mut cp = cp.clone();
    cp["world"]["players"][i]["build"]["native"] = rows;
    cp
}

fn cap(id: CardId) -> &'static rh_sim::cards::native::NativeRule {
    let r = rule(id);
    assert!(r.is_some(), "{id:?} has no native rule");
    r.unwrap()
}

fn next_up(v: f64) -> f64 {
    f64::from_bits(v.to_bits() + 1)
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. Ids and definitions.
// ---------------------------------------------------------------------------------------------------------------------

#[test]
fn native_ids_are_80_to_93_outside_all_each_with_its_own_definition() {
    assert_eq!(CardId::ALL.len(), 80, "the catalog stays the 80 cards");
    assert_eq!(CardId::NATIVE.len(), 14);
    for (i, (id, name, title)) in NATIVE.iter().enumerate() {
        assert_eq!(CardId::NATIVE[i], *id, "native order at {i}");
        assert_eq!(id.index(), 80 + i, "{id:?} index");
        assert_eq!(id.as_str(), *name);
        assert_eq!(serde_json::to_value(id).unwrap(), json!(name), "serde name");
        assert_eq!(
            serde_json::from_value::<CardId>(json!(name)).unwrap(),
            *id,
            "serde round trip"
        );
        assert!(!CardId::ALL.contains(id), "{id:?} is not a catalog card");
        let def = id.definition();
        assert_eq!(def.id, *id, "{id:?}: its own definition");
        assert_eq!(def.title, *title);
        assert_eq!(def.kind, CardKind::Augment);
        assert_eq!(def.tier, 1, "legacy's default augment tier (cards.ts:248)");
        assert_eq!(id.tier(), 1);
        assert!(def.unique, "{id:?} is held once");
        assert!(def.base.is_none() && def.requires.is_none());
        assert!(
            def.rows.is_empty() && def.selections.is_empty(),
            "{id:?}: no rows before its batch packet"
        );
        // The world tables answer the same definition (no override row for a native card).
        for rule in [AugmentRule::Legacy, AugmentRule::Rework] {
            assert_eq!(Tuning::of(&config(rule)).def(*id).id, *id);
        }
    }
    for id in CardId::ALL {
        assert!(rule(id).is_none(), "{id:?} is not native");
    }
}

#[test]
fn a_build_holds_a_native_card_beside_the_catalog_and_counts_its_tier() {
    let build = Build::from_counts([(CardId::TankEngine, 1), (CardId::Calluses, 1)]);
    assert!(build.owns(CardId::TankEngine) && build.owns(CardId::Calluses));
    assert!(!build.owns(CardId::Glacier));
    assert_eq!(build.count(CardId::Calluses), 1);
    assert_eq!(
        build.cards().collect::<Vec<_>>(),
        vec![CardId::TankEngine, CardId::Calluses],
        "the catalog cards first, then the native ones"
    );
    assert_eq!(
        build.power(),
        f64::from(CardId::TankEngine.tier()) + 1.,
        "legacy cardPower sums every held card's tier"
    );
    let catalog: u32 = build.counts().iter().map(|c| u32::from(*c)).sum();
    assert_eq!(catalog, 1, "the 80-entry count map holds no native card");
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. The workbook numbers.
// ---------------------------------------------------------------------------------------------------------------------

/// Augment_Tuning "Suggested change" (and the Augments sheet where Augment_Tuning keeps a number), brief section 4.
const NUMBERS: [(&str, f64); 26] = [
    ("REWORK_MARKSMANS_TALLY_PER", 0.003),
    ("REWORK_MARKSMANS_TALLY_CAP", 0.30),
    ("REWORK_MARKSMANS_TALLY_RANGE_SHARE", 0.8),
    ("REWORK_BASTION_SHARE", 0.35),
    ("REWORK_CALLUSES_PER", 0.07),
    ("REWORK_CALLUSES_CAP", 30.),
    ("REWORK_EXECUTIONERS_LEDGER_PER", 3.),
    ("REWORK_EXECUTIONERS_LEDGER_CAP", 30.),
    ("REWORK_EIGHTH_STRIKE_EVERY", 8.),
    ("REWORK_EIGHTH_STRIKE_MULT", 2.),
    ("REWORK_PATHFINDER_PER", 0.012),
    ("REWORK_PATHFINDER_CAP", 0.24),
    ("REWORK_HAZARD_WALKER_CAP", 15.),
    ("REWORK_HAZARD_WALKER_IMMUNE_MS", 20_000.),
    ("REWORK_WISH_ENGINE_CAP", 0.25),
    ("REWORK_WISH_ENGINE_CAP_MS", 300_000.),
    ("REWORK_OVERFLOW_FADE_MS", 8_000.),
    ("REWORK_CORPSE_HOARDER_PER", 0.03),
    ("REWORK_CORPSE_HOARDER_CAP", 0.24),
    ("REWORK_STOKED_PER", 2.),
    ("REWORK_STOKED_CAP", 30.),
    ("REWORK_GLACIER_PER", 0.15),
    ("REWORK_GLACIER_CAP", 30.),
    ("REWORK_TROPHY_HUNTER_PER", 0.02),
    ("REWORK_TROPHY_HUNTER_CAP", 0.15),
    ("REWORK_MARKED_MAN_STACK_MULT", 1.5),
];

fn registered(name: &str) -> Option<f64> {
    REGISTRY
        .iter()
        .find(|e| e.name == name)
        .map(|e| match e.val {
            ContentVal::F64(v) => v,
            ContentVal::U64(v) => v as f64,
            ContentVal::I64(v) => v as f64,
        })
}

#[test]
fn the_native_numbers_are_the_workbooks_registered_rows_and_the_caps_read_them() {
    for (name, want) in NUMBERS {
        assert_eq!(
            registered(name),
            Some(want),
            "{name}: a hashed content! row with the workbook number"
        );
    }
    let num = |name: &str| registered(name).unwrap();
    let counter_caps = [
        (CardId::MarksmansTally, num("REWORK_MARKSMANS_TALLY_CAP")),
        (CardId::Bastion, 0.),
        (CardId::Calluses, num("REWORK_CALLUSES_CAP")),
        (
            CardId::ExecutionersLedger,
            num("REWORK_EXECUTIONERS_LEDGER_CAP"),
        ),
        (CardId::EighthStrike, num("REWORK_EIGHTH_STRIKE_EVERY") - 1.),
        (CardId::Pathfinder, num("REWORK_PATHFINDER_CAP")),
        (CardId::HazardWalker, num("REWORK_HAZARD_WALKER_CAP")),
        (CardId::WishEngine, num("REWORK_WISH_ENGINE_CAP")),
        (CardId::Overflow, 0.),
        (CardId::CorpseHoarder, num("REWORK_CORPSE_HOARDER_CAP")),
        (CardId::Stoked, num("REWORK_STOKED_CAP")),
        (CardId::Glacier, num("REWORK_GLACIER_CAP")),
        (CardId::TrophyHunter, num("REWORK_TROPHY_HUNTER_CAP")),
        // P-AUG-NATIVE-5 (oracle-amend): the carried half stack (brief decision 3).
        (CardId::MarkedMan, num("REWORK_MARKED_MAN_CARRY_CAP")),
    ];
    let normal_types: u32 = FactionId::ALL
        .iter()
        .flat_map(|z| normal_types_of(*z))
        .map(|t| 1u32 << MobTypeId::ALL.iter().position(|id| *id == t.id).unwrap())
        .fold(0, |a, b| a | b);
    assert_eq!(normal_types.count_ones(), 20, "the 20 normal mob types");
    let immune = num("REWORK_HAZARD_WALKER_IMMUNE_MS");
    for (id, counter_cap) in counter_caps {
        let r = cap(id);
        assert_eq!(r.counter_cap, counter_cap, "{id:?} counter cap");
        let (meters, marks) = match id {
            CardId::HazardWalker => ([immune; NATIVE_METERS], 0b111),
            CardId::Pathfinder => ([0.; NATIVE_METERS], normal_types),
            CardId::Bastion => ([num("REWORK_BASTION_METER_CAP"), 0., 0.], 0),
            _ => ([0.; NATIVE_METERS], 0),
        };
        assert_eq!(r.meter_caps, meters, "{id:?} meter caps");
        assert_eq!(r.marks, marks, "{id:?} marks");
    }
}

/// `visit_progression_content` folds `CardId::ALL` as (index, name length, name bytes); the native ids are folded the
/// same way, so the rules identity (and the client/server content check) sees them.
#[test]
fn native_ids_and_names_reach_the_content_hash() {
    let mut words = Vec::new();
    rh_sim::content::visit_progression_content(|w| words.push(w));
    for (id, name, _) in NATIVE {
        let mut needle = vec![id.index() as u64, name.len() as u64];
        needle.extend(name.bytes().map(u64::from));
        assert!(
            words.windows(needle.len()).any(|w| w == needle.as_slice()),
            "{id:?} is not folded into the progression content words"
        );
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Save, restore, hash and observation.
// ---------------------------------------------------------------------------------------------------------------------

fn held_rows() -> Value {
    let tally = cap(CardId::MarksmansTally).counter_cap;
    let hazard = cap(CardId::HazardWalker);
    json!([
        row(CardId::MarksmansTally, 1, tally, [0.; NATIVE_METERS], 0),
        row(
            CardId::HazardWalker,
            1,
            3.,
            [hazard.meter_caps[0], 1500., 0.],
            0b001
        ),
        row(CardId::Stoked, 1, 0., [0.; NATIVE_METERS], 0),
    ])
}

#[test]
fn a_rework_checkpoint_with_native_cards_restores_hash_exact_and_plays_on() {
    let base = world(AugmentRule::Rework);
    let cp = with_native(&checkpoint(&base), 0, held_rows());
    let restored = Sim::restore(&cp);
    assert!(
        restored.is_ok(),
        "a Rework world holding native cards restores: {:?}",
        restored.err()
    );
    let mut a = restored.unwrap();
    let pid = PlayerId(1);
    let p = a.player(pid).unwrap();
    assert!(p.build.owns(CardId::MarksmansTally) && p.build.owns(CardId::HazardWalker));
    assert!(p.build.owns(CardId::Stoked) && !p.build.owns(CardId::Glacier));
    assert_eq!(a.check_layout(), Ok(()), "the hasher's layout rules hold");
    assert_ne!(
        a.state_hash(),
        base.state_hash(),
        "the state hash sees the native state"
    );
    // The canonical form is the forged one: the rows come back exactly, written before the counts.
    let again = checkpoint(&a);
    assert_eq!(again["world"]["players"][0]["build"]["native"], held_rows());
    let text = serde_json::to_string(&a).unwrap();
    assert!(
        text.contains("\"build\":{\"native\":["),
        "native is the first field of a build that holds one"
    );
    let mut b = Sim::restore(&again).expect("the re-saved checkpoint restores");
    assert_eq!(b.state_hash(), a.state_hash(), "restore is hash-exact");
    // Every native leaf is hashed: one ulp or one unit on any of them moves the hash.
    for (path, value) in [
        ("counter", json!(2.)),
        ("meters", json!([hazard_meter(), 1501., 0.])),
        ("marks", json!(0b011)),
    ] {
        let mut c = again.clone();
        c["world"]["players"][0]["build"]["native"][1][path] = value;
        let s = Sim::restore(&c).unwrap_or_else(|e| panic!("{path}: {e:?}"));
        assert_ne!(s.state_hash(), a.state_hash(), "{path} is hashed");
    }
    for t in 0..40u32 {
        for sim in [&mut a, &mut b] {
            if t % 5 == 0 {
                let _ = sim.submit(
                    pid,
                    cmd(RawCommand::Move {
                        x: 380. + f64::from(t),
                        y: 420.,
                        seq: Some(t as u8),
                    }),
                );
            }
        }
        let ea = a.step();
        let eb = b.step();
        assert_eq!(ea, eb, "tick {t}: events");
        assert_eq!(a.state_hash(), b.state_hash(), "tick {t}: state hash");
    }
}

fn hazard_meter() -> f64 {
    cap(CardId::HazardWalker).meter_caps[0]
}

#[test]
fn legacy_refuses_a_native_card_that_rework_admits() {
    let rows = json!([row(CardId::Calluses, 1, 0., [0.; NATIVE_METERS], 0)]);
    let rework = with_native(&checkpoint(&world(AugmentRule::Rework)), 1, rows.clone());
    assert!(
        Sim::restore(&rework).is_ok(),
        "positive control: Rework admits a held native card"
    );
    let legacy = with_native(&checkpoint(&world(AugmentRule::Legacy)), 1, rows);
    assert!(
        Sim::restore(&legacy).is_err(),
        "a native card is live-only: the Legacy world refuses it"
    );
}

#[test]
fn a_player_holding_a_native_card_is_observed_as_one_who_does_not() {
    let base = world(AugmentRule::Rework);
    let cp = checkpoint(&base);
    let mut plain = Sim::restore(&cp).unwrap();
    let forged = Sim::restore(with_native(&cp, 0, held_rows()));
    assert!(
        forged.is_ok(),
        "the native world restores: {:?}",
        forged.err()
    );
    let mut native = forged.unwrap();
    for t in 0..20u32 {
        for viewer in [PlayerId(1), PlayerId(2)] {
            // P-WIRE19-B: the holder (player 1) sees its own readout rows; nothing else tells a native card apart.
            let mut seen = observe(&native, viewer, &[]);
            assert_eq!(
                !seen.readouts.is_empty(),
                viewer == PlayerId(1),
                "tick {t}: viewer {viewer:?} sees readouts only for its own native cards"
            );
            seen.readouts.clear();
            assert_eq!(
                seen,
                observe(&plain, viewer, &[]),
                "tick {t}: viewer {viewer:?} sees no native card beyond its own readouts"
            );
        }
        let e1 = native.step();
        let e2 = plain.step();
        assert_eq!(e1, e2, "tick {t}: no event tells a native card apart");
    }
    let summary = native.player(PlayerId(1)).unwrap().build.counts();
    assert_eq!(summary, plain.player(PlayerId(1)).unwrap().build.counts());
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. check_world refusals.
// ---------------------------------------------------------------------------------------------------------------------

#[test]
fn check_world_refuses_native_state_outside_its_caps_and_shapes() {
    let cp = checkpoint(&world(AugmentRule::Rework));
    let z = [0.; NATIVE_METERS];
    let tally = cap(CardId::MarksmansTally).counter_cap;
    let hazard = cap(CardId::HazardWalker);
    let walker_cap = hazard.counter_cap;
    let meter = hazard.meter_caps[0];
    let restores = |rows: Value| Sim::restore(with_native(&cp, 0, rows)).is_ok();
    // Positive controls: every value at its cap, every allowed mark.
    assert!(restores(json!([row(
        CardId::MarksmansTally,
        1,
        tally,
        z,
        0
    )])));
    assert!(restores(json!([row(
        CardId::HazardWalker,
        1,
        walker_cap,
        [meter, meter, meter],
        0b111
    )])));
    let pathfinder = cap(CardId::Pathfinder);
    assert!(restores(json!([row(
        CardId::Pathfinder,
        1,
        pathfinder.counter_cap,
        z,
        pathfinder.marks
    )])));
    assert!(restores(json!([
        row(CardId::Calluses, 1, 0., z, 0),
        row(CardId::MarkedMan, 1, 0., z, 0)
    ])));
    let refused: Vec<(&str, Value)> = vec![
        (
            "counter over its cap",
            json!([row(CardId::MarksmansTally, 1, next_up(tally), z, 0)]),
        ),
        (
            "negative counter",
            json!([row(CardId::Calluses, 1, -1., z, 0)]),
        ),
        (
            "counter on a card whose counter is unused (cap 0)",
            json!([row(CardId::Bastion, 1, 1., z, 0)]),
        ),
        (
            "meter over its cap",
            json!([row(
                CardId::HazardWalker,
                1,
                0.,
                [0., next_up(meter), 0.],
                0
            )]),
        ),
        (
            "an unused meter that is not zero",
            json!([row(CardId::MarksmansTally, 1, 0., [0., 0., 1.], 0)]),
        ),
        (
            "a mark outside the card's bits",
            json!([row(CardId::HazardWalker, 1, 0., z, 0b1000)]),
        ),
        (
            "a mark on a card with no marks",
            json!([row(CardId::Stoked, 1, 0., z, 1)]),
        ),
        (
            "a Pathfinder mark that is no normal mob type",
            json!([row(CardId::Pathfinder, 1, 0., z, 1u32 << 31)]),
        ),
        (
            "a unique native card held twice",
            json!([row(CardId::Calluses, 2, 0., z, 0)]),
        ),
        (
            "a row with count 0 (not held is not written)",
            json!([row(CardId::Calluses, 0, 0., z, 0)]),
        ),
        ("an empty list (none held is no field)", json!([])),
        (
            "a catalog card in the native rows",
            json!([row(CardId::TankEngine, 1, 0., z, 0)]),
        ),
        (
            "a card written twice",
            json!([
                row(CardId::Calluses, 1, 0., z, 0),
                row(CardId::Calluses, 1, 0., z, 0)
            ]),
        ),
        (
            "rows out of native order",
            json!([
                row(CardId::Stoked, 1, 0., z, 0),
                row(CardId::Calluses, 1, 0., z, 0)
            ]),
        ),
    ];
    for (why, rows) in refused {
        assert!(!restores(rows), "admitted: {why}");
    }
}

/// The missing Tank Engine rule: `0 <= card_tank_hp <= C`, C the largest Fortify cap of the world's table (250 under
/// Legacy, legacy `cardHooks.ts:190-197`; 350 under Rework). Not tied to holding the card (hash_coverage perturbs it).
#[test]
fn check_world_caps_card_tank_hp_at_the_worlds_tank_engine_cap() {
    let cap_of = |rule: AugmentRule| {
        Tuning::of(&config(rule))
            .def(CardId::TankEngine)
            .rows
            .iter()
            .find_map(|r| match r {
                rh_sim::cards::CardRow::Trigger(t) => match t.action {
                    rh_sim::cards::TriggerAction::Fortify { cap, .. } => Some(cap),
                    _ => None,
                },
                _ => None,
            })
            .unwrap()
    };
    let legacy_cap = cap_of(AugmentRule::Legacy);
    let rework_cap = cap_of(AugmentRule::Rework);
    assert_eq!(legacy_cap, 250.);
    assert!(rework_cap > legacy_cap, "the Rework cap is larger (350)");
    for (rule, top) in [
        (AugmentRule::Legacy, legacy_cap),
        (AugmentRule::Rework, rework_cap),
    ] {
        let cp = checkpoint(&world(rule));
        let restores = |v: f64| {
            let mut c = cp.clone();
            c["world"]["players"][1]["card_tank_hp"] = json!(v);
            Sim::restore(&c).is_ok()
        };
        assert!(restores(0.), "{rule:?}: no bonus");
        assert!(restores(5e-324), "{rule:?}: hash_coverage's perturbation");
        assert!(restores(top), "{rule:?}: the cap itself");
        assert!(!restores(next_up(top)), "{rule:?}: over the cap");
        assert!(!restores(-1.), "{rule:?}: negative");
    }
    let mut c = checkpoint(&world(AugmentRule::Legacy));
    c["world"]["players"][0]["card_tank_hp"] = json!(rework_cap);
    assert!(
        Sim::restore(&c).is_err(),
        "the Legacy world holds no Rework-sized bonus"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. Not offered, not on the wire.
// ---------------------------------------------------------------------------------------------------------------------

/// The checkpoint with one declared camp-less chest at player slot 0's feet offering `card`.
fn with_chest(sim: &Sim, card: CardId) -> Value {
    let mut cp = checkpoint(sim);
    let chest_id = u32::try_from(cp["world"]["entity_counter"].as_u64().unwrap()).unwrap() + 1;
    let p = sim.player(PlayerId(1)).unwrap();
    let chest = json!({
        "id": chest_id, "at": {"x": p.body.x, "y": p.body.y},
        "expires_at": sim.server_time() + rh_sim::reward_chests::DEFINITION.lifetime_ms,
        "held_until_tick": 0, "options": [{"Card": card.as_str()}, null, null],
        "taken": [null, null, null], "pickers": [], "camp": null, "owner": null
    });
    cp["world"]["reward_chests"]
        .as_array_mut()
        .unwrap()
        .push(chest);
    cp["world"]["entity_counter"] = chest_id.into();
    cp
}

#[test]
fn no_pool_holds_a_native_card_and_only_a_rework_chest_may_offer_one() {
    for rule in [AugmentRule::Legacy, AugmentRule::Rework] {
        let t = Tuning::of(&config(rule));
        let pickers = [Build::default()];
        for id in t
            .pool()
            .iter()
            .chain(t.augment_pool(&pickers).iter())
            .chain(t.conditional_pool(&pickers).iter())
        {
            // P-AUG-NATIVE-4 (oracle-amend): a Rework chest pool holds the batch tables' native cards; Legacy none.
            let listed = rule == AugmentRule::Rework
                && rh_sim::cards::native::pool_members().any(|(c, _)| c == *id);
            assert!(id.index() < 80 || listed, "{rule:?} offers {id:?}");
        }
    }
    // P-WIRE19-A (oracle-amend): native ids are on the wire (`WireRewardId::Card(80..=93)`), so the chest refusal narrows
    // to the Legacy card table, which holds no native card.
    let rework = world(AugmentRule::Rework);
    let legacy = world(AugmentRule::Legacy);
    for sim in [&rework, &legacy] {
        assert!(
            Sim::restore(with_chest(sim, CardId::TankEngine)).is_ok(),
            "positive control: a declared camp-less chest restores"
        );
    }
    for (id, _, _) in NATIVE {
        let restored = Sim::restore(with_chest(&rework, id));
        assert!(
            restored.is_ok(),
            "a Rework chest may offer {id:?} now that native ids are on the wire: {:?}",
            restored.err()
        );
        assert!(
            Sim::restore(with_chest(&legacy, id)).is_err(),
            "a Legacy chest offering {id:?} is outside the Legacy card table"
        );
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. Identities.
// ---------------------------------------------------------------------------------------------------------------------

#[test]
fn the_checkpoint_format_moved_past_33_and_a_33_checkpoint_is_refused() {
    assert_ne!(
        CHECKPOINT_FORMAT, "rh-checkpoint/33",
        "the native rows are a new layout: bump CHECKPOINT_FORMAT"
    );
    let mut cp = checkpoint(&world(AugmentRule::Legacy));
    assert!(Sim::restore(&cp).is_ok());
    cp["format"] = json!("rh-checkpoint/33");
    assert!(Sim::restore(&cp).is_err(), "an old checkpoint is refused");
}

fn fnv(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

/// A Legacy match with catalog cards held (Tank Engine and Gambler through declared chests, Choose), the two players
/// fighting for 60 ticks. Its state hashes and its checkpoint's `world` and `statics` text are the ones the base
/// (7673f8a02; recorded at the stub, which serializes as the base) produced: a world holding no native card writes
/// nothing new and hashes as before.
#[test]
fn legacy_worlds_keep_their_state_hash_and_checkpoint_bytes() {
    let mut sim = world(AugmentRule::Legacy);
    for card in [CardId::TankEngine, CardId::Gambler] {
        let cp = with_chest(&sim, card);
        let chest_id = u32::try_from(cp["world"]["entity_counter"].as_u64().unwrap()).unwrap();
        sim = Sim::restore(cp).expect("a declared chest restores");
        sim.submit(
            PlayerId(1),
            cmd(RawCommand::Choose {
                chest_id: Some(chest_id),
                pick: 0,
            }),
        )
        .unwrap();
        let events = sim.step();
        assert!(events
            .iter()
            .any(|e| matches!(e, Event::ChestTaken { by, .. } if *by == PlayerId(1))));
    }
    let mut hashes = Vec::new();
    for t in 0..60u32 {
        for (id, a) in [(PlayerId(1), 0.), (PlayerId(2), std::f64::consts::PI)] {
            let _ = sim.submit(id, cmd(RawCommand::Aim { a }));
            if t % 6 == 0 {
                let _ = sim.submit(id, cmd(RawCommand::Attack { a, t: None }));
            }
            if t % 6 == 3 {
                let _ = sim.submit(id, cmd(RawCommand::Release { a, t: None }));
            }
        }
        sim.step();
        if t % 20 == 19 {
            hashes.push(sim.state_hash());
        }
    }
    let cp = checkpoint(&sim);
    let world = fnv(&serde_json::to_string(&cp["world"]).unwrap());
    let statics = fnv(&serde_json::to_string(&cp["statics"]).unwrap());
    let got = (hashes, world, statics);
    let want = (BASE_HASHES.to_vec(), BASE_WORLD, BASE_STATICS);
    assert_eq!(
        got, want,
        "a Legacy world's state hash or checkpoint bytes moved (recorded at the stub, base serialization)"
    );
}

// Recorded on `packet/P-AUG-NATIVE-1a` at the stub commit, whose serialized state equals the base's (the stub only
// appends `CardId` variants no Legacy world holds). FNV-1a 64 over `serde_json` text of the checkpoint `Value` parts.
// Coordinator oracle-amend 2026-11-19: re-recorded on coord/int-65 @ b6d6aea90 after P-ELITE-PICK-1 added the reward
// chest's `first_pick` field (`null` in a Legacy world's chests); values measured on the base's own sources.
const BASE_HASHES: [u64; 3] = [
    17_336_830_712_536_725_841,
    7_894_769_073_158_783_840,
    9_295_211_415_488_179_496,
];
const BASE_WORLD: u64 = 7_001_276_216_922_443_237;
// P-SYNC-ORIGIN-1: origin's P-TICK-1a writes `"tick_ms": null` into every 50 ms config; with that one key removed the
// merged statics text hashes to the pin before the merge, `2_263_326_562_367_864_595` (world and state hashes unchanged).
const BASE_STATICS: u64 = 16_122_486_807_007_151_944;
