//! Isolated Full-only experiment, NOT a protocol version/tag or a live-WS fallback.
//! Owns original v14 bytes. No World access, new facts, Delta, replay or policy authority.
use crate::{ServerMsg, StateItem};
use std::sync::Arc;

pub const MAGIC: &[u8; 8] = b"RHC14EXP";
pub const HEADER: usize = 26;
pub const BEGIN_LEN: usize = 69;
pub const COMMIT_LEN: usize = 40;
pub const PART_HEADER: usize = 32;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Error(pub &'static str);
pub type Result<T> = std::result::Result<T, Error>;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    pub body_bytes: usize,
    /// Conservative epoch allocation budget: accepted bodies are never silently pruned/refunded.
    pub retained_body_bytes: usize,
    pub part_bytes: usize,
    pub parts: usize,
    pub frames: usize,
    pub frame_bytes: usize,
}
impl Limits {
    pub fn check(self) -> Result<Self> {
        if !matches!(crate::PROTOCOL_VERSION, 14 | 18)
            || self.body_bytes == 0
            || self.body_bytes > i32::MAX as usize
            || self.retained_body_bytes < self.body_bytes
            || self.retained_body_bytes > i32::MAX as usize
            || self.part_bytes == 0
            || self.part_bytes > self.body_bytes
            || self.parts == 0
            || self.parts > u16::MAX as usize
            || self.frames < 2
            || self.frames > u16::MAX as usize
            || self.frame_bytes == 0
            || self.frame_bytes > crate::MAX_SERVER_FRAME
            || self.frame_bytes < BEGIN_LEN
            || self
                .part_bytes
                .checked_add(PART_HEADER)
                .is_none_or(|n| n > self.frame_bytes)
        {
            return Err(Error("limits"));
        }
        Ok(self)
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Meta {
    pub epoch: u64,
    pub scene: u64,
    pub tick: u32,
    pub source_time: f64,
    pub cue_from: u64,
    pub cue_through: u64,
}
impl Meta {
    fn check(self) -> Result<()> {
        if self.epoch == 0
            || self.epoch == u64::MAX
            || self.scene == 0
            || self.scene == u64::MAX
            || !self.source_time.is_finite()
            || self.source_time < 0.
            || self.cue_through < self.cue_from
            || self.cue_through == u64::MAX
        {
            return Err(Error("tuple"));
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ack {
    pub epoch: u64,
    pub scene: u64,
    pub cue_through: u64,
}
#[derive(Debug)]
pub struct PreparedScene {
    meta: Meta,
    body: Arc<[u8]>,
    limits: Limits,
    parts: usize,
    framed: usize,
}
impl PreparedScene {
    /// Inputs are exact already-public v14 records. Tail batches retain their original ticks;
    /// the container never invents event-origin timestamps for timeless v14 events.
    pub fn prepare(meta: Meta, frames: &[Vec<u8>], limits: Limits) -> Result<Self> {
        let limits = limits.check()?;
        meta.check()?;
        if frames.len() < 2 || frames.len() > limits.frames {
            return Err(Error("frames"));
        }
        let mut size = 2usize;
        for f in frames {
            if f.is_empty() || f.len() > limits.frame_bytes {
                return Err(Error("frame size"));
            }
            size = size
                .checked_add(4)
                .and_then(|n| n.checked_add(f.len()))
                .ok_or(Error("size"))?;
        }
        if size > limits.body_bytes {
            return Err(Error("body size"));
        }
        let mut body = Vec::with_capacity(size);
        body.extend_from_slice(&(frames.len() as u16).to_le_bytes());
        for f in frames {
            body.extend_from_slice(&(f.len() as u32).to_le_bytes());
            body.extend_from_slice(f);
        }
        validate_body(meta, &body, limits)?;
        let parts = size.div_ceil(limits.part_bytes);
        if parts > limits.parts {
            return Err(Error("parts"));
        }
        let framed = parts
            .checked_mul(PART_HEADER)
            .and_then(|v| v.checked_add(size))
            .and_then(|v| v.checked_add(BEGIN_LEN + COMMIT_LEN))
            .ok_or(Error("size"))?;
        Ok(Self {
            meta,
            body: body.into_boxed_slice().into(),
            limits,
            parts,
            framed,
        })
    }
    pub fn meta(&self) -> Meta {
        self.meta
    }
    pub fn body(&self) -> &[u8] {
        &self.body
    }
    pub fn framed_bytes(&self) -> usize {
        self.framed
    }
    pub fn record_count(&self) -> usize {
        self.parts + 2
    }
    pub fn record_len(&self, index: usize) -> Result<usize> {
        if index >= self.record_count() {
            return Err(Error("record index"));
        }
        Ok(if index == 0 {
            BEGIN_LEN
        } else if index + 1 == self.record_count() {
            COMMIT_LEN
        } else {
            PART_HEADER
                + (self.body.len() - (index - 1) * self.limits.part_bytes)
                    .min(self.limits.part_bytes)
        })
    }
    /// Copy-out utility for fixtures/isolated callers. A future socket adapter must charge
    /// copies or use leased slices; this does not grant an unaccounted live writer buffer.
    pub fn record(&self, index: usize) -> Result<Vec<u8>> {
        if index >= self.record_count() {
            return Err(Error("record index"));
        }
        let kind = if index == 0 {
            1
        } else if index == self.parts + 1 {
            3
        } else {
            2
        };
        let len = if kind == 1 {
            BEGIN_LEN
        } else if kind == 3 {
            COMMIT_LEN
        } else {
            PART_HEADER
                + (self.body.len() - (index - 1) * self.limits.part_bytes)
                    .min(self.limits.part_bytes)
        };
        let mut out = Vec::with_capacity(len);
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&[1, kind]);
        out.extend_from_slice(&self.meta.epoch.to_le_bytes());
        out.extend_from_slice(&self.meta.scene.to_le_bytes());
        match kind {
            1 => {
                out.extend_from_slice(&self.meta.tick.to_le_bytes());
                out.extend_from_slice(&self.meta.source_time.to_le_bytes());
                out.push(0);
                out.extend_from_slice(&0u64.to_le_bytes()); // Full only; no base.
                out.extend_from_slice(&self.meta.cue_from.to_le_bytes());
                out.extend_from_slice(&self.meta.cue_through.to_le_bytes());
                out.extend_from_slice(&(self.parts as u16).to_le_bytes());
                out.extend_from_slice(&(self.body.len() as u32).to_le_bytes());
            }
            2 => {
                let p = index - 1;
                let from = p * self.limits.part_bytes;
                let end = (from + self.limits.part_bytes).min(self.body.len());
                out.extend_from_slice(&(p as u16).to_le_bytes());
                out.extend_from_slice(&((end - from) as u32).to_le_bytes());
                out.extend_from_slice(&self.body[from..end]);
            }
            _ => {
                out.extend_from_slice(&(self.parts as u16).to_le_bytes());
                out.extend_from_slice(&(self.body.len() as u32).to_le_bytes());
                out.extend_from_slice(&self.meta.cue_through.to_le_bytes());
            }
        }
        Ok(out)
    }
}
fn prefix(kind: u8, epoch: u64, scene: u64) -> Vec<u8> {
    let mut out = Vec::from(*MAGIC);
    out.extend_from_slice(&[1, kind]);
    out.extend_from_slice(&epoch.to_le_bytes());
    out.extend_from_slice(&scene.to_le_bytes());
    out
}
pub fn encode_ack(ack: Ack) -> Vec<u8> {
    let mut out = prefix(4, ack.epoch, ack.scene);
    out.extend_from_slice(&ack.cue_through.to_le_bytes());
    out
}
pub fn decode_ack(bytes: &[u8]) -> Result<Ack> {
    let mut r = Read::new(bytes);
    let (k, epoch, scene) = r.header()?;
    if k != 4 {
        return Err(Error("ack kind"));
    }
    let cue_through = r.u64()?;
    r.end()?;
    Ok(Ack {
        epoch,
        scene,
        cue_through,
    })
}
/// Accepted DATA, not AcceptedFrame. Private owned bytes prevent caller/pool mutation.
#[derive(Debug)]
pub struct View {
    meta: Meta,
    body: Arc<[u8]>,
}
impl View {
    pub fn meta(&self) -> Meta {
        self.meta
    }
    pub fn body(&self) -> &[u8] {
        &self.body
    }
    /// Returns detached DTOs; mutations cannot alter the accepted byte-owned view.
    pub fn messages(&self) -> Result<Vec<ServerMsg>> {
        let mut r = Read::new(&self.body);
        let n = r.u16()?;
        let mut out = Vec::with_capacity(n as usize);
        for _ in 0..n {
            let len = r.u32()? as usize;
            out.push(ServerMsg::decode(r.take(len)?).map_err(|_| Error("inner codec"))?);
        }
        r.end()?;
        Ok(out)
    }
}
#[derive(Debug)]
struct Assembly {
    meta: Meta,
    total: usize,
    parts: usize,
    next: usize,
    bytes: Vec<u8>,
}
#[derive(Debug)]
pub struct Receiver {
    epoch: u64,
    limits: Limits,
    held: Option<Arc<View>>,
    stage: Option<Assembly>,
    owned_body_bytes: usize,
    closed: bool,
}
impl Receiver {
    pub fn new(epoch: u64, limits: Limits) -> Result<Self> {
        if epoch == 0 || epoch == u64::MAX {
            return Err(Error("epoch"));
        }
        Ok(Self {
            epoch,
            limits: limits.check()?,
            held: None,
            stage: None,
            owned_body_bytes: 0,
            closed: false,
        })
    }
    pub fn current(&self) -> Option<&Arc<View>> {
        self.held.as_ref()
    }
    pub fn closed(&self) -> bool {
        self.closed
    }
    pub fn owned_body_bytes(&self) -> usize {
        self.owned_body_bytes
    }
    pub fn close(&mut self) {
        self.closed = true;
        if let Some(a) = self.stage.take() {
            self.owned_body_bytes -= a.total;
        }
    }
    /// Every malformed/unsupported transaction explicitly closes the epoch, retaining the
    /// prior exposed immutable view. No silent retry, rewind, Delta or resync path exists.
    pub fn push(&mut self, bytes: &[u8]) -> Result<bool> {
        if self.closed {
            return Err(Error("closed"));
        }
        let result = if bytes.len() > self.limits.frame_bytes {
            Err(Error("outer size"))
        } else {
            self.push_inner(bytes)
        };
        if result.is_err() {
            self.close();
        }
        result
    }
    fn push_inner(&mut self, bytes: &[u8]) -> Result<bool> {
        let mut r = Read::new(bytes);
        let (kind, epoch, scene) = r.header()?;
        if epoch != self.epoch {
            return Err(Error("epoch"));
        }
        let held_scene = self.held.as_ref().map_or(0, |v| v.meta.scene);
        let held_cue = self.held.as_ref().map_or(0, |v| v.meta.cue_through);
        match kind {
            1 => {
                if self.stage.is_some() {
                    return Err(Error("duplicate begin"));
                }
                let tick = r.u32()?;
                let source_time = r.f64()?;
                if r.u8()? != 0 || r.u64()? != 0 {
                    return Err(Error("Full only"));
                }
                let cue_from = r.u64()?;
                let cue_through = r.u64()?;
                let parts = r.u16()? as usize;
                let total = r.u32()? as usize;
                r.end()?;
                let meta = Meta {
                    epoch,
                    scene,
                    tick,
                    source_time,
                    cue_from,
                    cue_through,
                };
                meta.check()?;
                if held_scene.checked_add(1) != Some(scene)
                    || cue_from != held_cue
                    || self
                        .held
                        .as_ref()
                        .is_some_and(|v| tick < v.meta.tick || source_time < v.meta.source_time)
                {
                    return Err(Error("base"));
                }
                if total == 0
                    || total > self.limits.body_bytes
                    || parts == 0
                    || parts > self.limits.parts
                    || total.div_ceil(self.limits.part_bytes) != parts
                {
                    return Err(Error("assembly size"));
                }
                if self
                    .owned_body_bytes
                    .checked_add(total)
                    .is_none_or(|n| n > self.limits.retained_body_bytes)
                {
                    return Err(Error("retained bodies"));
                }
                self.owned_body_bytes += total; // Charge before allocation; transfer to accepted ownership on COMMIT.
                self.stage = Some(Assembly {
                    meta,
                    total,
                    parts,
                    next: 0,
                    bytes: Vec::with_capacity(total),
                });
                Ok(false)
            }
            2 => {
                let index = r.u16()? as usize;
                let len = r.u32()? as usize;
                let a = self.stage.as_mut().ok_or(Error("no begin"))?;
                if scene != a.meta.scene
                    || index != a.next
                    || index >= a.parts
                    || len != (a.total - a.bytes.len()).min(self.limits.part_bytes)
                {
                    return Err(Error("part"));
                }
                let payload = r.take(len)?;
                r.end()?;
                a.bytes.extend_from_slice(payload);
                a.next += 1;
                Ok(false)
            }
            3 => {
                let parts = r.u16()? as usize;
                let total = r.u32()? as usize;
                let cue = r.u64()?;
                r.end()?;
                let a = self.stage.as_ref().ok_or(Error("no begin"))?;
                if scene != a.meta.scene
                    || parts != a.parts
                    || total != a.total
                    || cue != a.meta.cue_through
                    || a.next != a.parts
                    || a.bytes.len() != a.total
                {
                    return Err(Error("commit"));
                }
                validate_body(a.meta, &a.bytes, self.limits)?;
                let a = self.stage.take().ok_or(Error("no begin"))?;
                self.held = Some(Arc::new(View {
                    meta: a.meta,
                    body: a.bytes.into_boxed_slice().into(),
                }));
                Ok(true)
            }
            _ => Err(Error("unsupported kind")),
        }
    }
}
fn validate_body(meta: Meta, body: &[u8], limits: Limits) -> Result<()> {
    let mut r = Read::new(body);
    let n = r.u16()? as usize;
    if n < 2 || n > limits.frames {
        return Err(Error("frames"));
    }
    let mut occurrences = 0u64;
    for index in 0..n {
        let len = r.u32()? as usize;
        if len == 0 || len > limits.frame_bytes {
            return Err(Error("frame size"));
        }
        let message = ServerMsg::decode(r.take(len)?).map_err(|_| Error("inner codec"))?;
        // Inner validators include owner lock/current actors and complete props/quest refs.
        message.try_encode().map_err(|_| Error("inner value"))?;
        match (index, &message) {
            (
                0,
                ServerMsg::Snapshot {
                    tick, server_time, ..
                },
            ) if *tick == meta.tick && server_time.to_bits() == meta.source_time.to_bits() => {}
            (1, ServerMsg::State { tick, items })
                if *tick == meta.tick
                    // The experiment predates key 12 (ADR0026 roster): a complete scene is keys 1..=11, or 1..=12.
                    && (items.len() == 11 || items.len() == crate::state::MAX_STATE_KEYS)
                    && items
                        .iter()
                        .enumerate()
                        .all(|(i, v)| v.key() == i as u32 + 1) => {}
            (i, ServerMsg::Events { tick, events }) if i >= 2 && *tick <= meta.tick => {
                occurrences = occurrences
                    .checked_add(events.len() as u64)
                    .ok_or(Error("cue count"))?;
            }
            (i, ServerMsg::Fx { tick, fx }) if i >= 2 && *tick <= meta.tick => {
                occurrences = occurrences
                    .checked_add(fx.len() as u64)
                    .ok_or(Error("cue count"))?;
            }
            _ => return Err(Error("body role")),
        }
        // Each full State carries all11 groups, so the existing codec validates reconstructed
        // props/quest joins, absent vs available-empty, focus and typed roster relations.
        if let ServerMsg::State { items, .. } = &message {
            let StateItem::Props(props) = &items[1] else {
                return Err(Error("props"));
            };
            let StateItem::Quests(quests) = &items[9] else {
                return Err(Error("quests"));
            };
            crate::validate_quest_props(props, quests.as_ref())
                .map_err(|_| Error("quest props"))?;
        }
    }
    r.end()?;
    if meta.cue_from.checked_add(occurrences) != Some(meta.cue_through) {
        return Err(Error("cue count"));
    }
    Ok(())
}
struct Read<'a> {
    bytes: &'a [u8],
    pos: usize,
}
impl<'a> Read<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        let end = self.pos.checked_add(n).ok_or(Error("size"))?;
        let v = self.bytes.get(self.pos..end).ok_or(Error("truncated"))?;
        self.pos = end;
        Ok(v)
    }
    fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_le_bytes(
            self.take(2)?.try_into().map_err(|_| Error("truncated"))?,
        ))
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(
            self.take(4)?.try_into().map_err(|_| Error("truncated"))?,
        ))
    }
    fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(
            self.take(8)?.try_into().map_err(|_| Error("truncated"))?,
        ))
    }
    fn f64(&mut self) -> Result<f64> {
        Ok(f64::from_bits(self.u64()?))
    }
    fn header(&mut self) -> Result<(u8, u64, u64)> {
        if self.take(8)? != MAGIC || self.u8()? != 1 {
            return Err(Error("experiment"));
        }
        let k = self.u8()?;
        let e = self.u64()?;
        let s = self.u64()?;
        Ok((k, e, s))
    }
    fn end(&self) -> Result<()> {
        if self.pos != self.bytes.len() {
            Err(Error("trailing"))
        } else {
            Ok(())
        }
    }
}
#[cfg(test)]
mod tests;
