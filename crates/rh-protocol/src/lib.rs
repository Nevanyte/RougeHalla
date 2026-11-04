//! Roguehalla wire protocol, version [`PROTOCOL_VERSION`]. One message per WebSocket BINARY frame (the only transport a
//! browser build can use; served as wss:// in production). Little-endian, no reflection: the C# mirror
//! (`client-unity/RoguehallaNet`) and the JS probe decode the same bytes, and all are held to the golden vectors in
//! `protocol/fixtures/v2.json` (docs/CONTRACTS.md C-NET).
//!
//! Frame layout: `[tag u8][body]`. Strings: `u8 length + UTF-8`. Optional values: `u8 flag (0/1) + value`. Lists:
//! `u16 count + items`. Floats are IEEE-754; a decoder REJECTS non-finite floats in client messages. Unknown tags and
//! trailing bytes are malformed. Size limits are enforced before decoding ([`MAX_CLIENT_FRAME`], [`MAX_SERVER_FRAME`]).
//!
//! # What changed in v2 (Snapshot and Fx; every other message is as in v1)
//!
//! Counters are canonical unsigned LEB128 varints ([`Writer::varint`]). Time is not sent: the server's clock is always
//! `tick * 50 ms` ([`snapshot_server_ms`]), so a decoder derives it. A field equal to its default is left out and its
//! mask bit is clear.
//!
//! ```text
//! Snapshot  0x83, tick varint, ack_input varint,
//!   head u16   bit 15 a self follows; bits 12..13 phase; bits 0..9 the self's fields (all zero without a self)
//!   [self: id varint, x f32, y f32, facing f32, then per head bit:
//!      max_hp  f32 when bit 9 is set, else a varint (an integer in 0..=65535: the usual case)
//!      0 kit u8 (faction | weapon << 4; default 0)     1 hp f32 (default = max_hp)    bits 2..3 status (inline, 0..=3)
//!      4 ready_in_ms u16 (0)    5 kills varint (0)    6 bounty varint (0)    7 gv varint (0)    8 move_seq u8 (0)]
//!   actor_count varint (<= MAX_ACTORS), then per actor (the observation sorts them by id; ids must strictly ascend):
//!     id varint (the first actor's id, then the gap from the previous one), mask u8, x u16, y u16, facing u16, then
//!     per mask bit: 0 kit u8 (default 0)   1 hp_pct u8 (default 100)   bounty varint when bit 4 (default 0)
//!     mask bits 2..3 hold the status (inline, 0..=3); bits 5..7 are reserved and must be zero
//! Fx        0x85, tick varint, count varint (<= 65535), then per item
//!     swing 1: by varint, weapon u8, x u16, y u16, a u16 (quantized as remote actors are)
//!     hit   2: victim varint, by varint, amount f32
//! ```
//!
//! The SELF view keeps full precision (prediction and reconciliation need it); remote actors and swing effects are
//! quantized ([`quant`]: positions 1/8 u, angles 2 pi / 65536, hp_pct exact). Factions and weapons are 4-bit codes, status
//! and phase 2-bit codes: the encoders refuse a larger one ([`EncodeError::BadValue`]) rather than truncate it. Decoders
//! reject reserved bits, values out of range (hp_pct over 100, a varint past its type), ids that do not strictly ascend, a
//! count over [`MAX_ACTORS`] and a non-canonical varint; the encoders never write such a frame.
//!
//! This crate does not depend on the simulation: the server maps sim types to these wire types, so internal refactors never
//! change the wire by accident.
//!
//! Encoding (module `encode`): every message knows its exact `encoded_len()`, so `encode()` allocates the frame once and
//! never regrows it, `encode_into()` appends to a caller's reused buffer, and [`SnapshotWriter`] streams a Snapshot's
//! actors straight from the caller's own data (no intermediate `Vec<WireActor>`). The fallible paths (`try_encode`,
//! `encode_into`, [`SnapshotWriter::finish`]) refuse, with an [`EncodeError`], any message a decoder would reject (more
//! than [`MAX_ACTORS`] actors, an oversized frame, a bad map): the codec never clamps or drops what the observation chose.

pub mod codec;
mod encode;
pub mod map;
pub mod quant;
pub mod samples;

pub use codec::{DecodeError, EncodeError, Reader, Writer};
pub use encode::{encode_welcome, encode_welcome_into, SnapshotWriter, WelcomeHeader};

/// Bump on any incompatible change (a new tag or field in an existing message). Both ends refuse another major version.
pub const PROTOCOL_VERSION: u16 = 2;
/// Milliseconds per server tick (20 Hz). A Snapshot carries `tick` only: its server time is `tick * TICK_MS` exactly.
pub const TICK_MS: u32 = 50;

/// The server time (ms) a Snapshot of `tick` stands for. The simulation advances its clock by exactly one tick step from 0
/// (`rh_sim::Sim::step`), so the product is exact in `f64`; the server test `server_time_is_tick_times_50` holds the
/// identity against the simulation.
#[inline]
pub fn snapshot_server_ms(tick: u32) -> f64 {
    tick as f64 * TICK_MS as f64
}
/// A client frame larger than this is malformed (the largest legal one, an Input with 16 commands, is under 400 bytes).
pub const MAX_CLIENT_FRAME: usize = 1024;
/// A server frame larger than this is a server bug (a Welcome with a map blob is the largest).
pub const MAX_SERVER_FRAME: usize = 256 * 1024;
/// Most commands one Input frame may carry.
pub const MAX_COMMANDS_PER_INPUT: usize = 16;
/// Most actors one Snapshot may list (8 players today; mobs later). Decoders reject more, so the fallible encoders refuse
/// more ([`EncodeError::TooMany`]); deciding what fits is the observation's job, never the codec's.
pub const MAX_ACTORS: usize = 512;

/// Why the server refuses or closes a session. Codes are wire format (append only).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RejectCode {
    ProtocolMismatch = 1,
    ContentMismatch = 2,
    BadCredentials = 3,
    ProfileInUse = 4,
    MatchFull = 5,
    RateLimited = 6,
    Malformed = 7,
    TooSlow = 8,
    ServerDraining = 9,
    NoSuchSession = 10,
    Kicked = 11,
}

impl RejectCode {
    pub fn from_u16(v: u16) -> Option<Self> {
        use RejectCode::*;
        Some(match v {
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
            _ => return None,
        })
    }
}

/// A command as the client sends it (validated again by the server's simulation: never trusted).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum WireCommand {
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
}

#[derive(Clone, Debug, PartialEq)]
pub enum ClientMsg {
    /// First frame of every connection. `resume` is the session token of a dropped connection (reconnect).
    Hello {
        protocol: u16,
        content_hash: u64,
        build: String,
        profile: String,
        token: String,
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
}

#[derive(Clone, Copy, Debug, PartialEq)]
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
}

/// A remote actor as the observation chose it. On the wire its position and facing are quantized ([`quant`]): a decoded
/// actor equals [`WireActor::quantized`] of what was encoded. `hp_pct` is 0..=100 (the observation clamps it).
#[derive(Clone, Copy, Debug, PartialEq)]
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
            hit => hit,
        }
    }
}

/// Important events: delivered reliably and in order (never dropped for a slow client).
#[derive(Clone, Debug, PartialEq)]
pub enum WireEvent {
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
}

/// Presentation effects: a slow client may lose them (the server drops the oldest first under backpressure).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum WireFx {
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
    /// Its server time is [`snapshot_server_ms`]`(tick)`; it is not sent.
    Snapshot {
        tick: u32,
        phase: u8,
        ack_input: u32,
        me: Option<WireSelf>,
        actors: Vec<WireActor>,
    },
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
}

const T_HELLO: u8 = 0x01;
const T_INPUT: u8 = 0x02;
const T_PING: u8 = 0x03;
const T_LEAVE: u8 = 0x04;
const T_WELCOME: u8 = 0x81;
const T_REJECT: u8 = 0x82;
const T_SNAPSHOT: u8 = 0x83;
const T_EVENTS: u8 = 0x84;
const T_FX: u8 = 0x85;
const T_PONG: u8 = 0x86;

const C_MOVE: u8 = 1;
const C_STOP: u8 = 2;
const C_AIM: u8 = 3;
const C_ATTACK: u8 = 4;
const C_RELEASE: u8 = 5;

impl ClientMsg {
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
                token: r.str()?,
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
            t => return Err(DecodeError::BadTag(t)),
        };
        r.end()?;
        Ok(msg)
    }
}

/// Head word bits (protocol v2): the self's field bits 0..=9, phase in bits 12..=13, bit 15 = a self follows.
pub(crate) const HM_KIT: u16 = 1 << 0;
pub(crate) const HM_HP: u16 = 1 << 1;
/// Bits 2..=3: the self's status code, always present (no default).
pub(crate) const HM_STATUS_SHIFT: u16 = 2;
pub(crate) const HM_READY: u16 = 1 << 4;
pub(crate) const HM_KILLS: u16 = 1 << 5;
pub(crate) const HM_BOUNTY: u16 = 1 << 6;
pub(crate) const HM_GV: u16 = 1 << 7;
pub(crate) const HM_MOVE_SEQ: u16 = 1 << 8;
/// `max_hp` is written as an f32 (it is not an integer in 0..=65535); otherwise as a varint.
pub(crate) const HM_MAXHP_F32: u16 = 1 << 9;
pub(crate) const HM_PHASE_SHIFT: u16 = 12;
pub(crate) const HM_PRESENT: u16 = 1 << 15;
/// Bits that belong to the self; a head without a self must have none of them set.
pub(crate) const HM_SELF_BITS: u16 = 0x03ff | HM_PRESENT;
pub(crate) const HM_KNOWN: u16 = HM_SELF_BITS | (3 << HM_PHASE_SHIFT);
/// Actor mask bits: bit 0 kit, bit 1 hp, bits 2..=3 status (always present), bit 4 bounty, bits 5..=7 reserved.
pub(crate) const AM_KIT: u8 = 1 << 0;
pub(crate) const AM_HP: u8 = 1 << 1;
pub(crate) const AM_STATUS_SHIFT: u8 = 2;
pub(crate) const AM_BOUNTY: u8 = 1 << 4;
pub(crate) const AM_KNOWN: u8 = AM_KIT | AM_HP | (3 << AM_STATUS_SHIFT) | AM_BOUNTY;
/// The hp a clear hp bit stands for.
pub(crate) const DEFAULT_HP_PCT: u8 = 100;
/// Largest faction, weapon (4 bits each in the kit byte), status and phase (2 bits each) the wire can carry.
pub const MAX_KIT_CODE: u8 = 15;
pub const MAX_STATUS_CODE: u8 = 3;
pub const MAX_PHASE_CODE: u8 = 3;

fn varint_u16(r: &mut Reader, what: &'static str) -> Result<u16, DecodeError> {
    u16::try_from(r.varint()?).map_err(|_| DecodeError::BadField(what))
}

/// The self record after its head word (`mask` has HM_PRESENT set).
fn read_self(r: &mut Reader, mask: u16) -> Result<WireSelf, DecodeError> {
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
    let gv = if mask & HM_GV != 0 {
        varint_u16(r, "gv")?
    } else {
        0
    };
    let move_seq = if mask & HM_MOVE_SEQ != 0 { r.u8()? } else { 0 };
    Ok(WireSelf {
        id,
        faction,
        x,
        y,
        facing,
        hp,
        max_hp,
        status: ((mask >> HM_STATUS_SHIFT) & 3) as u8,
        weapon,
        ready_in_ms,
        kills,
        bounty,
        gv,
        move_seq,
    })
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
    let mask = r.u8()?;
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
    let bounty = if mask & AM_BOUNTY != 0 {
        varint_u16(r, "bounty")?
    } else {
        0
    };
    Ok(WireActor {
        id,
        faction,
        x,
        y,
        facing,
        hp_pct,
        status: (mask >> AM_STATUS_SHIFT) & 3,
        weapon,
        bounty,
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
                let code = r.u16()?;
                ServerMsg::Reject {
                    code: RejectCode::from_u16(code).ok_or(DecodeError::BadTag(code as u8))?,
                    reason: r.str()?,
                }
            }
            T_SNAPSHOT => {
                let tick = r.varint()?;
                let ack_input = r.varint()?;
                let head = r.u16()?;
                if head & !HM_KNOWN != 0 || (head & HM_PRESENT == 0 && head & HM_SELF_BITS != 0) {
                    return Err(DecodeError::BadField("head"));
                }
                let phase = ((head >> HM_PHASE_SHIFT) & 3) as u8;
                let me = if head & HM_PRESENT != 0 {
                    Some(read_self(&mut r, head)?)
                } else {
                    None
                };
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
                    phase,
                    ack_input,
                    me,
                    actors,
                }
            }
            T_EVENTS => {
                let tick = r.u32()?;
                let n = r.u16()? as usize;
                let mut events = Vec::with_capacity(n.min(1024));
                for _ in 0..n {
                    events.push(match r.u8()? {
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
                        },
                        t => return Err(DecodeError::BadTag(t)),
                    });
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
