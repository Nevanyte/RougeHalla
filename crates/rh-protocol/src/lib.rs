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
//! Snapshot's source clock defaults to `tick * 50 ms` ([`snapshot_server_ms`]); protocol 12 carries an absolute f64 override
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
//! cleared/respawn f64 times with respawn >= cleared. At most 512 rows and ten ascending State keys.
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
//! 2 zombie, 3 training dummy. State keys 8 private Plan and 9 public Arena remain complete replacements; key 10 carries only the private quest observer view.
//! Build carries all 80 card counts followed by eight boosts. Inventory carries small, large and active-healing counts.
//! Hunt uses Full self bits 14/15 and Delta self bits 18/19. Training is independent of self, Full bit 16 and
//! Delta bit 20; the bit is the value on every frame. A Delta hunt-target value of zero clears it; a present
//! Full hunt target and HuntTarget command must remain nonzero. Every old major is refused at admission.
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
//! SnapshotDelta 0x87, tick varint, base_age varint (tick - base tick, 1..=MAX_DELTA_AGE), ack_input varint, head varint
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
//! `Resync`, when its base is older than [`MAX_DELTA_AGE`] ticks, when the self appears or changes id, and whenever the
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
//! lifecycle. Each is a complete replacement; missing keys retain their last value. Module [`state`]
//! defines strict bounds and record layouts. Welcome (join and resume) is followed by all ten keys, even empty,
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

pub mod codec;
mod encode;
pub mod ground;
pub use encode::delta;
pub mod map;
pub mod quant;
pub mod samples;
pub mod state;
pub use state::{
    validate_quest_props, PickupHandle, QuestHandle, RewardChestHandle, RosterId, StateItem,
    TrophyStatKey, WireArena, WireBuild, WireCamp, WireField, WireFocus, WireInventory, WirePlan,
    WirePlanOption, WireProjectile, WireProp, WirePropKind, WireProps, WireQuestObjective,
    WireQuestParticipant, WireQuestPoint, WireQuestRow, WireQuestView, WireRewardChest,
    WireRewardId, WireRewardOption, WireRosterEntry,
};

pub use codec::{DecodeError, EncodeError, Reader, Writer};
pub use delta::{
    ActorDelta, ConnEncoder, DeltaError, FrameKind, QActor, SelfDelta, SnapshotData, SnapshotDelta,
    SnapshotTracker, TrackError, MAX_DELTA_AGE,
};
pub use encode::{encode_welcome, encode_welcome_into, WelcomeHeader, WELCOME_HEADER_LEN};
pub use ground::GroundMode;

/// Bump on any incompatible change (a new tag or field in an existing message). Both ends refuse another major version.
pub const PROTOCOL_VERSION: u16 = 14;
/// Milliseconds per server tick (20 Hz). A Snapshot carries `tick` only: its server time is `tick * TICK_MS` exactly.
pub const TICK_MS: u32 = 50;

/// The server time (ms) a Snapshot of `tick` stands for. The simulation advances its clock by exactly one tick step from 0
/// (`rh_sim::Sim::step`), so the product is exact in `f64`; the server test `server_time_is_tick_times_50` holds the
/// identity against the simulation.
#[inline]
pub fn snapshot_server_ms(tick: u32) -> f64 {
    tick as f64 * TICK_MS as f64
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

/// Why the server refuses or closes a session. Codes are wire format and append only: a decoder that meets a code it does
/// not know keeps it as [`RejectCode::Unknown`] (it never fails the frame), so a newer server can always tell an older
/// client why it was refused. `Unknown(n)` with a known `n` encodes as that code but decodes as the named variant.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RejectCode {
    ProtocolMismatch,
    ContentMismatch,
    BadCredentials,
    ProfileInUse,
    MatchFull,
    RateLimited,
    Malformed,
    TooSlow,
    ServerDraining,
    NoSuchSession,
    Kicked,
    /// A code this build does not name (including 0), kept raw.
    Unknown(u16),
}

impl RejectCode {
    /// The wire value.
    pub fn code(self) -> u16 {
        use RejectCode::*;
        match self {
            ProtocolMismatch => 1,
            ContentMismatch => 2,
            BadCredentials => 3,
            ProfileInUse => 4,
            MatchFull => 5,
            RateLimited => 6,
            Malformed => 7,
            TooSlow => 8,
            ServerDraining => 9,
            NoSuchSession => 10,
            Kicked => 11,
            Unknown(v) => v,
        }
    }

    /// Total: a value this build does not name becomes [`RejectCode::Unknown`].
    pub fn from_u16(v: u16) -> Self {
        use RejectCode::*;
        match v {
            1 => ProtocolMismatch,
            2 => ContentMismatch,
            3 => BadCredentials,
            4 => ProfileInUse,
            5 => MatchFull,
            6 => RateLimited,
            7 => Malformed,
            8 => TooSlow,
            9 => ServerDraining,
            10 => NoSuchSession,
            11 => Kicked,
            _ => Unknown(v),
        }
    }
}

/// A command as the client sends it (validated again by the server's simulation: never trusted).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum WireCommand {
    UseConsumable,
    Target {
        actor: u32,
    },
    HuntTarget {
        actor: u32,
    },
    ConsumeCorpse {
        handle: PickupHandle,
    },
    AttackMove {
        x: f32,
        y: f32,
        seq: Option<u8>,
    },
    Swap {
        slot: Option<u8>,
    },
    Pickup {
        handle: PickupHandle,
    },
    Choose {
        handle: RewardChestHandle,
        pick: i8,
    },
    /// The planning screen's private command (source arena planning only; dropped in any other phase). `spawn`/`boon` are
    /// indexes into the caller's own private plan options (0/1); `ready` latches. At least one field should be present.
    Plan {
        spawn: Option<u8>,
        boon: Option<u8>,
        ready: Option<bool>,
    },
    Move {
        x: f32,
        y: f32,
        seq: Option<u8>,
    },
    Stop {
        seq: Option<u8>,
    },
    Aim {
        a: f32,
    },
    /// `t`: the client's render time in server milliseconds (lag compensation; clamped server side).
    Attack {
        a: f32,
        t: Option<f64>,
    },
    Release {
        a: f32,
        t: Option<f64>,
    },
    /// The training room's practice console (protocol 11, tag 15): the source's five commands. The command byte names
    /// one (1 card, 2 stat, 3 camp, 4 chest, 5 clear); the id is a catalog position, the count is clamped by the sim, and
    /// the options are the chest's chosen card positions (at most three).
    Train {
        command: u8,
        id: u32,
        count: u64,
        /// The chest's chosen card positions (the first `option_count` are real; at most three).
        options: [u8; 3],
        option_count: u8,
    },
    /// Ordinary human Wish request; the server treats the fields as untrusted aim/input only.
    Cast {
        slot: u8,
        x: f32,
        y: f32,
        actor: Option<u32>,
        t: Option<f64>,
        seq: Option<u8>,
    },
    /// Accept a quest row through its observer-issued, quest-only handle.
    QuestAccept {
        handle: QuestHandle,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub enum ClientMsg {
    /// First frame of every connection. `resume` is the session token of a dropped connection (reconnect).
    Hello {
        protocol: u16,
        content_hash: u64,
        build: String,
        /// The requested display name (the callsign).
        profile: String,
        /// Opaque admission credential, at most [`MAX_TICKET`] bytes: what P-HOST-1 defines (a game-session player id or a
        /// signed join token). The server's admission checks it where the credentials were checked before; with no hosting
        /// layer it is the callsign's secret as UTF-8 bytes.
        ticket: Vec<u8>,
        faction: Option<u8>,
        resume: Option<[u8; 16]>,
    },
    /// `seq`: the client's input frame counter, echoed in Snapshot.ack_input (prediction reconciliation).
    Input {
        seq: u32,
        commands: Vec<WireCommand>,
    },
    Ping {
        nonce: u32,
        client_ms: f64,
    },
    Leave,
    /// "Send me a full snapshot": the client refused a delta it could not apply (v3). The server answers with a Full
    /// snapshot at its next tick, or at the first tick at least 20 (one second) after its previous forced Full if that is
    /// later: a request is never dropped, only deferred ([`delta::MIN_FORCED_FULL_TICKS`]).
    Resync,
}

#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct WireSelf {
    pub id: u32,
    pub faction: u8,
    pub x: f32,
    pub y: f32,
    pub facing: f32,
    pub hp: f32,
    pub max_hp: f32,
    pub status: u8,
    pub weapon: u8,
    pub ready_in_ms: u16,
    pub kills: u16,
    pub bounty: u16,
    pub gv: u16,
    pub move_seq: u8,
    pub effects: u16,
    pub displace_seq: u8,
    pub sig: u8,
    /// The selected Sentenced rival; absent is `None` (never actor 0).
    pub hunt_target: Option<u32>,
    pub hunt_stacks: u16,
    /// The owner-only Wish display record. Full snapshots omit it when absent; deltas can explicitly clear it.
    pub wish: Option<WireWishOwner>,
    /// The owner's source-f32 barrier value and its source-derived eight-step ring.
    pub barrier: f32,
    pub barrier_ring_step: u8,
}

/// Owner-only, already-authoritative Wish display facts (ADR0022). This carries no target, cursor, rank, or outcome.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WireWishOwner {
    pub ability: u8,
    pub ready_at: f64,
    pub full_at: Option<f64>,
    pub max_charges: u8,
    pub recharge_ms: f64,
    pub charges: u8,
    pub next_charge_at: Option<f64>,
    pub cast: Option<WireWishCast>,
}

/// The owner's current cast cue deadlines.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WireWishCast {
    pub ability: u8,
    pub started_at: f64,
    pub lands_at: f64,
}

/// A public, quantized point carried by a Wish cue.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WirePoint {
    pub x: f32,
    pub y: f32,
}

/// A remote actor as the observation chose it. On the wire its position and facing are quantized ([`quant`]): a decoded
/// actor equals [`WireActor::quantized`] of what was encoded. `hp_pct` is 0..=100 (the observation clamps it).
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct WireActor {
    pub id: u32,
    pub faction: u8,
    pub x: f32,
    pub y: f32,
    pub facing: f32,
    /// hp fraction in hundredths (0..=100), what an hp bar shows.
    pub hp_pct: u8,
    pub status: u8,
    pub weapon: u8,
    pub bounty: u16,
    /// What the entity is: 0 = player (the default, which costs no byte). Other kinds are assigned by the packet that adds
    /// them; the id namespace is shared by every kind.
    pub kind: u8,
    pub effects: u16,
    pub displace_seq: u8,
    pub sig: u8,
    pub mob_type_code: u8,
    /// Source-derived twentieth share rounded to an integer percent.
    pub barrier_pct: u8,
    /// Source-derived barrier ring step in 0..=8.
    pub barrier_ring_step: u8,
}

impl WireActor {
    /// What a client decodes after this actor went over the wire (positions to 1/8 u, facing to 2 pi / 65536).
    pub fn quantized(&self) -> WireActor {
        WireActor {
            x: quant::dequantize_pos(quant::quantize_pos(self.x)),
            y: quant::dequantize_pos(quant::quantize_pos(self.y)),
            facing: quant::dequantize_facing(quant::quantize_facing(self.facing)),
            ..*self
        }
    }
}

impl WireFx {
    /// What a client decodes after this effect went over the wire (a swing's position and angle quantized).
    pub fn quantized(&self) -> WireFx {
        match *self {
            WireFx::Swing {
                by,
                weapon,
                x,
                y,
                a,
            } => WireFx::Swing {
                by,
                weapon,
                x: quant::dequantize_pos(quant::quantize_pos(x)),
                y: quant::dequantize_pos(quant::quantize_pos(y)),
                a: quant::dequantize_facing(quant::quantize_facing(a)),
            },
            WireFx::WishStarted {
                event_time,
                caster,
                ability,
                duration,
                target,
                anchor,
            } => WireFx::WishStarted {
                event_time,
                caster,
                ability,
                duration,
                target,
                anchor: quantized_point(anchor),
            },
            WireFx::WishLanded {
                event_time,
                ability,
                caster,
                target,
                anchor,
                destination,
            } => WireFx::WishLanded {
                event_time,
                ability,
                caster,
                target,
                anchor: quantized_point(anchor),
                destination: quantized_point(destination),
            },
            hit => hit,
        }
    }
}

fn quantized_point(point: Option<WirePoint>) -> Option<WirePoint> {
    point.map(|p| WirePoint {
        x: quant::dequantize_pos(quant::quantize_pos(p.x)),
        y: quant::dequantize_pos(quant::quantize_pos(p.y)),
    })
}

fn read_point_opt(r: &mut Reader) -> Result<Option<WirePoint>, DecodeError> {
    r.opt(|r| {
        Ok(WirePoint {
            x: quant::dequantize_pos(r.u16()?),
            y: quant::dequantize_pos(r.u16()?),
        })
    })
}

fn point_valid(point: Option<WirePoint>) -> bool {
    point.is_none_or(|p| quant::pos_in_range(p.x) && quant::pos_in_range(p.y))
}

fn nonzero_varint(r: &mut Reader, what: &'static str) -> Result<u32, DecodeError> {
    match r.varint()? {
        0 => Err(DecodeError::BadField(what)),
        id => Ok(id),
    }
}

/// Important events: delivered reliably and in order (never dropped for a slow client).
#[derive(Clone, Debug, PartialEq)]
pub enum WireEvent {
    PotionNotice {
        notice: u8,
    },
    Death {
        id: u32,
        by: Option<u32>,
    },
    Bounty {
        id: u32,
        bounty: u16,
    },
    MatchEnded {
        winner: Option<u32>,
        draw: bool,
    },
    /// The player's own resolved run.
    Result(WireResult),
    /// A wind emblem was walked over (the client's fixed "+50% movement for 5s" toast).
    WindEmblem,
    PickupRefused {
        reason: u8,
    },
    ChestRefused {
        reason: u8,
    },
    /// The owner's travel-cannon notice: 1 sealed, 2 cannot enter, 3 blast, or 4 reloading with the remaining seconds.
    CannonNotice {
        code: u8,
        seconds: Option<u16>,
    },
    /// The practice console's owner-only notice (protocol 11, tag 10): routed only to the connection that owns the event.
    Toast {
        text: String,
    },
}

/// Presentation effects: a slow client may lose them (the server drops the oldest first under backpressure).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum WireFx {
    Block {
        id: u32,
        by: u32,
        weapon: u8,
    },
    Stagger {
        id: u32,
    },
    Swing {
        by: u32,
        weapon: u8,
        x: f32,
        y: f32,
        a: f32,
    },
    Hit {
        victim: u32,
        by: u32,
        amount: f32,
        passive: bool,
    },
    /// The coliseum teleport happened at this tick (source sends the `teleport` fx to the whole room).
    Teleport,
    WishStarted {
        event_time: f64,
        caster: u32,
        ability: u8,
        duration: f64,
        target: Option<u32>,
        anchor: Option<WirePoint>,
    },
    WishLanded {
        event_time: f64,
        ability: u8,
        caster: Option<u32>,
        target: Option<u32>,
        anchor: Option<WirePoint>,
        destination: Option<WirePoint>,
    },
    WishEnded {
        event_time: f64,
        caster: u32,
        ability: u8,
        reason: u8,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct WireResult {
    pub outcome: u8,
    pub place: u8,
    pub players: u8,
    pub kills: u16,
    pub killed_by: Option<String>,
    pub gv_total: u32,
    pub gv_win: u32,
    pub duration_sec: u32,
    pub win_bonus_withheld: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ServerMsg {
    Welcome {
        protocol: u16,
        content_hash: u64,
        match_id: [u8; 16],
        player_id: u32,
        session: [u8; 16],
        tick_rate: u8,
        tick: u32,
        server_ms: f64,
        /// The canonical public map (server-sent; clients never generate it): docs/adr/0003-canonical-map.md.
        map: map::MapBlob,
    },
    Reject {
        code: RejectCode,
        reason: String,
    },
    /// The receiving player's own interest-managed view (only what it can see), once per tick.
    /// Its source clock is absolute; the wire omits it only when it equals [`snapshot_server_ms`]`(tick)`.
    Snapshot {
        tick: u32,
        /// Logical source clock in milliseconds; absent wire overrides decode to `snapshot_server_ms(tick)`.
        server_time: f64,
        phase: u8,
        ack_input: u32,
        me: Option<WireSelf>,
        actors: Vec<WireActor>,
        /// Protocol 11: the source's public training fact (head bit 16; absent means false, so a non-training frame is
        /// byte-identical to v7 apart from the version number).
        training: bool,
    },
    /// A snapshot as a delta against the last one the connection received (v3); see [`delta`].
    SnapshotDelta(SnapshotDelta),
    Events {
        tick: u32,
        events: Vec<WireEvent>,
    },
    Fx {
        tick: u32,
        fx: Vec<WireFx>,
    },
    Pong {
        nonce: u32,
        client_ms: f64,
        server_ms: f64,
    },
    /// Keyed state, the latest value per key (keys 1..=10; see the crate docs). Each item is a complete replacement.
    State {
        tick: u32,
        items: Vec<StateItem>,
    },
}

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

impl ClientMsg {
    /// The protocol version a Hello frame announces, read from its first three bytes (`[0x01][protocol u16]`) and nothing
    /// else: `None` if the frame is not a Hello or is shorter than that prefix. Those three bytes and the whole Reject frame
    /// never change across protocol versions, so a server reads this BEFORE [`ClientMsg::decode`] and answers a client of
    /// another version with [`RejectCode::ProtocolMismatch`] whatever follows (a future Hello may add fields).
    pub fn hello_protocol(frame: &[u8]) -> Option<u16> {
        match frame {
            [T_HELLO, lo, hi, ..] => Some(u16::from_le_bytes([*lo, *hi])),
            _ => None,
        }
    }

    /// Decodes an untrusted client frame. Size limit, finite floats, list bounds and no trailing bytes are enforced here.
    pub fn decode(frame: &[u8]) -> Result<Self, DecodeError> {
        if frame.len() > MAX_CLIENT_FRAME {
            return Err(DecodeError::TooLarge(frame.len()));
        }
        let mut r = Reader::new(frame);
        r.finite_only = true;
        let msg = match r.u8()? {
            T_HELLO => ClientMsg::Hello {
                protocol: r.u16()?,
                content_hash: r.u64()?,
                build: r.str()?,
                profile: r.str()?,
                ticket: r.blob(MAX_TICKET)?,
                faction: r.opt(|r| r.u8())?,
                resume: r.opt(|r| r.array16())?,
            },
            T_INPUT => {
                let seq = r.u32()?;
                let n = r.u16()? as usize;
                if n > MAX_COMMANDS_PER_INPUT {
                    return Err(DecodeError::TooMany(n));
                }
                let mut commands = Vec::with_capacity(n);
                for _ in 0..n {
                    commands.push(match r.u8()? {
                        6 => {
                            let slot = r.opt(|r| r.u8())?;
                            if slot.is_some_and(|s| s > 1) {
                                return Err(DecodeError::BadField("combat"));
                            }
                            WireCommand::Swap { slot }
                        }
                        7 => {
                            let handle = PickupHandle::new(r.u32()?)
                                .ok_or(DecodeError::BadField("combat"))?;
                            WireCommand::Pickup { handle }
                        }
                        8 => {
                            let handle = RewardChestHandle::new(r.u32()?)
                                .ok_or(DecodeError::BadField("reward choice"))?;
                            let pick = r.u8()? as i8;
                            if !(-1..=2).contains(&pick) {
                                return Err(DecodeError::BadField("reward choice"));
                            }
                            WireCommand::Choose { handle, pick }
                        }
                        9 => WireCommand::UseConsumable,
                        10 => {
                            let actor = r.u32()?;
                            if actor == 0 {
                                return Err(DecodeError::BadField("target"));
                            }
                            WireCommand::Target { actor }
                        }
                        15 => {
                            let command = r.u8()?;
                            if !(1..=5).contains(&command) {
                                return Err(DecodeError::BadField("train command"));
                            }
                            let id = r.varint()?;
                            let count = r.u64()?;
                            let n = r.u8()? as usize;
                            if n > 3 {
                                return Err(DecodeError::TooMany(n));
                            }
                            let mut options = [0u8; 3];
                            for option in options.iter_mut().take(n) {
                                *option = r.u8()?;
                            }
                            WireCommand::Train {
                                command,
                                id,
                                count,
                                options,
                                option_count: n as u8,
                            }
                        }
                        C_CAST => {
                            let slot = r.u8()?;
                            if slot > 2 {
                                return Err(DecodeError::BadField("cast slot"));
                            }
                            let x = r.f32()?;
                            let y = r.f32()?;
                            let actor = r.opt(|r| {
                                let id = r.u32()?;
                                if id == 0 {
                                    return Err(DecodeError::BadField("cast actor"));
                                }
                                Ok(id)
                            })?;
                            WireCommand::Cast {
                                slot,
                                x,
                                y,
                                actor,
                                t: r.opt(|r| r.f64())?,
                                seq: r.opt(|r| r.u8())?,
                            }
                        }
                        C_QUEST_ACCEPT => WireCommand::QuestAccept {
                            handle: QuestHandle::new(r.varint()?)
                                .ok_or(DecodeError::BadField("quest handle"))?,
                        },
                        11 => WireCommand::AttackMove {
                            x: r.f32()?,
                            y: r.f32()?,
                            seq: r.opt(|r| r.u8())?,
                        },
                        12 => {
                            let actor = r.u32()?;
                            if actor == 0 {
                                return Err(DecodeError::BadField("hunt target"));
                            }
                            WireCommand::HuntTarget { actor }
                        }
                        13 => {
                            let handle = PickupHandle::new(r.u32()?)
                                .ok_or(DecodeError::BadField("corpse handle"))?;
                            WireCommand::ConsumeCorpse { handle }
                        }
                        C_PLAN => {
                            let flags = r.u8()?;
                            if flags & !0b111 != 0 {
                                return Err(DecodeError::BadField("plan flags"));
                            }
                            let spawn = if flags & 1 != 0 {
                                let v = r.u8()?;
                                if v > 1 {
                                    return Err(DecodeError::BadField("plan spawn"));
                                }
                                Some(v)
                            } else {
                                None
                            };
                            let boon = if flags & 2 != 0 {
                                let v = r.u8()?;
                                if v > 1 {
                                    return Err(DecodeError::BadField("plan boon"));
                                }
                                Some(v)
                            } else {
                                None
                            };
                            let ready = if flags & 4 != 0 {
                                Some(r.u8()? != 0)
                            } else {
                                None
                            };
                            WireCommand::Plan { spawn, boon, ready }
                        }
                        C_MOVE => WireCommand::Move {
                            x: r.f32()?,
                            y: r.f32()?,
                            seq: r.opt(|r| r.u8())?,
                        },
                        C_STOP => WireCommand::Stop {
                            seq: r.opt(|r| r.u8())?,
                        },
                        C_AIM => WireCommand::Aim { a: r.f32()? },
                        C_ATTACK => WireCommand::Attack {
                            a: r.f32()?,
                            t: r.opt(|r| r.f64())?,
                        },
                        C_RELEASE => WireCommand::Release {
                            a: r.f32()?,
                            t: r.opt(|r| r.f64())?,
                        },
                        t => return Err(DecodeError::BadTag(t)),
                    });
                }
                ClientMsg::Input { seq, commands }
            }
            T_PING => ClientMsg::Ping {
                nonce: r.u32()?,
                client_ms: r.f64()?,
            },
            T_LEAVE => ClientMsg::Leave,
            T_RESYNC => ClientMsg::Resync,
            t => return Err(DecodeError::BadTag(t)),
        };
        r.end()?;
        Ok(msg)
    }
}

/// Full head bits (protocol v4; append only, see the crate docs). A head is a varint: bits below 7 take one byte.
pub(crate) const HM_PRESENT: u32 = 1 << 0;
pub(crate) const HM_KIT: u32 = 1 << 1;
pub(crate) const HM_HP: u32 = 1 << 2;
pub(crate) const HM_READY: u32 = 1 << 3;
pub(crate) const HM_KILLS: u32 = 1 << 4;
pub(crate) const HM_BOUNTY: u32 = 1 << 5;
pub(crate) const HM_MOVE_SEQ: u32 = 1 << 6;
pub(crate) const HM_GV: u32 = 1 << 7;
/// `max_hp` is written as an f32 (it is not an integer in 0..=65535); otherwise as a varint.
pub(crate) const HM_MAXHP_F32: u32 = 1 << 8;
pub(crate) const HM_STATUS: u32 = 1 << 9;
pub(crate) const HM_PHASE: u32 = 1 << 10;
/// Bits that belong to the self; a head without a self must have none of them set.
pub(crate) const HM_EFFECTS: u32 = 1 << 11;
pub(crate) const HM_DISPLACE: u32 = 1 << 12;
pub(crate) const HM_SIG: u32 = 1 << 13;
pub(crate) const HM_HUNT_TARGET: u32 = 1 << 14;
pub(crate) const HM_HUNT_STACKS: u32 = 1 << 15;
pub(crate) const HM_WISH: u32 = 1 << 17;
pub(crate) const HM_BARRIER: u32 = 1 << 18;
pub(crate) const HM_SERVER_TIME: u32 = 1 << 19;
pub(crate) const HM_SELF_BITS: u32 = 0x03ff
    | HM_EFFECTS
    | HM_DISPLACE
    | HM_SIG
    | HM_HUNT_TARGET
    | HM_HUNT_STACKS
    | HM_WISH
    | HM_BARRIER;
pub(crate) const HM_KNOWN: u32 = HM_SELF_BITS | HM_PHASE | HM_TRAINING | HM_SERVER_TIME;
pub(crate) const HM_TRAINING: u32 = 1 << 16;
/// Full actor mask bits (append only): 0 kit, 1 hp, 2 status, 3 bounty, 4 kind.
pub(crate) const AM_KIT: u32 = 1 << 0;
pub(crate) const AM_HP: u32 = 1 << 1;
pub(crate) const AM_STATUS: u32 = 1 << 2;
pub(crate) const AM_BOUNTY: u32 = 1 << 3;
pub(crate) const AM_KIND: u32 = 1 << 4;
pub(crate) const AM_EFFECTS: u32 = 1 << 5;
pub(crate) const AM_DISPLACE: u32 = 1 << 6;
pub(crate) const AM_MOB_TYPE: u32 = 1 << 7;
pub(crate) const AM_SIG: u32 = 1 << 8;
pub(crate) const AM_BARRIER: u32 = 1 << 9;
pub(crate) const AM_KNOWN: u32 = AM_KIT
    | AM_HP
    | AM_STATUS
    | AM_BOUNTY
    | AM_KIND
    | AM_EFFECTS
    | AM_DISPLACE
    | AM_MOB_TYPE
    | AM_SIG
    | AM_BARRIER;
/// The hp a clear hp bit stands for.
pub(crate) const DEFAULT_HP_PCT: u8 = 100;
pub(crate) const DEFAULT_BARRIER_PCT: u8 = 0;
pub(crate) const DEFAULT_BARRIER_RING_STEP: u8 = 0;
/// The status a clear status bit stands for: alive (0 lobby, 1 alive, 2 dead, 3 mia: docs/CONTRACTS.md C-NET).
pub const DEFAULT_STATUS: u8 = 1;
/// The phase a clear phase bit stands for: active (0 lobby, 1 active, 2 ended).
pub const DEFAULT_PHASE: u8 = 1;
/// Largest faction, weapon (4 bits each in the kit byte), status and phase (2 bits each) the wire can carry.
pub const MAX_KIT_CODE: u8 = 15;
pub const MAX_STATUS_CODE: u8 = 3;
pub const MAX_PHASE_CODE: u8 = 3;

pub(crate) fn varint_u16(r: &mut Reader, what: &'static str) -> Result<u16, DecodeError> {
    u16::try_from(r.varint()?).map_err(|_| DecodeError::BadField(what))
}

/// The self record after its head (`mask` has HM_PRESENT set). The phase, if the head has one, is read by the caller.
fn read_self(r: &mut Reader, mask: u32) -> Result<WireSelf, DecodeError> {
    let id = r.varint()?;
    let x = r.f32()?;
    let y = r.f32()?;
    let facing = r.f32()?;
    let max_hp = if mask & HM_MAXHP_F32 != 0 {
        r.f32()?
    } else {
        varint_u16(r, "max_hp")? as f32
    };
    let (faction, weapon) = if mask & HM_KIT != 0 {
        let k = r.u8()?;
        (k & 0x0f, k >> 4)
    } else {
        (0, 0)
    };
    let hp = if mask & HM_HP != 0 { r.f32()? } else { max_hp };
    let ready_in_ms = if mask & HM_READY != 0 { r.u16()? } else { 0 };
    let kills = if mask & HM_KILLS != 0 {
        varint_u16(r, "kills")?
    } else {
        0
    };
    let bounty = if mask & HM_BOUNTY != 0 {
        varint_u16(r, "bounty")?
    } else {
        0
    };
    let move_seq = if mask & HM_MOVE_SEQ != 0 { r.u8()? } else { 0 };
    let gv = if mask & HM_GV != 0 {
        varint_u16(r, "gv")?
    } else {
        0
    };
    let status = if mask & HM_STATUS != 0 {
        code(r, MAX_STATUS_CODE, "status")?
    } else {
        DEFAULT_STATUS
    };
    let effects = if mask & HM_EFFECTS != 0 { r.u16()? } else { 0 };
    let displace_seq = if mask & HM_DISPLACE != 0 { r.u8()? } else { 0 };
    let sig = if mask & HM_SIG != 0 { r.u8()? } else { 0 };
    let hunt_target = if mask & HM_HUNT_TARGET != 0 {
        let target = r.varint()?;
        if target == 0 {
            return Err(DecodeError::BadField("hunt target"));
        }
        Some(target)
    } else {
        None
    };
    let hunt_stacks = if mask & HM_HUNT_STACKS != 0 {
        varint_u16(r, "hunt_stacks")?
    } else {
        0
    };
    let wish = if mask & HM_WISH != 0 {
        let wish = read_wish_owner(r)?;
        if !encode::wish_owner_valid(&wish) {
            return Err(DecodeError::BadField("wish"));
        }
        Some(wish)
    } else {
        None
    };
    let (barrier, barrier_ring_step) = if mask & HM_BARRIER != 0 {
        let barrier = r.f32()?;
        let ring = r.u8()?;
        if !barrier.is_finite() || barrier < 0.0 || ring > 8 {
            return Err(DecodeError::BadField("barrier"));
        }
        (barrier, ring)
    } else {
        (0.0, 0)
    };
    Ok(WireSelf {
        effects,
        displace_seq,
        sig,
        id,
        faction,
        x,
        y,
        facing,
        hp,
        max_hp,
        status,
        weapon,
        ready_in_ms,
        kills,
        bounty,
        gv,
        move_seq,
        hunt_target,
        hunt_stacks,
        wish,
        barrier,
        barrier_ring_step,
    })
}

pub(crate) fn read_wish_owner(r: &mut Reader) -> Result<WireWishOwner, DecodeError> {
    let ability = code(r, 4, "wish ability")?;
    let ready_at = r.f64()?;
    let full_at = r.opt(|r| r.f64())?;
    let max_charges = r.u8()?;
    let recharge_ms = r.f64()?;
    let charges = r.u8()?;
    let next_charge_at = r.opt(|r| r.f64())?;
    let cast = r.opt(|r| {
        Ok(WireWishCast {
            ability: code(r, 4, "wish cast ability")?,
            started_at: r.f64()?,
            lands_at: r.f64()?,
        })
    })?;
    let wish = WireWishOwner {
        ability,
        ready_at,
        full_at,
        max_charges,
        recharge_ms,
        charges,
        next_charge_at,
        cast,
    };
    if !encode::wish_owner_valid(&wish) {
        return Err(DecodeError::BadField("wish"));
    }
    Ok(wish)
}

/// A byte that must be at most `max`.
pub(crate) fn code(r: &mut Reader, max: u8, what: &'static str) -> Result<u8, DecodeError> {
    match r.u8()? {
        v if v <= max => Ok(v),
        _ => Err(DecodeError::BadField(what)),
    }
}

/// One actor; `prev` is the previous actor's id (ids strictly ascend: the first is absolute, the rest are gaps).
fn read_actor(r: &mut Reader, prev: Option<u32>) -> Result<WireActor, DecodeError> {
    let field = r.varint()?;
    let id = match prev {
        None => field,
        Some(p) => match p.checked_add(field) {
            Some(id) if field != 0 => id,
            _ => return Err(DecodeError::BadField("actor order")),
        },
    };
    let mask = r.varint()?;
    if mask & !AM_KNOWN != 0 {
        return Err(DecodeError::BadField("actor mask"));
    }
    let x = quant::dequantize_pos(r.u16()?);
    let y = quant::dequantize_pos(r.u16()?);
    let facing = quant::dequantize_facing(r.u16()?);
    let (faction, weapon) = if mask & AM_KIT != 0 {
        let k = r.u8()?;
        (k & 0x0f, k >> 4)
    } else {
        (0, 0)
    };
    let hp_pct = if mask & AM_HP != 0 {
        r.u8()?
    } else {
        DEFAULT_HP_PCT
    };
    if hp_pct > 100 {
        return Err(DecodeError::BadField("hp_pct"));
    }
    let status = if mask & AM_STATUS != 0 {
        code(r, MAX_STATUS_CODE, "status")?
    } else {
        DEFAULT_STATUS
    };
    let bounty = if mask & AM_BOUNTY != 0 {
        varint_u16(r, "bounty")?
    } else {
        0
    };
    let kind = if mask & AM_KIND != 0 { r.u8()? } else { 0 };
    let effects = if mask & AM_EFFECTS != 0 { r.u16()? } else { 0 };
    let displace_seq = if mask & AM_DISPLACE != 0 { r.u8()? } else { 0 };
    let mob_type_code = if mask & AM_MOB_TYPE != 0 {
        code(r, 30, "mob type")?
    } else {
        0
    };
    let sig = if mask & AM_SIG != 0 { r.u8()? } else { 0 };
    let (barrier_pct, barrier_ring_step) = if mask & AM_BARRIER != 0 {
        let pct = r.u8()?;
        let ring = r.u8()?;
        if pct > 100 || ring > 8 {
            return Err(DecodeError::BadField("barrier"));
        }
        (pct, ring)
    } else {
        (DEFAULT_BARRIER_PCT, DEFAULT_BARRIER_RING_STEP)
    };
    Ok(WireActor {
        mob_type_code,
        effects,
        displace_seq,
        sig,
        id,
        faction,
        x,
        y,
        facing,
        hp_pct,
        status,
        weapon,
        bounty,
        kind,
        barrier_pct,
        barrier_ring_step,
    })
}

impl ServerMsg {
    pub fn decode(frame: &[u8]) -> Result<Self, DecodeError> {
        if frame.len() > MAX_SERVER_FRAME {
            return Err(DecodeError::TooLarge(frame.len()));
        }
        let mut r = Reader::new(frame);
        let msg = match r.u8()? {
            T_WELCOME => ServerMsg::Welcome {
                protocol: r.u16()?,
                content_hash: r.u64()?,
                match_id: r.array16()?,
                player_id: r.u32()?,
                session: r.array16()?,
                tick_rate: r.u8()?,
                tick: r.u32()?,
                server_ms: r.f64()?,
                map: map::MapBlob::read(&mut r)?,
            },
            T_REJECT => {
                // Any code above 0 decodes (unnamed ones as `Unknown`); 0 is not a code.
                let code = r.u16()?;
                if code == 0 {
                    return Err(DecodeError::BadTag(0));
                }
                ServerMsg::Reject {
                    code: RejectCode::from_u16(code),
                    reason: r.str()?,
                }
            }
            T_SNAPSHOT => {
                let tick = r.varint()?;
                let ack_input = r.varint()?;
                let head = r.varint()?;
                if head & !HM_KNOWN != 0 || (head & HM_PRESENT == 0 && head & HM_SELF_BITS != 0) {
                    return Err(DecodeError::BadField("head"));
                }
                let me = if head & HM_PRESENT != 0 {
                    Some(read_self(&mut r, head)?)
                } else {
                    None
                };
                let phase = if head & HM_PHASE != 0 {
                    code(&mut r, MAX_PHASE_CODE, "phase")?
                } else {
                    DEFAULT_PHASE
                };
                let server_time = if head & HM_SERVER_TIME != 0 {
                    let time = r.f64()?;
                    if !time.is_finite()
                        || time < 0.0
                        || time.to_bits() == snapshot_server_ms(tick).to_bits()
                    {
                        return Err(DecodeError::BadField("server time"));
                    }
                    time
                } else {
                    snapshot_server_ms(tick)
                };
                let training = head & HM_TRAINING != 0;
                let n = r.varint()? as usize;
                if n > MAX_ACTORS {
                    return Err(DecodeError::TooMany(n));
                }
                let mut actors = Vec::with_capacity(n);
                let mut prev = None;
                for _ in 0..n {
                    let a = read_actor(&mut r, prev)?;
                    prev = Some(a.id);
                    actors.push(a);
                }
                ServerMsg::Snapshot {
                    tick,
                    server_time,
                    phase,
                    ack_input,
                    me,
                    actors,
                    training,
                }
            }
            T_SNAPSHOT_DELTA => ServerMsg::SnapshotDelta(delta::read_snapshot_delta(&mut r)?),
            T_STATE => {
                let tick = r.varint()?;
                ServerMsg::State {
                    tick,
                    items: state::read_items(&mut r)?,
                }
            }
            T_EVENTS => {
                let tick = r.u32()?;
                let n = r.u16()? as usize;
                let mut events = Vec::with_capacity(n.min(1024));
                for _ in 0..n {
                    events.push(match r.u8()? {
                        8 => WireEvent::WindEmblem,
                        10 => WireEvent::Toast { text: r.str()? },
                        7 => {
                            let notice = r.u8()?;
                            if !(1..=10).contains(&notice) {
                                return Err(DecodeError::BadField("potion notice"));
                            }
                            WireEvent::PotionNotice { notice }
                        }
                        9 => {
                            let code = r.u8()?;
                            let seconds = match code {
                                1..=3 => None,
                                4 => {
                                    let s = r.u16()?;
                                    if !(1..=75).contains(&s) {
                                        return Err(DecodeError::BadField("cannon notice"));
                                    }
                                    Some(s)
                                }
                                _ => return Err(DecodeError::BadField("cannon notice")),
                            };
                            WireEvent::CannonNotice { code, seconds }
                        }
                        6 => {
                            let reason = r.u8()?;
                            if !(1..=9).contains(&reason) {
                                return Err(DecodeError::BadField("chest reason"));
                            }
                            WireEvent::ChestRefused { reason }
                        }
                        5 => {
                            let reason = r.u8()?;
                            if !(1..=5).contains(&reason) {
                                return Err(DecodeError::BadField("combat"));
                            }
                            WireEvent::PickupRefused { reason }
                        }
                        1 => WireEvent::Death {
                            id: r.u32()?,
                            by: r.opt(|r| r.u32())?,
                        },
                        2 => WireEvent::Bounty {
                            id: r.u32()?,
                            bounty: r.u16()?,
                        },
                        3 => WireEvent::MatchEnded {
                            winner: r.opt(|r| r.u32())?,
                            draw: r.u8()? != 0,
                        },
                        4 => WireEvent::Result(WireResult {
                            outcome: r.u8()?,
                            place: r.u8()?,
                            players: r.u8()?,
                            kills: r.u16()?,
                            killed_by: r.opt(|r| r.str())?,
                            gv_total: r.u32()?,
                            gv_win: r.u32()?,
                            duration_sec: r.u32()?,
                            win_bonus_withheld: r.u8()? != 0,
                        }),
                        t => return Err(DecodeError::BadTag(t)),
                    });
                }
                ServerMsg::Events { tick, events }
            }
            T_FX => {
                let tick = r.varint()?;
                let n = r.varint()? as usize;
                if n > u16::MAX as usize {
                    return Err(DecodeError::TooMany(n));
                }
                let mut fx = Vec::with_capacity(n.min(1024));
                for _ in 0..n {
                    fx.push(match r.u8()? {
                        3 => WireFx::Block {
                            id: r.varint()?,
                            by: r.varint()?,
                            weapon: r.u8()?,
                        },
                        4 => WireFx::Stagger { id: r.varint()? },
                        5 => WireFx::Teleport,
                        6 => WireFx::WishStarted {
                            event_time: r.f64()?,
                            caster: nonzero_varint(&mut r, "wish caster")?,
                            ability: code(&mut r, 4, "wish ability")?,
                            duration: r.f64()?,
                            target: r.opt(|r| nonzero_varint(r, "wish target"))?,
                            anchor: read_point_opt(&mut r)?,
                        },
                        7 => WireFx::WishLanded {
                            event_time: r.f64()?,
                            ability: code(&mut r, 4, "wish ability")?,
                            caster: r.opt(|r| nonzero_varint(r, "wish caster"))?,
                            target: r.opt(|r| nonzero_varint(r, "wish target"))?,
                            anchor: read_point_opt(&mut r)?,
                            destination: read_point_opt(&mut r)?,
                        },
                        8 => WireFx::WishEnded {
                            event_time: r.f64()?,
                            caster: nonzero_varint(&mut r, "wish caster")?,
                            ability: code(&mut r, 4, "wish ability")?,
                            reason: code(&mut r, 2, "wish reason")?,
                        },
                        1 => WireFx::Swing {
                            by: r.varint()?,
                            weapon: r.u8()?,
                            x: quant::dequantize_pos(r.u16()?),
                            y: quant::dequantize_pos(r.u16()?),
                            a: quant::dequantize_facing(r.u16()?),
                        },
                        2 => WireFx::Hit {
                            victim: r.varint()?,
                            by: r.varint()?,
                            amount: r.f32()?,
                            passive: r.opt(|_| Ok(()))?.is_some(),
                        },
                        t => return Err(DecodeError::BadTag(t)),
                    });
                }
                for f in &fx {
                    let valid = match *f {
                        WireFx::WishStarted {
                            event_time,
                            duration,
                            target,
                            anchor,
                            ..
                        } => {
                            event_time.is_finite()
                                && event_time >= 0.0
                                && duration.is_finite()
                                && duration >= 0.0
                                && target.is_none_or(|id| id != 0)
                                && point_valid(anchor)
                        }
                        WireFx::WishLanded {
                            event_time,
                            ability,
                            caster,
                            target,
                            anchor,
                            destination,
                        } => {
                            event_time.is_finite()
                                && event_time >= 0.0
                                && caster.is_none_or(|id| id != 0)
                                && target.is_none_or(|id| id != 0)
                                && point_valid(anchor)
                                && point_valid(destination)
                                && ((ability == 3 && anchor.is_some() == destination.is_some())
                                    || (ability != 3 && destination.is_none()))
                                && (caster.is_some() || anchor.is_some())
                        }
                        WireFx::WishEnded { event_time, .. } => {
                            event_time.is_finite() && event_time >= 0.0
                        }
                        _ => true,
                    };
                    if !valid {
                        return Err(DecodeError::BadField("wish fx"));
                    }
                }
                ServerMsg::Fx { tick, fx }
            }
            T_PONG => ServerMsg::Pong {
                nonce: r.u32()?,
                client_ms: r.f64()?,
                server_ms: r.f64()?,
            },
            t => return Err(DecodeError::BadTag(t)),
        };
        r.end()?;
        Ok(msg)
    }
}

#[cfg(test)]
mod mask_numbers {
    use super::*;

    /// The Full actor mask bit numbers are append only (docs/adr/0011-protocol-v4.md).
    #[test]
    fn full_actor_mask_bit_numbers_are_pinned() {
        assert_eq!(
            [AM_KIT, AM_HP, AM_STATUS, AM_BOUNTY, AM_KIND],
            [1 << 0, 1 << 1, 1 << 2, 1 << 3, 1 << 4]
        );
    }
}
