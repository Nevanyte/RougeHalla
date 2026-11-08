//! The legacy bots' farming plan, pure part (packages/server/src/bots/brain/buildRoute.ts): the two builds per faction
//! and their stat weights, the elite readiness rule and a camp's value to a build. The stateful BuildRoute planner
//! (route, contests, zone memory, replanning) is the P-BOTS-4 remainder: it needs the brain's camp/player frames.
//!
//! The stat-reward mapping is read from rh-sim's public source catalog (modifiers/farm.rs DEFINITION, the actual
//! MOB_STAT_REWARDS rows) and the rest is static: no clock, I/O or entropy.
use rh_sim::content::FactionId;
use rh_sim::mob_catalog::MobTypeId;
use rh_sim::modifiers::farm::{RewardStat, DEFINITION};
use rh_sim::stat_fold::{EffectStat, FlatStat};

/// The stats a normal-mob kill can give (shared/mobStats.ts REWARDS).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FarmStat {
    Ad,
    Ap,
    Armor,
    Shield,
    MaxHp,
    AttackSpeed,
    MoveSpeed,
    Lifesteal,
    Damage,
}

impl FarmStat {
    /// The shared stat key string, as the source build weights spell it.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ad => "ad",
            Self::Ap => "ap",
            Self::Armor => "armor",
            Self::Shield => "shield",
            Self::MaxHp => "maxHp",
            Self::AttackSpeed => "attackSpeed",
            Self::MoveSpeed => "moveSpeed",
            Self::Lifesteal => "lifesteal",
            Self::Damage => "damage",
        }
    }

    pub const ALL: [FarmStat; 9] = [
        Self::Ad,
        Self::Ap,
        Self::Armor,
        Self::Shield,
        Self::MaxHp,
        Self::AttackSpeed,
        Self::MoveSpeed,
        Self::Lifesteal,
        Self::Damage,
    ];
}

/// One build: its identity and what each stat is worth to it (buildRoute.ts BuildGoal).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BuildGoal {
    pub id: &'static str,
    pub name: &'static str,
    /// Only the stats the build asks for; STAT_FLOOR..1 each, every absent stat is worth nothing (the caller floors).
    pub weights: &'static [(FarmStat, f64)],
}

impl BuildGoal {
    /// The build's weight for one stat, 0 when it does not ask for it.
    pub fn weight(&self, stat: FarmStat) -> f64 {
        self.weights
            .iter()
            .find_map(|(key, value)| (*key == stat).then_some(*value))
            .unwrap_or(0.)
    }
}

/// The faction rework's two builds per faction, as stat weights (buildRoute.ts BUILD_GOALS, unchanged), indexed in
/// FactionId::ALL order (fire, sentenced, plague, frost, holy).
pub const BUILD_GOALS: [[BuildGoal; 2]; 5] = [
    [
        BuildGoal {
            id: "fire:A",
            name: "AD burst assassin",
            weights: &[
                (FarmStat::Damage, 1.),
                (FarmStat::MaxHp, 0.95),
                (FarmStat::Armor, 0.76),
                (FarmStat::Ad, 0.75),
                (FarmStat::Shield, 0.53),
                (FarmStat::Lifesteal, 0.46),
            ],
        },
        BuildGoal {
            id: "fire:B",
            name: "AP burn tank",
            weights: &[
                (FarmStat::Armor, 1.),
                (FarmStat::Damage, 1.),
                (FarmStat::MaxHp, 0.94),
                (FarmStat::Ap, 0.75),
                (FarmStat::Shield, 0.73),
                (FarmStat::Lifesteal, 0.55),
            ],
        },
    ],
    [
        BuildGoal {
            id: "sentenced:A",
            name: "stat bully bruiser",
            weights: &[
                (FarmStat::AttackSpeed, 1.),
                (FarmStat::Armor, 0.75),
                (FarmStat::Shield, 0.75),
                (FarmStat::Ad, 0.75),
                (FarmStat::Damage, 0.74),
                (FarmStat::MaxHp, 0.72),
                (FarmStat::Ap, 0.51),
            ],
        },
        BuildGoal {
            id: "sentenced:B",
            name: "attack-speed max-HP punisher",
            weights: &[
                (FarmStat::AttackSpeed, 1.),
                (FarmStat::Damage, 0.78),
                (FarmStat::MaxHp, 0.73),
                (FarmStat::Ad, 0.51),
                (FarmStat::Armor, 0.42),
            ],
        },
    ],
    [
        BuildGoal {
            id: "plague:A",
            name: "attack-speed SO DoT stacker",
            weights: &[
                (FarmStat::Ap, 1.),
                (FarmStat::AttackSpeed, 0.75),
                (FarmStat::Damage, 0.49),
                (FarmStat::MaxHp, 0.46),
            ],
        },
        BuildGoal {
            id: "plague:B",
            name: "zombie commander",
            weights: &[
                (FarmStat::Ap, 1.),
                (FarmStat::MaxHp, 0.75),
                (FarmStat::Damage, 0.52),
            ],
        },
    ],
    [
        BuildGoal {
            id: "frost:A",
            name: "Defense/SD shield tank",
            weights: &[
                (FarmStat::AttackSpeed, 1.),
                (FarmStat::Shield, 0.81),
                (FarmStat::Armor, 0.75),
                (FarmStat::MaxHp, 0.58),
                (FarmStat::Damage, 0.56),
            ],
        },
        BuildGoal {
            id: "frost:B",
            name: "bow kiter",
            weights: &[
                (FarmStat::AttackSpeed, 1.),
                (FarmStat::Ad, 0.8),
                (FarmStat::Damage, 0.8),
                (FarmStat::MaxHp, 0.6),
                (FarmStat::Shield, 0.4),
            ],
        },
    ],
    [
        BuildGoal {
            id: "holy:A",
            name: "lifesteal juggernaut",
            weights: &[
                (FarmStat::AttackSpeed, 1.),
                (FarmStat::Lifesteal, 0.75),
                (FarmStat::Damage, 0.64),
                (FarmStat::Ad, 0.57),
                (FarmStat::MaxHp, 0.31),
            ],
        },
        BuildGoal {
            id: "holy:B",
            name: "Soul-damage Holy",
            weights: &[
                (FarmStat::AttackSpeed, 1.),
                (FarmStat::Ap, 0.75),
                (FarmStat::Damage, 0.75),
                (FarmStat::Armor, 0.31),
            ],
        },
    ],
];

/// What any stat is worth to a build that does not ask for it: a stack is never worthless (buildRoute.ts STAT_FLOOR).
pub const STAT_FLOOR: f64 = 0.25;
/// Camps planned ahead (buildRoute.ts ROUTE_STEPS).
pub const ROUTE_STEPS: u32 = 4;
/// Waiting at a camp for its respawn is planned only when the respawn is this close.
pub const MAX_WAIT_MS: f64 = 40_000.;
/// The time a camp takes to clear, per normal mob and for an elite.
pub const CLEAR_MS_PER_MOB: f64 = 4_000.;
pub const CLEAR_MS_ELITE: f64 = 15_000.;
/// An elite camp's elite, in normal mobs' worth of value (its augment chest).
pub const ELITE_VALUE: f64 = 6.;
pub const ELITE_AFTER_MS: f64 = 360_000.;
pub const ELITE_MIN_KILLS: f64 = 12.;
/// Card power that lets a bot take elites early.
pub const ELITE_EARLY_POWER: f64 = 6.;
pub const CONTEST_MS: f64 = 30_000.;
/// A zone contested this many times within ZONE_MEMORY_MS is left out for ZONE_AVOID_MS.
pub const ZONE_CONTESTS: u32 = 2;
pub const ZONE_MEMORY_MS: f64 = 90_000.;
pub const ZONE_AVOID_MS: f64 = 60_000.;
/// An enemy player this close to a camp contests it.
pub const CONTEST_PLAYER_RANGE: f64 = 320.;
/// Mobs dying at a camp the bot is farther than this beyond the clearing of are somebody else's kills.
pub const OWN_FIGHT_SLACK: f64 = 200.;
/// A straight line is this much shorter than a walk.
pub const WALK_FACTOR: f64 = 1.3;
pub const REPLAN_MS: f64 = 8_000.;

/// The build the bot goes for; the draw is the bot's own seeded 0..1 value (buildRoute.ts buildOf).
pub fn build_of(faction: FactionId, draw: f64) -> &'static BuildGoal {
    &BUILD_GOALS[faction as usize][if draw < 0.5 { 0 } else { 1 }]
}

/// The stat reward one normal kill of this type grants (shared/mobStats.ts mobStatReward), or None for elites, unknown
/// types and empty input. Read from rh-sim's public source catalog: no content is duplicated here.
pub fn reward_stat(mob_type: Option<&str>) -> Option<FarmStat> {
    let mob = MobTypeId::parse(mob_type?)?;
    let reward = DEFINITION.rows.iter().find(|row| row.mob == mob)?;
    Some(match reward.stat {
        RewardStat::Stat(stat) => match stat {
            EffectStat::Damage => FarmStat::Damage,
            EffectStat::MaxHp => FarmStat::MaxHp,
            EffectStat::AttackSpeed => FarmStat::AttackSpeed,
            EffectStat::MoveSpeed => FarmStat::MoveSpeed,
            EffectStat::Lifesteal => FarmStat::Lifesteal,
            _ => return None,
        },
        RewardStat::Flat(stat) => match stat {
            FlatStat::Ad => FarmStat::Ad,
            FlatStat::Ap => FarmStat::Ap,
            FlatStat::Armor => FarmStat::Armor,
            FlatStat::Shield => FarmStat::Shield,
        },
    })
}

/// How much a kill of this normal type is worth to the build (STAT_FLOOR..1); an unknown type is worth the floor
/// (buildRoute.ts typeWeight).
pub fn type_weight(build: &BuildGoal, mob_type: Option<&str>) -> f64 {
    reward_stat(mob_type).map_or(STAT_FLOOR, |stat| build.weight(stat).max(STAT_FLOOR))
}

/// Elites come later: run time and mob kills, or card power early (buildRoute.ts readyForElites).
pub fn ready_for_elites(run_ms: f64, mob_kills: f64, power: f64) -> bool {
    (run_ms >= ELITE_AFTER_MS && mob_kills >= ELITE_MIN_KILLS) || power >= ELITE_EARLY_POWER
}

/// One camp as the plan reads it: the map's definition and its public state (buildRoute.ts RouteCamp).
#[derive(Clone, Debug, PartialEq)]
pub struct RouteCamp {
    pub index: u32,
    pub id: String,
    pub zone: FactionId,
    pub x: f64,
    pub y: f64,
    pub r: f64,
    pub elite: bool,
    pub spots: u32,
    /// MobTypeId, or empty when unknown.
    pub mob_type: String,
    pub alive: u32,
    /// 0 idle, 1 engaged, 2 cleared.
    pub state: u8,
    pub respawn_at: f64,
}

/// The value of one camp to this build, now; 0 when it is no use to it (buildRoute.ts BuildRoute.campValue).
pub fn camp_value(build: &BuildGoal, camp: &RouteCamp, elites: bool) -> f64 {
    if camp.elite && !elites {
        return 0.;
    }
    let mobs = if camp.state == 2 {
        f64::from(camp.spots)
    } else {
        0f64.max(f64::from(camp.alive))
    };
    let normals = if camp.elite {
        0f64.max(mobs - 1.)
    } else {
        mobs
    };
    let mob_type = (!camp.mob_type.is_empty()).then_some(camp.mob_type.as_str());
    let mut value = normals * type_weight(build, mob_type);
    if camp.elite && mobs > 0. {
        value += ELITE_VALUE;
    }
    value
}
