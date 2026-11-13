//! P-MECHANICS-SALVAGE-2 (group 2 of `fix/mechanics-sim`, block and riposte bookkeeping): loose proofs, one per
//! mechanic, plus guards that pass today and must keep passing.
//!
//! * #8 the sword riposte carries the holder's `returned` mult (`packages/server/src/sim/melee.ts:84-90`, `:88`);
//! * #5c the card weapon-hit test excludes returned (`passive`) and follow-on (`derived`) hits
//!   (`packages/server/src/sim/cardHooks.ts:291-293`);
//! * #5b every block whose `blocked` hook ran is a Best Offense pending note, read after the pass for the streak and
//!   Wishful Thinking (`cardHooks.ts:206-214` push, `:319-323` read), in every world, reflected arrows included
//!   (`packages/server/src/sim/projectiles.ts:303-310`: the hook runs while the shooter exists).
//!
//! The rig is P-MECHANICS-SALVAGE-1's (`on_hit_salvage_tests.rs`): the capture rig's empty `room`, driven through
//! `validate` + `Sim::submit` with ordinary inputs; cards are granted directly. Legacy numbers come from
//! `parity/card-runtime/source.json` (cases named per test) and from `parity/card-onhit/source.json` on
//! `fix/mechanics-sim` (not merged; cited for the number only, owner direction 2026-11-10: no new pinned captures).
//!
//! Wishful Thinking (`packages/shared/src/cards.ts:399-404`, `cardHooks.ts:367-388`): each counted hit or Best Offense
//! block of the tick cuts the cast Wish's cooldown by 1000 ms, within a 30 s budget per 60 s window and never under half
//! the cooldown. The scenarios stay far from both caps (at most 7 s cut out of a 150 s Holy Wish), so "trimmed ms" is
//! exactly 1000 x (counted hits + counted blocks).
use crate::cards::CardId;
use crate::content::WeaponId;
use crate::events::Event;
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
    facing: Option<f64>,
    cards: Vec<CardId>,
}

/// The rig's seats: p0 at (300, 320), p1 at (332, 320), and an idle Fire third seat far away. Core profile is
/// `FactionMode::Off` (no faction layer); the full profile is every faction installer. Unlike P-MECHANICS-SALVAGE-1's
/// rig, the abilities are on with no opening Wish lock (below).
fn sim(seats: [Seat; 2], faction_mode: FactionMode) -> Sim {
    let far = Seat {
        faction: FactionId::Fire,
        at: (1100., 600.),
        weapon0: None,
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
            weapon1: None,
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
        // The card-runtime capture's config: abilities on, no opening Wish lock, so a seat can cast its Wish at once
        // (`tools/card-runtime-fixtures/cases.mts:15`, the cast on the first step).
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

/// The live statuses of `kind` on seat `victim` applied by seat `by`: values, in table order.
fn live(sim: &Sim, victim: usize, by: u32, kind: StatusKind) -> Vec<f64> {
    let now = sim.w.server_time;
    sim.players()[victim]
        .statuses
        .instances
        .iter()
        .filter(|s| s.kind == kind && s.until > now && s.source.id == Some(PlayerId(by + 1)))
        .map(|s| s.value)
        .collect()
}

/// Steps `n` ticks and returns the first status of `kind` seat `victim` carries from seat `by`, if any.
fn first_status(sim: &mut Sim, n: usize, victim: usize, by: u32, kind: StatusKind) -> Option<f64> {
    for _ in 0..n {
        sim.step();
        if let Some(&v) = live(sim, victim, by, kind).first() {
            return Some(v);
        }
    }
    None
}

fn near(got: f64, want: f64, tol: f64) -> bool {
    (got - want).abs() <= want.abs() * tol
}

/// The attacker p0 (Holy, `weapon`, `attacker_cards`) at (300, 320) facing +x, and the shield holder p1 (Holy) at
/// (332, 320) facing it: the card-runtime capture's `blockers` seats (`tools/card-runtime-fixtures/cases.mts:14`).
fn blockers(
    weapon: WeaponId,
    attacker_cards: Vec<CardId>,
    holder_cards: Vec<CardId>,
    faction_mode: FactionMode,
) -> Sim {
    sim(
        [
            Seat {
                faction: FactionId::Holy,
                at: (300., 320.),
                weapon0: Some(weapon),
                facing: None,
                cards: attacker_cards,
            },
            Seat {
                faction: FactionId::Holy,
                at: (332., 320.),
                weapon0: Some(WeaponId::Shield),
                facing: Some(std::f64::consts::PI),
                cards: holder_cards,
            },
        ],
        faction_mode,
    )
}

/// Six Vitality cards (the captures' padding, so the holder outlives the exchange) plus `extra`.
fn holder(extra: &[CardId]) -> Vec<CardId> {
    let mut c = vec![CardId::Vitality3; 6];
    c.extend_from_slice(extra);
    c
}

/// The full profile: every faction installer (the faction layer records block contacts here today).
fn full() -> FactionMode {
    FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam
}

/// What one exchange produced: the holder's Wish trim and the blocks it made.
struct Exchange {
    /// Milliseconds Wishful Thinking cut from p1's Wish (the sum of its trims).
    trimmed: f64,
    /// `Block` events with p1 as the holder (each one ran the source `blocked` hook: the attacker exists throughout).
    blocks: u32,
}

/// The capture's script (`real-block-pending-best-pocket-tank-wish`): on the first step p1 casts its Wish on itself and
/// p0 presses attack; 65 more steps holding; release; then `tail` steps.
fn exchange(sim: &mut Sim, tail: usize) -> Exchange {
    input(
        sim,
        1,
        RawCommand::Cast {
            slot: crate::abilities::Slot::Wish,
            x: 332.,
            y: 320.,
            id: None,
            t: None,
            seq: None,
        },
    );
    input(sim, 0, RawCommand::Attack { a: 0., t: None });
    let mut events = sim.step();
    for _ in 0..65 {
        events.extend(sim.step());
    }
    input(sim, 0, RawCommand::Release { a: 0., t: None });
    for _ in 0..1 + tail {
        events.extend(sim.step());
    }
    assert!(
        sim.w.players[1]
            .card_runtime
            .is_some_and(|r| r.wish_cast.is_some()),
        "the holder's Wish was cast (Wishful Thinking needs a cast to trim)"
    );
    let holder = PlayerId(2);
    Exchange {
        trimmed: sim.w.players[1].card_trims.iter().map(|t| t.ms).sum(),
        blocks: events
            .iter()
            .filter(|e| matches!(e, Event::Block { id, .. } if *id == holder))
            .count() as u32,
    }
}

// ----------------------------------------------------------------------------------------------- #8 riposte returned mult

/// A sword riposte is returned damage that carries the shield holder's `returned` mult: `raw * SHIELD_BLOCK_SHARE *
/// riposteShare() * returnedMultOf(target.s)` (`melee.ts:88`); Here Comes the Boom is `returned` x1.25
/// (`packages/shared/src/cards.ts:253-258`). Eye for an Eye runs Hemorrhage on that returned hit with `streak = false`
/// (`cardHooks.ts:125`, `onHit.ts:60`: no hit-mult division, so Boom's x2.5 hit mult does not enter).
///
/// Worked: the plain riposte bleed is 0.11256976744186048/s (sword raw x 0.07 x 0.5 x phys x 0.1 / 2 s, the
/// P-MECHANICS-SALVAGE-1 guard); with Boom it is 0.11256976744186048 x 1.25 = 0.1407122093023256/s, the legacy value
/// at tick 2 of `returned-eye-spike-no-recursion` (same seats and cards; `bleed:2`, source p1). Spiked Shell's return is
/// deferred to the next tick's ledger (`cardHooks.ts:139-146`), so the first bleed is the riposte's alone. The native
/// riposte packet has no returned mult: 0.1126 (20 % low).
#[test]
fn a_sword_riposte_carries_the_holders_returned_mult() {
    let mut sim = blockers(
        WeaponId::Sword,
        vec![CardId::SpikedShell],
        holder(&[
            CardId::EyeForAnEye,
            CardId::Hemorrhage,
            CardId::SpikedShell,
            CardId::HereComesTheBoom,
        ]),
        FactionMode::Off,
    );
    input(&mut sim, 0, RawCommand::Attack { a: 0., t: None });
    let got = first_status(&mut sim, 20, 0, 1, StatusKind::Dot);
    let want = 0.1407122093023256;
    assert!(
        got.is_some_and(|v| near(v, want, 0.1)),
        "Boom holder's riposte bleed on the swordsman: got {got:?}, legacy {want} = 0.11257 x 1.25 (melee.ts:88)"
    );
}

// ---------------------------------------------------------------------------------- #5c isWeaponHit excludes returned hits

/// `isWeaponHit` (`cardHooks.ts:291-293`) is false for a `passive` (returned) or `derived` (follow-on) hit, so a sword
/// riposte (`passive: true`, `melee.ts:86-89`) never reaches the streak or Wishful Thinking. A shield holder with
/// Wishful Thinking and no Best Offense blocks seven sword swings (the capture's script; blocks at ticks 2, 12, 22, 32,
/// 42, 51, 61 in `real-block-pending-best-pocket-tank-wish`) and ripostes each: legacy trims 0 ms and starts no streak.
/// The native counts each riposte as a weapon hit: 1000 ms per riposte (about 7000 ms) and a streak on the swordsman.
#[test]
fn a_riposte_is_no_weapon_hit_for_wishful_thinking_or_the_streak() {
    let mut sim = blockers(
        WeaponId::Sword,
        vec![],
        holder(&[CardId::WishfulThinking]),
        FactionMode::Off,
    );
    let x = exchange(&mut sim, 0);
    assert!(x.blocks >= 5, "the exchange made blocks: {}", x.blocks);
    assert_eq!(
        x.trimmed, 0.,
        "Wishful Thinking trim from {} ripostes: legacy 0 ms (cardHooks.ts:291-293)",
        x.blocks
    );
    assert!(
        sim.w.players[1].card_streak.is_none(),
        "a riposte starts no streak: got {:?}",
        sim.w.players[1].card_streak
    );
}

// ------------------------------------------------------------------------------------- #5b Best Offense pending note

/// A shield bash on a shield is a plain block (`packages/shared/src/interactions.ts:64`: no riposte), and the `blocked`
/// hook runs for it (`melee.ts:83`); Best Offense pushes `{by: holder, victim: attacker}` (`cardHooks.ts:206-214`) and
/// `afterDamage` notes it as one hit (`:319-323`), in any world. Legacy: 1000 ms per block. The native records block
/// contacts only when the faction layer is on (`FactionMode::engagement()`), so in a core world it trims nothing.
#[test]
fn best_offense_shield_bash_blocks_trim_the_wish_in_a_core_world() {
    let mut sim = blockers(
        WeaponId::Shield,
        vec![],
        holder(&[CardId::BestOffense, CardId::WishfulThinking]),
        FactionMode::Off,
    );
    let x = exchange(&mut sim, 0);
    assert!(x.blocks >= 1, "the exchange made blocks: {}", x.blocks);
    assert_eq!(
        x.trimmed,
        1000. * f64::from(x.blocks),
        "Best Offense trim for {} shield-bash blocks in a core world: legacy 1000 ms each (cardHooks.ts:206-214, :319-323)",
        x.blocks
    );
}

/// The trap of the brief (section 11): in a faction world the native counts each sword block twice for Wishful Thinking
/// (the block contact under Best Offense, and the riposte as a weapon hit). Legacy counts the block once and the riposte
/// never: the capture's core numbers are 150100 -> 143100 for 7 blocks (`real-block-pending-best-pocket-tank-wish`,
/// p1 `wishReadyAt`), i.e. exactly 1000 ms per block, and nothing in the faction layer changes that rule. The native
/// full-profile world trims 2000 ms per block.
#[test]
fn best_offense_sword_blocks_trim_once_each_in_a_faction_world() {
    let mut sim = blockers(
        WeaponId::Sword,
        vec![],
        holder(&[
            CardId::TankEngine,
            CardId::PocketSand,
            CardId::BestOffense,
            CardId::Hemorrhage,
            CardId::WishfulThinking,
        ]),
        full(),
    );
    let x = exchange(&mut sim, 0);
    assert!(x.blocks >= 5, "the exchange made blocks: {}", x.blocks);
    assert_eq!(
        x.trimmed,
        1000. * f64::from(x.blocks),
        "Best Offense trim for {} sword blocks in the full profile: legacy 1000 ms per block, 0 per riposte",
        x.blocks
    );
}

/// An arrow reflected by a shield runs the `blocked` hook while its shooter exists (`projectiles.ts:308-310`), so Best
/// Offense notes it (`cardHooks.ts:206-214`); the reflected arrow that then hits the archer is returned damage
/// (`returnedFlag`, `passive`) and counts for nothing (`:291-293`). Legacy: 1000 ms per reflection, in either world.
/// The native records no contact in a core world but counts the returned arrow as the holder's weapon hit (1000 ms, right
/// for the wrong reason, as the core guard below); in the full profile it counts both (2000 ms per reflection).
#[test]
fn best_offense_counts_a_reflected_arrow_once_in_every_world() {
    for (world, mode) in [("core", FactionMode::Off), ("full", full())] {
        let mut sim = blockers(
            WeaponId::Bow,
            vec![],
            holder(&[CardId::BestOffense, CardId::WishfulThinking]),
            mode,
        );
        let x = exchange(&mut sim, 40);
        assert!(
            x.blocks >= 1,
            "{world}: the arrow was reflected by the shield: {}",
            x.blocks
        );
        assert_eq!(
            x.trimmed,
            1000. * f64::from(x.blocks),
            "{world}: Best Offense trim for {} reflections: legacy 1000 ms each, 0 for the returned arrow",
            x.blocks
        );
    }
}

// ------------------------------------------------------------------------------------------- guards (pass today and after)

/// Guard: the capture case `real-block-pending-best-pocket-tank-wish` (core profile): seven sword blocks under Best
/// Offense trim p1's Wish from 150100 to 143100, i.e. 7000 ms. Today the native gets it right for the wrong reason
/// (riposte counted, block not); after the packet, for the right one. Fixing only one of #5b / #5c breaks it.
#[test]
fn guard_the_core_real_block_pending_case_trims_seven_seconds() {
    let mut sim = blockers(
        WeaponId::Sword,
        vec![],
        holder(&[
            CardId::TankEngine,
            CardId::PocketSand,
            CardId::BestOffense,
            CardId::Hemorrhage,
            CardId::WishfulThinking,
        ]),
        FactionMode::Off,
    );
    let x = exchange(&mut sim, 0);
    assert_eq!(
        x.blocks, 7,
        "legacy blocks at ticks 2, 12, 22, 32, 42, 51, 61"
    );
    assert_eq!(x.trimmed, 7000., "legacy wishReadyAt 150100 -> 143100");
}

/// Guard: a weapon hit that is not blocked still counts once for Wishful Thinking (`cardHooks.ts:317`): the swordsman
/// with Wishful Thinking casts its Wish and hits an unshielded target; 1000 ms per hit.
#[test]
fn guard_an_unblocked_weapon_hit_still_trims_the_wish() {
    let mut sim = sim(
        [
            Seat {
                faction: FactionId::Holy,
                at: (300., 320.),
                weapon0: Some(WeaponId::Sword),
                facing: None,
                cards: holder(&[CardId::WishfulThinking]),
            },
            Seat {
                faction: FactionId::Holy,
                at: (332., 320.),
                weapon0: None,
                facing: None,
                cards: holder(&[]),
            },
        ],
        FactionMode::Off,
    );
    input(
        &mut sim,
        0,
        RawCommand::Cast {
            slot: crate::abilities::Slot::Wish,
            x: 300.,
            y: 320.,
            id: None,
            t: None,
            seq: None,
        },
    );
    input(&mut sim, 0, RawCommand::Attack { a: 0., t: None });
    let mut hits = 0u32;
    for _ in 0..40 {
        hits += sim
            .step()
            .iter()
            .filter(|e| {
                matches!(
                    e,
                    Event::Hit {
                        by: Some(PlayerId(1)),
                        passive: false,
                        ..
                    }
                )
            })
            .count() as u32;
    }
    assert!(
        sim.w.players[0]
            .card_runtime
            .is_some_and(|r| r.wish_cast.is_some()),
        "the swordsman's Wish was cast"
    );
    let trimmed: f64 = sim.w.players[0].card_trims.iter().map(|t| t.ms).sum();
    assert!(hits >= 1, "the swordsman landed hits: {hits}");
    assert_eq!(trimmed, 1000. * f64::from(hits));
}

/// Guard (carried from the review of P-MECHANICS-SALVAGE-1, rule #7 on a Spiked Shell return): an Eye for an Eye
/// holder with an axe in hand answers a sword hit with Spiked Shell's returned damage, which names the holder's active
/// weapon (`cardHooks.ts:139-146`: `weapon = activeWeapon(victim.s)`, `passive: true`); `onHitLanded` classes it as
/// returned and runs `runOnHit(..., streak = false)` for the Eye holder (`cardHooks.ts:125`), whose axe special shreds
/// `armor * k` = AXE_SHRED_ARMOR 3 x k 1 (axe onHitPower 1, one application: `onHit.ts:35-55`,
/// `packages/shared/src/constants.ts:303-305`). Expected: shred 3 on the swordsman, by the holder.
#[test]
fn guard_eye_for_an_eye_spiked_shell_return_shreds_with_the_axe() {
    let mut sim = sim(
        [
            Seat {
                faction: FactionId::Holy,
                at: (300., 320.),
                weapon0: Some(WeaponId::Sword),
                facing: None,
                cards: vec![],
            },
            Seat {
                faction: FactionId::Holy,
                at: (332., 320.),
                weapon0: Some(WeaponId::Axe),
                facing: Some(std::f64::consts::PI),
                cards: holder(&[CardId::EyeForAnEye, CardId::SpikedShell]),
            },
        ],
        FactionMode::Off,
    );
    input(&mut sim, 0, RawCommand::Attack { a: 0., t: None });
    let got = first_status(&mut sim, 20, 0, 1, StatusKind::Shred);
    assert!(
        got.is_some_and(|v| near(v, 3., 0.01)),
        "axe shred from the Eye holder's Spiked Shell return: got {got:?}, legacy 3 (onHit.ts:50-55, k = 1)"
    );
}

/// Guard (carried from the review of P-MECHANICS-SALVAGE-1, the same-tick case): Best Offense's block bleed (applied at
/// once by the `blocked` hook) and the Eye for an Eye riposte bleed (in the pass) land on the swordsman in one tick and
/// share the tag `bleed:<tick>` (`onHit.ts:64`), so they add into one instance: 4.321875 + 0.11256976744186048 =
/// 4.434444767441861/s, the legacy value at tick 2 of `returned-eye-third-charm-not-counted`
/// (`fix/mechanics-sim:parity/card-onhit/source.json`; same seats and cards). The holder has no `returned` mult (x1):
/// the riposte multiplier of #8 must leave this sum unchanged.
#[test]
fn guard_same_tick_block_and_riposte_bleeds_share_one_instance() {
    let mut sim = blockers(
        WeaponId::Sword,
        vec![],
        holder(&[
            CardId::EyeForAnEye,
            CardId::Hemorrhage,
            CardId::SpikedShell,
            CardId::BestOffense,
            CardId::ThirdTimesTheCharm,
        ]),
        FactionMode::Off,
    );
    input(&mut sim, 0, RawCommand::Attack { a: 0., t: None });
    let mut got = None;
    for _ in 0..20 {
        sim.step();
        let bleeds = live(&sim, 0, 1, StatusKind::Dot);
        if !bleeds.is_empty() {
            got = Some(bleeds);
            break;
        }
    }
    let want = 4.434444767441861;
    assert!(
        got.as_ref()
            .is_some_and(|b| b.len() == 1 && near(b[0], want, 0.01)),
        "one bleed instance on the swordsman after the first block: got {got:?}, legacy [{want}]"
    );
}
