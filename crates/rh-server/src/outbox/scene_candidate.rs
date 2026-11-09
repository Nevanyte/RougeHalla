//! Isolated queue/writer MODEL. Not connected to Outbox/Room/live WS. Completion is a
//! trusted adapter obligation: only actual successful socket flush may call complete().
use rh_protocol::scene_candidate::{Ack, Error, Limits, Meta, PreparedScene, Result};
use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard};

pub mod socket;

#[derive(Clone, Copy, Debug)]
pub struct QueueLimits {
    pub outstanding_bytes: usize,
    pub scenes: usize,
    pub pending_bytes: usize,
    pub pending_scenes: usize,
    pub scratch_bytes: usize,
}
/// Opaque publication metadata for the isolated owner, NOT live ItemObserver authority.
/// The leaf deliberately does not mutate a Room or mint AcceptedFrame/capabilities.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Publication {
    pub alias_cursor: u64,
    pub sample_cursor: u64,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Meter {
    pub outstanding_bytes: usize,
    pub scenes: usize,
    pub pending_bytes: usize,
    pub pending_scenes: usize,
    pub scratch_bytes: usize,
    pub entries: usize,
    pub written: u64,
    pub acked: u64,
    pub published: u64,
    pub cue_through: u64,
    pub closed: bool,
    pub publication: Publication,
    pub pending_ack: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Pending,
    Queued,
    Writing,
    Committing,
    Written,
}
struct Entry {
    scene: PreparedScene,
    publication: Publication,
    phase: Phase,
    owners: usize,
    retained: bool,
    next: usize,
    record_live: bool,
}
struct State {
    generation: u64,
    epoch: u64,
    limits: QueueLimits,
    codec: Limits,
    meter: Meter,
    next_id: u64,
    entries: BTreeMap<u64, Entry>,
    queue: VecDeque<u64>,
    writer: Option<u64>,
    last_ack: Option<Ack>,
    deferred: Option<Ack>,
    published_meta: Option<Meta>,
}
#[derive(Clone)]
pub struct Queue(Arc<Mutex<State>>);
fn lock(shared: &Arc<Mutex<State>>) -> MutexGuard<'_, State> {
    shared
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
impl Queue {
    pub fn new(generation: u64, epoch: u64, codec: Limits, limits: QueueLimits) -> Result<Self> {
        codec.check()?;
        if generation == 0
            || epoch == 0
            || epoch == u64::MAX
            || limits.outstanding_bytes == 0
            || limits.scenes == 0
            || limits.pending_bytes == 0
            || limits.pending_scenes == 0
            || limits.scratch_bytes == 0
            || limits.scenes.checked_add(limits.pending_scenes).is_none()
        {
            return Err(Error("queue limits"));
        }
        Ok(Self(Arc::new(Mutex::new(State {
            generation,
            epoch,
            limits,
            codec,
            meter: Meter::default(),
            next_id: 1,
            entries: BTreeMap::new(),
            queue: VecDeque::new(),
            writer: None,
            last_ack: None,
            deferred: None,
            published_meta: None,
        }))))
    }
    pub fn meter(&self) -> Meter {
        let s = lock(&self.0);
        Meter {
            entries: s.entries.len(),
            pending_ack: s.deferred.is_some(),
            ..s.meter
        }
    }
    /// Own raw originals while preparing. Reserve their ACTUAL retained Vec capacities plus
    /// the predicted new body before allocating it; failure closes rather than losing events.
    pub fn prepare(
        &self,
        meta: Meta,
        frames: Vec<Vec<u8>>,
        publication: Publication,
    ) -> Result<Pending> {
        let mut s = lock(&self.0);
        if s.meter.closed {
            return Err(Error("closed"));
        }
        let raw = frames.iter().try_fold(
            frames
                .capacity()
                .checked_mul(std::mem::size_of::<Vec<u8>>())
                .ok_or(Error("size"))?,
            |n, f| n.checked_add(f.capacity()).ok_or(Error("size")),
        )?;
        let body = frames.iter().try_fold(2usize, |n, f| {
            n.checked_add(4)
                .and_then(|n| n.checked_add(f.len()))
                .ok_or(Error("size"))
        })?;
        let reserve = raw.checked_add(body).ok_or(Error("size"))?;
        if s.meter.pending_scenes >= s.limits.pending_scenes
            || s.meter
                .pending_bytes
                .checked_add(reserve)
                .is_none_or(|n| n > s.limits.pending_bytes)
        {
            s.close();
            return Err(Error("pending capacity"));
        }
        // No unlocked callback can consume the source while its charge is provisional.
        s.meter.pending_bytes += reserve;
        s.meter.pending_scenes += 1;
        let scene = match PreparedScene::prepare(meta, &frames, s.codec) {
            Ok(v) => v,
            Err(e) => {
                s.meter.pending_bytes -= reserve;
                s.meter.pending_scenes -= 1;
                s.close();
                return Err(e);
            }
        };
        drop(frames);
        let charge = scene.framed_bytes();
        if charge > s.limits.pending_bytes
            || s.meter.pending_bytes - reserve > s.limits.pending_bytes - charge
        {
            s.meter.pending_bytes -= reserve;
            s.meter.pending_scenes -= 1;
            s.close();
            return Err(Error("pending capacity"));
        }
        s.meter.pending_bytes = s.meter.pending_bytes - reserve + charge;
        if s.next_id == u64::MAX {
            s.meter.pending_bytes -= charge;
            s.meter.pending_scenes -= 1;
            s.close();
            return Err(Error("exhausted"));
        }
        let id = s.next_id;
        s.next_id += 1;
        s.entries.insert(
            id,
            Entry {
                scene,
                publication,
                phase: Phase::Pending,
                owners: 1,
                retained: false,
                next: 0,
                record_live: false,
            },
        );
        Ok(Pending {
            queue: self.clone(),
            id,
            generation: s.generation,
            transferred: false,
        })
    }
    /// An admission refusal leaves Pending's exact original bytes charged for retry.
    pub fn try_admit(&self, pending: &mut Pending) -> Result<()> {
        if !Arc::ptr_eq(&self.0, &pending.queue.0) || pending.transferred {
            return Err(Error("pending owner"));
        }
        let mut s = lock(&self.0);
        if s.meter.closed || s.generation != pending.generation {
            return Err(Error("closed"));
        }
        let e = s.entries.get(&pending.id).ok_or(Error("pending"))?;
        let m = e.scene.meta();
        let charge = e.scene.framed_bytes();
        let pub_next = e.publication;
        if e.phase != Phase::Pending
            || m.epoch != s.epoch
            || s.meter.published.checked_add(1) != Some(m.scene)
            || s.published_meta
                .is_some_and(|old| m.tick < old.tick || m.source_time < old.source_time)
            || m.cue_from != s.meter.cue_through
            || pub_next.alias_cursor == u64::MAX
            || pub_next.sample_cursor == u64::MAX
            || pub_next.alias_cursor < s.meter.publication.alias_cursor
            || pub_next.sample_cursor <= s.meter.publication.sample_cursor
        {
            return Err(Error("publication"));
        }
        if s.meter.scenes >= s.limits.scenes
            || s.meter
                .outstanding_bytes
                .checked_add(charge)
                .is_none_or(|n| n > s.limits.outstanding_bytes)
        {
            return Err(Error("full"));
        }
        // All publication state and reservation transfers share this one mutation boundary.
        s.meter.pending_bytes -= charge;
        s.meter.pending_scenes -= 1;
        s.meter.outstanding_bytes += charge;
        s.meter.scenes += 1;
        s.meter.published = m.scene;
        s.published_meta = Some(m);
        s.meter.cue_through = m.cue_through;
        s.meter.publication = pub_next;
        let e = s.entries.get_mut(&pending.id).ok_or(Error("pending"))?;
        e.phase = Phase::Queued;
        e.retained = true;
        s.queue.push_back(pending.id);
        pending.transferred = true;
        Ok(())
    }
    pub fn begin_write(&self) -> Result<Option<Writer>> {
        let mut s = lock(&self.0);
        if s.meter.closed {
            return Err(Error("closed"));
        }
        if s.writer.is_some() {
            return Err(Error("writer busy"));
        }
        let Some(id) = s.queue.pop_front() else {
            return Ok(None);
        };
        let e = s.entries.get_mut(&id).ok_or(Error("queue"))?;
        e.phase = Phase::Writing;
        s.writer = Some(id);
        Ok(Some(Writer {
            queue: self.clone(),
            id,
            generation: s.generation,
            finished: false,
        }))
    }
    pub fn ack(&self, generation: u64, ack: Ack) -> Result<bool> {
        let mut s = lock(&self.0);
        s.ack(generation, ack, true)
    }
    pub fn close(&self) {
        lock(&self.0).close();
    }
}
pub struct Pending {
    queue: Queue,
    id: u64,
    generation: u64,
    transferred: bool,
}
impl Pending {
    pub fn meta(&self) -> Result<Meta> {
        lock(&self.queue.0)
            .entries
            .get(&self.id)
            .map(|e| e.scene.meta())
            .ok_or(Error("pending"))
    }
}
impl Drop for Pending {
    fn drop(&mut self) {
        if !self.transferred {
            let mut s = lock(&self.queue.0);
            s.close();
            s.release(self.id);
        }
    }
}
pub struct Writer {
    queue: Queue,
    id: u64,
    generation: u64,
    finished: bool,
}
impl Writer {
    /// Exactly one scratch record at a time; the guard owns its charged copy until drop.
    pub fn next_record(&mut self) -> Result<Option<WriteRecord>> {
        let mut s = lock(&self.queue.0);
        if s.meter.closed || s.generation != self.generation {
            return Err(Error("closed"));
        }
        let e = s.entries.get(&self.id).ok_or(Error("writer"))?;
        if e.record_live {
            return Err(Error("record busy"));
        }
        if e.next == e.scene.record_count() {
            self.finished = true;
            return Ok(None);
        }
        let index = e.next;
        let reserved = e.scene.record_len(index)?;
        if s.meter
            .scratch_bytes
            .checked_add(reserved)
            .is_none_or(|n| n > s.limits.scratch_bytes)
        {
            s.close();
            return Err(Error("scratch capacity"));
        }
        s.meter.scratch_bytes += reserved; // Reserve BEFORE copy-out allocation.
        let bytes = match s
            .entries
            .get(&self.id)
            .ok_or(Error("writer"))?
            .scene
            .record(index)
        {
            Ok(b) => b,
            Err(e) => {
                s.meter.scratch_bytes -= reserved;
                s.close();
                return Err(e);
            }
        };
        let charge = bytes.capacity();
        if charge != reserved {
            s.meter.scratch_bytes -= reserved;
            s.close();
            return Err(Error("unexpected capacity"));
        }
        let e = s.entries.get_mut(&self.id).ok_or(Error("writer"))?;
        e.owners += 1;
        e.record_live = true;
        Ok(Some(WriteRecord {
            queue: self.queue.clone(),
            id: self.id,
            generation: self.generation,
            bytes,
            index,
            charge,
            started: false,
            completed: false,
        }))
    }
}
impl Drop for Writer {
    fn drop(&mut self) {
        let mut s = lock(&self.queue.0);
        if !self.finished
            && s.entries
                .get(&self.id)
                .is_some_and(|e| e.phase != Phase::Written)
        {
            s.close();
        }
        if s.writer == Some(self.id) {
            s.writer = None;
        }
        s.release(self.id);
    }
}
pub struct WriteRecord {
    queue: Queue,
    id: u64,
    generation: u64,
    bytes: Vec<u8>,
    index: usize,
    charge: usize,
    started: bool,
    completed: bool,
}
impl WriteRecord {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
    /// Trusted adapter signals the beginning of the actual sink write, separately from
    /// preparing bytes. Only a started final COMMIT may occupy the bounded ACK-race slot.
    pub fn start(&mut self) -> Result<()> {
        let mut s = lock(&self.queue.0);
        if s.meter.closed || s.generation != self.generation || self.started {
            return Err(Error("write start"));
        }
        let e = s.entries.get_mut(&self.id).ok_or(Error("writer"))?;
        if e.next != self.index || !e.record_live {
            return Err(Error("write order"));
        }
        if self.index + 1 == e.scene.record_count() {
            e.phase = Phase::Committing;
        }
        self.started = true;
        Ok(())
    }
    /// Trusted writer MODEL completion, never called by ACK parsing. Live integration is
    /// absent: a future adapter must call only after the actual successful socket flush.
    pub fn complete(mut self) -> Result<()> {
        self.complete_borrowed()
    }
    fn complete_borrowed(&mut self) -> Result<()> {
        let mut s = lock(&self.queue.0);
        if s.meter.closed || s.generation != self.generation || !self.started {
            return Err(Error("write incomplete"));
        }
        let e = s.entries.get_mut(&self.id).ok_or(Error("writer"))?;
        if e.next != self.index {
            return Err(Error("write order"));
        }
        e.next += 1;
        if e.next == e.scene.record_count() {
            e.phase = Phase::Written;
            let scene = e.scene.meta().scene;
            if s.meter.written.checked_add(1) != Some(scene) {
                s.close();
                return Err(Error("write gap"));
            }
            s.meter.written = scene;
            if let Some(a) = s.deferred.take() {
                let generation = s.generation;
                s.ack(generation, a, false)?;
            }
        } else {
            e.phase = Phase::Writing;
        }
        self.completed = true;
        Ok(())
    }
}
impl Drop for WriteRecord {
    fn drop(&mut self) {
        let mut s = lock(&self.queue.0);
        if !self.completed {
            s.close();
        }
        s.meter.scratch_bytes -= self.charge;
        if let Some(e) = s.entries.get_mut(&self.id) {
            e.record_live = false;
        }
        s.release(self.id);
    }
}
impl State {
    fn ack(&mut self, generation: u64, a: Ack, allow_defer: bool) -> Result<bool> {
        if self.meter.closed || generation != self.generation || a.epoch != self.epoch {
            return Err(Error("ack epoch"));
        }
        if self.last_ack == Some(a) {
            return Ok(true);
        }
        if a.scene <= self.meter.acked {
            return Err(Error("ack stale"));
        }
        let exact = self.entries.values().find(|e| {
            let m = e.scene.meta();
            m.epoch == a.epoch
                && m.scene == a.scene
                && m.cue_through == a.cue_through
                && e.phase != Phase::Pending
        });
        let Some(e) = exact else {
            return Err(Error("ack tuple"));
        };
        if a.scene > self.meter.written {
            if allow_defer
                && e.phase == Phase::Committing
                && self.writer.is_some_and(|id| {
                    self.entries
                        .get(&id)
                        .is_some_and(|w| w.scene.meta().scene == a.scene)
                })
                && self.deferred.is_none_or(|v| v == a)
            {
                self.deferred = Some(a);
                return Ok(false);
            }
            return Err(Error("ack unwritten"));
        }
        self.meter.acked = a.scene;
        self.last_ack = Some(a);
        let ids: Vec<_> = self
            .entries
            .iter()
            .filter_map(|(&id, e)| {
                (e.phase == Phase::Written && e.scene.meta().scene <= a.scene).then_some(id)
            })
            .collect();
        for id in ids {
            if let Some(e) = self.entries.get_mut(&id) {
                e.retained = false;
            }
            self.reclaim(id);
        }
        Ok(true)
    }
    fn release(&mut self, id: u64) {
        if let Some(e) = self.entries.get_mut(&id) {
            e.owners = e.owners.checked_sub(1).expect("balanced private leases");
        }
        self.reclaim(id);
    }
    fn reclaim(&mut self, id: u64) {
        if self
            .entries
            .get(&id)
            .is_some_and(|e| e.owners == 0 && !e.retained)
        {
            if let Some(e) = self.entries.remove(&id) {
                let n = e.scene.framed_bytes();
                if e.phase == Phase::Pending {
                    self.meter.pending_bytes -= n;
                    self.meter.pending_scenes -= 1;
                } else {
                    self.meter.outstanding_bytes -= n;
                    self.meter.scenes -= 1;
                }
            }
        }
    }
    fn close(&mut self) {
        self.meter.closed = true;
        self.deferred = None;
        while let Some(id) = self.queue.pop_front() {
            self.release(id);
        }
        let ids: Vec<_> = self.entries.keys().copied().collect();
        for id in ids {
            if let Some(e) = self.entries.get_mut(&id) {
                e.retained = false;
            }
            self.reclaim(id);
        }
    }
}
#[cfg(test)]
mod tests;
