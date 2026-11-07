//! Encoders. Every message has an exact [`ServerMsg::encoded_len`] / [`ClientMsg::encoded_len`], so a frame is written
//! into a buffer sized once:
//!
//! * `encode()` allocates exactly one `Vec` of exactly the frame's size (infallible: for frames that cannot be refused,
//!   such as Pong and Reject; a message decoders would reject trips a `debug_assert`).
//! * `try_encode()` is the same single exact allocation, but returns an [`EncodeError`] instead of writing a frame
//!   decoders would reject (the server's Events and Fx path). `encode_into(&mut Vec<u8>)` appends to a caller's buffer
//!   (reused across frames: no allocation once it is warm) with the same refusals.
//! * The server does not encode `ServerMsg::Snapshot` at all: it builds a [`SnapshotData`] ([`SnapshotData::build_with`], which
//!   refuses what these encoders refuse) and its connection's [`ConnEncoder`] writes the Full or Delta frame.
//! * [`encode_welcome`] takes a map that was RLE-encoded once ([`crate::map::MapBlob::pre_encode`]).
//!
//! One layout: `ServerMsg::Snapshot` is the reference writer of the v2 Snapshot, and tests hold the Full frame of a
//! [`SnapshotData`] byte-identical to it and to the golden vectors. A v2 Snapshot's size depends on its content (field masks, varints), so
//! `encoded_len()` walks the actors once (no allocation) instead of multiplying.

use crate::codec::{blob_len, str_fits, str_len, varint_len, EncodeError, Writer};
use crate::map::EncodedMap;
use crate::*;

/// Protocol v3: per-connection snapshot deltas. A child module so it reaches this module's private writers.
#[path = "delta.rs"]
pub mod delta;

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

/// The refusing twin of [`sized_then_written`]: the same single allocation of exactly the frame's size, or the reason a
/// decoder would reject the frame (nothing is allocated then).
fn checked_exact<F: Frame>(m: &F) -> Result<Vec<u8>, EncodeError> {
    let len = m.encoded_len();
    m.check(len)?;
    let mut w = Writer::with_capacity(len);
    m.write(&mut w);
    debug_assert_eq!(w.len(), len, "encoded_len disagrees with the writer");
    Ok(w.finish())
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
        WireCommand::Swap { slot } => 2 + usize::from(slot.is_some()),
        WireCommand::Pickup { .. } => 5,
        WireCommand::Choose { .. } => 6,
        WireCommand::Plan { spawn, boon, ready } => {
            2 + usize::from(spawn.is_some())
                + usize::from(boon.is_some())
                + usize::from(ready.is_some())
        }
        WireCommand::UseConsumable => 1,
        WireCommand::Target { .. } => 5,
        WireCommand::Move { seq, .. } | WireCommand::AttackMove { seq, .. } => {
            1 + 8 + opt_len(seq.is_some(), 1)
        }
        WireCommand::Stop { seq } => 1 + opt_len(seq.is_some(), 1),
        WireCommand::Aim { .. } => 1 + 4,
        WireCommand::Attack { t, .. } | WireCommand::Release { t, .. } => {
            1 + 4 + opt_len(t.is_some(), 8)
        }
    }
}

fn command_finite(c: &WireCommand) -> bool {
    match *c {
        WireCommand::Move { x, y, .. } | WireCommand::AttackMove { x, y, .. } => {
            x.is_finite() && y.is_finite()
        }
        WireCommand::Stop { .. }
        | WireCommand::Swap { .. }
        | WireCommand::Pickup { .. }
        | WireCommand::Choose { .. }
        | WireCommand::Plan { .. }
        | WireCommand::Target { .. }
        | WireCommand::UseConsumable => true,
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
                ticket,
                faction,
                resume,
                ..
            } => {
                1 + 2
                    + 8
                    + str_len(build)
                    + str_len(profile)
                    + blob_len(ticket)
                    + opt_len(faction.is_some(), 1)
                    + opt_len(resume.is_some(), 16)
            }
            ClientMsg::Input { commands, .. } => {
                1 + 4 + 2 + commands.iter().map(command_len).sum::<usize>()
            }
            ClientMsg::Ping { .. } => 1 + 4 + 8,
            ClientMsg::Leave | ClientMsg::Resync => 1,
        }
    }

    fn check(&self, len: usize) -> Result<(), EncodeError> {
        match self {
            ClientMsg::Hello {
                build,
                profile,
                ticket,
                ..
            } => {
                str_fits("build", build)?;
                str_fits("profile", profile)?;
                if ticket.len() > MAX_TICKET {
                    return Err(EncodeError::StringTooLong {
                        what: "ticket",
                        len: ticket.len(),
                    });
                }
            }
            ClientMsg::Input { commands, .. } => {
                list("commands", commands.len(), MAX_COMMANDS_PER_INPUT)?;
                if commands.iter().any(|c| {
                    matches!(c, WireCommand::Target { actor: 0 })
                        || matches!(c, WireCommand::Swap { slot: Some(s) } if *s > 1)
                        || matches!(c, WireCommand::Choose { pick, .. } if !(-1..=2).contains(pick))
                        || matches!(c, WireCommand::Plan { spawn, boon, .. } if spawn.is_some_and(|v| v > 1) || boon.is_some_and(|v| v > 1))
                }) {
                    return Err(EncodeError::BadValue("command"));
                }
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
                ticket,
                faction,
                resume,
            } => {
                w.u8(T_HELLO);
                w.u16(*protocol);
                w.u64(*content_hash);
                w.str(build);
                w.str(profile);
                w.blob(ticket);
                w.opt(faction.as_ref(), |w, f| w.u8(*f));
                w.opt(resume.as_ref(), |w, r| w.bytes(r));
            }
            ClientMsg::Input { seq, commands } => {
                w.u8(T_INPUT);
                w.u32(*seq);
                w.u16(commands.len() as u16);
                for c in commands {
                    match *c {
                        WireCommand::Swap { slot } => {
                            w.u8(6);
                            w.opt(slot.as_ref(), |w, s| w.u8(*s));
                        }
                        WireCommand::Pickup { handle } => {
                            w.u8(7);
                            w.u32(handle.get());
                        }
                        WireCommand::Choose { handle, pick } => {
                            w.u8(8);
                            w.u32(handle.get());
                            w.u8(pick as u8);
                        }
                        WireCommand::Plan { spawn, boon, ready } => {
                            w.u8(C_PLAN);
                            w.u8(u8::from(spawn.is_some())
                                | (u8::from(boon.is_some()) << 1)
                                | (u8::from(ready.is_some()) << 2));
                            if let Some(v) = spawn {
                                w.u8(v);
                            }
                            if let Some(v) = boon {
                                w.u8(v);
                            }
                            if let Some(v) = ready {
                                w.u8(u8::from(v));
                            }
                        }
                        WireCommand::UseConsumable => w.u8(9),
                        WireCommand::Target { actor } => {
                            w.u8(10);
                            w.u32(actor);
                        }
                        WireCommand::AttackMove { x, y, seq } => {
                            w.u8(11);
                            w.f32(x);
                            w.f32(y);
                            w.opt(seq.as_ref(), |w, s| w.u8(*s));
                        }
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
            ClientMsg::Resync => w.u8(T_RESYNC),
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

    /// Like [`ClientMsg::encode`] (one allocation of the exact size), but a message decoders would reject is an error.
    pub fn try_encode(&self) -> Result<Vec<u8>, EncodeError> {
        checked_exact(self)
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
        WireEvent::PickupRefused { .. } => 2,
        WireEvent::ChestRefused { .. } | WireEvent::PotionNotice { .. } => 2,
        WireEvent::CannonNotice { seconds, .. } => 2 + seconds.map_or(0, |_| 2),
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
        WireFx::Block { id, by, .. } => 2 + varint_len(*id) + varint_len(*by),
        WireFx::Stagger { id } => 1 + varint_len(*id),
        WireFx::Swing { by, .. } => 1 + varint_len(*by) + 1 + 6,
        WireFx::Hit { victim, by, .. } => 1 + varint_len(*victim) + varint_len(*by) + 5,
        WireFx::Teleport => 1,
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

/// The head of a Snapshot: for a self its present bit and the bits of every field that differs from its default, and the phase
/// bit when the phase is not the default.
fn head_word(phase: u8, me: Option<&WireSelf>) -> u32 {
    let mut m = if phase != DEFAULT_PHASE { HM_PHASE } else { 0 };
    let Some(s) = me else { return m };
    m |= HM_PRESENT;
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
    if s.status != DEFAULT_STATUS {
        m |= HM_STATUS;
    }
    if s.effects != 0 {
        m |= HM_EFFECTS;
    }
    if s.displace_seq != 0 {
        m |= HM_DISPLACE;
    }
    if s.sig != 0 {
        m |= HM_SIG;
    }
    m
}

/// Bytes of the self record after its head (`mask` is [`head_word`]).
fn self_len(s: &WireSelf, mask: u32) -> usize {
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
    if mask & HM_STATUS != 0 {
        n += 1;
    }
    if mask & HM_EFFECTS != 0 {
        n += 2;
    }
    if mask & HM_DISPLACE != 0 {
        n += 1;
    }
    if mask & HM_SIG != 0 {
        n += 1;
    }
    n
}

/// Bytes of the head itself, with the phase byte that follows it when `mask` has the phase bit.
#[inline]
fn head_len(mask: u32) -> usize {
    varint_len(mask) + (mask & HM_PHASE != 0) as usize
}

/// A record built on the stack (no capacity checks per byte), then appended to the frame with one copy: the byte-wise
/// `Vec::push` path of [`Writer`] dominated the cost of a Snapshot's header and actors. `N` is the record's maximum size
/// (a longer write panics, which the size constants below make unreachable).
struct Fixed<const N: usize> {
    b: [u8; N],
    n: usize,
}

impl<const N: usize> Fixed<N> {
    #[inline(always)]
    fn new() -> Self {
        Self { b: [0; N], n: 0 }
    }
    #[inline(always)]
    fn u8(&mut self, v: u8) {
        self.b[self.n] = v;
        self.n += 1;
    }
    #[inline(always)]
    fn bytes<const M: usize>(&mut self, v: [u8; M]) {
        if let Some(dst) = self.b[self.n..].first_chunk_mut::<M>() {
            *dst = v;
            self.n += M;
        } else {
            unreachable!("Fixed record overflow");
        }
    }
    #[inline(always)]
    fn u16(&mut self, v: u16) {
        self.bytes(v.to_le_bytes());
    }
    #[inline(always)]
    fn f32(&mut self, v: f32) {
        self.bytes(v.to_le_bytes());
    }
    /// Unsigned LEB128, one bounds check per length class instead of one per byte.
    #[inline(always)]
    fn varint(&mut self, v: u32) {
        if v < 0x80 {
            self.u8(v as u8);
        } else if v < 0x4000 {
            self.bytes([(v as u8) | 0x80, (v >> 7) as u8]);
        } else if v < 0x20_0000 {
            self.bytes([(v as u8) | 0x80, ((v >> 7) as u8) | 0x80, (v >> 14) as u8]);
        } else if v < 0x1000_0000 {
            self.bytes([
                (v as u8) | 0x80,
                ((v >> 7) as u8) | 0x80,
                ((v >> 14) as u8) | 0x80,
                (v >> 21) as u8,
            ]);
        } else {
            self.bytes([
                (v as u8) | 0x80,
                ((v >> 7) as u8) | 0x80,
                ((v >> 14) as u8) | 0x80,
                ((v >> 21) as u8) | 0x80,
                (v >> 28) as u8,
            ]);
        }
    }
    #[inline(always)]
    fn put(&self, w: &mut Writer) {
        w.append_record(&self.b, self.n);
    }
}

/// Largest Snapshot head: tag, tick, ack (5 each at most), head (2), a full self (id 5, 12, max_hp 4, kit, hp 4, ready 2,
/// kills, bounty, gv 3 each, move_seq, status, effects 2, displacement, sig), the phase and actor count.
const MAX_HEAD_LEN: usize = 1 + 5 + 5 + 2 + 5 + 12 + 4 + 1 + 4 + 2 + 9 + 1 + 1 + 2 + 1 + 1 + 1 + 5;
/// Largest actor: id 5, mask 2, x/y/facing 6, kit/hp/status, bounty 3, kind, effects 2, displacement, mob type, sig.
const MAX_ACTOR_LEN: usize = 5 + 2 + 6 + 1 + 1 + 1 + 3 + 1 + 2 + 1 + 1 + 1;

/// Writes the self record for the head word `m` ([`head_word`] of `s`), fields in bit order.
#[inline]
fn write_self(w: &mut Fixed<MAX_HEAD_LEN>, m: u32, s: &WireSelf) {
    w.varint(s.id);
    let [x0, x1, x2, x3] = s.x.to_le_bytes();
    let [y0, y1, y2, y3] = s.y.to_le_bytes();
    let [f0, f1, f2, f3] = s.facing.to_le_bytes();
    w.bytes([x0, x1, x2, x3, y0, y1, y2, y3, f0, f1, f2, f3]);
    if m & HM_MAXHP_F32 != 0 {
        w.f32(s.max_hp);
    } else {
        w.varint(s.max_hp as u32);
    }
    if m & HM_KIT != 0 {
        w.u8(kit(s.faction, s.weapon));
    }
    if m & HM_HP != 0 {
        w.f32(s.hp);
    }
    if m & HM_READY != 0 {
        w.u16(s.ready_in_ms);
    }
    if m & HM_KILLS != 0 {
        w.varint(s.kills as u32);
    }
    if m & HM_BOUNTY != 0 {
        w.varint(s.bounty as u32);
    }
    if m & HM_MOVE_SEQ != 0 {
        w.u8(s.move_seq);
    }
    if m & HM_GV != 0 {
        w.varint(s.gv as u32);
    }
    if m & HM_STATUS != 0 {
        w.u8(s.status);
    }
    if m & HM_EFFECTS != 0 {
        w.u16(s.effects);
    }
    if m & HM_DISPLACE != 0 {
        w.u8(s.displace_seq);
    }
    if m & HM_SIG != 0 {
        w.u8(s.sig);
    }
}

/// The actor mask of `a`: a bit for every field that differs from its default.
#[inline]
fn actor_mask(a: &WireActor) -> u32 {
    let mut m = 0;
    if kit(a.faction, a.weapon) != 0 {
        m |= AM_KIT;
    }
    if a.hp_pct != DEFAULT_HP_PCT {
        m |= AM_HP;
    }
    if a.status != DEFAULT_STATUS {
        m |= AM_STATUS;
    }
    if a.bounty != 0 {
        m |= AM_BOUNTY;
    }
    if a.kind != 0 {
        m |= AM_KIND;
    }
    if a.effects != 0 {
        m |= AM_EFFECTS;
    }
    if a.displace_seq != 0 {
        m |= AM_DISPLACE;
    }
    if a.mob_type_code != 0 {
        m |= AM_MOB_TYPE;
    }
    if a.sig != 0 {
        m |= AM_SIG;
    }
    m
}

/// Bytes one actor takes on the wire.
#[inline]
fn actor_len(a: &WireActor, prev: Option<u32>) -> usize {
    let m = actor_mask(a);
    varint_len(id_field(a.id, prev))
        + varint_len(m)
        + 6
        + (m & AM_KIT != 0) as usize
        + (m & AM_HP != 0) as usize
        + (m & AM_STATUS != 0) as usize
        + if m & AM_BOUNTY != 0 {
            varint_len(a.bounty as u32)
        } else {
            0
        }
        + (m & AM_KIND != 0) as usize
        + 2 * (m & AM_EFFECTS != 0) as usize
        + (m & AM_DISPLACE != 0) as usize
        + (m & AM_MOB_TYPE != 0) as usize
        + (m & AM_SIG != 0) as usize
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
        if a.mob_type_code > 30 {
            return Some("mob type");
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

/// Whether `snapshot_fault` could report `a` (or its order after `prev`): a cheap superset test, exact when it says no.
#[inline(always)]
fn actor_looks_bad(a: &WireActor, prev: Option<u32>) -> bool {
    (a.faction | a.weapon) > MAX_KIT_CODE
        || a.status > MAX_STATUS_CODE
        || a.mob_type_code > 30
        || a.hp_pct > 100
        || !(quant::pos_in_range(a.x) && quant::pos_in_range(a.y))
        || prev.is_some_and(|p| a.id <= p)
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

#[inline(always)]
fn write_actor(out: &mut Writer, a: &WireActor, prev: Option<u32>) {
    let m = actor_mask(a);
    let mut w = Fixed::<MAX_ACTOR_LEN>::new();
    w.varint(id_field(a.id, prev));
    w.varint(m);
    w.u16(quant::quantize_pos(a.x));
    w.u16(quant::quantize_pos(a.y));
    w.u16(quant::quantize_facing(a.facing));
    if m & AM_KIT != 0 {
        w.u8(kit(a.faction, a.weapon));
    }
    if m & AM_HP != 0 {
        w.u8(a.hp_pct);
    }
    if m & AM_STATUS != 0 {
        w.u8(a.status);
    }
    if m & AM_BOUNTY != 0 {
        w.varint(a.bounty as u32);
    }
    if m & AM_KIND != 0 {
        w.u8(a.kind);
    }
    if m & AM_EFFECTS != 0 {
        w.u16(a.effects);
    }
    if m & AM_DISPLACE != 0 {
        w.u8(a.displace_seq);
    }
    if m & AM_MOB_TYPE != 0 {
        w.u8(a.mob_type_code);
    }
    if m & AM_SIG != 0 {
        w.u8(a.sig);
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
    let head = head_word(phase, me);
    1 + varint_len(tick)
        + varint_len(ack_input)
        + head_len(head)
        + me.map_or(0, |s| self_len(s, head))
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
    let head = head_word(phase, me);
    f.varint(head);
    if let Some(s) = me {
        write_self(&mut f, head, s);
    }
    if head & HM_PHASE != 0 {
        f.u8(phase);
    }
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
            ServerMsg::SnapshotDelta(d) => delta::message_len(d),
            ServerMsg::Events { events, .. } => {
                1 + 4 + 2 + events.iter().map(event_len).sum::<usize>()
            }
            ServerMsg::Fx { tick, fx } => {
                1 + varint_len(*tick)
                    + varint_len(fx.len() as u32)
                    + fx.iter().map(fx_len).sum::<usize>()
            }
            ServerMsg::Pong { .. } => 1 + 4 + 8 + 8,
            ServerMsg::State { tick, items } => {
                1 + varint_len(*tick)
                    + varint_len(items.len() as u32)
                    + items.iter().map(StateItem::encoded_len).sum::<usize>()
            }
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
            ServerMsg::SnapshotDelta(d) => delta::message_check(d)?,
            ServerMsg::Events { events, .. } => {
                list("events", events.len(), u16::MAX as usize)?;
                for e in events {
                    if matches!(e, WireEvent::PotionNotice { notice } if !(1..=7).contains(notice))
                    {
                        return Err(EncodeError::BadValue("potion notice"));
                    }
                    if matches!(e, WireEvent::CannonNotice { code, seconds }
                        if !(1..=4).contains(code)
                            || (*code == 4)
                                != matches!(seconds, Some(s) if (1..=75).contains(s)))
                    {
                        return Err(EncodeError::BadValue("cannon notice"));
                    }
                    if matches!(e, WireEvent::ChestRefused { reason } if !(1..=9).contains(reason))
                    {
                        return Err(EncodeError::BadValue("chest reason"));
                    }
                    if matches!(e, WireEvent::PickupRefused { reason } if !(1..=5).contains(reason))
                    {
                        return Err(EncodeError::BadValue("pickup reason"));
                    }
                    if let WireEvent::Result(r) = e {
                        if let Some(k) = &r.killed_by {
                            str_fits("killed_by", k)?;
                        }
                    }
                }
            }
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
            ServerMsg::Reject { code, reason } => {
                // Code 0 is not a code (every decoder refuses it), and a named code must be built as its variant.
                let c = code.code();
                if c == 0
                    || (matches!(code, RejectCode::Unknown(_)) && RejectCode::from_u16(c) != *code)
                {
                    return Err(EncodeError::BadValue("reject code"));
                }
                str_fits("reason", reason)?
            }
            ServerMsg::Pong { .. } => {}
            ServerMsg::State { items, .. } => {
                crate::state::check_items(items)?;
            }
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
                w.u16(code.code());
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
            ServerMsg::SnapshotDelta(d) => delta::write_message(w, d),
            ServerMsg::Events { tick, events } => {
                w.u8(T_EVENTS);
                w.u32(*tick);
                w.u16(events.len() as u16);
                for e in events {
                    match e {
                        WireEvent::PotionNotice { notice } => {
                            w.u8(7);
                            w.u8(*notice);
                        }
                        WireEvent::CannonNotice { code, seconds } => {
                            w.u8(8);
                            w.u8(*code);
                            if let Some(seconds) = seconds {
                                w.u16(*seconds);
                            }
                        }
                        WireEvent::ChestRefused { reason } => {
                            w.u8(6);
                            w.u8(*reason);
                        }
                        WireEvent::PickupRefused { reason } => {
                            w.u8(5);
                            w.u8(*reason);
                        }
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
                        WireFx::Block { id, by, weapon } => {
                            w.u8(3);
                            w.varint(id);
                            w.varint(by);
                            w.u8(weapon);
                        }
                        WireFx::Stagger { id } => {
                            w.u8(4);
                            w.varint(id);
                        }
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
                        WireFx::Teleport => w.u8(5),
                        WireFx::Hit {
                            victim,
                            by,
                            amount,
                            passive,
                        } => {
                            w.u8(2);
                            w.varint(victim);
                            w.varint(by);
                            w.f32(amount);
                            w.u8(passive as u8);
                        }
                    }
                }
            }
            ServerMsg::State { tick, items } => {
                w.u8(T_STATE);
                w.varint(*tick);
                w.varint(items.len() as u32);
                for item in items {
                    item.write(w);
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
    /// builds, except that a string over 255 bytes panics in release too (the writer never truncates); use [`ServerMsg::try_encode`] or [`ServerMsg::encode_into`] where that can happen.
    pub fn encode(&self) -> Vec<u8> {
        encode_exact(self)
    }

    /// Like [`ServerMsg::encode`] (one allocation of the exact size), but a message decoders would reject is an error. The
    /// server encodes every Events and Fx frame through this.
    pub fn try_encode(&self) -> Result<Vec<u8>, EncodeError> {
        checked_exact(self)
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

#[cfg(test)]
mod fixed_tests {
    use super::*;

    /// The stack record's varint, record append and the byte-wise `Writer` agree on every length-class boundary.
    #[test]
    fn fixed_varint_matches_writer_varint() {
        let mut vals = vec![0u32, 1, u32::MAX, u32::MAX - 1];
        for sh in [7u32, 14, 21, 28] {
            let b = 1u32 << sh;
            vals.extend([b - 1, b, b + 1]);
        }
        for v in vals {
            let mut f = Fixed::<8>::new();
            f.varint(v);
            let mut w = Writer::with_capacity(8);
            w.varint(v);
            let mut out = Writer::with_capacity(0);
            out.u8(0xAA);
            f.put(&mut out);
            let got = out.finish();
            assert_eq!(&got[1..], &w.finish()[..], "{v}");
            assert_eq!(got[0], 0xAA);
        }
    }
}
