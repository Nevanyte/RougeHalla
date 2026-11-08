//! Complete replacements for observer-owned collections. Keys and handles are strict per wire version.
use crate::codec::{str_fits, str_len, varint_len};
use crate::{DecodeError, EncodeError, Reader, Writer};
use std::num::NonZeroU32;

pub const MAX_STATE_KEYS: usize = 9;
pub const MAX_VISIBLE_PROPS: usize = 512;
pub const MAX_VISIBLE_FIELDS: usize = 512;
pub const MAX_REWARD_CHESTS: usize = 512;

/// An observer-issued pickup reference; never an actor or authoritative container identifier.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct PickupHandle(NonZeroU32);
impl PickupHandle {
    pub fn new(value: u32) -> Option<Self> {
        NonZeroU32::new(value).map(Self)
    }
    pub fn get(self) -> u32 {
        self.0.get()
    }
}

/// A separately issued reward-choice handle. It cannot be used as a pickup or actor ID.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct RewardChestHandle(NonZeroU32);
impl RewardChestHandle {
    pub fn new(value: u32) -> Option<Self> {
        NonZeroU32::new(value).map(Self)
    }
    pub fn get(self) -> u32 {
        self.0.get()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WireRewardId {
    /// Selected source order: Slow Burn, Pocket Sand, Siphon.
    Card(u8),
    /// Source order: ad,ap,armor,shield,maxHp,attackSpeed,moveSpeed,lifesteal.
    Boost(u8),
}
impl WireRewardId {
    fn valid(self) -> bool {
        match self {
            Self::Card(id) => id < 3,
            Self::Boost(id) => id < 8,
        }
    }
    fn write(self, w: &mut Writer) {
        match self {
            Self::Card(id) => {
                w.u8(1);
                w.u8(id)
            }
            Self::Boost(id) => {
                w.u8(2);
                w.u8(id)
            }
        }
    }
    fn read(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let result = match r.u8()? {
            1 => Self::Card(r.u8()?),
            2 => Self::Boost(r.u8()?),
            _ => return Err(DecodeError::BadField("reward kind")),
        };
        if result.valid() {
            Ok(result)
        } else {
            Err(DecodeError::BadField("reward id"))
        }
    }
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WireRewardOption {
    pub id: WireRewardId,
    pub taken: bool,
    pub taken_by: Option<u32>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct WireRewardChest {
    pub handle: RewardChestHandle,
    pub x: u16,
    pub y: u16,
    pub expires_at: f64,
    pub options: Vec<WireRewardOption>,
    pub picked: bool,
    pub can_choose: bool,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WireBuild {
    pub cards: [u8; 80],
    pub boosts: [u8; 8],
}

impl Default for WireBuild {
    fn default() -> Self {
        Self {
            cards: [0; 80],
            boosts: [0; 8],
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WireInventory {
    pub active_slot: u8,
    /// Carried weapon codes0..4; an empty slot is distinct from fists.
    pub slots: [Option<u8>; 2],
    pub potion_small: u8,
    pub potions_healing: u8,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WirePropKind {
    Ground(u8),
    Chest {
        open: bool,
    },
    Body {
        label: String,
    },
    /// A travel cannon with its server-time reload clock (the legacy `readyAt` countdown).
    Cannon {
        ready_at: u32,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WireProp {
    pub handle: PickupHandle,
    pub x: u16,
    pub y: u16,
    pub kind: WirePropKind,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WireFocus {
    pub handle: PickupHandle,
    /// Only a focused body may reveal this first-weapon hint.
    pub body_hint: Option<u8>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct WireProps {
    pub rows: Vec<WireProp>,
    pub focus: Option<WireFocus>,
}

/// Public geometry and already-redacted actors only. No runtime field ID or private source record.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WireField {
    pub kind: u8,
    pub ability: u8,
    pub owner: Option<u32>,
    pub subject: Option<u32>,
    pub x: f32,
    pub y: f32,
    pub x2: f32,
    pub y2: f32,
    pub r: f32,
    pub vx: f32,
    pub vy: f32,
    pub started_at: f64,
    pub ends_at: f64,
}

/// The viewer's own private planning deal (key 8). Never another player's options; the server resolves every fact so a
/// client chooses an index and never computes a path or a deal.
#[derive(Clone, Debug, PartialEq)]
pub struct WirePlan {
    /// Server time planning ends (the same value as RaidView.plan_ends_at; it can end sooner when everyone is ready).
    pub ends_at: f64,
    /// The two spawns dealt, as indexes into the map's spawn pool; absent only on a map with no spawn pool.
    pub spawns: [Option<u32>; 2],
    /// That option is held by another player's pick (never set for the viewer's own pick).
    pub taken: [bool; 2],
    /// The viewer's own pick (an index into `spawns`), absent for none yet.
    pub pick: Option<u8>,
    /// Start boons dealt (empty until a boon producer exists; source had none in a normal run).
    pub boons: Vec<String>,
    /// The viewer's own boon pick, absent for none.
    pub boon: Option<u8>,
    /// `ready` latches and freezes picks.
    pub ready: bool,
    /// The server-resolved facts for the two options (position, zone and walk time), so a client needs no spawn pool.
    pub options: [Option<WirePlanOption>; 2],
}
/// One resolved planning option: where it is, which zone it is in and how long it takes to walk there.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WirePlanOption {
    pub index: u32,
    /// Position: u16 at 1/8 world unit on the same grid as remote actors.
    pub x: u16,
    pub y: u16,
    /// Source zone code: 1 fire, 2 sentenced, 3 plague, 4 frost, 5 holy.
    pub zone: u8,
    /// Absent when the source did not resolve a walk for this spawn (the deal fallback).
    pub walk_seconds: Option<f32>,
}
impl WirePlanOption {
    fn valid(&self) -> bool {
        (1..=5).contains(&self.zone) && self.walk_seconds.is_none_or(|v| v.is_finite() && v >= 0.)
    }
    fn len(&self) -> usize {
        varint_len(self.index) + 5 + 1 + self.walk_seconds.map_or(0, |_| 4)
    }
    fn write(&self, w: &mut Writer) {
        w.varint(self.index);
        w.u16(self.x);
        w.u16(self.y);
        w.u8(self.zone);
        w.opt(self.walk_seconds.as_ref(), |w, v| w.f32(*v));
    }
    fn read(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let result = Self {
            index: r.varint()?,
            x: r.u16()?,
            y: r.u16()?,
            zone: r.u8()?,
            walk_seconds: r.opt(Reader::f32)?,
        };
        if result.valid() {
            Ok(result)
        } else {
            Err(DecodeError::BadField("plan option"))
        }
    }
}
impl WirePlan {
    fn valid(&self) -> bool {
        self.ends_at.is_finite()
            && self.pick.is_none_or(|v| v <= 1)
            && self.boon.is_none_or(|v| v <= 1)
            && self.boons.len() <= 4
            && self.boons.iter().all(|b| str_fits("boon", b).is_ok())
            && self.options.iter().flatten().all(WirePlanOption::valid)
    }
    fn len(&self) -> usize {
        8 + self
            .spawns
            .iter()
            .map(|s| 1 + s.map_or(0, varint_len))
            .sum::<usize>()
            + 2
            + 1
            + 1
            + self.boons.iter().map(|b| 1 + b.len()).sum::<usize>()
            + 1
            + 1
            + self
                .options
                .iter()
                .map(|o| 1 + o.as_ref().map_or(0, WirePlanOption::len))
                .sum::<usize>()
    }
    fn write(&self, w: &mut Writer) {
        w.f64(self.ends_at);
        for spawn in self.spawns {
            w.opt(spawn.as_ref(), |w, v| w.varint(*v));
        }
        for taken in self.taken {
            w.u8(u8::from(taken));
        }
        w.u8(self.pick.map_or(0, |v| v + 1));
        w.u8(self.boons.len() as u8);
        for boon in &self.boons {
            w.str(boon);
        }
        w.u8(self.boon.map_or(0, |v| v + 1));
        w.u8(u8::from(self.ready));
        for option in self.options {
            w.opt(option.as_ref(), |w, v| v.write(w));
        }
    }
    fn read(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let ends_at = r.f64()?;
        let spawns = [r.opt(Reader::varint)?, r.opt(Reader::varint)?];
        let taken = [bool_flag(r)?, bool_flag(r)?];
        let code = |v: u8| match v {
            0 => Ok(None),
            1 => Ok(Some(0)),
            2 => Ok(Some(1)),
            _ => Err(DecodeError::BadField("plan pick")),
        };
        let pick = code(r.u8()?)?;
        let n = r.u8()? as usize;
        if n > 4 {
            return Err(DecodeError::TooMany(n));
        }
        let mut boons = Vec::with_capacity(n);
        for _ in 0..n {
            boons.push(r.str()?);
        }
        let boon = code(r.u8()?)?;
        let ready = bool_flag(r)?;
        let options = [r.opt(WirePlanOption::read)?, r.opt(WirePlanOption::read)?];
        let result = Self {
            ends_at,
            spawns,
            taken,
            pick,
            boons,
            boon,
            ready,
            options,
        };
        if result.valid() {
            Ok(result)
        } else {
            Err(DecodeError::BadField("plan"))
        }
    }
}
/// The public source arena lifecycle view (key 9). Timers are server milliseconds; a typed absent deadline is `None`, never
/// Infinity.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WireArena {
    pub lobby_ends_at: f64,
    pub plan_ends_at: f64,
    pub raid_started_at: f64,
    pub patience_ends_at: Option<f64>,
    pub in_coliseum: bool,
    pub gates_locked: bool,
    pub sudden_death_at: f64,
    pub started_with: u32,
}
impl WireArena {
    fn valid(&self) -> bool {
        [self.lobby_ends_at, self.plan_ends_at, self.raid_started_at]
            .into_iter()
            .chain(self.patience_ends_at)
            .chain([self.sudden_death_at])
            .all(|v| v.is_finite() && v >= 0.)
            && self.patience_ends_at.is_none_or(|v| v >= 0.)
            && self.started_with <= 512
    }
    fn len(&self) -> usize {
        8 + 8
            + 8
            + 1
            + usize::from(self.patience_ends_at.is_some()) * 8
            + 1
            + 1
            + 8
            + varint_len(self.started_with)
    }
    fn write(&self, w: &mut Writer) {
        w.f64(self.lobby_ends_at);
        w.f64(self.plan_ends_at);
        w.f64(self.raid_started_at);
        w.opt(self.patience_ends_at.as_ref(), |w, v| w.f64(*v));
        w.u8(u8::from(self.in_coliseum));
        w.u8(u8::from(self.gates_locked));
        w.f64(self.sudden_death_at);
        w.varint(self.started_with);
    }
    fn read(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let result = Self {
            lobby_ends_at: r.f64()?,
            plan_ends_at: r.f64()?,
            raid_started_at: r.f64()?,
            patience_ends_at: r.opt(Reader::f64)?,
            in_coliseum: bool_flag(r)?,
            gates_locked: bool_flag(r)?,
            sudden_death_at: r.f64()?,
            started_with: r.varint()?,
        };
        if result.valid() {
            Ok(result)
        } else {
            Err(DecodeError::BadField("arena"))
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum StateItem {
    Inventory(Option<WireInventory>),
    Props(WireProps),
    Fields(Vec<WireField>),
    RewardChests(Vec<WireRewardChest>),
    Build(Option<WireBuild>),
    Camps(Vec<WireCamp>),
    Projectiles(Vec<WireProjectile>),
    /// Key 8: the viewer's own plan, never another player's deal.
    Plan(Option<WirePlan>),
    /// Key 9: the public source arena lifecycle view (only present when the source lifecycle runs).
    Arena(Option<WireArena>),
}

/// Public camp summary; no private actor identity is carried.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WireCamp {
    pub mob_type: u8,
    pub elite: Option<u8>,
    pub alive: u32,
    pub state: u8,
    pub cleared_at: f64,
    pub respawn_at: f64,
}
/// Visible projectile fact, with no global projectile ID.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WireProjectile {
    pub kind: u8,
    pub x: u16,
    pub y: u16,
    pub facing: u16,
    pub owner: Option<u32>,
}
impl WireProjectile {
    fn valid(&self) -> bool {
        self.kind <= 1 && self.owner != Some(0)
    }
    fn len(&self) -> usize {
        8 + self.owner.map_or(0, varint_len)
    }
    fn write(&self, w: &mut Writer) {
        w.u8(self.kind);
        w.u16(self.x);
        w.u16(self.y);
        w.u16(self.facing);
        w.opt(self.owner.as_ref(), |w, id| w.varint(*id));
    }
    fn read(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let v = Self {
            kind: r.u8()?,
            x: r.u16()?,
            y: r.u16()?,
            facing: r.u16()?,
            owner: r.opt(Reader::varint)?,
        };
        if v.valid() {
            Ok(v)
        } else {
            Err(DecodeError::BadField("projectile"))
        }
    }
}

impl WireCamp {
    fn valid(&self) -> bool {
        self.mob_type < 30
            && self.elite.is_none_or(|v| v < 30)
            && self.alive <= 512
            && self.state <= 2
            && self.cleared_at.is_finite()
            && self.cleared_at >= 0.
            && self.respawn_at.is_finite()
            && self.respawn_at >= self.cleared_at
    }
    fn len(&self) -> usize {
        19 + varint_len(self.alive)
    }
    fn write(&self, w: &mut Writer) {
        w.u8(self.mob_type);
        w.u8(self.elite.map_or(0, |v| v + 1));
        w.varint(self.alive);
        w.u8(self.state);
        w.f64(self.cleared_at);
        w.f64(self.respawn_at);
    }
    fn read(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let mob_type = r.u8()?;
        let elite = r.u8()?.checked_sub(1);
        let v = Self {
            mob_type,
            elite,
            alive: r.varint()?,
            state: r.u8()?,
            cleared_at: r.f64()?,
            respawn_at: r.f64()?,
        };
        if v.valid() {
            Ok(v)
        } else {
            Err(DecodeError::BadField("camp"))
        }
    }
}

impl WireRewardChest {
    fn valid(&self) -> bool {
        self.expires_at.is_finite()
            && self.options.len() <= 3
            && self
                .options
                .iter()
                .all(|o| o.id.valid() && o.taken_by != Some(0))
    }
    fn len(&self) -> usize {
        varint_len(self.handle.get())
            + 15
            + self
                .options
                .iter()
                .map(|o| 4 + o.taken_by.map_or(0, varint_len))
                .sum::<usize>()
    }
    fn write(&self, w: &mut Writer) {
        w.varint(self.handle.get());
        w.u16(self.x);
        w.u16(self.y);
        w.f64(self.expires_at);
        w.u8(self.options.len() as u8);
        for o in &self.options {
            o.id.write(w);
            w.u8(u8::from(o.taken));
            w.opt(o.taken_by.as_ref(), |w, id| w.varint(*id));
        }
        w.u8(u8::from(self.picked));
        w.u8(u8::from(self.can_choose));
    }
    fn read(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let handle =
            RewardChestHandle::new(r.varint()?).ok_or(DecodeError::BadField("chest handle"))?;
        let (x, y, expires_at, n) = (r.u16()?, r.u16()?, r.f64()?, r.u8()? as usize);
        if n > 3 {
            return Err(DecodeError::TooMany(n));
        }
        let mut options = Vec::with_capacity(n);
        for _ in 0..n {
            options.push(WireRewardOption {
                id: WireRewardId::read(r)?,
                taken: bool_flag(r)?,
                taken_by: r.opt(Reader::varint)?,
            });
        }
        let result = Self {
            handle,
            x,
            y,
            expires_at,
            options,
            picked: bool_flag(r)?,
            can_choose: bool_flag(r)?,
        };
        if result.valid() {
            Ok(result)
        } else {
            Err(DecodeError::BadField("reward chest"))
        }
    }
}

fn weapon(value: u8) -> Result<u8, DecodeError> {
    if value < 5 {
        Ok(value)
    } else {
        Err(DecodeError::BadField("carried weapon"))
    }
}
fn read_weapon(r: &mut Reader<'_>) -> Result<Option<u8>, DecodeError> {
    match r.u8()? {
        0 => Ok(None),
        value => Ok(Some(weapon(value - 1)?)),
    }
}
fn write_weapon(w: &mut Writer, value: Option<u8>) {
    w.u8(value.map_or(0, |v| v + 1));
}
fn read_handle(r: &mut Reader<'_>) -> Result<PickupHandle, DecodeError> {
    PickupHandle::new(r.varint()?).ok_or(DecodeError::BadField("pickup handle"))
}
fn bool_flag(r: &mut Reader<'_>) -> Result<bool, DecodeError> {
    match r.u8()? {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(DecodeError::BadField("flag")),
    }
}
fn check_weapon(value: Option<u8>) -> Result<(), EncodeError> {
    if value.is_some_and(|v| v >= 5) {
        Err(EncodeError::BadValue("carried weapon"))
    } else {
        Ok(())
    }
}

impl WireProps {
    fn check(&self) -> Result<(), EncodeError> {
        if self.rows.len() > MAX_VISIBLE_PROPS {
            return Err(EncodeError::TooMany {
                what: "props",
                n: self.rows.len(),
                max: MAX_VISIBLE_PROPS,
            });
        }
        let mut previous = 0;
        for row in &self.rows {
            if row.handle.get() <= previous {
                return Err(EncodeError::BadValue("prop handles"));
            }
            previous = row.handle.get();
            match &row.kind {
                WirePropKind::Ground(v) => check_weapon(Some(*v))?,
                WirePropKind::Chest { .. } => {}
                WirePropKind::Body { label } => str_fits("body label", label)?,
                WirePropKind::Cannon { .. } => {}
            }
        }
        if let Some(focus) = self.focus {
            let row = self
                .rows
                .binary_search_by_key(&focus.handle, |row| row.handle)
                .ok()
                .map(|i| &self.rows[i])
                .ok_or(EncodeError::BadValue("prop focus"))?;
            check_weapon(focus.body_hint)?;
            if focus.body_hint.is_some() && !matches!(row.kind, WirePropKind::Body { .. }) {
                return Err(EncodeError::BadValue("body hint"));
            }
        }
        Ok(())
    }

    fn len(&self) -> usize {
        varint_len(self.rows.len() as u32)
            + self
                .rows
                .iter()
                .map(|row| {
                    varint_len(row.handle.get())
                        + 5
                        + match &row.kind {
                            WirePropKind::Ground(_) | WirePropKind::Chest { .. } => 1,
                            WirePropKind::Body { label } => str_len(label),
                            WirePropKind::Cannon { ready_at } => varint_len(*ready_at),
                        }
                })
                .sum::<usize>()
            + self.focus.map_or(1, |f| varint_len(f.handle.get()) + 1)
    }

    fn write(&self, w: &mut Writer) {
        w.varint(self.rows.len() as u32);
        for row in &self.rows {
            w.varint(row.handle.get());
            w.u16(row.x);
            w.u16(row.y);
            match &row.kind {
                WirePropKind::Ground(v) => {
                    w.u8(1);
                    w.u8(*v);
                }
                WirePropKind::Chest { open } => {
                    w.u8(2);
                    w.u8(u8::from(*open));
                }
                WirePropKind::Body { label } => {
                    w.u8(3);
                    w.str(label);
                }
                WirePropKind::Cannon { ready_at } => {
                    w.u8(4);
                    w.varint(*ready_at);
                }
            }
        }
        w.varint(self.focus.map_or(0, |f| f.handle.get()));
        if let Some(focus) = self.focus {
            write_weapon(w, focus.body_hint);
        }
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let n = r.varint()? as usize;
        if n > MAX_VISIBLE_PROPS {
            return Err(DecodeError::TooMany(n));
        }
        let mut rows = Vec::with_capacity(n);
        let mut previous = 0;
        for _ in 0..n {
            let handle = read_handle(r)?;
            if handle.get() <= previous {
                return Err(DecodeError::BadField("prop handles"));
            }
            previous = handle.get();
            let (x, y) = (r.u16()?, r.u16()?);
            let kind = match r.u8()? {
                1 => WirePropKind::Ground(weapon(r.u8()?)?),
                2 => WirePropKind::Chest {
                    open: bool_flag(r)?,
                },
                3 => WirePropKind::Body { label: r.str()? },
                4 => WirePropKind::Cannon {
                    ready_at: r.varint()?,
                },
                _ => return Err(DecodeError::BadField("prop kind")),
            };
            rows.push(WireProp { handle, x, y, kind });
        }
        let focus = match PickupHandle::new(r.varint()?) {
            None => None,
            Some(handle) => Some(WireFocus {
                handle,
                body_hint: read_weapon(r)?,
            }),
        };
        let result = Self { rows, focus };
        result
            .check()
            .map_err(|_| DecodeError::BadField("prop focus"))?;
        Ok(result)
    }
}

impl WireField {
    fn valid(&self) -> bool {
        self.kind < 3
            && self.ability < 5
            && self.owner != Some(0)
            && self.subject != Some(0)
            && [self.x, self.y, self.x2, self.y2, self.r, self.vx, self.vy]
                .into_iter()
                .all(f32::is_finite)
            && self.r >= 0.
            && self.started_at.is_finite()
            && self.ends_at.is_finite()
            && self.ends_at >= self.started_at
    }
    fn len(&self) -> usize {
        48 + self.owner.map_or(0, varint_len) + self.subject.map_or(0, varint_len)
    }
    fn write(&self, w: &mut Writer) {
        w.u8(self.kind);
        w.u8(self.ability);
        w.opt(self.owner.as_ref(), |w, id| w.varint(*id));
        w.opt(self.subject.as_ref(), |w, id| w.varint(*id));
        for value in [self.x, self.y, self.x2, self.y2, self.r, self.vx, self.vy] {
            w.f32(value);
        }
        w.f64(self.started_at);
        w.f64(self.ends_at);
    }
    fn read(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let result = Self {
            kind: r.u8()?,
            ability: r.u8()?,
            owner: r.opt(Reader::varint)?,
            subject: r.opt(Reader::varint)?,
            x: r.f32()?,
            y: r.f32()?,
            x2: r.f32()?,
            y2: r.f32()?,
            r: r.f32()?,
            vx: r.f32()?,
            vy: r.f32()?,
            started_at: r.f64()?,
            ends_at: r.f64()?,
        };
        if result.valid() {
            Ok(result)
        } else {
            Err(DecodeError::BadField("field"))
        }
    }
}

impl StateItem {
    pub fn key(&self) -> u32 {
        match self {
            Self::Inventory(_) => 1,
            Self::Props(_) => 2,
            Self::Fields(_) => 3,
            Self::RewardChests(_) => 4,
            Self::Build(_) => 5,
            Self::Camps(_) => 6,
            Self::Projectiles(_) => 7,
            Self::Plan(_) => 8,
            Self::Arena(_) => 9,
        }
    }
    pub(crate) fn encoded_len(&self) -> usize {
        varint_len(self.key())
            + match self {
                Self::Inventory(value) => 1 + usize::from(value.is_some()) * 5,
                Self::Props(value) => value.len(),
                Self::Fields(value) => {
                    varint_len(value.len() as u32) + value.iter().map(WireField::len).sum::<usize>()
                }
                Self::RewardChests(value) => {
                    varint_len(value.len() as u32)
                        + value.iter().map(WireRewardChest::len).sum::<usize>()
                }
                Self::Build(value) => 1 + usize::from(value.is_some()) * 88,
                Self::Projectiles(value) => {
                    varint_len(value.len() as u32)
                        + value.iter().map(WireProjectile::len).sum::<usize>()
                }
                Self::Camps(value) => {
                    varint_len(value.len() as u32) + value.iter().map(WireCamp::len).sum::<usize>()
                }
                Self::Plan(value) => 1 + value.as_ref().map_or(0, WirePlan::len),
                Self::Arena(value) => 1 + value.as_ref().map_or(0, WireArena::len),
            }
    }
    pub(crate) fn check(&self) -> Result<(), EncodeError> {
        match self {
            Self::Inventory(Some(value)) => {
                if value.active_slot > 1 {
                    return Err(EncodeError::BadValue("active slot"));
                }
                if value.potion_small > 5 || value.potions_healing > 3 {
                    return Err(EncodeError::BadValue("potion count"));
                }
                for slot in value.slots {
                    check_weapon(slot)?;
                }
            }
            Self::Inventory(None) => {}
            Self::Props(value) => value.check()?,
            Self::Fields(value) => {
                if value.len() > MAX_VISIBLE_FIELDS {
                    return Err(EncodeError::TooMany {
                        what: "fields",
                        n: value.len(),
                        max: MAX_VISIBLE_FIELDS,
                    });
                }
                if !value.iter().all(WireField::valid) {
                    return Err(EncodeError::BadValue("field"));
                }
            }
            Self::RewardChests(value) => {
                if value.len() > MAX_REWARD_CHESTS {
                    return Err(EncodeError::TooMany {
                        what: "reward chests",
                        n: value.len(),
                        max: MAX_REWARD_CHESTS,
                    });
                }
                let mut previous = 0;
                for row in value {
                    if row.handle.get() <= previous || !row.valid() {
                        return Err(EncodeError::BadValue("reward chest"));
                    }
                    previous = row.handle.get();
                }
            }
            Self::Build(_) => {}
            Self::Projectiles(value) => {
                if value.len() > 512 {
                    return Err(EncodeError::TooMany {
                        what: "projectiles",
                        n: value.len(),
                        max: 512,
                    });
                }
                if !value.iter().all(WireProjectile::valid) {
                    return Err(EncodeError::BadValue("projectile"));
                }
            }
            Self::Camps(value) => {
                if value.len() > 512 {
                    return Err(EncodeError::TooMany {
                        what: "camps",
                        n: value.len(),
                        max: 512,
                    });
                }
                if !value.iter().all(WireCamp::valid) {
                    return Err(EncodeError::BadValue("camp"));
                }
            }
            Self::Plan(Some(value)) => {
                if !value.valid() {
                    return Err(EncodeError::BadValue("plan"));
                }
            }
            Self::Plan(None) | Self::Arena(None) => {}
            Self::Arena(Some(value)) => {
                if !value.valid() {
                    return Err(EncodeError::BadValue("arena"));
                }
            }
        }
        Ok(())
    }
    pub(crate) fn write(&self, w: &mut Writer) {
        w.varint(self.key());
        match self {
            Self::Inventory(value) => {
                w.opt(value.as_ref(), |w, value| {
                    w.u8(value.active_slot);
                    for slot in value.slots {
                        write_weapon(w, slot);
                    }
                    w.u8(value.potion_small);
                    w.u8(value.potions_healing);
                });
            }
            Self::Props(value) => value.write(w),
            Self::Projectiles(value) => {
                w.varint(value.len() as u32);
                for row in value {
                    row.write(w);
                }
            }
            Self::Camps(value) => {
                w.varint(value.len() as u32);
                for row in value {
                    row.write(w);
                }
            }
            Self::Fields(value) => {
                w.varint(value.len() as u32);
                for field in value {
                    field.write(w);
                }
            }
            Self::RewardChests(value) => {
                w.varint(value.len() as u32);
                for row in value {
                    row.write(w)
                }
            }
            Self::Build(value) => w.opt(value.as_ref(), |w, v| {
                w.bytes(&v.cards);
                w.bytes(&v.boosts);
            }),
            Self::Plan(value) => w.opt(value.as_ref(), |w, v| v.write(w)),
            Self::Arena(value) => w.opt(value.as_ref(), |w, v| v.write(w)),
        }
    }
    pub(crate) fn read(r: &mut Reader<'_>, key: u32) -> Result<Self, DecodeError> {
        Ok(match key {
            1 => Self::Inventory(r.opt(|r| {
                let active_slot = r.u8()?;
                if active_slot > 1 {
                    return Err(DecodeError::BadField("active slot"));
                }
                let slots = [read_weapon(r)?, read_weapon(r)?];
                let potion_small = r.u8()?;
                let potions_healing = r.u8()?;
                if potion_small > 5 || potions_healing > 3 {
                    return Err(DecodeError::BadField("potion count"));
                }
                Ok(WireInventory {
                    active_slot,
                    slots,
                    potion_small,
                    potions_healing,
                })
            })?),
            2 => Self::Props(WireProps::read(r)?),
            3 => {
                let n = r.varint()? as usize;
                if n > MAX_VISIBLE_FIELDS {
                    return Err(DecodeError::TooMany(n));
                }
                let mut fields = Vec::with_capacity(n);
                for _ in 0..n {
                    fields.push(WireField::read(r)?);
                }
                Self::Fields(fields)
            }
            4 => {
                let n = r.varint()? as usize;
                if n > MAX_REWARD_CHESTS {
                    return Err(DecodeError::TooMany(n));
                }
                let mut rows = Vec::with_capacity(n);
                let mut previous = 0;
                for _ in 0..n {
                    let row = WireRewardChest::read(r)?;
                    if row.handle.get() <= previous {
                        return Err(DecodeError::BadField("chest handles"));
                    }
                    previous = row.handle.get();
                    rows.push(row);
                }
                Self::RewardChests(rows)
            }
            5 => Self::Build(r.opt(|r| {
                Ok(WireBuild {
                    cards: r.bytes(80)?.try_into().unwrap(),
                    boosts: r.bytes(8)?.try_into().unwrap(),
                })
            })?),
            6 => {
                let n = r.varint()? as usize;
                if n > 512 {
                    return Err(DecodeError::TooMany(n));
                }
                let mut rows = Vec::with_capacity(n);
                for _ in 0..n {
                    rows.push(WireCamp::read(r)?);
                }
                Self::Camps(rows)
            }
            7 => {
                let n = r.varint()? as usize;
                if n > 512 {
                    return Err(DecodeError::TooMany(n));
                }
                let mut rows = Vec::with_capacity(n);
                for _ in 0..n {
                    rows.push(WireProjectile::read(r)?);
                }
                Self::Projectiles(rows)
            }
            8 => Self::Plan(r.opt(WirePlan::read)?),
            9 => Self::Arena(r.opt(WireArena::read)?),
            _ => return Err(DecodeError::BadField("state key")),
        })
    }
}

pub(crate) fn check_items(items: &[StateItem]) -> Result<(), EncodeError> {
    if items.len() > MAX_STATE_KEYS {
        return Err(EncodeError::TooMany {
            what: "state keys",
            n: items.len(),
            max: MAX_STATE_KEYS,
        });
    }
    let mut previous = 0;
    for item in items {
        if item.key() <= previous {
            return Err(EncodeError::BadValue("state key order"));
        }
        previous = item.key();
        item.check()?;
    }
    Ok(())
}

pub(crate) fn read_items(r: &mut Reader<'_>) -> Result<Vec<StateItem>, DecodeError> {
    let n = r.varint()? as usize;
    if n > MAX_STATE_KEYS {
        return Err(DecodeError::TooMany(n));
    }
    let mut items = Vec::with_capacity(n);
    let mut previous = 0;
    for _ in 0..n {
        let key = r.varint()?;
        if key <= previous {
            return Err(DecodeError::BadField("state key order"));
        }
        previous = key;
        items.push(StateItem::read(r, key)?);
    }
    Ok(items)
}
