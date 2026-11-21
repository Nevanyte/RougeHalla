//! P-AUG-NATIVE-1b oracle: the native hook points, the batch tables and the plan's 1b notes.
//!
//! Brief `docs/backlog/packets/P-AUG-NATIVE-1b.md` sections 1.1, 1.2 and 1.6:
//! - every hook point has a call site outside `cards/native/` (source scan of `NativeEvent::<Name>`);
//! - through real play, a hook fires once per event for a holder of a native card and never for a non-holder
//!   (long-range hit, hit count, fist hit, block, credited kill; read from the `cfg(test)` dispatch trace);
//! - a Rework world where nobody holds a native card plays exactly as on the base (digests recorded at the stub);
//! - the three batch tables hold their own batches' cards, and no pool or offer reads them yet (P-WIRE19-A);
//! - `trusted_build::apply` refuses a native card outside Rework; `MAX_FOLD_ROWS` covers every card of both tables.
use super::exemplars_tests::{
    attack, flight_range, give, hits, lane, seat, send, wait_ready, world,
};
use super::hooks::{trace, NativeHook};
use crate::cards::{CardId, CardRow};
use crate::reward_chests::Offer;
use crate::{AugmentRule, Event, FactionId, PlayerId, RawCommand, Sim, Vec2, WeaponId};
use std::collections::BTreeMap;

/// The plan's 13 hook names (brief section 1.1), as the variants are named.
fn hook_names() -> [&'static str; 13] {
    [
        "LongRangeHit",
        "CreditedKill",
        "FistHit",
        "MobKill",
        "HazardTick",
        "WishCast",
        "CorpseHarvest",
        "BurstLanded",
        "ChillInflicted",
        "HuntStack",
        "Block",
        "Overheal",
        "HitCount",
    ]
}

fn is_test_file(path: &std::path::Path) -> bool {
    let name = path.file_name().unwrap().to_string_lossy();
    name == "tests.rs"
        || name.ends_with("_tests.rs")
        || path
            .components()
            .any(|c| matches!(c.as_os_str().to_str(), Some("tests" | "source_tests")))
}

/// The non-test sources of `crates/rh-sim/src` outside `cards/native/`.
fn call_site_sources() -> Vec<(String, String)> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let native = root.join("cards").join("native");
    let mut out = Vec::new();
    let mut dirs = vec![root.clone()];
    while let Some(dir) = dirs.pop() {
        let mut entries: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        entries.sort();
        for path in entries {
            if path.is_dir() {
                if path != native {
                    dirs.push(path);
                }
            } else if path.extension().is_some_and(|e| e == "rs") && !is_test_file(&path) {
                let rel = path.strip_prefix(&root).unwrap().display().to_string();
                out.push((rel, std::fs::read_to_string(&path).unwrap()));
            }
        }
    }
    out
}

/// Each hook point is fired from a system or hook link outside the native module (a helper call, never a schedule row:
/// `crates/rh-parity/tests/schedule.rs` keeps the tables equal to the legacy record).
#[test]
fn every_native_hook_point_has_a_call_site_outside_the_native_module() {
    let names = hook_names();
    assert_eq!(
        NativeHook::ALL.map(|h| format!("{h:?}")),
        names.map(String::from),
        "the hook kinds are the plan's 13, in the brief's order"
    );
    let sources = call_site_sources();
    assert!(sources.len() > 100, "the scan reads the crate's sources");
    let missing: Vec<&str> = names
        .into_iter()
        .filter(|name| {
            let needle = format!("NativeEvent::{name}");
            !sources.iter().any(|(_, text)| text.contains(&needle))
        })
        .collect();
    assert!(
        missing.is_empty(),
        "hook points with no call site outside cards/native/: {missing:?}"
    );
}

fn tally(trace: &[(PlayerId, NativeHook)], who: PlayerId) -> BTreeMap<NativeHook, usize> {
    let mut out = BTreeMap::new();
    for (p, h) in trace {
        if *p == who {
            *out.entry(*h).or_insert(0) += 1;
        }
    }
    out
}

fn expect(pairs: &[(NativeHook, usize)]) -> BTreeMap<NativeHook, usize> {
    pairs.iter().filter(|(_, n)| *n > 0).copied().collect()
}

/// Players `holder` and `other` each run `n` attacks toward `a`; returns both attacks' events.
fn both_attack(
    sim: &mut Sim,
    holder: PlayerId,
    other: PlayerId,
    a: f64,
    n: u32,
    ticks: u32,
) -> Vec<Event> {
    let mut out = Vec::new();
    for _ in 0..n {
        wait_ready(sim, holder);
        wait_ready(sim, other);
        send(sim, other, RawCommand::Attack { a, t: None });
        out.extend(attack(sim, holder, a, 1));
        send(sim, other, RawCommand::Release { a, t: None });
        send(sim, holder, RawCommand::Release { a, t: None });
        for _ in 1..ticks {
            out.extend(sim.step());
        }
    }
    out
}

/// Bows: a holder's long shots fire `LongRangeHit` and `HitCount` once per landed hit and nothing else; its short shots
/// fire only `HitCount`; a non-holder shooting the same way fires nothing.
#[test]
fn ranged_hooks_fire_once_per_landed_hit_for_holders_only() {
    let far = flight_range(WeaponId::Bow) * 0.92;
    for (share_of_far, long) in [(1., true), (0.5 / 0.92, false)] {
        let d = far * share_of_far;
        let other_lane = Vec2::new(lane().x, 400.);
        let mut sim = world(
            AugmentRule::Rework,
            &[
                seat("holder", lane(), Some(WeaponId::Bow), None),
                seat("other", other_lane, Some(WeaponId::Bow), None),
                seat(
                    "t1",
                    Vec2::new(lane().x + d, lane().y),
                    Some(WeaponId::Sword),
                    None,
                ),
                seat(
                    "t2",
                    Vec2::new(other_lane.x + d, other_lane.y),
                    Some(WeaponId::Sword),
                    None,
                ),
            ],
        );
        give(&mut sim, PlayerId(1), CardId::MarksmansTally);
        trace::take();
        let ev = both_attack(&mut sim, PlayerId(1), PlayerId(2), 0., 3, 60);
        let (h1, h2) = (
            hits(&ev, PlayerId(1), PlayerId(3)).len(),
            hits(&ev, PlayerId(2), PlayerId(4)).len(),
        );
        assert_eq!((h1, h2), (3, 3), "long {long}: every shot lands");
        let t = trace::take();
        assert_eq!(
            tally(&t, PlayerId(1)),
            expect(&[
                (NativeHook::LongRangeHit, if long { h1 } else { 0 }),
                (NativeHook::HitCount, h1)
            ]),
            "long {long}: the holder's hooks"
        );
        for p in [PlayerId(2), PlayerId(3), PlayerId(4)] {
            assert!(
                tally(&t, p).is_empty(),
                "long {long}: {p:?} holds no native card"
            );
        }
    }
}

/// Fists: a holder's punches fire `FistHit` and `HitCount` once each per landed hit; a non-holder's fire nothing.
#[test]
fn fist_hooks_fire_once_per_landed_punch_for_holders_only() {
    let mut sim = world(
        AugmentRule::Rework,
        &[
            seat("holder", Vec2::new(300., 272.), Some(WeaponId::Fists), None),
            seat("other", Vec2::new(300., 400.), Some(WeaponId::Fists), None),
            seat("t1", Vec2::new(340., 272.), Some(WeaponId::Sword), None),
            seat("t2", Vec2::new(340., 400.), Some(WeaponId::Sword), None),
        ],
    );
    give(&mut sim, PlayerId(1), CardId::MarksmansTally);
    trace::take();
    let ev = both_attack(&mut sim, PlayerId(1), PlayerId(2), 0., 3, 20);
    let (h1, h2) = (
        hits(&ev, PlayerId(1), PlayerId(3)).len(),
        hits(&ev, PlayerId(2), PlayerId(4)).len(),
    );
    assert!(h1 >= 3 && h2 >= 3, "the punches land: {h1}, {h2}");
    let t = trace::take();
    assert_eq!(
        tally(&t, PlayerId(1)),
        expect(&[(NativeHook::FistHit, h1), (NativeHook::HitCount, h1)])
    );
    for p in [PlayerId(2), PlayerId(3), PlayerId(4)] {
        assert!(tally(&t, p).is_empty(), "{p:?} holds no native card");
    }
}

/// Shields: each block of a holder's shield fires `Block` once (and nothing else); a non-holder's blocks fire nothing.
#[test]
fn block_hook_fires_once_per_block_for_holders_only() {
    let mut sim = world(
        AugmentRule::Rework,
        &[
            seat(
                "holder",
                Vec2::new(300., 272.),
                Some(WeaponId::Shield),
                None,
            ),
            seat("other", Vec2::new(300., 400.), Some(WeaponId::Shield), None),
            seat("a1", Vec2::new(360., 272.), Some(WeaponId::Shield), None),
            seat("a2", Vec2::new(360., 400.), Some(WeaponId::Shield), None),
        ],
    );
    give(&mut sim, PlayerId(1), CardId::Bastion);
    for p in [PlayerId(1), PlayerId(2)] {
        send(&mut sim, p, RawCommand::Aim { a: 0. });
    }
    sim.step();
    trace::take();
    let ev = both_attack(
        &mut sim,
        PlayerId(3),
        PlayerId(4),
        std::f64::consts::PI,
        3,
        20,
    );
    let blocks = |id: PlayerId| {
        ev.iter()
            .filter(|e| matches!(e, Event::Block { id: i, .. } if *i == id))
            .count()
    };
    assert_eq!(
        (blocks(PlayerId(1)), blocks(PlayerId(2))),
        (3, 3),
        "both shields block all three"
    );
    let t = trace::take();
    assert_eq!(
        tally(&t, PlayerId(1)),
        expect(&[(NativeHook::Block, blocks(PlayerId(1)))])
    );
    for p in [PlayerId(2), PlayerId(3), PlayerId(4)] {
        assert!(tally(&t, p).is_empty(), "{p:?} holds no native card");
    }
}

/// A player kill credited to a holder fires `CreditedKill` once (beside the killing hit's `HitCount`); a non-holder's
/// kill fires nothing.
#[test]
fn credited_kill_hook_fires_once_per_kill_for_holders_only() {
    let mut sim = world(
        AugmentRule::Rework,
        &[
            seat("holder", Vec2::new(300., 272.), Some(WeaponId::Sword), None),
            seat("other", Vec2::new(300., 400.), Some(WeaponId::Sword), None),
            seat("v1", Vec2::new(340., 272.), Some(WeaponId::Sword), Some(1.)),
            seat("v2", Vec2::new(340., 400.), Some(WeaponId::Sword), Some(1.)),
        ],
    );
    give(&mut sim, PlayerId(1), CardId::MarksmansTally);
    trace::take();
    let ev = both_attack(&mut sim, PlayerId(1), PlayerId(2), 0., 1, 20);
    let deaths = |victim: PlayerId, by: PlayerId| {
        ev.iter()
            .filter(
                |e| matches!(e, Event::Death { id, by: Some(b), .. } if *id == victim && *b == by),
            )
            .count()
    };
    assert_eq!(
        (
            deaths(PlayerId(3), PlayerId(1)),
            deaths(PlayerId(4), PlayerId(2))
        ),
        (1, 1),
        "both victims die"
    );
    let h1 = hits(&ev, PlayerId(1), PlayerId(3)).len();
    let t = trace::take();
    assert_eq!(
        tally(&t, PlayerId(1)),
        expect(&[(NativeHook::CreditedKill, 1), (NativeHook::HitCount, h1)])
    );
    for p in [PlayerId(2), PlayerId(3), PlayerId(4)] {
        assert!(tally(&t, p).is_empty(), "{p:?} holds no native card");
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// A native-free Rework world is unchanged.
// ---------------------------------------------------------------------------------------------------------------------

fn fnv(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

/// A Rework match where nobody holds a native card but every 1b hook point it can reach happens (long bow shots, fist
/// hits, shield blocks with Tank Engine held, a kill): its state hashes, events and checkpoint `world` text are the ones
/// the base produced (recorded at the stub, which has no call site).
#[test]
fn a_rework_world_without_native_cards_plays_as_on_the_base() {
    let far = flight_range(WeaponId::Bow) * 0.92;
    let mut sim = world(
        AugmentRule::Rework,
        &[
            seat("bow", lane(), Some(WeaponId::Bow), None),
            seat(
                "far",
                Vec2::new(lane().x + far, lane().y),
                Some(WeaponId::Sword),
                None,
            ),
            seat(
                "shield",
                Vec2::new(300., 400.),
                Some(WeaponId::Shield),
                None,
            ),
            seat(
                "basher",
                Vec2::new(360., 400.),
                Some(WeaponId::Shield),
                None,
            ),
            seat("fists", Vec2::new(300., 528.), Some(WeaponId::Fists), None),
            seat(
                "punched",
                Vec2::new(340., 528.),
                Some(WeaponId::Sword),
                Some(30.),
            ),
        ],
    );
    give(&mut sim, PlayerId(3), CardId::TankEngine);
    send(&mut sim, PlayerId(3), RawCommand::Aim { a: 0. });
    let mut events = Vec::new();
    let mut hashes = Vec::new();
    for t in 0..180u32 {
        let cmds = [
            (PlayerId(1), t % 20 == 0, t % 20 == 1, 0.),
            (PlayerId(4), t % 16 == 0, t % 16 == 1, std::f64::consts::PI),
            (PlayerId(5), t % 10 == 0, t % 10 == 1, 0.),
        ];
        for (id, press, release, a) in cmds {
            if press {
                send(&mut sim, id, RawCommand::Attack { a, t: None });
            }
            if release {
                send(&mut sim, id, RawCommand::Release { a, t: None });
            }
        }
        events.extend(sim.step());
        if t % 60 == 59 {
            hashes.push(sim.state_hash());
        }
    }
    assert!(
        events.iter().any(|e| matches!(e, Event::Death { .. })),
        "the punched player dies (a credited kill happens)"
    );
    assert!(
        !hits(&events, PlayerId(1), PlayerId(2)).is_empty(),
        "the long bow shots land"
    );
    assert!(
        events
            .iter()
            .any(|e| matches!(e, Event::Block { id, .. } if *id == PlayerId(3))),
        "the shield blocks"
    );
    let cp = serde_json::to_value(&sim).unwrap();
    let got = (
        hashes,
        fnv(&serde_json::to_string(&events).unwrap()),
        fnv(&serde_json::to_string(&cp["world"]).unwrap()),
    );
    let want = base();
    assert_eq!(
        got, want,
        "a native-free Rework world moved (recorded at the stub)"
    );
}

// Recorded on `packet/P-AUG-NATIVE-1b` at the stub commit (no native call site; the base's behaviour).
fn base() -> (Vec<u64>, u64, u64) {
    (
        vec![
            1_802_478_796_085_204_066,
            7_713_476_058_625_414_444,
            2_551_249_949_394_736_277,
        ],
        18_120_522_559_088_589_803,
        15_830_096_635_171_906_358,
    )
}

// ---------------------------------------------------------------------------------------------------------------------
// Batch tables, trusted build, fold rows.
// ---------------------------------------------------------------------------------------------------------------------

/// Each batch table holds only its own batch's cards (no card in two tables, faction cards offered per faction); the
/// weapon table holds the two exemplars; no pool, offer or chest pool reads the tables until P-WIRE19-A.
#[test]
fn the_batch_tables_hold_their_own_cards() {
    use CardId::*;
    type Batch = (&'static str, &'static [(CardId, Offer)], &'static [CardId]);
    let batches: [Batch; 3] = [
        (
            "weapon",
            super::weapon::POOL,
            &[
                MarksmansTally,
                Bastion,
                Calluses,
                ExecutionersLedger,
                EighthStrike,
            ],
        ),
        (
            "zone",
            super::zone::POOL,
            &[Pathfinder, HazardWalker, WishEngine, Overflow, MarkedMan],
        ),
        (
            "faction",
            super::faction::POOL,
            &[CorpseHoarder, Stoked, Glacier, TrophyHunter],
        ),
    ];
    let mut seen = Vec::new();
    for (name, pool, cards) in batches {
        for (card, offer) in pool {
            assert!(cards.contains(card), "{name} table holds {card:?}");
            assert!(!seen.contains(card), "{card:?} in two places");
            seen.push(*card);
            if name == "faction" {
                assert!(
                    matches!(offer, Offer::Faction(_)),
                    "{card:?} is faction-only"
                );
            }
        }
    }
    for card in [MarksmansTally, Bastion] {
        assert!(
            super::weapon::POOL.contains(&(card, Offer::Any)),
            "the weapon table lists {card:?} for every picker"
        );
    }
    assert_eq!(super::pool_members().count(), seen.len());
    // P-AUG-NATIVE-4 (oracle-amend): the membership is read now; `reward_chests::native_pool_tests` pins what it does.
}

/// The bench seam cannot put a native card in a Legacy world (it would fail `check_world`); in a Rework world it can.
/// A refused request changes nothing.
#[cfg(feature = "trusted-build-setup")]
#[test]
fn trusted_build_refuses_a_native_card_outside_rework() {
    use crate::trusted_build::{apply, BuildRefusal, TrustedBuild};
    let seats = [seat("a", lane(), Some(WeaponId::Bow), None)];
    let request = TrustedBuild {
        cards: vec![(CardId::TankEngine, 1), (CardId::MarksmansTally, 1)],
        ..Default::default()
    };
    let mut legacy = world(AugmentRule::Legacy, &seats);
    let before = serde_json::to_string(&legacy).unwrap();
    assert_eq!(
        apply(&mut legacy, PlayerId(1), &request),
        Err(BuildRefusal::NativeOutsideRework(CardId::MarksmansTally))
    );
    assert_eq!(
        serde_json::to_string(&legacy).unwrap(),
        before,
        "a refused request changes nothing"
    );
    let mut rework = world(AugmentRule::Rework, &seats);
    assert_eq!(apply(&mut rework, PlayerId(1), &request), Ok(()));
    let build = rework.player(PlayerId(1)).unwrap().build;
    assert!(build.owns(CardId::MarksmansTally) && build.owns(CardId::TankEngine));
    let cp = serde_json::to_value(&rework).unwrap();
    assert!(
        Sim::restore(&cp).is_ok(),
        "the Rework grant passes check_world"
    );
}

/// The fold's fixed row bound covers one copy of every card of both tables, under each table and for every faction (a
/// faction's own row selection counts: `Tuning::rows(id, faction)`). `Build::rows` truncates silently when the bound
/// is full (plan note 2026-11-19); a batch that adds native fold rows raises it. On the base the bound is the catalog's
/// total under `definition()` (79), one short of a Plague player's selection (80): the implementer raises it.
#[test]
fn max_fold_rows_covers_every_card_of_both_tables() {
    let mut over = Vec::new();
    for rule in [AugmentRule::Legacy, AugmentRule::Rework] {
        let t = world(rule, &[seat("a", lane(), None, None)]).k.cards;
        for f in FactionId::ALL {
            let n: usize = CardId::ALL
                .into_iter()
                .chain(CardId::NATIVE)
                .map(|id| {
                    t.rows(id, f)
                        .iter()
                        .filter(|r| matches!(r, CardRow::Fold(_)))
                        .count()
                })
                .sum();
            if n > crate::cards::MAX_FOLD_ROWS {
                over.push((rule, f, n));
            }
        }
    }
    assert!(
        over.is_empty(),
        "fold rows of one copy of every card > MAX_FOLD_ROWS {}: {over:?}",
        crate::cards::MAX_FOLD_ROWS
    );
}
