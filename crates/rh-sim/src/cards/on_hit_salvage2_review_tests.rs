//! P-MECHANICS-SALVAGE-2 review notes (reviewer-opus, 2026-11-12): loose proofs beside the oracle
//! (`on_hit_salvage2_tests.rs`, read-only) for the cases its tests leave open.
//!
//! * A follow-on (`derived`) hit and a returned (`passive`) hit are no weapon hits for the cards
//!   (`packages/server/src/sim/cardHooks.ts:291-293`; the ledger copies both flags onto the landed record,
//!   `packages/server/src/sim/ledger.ts:378-379`): a wand splash and a Spiked Shell return neither trim Wishful Thinking
//!   nor feed the streak, while the direct wand hit in the same rig does.
//! * Best Offense's pending note for the two arrow traps of the brief (section 11): a twice-reflected arrow runs the
//!   `blocked` hook (its owner, the first reflector, exists) and counts once; an arrow whose shooter has left runs no hook
//!   (`packages/server/src/sim/projectiles.ts:305`, `:310`, `if (shooter)`) and counts zero.
//!
//! Rig: the capture rig's empty `room` (as the oracle), driven through `validate` + `Sim::submit`, abilities on with no
//! opening Wish lock, cards granted directly, core profile (`FactionMode::Off`). Wishful Thinking cuts 1000 ms per
//! counted hit or Best Offense block (`packages/shared/src/cards.ts:399-404`); the scenarios stay far below its caps.
use crate::cards::CardId;
use crate::content::WeaponId;
use crate::events::Event;
use crate::input::{validate, RawCommand};
use crate::map::TileMap;
use crate::{Arena, FactionId, FactionMode, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

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
    at: (f64, f64),
    weapon0: Option<WeaponId>,
    weapon1: Option<WeaponId>,
    facing: Option<f64>,
    cards: Vec<CardId>,
}

fn seat(at: (f64, f64), weapon0: Option<WeaponId>, facing: Option<f64>, extra: &[CardId]) -> Seat {
    // Six Vitality cards (the captures' padding, so every seat outlives the exchange) plus `extra`.
    let mut cards = vec![CardId::Vitality3; 6];
    cards.extend_from_slice(extra);
    Seat {
        at,
        weapon0,
        weapon1: None,
        facing,
        cards,
    }
}

/// Three Holy seats (slots 0, 1, 2 = ids 1, 2, 3) in the core profile.
fn sim(seats: [Seat; 3]) -> Sim {
    let placements: Vec<Placement> = seats
        .iter()
        .map(|s| Placement {
            profile: FactionId::Holy.as_str().into(),
            faction: FactionId::Holy,
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
        faction_mode: FactionMode::Off,
        abilities: crate::abilities::Mode::Full,
        wish_lock_ms: 0.,
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

/// Seat `slot` casts its Wish on itself (Wishful Thinking trims only a cast Wish).
fn cast_wish(sim: &mut Sim, slot: u32) {
    let (x, y) = {
        let b = &sim.w.players[slot as usize].core.body;
        (b.x, b.y)
    };
    input(
        sim,
        slot,
        RawCommand::Cast {
            slot: crate::abilities::Slot::Wish,
            x,
            y,
            id: None,
            t: None,
            seq: None,
        },
    );
}

fn trimmed(sim: &Sim, slot: usize) -> f64 {
    assert!(
        sim.w.players[slot]
            .card_runtime
            .is_some_and(|r| r.wish_cast.is_some()),
        "seat {slot}'s Wish was cast (Wishful Thinking needs a cast to trim)"
    );
    sim.w.players[slot].card_trims.iter().map(|t| t.ms).sum()
}

fn hits(events: &[Event], by: u32, victim: u32, passive: bool) -> u32 {
    events
        .iter()
        .filter(|e| {
            matches!(e, Event::Hit { by: Some(b), victim: v, passive: p, .. }
                if *b == PlayerId(by) && *v == PlayerId(victim) && *p == passive)
        })
        .count() as u32
}

fn blocks(events: &[Event], holder: u32, passive: bool) -> u32 {
    events
        .iter()
        .filter(|e| matches!(e, Event::Block { id, passive: p, .. } if *id == PlayerId(holder) && *p == passive))
        .count() as u32
}

// --------------------------------------------------------------------- follow-on and returned hits are no weapon hits

/// `isWeaponHit` is false for a `derived` (follow-on) or `passive` (returned) landed hit (`cardHooks.ts:291-293`,
/// `ledger.ts:378-379`).
///
/// Wand: p1 (Wishful Thinking) shoots p2 at 100 u; p3 stands 24 u from p2, inside the splash radius (48 u), and takes the
/// wand splash, a follow-on entry (`derived`). Legacy: 1000 ms per direct hit on p2 (the positive control), 0 per splash;
/// the streak is on p2 and counts the direct hits only.
///
/// Spiked Shell: p2 (Spiked Shell, Wishful Thinking, a sword in hand, no shield) is cut by p1's sword and answers with
/// Spiked Shell's returned damage (`cardHooks.ts:139-146`, `passive: true`, naming p2's sword). Legacy: 0 ms trimmed and
/// no streak for p2.
#[test]
fn a_follow_on_or_returned_hit_is_no_weapon_hit_for_the_cards() {
    // Wand splash (derived) with the direct hit as the positive control.
    let mut s = sim([
        seat(
            (300., 320.),
            Some(WeaponId::Wand),
            Some(0.),
            &[CardId::WishfulThinking],
        ),
        seat((400., 320.), None, None, &[]),
        seat((400., 344.), None, None, &[]),
    ]);
    cast_wish(&mut s, 0);
    input(&mut s, 0, RawCommand::Attack { a: 0., t: None });
    let mut ev = Vec::new();
    for _ in 0..40 {
        ev.extend(s.step());
    }
    let direct = hits(&ev, 1, 2, false);
    let splash = hits(&ev, 1, 3, false);
    assert!(direct >= 1, "the wand hit p2: {direct}");
    assert!(splash >= 1, "the wand splash hit p3: {splash}");
    assert_eq!(
        trimmed(&s, 0),
        1000. * f64::from(direct),
        "Wishful Thinking: legacy 1000 ms per direct wand hit ({direct}), 0 per splash ({splash}) (cardHooks.ts:291-293)"
    );
    let streak = s.w.players[0]
        .card_streak
        .expect("the direct hits start a streak");
    assert_eq!(
        (streak.target, u32::from(streak.count)),
        (PlayerId(2), direct),
        "the streak is on the direct target and counts its hits only"
    );

    // Spiked Shell return (passive).
    let mut s = sim([
        seat((300., 320.), Some(WeaponId::Sword), Some(0.), &[]),
        seat(
            (332., 320.),
            Some(WeaponId::Sword),
            Some(std::f64::consts::PI),
            &[CardId::SpikedShell, CardId::WishfulThinking],
        ),
        seat((1100., 600.), None, None, &[]),
    ]);
    cast_wish(&mut s, 1);
    input(&mut s, 0, RawCommand::Attack { a: 0., t: None });
    let mut ev = Vec::new();
    for _ in 0..40 {
        ev.extend(s.step());
    }
    let cut = hits(&ev, 1, 2, false);
    let returned = hits(&ev, 2, 1, true);
    assert!(cut >= 1, "the swordsman cut p2: {cut}");
    assert!(
        returned >= 1,
        "Spiked Shell returned damage to p1: {returned}"
    );
    assert_eq!(
        hits(&ev, 2, 1, false),
        0,
        "p2 made no hit of its own (the rig isolates the return)"
    );
    assert_eq!(
        trimmed(&s, 1),
        0.,
        "Wishful Thinking for {returned} Spiked Shell returns: legacy 0 ms (cardHooks.ts:291-293)"
    );
    assert!(
        s.w.players[1].card_streak.is_none(),
        "a Spiked Shell return starts no streak: got {:?}",
        s.w.players[1].card_streak
    );
}

// ------------------------------------------------------------------------------------ Best Offense and the arrow traps

/// p3 (bow) shoots -x: press, step until its first arrow is launched, then release. Returns the steps' events.
fn shoot(sim: &mut Sim) -> Vec<Event> {
    input(
        sim,
        2,
        RawCommand::Attack {
            a: std::f64::consts::PI,
            t: None,
        },
    );
    let mut ev = Vec::new();
    for _ in 0..40 {
        let step = sim.step();
        let launched = step
            .iter()
            .any(|e| matches!(e, Event::ProjectileLaunched(l) if l.owner == PlayerId(3)));
        ev.extend(step);
        if launched {
            input(
                sim,
                2,
                RawCommand::Release {
                    a: std::f64::consts::PI,
                    t: None,
                },
            );
            return ev;
        }
    }
    panic!("the archer launched no arrow");
}

/// A twice-reflected arrow (shield against shield): the first reflector p2 becomes the arrow's owner (the relaunch,
/// weapon `shield`) and the second reflector p1 blocks it as a `passive` block. The owner of that arrow (p2) exists, so
/// the `blocked` hook runs (`projectiles.ts:305`, `:310`) and Best Offense notes it once (`cardHooks.ts:206-214`,
/// `:319-323`); the arrow p1 sends back is returned damage and counts for nothing (`:291-293`). Legacy: p1 trims 1000 ms
/// per passive block, and has no plain block.
///
/// Geometry: p3's arrow flies -x into p2, who faces 45 degrees down-right (inside the 60 degree shield half arc), so the
/// reflection turns it to +y, into p1 below, who faces up at it.
#[test]
fn best_offense_counts_a_twice_reflected_arrow_once() {
    let mut s = sim([
        seat(
            (344., 420.),
            Some(WeaponId::Shield),
            Some(-std::f64::consts::FRAC_PI_2),
            &[CardId::BestOffense, CardId::WishfulThinking],
        ),
        seat(
            (332., 320.),
            Some(WeaponId::Shield),
            Some(std::f64::consts::FRAC_PI_4),
            &[],
        ),
        seat((560., 320.), Some(WeaponId::Bow), None, &[]),
    ]);
    cast_wish(&mut s, 0);
    let mut ev = shoot(&mut s);
    for _ in 0..40 {
        ev.extend(s.step());
    }
    let twice = blocks(&ev, 1, true);
    assert_eq!(blocks(&ev, 2, false), 1, "p2 reflected the archer's arrow");
    assert!(twice >= 1, "p1 blocked the reflected arrow: {twice}");
    assert_eq!(blocks(&ev, 1, false), 0, "p1 blocked no first-hand arrow");
    assert_eq!(
        trimmed(&s, 0),
        1000. * f64::from(twice),
        "Best Offense trim for {twice} twice-reflected arrows: legacy 1000 ms each (the hook ran: its owner p2 exists)"
    );
}

/// An arrow whose shooter left before it arrived: the shield still blocks it (the fx is emitted), but `combatant(world,
/// pr.owner)` is null, so the `blocked` hook does not run (`projectiles.ts:305`, `:310`, `if (shooter)`): no Best Offense
/// note (0 ms trimmed) and no Tank Engine tally (`cardHooks.ts:189-196`). Positive control in the same rig: the shooter
/// stays, and the same block trims 1000 ms and tallies the prevented damage.
#[test]
fn an_arrow_whose_shooter_left_runs_no_block_hook() {
    for leaves in [false, true] {
        let mut s = sim([
            seat((1100., 600.), None, None, &[]),
            seat(
                (332., 320.),
                Some(WeaponId::Shield),
                Some(0.),
                &[
                    CardId::TankEngine,
                    CardId::BestOffense,
                    CardId::WishfulThinking,
                ],
            ),
            seat((700., 320.), Some(WeaponId::Bow), None, &[]),
        ]);
        cast_wish(&mut s, 1);
        let mut ev = shoot(&mut s);
        if leaves {
            s.remove_player(PlayerId(3));
        }
        for _ in 0..40 {
            ev.extend(s.step());
        }
        let n = blocks(&ev, 2, false);
        assert_eq!(n, 1, "leaves {leaves}: p2's shield blocked the arrow");
        let prevented = s.w.players[1].card_prevented;
        if leaves {
            assert_eq!(
                trimmed(&s, 1),
                0.,
                "Best Offense trim for an arrow whose shooter left: legacy 0 (no hook)"
            );
            assert_eq!(prevented, 0., "Tank Engine tally with no hook: legacy 0");
        } else {
            assert_eq!(trimmed(&s, 1), 1000., "control: one hooked block, 1000 ms");
            assert!(prevented > 0., "control: Tank Engine tallied {prevented}");
        }
    }
}
