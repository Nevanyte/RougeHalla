//! Roguehalla wire protocol, version [`PROTOCOL_VERSION`]. One message per WebSocket BINARY frame (the only transport a
//! browser build can use; served as wss:// in production). Little-endian, fixed-width fields, no reflection: the C# mirror
//! (`client-unity/RoguehallaNet`) decodes the same bytes, and both sides are held to the golden vectors in
//! `protocol/fixtures/` (docs/CONTRACTS.md C-NET).
//!
//! Frame layout: `[tag u8][body]`. Strings: `u8 length + UTF-8`. Optional values: `u8 flag (0/1) + value`. Lists:
//! `u16 count + items`. Floats are IEEE-754; a decoder REJECTS non-finite floats in client messages. Unknown tags and
//! trailing bytes are malformed. Size limits are enforced before decoding ([`MAX_CLIENT_FRAME`], [`MAX_SERVER_FRAME`]).
//!
//! This crate does not depend on the simulation: the server maps sim types to these wire types, so internal refactors never
//! change the wire by accident.

pub mod codec;
pub mod map;
pub mod samples;

pub use codec::{DecodeError, Reader, Writer};

/// Bump on any incompatible change (a new tag or field in an existing message). Both ends refuse another major version.
pub const PROTOCOL_VERSION: u16 = 1;
/// A client frame larger than this is malformed (the largest legal one, an Input with 16 commands, is under 400 bytes).
pub const MAX_CLIENT_FRAME: usize = 1024;
/// A server frame larger than this is a server bug (a Welcome with a map blob is the largest).
pub const MAX_SERVER_FRAME: usize = 256 * 1024;
/// Most commands one Input frame may carry.
pub const MAX_COMMANDS_PER_INPUT: usize = 16;
/// Most actors one Snapshot may list (8 players today; mobs later).
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
    Snapshot {
        tick: u32,
        server_ms: f64,
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
    pub fn encode(&self) -> Vec<u8> {
        let mut w = Writer::default();
        match self {
            ClientMsg::Hello {
                protocol,
                content_hash,
                build,
                profile,
                token,
                faction,
                resume,
            } => {
                w.u8(T_HELLO);
                w.u16(*protocol);
                w.u64(*content_hash);
                w.str(build);
                w.str(profile);
                w.str(token);
                w.opt(faction.as_ref(), |w, f| w.u8(*f));
                w.opt(resume.as_ref(), |w, r| w.bytes(r));
            }
            ClientMsg::Input { seq, commands } => {
                w.u8(T_INPUT);
                w.u32(*seq);
                w.u16(commands.len() as u16);
                for c in commands {
                    match *c {
                        WireCommand::Move { x, y, seq } => {
                            w.u8(C_MOVE);
                            w.f32(x);
                            w.f32(y);
                            w.opt(seq.as_ref(), |w, s| w.u8(*s));
                        }
                        WireCommand::Stop { seq } => {
                            w.u8(C_STOP);
                            w.opt(seq.as_ref(), |w, s| w.u8(*s));
                        }
                        WireCommand::Aim { a } => {
                            w.u8(C_AIM);
                            w.f32(a);
                        }
                        WireCommand::Attack { a, t } => {
                            w.u8(C_ATTACK);
                            w.f32(a);
                            w.opt(t.as_ref(), |w, t| w.f64(*t));
                        }
                        WireCommand::Release { a, t } => {
                            w.u8(C_RELEASE);
                            w.f32(a);
                            w.opt(t.as_ref(), |w, t| w.f64(*t));
                        }
                    }
                }
            }
            ClientMsg::Ping { nonce, client_ms } => {
                w.u8(T_PING);
                w.u32(*nonce);
                w.f64(*client_ms);
            }
            ClientMsg::Leave => w.u8(T_LEAVE),
        }
        w.finish()
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

fn write_self(w: &mut Writer, s: &WireSelf) {
    w.u32(s.id);
    w.u8(s.faction);
    w.f32(s.x);
    w.f32(s.y);
    w.f32(s.facing);
    w.f32(s.hp);
    w.f32(s.max_hp);
    w.u8(s.status);
    w.u8(s.weapon);
    w.u16(s.ready_in_ms);
    w.u16(s.kills);
    w.u16(s.bounty);
    w.u16(s.gv);
    w.u8(s.move_seq);
}

fn read_self(r: &mut Reader) -> Result<WireSelf, DecodeError> {
    Ok(WireSelf {
        id: r.u32()?,
        faction: r.u8()?,
        x: r.f32()?,
        y: r.f32()?,
        facing: r.f32()?,
        hp: r.f32()?,
        max_hp: r.f32()?,
        status: r.u8()?,
        weapon: r.u8()?,
        ready_in_ms: r.u16()?,
        kills: r.u16()?,
        bounty: r.u16()?,
        gv: r.u16()?,
        move_seq: r.u8()?,
    })
}

impl ServerMsg {
    pub fn encode(&self) -> Vec<u8> {
        let mut w = Writer::default();
        match self {
            ServerMsg::Welcome {
                protocol,
                content_hash,
                match_id,
                player_id,
                session,
                tick_rate,
                tick,
                server_ms,
                map,
            } => {
                w.u8(T_WELCOME);
                w.u16(*protocol);
                w.u64(*content_hash);
                w.bytes(match_id);
                w.u32(*player_id);
                w.bytes(session);
                w.u8(*tick_rate);
                w.u32(*tick);
                w.f64(*server_ms);
                map.write(&mut w);
            }
            ServerMsg::Reject { code, reason } => {
                w.u8(T_REJECT);
                w.u16(*code as u16);
                w.str(reason);
            }
            ServerMsg::Snapshot {
                tick,
                server_ms,
                phase,
                ack_input,
                me,
                actors,
            } => {
                w.u8(T_SNAPSHOT);
                w.u32(*tick);
                w.f64(*server_ms);
                w.u8(*phase);
                w.u32(*ack_input);
                w.opt(me.as_ref(), write_self);
                w.u16(actors.len() as u16);
                for a in actors {
                    w.u32(a.id);
                    w.u8(a.faction);
                    w.f32(a.x);
                    w.f32(a.y);
                    w.f32(a.facing);
                    w.u8(a.hp_pct);
                    w.u8(a.status);
                    w.u8(a.weapon);
                    w.u16(a.bounty);
                }
            }
            ServerMsg::Events { tick, events } => {
                w.u8(T_EVENTS);
                w.u32(*tick);
                w.u16(events.len() as u16);
                for e in events {
                    match e {
                        WireEvent::Death { id, by } => {
                            w.u8(1);
                            w.u32(*id);
                            w.opt(by.as_ref(), |w, b| w.u32(*b));
                        }
                        WireEvent::Bounty { id, bounty } => {
                            w.u8(2);
                            w.u32(*id);
                            w.u16(*bounty);
                        }
                        WireEvent::MatchEnded { winner, draw } => {
                            w.u8(3);
                            w.opt(winner.as_ref(), |w, b| w.u32(*b));
                            w.u8(*draw as u8);
                        }
                        WireEvent::Result(r) => {
                            w.u8(4);
                            w.u8(r.outcome);
                            w.u8(r.place);
                            w.u8(r.players);
                            w.u16(r.kills);
                            w.opt(r.killed_by.as_ref(), |w, s| w.str(s));
                            w.u32(r.gv_total);
                            w.u32(r.gv_win);
                            w.u32(r.duration_sec);
                            w.u8(r.win_bonus_withheld as u8);
                        }
                    }
                }
            }
            ServerMsg::Fx { tick, fx } => {
                w.u8(T_FX);
                w.u32(*tick);
                w.u16(fx.len() as u16);
                for f in fx {
                    match *f {
                        WireFx::Swing {
                            by,
                            weapon,
                            x,
                            y,
                            a,
                        } => {
                            w.u8(1);
                            w.u32(by);
                            w.u8(weapon);
                            w.f32(x);
                            w.f32(y);
                            w.f32(a);
                        }
                        WireFx::Hit { victim, by, amount } => {
                            w.u8(2);
                            w.u32(victim);
                            w.u32(by);
                            w.f32(amount);
                        }
                    }
                }
            }
            ServerMsg::Pong {
                nonce,
                client_ms,
                server_ms,
            } => {
                w.u8(T_PONG);
                w.u32(*nonce);
                w.f64(*client_ms);
                w.f64(*server_ms);
            }
        }
        w.finish()
    }

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
                let tick = r.u32()?;
                let server_ms = r.f64()?;
                let phase = r.u8()?;
                let ack_input = r.u32()?;
                let me = r.opt(read_self)?;
                let n = r.u16()? as usize;
                if n > MAX_ACTORS {
                    return Err(DecodeError::TooMany(n));
                }
                let mut actors = Vec::with_capacity(n);
                for _ in 0..n {
                    actors.push(WireActor {
                        id: r.u32()?,
                        faction: r.u8()?,
                        x: r.f32()?,
                        y: r.f32()?,
                        facing: r.f32()?,
                        hp_pct: r.u8()?,
                        status: r.u8()?,
                        weapon: r.u8()?,
                        bounty: r.u16()?,
                    });
                }
                ServerMsg::Snapshot {
                    tick,
                    server_ms,
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
                let tick = r.u32()?;
                let n = r.u16()? as usize;
                let mut fx = Vec::with_capacity(n.min(1024));
                for _ in 0..n {
                    fx.push(match r.u8()? {
                        1 => WireFx::Swing {
                            by: r.u32()?,
                            weapon: r.u8()?,
                            x: r.f32()?,
                            y: r.f32()?,
                            a: r.f32()?,
                        },
                        2 => WireFx::Hit {
                            victim: r.u32()?,
                            by: r.u32()?,
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
