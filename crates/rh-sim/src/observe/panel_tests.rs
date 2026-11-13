//! P-WIRE17-HUD-2 oracle (observation side): the owner's champion panel, the numbers the legacy bottom-left panel
//! prints in its three rows' value and scaling lines (`packages/client/src/ui/championCombatModel.ts:91-216`).
//!
//! Loose proof (owner direction 2026-11-10): one Holy and one Fire build whose panel values equal the legacy formulas,
//! worked by hand below with the legacy constants written out, within one `HUD_QUANTUM` (1e-4); a fresh champion of
//! every faction carries exactly its faction's codes; a seat never observes another seat's panel (C-OBS).
//!
//! Inputs are what legacy reads from `PlayerState` (the decoded stat mirrors, hp, max hp, the card fold's hit and DoT
//! multipliers, camps cleared, roam clock); the formulas applied to them are legacy's, not the Rust helpers.
use super::*;
use crate::build_summary::{champion_panel, ChampionPanel, PanelCode as C};
use crate::cards::CardId;
use crate::map::TileMap;
use crate::stat_fold::MultKey;
use crate::{Arena, FactionId, Placement, Secrets, SimConfig, Vec2, WeaponId};

/// The wire's fixed-point unit (rh-protocol `HUD_QUANTUM`): the panel must agree with legacy within one of these.
const QUANTUM: f64 = 1e-4;
/// Legacy `DUEL_PACE` (`packages/shared/src/constants.ts`): `pacedFaction` multiplies the hit and damage params by it.
const PACE: f64 = 2.;

/// Legacy `WEAPONS` (`packages/shared/src/weapons.ts:96-124`): boost, floor, dpsMult, scaling (ad, ap, hp, def),
/// dominant.
struct LegacyWeapon {
    boost: f64,
    floor: f64,
    dps: f64,
    sc: [f64; 4],
    dominant: bool,
}
fn legacy_weapon(w: WeaponId) -> LegacyWeapon {
    let (boost, floor, dps, sc, dominant) = match w {
        WeaponId::Sword => (1.15, 0.25, 0.75, [1.0, 1.0, 0., 0.], true),
        WeaponId::Bow => (0.95, 0.25, 0.8, [1.0, 0., 0., 0.], false),
        WeaponId::Wand => (0.65, 0.3, 0.8, [0.3, 1.0, 0., 0.], false),
        WeaponId::Shield => (0.6, 0.3, 0.75, [0., 0.3, 0., 0.4], false),
        WeaponId::Axe => (0.4, 0.35, 0.77, [1.0, 0., 0.02, 0.], false),
        WeaponId::Fists => (1.5, 0.2, 0.6, [0.6, 0.6, 0., 0.], false),
    };
    LegacyWeapon {
        boost,
        floor,
        dps,
        sc,
        dominant,
    }
}

/// Legacy `FACTIONS` (`packages/shared/src/factions.ts:48-70`): hp, rate, hit (unpaced), phys share (true share 0).
fn legacy_faction(f: FactionId) -> (f64, f64, f64, f64) {
    match f {
        FactionId::Fire => (950., 0.6, 85.2, 0.0),
        FactionId::Sentenced => (1085., 0.95, 72.1, 0.4),
        FactionId::Plague => (1020., 1.85, 28.7, 0.8),
        FactionId::Frost => (985., 0.45, 168.2, 0.9),
        FactionId::Holy => (1145., 0.95, 92.2, 1.0),
    }
}

/// Legacy `attackInterval` (weapons.ts:172).
fn interval(rate: f64, w: &LegacyWeapon, as_mult: f64) -> f64 {
    w.floor.max(1. / (rate * (1. + w.boost) * as_mult))
}

/// Legacy auto row (championCombatModel.ts:96-113, `damagePerHit` weapons.ts:181, `scalingDamage` weapons.ts:203):
/// (physical, magic, true) per hit and attacks per second.
fn legacy_auto(p: &crate::state::Player) -> [f64; 4] {
    let faction = p.core.vitals.faction.faction_id().expect("a champion");
    let (base_hp, rate, hit, phys_share) = legacy_faction(faction);
    let w = legacy_weapon(p.core.active_weapon());
    let m = p.core.modifiers.mirrors();
    let hit_mult = p.core.modifiers.mult_of(MultKey::Hit);
    let i = interval(rate, &w, m.as_mult);
    let base = rate * (hit * PACE) * w.dps * m.as_mult * i;
    let bonus_hp = (p.core.vitals.max_hp - base_hp).max(0.);
    let bonus_def = m.armor_bonus.max(0.) + m.shield_bonus;
    let per = m.as_mult * i;
    let [sad, sap, shp, sdef] = w.sc;
    let (sphys, smagic) = if w.dominant {
        let ap_side = m.ap_bonus * sap > m.ad_bonus * sad;
        (
            ((if ap_side { 0. } else { sad * m.ad_bonus }) + shp * bonus_hp + sdef * bonus_def)
                * per,
            (if ap_side { sap * m.ap_bonus } else { 0. }) * per,
        )
    } else {
        (
            (sad * m.ad_bonus + shp * bonus_hp + sdef * bonus_def) * per,
            sap * m.ap_bonus * per,
        )
    };
    [
        (base * phys_share + sphys) * hit_mult,
        (base * (1. - phys_share) + smagic) * hit_mult,
        0.,
        1. / i,
    ]
}

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
    sim_in(
        SimConfig {
            quests: false,
            pvp_rules: false,
            ..Default::default()
        },
        ps,
    )
}

/// A world that installs `bruiserPassives` (the practice room, `Gates::TRAINING`), so Holy's public camp-clear mirror holds the
/// canonical count (`systems::bruiser::camp_clears`); without the installer legacy's mirror is 0.
fn sim_with_bruiser(ps: &[Placement]) -> Sim {
    sim_in(
        SimConfig {
            quests: false,
            pvp_rules: false,
            training: true,
            faction_mode: crate::FactionMode::EngagementHoly,
            ..Default::default()
        },
        ps,
    )
}

fn sim_in(config: SimConfig, ps: &[Placement]) -> Sim {
    let secrets = Secrets {
        order_salt: 1,
        spawn_seed: 0,
        reward_salt: [1, 2, 3, 4],
    };
    Sim::reset_active(config, room(), secrets, ps)
}

fn grant(sim: &mut Sim, id: PlayerId, cards: &[CardId]) {
    let (k, w) = (&sim.k, &mut sim.w);
    for card in cards {
        assert!(crate::cards::grant(k, w, id, *card), "{card:?}");
    }
}

/// The observed panel of `viewer` (an absent panel reads as empty, so a missing value fails an assertion below).
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

fn assert_auto(panel: &ChampionPanel, p: &crate::state::Player) {
    let [phys, magic, true_, aps] = legacy_auto(p);
    assert_close(panel, C::HitPhysical, phys, "raw physical per hit");
    assert_close(panel, C::HitMagic, magic, "raw magic per hit");
    assert_close(panel, C::HitTrue, true_, "raw true per hit");
    assert_close(panel, C::AttacksPerSecond, aps, "1 / attackInterval");
}

fn codes(panel: &ChampionPanel) -> Vec<C> {
    panel.codes().collect()
}

/// Holy with a Sword, Machine Gun (hits x0.5, attack speed x2), +Offense and Bloodthirst, at 40% hp with 6 camp
/// clears. Legacy passive row (championCombatModel.ts:205-214): share = min(ls_cap, ls0 + ls1 x (1 - hpFrac)) =
/// min(0.6, 0.07 + 0.6 x 0.6) = 0.43; camp leech = 6 x 0.005 = 0.03, doubled by Bloodthirst below half health = 0.06;
/// the row prints share + camp leech = 0.49, the camp count 6 and the camp leech 0.06.
#[test]
fn a_holy_build_shows_the_legacy_auto_and_radiant_numbers() {
    let mut sim = sim_with_bruiser(&[seat(
        "holy",
        FactionId::Holy,
        Some(WeaponId::Sword),
        Vec2::new(112., 112.),
    )]);
    let id = sim.players()[0].id;
    grant(
        &mut sim,
        id,
        &[CardId::MachineGun, CardId::Ad1, CardId::Bloodthirst],
    );
    {
        let p = sim.w.players.get_mut(id).expect("seated");
        p.core.vitals.hp = 0.4 * p.core.vitals.max_hp;
        p.camps_cleared = 6;
    }
    let p = sim.player(id).expect("seated").clone();
    let m = p.core.modifiers.mirrors();
    assert!(
        m.ad_bonus > 0.,
        "Ad1 gives Offense, so weapon scaling is exercised"
    );
    assert_eq!(
        p.core.modifiers.mult_of(MultKey::Hit),
        0.5,
        "Machine Gun halves each hit (legacy cards.ts machineGun)"
    );

    let panel = panel_of(&sim, id);
    assert_eq!(
        codes(&panel),
        vec![
            C::HitPhysical,
            C::HitMagic,
            C::HitTrue,
            C::AttacksPerSecond,
            C::HolyLifeSteal,
            C::HolyCampClears,
            C::HolyCampLeech,
            // P-WIRE17-HUD-2c: the auto tooltip's hit mult and scaling split, every champion.
            C::HitMult,
            C::ScalingPhysical,
            C::ScalingMagic
        ],
        "a Holy panel prints the auto row and the Radiant row"
    );
    assert_auto(&panel, &p);
    assert_close(
        &panel,
        C::HolyLifeSteal,
        0.49,
        "0.43 share + 0.06 camp leech",
    );
    assert_close(&panel, C::HolyCampClears, 6., "camps cleared");
    assert_close(&panel, C::HolyCampLeech, 0.06, "6 x 0.005, doubled");
}

/// Fire with a Wand, Here Comes the Boom (hits x2.5, DoT x1.25, attack speed x0.5), +Offense and +SO, 5 s out of
/// combat. Legacy passive row (championCombatModel.ts:144-155): burn = (burn x PACE x dpsMult + 0.6 x SO + 0.5 x
/// Offense) x DoT mult, with burn 28 and the wand's dpsMult 0.8; the scaling line prints 0.6, 0.5 and the DoT mult.
/// Fire Roam (:114-116, shared/fireRoam.ts:16): charge = floor(5000 / 20000 x 1000) = 250, not armed.
#[test]
fn a_fire_build_shows_the_legacy_auto_dragonslayer_and_roam_numbers() {
    let mut sim = sim_with(&[seat(
        "fire",
        FactionId::Fire,
        Some(WeaponId::Wand),
        Vec2::new(112., 112.),
    )]);
    let id = sim.players()[0].id;
    grant(
        &mut sim,
        id,
        &[CardId::HereComesTheBoom, CardId::Ad1, CardId::Ap1],
    );
    let now = sim.server_time();
    {
        let p = sim.w.players.get_mut(id).expect("seated");
        p.roam.last_combat_at = Some(now - 5_000.);
        p.roam.ready = false;
    }
    let p = sim.player(id).expect("seated").clone();
    let m = p.core.modifiers.mirrors();
    assert!(
        m.ad_bonus > 0. && m.ap_bonus > 0.,
        "Ad1 and Ap1 give Offense and SO"
    );
    let dot = p.core.modifiers.mult_of(MultKey::Dot);
    assert_eq!(
        (p.core.modifiers.mult_of(MultKey::Hit), dot),
        (2.5, 1.25),
        "Here Comes the Boom: hits x2.5, DoT x1.25 (legacy cards.ts hereComesTheBoom)"
    );

    let panel = panel_of(&sim, id);
    assert_eq!(
        codes(&panel),
        vec![
            C::HitPhysical,
            C::HitMagic,
            C::HitTrue,
            C::AttacksPerSecond,
            C::BurnDps,
            C::BurnSoRatio,
            C::BurnOffenseRatio,
            C::DotMult,
            C::RoamCharge,
            C::RoamArmed,
            // P-WIRE17-HUD-2c: the roam line (Fire only), then the auto tooltip's numbers.
            C::RoamSpeedBonus,
            C::RoamBurstDamage,
            C::HitMult,
            C::ScalingPhysical,
            C::ScalingMagic
        ],
        "a Fire panel prints the auto row, the Dragonslayer row and the roam charge"
    );
    assert_auto(&panel, &p);
    let burn = (28. * PACE * 0.8 + 0.6 * m.ap_bonus + 0.5 * m.ad_bonus) * dot;
    assert_close(&panel, C::BurnDps, burn, "legacy burn formula");
    assert_close(&panel, C::BurnSoRatio, 0.6, "AP_DOT_RATIO");
    assert_close(&panel, C::BurnOffenseRatio, 0.5, "FIRE_BURN_AD_RATIO");
    assert_close(&panel, C::DotMult, 1.25, "the card fold's DoT mult");
    assert_close(&panel, C::RoamCharge, 250., "floor(5000 / 20000 x 1000)");
    assert_close(&panel, C::RoamArmed, 0., "not armed");

    // An armed burst shows as armed whatever the clock says (legacy prints "armed" instead of the charge).
    sim.w.players.get_mut(id).expect("seated").roam.ready = true;
    assert_close(&panel_of(&sim, id), C::RoamArmed, 1., "armed");
}

/// A fresh champion of each other faction, fists in hand, no build: exactly its faction's codes, and the passive
/// numbers worked by hand from legacy (championCombatModel.ts:157-204).
#[test]
fn a_fresh_champion_of_every_faction_carries_exactly_its_codes() {
    let auto = [C::HitPhysical, C::HitMagic, C::HitTrue, C::AttacksPerSecond];
    let cases: [(FactionId, &[C]); 5] = [
        (
            FactionId::Fire,
            &[
                C::BurnDps,
                C::BurnSoRatio,
                C::BurnOffenseRatio,
                C::DotMult,
                C::RoamCharge,
                C::RoamArmed,
                C::RoamSpeedBonus,
                C::RoamBurstDamage,
            ],
        ),
        (FactionId::Sentenced, &[C::MarkPulse, C::MarkKillStack]),
        // No body eaten: the scaling line reads "Walk over a body", so no zombie numbers.
        (FactionId::Plague, &[C::DiseaseDps, C::CorpseStacks]),
        (
            FactionId::Frost,
            &[
                C::ChillSlow,
                C::ChillMoveSlow,
                C::EliteGuardBonus,
                C::EliteGuardActive,
            ],
        ),
        (
            FactionId::Holy,
            &[C::HolyLifeSteal, C::HolyCampClears, C::HolyCampLeech],
        ),
    ];
    for (faction, own) in cases {
        let sim = sim_with(&[seat("p", faction, None, Vec2::new(112., 112.))]);
        let p = sim.players()[0].clone();
        let panel = panel_of(&sim, p.id);
        // P-WIRE17-HUD-2c: every panel ends with the auto tooltip's hit mult and scaling split.
        let tooltip = [C::HitMult, C::ScalingPhysical, C::ScalingMagic];
        let want: Vec<C> = auto.iter().chain(own).chain(&tooltip).copied().collect();
        assert_eq!(codes(&panel), want, "{faction:?} panel codes");
        assert_auto(&panel, &p);
        match faction {
            FactionId::Sentenced => {
                // markPct x markWeight (mark.ts:44,62): (0.045 x PACE) x rate x dpsMult x as x interval;
                // fists: interval = max(0.2, 1 / (0.95 x 2.5)) = 0.42105..
                let i = 1. / (0.95 * 2.5);
                assert_close(&panel, C::MarkPulse, 0.045 * PACE * 0.95 * 0.6 * i, "pulse");
                assert_close(&panel, C::MarkKillStack, 0.00675 * PACE, "mark_kill");
            }
            FactionId::Plague => {
                // (plague x PACE x dpsMult + 0.8 x SO x hits/s) x DoT = 52 x 2 x 0.6 with no SO.
                assert_close(&panel, C::DiseaseDps, 52. * PACE * 0.6, "disease");
                assert_close(&panel, C::CorpseStacks, 0., "no bodies");
            }
            FactionId::Frost => {
                assert_close(
                    &panel,
                    C::ChillSlow,
                    0.32,
                    "slow with no SD or attack speed",
                );
                assert_close(&panel, C::ChillMoveSlow, 0.3, "1 - CHILL_MOVE_MULT");
                assert_close(&panel, C::EliteGuardBonus, 25., "FROST_ELITE_GUARD_BONUS");
                assert_close(&panel, C::EliteGuardActive, 0., "no elite contact");
            }
            FactionId::Holy => {
                assert_close(&panel, C::HolyLifeSteal, 0.07, "ls0 at full health");
                assert_close(&panel, C::HolyCampClears, 0., "no camps");
                assert_close(&panel, C::HolyCampLeech, 0., "no camps");
            }
            FactionId::Fire => {
                assert_close(&panel, C::BurnDps, 28. * PACE * 0.6, "burn with fists");
                assert_close(&panel, C::DotMult, 1., "no DoT cards");
                assert_close(&panel, C::RoamArmed, 0., "not armed");
            }
        }
    }
}

/// C-OBS: each seat observes only its own panel, equal to `champion_panel` of that seat; an unseated viewer none.
#[test]
fn each_seat_observes_only_its_own_champion_panel() {
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
    grant(&mut sim, a, &[CardId::Ad1, CardId::Ap1]);
    let want_a = champion_panel(&sim, a).expect("a seated");
    let want_b = champion_panel(&sim, b).expect("b seated");
    assert_ne!(
        want_a, want_b,
        "the two panels differ, so a leak is visible"
    );
    assert_eq!(
        observe(&sim, a, &[]).panel,
        Some(want_a),
        "seat A's own panel"
    );
    assert_eq!(
        observe(&sim, b, &[]).panel,
        Some(want_b),
        "seat B's own panel, never A's"
    );
    let unseated = observe(&sim, PlayerId(9_999), &[]);
    assert_eq!(
        (unseated.summary.is_some(), unseated.panel),
        (false, None),
        "an unseated viewer observes no summary and no panel"
    );
    assert_eq!(
        champion_panel(&sim, PlayerId(9_999)),
        None,
        "no panel for an unseated id"
    );
}

#[test]
fn the_observation_identity_moves_for_the_panel() {
    assert_eq!(
        OBSERVATION_VERSION, 28,
        "Observation gains the owner's champion panel (26), its codes 23-27 (27, P-WIRE17-HUD-2c), the owner's clocks and the room minimum (28, P-WIRE17-HUD-3)"
    );
}
