//! Non-seat regional actors, retained birth provenance, and explicit staged runtime modes.
use crate::{
    fighter::{Body, FighterCore, Motion, Vitals},
    input::InputQueue,
    mob_catalog::MobTypeId,
    state::{History, PlayerId, Sample, Status, WeaponRt},
    store::Keyed,
    FactionId, Vec2,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MobMode {
    #[default]
    Off,
    SpawnFoundation,
    Pve,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub enum ActorOrigin {
    Player {
        join_ordinal: u32,
    },
    Mob {
        birth_serial: u32,
        born_tick: u32,
        camp: u32,
        spot: u32,
        mob_type: MobTypeId,
        elite: bool,
    },
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActorProvenance {
    pub id: PlayerId,
    pub origin: ActorOrigin,
}
impl Keyed for ActorProvenance {
    fn key(&self) -> PlayerId {
        self.id
    }
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CampRoster {
    pub mob_type: MobTypeId,
    pub elite: Option<MobTypeId>,
    pub alive: u32,
    pub state: u8,
    pub cleared_at: f64,
    pub respawn_at: f64,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Mob {
    pub core: FighterCore,
    pub(crate) brain: Brain,
    pub(crate) last_hit_at: f64,
    pub mob_type: MobTypeId,
    pub elite: bool,
    pub camp: u32,
    pub status: Status,
    pub home: Vec2,
    pub home_facing: f64,
    pub repath_phase: u32,
}
impl Keyed for Mob {
    fn key(&self) -> PlayerId {
        self.core.id
    }
}
impl Mob {
    pub(crate) fn born(provenance: &ActorProvenance, at: Vec2, facing: f64, now: f64) -> Self {
        let ActorOrigin::Mob {
            birth_serial: serial,
            camp,
            mob_type,
            elite,
            ..
        } = provenance.origin
        else {
            unreachable!("only a typed mob birth constructs Mob")
        };
        let id = provenance.id;
        let ty = crate::mob_catalog::mob_type_by_id(mob_type.as_str()).expect("typed catalog row");
        let hp = spawn_hp(ty.zone, elite, mob_type);
        let mut history = History::default();
        history.reset(Sample {
            t: now,
            x: at.x,
            y: at.y,
        });
        Self {
            brain: Brain::default(),
            last_hit_at: 0.,
            core: FighterCore {
                id,
                body: Body {
                    x: at.x,
                    y: at.y,
                    facing,
                    history,
                },
                vitals: Vitals {
                    faction: ty.zone,
                    hp,
                    max_hp: hp,
                    barrier: 0.,
                    immune_until: 0.,
                    hp_frac_at_tick_start: 1.,
                },
                weapon: WeaponRt {
                    weapon0: Some(ty.weapon),
                    ..WeaponRt::default()
                },
                signature: Default::default(),
                statuses: Default::default(),
                modifiers: crate::modifiers::Runtime::default(),
                card_dot_crit: None,
                motion: Motion::default(),
                inputs: InputQueue::default(),
            },
            mob_type,
            elite,
            camp,
            status: Status::Alive,
            home: at,
            home_facing: facing,
            repath_phase: ((u64::from(serial) * u64::from(crate::constants::MOB_REPATH_PHASE_MULT))
                % u64::from(crate::constants::MOB_REPATH_PHASE_PERIOD))
                as u32,
        }
    }
}
/// Source mobTypeFaction HP only. Full faction sheets remain the combat stage's responsibility.
pub fn spawn_hp(region: FactionId, elite: bool, ty: MobTypeId) -> f64 {
    let scale = if elite {
        crate::constants::ELITE_K
    } else {
        crate::constants::MOB_K
    };
    let hp_mult = crate::constants::MOB_HP_MULT
        * if elite {
            crate::constants::ELITE_HP_MULT
        } else {
            1.
        };
    let role = crate::mob_catalog::mob_type_in(region, Some(ty.as_str()))
        .map_or(1., |t| t.role_def().hp_mult);
    (crate::content::faction(region).hp * scale) * hp_mult * role
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct MobRuntime {
    pub(crate) combat: bool,
    pub(crate) camps: Vec<CampRoster>,
    pub(crate) life: Vec<CampLife>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) enum BrainMode {
    #[default]
    Idle,
    Fight,
    Return,
}
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Brain {
    pub mode: BrainMode,
    pub target: Option<PlayerId>,
    pub threat: Vec<(PlayerId, f64)>,
    pub last_combat_at: f64,
    pub last_move_at: f64,
    pub goal: Option<Vec2>,
    pub moving: bool,
    pub holding: bool,
    pub died_at: f64,
    pub last_aim: Option<f64>,
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CampLife {
    pub contributors: Vec<PlayerId>,
    pub ward_owner: Option<PlayerId>,
    pub ward_expires_at: f64,
}
