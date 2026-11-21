//! P-AUG-PLANT-1 oracle: Plant Your Feet's range and damage for every weapon, decided when the attack starts.
//!
//! Legacy: `packages/server/src/sim/weapons.ts:333-347` (`startAttack`: an armed attack's packet is `raw * 1.25`,
//! `mult * 1.25`, and it carries `rangeMult = 1.25`, for swings, draws and casts alike; the clock is spent there),
//! `melee.ts:63-64` (the reach is scaled, the body radius is not), `projectiles.ts:110` (the flight range is scaled),
//! `ledger.ts:233` with `mods.ts:656-690` (the baked multiplier shares the outgoing row cap), `cardState.ts:84-94`
//! (armed when `serverTime - stillSince >= 1000`). Every comparison is between two players holding the same build, so
//! the build's own effects cancel; the worlds are `SimConfig::default()` (the legacy 25%).

use crate::cards::CardId;
use crate::content::{weapon, Shape};
use crate::{
    arenas, validate, Event, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig,
    Vec2, WeaponId,
};

/// Legacy `1 + PLANT_FEET_BONUS` (`packages/shared/src/constants.ts:276`), written out so the oracle does not read the
/// value it checks. (Functions, not consts: `tests/content.rs` audits every const under `src/`.)
fn legacy_factor() -> f64 {
    1.25
}

/// Legacy `PLANT_FEET_MS` (`constants.ts:275`).
fn legacy_still_ms() -> f64 {
    1000.0
}

/// The body radius of the legacy circle (`PLAYER_RADIUS`), which the planted swing does not scale (`melee.ts:64`).
fn body() -> f64 {
    12.0
}

/// The attacker's spot on the practice arena: tile row 8, no pillar or fence on the row to the east. The attacker is
/// always player 1.
fn at() -> Vec2 {
    Vec2::new(100.0, 272.0)
}

fn seat(profile: &str, at: Vec2, weapon: WeaponId) -> Placement {
    Placement {
        profile: profile.into(),
        faction: FactionId::Holy,
        bot: false,
        at,
        hp: None,
        weapon0: Some(weapon),
        weapon1: None,
    }
}

/// The attacker (player 1, at `at()`, holding `cards`) and one idle Holy target per point (players 2, 3, ...).
fn duel(attacker: WeaponId, cards: &[CardId], targets: &[Vec2]) -> Sim {
    let mut seats = vec![seat("attacker", at(), attacker)];
    for (i, &at) in targets.iter().enumerate() {
        seats.push(seat(&format!("target{i}"), at, WeaponId::Sword));
    }
    let mut sim = Sim::reset_active(
        SimConfig::default(),
        arenas::practice_arena(),
        Secrets::from_seed(5),
        &seats,
    );
    for &card in cards {
        assert!(crate::cards::grant(&sim.k, &mut sim.w, PlayerId(1), card));
    }
    sim
}

/// How long the attacker will have stood still when the next step's weapons pass runs (the step advances the clock
/// first; the stillness clock is read as the previous step left it).
fn still_at_next_step(sim: &Sim) -> f64 {
    let i = sim.w.idx(PlayerId(1)).unwrap();
    sim.w.server_time + crate::constants::TICK_MS - sim.w.players[i].card_still_since
}

/// Steps until the next step's attack would start with the attacker still for exactly `ms` (at least one step first,
/// so the stillness clock has seen the spawn position).
fn idle_until_still(sim: &mut Sim, ms: f64) {
    sim.step();
    while still_at_next_step(sim) < ms {
        sim.step();
    }
    assert_eq!(
        still_at_next_step(sim),
        ms,
        "the clock runs on the tick grid"
    );
}

/// What one attack did: the hits the attacker landed, per victim, and the range of the flight it launched.
#[derive(Debug, Default)]
struct Outcome {
    hits: Vec<(PlayerId, f64)>,
    flight_range: Option<f64>,
}

fn press(sim: &mut Sim, a: f64) {
    sim.submit(
        PlayerId(1),
        validate(RawCommand::Attack { a, t: None }).unwrap(),
    )
    .unwrap();
}

fn let_go(sim: &mut Sim, a: f64) {
    sim.submit(
        PlayerId(1),
        validate(RawCommand::Release { a, t: None }).unwrap(),
    )
    .unwrap();
}

/// Presses the trigger toward `a` this step, lets go the next, and watches `ticks` steps.
fn attack(sim: &mut Sim, a: f64, ticks: u32) -> Outcome {
    let mut out = Outcome::default();
    press(sim, a);
    for t in 0..ticks {
        if t == 1 {
            let_go(sim, a);
        }
        for e in sim.step() {
            match e {
                Event::Hit {
                    victim,
                    by: Some(PlayerId(1)),
                    amount,
                    passive: false,
                    ..
                } => out.hits.push((victim, amount)),
                Event::ProjectileLaunched(l) if l.owner == PlayerId(1) && !l.reflected => {
                    out.flight_range = Some(l.range)
                }
                _ => {}
            }
        }
    }
    out
}

fn hit_on(o: &Outcome, victim: PlayerId) -> Option<f64> {
    let mut it = o.hits.iter().filter(|(v, _)| *v == victim);
    let first = it.next().map(|&(_, amount)| amount);
    assert!(
        it.next().is_none(),
        "one attack hits {victim:?} once: {o:?}"
    );
    first
}

fn arc_reach(w: WeaponId) -> f64 {
    match weapon(w).shape {
        Shape::Arc { reach, .. } => reach,
        Shape::Projectile { .. } => unreachable!("{w:?} is not an arc weapon"),
    }
}

fn flight_range(w: WeaponId) -> f64 {
    match weapon(w).shape {
        Shape::Projectile { range, .. } => range,
        Shape::Arc { .. } => unreachable!("{w:?} is not a ranged weapon"),
    }
}

/// One attack toward `a`, `planted` (started after exactly the legacy second still) or not (after half of it).
fn one_attack(w: WeaponId, cards: &[CardId], targets: &[Vec2], planted: bool, a: f64) -> Outcome {
    let mut sim = duel(w, cards, targets);
    let still = if planted {
        legacy_still_ms()
    } else {
        legacy_still_ms() / 2.
    };
    idle_until_still(&mut sim, still);
    attack(&mut sim, a, 90)
}

fn ratio_near(planted: f64, unplanted: f64, want: f64, what: &str) {
    let r = planted / unplanted;
    assert!(
        (r - want).abs() <= 0.02 * want,
        "{what}: planted {planted} / unplanted {unplanted} = {r}, legacy {want}"
    );
}

/// A planted swing reaches 1.25x its catalog reach (plus the body radius, which is not scaled), for every arc weapon;
/// an unplanted one exactly its reach.
#[test]
fn a_planted_swing_reaches_a_quarter_further() {
    for w in [
        WeaponId::Sword,
        WeaponId::Axe,
        WeaponId::Shield,
        WeaponId::Fists,
    ] {
        let reach = arc_reach(w);
        for (share, unplanted_hits, planted_hits) in [
            (0.95, true, true),
            (1.05, false, true),
            (1.20, false, true),
            (1.30, false, false),
        ] {
            let target = Vec2::new(at().x + body() + reach * share, at().y);
            for (planted, want) in [(false, unplanted_hits), (true, planted_hits)] {
                let o = one_attack(w, &[CardId::PlantYourFeet], &[target], planted, 0.);
                assert_eq!(
                    hit_on(&o, PlayerId(2)).is_some(),
                    want,
                    "{w:?} at {share} x reach + body, planted {planted}: {o:?}"
                );
            }
        }
    }
}

/// One multiplier per attack: a planted swing that meets two bodies hits BOTH 1.25x as hard (legacy bakes the packet
/// at the start; Rust today spends the bonus on the first body).
#[test]
fn a_planted_swing_hits_every_body_it_meets_a_quarter_harder() {
    let targets = [
        Vec2::new(at().x + 40., at().y),
        Vec2::new(at().x + 40., at().y + 30.),
    ];
    let cards = [CardId::PlantYourFeet];
    let planted = one_attack(WeaponId::Sword, &cards, &targets, true, 0.);
    let unplanted = one_attack(WeaponId::Sword, &cards, &targets, false, 0.);
    for victim in [PlayerId(2), PlayerId(3)] {
        let p = hit_on(&planted, victim).expect("the planted swing meets both");
        let u = hit_on(&unplanted, victim).expect("the unplanted swing meets both");
        ratio_near(p, u, legacy_factor(), &format!("sword on {victim:?}"));
    }
}

/// Bows and wands: a planted shot flies 1.25x the catalog range and hits 1.25x as hard, and reaches a body beyond the
/// unplanted range. Unplanted, both are as today.
#[test]
fn a_planted_bow_or_wand_shot_flies_a_quarter_further_and_hits_a_quarter_harder() {
    let cards = [CardId::PlantYourFeet];
    for w in [WeaponId::Bow, WeaponId::Wand] {
        let range = flight_range(w);
        let near = [Vec2::new(at().x + 150., at().y)];
        let planted = one_attack(w, &cards, &near, true, 0.);
        let unplanted = one_attack(w, &cards, &near, false, 0.);
        assert_eq!(unplanted.flight_range, Some(range), "{w:?} unplanted");
        let got = planted.flight_range.expect("the planted shot launches");
        assert!(
            (got - range * legacy_factor()).abs() < 1e-9,
            "{w:?}: planted flight range {got}, legacy {}",
            range * legacy_factor()
        );
        ratio_near(
            hit_on(&planted, PlayerId(2)).expect("planted hit"),
            hit_on(&unplanted, PlayerId(2)).expect("unplanted hit"),
            legacy_factor(),
            &format!("{w:?} damage"),
        );
        // A body at 1.15x the catalog range: out of an unplanted shot's reach, inside a planted one's.
        let far = [Vec2::new(at().x + range * 1.15, at().y)];
        let o = one_attack(w, &cards, &far, false, 0.);
        assert_eq!(hit_on(&o, PlayerId(2)), None, "{w:?} unplanted, far: {o:?}");
        let o = one_attack(w, &cards, &far, true, 0.);
        assert!(
            hit_on(&o, PlayerId(2)).is_some(),
            "{w:?} planted, far: {o:?}"
        );
    }
}

/// The tick boundary, decided when the attack STARTS: an attack started one tick before the legacy second is unplanted
/// (a wand cast that lands after the mark included), one started exactly on it is planted.
#[test]
fn the_plant_is_decided_at_the_start_on_the_legacy_second() {
    let tick = crate::constants::TICK_MS;
    let cards = [CardId::PlantYourFeet];
    // The sword's target is just past its unplanted reach; the wand's flight range is read from its launch.
    let sword_target = [Vec2::new(
        at().x + body() + arc_reach(WeaponId::Sword) * 1.05,
        at().y,
    )];
    for (still, planted) in [(legacy_still_ms() - tick, false), (legacy_still_ms(), true)] {
        let mut sim = duel(WeaponId::Sword, &cards, &sword_target);
        idle_until_still(&mut sim, still);
        let o = attack(&mut sim, 0., 30);
        assert_eq!(
            hit_on(&o, PlayerId(2)).is_some(),
            planted,
            "sword started after {still} ms still: {o:?}"
        );

        let mut sim = duel(WeaponId::Wand, &cards, &[]);
        idle_until_still(&mut sim, still);
        let o = attack(&mut sim, 0., 30);
        let want = flight_range(WeaponId::Wand) * if planted { legacy_factor() } else { 1. };
        let got = o.flight_range.expect("the cast launches");
        assert!(
            (got - want).abs() < 1e-9,
            "wand started after {still} ms still: range {got}, legacy {want}"
        );
    }
}

/// The plant is spent when the attack starts, even by a swing that meets nobody: the clock restarts at that swing and
/// the next attack, under a second later, is unplanted.
#[test]
fn the_plant_is_spent_when_the_attack_starts_even_on_a_miss() {
    let cards = [CardId::PlantYourFeet];
    let target = [Vec2::new(at().x + 50., at().y)];
    let mut sim = duel(WeaponId::Sword, &cards, &target);
    idle_until_still(&mut sim, legacy_still_ms());
    let swung_at = sim.w.server_time + crate::constants::TICK_MS;
    // Away from the target (west, toward the arena wall): nobody is met.
    let miss = attack(&mut sim, std::f64::consts::PI, 2);
    assert!(
        miss.hits.is_empty(),
        "the first swing meets nobody: {miss:?}"
    );
    let i = sim.w.idx(PlayerId(1)).unwrap();
    assert_eq!(
        sim.w.players[i].card_still_since, swung_at,
        "legacy spendPlant restarts the clock at the planted attack's start"
    );
    // The next swing, toward the target, as soon as the sword is ready again: well under a second after the first.
    while sim.w.players[i].core.weapon.ready_at > sim.w.server_time + crate::constants::TICK_MS {
        sim.step();
    }
    assert!(
        still_at_next_step(&sim) < legacy_still_ms(),
        "the next swing starts under a second after the spent one"
    );
    let next = attack(&mut sim, 0., 30);
    let reference = one_attack(WeaponId::Sword, &cards, &target, false, 0.);
    ratio_near(
        hit_on(&next, PlayerId(2)).expect("the second swing hits"),
        hit_on(&reference, PlayerId(2)).expect("the unplanted reference hits"),
        1.0,
        "the swing after a spent plant",
    );
}

/// Not planted, the card changes nothing: an unplanted attack by its holder deals what the same attack by a holder of
/// another card deals, and flies the catalog range.
#[test]
fn unplanted_the_card_changes_nothing() {
    let near = [Vec2::new(at().x + 60., at().y)];
    for w in [WeaponId::Sword, WeaponId::Bow, WeaponId::Wand] {
        let with = one_attack(w, &[CardId::PlantYourFeet], &near, false, 0.);
        let other = one_attack(w, &[CardId::Siphon], &near, false, 0.);
        let a = hit_on(&with, PlayerId(2)).expect("hit");
        let b = hit_on(&other, PlayerId(2)).expect("hit");
        assert!((a - b).abs() <= 1e-9 * b, "{w:?}: {a} vs {b}");
        assert_eq!(with.flight_range, other.flight_range, "{w:?}");
    }
}

/// The planted multiplier shares the outgoing row cap (legacy `mods.ts:656-690`, G1): with Here Comes the Boom's
/// x2.5 hits the cap is already reached, so a planted hit deals what an unplanted one does, for a swing and a shot.
#[test]
fn under_boom_a_planted_hit_is_capped_like_legacy() {
    let near = [Vec2::new(at().x + 60., at().y)];
    let cards = [CardId::PlantYourFeet, CardId::HereComesTheBoom];
    for w in [WeaponId::Sword, WeaponId::Bow, WeaponId::Wand] {
        let planted = one_attack(w, &cards, &near, true, 0.);
        let unplanted = one_attack(w, &cards, &near, false, 0.);
        ratio_near(
            hit_on(&planted, PlayerId(2)).expect("planted hit"),
            hit_on(&unplanted, PlayerId(2)).expect("unplanted hit"),
            1.0,
            &format!("{w:?} under Boom"),
        );
    }
}

/// The JSON path (keys and indices) to the one object under `v` holding `key` and a planted `range_mult`, ending in
/// `range_mult`; `count` gets how many such objects there are.
fn planted_path(v: &serde_json::Value, key: &str, count: &mut usize) -> Option<Vec<String>> {
    let mut found = None;
    match v {
        serde_json::Value::Object(m) => {
            if m.contains_key(key)
                && m.get("range_mult")
                    .and_then(|r| r.as_f64())
                    .is_some_and(|r| (r - legacy_factor()).abs() < 1e-12)
            {
                *count += 1;
                found = Some(vec!["range_mult".to_string()]);
            }
            for (k, c) in m {
                if let Some(mut p) = planted_path(c, key, count) {
                    p.insert(0, k.clone());
                    found = found.or(Some(p));
                }
            }
        }
        serde_json::Value::Array(a) => {
            for (i, c) in a.iter().enumerate() {
                if let Some(mut p) = planted_path(c, key, count) {
                    p.insert(0, i.to_string());
                    found = found.or(Some(p));
                }
            }
        }
        _ => {}
    }
    found
}

/// The one planted object (a pending action has `lands_at`, a flight `traveled`) in a checkpoint's world.
fn the_planted(cp: &serde_json::Value, key: &str, what: &str) -> Vec<String> {
    let mut count = 0;
    let path = planted_path(&cp["world"], key, &mut count);
    assert_eq!(
        count, 1,
        "{what}: the checkpoint holds one planted object with `{key}` and range_mult 1.25"
    );
    path.unwrap()
}

fn at_path<'a>(v: &'a mut serde_json::Value, path: &[String]) -> &'a mut serde_json::Value {
    path.iter().fold(v, |cur, k| match cur {
        serde_json::Value::Array(a) => &mut a[k.parse::<usize>().unwrap()],
        other => &mut other[k.as_str()],
    })
}

/// Restores `cp` and steps it beside `live` for `ticks` steps: the same events and state hash at every step. Returns
/// whether the attacker hit player 2 meanwhile.
fn plays_on_identically(live: &mut Sim, cp: &serde_json::Value, ticks: u32, what: &str) -> bool {
    let mut restored =
        Sim::restore(cp).unwrap_or_else(|e| panic!("{what}: restore refused: {e:?}"));
    assert_eq!(
        restored.state_hash(),
        live.state_hash(),
        "{what}: restore is hash-exact"
    );
    let mut hit = false;
    for t in 0..ticks {
        let (a, b) = (restored.step(), live.step());
        assert_eq!(a, b, "{what}: events at step {t}");
        assert_eq!(
            restored.state_hash(),
            live.state_hash(),
            "{what}: hash at step {t}"
        );
        hit |= a.iter().any(|e| {
            matches!(
                e,
                Event::Hit {
                    victim: PlayerId(2),
                    by: Some(PlayerId(1)),
                    passive: false,
                    ..
                }
            )
        });
    }
    hit
}

/// A checkpoint taken while a planted wand cast is pending, and one taken while its ball flies, restore and play on
/// identically; the factor is serialized on both, and setting it back to 1 changes the state (hashed or refused).
#[test]
fn a_planted_cast_and_its_flight_checkpoint_restore_and_play_on() {
    let wand = flight_range(WeaponId::Wand);
    let far = [Vec2::new(at().x + wand * 1.15, at().y)];
    let mut sim = duel(WeaponId::Wand, &[CardId::PlantYourFeet], &far);
    idle_until_still(&mut sim, legacy_still_ms());
    press(&mut sim, 0.);
    sim.step();
    let_go(&mut sim, 0.);
    sim.step();
    let i = sim.w.idx(PlayerId(1)).unwrap();
    assert!(
        sim.w.players[i].core.weapon.action.is_some(),
        "the cast is still winding up"
    );
    let pending = serde_json::to_value(&sim).unwrap();
    let path = the_planted(&pending, "lands_at", "pending cast");
    let mut reset = pending.clone();
    *at_path(&mut reset["world"], &path) = serde_json::json!(1.0);
    if let Ok(other) = Sim::restore(&reset) {
        assert_ne!(
            other.state_hash(),
            sim.state_hash(),
            "the pending range_mult is hashed"
        );
    }
    let mut flying = Sim::restore(&pending).expect("the pending checkpoint restores");
    plays_on_identically(&mut sim, &pending, 12, "pending cast");

    // The ball leaves with the planted range; checkpoint it in flight.
    let mut launched = None;
    while launched.is_none() {
        for e in flying.step() {
            if let Event::ProjectileLaunched(l) = e {
                launched = Some(l.range);
            }
        }
    }
    let range = launched.unwrap();
    assert!(
        (range - wand * legacy_factor()).abs() < 1e-9,
        "the restored cast flies the planted range: {range}"
    );
    flying.step();
    let in_flight = serde_json::to_value(&flying).unwrap();
    let path = the_planted(&in_flight, "traveled", "flight");
    let mut reset = in_flight.clone();
    *at_path(&mut reset["world"], &path) = serde_json::json!(1.0);
    if let Ok(other) = Sim::restore(&reset) {
        assert_ne!(
            other.state_hash(),
            flying.state_hash(),
            "the flight's range_mult is hashed"
        );
    }
    assert!(
        plays_on_identically(&mut flying, &in_flight, 60, "flight"),
        "the restored planted ball reaches the far target"
    );
}
