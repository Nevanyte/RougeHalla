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
//! every path byte-identical to the golden vectors. A v2 Snapshot's size depends on its content (field masks, varints), so
//! `encoded_len()` walks the actors once (no allocation) instead of multiplying.

use crate::codec::{str_len, varint_len, EncodeError, Writer};
use crate::map::EncodedMap;
use crate::*;

/// Fewest bytes a Snapshot takes before its actors and self: tag, tick, phase, ack, mask (2), count.
const MIN_SNAPSHOT_HEAD_LEN: usize = 1 + 1 + 1 + 1 + 2 + 1;
/// Fewest bytes a self takes after its mask: id and four floats.
const MIN_SELF_LEN: usize = 1 + 16;
/// Fewest bytes one actor takes: id, mask, x, y, facing.
const MIN_ACTOR_LEN: usize = 1 + 1 + 6;

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
    /// The frame in one allocation of exactly its length. The default sizes it first (`encoded_len`), then writes.
    fn exact_vec(&self) -> Vec<u8> {
        sized_then_written(self)
    }
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
    m.exact_vec()
}

fn sized_then_written<F: Frame + ?Sized>(m: &F) -> Vec<u8> {
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
        WireFx::Swing { by, .. } => 1 + varint_len(*by) + 1 + 6,
        WireFx::Hit { victim, by, .. } => 1 + varint_len(*victim) + varint_len(*by) + 4,
    }
}

/// `max_hp` goes out as a varint when it is an integer in 0..=65535 (the bit pattern survives the round trip, so -0.0, NaN
/// and fractions take the f32 path).
#[inline]
fn max_hp_is_varint(v: f32) -> bool {
    (v as u16 as f32).to_bits() == v.to_bits()
}

#[inline]
fn kit(faction: u8, weapon: u8) -> u8 {
    (faction & 0x0f) | (weapon << 4)
}

/// The head word of a Snapshot: the phase, and for a self its present bit, field bits and status.
fn head_word(phase: u8, me: Option<&WireSelf>) -> u16 {
    let mut m = (phase as u16 & 3) << HM_PHASE_SHIFT;
    let Some(s) = me else { return m };
    m |= HM_PRESENT | ((s.status as u16 & 3) << HM_STATUS_SHIFT);
    if kit(s.faction, s.weapon) != 0 {
        m |= HM_KIT;
    }
    // Bitwise: -0.0 and NaN payloads must survive.
    if s.hp.to_bits() != s.max_hp.to_bits() {
        m |= HM_HP;
    }
    if s.ready_in_ms != 0 {
        m |= HM_READY;
    }
    if s.kills != 0 {
        m |= HM_KILLS;
    }
    if s.bounty != 0 {
        m |= HM_BOUNTY;
    }
    if s.gv != 0 {
        m |= HM_GV;
    }
    if s.move_seq != 0 {
        m |= HM_MOVE_SEQ;
    }
    if !max_hp_is_varint(s.max_hp) {
        m |= HM_MAXHP_F32;
    }
    m
}

/// Bytes of the self record after its head word.
fn self_len(s: &WireSelf, mask: u16) -> usize {
    let mut n = varint_len(s.id) + 12;
    n += if mask & HM_MAXHP_F32 != 0 {
        4
    } else {
        varint_len(s.max_hp as u32)
    };
    if mask & HM_KIT != 0 {
        n += 1;
    }
    if mask & HM_HP != 0 {
        n += 4;
    }
    if mask & HM_READY != 0 {
        n += 2;
    }
    if mask & HM_KILLS != 0 {
        n += varint_len(s.kills as u32);
    }
    if mask & HM_BOUNTY != 0 {
        n += varint_len(s.bounty as u32);
    }
    if mask & HM_GV != 0 {
        n += varint_len(s.gv as u32);
    }
    if mask & HM_MOVE_SEQ != 0 {
        n += 1;
    }
    n
}

/// A record built on the stack (no capacity checks per byte), then appended to the frame with one copy: the byte-wise
/// `Vec::push` path of [`Writer`] dominated the cost of a Snapshot's header and actors. `N` is the record's maximum size
/// (a longer write panics, which the size constants below make unreachable).
struct Fixed<const N: usize> {
    b: [u8; N],
    n: usize,
}

impl<const N: usize> Fixed<N> {
    #[inline]
    fn new() -> Self {
        Self { b: [0; N], n: 0 }
    }
    #[inline]
    fn u8(&mut self, v: u8) {
        self.b[self.n] = v;
        self.n += 1;
    }
    #[inline]
    fn bytes<const M: usize>(&mut self, v: [u8; M]) {
        if let Some(dst) = self.b[self.n..].first_chunk_mut::<M>() {
            *dst = v;
            self.n += M;
        } else {
            unreachable!("Fixed record overflow");
        }
    }
    #[inline]
    fn u16(&mut self, v: u16) {
        self.bytes(v.to_le_bytes());
    }
    #[inline]
    fn f32(&mut self, v: f32) {
        self.bytes(v.to_le_bytes());
    }
    #[inline]
    fn varint(&mut self, mut v: u32) {
        while v >= 0x80 {
            self.u8((v as u8) | 0x80);
            v >>= 7;
        }
        self.u8(v as u8);
    }
    #[inline]
    fn put(&self, w: &mut Writer) {
        w.bytes(&self.b[..self.n]);
    }
}

/// Largest Snapshot head: tag, tick, ack (5 each at most), head word, a full self (id 5, 12, max_hp 4, kit, hp 4, ready 2,
/// kills, bounty, gv 3 each, move_seq) and the actor count.
const MAX_HEAD_LEN: usize = 1 + 5 + 5 + 2 + 5 + 12 + 4 + 1 + 4 + 2 + 9 + 1 + 5;
/// Largest actor: id 5, mask, x, y, facing, kit, hp, bounty 3.
const MAX_ACTOR_LEN: usize = 5 + 1 + 6 + 1 + 1 + 3;

/// Writes the self record and returns its head word, in one pass over the optional fields (the same word [`head_word`]
/// computes for [`self_len`]; a debug assertion holds them equal). The caller patches the word in.
#[inline]
fn write_self(w: &mut Fixed<MAX_HEAD_LEN>, phase: u8, s: &WireSelf) -> u16 {
    let mut m = ((phase as u16 & 3) << HM_PHASE_SHIFT)
        | HM_PRESENT
        | ((s.status as u16 & 3) << HM_STATUS_SHIFT);
    w.varint(s.id);
    let [x0, x1, x2, x3] = s.x.to_le_bytes();
    let [y0, y1, y2, y3] = s.y.to_le_bytes();
    let [f0, f1, f2, f3] = s.facing.to_le_bytes();
    w.bytes([x0, x1, x2, x3, y0, y1, y2, y3, f0, f1, f2, f3]);
    if max_hp_is_varint(s.max_hp) {
        w.varint(s.max_hp as u32);
    } else {
        m |= HM_MAXHP_F32;
        w.f32(s.max_hp);
    }
    let k = kit(s.faction, s.weapon);
    if k != 0 {
        m |= HM_KIT;
        w.u8(k);
    }
    // Bitwise: -0.0 and NaN payloads must survive.
    if s.hp.to_bits() != s.max_hp.to_bits() {
        m |= HM_HP;
        w.f32(s.hp);
    }
    if s.ready_in_ms != 0 {
        m |= HM_READY;
        w.u16(s.ready_in_ms);
    }
    if s.kills != 0 {
        m |= HM_KILLS;
        w.varint(s.kills as u32);
    }
    if s.bounty != 0 {
        m |= HM_BOUNTY;
        w.varint(s.bounty as u32);
    }
    if s.gv != 0 {
        m |= HM_GV;
        w.varint(s.gv as u32);
    }
    if s.move_seq != 0 {
        m |= HM_MOVE_SEQ;
        w.u8(s.move_seq);
    }
    m
}

/// The actor mask of `a`: the status inline, and a bit for every optional field that differs from its default.
#[inline]
fn actor_mask(a: &WireActor) -> u8 {
    let mut m = (a.status & 3) << AM_STATUS_SHIFT;
    if kit(a.faction, a.weapon) != 0 {
        m |= AM_KIT;
    }
    if a.hp_pct != DEFAULT_HP_PCT {
        m |= AM_HP;
    }
    if a.bounty != 0 {
        m |= AM_BOUNTY;
    }
    m
}

/// Bytes one actor takes on the wire.
#[inline]
fn actor_len(a: &WireActor, prev: Option<u32>) -> usize {
    let m = actor_mask(a);
    varint_len(id_field(a.id, prev))
        + 1
        + 6
        + (m & AM_KIT != 0) as usize
        + (m & AM_HP != 0) as usize
        + if m & AM_BOUNTY != 0 {
            varint_len(a.bounty as u32)
        } else {
            0
        }
}

/// The id as written: the first actor's absolute id, then the gap to the previous one (the observation sorts by id, so a
/// gap is small and a varint of it is mostly one byte).
#[inline]
fn id_field(id: u32, prev: Option<u32>) -> u32 {
    match prev {
        None => id,
        Some(p) => id.wrapping_sub(p),
    }
}

/// The first reason a decoder would reject this Snapshot's content (None when it is encodable).
fn snapshot_fault(phase: u8, me: Option<&WireSelf>, actors: &[WireActor]) -> Option<&'static str> {
    if phase > MAX_PHASE_CODE {
        return Some("phase");
    }
    if let Some(s) = me {
        if let Some(f) = kit_status_fault(s.faction, s.weapon, s.status) {
            return Some(f);
        }
    }
    let mut prev: Option<u32> = None;
    for a in actors {
        if let Some(f) = kit_status_fault(a.faction, a.weapon, a.status) {
            return Some(f);
        }
        if a.hp_pct > 100 {
            return Some("hp_pct");
        }
        if !quant::pos_in_range(a.x) || !quant::pos_in_range(a.y) {
            return Some("position");
        }
        if prev.is_some_and(|p| a.id <= p) {
            return Some("actor order");
        }
        prev = Some(a.id);
    }
    None
}

fn kit_status_fault(faction: u8, weapon: u8, status: u8) -> Option<&'static str> {
    if faction > MAX_KIT_CODE {
        Some("faction")
    } else if weapon > MAX_KIT_CODE {
        Some("weapon")
    } else if status > MAX_STATUS_CODE {
        Some("status")
    } else {
        None
    }
}

#[inline]
fn write_actor(out: &mut Writer, a: &WireActor, prev: Option<u32>) {
    let m = actor_mask(a);
    let mut w = Fixed::<MAX_ACTOR_LEN>::new();
    w.varint(id_field(a.id, prev));
    w.u8(m);
    w.u16(quant::quantize_pos(a.x));
    w.u16(quant::quantize_pos(a.y));
    w.u16(quant::quantize_facing(a.facing));
    if m & AM_KIT != 0 {
        w.u8(kit(a.faction, a.weapon));
    }
    if m & AM_HP != 0 {
        w.u8(a.hp_pct);
    }
    if m & AM_BOUNTY != 0 {
        w.varint(a.bounty as u32);
    }
    w.put(out);
}

/// Exact size of a Snapshot frame.
fn snapshot_len(
    tick: u32,
    phase: u8,
    ack_input: u32,
    me: Option<&WireSelf>,
    actors: &[WireActor],
) -> usize {
    1 + varint_len(tick)
        + varint_len(ack_input)
        + 2
        + me.map_or(0, |s| self_len(s, head_word(phase, Some(s))))
        + varint_len(actors.len() as u32)
        + actors
            .iter()
            .enumerate()
            .map(|(i, a)| actor_len(a, i.checked_sub(1).map(|j| actors[j].id)))
            .sum::<usize>()
}

/// Everything of a Snapshot before the actors: header, self and the actor count.
fn write_snapshot_head(
    w: &mut Writer,
    tick: u32,
    phase: u8,
    ack_input: u32,
    me: Option<&WireSelf>,
    actors: usize,
) {
    let mut f = Fixed::<MAX_HEAD_LEN>::new();
    f.u8(T_SNAPSHOT);
    f.varint(tick);
    f.varint(ack_input);
    let at = f.n;
    f.u16(0);
    let head = match me {
        Some(s) => write_self(&mut f, phase, s),
        None => (phase as u16 & 3) << HM_PHASE_SHIFT,
    };
    debug_assert_eq!(head, head_word(phase, me));
    f.b[at..at + 2].copy_from_slice(&head.to_le_bytes());
    f.varint(actors as u32);
    f.put(w);
}

impl Frame for ServerMsg {
    const MAX_FRAME: usize = MAX_SERVER_FRAME;

    fn encoded_len(&self) -> usize {
        match self {
            ServerMsg::Welcome { map, .. } => WELCOME_HEAD_LEN + map.encoded_len(),
            ServerMsg::Reject { reason, .. } => 1 + 2 + str_len(reason),
            ServerMsg::Snapshot {
                tick,
                phase,
                ack_input,
                me,
                actors,
            } => snapshot_len(*tick, *phase, *ack_input, me.as_ref(), actors),
            ServerMsg::Events { events, .. } => {
                1 + 4 + 2 + events.iter().map(event_len).sum::<usize>()
            }
            ServerMsg::Fx { tick, fx } => {
                1 + varint_len(*tick)
                    + varint_len(fx.len() as u32)
                    + fx.iter().map(fx_len).sum::<usize>()
            }
            ServerMsg::Pong { .. } => 1 + 4 + 8 + 8,
        }
    }

    fn check(&self, len: usize) -> Result<(), EncodeError> {
        match self {
            ServerMsg::Welcome { map, .. } => map.check()?,
            ServerMsg::Snapshot {
                phase, me, actors, ..
            } => {
                list("actors", actors.len(), MAX_ACTORS)?;
                if let Some(why) = snapshot_fault(*phase, me.as_ref(), actors) {
                    return Err(EncodeError::BadValue(why));
                }
            }
            ServerMsg::Events { events, .. } => list("events", events.len(), u16::MAX as usize)?,
            ServerMsg::Fx { fx, .. } => {
                list("fx", fx.len(), u16::MAX as usize)?;
                let swing_off_grid = |f: &WireFx| {
                    matches!(*f, WireFx::Swing { x, y, .. }
                        if !quant::pos_in_range(x) || !quant::pos_in_range(y))
                };
                if fx.iter().any(swing_off_grid) {
                    return Err(EncodeError::BadValue("position"));
                }
            }
            ServerMsg::Reject { .. } | ServerMsg::Pong { .. } => {}
        }
        frame_size(len, Self::MAX_FRAME)
    }

    /// A Snapshot is written once into a reused per-thread scratch buffer and copied to its exact size: every actor's mask
    /// and field lengths are computed once (by the writer), not again by a sizing pass. The bytes are those of the sized
    /// path (debug builds assert it). Every other message is sized first.
    fn exact_vec(&self) -> Vec<u8> {
        if !matches!(self, ServerMsg::Snapshot { .. }) {
            return sized_then_written(self);
        }
        #[cfg(debug_assertions)]
        if let Err(e) = self.check(self.encoded_len()) {
            panic!("encoding a frame every decoder rejects: {e} (use try_encode or encode_into)");
        }
        thread_local! {
            static SCRATCH: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
        }
        SCRATCH.with(|cell| {
            let mut buf = std::mem::take(&mut *cell.borrow_mut());
            buf.clear();
            let mut w = Writer::from_vec(buf);
            self.write(&mut w);
            let buf = w.finish();
            debug_assert_eq!(
                buf.len(),
                self.encoded_len(),
                "encoded_len disagrees with the writer"
            );
            let out = buf.clone();
            *cell.borrow_mut() = buf;
            out
        })
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
                phase,
                ack_input,
                me,
                actors,
            } => {
                write_snapshot_head(w, *tick, *phase, *ack_input, me.as_ref(), actors.len());
                let mut prev = None;
                for a in actors {
                    write_actor(w, a, prev);
                    prev = Some(a.id);
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
                w.varint(*tick);
                w.varint(fx.len() as u32);
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
                            w.varint(by);
                            w.u8(weapon);
                            w.u16(quant::quantize_pos(x));
                            w.u16(quant::quantize_pos(y));
                            w.u16(quant::quantize_facing(a));
                        }
                        WireFx::Hit { victim, by, amount } => {
                            w.u8(2);
                            w.varint(victim);
                            w.varint(by);
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

/// Streams one Snapshot frame into a caller's buffer: [`SnapshotWriter::begin`] writes the header, the self and the actor
/// count, each [`SnapshotWriter::actor`] appends one actor, and [`SnapshotWriter::finish`] checks the count. The caller maps
/// its own data (an observation) to [`WireActor`]s one at a time on the stack, so no `Vec<WireActor>` is built. The bytes
/// are exactly those of the equivalent `ServerMsg::Snapshot`.
///
/// The count goes first on the wire (a varint, so it cannot be patched afterwards): `begin` takes the exact number of
/// actors that will follow, and `finish` fails with [`EncodeError::CountMismatch`] when the caller wrote another number,
/// [`EncodeError::TooMany`] when it is over [`MAX_ACTORS`] or [`EncodeError::BadValue`] for a value the format cannot carry (an `hp_pct` over 100, ids that do not strictly
/// ascend, a faction, weapon, status or phase over its bit width; frames every
/// decoder would reject); the frame is removed
/// from the buffer in both cases, and the writer never drops actors itself. Dropping the writer without `finish` also
/// removes the partial frame.
pub struct SnapshotWriter<'a> {
    out: &'a mut Vec<u8>,
    w: Writer,
    start: usize,
    declared: usize,
    n: usize,
    fault: Option<&'static str>,
    last_id: Option<u32>,
}

impl<'a> SnapshotWriter<'a> {
    /// `actors`: how many actors will follow. The buffer is reserved for the least those bytes can take (an actor is 8 to
    /// 22 bytes, a typical one 9), so a buffer reused across frames never grows more than once to its working size.
    pub fn begin(
        out: &'a mut Vec<u8>,
        tick: u32,
        phase: u8,
        ack_input: u32,
        me: Option<&WireSelf>,
        actors: usize,
    ) -> Self {
        let start = out.len();
        let fault = snapshot_fault(phase, me, &[]);
        let mut w = Writer::from_vec(std::mem::take(out));
        w.reserve(
            MIN_SNAPSHOT_HEAD_LEN
                + me.map_or(0, |_| MIN_SELF_LEN)
                + MIN_ACTOR_LEN * actors.min(MAX_ACTORS),
        );
        write_snapshot_head(&mut w, tick, phase, ack_input, me, actors);
        Self {
            out,
            w,
            start,
            declared: actors,
            n: 0,
            fault,
            last_id: None,
        }
    }

    /// Appends one actor (in the order the observation lists them).
    #[inline]
    pub fn actor(&mut self, a: &WireActor) {
        write_actor(&mut self.w, a, self.last_id);
        if self.fault.is_none() {
            self.fault = snapshot_fault(0, None, std::slice::from_ref(a)).or(self
                .last_id
                .is_some_and(|p| a.id <= p)
                .then_some("actor order"));
        }
        self.last_id = Some(a.id);
        self.n += 1;
    }

    /// Actors written so far.
    pub fn actors(&self) -> usize {
        self.n
    }

    /// Completes the frame and returns its length, or removes it from the buffer (see the type's docs).
    pub fn finish(mut self) -> Result<usize, EncodeError> {
        list("actors", self.declared, MAX_ACTORS)?;
        if self.n != self.declared {
            return Err(EncodeError::CountMismatch {
                declared: self.declared,
                written: self.n,
            });
        }
        if let Some(why) = self.fault {
            return Err(EncodeError::BadValue(why));
        }
        let len = self.w.len() - self.start;
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
