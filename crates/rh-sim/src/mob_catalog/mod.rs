//! Pure source-derived catalog and draw-injected rosters. No runtime actor, faction sheet or RNG port.
use crate::content::{self, FactionId, Shape, WeaponId};
pub mod rosters;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MobTypeId {
    EmberImp,
    CinderHound,
    MagmaBrute,
    FlameCaller,
    Wyrmling,
    AshDrake,
    Bailiff,
    ChainWarden,
    Inquisitor,
    Pardoner,
    Executioner,
    Gaoler,
    PlagueRat,
    Bloatfly,
    RotMonk,
    MiasmaWitch,
    RatOgre,
    PoxBehemoth,
    FrostWisp,
    IceGolem,
    RimeStalker,
    FrostbowSentry,
    GlacialWarden,
    AvalancheTroll,
    Acolyte,
    SeraphShard,
    Penitent,
    Zealot,
    BloodSaint,
    Archon,
}
impl MobTypeId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::EmberImp => "emberImp",
            Self::CinderHound => "cinderHound",
            Self::MagmaBrute => "magmaBrute",
            Self::FlameCaller => "flameCaller",
            Self::Wyrmling => "wyrmling",
            Self::AshDrake => "ashDrake",
            Self::Bailiff => "bailiff",
            Self::ChainWarden => "chainWarden",
            Self::Inquisitor => "inquisitor",
            Self::Pardoner => "pardoner",
            Self::Executioner => "executioner",
            Self::Gaoler => "gaoler",
            Self::PlagueRat => "plagueRat",
            Self::Bloatfly => "bloatfly",
            Self::RotMonk => "rotMonk",
            Self::MiasmaWitch => "miasmaWitch",
            Self::RatOgre => "ratOgre",
            Self::PoxBehemoth => "poxBehemoth",
            Self::FrostWisp => "frostWisp",
            Self::IceGolem => "iceGolem",
            Self::RimeStalker => "rimeStalker",
            Self::FrostbowSentry => "frostbowSentry",
            Self::GlacialWarden => "glacialWarden",
            Self::AvalancheTroll => "avalancheTroll",
            Self::Acolyte => "acolyte",
            Self::SeraphShard => "seraphShard",
            Self::Penitent => "penitent",
            Self::Zealot => "zealot",
            Self::BloodSaint => "bloodSaint",
            Self::Archon => "archon",
        }
    }
    pub fn parse(id: &str) -> Option<Self> {
        mob_type_by_id(id).map(|t| t.id)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MobRole {
    Grunt,
    Swarm,
    Brute,
    Skirmisher,
    Caster,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MobTag {
    Fast,
    Fragile,
    Tanky,
    Chases,
    Ranged,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MobRoleDef {
    pub id: MobRole,
    pub label: &'static str,
    pub hp_mult: f64,
    pub dmg_mult: f64,
    pub move_mult: f64,
    pub tags: &'static [MobTag],
    pub blurb: &'static str,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MobTypeDef {
    pub id: MobTypeId,
    pub zone: FactionId,
    pub elite: bool,
    pub name: &'static str,
    pub role: MobRole,
    pub weapon: WeaponId,
}
impl MobTypeDef {
    pub fn role_def(&self) -> &'static MobRoleDef {
        role_def(self.role)
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RegionDef {
    pub zone: FactionId,
    pub names: [&'static str; 2],
    pub weapon: WeaponId,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rules {
    pub bag_copies: usize,
    pub melee_damage: f64,
    pub ranged_damage: f64,
    pub elite_damage: f64,
}
/// The single definition visited by content integration; no duplicate identity-only table.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Definition {
    pub roles: [MobRoleDef; 5],
    pub types: [MobTypeDef; 30],
    pub regions: [RegionDef; 5],
    pub rules: Rules,
}
pub static DEFINITION: Definition = Definition {
    roles: [
        MobRoleDef {
            id: MobRole::Grunt,
            label: "Grunt",
            hp_mult: 1.0,
            dmg_mult: 1.0,
            move_mult: 1.0,
            tags: &[],
            blurb: "Plain fighter.",
        },
        MobRoleDef {
            id: MobRole::Swarm,
            label: "Swarm",
            hp_mult: 0.7,
            dmg_mult: 0.9,
            move_mult: 1.1,
            tags: &[MobTag::Fast, MobTag::Fragile],
            blurb: "Fast and fragile.",
        },
        MobRoleDef {
            id: MobRole::Brute,
            label: "Brute",
            hp_mult: 1.4,
            dmg_mult: 0.8,
            move_mult: 0.9,
            tags: &[MobTag::Tanky],
            blurb: "Slow and tough.",
        },
        MobRoleDef {
            id: MobRole::Skirmisher,
            label: "Skirmisher",
            hp_mult: 0.85,
            dmg_mult: 1.1,
            move_mult: 1.15,
            tags: &[MobTag::Chases],
            blurb: "Runs you down.",
        },
        MobRoleDef {
            id: MobRole::Caster,
            label: "Caster",
            hp_mult: 0.75,
            dmg_mult: 1.2,
            move_mult: 1.0,
            tags: &[MobTag::Ranged],
            blurb: "Shoots from range.",
        },
    ],
    types: [
        MobTypeDef {
            id: MobTypeId::EmberImp,
            zone: FactionId::Fire,
            elite: false,
            name: "Ember Imp",
            role: MobRole::Swarm,
            weapon: WeaponId::Axe,
        },
        MobTypeDef {
            id: MobTypeId::CinderHound,
            zone: FactionId::Fire,
            elite: false,
            name: "Cinder Hound",
            role: MobRole::Skirmisher,
            weapon: WeaponId::Axe,
        },
        MobTypeDef {
            id: MobTypeId::MagmaBrute,
            zone: FactionId::Fire,
            elite: false,
            name: "Magma Brute",
            role: MobRole::Brute,
            weapon: WeaponId::Axe,
        },
        MobTypeDef {
            id: MobTypeId::FlameCaller,
            zone: FactionId::Fire,
            elite: false,
            name: "Flame Caller",
            role: MobRole::Caster,
            weapon: WeaponId::Wand,
        },
        MobTypeDef {
            id: MobTypeId::Wyrmling,
            zone: FactionId::Fire,
            elite: true,
            name: "Wyrmling",
            role: MobRole::Grunt,
            weapon: WeaponId::Axe,
        },
        MobTypeDef {
            id: MobTypeId::AshDrake,
            zone: FactionId::Fire,
            elite: true,
            name: "Ash Drake",
            role: MobRole::Caster,
            weapon: WeaponId::Wand,
        },
        MobTypeDef {
            id: MobTypeId::Bailiff,
            zone: FactionId::Sentenced,
            elite: false,
            name: "Bailiff",
            role: MobRole::Grunt,
            weapon: WeaponId::Sword,
        },
        MobTypeDef {
            id: MobTypeId::ChainWarden,
            zone: FactionId::Sentenced,
            elite: false,
            name: "Chain Warden",
            role: MobRole::Brute,
            weapon: WeaponId::Sword,
        },
        MobTypeDef {
            id: MobTypeId::Inquisitor,
            zone: FactionId::Sentenced,
            elite: false,
            name: "Inquisitor",
            role: MobRole::Skirmisher,
            weapon: WeaponId::Sword,
        },
        MobTypeDef {
            id: MobTypeId::Pardoner,
            zone: FactionId::Sentenced,
            elite: false,
            name: "Pardoner",
            role: MobRole::Caster,
            weapon: WeaponId::Bow,
        },
        MobTypeDef {
            id: MobTypeId::Executioner,
            zone: FactionId::Sentenced,
            elite: true,
            name: "Executioner",
            role: MobRole::Grunt,
            weapon: WeaponId::Sword,
        },
        MobTypeDef {
            id: MobTypeId::Gaoler,
            zone: FactionId::Sentenced,
            elite: true,
            name: "Gaoler",
            role: MobRole::Brute,
            weapon: WeaponId::Shield,
        },
        MobTypeDef {
            id: MobTypeId::PlagueRat,
            zone: FactionId::Plague,
            elite: false,
            name: "Plague Rat",
            role: MobRole::Swarm,
            weapon: WeaponId::Bow,
        },
        MobTypeDef {
            id: MobTypeId::Bloatfly,
            zone: FactionId::Plague,
            elite: false,
            name: "Bloatfly",
            role: MobRole::Skirmisher,
            weapon: WeaponId::Bow,
        },
        MobTypeDef {
            id: MobTypeId::RotMonk,
            zone: FactionId::Plague,
            elite: false,
            name: "Rot Monk",
            role: MobRole::Grunt,
            weapon: WeaponId::Bow,
        },
        MobTypeDef {
            id: MobTypeId::MiasmaWitch,
            zone: FactionId::Plague,
            elite: false,
            name: "Miasma Witch",
            role: MobRole::Caster,
            weapon: WeaponId::Wand,
        },
        MobTypeDef {
            id: MobTypeId::RatOgre,
            zone: FactionId::Plague,
            elite: true,
            name: "Rat Ogre",
            role: MobRole::Brute,
            weapon: WeaponId::Bow,
        },
        MobTypeDef {
            id: MobTypeId::PoxBehemoth,
            zone: FactionId::Plague,
            elite: true,
            name: "Pox Behemoth",
            role: MobRole::Brute,
            weapon: WeaponId::Axe,
        },
        MobTypeDef {
            id: MobTypeId::FrostWisp,
            zone: FactionId::Frost,
            elite: false,
            name: "Frost Wisp",
            role: MobRole::Swarm,
            weapon: WeaponId::Shield,
        },
        MobTypeDef {
            id: MobTypeId::IceGolem,
            zone: FactionId::Frost,
            elite: false,
            name: "Ice Golem",
            role: MobRole::Brute,
            weapon: WeaponId::Shield,
        },
        MobTypeDef {
            id: MobTypeId::RimeStalker,
            zone: FactionId::Frost,
            elite: false,
            name: "Rime Stalker",
            role: MobRole::Skirmisher,
            weapon: WeaponId::Shield,
        },
        MobTypeDef {
            id: MobTypeId::FrostbowSentry,
            zone: FactionId::Frost,
            elite: false,
            name: "Frostbow Sentry",
            role: MobRole::Caster,
            weapon: WeaponId::Bow,
        },
        MobTypeDef {
            id: MobTypeId::GlacialWarden,
            zone: FactionId::Frost,
            elite: true,
            name: "Glacial Warden",
            role: MobRole::Grunt,
            weapon: WeaponId::Shield,
        },
        MobTypeDef {
            id: MobTypeId::AvalancheTroll,
            zone: FactionId::Frost,
            elite: true,
            name: "Avalanche Troll",
            role: MobRole::Brute,
            weapon: WeaponId::Axe,
        },
        MobTypeDef {
            id: MobTypeId::Acolyte,
            zone: FactionId::Holy,
            elite: false,
            name: "Acolyte",
            role: MobRole::Grunt,
            weapon: WeaponId::Wand,
        },
        MobTypeDef {
            id: MobTypeId::SeraphShard,
            zone: FactionId::Holy,
            elite: false,
            name: "Seraph Shard",
            role: MobRole::Swarm,
            weapon: WeaponId::Wand,
        },
        MobTypeDef {
            id: MobTypeId::Penitent,
            zone: FactionId::Holy,
            elite: false,
            name: "Penitent",
            role: MobRole::Skirmisher,
            weapon: WeaponId::Wand,
        },
        MobTypeDef {
            id: MobTypeId::Zealot,
            zone: FactionId::Holy,
            elite: false,
            name: "Zealot",
            role: MobRole::Brute,
            weapon: WeaponId::Sword,
        },
        MobTypeDef {
            id: MobTypeId::BloodSaint,
            zone: FactionId::Holy,
            elite: true,
            name: "Blood Saint",
            role: MobRole::Grunt,
            weapon: WeaponId::Wand,
        },
        MobTypeDef {
            id: MobTypeId::Archon,
            zone: FactionId::Holy,
            elite: true,
            name: "Archon",
            role: MobRole::Skirmisher,
            weapon: WeaponId::Sword,
        },
    ],
    regions: [
        RegionDef {
            zone: FactionId::Fire,
            names: ["Cinderling", "Ember Warlord"],
            weapon: WeaponId::Axe,
        },
        RegionDef {
            zone: FactionId::Sentenced,
            names: ["Convict", "Warden"],
            weapon: WeaponId::Sword,
        },
        RegionDef {
            zone: FactionId::Plague,
            names: ["Plaguerat", "Rat King"],
            weapon: WeaponId::Bow,
        },
        RegionDef {
            zone: FactionId::Frost,
            names: ["Rimeguard", "Ice Colossus"],
            weapon: WeaponId::Shield,
        },
        RegionDef {
            zone: FactionId::Holy,
            names: ["Blood Imp", "Demon Herald"],
            weapon: WeaponId::Wand,
        },
    ],
    rules: Rules {
        bag_copies: 3,
        melee_damage: 1.6,
        ranged_damage: 1.2,
        elite_damage: 1.0,
    },
};
/// Typed access to the actual runtime definition. Coordinator folds every field into content identity.
#[derive(Clone, Copy, Debug)]
pub enum Metadata<'a> {
    Role(&'a MobRoleDef),
    Type(&'a MobTypeDef),
    Region(&'a RegionDef),
    Rules(&'a Rules),
}
pub fn visit_definition<'a>(definition: &'a Definition, mut visit: impl FnMut(Metadata<'a>)) {
    for role in &definition.roles {
        visit(Metadata::Role(role));
    }
    for ty in &definition.types {
        visit(Metadata::Type(ty));
    }
    for region in &definition.regions {
        visit(Metadata::Region(region));
    }
    visit(Metadata::Rules(&definition.rules));
}
pub fn role_def(role: MobRole) -> &'static MobRoleDef {
    DEFINITION
        .roles
        .iter()
        .find(|r| r.id == role)
        .expect("all typed roles defined")
}
pub fn mob_types_of(zone: FactionId) -> impl Iterator<Item = &'static MobTypeDef> {
    DEFINITION.types.iter().filter(move |t| t.zone == zone)
}
pub fn normal_types_of(zone: FactionId) -> impl Iterator<Item = &'static MobTypeDef> {
    mob_types_of(zone).filter(|t| !t.elite)
}
pub fn elites_of(zone: FactionId) -> impl Iterator<Item = &'static MobTypeDef> {
    mob_types_of(zone).filter(|t| t.elite)
}
pub fn mob_type_by_id(id: &str) -> Option<&'static MobTypeDef> {
    DEFINITION.types.iter().find(|t| t.id.as_str() == id)
}
pub fn mob_type_in(region: FactionId, id: Option<&str>) -> Option<&'static MobTypeDef> {
    id.and_then(mob_type_by_id).filter(|t| t.zone == region)
}
fn region_def(region: FactionId) -> &'static RegionDef {
    DEFINITION
        .regions
        .iter()
        .find(|r| r.zone == region)
        .expect("all typed regions defined")
}
pub fn mob_name(region: FactionId, elite: bool) -> &'static str {
    region_def(region).names[usize::from(elite)]
}
pub fn mob_weapon(region: FactionId) -> WeaponId {
    region_def(region).weapon
}
pub fn mob_type_weapon(region: FactionId, id: Option<&str>) -> WeaponId {
    mob_type_in(region, id).map_or_else(|| mob_weapon(region), |t| t.weapon)
}
pub fn mob_reach_damage(ty: &MobTypeDef) -> f64 {
    if ty.elite {
        DEFINITION.rules.elite_damage
    } else if matches!(content::weapon(ty.weapon).shape, Shape::Projectile { .. }) {
        DEFINITION.rules.ranged_damage
    } else {
        DEFINITION.rules.melee_damage
    }
}
pub fn is_regional_kind(kind: &str) -> bool {
    matches!(kind, "mob" | "elite")
}

impl MobRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Grunt => "grunt",
            Self::Swarm => "swarm",
            Self::Brute => "brute",
            Self::Skirmisher => "skirmisher",
            Self::Caster => "caster",
        }
    }
}
impl MobTag {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Fast => "fast",
            Self::Fragile => "fragile",
            Self::Tanky => "tanky",
            Self::Chases => "chases",
            Self::Ranged => "ranged",
        }
    }
}
