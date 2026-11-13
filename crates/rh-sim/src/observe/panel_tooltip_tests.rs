//! P-WIRE17-HUD-2c oracle (observation side): the champion panel's remaining legacy numbers, codes 23-27.
//!
//! Legacy `packages/client/src/ui/championCombatModel.ts`:
//! - `:114-117` Fire roam line: `(fireRoamSpeedMult(roamCharge) - 1) x 100` % move speed (code 23, a fraction here) and
//!   `fireRoamBurstDamage(adBonus)` physical (code 24); `packages/shared/src/fireRoam.ts:10-22`.
//! - `:100-112,:128` auto tooltip: "Weapon scaling adds `scalingValues.phys` physical and `scalingValues.magic` magic
//!   before the `hitMult` x hit multiplier" (codes 26, 27, 25); `scalingDamage` `packages/shared/src/weapons.ts:203-219`.
//!
//! Loose proof (owner direction 2026-11-10): the numbers are worked by hand from the legacy formulas and constants in the
//! comments below and must agree within one `HUD_QUANTUM` (1e-4). Inputs are what legacy reads (the stat mirrors, max
//! hp, the card fold's hit multiplier, the roam charge); the formulas are legacy's, not the Rust helpers.
use super::*;
use crate::build_summary::{champion_panel, ChampionPanel, PanelCode as C};
use crate::cards::CardId;
use crate::map::TileMap;
use crate::stat_fold::MultKey;
use crate::{Arena, FactionId, Placement, Secrets, SimConfig, Vec2, WeaponId};

/// The wire's fixed-point unit (rh-protocol `HUD_QUANTUM`).
const QUANTUM: f64 = 1e-4;

fn room() -> Arena {
    let (w, h) = (20usize, 12usize);
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
    Arena {
        map: TileMap::from_rows(&rows).expect("room"),
        spawns: vec![Vec2::new(112., 112.), Vec2::new(400., 200.)],
    }
}

fn seat(profile: &str, faction: FactionId, weapon: Option<WeaponId>, at: Vec2) -> Placement {
    Placement {
        profile: profile.into(),
        faction,
        bot: false,
        at,
        hp: None,
        weapon0: weapon,
        weapon1: None,
    }
}

fn sim_with(ps: &[Placement]) -> Sim {
    let secrets = Secrets {
        order_salt: 1,
        spawn_seed: 0,
        reward_salt: [1, 2, 3, 4],
    };
    let config = SimConfig {
        quests: false,
        pvp_rules: false,
        ..Default::default()
    };
    Sim::reset_active(config, room(), secrets, ps)
}

fn grant(sim: &mut Sim, id: PlayerId, cards: &[CardId]) {
    let (k, w) = (&sim.k, &mut sim.w);
    for card in cards {
        assert!(crate::cards::grant(k, w, id, *card), "{card:?}");
    }
}

fn panel_of(sim: &Sim, viewer: PlayerId) -> ChampionPanel {
    observe(sim, viewer, &[]).panel.unwrap_or_default()
}

fn assert_close(panel: &ChampionPanel, code: C, want: f64, why: &str) {
    let got = panel.get(code);
    assert!(
        got.is_some_and(|v| (v - want).abs() <= QUANTUM),
        "{code:?} ({why}): panel {got:?}, legacy formula {want}"
    );
}

/// Sets the Fire roam clock: last combat `ago_ms` before now (None: no combat recorded), and the armed flag.
fn set_roam(sim: &mut Sim, id: PlayerId, ago_ms: Option<f64>, armed: bool) {
    let now = sim.server_time();
    let p = sim.w.players.get_mut(id).expect("seated");
    p.roam.last_combat_at = ago_ms.map(|ago| now - ago);
    p.roam.ready = armed;
}

/// Fire with a Wand and Offense I (+12 Offense). Legacy (championCombatModel.ts:116, fireRoam.ts):
/// - 5 s out of combat: charge = floor(5000 / 20000 x 1000) = 250; speed mult = 1 + (1.5 - 1) x 250 / 1000 = 1.125, so
///   the line prints 12.5 % (code 23 = 0.125). Burst = 50 + 0.4 x max(0, 12) = 54.8 physical (code 24).
/// - 25 s out of combat: charge 1000 (clamped), armed: 50 % (0.5); the burst is still 54.8.
/// - Armed, but a hit just reset the clock (legacy `resetCharge` zeroes `roamCharge` and keeps `roamReady`): the line
///   prints "armed" and 0 % move speed, because :116 reads `roamCharge`, not `roamReady` (legacy pinned; flagged in the
///   brief).
#[test]
fn a_fire_owner_shows_the_legacy_roam_speed_and_burst() {
    let mut sim = sim_with(&[seat(
        "fire",
        FactionId::Fire,
        Some(WeaponId::Wand),
        Vec2::new(112., 112.),
    )]);
    let id = sim.players()[0].id;
    grant(&mut sim, id, &[CardId::Ad1]);
    assert_eq!(
        sim.player(id)
            .expect("seated")
            .core
            .modifiers
            .mirrors()
            .ad_bonus,
        12.,
        "Offense I gives +12 Offense (legacy cards.ts ad1)"
    );

    set_roam(&mut sim, id, Some(5_000.), false);
    let panel = panel_of(&sim, id);
    assert_close(
        &panel,
        C::RoamCharge,
        250.,
        "code 8, the charge code 23 reads",
    );
    assert_close(&panel, C::RoamSpeedBonus, 0.125, "1.125 - 1 at charge 250");
    assert_close(&panel, C::RoamBurstDamage, 54.8, "50 + 0.4 x 12");

    set_roam(&mut sim, id, Some(25_000.), true);
    let panel = panel_of(&sim, id);
    assert_close(&panel, C::RoamSpeedBonus, 0.5, "full charge: 1.5 - 1");
    assert_close(
        &panel,
        C::RoamBurstDamage,
        54.8,
        "the burst does not depend on the charge",
    );
    assert_close(&panel, C::RoamArmed, 1., "armed");

    set_roam(&mut sim, id, Some(0.), true);
    let panel = panel_of(&sim, id);
    assert_close(&panel, C::RoamArmed, 1., "still armed after the reset");
    assert_close(
        &panel,
        C::RoamSpeedBonus,
        0.,
        "the speed line follows the charge (0), not the armed flag",
    );
}

/// One weapon per scaling class, a Holy champion (legacy rate 0.95, base hp 1145; factions.ts:48-70). No case hits the
/// interval floor, so legacy `per = asMult x attackInterval = 1 / (rate x (1 + boost))` (weapons.ts:172,:206), and
/// `scalingDamage` (weapons.ts:203-219) gives, with the weapon table of weapons.ts:96-124:
/// - Bow (boost 0.95; ad 1), Offense I + Machine Gun (hit x0.5): phys = 12 / (0.95 x 1.95) = 6.477733, magic 0, h 0.5.
/// - Wand (boost 0.65; ad 0.3, ap 1), Offense I + SO I + Here Comes the Boom (hit x2.5): per = 1 / 1.5675;
///   phys = 3.6 / 1.5675 = 2.296651, magic = 12 / 1.5675 = 7.655502, h 2.5.
/// - Sword (boost 1.15; dominant ad 1 or ap 1), SO I only: the SO side wins, phys 0, magic = 12 / 2.0425 = 5.875153.
/// - Sword, Offense I + SO I: a tie is not "higher" (`s.ap x ap > s.ad x ad` is strict), so the Offense side:
///   phys 5.875153, magic 0.
/// - Shield (boost 0.6; ap 0.3, def 0.4), Defense I (+15): phys = 0.4 x 15 / 1.52 = 3.947368, magic 0.
/// - Axe (boost 0.4; ad 1, hp 0.02), Vitality I (+9 % max hp): bonus hp = 1145 x 0.09 = 103.05,
///   phys = 0.02 x 103.05 / 1.33 = 1.549624, magic 0.
#[test]
fn the_hit_multiplier_and_scaling_split_follow_legacy_per_weapon_class() {
    let cases: [(WeaponId, &[CardId], f64, f64, f64); 6] = [
        (
            WeaponId::Bow,
            &[CardId::Ad1, CardId::MachineGun],
            0.5,
            12. / (0.95 * 1.95),
            0.,
        ),
        (
            WeaponId::Wand,
            &[CardId::Ad1, CardId::Ap1, CardId::HereComesTheBoom],
            2.5,
            0.3 * 12. / (0.95 * 1.65),
            12. / (0.95 * 1.65),
        ),
        (WeaponId::Sword, &[CardId::Ap1], 1., 0., 12. / (0.95 * 2.15)),
        (
            WeaponId::Sword,
            &[CardId::Ad1, CardId::Ap1],
            1.,
            12. / (0.95 * 2.15),
            0.,
        ),
        (
            WeaponId::Shield,
            &[CardId::Armor1],
            1.,
            0.4 * 15. / (0.95 * 1.6),
            0.,
        ),
        (
            WeaponId::Axe,
            &[CardId::Vitality1],
            1.,
            0.02 * (1145. * 0.09) / (0.95 * 1.4),
            0.,
        ),
    ];
    // The hand-worked numbers of the doc comment, so the formulas above are the ones written there.
    assert!((12f64 / (0.95 * 1.95) - 6.477_733).abs() < 1e-6);
    assert!((0.02f64 * (1145. * 0.09) / (0.95 * 1.4) - 1.549_624).abs() < 1e-6);
    for (weapon, cards, hit, phys, magic) in cases {
        let mut sim = sim_with(&[seat(
            "holy",
            FactionId::Holy,
            Some(weapon),
            Vec2::new(112., 112.),
        )]);
        let id = sim.players()[0].id;
        grant(&mut sim, id, cards);
        let p = sim.player(id).expect("seated");
        assert_eq!(
            p.core.modifiers.mult_of(MultKey::Hit),
            hit,
            "{weapon:?} {cards:?}: the card fold's hit mult"
        );
        let panel = panel_of(&sim, id);
        let why = format!("{weapon:?} {cards:?}");
        assert_close(&panel, C::HitMult, hit, &why);
        assert_close(&panel, C::ScalingPhysical, phys, &why);
        assert_close(&panel, C::ScalingMagic, magic, &why);
    }
}

/// Every champion carries the auto tooltip's three numbers; only Fire carries the roam line's two. A fresh champion
/// with fists and no build: hit mult 1, no scaling (0 and 0); Fire's roam clock has not started (charge 0, so 0 % and
/// the bare 50-damage burst).
#[test]
fn only_a_fire_owner_gets_the_roam_codes() {
    for faction in [
        FactionId::Fire,
        FactionId::Sentenced,
        FactionId::Plague,
        FactionId::Frost,
        FactionId::Holy,
    ] {
        let sim = sim_with(&[seat("p", faction, None, Vec2::new(112., 112.))]);
        let id = sim.players()[0].id;
        let panel = panel_of(&sim, id);
        assert_close(&panel, C::HitMult, 1., "no hit card");
        assert_close(&panel, C::ScalingPhysical, 0., "no bonus stats");
        assert_close(&panel, C::ScalingMagic, 0., "no bonus stats");
        if faction == FactionId::Fire {
            assert_close(&panel, C::RoamSpeedBonus, 0., "charge 0");
            assert_close(&panel, C::RoamBurstDamage, 50., "FIRE_ROAM_BURST_BASE");
        } else {
            assert_eq!(
                (panel.get(C::RoamSpeedBonus), panel.get(C::RoamBurstDamage)),
                (None, None),
                "{faction:?}: legacy prints the roam line for Fire only (:114)"
            );
        }
    }
}

/// C-OBS: a seat's key 13 carries its own panel only. Seat A (Fire, Wand, Here Comes the Boom, Offense I, 5 s out of
/// combat) and seat B (Holy, Sword) differ on every new code; B never observes A's roam or tooltip numbers, A's
/// observation carries A's, and an unseated viewer observes no panel.
#[test]
fn another_seat_never_observes_this_seats_new_codes() {
    let mut sim = sim_with(&[
        seat(
            "a",
            FactionId::Fire,
            Some(WeaponId::Wand),
            Vec2::new(112., 112.),
        ),
        seat(
            "b",
            FactionId::Holy,
            Some(WeaponId::Sword),
            Vec2::new(400., 200.),
        ),
    ]);
    let (a, b) = (sim.players()[0].id, sim.players()[1].id);
    grant(&mut sim, a, &[CardId::HereComesTheBoom, CardId::Ad1]);
    set_roam(&mut sim, a, Some(5_000.), false);

    let seen_a = panel_of(&sim, a);
    assert_close(&seen_a, C::RoamSpeedBonus, 0.125, "A's own roam line");
    assert_close(&seen_a, C::RoamBurstDamage, 54.8, "A's own burst");
    assert_close(&seen_a, C::HitMult, 2.5, "A's own hit mult");
    // Wand: 0.3 x 12 / (0.6 x 1.65) (Fire rate 0.6; asMult cancels while the interval is not floored).
    assert_close(&seen_a, C::ScalingPhysical, 3.6 / 0.99, "A's own scaling");

    let seen_b = panel_of(&sim, b);
    assert_eq!(
        (
            seen_b.get(C::RoamSpeedBonus),
            seen_b.get(C::RoamBurstDamage)
        ),
        (None, None),
        "B observes no roam numbers (A's are not leaked)"
    );
    assert_close(&seen_b, C::HitMult, 1., "B's own hit mult, never A's 2.5");
    assert_close(&seen_b, C::ScalingPhysical, 0., "B's own scaling");
    assert_eq!(
        Some(seen_b),
        champion_panel(&sim, b),
        "B observes B's panel"
    );
    assert_eq!(
        observe(&sim, PlayerId(9_999), &[]).panel,
        None,
        "an unseated viewer observes no panel"
    );
}

#[test]
fn the_observation_identity_moves_for_the_new_codes() {
    assert_eq!(
        OBSERVATION_VERSION, 27,
        "Observation.panel gains codes 23-27 (P-WIRE17-HUD-2c)"
    );
}
