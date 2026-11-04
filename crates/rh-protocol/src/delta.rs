//! Protocol v3: per-connection snapshot deltas (docs/adr/0010-snapshot-delta.md). Layout: the crate docs ([`crate`]).
//!
//! Three pieces, one per side of the socket:
//!
//! * [`SnapshotData`]: one viewer's snapshot as the room hands it to a connection: remote actors already quantized
//!   ([`QActor`]), the self at full precision, and the exact size of its Full frame. The room builds it once per tick from the
//!   observation ([`SnapshotData::build`], which refuses what the encoders always refused) and does not encode it.
//! * [`ConnEncoder`]: the connection's writer state. It remembers the last snapshot it wrote and encodes the next one as a
//!   Full frame (the v2 layout) or as a Delta against that base, whichever is smaller; a snapshot a slow client skipped never
//!   reaches it. Its memory is bounded by [`MAX_ACTORS`] (one base, two scratch lists).
//! * [`SnapshotTracker`]: a client's decoder. It holds the last snapshot it applied and REFUSES, with a [`DeltaError`], a delta
//!   that does not apply to it. It never clamps or repairs, and a refused delta changes nothing.
//!
//! Everything is lossless: the actors a client holds after any chain of frames equal the actors of a Full frame of the same
//! tick (quantized as always), and the self block is exact (bitwise, so -0.0 and NaN payloads survive).

use super::{
    actor_looks_bad, head_word, id_field, kit, list, self_len, snapshot_fault, write_snapshot_head,
    Fixed, MAX_ACTOR_LEN,
};
use crate::codec::{varint_len, DecodeError, EncodeError, Reader, Writer};
use crate::*;

/// Most ticks a delta's base may be behind it (a writer that skipped more sends a Full frame instead).
pub const MAX_DELTA_AGE: u32 = 64;

/// Delta head word: bit 15 a self follows, bit 14 a departed list follows, bits 12..=13 the phase, bits 0..=11 the self
/// fields that follow (the same order as the bits).
const DH_X: u16 = 1 << 0;
const DH_Y: u16 = 1 << 1;
const DH_FACING: u16 = 1 << 2;
const DH_HP: u16 = 1 << 3;
const DH_MAX_HP: u16 = 1 << 4;
const DH_KIT: u16 = 1 << 5;
const DH_READY: u16 = 1 << 6;
const DH_KILLS: u16 = 1 << 7;
const DH_BOUNTY: u16 = 1 << 8;
const DH_GV: u16 = 1 << 9;
const DH_MOVE_SEQ: u16 = 1 << 10;
const DH_STATUS: u16 = 1 << 11;
const DH_FIELDS: u16 = 0x0fff;
const DH_PHASE_SHIFT: u16 = 12;
const DH_DEPARTED: u16 = 1 << 14;
const DH_PRESENT: u16 = 1 << 15;

/// Actor delta mask: bits 0..=5 the fields that follow, bits 6..=7 the status (always present).
pub const AD_X: u8 = 1 << 0;
pub const AD_Y: u8 = 1 << 1;
pub const AD_FACING: u8 = 1 << 2;
pub const AD_KIT: u8 = 1 << 3;
pub const AD_HP: u8 = 1 << 4;
pub const AD_BOUNTY: u8 = 1 << 5;
/// Every field: what a new actor (one the base does not hold) must carry.
pub const AD_ALL: u8 = 0x3f;
const AD_STATUS_SHIFT: u8 = 6;

/// Fewest bytes a self takes after the head word (id, x y facing, a one-byte max_hp) and an actor takes in a Full frame (id, mask,
/// x y facing).
const MIN_SELF: usize = 1 + 12 + 1;
const MIN_ACTOR: usize = 1 + 1 + 6;

/// Largest self delta after the head word: x, y, facing, hp, max_hp (4 each), kit, ready (2), kills, bounty, gv (3 each),
/// move_seq, status.
const MAX_SELF_DELTA: usize = 20 + 1 + 2 + 9 + 1 + 1;
/// Largest delta head: tag, tick (5), age, ack (5), head word, the self delta, the changed count (3).
const MAX_DELTA_HEAD: usize = 1 + 5 + 1 + 5 + 2 + MAX_SELF_DELTA + 3;
/// Largest changed-actor record: id 5, mask, x y facing 6, kit, hp, bounty 3.
const MAX_ACTOR_DELTA: usize = 5 + 1 + 6 + 1 + 1 + 3;

/// A remote actor as a connection remembers and sends it: exactly what the wire carries (15 bytes of fields).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct QActor {
    pub id: u32,
    /// Position on the 1/8 u grid ([`quant::quantize_pos`]).
    pub x: u16,
    pub y: u16,
    /// Angle code ([`quant::quantize_facing`]).
    pub facing: u16,
    /// Faction in the low nibble, weapon in the high one.
    pub kit: u8,
    pub hp_pct: u8,
    pub status: u8,
    pub bounty: u16,
}

impl QActor {
    /// `a` as it goes over the wire (the caller has checked it: [`SnapshotData::build`] does).
    #[inline]
    pub fn from_wire(a: &WireActor) -> Self {
        QActor {
            id: a.id,
            x: quant::quantize_pos(a.x),
            y: quant::quantize_pos(a.y),
            facing: quant::quantize_facing(a.facing),
            kit: kit(a.faction, a.weapon),
            hp_pct: a.hp_pct,
            status: a.status,
            bounty: a.bounty,
        }
    }

    /// What a client decodes this actor to.
    pub fn to_wire(&self) -> WireActor {
        WireActor {
            id: self.id,
            faction: self.kit & 0x0f,
            x: quant::dequantize_pos(self.x),
            y: quant::dequantize_pos(self.y),
            facing: quant::dequantize_facing(self.facing),
            hp_pct: self.hp_pct,
            status: self.status,
            weapon: self.kit >> 4,
            bounty: self.bounty,
        }
    }

    /// The v2 actor mask: status inline, a bit per optional field that differs from its default.
    #[inline]
    fn full_mask(&self) -> u8 {
        let mut m = (self.status & 3) << AM_STATUS_SHIFT;
        if self.kit != 0 {
            m |= AM_KIT;
        }
        if self.hp_pct != DEFAULT_HP_PCT {
            m |= AM_HP;
        }
        if self.bounty != 0 {
            m |= AM_BOUNTY;
        }
        m
    }

    /// Bytes this actor takes in a Full frame after `prev` (the previous actor's id).
    #[inline]
    fn full_len(&self, prev: Option<u32>) -> usize {
        varint_len(id_field(self.id, prev))
            + 7
            + (self.kit != 0) as usize
            + (self.hp_pct != DEFAULT_HP_PCT) as usize
            + if self.bounty != 0 {
                varint_len(self.bounty as u32)
            } else {
                0
            }
    }
}

/// One v2 actor record from a [`QActor`] (the same bytes as `write_actor` writes for the [`WireActor`] it came from).
#[inline(always)]
fn write_full_actor(out: &mut Writer, q: &QActor, prev: Option<u32>) {
    let m = q.full_mask();
    let mut w = Fixed::<MAX_ACTOR_LEN>::new();
    w.varint(id_field(q.id, prev));
    w.u8(m);
    w.u16(q.x);
    w.u16(q.y);
    w.u16(q.facing);
    if m & AM_KIT != 0 {
        w.u8(q.kit);
    }
    if m & AM_HP != 0 {
        w.u8(q.hp_pct);
    }
    if m & AM_BOUNTY != 0 {
        w.varint(q.bounty as u32);
    }
    w.put(out);
}

/// One viewer's snapshot as the room hands it to that viewer's connection (validated: every frame built from it is one every
/// decoder accepts). Immutable once built; the connection's [`ConnEncoder`] keeps the last one it wrote as its base.
///
/// A handle to a heap block (the snapshot is some 80 bytes plus its actor list): it moves from the room to the outbox slot to the
/// writer's base as a pointer, and the block of a snapshot the writer is finished with is handed back to build the next one in
/// ([`ConnEncoder::take_spare`], [`SnapshotData::build_with`]), so a steady stream allocates nothing and copies nothing.
#[derive(Clone, Debug, PartialEq)]
pub struct SnapshotData(Box<SnapshotInner>);

/// What a [`SnapshotData`] holds (its fields are this module's; read them through the accessors).
#[doc(hidden)]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SnapshotInner {
    tick: u32,
    phase: u8,
    ack_input: u32,
    me: Option<WireSelf>,
    actors: Vec<QActor>,
    /// [`SnapshotData::min_len`], worked out once.
    min_len: u32,
}

impl std::ops::Deref for SnapshotData {
    type Target = SnapshotInner;
    #[inline]
    fn deref(&self) -> &SnapshotInner {
        &self.0
    }
}

impl SnapshotData {
    /// Quantizes and checks a snapshot, refusing (never repairing) anything a decoder would reject: more than [`MAX_ACTORS`]
    /// actors, a phase, status, faction or weapon over its bit width, an `hp_pct` over 100, a position off the wire grid,
    /// ids that do not strictly ascend, or an iterator whose length lies. The same refusals as `encode_snapshot_into`.
    pub fn build<I>(
        tick: u32,
        phase: u8,
        ack_input: u32,
        me: Option<WireSelf>,
        actors: I,
    ) -> Result<Self, EncodeError>
    where
        I: ExactSizeIterator<Item = WireActor>,
    {
        Self::build_with(None, tick, phase, ack_input, me, actors)
    }

    /// [`SnapshotData::build`] in the block of an earlier snapshot ([`ConnEncoder::take_spare`]; its contents are overwritten),
    /// so a steady stream builds its snapshots without allocating.
    pub fn build_with<I>(
        spare: Option<SnapshotData>,
        tick: u32,
        phase: u8,
        ack_input: u32,
        me: Option<WireSelf>,
        actors: I,
    ) -> Result<Self, EncodeError>
    where
        I: ExactSizeIterator<Item = WireActor>,
    {
        let declared = actors.len();
        list("actors", declared, MAX_ACTORS)?;
        if phase > MAX_PHASE_CODE
            || me.is_some_and(|s| {
                (s.faction | s.weapon) > MAX_KIT_CODE || s.status > MAX_STATUS_CODE
            })
        {
            if let Some(why) = snapshot_fault(phase, me.as_ref(), &[]) {
                return Err(EncodeError::BadValue(why));
            }
        }
        let mut b = spare.map_or_else(Box::default, |s| s.0);
        let out = &mut b.actors;
        out.clear();
        out.reserve(declared);
        let mut prev: Option<u32> = None;
        for a in actors {
            if actor_looks_bad(&a, prev) {
                let why = snapshot_fault(0, None, std::slice::from_ref(&a))
                    .or(prev.is_some_and(|p| a.id <= p).then_some("actor order"))
                    .unwrap_or("actor");
                return Err(EncodeError::BadValue(why));
            }
            let q = QActor::from_wire(&a);
            prev = Some(q.id);
            out.push(q);
        }
        if out.len() != declared {
            return Err(EncodeError::CountMismatch {
                declared,
                written: out.len(),
            });
        }
        b.min_len = (1
            + varint_len(tick)
            + varint_len(ack_input)
            + 2
            + varint_len(declared as u32)
            + me.as_ref().map_or(0, |_| MIN_SELF)
            + MIN_ACTOR * declared) as u32;
        b.tick = tick;
        b.phase = phase;
        b.ack_input = ack_input;
        b.me = me;
        Ok(SnapshotData(b))
    }

    pub fn tick(&self) -> u32 {
        self.tick
    }
    pub fn phase(&self) -> u8 {
        self.phase
    }
    pub fn ack_input(&self) -> u32 {
        self.ack_input
    }
    pub fn me(&self) -> Option<&WireSelf> {
        self.me.as_ref()
    }
    pub fn actors(&self) -> &[QActor] {
        &self.actors
    }
    /// Exact size of this snapshot's Full frame (a pass over the actors: the writer asks only when a delta is not clearly
    /// smaller).
    pub fn full_len(&self) -> usize {
        let mut n = 1
            + varint_len(self.tick)
            + varint_len(self.ack_input)
            + 2
            + self
                .me
                .as_ref()
                .map_or(0, |s| self_len(s, head_word(self.phase, Some(s))))
            + varint_len(self.actors.len() as u32);
        let mut prev = None;
        for q in &self.actors {
            n += q.full_len(prev);
            prev = Some(q.id);
        }
        n
    }

    /// A capacity to build this snapshot's frame in without growing: its least Full size plus room for the stack records a delta
    /// is assembled from (they are copied whole, then trimmed).
    pub fn frame_capacity(&self) -> usize {
        self.min_len() + MAX_DELTA_HEAD + MAX_ACTOR_DELTA
    }

    /// A lower bound of [`SnapshotData::full_len`] in constant time: the fewest bytes the head, the self and the actors take.
    #[inline]
    pub fn min_len(&self) -> usize {
        self.min_len as usize
    }

    /// Appends this snapshot as a Full frame (the v2 layout): the same bytes `encode_snapshot_into` writes for it.
    pub fn encode_full_into(&self, out: &mut Vec<u8>) -> usize {
        let start = out.len();
        let mut w = Writer::from_vec(std::mem::take(out));
        w.reserve(self.min_len());
        write_snapshot_head(
            &mut w,
            self.tick,
            self.phase,
            self.ack_input,
            self.me.as_ref(),
            self.actors.len(),
        );
        let mut prev = None;
        for q in &self.actors {
            write_full_actor(&mut w, q, prev);
            prev = Some(q.id);
        }
        *out = w.finish();
        debug_assert_eq!(out.len() - start, self.full_len());
        out.len() - start
    }

    /// What a client decodes this snapshot to (a Full frame or a chain of deltas ending here).
    pub fn decoded(&self) -> ServerMsg {
        ServerMsg::Snapshot {
            tick: self.tick,
            phase: self.phase,
            ack_input: self.ack_input,
            me: self.me,
            actors: self.actors.iter().map(QActor::to_wire).collect(),
        }
    }

    /// Heap and inline bytes this value occupies.
    pub fn memory_bytes(&self) -> usize {
        std::mem::size_of::<Self>()
            + std::mem::size_of::<SnapshotInner>()
            + self.actors.capacity() * std::mem::size_of::<QActor>()
    }
}

/// Which kind of snapshot frame [`ConnEncoder::encode`] wrote.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FrameKind {
    Full,
    Delta,
}

/// A connection's writer state for snapshots (one per connection, owned by its writer task). See the module docs.
#[derive(Debug, Default)]
pub struct ConnEncoder {
    base: Option<SnapshotData>,
    /// A resync was requested: the next snapshot is Full.
    force_full: bool,
    departed: Vec<u32>,
    /// The base before the current one, free to build the next snapshot in ([`ConnEncoder::take_spare`]).
    spare: Option<SnapshotData>,
}

impl ConnEncoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// The next snapshot is a Full frame (a client asked to resync).
    pub fn request_full(&mut self) {
        self.force_full = true;
    }

    /// The tick of the last snapshot written (the base of the next delta), if any.
    pub fn base_tick(&self) -> Option<u32> {
        self.base.as_ref().map(SnapshotData::tick)
    }

    /// Bytes this connection's snapshot state holds (base, spare list, scratch list): bounded by [`MAX_ACTORS`] whatever the
    /// traffic.
    pub fn memory_bytes(&self) -> usize {
        std::mem::size_of::<Self>()
            + self.base.as_ref().map_or(0, |b| b.memory_bytes())
            + self.spare.as_ref().map_or(0, SnapshotData::memory_bytes)
            + self.departed.capacity() * 4
    }

    /// The snapshot the base replaced, finished with: pass it to [`SnapshotData::build_with`] for the next snapshot, so the
    /// steady state never allocates one. `None` until the base has been replaced once.
    pub fn take_spare(&mut self) -> Option<SnapshotData> {
        self.spare.take()
    }

    /// Whether `cur` may be sent as a delta against the base.
    fn delta_possible(&self, cur: &SnapshotData) -> bool {
        let Some(b) = &self.base else { return false };
        if self.force_full || cur.tick <= b.tick || cur.tick - b.tick > MAX_DELTA_AGE {
            return false;
        }
        match (&b.me, &cur.me) {
            (_, None) => true,
            (Some(bm), Some(cm)) => bm.id == cm.id,
            (None, Some(_)) => false,
        }
    }

    /// Appends the frame for `snap` to `out` and makes `snap` the base of the next one: a Delta when that is possible and
    /// smaller than the Full frame, else a Full frame.
    pub fn encode(&mut self, snap: SnapshotData, out: &mut Vec<u8>) -> FrameKind {
        let start = out.len();
        let mut kind = FrameKind::Full;
        if self.delta_possible(&snap) {
            let base = self.base.as_ref().expect("checked by delta_possible");
            write_delta(base, &snap, &mut self.departed, out);
            // Smaller than the Full frame? Below the Full frame's least size it certainly is; the exact size (a pass over the
            // actors) is asked for only when the delta is that large.
            let len = out.len() - start;
            if len < snap.min_len() || len < snap.full_len() {
                kind = FrameKind::Delta;
            } else {
                out.truncate(start);
            }
        }
        if kind == FrameKind::Full {
            snap.encode_full_into(out);
        }
        self.force_full = false;
        self.spare = self.base.replace(snap);
        kind
    }
}

/// Appends a stack record to the frame with one constant-size copy (inline moves, no `memcpy` call for a length only known at
/// run time), then drops the unused tail: what `Fixed::put` does for a [`Writer`].
#[inline(always)]
fn put<const N: usize>(out: &mut Vec<u8>, f: &Fixed<N>) {
    let len = out.len();
    out.extend_from_slice(&f.b);
    out.truncate(len + f.n);
}

/// Appends the delta of `cur` against `base` to `out` (the caller has checked [`ConnEncoder::delta_possible`]'s conditions).
/// One pass: the head is written with its departed bit and the changed count as placeholders that are patched once the actors
/// have been walked (the count is one byte unless 128 or more actors changed), and each changed actor is appended as it is found.
fn write_delta(
    base: &SnapshotData,
    cur: &SnapshotData,
    departed: &mut Vec<u32>,
    out: &mut Vec<u8>,
) {
    departed.clear();
    let start = out.len();
    let age = cur.tick - base.tick;
    let mut f = Fixed::<MAX_DELTA_HEAD>::new();
    f.u8(T_SNAPSHOT_DELTA);
    f.varint(cur.tick);
    f.varint(age);
    f.varint(cur.ack_input);
    let head_at = f.n;
    f.u16(0);
    let mut head = ((cur.phase as u16) & 3) << DH_PHASE_SHIFT;
    if let (Some(bm), Some(cm)) = (&base.me, &cur.me) {
        head |= DH_PRESENT | write_self_delta(&mut f, bm, cm);
    }
    let count_at = f.n;
    f.u8(0);
    put(out, &f);

    let (b, c) = (base.actors.as_slice(), cur.actors.as_slice());
    let (mut i, mut last, mut changed) = (0usize, 0u32, 0u32);
    for q in c {
        while i < b.len() && b[i].id < q.id {
            departed.push(b[i].id);
            i += 1;
        }
        let (mask, same_status) = if i < b.len() && b[i].id == q.id {
            let p = &b[i];
            i += 1;
            (
                (p.x != q.x) as u8
                    | ((p.y != q.y) as u8) << 1
                    | ((p.facing != q.facing) as u8) << 2
                    | ((p.kit != q.kit) as u8) << 3
                    | ((p.hp_pct != q.hp_pct) as u8) << 4
                    | ((p.bounty != q.bounty) as u8) << 5,
                p.status == q.status,
            )
        } else {
            (AD_ALL, false)
        };
        if mask == 0 && same_status {
            continue;
        }
        let mut w = Fixed::<MAX_ACTOR_DELTA>::new();
        w.varint(if changed == 0 { q.id } else { q.id - last });
        w.u8(mask | (q.status & 3) << AD_STATUS_SHIFT);
        if mask & AD_X != 0 {
            w.u16(q.x);
        }
        if mask & AD_Y != 0 {
            w.u16(q.y);
        }
        if mask & AD_FACING != 0 {
            w.u16(q.facing);
        }
        if mask & AD_KIT != 0 {
            w.u8(q.kit);
        }
        if mask & AD_HP != 0 {
            w.u8(q.hp_pct);
        }
        if mask & AD_BOUNTY != 0 {
            w.varint(q.bounty as u32);
        }
        put(out, &w);
        last = q.id;
        changed += 1;
    }
    departed.extend(b[i..].iter().map(|p| p.id));
    if !departed.is_empty() {
        head |= DH_DEPARTED;
        let mut w = Writer::from_vec(std::mem::take(out));
        write_departed(&mut w, departed);
        *out = w.finish();
    }
    out[start + head_at..start + head_at + 2].copy_from_slice(&head.to_le_bytes());
    if changed < 0x80 {
        out[start + count_at] = changed as u8;
    } else {
        // 128 or more changed actors: the count is a two-byte varint (at most 512).
        let v = [(changed as u8) | 0x80, (changed >> 7) as u8];
        out.splice(start + count_at..start + count_at + 1, v);
    }
}

fn write_departed(w: &mut Writer, ids: &[u32]) {
    w.varint(ids.len() as u32);
    let mut last = 0u32;
    for (n, &id) in ids.iter().enumerate() {
        w.varint(if n == 0 { id } else { id - last });
        last = id;
    }
}

/// The self fields of `c` that differ from `b`, written in bit order; returns their head bits.
#[inline]
fn write_self_delta(f: &mut Fixed<MAX_DELTA_HEAD>, b: &WireSelf, c: &WireSelf) -> u16 {
    let mut m = 0u16;
    // Bitwise comparisons: -0.0 and NaN payloads must survive.
    if c.x.to_bits() != b.x.to_bits() {
        m |= DH_X;
        f.f32(c.x);
    }
    if c.y.to_bits() != b.y.to_bits() {
        m |= DH_Y;
        f.f32(c.y);
    }
    if c.facing.to_bits() != b.facing.to_bits() {
        m |= DH_FACING;
        f.f32(c.facing);
    }
    if c.hp.to_bits() != b.hp.to_bits() {
        m |= DH_HP;
        f.f32(c.hp);
    }
    if c.max_hp.to_bits() != b.max_hp.to_bits() {
        m |= DH_MAX_HP;
        f.f32(c.max_hp);
    }
    let k = kit(c.faction, c.weapon);
    if k != kit(b.faction, b.weapon) {
        m |= DH_KIT;
        f.u8(k);
    }
    if c.ready_in_ms != b.ready_in_ms {
        m |= DH_READY;
        f.u16(c.ready_in_ms);
    }
    if c.kills != b.kills {
        m |= DH_KILLS;
        f.varint(c.kills as u32);
    }
    if c.bounty != b.bounty {
        m |= DH_BOUNTY;
        f.varint(c.bounty as u32);
    }
    if c.gv != b.gv {
        m |= DH_GV;
        f.varint(c.gv as u32);
    }
    if c.move_seq != b.move_seq {
        m |= DH_MOVE_SEQ;
        f.u8(c.move_seq);
    }
    if c.status != b.status {
        m |= DH_STATUS;
        f.u8(c.status);
    }
    m
}

/// The changed self fields of a delta: `mask` has the head's field bits (0..=11); only the fields whose bit is set mean
/// anything (the others are zero).
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct SelfDelta {
    pub mask: u16,
    pub x: f32,
    pub y: f32,
    pub facing: f32,
    pub hp: f32,
    pub max_hp: f32,
    /// Faction in the low nibble, weapon in the high one.
    pub kit: u8,
    pub ready_in_ms: u16,
    pub kills: u16,
    pub bounty: u16,
    pub gv: u16,
    pub move_seq: u8,
    pub status: u8,
}

impl SelfDelta {
    /// The self after applying this delta to `base`.
    pub fn apply(&self, base: &WireSelf) -> WireSelf {
        let mut s = *base;
        let m = self.mask;
        if m & DH_X != 0 {
            s.x = self.x;
        }
        if m & DH_Y != 0 {
            s.y = self.y;
        }
        if m & DH_FACING != 0 {
            s.facing = self.facing;
        }
        if m & DH_HP != 0 {
            s.hp = self.hp;
        }
        if m & DH_MAX_HP != 0 {
            s.max_hp = self.max_hp;
        }
        if m & DH_KIT != 0 {
            s.faction = self.kit & 0x0f;
            s.weapon = self.kit >> 4;
        }
        if m & DH_READY != 0 {
            s.ready_in_ms = self.ready_in_ms;
        }
        if m & DH_KILLS != 0 {
            s.kills = self.kills;
        }
        if m & DH_BOUNTY != 0 {
            s.bounty = self.bounty;
        }
        if m & DH_GV != 0 {
            s.gv = self.gv;
        }
        if m & DH_MOVE_SEQ != 0 {
            s.move_seq = self.move_seq;
        }
        if m & DH_STATUS != 0 {
            s.status = self.status;
        }
        s
    }

    /// The delta that turns `b` into `c` (their ids must be equal; the id is not carried).
    pub fn between(b: &WireSelf, c: &WireSelf) -> SelfDelta {
        let mut f = Fixed::<MAX_DELTA_HEAD>::new();
        let mask = write_self_delta(&mut f, b, c);
        // Only the fields in the mask mean anything (the others are zero, as a decoder reads them back).
        let keep = |bit: u16| mask & bit != 0;
        SelfDelta {
            mask,
            x: if keep(DH_X) { c.x } else { 0.0 },
            y: if keep(DH_Y) { c.y } else { 0.0 },
            facing: if keep(DH_FACING) { c.facing } else { 0.0 },
            hp: if keep(DH_HP) { c.hp } else { 0.0 },
            max_hp: if keep(DH_MAX_HP) { c.max_hp } else { 0.0 },
            kit: if keep(DH_KIT) {
                kit(c.faction, c.weapon)
            } else {
                0
            },
            ready_in_ms: if keep(DH_READY) { c.ready_in_ms } else { 0 },
            kills: if keep(DH_KILLS) { c.kills } else { 0 },
            bounty: if keep(DH_BOUNTY) { c.bounty } else { 0 },
            gv: if keep(DH_GV) { c.gv } else { 0 },
            move_seq: if keep(DH_MOVE_SEQ) { c.move_seq } else { 0 },
            status: if keep(DH_STATUS) { c.status } else { 0 },
        }
    }
}

/// One changed remote actor of a delta: `mask` (bits [`AD_X`]..[`AD_BOUNTY`]) says which fields of `q` are carried; the others
/// are zero and mean nothing. The status is always carried.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ActorDelta {
    pub mask: u8,
    pub q: QActor,
}

impl ActorDelta {
    /// This delta applied to the actor `base` (a decoded actor).
    pub fn apply(&self, base: &WireActor) -> WireActor {
        let mut a = *base;
        if self.mask & AD_X != 0 {
            a.x = quant::dequantize_pos(self.q.x);
        }
        if self.mask & AD_Y != 0 {
            a.y = quant::dequantize_pos(self.q.y);
        }
        if self.mask & AD_FACING != 0 {
            a.facing = quant::dequantize_facing(self.q.facing);
        }
        if self.mask & AD_KIT != 0 {
            a.faction = self.q.kit & 0x0f;
            a.weapon = self.q.kit >> 4;
        }
        if self.mask & AD_HP != 0 {
            a.hp_pct = self.q.hp_pct;
        }
        if self.mask & AD_BOUNTY != 0 {
            a.bounty = self.q.bounty;
        }
        a.status = self.q.status;
        a
    }
}

/// A snapshot delta frame, as decoded (syntax checked; whether it applies is [`SnapshotTracker`]'s question).
#[derive(Clone, Debug, PartialEq)]
pub struct SnapshotDelta {
    pub tick: u32,
    /// The tick of the snapshot this one is relative to (`tick - base_age`, 1..=[`MAX_DELTA_AGE`] behind).
    pub base_tick: u32,
    pub phase: u8,
    pub ack_input: u32,
    /// `Some` when the frame has a self (the base must have one too); the id is the base's.
    pub me: Option<SelfDelta>,
    /// Ascending by id; a new actor carries every field ([`AD_ALL`]).
    pub changed: Vec<ActorDelta>,
    /// Ascending ids that were in the base and are gone.
    pub departed: Vec<u32>,
}

/// The delta that turns `base` into `cur`, as a message (a reference implementation: [`ConnEncoder`] writes the same bytes
/// without building it). `None` when `cur` cannot be a delta of `base` (the same conditions [`ConnEncoder`] sends a Full
/// frame for, except that it may be larger than the Full frame).
pub fn diff(base: &SnapshotData, cur: &SnapshotData) -> Option<SnapshotDelta> {
    let me = match (&base.me, &cur.me) {
        (_, None) => None,
        (Some(b), Some(c)) if b.id == c.id => Some(SelfDelta::between(b, c)),
        _ => return None,
    };
    if cur.tick <= base.tick || cur.tick - base.tick > MAX_DELTA_AGE {
        return None;
    }
    let (b, c) = (&base.actors, &cur.actors);
    let mut changed = Vec::new();
    for q in c {
        match b.binary_search_by_key(&q.id, |p| p.id) {
            Ok(i) => {
                let p = &b[i];
                let mask = (p.x != q.x) as u8
                    | ((p.y != q.y) as u8) << 1
                    | ((p.facing != q.facing) as u8) << 2
                    | ((p.kit != q.kit) as u8) << 3
                    | ((p.hp_pct != q.hp_pct) as u8) << 4
                    | ((p.bounty != q.bounty) as u8) << 5;
                if mask != 0 || p.status != q.status {
                    changed.push(ActorDelta {
                        mask,
                        q: mask_fields(q, mask),
                    });
                }
            }
            Err(_) => changed.push(ActorDelta {
                mask: AD_ALL,
                q: *q,
            }),
        }
    }
    let departed = b
        .iter()
        .filter(|p| c.binary_search_by_key(&p.id, |q| q.id).is_err())
        .map(|p| p.id)
        .collect();
    Some(SnapshotDelta {
        tick: cur.tick,
        base_tick: base.tick,
        phase: cur.phase,
        ack_input: cur.ack_input,
        me,
        changed,
        departed,
    })
}

/// `q` with the fields outside `mask` zeroed (what a decoder reads back).
fn mask_fields(q: &QActor, mask: u8) -> QActor {
    QActor {
        id: q.id,
        x: if mask & AD_X != 0 { q.x } else { 0 },
        y: if mask & AD_Y != 0 { q.y } else { 0 },
        facing: if mask & AD_FACING != 0 { q.facing } else { 0 },
        kit: if mask & AD_KIT != 0 { q.kit } else { 0 },
        hp_pct: if mask & AD_HP != 0 { q.hp_pct } else { 0 },
        status: q.status,
        bounty: if mask & AD_BOUNTY != 0 { q.bounty } else { 0 },
    }
}

/// The delta message as bytes (the reference writer behind `ServerMsg::SnapshotDelta`).
pub(crate) fn write_message(w: &mut Writer, d: &SnapshotDelta) {
    w.u8(T_SNAPSHOT_DELTA);
    w.varint(d.tick);
    w.varint(d.tick.wrapping_sub(d.base_tick));
    w.varint(d.ack_input);
    let mut head = ((d.phase as u16) & 3) << DH_PHASE_SHIFT;
    if let Some(s) = &d.me {
        head |= DH_PRESENT | (s.mask & DH_FIELDS);
    }
    if !d.departed.is_empty() {
        head |= DH_DEPARTED;
    }
    w.u16(head);
    if let Some(s) = &d.me {
        let m = s.mask;
        if m & DH_X != 0 {
            w.f32(s.x);
        }
        if m & DH_Y != 0 {
            w.f32(s.y);
        }
        if m & DH_FACING != 0 {
            w.f32(s.facing);
        }
        if m & DH_HP != 0 {
            w.f32(s.hp);
        }
        if m & DH_MAX_HP != 0 {
            w.f32(s.max_hp);
        }
        if m & DH_KIT != 0 {
            w.u8(s.kit);
        }
        if m & DH_READY != 0 {
            w.u16(s.ready_in_ms);
        }
        if m & DH_KILLS != 0 {
            w.varint(s.kills as u32);
        }
        if m & DH_BOUNTY != 0 {
            w.varint(s.bounty as u32);
        }
        if m & DH_GV != 0 {
            w.varint(s.gv as u32);
        }
        if m & DH_MOVE_SEQ != 0 {
            w.u8(s.move_seq);
        }
        if m & DH_STATUS != 0 {
            w.u8(s.status);
        }
    }
    w.varint(d.changed.len() as u32);
    let mut prev: Option<u32> = None;
    for a in &d.changed {
        w.varint(id_field(a.q.id, prev));
        prev = Some(a.q.id);
        w.u8((a.mask & AD_ALL) | (a.q.status & 3) << AD_STATUS_SHIFT);
        if a.mask & AD_X != 0 {
            w.u16(a.q.x);
        }
        if a.mask & AD_Y != 0 {
            w.u16(a.q.y);
        }
        if a.mask & AD_FACING != 0 {
            w.u16(a.q.facing);
        }
        if a.mask & AD_KIT != 0 {
            w.u8(a.q.kit);
        }
        if a.mask & AD_HP != 0 {
            w.u8(a.q.hp_pct);
        }
        if a.mask & AD_BOUNTY != 0 {
            w.varint(a.q.bounty as u32);
        }
    }
    if !d.departed.is_empty() {
        write_departed(w, &d.departed);
    }
}

pub(crate) fn message_len(d: &SnapshotDelta) -> usize {
    let mut w = Writer::default();
    write_message(&mut w, d);
    w.len()
}

/// Why a decoder would reject this delta message (the encoder refuses it too: [`EncodeError`]).
pub(crate) fn message_check(d: &SnapshotDelta) -> Result<(), EncodeError> {
    list("actors", d.changed.len(), MAX_ACTORS)?;
    list("departed", d.departed.len(), MAX_ACTORS)?;
    let bad = |why| Err(EncodeError::BadValue(why));
    if d.phase > MAX_PHASE_CODE {
        return bad("phase");
    }
    match d.tick.checked_sub(d.base_tick) {
        Some(age) if (1..=MAX_DELTA_AGE).contains(&age) => {}
        _ => return bad("base age"),
    }
    if let Some(s) = &d.me {
        if s.mask & !DH_FIELDS != 0 {
            return bad("head");
        }
        if s.mask & DH_STATUS != 0 && s.status > MAX_STATUS_CODE {
            return bad("status");
        }
    }
    let mut prev: Option<u32> = None;
    for a in &d.changed {
        if a.mask & !AD_ALL != 0 {
            return bad("actor mask");
        }
        if a.q.status > MAX_STATUS_CODE {
            return bad("status");
        }
        if a.mask & AD_HP != 0 && a.q.hp_pct > 100 {
            return bad("hp_pct");
        }
        if prev.is_some_and(|p| a.q.id <= p) {
            return bad("actor order");
        }
        prev = Some(a.q.id);
    }
    if d.departed.windows(2).any(|w| w[1] <= w[0]) {
        return bad("departed order");
    }
    Ok(())
}

fn read_self_delta(r: &mut Reader, mask: u16) -> Result<SelfDelta, DecodeError> {
    let mut s = SelfDelta {
        mask,
        ..SelfDelta::default()
    };
    if mask & DH_X != 0 {
        s.x = r.f32()?;
    }
    if mask & DH_Y != 0 {
        s.y = r.f32()?;
    }
    if mask & DH_FACING != 0 {
        s.facing = r.f32()?;
    }
    if mask & DH_HP != 0 {
        s.hp = r.f32()?;
    }
    if mask & DH_MAX_HP != 0 {
        s.max_hp = r.f32()?;
    }
    if mask & DH_KIT != 0 {
        s.kit = r.u8()?;
    }
    if mask & DH_READY != 0 {
        s.ready_in_ms = r.u16()?;
    }
    if mask & DH_KILLS != 0 {
        s.kills = crate::varint_u16(r, "kills")?;
    }
    if mask & DH_BOUNTY != 0 {
        s.bounty = crate::varint_u16(r, "bounty")?;
    }
    if mask & DH_GV != 0 {
        s.gv = crate::varint_u16(r, "gv")?;
    }
    if mask & DH_MOVE_SEQ != 0 {
        s.move_seq = r.u8()?;
    }
    if mask & DH_STATUS != 0 {
        s.status = r.u8()?;
        if s.status > MAX_STATUS_CODE {
            return Err(DecodeError::BadField("status"));
        }
    }
    Ok(s)
}

/// An id that is absolute for the first of a list and a non-zero gap after (so ids strictly ascend).
fn read_id(r: &mut Reader, prev: Option<u32>, what: &'static str) -> Result<u32, DecodeError> {
    let field = r.varint()?;
    match prev {
        None => Ok(field),
        Some(p) => match p.checked_add(field) {
            Some(id) if field != 0 => Ok(id),
            _ => Err(DecodeError::BadField(what)),
        },
    }
}

/// Reads the body of a delta frame (after the tag): syntax and ranges only.
pub(crate) fn read_snapshot_delta(r: &mut Reader) -> Result<SnapshotDelta, DecodeError> {
    let tick = r.varint()?;
    let age = r.varint()?;
    if !(1..=MAX_DELTA_AGE).contains(&age) || age > tick {
        return Err(DecodeError::BadField("base age"));
    }
    let ack_input = r.varint()?;
    let head = r.u16()?;
    if head & DH_PRESENT == 0 && head & DH_FIELDS != 0 {
        return Err(DecodeError::BadField("head"));
    }
    let phase = ((head >> DH_PHASE_SHIFT) & 3) as u8;
    let me = if head & DH_PRESENT != 0 {
        Some(read_self_delta(r, head & DH_FIELDS)?)
    } else {
        None
    };
    let n = r.varint()? as usize;
    if n > MAX_ACTORS {
        return Err(DecodeError::TooMany(n));
    }
    let mut changed = Vec::with_capacity(n);
    let mut prev = None;
    for _ in 0..n {
        let id = read_id(r, prev, "actor order")?;
        prev = Some(id);
        let m = r.u8()?;
        let mask = m & AD_ALL;
        let mut q = QActor {
            id,
            status: m >> AD_STATUS_SHIFT,
            ..QActor::default()
        };
        if mask & AD_X != 0 {
            q.x = r.u16()?;
        }
        if mask & AD_Y != 0 {
            q.y = r.u16()?;
        }
        if mask & AD_FACING != 0 {
            q.facing = r.u16()?;
        }
        if mask & AD_KIT != 0 {
            q.kit = r.u8()?;
        }
        if mask & AD_HP != 0 {
            q.hp_pct = r.u8()?;
            if q.hp_pct > 100 {
                return Err(DecodeError::BadField("hp_pct"));
            }
        }
        if mask & AD_BOUNTY != 0 {
            q.bounty = crate::varint_u16(r, "bounty")?;
        }
        changed.push(ActorDelta { mask, q });
    }
    let mut departed = Vec::new();
    if head & DH_DEPARTED != 0 {
        let n = r.varint()? as usize;
        if n == 0 {
            return Err(DecodeError::BadField("departed"));
        }
        if n > MAX_ACTORS {
            return Err(DecodeError::TooMany(n));
        }
        departed.reserve(n);
        let mut prev = None;
        for _ in 0..n {
            let id = read_id(r, prev, "departed order")?;
            prev = Some(id);
            departed.push(id);
        }
    }
    Ok(SnapshotDelta {
        tick,
        base_tick: tick - age,
        phase,
        ack_input,
        me,
        changed,
        departed,
    })
}

/// Why a client refused a delta (what it held did not change). Each is a reason to ask the server for a Full frame.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DeltaError {
    /// No snapshot held yet (the connection's first snapshot must be Full, and so must the first after a Welcome).
    NoBase,
    /// The delta's base is not the snapshot held.
    BaseMismatch { have: u32, want: u32 },
    /// The delta has a self but the held snapshot has none.
    SelfWithoutBase,
    /// A departed id the held snapshot does not list.
    UnknownDeparted(u32),
    /// An actor both changed and departed.
    DepartedAndChanged(u32),
    /// An actor the held snapshot does not list, carried without every field.
    IncompleteNewActor(u32),
    /// The result would list more than [`MAX_ACTORS`] actors.
    TooManyActors(usize),
}

impl DeltaError {
    /// A stable name (the golden vectors' `reason`).
    pub fn code(&self) -> &'static str {
        match self {
            DeltaError::NoBase => "no_base",
            DeltaError::BaseMismatch { .. } => "base_mismatch",
            DeltaError::SelfWithoutBase => "self_without_base",
            DeltaError::UnknownDeparted(_) => "unknown_departed",
            DeltaError::DepartedAndChanged(_) => "departed_and_changed",
            DeltaError::IncompleteNewActor(_) => "incomplete_new_actor",
            DeltaError::TooManyActors(_) => "too_many_actors",
        }
    }
}

impl std::fmt::Display for DeltaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for DeltaError {}

/// Why [`SnapshotTracker::decode`] refused a frame.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TrackError {
    Decode(DecodeError),
    Delta(DeltaError),
}

impl std::fmt::Display for TrackError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for TrackError {}

/// A client's snapshot decoder: the last snapshot applied (the base of the next delta). One per connection; a Welcome resets
/// it, so the first snapshot after one must be Full. A refused delta leaves it exactly as it was.
#[derive(Clone, Debug, Default)]
pub struct SnapshotTracker {
    tick: Option<u32>,
    phase: u8,
    ack_input: u32,
    me: Option<WireSelf>,
    actors: Vec<WireActor>,
    scratch: Vec<WireActor>,
}

impl SnapshotTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Forgets the held snapshot (a new connection or a Welcome).
    pub fn reset(&mut self) {
        self.tick = None;
        self.me = None;
        self.actors.clear();
    }

    /// The tick of the snapshot held.
    pub fn held_tick(&self) -> Option<u32> {
        self.tick
    }

    /// The actors of the snapshot held, ascending by id.
    pub fn actors(&self) -> &[WireActor] {
        &self.actors
    }

    pub fn me(&self) -> Option<&WireSelf> {
        self.me.as_ref()
    }

    /// The held snapshot as the message a Full frame of it would decode to.
    pub fn snapshot(&self) -> Option<ServerMsg> {
        Some(ServerMsg::Snapshot {
            tick: self.tick?,
            phase: self.phase,
            ack_input: self.ack_input,
            me: self.me,
            actors: self.actors.clone(),
        })
    }

    /// Decodes one server frame. A Snapshot is held and returned; a SnapshotDelta is applied and returned as the Snapshot it
    /// resolves to; a Welcome resets the tracker; everything else is returned as decoded.
    pub fn decode(&mut self, frame: &[u8]) -> Result<ServerMsg, TrackError> {
        let msg = ServerMsg::decode(frame).map_err(TrackError::Decode)?;
        self.apply(msg).map_err(TrackError::Delta)
    }

    /// [`SnapshotTracker::decode`] for a message already decoded.
    pub fn apply(&mut self, msg: ServerMsg) -> Result<ServerMsg, DeltaError> {
        match msg {
            ServerMsg::Welcome { .. } => {
                self.reset();
                Ok(msg)
            }
            ServerMsg::Snapshot {
                tick,
                phase,
                ack_input,
                me,
                actors,
            } => {
                self.tick = Some(tick);
                self.phase = phase;
                self.ack_input = ack_input;
                self.me = me;
                self.actors.clear();
                self.actors.extend_from_slice(&actors);
                Ok(ServerMsg::Snapshot {
                    tick,
                    phase,
                    ack_input,
                    me,
                    actors,
                })
            }
            ServerMsg::SnapshotDelta(d) => {
                self.apply_delta(&d)?;
                Ok(self.snapshot().expect("a delta was just applied"))
            }
            other => Ok(other),
        }
    }

    fn apply_delta(&mut self, d: &SnapshotDelta) -> Result<(), DeltaError> {
        match self.tick {
            None => return Err(DeltaError::NoBase),
            Some(t) if t != d.base_tick => {
                return Err(DeltaError::BaseMismatch {
                    have: t,
                    want: d.base_tick,
                })
            }
            Some(_) => {}
        }
        let me = match (&d.me, &self.me) {
            (None, _) => None,
            (Some(s), Some(b)) => Some(s.apply(b)),
            (Some(_), None) => return Err(DeltaError::SelfWithoutBase),
        };
        let mut out = std::mem::take(&mut self.scratch);
        out.clear();
        let r = Self::merge(&self.actors, d, &mut out);
        if let Err(e) = r {
            self.scratch = out;
            return Err(e);
        }
        std::mem::swap(&mut self.actors, &mut out);
        self.scratch = out;
        self.tick = Some(d.tick);
        self.phase = d.phase;
        self.ack_input = d.ack_input;
        self.me = me;
        Ok(())
    }

    /// `base` with `d`'s changes and departures applied, into `out` (ascending by id).
    fn merge(
        base: &[WireActor],
        d: &SnapshotDelta,
        out: &mut Vec<WireActor>,
    ) -> Result<(), DeltaError> {
        let dep = &d.departed;
        let (mut bi, mut di) = (0usize, 0usize);
        // Copies (or retires) base actors below `limit`; a departed id that no base actor matches is refused.
        let flush =
            |bi: &mut usize, di: &mut usize, limit: Option<u32>, out: &mut Vec<WireActor>| {
                while *bi < base.len() && limit.is_none_or(|l| base[*bi].id < l) {
                    let a = &base[*bi];
                    if *di < dep.len() && dep[*di] < a.id {
                        return Err(DeltaError::UnknownDeparted(dep[*di]));
                    }
                    if *di < dep.len() && dep[*di] == a.id {
                        *di += 1;
                    } else {
                        out.push(*a);
                    }
                    *bi += 1;
                }
                Ok(())
            };
        for ch in &d.changed {
            flush(&mut bi, &mut di, Some(ch.q.id), out)?;
            if bi < base.len() && base[bi].id == ch.q.id {
                if di < dep.len() && dep[di] == ch.q.id {
                    return Err(DeltaError::DepartedAndChanged(ch.q.id));
                }
                out.push(ch.apply(&base[bi]));
                bi += 1;
            } else {
                if ch.mask != AD_ALL {
                    return Err(DeltaError::IncompleteNewActor(ch.q.id));
                }
                out.push(ch.q.to_wire());
            }
        }
        flush(&mut bi, &mut di, None, out)?;
        if di < dep.len() {
            return Err(DeltaError::UnknownDeparted(dep[di]));
        }
        if out.len() > MAX_ACTORS {
            return Err(DeltaError::TooManyActors(out.len()));
        }
        Ok(())
    }
}
