//! Loose proof for `build_summary` (owner direction 2026-11-10: read the legacy code, one test that the numbers are not
//! drastically off; no capture). Every expected value below is worked out by hand from the legacy formulas in
//! `packages/client/src/ui/buildModel.ts` `buildGains` (see the packet brief for file:line), then compared within 10%.
use crate::build_summary::build_summary;
use crate::cards::CardId;
use crate::map::TileMap;
use crate::mob_catalog::MobTypeId as M;
use crate::reward_chests::BoostId;
use crate::{Arena, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

fn room() -> Arena {
    let (w, h) = (20usize, 12usize);
    let rows: Vec<String> = (0..h)
        .map(|y| {
            (0..w)
                .map(|x| if x == 0 || y == 0 || x == w - 1 || y == h - 1 { '#' } else { '.' })
                .collect()
        })
        .collect();
    Arena {
        map: TileMap::from_rows(&rows).expect("room"),
        spawns: vec![Vec2::new(112., 112.)],
    }
}

fn holy_sim() -> (Sim, PlayerId) {
    let ps = [Placement {
        profile: "holy".into(),
        faction: FactionId::Holy,
        bot: false,
        at: Vec2::new(112., 112.),
        hp: None,
        weapon0: None,
        weapon1: None,
    }];
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
    let sim = Sim::reset_active(config, room(), secrets, &ps);
    let id = sim.players()[0].id;
    (sim, id)
}

/// Within 10% of the hand value (absolute 1e-9 when the hand value is 0); the sign must match.
fn near(name: &str, got: f64, want: f64) {
    if want == 0. {
        assert!(got.abs() < 1e-9, "{name}: got {got}, want 0");
        return;
    }
    assert!(
        got * want > 0.,
        "{name}: sign differs, got {got}, want {want}"
    );
    assert!(
        (got - want).abs() <= 0.1 * want.abs(),
        "{name}: got {got}, want about {want}"
    );
}

#[test]
fn a_mixed_holy_build_reports_the_legacy_gains() {
    let (mut sim, id) = holy_sim();
    let (k, w) = (&sim.k, &mut sim.w);
    for card in [
        CardId::Ad1,
        CardId::Ad2,
        CardId::Ap1,
        CardId::Armor1,
        CardId::Mr1,
        CardId::Haste1,
        CardId::Fleet1,
        CardId::Vitality1,
        CardId::Vitality2,
        CardId::Leech1,
        CardId::SlowStarter,
    ] {
        assert!(crate::cards::grant(k, w, id, card), "{card:?}");
    }
    for (mob, n) in [
        (M::Pardoner, 3),
        (M::FlameCaller, 5),
        (M::Bailiff, 4),
        (M::ChainWarden, 2),
        (M::PlagueRat, 10),
        (M::CinderHound, 6),
        (M::EmberImp, 7),
        (M::MagmaBrute, 10),
        (M::Acolyte, 8),
    ] {
        assert_eq!(crate::modifiers::grant_mob_stat(k, w, id, mob, n), n);
    }
    assert!(crate::reward_chests::grant_boost(k, w, id, BoostId::Ad));
    w.players[0].camps_cleared = 6;

    let s = build_summary(&sim, id).expect("seated");
    let holy_hp = crate::content::faction(FactionId::Holy).hp;

    // Offense: cards 12 + 21, Pardoner 3 x 1; the Ad chest boost adds 0.2 x max(36, 25) = 7.2 (under its 9 ceiling).
    near("offense", s.offense, 12. + 21. + 3. + 7.2);
    // SO: card 12 + Flame Caller 5 x 1.
    near("soul_offense", s.soul_offense, 12. + 5.);
    // Damage counts unconditional rows only: Slow Starter's -0.30 (its +0.65 `while` row is excluded) + Ember Imp 7 x 0.01.
    near("damage", s.damage, -0.30 + 0.07);
    // Attack speed: asMult - 1 = Haste I 0.09 + Plague Rat 10 x 0.01 = 0.19.
    near("attack_speed", s.attack_speed, 0.09 + 0.10);
    // Life steal (Holy): Leech I 0.05 x 2.7 (rows under LS_CAP) + Acolyte 8 x 0.0025 + 6 camp clears x 0.005.
    near("life_steal", s.life_steal, 0.05 * 2.7 + 0.02 + 0.03);
    // Health above the faction baseline: base hp x (Vitality I 0.09 + II 0.16 + Magma Brute 10 x 0.01).
    near("health", s.health, holy_hp * (0.09 + 0.16 + 0.10));
    // Defense and Soul Defense: card + farmed flat rows.
    near("defense", s.defense, 15. + 4. * 1.25);
    near("soul_defense", s.soul_defense, 15. + 2. * 1.5);
    // Move speed: Fleet I 0.06 + Cinder Hound 6 x 0.005.
    near("move_speed", s.move_speed, 0.06 + 0.03);

    // "Mob bonuses": one row per owned type with its stacks and cumulative reward.
    assert_eq!(s.mob_row_count(), 9);
    let row = |m: M| s.mob_rows.iter().flatten().find(|r| r.mob == m).copied().expect("row");
    assert_eq!(row(M::PlagueRat).stacks, 10);
    near("plague rat total", row(M::PlagueRat).total, 0.10);
    assert_eq!(row(M::Bailiff).stacks, 4);
    near("bailiff total", row(M::Bailiff).total, 5.);
}

#[test]
fn a_player_with_nothing_gained_returns_zeros_and_no_mob_rows() {
    let (sim, id) = holy_sim();
    let s = build_summary(&sim, id).expect("seated");
    for (name, v) in [
        ("offense", s.offense),
        ("soul_offense", s.soul_offense),
        ("damage", s.damage),
        ("attack_speed", s.attack_speed),
        ("life_steal", s.life_steal),
        ("health", s.health),
        ("defense", s.defense),
        ("soul_defense", s.soul_defense),
        ("move_speed", s.move_speed),
    ] {
        assert!(v.abs() < 1e-9, "{name} should be 0, got {v}");
    }
    assert_eq!(s.mob_row_count(), 0);
}
