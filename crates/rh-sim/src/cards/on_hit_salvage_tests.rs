//! P-MECHANICS-SALVAGE-1 (group 1, the on-hit rules of `fix/mechanics-sim`): loose proofs, one per mechanic, that the
//! source `runOnHit` (`packages/server/src/sim/onHit.ts:47-73`) reaches the cases the native path misses.
//!
//! Each scenario is the capture rig's empty `room` (as `card_witness_tests`), driven through `validate` + `Sim::submit`
//! with ordinary attack/release/swap inputs; cards are granted directly (the same rows a reward pick grants). Expected
//! numbers are worked from the legacy formula and cross-checked against a value the legacy game produced:
//!
//! * `parity/card-runtime/source.json` (on this branch, captured by `tools/card-runtime-fixtures`): cases
//!   `interactive-choice-and-runtime-bestOffense` (bleed 4.321875/s on the swordsman per block) and
//!   `interactive-choice-and-runtime-eyeForAnEye` (riposte bleed 0.11256976744186048/s).
//! * `parity/card-onhit/{source,backlash}.json` on `fix/mechanics-sim` (not merged; cited for the numbers only, owner
//!   direction 2026-11-10: no new pinned captures): `axe-shred-third-charm` (first axe shred 6) and
//!   `fire-backlash-eye-for-an-eye` (shred 3 and bleed 4.82545899632803/s on the attacker at its first backlash).
//!
//! A bleed status's `value` is the source's `add.per = raw / (ms / 1000)` (onHit.ts:64), with Hemorrhage's row
//! `per 0.1, ms 2000` (`packages/shared/src/cards.ts:406-409`): value = hit * phys * 0.1 * k / 2.
use crate::cards::CardId;
use crate::content::WeaponId;
use crate::input::{validate, RawCommand};
use crate::map::TileMap;
use crate::status_runtime::StatusKind;
use crate::{Arena, FactionId, FactionMode, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

/// The capture rig's `room`: 40x24 walls with its five spawns and nothing inside.
fn room() -> Arena {
    let (w, h) = (40usize, 24usize);
    let rows: Vec<String> = (0..h)
        .map(|y| {
            (0..w)
                .map(|x| {
                    if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                        '#'
                    } else {
                        '.'
                    }
                })
                .collect()
        })
        .collect();
    let map = TileMap::from_rows(&rows).expect("room");
    let spawns = [
        (112., 112.),
        (400., 112.),
        (800., 112.),
        (112., 624.),
        (800., 624.),
    ]
    .iter()
    .map(|&(x, y)| Vec2::new(x, y))
    .collect();
    Arena { map, spawns }
}

struct Seat {
    faction: FactionId,
    at: (f64, f64),
    weapon0: Option<WeaponId>,
    weapon1: Option<WeaponId>,
    facing: Option<f64>,
    cards: Vec<CardId>,
}

/// The rig's seats: p0 at (300, 320), p1 at (332, 320), and an idle Fire third seat far away. Core profile is
/// `FactionMode::Off` (no faction layer); full profile is every faction installer.
fn sim(seats: [Seat; 2], faction_mode: FactionMode) -> Sim {
    let far = Seat {
        faction: FactionId::Fire,
        at: (1100., 600.),
        weapon0: None,
        weapon1: None,
        facing: None,
        cards: vec![],
    };
    let seats = [&seats[0], &seats[1], &far];
    let placements: Vec<Placement> = seats
        .iter()
        .map(|s| Placement {
            profile: s.faction.as_str().into(),
            faction: s.faction,
            bot: false,
            at: Vec2::new(s.at.0, s.at.1),
            hp: None,
            weapon0: s.weapon0,
            weapon1: s.weapon1,
        })
        .collect();
    let mut rng = crate::rng::Mulberry32::new(12);
    let secrets = Secrets {
        order_salt: rng.next_u32(),
        spawn_seed: 0,
        reward_salt: [1, 2, 3, 4],
    };
    let config = SimConfig {
        quests: false,
        pvp_rules: false,
        faction_mode,
        ..Default::default()
    };
    let mut sim = Sim::reset_active(config, room(), secrets, &placements);
    for (slot, s) in seats.iter().enumerate() {
        if let Some(f) = s.facing {
            sim.w.players[slot].core.body.facing = f;
        }
        for &card in &s.cards {
            assert!(crate::cards::grant(
                &sim.k,
                &mut sim.w,
                PlayerId(slot as u32 + 1),
                card
            ));
        }
    }
    sim
}

fn input(sim: &mut Sim, slot: u32, raw: RawCommand) {
    sim.submit(PlayerId(slot + 1), validate(raw).expect("valid input"))
        .expect("accepted input");
}

/// The live statuses of `kind` on seat `victim` applied by seat `by`: (startedAt, value), in table order.
fn live(sim: &Sim, victim: usize, by: u32, kind: StatusKind) -> Vec<(f64, f64)> {
    let now = sim.w.server_time;
    sim.players()[victim]
        .statuses
        .instances
        .iter()
        .filter(|s| s.kind == kind && s.until > now && s.source.id == Some(PlayerId(by + 1)))
        .map(|s| (s.started_at, s.value))
        .collect()
}

/// Steps `n` ticks and returns the first bleed (a Dot status) seat `victim` carries from seat `by`, if any.
fn first_bleed(sim: &mut Sim, n: usize, victim: usize, by: u32) -> Option<f64> {
    for _ in 0..n {
        sim.step();
        if let Some(&(_, v)) = live(sim, victim, by, StatusKind::Dot).first() {
            return Some(v);
        }
    }
    None
}

fn near(got: f64, want: f64, tol: f64) -> bool {
    (got - want).abs() <= want.abs() * tol
}

/// A sword swing on a shield holder facing it (the riposte outcome, melee.ts:78-95), p0 attacking along +x.
fn sword_on_shield(holder_cards: Vec<CardId>) -> Sim {
    sim(
        [
            Seat {
                faction: FactionId::Holy,
                at: (300., 320.),
                weapon0: Some(WeaponId::Sword),
                weapon1: None,
                facing: None,
                cards: vec![],
            },
            Seat {
                faction: FactionId::Holy,
                at: (332., 320.),
                weapon0: Some(WeaponId::Shield),
                weapon1: None,
                facing: Some(std::f64::consts::PI),
                cards: holder_cards,
            },
        ],
        FactionMode::Off,
    )
}

/// Six Vitality cards (the captures' padding, so the holder outlives the exchange) plus `extra`.
fn holder(extra: &[CardId]) -> Vec<CardId> {
    let mut c = vec![CardId::Vitality3; 6];
    c.extend_from_slice(extra);
    c
}

/// Best Offense: a block is the holder's own blow (`cardHooks.ts:206-214`): `runOnHit(holder, attacker, {weapon,
/// packet: packetFor(holder, weapon), scale: 1}, true)`, so a Hemorrhage holder bleeds the blocked swordsman at once.
/// k = shield onHitPower 1 x 1 application; hit mult 1. Legacy (`interactive-choice-and-runtime-bestOffense`, same
/// seats and cards): 4.321875/s, i.e. the holder's shield packet raw x phys = 86.4375. The native path never runs the
/// on-hit rows on a block: no bleed at all.
#[test]
fn best_offense_block_bleeds_the_blocked_swordsman() {
    let mut sim = sword_on_shield(holder(&[CardId::BestOffense, CardId::Hemorrhage]));
    input(&mut sim, 0, RawCommand::Attack { a: 0., t: None });
    let got = first_bleed(&mut sim, 20, 0, 1);
    let want = 4.321875;
    assert!(
        got.is_some_and(|v| near(v, want, 0.15)),
        "Best Offense block bleed on the swordsman: got {got:?}, legacy {want} (cardHooks.ts:206-214)"
    );
}

/// Eye for an Eye on returned damage: `onHitLanded` runs `runOnHit(..., streak = false)` (`cardHooks.ts:125`), and
/// `runOnHit` divides the bleed's raw by `hitMultOf` only when the streak counts (`onHit.ts:60`): the riposte bleed of
/// a Machine Gun holder (hit x0.5, `cards.ts:261-264`, no `returned` mult) is the plain holder's. Legacy riposte bleed
/// without Machine Gun (`interactive-choice-and-runtime-eyeForAnEye`): 0.11256976744186048/s = swordRaw x
/// SHIELD_BLOCK_SHARE 0.07 x RIPOSTE_SHARE 0.5 x phys x 0.1 / 2; Machine Gun leaves it unchanged. The native divides by
/// the holder's hit mult 0.5 and doubles it (about 0.2251).
#[test]
fn eye_for_an_eye_returned_bleed_ignores_the_holders_hit_mult() {
    let mut sim = sword_on_shield(holder(&[
        CardId::EyeForAnEye,
        CardId::Hemorrhage,
        CardId::MachineGun,
    ]));
    input(&mut sim, 0, RawCommand::Attack { a: 0., t: None });
    let got = first_bleed(&mut sim, 20, 0, 1);
    let want = 0.11256976744186048;
    assert!(
        got.is_some_and(|v| near(v, want, 0.15)),
        "Eye for an Eye riposte bleed with Machine Gun: got {got:?}, legacy {want} (onHit.ts:60, cardHooks.ts:125)"
    );
}

/// Guard (passes before and after): the plain Eye for an Eye riposte bleed (hit mult 1) is the captured legacy value.
#[test]
fn guard_eye_for_an_eye_plain_riposte_bleed_matches_the_capture() {
    let mut sim = sword_on_shield(holder(&[CardId::EyeForAnEye, CardId::Hemorrhage]));
    input(&mut sim, 0, RawCommand::Attack { a: 0., t: None });
    let got = first_bleed(&mut sim, 20, 0, 1);
    let want = 0.11256976744186048;
    assert!(
        got.is_some_and(|v| near(v, want, 0.01)),
        "plain Eye for an Eye riposte bleed: got {got:?}, legacy {want}"
    );
}

/// Guard (passes before and after): without Best Offense or Eye for an Eye a block applies no on-hit row.
#[test]
fn guard_a_block_without_the_cards_bleeds_nobody() {
    let mut sim = sword_on_shield(holder(&[CardId::Hemorrhage]));
    input(&mut sim, 0, RawCommand::Attack { a: 0., t: None });
    assert_eq!(first_bleed(&mut sim, 20, 0, 1), None);
}

/// The axe shred is `special.armor * k` (`onHit.ts:50-54`), k = onHitPower x onHitApplications; Third Time's the Charm
/// adds an application on every third hit in a row on one target (`onHit.ts:39`). Two sword hits, a swap, and the first
/// axe hit is the third in a row: legacy shred 6 = AXE_SHRED_ARMOR 3 x k 2 (`axe-shred-third-charm`, tick 27,
/// `packages/shared/src/constants.ts:303-305`). The native applies a flat 3 on that hit.
#[test]
fn the_axe_shred_doubles_on_a_third_charm_hit() {
    let mut sim = sim(
        [
            Seat {
                faction: FactionId::Holy,
                at: (300., 320.),
                weapon0: Some(WeaponId::Sword),
                weapon1: Some(WeaponId::Axe),
                facing: None,
                cards: vec![CardId::ThirdTimesTheCharm],
            },
            Seat {
                faction: FactionId::Holy,
                at: (332., 320.),
                weapon0: None,
                weapon1: None,
                facing: None,
                cards: vec![CardId::Vitality3; 5],
            },
        ],
        FactionMode::Off,
    );
    // The capture's inputs: attack, 10 ticks, release + swap to the axe, 12 ticks, attack, hold.
    input(&mut sim, 0, RawCommand::Attack { a: 0., t: None });
    sim.step();
    for _ in 0..10 {
        sim.step();
    }
    input(&mut sim, 0, RawCommand::Release { a: 0., t: None });
    input(&mut sim, 0, RawCommand::Swap { slot: Some(1) });
    sim.step();
    for _ in 0..12 {
        sim.step();
    }
    input(&mut sim, 0, RawCommand::Attack { a: 0., t: None });
    let mut first = None;
    for _ in 0..41 {
        sim.step();
        if let Some(&(_, v)) = live(&sim, 1, 0, StatusKind::Shred).first() {
            first = Some(v);
            break;
        }
    }
    assert!(
        first.is_some_and(|v| near(v, 6., 0.15)),
        "first axe shred on a third-in-a-row hit: got {first:?}, legacy 6 (onHit.ts:50-54)"
    );
}

/// Fire's backlash is returned damage (`mods.ts:639-644`: `sig === "backlash"` classes as "returned"), so an Eye for
/// an Eye Fire holder's backlash runs `runOnHit(..., streak = false)` on the attacker (`cardHooks.ts:125`): the axe's
/// shred (3 x k 1) and Hemorrhage's bleed. Legacy (`fire-backlash-eye-for-an-eye`, full profile, tick 2): shred 3 and
/// bleed 4.82545899632803/s on the swordsman. The native classes the backlash as no hit: neither applies.
#[test]
fn fire_backlash_applies_eye_for_an_eye_on_hit_effects() {
    let mut sim = sim(
        [
            Seat {
                faction: FactionId::Fire,
                at: (300., 320.),
                weapon0: Some(WeaponId::Axe),
                weapon1: None,
                facing: None,
                cards: holder(&[CardId::EyeForAnEye, CardId::Hemorrhage]),
            },
            Seat {
                faction: FactionId::Holy,
                at: (332., 320.),
                weapon0: Some(WeaponId::Sword),
                weapon1: None,
                facing: None,
                cards: holder(&[]),
            },
        ],
        FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
    );
    input(
        &mut sim,
        1,
        RawCommand::Attack {
            a: std::f64::consts::PI,
            t: None,
        },
    );
    let mut shred = None;
    let mut bleed = None;
    for _ in 0..20 {
        sim.step();
        shred = shred.or(live(&sim, 1, 0, StatusKind::Shred).first().map(|s| s.1));
        bleed = bleed.or(live(&sim, 1, 0, StatusKind::Dot).first().map(|s| s.1));
        if shred.is_some() && bleed.is_some() {
            break;
        }
    }
    assert!(
        shred.is_some_and(|v| near(v, 3., 0.15)),
        "axe shred from the Fire holder's backlash: got {shred:?}, legacy 3"
    );
    assert!(
        bleed.is_some_and(|v| near(v, 4.82545899632803, 0.15)),
        "Hemorrhage bleed from the Fire holder's backlash: got {bleed:?}, legacy 4.82545899632803"
    );
}
