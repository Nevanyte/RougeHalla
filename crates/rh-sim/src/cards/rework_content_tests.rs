//! P-AUG-CONTENT-1 oracle: the Augment_Tuning numbers and text under `AugmentRule::Rework`, and nothing under `Legacy`.
//!
//! Loose proof (owner direction 2026-11-10), in four parts:
//! 1. every changed number is the Appendix A number (`docs/backlog/AUGMENT_ELITE_REWORK.md`), in the override rows and in
//!    the named numbers, and each is a hashed `REWORK_*` registry row of the same value;
//! 2. every other card, and every number the packet leaves alone, is the legacy one under Rework; Legacy is unchanged;
//! 3. the override text is the exact string the Unity catalog shows (`CardDisplayCatalog.cs` on P-AUG-UI-1, b2fc08016);
//! 4. behaviour reads the numbers: Tank Engine, Pocket Sand, Gambler, and the fold (Committed, Glass Cannon, Machine Gun,
//!    Boom with its 2.6 cap, Arcane Overload) differ between a Rework and a Legacy world as the table says.
use super::{CardNumbers, Tuning};
use crate::cards::{CardId, CardRow, OnHitRow, TriggerAction, TriggerOn, TriggerRow};
use crate::constants::{ContentVal, REGISTRY};
use crate::modifiers::{OutgoingKind, VsProbe};
use crate::stat_fold::{EffectFlag, EffectKind, EffectStat, MultKey, StatKey, WhileCond, WhileRow};
use crate::status_runtime::StatusKind;
use crate::{arenas, AugmentRule, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

fn rework() -> &'static Tuning {
    Tuning::of(&SimConfig {
        augments: AugmentRule::Rework,
        ..SimConfig::default()
    })
}

fn legacy() -> &'static Tuning {
    Tuning::of(&SimConfig::default())
}

fn stat(stat: EffectStat, v: f64) -> CardRow {
    CardRow::Fold(EffectKind::Stat { stat, v })
}
fn mult(key: MultKey, v: f64) -> CardRow {
    CardRow::Fold(EffectKind::Mult { key, v })
}
fn flag(flag: EffectFlag) -> CardRow {
    CardRow::Fold(EffectKind::Flag { flag })
}
fn trigger(on: TriggerOn, arg: f64, once: bool, action: TriggerAction) -> CardRow {
    CardRow::Trigger(TriggerRow {
        on,
        arg,
        once,
        action,
    })
}

/// The 18 changed cards: (id, the Rework rows, the Rework text). Rows are written out in full from the catalog rows with
/// the Appendix A numbers; the text is the Unity catalog's description string.
fn changed() -> Vec<(CardId, Vec<CardRow>, &'static str)> {
    vec![
        (
            CardId::HereComesTheBoom,
            vec![
                mult(MultKey::AsPost, 0.5),
                mult(MultKey::Hit, 2.6),
                mult(MultKey::Dot, 1.25),
                mult(MultKey::Returned, 1.25),
            ],
            "Your attack speed is halved, but your hits deal 2.6x damage, Offense and SO alike. Your damage over time and returned damage deal 1.25x.",
        ),
        (
            CardId::MachineGun,
            vec![mult(MultKey::AsPost, 2.0), mult(MultKey::Hit, 0.55)],
            "Your attack speed is doubled, but each hit deals 55% damage. Your on-hit effects keep their full strength.",
        ),
        (
            CardId::GlassCannon,
            vec![
                stat(EffectStat::Damage, 0.35),
                stat(EffectStat::MaxHp, -0.22),
            ],
            "+35% damage, -22% max health.",
        ),
        (
            CardId::VampiricPact,
            vec![
                stat(EffectStat::Lifesteal, 0.18),
                stat(EffectStat::HealTaken, -1.0),
            ],
            "+18% lifesteal, but no other healing works on you (camp heals included).",
        ),
        (
            CardId::ArcaneOverload,
            vec![mult(MultKey::Ap, 1.5), mult(MultKey::WishCooldown, 1.5)],
            "Your SO is multiplied by 1.5, but your Wish's cooldown is multiplied by 1.5.",
        ),
        (
            CardId::Committed,
            vec![
                flag(EffectFlag::LockSecondSlot),
                stat(EffectStat::Damage, 0.22),
                stat(EffectStat::AttackSpeed, 0.15),
            ],
            "Your second weapon slot is locked. The weapon you hold deals +22% damage and attacks 15% faster.",
        ),
        (
            CardId::SlowBurn,
            vec![mult(MultKey::Linger, 2.0), mult(MultKey::Dot, 0.85)],
            "Your damage over time keeps burning twice as long after a fight breaks off, at 15% less per second.",
        ),
        (
            CardId::FistsOfFury,
            vec![
                CardRow::Fold(EffectKind::While(WhileRow {
                    cond: WhileCond::Unarmed,
                    arg: 0.0,
                    stat: StatKey::AttackSpeed,
                    v: 0.5,
                    ms: None,
                })),
                flag(EffectFlag::TwiceUnarmed),
            ],
            "While unarmed: +50% attack speed (counts toward the cap), and your on-hit effects apply twice.",
        ),
        (
            CardId::Overkill,
            vec![trigger(
                TriggerOn::Kill,
                0.0,
                false,
                TriggerAction::Splash { radius: 260.0 },
            )],
            "Damage beyond a kill splashes onto the nearest enemy within 260 u.",
        ),
        (
            CardId::TankEngine,
            vec![trigger(
                TriggerOn::Block,
                0.0,
                false,
                TriggerAction::Fortify {
                    per: 1.5,
                    cap: 350.0,
                },
            )],
            "Permanently gain 1.5 max health for every point of damage your blocks prevent (up to +350).",
        ),
        (
            CardId::PocketSand,
            vec![trigger(
                TriggerOn::Block,
                0.0,
                false,
                TriggerAction::Status {
                    to: crate::cards::Side::Target,
                    status: StatusKind::SlowMove,
                    ms: 1500.0,
                    value: Some(0.4),
                },
            )],
            "Your blocks slow the attacker by 40% for 1.5 s.",
        ),
        (
            CardId::Gambler,
            vec![flag(EffectFlag::Gambler)],
            "Each hit has an 18% chance to deal double damage and a 12% chance to deal half.",
        ),
        (
            CardId::ThirdTimesTheCharm,
            vec![flag(EffectFlag::ThirdCharm)],
            "Every 3rd hit on the same target applies its on-hit effects at 2.5x strength.",
        ),
        (
            CardId::PlantYourFeet,
            vec![flag(EffectFlag::PlantFeet)],
            "After standing still for 1 s, your next attack has +35% range and damage.",
        ),
        (
            CardId::Hemorrhage,
            vec![CardRow::OnHit(OnHitRow {
                status: StatusKind::Dot,
                per: 0.12,
                cap: Some(1.0),
                ms: 2000.0,
            })],
            "Your physical hits make the target bleed for 12% of the hit over 2 s.",
        ),
        (
            CardId::SpikedShell,
            vec![trigger(
                TriggerOn::HitTaken,
                0.0,
                false,
                TriggerAction::Return {
                    melee: true,
                    share: 0.2,
                },
            )],
            "Melee attackers take 20% of the damage they deal to you back as physical damage.",
        ),
        (
            CardId::Siphon,
            vec![stat(EffectStat::LifestealDot, 0.25)],
            "Your damage over time heals you for 25% of the damage it deals.",
        ),
        (
            CardId::SecondWind,
            vec![trigger(
                TriggerOn::HpBelow,
                0.3,
                true,
                TriggerAction::Heal {
                    share: 0.25,
                    ms: Some(2000.0),
                    ignore_lockout: true,
                },
            )],
            "Once per run, the first time a hit leaves you below 30% health: heal 25% of max health over 1.5 s.",
        ),
    ]
}

/// The registry rows this packet appends (name, value), in the appended order: the Appendix A numbers. The elite helper
/// share (decision 7, `REWORK_ELITE_SHARE_STACKS` = 12, a `u32` row) follows them.
fn registered_rows() -> Vec<(&'static str, f64)> {
    vec![
        ("REWORK_TANK_ENGINE_PER", 1.5),
        ("REWORK_TANK_ENGINE_CAP", 350.0),
        ("REWORK_PLANT_FEET_BONUS", 0.35),
        ("REWORK_SLOW_BURN_DOT", 0.85),
        ("REWORK_POCKET_SAND_SLOW", 0.4),
        ("REWORK_POCKET_SAND_MS", 1500.0),
        ("REWORK_OVERKILL_RADIUS", 260.0),
        ("REWORK_THIRD_TIME_EXTRA", 1.5),
        ("REWORK_SPIKED_SHELL_SHARE", 0.2),
        ("REWORK_SIPHON_SHARE", 0.25),
        ("REWORK_HEMORRHAGE_PER", 0.12),
        ("REWORK_SECOND_WIND_BELOW", 0.3),
        ("REWORK_SECOND_WIND_HEAL", 0.25),
        ("REWORK_GAMBLER_UP_CHANCE", 0.18),
        ("REWORK_GAMBLER_DOWN_CHANCE", 0.12),
        ("REWORK_COMMITTED_DAMAGE", 0.22),
        ("REWORK_GLASS_CANNON_MAX_HP", -0.22),
        ("REWORK_MACHINE_GUN_HIT", 0.55),
        ("REWORK_FISTS_ATTACK_SPEED", 0.5),
        ("REWORK_BOOM_HIT", 2.6),
        ("REWORK_OUTGOING_ROW_CAP", 2.6),
        ("REWORK_VAMPIRIC_LIFESTEAL", 0.18),
        ("REWORK_ARCANE_OVERLOAD_WISH_COOLDOWN", 1.5),
    ]
}

fn registered(name: &str) -> Option<ContentVal> {
    REGISTRY.iter().find(|e| e.name == name).map(|e| e.val)
}

/// Part 1a and 3: the override rows are the Appendix A rows, and their text is the Unity catalog's.
#[test]
fn rework_overrides_carry_the_augment_tuning_rows_and_text() {
    let t = rework();
    for (id, rows, text) in changed() {
        let def = t.def(id);
        assert_eq!(def.rows, &rows[..], "{id:?}: Rework rows");
        assert_eq!(def.text, text, "{id:?}: Rework text");
        // Gambler, Third Time and Plant keep their legacy flag row: their numbers are named numbers (`CardNumbers`,
        // asserted below), so only their text changes.
        if !matches!(
            id,
            CardId::Gambler | CardId::ThirdTimesTheCharm | CardId::PlantYourFeet
        ) {
            assert_ne!(
                def.rows,
                id.definition().rows,
                "{id:?}: the Rework rows are not the legacy ones"
            );
        }
        assert_ne!(
            def.text,
            id.definition().text,
            "{id:?}: the Rework text is not the legacy text"
        );
        assert_eq!(
            super::check_override(id.definition(), def),
            Ok(()),
            "{id:?}: the override passes the shape guard"
        );
    }
}

/// Part 1b: the named numbers (Plant, Gambler's two chances, Third Time, the G1 cap).
#[test]
fn rework_named_numbers_are_the_augment_tuning_numbers() {
    let n: &CardNumbers = rework().numbers();
    assert_eq!(n.plant_feet_bonus, 0.35, "Plant Your Feet +35%");
    assert_eq!(n.gambler_up_chance, 0.18, "Gambler doubles 18%");
    assert_eq!(n.gambler_down_chance, 0.12, "Gambler halves 12%");
    assert_eq!(n.gambler_up, 2.0);
    assert_eq!(n.gambler_down, 0.5);
    assert_eq!(n.third_time_every, 3, "Third Time stays every 3rd hit");
    assert_eq!(
        1. + n.third_time_extra,
        2.5,
        "Third Time applies on-hit effects 2.5x (1 + extra)"
    );
    assert_eq!(n.outgoing_row_cap, 2.6, "decision 2: the Rework row cap");
    assert_eq!(
        rework().fold_definition().outgoing_row_cap,
        2.6,
        "the cap reaches the fold's hit clamp too (both cap sites)"
    );
    // Left alone by this packet: A Race to 0 (cap) and Wishful Thinking (P-AUG-TUNE-1).
    assert_eq!(n.hp_race_cap, crate::constants::HP_RACE_CAP);
    assert_eq!(
        rework().fold_definition().hp_race_cap,
        crate::constants::HP_RACE_CAP
    );
    assert_eq!(n.wishful_budget_ms, crate::constants::WISHFUL_BUDGET_MS);
    assert_eq!(n.wishful_window_ms, crate::constants::WISHFUL_WINDOW_MS);
    assert_eq!(n.wishful_floor_share, crate::constants::WISHFUL_FLOOR_SHARE);
}

/// Part 1c: every changed number is a hashed registry row (`content_hash` folds the whole registry), appended at the end
/// in the listed order, and the elite helper share (decision 7) is registered at 12.
#[test]
fn every_changed_number_is_a_hashed_rework_registry_row() {
    let rows = registered_rows();
    for (name, want) in &rows {
        match registered(name) {
            Some(ContentVal::F64(x)) => assert_eq!(x, *want, "{name}"),
            other => panic!("{name}: not registered as an f64 row ({other:?})"),
        }
    }
    assert_eq!(
        registered("REWORK_ELITE_SHARE_STACKS"),
        Some(ContentVal::U64(12)),
        "decision 7: one camp's worth of stacks"
    );
    // Appended as one run, in order, never reordered. Later packets append their own rows after this run
    // (coordinator oracle-amend 2026-11-19: the run used to have to end the registry, which every append broke).
    let names: Vec<&str> = REGISTRY.iter().map(|e| e.name).collect();
    let run: Vec<&str> = rows
        .iter()
        .map(|(n, _)| *n)
        .chain(["REWORK_ELITE_SHARE_STACKS"])
        .collect();
    let start = names
        .iter()
        .position(|n| *n == run[0])
        .expect("the first CONTENT-1 REWORK row is registered");
    assert!(start > 0, "the registry is not just the REWORK rows");
    assert_eq!(
        names.get(start..start + run.len()),
        Some(&run[..]),
        "the CONTENT-1 REWORK rows are one run in the registry, in this order"
    );
    // The numbers the tables carry are the rows' values (a literal copy would be an unhashed second source).
    let by = |n: &str| match registered(n) {
        Some(ContentVal::F64(x)) => x,
        other => panic!("{n}: {other:?}"),
    };
    let n = rework().numbers();
    assert_eq!(n.plant_feet_bonus, by("REWORK_PLANT_FEET_BONUS"));
    assert_eq!(n.gambler_up_chance, by("REWORK_GAMBLER_UP_CHANCE"));
    assert_eq!(n.gambler_down_chance, by("REWORK_GAMBLER_DOWN_CHANCE"));
    assert_eq!(n.outgoing_row_cap, by("REWORK_OUTGOING_ROW_CAP"));
    assert_eq!(n.third_time_extra, by("REWORK_THIRD_TIME_EXTRA"));
}

/// Part 2: Legacy is unchanged, and under Rework every card the packet does not change (Wishful Thinking, A Race to 0,
/// Best Offense, Eye for an Eye and the rest) is its catalog row; the pool is still `INTERACTIVE`.
#[test]
fn legacy_is_unchanged_and_unlisted_cards_keep_their_catalog_rows() {
    let listed: Vec<CardId> = changed().iter().map(|c| c.0).collect();
    assert_eq!(listed.len(), 18);
    for id in CardId::ALL {
        assert_eq!(legacy().def(id), id.definition(), "Legacy {id:?}");
        // Wishful Thinking's override is text only (P-AUG-TUNE-1, `wishful_rework_tests`): its rows are the catalog's.
        if id == CardId::WishfulThinking {
            assert_eq!(rework().def(id).rows, id.definition().rows);
        } else if !listed.contains(&id) {
            assert_eq!(rework().def(id), id.definition(), "Rework {id:?} unchanged");
        }
    }
    let n = legacy().numbers();
    assert_eq!(n.plant_feet_bonus, 0.25);
    assert_eq!(n.gambler_up_chance, 0.15);
    assert_eq!(n.gambler_down_chance, 0.15);
    assert_eq!(n.third_time_every, 3);
    assert_eq!(n.third_time_extra, 1.);
    assert_eq!(n.outgoing_row_cap, 2.5);
    assert_eq!(n.hp_race_cap, 2.5);
    assert_eq!(legacy().fold_definition().outgoing_row_cap, 2.5);
    // The Rework pool is P-AUG-POOL-1's (`reward_chests::pool_tests`); the Legacy pool stays the legacy one.
    assert_eq!(legacy().pool(), &crate::reward_chests::INTERACTIVE[..]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Part 4: behaviour.
// ---------------------------------------------------------------------------------------------------------------------

fn world(augments: AugmentRule) -> Sim {
    let ps = [
        Placement {
            profile: "rework-a".into(),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(400., 400.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
        Placement {
            profile: "rework-b".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(456., 400.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
    ];
    let config = SimConfig {
        augments,
        ..SimConfig::default()
    };
    Sim::reset_active(config, arenas::practice_arena(), Secrets::from_seed(7), &ps)
}

/// Player 2 holds `card` and blocks `raw` physical damage from player 1, `blocks` times; returns the world.
fn block(augments: AugmentRule, card: CardId, raw: f64, blocks: usize) -> Sim {
    let mut sim = world(augments);
    assert!(crate::cards::grant(&sim.k, &mut sim.w, PlayerId(2), card));
    for _ in 0..blocks {
        let mut ev = Vec::new();
        let mut hx = crate::hooks::Hx {
            stats: Default::default(),
            fx: None,
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut ev,
        };
        crate::cards::on_blocked(
            &mut hx,
            &crate::hooks::HookArgs::Blocked {
                holder: PlayerId(2),
                attacker: PlayerId(1),
                prevented: crate::state::Packet {
                    raw,
                    phys: 1.,
                    magic: 0.,
                    true_: 0.,
                },
                melee: true,
            },
        );
    }
    sim
}

/// Tank Engine: the same blocked amount earns 1.5x the max health under Rework (Legacy 1 per point), and the total stops
/// at +350 (Legacy +250).
#[test]
fn tank_engine_earns_one_and_a_half_hp_per_blocked_point_up_to_350() {
    let tank = |sim: &Sim| sim.w.player(PlayerId(2)).unwrap().card_tank_hp;
    let l_sim = block(AugmentRule::Legacy, CardId::TankEngine, 100., 1);
    let l = tank(&l_sim);
    let r_sim = block(AugmentRule::Rework, CardId::TankEngine, 100., 1);
    let r = tank(&r_sim);
    assert!(l > 0., "Legacy earned {l}");
    assert!(
        (r - 1.5 * l).abs() < 1e-9,
        "one block of 100: Rework earned {r}, Legacy {l}; want exactly 1.5x"
    );
    let hp = |sim: &Sim| sim.w.player(PlayerId(2)).unwrap().vitals.max_hp;
    assert!(
        (hp(&r_sim) - hp(&l_sim) - (r - l)).abs() < 1e-9,
        "the earned health reaches max health"
    );
    let l_cap = tank(&block(AugmentRule::Legacy, CardId::TankEngine, 1.0e6, 3));
    let r_cap = tank(&block(AugmentRule::Rework, CardId::TankEngine, 1.0e6, 3));
    assert_eq!(l_cap, 250., "Legacy cap");
    assert_eq!(r_cap, 350., "Rework cap");
}

/// Pocket Sand: the blocked attacker is slowed 40% for 1.5 s under Rework (30% for 1 s under Legacy).
#[test]
fn pocket_sand_slows_the_attacker_forty_percent_for_one_and_a_half_seconds() {
    let slow = |augments| {
        let sim = block(augments, CardId::PocketSand, 100., 1);
        let st = &sim.w.player(PlayerId(1)).unwrap().core.statuses.instances;
        let s = st
            .iter()
            .find(|s| s.kind == StatusKind::SlowMove)
            .expect("the attacker is slowed");
        (s.value, s.until - s.started_at)
    };
    assert_eq!(slow(AugmentRule::Legacy), (0.3, 1000.));
    assert_eq!(slow(AugmentRule::Rework), (0.4, 1500.));
}

/// Gambler: over many entries the up and down shares are 18% and 12% under Rework (15% and 15% under Legacy). Loose:
/// within 1.5 points of the target over 20000 entries (the two chances are told apart: 15/15 fails).
#[test]
fn gambler_doubles_about_eighteen_percent_and_halves_about_twelve() {
    for (augments, up, down) in [
        (AugmentRule::Legacy, 0.15, 0.15),
        (AugmentRule::Rework, 0.18, 0.12),
    ] {
        let sim = world(augments);
        let (mut ups, mut downs) = (0u32, 0u32);
        let total = 20_000u32;
        for index in 0..total {
            match crate::cards::gambler_factor(&sim.k, &sim.w, PlayerId(1), PlayerId(2), index) {
                2.0 => ups += 1,
                0.5 => downs += 1,
                f => assert_eq!(f, 1., "a Gambler factor is 2, 0.5 or 1"),
            }
        }
        let (u, d) = (
            f64::from(ups) / f64::from(total),
            f64::from(downs) / f64::from(total),
        );
        assert!(
            (u - up).abs() < 0.015,
            "{augments:?}: up share {u}, want about {up}"
        );
        assert!(
            (d - down).abs() < 0.015,
            "{augments:?}: down share {d}, want about {down}"
        );
    }
}

/// The fold: Committed +22%, Boom 2.6x (the cap lets it land), Machine Gun 0.55x, Glass Cannon -22% max health and
/// Arcane Overload's Wish cooldown 1.5x under Rework, the Legacy numbers under Legacy.
#[test]
fn the_fold_reads_the_rework_numbers() {
    let hold = |augments, card| {
        let mut sim = world(augments);
        assert!(crate::cards::grant(&sim.k, &mut sim.w, PlayerId(1), card));
        sim
    };
    let p = |sim: &Sim| sim.w.player(PlayerId(1)).unwrap().clone();
    let row = |sim: &Sim| {
        let p = p(sim);
        crate::modifiers::outgoing_damage(
            sim.k.cards,
            &p.core,
            &p.build,
            1.,
            OutgoingKind::Hit,
            1.,
            0,
            0,
            VsProbe::default(),
            false,
        )
    };
    let near = |a: f64, b: f64, what: &str| assert!((a - b).abs() < 1e-9, "{what}: {a} vs {b}");

    let (l, r) = (
        hold(AugmentRule::Legacy, CardId::Committed),
        hold(AugmentRule::Rework, CardId::Committed),
    );
    near(row(&l), 1.20, "Committed legacy");
    near(row(&r), 1.22, "Committed rework");

    let (l, r) = (
        hold(AugmentRule::Legacy, CardId::HereComesTheBoom),
        hold(AugmentRule::Rework, CardId::HereComesTheBoom),
    );
    near(
        p(&l).modifiers.mult_of(MultKey::Hit),
        2.5,
        "Boom legacy fold",
    );
    near(
        p(&r).modifiers.mult_of(MultKey::Hit),
        2.6,
        "Boom rework fold",
    );
    // The outgoing row is divided by Boom's own Hit mult (ceiling = cap / own), so a hit lands at own x row. Under a
    // 2.5 cap Boom's 2.6 would land at 2.5; the Rework cap of 2.6 lets it land whole.
    near(
        p(&l).modifiers.mult_of(MultKey::Hit) * row(&l),
        2.5,
        "Boom legacy landed hit",
    );
    near(
        p(&r).modifiers.mult_of(MultKey::Hit) * row(&r),
        2.6,
        "Boom rework landed hit (cap 2.6)",
    );

    let (l, r) = (
        hold(AugmentRule::Legacy, CardId::MachineGun),
        hold(AugmentRule::Rework, CardId::MachineGun),
    );
    near(
        p(&l).modifiers.mult_of(MultKey::Hit),
        0.5,
        "Machine Gun legacy",
    );
    near(
        p(&r).modifiers.mult_of(MultKey::Hit),
        0.55,
        "Machine Gun rework",
    );

    let (l, r) = (
        hold(AugmentRule::Legacy, CardId::GlassCannon),
        hold(AugmentRule::Rework, CardId::GlassCannon),
    );
    near(
        p(&r).vitals.max_hp / p(&l).vitals.max_hp,
        0.78 / 0.75,
        "Glass Cannon max health ratio",
    );

    let (l, r) = (
        hold(AugmentRule::Legacy, CardId::ArcaneOverload),
        hold(AugmentRule::Rework, CardId::ArcaneOverload),
    );
    near(
        p(&l).modifiers.mult_of(MultKey::WishCooldown),
        2.0,
        "Arcane legacy",
    );
    near(
        p(&r).modifiers.mult_of(MultKey::WishCooldown),
        1.5,
        "Arcane rework",
    );
}
