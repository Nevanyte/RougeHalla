//! Private, codec-shaped protocol13 subset. Not a network decoder or an attested delivery token.
//! Only an owned, successfully reconstructed public snapshot may feed this boundary. There is
//! deliberately NO raw Observation/World constructor, interpolation, event carry or action binding.
use rh_sim::{FactionId, Status, WeaponId};
use std::num::NonZeroU32;

pub const ACTOR_LIMIT: usize = 512;
const NPC_BASE: u32 = 1 << 31;
const FACING_STEP: f32 = (std::f64::consts::TAU / 65536.) as f32;
/// Local adapter lifecycle token, not a new wire field or a hidden-world counter.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Epoch(pub u64);
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct PlayerRef(NonZeroU32);
impl PlayerRef {
    pub fn new(value: u32) -> Result<Self, Error> {
        if value >= NPC_BASE {
            return Err(Error::Namespace);
        }
        NonZeroU32::new(value).map(Self).ok_or(Error::Namespace)
    }
    pub fn get(self) -> u32 {
        self.0.get()
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NpcRef(NonZeroU32);
impl NpcRef {
    fn new(value: u32) -> Result<Self, Error> {
        if value < NPC_BASE || value == u32::MAX {
            return Err(Error::Namespace);
        }
        NonZeroU32::new(value).map(Self).ok_or(Error::Namespace)
    }
    pub fn get(self) -> u32 {
        self.0.get()
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reference {
    Player(PlayerRef),
    RegionalMob(NpcRef),
    Zombie(NpcRef),
    TrainingDummy(NpcRef),
}
impl Reference {
    pub fn player(self) -> Option<PlayerRef> {
        if let Self::Player(id) = self {
            Some(id)
        } else {
            None
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fact<T> {
    Unavailable,
    Delivered(T),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MissingFact {
    OwnerLock,
    OwnerAbsoluteReady,
    OwnerDraw,
    OwnerImmunity,
    OwnerMirrors,
    Brand,
    Names,
    BotTag,
    PlayerCounts,
    Winner,
    MobMinimap,
    EventOrigins,
    ItemContinuity,
    Arena,
    Inventory,
    Build,
    Wish,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    Protocol,
    Clock,
    Float,
    Barrier,
    Owner,
    Namespace,
    Code,
    ActorOrder,
    ActorLimit,
}

/// Fields already decoded by the current human codec; f32 here prevents extra native f64 residue.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Owner13 {
    pub id: u32,
    pub faction: u8,
    pub weapon: u8,
    pub status: u8,
    pub x: f32,
    pub y: f32,
    pub facing: f32,
    pub hp: f32,
    pub max_hp: f32,
    pub barrier: f32,
    pub barrier_ring_step: u8,
    pub ready_in_ms: u16,
    pub kills: u16,
    pub bounty: u16,
    pub gv: u16,
    pub effects: u16,
    pub move_seq: u8,
    pub displace_seq: u8,
    pub sig: u8,
}
/// Remote geometry remains codec codes until decoded once at this boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Actor13 {
    pub id: u32,
    pub kind: u8,
    pub faction: u8,
    pub weapon: u8,
    pub status: u8,
    pub x: u16,
    pub y: u16,
    pub facing: u16,
    pub hp_pct: u8,
    pub barrier_pct: u8,
    pub barrier_ring_step: u8,
    pub bounty: u16,
    pub effects: u16,
    pub displace_seq: u8,
    pub sig: u8,
    pub mob_type_code: u8,
}
/// A complete replacement scene after codec Delta reconstruction, not a partial packet.
/// `source_time` is the actual decoded clock (including source overrides), never recomputed from tick.
/// Struct construction is not proof of real delivery/commit. That bridge is separately held.
pub struct Snapshot13 {
    pub protocol: u16,
    pub epoch: Epoch,
    pub viewer: PlayerRef,
    pub source_time: f64,
    pub owner: Option<Owner13>,
    pub actors: Vec<Actor13>,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Owner {
    pub id: PlayerRef,
    pub faction: FactionId,
    pub weapon: WeaponId,
    pub status: Status,
    pub x: f64,
    pub y: f64,
    pub facing: f64,
    pub hp: f64,
    pub max_hp: f64,
    pub barrier: f64,
    pub barrier_ring_step: u8,
    pub ready_in_ms: u16,
    pub kills: u16,
    pub bounty: u16,
    pub gv: u16,
    pub effects: u16,
    pub move_seq: u8,
    pub displace_seq: u8,
    pub sig: u8,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Actor {
    pub reference: Reference,
    pub faction: FactionId,
    pub weapon: WeaponId,
    pub status: Status,
    pub x: f64,
    pub y: f64,
    pub facing: f64,
    pub hp_pct: u8,
    pub barrier_pct: u8,
    pub barrier_ring_step: u8,
    pub bounty: u16,
    pub effects: u16,
    pub displace_seq: u8,
    pub sig: u8,
    pub mob_type_code: u8,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Frame {
    epoch: Epoch,
    viewer: PlayerRef,
    source_time: f64,
    owner: Option<Owner>,
    actors: Vec<Actor>,
}
fn faction(code: u8) -> Result<FactionId, Error> {
    FactionId::ALL
        .get(usize::from(code))
        .copied()
        .ok_or(Error::Code)
}
fn weapon(code: u8) -> Result<WeaponId, Error> {
    match code {
        0 => Ok(WeaponId::Sword),
        1 => Ok(WeaponId::Bow),
        2 => Ok(WeaponId::Wand),
        3 => Ok(WeaponId::Shield),
        4 => Ok(WeaponId::Axe),
        5 => Ok(WeaponId::Fists),
        _ => Err(Error::Code),
    }
}
fn status(code: u8) -> Result<Status, Error> {
    match code {
        0 => Ok(Status::Lobby),
        1 => Ok(Status::Alive),
        2 => Ok(Status::Dead),
        3 => Ok(Status::Mia),
        _ => Err(Error::Code),
    }
}
impl Frame {
    pub fn from_decoded(input: Snapshot13) -> Result<Self, Error> {
        if input.protocol != 13 {
            return Err(Error::Protocol);
        }
        if !input.source_time.is_finite() || input.source_time < 0. {
            return Err(Error::Clock);
        }
        if input.actors.len() > ACTOR_LIMIT {
            return Err(Error::ActorLimit);
        }
        let owner = input
            .owner
            .map(|o| -> Result<Owner, Error> {
                let id = PlayerRef::new(o.id)?;
                if id != input.viewer {
                    return Err(Error::Owner);
                }
                if ![o.x, o.y, o.facing, o.hp, o.max_hp]
                    .iter()
                    .all(|x| x.is_finite())
                {
                    return Err(Error::Float);
                }
                if !o.barrier.is_finite() || o.barrier < 0. || o.barrier_ring_step > 8 {
                    return Err(Error::Barrier);
                }
                Ok(Owner {
                    id,
                    faction: faction(o.faction)?,
                    weapon: weapon(o.weapon)?,
                    status: status(o.status)?,
                    x: f64::from(o.x),
                    y: f64::from(o.y),
                    facing: f64::from(o.facing),
                    hp: f64::from(o.hp),
                    max_hp: f64::from(o.max_hp),
                    barrier: f64::from(o.barrier),
                    barrier_ring_step: o.barrier_ring_step,
                    ready_in_ms: o.ready_in_ms,
                    kills: o.kills,
                    bounty: o.bounty,
                    gv: o.gv,
                    effects: o.effects,
                    move_seq: o.move_seq,
                    displace_seq: o.displace_seq,
                    sig: o.sig,
                })
            })
            .transpose()?;
        let mut previous = None;
        let mut actors = Vec::with_capacity(input.actors.len());
        for a in input.actors {
            if previous.is_some_and(|id| a.id <= id) {
                return Err(Error::ActorOrder);
            }
            previous = Some(a.id);
            if a.id == input.viewer.get() {
                return Err(Error::Owner);
            }
            if a.hp_pct > 100 || a.barrier_pct > 100 || a.barrier_ring_step > 8 {
                return Err(Error::Barrier);
            }
            if a.mob_type_code > 30 {
                return Err(Error::Code);
            }
            let reference = match a.kind {
                0 => Reference::Player(PlayerRef::new(a.id)?),
                1 => Reference::RegionalMob(NpcRef::new(a.id)?),
                2 => Reference::Zombie(NpcRef::new(a.id)?),
                3 => Reference::TrainingDummy(NpcRef::new(a.id)?),
                _ => return Err(Error::Code),
            };
            actors.push(Actor {
                reference,
                faction: faction(a.faction)?,
                weapon: weapon(a.weapon)?,
                status: status(a.status)?,
                x: f64::from(f32::from(a.x) / 8.),
                y: f64::from(f32::from(a.y) / 8.),
                facing: f64::from((a.facing as i16) as f32 * FACING_STEP),
                hp_pct: a.hp_pct,
                barrier_pct: a.barrier_pct,
                barrier_ring_step: a.barrier_ring_step,
                bounty: a.bounty,
                effects: a.effects,
                displace_seq: a.displace_seq,
                sig: a.sig,
                mob_type_code: a.mob_type_code,
            });
        }
        Ok(Self {
            epoch: input.epoch,
            viewer: input.viewer,
            source_time: input.source_time,
            owner,
            actors,
        })
    }
    pub fn epoch(&self) -> Epoch {
        self.epoch
    }
    pub fn viewer(&self) -> PlayerRef {
        self.viewer
    }
    pub fn source_time(&self) -> f64 {
        self.source_time
    }
    /// Delivered(None) is an actual cleared owner; it is distinct from an unsupported leaf.
    pub fn owner(&self) -> Fact<Option<&Owner>> {
        Fact::Delivered(self.owner.as_ref())
    }
    pub fn actors(&self) -> &[Actor] {
        &self.actors
    }
    pub fn unavailable(&self, _fact: MissingFact) -> Fact<()> {
        Fact::Unavailable
    }
}
#[cfg(test)]
pub(super) mod tests;
