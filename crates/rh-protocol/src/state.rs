//! Complete replacements for observer-owned collections. Keys and handles are strict per wire version.
use crate::codec::{str_fits, str_len, varint_len};
use crate::{DecodeError, EncodeError, Reader, Writer};
use std::num::NonZeroU32;

mod camp;
mod handles;
mod item;
mod plan;
mod props;
mod quest;
mod reward;
mod roster;
mod trade;

pub use self::camp::*;
pub use self::handles::*;
pub(crate) use self::item::*;
use self::plan::*;
use self::props::*;
pub use self::quest::*;
pub use self::reward::*;
pub use self::roster::*;
pub use self::trade::*;

/// Keys 1..=15; key 14 (P-WIRE19-B, the own readout rows) and key 15 (P-AUG-NATIVE-5, the public Marked Man rows) are
/// optional and sent only on change.
pub const MAX_STATE_KEYS: usize = 15;
/// Most roster rows a State key 12 carries (ADR0026); a match seats at most 8 players today.
pub const MAX_ROSTER: usize = 32;
/// Longest roster display name in UTF-8 bytes (ADR0026).
pub const MAX_ROSTER_NAME: usize = 24;
/// Roster row flag: the seat is a bot.
pub const ROSTER_FLAG_BOT: u8 = 1;
/// Largest room minimum players State key 9 accepts (P-WIRE17-HUD-3): the roster bound; a match seats at most 8.
pub const MAX_MIN_PLAYERS: u8 = MAX_ROSTER as u8;
pub const MAX_VISIBLE_PROPS: usize = 512;
pub const MAX_VISIBLE_FIELDS: usize = 512;
/// P-FROST-WALL-2: State key 3 field kind codes (`rh_sim::status_runtime::FieldKind` order). A code at or above
/// [`FIELD_KIND_COUNT`] is refused ("field").
pub const FIELD_KIND_ZONE: u8 = 0;
pub const FIELD_KIND_CLOUD: u8 = 1;
pub const FIELD_KIND_TRAIL: u8 = 2;
/// A standing Frost Wall: the only kind whose row carries a tile list.
pub const FIELD_KIND_WALL: u8 = 3;
/// Number of field kind codes: zone, cloud, trail, wall.
pub const FIELD_KIND_COUNT: u8 = 4;
/// Most tiles one wall row may carry (P-FROST-WALL-2): a wall takes at most 17 tiles with the legacy numbers (length
/// 224, reach 24, end slack 8, any angle); 64 leaves room for a retune. A count of 0 or above this is "wall tiles".
pub const MAX_WALL_TILES: usize = 64;
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
    /// P-WIRE19-A (protocol 19): the killer first-pick window while it is in force (P-ELITE-PICK-1). Its end is public;
    /// `mine` is the viewer's own fact (true only in the killer's row). Never a player id (C-OBS).
    pub first_pick: Option<WireFirstPick>,
}
/// P-WIRE19-A: a reward chest's first-pick window as one viewer sees it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WireFirstPick {
    /// The window's end, server ms (open while `server_ms < until`).
    pub until: f64,
    /// Whether the window is this viewer's own.
    pub mine: bool,
}
/// P-WIRE19-B (protocol 19, State key 14): most readout rows one viewer receives (two per native card; equal to
/// `rh_sim::cards::native::MAX_READOUTS`).
pub const MAX_READOUTS: usize = 28;
/// P-WIRE19-B: readout kind codes (`rh_sim::cards::native::ReadoutKind` order). A code at or above
/// [`READOUT_KIND_COUNT`] is refused ("readout kind").
pub const READOUT_KIND_COUNTER: u8 = 0;
pub const READOUT_KIND_METER: u8 = 1;
pub const READOUT_KIND_MARKS: u8 = 2;
/// Number of readout kind codes: counter, meter, marks.
pub const READOUT_KIND_COUNT: u8 = 3;
/// P-WIRE19-B: one of the viewer's own native readout rows (C-OBS: never another player's). `card` is a native
/// `CardId` index (80..=93), `kind` a `READOUT_KIND_*` code; `value` and `max` are finite with `0 <= value <= max`.
/// On the wire (brief `docs/backlog/packets/P-WIRE19-B.md`): `u8 card, u8 kind, f64 value, f64 max`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WireReadout {
    pub card: u8,
    pub kind: u8,
    pub value: f64,
    pub max: f64,
}
impl WireReadout {
    /// Bytes a row: card, kind, value, max.
    pub(crate) const LEN: usize = 18;
    /// The first native card index (`CardId::NATIVE`); a catalog card never has a readout.
    const FIRST_CARD: u8 = 80;
    /// The last native card index.
    const LAST_CARD: u8 = 93;
    /// Why this row is refused after a row of card `previous`, checked in the wire order: card, kind, value and max,
    /// then native order (a card never decreases; two rows of one card are allowed).
    pub(crate) fn fault(&self, previous: Option<u8>) -> Result<(), &'static str> {
        if !(Self::FIRST_CARD..=Self::LAST_CARD).contains(&self.card) {
            return Err("readout card");
        }
        if self.kind >= READOUT_KIND_COUNT {
            return Err("readout kind");
        }
        if !(self.value.is_finite()
            && self.max.is_finite()
            && self.value >= 0.
            && self.value <= self.max)
        {
            return Err("readout value");
        }
        if previous.is_some_and(|p| self.card < p) {
            return Err("readout order");
        }
        Ok(())
    }
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

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WireInventory {
    pub active_slot: u8,
    /// Carried weapon codes0..4; an empty slot is distinct from fists.
    pub slots: [Option<u8>; 2],
    pub potion_small: u8,
    pub potion_large: u8,
    pub potions_healing: u8,
    /// P-WIRE17-HUD-3: server ms the running healing potions end (legacy `healingUntil`); `None` when none runs.
    pub healing_until: Option<f64>,
    /// P-WIRE17-HUD-3: server ms the wind emblem's speed boost ends (legacy `speedBoostUntil`); `None` when none runs.
    pub speed_boost_until: Option<f64>,
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
    /// A coliseum heal pickup with the server time it is available again (0: available now). Prop kind 8, the cannon's
    /// layout (protocol 20, P-COLISEUM-HEALS-2). Never the focus: it holds no item.
    Heal {
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
#[derive(Clone, Debug, PartialEq)]
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
    /// P-FROST-WALL-2: a wall's tiles (kind [`FIELD_KIND_WALL`] only): row-major tile indices into the Welcome map,
    /// strictly ascending, 1..=[`MAX_WALL_TILES`] of them, each below `map::MAX_MAP_TILES`. Empty for every other kind.
    /// On the wire only for a wall row, after `ends_at`: `count u8 | count x tile u32 LE`.
    pub tiles: Vec<u32>,
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
    /// P-WIRE17-HUD-3: the room's minimum players (legacy `RaidState.minPlayers`), 0..=[`MAX_MIN_PLAYERS`].
    pub min_players: u8,
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
    /// Key 14 (P-WIRE19-B): the viewer's own native readout rows, in native order; never another seat's. Sent only when
    /// the rows change (a client's rows start empty), so a viewer without native cards never receives it.
    Readouts(Vec<WireReadout>),
    /// Key 15 (P-AUG-NATIVE-5): every `Alive` Marked Man holder's position, the same for every viewer (the minimap
    /// marker). Sent only when the rows change (a client's rows start empty).
    Marked(Vec<WireMarked>),
}

/// P-AUG-NATIVE-5: one Marked Man holder: its actor id and position (brief
/// `docs/backlog/packets/P-AUG-NATIVE-5.md`, "Wire layout"): `varint id, u16 x, u16 y` (actor quantization).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WireMarked {
    pub id: u32,
    pub x: f32,
    pub y: f32,
}

impl WireMarked {
    /// The reason a row after one with id `previous` (0 for the first) is refused: id 0, then the order.
    pub(crate) fn id_fault(id: u32, previous: u32) -> Option<&'static str> {
        if id == 0 {
            Some("marked id")
        } else if id <= previous {
            Some("marked order")
        } else {
            None
        }
    }
    pub(crate) fn len(&self) -> usize {
        varint_len(self.id) + 4
    }
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
