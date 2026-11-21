//! P-AUG-RULES-1: the Rework override rows, hand-written (the catalog, `catalog_data.rs`, is generated and pinned to the
//! legacy capture). `cards::Tuning` reads this table under `SimConfig::augments = Rework`; every row passes
//! `cards::check_override` (only row numbers and `text` may differ from the catalog row; `cards::tuning` tests run the
//! guard over this table).
//!
//! Layout (fixed: the Unity mirror test reads `title` and `text` from it with the `catalog_data.rs` regex,
//! `BuildDrawerEditModeTests.cs:28`): one `CardDef { ... }` per card, every field on its own line in the
//! `catalog_data.rs` order `id`, `kind`, `tier`, `base`, `requires`, `unique`, `ready`, `title`, `text`, `tags`, `rows`,
//! `selections`, in `CardId` order. A changed row number is a registered constant by name
//! (`v: crate::constants::REWORK_<NAME>`, a `content!` row), never a bare literal; an unchanged one is copied from
//! `catalog_data.rs`. How to add a row: `docs/agent/AUGMENT_REWORK.md`.
use super::{
    CardDef, CardId, CardKind, CardRow, MechanicTag, OnHitRow, Side, TriggerAction, TriggerOn,
    TriggerRow,
};
use crate::stat_fold::{EffectFlag, EffectKind, EffectStat, MultKey, StatKey, WhileCond, WhileRow};
use crate::status_runtime::StatusKind;

pub(crate) static REWORK_OVERRIDES: &[CardDef] = &[
    CardDef {
        id: CardId::HereComesTheBoom,
        kind: CardKind::Augment,
        tier: 3,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title: "Here Comes the Boom",
        text: "Your attack speed is halved, but your hits deal 2.6x damage, Offense and SO alike. Your damage over time and returned damage deal 1.25x.",
        tags: &[MechanicTag::Dot, MechanicTag::Returned],
        rows: &[
            CardRow::Fold(EffectKind::Mult { key: MultKey::AsPost, v: 0.5 }),
            CardRow::Fold(EffectKind::Mult { key: MultKey::Hit, v: crate::constants::REWORK_BOOM_HIT }),
            CardRow::Fold(EffectKind::Mult { key: MultKey::Dot, v: 1.25 }),
            CardRow::Fold(EffectKind::Mult { key: MultKey::Returned, v: 1.25 }),
        ],
        selections: &[
        ],
    },

    CardDef {
        id: CardId::MachineGun,
        kind: CardKind::Augment,
        tier: 2,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title: "Machine Gun",
        text: "Your attack speed is doubled, but each hit deals 55% damage. Your on-hit effects keep their full strength.",
        tags: &[MechanicTag::OnHit],
        rows: &[
            CardRow::Fold(EffectKind::Mult { key: MultKey::AsPost, v: 2.0 }),
            CardRow::Fold(EffectKind::Mult { key: MultKey::Hit, v: crate::constants::REWORK_MACHINE_GUN_HIT }),
        ],
        selections: &[
        ],
    },

    CardDef {
        id: CardId::GlassCannon,
        kind: CardKind::Augment,
        tier: 2,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title: "Glass Cannon",
        text: "+35% damage, -22% max health.",
        tags: &[],
        rows: &[
            CardRow::Fold(EffectKind::Stat { stat: EffectStat::Damage, v: 0.35 }),
            CardRow::Fold(EffectKind::Stat { stat: EffectStat::MaxHp, v: crate::constants::REWORK_GLASS_CANNON_MAX_HP }),
        ],
        selections: &[
        ],
    },

    CardDef {
        id: CardId::VampiricPact,
        kind: CardKind::Augment,
        tier: 2,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title: "Vampiric Pact",
        text: "+18% lifesteal, but no other healing works on you (camp heals included).",
        tags: &[MechanicTag::Heal],
        rows: &[
            CardRow::Fold(EffectKind::Stat { stat: EffectStat::Lifesteal, v: crate::constants::REWORK_VAMPIRIC_LIFESTEAL }),
            CardRow::Fold(EffectKind::Stat { stat: EffectStat::HealTaken, v: -1.0 }),
        ],
        selections: &[
        ],
    },

    CardDef {
        id: CardId::ArcaneOverload,
        kind: CardKind::Augment,
        tier: 2,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title: "Arcane Overload",
        text: "Your SO is multiplied by 1.5, but your Wish's cooldown is multiplied by 1.5.",
        tags: &[MechanicTag::Magic, MechanicTag::Wish],
        rows: &[
            CardRow::Fold(EffectKind::Mult { key: MultKey::Ap, v: 1.5 }),
            CardRow::Fold(EffectKind::Mult { key: MultKey::WishCooldown, v: crate::constants::REWORK_ARCANE_OVERLOAD_WISH_COOLDOWN }),
        ],
        selections: &[
        ],
    },

    CardDef {
        id: CardId::Committed,
        kind: CardKind::Augment,
        tier: 3,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title: "Committed",
        text: "Your second weapon slot is locked. The weapon you hold deals +22% damage and attacks 15% faster.",
        tags: &[],
        rows: &[
            CardRow::Fold(EffectKind::Flag { flag: EffectFlag::LockSecondSlot }),
            CardRow::Fold(EffectKind::Stat { stat: EffectStat::Damage, v: crate::constants::REWORK_COMMITTED_DAMAGE }),
            CardRow::Fold(EffectKind::Stat { stat: EffectStat::AttackSpeed, v: 0.15 }),
        ],
        selections: &[
        ],
    },

    CardDef {
        id: CardId::SlowBurn,
        kind: CardKind::Augment,
        tier: 1,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title: "Slow Burn",
        text: "Your damage over time keeps burning twice as long after a fight breaks off, at 15% less per second.",
        tags: &[MechanicTag::Dot],
        rows: &[
            CardRow::Fold(EffectKind::Mult { key: MultKey::Linger, v: 2.0 }),
            CardRow::Fold(EffectKind::Mult { key: MultKey::Dot, v: crate::constants::REWORK_SLOW_BURN_DOT }),
        ],
        selections: &[
        ],
    },

    CardDef {
        id: CardId::FistsOfFury,
        kind: CardKind::Augment,
        tier: 2,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title: "Fists of Fury",
        text: "While unarmed: +50% attack speed (counts toward the cap), and your on-hit effects apply twice.",
        tags: &[MechanicTag::OnHit],
        rows: &[
            CardRow::Fold(EffectKind::While(WhileRow { cond: WhileCond::Unarmed, arg: 0.0, stat: StatKey::AttackSpeed, v: crate::constants::REWORK_FISTS_ATTACK_SPEED, ms: None })),
            CardRow::Fold(EffectKind::Flag { flag: EffectFlag::TwiceUnarmed }),
        ],
        selections: &[
        ],
    },

    CardDef {
        id: CardId::Overkill,
        kind: CardKind::Augment,
        tier: 2,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title: "Overkill",
        text: "Damage beyond a kill splashes onto the nearest enemy within 260 u.",
        tags: &[MechanicTag::Area],
        rows: &[
            CardRow::Trigger(TriggerRow { on: TriggerOn::Kill, arg: 0.0, once: false, action: TriggerAction::Splash { radius: crate::constants::REWORK_OVERKILL_RADIUS } }),
        ],
        selections: &[
        ],
    },

    CardDef {
        id: CardId::TankEngine,
        kind: CardKind::Augment,
        tier: 2,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title: "Tank Engine",
        text: "Permanently gain 1.5 max health for every point of damage your blocks prevent (up to +350).",
        tags: &[MechanicTag::Block],
        rows: &[
            CardRow::Trigger(TriggerRow { on: TriggerOn::Block, arg: 0.0, once: false, action: TriggerAction::Fortify { per: crate::constants::REWORK_TANK_ENGINE_PER, cap: crate::constants::REWORK_TANK_ENGINE_CAP } }),
        ],
        selections: &[
        ],
    },

    CardDef {
        id: CardId::PocketSand,
        kind: CardKind::Augment,
        tier: 1,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title: "Pocket Sand",
        text: "Your blocks slow the attacker by 40% for 1.5 s.",
        tags: &[MechanicTag::Block, MechanicTag::Slow],
        rows: &[
            CardRow::Trigger(TriggerRow { on: TriggerOn::Block, arg: 0.0, once: false, action: TriggerAction::Status { to: Side::Target, status: StatusKind::SlowMove, ms: crate::constants::REWORK_POCKET_SAND_MS, value: Some(crate::constants::REWORK_POCKET_SAND_SLOW) } }),
        ],
        selections: &[
        ],
    },

    CardDef {
        id: CardId::Gambler,
        kind: CardKind::Augment,
        tier: 1,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title: "Gambler",
        text: "Each hit has an 18% chance to deal double damage and a 12% chance to deal half.",
        tags: &[MechanicTag::Crit],
        rows: &[
            CardRow::Fold(EffectKind::Flag { flag: EffectFlag::Gambler }),
        ],
        selections: &[
        ],
    },

    CardDef {
        id: CardId::ThirdTimesTheCharm,
        kind: CardKind::Augment,
        tier: 2,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title: "Third Time's the Charm",
        text: "Every 3rd hit on the same target applies its on-hit effects at 2.5x strength.",
        tags: &[MechanicTag::OnHit],
        rows: &[
            CardRow::Fold(EffectKind::Flag { flag: EffectFlag::ThirdCharm }),
        ],
        selections: &[
        ],
    },

    CardDef {
        id: CardId::PlantYourFeet,
        kind: CardKind::Augment,
        tier: 2,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title: "Plant Your Feet",
        text: "After standing still for 1 s, your next attack has +35% range and damage.",
        tags: &[],
        rows: &[
            CardRow::Fold(EffectKind::Flag { flag: EffectFlag::PlantFeet }),
        ],
        selections: &[
        ],
    },

    CardDef {
        id: CardId::WishfulThinking,
        kind: CardKind::Augment,
        tier: 2,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title: "Wishful Thinking",
        text: "Each hit you land shortens your Wish's cooldown by 1.5% of its full length (at most 20% a minute).",
        tags: &[MechanicTag::Wish],
        rows: &[
            CardRow::Trigger(TriggerRow { on: TriggerOn::Hit, arg: 0.0, once: false, action: TriggerAction::Cooldown { ms: 1000.0 } }),
        ],
        selections: &[
        ],
    },

    CardDef {
        id: CardId::Hemorrhage,
        kind: CardKind::Augment,
        tier: 1,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title: "Hemorrhage",
        text: "Your physical hits make the target bleed for 12% of the hit over 2 s.",
        tags: &[MechanicTag::OnHit, MechanicTag::Dot, MechanicTag::Physical],
        rows: &[
            CardRow::OnHit(OnHitRow { status: StatusKind::Dot, per: crate::constants::REWORK_HEMORRHAGE_PER, cap: Some(1.0), ms: 2000.0 }),
        ],
        selections: &[
        ],
    },

    CardDef {
        id: CardId::SpikedShell,
        kind: CardKind::Augment,
        tier: 2,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title: "Spiked Shell",
        text: "Melee attackers take 20% of the damage they deal to you back as physical damage.",
        tags: &[MechanicTag::Returned, MechanicTag::Physical],
        rows: &[
            CardRow::Trigger(TriggerRow { on: TriggerOn::HitTaken, arg: 0.0, once: false, action: TriggerAction::Return { melee: true, share: crate::constants::REWORK_SPIKED_SHELL_SHARE } }),
        ],
        selections: &[
        ],
    },

    CardDef {
        id: CardId::Siphon,
        kind: CardKind::Augment,
        tier: 2,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title: "Siphon",
        text: "Your damage over time heals you for 25% of the damage it deals.",
        tags: &[MechanicTag::Dot, MechanicTag::Heal],
        rows: &[
            CardRow::Fold(EffectKind::Stat { stat: EffectStat::LifestealDot, v: crate::constants::REWORK_SIPHON_SHARE }),
        ],
        selections: &[
        ],
    },

    CardDef {
        id: CardId::SecondWind,
        kind: CardKind::Augment,
        tier: 2,
        base: None,
        requires: None,
        unique: true,
        ready: true,
        title: "Second Wind",
        text: "Once per run, the first time a hit leaves you below 30% health: heal 25% of max health over 1.5 s.",
        tags: &[MechanicTag::Heal],
        rows: &[
            CardRow::Trigger(TriggerRow { on: TriggerOn::HpBelow, arg: crate::constants::REWORK_SECOND_WIND_BELOW, once: true, action: TriggerAction::Heal { share: crate::constants::REWORK_SECOND_WIND_HEAL, ms: Some(2000.0), ignore_lockout: true } }),
        ],
        selections: &[
        ],
    },
];
