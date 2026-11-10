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
    QuestGiver,
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
    /// A neutral quest actor, including retained provenance after retirement.
    QuestGiver {
        birth_serial: u32,
        born_tick: u32,
        quest_id: u32,
        def: u16,
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
            | Self::Dummy { birth_serial, .. }
            | Self::QuestGiver { birth_serial, .. } => Some(birth_serial),
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
    pub(crate) brain: Option<Brain>,
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
    /// What decides this actor's hitbox archetype (ADR0024), or `None` for a malformed record (a regional actor without a
    /// catalog type).
    pub fn identity(&self) -> Option<crate::archetype::Identity> {
        use crate::archetype::Identity;
        Some(match self.kind {
            _ if self.zombie.is_some() => Identity::Zombie,
            MobKind::Regional | MobKind::Practice => Identity::Mob(self.mob_type?),
            MobKind::Dummy => Identity::Dummy,
            MobKind::QuestGiver => Identity::QuestGiver,
        })
    }
    /// Is this mob fighting (its brain is in fight mode)? A read for tools and tests (rh-headless measurements); the sim
    /// never sends it to a client.
    pub fn engaged(&self) -> bool {
        self.brain
            .as_ref()
            .is_some_and(|b| b.mode == BrainMode::Fight)
    }
    pub(crate) fn returning(&self) -> bool {
        self.brain
            .as_ref()
            .is_some_and(|b| b.mode == BrainMode::Return)
    }
    pub(crate) fn regional_brain(&self) -> &Brain {
        self.brain.as_ref().expect("validated regional brain")
    }
    pub(crate) fn regional_brain_mut(&mut self) -> &mut Brain {
        self.brain.as_mut().expect("validated regional brain")
    }

    /// A Plague-owned companion, with no regional catalog type.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn zombie(
        provenance: &ActorProvenance,
        owner: PlayerId,
        at: Vec2,
        name: String,
        max_hp: f64,
        now: f64,
        owner_displace_seq: u8,
        hitboxes: crate::archetype::HitboxMode,
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
            brain: None,
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
                    faction: crate::FactionId::Plague.into(),
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
                archetype: crate::archetype::assign(hitboxes, crate::archetype::Identity::Zombie),
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
        faction: crate::fighter::FighterAffiliation,
        weapon: Option<WeaponId>,
        archetype: crate::archetype::ArchetypeId,
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
            archetype,
            inputs: InputQueue::default(),
        }
    }
    pub(crate) fn born(
        provenance: &ActorProvenance,
        at: Vec2,
        facing: f64,
        now: f64,
        hitboxes: crate::archetype::HitboxMode,
    ) -> Self {
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
            crate::fighter::FighterAffiliation,
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
                    ty.zone.into(),
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
                    ty.zone.into(),
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
                FactionId::Fire.into(),
                if shield { Some(WeaponId::Shield) } else { None },
            ),
            ActorOrigin::QuestGiver { .. } => (
                MobKind::QuestGiver,
                None,
                false,
                0,
                crate::constants::DUMMY_HP,
                crate::fighter::FighterAffiliation::Neutral,
                None,
            ),
            ActorOrigin::Player { .. } | ActorOrigin::Zombie { .. } => {
                unreachable!("only a typed non-seat birth constructs Mob")
            }
        };
        let id = provenance.id;
        let identity = match (kind, mob_type) {
            (MobKind::Regional | MobKind::Practice, Some(t)) => crate::archetype::Identity::Mob(t),
            (MobKind::Dummy, _) => crate::archetype::Identity::Dummy,
            (MobKind::QuestGiver, _) => crate::archetype::Identity::QuestGiver,
            _ => unreachable!("a typed regional birth has a catalog type"),
        };
        let archetype = crate::archetype::assign(hitboxes, identity);
        Self {
            brain: matches!(kind, MobKind::Regional | MobKind::Practice).then(Brain::default),
            last_hit_at: 0.,
            core: Self::core(id, at, facing, now, hp, faction, weapon, archetype),
            kind,
            mob_type,
            elite,
            camp,
            status: Status::Alive,
            home: at,
            home_facing: facing,
            repath_phase: if matches!(kind, MobKind::Regional | MobKind::Practice) {
                ((u64::from(serial) * u64::from(crate::constants::MOB_REPATH_PHASE_MULT))
                    % u64::from(crate::constants::MOB_REPATH_PHASE_PERIOD)) as u32
            } else {
                0
            },
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

#[cfg(test)]
mod neutral_tests {
    use super::*;
    #[test]
    fn neutral_giver_constructor_has_no_combat_kit_or_regional_brain() {
        // Declared constructor fixture; birth is not wired into quest publication in Slice 1.
        let origin = ActorProvenance {
            id: PlayerId(8),
            origin: ActorOrigin::QuestGiver {
                birth_serial: 73,
                born_tick: 2,
                quest_id: 4,
                def: 0,
            },
        };
        let m = Mob::born(
            &origin,
            Vec2::new(200., 300.),
            1.25,
            100.,
            crate::archetype::HitboxMode::LegacyCircle,
        );
        assert_eq!(m.kind, MobKind::QuestGiver);
        assert_eq!(m.core.faction_id(), None);
        assert!(m.brain.is_none());
        assert!(m.mob_type.is_none() && m.owner.is_none() && m.zombie.is_none());
        assert_eq!((m.camp, m.elite, m.repath_phase), (0, false, 0));
        assert_eq!((m.core.weapon.weapon0, m.core.weapon.weapon1), (None, None));
        assert_eq!((m.core.vitals.hp, m.core.vitals.max_hp), (5000., 5000.));
        assert_eq!(
            m.core.body.history.as_slice(),
            &[Sample {
                t: 100.,
                x: 200.,
                y: 300.
            }]
        );
        assert!(m.core.motion.path.is_empty() && m.core.inputs.actions.as_slice().is_empty());
        assert_eq!(origin.origin.birth_serial(), Some(73));
    }
}
