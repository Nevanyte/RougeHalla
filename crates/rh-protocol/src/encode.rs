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
pub const WELCOME_HEADER_LEN: usize = 60;

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
        WireCommand::Target { .. } | WireCommand::HuntTarget { .. } => 5,
        WireCommand::ConsumeCorpse { .. } => 5,
        WireCommand::Move { seq, .. } | WireCommand::AttackMove { seq, .. } => {
            1 + 8 + opt_len(seq.is_some(), 1)
        }
        WireCommand::Stop { seq } => 1 + opt_len(seq.is_some(), 1),
        WireCommand::Aim { .. } => 1 + 4,
        WireCommand::Attack { t, .. } | WireCommand::Release { t, .. } => {
            1 + 4 + opt_len(t.is_some(), 8)
        }
        WireCommand::Train {
            id, option_count, ..
        } => 1 + 1 + varint_len(id) + 8 + 1 + usize::from(option_count),
        WireCommand::Cast { actor, t, seq, .. } => {
            1 + 1
                + 4
                + 4
                + opt_len(actor.is_some(), 4)
                + opt_len(t.is_some(), 8)
                + opt_len(seq.is_some(), 1)
        }
        WireCommand::QuestAccept { handle } => 1 + varint_len(handle.get()),
        WireCommand::Trade { .. } => 3,
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
        | WireCommand::HuntTarget { .. }
        | WireCommand::ConsumeCorpse { .. }
        | WireCommand::Train { .. }
        | WireCommand::UseConsumable => true,
        WireCommand::QuestAccept { .. } => true,
        WireCommand::Trade { pick, .. } => pick <= 2,
        WireCommand::Aim { a } => a.is_finite(),
        WireCommand::Attack { a, t } | WireCommand::Release { a, t } => {
            a.is_finite() && t.is_none_or(f64::is_finite)
        }
        WireCommand::Cast { x, y, t, .. } => {
            x.is_finite() && y.is_finite() && t.is_none_or(f64::is_finite)
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
                        || matches!(c, WireCommand::Train { command, option_count, .. }
                            if !(1..=5).contains(command) || *option_count > 3)
                        || matches!(c, WireCommand::Cast { slot, actor, .. }
                            if *slot > 2 || actor.is_some_and(|id| id == 0))
                        || matches!(c, WireCommand::Trade { pick, .. } if *pick > 2)
                }) {
                    return Err(EncodeError::BadValue("command"));
                }
                if !commands.iter().all(command_finite) {
                    return Err(EncodeError::NonFinite);
                }
            }
            ClientMsg::Ping { client_ms, .. } if !client_ms.is_finite() => {
                return Err(EncodeError::NonFinite);
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
                        WireCommand::HuntTarget { actor } => {
                            w.u8(12);
                            w.u32(actor);
                        }
                        WireCommand::ConsumeCorpse { handle } => {
                            w.u8(13);
                            w.u32(handle.get());
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
                        WireCommand::Train {
                            command,
                            id,
                            count,
                            options,
                            option_count,
                        } => {
                            w.u8(15);
                            w.u8(command);
                            w.varint(id);
                            w.u64(count);
                            w.u8(option_count);
                            for option in options.iter().take(usize::from(option_count)) {
                                w.u8(*option);
                            }
                        }
                        WireCommand::Cast {
                            slot,
                            x,
                            y,
                            actor,
                            t,
                            seq,
                        } => {
                            w.u8(C_CAST);
                            w.u8(slot);
                            w.f32(x);
                            w.f32(y);
                            w.opt(actor.as_ref(), |w, id| w.u32(*id));
                            w.opt(t.as_ref(), |w, ms| w.f64(*ms));
                            w.opt(seq.as_ref(), |w, seq| w.u8(*seq));
                        }
                        WireCommand::QuestAccept { handle } => {
                            w.u8(C_QUEST_ACCEPT);
                            w.varint(handle.get());
                        }
                        WireCommand::Trade { kind, pick } => {
                            w.u8(C_TRADE);
                            w.u8(kind.code());
                            w.u8(pick);
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
        WireEvent::WindEmblem => 1,
        WireEvent::PickupRefused { .. } => 2,
        WireEvent::ChestRefused { .. } | WireEvent::PotionNotice { .. } => 2,
        WireEvent::CannonNotice { seconds, .. } => 2 + seconds.map_or(0, |_| 2),
        WireEvent::Death { by, .. } => 1 + 4 + opt_len(by.is_some(), 4),
        WireEvent::Bounty { .. } => 1 + 4 + 2,
        WireEvent::MatchEnded { winner, .. } => 1 + opt_len(winner.is_some(), 4) + 1,
        WireEvent::Result(r) => {
            1 + 3 + 2 + 1 + r.killed_by.as_deref().map_or(0, str_len) + 4 + 4 + 4 + 1
        }
        WireEvent::Toast { text } => 1 + str_len(text),
        WireEvent::CampCleared { .. } => 1 + 2,
    }
}

fn fx_len(f: &WireFx) -> usize {
    match f {
        WireFx::Block { id, by, .. } => 2 + varint_len(*id) + varint_len(*by),
        WireFx::Stagger { id } => 1 + varint_len(*id),
        WireFx::Swing { by, .. } => 1 + varint_len(*by) + 1 + 6,
        WireFx::Hit { victim, by, .. } => 1 + varint_len(*victim) + varint_len(*by) + 5,
        WireFx::Windup { by, .. } => 1 + varint_len(*by) + 1 + 2 + 2,
        WireFx::Cancel { id } => 1 + varint_len(*id),
        WireFx::SigHit { victim, by, .. } => 1 + varint_len(*victim) + varint_len(*by) + 1 + 4,
        WireFx::Heal { id, .. } => 1 + varint_len(*id) + 4,
        WireFx::Teleport => 1,
        WireFx::WishStarted {
            caster,
            target,
            anchor,
            ..
        } => {
            1 + 8
                + varint_len(*caster)
                + 1
                + 8
                + opt_len(target.is_some(), target.map_or(0, varint_len))
                + point_opt_len(anchor)
        }
        WireFx::WishLanded {
            caster,
            target,
            anchor,
            destination,
            ..
        } => {
            1 + 8
                + 1
                + opt_len(caster.is_some(), caster.map_or(0, varint_len))
                + opt_len(target.is_some(), target.map_or(0, varint_len))
                + point_opt_len(anchor)
                + point_opt_len(destination)
        }
        WireFx::WishEnded { caster, .. } => 1 + 8 + varint_len(*caster) + 1 + 1,
    }
}

fn point_opt_len(point: &Option<WirePoint>) -> usize {
    1 + if point.is_some() { 4 } else { 0 }
}
fn point_valid(point: Option<WirePoint>) -> bool {
    point.is_none_or(|p| quant::pos_in_range(p.x) && quant::pos_in_range(p.y))
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
fn head_word(
    phase: u8,
    tick: u32,
    server_time: f64,
    me: Option<&WireSelf>,
    training: bool,
    owner_combat: bool,
) -> u32 {
    let mut m = if phase != DEFAULT_PHASE { HM_PHASE } else { 0 };
    if training {
        m |= HM_TRAINING;
    }
    if owner_combat {
        m |= HM_OWNER_COMBAT;
    }
    if server_time.to_bits() != snapshot_server_ms(tick).to_bits() {
        m |= HM_SERVER_TIME;
    }
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
    if s.hunt_target.is_some() {
        m |= HM_HUNT_TARGET;
    }
    if s.hunt_stacks != 0 {
        m |= HM_HUNT_STACKS;
    }
    if s.wish.is_some() {
        m |= HM_WISH;
    }
    if s.barrier.to_bits() != 0.0f32.to_bits() || s.barrier_ring_step != 0 {
        m |= HM_BARRIER;
    }
    if s.archetype != 0 {
        m |= HM_ARCHETYPE;
    }
    if s.flags != 0 {
        m |= HM_FLAGS;
    }
    if s.build_marks != 0 {
        m |= HM_BUILD_MARKS;
    }
    if s.mark_tier != 0 || s.brand != 0 || s.mark_tax != 0 {
        m |= HM_MARK;
    }
    m
}

fn wish_owner_len(wish: &WireWishOwner) -> usize {
    1 + 8
        + opt_len(wish.full_at.is_some(), 8)
        + 1
        + 8
        + 1
        + opt_len(wish.next_charge_at.is_some(), 8)
        + opt_len(wish.cast.is_some(), 17)
}

fn write_wish_owner<const N: usize>(w: &mut Fixed<N>, wish: &WireWishOwner) {
    w.u8(wish.ability);
    w.bytes(wish.ready_at.to_le_bytes());
    if let Some(full_at) = wish.full_at {
        w.u8(1);
        w.bytes(full_at.to_le_bytes());
    } else {
        w.u8(0);
    }
    w.u8(wish.max_charges);
    w.bytes(wish.recharge_ms.to_le_bytes());
    w.u8(wish.charges);
    if let Some(next_charge_at) = wish.next_charge_at {
        w.u8(1);
        w.bytes(next_charge_at.to_le_bytes());
    } else {
        w.u8(0);
    }
    if let Some(cast) = wish.cast {
        w.u8(1);
        w.u8(cast.ability);
        w.bytes(cast.started_at.to_le_bytes());
        w.bytes(cast.lands_at.to_le_bytes());
    } else {
        w.u8(0);
    }
}

pub(crate) fn write_wish_owner_writer(w: &mut Writer, wish: &WireWishOwner) {
    w.u8(wish.ability);
    w.f64(wish.ready_at);
    w.opt(wish.full_at.as_ref(), |w, v| w.f64(*v));
    w.u8(wish.max_charges);
    w.f64(wish.recharge_ms);
    w.u8(wish.charges);
    w.opt(wish.next_charge_at.as_ref(), |w, v| w.f64(*v));
    w.opt(wish.cast.as_ref(), |w, cast| {
        w.u8(cast.ability);
        w.f64(cast.started_at);
        w.f64(cast.lands_at);
    });
}

pub(crate) fn wish_owner_valid(wish: &WireWishOwner) -> bool {
    let clock = |v: f64| v.is_finite() && v >= 0.0;
    wish.ability <= 4
        && clock(wish.ready_at)
        && wish.full_at.is_none_or(clock)
        && (1..=2).contains(&wish.max_charges)
        && wish.recharge_ms.is_finite()
        && wish.recharge_ms >= 0.0
        && wish.charges <= wish.max_charges
        && wish.next_charge_at.is_none_or(clock)
        && wish.cast.is_none_or(|cast| {
            cast.ability <= 4
                && clock(cast.started_at)
                && clock(cast.lands_at)
                && cast.started_at <= cast.lands_at
        })
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
    if let Some(target) = s.hunt_target {
        n += varint_len(target);
    }
    if mask & HM_HUNT_STACKS != 0 {
        n += varint_len(s.hunt_stacks as u32);
    }
    if mask & HM_WISH != 0 {
        n += wish_owner_len(s.wish.as_ref().expect("Wish bit requires a record"));
    }
    if mask & HM_BARRIER != 0 {
        n += 5;
    }
    if mask & HM_ARCHETYPE != 0 {
        n += 1;
    }
    n += (mask & HM_FLAGS != 0) as usize
        + (mask & HM_BUILD_MARKS != 0) as usize
        + 3 * (mask & HM_MARK != 0) as usize;
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

/// Largest Snapshot head including protocol-12 Wish, barrier, and source-clock override groups.
const MAX_HEAD_LEN: usize = 1
    + 5
    + 5
    + 3
    + 5
    + 12
    + 4
    + 1
    + 4
    + 2
    + 9
    + 1
    + 1
    + 2
    + 1
    + 1
    + 1
    + 5
    + 5
    + 3
    + 55
    + 5
    + 8
    + 1
    + 1
    + 1
    + 3;
/// Largest actor: id 5, mask 3, x/y/facing 6, kit/hp/status, bounty 3, kind, effects 2, displacement, mob type, sig, barrier pair,
/// archetype, flags, off-hand, build marks, mark plate 3.
pub(crate) const MAX_ACTOR_LEN: usize =
    5 + 3 + 6 + 1 + 1 + 1 + 3 + 1 + 2 + 1 + 1 + 1 + 2 + 1 + 1 + 1 + 1 + 3;

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
    if let Some(target) = s.hunt_target {
        w.varint(target);
    }
    if m & HM_HUNT_STACKS != 0 {
        w.varint(s.hunt_stacks as u32);
    }
    if m & HM_WISH != 0 {
        write_wish_owner(w, s.wish.as_ref().expect("Wish bit requires a record"));
    }
    if m & HM_BARRIER != 0 {
        w.f32(s.barrier);
        w.u8(s.barrier_ring_step);
    }
    if m & HM_ARCHETYPE != 0 {
        w.u8(s.archetype);
    }
    if m & HM_FLAGS != 0 {
        w.u8(s.flags);
    }
    if m & HM_BUILD_MARKS != 0 {
        w.u8(s.build_marks);
    }
    if m & HM_MARK != 0 {
        w.bytes([s.mark_tier, s.brand, s.mark_tax]);
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
    if a.barrier_pct != DEFAULT_BARRIER_PCT || a.barrier_ring_step != DEFAULT_BARRIER_RING_STEP {
        m |= AM_BARRIER;
    }
    if a.archetype != 0 {
        m |= AM_ARCHETYPE;
    }
    if a.flags != 0 {
        m |= AM_FLAGS;
    }
    if a.offhand != 0 {
        m |= AM_OFFHAND;
    }
    if a.build_marks != 0 {
        m |= AM_BUILD_MARKS;
    }
    if a.mark_tier != 0 || a.brand != 0 || a.mark_tax != 0 {
        m |= AM_MARK;
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
        + 2 * (m & AM_BARRIER != 0) as usize
        + (m & AM_ARCHETYPE != 0) as usize
        + (m & AM_FLAGS != 0) as usize
        + (m & AM_OFFHAND != 0) as usize
        + (m & AM_BUILD_MARKS != 0) as usize
        + 3 * (m & AM_MARK != 0) as usize
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
        if s.hunt_target == Some(0) {
            return Some("hunt target");
        }
        if !s.barrier.is_finite() || s.barrier < 0.0 || s.barrier_ring_step > 8 {
            return Some("barrier");
        }
        if s.wish.is_some_and(|wish| !wish_owner_valid(&wish)) {
            return Some("wish");
        }
        if let Some(f) = indicator_fault(
            0,
            s.build_marks,
            [s.mark_tier, s.brand, s.mark_tax],
            s.flags,
        ) {
            return Some(f);
        }
    }
    let mut prev: Option<u32> = None;
    for a in actors {
        if giver_actor_fault(a).is_some() {
            return Some("giver actor");
        }
        if let Some(f) = kit_status_fault(a.faction, a.weapon, a.status) {
            return Some(f);
        }
        if a.mob_type_code > 30 {
            return Some("mob type");
        }
        if a.hp_pct > 100 {
            return Some("hp_pct");
        }
        if a.barrier_pct > 100 || a.barrier_ring_step > 8 {
            return Some("barrier");
        }
        if let Some(f) = actor_indicator_fault(a) {
            return Some(f);
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
    giver_actor_fault(a).is_some()
        || (a.faction | a.weapon) > MAX_KIT_CODE
        || a.status > MAX_STATUS_CODE
        || a.mob_type_code > 30
        || a.hp_pct > 100
        || a.barrier_pct > 100
        || a.barrier_ring_step > 8
        || actor_indicator_fault(a).is_some()
        || !(quant::pos_in_range(a.x) && quant::pos_in_range(a.y))
        || prev.is_some_and(|p| a.id <= p)
}

/// The actor's indicator facts as a decoder checks them (ADR0026).
#[inline(always)]
fn actor_indicator_fault(a: &WireActor) -> Option<&'static str> {
    indicator_fault(
        a.offhand,
        a.build_marks,
        [a.mark_tier, a.brand, a.mark_tax],
        a.flags,
    )
}

/// A QuestGiver actor has one contextual sentinel tuple. Other actor kinds and Self retain the full four-bit domains.
#[inline(always)]
pub(crate) fn giver_actor_fault(a: &WireActor) -> Option<&'static str> {
    (a.kind == 4 && (a.faction != 15 || a.weapon != 15 || a.mob_type_code != 0))
        .then_some("giver actor")
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
    if m & AM_BARRIER != 0 {
        w.u8(a.barrier_pct);
        w.u8(a.barrier_ring_step);
    }
    if m & AM_ARCHETYPE != 0 {
        w.u8(a.archetype);
    }
    if m & AM_FLAGS != 0 {
        w.u8(a.flags);
    }
    if m & AM_OFFHAND != 0 {
        w.u8(a.offhand);
    }
    if m & AM_BUILD_MARKS != 0 {
        w.u8(a.build_marks);
    }
    if m & AM_MARK != 0 {
        w.bytes([a.mark_tier, a.brand, a.mark_tax]);
    }
    w.put(out);
}

/// Exact size of a Snapshot frame.
#[allow(clippy::too_many_arguments)] // Mirrors the complete snapshot wire header and body inputs.
fn snapshot_len(
    tick: u32,
    server_time: f64,
    phase: u8,
    ack_input: u32,
    me: Option<&WireSelf>,
    training: bool,
    actors: &[WireActor],
    owner_combat: Option<&WireOwnerCombat>,
) -> usize {
    let head = head_word(
        phase,
        tick,
        server_time,
        me,
        training,
        owner_combat.is_some(),
    );
    1 + varint_len(tick)
        + varint_len(ack_input)
        + head_len(head)
        + me.map_or(0, |s| self_len(s, head))
        + (head & HM_SERVER_TIME != 0) as usize * 8
        + varint_len(actors.len() as u32)
        + actors
            .iter()
            .enumerate()
            .map(|(i, a)| actor_len(a, i.checked_sub(1).map(|j| actors[j].id)))
            .sum::<usize>()
        + owner_combat.map_or(0, owner_combat_len)
}

pub(crate) fn owner_combat_len(owner: &WireOwnerCombat) -> usize {
    let lock_len = match owner.lock {
        WireOwnerLock::Clear | WireOwnerLock::Held { target: None } => 1,
        WireOwnerLock::Held { target: Some(id) } => 1 + varint_len(id),
    };
    lock_len + 4 + 4 + 8 + 8 + 8
}

pub(crate) fn write_owner_combat(w: &mut Writer, owner: &WireOwnerCombat) {
    match owner.lock {
        WireOwnerLock::Clear => w.u8(0),
        WireOwnerLock::Held { target: None } => w.u8(1),
        WireOwnerLock::Held { target: Some(id) } => {
            w.u8(2);
            w.varint(id);
        }
    }
    w.u32(owner.draw_started_at);
    w.u32(owner.ready_at);
    w.f64(owner.as_milli);
    w.f64(owner.windup_milli);
    w.f64(owner.speed_milli);
}

struct SnapshotHeader<'a> {
    tick: u32,
    server_time: f64,
    phase: u8,
    ack_input: u32,
    me: Option<&'a WireSelf>,
    training: bool,
    actors: usize,
    owner_combat: bool,
}

/// Everything of a Snapshot before the actors: header, self and the actor count.
fn write_snapshot_head(w: &mut Writer, header: SnapshotHeader<'_>) {
    let SnapshotHeader {
        tick,
        server_time,
        phase,
        ack_input,
        me,
        training,
        actors,
        owner_combat,
    } = header;
    let mut f = Fixed::<MAX_HEAD_LEN>::new();
    f.u8(T_SNAPSHOT);
    f.varint(tick);
    f.varint(ack_input);
    let head = head_word(phase, tick, server_time, me, training, owner_combat);
    f.varint(head);
    if let Some(s) = me {
        write_self(&mut f, head, s);
    }
    if head & HM_PHASE != 0 {
        f.u8(phase);
    }
    if head & HM_SERVER_TIME != 0 {
        f.bytes(server_time.to_le_bytes());
    }
    f.varint(actors as u32);
    f.put(w);
}

impl Frame for ServerMsg {
    const MAX_FRAME: usize = MAX_SERVER_FRAME;

    fn encoded_len(&self) -> usize {
        match self {
            ServerMsg::Welcome {
                archetypes,
                vision,
                weapons,
                map,
                ..
            } => {
                WELCOME_HEADER_LEN
                    + crate::archetype::table_len(archetypes)
                    + vision.encoded_len()
                    + crate::weapon::table_len(weapons)
                    + map.encoded_len()
            }
            ServerMsg::Reject { reason, .. } => 1 + 2 + str_len(reason),
            ServerMsg::Snapshot {
                tick,
                server_time,
                phase,
                ack_input,
                me,
                training,
                actors,
                owner_combat,
            } => snapshot_len(
                *tick,
                *server_time,
                *phase,
                *ack_input,
                me.as_ref(),
                *training,
                actors,
                owner_combat.as_ref(),
            ),
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
            ServerMsg::Welcome {
                archetypes,
                vision,
                weapons,
                map,
                ..
            } => {
                if let Some(why) = crate::archetype::table_fault(archetypes) {
                    return Err(EncodeError::BadValue(why));
                }
                if let Some(why) = vision.fault() {
                    return Err(EncodeError::BadValue(why));
                }
                if !vision.fits(map.w, map.h) {
                    return Err(EncodeError::BadValue("vision"));
                }
                if let Some(why) = crate::weapon::table_fault(weapons) {
                    return Err(EncodeError::BadValue(why));
                }
                map.check()?
            }
            ServerMsg::Snapshot {
                server_time,
                phase,
                me,
                actors,
                owner_combat,
                ..
            } => {
                if !server_time.is_finite() || *server_time < 0.0 {
                    return Err(EncodeError::BadValue("server time"));
                }
                list("actors", actors.len(), MAX_ACTORS)?;
                if let Some(why) = snapshot_fault(*phase, me.as_ref(), actors) {
                    return Err(EncodeError::BadValue(why));
                }
                if owner_combat_fault(owner_combat.as_ref(), me.is_some(), |id| {
                    actors.binary_search_by_key(&id, |a| a.id).is_ok()
                })
                .is_some()
                {
                    return Err(EncodeError::BadValue("owner combat"));
                }
            }
            ServerMsg::SnapshotDelta(d) => delta::message_check(d)?,
            ServerMsg::Events { events, .. } => {
                list("events", events.len(), u16::MAX as usize)?;
                for e in events {
                    if matches!(e, WireEvent::PotionNotice { notice } if !(1..=10).contains(notice))
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
                    if let WireEvent::Toast { text } = e {
                        str_fits("toast", text)?;
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
                for f in fx {
                    let good = match *f {
                        WireFx::WishStarted {
                            event_time,
                            caster,
                            ability,
                            duration,
                            target,
                            anchor,
                        } => {
                            event_time.is_finite()
                                && event_time >= 0.0
                                && caster != 0
                                && ability <= 4
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
                                && ability <= 4
                                && caster.is_none_or(|id| id != 0)
                                && target.is_none_or(|id| id != 0)
                                && point_valid(anchor)
                                && point_valid(destination)
                                && ((ability == 3 && anchor.is_some() == destination.is_some())
                                    || (ability != 3 && destination.is_none()))
                                && (caster.is_some() || anchor.is_some())
                        }
                        WireFx::WishEnded {
                            event_time,
                            caster,
                            ability,
                            reason,
                        } => {
                            event_time.is_finite()
                                && event_time >= 0.0
                                && caster != 0
                                && ability <= 4
                                && reason <= 2
                        }
                        WireFx::Windup { weapon, .. } if weapon > MAX_KIT_CODE => {
                            return Err(EncodeError::BadValue("windup weapon"));
                        }
                        WireFx::SigHit { kind, .. } if !hit_kind_valid(kind) => {
                            return Err(EncodeError::BadValue("hit kind"));
                        }
                        _ => true,
                    };
                    if !good {
                        return Err(EncodeError::BadValue("wish fx"));
                    }
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
                archetypes,
                vision,
                weapons,
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
                crate::archetype::write_table(w, archetypes);
                vision.write(w);
                crate::weapon::write_table(w, weapons);
                map.write(w);
            }
            ServerMsg::Reject { code, reason } => {
                w.u8(T_REJECT);
                w.u16(code.code());
                w.str(reason);
            }
            ServerMsg::Snapshot {
                tick,
                server_time,
                phase,
                ack_input,
                me,
                training,
                actors,
                owner_combat,
            } => {
                write_snapshot_head(
                    w,
                    SnapshotHeader {
                        tick: *tick,
                        server_time: *server_time,
                        phase: *phase,
                        ack_input: *ack_input,
                        me: me.as_ref(),
                        training: *training,
                        actors: actors.len(),
                        owner_combat: owner_combat.is_some(),
                    },
                );
                let mut prev = None;
                for a in actors {
                    write_actor(w, a, prev);
                    prev = Some(a.id);
                }
                if let Some(owner) = owner_combat {
                    write_owner_combat(w, owner);
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
                            w.u8(9);
                            w.u8(*code);
                            if let Some(seconds) = seconds {
                                w.u16(*seconds);
                            }
                        }
                        WireEvent::ChestRefused { reason } => {
                            w.u8(6);
                            w.u8(*reason);
                        }
                        WireEvent::WindEmblem => {
                            w.u8(8);
                        }
                        WireEvent::Toast { text } => {
                            w.u8(10);
                            w.str(text);
                        }
                        WireEvent::CampCleared { camp } => {
                            w.u8(11);
                            w.u16(*camp);
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
                        WireFx::WishStarted {
                            event_time,
                            caster,
                            ability,
                            duration,
                            target,
                            anchor,
                        } => {
                            w.u8(6);
                            w.f64(event_time);
                            w.varint(caster);
                            w.u8(ability);
                            w.f64(duration);
                            w.opt(target.as_ref(), |w, id| w.varint(*id));
                            write_point_opt(w, anchor);
                        }
                        WireFx::WishLanded {
                            event_time,
                            ability,
                            caster,
                            target,
                            anchor,
                            destination,
                        } => {
                            w.u8(7);
                            w.f64(event_time);
                            w.u8(ability);
                            w.opt(caster.as_ref(), |w, id| w.varint(*id));
                            w.opt(target.as_ref(), |w, id| w.varint(*id));
                            write_point_opt(w, anchor);
                            write_point_opt(w, destination);
                        }
                        WireFx::WishEnded {
                            event_time,
                            caster,
                            ability,
                            reason,
                        } => {
                            w.u8(8);
                            w.f64(event_time);
                            w.varint(caster);
                            w.u8(ability);
                            w.u8(reason);
                        }
                        WireFx::Hit {
                            victim,
                            by,
                            amount,
                            passive,
                            critical,
                        } => {
                            w.u8(2);
                            w.varint(victim);
                            w.varint(by);
                            w.f32(amount);
                            w.u8(passive as u8 | (critical as u8) << 1);
                        }
                        WireFx::Windup { by, weapon, a, ms } => {
                            w.u8(9);
                            w.varint(by);
                            w.u8(weapon);
                            w.u16(quant::quantize_facing(a));
                            w.u16(ms);
                        }
                        WireFx::Cancel { id } => {
                            w.u8(10);
                            w.varint(id);
                        }
                        WireFx::SigHit {
                            victim,
                            by,
                            kind,
                            amount,
                        } => {
                            w.u8(11);
                            w.varint(victim);
                            w.varint(by);
                            w.u8(kind);
                            w.f32(amount);
                        }
                        WireFx::Heal { id, amount } => {
                            w.u8(12);
                            w.varint(id);
                            w.f32(amount);
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

fn write_point_opt(w: &mut Writer, point: Option<WirePoint>) {
    w.opt(point.as_ref(), |w, p| {
        w.u16(quant::quantize_pos(p.x));
        w.u16(quant::quantize_pos(p.y));
    });
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

/// A Welcome frame with a pre-encoded map: the same bytes as
/// `ServerMsg::Welcome { .., archetypes, vision, weapons, map }.encode()`, without RLE encoding (or cloning) the map per
/// joining player. One allocation of the exact size. `archetypes` must pass [`crate::archetype::table_fault`], `vision`
/// [`WireVision::fault`] and `weapons` [`crate::weapon::table_fault`] (the server builds them from build constants, sim
/// content and the validated map, checked by its tests).
pub fn encode_welcome(
    h: &WelcomeHeader,
    archetypes: &[WireArchetype],
    vision: &WireVision,
    weapons: &[WireWeapon],
    map: &EncodedMap,
    mode: GroundMode,
) -> Vec<u8> {
    debug_assert_eq!(crate::archetype::table_fault(archetypes), None);
    debug_assert_eq!(vision.fault(), None);
    debug_assert!(vision.fits(map.w(), map.h()));
    debug_assert_eq!(crate::weapon::table_fault(weapons), None);
    let len = WELCOME_HEADER_LEN
        + crate::archetype::table_len(archetypes)
        + vision.encoded_len()
        + crate::weapon::table_len(weapons)
        + map.encoded_len_for_mode(mode);
    debug_assert!(
        len <= MAX_SERVER_FRAME,
        "a Welcome of {len} bytes exceeds MAX_SERVER_FRAME"
    );
    let mut w = Writer::with_capacity(len);
    h.write(&mut w);
    crate::archetype::write_table(&mut w, archetypes);
    vision.write(&mut w);
    crate::weapon::write_table(&mut w, weapons);
    map.write_with_mode(&mut w, mode);
    w.finish()
}

/// [`encode_welcome`] appended to `out`; a frame over [`MAX_SERVER_FRAME`] is an error and leaves `out` unchanged.
pub fn encode_welcome_into(
    h: &WelcomeHeader,
    archetypes: &[WireArchetype],
    vision: &WireVision,
    weapons: &[WireWeapon],
    map: &EncodedMap,
    mode: GroundMode,
    out: &mut Vec<u8>,
) -> Result<usize, EncodeError> {
    if let Some(why) = crate::archetype::table_fault(archetypes) {
        return Err(EncodeError::BadValue(why));
    }
    if let Some(why) = vision.fault() {
        return Err(EncodeError::BadValue(why));
    }
    if !vision.fits(map.w(), map.h()) {
        return Err(EncodeError::BadValue("vision"));
    }
    if let Some(why) = crate::weapon::table_fault(weapons) {
        return Err(EncodeError::BadValue(why));
    }
    let len = WELCOME_HEADER_LEN
        + crate::archetype::table_len(archetypes)
        + vision.encoded_len()
        + crate::weapon::table_len(weapons)
        + map.encoded_len_for_mode(mode);
    frame_size(len, MAX_SERVER_FRAME)?;
    let mut w = Writer::from_vec(std::mem::take(out));
    w.reserve(len);
    h.write(&mut w);
    crate::archetype::write_table(&mut w, archetypes);
    vision.write(&mut w);
    crate::weapon::write_table(&mut w, weapons);
    map.write_with_mode(&mut w, mode);
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
