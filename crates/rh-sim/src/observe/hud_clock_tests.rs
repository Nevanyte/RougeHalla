//! P-WIRE17-HUD-3 oracle (observation side): the owner's healing-potion and wind-emblem end times in its inventory, and
//! the room's minimum players in the public arena view.
//!
//! Legacy (read-only, `packages/`):
//! - `client/src/ui/weaponBar.ts:145-153`: "Healing xN Ns" = `ceil((healingUntil - serverNow) / 1000)` with N =
//!   `potionsHealing` (shown when > 1); "+50% speed" / "Active Ns" = `ceil((speedBoostUntil - serverNow) / 1000)`.
//! - `server/src/sim/consumables.ts:67`: drinking sets `healingUntil = now + POTION_HEAL_MS` ("the newest potion always
//!   ends last"); `:81,:89` zero it when the fighter falls or the last potion finishes; `:93-94` zero `speedBoostUntil`
//!   once `<= now`; `:164` a pickup sets `speedBoostUntil = now + SPEED_BOOST_MS`. `shared/src/constants.ts:652,:657`:
//!   both durations 5000 ms.
//! - `client/src/ui/hud.ts:44`: "Waiting for players {playerCount}/{minPlayers}"; `server/src/sim/world.ts:899`
//!   `state.minPlayers = opts.config.minPlayers` (`shared/src/schema.ts:349`, public RaidState).
//!
//! Loose proof (owner direction 2026-11-10): the end times are worked by hand from the tick the action lands on (20 Hz,
//! 50 ms a tick) and the legacy durations; `None` stands for legacy's 0 ("not running").
use super::*;
use crate::item_view::{Inventory, ItemObserver};
use crate::{FactionId, Placement, PublicCommand, Secrets, SimConfig, Vec2};

fn seat(profile: &str, faction: FactionId, at: Vec2) -> Placement {
    Placement {
        profile: profile.into(),
        faction,
        bot: false,
        at,
        hp: None,
        weapon0: None,
        weapon1: None,
    }
}

/// Two humans far apart in the practice arena, the run already active.
fn two_seats() -> Sim {
    Sim::reset_active(
        SimConfig {
            quests: false,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        Secrets::from_seed(7),
        &[
            seat("owner", FactionId::Fire, Vec2::new(112., 112.)),
            seat("other", FactionId::Holy, Vec2::new(900., 600.)),
        ],
    )
}

fn inventory(sim: &Sim, observer: &mut ItemObserver) -> Option<Inventory> {
    let mut out = Observation::default();
    observer
        .observe_into(sim, &[], &mut out, None)
        .expect("observes");
    out.inventory
}

/// The owner drinks one potion now (it is hurt and holds `stock` small potions).
fn drink(sim: &mut Sim, observer: &mut ItemObserver) {
    let cmd = observer
        .resolve(sim, PublicCommand::UseConsumable)
        .expect("a legal press");
    sim.submit(PlayerId(1), cmd).expect("submitted");
}

fn hurt_with_potions(sim: &mut Sim, stock: u8) {
    let p = &mut sim.w.players[0];
    p.vitals.hp = p.vitals.max_hp * 0.25;
    p.potion_small = stock;
}

/// Legacy consumables.ts:67: a potion drunk on the tick at server time t ends at t + 5000. The press submitted before a
/// step lands on that step, whose server time is the time after it: starting at `t0`, one step makes it `t0 + 50`, so
/// the potion ends at `t0 + 50 + 5000`. A second potion one second later moves the end to its own `+ 5000` (the newest
/// ends last), with two running ("Healing x2").
#[test]
fn drinking_a_potion_reports_when_its_healing_ends() {
    let mut sim = two_seats();
    let mut owner = ItemObserver::new(PlayerId(1));
    hurt_with_potions(&mut sim, 2);
    let t0 = sim.server_time();
    assert_eq!(
        inventory(&sim, &mut owner).expect("seated").healing_until,
        None,
        "nothing runs before the first potion (legacy healingUntil 0)"
    );
    drink(&mut sim, &mut owner);
    sim.step();
    assert_eq!(sim.server_time(), t0 + 50., "one 50 ms tick");
    assert_eq!(
        sim.w.players[0].healing_until,
        t0 + 50. + 5000.,
        "the sim's clock (legacy consumables.ts:67)"
    );
    let inv = inventory(&sim, &mut owner).expect("seated");
    assert_eq!(inv.potions_healing, 1);
    assert_eq!(
        inv.healing_until,
        Some(t0 + 5050.),
        "the owner sees when its potion ends: drank at t0 + 50, plus POTION_HEAL_MS 5000"
    );
    for _ in 0..20 {
        sim.step();
    }
    let t1 = sim.server_time();
    assert_eq!(t1, t0 + 1050.);
    drink(&mut sim, &mut owner);
    sim.step();
    let inv = inventory(&sim, &mut owner).expect("seated");
    assert_eq!(inv.potions_healing, 2, "two potions run");
    assert_eq!(
        inv.healing_until,
        Some(t1 + 50. + 5000.),
        "the newest potion ends last: t0 + 6100"
    );
    // The first potion's five seconds and the second's run out; legacy zeroes healingUntil with the last one.
    for _ in 0..200 {
        sim.step();
    }
    let inv = inventory(&sim, &mut owner).expect("seated");
    assert_eq!(inv.potions_healing, 0);
    assert_eq!(inv.healing_until, None, "absent once no potion runs");
}

/// Legacy consumables.ts:164: walking over an emblem on the tick at server time t sets `speedBoostUntil = t + 5000`;
/// `:93-94` clears it once the clock reaches it. The pickup runs inside the step, at the step's server time.
#[test]
fn the_wind_emblem_reports_when_its_boost_ends() {
    let mut sim = two_seats();
    let mut owner = ItemObserver::new(PlayerId(1));
    sim.w.wind_next_at = sim.server_time();
    sim.step();
    let at = sim
        .containers()
        .iter()
        .find(|c| c.kind == crate::state::ContainerKind::WindEmblem)
        .map(|c| c.at)
        .expect("an emblem spawned");
    sim.w.players[0].body.x = at.x;
    sim.w.players[0].body.y = at.y;
    sim.step();
    let picked = sim.server_time();
    assert_eq!(
        sim.w.players[0].speed_boost_until,
        picked + 5000.,
        "the sim's clock (legacy consumables.ts:164)"
    );
    let inv = inventory(&sim, &mut owner).expect("seated");
    assert_eq!(
        inv.speed_boost_until,
        Some(picked + 5000.),
        "the owner sees when its +50% ends: picked up at t, plus SPEED_BOOST_MS 5000"
    );
    assert_eq!(inv.healing_until, None, "no potion runs");
    for _ in 0..101 {
        sim.step();
    }
    assert_eq!(sim.w.players[0].speed_boost_until, 0., "expired");
    assert_eq!(
        inventory(&sim, &mut owner)
            .expect("seated")
            .speed_boost_until,
        None,
        "absent once the boost has ended"
    );
}

/// C-OBS: the clocks are the owner's own. Another seat's inventory carries its own (none running), never the owner's;
/// an unseated viewer has no inventory at all.
#[test]
fn another_seat_never_receives_the_owner_clocks() {
    let mut sim = two_seats();
    let mut owner = ItemObserver::new(PlayerId(1));
    let mut other = ItemObserver::new(PlayerId(2));
    let mut nobody = ItemObserver::new(PlayerId(99));
    hurt_with_potions(&mut sim, 1);
    drink(&mut sim, &mut owner);
    sim.w.players[0].speed_boost_until = sim.server_time() + 4000.;
    sim.step();
    let mine = inventory(&sim, &mut owner).expect("seated");
    assert!(mine.healing_until.is_some() && mine.speed_boost_until.is_some());
    let theirs = inventory(&sim, &mut other).expect("seated");
    assert_eq!(theirs.healing_until, None, "the owner's potion clock");
    assert_eq!(theirs.speed_boost_until, None, "the owner's boost clock");
    assert_eq!(inventory(&sim, &mut nobody), None, "unseated: no inventory");
}

/// Legacy world.ts:899 copies the room's `minPlayers` into the public RaidState; hud.ts:44 prints it as "n/min". The
/// arena view (State key 9, present while the source lifecycle runs) carries `SimConfig::min_players` unchanged, for every
/// viewer alike.
#[test]
fn the_arena_view_carries_the_rooms_minimum_players() {
    for min_players in [1usize, 3, 8] {
        let config = SimConfig {
            quests: false,
            min_players,
            lifecycle: crate::ArenaMode::Source(crate::ArenaRules::default()),
            ..Default::default()
        };
        let mut sim = Sim::new(
            config,
            crate::arenas::practice_arena(),
            Secrets::from_seed(3),
        );
        sim.add_player("a", Some(FactionId::Holy), false)
            .expect("seated");
        sim.step();
        let seated = observe(&sim, PlayerId(1), &[]);
        let unseated = observe(&sim, PlayerId(99), &[]);
        assert_eq!(
            seated.arena.expect("source lifecycle").min_players,
            min_players as u32,
            "the room's minimum ({min_players})"
        );
        assert_eq!(
            unseated.arena.expect("public").min_players,
            min_players as u32,
            "public room configuration: every viewer alike"
        );
    }
}

#[test]
fn the_observation_version_moves_for_the_clocks_and_the_minimum() {
    assert_eq!(
        OBSERVATION_VERSION, 28,
        "Inventory gains the owner's two end times and ArenaView the room minimum (P-WIRE17-HUD-3)"
    );
}
