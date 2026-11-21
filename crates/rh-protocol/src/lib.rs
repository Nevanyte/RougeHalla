//! Roguehalla wire protocol, version [`PROTOCOL_VERSION`]. One message per WebSocket BINARY frame (the only transport a
//! browser build can use; served as wss:// in production). Little-endian, no reflection: the C# mirror
//! (`client-unity/RoguehallaNet`) and the JS probe decode the same bytes, and all are held to the golden vectors in
//! `protocol/fixtures/v<PROTOCOL_VERSION>.json` (docs/CONTRACTS.md C-NET).
//!
//! Frame layout: `[tag u8][body]`. Strings: `u8 length + UTF-8`. Blobs: `u16 length + bytes`. Optional values: `u8 flag (0/1) +
//! value`. Lists: `u16 count + items`. Floats are IEEE-754; a decoder REJECTS non-finite floats in client messages. Unknown
//! tags and trailing bytes are malformed. Size limits are enforced before decoding ([`MAX_CLIENT_FRAME`], [`MAX_SERVER_FRAME`]).
//!
//! Counters are canonical unsigned LEB128 varints ([`Writer::varint`]); a decoder rejects a longer-than-necessary form. A
//! Snapshot's source clock defaults to `tick * tick_ms` (protocol 21: `tick_ms = 1000 / Welcome.tick_rate`, 50 ms at 20 Hz
//! and 25 ms at 40 Hz, the only rates a decoder accepts; [`snapshot_server_ms_at`]); protocol 12 carries an absolute f64 override
//! only when that frame's clock differs, and an omitted delta override always resolves from that delta's tick. The SELF view keeps full precision
//! (prediction and reconciliation need it); remote actors and swing effects are quantized ([`quant`]: positions 1/8 u, angles
//! 2 pi / 65536, hp_pct exact). Factions and weapons are 4-bit codes, status and phase 2-bit codes: the encoders refuse a larger
//! one ([`EncodeError::BadValue`]) rather than truncate it.
//!
//! # Combat records (v5; docs/adr/0012-combat-protocol-v5.md)
//!
//! Input command 6: Swap, strict option flag then slot 0/1; absent toggles. Command 7: Pickup, nonzero observer-issued handle u32 (never a world container ID).
//! Hit (Fx 2) adds a strict passive flag after its amount f32. Block (Fx 3) carries id varint, source varint, weapon u8;
//! Stagger (Fx 4) carries id varint. Source u32::MAX means absent or redacted for Hit and Block.
//! PickupRefused (Events 5) carries only its owner-filtered reason byte: append-only 1 Blocked, 2 NothingThere,
//! 3 TooFar, 4 Unreachable, 5 NothingToTake; all other values are refused. No private recipient id is sent.
//!
//! Protocol 6 adds Choose (8: handle u32 + pick i8 -1..=2), UseConsumable (9: no body),
//! Target (10: nonzero actor reference u32), and AttackMove (11: Move payload).
//! Protocol 7 adds HuntTarget (12: nonzero actor reference u32) and the self hunt fields
//! (Full head bits 14/15, delta bits 18/19; the target is a nonzero varint, stacks a varint).
//! PotionNotice (Events 7) carries only a notice byte 1..=10. Camps carry direct mob type 0..29,
//! optional elite as 0 absent / 1+index, alive varint <=512, state 0..=2, and finite nonnegative
//! cleared/respawn f64 times with respawn >= cleared. At most 512 rows and eleven ascending State keys.
//!
//! Source planning/lifecycle transport: Plan (command 14): a flags u8 (bit 0 spawn, bit 1 boon,
//! bit 2 ready) and the present fields in order (spawn u8 0/1, boon u8 0/1, ready u8 0/1); it is accepted only during the
//! planning phase and goes through the ordinary input frame so the simulation's action order still applies. A Snapshot
//! phase code 3 is Planning (0 lobby, 1 active, 2 ended). Teleport (Fx 5) has no body. State key 8 is the viewer's own
//! private plan (never another player's): ends_at f64, spawns (two optional non-negative pool indices), taken (two flags),
//! pick (0 absent / 1 = option 0 / 2 = option 1), boons (<= 4 byte-len strings), boon (same 0/1/2 code) and ready, plus the
//! two server-resolved option facts (pool index, quantized position, zone code 1..=5, optional walk seconds f32). State key
//! 9 is the public arena lifecycle view: lobby/plan/raid timers, optional patience deadline, in-coliseum and gates-locked
//! flags, the sudden-death deadline and the starter count. Both keys are complete replacements; key 8 is only ever built
//! from the owner's own observation.
//!
//! Travel cannon: prop kind 6 (Cannon) carries the load-ready varint after its position, and
//! CannonNotice (Events 9) carries only a notice code byte (1 sealed, 2 cannot enter, 3 blast) plus, for code 4
//! (reloading), the source's rounded-up remaining whole seconds as u16 1..=75. Both are owner-filtered where they name a
//! player and never carry a world container id.
//!
//! Protocol 20 adds prop kind 8 (Heal): a grand-coliseum heal pickup with the cannon's layout, `handle varint | x u16 |
//! y u16 | 8 u8 | ready_at varint` (server ms it is available again; 0 when available). It holds no item, so it is never
//! the focus. No mask bit, key or delta change; every other prop kind keeps its bytes, and a kind byte past 8 is refused.
//!
//! Protocol 12 adds Cast (command 16: slot u8 0..=2, x/y f32, strict optional nonzero fixed-u32 actor, strict optional f64
//! event time, strict optional sequence u8); WishStarted/Landed/Ended (Fx 6/7/8); owner Wish and barrier groups in self; and
//! barrier share/ring fields on remote actors. Wish records are owner-only complete replacements. Every new optional flag
//! accepts only 0 or 1. Wish charges use max 1..=2 and current <= max; public times must be finite and nonnegative. Landed
//! Blaze requires anchor and destination together or neither; other abilities cannot carry a destination, and a Landed record
//! must identify a caster or carry geometry. Fx event times and durations are source f64 values, not tick-derived.
//!
//! Protocol 11 combines the independent branch additions. Commands 12 HuntTarget, 13 ConsumeCorpse,
//! 14 Plan and 15 Train are distinct. Events 8 WindEmblem, 9 CannonNotice and 10 Toast are distinct.
//! Props 4 Corpse, 5 WindEmblem and 6 Cannon are distinct. Actor kinds: 0 player, 1 regional mob,
//! 2 zombie, 3 training dummy. State keys 8 private Plan and 9 public Arena remain complete replacements; key 10 carries only the private quest observer view and key 11 carries the private owner trade view.
//! Build carries all 80 card counts followed by eight boosts. Inventory carries small, large and active-healing counts.
//! Hunt uses Full self bits 14/15 and Delta self bits 18/19. Training is independent of self, Full bit 16 and
//! Delta bit 20; the bit is the value on every frame. A Delta hunt-target value of zero clears it; a present
//! Full hunt target and HuntTarget command must remain nonzero. Every old major is refused at admission.
//!
//! Protocol 16 adds the legacy indicator facts (docs/adr/0026-legacy-indicator-facts.md): Hit (Fx 2) turns its passive byte
//! into flags (bit 0 passive, bit 1 critical); Windup (Fx 9: by varint, weapon u8, angle u16, ms u16), Cancel (Fx 10: id
//! varint), SigHit (Fx 11: victim varint, source varint, kind u8, amount f32) and Heal (Fx 12: id varint, amount f32);
//! CampCleared (Events 11: camp u16); State key 12, the roster.
//!
//! # Field masks (protocol v4; docs/adr/0011-protocol-v4.md)
//!
//! Every presence mask (the Full head, the Full actor mask, the Delta head, the actor-delta mask) is a canonical LEB128
//! varint: one byte while its set bits are below bit 7, so the common frame pays nothing for the room to grow. Bit numbers are
//! APPEND ONLY: a bit is never renumbered or reused; a new field is a new top bit plus its codec arm in the three decoders
//! (Rust, C#, JS). A decoder still REFUSES a bit it does not know (strict per version: nothing is skippable), so a mask can only
//! gain bits in a version bump. Lifecycle status and the match phase are ordinary fields: a field equal to its default is left
//! out and its bit is clear ([`DEFAULT_STATUS`] alive, [`DEFAULT_PHASE`] active, kind 0 = player).
//!
//! ```text
//! Snapshot  0x83, tick varint, ack_input varint, head varint, [self], actor_count varint (<= MAX_ACTORS), actors
//!   head bits  0 a self follows   1 kit   2 hp   3 ready_in_ms   4 kills   5 bounty   6 move_seq   7 gv   8 max_hp is an f32
//!              9 status   10 phase   11 effects u16   12 displacement u8   13 sig u8   14 hunt target varint   15 hunt stacks varint
//!              16 training   17 Wish owner group   18 barrier f32 + ring step u8   19 source time f64 (global)
//!   [self: id varint, x f32, y f32, facing f32, max_hp (f32 with bit 8, else a varint in 0..=65535), then per set bit, in
//!      bit order: 1 kit u8 (faction | weapon << 4; default 0)  2 hp f32 (default = max_hp)  3 ready_in_ms u16 (0)
//!      4 kills varint (0)  5 bounty varint (0)  6 move_seq u8 (0)  7 gv varint (0)  9 status u8 0..=3 (default 1)
//!      11 effects u16 (0)  12 displacement u8 (0)  13 sig u8 (0)  14 hunt target varint  15 hunt stacks varint
//!      17 Wish owner record (ability, ready_at, optional full_at, max_charges, recharge_ms, charges, optional next_charge_at, optional cast)
//!      18 barrier f32 + ring step u8; then phase u8 0..=3 with head bit 10 (default 1), then optional global source time f64]
//!   per actor (the observation sorts them by id; ids must strictly ascend): id varint (the first actor's id, then the gap
//!     from the previous one), mask varint, x u16, y u16, facing u16, then per mask bit: 0 kit u8 (default 0)
//!     1 hp_pct u8 (default 100)  2 status u8 0..=3 (default 1)  3 bounty varint (0)  4 kind u8 (0 = player)  5 effects u16 (0)  6 displacement u8 (0)  7 mob_type_code u8 (0..=30)  8 sig u8 (0)  9 barrier_pct u8 + ring step u8
//!     10 archetype u8  11 indicator flags u8  12 off-hand u8 (0 empty, weapon + 1)  13 build marks u8 (two 4-bit stat keys)
//!     14 mark plate: tier u8, brand u8, tax u8 (protocol 16; ADR0024, ADR0026)
//!     15 walk hint: walk_dir u8, walk_ticks u8, set only while walk_ticks != 0; absent is (0, 0) (protocol 19)
//!   protocol 16 head bits: 20 owner combat (after the actors)  21 archetype u8  22 indicator flags u8  23 build marks u8
//!     24 mark plate (tier, brand, tax), self fields in bit order after the barrier pair
//! SnapshotDelta 0x87, tick varint, base_age varint (tick - base tick, 1..=MAX_DELTA_AGE_MS / tick_ms: 64 at 20 Hz, 128 at 40 Hz), ack_input varint, head varint
//!   head bits  0 a self follows (its id is the base's)   1 x   2 y   3 facing   4 move_seq   5 hp   6 ready_in_ms
//!              7 a departed list follows   8 phase   9 max_hp   10 kit   11 kills   12 bounty   13 gv   14 status   15 effects u16   16 displacement u8   17 sig u8
//!              18 hunt target varint   19 hunt stacks varint   20 training   21 Wish optional owner record   22 barrier f32 + ring step u8   23 source time f64 (global)
//!   [self fields, in bit order, only those whose bit is set: x f32, y f32, facing f32, move_seq u8, hp f32, ready_in_ms u16,
//!      max_hp f32, kit u8, kills varint, bounty varint, gv varint, status u8 (0..=3), effects u16, displacement u8, sig u8,
//!      hunt target varint (zero clears), hunt stacks varint, Wish strict optional record, barrier f32 + ring step u8]   self bits need bit 0
//!   [phase u8 (0..=3) with bit 8, then optional source time f64 with bit 23: the delta clock is absolute and never inherited from the base]
//!   changed_count varint (<= MAX_ACTORS), then per changed actor, ascending by id: id varint (the first's id, then the gap),
//!     mask varint, then per mask bit: 0 x u16  1 y u16  2 facing u16  3 kit u8  4 hp_pct u8  5 bounty varint  6 status u8
//!     7 kind u8  8 effects u16  9 displacement u8  10 mob_type_code u8 (0..=30)  11 sig u8. A NEW actor (not in the base) starts from the default actor and must carry bits 0..=2 (its position).
//!     Protocol 16: delta head bits 24 owner combat, 25 archetype, 26 indicator flags, 27 build marks, 28 mark plate; actor delta
//!     bits 12 barrier pair, 13 archetype, 14 indicator flags, 15 off-hand, 16 build marks, 17 mark plate (ADR0024, ADR0026).
//!     Protocol 19: actor delta bit 18 walk hint (walk_dir u8, walk_ticks u8; (0, 0) clears it).
//!   [departed_count varint (1..=MAX_ACTORS), then the ids: the first's id, then gaps]    only with head bit 7
//! ```
//!
//! # Snapshots and deltas (v3, unchanged in v4)
//!
//! A connection's snapshots are either FULL (tag 0x83) or a DELTA (tag 0x87) against the last snapshot that connection's writer
//! wrote to the socket. TCP is ordered and reliable, so that base needs no client ack: the client's base is simply the last
//! snapshot it applied. Module [`delta`] has the writer-side [`ConnEncoder`] (which picks Full or Delta per frame) and the
//! reader-side [`SnapshotTracker`] (which REFUSES, never repairs, a delta it cannot apply: unknown base, unknown or departed
//! actor, out-of-range field). `Resync` (0x05, client to server, no body) asks for a Full snapshot; the server honours at most
//! one per second.
//!
//! The writer sends a Full snapshot for the first one after a Welcome (a resumed connection always starts so), after a
//! `Resync`, when its base is older than [`MAX_DELTA_AGE_MS`] (64 ticks at 20 Hz), when the self appears or changes id, and whenever the
//! delta would not be smaller than the full frame. The room never encodes a snapshot: it hands each connection's writer the
//! observation's wire data ([`SnapshotData`]), so a snapshot a slow client skips is never encoded at all.
//!
//! # Channels and keyed State (v6)
//!
//! Three channels carry the game to a client: Snapshot (per-tick scalars, lossless chain), Events (reliable one-shot
//! announcements) and Fx (droppable). Anything else the client needs to KEEP (collections, match-level state) is KEYED STATE:
//! `State 0x88, tick varint, count varint, then per item [key varint][record]`, the latest value per key, the record layout
//! defined by the key. Keys are unique and ascending: 1 self inventory, 2 props/focus, 3 visible fields,
//! 4 reward offers, 5 self build, 6 camp summaries, 7 visible projectiles, 8 the viewer's own plan, 9 the public arena
//! lifecycle, 10 the viewer's quest view (explicitly unavailable when disabled). A key 3 row of field kind 3 (a standing
//! Frost Wall, P-FROST-WALL-2) alone continues with its tile list (`count u8`, then that many u32 tile indices).
//! Each is a complete replacement; missing keys retain their last value. Module [`state`]
//! defines strict bounds and record layouts. Welcome (join and resume) is followed by all eleven keys, even empty,
//! so a resumed or recovered client never depends on an
//! event it may have missed; events stay for one-shot announcements. The player's own `Result` is the one event the server
//! keeps and re-sends after a resume.
//!
//! # Actor ids
//!
//! A wire actor id names one entity for the whole match, across every kind of entity (players, and later mobs), and is never
//! reused within a match; `kind` says what it is (0 = player). See docs/CONTRACTS.md C-NET.
//!
//! This crate does not depend on the simulation: the server maps sim types to these wire types, so internal refactors never
//! change the wire by accident.
//!
//! Encoding (module `encode`): every message knows its exact `encoded_len()`, so `encode()` allocates the frame once and
//! never regrows it, and `encode_into()` appends to a caller's reused buffer. The fallible paths (`try_encode`, `encode_into`,
//! and the server's [`SnapshotData::build`]) refuse, with an [`EncodeError`], any message a decoder would reject (more
//! than [`MAX_ACTORS`] actors, an oversized frame, a bad map): the codec never clamps or drops what the observation chose.

pub mod archetype;
pub mod codec;
mod encode;
pub mod ground;
pub mod hud_content;
pub mod vision;
pub mod weapon;
pub use encode::delta;
pub mod map;
pub mod quant;
pub mod samples;
/// Isolated experimental container; never accepted by the live protocol decoder.
pub mod scene_candidate;
pub mod state;

// Message types and codecs, one file per concern; their public items are re-exported below.
mod actor;
mod command;
mod masks;
mod server_msg;
mod snapshot_read;
pub use state::{
    validate_quest_props, PickupHandle, QuestHandle, RewardChestHandle, RosterId, StateItem,
    TrophyStatKey, WireArena, WireBuild, WireCamp, WireField, WireFirstPick, WireFocus,
    WireInventory, WireMarked, WireMerchant, WirePlan, WirePlanOption, WireProjectile, WireProp,
    WirePropKind, WireProps, WireQuestObjective, WireQuestParticipant, WireQuestPoint,
    WireQuestRow, WireQuestView, WireReadout, WireRewardChest, WireRewardId, WireRewardOption,
    WireRosterEntry, WireRosterRow, WireTradeDelta, WireTradeKind, WireTradeOffer, WireTradeStat,
    WireTradeView, MAX_TRADE_MERCHANTS, MAX_TRADE_OFFERS, MAX_TRADE_STATS, MAX_TRADE_VIEW_BYTES,
};

pub use actor::*;
pub use archetype::{WireArchetype, WireHull};
pub use codec::{DecodeError, EncodeError, Reader, Writer};
pub use command::*;
pub use delta::{
    ActorDelta, ConnEncoder, DeltaError, FrameKind, QActor, SelfDelta, SnapshotData, SnapshotDelta,
    SnapshotTracker, TrackError, MAX_DELTA_AGE, MAX_DELTA_AGE_MS,
};
pub use encode::{encode_welcome, encode_welcome_into, WelcomeHeader, WELCOME_HEADER_LEN};
pub use ground::GroundMode;
pub use hud_content::{
    HudTerm, WireHudContent, WireHudTerm, WireWeaponScaling, HUD_TERM_COUNT, MAX_HUD_TERMS,
};
pub use masks::*;
pub use server_msg::*;
pub(crate) use snapshot_read::*;
pub use vision::{WireRect, WireVision, VISION_RULES_VERSION};
pub use weapon::{
    WireWeapon, MAX_WEAPONS, WEAPON_KIND_ARC, WEAPON_KIND_NONE, WEAPON_KIND_PROJECTILE,
};

/// Bump on any incompatible change (a new tag or field in an existing message). Both ends refuse another major version.
/// 20 (P-SYNC-ORIGIN-1): the walk hint (P-NET-DRAWAHEAD-1a, origin's 19) and native card ids, the first-pick window
/// and the own readouts, State key 14 (P-WIRE19-A/B, the local 19) together. Both 19s are refused.
/// 22 (P-SYNC-ORIGIN-2): origin's 20 (heal pickups as prop kind 8, P-COLISEUM-HEALS-2) and 21 (snapshot time at the
/// Welcome's tick rate, P-TICK-3) with the local 20 (the walk hint, P-WIRE19-A/B and Marked Man, State key 15). 21 and
/// below are refused.
pub const PROTOCOL_VERSION: u16 = 22;
/// Milliseconds per server tick at the default 20 Hz. A Snapshot carries `tick` only: its server time is `tick * tick_ms`
/// exactly, with `tick_ms` from the connection's Welcome ([`tick_ms_for_rate`]); this is the 20 Hz value, which every
/// rate-less decode and encode uses.
pub const TICK_MS: u32 = 50;

/// The server time (ms) a Snapshot of `tick` stands for at 20 Hz ([`snapshot_server_ms_at`] with [`TICK_MS`]). The simulation
/// advances its clock by exactly one tick step from 0 (`rh_sim::Sim::step`), so the product is exact in `f64`; the server test
/// `server_time_is_tick_times_50` holds the identity against the simulation.
#[inline]
pub fn snapshot_server_ms(tick: u32) -> f64 {
    snapshot_server_ms_at(tick, TICK_MS)
}

/// P-TICK-3 (ADR 0029): the milliseconds of one server tick at `tick_rate` (`Welcome.tick_rate`): 20 Hz is 50 ms, 40 Hz is
/// 25 ms, and every other rate is `None` (refused by every decoder).
#[inline]
pub fn tick_ms_for_rate(tick_rate: u8) -> Option<u32> {
    match tick_rate {
        20 => Some(50),
        40 => Some(25),
        _ => None,
    }
}

/// P-TICK-3-fix: `tick_ms` when it is the step of a rate every decoder accepts ([`tick_ms_for_rate`]: 50 or 25 ms), else
/// `BadValue("tick ms")`. An encoder is only ever set to such a rate, so it never writes a frame no client can read.
pub fn checked_tick_ms(tick_ms: u32) -> Result<u32, EncodeError> {
    if [20u8, 40]
        .iter()
        .any(|&rate| tick_ms_for_rate(rate) == Some(tick_ms))
    {
        Ok(tick_ms)
    } else {
        Err(EncodeError::BadValue("tick ms"))
    }
}

/// P-TICK-3: the server time (ms) a Snapshot of `tick` stands for on a connection whose Welcome gave `tick_ms` per tick.
/// Both factors are exact in `f64` (a u32 and a small integer), and so is their product below 2^53.
#[inline]
pub fn snapshot_server_ms_at(tick: u32, tick_ms: u32) -> f64 {
    tick as f64 * tick_ms as f64
}
/// Longest admission ticket a Hello may carry. With the other Hello fields at their maxima (two 255-byte strings, a faction and a
/// resume token) the frame is 11 + 2*256 + 2 + 17 + 2 + 448 = 992 bytes, under [`MAX_CLIENT_FRAME`] (a test holds it).
pub const MAX_TICKET: usize = 448;
/// A client frame larger than this is malformed (the largest legal one, an Input with 16 commands, is under 400 bytes).
pub const MAX_CLIENT_FRAME: usize = 1024;
/// A server frame larger than this is a server bug (a Welcome with a map blob is the largest).
pub const MAX_SERVER_FRAME: usize = 256 * 1024;
/// Most commands one Input frame may carry.
pub const MAX_COMMANDS_PER_INPUT: usize = 16;
/// Most actors one Snapshot may list (8 players today; mobs later). Decoders reject more, so the fallible encoders refuse
/// more ([`EncodeError::TooMany`]); deciding what fits is the observation's job, never the codec's.
pub const MAX_ACTORS: usize = 512;

// Frame tags and command tags, shared by the encoders and the decoders in the files above.
const T_HELLO: u8 = 0x01;
const T_INPUT: u8 = 0x02;
const T_PING: u8 = 0x03;
const T_LEAVE: u8 = 0x04;
const T_RESYNC: u8 = 0x05;
const T_WELCOME: u8 = 0x81;
const T_REJECT: u8 = 0x82;
const T_SNAPSHOT: u8 = 0x83;
const T_EVENTS: u8 = 0x84;
const T_FX: u8 = 0x85;
const T_PONG: u8 = 0x86;
const T_SNAPSHOT_DELTA: u8 = 0x87;
const T_STATE: u8 = 0x88;

const C_MOVE: u8 = 1;
const C_STOP: u8 = 2;
const C_AIM: u8 = 3;
const C_ATTACK: u8 = 4;
const C_RELEASE: u8 = 5;
const C_PLAN: u8 = 14;
const C_CAST: u8 = 16;
const C_QUEST_ACCEPT: u8 = 17;
const C_TRADE: u8 = 18;

#[cfg(test)]
mod tests;
