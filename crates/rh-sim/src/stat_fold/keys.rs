#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum EffectStat {
    MaxHp,
    AttackSpeed,
    MoveSpeed,
    Damage,
    Windup,
    Lifesteal,
    MarkRate,
    HealTaken,
    DamageTaken,
    Cooldown,
    ExecuteBand,
    SlowResist,
    LifestealMult,
    LifestealDot,
    CritChance,
    HealBarrier,
}

impl EffectStat {
    pub fn source_order() -> [Self; 16] {
        [
            Self::MaxHp,
            Self::AttackSpeed,
            Self::MoveSpeed,
            Self::Damage,
            Self::Windup,
            Self::Lifesteal,
            Self::MarkRate,
            Self::HealTaken,
            Self::DamageTaken,
            Self::Cooldown,
            Self::ExecuteBand,
            Self::SlowResist,
            Self::LifestealMult,
            Self::LifestealDot,
            Self::CritChance,
            Self::HealBarrier,
        ]
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FlatStat {
    Armor,
    Shield,
    Ad,
    Ap,
}

impl FlatStat {
    pub fn source_order() -> [Self; 4] {
        [Self::Armor, Self::Shield, Self::Ad, Self::Ap]
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum StatKey {
    MaxHp,
    AttackSpeed,
    MoveSpeed,
    Damage,
    Windup,
    Lifesteal,
    MarkRate,
    HealTaken,
    DamageTaken,
    Cooldown,
    ExecuteBand,
    SlowResist,
    LifestealMult,
    LifestealDot,
    CritChance,
    HealBarrier,
    Armor,
    Shield,
    Ad,
    Ap,
}

impl StatKey {
    pub fn source_order() -> [Self; 20] {
        [
            Self::MaxHp,
            Self::AttackSpeed,
            Self::MoveSpeed,
            Self::Damage,
            Self::Windup,
            Self::Lifesteal,
            Self::MarkRate,
            Self::HealTaken,
            Self::DamageTaken,
            Self::Cooldown,
            Self::ExecuteBand,
            Self::SlowResist,
            Self::LifestealMult,
            Self::LifestealDot,
            Self::CritChance,
            Self::HealBarrier,
            Self::Armor,
            Self::Shield,
            Self::Ad,
            Self::Ap,
        ]
    }

    pub const fn is_product(self) -> bool {
        matches!(self, Self::LifestealMult)
    }

    pub const fn index(self) -> usize {
        match self {
            Self::MaxHp => 0,
            Self::AttackSpeed => 1,
            Self::MoveSpeed => 2,
            Self::Damage => 3,
            Self::Windup => 4,
            Self::Lifesteal => 5,
            Self::MarkRate => 6,
            Self::HealTaken => 7,
            Self::DamageTaken => 8,
            Self::Cooldown => 9,
            Self::ExecuteBand => 10,
            Self::SlowResist => 11,
            Self::LifestealMult => 12,
            Self::LifestealDot => 13,
            Self::CritChance => 14,
            Self::HealBarrier => 15,
            Self::Armor => 16,
            Self::Shield => 17,
            Self::Ad => 18,
            Self::Ap => 19,
        }
    }
}

pub const fn is_product_stat(stat: StatKey) -> bool {
    stat.is_product()
}

pub const fn is_flat_stat(stat: StatKey) -> bool {
    matches!(
        stat,
        StatKey::Armor | StatKey::Shield | StatKey::Ad | StatKey::Ap
    )
}

impl From<EffectStat> for StatKey {
    fn from(stat: EffectStat) -> Self {
        match stat {
            EffectStat::MaxHp => Self::MaxHp,
            EffectStat::AttackSpeed => Self::AttackSpeed,
            EffectStat::MoveSpeed => Self::MoveSpeed,
            EffectStat::Damage => Self::Damage,
            EffectStat::Windup => Self::Windup,
            EffectStat::Lifesteal => Self::Lifesteal,
            EffectStat::MarkRate => Self::MarkRate,
            EffectStat::HealTaken => Self::HealTaken,
            EffectStat::DamageTaken => Self::DamageTaken,
            EffectStat::Cooldown => Self::Cooldown,
            EffectStat::ExecuteBand => Self::ExecuteBand,
            EffectStat::SlowResist => Self::SlowResist,
            EffectStat::LifestealMult => Self::LifestealMult,
            EffectStat::LifestealDot => Self::LifestealDot,
            EffectStat::CritChance => Self::CritChance,
            EffectStat::HealBarrier => Self::HealBarrier,
        }
    }
}

impl From<FlatStat> for StatKey {
    fn from(stat: FlatStat) -> Self {
        match stat {
            FlatStat::Armor => Self::Armor,
            FlatStat::Shield => Self::Shield,
            FlatStat::Ad => Self::Ad,
            FlatStat::Ap => Self::Ap,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StatSums {
    pub max_hp: f64,
    pub attack_speed: f64,
    pub move_speed: f64,
    pub damage: f64,
    pub windup: f64,
    pub lifesteal: f64,
    pub mark_rate: f64,
    pub heal_taken: f64,
    pub damage_taken: f64,
    pub cooldown: f64,
    pub execute_band: f64,
    pub slow_resist: f64,
    pub lifesteal_mult: f64,
    pub lifesteal_dot: f64,
    pub crit_chance: f64,
    pub heal_barrier: f64,
    pub armor: f64,
    pub shield: f64,
    pub ad: f64,
    pub ap: f64,
}

impl StatSums {
    pub fn get(&self, key: StatKey) -> f64 {
        match key {
            StatKey::MaxHp => self.max_hp,
            StatKey::AttackSpeed => self.attack_speed,
            StatKey::MoveSpeed => self.move_speed,
            StatKey::Damage => self.damage,
            StatKey::Windup => self.windup,
            StatKey::Lifesteal => self.lifesteal,
            StatKey::MarkRate => self.mark_rate,
            StatKey::HealTaken => self.heal_taken,
            StatKey::DamageTaken => self.damage_taken,
            StatKey::Cooldown => self.cooldown,
            StatKey::ExecuteBand => self.execute_band,
            StatKey::SlowResist => self.slow_resist,
            StatKey::LifestealMult => self.lifesteal_mult,
            StatKey::LifestealDot => self.lifesteal_dot,
            StatKey::CritChance => self.crit_chance,
            StatKey::HealBarrier => self.heal_barrier,
            StatKey::Armor => self.armor,
            StatKey::Shield => self.shield,
            StatKey::Ad => self.ad,
            StatKey::Ap => self.ap,
        }
    }

    pub fn set(&mut self, key: StatKey, value: f64) {
        match key {
            StatKey::MaxHp => self.max_hp = value,
            StatKey::AttackSpeed => self.attack_speed = value,
            StatKey::MoveSpeed => self.move_speed = value,
            StatKey::Damage => self.damage = value,
            StatKey::Windup => self.windup = value,
            StatKey::Lifesteal => self.lifesteal = value,
            StatKey::MarkRate => self.mark_rate = value,
            StatKey::HealTaken => self.heal_taken = value,
            StatKey::DamageTaken => self.damage_taken = value,
            StatKey::Cooldown => self.cooldown = value,
            StatKey::ExecuteBand => self.execute_band = value,
            StatKey::SlowResist => self.slow_resist = value,
            StatKey::LifestealMult => self.lifesteal_mult = value,
            StatKey::LifestealDot => self.lifesteal_dot = value,
            StatKey::CritChance => self.crit_chance = value,
            StatKey::HealBarrier => self.heal_barrier = value,
            StatKey::Armor => self.armor = value,
            StatKey::Shield => self.shield = value,
            StatKey::Ad => self.ad = value,
            StatKey::Ap => self.ap = value,
        }
    }

    pub fn source_values(&self) -> [f64; 20] {
        StatKey::source_order().map(|key| self.get(key))
    }

    pub fn from_source_values(values: [f64; 20]) -> Self {
        let mut sums = Self::default();
        for (key, value) in StatKey::source_order().into_iter().zip(values) {
            sums.set(key, value);
        }
        sums
    }
}

impl Default for StatSums {
    fn default() -> Self {
        Self {
            max_hp: 0.0,
            attack_speed: 0.0,
            move_speed: 0.0,
            damage: 0.0,
            windup: 0.0,
            lifesteal: 0.0,
            mark_rate: 0.0,
            heal_taken: 0.0,
            damage_taken: 0.0,
            cooldown: 0.0,
            execute_band: 0.0,
            slow_resist: 0.0,
            lifesteal_mult: 1.0,
            lifesteal_dot: 0.0,
            crit_chance: 0.0,
            heal_barrier: 0.0,
            armor: 0.0,
            shield: 0.0,
            ad: 0.0,
            ap: 0.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum MultKey {
    AsPost,
    Hit,
    Dot,
    Returned,
    Ap,
    WishCooldown,
    HpRace,
    Linger,
}

impl MultKey {
    pub fn source_order() -> [Self; 8] {
        [
            Self::AsPost,
            Self::Hit,
            Self::Dot,
            Self::Returned,
            Self::Ap,
            Self::WishCooldown,
            Self::HpRace,
            Self::Linger,
        ]
    }

    pub const fn index(self) -> usize {
        match self {
            Self::AsPost => 0,
            Self::Hit => 1,
            Self::Dot => 2,
            Self::Returned => 3,
            Self::Ap => 4,
            Self::WishCooldown => 5,
            Self::HpRace => 6,
            Self::Linger => 7,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MultSums {
    pub as_post: f64,
    pub hit: f64,
    pub dot: f64,
    pub returned: f64,
    pub ap: f64,
    pub wish_cooldown: f64,
    pub hp_race: f64,
    pub linger: f64,
}

impl MultSums {
    pub fn get(&self, key: MultKey) -> f64 {
        match key {
            MultKey::AsPost => self.as_post,
            MultKey::Hit => self.hit,
            MultKey::Dot => self.dot,
            MultKey::Returned => self.returned,
            MultKey::Ap => self.ap,
            MultKey::WishCooldown => self.wish_cooldown,
            MultKey::HpRace => self.hp_race,
            MultKey::Linger => self.linger,
        }
    }

    pub fn set(&mut self, key: MultKey, value: f64) {
        match key {
            MultKey::AsPost => self.as_post = value,
            MultKey::Hit => self.hit = value,
            MultKey::Dot => self.dot = value,
            MultKey::Returned => self.returned = value,
            MultKey::Ap => self.ap = value,
            MultKey::WishCooldown => self.wish_cooldown = value,
            MultKey::HpRace => self.hp_race = value,
            MultKey::Linger => self.linger = value,
        }
    }

    pub fn source_values(&self) -> [f64; 8] {
        MultKey::source_order().map(|key| self.get(key))
    }

    pub fn from_source_values(values: [f64; 8]) -> Self {
        let mut sums = Self::default();
        for (key, value) in MultKey::source_order().into_iter().zip(values) {
            sums.set(key, value);
        }
        sums
    }
}

impl Default for MultSums {
    fn default() -> Self {
        Self {
            as_post: 1.0,
            hit: 1.0,
            dot: 1.0,
            returned: 1.0,
            ap: 1.0,
            wish_cooldown: 1.0,
            hp_race: 1.0,
            linger: 1.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum EffectFlag {
    LockSecondSlot,
    NoCrit,
    DotCrit,
    PlagueDotCritConversion,
    Gambler,
    ThirdCharm,
    EyeForAnEye,
    TwiceUnarmed,
    BlockHits,
    PlantFeet,
    Festering,
    HeavierSentence,
    SwiftJudgment,
    GallowsPatience,
    NoCommutation,
    FinalVerdict,
}

impl EffectFlag {
    pub fn source_order() -> [Self; 16] {
        [
            Self::LockSecondSlot,
            Self::NoCrit,
            Self::DotCrit,
            Self::PlagueDotCritConversion,
            Self::Gambler,
            Self::ThirdCharm,
            Self::EyeForAnEye,
            Self::TwiceUnarmed,
            Self::BlockHits,
            Self::PlantFeet,
            Self::Festering,
            Self::HeavierSentence,
            Self::SwiftJudgment,
            Self::GallowsPatience,
            Self::NoCommutation,
            Self::FinalVerdict,
        ]
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FlagSet {
    entries: [EffectFlag; 16],
    len: usize,
}

impl FlagSet {
    pub fn insert(&mut self, flag: EffectFlag) {
        if !self.contains(flag) {
            self.entries[self.len] = flag;
            self.len += 1;
        }
    }

    pub fn contains(&self, flag: EffectFlag) -> bool {
        self.as_slice().contains(&flag)
    }

    pub fn as_slice(&self) -> &[EffectFlag] {
        &self.entries[..self.len]
    }

    pub fn iter(&self) -> impl Iterator<Item = EffectFlag> + '_ {
        self.as_slice().iter().copied()
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}

impl Default for FlagSet {
    fn default() -> Self {
        Self {
            entries: [EffectFlag::LockSecondSlot; 16],
            len: 0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ConvertFrom {
    Ad,
    MaxHp,
    BonusAttackSpeed,
    BonusMoveSpeed,
}

impl ConvertFrom {
    pub fn source_order() -> [Self; 4] {
        [
            Self::Ad,
            Self::MaxHp,
            Self::BonusAttackSpeed,
            Self::BonusMoveSpeed,
        ]
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ConvertTo {
    AttackSpeed,
    MoveSpeed,
    Damage,
    Windup,
    Lifesteal,
    MarkRate,
    HealTaken,
    DamageTaken,
    Cooldown,
    ExecuteBand,
    SlowResist,
    LifestealMult,
    LifestealDot,
    CritChance,
    HealBarrier,
    Armor,
    Shield,
    Ad,
    Ap,
}

impl ConvertTo {
    pub fn source_order() -> [Self; 19] {
        [
            Self::AttackSpeed,
            Self::MoveSpeed,
            Self::Damage,
            Self::Windup,
            Self::Lifesteal,
            Self::MarkRate,
            Self::HealTaken,
            Self::DamageTaken,
            Self::Cooldown,
            Self::ExecuteBand,
            Self::SlowResist,
            Self::LifestealMult,
            Self::LifestealDot,
            Self::CritChance,
            Self::HealBarrier,
            Self::Armor,
            Self::Shield,
            Self::Ad,
            Self::Ap,
        ]
    }

    pub const fn stat_key(self) -> StatKey {
        match self {
            Self::AttackSpeed => StatKey::AttackSpeed,
            Self::MoveSpeed => StatKey::MoveSpeed,
            Self::Damage => StatKey::Damage,
            Self::Windup => StatKey::Windup,
            Self::Lifesteal => StatKey::Lifesteal,
            Self::MarkRate => StatKey::MarkRate,
            Self::HealTaken => StatKey::HealTaken,
            Self::DamageTaken => StatKey::DamageTaken,
            Self::Cooldown => StatKey::Cooldown,
            Self::ExecuteBand => StatKey::ExecuteBand,
            Self::SlowResist => StatKey::SlowResist,
            Self::LifestealMult => StatKey::LifestealMult,
            Self::LifestealDot => StatKey::LifestealDot,
            Self::CritChance => StatKey::CritChance,
            Self::HealBarrier => StatKey::HealBarrier,
            Self::Armor => StatKey::Armor,
            Self::Shield => StatKey::Shield,
            Self::Ad => StatKey::Ad,
            Self::Ap => StatKey::Ap,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ChestBoostStat {
    Ad,
    Ap,
    Armor,
    Shield,
    MaxHp,
    AttackSpeed,
    MoveSpeed,
    Lifesteal,
}

impl ChestBoostStat {
    pub fn source_order() -> [Self; 8] {
        [
            Self::Ad,
            Self::Ap,
            Self::Armor,
            Self::Shield,
            Self::MaxHp,
            Self::AttackSpeed,
            Self::MoveSpeed,
            Self::Lifesteal,
        ]
    }

    pub const fn index(self) -> usize {
        match self {
            Self::Ad => 0,
            Self::Ap => 1,
            Self::Armor => 2,
            Self::Shield => 3,
            Self::MaxHp => 4,
            Self::AttackSpeed => 5,
            Self::MoveSpeed => 6,
            Self::Lifesteal => 7,
        }
    }
}

impl From<ChestBoostStat> for StatKey {
    fn from(stat: ChestBoostStat) -> Self {
        match stat {
            ChestBoostStat::Ad => Self::Ad,
            ChestBoostStat::Ap => Self::Ap,
            ChestBoostStat::Armor => Self::Armor,
            ChestBoostStat::Shield => Self::Shield,
            ChestBoostStat::MaxHp => Self::MaxHp,
            ChestBoostStat::AttackSpeed => Self::AttackSpeed,
            ChestBoostStat::MoveSpeed => Self::MoveSpeed,
            ChestBoostStat::Lifesteal => Self::Lifesteal,
        }
    }
}
