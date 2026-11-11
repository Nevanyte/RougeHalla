//! Complete replacements for observer-owned collections. Keys and handles are strict per wire version.
use crate::codec::{str_fits, str_len, varint_len};
use crate::{DecodeError, EncodeError, Reader, Writer};
use std::num::NonZeroU32;

pub const MAX_STATE_KEYS: usize = 12;
/// Most roster rows a State key 12 carries (ADR0026); a match seats at most 8 players today.
pub const MAX_ROSTER: usize = 32;
/// Longest roster display name in UTF-8 bytes (ADR0026).
pub const MAX_ROSTER_NAME: usize = 24;
/// Roster row flag: the seat is a bot.
pub const ROSTER_FLAG_BOT: u8 = 1;
pub const MAX_VISIBLE_PROPS: usize = 512;
pub const MAX_VISIBLE_FIELDS: usize = 512;
pub const MAX_REWARD_CHESTS: usize = 512;
pub const MAX_QUEST_ROWS: usize = 20;
pub const MAX_QUEST_ROSTER: usize = 8;
pub const MAX_QUEST_PARTICIPANTS: usize = 8;
pub const MAX_QUEST_OBJECTIVES: usize = 160;
pub const MAX_QUEST_OBJECTIVES_PER_ROW: usize = 8;
pub const MAX_QUEST_VIEW_BYTES: usize = 24_576;
pub const MAX_TRADE_OFFERS: usize = 3;
pub const MAX_TRADE_STATS: usize = 7;
pub const MAX_TRADE_MERCHANTS: usize = 2;
/// Trade value body including its availability byte, excluding the State key varint.
pub const MAX_TRADE_VIEW_BYTES: usize = 2213;

/// Quest row capability. Separate from pickup, reward, and actor identifiers.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct QuestHandle(NonZeroU32);
impl QuestHandle {
    pub fn new(value: u32) -> Option<Self> {
        NonZeroU32::new(value).map(Self)
    }
    pub fn get(self) -> u32 {
        self.0.get()
    }
}

/// Quest-only roster identity. It is not a player/actor ID.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct RosterId(NonZeroU32);
impl RosterId {
    pub fn new(value: u32) -> Option<Self> {
        NonZeroU32::new(value).map(Self)
    }
    pub fn get(self) -> u32 {
        self.0.get()
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WireQuestPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WireRosterEntry {
    pub id: RosterId,
    pub label: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WireQuestParticipant {
    pub id: RosterId,
    pub accepted: bool,
    pub progress: u32,
    pub visited: u8,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WireQuestRow {
    pub handle: QuestHandle,
    pub def: String,
    pub giver: WireQuestPoint,
    /// Closed native RowState code: Preview0, Open1, Done2, Expired3.
    pub state: u8,
    pub expires_at: f64,
    pub participants: Vec<WireQuestParticipant>,
    pub carrier: Option<RosterId>,
    pub done_by: Option<String>,
    pub can_accept: bool,
    pub owner_accepted: bool,
    pub owner_progress: u32,
    pub owner_visited: u8,
    pub name: String,
    pub giver_label: String,
    pub brief: String,
    pub objective: String,
    pub reward: String,
    pub owner_completed: bool,
    pub owner_ready: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WireQuestObjective {
    pub quest: QuestHandle,
    pub at: WireQuestPoint,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct WireQuestView {
    pub unknown_count: u32,
    pub display_unknown_count: u32,
    pub owner_roster: Option<RosterId>,
    pub roster: Vec<WireRosterEntry>,
    pub rows: Vec<WireQuestRow>,
    pub objectives: Vec<WireQuestObjective>,
}

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
#[repr(u8)]
pub enum TrophyStatKey {
    Ad = 0,
    Ap = 1,
    Damage = 2,
    Health = 3,
    AttackSpeed = 4,
    Armor = 5,
    Mr = 6,
    Speed = 7,
    Leech = 8,
}
impl TrophyStatKey {
    pub(crate) fn from_code(value: u8) -> Option<Self> {
        Some(match value {
            0 => Self::Ad,
            1 => Self::Ap,
            2 => Self::Damage,
            3 => Self::Health,
            4 => Self::AttackSpeed,
            5 => Self::Armor,
            6 => Self::Mr,
            7 => Self::Speed,
            8 => Self::Leech,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum WireRewardId {
    /// Full 80-card catalog order (the same positions as WireBuild.cards).
    Card(u8),
    /// Source order: ad,ap,armor,shield,maxHp,attackSpeed,moveSpeed,lifesteal.
    Boost(u8),
    /// Owner-only Trophy award. `gain` is the exact source binary64 value.
    Kill { key: TrophyStatKey, gain: f64 },
}
impl WireRewardId {
    fn valid(self) -> bool {
        match self {
            Self::Card(id) => id < 80,
            Self::Boost(id) => id < 8,
            Self::Kill { gain, .. } => gain.is_finite() && gain > 0.0,
        }
    }
    fn encoded_len(self) -> usize {
        match self {
            Self::Card(_) | Self::Boost(_) => 2,
            Self::Kill { .. } => 10,
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
            Self::Kill { key, gain } => {
                w.u8(3);
                w.u8(key as u8);
                w.f64(gain);
            }
        }
    }
    fn read(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let result = match r.u8()? {
            1 => Self::Card(r.u8()?),
            2 => Self::Boost(r.u8()?),
            3 => {
                let key =
                    TrophyStatKey::from_code(r.u8()?).ok_or(DecodeError::BadField("reward key"))?;
                Self::Kill {
                    key,
                    gain: r.f64()?,
                }
            }
            _ => return Err(DecodeError::BadField("reward kind")),
        };
        if result.valid() {
            Ok(result)
        } else {
            Err(match result {
                Self::Kill { .. } => DecodeError::BadField("reward gain"),
                _ => DecodeError::BadField("reward id"),
            })
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
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
    pub potion_large: u8,
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
    Corpse {
        label: String,
    },
    /// A walk-over wind emblem (the label is the source's fixed one).
    WindEmblem,
    /// A travel cannon with its server-time reload clock (the legacy `readyAt` countdown).
    Cannon {
        ready_at: u32,
    },
    /// Publicly visible quest token or parcel; the QuestHandle is not a pickup capability.
    QuestItem {
        quest: QuestHandle,
        fetch: bool,
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
            && self.ends_at >= 0.
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

/// Closed native trader catalog code: Barter 0, Stats 1.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WireTradeKind {
    Barter,
    Stats,
}
impl WireTradeKind {
    pub const fn code(self) -> u8 {
        match self {
            Self::Barter => 0,
            Self::Stats => 1,
        }
    }
    pub const fn from_code(code: u8) -> Option<Self> {
        match code {
            0 => Some(Self::Barter),
            1 => Some(Self::Stats),
            _ => None,
        }
    }
}

/// Closed native stat code in source order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WireTradeStat {
    MaxHp,
    Ad,
    Ap,
    AttackSpeed,
    MoveSpeed,
    Armor,
    Shield,
}
impl WireTradeStat {
    pub const fn code(self) -> u8 {
        match self {
            Self::MaxHp => 0,
            Self::Ad => 1,
            Self::Ap => 2,
            Self::AttackSpeed => 3,
            Self::MoveSpeed => 4,
            Self::Armor => 5,
            Self::Shield => 6,
        }
    }
    pub const fn from_code(code: u8) -> Option<Self> {
        match code {
            0 => Some(Self::MaxHp),
            1 => Some(Self::Ad),
            2 => Some(Self::Ap),
            3 => Some(Self::AttackSpeed),
            4 => Some(Self::MoveSpeed),
            5 => Some(Self::Armor),
            6 => Some(Self::Shield),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct WireTradeOffer {
    pub cost: WireTradeStat,
    pub cost_value: f64,
    pub gain: WireTradeStat,
    pub gain_value: f64,
    pub label: String,
}
impl WireTradeOffer {
    fn valid(&self) -> bool {
        self.cost != self.gain
            && self.cost_value.is_finite()
            && self.cost_value > 0.0
            && self.gain_value.is_finite()
            && self.gain_value > 0.0
    }
    fn len(&self) -> usize {
        18 + str_len(&self.label)
    }
    fn write(&self, w: &mut Writer) {
        w.u8(self.cost.code());
        w.f64(self.cost_value);
        w.u8(self.gain.code());
        w.f64(self.gain_value);
        w.str(&self.label);
    }
    fn read(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let cost = WireTradeStat::from_code(r.u8()?).ok_or(DecodeError::BadField("trade stat"))?;
        let cost_value = r.f64()?;
        let gain = WireTradeStat::from_code(r.u8()?).ok_or(DecodeError::BadField("trade stat"))?;
        let gain_value = r.f64()?;
        let label = r.str()?;
        let offer = Self {
            cost,
            cost_value,
            gain,
            gain_value,
            label,
        };
        if offer.valid() {
            Ok(offer)
        } else {
            Err(DecodeError::BadField("trade offer"))
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WireTradeDelta {
    pub stat: WireTradeStat,
    pub value: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WireMerchant {
    pub kind: WireTradeKind,
    pub x: f64,
    pub y: f64,
    pub name: String,
}
impl WireMerchant {
    fn valid(&self) -> bool {
        let limit = f64::from(crate::quant::POS_MAX);
        self.x.is_finite()
            && self.y.is_finite()
            && (0.0..=limit).contains(&self.x)
            && (0.0..=limit).contains(&self.y)
    }
    fn len(&self) -> usize {
        17 + str_len(&self.name)
    }
    fn write(&self, w: &mut Writer) {
        w.u8(self.kind.code());
        w.f64(self.x);
        w.f64(self.y);
        w.str(&self.name);
    }
    fn read(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let kind = WireTradeKind::from_code(r.u8()?).ok_or(DecodeError::BadField("trade kind"))?;
        let merchant = Self {
            kind,
            x: r.f64()?,
            y: r.f64()?,
            name: r.str()?,
        };
        if merchant.valid() {
            Ok(merchant)
        } else {
            Err(DecodeError::BadField("trade merchant"))
        }
    }
}

/// The owner's exact saved trade facts plus point-visible, noncombat merchant locations.
#[derive(Clone, Debug, PartialEq)]
pub struct WireTradeView {
    pub trade_used: bool,
    pub offers: Vec<WireTradeOffer>,
    pub stats: Vec<WireTradeDelta>,
    pub barter_ready_at: Option<f64>,
    pub merchants: Vec<WireMerchant>,
    pub barter_labels: [String; 3],
}
impl WireTradeView {
    pub fn check(&self) -> Result<(), EncodeError> {
        if self.offers.len() > MAX_TRADE_OFFERS {
            return Err(EncodeError::TooMany {
                what: "trade offers",
                n: self.offers.len(),
                max: MAX_TRADE_OFFERS,
            });
        }
        if self.stats.len() > MAX_TRADE_STATS {
            return Err(EncodeError::TooMany {
                what: "trade stats",
                n: self.stats.len(),
                max: MAX_TRADE_STATS,
            });
        }
        if self.merchants.len() > MAX_TRADE_MERCHANTS {
            return Err(EncodeError::TooMany {
                what: "trade merchants",
                n: self.merchants.len(),
                max: MAX_TRADE_MERCHANTS,
            });
        }
        if !self.offers.iter().all(WireTradeOffer::valid) {
            return Err(EncodeError::BadValue("trade offer"));
        }
        if self.stats.iter().any(|row| !row.value.is_finite()) {
            return Err(EncodeError::BadValue("trade delta"));
        }
        if self
            .barter_ready_at
            .is_some_and(|time| !time.is_finite() || time < 0.0)
        {
            return Err(EncodeError::BadValue("trade deadline"));
        }
        if !self.merchants.iter().all(WireMerchant::valid) {
            return Err(EncodeError::BadValue("trade merchant"));
        }
        for offer in &self.offers {
            str_fits("trade offer label", &offer.label)?;
        }
        for merchant in &self.merchants {
            str_fits("trade merchant name", &merchant.name)?;
        }
        for label in &self.barter_labels {
            str_fits("trade barter label", label)?;
        }
        if 1 + self.encoded_len() > MAX_TRADE_VIEW_BYTES {
            return Err(EncodeError::TooLarge {
                len: 1 + self.encoded_len(),
                max: MAX_TRADE_VIEW_BYTES,
            });
        }
        Ok(())
    }
    fn encoded_len(&self) -> usize {
        1 + varint_len(self.offers.len() as u32)
            + self.offers.iter().map(WireTradeOffer::len).sum::<usize>()
            + varint_len(self.stats.len() as u32)
            + self.stats.len() * 9
            + 1
            + usize::from(self.barter_ready_at.is_some()) * 8
            + varint_len(self.merchants.len() as u32)
            + self.merchants.iter().map(WireMerchant::len).sum::<usize>()
            + self.barter_labels.iter().map(|s| str_len(s)).sum::<usize>()
    }
    fn write(&self, w: &mut Writer) {
        w.u8(u8::from(self.trade_used));
        w.varint(self.offers.len() as u32);
        for offer in &self.offers {
            offer.write(w);
        }
        w.varint(self.stats.len() as u32);
        for stat in &self.stats {
            w.u8(stat.stat.code());
            w.f64(stat.value);
        }
        w.opt(self.barter_ready_at.as_ref(), |w, time| w.f64(*time));
        w.varint(self.merchants.len() as u32);
        for merchant in &self.merchants {
            merchant.write(w);
        }
        for label in &self.barter_labels {
            w.str(label);
        }
    }
    fn read(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let trade_used = trade_bool(r)?;
        let offers_len = r.varint()? as usize;
        if offers_len > MAX_TRADE_OFFERS {
            return Err(DecodeError::TooMany(offers_len));
        }
        let mut offers = Vec::with_capacity(offers_len);
        for _ in 0..offers_len {
            offers.push(WireTradeOffer::read(r)?);
        }
        let stats_len = r.varint()? as usize;
        if stats_len > MAX_TRADE_STATS {
            return Err(DecodeError::TooMany(stats_len));
        }
        let mut stats = Vec::with_capacity(stats_len);
        for _ in 0..stats_len {
            let stat =
                WireTradeStat::from_code(r.u8()?).ok_or(DecodeError::BadField("trade stat"))?;
            let value = r.f64()?;
            if !value.is_finite() {
                return Err(DecodeError::BadField("trade delta"));
            }
            stats.push(WireTradeDelta { stat, value });
        }
        let barter_ready_at = r.opt(Reader::f64)?;
        if barter_ready_at.is_some_and(|time| !time.is_finite() || time < 0.0) {
            return Err(DecodeError::BadField("trade deadline"));
        }
        let merchants_len = r.varint()? as usize;
        if merchants_len > MAX_TRADE_MERCHANTS {
            return Err(DecodeError::TooMany(merchants_len));
        }
        let mut merchants = Vec::with_capacity(merchants_len);
        for _ in 0..merchants_len {
            merchants.push(WireMerchant::read(r)?);
        }
        let barter_labels = [r.str()?, r.str()?, r.str()?];
        let view = Self {
            trade_used,
            offers,
            stats,
            barter_ready_at,
            merchants,
            barter_labels,
        };
        if 1 + view.encoded_len() > MAX_TRADE_VIEW_BYTES {
            return Err(DecodeError::TooLarge(1 + view.encoded_len()));
        }
        Ok(view)
    }
}

fn trade_bool(r: &mut Reader<'_>) -> Result<bool, DecodeError> {
    match r.u8()? {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(DecodeError::BadField("trade flag")),
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
    /// Key 10: the seat-local quest view; None means unavailable, Some(empty) is an available empty view.
    Quests(Option<WireQuestView>),
    /// Key 11: private saved owner trade state and currently point-visible merchants.
    Trade(Option<WireTradeView>),
    /// Key 12 (protocol 16, ADR0026): every player seated in the match, by ascending actor id: display name and bot flag.
    /// The same for every viewer; it carries no position, faction, health or sight fact.
    Roster(Vec<WireRosterRow>),
    /// Key 13 (P-WIRE17-HUD-1): the viewer's own build summary; never another seat's. None when unseated.
    BuildSummary(Option<WireBuildSummary>),
}

/// One seated player (State key 12): its actor id (the id its actor row carries when delivered), the bot flag and its
/// display name (1..=24 UTF-8 bytes, no control character).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WireRosterRow {
    pub id: u32,
    pub bot: bool,
    pub name: String,
}

/// A roster name a decoder accepts: 1..=[`MAX_ROSTER_NAME`] bytes with no control character.
pub fn roster_name_valid(name: &str) -> bool {
    (1..=MAX_ROSTER_NAME).contains(&name.len()) && !name.chars().any(char::is_control)
}

fn roster_fault(rows: &[WireRosterRow]) -> Option<&'static str> {
    if rows.len() > MAX_ROSTER {
        return Some("roster count");
    }
    let mut previous = 0u32;
    for row in rows {
        if row.id == 0 || row.id <= previous {
            return Some("roster order");
        }
        previous = row.id;
        if !roster_name_valid(&row.name) {
            return Some("roster name");
        }
    }
    None
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
    /// P-WIRE17-HUD-1: the stat reward one kill of this camp's normal mob type grants (public content, as legacy's
    /// reward badges). Appended after `respawn_at`: u8 `0` none / `1 + stat code`, then the amount u16 LE in
    /// [`HUD_QUANTUM`] units only when present.
    pub reward: Option<WireCampReward>,
    /// P-WIRE17-HUD-1: the camp ward as a verdict for THIS viewer, never an owner id. Appended after the reward: u8 `0`
    /// none / `1` yours / `2` another player's, then the expiry f64 LE (server ms) only when not none.
    pub ward: Option<WireWard>,
}

/// The fixed-point unit of every HUD number on the wire: 1e-4 (a fraction 0.0025 is 25, 1.25 points is 12500).
pub const HUD_QUANTUM: f64 = 1e-4;
/// The most "Mob bonuses" rows a build summary carries (the 20 normal mob types of the farm table).
pub const MAX_SUMMARY_MOB_ROWS: usize = 20;
/// The nine GAINED stats in the legacy strip order (`buildModel.ts` `buildGains`); also a camp reward's stat. Codes:
/// 0 Offense, 1 Soul Offense, 2 Damage, 3 Attack speed, 4 Life steal, 5 Health, 6 Defense, 7 Soul Defense,
/// 8 Move speed.
pub const HUD_STAT_COUNT: u8 = 9;

/// A camp's per-kill reward: the HUD stat code (`< HUD_STAT_COUNT`) and the amount in [`HUD_QUANTUM`] units (`> 0`):
/// a fraction for Damage/Attack speed/Life steal/Health(% max hp)/Move speed, points for the flat four.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WireCampReward {
    pub stat: u8,
    pub amount: u16,
}

/// A live camp ward as this viewer sees it: `yours` or another player's, and its expiry in server ms.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WireWard {
    pub yours: bool,
    pub expires_at: f64,
}

/// One "Mob bonuses" row of the owner's build summary: mob type code, HUD stat code, stacks (`>= 1`) and the
/// cumulative total in [`HUD_QUANTUM`] units.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WireMobBonusRow {
    pub mob_type: u8,
    pub stat: u8,
    pub stacks: u32,
    pub total: i32,
}

/// State key 13 (P-WIRE17-HUD-1): the owning seat's GAINED strip. `gains` in HUD stat code order, each in
/// [`HUD_QUANTUM`] units (fractions for 2,3,4,8; points for 0,1,5,6,7); `mob_rows` strictly ascending by `mob_type`,
/// at most [`MAX_SUMMARY_MOB_ROWS`].
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WireBuildSummary {
    pub gains: [i32; 9],
    pub mob_rows: Vec<WireMobBonusRow>,
}
/// Visible projectile fact, with no global projectile ID.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WireProjectile {
    pub kind: u8,
    pub x: u16,
    pub y: u16,
    pub facing: u16,
    pub owner: Option<u32>,
    /// Height above the ground position in whole sim units (protocol 16, ADR0024): the shooter's chest at launch.
    pub height: u8,
}
impl WireProjectile {
    fn valid(&self) -> bool {
        self.kind <= 1 && self.owner != Some(0)
    }
    fn len(&self) -> usize {
        9 + self.owner.map_or(0, varint_len)
    }
    fn write(&self, w: &mut Writer) {
        w.u8(self.kind);
        w.u16(self.x);
        w.u16(self.y);
        w.u16(self.facing);
        w.opt(self.owner.as_ref(), |w, id| w.varint(*id));
        w.u8(self.height);
    }
    fn read(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let v = Self {
            kind: r.u8()?,
            x: r.u16()?,
            y: r.u16()?,
            facing: r.u16()?,
            owner: r.opt(Reader::varint)?,
            height: r.u8()?,
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
            // P-WIRE17-HUD-1 stub: the reward and ward bytes are not on the wire yet.
            reward: None,
            ward: None,
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
                .map(|o| o.id.encoded_len() + 2 + o.taken_by.map_or(0, varint_len))
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
                WirePropKind::Body { label } | WirePropKind::Corpse { label } => {
                    str_fits("prop label", label)?
                }
                WirePropKind::WindEmblem => {}
                WirePropKind::Cannon { .. } => {}
                WirePropKind::QuestItem { .. } => {}
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
                            WirePropKind::WindEmblem => 0,
                            WirePropKind::QuestItem { quest, .. } => varint_len(quest.get()) + 1,
                            WirePropKind::Body { label } | WirePropKind::Corpse { label } => {
                                str_len(label)
                            }
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
                WirePropKind::Corpse { label } => {
                    w.u8(4);
                    w.str(label);
                }
                WirePropKind::WindEmblem => {
                    w.u8(5);
                }
                WirePropKind::Cannon { ready_at } => {
                    w.u8(6);
                    w.varint(*ready_at);
                }
                WirePropKind::QuestItem { quest, fetch } => {
                    w.u8(7);
                    w.varint(quest.get());
                    w.u8(u8::from(*fetch));
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
                4 => WirePropKind::Corpse { label: r.str()? },
                5 => WirePropKind::WindEmblem,
                6 => WirePropKind::Cannon {
                    ready_at: r.varint()?,
                },
                7 => WirePropKind::QuestItem {
                    quest: QuestHandle::new(r.varint()?)
                        .ok_or(DecodeError::BadField("quest handle"))?,
                    fetch: bool_flag(r)?,
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

fn valid_quest_point(point: WireQuestPoint) -> bool {
    point.x.is_finite()
        && point.y.is_finite()
        && (0.0..=8191.875).contains(&point.x)
        && (0.0..=8191.875).contains(&point.y)
}

impl WireQuestView {
    pub fn check(&self) -> Result<(), EncodeError> {
        if self.unknown_count > 20 || self.display_unknown_count > self.unknown_count {
            return Err(EncodeError::BadValue("quest counts"));
        }
        if self.roster.len() > MAX_QUEST_ROSTER {
            return Err(EncodeError::TooMany {
                what: "quest roster",
                n: self.roster.len(),
                max: MAX_QUEST_ROSTER,
            });
        }
        if self.rows.len() > MAX_QUEST_ROWS {
            return Err(EncodeError::TooMany {
                what: "quest rows",
                n: self.rows.len(),
                max: MAX_QUEST_ROWS,
            });
        }
        if self.objectives.len() > MAX_QUEST_OBJECTIVES {
            return Err(EncodeError::TooMany {
                what: "quest objectives",
                n: self.objectives.len(),
                max: MAX_QUEST_OBJECTIVES,
            });
        }
        let roster_ids: Vec<u32> = self.roster.iter().map(|entry| entry.id.get()).collect();
        for entry in &self.roster {
            str_fits("quest roster label", &entry.label)?;
        }
        if has_duplicates(&roster_ids) {
            return Err(EncodeError::BadValue("quest roster"));
        }
        if self
            .owner_roster
            .is_some_and(|id| !roster_ids.contains(&id.get()))
        {
            return Err(EncodeError::BadValue("quest references"));
        }
        let mut quest_ids = Vec::with_capacity(self.rows.len());
        for row in &self.rows {
            if row.def.is_empty()
                || row.def.len() > 16
                || row.state > 3
                || !valid_quest_point(row.giver)
                || !row.expires_at.is_finite()
                || row.expires_at < 0.0
                || row.owner_visited & !0x1f != 0
            {
                return Err(EncodeError::BadValue("quest row"));
            }
            if let Some(label) = &row.done_by {
                str_fits("quest done_by", label)?;
            }
            for (what, text) in [
                ("quest name", &row.name),
                ("quest giver label", &row.giver_label),
                ("quest brief", &row.brief),
                ("quest objective text", &row.objective),
                ("quest reward", &row.reward),
            ] {
                str_fits(what, text)?;
            }
            if row.participants.len() > MAX_QUEST_PARTICIPANTS {
                return Err(EncodeError::TooMany {
                    what: "quest participants",
                    n: row.participants.len(),
                    max: MAX_QUEST_PARTICIPANTS,
                });
            }
            let participant_ids: Vec<u32> =
                row.participants.iter().map(|part| part.id.get()).collect();
            if has_duplicates(&participant_ids)
                || row
                    .participants
                    .iter()
                    .any(|part| part.visited & !0x1f != 0 || !roster_ids.contains(&part.id.get()))
                || row
                    .carrier
                    .is_some_and(|id| !roster_ids.contains(&id.get()))
            {
                return Err(EncodeError::BadValue("quest references"));
            }
            quest_ids.push(row.handle.get());
        }
        if has_duplicates(&quest_ids) {
            return Err(EncodeError::BadValue("quest handles"));
        }
        let mut per_quest = vec![0u8; self.rows.len()];
        for objective in &self.objectives {
            if !valid_quest_point(objective.at) {
                return Err(EncodeError::BadValue("quest objective"));
            }
            let Some(index) = quest_ids.iter().position(|&id| id == objective.quest.get()) else {
                return Err(EncodeError::BadValue("quest references"));
            };
            per_quest[index] = per_quest[index].saturating_add(1);
            if usize::from(per_quest[index]) > MAX_QUEST_OBJECTIVES_PER_ROW {
                return Err(EncodeError::TooMany {
                    what: "quest objectives per row",
                    n: usize::from(per_quest[index]),
                    max: MAX_QUEST_OBJECTIVES_PER_ROW,
                });
            }
        }
        if 1 + self.encoded_len() > MAX_QUEST_VIEW_BYTES {
            return Err(EncodeError::TooLarge {
                len: 1 + self.encoded_len(),
                max: MAX_QUEST_VIEW_BYTES,
            });
        }
        Ok(())
    }

    fn encoded_len(&self) -> usize {
        varint_len(self.unknown_count)
            + varint_len(self.display_unknown_count)
            + varint_len(self.owner_roster.map_or(0, RosterId::get))
            + varint_len(self.roster.len() as u32)
            + self
                .roster
                .iter()
                .map(|entry| varint_len(entry.id.get()) + str_len(&entry.label))
                .sum::<usize>()
            + varint_len(self.rows.len() as u32)
            + self
                .rows
                .iter()
                .map(WireQuestRow::encoded_len)
                .sum::<usize>()
            + varint_len(self.objectives.len() as u32)
            + self
                .objectives
                .iter()
                .map(WireQuestObjective::encoded_len)
                .sum::<usize>()
    }

    fn write(&self, w: &mut Writer) {
        w.varint(self.unknown_count);
        w.varint(self.display_unknown_count);
        w.varint(self.owner_roster.map_or(0, RosterId::get));
        w.varint(self.roster.len() as u32);
        for entry in &self.roster {
            w.varint(entry.id.get());
            w.str(&entry.label);
        }
        w.varint(self.rows.len() as u32);
        for row in &self.rows {
            row.write(w);
        }
        w.varint(self.objectives.len() as u32);
        for objective in &self.objectives {
            objective.write(w);
        }
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let unknown_count = r.varint()?;
        let display_unknown_count = r.varint()?;
        let owner_roster = roster_id_or_none(r.varint()?)?;
        let roster_len = r.varint()? as usize;
        if roster_len > MAX_QUEST_ROSTER {
            return Err(DecodeError::TooMany(roster_len));
        }
        let mut roster = Vec::with_capacity(roster_len);
        for _ in 0..roster_len {
            roster.push(WireRosterEntry {
                id: roster_id(r.varint()?)?,
                label: r.str()?,
            });
        }
        let rows_len = r.varint()? as usize;
        if rows_len > MAX_QUEST_ROWS {
            return Err(DecodeError::TooMany(rows_len));
        }
        let mut rows = Vec::with_capacity(rows_len);
        for _ in 0..rows_len {
            rows.push(WireQuestRow::read(r)?);
        }
        let objectives_len = r.varint()? as usize;
        if objectives_len > MAX_QUEST_OBJECTIVES {
            return Err(DecodeError::TooMany(objectives_len));
        }
        let mut objectives = Vec::with_capacity(objectives_len);
        for _ in 0..objectives_len {
            objectives.push(WireQuestObjective::read(r)?);
        }
        let view = Self {
            unknown_count,
            display_unknown_count,
            owner_roster,
            roster,
            rows,
            objectives,
        };
        view.check().map_err(quest_decode_error)?;
        Ok(view)
    }
}

impl WireQuestRow {
    fn encoded_len(&self) -> usize {
        varint_len(self.handle.get())
            + str_len(&self.def)
            + 16
            + 1
            + 8
            + varint_len(self.participants.len() as u32)
            + self
                .participants
                .iter()
                .map(|part| varint_len(part.id.get()) + 1 + varint_len(part.progress) + 1)
                .sum::<usize>()
            + varint_len(self.carrier.map_or(0, RosterId::get))
            + 1
            + self.done_by.as_deref().map_or(0, str_len)
            + 1
            + varint_len(self.owner_progress)
            + 1
            + str_len(&self.name)
            + str_len(&self.giver_label)
            + str_len(&self.brief)
            + str_len(&self.objective)
            + str_len(&self.reward)
    }
    fn write(&self, w: &mut Writer) {
        w.varint(self.handle.get());
        w.str(&self.def);
        w.f64(self.giver.x);
        w.f64(self.giver.y);
        w.u8(self.state);
        w.f64(self.expires_at);
        w.varint(self.participants.len() as u32);
        for part in &self.participants {
            w.varint(part.id.get());
            w.u8(u8::from(part.accepted));
            w.varint(part.progress);
            w.u8(part.visited);
        }
        w.varint(self.carrier.map_or(0, RosterId::get));
        w.opt(self.done_by.as_ref(), |w, label| w.str(label));
        w.u8(u8::from(self.can_accept)
            | (u8::from(self.owner_accepted) << 1)
            | (u8::from(self.owner_completed) << 2)
            | (u8::from(self.owner_ready) << 3));
        w.varint(self.owner_progress);
        w.u8(self.owner_visited);
        w.str(&self.name);
        w.str(&self.giver_label);
        w.str(&self.brief);
        w.str(&self.objective);
        w.str(&self.reward);
    }
    fn read(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let handle = quest_handle(r.varint()?)?;
        let def = r.str()?;
        let giver = WireQuestPoint {
            x: r.f64()?,
            y: r.f64()?,
        };
        let state = r.u8()?;
        if state > 3 {
            return Err(DecodeError::BadField("quest status"));
        }
        let expires_at = r.f64()?;
        let count = r.varint()? as usize;
        if count > MAX_QUEST_PARTICIPANTS {
            return Err(DecodeError::TooMany(count));
        }
        let mut participants = Vec::with_capacity(count);
        for _ in 0..count {
            participants.push(WireQuestParticipant {
                id: roster_id(r.varint()?)?,
                accepted: quest_bool(r)?,
                progress: r.varint()?,
                visited: r.u8()?,
            });
        }
        let carrier = roster_id_or_none(r.varint()?)?;
        let done_by = if quest_bool(r)? { Some(r.str()?) } else { None };
        let flags = r.u8()?;
        if flags & !0x0f != 0 {
            return Err(DecodeError::BadField("quest flags"));
        }
        let owner_progress = r.varint()?;
        let owner_visited = r.u8()?;
        Ok(Self {
            handle,
            def,
            giver,
            state,
            expires_at,
            participants,
            carrier,
            done_by,
            can_accept: flags & 1 != 0,
            owner_accepted: flags & 2 != 0,
            owner_completed: flags & 4 != 0,
            owner_ready: flags & 8 != 0,
            owner_progress,
            owner_visited,
            name: r.str()?,
            giver_label: r.str()?,
            brief: r.str()?,
            objective: r.str()?,
            reward: r.str()?,
        })
    }
}

impl WireQuestObjective {
    fn encoded_len(&self) -> usize {
        varint_len(self.quest.get()) + 16
    }
    fn write(&self, w: &mut Writer) {
        w.varint(self.quest.get());
        w.f64(self.at.x);
        w.f64(self.at.y);
    }
    fn read(r: &mut Reader<'_>) -> Result<Self, DecodeError> {
        Ok(Self {
            quest: quest_handle(r.varint()?)?,
            at: WireQuestPoint {
                x: r.f64()?,
                y: r.f64()?,
            },
        })
    }
}

fn quest_handle(value: u32) -> Result<QuestHandle, DecodeError> {
    QuestHandle::new(value).ok_or(DecodeError::BadField("quest handle"))
}
fn roster_id(value: u32) -> Result<RosterId, DecodeError> {
    RosterId::new(value).ok_or(DecodeError::BadField("quest roster id"))
}
fn roster_id_or_none(value: u32) -> Result<Option<RosterId>, DecodeError> {
    if value == 0 {
        Ok(None)
    } else {
        roster_id(value).map(Some)
    }
}
fn quest_bool(r: &mut Reader<'_>) -> Result<bool, DecodeError> {
    match r.u8()? {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(DecodeError::BadField("quest flag")),
    }
}
fn quest_decode_error(error: EncodeError) -> DecodeError {
    match error {
        EncodeError::TooMany { n, .. } => DecodeError::TooMany(n),
        EncodeError::TooLarge { len, .. } => DecodeError::TooLarge(len),
        EncodeError::BadValue(name) => DecodeError::BadField(name),
        _ => DecodeError::BadField("quest"),
    }
}
fn has_duplicates(values: &[u32]) -> bool {
    values
        .iter()
        .enumerate()
        .any(|(i, value)| values[..i].contains(value))
}

/// Validate a candidate's Props and Quest collection together. Stateful publishers call this after retained and replaced
/// collections have been reconstructed; a stateless State patch may carry either key alone.
pub fn validate_quest_props(
    props: &WireProps,
    quests: Option<&WireQuestView>,
) -> Result<(), EncodeError> {
    props.check()?;
    if let Some(view) = quests {
        view.check()?;
    }
    for row in &props.rows {
        if let WirePropKind::QuestItem { quest, .. } = &row.kind {
            if !quests.is_some_and(|view| view.rows.iter().any(|q| q.handle == *quest)) {
                return Err(EncodeError::BadValue("quest prop reference"));
            }
        }
    }
    Ok(())
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
            Self::Quests(_) => 10,
            Self::Trade(_) => 11,
            Self::Roster(_) => 12,
            Self::BuildSummary(_) => 13,
        }
    }
    pub(crate) fn encoded_len(&self) -> usize {
        varint_len(self.key())
            + match self {
                Self::Inventory(value) => 1 + usize::from(value.is_some()) * 6,
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
                Self::Quests(value) => 1 + value.as_ref().map_or(0, WireQuestView::encoded_len),
                Self::Trade(value) => 1 + value.as_ref().map_or(0, WireTradeView::encoded_len),
                Self::Roster(rows) => {
                    1 + rows
                        .iter()
                        .map(|row| varint_len(row.id) + 1 + 1 + row.name.len())
                        .sum::<usize>()
                }
                // P-WIRE17-HUD-1 stub: not encodable yet (check refuses it).
                Self::BuildSummary(_) => 1,
            }
    }
    pub(crate) fn check(&self) -> Result<(), EncodeError> {
        match self {
            Self::Inventory(Some(value)) => {
                if value.active_slot > 1 {
                    return Err(EncodeError::BadValue("active slot"));
                }
                if value.potion_small > 5 || value.potion_large > 5 || value.potions_healing > 3 {
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
            Self::Quests(Some(value)) => value.check()?,
            Self::Quests(None) => {}
            Self::Trade(Some(value)) => value.check()?,
            Self::Trade(None) => {}
            Self::Roster(rows) => {
                if let Some(why) = roster_fault(rows) {
                    return Err(EncodeError::BadValue(why));
                }
            }
            // P-WIRE17-HUD-1 stub: the layout is fixed in the packet brief; the implementer encodes it.
            Self::BuildSummary(_) => {
                return Err(EncodeError::BadValue("build summary not implemented"));
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
                    w.u8(value.potion_large);
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
            Self::Quests(value) => {
                w.u8(u8::from(value.is_some()));
                if let Some(view) = value {
                    view.write(w);
                }
            }
            Self::Trade(value) => {
                w.u8(u8::from(value.is_some()));
                if let Some(view) = value {
                    view.write(w);
                }
            }
            Self::Roster(rows) => {
                w.u8(rows.len() as u8);
                for row in rows {
                    w.varint(row.id);
                    w.u8(if row.bot { ROSTER_FLAG_BOT } else { 0 });
                    w.str(&row.name);
                }
            }
            // P-WIRE17-HUD-1 stub: never reached (check refuses the item).
            Self::BuildSummary(_) => w.u8(0),
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
                let potion_large = r.u8()?;
                let potions_healing = r.u8()?;
                if potion_small > 5 || potion_large > 5 || potions_healing > 3 {
                    return Err(DecodeError::BadField("potion count"));
                }
                Ok(WireInventory {
                    active_slot,
                    slots,
                    potion_small,
                    potion_large,
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
            10 => {
                let start = r.position();
                let value = match quest_bool(r)? {
                    false => None,
                    true => Some(WireQuestView::read(r)?),
                };
                let payload_len = r.position() - start;
                if payload_len > MAX_QUEST_VIEW_BYTES {
                    return Err(DecodeError::TooLarge(payload_len));
                }
                Self::Quests(value)
            }
            11 => {
                let start = r.position();
                let value = match trade_bool(r)? {
                    false => None,
                    true => Some(WireTradeView::read(r)?),
                };
                let payload_len = r.position() - start;
                if payload_len > MAX_TRADE_VIEW_BYTES {
                    return Err(DecodeError::TooLarge(payload_len));
                }
                Self::Trade(value)
            }
            12 => {
                let n = usize::from(r.u8()?);
                if n > MAX_ROSTER {
                    return Err(DecodeError::BadField("roster count"));
                }
                let mut rows = Vec::with_capacity(n);
                for _ in 0..n {
                    let id = r.varint()?;
                    let bot = match r.u8()? {
                        0 => false,
                        ROSTER_FLAG_BOT => true,
                        _ => return Err(DecodeError::BadField("roster flags")),
                    };
                    let name = r.str()?;
                    rows.push(WireRosterRow { id, bot, name });
                }
                if let Some(why) = roster_fault(&rows) {
                    return Err(DecodeError::BadField(why));
                }
                Self::Roster(rows)
            }
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
    let props = items.iter().find_map(|item| match item {
        StateItem::Props(value) => Some(value),
        _ => None,
    });
    let quests_item = items.iter().find_map(|item| match item {
        StateItem::Quests(value) => Some(value),
        _ => None,
    });
    if let (Some(props), Some(quests)) = (props, quests_item) {
        validate_quest_props(props, quests.as_ref())?;
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
    let props = items.iter().find_map(|item| match item {
        StateItem::Props(value) => Some(value),
        _ => None,
    });
    let quests_item = items.iter().find_map(|item| match item {
        StateItem::Quests(value) => Some(value),
        _ => None,
    });
    if let (Some(props), Some(quests)) = (props, quests_item) {
        validate_quest_props(props, quests.as_ref())
            .map_err(|_| DecodeError::BadField("quest prop reference"))?;
    }
    Ok(items)
}
