//! Encoders. Every message has an exact [`ServerMsg::encoded_len`] / [`ClientMsg::encoded_len`], so a frame is written
//! into a buffer sized once:
//!
//! * `encode()` allocates exactly one `Vec` of exactly the frame's size (the infallible path the server uses today; a
//!   message decoders would reject trips a `debug_assert`).
//! * `encode_into(&mut Vec<u8>)` appends to a caller's buffer (reused across frames: no allocation once it is warm) and
//!   returns an [`EncodeError`] instead of writing a frame decoders would reject. `try_encode()` is the same into a fresh,
//!   exact `Vec`.
//! * [`SnapshotWriter`] streams a Snapshot's actors from the caller's own data, so a server can encode straight from an
//!   observation without building a `Vec<WireActor>` first.
//! * [`encode_welcome`] takes a map that was RLE-encoded once ([`crate::map::MapBlob::pre_encode`]).
//!
//! One layout: `ServerMsg::Snapshot` and [`SnapshotWriter`] share the same header and actor writers, and a test holds
//! every path byte-identical to the golden vectors.

use crate::codec::{str_len, EncodeError, Writer};
use crate::map::EncodedMap;
use crate::*;

/// `tag u8, tick u32, server_ms f64, phase u8, ack_input u32`.
const SNAPSHOT_HEAD_LEN: usize = 18;
/// [`WireSelf`] on the wire.
pub(crate) const SELF_LEN: usize = 36;
/// [`WireActor`] on the wire.
pub(crate) const ACTOR_LEN: usize = 22;
/// Welcome up to the map: `tag, protocol u16, content_hash u64, match_id 16, player_id u32, session 16, tick_rate u8,
/// tick u32, server_ms f64`.
const WELCOME_HEAD_LEN: usize = 60;

const fn opt_len(present: bool, len: usize) -> usize {
    if present {
        1 + len
    } else {
        1
    }
}

/// What both message enums share: an exact size, the checks a decoder would apply, and the writer.
trait Frame {
    const MAX_FRAME: usize;
    fn encoded_len(&self) -> usize;
    /// `len` is `encoded_len()` (computed once by the caller).
    fn check(&self, len: usize) -> Result<(), EncodeError>;
    fn write(&self, w: &mut Writer);
}

fn frame_size(len: usize, max: usize) -> Result<(), EncodeError> {
    if len > max {
        return Err(EncodeError::TooLarge { len, max });
    }
    Ok(())
}

fn list(what: &'static str, n: usize, max: usize) -> Result<(), EncodeError> {
    if n > max {
        return Err(EncodeError::TooMany { what, n, max });
    }
    Ok(())
}

fn encode_exact<F: Frame>(m: &F) -> Vec<u8> {
    let len = m.encoded_len();
    #[cfg(debug_assertions)]
    if let Err(e) = m.check(len) {
        panic!("encoding a frame every decoder rejects: {e} (use try_encode or encode_into)");
    }
    let mut w = Writer::with_capacity(len);
    m.write(&mut w);
    debug_assert_eq!(w.len(), len, "encoded_len disagrees with the writer");
    w.finish()
}

fn encode_into<F: Frame>(m: &F, out: &mut Vec<u8>) -> Result<usize, EncodeError> {
    let len = m.encoded_len();
    m.check(len)?;
    let start = out.len();
    let mut w = Writer::from_vec(std::mem::take(out));
    w.reserve(len);
    m.write(&mut w);
    *out = w.finish();
    debug_assert_eq!(
        out.len() - start,
        len,
        "encoded_len disagrees with the writer"
    );
    Ok(len)
}

fn command_len(c: &WireCommand) -> usize {
    match *c {
        WireCommand::Move { seq, .. } => 1 + 8 + opt_len(seq.is_some(), 1),
        WireCommand::Stop { seq } => 1 + opt_len(seq.is_some(), 1),
        WireCommand::Aim { .. } => 1 + 4,
        WireCommand::Attack { t, .. } | WireCommand::Release { t, .. } => {
            1 + 4 + opt_len(t.is_some(), 8)
        }
    }
}

fn command_finite(c: &WireCommand) -> bool {
    match *c {
        WireCommand::Move { x, y, .. } => x.is_finite() && y.is_finite(),
        WireCommand::Stop { .. } => true,
        WireCommand::Aim { a } => a.is_finite(),
        WireCommand::Attack { a, t } | WireCommand::Release { a, t } => {
            a.is_finite() && t.is_none_or(f64::is_finite)
        }
    }
}

impl Frame for ClientMsg {
    const MAX_FRAME: usize = MAX_CLIENT_FRAME;

    fn encoded_len(&self) -> usize {
        match self {
            ClientMsg::Hello {
                build,
                profile,
                token,
                faction,
                resume,
                ..
            } => {
                1 + 2
                    + 8
                    + str_len(build)
                    + str_len(profile)
                    + str_len(token)
                    + opt_len(faction.is_some(), 1)
                    + opt_len(resume.is_some(), 16)
            }
            ClientMsg::Input { commands, .. } => {
                1 + 4 + 2 + commands.iter().map(command_len).sum::<usize>()
            }
            ClientMsg::Ping { .. } => 1 + 4 + 8,
            ClientMsg::Leave => 1,
        }
    }

    fn check(&self, len: usize) -> Result<(), EncodeError> {
        match self {
            ClientMsg::Input { commands, .. } => {
                list("commands", commands.len(), MAX_COMMANDS_PER_INPUT)?;
                if !commands.iter().all(command_finite) {
                    return Err(EncodeError::NonFinite);
                }
            }
            ClientMsg::Ping { client_ms, .. } if !client_ms.is_finite() => {
                return Err(EncodeError::NonFinite)
            }
            _ => {}
        }
        frame_size(len, Self::MAX_FRAME)
    }

    fn write(&self, w: &mut Writer) {
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
    }
}

impl ClientMsg {
    /// The frame, in one allocation of exactly [`ClientMsg::encoded_len`] bytes. A message decoders would reject (more
    /// than [`MAX_COMMANDS_PER_INPUT`] commands, a non-finite float) panics in debug builds; use [`ClientMsg::try_encode`]
    /// where that can happen.
    pub fn encode(&self) -> Vec<u8> {
        encode_exact(self)
    }

    /// Like [`ClientMsg::encode`], but a message decoders would reject is an error.
    pub fn try_encode(&self) -> Result<Vec<u8>, EncodeError> {
        let mut out = Vec::new();
        encode_into(self, &mut out)?;
        Ok(out)
    }

    /// Appends the frame to `out` and returns its length; on error `out` is unchanged.
    pub fn encode_into(&self, out: &mut Vec<u8>) -> Result<usize, EncodeError> {
        encode_into(self, out)
    }

    /// Exact size of the frame [`ClientMsg::encode`] writes.
    pub fn encoded_len(&self) -> usize {
        Frame::encoded_len(self)
    }
}

fn event_len(e: &WireEvent) -> usize {
    match e {
        WireEvent::Death { by, .. } => 1 + 4 + opt_len(by.is_some(), 4),
        WireEvent::Bounty { .. } => 1 + 4 + 2,
        WireEvent::MatchEnded { winner, .. } => 1 + opt_len(winner.is_some(), 4) + 1,
        WireEvent::Result(r) => {
            1 + 3 + 2 + 1 + r.killed_by.as_deref().map_or(0, str_len) + 4 + 4 + 4 + 1
        }
    }
}

fn fx_len(f: &WireFx) -> usize {
    match f {
        WireFx::Swing { .. } => 1 + 4 + 1 + 4 + 4 + 4,
        WireFx::Hit { .. } => 1 + 4 + 4 + 4,
    }
}

/// Exact size of a Snapshot frame.
fn snapshot_len(me: bool, actors: usize) -> usize {
    SNAPSHOT_HEAD_LEN + opt_len(me, SELF_LEN) + 2 + ACTOR_LEN * actors
}

fn write_self(w: &mut Writer, s: &WireSelf) {
    let mut b = [0u8; SELF_LEN];
    b[0..4].copy_from_slice(&s.id.to_le_bytes());
    b[4] = s.faction;
    b[5..9].copy_from_slice(&s.x.to_le_bytes());
    b[9..13].copy_from_slice(&s.y.to_le_bytes());
    b[13..17].copy_from_slice(&s.facing.to_le_bytes());
    b[17..21].copy_from_slice(&s.hp.to_le_bytes());
    b[21..25].copy_from_slice(&s.max_hp.to_le_bytes());
    b[25] = s.status;
    b[26] = s.weapon;
    b[27..29].copy_from_slice(&s.ready_in_ms.to_le_bytes());
    b[29..31].copy_from_slice(&s.kills.to_le_bytes());
    b[31..33].copy_from_slice(&s.bounty.to_le_bytes());
    b[33..35].copy_from_slice(&s.gv.to_le_bytes());
    b[35] = s.move_seq;
    w.bytes(&b);
}

#[inline]
fn write_actor(w: &mut Writer, a: &WireActor) {
    let mut b = [0u8; ACTOR_LEN];
    b[0..4].copy_from_slice(&a.id.to_le_bytes());
    b[4] = a.faction;
    b[5..9].copy_from_slice(&a.x.to_le_bytes());
    b[9..13].copy_from_slice(&a.y.to_le_bytes());
    b[13..17].copy_from_slice(&a.facing.to_le_bytes());
    b[17] = a.hp_pct;
    b[18] = a.status;
    b[19] = a.weapon;
    b[20..22].copy_from_slice(&a.bounty.to_le_bytes());
    w.bytes(&b);
}

/// Everything of a Snapshot before the actor count: the fixed header and the optional self.
fn write_snapshot_head(
    w: &mut Writer,
    tick: u32,
    server_ms: f64,
    phase: u8,
    ack_input: u32,
    me: Option<&WireSelf>,
) {
    let mut b = [0u8; SNAPSHOT_HEAD_LEN];
    b[0] = T_SNAPSHOT;
    b[1..5].copy_from_slice(&tick.to_le_bytes());
    b[5..13].copy_from_slice(&server_ms.to_le_bytes());
    b[13] = phase;
    b[14..18].copy_from_slice(&ack_input.to_le_bytes());
    w.bytes(&b);
    w.opt(me, write_self);
}

impl Frame for ServerMsg {
    const MAX_FRAME: usize = MAX_SERVER_FRAME;

    fn encoded_len(&self) -> usize {
        match self {
            ServerMsg::Welcome { map, .. } => WELCOME_HEAD_LEN + map.encoded_len(),
            ServerMsg::Reject { reason, .. } => 1 + 2 + str_len(reason),
            ServerMsg::Snapshot { me, actors, .. } => snapshot_len(me.is_some(), actors.len()),
            ServerMsg::Events { events, .. } => {
                1 + 4 + 2 + events.iter().map(event_len).sum::<usize>()
            }
            ServerMsg::Fx { fx, .. } => 1 + 4 + 2 + fx.iter().map(fx_len).sum::<usize>(),
            ServerMsg::Pong { .. } => 1 + 4 + 8 + 8,
        }
    }

    fn check(&self, len: usize) -> Result<(), EncodeError> {
        match self {
            ServerMsg::Welcome { map, .. } => map.check()?,
            ServerMsg::Snapshot { actors, .. } => list("actors", actors.len(), MAX_ACTORS)?,
            ServerMsg::Events { events, .. } => list("events", events.len(), u16::MAX as usize)?,
            ServerMsg::Fx { fx, .. } => list("fx", fx.len(), u16::MAX as usize)?,
            ServerMsg::Reject { .. } | ServerMsg::Pong { .. } => {}
        }
        frame_size(len, Self::MAX_FRAME)
    }

    fn write(&self, w: &mut Writer) {
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
                WelcomeHeader {
                    protocol: *protocol,
                    content_hash: *content_hash,
                    match_id: *match_id,
                    player_id: *player_id,
                    session: *session,
                    tick_rate: *tick_rate,
                    tick: *tick,
                    server_ms: *server_ms,
                }
                .write(w);
                map.write(w);
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
                write_snapshot_head(w, *tick, *server_ms, *phase, *ack_input, me.as_ref());
                w.u16(actors.len() as u16);
                for a in actors {
                    write_actor(w, a);
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
    }
}

impl ServerMsg {
    /// The frame, in one allocation of exactly [`ServerMsg::encoded_len`] bytes. A message decoders would reject (more
    /// than [`MAX_ACTORS`] actors, an oversized frame, a bad map) panics in debug builds and is NOT repaired in release
    /// builds; use [`ServerMsg::try_encode`] or [`ServerMsg::encode_into`] where that can happen.
    pub fn encode(&self) -> Vec<u8> {
        encode_exact(self)
    }

    /// Like [`ServerMsg::encode`], but a message decoders would reject is an error.
    pub fn try_encode(&self) -> Result<Vec<u8>, EncodeError> {
        let mut out = Vec::new();
        encode_into(self, &mut out)?;
        Ok(out)
    }

    /// Appends the frame to `out` (a buffer the caller reuses) and returns its length; on error `out` is unchanged.
    pub fn encode_into(&self, out: &mut Vec<u8>) -> Result<usize, EncodeError> {
        encode_into(self, out)
    }

    /// Exact size of the frame [`ServerMsg::encode`] writes (a Welcome counts its map's runs: one pass, no allocation).
    pub fn encoded_len(&self) -> usize {
        Frame::encoded_len(self)
    }
}

/// The fields of a Welcome before its map, for [`encode_welcome`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WelcomeHeader {
    pub protocol: u16,
    pub content_hash: u64,
    pub match_id: [u8; 16],
    pub player_id: u32,
    pub session: [u8; 16],
    pub tick_rate: u8,
    pub tick: u32,
    pub server_ms: f64,
}

impl WelcomeHeader {
    fn write(&self, w: &mut Writer) {
        w.u8(T_WELCOME);
        w.u16(self.protocol);
        w.u64(self.content_hash);
        w.bytes(&self.match_id);
        w.u32(self.player_id);
        w.bytes(&self.session);
        w.u8(self.tick_rate);
        w.u32(self.tick);
        w.f64(self.server_ms);
    }
}

/// A Welcome frame with a pre-encoded map: the same bytes as `ServerMsg::Welcome { .., map }.encode()`, without RLE
/// encoding (or cloning) the map per joining player. One allocation of the exact size.
pub fn encode_welcome(h: &WelcomeHeader, map: &EncodedMap) -> Vec<u8> {
    let len = WELCOME_HEAD_LEN + map.len();
    debug_assert!(
        len <= MAX_SERVER_FRAME,
        "a Welcome of {len} bytes exceeds MAX_SERVER_FRAME"
    );
    let mut w = Writer::with_capacity(len);
    h.write(&mut w);
    w.bytes(map.as_bytes());
    w.finish()
}

/// [`encode_welcome`] appended to `out`; a frame over [`MAX_SERVER_FRAME`] is an error and leaves `out` unchanged.
pub fn encode_welcome_into(
    h: &WelcomeHeader,
    map: &EncodedMap,
    out: &mut Vec<u8>,
) -> Result<usize, EncodeError> {
    let len = WELCOME_HEAD_LEN + map.len();
    frame_size(len, MAX_SERVER_FRAME)?;
    let mut w = Writer::from_vec(std::mem::take(out));
    w.reserve(len);
    h.write(&mut w);
    w.bytes(map.as_bytes());
    *out = w.finish();
    Ok(len)
}

/// Streams one Snapshot frame into a caller's buffer: [`SnapshotWriter::begin`] writes the header and self, each
/// [`SnapshotWriter::actor`] appends one actor, and [`SnapshotWriter::finish`] patches the actor count. The caller maps
/// its own data (an observation) to [`WireActor`]s one at a time on the stack, so no `Vec<WireActor>` is built. The
/// bytes are exactly those of the equivalent `ServerMsg::Snapshot`.
///
/// More than [`MAX_ACTORS`] actors is an error at `finish` (the frame is removed from the buffer); the writer never
/// drops actors itself. Dropping the writer without `finish` also removes the partial frame.
pub struct SnapshotWriter<'a> {
    out: &'a mut Vec<u8>,
    w: Writer,
    start: usize,
    count_at: usize,
    n: usize,
}

impl<'a> SnapshotWriter<'a> {
    /// `actors_hint`: how many actors will follow (the buffer is reserved for exactly that many; more still works).
    pub fn begin(
        out: &'a mut Vec<u8>,
        tick: u32,
        server_ms: f64,
        phase: u8,
        ack_input: u32,
        me: Option<&WireSelf>,
        actors_hint: usize,
    ) -> Self {
        let start = out.len();
        let mut w = Writer::from_vec(std::mem::take(out));
        w.reserve(snapshot_len(me.is_some(), actors_hint));
        write_snapshot_head(&mut w, tick, server_ms, phase, ack_input, me);
        let count_at = w.len();
        w.u16(0);
        Self {
            out,
            w,
            start,
            count_at,
            n: 0,
        }
    }

    /// Appends one actor (in the order the observation lists them).
    #[inline]
    pub fn actor(&mut self, a: &WireActor) {
        write_actor(&mut self.w, a);
        self.n += 1;
    }

    /// Actors written so far.
    pub fn actors(&self) -> usize {
        self.n
    }

    /// Completes the frame and returns its length, or removes it from the buffer and fails when it lists more than
    /// [`MAX_ACTORS`] actors (a frame every decoder would reject).
    pub fn finish(mut self) -> Result<usize, EncodeError> {
        list("actors", self.n, MAX_ACTORS)?;
        self.w.patch_u16(self.count_at, self.n as u16);
        let len = self.w.len() - self.start;
        debug_assert_eq!(
            len,
            snapshot_len(self.count_at - self.start > SNAPSHOT_HEAD_LEN + 1, self.n)
        );
        // Mark the frame complete for Drop: everything up to the current end is kept.
        self.start = self.w.len();
        Ok(len)
    }
}

impl Drop for SnapshotWriter<'_> {
    /// Hands the buffer back; an unfinished (or refused) frame is removed, so `out` never holds half a frame.
    fn drop(&mut self) {
        let mut w = std::mem::take(&mut self.w);
        w.truncate(self.start);
        *self.out = w.finish();
    }
}
