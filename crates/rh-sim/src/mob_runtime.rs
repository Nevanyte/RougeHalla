//! Non-seat regional actors, retained birth provenance, and explicit staged runtime modes.
use crate::{
    fighter::{Body, FighterCore, Motion, Vitals},
    input::InputQueue,
    mob_catalog::MobTypeId,
    state::{History, PlayerId, Sample, Status, WeaponRt},
    store::Keyed,
    FactionId, Vec2, WeaponId,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MobMode {
    #[default]
    Off,
    SpawnFoundation,
    Pve,
}

/// What a non-seat actor is. The source's `MobState.kind` string: a regional (map camp) mob, a practice console mob
/// (`sim/training.ts`, camp refs 101..255 with no map camp) or a training dummy (`sim/mobs.ts`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MobKind {
    #[default]
    Regional,
    Practice,
    Dummy,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub enum ActorOrigin {
    Player {
        join_ordinal: u32,
    },
    /// A regional mob born from the map's camp roster (the only kind P-MOBS-1 knows).
    Mob {
        birth_serial: u32,
        born_tick: u32,
        camp: u32,
        spot: u32,
        mob_type: MobTypeId,
        elite: bool,
    },
    /// A practice console mob (`sim/training.ts`): a real regional fighter whose camp ref is beyond the map's camps
    /// (101..255) and whose tile need not be a map camp spot.
    Practice {
        birth_serial: u32,
        born_tick: u32,
        camp: u32,
        mob_type: MobTypeId,
        elite: bool,
    },
    /// A training dummy (`sim/mobs.ts`): no faction, no camp, no catalog type, never dies.
    Dummy {
        birth_serial: u32,
        born_tick: u32,
        /// The source's shield dummy carries a shield it blocks and reflects with (`spawnTraining`).
        shield: bool,
    },
    /// A Plague-owned companion (legacy MobState kind "zombie").
    Zombie {
        owner: PlayerId,
    },
}
impl ActorOrigin {
    /// The retained birth serial of any non-seat actor.
    pub(crate) fn birth_serial(&self) -> Option<u32> {
        match *self {
            Self::Player { .. } | Self::Zombie { .. } => None,
            Self::Mob { birth_serial, .. }
            | Self::Practice { birth_serial, .. }
            | Self::Dummy { birth_serial, .. } => Some(birth_serial),
        }
    }
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
    pub kind: MobKind,
    /// The regional catalog type. Training dummies and Plague companions have none.
    pub mob_type: Option<MobTypeId>,
    pub elite: bool,
    pub camp: u32,
    pub status: Status,
    pub home: Vec2,
    pub home_facing: f64,
    pub repath_phase: u32,
    /// Present only for a Plague-owned companion; regional mobs are None.
    #[serde(default)]
    pub owner: Option<PlayerId>,
    #[serde(default)]
    pub zombie: Option<ZombieRt>,
    #[serde(default)]
    pub display_name: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ZombieRt {
    pub target: Option<PlayerId>,
    pub assist_until: f64,
    pub last_move_at: f64,
    pub owner_displace_seq: u8,
}
impl Keyed for Mob {
    fn key(&self) -> PlayerId {
        self.core.id
    }
}
impl Mob {
    /// A Plague-owned companion, with no regional catalog type.
    pub(crate) fn zombie(
        provenance: &ActorProvenance,
        owner: PlayerId,
        at: Vec2,
        name: String,
        max_hp: f64,
        now: f64,
        owner_displace_seq: u8,
    ) -> Self {
        debug_assert!(matches!(provenance.origin, ActorOrigin::Zombie { .. }));
        let id = provenance.id;
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
                    facing: 0.,
                    history,
                },
                vitals: Vitals {
                    faction: crate::FactionId::Plague,
                    hp: max_hp,
                    max_hp,
                    barrier: 0.,
                    immune_until: 0.,
                    hp_frac_at_tick_start: 1.,
                },
                weapon: WeaponRt::default(),
                signature: Default::default(),
                statuses: Default::default(),
                modifiers: crate::modifiers::Runtime::default(),
                card_dot_crit: None,
                motion: Motion::default(),
                inputs: InputQueue::default(),
            },
            kind: MobKind::Regional,
            mob_type: None,
            elite: false,
            camp: 0,
            status: Status::Alive,
            home: at,
            home_facing: 0.,
            repath_phase: 0,
            owner: Some(owner),
            zombie: Some(ZombieRt {
                target: None,
                assist_until: 0.,
                last_move_at: 0.,
                owner_displace_seq,
            }),
            display_name: Some(name),
        }
    }

    /// Builds the shared fighter core for a non-seat actor.
    #[allow(clippy::too_many_arguments)]
    fn core(
        id: PlayerId,
        at: Vec2,
        facing: f64,
        now: f64,
        hp: f64,
        faction: FactionId,
        weapon: Option<WeaponId>,
    ) -> FighterCore {
        let mut history = History::default();
        history.reset(Sample {
            t: now,
            x: at.x,
            y: at.y,
        });
        FighterCore {
            id,
            body: Body {
                x: at.x,
                y: at.y,
                facing,
                history,
            },
            vitals: Vitals {
                faction,
                hp,
                max_hp: hp,
                barrier: 0.,
                immune_until: 0.,
                hp_frac_at_tick_start: 1.,
            },
            weapon: WeaponRt {
                weapon0: weapon,
                ..WeaponRt::default()
            },
            signature: Default::default(),
            statuses: Default::default(),
            modifiers: crate::modifiers::Runtime::default(),
            card_dot_crit: None,
            motion: Motion::default(),
            inputs: InputQueue::default(),
        }
    }
    pub(crate) fn born(provenance: &ActorProvenance, at: Vec2, facing: f64, now: f64) -> Self {
        let origin = &provenance.origin;
        let serial = origin
            .birth_serial()
            .expect("only a non-seat provenance constructs Mob");
        let (kind, mob_type, elite, camp, hp, faction, weapon): (
            MobKind,
            Option<MobTypeId>,
            bool,
            u32,
            f64,
            FactionId,
            Option<WeaponId>,
        ) = match *origin {
            ActorOrigin::Mob {
                camp,
                mob_type,
                elite,
                ..
            } => {
                let ty = crate::mob_catalog::mob_type_by_id(mob_type.as_str())
                    .expect("typed catalog row");
                (
                    MobKind::Regional,
                    Some(mob_type),
                    elite,
                    camp,
                    spawn_hp(ty.zone, elite, mob_type),
                    ty.zone,
                    Some(ty.weapon),
                )
            }
            ActorOrigin::Practice {
                camp,
                mob_type,
                elite,
                ..
            } => {
                let ty = crate::mob_catalog::mob_type_by_id(mob_type.as_str())
                    .expect("typed catalog row");
                (
                    MobKind::Practice,
                    Some(mob_type),
                    elite,
                    camp,
                    spawn_hp(ty.zone, elite, mob_type),
                    ty.zone,
                    Some(ty.weapon),
                )
            }
            // A dummy has no faction (so no faction armor/shield; `base_sheet` pins both to 0) and no catalog type.
            // The faction field only carries the presentation/wire placeholder the source leaves empty.
            ActorOrigin::Dummy { shield, .. } => (
                MobKind::Dummy,
                None,
                false,
                0,
                crate::constants::DUMMY_HP,
                FactionId::Fire,
                if shield { Some(WeaponId::Shield) } else { None },
            ),
            ActorOrigin::Player { .. } | ActorOrigin::Zombie { .. } => {
                unreachable!("only a typed non-seat birth constructs Mob")
            }
        };
        let id = provenance.id;
        Self {
            brain: Brain::default(),
            last_hit_at: 0.,
            core: Self::core(id, at, facing, now, hp, faction, weapon),
            kind,
            mob_type,
            elite,
            camp,
            status: Status::Alive,
            home: at,
            home_facing: facing,
            repath_phase: ((u64::from(serial) * u64::from(crate::constants::MOB_REPATH_PHASE_MULT))
                % u64::from(crate::constants::MOB_REPATH_PHASE_PERIOD))
                as u32,
            owner: None,
            zombie: None,
            display_name: None,
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
