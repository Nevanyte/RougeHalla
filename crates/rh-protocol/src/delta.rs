//! Per-connection snapshot deltas (protocol v3, docs/adr/0010-snapshot-delta.md) with the v4 append-only varint masks
//! (docs/adr/0011-protocol-v4.md). Layout: the crate docs ([`crate`]).
//!
//! Three pieces, one per side of the socket:
//!
//! * [`SnapshotData`]: one viewer's snapshot as the room hands it to a connection: remote actors already quantized
//!   ([`QActor`]), the self at full precision, and a lower bound of its Full frame size (the exact size is computed only when
//!   needed). The room builds it once per tick from the observation ([`SnapshotData::build`], which refuses what the encoders always refused) and does not encode it.
//! * [`ConnEncoder`]: the connection's writer state. It remembers the last snapshot it wrote and encodes the next one as a
//!   Full frame (the v2 layout) or as a Delta against that base, whichever is smaller; a snapshot a slow client skipped never
//!   reaches it. Its memory is bounded by [`MAX_ACTORS`] (one base, two scratch lists).
//! * [`SnapshotTracker`]: a client's decoder. It holds the last snapshot it applied and REFUSES, with a [`DeltaError`], a delta
//!   that does not apply to it. It never clamps or repairs, and a refused delta changes nothing.
//!
//! Everything is lossless: the actors a client holds after any chain of frames equal the actors of a Full frame of the same
//! tick (quantized as always), and the self block is exact (bitwise, so -0.0 and NaN payloads survive).

use super::{
    actor_looks_bad, giver_actor_fault, head_len, head_word, id_field, kit, list, owner_combat_len,
    self_len, snapshot_fault, write_owner_combat, write_snapshot_head, Fixed, SnapshotHeader,
    MAX_ACTOR_LEN,
};
use crate::codec::{varint_len, DecodeError, EncodeError, Reader, Writer};
use crate::*;

/// Most ticks a delta's base may be behind it (a writer that skipped more sends a Full frame instead).
pub const MAX_DELTA_AGE: u32 = 64;

/// Fewest ticks between two Full frames that a resync request forced (20 ticks = 1 s at 20 Hz). A request that arrives sooner
/// is not dropped: it stays pending and the Full frame goes out when the interval ends, so a client that asks once per burst
/// of refusals always gets its Full frame, and a client that asks in a flood costs the writer one Full per interval.
pub const MIN_FORCED_FULL_TICKS: u32 = 20;

/// Delta head bits (protocol v4, append only). A varint: bits below 7 take one byte, so the fields that change nearly every
/// tick of a moving player sit there. Bit 0: a self follows (its fields are bits 1..=6 and 9..=14, data in bit order); bit 7: a
/// departed list follows the actors; bit 8: the phase changed (its byte follows the self).
pub const DH_PRESENT: u32 = 1 << 0;
pub const DH_X: u32 = 1 << 1;
pub const DH_Y: u32 = 1 << 2;
pub const DH_FACING: u32 = 1 << 3;
pub const DH_MOVE_SEQ: u32 = 1 << 4;
pub const DH_HP: u32 = 1 << 5;
pub const DH_READY: u32 = 1 << 6;
pub const DH_DEPARTED: u32 = 1 << 7;
pub const DH_PHASE: u32 = 1 << 8;
pub const DH_MAX_HP: u32 = 1 << 9;
pub const DH_KIT: u32 = 1 << 10;
pub const DH_KILLS: u32 = 1 << 11;
pub const DH_BOUNTY: u32 = 1 << 12;
pub const DH_GV: u32 = 1 << 13;
pub const DH_STATUS: u32 = 1 << 14;
/// The self field bits (a head without a self must have none of them).
pub const DH_EFFECTS: u32 = 1 << 15;
pub const DH_DISPLACE: u32 = 1 << 16;
pub const DH_SIG: u32 = 1 << 17;
pub const DH_HUNT_TARGET: u32 = 1 << 18;
pub const DH_HUNT_STACKS: u32 = 1 << 19;
pub const DH_WISH: u32 = 1 << 21;
pub const DH_BARRIER: u32 = 1 << 22;
pub const DH_SERVER_TIME: u32 = 1 << 23;
/// Owner-combat state changed; the field has a strict 0/1 availability tag.
pub const DH_OWNER_COMBAT: u32 = 1 << 24;
/// The self's hitbox archetype id changed (protocol 16): one byte after the barrier pair.
pub const DH_ARCHETYPE: u32 = 1 << 25;
pub const DH_FIELDS: u32 = 0x7e7e
    | DH_EFFECTS
    | DH_DISPLACE
    | DH_SIG
    | DH_HUNT_TARGET
    | DH_HUNT_STACKS
    | DH_WISH
    | DH_BARRIER
    | DH_ARCHETYPE;
pub const DH_KNOWN: u32 = DH_PRESENT
    | DH_FIELDS
    | DH_PHASE
    | DH_DEPARTED
    | DH_TRAINING
    | DH_SERVER_TIME
    | DH_OWNER_COMBAT;
/// Public training fact, independent of the self; present on every training delta.
pub const DH_TRAINING: u32 = 1 << 20;

/// Actor delta mask bits (append only): the fields that follow, in bit order.
pub const AD_X: u32 = 1 << 0;
pub const AD_Y: u32 = 1 << 1;
pub const AD_FACING: u32 = 1 << 2;
pub const AD_KIT: u32 = 1 << 3;
pub const AD_HP: u32 = 1 << 4;
pub const AD_BOUNTY: u32 = 1 << 5;
pub const AD_STATUS: u32 = 1 << 6;
pub const AD_KIND: u32 = 1 << 7;
/// Every field.
pub const AD_EFFECTS: u32 = 1 << 8;
pub const AD_DISPLACE: u32 = 1 << 9;
pub const AD_MOB_TYPE: u32 = 1 << 10;
pub const AD_SIG: u32 = 1 << 11;
/// Source barrier share and ring pair (protocol 12).
pub const AD_BARRIER: u32 = 1 << 12;
/// Hitbox archetype id (protocol 16). An entity's archetype never changes, so only a new actor carries it.
pub const AD_ARCHETYPE: u32 = 1 << 13;
pub const AD_ALL: u32 = 0x3fff;
/// What a new actor (one the base does not hold) must carry: its position. Every other field starts at its default.
pub const AD_NEW: u32 = AD_X | AD_Y | AD_FACING;

/// Fewest bytes a self takes after the head word (id, x y facing, a one-byte max_hp) and an actor takes in a Full frame (id, mask,
/// x y facing).
const MIN_SELF: usize = 1 + 12 + 1;
const MIN_ACTOR: usize = 1 + 1 + 6;

/// Largest self delta after the head: x, y, facing, hp, max_hp (4 each), kit, ready (2), kills, bounty, gv (3 each),
/// move_seq, status, phase, effects (2), displacement, sig.
const MAX_SELF_DELTA: usize = 20 + 1 + 2 + 9 + 1 + 1 + 1 + 2 + 1 + 1 + 5 + 3 + 56 + 5 + 1;
/// Largest delta head: tag, tick (5), age, ack (5), head (1 placeholder), the self delta, the changed count (3).
const MAX_DELTA_HEAD: usize =
    1 + 5 + 1 + 5 + 5 + MAX_SELF_DELTA + 8 + 3 + 1 + 1 + 5 + 8 + 8 + 8 + 8;
/// Largest changed-actor record: id 5, mask 2, x/y/facing 6, kit/hp, bounty 3, status/kind, effects 2, displacement/mob type/sig.
const MAX_ACTOR_DELTA: usize = 5 + 2 + 6 + 1 + 1 + 3 + 1 + 1 + 2 + 1 + 1 + 1 + 2 + 1;

fn optional_f64_bits_equal(a: Option<f64>, b: Option<f64>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => a.to_bits() == b.to_bits(),
        _ => false,
    }
}

fn wish_bits_equal(a: Option<WireWishOwner>, b: Option<WireWishOwner>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => {
            a.ability == b.ability
                && a.ready_at.to_bits() == b.ready_at.to_bits()
                && optional_f64_bits_equal(a.full_at, b.full_at)
                && a.max_charges == b.max_charges
                && a.recharge_ms.to_bits() == b.recharge_ms.to_bits()
                && a.charges == b.charges
                && optional_f64_bits_equal(a.next_charge_at, b.next_charge_at)
                && match (a.cast, b.cast) {
                    (None, None) => true,
                    (Some(a), Some(b)) => {
                        a.ability == b.ability
                            && a.started_at.to_bits() == b.started_at.to_bits()
                            && a.lands_at.to_bits() == b.lands_at.to_bits()
                    }
                    _ => false,
                }
        }
        _ => false,
    }
}

/// A remote actor as a connection remembers and sends it: exactly what the wire carries.
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
    /// What the entity is (0 = player).
    pub kind: u8,
    pub effects: u16,
    pub displace_seq: u8,
    pub sig: u8,
    pub mob_type_code: u8,
    pub barrier_pct: u8,
    pub barrier_ring_step: u8,
    pub archetype: u8,
}

impl QActor {
    /// The actor a delta's new entry starts from: every optional field at its default (position zero; a new entry carries it).
    pub const NEW: QActor = QActor {
        id: 0,
        x: 0,
        y: 0,
        facing: 0,
        kit: 0,
        hp_pct: DEFAULT_HP_PCT,
        status: DEFAULT_STATUS,
        bounty: 0,
        kind: 0,
        effects: 0,
        displace_seq: 0,
        mob_type_code: 0,
        sig: 0,
        barrier_pct: 0,
        barrier_ring_step: 0,
        archetype: 0,
    };

    /// `a` checked and quantized: the first reason a decoder would reject the actor on its own (a faction, weapon or status over
    /// its bit width, an `hp_pct` over 100, a position off the wire grid), or the actor as it goes over the wire. The check is
    /// per actor, so a result can be reused wherever the same actor is shown; the ascending order of ids belongs to a list and
    /// is checked by [`SnapshotData::build_checked`].
    #[inline]
    pub fn checked(a: &WireActor) -> Result<Self, &'static str> {
        if actor_looks_bad(a, None) {
            return Err(snapshot_fault(0, None, std::slice::from_ref(a)).unwrap_or("actor"));
        }
        Ok(Self::from_wire(a))
    }

    /// `a` as it goes over the wire (the caller has checked it: [`QActor::checked`] does).
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
            kind: a.kind,
            effects: a.effects,
            displace_seq: a.displace_seq,
            mob_type_code: a.mob_type_code,
            sig: a.sig,
            barrier_pct: a.barrier_pct,
            barrier_ring_step: a.barrier_ring_step,
            archetype: a.archetype,
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
            kind: self.kind,
            effects: self.effects,
            displace_seq: self.displace_seq,
            mob_type_code: self.mob_type_code,
            sig: self.sig,
            barrier_pct: self.barrier_pct,
            barrier_ring_step: self.barrier_ring_step,
            archetype: self.archetype,
        }
    }

    /// The Full actor mask: a bit per field that differs from its default.
    #[inline]
    fn full_mask(&self) -> u32 {
        let mut m = 0;
        if self.kit != 0 {
            m |= AM_KIT;
        }
        if self.hp_pct != DEFAULT_HP_PCT {
            m |= AM_HP;
        }
        if self.status != DEFAULT_STATUS {
            m |= AM_STATUS;
        }
        if self.bounty != 0 {
            m |= AM_BOUNTY;
        }
        if self.kind != 0 {
            m |= AM_KIND;
        }
        if self.effects != 0 {
            m |= AM_EFFECTS;
        }
        if self.displace_seq != 0 {
            m |= AM_DISPLACE;
        }
        if self.mob_type_code != 0 {
            m |= AM_MOB_TYPE;
        }
        if self.sig != 0 {
            m |= AM_SIG;
        }
        if self.barrier_pct != 0 || self.barrier_ring_step != 0 {
            m |= AM_BARRIER;
        }
        if self.archetype != 0 {
            m |= AM_ARCHETYPE;
        }
        m
    }

    /// Bytes this actor takes in a Full frame after `prev` (the previous actor's id).
    #[inline]
    fn full_len(&self, prev: Option<u32>) -> usize {
        varint_len(id_field(self.id, prev))
            + 6
            + varint_len(self.full_mask())
            + (self.kit != 0) as usize
            + (self.hp_pct != DEFAULT_HP_PCT) as usize
            + (self.status != DEFAULT_STATUS) as usize
            + if self.bounty != 0 {
                varint_len(self.bounty as u32)
            } else {
                0
            }
            + (self.kind != 0) as usize
            + 2 * (self.effects != 0) as usize
            + (self.displace_seq != 0) as usize
            + (self.mob_type_code != 0) as usize
            + (self.sig != 0) as usize
            + 2 * (self.barrier_pct != 0 || self.barrier_ring_step != 0) as usize
            + (self.archetype != 0) as usize
    }
}

/// One v2 actor record from a [`QActor`] (the same bytes as `write_actor` writes for the [`WireActor`] it came from).
#[inline(always)]
fn write_full_actor(out: &mut Writer, q: &QActor, prev: Option<u32>) {
    let m = q.full_mask();
    let mut w = Fixed::<MAX_ACTOR_LEN>::new();
    w.varint(id_field(q.id, prev));
    w.varint(m);
    w.u16(q.x);
    w.u16(q.y);
    w.u16(q.facing);
    if m & AM_KIT != 0 {
        w.u8(q.kit);
    }
    if m & AM_HP != 0 {
        w.u8(q.hp_pct);
    }
    if m & AM_STATUS != 0 {
        w.u8(q.status);
    }
    if m & AM_BOUNTY != 0 {
        w.varint(q.bounty as u32);
    }
    if m & AM_KIND != 0 {
        w.u8(q.kind);
    }
    if m & AM_EFFECTS != 0 {
        w.u16(q.effects);
    }
    if m & AM_DISPLACE != 0 {
        w.u8(q.displace_seq);
    }
    if m & AM_MOB_TYPE != 0 {
        w.u8(q.mob_type_code);
    }
    if m & AM_SIG != 0 {
        w.u8(q.sig);
    }
    if m & AM_BARRIER != 0 {
        w.u8(q.barrier_pct);
        w.u8(q.barrier_ring_step);
    }
    if m & AM_ARCHETYPE != 0 {
        w.u8(q.archetype);
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
    server_time: f64,
    phase: u8,
    ack_input: u32,
    me: Option<WireSelf>,
    actors: Vec<QActor>,
    /// Protocol 11: the source's public training fact (head bit 16 on a Full frame, bit 18 on a delta).
    training: bool,
    owner_combat: Option<WireOwnerCombat>,
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
    /// ids that do not strictly ascend, or an iterator whose length lies.
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
        Self::build_with_server_time(tick, snapshot_server_ms(tick), phase, ack_input, me, actors)
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
        Self::build_checked_with_server_time(
            spare,
            tick,
            snapshot_server_ms(tick),
            phase,
            ack_input,
            me,
            actors.map(|a| QActor::checked(&a)),
        )
    }

    /// Builds a snapshot with an explicit logical source clock. Ordinary frames should use [`SnapshotData::build`].
    pub fn build_with_server_time<I>(
        tick: u32,
        server_time: f64,
        phase: u8,
        ack_input: u32,
        me: Option<WireSelf>,
        actors: I,
    ) -> Result<Self, EncodeError>
    where
        I: ExactSizeIterator<Item = WireActor>,
    {
        Self::build_checked_with_server_time(
            None,
            tick,
            server_time,
            phase,
            ack_input,
            me,
            actors.map(|a| QActor::checked(&a)),
        )
    }

    /// [`SnapshotData::build_with`] from actors already checked and quantized one by one ([`QActor::checked`]): a caller that
    /// shows the same actor to several viewers does that work once and passes the result to each. Every refusal of
    /// [`SnapshotData::build_with`] is made here: the list limit, the head, the first faulty actor (an `Err` item, reported in
    /// list order), ids that do not strictly ascend, and an iterator whose length lies.
    pub fn build_checked<I>(
        spare: Option<SnapshotData>,
        tick: u32,
        phase: u8,
        ack_input: u32,
        me: Option<WireSelf>,
        actors: I,
    ) -> Result<Self, EncodeError>
    where
        I: ExactSizeIterator<Item = Result<QActor, &'static str>>,
    {
        Self::build_checked_with_server_time(
            spare,
            tick,
            snapshot_server_ms(tick),
            phase,
            ack_input,
            me,
            actors,
        )
    }

    /// Reuses a previous snapshot allocation and records this frame's explicit source clock.
    pub fn build_checked_with_server_time<I>(
        spare: Option<SnapshotData>,
        tick: u32,
        server_time: f64,
        phase: u8,
        ack_input: u32,
        me: Option<WireSelf>,
        actors: I,
    ) -> Result<Self, EncodeError>
    where
        I: ExactSizeIterator<Item = Result<QActor, &'static str>>,
    {
        if !server_time.is_finite() || server_time < 0.0 {
            return Err(EncodeError::BadValue("server time"));
        }
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
            let q = a.map_err(EncodeError::BadValue)?;
            if prev.is_some_and(|p| q.id <= p) {
                return Err(EncodeError::BadValue("actor order"));
            }
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
            + head_len(head_word(
                phase,
                tick,
                server_time,
                me.as_ref(),
                false,
                false,
            ))
            + (server_time.to_bits() != snapshot_server_ms(tick).to_bits()) as usize * 8
            + varint_len(declared as u32)
            + me.as_ref().map_or(0, |_| MIN_SELF)
            + MIN_ACTOR * declared) as u32;
        b.tick = tick;
        b.server_time = server_time;
        b.phase = phase;
        b.ack_input = ack_input;
        b.me = me;
        b.training = false;
        b.owner_combat = None;
        Ok(SnapshotData(b))
    }

    /// Sets the Full-frame owner-combat group after actor construction, validating references against this exact actor list.
    pub fn set_owner_combat(
        &mut self,
        owner_combat: Option<WireOwnerCombat>,
    ) -> Result<(), EncodeError> {
        if owner_combat_fault(owner_combat.as_ref(), self.me.is_some(), |id| {
            self.actors.binary_search_by_key(&id, |a| a.id).is_ok()
        })
        .is_some()
        {
            return Err(EncodeError::BadValue("owner combat"));
        }
        self.0.owner_combat = owner_combat;
        self.refresh_min_len();
        Ok(())
    }

    fn refresh_min_len(&mut self) {
        let head = head_word(
            self.phase,
            self.tick,
            self.server_time,
            self.me.as_ref(),
            self.training,
            self.owner_combat.is_some(),
        );
        self.0.min_len =
            (1 + varint_len(self.tick)
                + varint_len(self.ack_input)
                + head_len(head)
                + (head & HM_SERVER_TIME != 0) as usize * 8
                + varint_len(self.actors.len() as u32)
                + self.me.as_ref().map_or(0, |_| MIN_SELF)
                + MIN_ACTOR * self.actors.len()
                + self.owner_combat.as_ref().map_or(0, owner_combat_len)) as u32;
    }

    pub fn owner_combat(&self) -> Option<WireOwnerCombat> {
        self.owner_combat
    }

    pub fn tick(&self) -> u32 {
        self.tick
    }
    pub fn server_time(&self) -> f64 {
        self.server_time
    }
    pub fn phase(&self) -> u8 {
        self.phase
    }
    pub fn ack_input(&self) -> u32 {
        self.ack_input
    }
    /// The source's public training fact (protocol 8).
    pub fn training(&self) -> bool {
        self.training
    }
    /// Marks this snapshot as the view of a training world: the wire writes the training head bit (bit 16 on a Full frame,
    /// bit 20 on a delta). Absent for every ordinary match, so those frames stay byte-identical to v7 apart from the
    /// version number.
    pub fn set_training(&mut self, training: bool) {
        if self.training == training {
            return;
        }
        self.0.training = training;
        self.refresh_min_len();
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
        let head = head_word(
            self.phase,
            self.tick,
            self.server_time,
            self.me.as_ref(),
            self.training,
            self.owner_combat.is_some(),
        );
        let mut n = 1
            + varint_len(self.tick)
            + varint_len(self.ack_input)
            + head_len(head)
            + self.me.as_ref().map_or(0, |s| self_len(s, head))
            + (head & HM_SERVER_TIME != 0) as usize * 8
            + varint_len(self.actors.len() as u32);
        let mut prev = None;
        for q in &self.actors {
            n += q.full_len(prev);
            prev = Some(q.id);
        }
        n += self.owner_combat.as_ref().map_or(0, owner_combat_len);
        n
    }

    /// A capacity to build this snapshot's frame in without growing (what [`ConnEncoder::encode_frame`] reserves): its least Full size plus room for the stack records a delta
    /// is assembled from (they are copied whole, then trimmed).
    pub fn frame_capacity(&self) -> usize {
        self.min_len() + MAX_DELTA_HEAD + MAX_ACTOR_DELTA
    }

    /// A lower bound of [`SnapshotData::full_len`] in constant time: the fewest bytes the head, the self and the actors take.
    #[inline]
    pub fn min_len(&self) -> usize {
        self.min_len as usize
    }

    /// Appends this snapshot as a Full frame: the same bytes `ServerMsg::Snapshot` encodes to for
    /// [`SnapshotData::decoded`].
    pub fn encode_full_into(&self, out: &mut Vec<u8>) -> usize {
        let start = out.len();
        let mut w = Writer::from_vec(std::mem::take(out));
        w.reserve(self.min_len());
        write_snapshot_head(
            &mut w,
            SnapshotHeader {
                tick: self.tick,
                server_time: self.server_time,
                phase: self.phase,
                ack_input: self.ack_input,
                me: self.me.as_ref(),
                training: self.training,
                actors: self.actors.len(),
                owner_combat: self.owner_combat.is_some(),
            },
        );
        let mut prev = None;
        for q in &self.actors {
            write_full_actor(&mut w, q, prev);
            prev = Some(q.id);
        }
        if let Some(owner) = &self.owner_combat {
            write_owner_combat(&mut w, owner);
        }
        *out = w.finish();
        debug_assert_eq!(out.len() - start, self.full_len());
        out.len() - start
    }

    /// What a client decodes this snapshot to (a Full frame or a chain of deltas ending here).
    pub fn decoded(&self) -> ServerMsg {
        ServerMsg::Snapshot {
            tick: self.tick,
            server_time: self.server_time,
            phase: self.phase,
            ack_input: self.ack_input,
            me: self.me,
            actors: self.actors.iter().map(QActor::to_wire).collect(),
            training: self.training,
            owner_combat: self.owner_combat,
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
    /// A resync was requested and not yet answered: the next snapshot is Full once [`MIN_FORCED_FULL_TICKS`] have passed since
    /// the last forced one (until then deltas continue and the request stays pending).
    force_full: bool,
    /// The tick of the last Full frame that answered a resync request.
    last_forced: Option<u32>,
    departed: Vec<u32>,
    /// The base before the current one, free to build the next snapshot in ([`ConnEncoder::take_spare`]).
    spare: Option<SnapshotData>,
    /// The buffer [`ConnEncoder::encode_frame`] assembles a frame in before copying it to its exact size.
    scratch: Vec<u8>,
}

/// Largest scratch buffer a [`ConnEncoder`] keeps between frames: a bigger one (a Full frame of a crowd) is freed once it has
/// been copied out, so a connection holds no more than this beyond its snapshots.
const SCRATCH_KEEP: usize = 2048;

impl ConnEncoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// A client asked to resync: the next snapshot is a Full frame, or the first one at least [`MIN_FORCED_FULL_TICKS`] after the
    /// last forced Full (the request is kept, never dropped). Asking again while it is pending changes nothing.
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
            + self.scratch.capacity()
    }

    /// The snapshot the base replaced, finished with: pass it to [`SnapshotData::build_with`] for the next snapshot, so the
    /// steady state never allocates one. `None` until the base has been replaced once.
    pub fn take_spare(&mut self) -> Option<SnapshotData> {
        self.spare.take()
    }

    /// Whether a pending resync request is to be answered with `cur` (it is pending and the interval since the last forced Full
    /// has passed).
    fn forced_full_due(&self, cur: &SnapshotData) -> bool {
        self.force_full
            && self
                .last_forced
                .is_none_or(|t| cur.tick.wrapping_sub(t) >= MIN_FORCED_FULL_TICKS)
    }

    /// Whether `cur` may be sent as a delta against the base; `forced` is [`ConnEncoder::forced_full_due`].
    fn delta_possible(&self, cur: &SnapshotData, forced: bool) -> bool {
        let Some(b) = &self.base else { return false };
        if forced || cur.tick <= b.tick || cur.tick - b.tick > MAX_DELTA_AGE {
            return false;
        }
        match (&b.me, &cur.me) {
            (_, None) => true,
            (Some(bm), Some(cm)) => bm.id == cm.id,
            (None, Some(_)) => false,
        }
    }

    /// The frame for `snap` in one allocation of exactly its size (what the socket writer owns until it is sent), and its kind.
    /// The frame is assembled in a buffer this encoder keeps between calls and copied out, so the only allocation per frame is
    /// the frame itself: assembled in a fresh buffer, a 13-byte delta would sit in a block sized for the worst case (the stack
    /// records are copied whole before they are trimmed). Otherwise exactly [`ConnEncoder::encode`].
    pub fn encode_frame(&mut self, snap: SnapshotData) -> (Vec<u8>, FrameKind) {
        let mut scratch = std::mem::take(&mut self.scratch);
        scratch.clear();
        scratch.reserve(snap.frame_capacity());
        let kind = self.encode(snap, &mut scratch);
        let frame = scratch.clone();
        if scratch.capacity() <= SCRATCH_KEEP {
            self.scratch = scratch;
        }
        (frame, kind)
    }

    /// Appends the frame for `snap` to `out` and makes `snap` the base of the next one: a Delta when that is possible and
    /// smaller than the Full frame, else a Full frame.
    pub fn encode(&mut self, snap: SnapshotData, out: &mut Vec<u8>) -> FrameKind {
        let start = out.len();
        let mut kind = FrameKind::Full;
        let forced = self.forced_full_due(&snap);
        if self.delta_possible(&snap, forced) {
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
        if kind == FrameKind::Full {
            // Any Full frame answers a pending request (the client holds a snapshot it can apply deltas to again).
            self.force_full = false;
            if forced {
                self.last_forced = Some(snap.tick);
            }
        }
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

/// The mask of the fields of `q` that differ from `p` (the same actor in the base), bits as [`AD_X`]...
#[inline]
fn actor_delta_mask(p: &QActor, q: &QActor) -> u32 {
    (p.x != q.x) as u32
        | ((p.y != q.y) as u32) << 1
        | ((p.facing != q.facing) as u32) << 2
        | ((p.kit != q.kit) as u32) << 3
        | ((p.hp_pct != q.hp_pct) as u32) << 4
        | ((p.bounty != q.bounty) as u32) << 5
        | ((p.status != q.status) as u32) << 6
        | ((p.kind != q.kind) as u32) << 7
        | ((p.effects != q.effects) as u32) << 8
        | ((p.displace_seq != q.displace_seq) as u32) << 9
        | ((p.mob_type_code != q.mob_type_code) as u32) << 10
        | ((p.sig != q.sig) as u32) << 11
        | ((p.barrier_pct != q.barrier_pct || p.barrier_ring_step != q.barrier_ring_step) as u32)
            << 12
        | ((p.archetype != q.archetype) as u32) << 13
}

/// The mask of a NEW actor: its position, and every other field that is not the default.
#[inline]
fn new_actor_mask(q: &QActor) -> u32 {
    AD_NEW | actor_delta_mask(&QActor::NEW, q)
}

/// Appends the delta of `cur` against `base` to `out` (the caller has checked [`ConnEncoder::delta_possible`]'s conditions).
/// One pass: the head and the changed count are written as one-byte placeholders that are patched once the actors have been
/// walked (the head is one byte unless a bit from 7 up is set; the count is one byte unless 128 or more actors changed), and
/// each changed actor is appended as it is found.
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
    f.u8(0);
    let mut head = 0u32;
    if cur.training {
        head |= DH_TRAINING;
    }
    if let (Some(bm), Some(cm)) = (&base.me, &cur.me) {
        head |= DH_PRESENT | write_self_delta(&mut f, bm, cm);
    }
    if cur.phase != base.phase {
        head |= DH_PHASE;
        f.u8(cur.phase);
    }
    if cur.server_time.to_bits() != snapshot_server_ms(cur.tick).to_bits() {
        head |= DH_SERVER_TIME;
        f.bytes(cur.server_time.to_le_bytes());
    }
    let owner_combat = owner_combat_delta(base, cur);
    if owner_combat.is_some() {
        head |= DH_OWNER_COMBAT;
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
        let mask = if i < b.len() && b[i].id == q.id {
            let m = actor_delta_mask(&b[i], q);
            i += 1;
            if m == 0 {
                continue;
            }
            m
        } else {
            new_actor_mask(q)
        };
        let mut w = Fixed::<MAX_ACTOR_DELTA>::new();
        w.varint(if changed == 0 { q.id } else { q.id - last });
        w.varint(mask);
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
        if mask & AD_STATUS != 0 {
            w.u8(q.status);
        }
        if mask & AD_KIND != 0 {
            w.u8(q.kind);
        }
        if mask & AD_EFFECTS != 0 {
            w.u16(q.effects);
        }
        if mask & AD_DISPLACE != 0 {
            w.u8(q.displace_seq);
        }
        if mask & AD_MOB_TYPE != 0 {
            w.u8(q.mob_type_code);
        }
        if mask & AD_SIG != 0 {
            w.u8(q.sig);
        }
        if mask & AD_BARRIER != 0 {
            w.u8(q.barrier_pct);
            w.u8(q.barrier_ring_step);
        }
        if mask & AD_ARCHETYPE != 0 {
            w.u8(q.archetype);
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
    if let Some(owner) = owner_combat {
        let mut w = Writer::from_vec(std::mem::take(out));
        match owner {
            None => w.u8(0),
            Some(owner) => {
                w.u8(1);
                write_owner_combat(&mut w, &owner);
            }
        }
        *out = w.finish();
    }
    // The count sits after the head, so it is patched first (a widening there does not move the head).
    if changed < 0x80 {
        out[start + count_at] = changed as u8;
    } else {
        // 128 or more changed actors: the count is a two-byte varint (at most 512).
        let v = [(changed as u8) | 0x80, (changed >> 7) as u8];
        out.splice(start + count_at..start + count_at + 1, v);
    }
    if head < 0x80 {
        out[start + head_at] = head as u8;
    } else {
        // Protocol 14 adds head bits through 24, so the canonical head can be four bytes.
        let mut v = [0u8; 4];
        let n = varint_len(head);
        for (k, b) in v[..n].iter_mut().enumerate() {
            *b = (head >> (7 * k)) as u8 & 0x7f | if k + 1 < n { 0x80 } else { 0 };
        }
        out.splice(start + head_at..start + head_at + 1, v[..n].iter().copied());
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
fn write_self_delta(f: &mut Fixed<MAX_DELTA_HEAD>, b: &WireSelf, c: &WireSelf) -> u32 {
    let mut m = 0u32;
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
    if c.move_seq != b.move_seq {
        m |= DH_MOVE_SEQ;
        f.u8(c.move_seq);
    }
    if c.hp.to_bits() != b.hp.to_bits() {
        m |= DH_HP;
        f.f32(c.hp);
    }
    if c.ready_in_ms != b.ready_in_ms {
        m |= DH_READY;
        f.u16(c.ready_in_ms);
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
    if c.status != b.status {
        m |= DH_STATUS;
        f.u8(c.status);
    }
    if c.effects != b.effects {
        m |= DH_EFFECTS;
        f.u16(c.effects);
    }
    if c.displace_seq != b.displace_seq {
        m |= DH_DISPLACE;
        f.u8(c.displace_seq);
    }
    if c.sig != b.sig {
        m |= DH_SIG;
        f.u8(c.sig);
    }
    if c.hunt_target != b.hunt_target {
        m |= DH_HUNT_TARGET;
        f.varint(c.hunt_target.unwrap_or(0));
    }
    if c.hunt_stacks != b.hunt_stacks {
        m |= DH_HUNT_STACKS;
        f.varint(c.hunt_stacks as u32);
    }
    if !wish_bits_equal(b.wish, c.wish) {
        m |= DH_WISH;
        match c.wish {
            None => f.u8(0),
            Some(wish) => {
                f.u8(1);
                super::write_wish_owner(f, &wish);
            }
        }
    }
    if c.barrier.to_bits() != b.barrier.to_bits() || c.barrier_ring_step != b.barrier_ring_step {
        m |= DH_BARRIER;
        f.f32(c.barrier);
        f.u8(c.barrier_ring_step);
    }
    if c.archetype != b.archetype {
        m |= DH_ARCHETYPE;
        f.u8(c.archetype);
    }
    m
}

/// The changed self fields of a delta: `mask` has the head's self field bits (never the present, phase or departed bits); only
/// the fields whose bit is set mean anything (the others are zero).
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct SelfDelta {
    pub mask: u32,
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
    pub effects: u16,
    pub displace_seq: u8,
    pub sig: u8,
    pub hunt_target: Option<u32>,
    pub hunt_stacks: u16,
    /// `Some(None)` clears the owner's Wish record; `None` means this group did not change.
    pub wish: Option<Option<WireWishOwner>>,
    pub barrier: f32,
    pub barrier_ring_step: u8,
    pub archetype: u8,
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
        if m & DH_EFFECTS != 0 {
            s.effects = self.effects;
        }
        if m & DH_DISPLACE != 0 {
            s.displace_seq = self.displace_seq;
        }
        if m & DH_SIG != 0 {
            s.sig = self.sig;
        }
        if m & DH_HUNT_TARGET != 0 {
            s.hunt_target = self.hunt_target;
        }
        if m & DH_HUNT_STACKS != 0 {
            s.hunt_stacks = self.hunt_stacks;
        }
        if m & DH_WISH != 0 {
            if let Some(wish) = self.wish {
                s.wish = wish;
            }
        }
        if m & DH_BARRIER != 0 {
            s.barrier = self.barrier;
            s.barrier_ring_step = self.barrier_ring_step;
        }
        if m & DH_ARCHETYPE != 0 {
            s.archetype = self.archetype;
        }
        s
    }

    /// The delta that turns `b` into `c` (their ids must be equal; the id is not carried).
    pub fn between(b: &WireSelf, c: &WireSelf) -> SelfDelta {
        let mut f = Fixed::<MAX_DELTA_HEAD>::new();
        let mask = write_self_delta(&mut f, b, c);
        // Only the fields in the mask mean anything (the others are zero, as a decoder reads them back).
        let keep = |bit: u32| mask & bit != 0;
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
            effects: if keep(DH_EFFECTS) { c.effects } else { 0 },
            displace_seq: if keep(DH_DISPLACE) { c.displace_seq } else { 0 },
            sig: if keep(DH_SIG) { c.sig } else { 0 },
            hunt_target: if keep(DH_HUNT_TARGET) {
                c.hunt_target
            } else {
                None
            },
            hunt_stacks: if keep(DH_HUNT_STACKS) {
                c.hunt_stacks
            } else {
                0
            },
            wish: if keep(DH_WISH) { Some(c.wish) } else { None },
            barrier: if keep(DH_BARRIER) { c.barrier } else { 0.0 },
            barrier_ring_step: if keep(DH_BARRIER) {
                c.barrier_ring_step
            } else {
                0
            },
            archetype: if keep(DH_ARCHETYPE) { c.archetype } else { 0 },
        }
    }
}

/// One changed remote actor of a delta: `mask` (bits [`AD_X`]..[`AD_KIND`]) says which fields of `q` are carried; the others
/// are zero and mean nothing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ActorDelta {
    pub mask: u32,
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
        if self.mask & AD_STATUS != 0 {
            a.status = self.q.status;
        }
        if self.mask & AD_KIND != 0 {
            a.kind = self.q.kind;
        }
        if self.mask & AD_EFFECTS != 0 {
            a.effects = self.q.effects;
        }
        if self.mask & AD_DISPLACE != 0 {
            a.displace_seq = self.q.displace_seq;
        }
        if self.mask & AD_MOB_TYPE != 0 {
            a.mob_type_code = self.q.mob_type_code;
        }
        if self.mask & AD_SIG != 0 {
            a.sig = self.q.sig;
        }
        if self.mask & AD_BARRIER != 0 {
            a.barrier_pct = self.q.barrier_pct;
            a.barrier_ring_step = self.q.barrier_ring_step;
        }
        if self.mask & AD_ARCHETYPE != 0 {
            a.archetype = self.q.archetype;
        }
        a
    }
}

/// A snapshot delta frame, as decoded (syntax checked; whether it applies is [`SnapshotTracker`]'s question).
#[derive(Clone, Debug, PartialEq)]
pub struct SnapshotDelta {
    pub tick: u32,
    /// This frame's absolute source clock; absent wire override decodes to `tick * 50`, never the base clock.
    pub server_time: f64,
    /// Protocol 11: the source's public training fact (delta head bit 20; static per connection).
    pub training: bool,
    /// The tick of the snapshot this one is relative to (`tick - base_age`, 1..=[`MAX_DELTA_AGE`] behind).
    pub base_tick: u32,
    /// `Some` when the phase differs from the base's.
    pub phase: Option<u8>,
    pub ack_input: u32,
    /// `Some` when the frame has a self (the base must have one too); the id is the base's.
    pub me: Option<SelfDelta>,
    /// Ascending by id; a new actor carries at least its position ([`AD_NEW`]), the rest starts at the defaults.
    pub changed: Vec<ActorDelta>,
    /// Ascending ids that were in the base and are gone.
    pub departed: Vec<u32>,
    /// `None` retains the group for a continuing owner; `Some(None)` explicitly marks it unavailable.
    pub owner_combat: Option<Option<WireOwnerCombat>>,
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
                let mask = actor_delta_mask(&b[i], q);
                if mask != 0 {
                    changed.push(ActorDelta {
                        mask,
                        q: mask_fields(q, mask),
                    });
                }
            }
            Err(_) => {
                let mask = new_actor_mask(q);
                changed.push(ActorDelta {
                    mask,
                    q: mask_fields(q, mask),
                })
            }
        }
    }
    let departed = b
        .iter()
        .filter(|p| c.binary_search_by_key(&p.id, |q| q.id).is_err())
        .map(|p| p.id)
        .collect();
    let owner_combat = owner_combat_delta(base, cur);
    Some(SnapshotDelta {
        tick: cur.tick,
        server_time: cur.server_time,
        training: cur.training,
        base_tick: base.tick,
        phase: (cur.phase != base.phase).then_some(cur.phase),
        ack_input: cur.ack_input,
        me,
        changed,
        departed,
        owner_combat,
    })
}

fn owner_combat_bits_equal(a: Option<WireOwnerCombat>, b: Option<WireOwnerCombat>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => {
            a.lock == b.lock
                && a.draw_started_at == b.draw_started_at
                && a.ready_at == b.ready_at
                && a.as_milli.to_bits() == b.as_milli.to_bits()
                && a.windup_milli.to_bits() == b.windup_milli.to_bits()
                && a.speed_milli.to_bits() == b.speed_milli.to_bits()
        }
        _ => false,
    }
}

fn owner_combat_delta(base: &SnapshotData, cur: &SnapshotData) -> Option<Option<WireOwnerCombat>> {
    // Owner loss clears retained owner-only state without spending a redundant option byte.
    cur.me.as_ref()?;
    if !owner_combat_bits_equal(base.owner_combat, cur.owner_combat) {
        return Some(cur.owner_combat);
    }
    let npc_refs_changed = base
        .actors
        .iter()
        .filter(|actor| actor.kind != 0)
        .map(|actor| actor.id)
        .ne(cur
            .actors
            .iter()
            .filter(|actor| actor.kind != 0)
            .map(|actor| actor.id));
    (npc_refs_changed && cur.owner_combat.is_some()).then_some(cur.owner_combat)
}

/// `q` with the fields outside `mask` zeroed (what a decoder reads back).
fn mask_fields(q: &QActor, mask: u32) -> QActor {
    QActor {
        id: q.id,
        x: if mask & AD_X != 0 { q.x } else { 0 },
        y: if mask & AD_Y != 0 { q.y } else { 0 },
        facing: if mask & AD_FACING != 0 { q.facing } else { 0 },
        kit: if mask & AD_KIT != 0 { q.kit } else { 0 },
        hp_pct: if mask & AD_HP != 0 { q.hp_pct } else { 0 },
        status: if mask & AD_STATUS != 0 { q.status } else { 0 },
        bounty: if mask & AD_BOUNTY != 0 { q.bounty } else { 0 },
        kind: if mask & AD_KIND != 0 { q.kind } else { 0 },
        effects: if mask & AD_EFFECTS != 0 { q.effects } else { 0 },
        displace_seq: if mask & AD_DISPLACE != 0 {
            q.displace_seq
        } else {
            0
        },
        mob_type_code: if mask & AD_MOB_TYPE != 0 {
            q.mob_type_code
        } else {
            0
        },
        sig: if mask & AD_SIG != 0 { q.sig } else { 0 },
        barrier_pct: if mask & AD_BARRIER != 0 {
            q.barrier_pct
        } else {
            0
        },
        barrier_ring_step: if mask & AD_BARRIER != 0 {
            q.barrier_ring_step
        } else {
            0
        },
        archetype: if mask & AD_ARCHETYPE != 0 {
            q.archetype
        } else {
            0
        },
    }
}

/// The delta message as bytes (the reference writer behind `ServerMsg::SnapshotDelta`).
pub(crate) fn write_message(w: &mut Writer, d: &SnapshotDelta) {
    w.u8(T_SNAPSHOT_DELTA);
    w.varint(d.tick);
    w.varint(d.tick.wrapping_sub(d.base_tick));
    w.varint(d.ack_input);
    let mut head = 0u32;
    if d.training {
        head |= DH_TRAINING;
    }
    if let Some(s) = &d.me {
        head |= DH_PRESENT | (s.mask & DH_FIELDS);
    }
    if d.phase.is_some() {
        head |= DH_PHASE;
    }
    if !d.departed.is_empty() {
        head |= DH_DEPARTED;
    }
    if d.owner_combat.is_some() {
        head |= DH_OWNER_COMBAT;
    }
    if d.server_time.to_bits() != snapshot_server_ms(d.tick).to_bits() {
        head |= DH_SERVER_TIME;
    }
    w.varint(head);
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
        if m & DH_MOVE_SEQ != 0 {
            w.u8(s.move_seq);
        }
        if m & DH_HP != 0 {
            w.f32(s.hp);
        }
        if m & DH_READY != 0 {
            w.u16(s.ready_in_ms);
        }
        if m & DH_MAX_HP != 0 {
            w.f32(s.max_hp);
        }
        if m & DH_KIT != 0 {
            w.u8(s.kit);
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
        if m & DH_STATUS != 0 {
            w.u8(s.status);
        }
        if m & DH_EFFECTS != 0 {
            w.u16(s.effects);
        }
        if m & DH_DISPLACE != 0 {
            w.u8(s.displace_seq);
        }
        if m & DH_SIG != 0 {
            w.u8(s.sig);
        }
        if m & DH_HUNT_TARGET != 0 {
            w.varint(s.hunt_target.unwrap_or(0));
        }
        if m & DH_HUNT_STACKS != 0 {
            w.varint(s.hunt_stacks as u32);
        }
        if m & DH_WISH != 0 {
            match s.wish {
                Some(Some(wish)) => {
                    w.u8(1);
                    super::write_wish_owner_writer(w, &wish);
                }
                Some(None) => w.u8(0),
                None => unreachable!("Wish bit has an explicit option"),
            }
        }
        if m & DH_BARRIER != 0 {
            w.f32(s.barrier);
            w.u8(s.barrier_ring_step);
        }
        if m & DH_ARCHETYPE != 0 {
            w.u8(s.archetype);
        }
    }
    if let Some(p) = d.phase {
        w.u8(p);
    }
    if head & DH_SERVER_TIME != 0 {
        w.f64(d.server_time);
    }
    w.varint(d.changed.len() as u32);
    let mut prev: Option<u32> = None;
    for a in &d.changed {
        w.varint(id_field(a.q.id, prev));
        prev = Some(a.q.id);
        w.varint(a.mask & AD_ALL);
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
        if a.mask & AD_STATUS != 0 {
            w.u8(a.q.status);
        }
        if a.mask & AD_KIND != 0 {
            w.u8(a.q.kind);
        }
        if a.mask & AD_EFFECTS != 0 {
            w.u16(a.q.effects);
        }
        if a.mask & AD_DISPLACE != 0 {
            w.u8(a.q.displace_seq);
        }
        if a.mask & AD_MOB_TYPE != 0 {
            w.u8(a.q.mob_type_code);
        }
        if a.mask & AD_SIG != 0 {
            w.u8(a.q.sig);
        }
        if a.mask & AD_BARRIER != 0 {
            w.u8(a.q.barrier_pct);
            w.u8(a.q.barrier_ring_step);
        }
        if a.mask & AD_ARCHETYPE != 0 {
            w.u8(a.q.archetype);
        }
    }
    if !d.departed.is_empty() {
        write_departed(w, &d.departed);
    }
    if let Some(owner) = d.owner_combat {
        match owner {
            None => w.u8(0),
            Some(owner) => {
                w.u8(1);
                write_owner_combat(w, &owner);
            }
        }
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
    if !d.server_time.is_finite() || d.server_time < 0.0 {
        return bad("server time");
    }
    if d.phase.is_some_and(|p| p > MAX_PHASE_CODE) {
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
        if s.mask & DH_HUNT_TARGET != 0 && s.hunt_target == Some(0) {
            return bad("hunt target");
        }
        if s.mask & DH_STATUS != 0 && s.status > MAX_STATUS_CODE {
            return bad("status");
        }
        if (s.mask & DH_WISH != 0) != s.wish.is_some() {
            return bad("wish");
        }
        if s.wish
            .flatten()
            .is_some_and(|wish| !super::wish_owner_valid(&wish))
        {
            return bad("wish");
        }
        if s.mask & DH_BARRIER != 0
            && (!s.barrier.is_finite() || s.barrier < 0.0 || s.barrier_ring_step > 8)
        {
            return bad("barrier");
        }
    }
    if let Some(Some(owner)) = d.owner_combat {
        if d.me.is_none() || !owner.valid() {
            return bad("owner combat");
        }
    }
    let mut prev: Option<u32> = None;
    for a in &d.changed {
        if a.mask & !AD_ALL != 0 {
            return bad("actor mask");
        }
        if a.mask & AD_STATUS != 0 && a.q.status > MAX_STATUS_CODE {
            return bad("status");
        }
        if a.mask & AD_MOB_TYPE != 0 && a.q.mob_type_code > 30 {
            return bad("mob type");
        }
        if a.mask & AD_HP != 0 && a.q.hp_pct > 100 {
            return bad("hp_pct");
        }
        if a.mask & AD_BARRIER != 0 && (a.q.barrier_pct > 100 || a.q.barrier_ring_step > 8) {
            return bad("barrier");
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

fn read_self_delta(r: &mut Reader, mask: u32) -> Result<SelfDelta, DecodeError> {
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
    if mask & DH_MOVE_SEQ != 0 {
        s.move_seq = r.u8()?;
    }
    if mask & DH_HP != 0 {
        s.hp = r.f32()?;
    }
    if mask & DH_READY != 0 {
        s.ready_in_ms = r.u16()?;
    }
    if mask & DH_MAX_HP != 0 {
        s.max_hp = r.f32()?;
    }
    if mask & DH_KIT != 0 {
        s.kit = r.u8()?;
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
    if mask & DH_STATUS != 0 {
        s.status = crate::code(r, MAX_STATUS_CODE, "status")?;
    }
    if mask & DH_EFFECTS != 0 {
        s.effects = r.u16()?;
    }
    if mask & DH_DISPLACE != 0 {
        s.displace_seq = r.u8()?;
    }
    if mask & DH_SIG != 0 {
        s.sig = r.u8()?;
    }
    if mask & DH_HUNT_TARGET != 0 {
        let target = r.varint()?;
        s.hunt_target = (target != 0).then_some(target);
    }
    if mask & DH_HUNT_STACKS != 0 {
        s.hunt_stacks = crate::varint_u16(r, "hunt_stacks")?;
    }
    if mask & DH_WISH != 0 {
        s.wish = Some(r.opt(crate::read_wish_owner)?);
    }
    if mask & DH_BARRIER != 0 {
        s.barrier = r.f32()?;
        s.barrier_ring_step = r.u8()?;
        if !s.barrier.is_finite() || s.barrier < 0.0 || s.barrier_ring_step > 8 {
            return Err(DecodeError::BadField("barrier"));
        }
    }
    if mask & DH_ARCHETYPE != 0 {
        s.archetype = r.u8()?;
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
    let head = r.varint()?;
    if head & !DH_KNOWN != 0 || (head & DH_PRESENT == 0 && head & DH_FIELDS != 0) {
        return Err(DecodeError::BadField("head"));
    }
    let training = head & DH_TRAINING != 0;
    let me = if head & DH_PRESENT != 0 {
        Some(read_self_delta(r, head & DH_FIELDS)?)
    } else {
        None
    };
    let phase = if head & DH_PHASE != 0 {
        Some(crate::code(r, MAX_PHASE_CODE, "phase")?)
    } else {
        None
    };
    let server_time = if head & DH_SERVER_TIME != 0 {
        let time = r.f64()?;
        if !time.is_finite() || time < 0.0 || time.to_bits() == snapshot_server_ms(tick).to_bits() {
            return Err(DecodeError::BadField("server time"));
        }
        time
    } else {
        snapshot_server_ms(tick)
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
        let mask = r.varint()?;
        if mask & !AD_ALL != 0 {
            return Err(DecodeError::BadField("actor mask"));
        }
        let mut q = QActor {
            id,
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
        if mask & AD_STATUS != 0 {
            q.status = crate::code(r, MAX_STATUS_CODE, "status")?;
        }
        if mask & AD_KIND != 0 {
            q.kind = r.u8()?;
        }
        if mask & AD_EFFECTS != 0 {
            q.effects = r.u16()?;
        }
        if mask & AD_DISPLACE != 0 {
            q.displace_seq = r.u8()?;
        }
        if mask & AD_MOB_TYPE != 0 {
            q.mob_type_code = crate::code(r, 30, "mob type")?;
        }
        if mask & AD_SIG != 0 {
            q.sig = r.u8()?;
        }
        if mask & AD_BARRIER != 0 {
            q.barrier_pct = r.u8()?;
            q.barrier_ring_step = r.u8()?;
            if q.barrier_pct > 100 || q.barrier_ring_step > 8 {
                return Err(DecodeError::BadField("barrier"));
            }
        }
        if mask & AD_ARCHETYPE != 0 {
            q.archetype = r.u8()?;
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
    let owner_combat = if head & DH_OWNER_COMBAT != 0 {
        Some(match r.u8()? {
            0 => None,
            1 => Some(read_owner_combat(r)?),
            _ => return Err(DecodeError::BadField("owner combat")),
        })
    } else {
        None
    };
    if matches!(owner_combat, Some(Some(_))) && me.is_none() {
        return Err(DecodeError::BadField("owner combat"));
    }
    Ok(SnapshotDelta {
        tick,
        server_time,
        training,
        base_tick: tick - age,
        phase,
        ack_input,
        me,
        changed,
        departed,
        owner_combat,
    })
}

/// Why a client refused a delta (what it held did not change). Each is a reason to ask the server for a Full frame.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DeltaError {
    /// No snapshot held yet (the connection's first snapshot must be Full, and so must the first after a Welcome).
    NoBase,
    /// The delta's base is not the snapshot held.
    BaseMismatch {
        have: u32,
        want: u32,
    },
    /// The delta has a self but the held snapshot has none.
    SelfWithoutBase,
    /// A departed id the held snapshot does not list.
    UnknownDeparted(u32),
    /// An actor both changed and departed.
    DepartedAndChanged(u32),
    /// An actor the held snapshot does not list, carried without its position.
    IncompleteNewActor(u32),
    /// The result would list more than [`MAX_ACTORS`] actors.
    TooManyActors(usize),
    /// A reconstructed kind-4 actor does not carry the contextual Neutral/None tuple.
    InvalidGiverActor(u32),
    InvalidOwnerCombat,
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
            DeltaError::InvalidGiverActor(_) => "giver_actor",
            DeltaError::InvalidOwnerCombat => "owner_combat",
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
    server_time: f64,
    training: bool,
    phase: u8,
    ack_input: u32,
    me: Option<WireSelf>,
    actors: Vec<WireActor>,
    scratch: Vec<WireActor>,
    owner_combat: Option<WireOwnerCombat>,
}

impl SnapshotTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Forgets the held snapshot (a new connection or a Welcome).
    pub fn reset(&mut self) {
        self.tick = None;
        self.server_time = 0.0;
        self.training = false;
        self.me = None;
        self.actors.clear();
        self.owner_combat = None;
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
            training: self.training,
            tick: self.tick?,
            server_time: self.server_time,
            phase: self.phase,
            ack_input: self.ack_input,
            me: self.me,
            actors: self.actors.clone(),
            owner_combat: self.owner_combat,
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
                server_time,
                phase,
                ack_input,
                me,
                actors,
                training,
                owner_combat,
            } => {
                if let Some(id) = actors
                    .iter()
                    .find(|actor| giver_actor_fault(actor).is_some())
                    .map(|actor| actor.id)
                {
                    return Err(DeltaError::InvalidGiverActor(id));
                }
                if owner_combat_fault(owner_combat.as_ref(), me.is_some(), |id| {
                    actors.binary_search_by_key(&id, |a| a.id).is_ok()
                })
                .is_some()
                {
                    return Err(DeltaError::InvalidOwnerCombat);
                }
                self.tick = Some(tick);
                self.server_time = server_time;
                self.training = training;
                self.phase = phase;
                self.ack_input = ack_input;
                self.me = me;
                self.actors.clear();
                self.actors.extend_from_slice(&actors);
                self.owner_combat = owner_combat;
                Ok(ServerMsg::Snapshot {
                    tick,
                    server_time,
                    phase,
                    ack_input,
                    me,
                    actors,
                    training,
                    owner_combat,
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
        if let Some(id) = out
            .iter()
            .find(|actor| giver_actor_fault(actor).is_some())
            .map(|actor| actor.id)
        {
            self.scratch = out;
            return Err(DeltaError::InvalidGiverActor(id));
        }
        let owner_combat = match d.owner_combat {
            Some(owner) => owner,
            None if me.is_none() => None,
            None => self.owner_combat,
        };
        if owner_combat_fault(owner_combat.as_ref(), me.is_some(), |id| {
            out.binary_search_by_key(&id, |a| a.id).is_ok()
        })
        .is_some()
        {
            self.scratch = out;
            return Err(DeltaError::InvalidOwnerCombat);
        }
        std::mem::swap(&mut self.actors, &mut out);
        self.scratch = out;
        self.tick = Some(d.tick);
        self.server_time = d.server_time;
        self.training = d.training;
        if let Some(p) = d.phase {
            self.phase = p;
        }
        self.ack_input = d.ack_input;
        self.me = me;
        self.owner_combat = owner_combat;
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
                if ch.mask & AD_NEW != AD_NEW {
                    return Err(DeltaError::IncompleteNewActor(ch.q.id));
                }
                // A new actor starts from the default one: the fields it does not carry are at their defaults.
                let start = QActor {
                    id: ch.q.id,
                    ..QActor::NEW
                };
                out.push(ch.apply(&start.to_wire()));
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
