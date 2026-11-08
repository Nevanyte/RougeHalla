use super::*;
pub struct Row {
    pub id: &'static str,
    pub tier: u8,
    pub unique: bool,
    pub effects: &'static [CardEffect],
    pub plague: &'static [CardEffect],
}
static E0: &[CardEffect] = &[CardEffect::Flat {
    stat: FlatStat::Ad,
    v: 12.,
}];
static P0: &[CardEffect] = &[];
static E1: &[CardEffect] = &[CardEffect::Flat {
    stat: FlatStat::Ad,
    v: 21.,
}];
static P1: &[CardEffect] = &[];
static E2: &[CardEffect] = &[CardEffect::Flat {
    stat: FlatStat::Ad,
    v: 33.,
}];
static P2: &[CardEffect] = &[];
static E3: &[CardEffect] = &[CardEffect::Flat {
    stat: FlatStat::Ap,
    v: 12.,
}];
static P3: &[CardEffect] = &[];
static E4: &[CardEffect] = &[CardEffect::Flat {
    stat: FlatStat::Ap,
    v: 21.,
}];
static P4: &[CardEffect] = &[];
static E5: &[CardEffect] = &[CardEffect::Flat {
    stat: FlatStat::Ap,
    v: 33.,
}];
static P5: &[CardEffect] = &[];
static E6: &[CardEffect] = &[CardEffect::Stat {
    stat: EffectStat::AttackSpeed,
    v: 0.09,
}];
static P6: &[CardEffect] = &[];
static E7: &[CardEffect] = &[CardEffect::Stat {
    stat: EffectStat::AttackSpeed,
    v: 0.16,
}];
static P7: &[CardEffect] = &[];
static E8: &[CardEffect] = &[CardEffect::Stat {
    stat: EffectStat::AttackSpeed,
    v: 0.25,
}];
static P8: &[CardEffect] = &[];
static E9: &[CardEffect] = &[CardEffect::Stat {
    stat: EffectStat::MaxHp,
    v: 0.09,
}];
static P9: &[CardEffect] = &[];
static E10: &[CardEffect] = &[CardEffect::Stat {
    stat: EffectStat::MaxHp,
    v: 0.16,
}];
static P10: &[CardEffect] = &[];
static E11: &[CardEffect] = &[CardEffect::Stat {
    stat: EffectStat::MaxHp,
    v: 0.25,
}];
static P11: &[CardEffect] = &[];
static E12: &[CardEffect] = &[CardEffect::Flat {
    stat: FlatStat::Armor,
    v: 15.,
}];
static P12: &[CardEffect] = &[];
static E13: &[CardEffect] = &[CardEffect::Flat {
    stat: FlatStat::Armor,
    v: 26.,
}];
static P13: &[CardEffect] = &[];
static E14: &[CardEffect] = &[CardEffect::Flat {
    stat: FlatStat::Armor,
    v: 41.,
}];
static P14: &[CardEffect] = &[];
static E15: &[CardEffect] = &[CardEffect::Flat {
    stat: FlatStat::Shield,
    v: 15.,
}];
static P15: &[CardEffect] = &[];
static E16: &[CardEffect] = &[CardEffect::Flat {
    stat: FlatStat::Shield,
    v: 26.,
}];
static P16: &[CardEffect] = &[];
static E17: &[CardEffect] = &[CardEffect::Flat {
    stat: FlatStat::Shield,
    v: 41.,
}];
static P17: &[CardEffect] = &[];
static E18: &[CardEffect] = &[CardEffect::Stat {
    stat: EffectStat::Lifesteal,
    v: 0.05,
}];
static P18: &[CardEffect] = &[];
static E19: &[CardEffect] = &[CardEffect::Stat {
    stat: EffectStat::Lifesteal,
    v: 0.09,
}];
static P19: &[CardEffect] = &[];
static E20: &[CardEffect] = &[CardEffect::Stat {
    stat: EffectStat::Lifesteal,
    v: 0.14,
}];
static P20: &[CardEffect] = &[];
static E21: &[CardEffect] = &[CardEffect::While {
    cond: WhileCond::NotShooting,
    arg: 0.,
    stat: StatKey::MoveSpeed,
    v: 0.06,
    ms: Some(2500.),
}];
static P21: &[CardEffect] = &[];
static E22: &[CardEffect] = &[CardEffect::While {
    cond: WhileCond::NotShooting,
    arg: 0.,
    stat: StatKey::MoveSpeed,
    v: 0.1,
    ms: Some(2500.),
}];
static P22: &[CardEffect] = &[];
static E23: &[CardEffect] = &[CardEffect::While {
    cond: WhileCond::NotShooting,
    arg: 0.,
    stat: StatKey::MoveSpeed,
    v: 0.15,
    ms: Some(2500.),
}];
static P23: &[CardEffect] = &[];
static E24: &[CardEffect] = &[CardEffect::While {
    cond: WhileCond::HpBelow,
    arg: 0.5,
    stat: StatKey::LifestealMult,
    v: 1.,
    ms: None,
}];
static P24: &[CardEffect] = &[];
static E25: &[CardEffect] = &[CardEffect::Stat {
    stat: EffectStat::HealBarrier,
    v: 0.3,
}];
static P25: &[CardEffect] = &[];
static E26: &[CardEffect] = &[
    CardEffect::Convert {
        from: ConvertFrom::Ad,
        to: ConvertTo::Armor,
        per: 0.25,
        cap: None,
    },
    CardEffect::Convert {
        from: ConvertFrom::Ad,
        to: ConvertTo::Shield,
        per: 0.25,
        cap: None,
    },
];
static P26: &[CardEffect] = &[];
static E27: &[CardEffect] = &[CardEffect::Convert {
    from: ConvertFrom::Ad,
    to: ConvertTo::Ap,
    per: 0.5,
    cap: None,
}];
static P27: &[CardEffect] = &[];
static E28: &[CardEffect] = &[CardEffect::Convert {
    from: ConvertFrom::MaxHp,
    to: ConvertTo::Ap,
    per: 0.02,
    cap: None,
}];
static P28: &[CardEffect] = &[];
static E29: &[CardEffect] = &[CardEffect::Convert {
    from: ConvertFrom::BonusAttackSpeed,
    to: ConvertTo::Ap,
    per: 100.,
    cap: None,
}];
static P29: &[CardEffect] = &[];
static E30: &[CardEffect] = &[CardEffect::Convert {
    from: ConvertFrom::BonusMoveSpeed,
    to: ConvertTo::Damage,
    per: 1.,
    cap: Some(0.3),
}];
static P30: &[CardEffect] = &[];
static E31: &[CardEffect] = &[
    CardEffect::Convert {
        from: ConvertFrom::MaxHp,
        to: ConvertTo::Armor,
        per: 0.02,
        cap: None,
    },
    CardEffect::Convert {
        from: ConvertFrom::MaxHp,
        to: ConvertTo::Shield,
        per: 0.02,
        cap: None,
    },
];
static P31: &[CardEffect] = &[];
static E32: &[CardEffect] = &[CardEffect::Stat {
    stat: EffectStat::MaxHp,
    v: 0.18,
}];
static P32: &[CardEffect] = &[];
static E33: &[CardEffect] = &[CardEffect::Flag(EffectFlag::Festering)];
static P33: &[CardEffect] = &[];
static E34: &[CardEffect] = &[CardEffect::Stat {
    stat: EffectStat::CritChance,
    v: 0.3333333333333333,
}];
static P34: &[CardEffect] = &[];
static E35: &[CardEffect] = &[CardEffect::Flag(EffectFlag::HeavierSentence)];
static P35: &[CardEffect] = &[];
static E36: &[CardEffect] = &[CardEffect::Flag(EffectFlag::SwiftJudgment)];
static P36: &[CardEffect] = &[];
static E37: &[CardEffect] = &[
    CardEffect::Mult {
        key: MultKey::AsPost,
        v: 0.5,
    },
    CardEffect::Mult {
        key: MultKey::Hit,
        v: 2.5,
    },
    CardEffect::Mult {
        key: MultKey::Dot,
        v: 1.25,
    },
    CardEffect::Mult {
        key: MultKey::Returned,
        v: 1.25,
    },
];
static P37: &[CardEffect] = &[];
static E38: &[CardEffect] = &[
    CardEffect::Mult {
        key: MultKey::AsPost,
        v: 2.,
    },
    CardEffect::Mult {
        key: MultKey::Hit,
        v: 0.5,
    },
];
static P38: &[CardEffect] = &[];
static E39: &[CardEffect] = &[
    CardEffect::Stat {
        stat: EffectStat::Damage,
        v: 0.35,
    },
    CardEffect::Stat {
        stat: EffectStat::MaxHp,
        v: -0.25,
    },
];
static P39: &[CardEffect] = &[];
static E40: &[CardEffect] = &[
    CardEffect::Stat {
        stat: EffectStat::MaxHp,
        v: 0.3,
    },
    CardEffect::Flag(EffectFlag::NoCrit),
];
static P40: &[CardEffect] = &[];
static E41: &[CardEffect] = &[
    CardEffect::Stat {
        stat: EffectStat::Lifesteal,
        v: 0.15,
    },
    CardEffect::Stat {
        stat: EffectStat::HealTaken,
        v: -1.,
    },
];
static P41: &[CardEffect] = &[];
static E42: &[CardEffect] = &[
    CardEffect::Mult {
        key: MultKey::Ap,
        v: 1.5,
    },
    CardEffect::Mult {
        key: MultKey::WishCooldown,
        v: 2.,
    },
];
static P42: &[CardEffect] = &[];
static E43: &[CardEffect] = &[
    CardEffect::Flag(EffectFlag::LockSecondSlot),
    CardEffect::Stat {
        stat: EffectStat::Damage,
        v: 0.2,
    },
    CardEffect::Stat {
        stat: EffectStat::AttackSpeed,
        v: 0.15,
    },
];
static P43: &[CardEffect] = &[];
static E44: &[CardEffect] = &[
    CardEffect::Mult {
        key: MultKey::Linger,
        v: 2.,
    },
    CardEffect::Mult {
        key: MultKey::Dot,
        v: 0.7,
    },
];
static P44: &[CardEffect] = &[];
static E45: &[CardEffect] = &[
    CardEffect::While {
        cond: WhileCond::Unarmed,
        arg: 0.,
        stat: StatKey::AttackSpeed,
        v: 0.4,
        ms: None,
    },
    CardEffect::Flag(EffectFlag::TwiceUnarmed),
];
static P45: &[CardEffect] = &[];
static E46: &[CardEffect] = &[CardEffect::Trigger {
    on: TriggerOn::Kill,
    arg: 0.,
    once: false,
    action: TriggerAction::Splash { radius: 200. },
}];
static P46: &[CardEffect] = &[];
static E47: &[CardEffect] = &[CardEffect::Trigger {
    on: TriggerOn::Block,
    arg: 0.,
    once: false,
    action: TriggerAction::Fortify { per: 1., cap: 250. },
}];
static P47: &[CardEffect] = &[];
static E48: &[CardEffect] = &[CardEffect::Trigger {
    on: TriggerOn::Block,
    arg: 0.,
    once: false,
    action: TriggerAction::Status {
        to_self: false,
        kind: OnHitStatus::SlowMove,
        ms: 1000.,
        value: Some(0.3),
    },
}];
static P48: &[CardEffect] = &[];
static E49: &[CardEffect] = &[CardEffect::Flag(EffectFlag::Gambler)];
static P49: &[CardEffect] = &[];
static E50: &[CardEffect] = &[
    CardEffect::Stat {
        stat: EffectStat::Damage,
        v: -0.3,
    },
    CardEffect::While {
        cond: WhileCond::FightTime,
        arg: 3.,
        stat: StatKey::Damage,
        v: 0.65,
        ms: None,
    },
];
static P50: &[CardEffect] = &[];
static E51: &[CardEffect] = &[CardEffect::Vs {
    test: VsTest::HpBelow,
    arg: 0.3,
    v: 0.3,
}];
static P51: &[CardEffect] = &[];
static E52: &[CardEffect] = &[
    CardEffect::Vs {
        test: VsTest::Elite,
        arg: 0.,
        v: 0.25,
    },
    CardEffect::Vs {
        test: VsTest::PlayerAbove,
        arg: 0.7,
        v: 0.25,
    },
];
static P52: &[CardEffect] = &[];
static E53: &[CardEffect] = &[CardEffect::Scale {
    src: ScaleSource::CampsCleared,
    per: 0.03,
    step: 1.,
    cap: Some(0.24),
}];
static P53: &[CardEffect] = &[];
static E54: &[CardEffect] = &[CardEffect::Trigger {
    on: TriggerOn::HitTaken,
    arg: 0.1,
    once: false,
    action: TriggerAction::Boost {
        attack_speed: 0.4,
        movement: 0.4,
        ms: 2000.,
    },
}];
static P54: &[CardEffect] = &[];
static E55: &[CardEffect] = &[CardEffect::Mult {
    key: MultKey::HpRace,
    v: 2.5,
}];
static P55: &[CardEffect] = &[];
static E56: &[CardEffect] = &[
    CardEffect::Stat {
        stat: EffectStat::CritChance,
        v: 0.2,
    },
    CardEffect::Flag(EffectFlag::DotCrit),
];
static P56: &[CardEffect] = &[
    CardEffect::Stat {
        stat: EffectStat::CritChance,
        v: 0.2,
    },
    CardEffect::Flag(EffectFlag::PlagueDotCritConversion),
];
static E57: &[CardEffect] = &[CardEffect::Flag(EffectFlag::ThirdCharm)];
static P57: &[CardEffect] = &[];
static E58: &[CardEffect] = &[CardEffect::Flag(EffectFlag::EyeForAnEye)];
static P58: &[CardEffect] = &[];
static E59: &[CardEffect] = &[CardEffect::Flag(EffectFlag::BlockHits)];
static P59: &[CardEffect] = &[];
static E60: &[CardEffect] = &[CardEffect::Vs {
    test: VsTest::Slowed,
    arg: 0.,
    v: 0.12,
}];
static P60: &[CardEffect] = &[];
static E61: &[CardEffect] = &[CardEffect::Scale {
    src: ScaleSource::Streak,
    per: 0.04,
    step: 1.,
    cap: Some(0.4),
}];
static P61: &[CardEffect] = &[];
static E62: &[CardEffect] = &[CardEffect::Vs {
    test: VsTest::Streak,
    arg: 0.,
    v: 0.4,
}];
static P62: &[CardEffect] = &[];
static E63: &[CardEffect] = &[CardEffect::Flag(EffectFlag::PlantFeet)];
static P63: &[CardEffect] = &[];
static E64: &[CardEffect] = &[CardEffect::Trigger {
    on: TriggerOn::Hit,
    arg: 0.,
    once: false,
    action: TriggerAction::Cooldown { ms: 1000. },
}];
static P64: &[CardEffect] = &[];
static E65: &[CardEffect] = &[CardEffect::OnHit {
    status: OnHitStatus::Dot,
    per: 0.1,
    cap: 1.,
    ms: 2000.,
}];
static P65: &[CardEffect] = &[];
static E66: &[CardEffect] = &[CardEffect::Stat {
    stat: EffectStat::SlowResist,
    v: 0.4,
}];
static P66: &[CardEffect] = &[];
static E67: &[CardEffect] = &[CardEffect::Trigger {
    on: TriggerOn::HitTaken,
    arg: 0.,
    once: false,
    action: TriggerAction::Return {
        share: 0.15,
        melee: true,
    },
}];
static P67: &[CardEffect] = &[];
static E68: &[CardEffect] = &[CardEffect::Stat {
    stat: EffectStat::MarkRate,
    v: 0.5,
}];
static P68: &[CardEffect] = &[];
static E69: &[CardEffect] = &[CardEffect::Stat {
    stat: EffectStat::HealTaken,
    v: 0.25,
}];
static P69: &[CardEffect] = &[];
static E70: &[CardEffect] = &[CardEffect::Stat {
    stat: EffectStat::LifestealDot,
    v: 0.2,
}];
static P70: &[CardEffect] = &[];
static E71: &[CardEffect] = &[CardEffect::Stat {
    stat: EffectStat::Windup,
    v: -0.5,
}];
static P71: &[CardEffect] = &[];
static E72: &[CardEffect] = &[CardEffect::Vs {
    test: VsTest::HigherPower,
    arg: 0.,
    v: 0.1,
}];
static P72: &[CardEffect] = &[];
static E73: &[CardEffect] = &[CardEffect::Trigger {
    on: TriggerOn::HpBelow,
    arg: 0.25,
    once: true,
    action: TriggerAction::Heal {
        share: 0.2,
        ignore_lockout: true,
        ms: Some(2000.),
    },
}];
static P73: &[CardEffect] = &[];
static E74: &[CardEffect] = &[CardEffect::Vs {
    test: VsTest::ThirdParty,
    arg: 0.,
    v: 0.08,
}];
static P74: &[CardEffect] = &[];
static E75: &[CardEffect] = &[CardEffect::Vs {
    test: VsTest::HpBelow,
    arg: 0.6,
    v: 0.08,
}];
static P75: &[CardEffect] = &[CardEffect::Stat {
    stat: EffectStat::ExecuteBand,
    v: 0.1,
}];
static E76: &[CardEffect] = &[CardEffect::While {
    cond: WhileCond::HpBelow,
    arg: 0.3,
    stat: StatKey::AttackSpeed,
    v: 0.25,
    ms: None,
}];
static P76: &[CardEffect] = &[];
static E77: &[CardEffect] = &[CardEffect::Flag(EffectFlag::GallowsPatience)];
static P77: &[CardEffect] = &[];
static E78: &[CardEffect] = &[CardEffect::Flag(EffectFlag::NoCommutation)];
static P78: &[CardEffect] = &[];
static E79: &[CardEffect] = &[CardEffect::Flag(EffectFlag::FinalVerdict)];
static P79: &[CardEffect] = &[];
pub static ROWS: [Row; 80] = [
    Row {
        id: "ad1",
        tier: 1,
        unique: false,
        effects: E0,
        plague: P0,
    },
    Row {
        id: "ad2",
        tier: 2,
        unique: false,
        effects: E1,
        plague: P1,
    },
    Row {
        id: "ad3",
        tier: 3,
        unique: false,
        effects: E2,
        plague: P2,
    },
    Row {
        id: "ap1",
        tier: 1,
        unique: false,
        effects: E3,
        plague: P3,
    },
    Row {
        id: "ap2",
        tier: 2,
        unique: false,
        effects: E4,
        plague: P4,
    },
    Row {
        id: "ap3",
        tier: 3,
        unique: false,
        effects: E5,
        plague: P5,
    },
    Row {
        id: "haste1",
        tier: 1,
        unique: false,
        effects: E6,
        plague: P6,
    },
    Row {
        id: "haste2",
        tier: 2,
        unique: false,
        effects: E7,
        plague: P7,
    },
    Row {
        id: "haste3",
        tier: 3,
        unique: false,
        effects: E8,
        plague: P8,
    },
    Row {
        id: "vitality1",
        tier: 1,
        unique: false,
        effects: E9,
        plague: P9,
    },
    Row {
        id: "vitality2",
        tier: 2,
        unique: false,
        effects: E10,
        plague: P10,
    },
    Row {
        id: "vitality3",
        tier: 3,
        unique: false,
        effects: E11,
        plague: P11,
    },
    Row {
        id: "armor1",
        tier: 1,
        unique: false,
        effects: E12,
        plague: P12,
    },
    Row {
        id: "armor2",
        tier: 2,
        unique: false,
        effects: E13,
        plague: P13,
    },
    Row {
        id: "armor3",
        tier: 3,
        unique: false,
        effects: E14,
        plague: P14,
    },
    Row {
        id: "mr1",
        tier: 1,
        unique: false,
        effects: E15,
        plague: P15,
    },
    Row {
        id: "mr2",
        tier: 2,
        unique: false,
        effects: E16,
        plague: P16,
    },
    Row {
        id: "mr3",
        tier: 3,
        unique: false,
        effects: E17,
        plague: P17,
    },
    Row {
        id: "leech1",
        tier: 1,
        unique: false,
        effects: E18,
        plague: P18,
    },
    Row {
        id: "leech2",
        tier: 2,
        unique: false,
        effects: E19,
        plague: P19,
    },
    Row {
        id: "leech3",
        tier: 3,
        unique: false,
        effects: E20,
        plague: P20,
    },
    Row {
        id: "fleet1",
        tier: 1,
        unique: false,
        effects: E21,
        plague: P21,
    },
    Row {
        id: "fleet2",
        tier: 2,
        unique: false,
        effects: E22,
        plague: P22,
    },
    Row {
        id: "fleet3",
        tier: 3,
        unique: false,
        effects: E23,
        plague: P23,
    },
    Row {
        id: "bloodthirst",
        tier: 2,
        unique: true,
        effects: E24,
        plague: P24,
    },
    Row {
        id: "secondSkin",
        tier: 2,
        unique: true,
        effects: E25,
        plague: P25,
    },
    Row {
        id: "juggernaut",
        tier: 2,
        unique: true,
        effects: E26,
        plague: P26,
    },
    Row {
        id: "spellsword",
        tier: 2,
        unique: true,
        effects: E27,
        plague: P27,
    },
    Row {
        id: "bigBrain",
        tier: 2,
        unique: true,
        effects: E28,
        plague: P28,
    },
    Row {
        id: "arcaneTempo",
        tier: 2,
        unique: true,
        effects: E29,
        plague: P29,
    },
    Row {
        id: "momentum",
        tier: 2,
        unique: true,
        effects: E30,
        plague: P30,
    },
    Row {
        id: "stoneSkin",
        tier: 2,
        unique: true,
        effects: E31,
        plague: P31,
    },
    Row {
        id: "hearty",
        tier: 2,
        unique: true,
        effects: E32,
        plague: P32,
    },
    Row {
        id: "festeringArcana",
        tier: 2,
        unique: true,
        effects: E33,
        plague: P33,
    },
    Row {
        id: "rhythm",
        tier: 2,
        unique: true,
        effects: E34,
        plague: P34,
    },
    Row {
        id: "heavierSentence",
        tier: 2,
        unique: true,
        effects: E35,
        plague: P35,
    },
    Row {
        id: "swiftJudgment",
        tier: 2,
        unique: true,
        effects: E36,
        plague: P36,
    },
    Row {
        id: "hereComesTheBoom",
        tier: 3,
        unique: true,
        effects: E37,
        plague: P37,
    },
    Row {
        id: "machineGun",
        tier: 2,
        unique: true,
        effects: E38,
        plague: P38,
    },
    Row {
        id: "glassCannon",
        tier: 2,
        unique: true,
        effects: E39,
        plague: P39,
    },
    Row {
        id: "thickSkull",
        tier: 2,
        unique: true,
        effects: E40,
        plague: P40,
    },
    Row {
        id: "vampiricPact",
        tier: 2,
        unique: true,
        effects: E41,
        plague: P41,
    },
    Row {
        id: "arcaneOverload",
        tier: 2,
        unique: true,
        effects: E42,
        plague: P42,
    },
    Row {
        id: "committed",
        tier: 3,
        unique: true,
        effects: E43,
        plague: P43,
    },
    Row {
        id: "slowBurn",
        tier: 1,
        unique: true,
        effects: E44,
        plague: P44,
    },
    Row {
        id: "fistsOfFury",
        tier: 2,
        unique: true,
        effects: E45,
        plague: P45,
    },
    Row {
        id: "overkill",
        tier: 2,
        unique: true,
        effects: E46,
        plague: P46,
    },
    Row {
        id: "tankEngine",
        tier: 2,
        unique: true,
        effects: E47,
        plague: P47,
    },
    Row {
        id: "pocketSand",
        tier: 1,
        unique: true,
        effects: E48,
        plague: P48,
    },
    Row {
        id: "gambler",
        tier: 1,
        unique: true,
        effects: E49,
        plague: P49,
    },
    Row {
        id: "slowStarter",
        tier: 2,
        unique: true,
        effects: E50,
        plague: P50,
    },
    Row {
        id: "coupDeGrace",
        tier: 2,
        unique: true,
        effects: E51,
        plague: P51,
    },
    Row {
        id: "bigGameHunter",
        tier: 2,
        unique: true,
        effects: E52,
        plague: P52,
    },
    Row {
        id: "packLeader",
        tier: 2,
        unique: true,
        effects: E53,
        plague: P53,
    },
    Row {
        id: "adrenaline",
        tier: 2,
        unique: true,
        effects: E54,
        plague: P54,
    },
    Row {
        id: "raceToZero",
        tier: 3,
        unique: true,
        effects: E55,
        plague: P55,
    },
    Row {
        id: "cruelWounds",
        tier: 2,
        unique: true,
        effects: E56,
        plague: P56,
    },
    Row {
        id: "thirdTimesTheCharm",
        tier: 2,
        unique: true,
        effects: E57,
        plague: P57,
    },
    Row {
        id: "eyeForAnEye",
        tier: 2,
        unique: true,
        effects: E58,
        plague: P58,
    },
    Row {
        id: "bestOffense",
        tier: 1,
        unique: true,
        effects: E59,
        plague: P59,
    },
    Row {
        id: "sittingDucks",
        tier: 2,
        unique: true,
        effects: E60,
        plague: P60,
    },
    Row {
        id: "tunnelVision",
        tier: 2,
        unique: true,
        effects: E61,
        plague: P61,
    },
    Row {
        id: "firstImpressions",
        tier: 1,
        unique: true,
        effects: E62,
        plague: P62,
    },
    Row {
        id: "plantYourFeet",
        tier: 2,
        unique: true,
        effects: E63,
        plague: P63,
    },
    Row {
        id: "wishfulThinking",
        tier: 2,
        unique: true,
        effects: E64,
        plague: P64,
    },
    Row {
        id: "hemorrhage",
        tier: 1,
        unique: true,
        effects: E65,
        plague: P65,
    },
    Row {
        id: "ironWill",
        tier: 1,
        unique: true,
        effects: E66,
        plague: P66,
    },
    Row {
        id: "spikedShell",
        tier: 2,
        unique: true,
        effects: E67,
        plague: P67,
    },
    Row {
        id: "gatheringStorm",
        tier: 2,
        unique: true,
        effects: E68,
        plague: P68,
    },
    Row {
        id: "wellspring",
        tier: 1,
        unique: true,
        effects: E69,
        plague: P69,
    },
    Row {
        id: "siphon",
        tier: 2,
        unique: true,
        effects: E70,
        plague: P70,
    },
    Row {
        id: "quickdraw",
        tier: 1,
        unique: true,
        effects: E71,
        plague: P71,
    },
    Row {
        id: "bountyHunter",
        tier: 1,
        unique: true,
        effects: E72,
        plague: P72,
    },
    Row {
        id: "secondWind",
        tier: 2,
        unique: true,
        effects: E73,
        plague: P73,
    },
    Row {
        id: "witness",
        tier: 1,
        unique: true,
        effects: E74,
        plague: P74,
    },
    Row {
        id: "pestilence",
        tier: 2,
        unique: true,
        effects: E75,
        plague: P75,
    },
    Row {
        id: "lastRites",
        tier: 1,
        unique: true,
        effects: E76,
        plague: P76,
    },
    Row {
        id: "gallowsPatience",
        tier: 2,
        unique: true,
        effects: E77,
        plague: P77,
    },
    Row {
        id: "noCommutation",
        tier: 2,
        unique: true,
        effects: E78,
        plague: P78,
    },
    Row {
        id: "finalVerdict",
        tier: 3,
        unique: true,
        effects: E79,
        plague: P79,
    },
];
#[allow(non_upper_case_globals)]
impl CardId {
    pub const Ad1: CardId = CardId(0);
    pub const Ad2: CardId = CardId(1);
    pub const Ad3: CardId = CardId(2);
    pub const Ap1: CardId = CardId(3);
    pub const Ap2: CardId = CardId(4);
    pub const Ap3: CardId = CardId(5);
    pub const Haste1: CardId = CardId(6);
    pub const Haste2: CardId = CardId(7);
    pub const Haste3: CardId = CardId(8);
    pub const Vitality1: CardId = CardId(9);
    pub const Vitality2: CardId = CardId(10);
    pub const Vitality3: CardId = CardId(11);
    pub const Armor1: CardId = CardId(12);
    pub const Armor2: CardId = CardId(13);
    pub const Armor3: CardId = CardId(14);
    pub const Mr1: CardId = CardId(15);
    pub const Mr2: CardId = CardId(16);
    pub const Mr3: CardId = CardId(17);
    pub const Leech1: CardId = CardId(18);
    pub const Leech2: CardId = CardId(19);
    pub const Leech3: CardId = CardId(20);
    pub const Fleet1: CardId = CardId(21);
    pub const Fleet2: CardId = CardId(22);
    pub const Fleet3: CardId = CardId(23);
    pub const Bloodthirst: CardId = CardId(24);
    pub const SecondSkin: CardId = CardId(25);
    pub const Juggernaut: CardId = CardId(26);
    pub const Spellsword: CardId = CardId(27);
    pub const BigBrain: CardId = CardId(28);
    pub const ArcaneTempo: CardId = CardId(29);
    pub const Momentum: CardId = CardId(30);
    pub const StoneSkin: CardId = CardId(31);
    pub const Hearty: CardId = CardId(32);
    pub const FesteringArcana: CardId = CardId(33);
    pub const Rhythm: CardId = CardId(34);
    pub const HeavierSentence: CardId = CardId(35);
    pub const SwiftJudgment: CardId = CardId(36);
    pub const HereComesTheBoom: CardId = CardId(37);
    pub const MachineGun: CardId = CardId(38);
    pub const GlassCannon: CardId = CardId(39);
    pub const ThickSkull: CardId = CardId(40);
    pub const VampiricPact: CardId = CardId(41);
    pub const ArcaneOverload: CardId = CardId(42);
    pub const Committed: CardId = CardId(43);
    pub const SlowBurn: CardId = CardId(44);
    pub const FistsOfFury: CardId = CardId(45);
    pub const Overkill: CardId = CardId(46);
    pub const TankEngine: CardId = CardId(47);
    pub const PocketSand: CardId = CardId(48);
    pub const Gambler: CardId = CardId(49);
    pub const SlowStarter: CardId = CardId(50);
    pub const CoupDeGrace: CardId = CardId(51);
    pub const BigGameHunter: CardId = CardId(52);
    pub const PackLeader: CardId = CardId(53);
    pub const Adrenaline: CardId = CardId(54);
    pub const RaceToZero: CardId = CardId(55);
    pub const CruelWounds: CardId = CardId(56);
    pub const ThirdTimesTheCharm: CardId = CardId(57);
    pub const EyeForAnEye: CardId = CardId(58);
    pub const BestOffense: CardId = CardId(59);
    pub const SittingDucks: CardId = CardId(60);
    pub const TunnelVision: CardId = CardId(61);
    pub const FirstImpressions: CardId = CardId(62);
    pub const PlantYourFeet: CardId = CardId(63);
    pub const WishfulThinking: CardId = CardId(64);
    pub const Hemorrhage: CardId = CardId(65);
    pub const IronWill: CardId = CardId(66);
    pub const SpikedShell: CardId = CardId(67);
    pub const GatheringStorm: CardId = CardId(68);
    pub const Wellspring: CardId = CardId(69);
    pub const Siphon: CardId = CardId(70);
    pub const Quickdraw: CardId = CardId(71);
    pub const BountyHunter: CardId = CardId(72);
    pub const SecondWind: CardId = CardId(73);
    pub const Witness: CardId = CardId(74);
    pub const Pestilence: CardId = CardId(75);
    pub const LastRites: CardId = CardId(76);
    pub const GallowsPatience: CardId = CardId(77);
    pub const NoCommutation: CardId = CardId(78);
    pub const FinalVerdict: CardId = CardId(79);
    pub const ALL: [CardId; 80] = [
        Self(0),
        Self(1),
        Self(2),
        Self(3),
        Self(4),
        Self(5),
        Self(6),
        Self(7),
        Self(8),
        Self(9),
        Self(10),
        Self(11),
        Self(12),
        Self(13),
        Self(14),
        Self(15),
        Self(16),
        Self(17),
        Self(18),
        Self(19),
        Self(20),
        Self(21),
        Self(22),
        Self(23),
        Self(24),
        Self(25),
        Self(26),
        Self(27),
        Self(28),
        Self(29),
        Self(30),
        Self(31),
        Self(32),
        Self(33),
        Self(34),
        Self(35),
        Self(36),
        Self(37),
        Self(38),
        Self(39),
        Self(40),
        Self(41),
        Self(42),
        Self(43),
        Self(44),
        Self(45),
        Self(46),
        Self(47),
        Self(48),
        Self(49),
        Self(50),
        Self(51),
        Self(52),
        Self(53),
        Self(54),
        Self(55),
        Self(56),
        Self(57),
        Self(58),
        Self(59),
        Self(60),
        Self(61),
        Self(62),
        Self(63),
        Self(64),
        Self(65),
        Self(66),
        Self(67),
        Self(68),
        Self(69),
        Self(70),
        Self(71),
        Self(72),
        Self(73),
        Self(74),
        Self(75),
        Self(76),
        Self(77),
        Self(78),
        Self(79),
    ];
    pub const NAMES: [&'static str; 80] = [
        "ad1",
        "ad2",
        "ad3",
        "ap1",
        "ap2",
        "ap3",
        "haste1",
        "haste2",
        "haste3",
        "vitality1",
        "vitality2",
        "vitality3",
        "armor1",
        "armor2",
        "armor3",
        "mr1",
        "mr2",
        "mr3",
        "leech1",
        "leech2",
        "leech3",
        "fleet1",
        "fleet2",
        "fleet3",
        "bloodthirst",
        "secondSkin",
        "juggernaut",
        "spellsword",
        "bigBrain",
        "arcaneTempo",
        "momentum",
        "stoneSkin",
        "hearty",
        "festeringArcana",
        "rhythm",
        "heavierSentence",
        "swiftJudgment",
        "hereComesTheBoom",
        "machineGun",
        "glassCannon",
        "thickSkull",
        "vampiricPact",
        "arcaneOverload",
        "committed",
        "slowBurn",
        "fistsOfFury",
        "overkill",
        "tankEngine",
        "pocketSand",
        "gambler",
        "slowStarter",
        "coupDeGrace",
        "bigGameHunter",
        "packLeader",
        "adrenaline",
        "raceToZero",
        "cruelWounds",
        "thirdTimesTheCharm",
        "eyeForAnEye",
        "bestOffense",
        "sittingDucks",
        "tunnelVision",
        "firstImpressions",
        "plantYourFeet",
        "wishfulThinking",
        "hemorrhage",
        "ironWill",
        "spikedShell",
        "gatheringStorm",
        "wellspring",
        "siphon",
        "quickdraw",
        "bountyHunter",
        "secondWind",
        "witness",
        "pestilence",
        "lastRites",
        "gallowsPatience",
        "noCommutation",
        "finalVerdict",
    ];
}
