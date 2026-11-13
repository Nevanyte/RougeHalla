//! P-MECHANICS-SALVAGE-3 (group 3 of `fix/mechanics-sim`, camp-clear and Wish bookkeeping): loose proofs, one per
//! mechanic, plus guards that pass today and must keep passing.
//!
//! * #1 the Bruiser camp-clear mirror: Holy's camp lifesteal reads the public mirror `PlayerState.campClears`
//!   (`packages/server/src/sim/factions.ts:895-896`), which only `bruiserPassives` writes
//!   (`packages/server/src/sim/bruiserPassives.ts:63-71` update, `:105-109` resetRun, `:115-126` install): without the
//!   installer the mirror stays 0 whatever the canonical `PlayerRuntime.campsCleared` holds;
//! * #3 `abilities.armWishes` refreshes every player's effect bits after the reset
//!   (`packages/server/src/sim/abilities.ts:84-99`: `rt.cast = null` at `:91`, `refreshEffects` at `:97`;
//!   `packages/server/src/sim/status.ts:345-365`: the casting bit comes from `rt.cast` alone);
//! * #4 `cardHooks.resetAll` drops the whole card memory, `rt.cards = undefined`
//!   (`packages/server/src/sim/cardHooks.ts:75-79`), which holds the damage-over-time crit memory too
//!   (`packages/server/src/sim/cardState.ts:22-27`: `critAccDot`, `dotRollTick`, `dotCrit`; `:59-70` `rollDotCrit`).
//!
//! #3 and #4 run through the real lobby: the raid starts inside a `Sim::step` (`systems/lobby.rs::start_raid`, legacy
//! `startRaid`: beginRun, then the `raidStarted` chain), so every link of the chain has run when the test reads the
//! state. The pending cast and the DoT crit memory are trusted placements in the lobby (no lobby input can make them),
//! standing in for whatever a world carried into the raid start.
use crate::events::Event;
use crate::map::TileMap;
use crate::status_runtime::stats::DotCritState;
use crate::status_runtime::{AbilityId, CancelCauses, CastFact};
use crate::{
    Arena, FactionId, FactionMode, Phase, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2,
};

/// The capture rig's `room` (as `cards/on_hit_salvage_tests.rs`): 40x24 walls with its five spawns and nothing inside.
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

fn secrets() -> Secrets {
    let mut rng = crate::rng::Mulberry32::new(12);
    Secrets {
        order_salt: rng.next_u32(),
        spawn_seed: 0,
        reward_salt: [1, 2, 3, 4],
    }
}

// ------------------------------------------------------------------------------------------------- #1 camp-clear mirror

/// A Holy p0 at (300, 320) and a Frost p1 at (600, 320) in the partial Holy foundation (`FactionMode::EngagementHoly`,
/// no mobs): `Gates::HOLY_FOUNDATION`, signatures on, the Bruiser installer off (the captured faction fixtures' module
/// set, `schedule.rs` `Gates::bruiser`). p0 at 500 hp with `clears` canonical camp clears deals one deferred plain hit
/// of raw 60 to p1 (the `holy-demon-blood` corpus's operation, `parity/holy-demon-blood/source.json`
/// `holy_one_clear`); the hit lands in the next step's ledger and Holy's lifesteal is paid in the factions
/// `afterDamage` row. Returns p0's hp after two steps, p1's hp loss, and p0's canonical count.
fn holy_lifesteal_without_the_installer(clears: u16) -> (f64, f64, u16) {
    let placements: Vec<Placement> = [(FactionId::Holy, 300.), (FactionId::Frost, 600.)]
        .iter()
        .map(|&(faction, x)| Placement {
            profile: faction.as_str().into(),
            faction,
            bot: false,
            at: Vec2::new(x, 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let config = SimConfig {
        quests: false,
        faction_mode: FactionMode::EngagementHoly,
        ..Default::default()
    };
    let mut sim = Sim::reset_active(config, room(), secrets(), &placements);
    assert!(
        !crate::schedule::Gates::of(&sim.k).bruiser
            && crate::schedule::Gates::of(&sim.k).signatures,
        "the rig is a faction world without the Bruiser installer"
    );
    let (p0, p1) = (PlayerId(1), PlayerId(2));
    let i0 = sim.w.idx(p0).unwrap();
    sim.w.players[i0].core.vitals.hp = 500.;
    sim.w.players[i0].camps_cleared = clears;
    let before = sim.w.player(p1).unwrap().vitals.hp;
    let mut entry = crate::systems::bruiser::contact_entry(p1, p0, None);
    entry.packet.raw = 60.;
    sim.w.deferred.defer_hit(entry);
    sim.step();
    sim.step();
    let p1_lost = before - sim.w.player(p1).unwrap().vitals.hp;
    let p0_hp = sim.w.player(p0).unwrap().vitals.hp;
    (p0_hp, p1_lost, sim.w.player(p0).unwrap().camps_cleared)
}

/// #1. Legacy: without `bruiserPassives` nothing writes `PlayerState.campClears` (it is written only at
/// `bruiserPassives.ts:68` and `:108`), so `holyCampLifestealOf(c.s.campClears)` (`factions.ts:896`,
/// `packages/shared/src/championPassives.ts:6-9`) is `holyCampLifestealOf(0)` = 0, whatever the canonical count. Worked:
/// the share with 3 canonical clears equals the share with 0, so p0 heals exactly the same in both worlds; the expected
/// difference in p0's hp is 0.
///
/// Native today reads `Player.camps_cleared` directly (`systems/signatures.rs::after_damage`), so 3 clears add
/// 3 x 0.005 = 0.015 of the damage fed (about 21.4 after the Frost seat's defense): p0 ends 0.3208 hp higher.
#[test]
fn a_holy_without_the_bruiser_installer_gains_no_camp_lifesteal() {
    let (with_clears, lost, _) = holy_lifesteal_without_the_installer(3);
    let (without, lost0, _) = holy_lifesteal_without_the_installer(0);
    assert!(
        lost > 0. && (lost - lost0).abs() < 1e-9,
        "the hit lands the same in both worlds"
    );
    assert!(
        (with_clears - without).abs() < 1e-9,
        "3 canonical clears without the installer: p0 hp {with_clears} vs {without} with none \
         (legacy mirror 0, no camp term; the extra {} is 0.015 x the damage fed)",
        with_clears - without
    );
}

/// Guard: the lifesteal itself is paid in this world (Holy's own share), and the canonical count is untouched: legacy
/// `PlayerRuntime.campsCleared` is still counted without the installer (`campHeal.ts:92`); only the public mirror is 0.
/// A port that zeroes or stops the count, or switches the Holy share off, fails here.
#[test]
fn guard_the_canonical_count_and_the_own_share_stay_without_the_installer() {
    let (hp, lost, clears) = holy_lifesteal_without_the_installer(3);
    assert!(lost > 0., "p1 took the deferred hit");
    assert!(hp > 500., "p0 healed its own Holy share: hp {hp}");
    assert_eq!(clears, 3, "the canonical camp count is kept");
}

// ----------------------------------------------------------------------------------- #3 armWishes, #4 cardHooks.resetAll

/// A core lobby (`FactionMode::Off`, capture gates) of two Holy humans that closes on its first step past the fill time
/// (`min_players` 1, no fill wait), so the raid starts inside `Sim::step`.
fn lobby() -> Sim {
    let config = SimConfig {
        quests: false,
        min_players: 1,
        fill_seconds: 0.,
        ..Default::default()
    };
    let mut sim = Sim::new(config, room(), secrets());
    for name in ["a", "b"] {
        sim.add_player(name, Some(FactionId::Holy), false)
            .expect("joined");
    }
    assert_eq!(sim.phase(), Phase::Lobby);
    sim
}

/// Steps until the `RaidStarted` event (at most 200 steps) and returns the sim as that step left it.
fn start_raid(mut sim: Sim) -> Sim {
    for _ in 0..200 {
        let ev = sim.step();
        if ev.iter().any(|e| matches!(e, Event::RaidStarted)) {
            assert_eq!(sim.phase(), Phase::Active);
            return sim;
        }
    }
    panic!("the lobby never started the raid");
}

/// A pending cast on seat `slot` (lands after it started, so `isCasting`), its casting bit set as the cast's start
/// left it (`status.ts:357`).
fn place_pending_cast(sim: &mut Sim, slot: usize) {
    let now = sim.w.server_time;
    let core = &mut sim.w.players[slot].core;
    core.statuses.cast = Some(CastFact {
        ability: AbilityId::Trial,
        started_at: now,
        lands_at: now + 5_000.,
        cancelled_by: CancelCauses::default(),
        producer: None,
    });
    core.statuses.refresh_effects(now);
    assert_ne!(
        core.statuses.effects & crate::status_runtime::EFFECT_CASTING,
        0,
        "the placed cast sets the casting bit"
    );
}

/// #3. Legacy `armWishes` (`abilities.ts:84-99`), for every player: `rt.cast = null` (`:91`), remove every status
/// (`:92`), then `refreshEffects(world, c)` (`:97`) unconditionally; `effectsOf` (`status.ts:345-359`) has no status and
/// no cast left, so `effects` = 0. Worked: a player with no status and a pending cast enters the raid with effects 0.
///
/// Native today (`systems/status/mod.rs::raid_started`) clears the cast but refreshes the bits only through the status
/// removal, which refreshes nothing when the player had no status: the casting bit 4096 survives the raid start.
#[test]
fn arm_wishes_drops_a_pending_casts_effect_bit_at_raid_start() {
    let mut sim = lobby();
    place_pending_cast(&mut sim, 0);
    assert!(sim.w.players[0].statuses.instances.is_empty());
    let sim = start_raid(sim);
    let p = &sim.w.players[0];
    assert_eq!(p.statuses.cast, None, "the cast is cleared (already today)");
    assert_eq!(
        p.statuses.effects, 0,
        "effects after raidStarted: legacy 0 (refreshEffects after the reset), native {}",
        p.statuses.effects
    );
}

/// Guard: a player without a pending cast and without statuses keeps effects 0 through the raid start, and the other
/// seat (no placement) too: the refresh adds no bit.
#[test]
fn guard_a_player_without_a_cast_enters_the_raid_with_no_effect_bits() {
    let sim = start_raid(lobby());
    for p in sim.w.players.iter() {
        assert_eq!(p.statuses.effects, 0, "{:?}", p.id);
        assert_eq!(p.statuses.cast, None);
    }
}

/// #4. Legacy `resetAll` (`cardHooks.ts:75-79`) sets `rt.cards = undefined` for every player; the next `cardsOf`
/// (`cardState.ts:22-27`) rebuilds it with `critAccDot: 0, dotRollTick: -1, dotCrit: false`. Worked: a player whose
/// DoT crit memory holds accumulator 0.4, roll tick 3 and a critical roll enters the raid with none of it: the native
/// `None` (the unrolled state, as `roll_dot_crit` starts it).
///
/// Native today (`cards/runtime.rs::reset_player`) resets the hit crit accumulator but keeps `core.card_dot_crit`.
#[test]
fn reset_all_clears_the_dot_crit_memory_at_raid_start() {
    let mut sim = lobby();
    sim.w.players[0].core.card_dot_crit = Some(DotCritState {
        accumulator: 0.4,
        roll_tick: Some(3),
        critical: true,
    });
    sim.w.players[0].card_crit_acc = 0.7;
    let sim = start_raid(sim);
    assert_eq!(
        sim.w.players[0].core.card_dot_crit, None,
        "the DoT crit memory after raidStarted: legacy cleared with rt.cards"
    );
}

/// Guard: the hit crit accumulator (`critAcc`) is cleared by the same reset today and must stay cleared; a seat with no
/// DoT memory stays without one.
#[test]
fn guard_reset_all_still_clears_the_hit_crit_accumulator() {
    let mut sim = lobby();
    sim.w.players[0].card_crit_acc = 0.7;
    let sim = start_raid(sim);
    assert_eq!(sim.w.players[0].card_crit_acc, 0.);
    assert_eq!(sim.w.players[1].core.card_dot_crit, None);
}

// ------------------------------------------------------------------------------------------------------- schedule rows

/// The seven rows this packet completes, flipped in place (C-TICK: no row moves; `crates/rh-parity/tests/schedule.rs`
/// keeps comparing the order against `parity/schedule/legacy_schedule.json`). Legacy installs them at
/// `bruiserPassives.ts:118` (afterWeapons `update`), `:120` (systems `update`), `:124` (campCleared), `:125`/`:126`
/// (raidStarted/runEnded `resetRun`), `abilities.ts:51` (`armWishes` on raidStarted) and `cardHooks.ts:44`
/// (`resetAll` on raidStarted). Each must be `Ported`: no pending owner, no partial description.
#[test]
fn the_salvaged_bookkeeping_rows_are_ported_in_place() {
    use crate::schedule::{tables, Hook};
    let t = tables();
    let mut rows: Vec<(String, Option<&str>, Option<&str>)> = Vec::new();
    for (table, entries) in [("afterWeapons", &t.after_weapons), ("systems", &t.systems)] {
        for e in entries
            .iter()
            .filter(|e| e.legacy == "bruiserPassives.update")
        {
            rows.push((format!("{table} {}", e.legacy), e.pending, e.completed));
        }
    }
    for (hook, name) in [
        (Hook::RaidStarted, "abilities.armWishes"),
        (Hook::RaidStarted, "cardHooks.resetAll"),
        (Hook::RaidStarted, "bruiserPassives.resetRun"),
        (Hook::RunEnded, "bruiserPassives.resetRun"),
        (Hook::CampCleared, "bruiserPassives.<arrow>"),
    ] {
        let links = &t.hooks.iter().find(|(h, _)| *h == hook).unwrap().1;
        let found: Vec<_> = links.iter().filter(|l| l.legacy == name).collect();
        assert_eq!(found.len(), 1, "{hook:?} {name}: one link");
        rows.push((
            format!("{hook:?} {name}"),
            found[0].pending,
            found[0].completed,
        ));
    }
    assert_eq!(rows.len(), 7, "the seven rows: {rows:?}");
    let partial: Vec<_> = rows
        .iter()
        .filter(|(_, pending, completed)| pending.is_some() || completed.is_some())
        .collect();
    assert!(partial.is_empty(), "still partial: {partial:?}");
}
