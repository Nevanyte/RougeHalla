//! Private current14 socket experiment. No default route/Room/Session/policy binding.
//! One whole socket owns its buffered output until flush or terminal teardown. Queue
//! meters cover their existing payload/lease domain, not WebSocket heap or process RSS.
use super::{Meter, Pending, Publication, Queue, QueueLimits, WriteRecord, Writer};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::Response;
use futures_util::{stream::FusedStream, Sink, Stream};
use rh_protocol::scene_candidate::{decode_ack, Limits, Meta, HEADER};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;
use tokio::sync::{futures::OwnedNotified, Notify};
use tokio::time::{Instant, Sleep};

const ACK_BYTES: usize = HEADER + 8;
// Conservative maximum, including masked framing. Not a new product capacity.
const WS_HEADER: usize = 14;
const CONTROL_BYTES: usize = 125;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SocketError {
    Configuration,
    Full,
    Closed,
    Model(&'static str),
    Malformed,
    Transport,
    Timeout(&'static str),
}
type Result<T> = std::result::Result<T, SocketError>;

/// Caller values only. Message/frame caps are applied by Endpoint before assembly.
#[derive(Clone, Copy, Debug)]
pub struct SocketLimits {
    pub read_buffer_bytes: usize,
    pub inbound_message_bytes: usize,
    pub inbound_frame_bytes: usize,
    pub write_buffer_bytes: usize,
    pub max_write_buffer_bytes: usize,
    pub scene_timeout: Duration,
    pub ack_timeout: Duration,
    pub idle_timeout: Duration,
    pub read_quota: usize,
    pub write_quota: usize,
}
impl SocketLimits {
    fn check(self, codec: Limits) -> Result<Self> {
        let capacity = self
            .write_buffer_bytes
            .checked_add(codec.frame_bytes)
            .and_then(|n| n.checked_add(WS_HEADER))
            .and_then(|n| n.checked_add(CONTROL_BYTES + WS_HEADER));
        let now = Instant::now();
        if self.read_buffer_bytes == 0
            || self.read_buffer_bytes.checked_add(WS_HEADER).is_none()
            || self.inbound_frame_bytes < ACK_BYTES
            || self.inbound_message_bytes < self.inbound_frame_bytes
            || self.inbound_message_bytes.checked_add(WS_HEADER).is_none()
            || self.max_write_buffer_bytes <= self.write_buffer_bytes
            || capacity.is_none_or(|n| n > self.max_write_buffer_bytes)
            || self.read_quota == 0
            || self.write_quota == 0
            || [self.scene_timeout, self.ack_timeout, self.idle_timeout]
                .iter()
                .any(|d| d.is_zero() || now.checked_add(*d).is_none())
        {
            return Err(SocketError::Configuration);
        }
        Ok(self)
    }
}

struct Shared {
    queue: Queue,
    generation: u64,
    work: Arc<Notify>,
    progress: Arc<Notify>,
    #[cfg(test)]
    trace: std::sync::Mutex<Vec<Trace>>,
    #[cfg(test)]
    observed: Arc<Notify>,
    #[cfg(test)]
    before_complete: std::sync::Mutex<Option<BeforeComplete>>,
}
#[cfg(test)]
type BeforeComplete = Box<dyn FnOnce(&Arc<Shared>) + Send>;
impl Shared {
    fn close(&self) {
        self.queue.close();
        self.work.notify_waiters();
        self.progress.notify_waiters();
    }
    fn model_error(&self, e: rh_protocol::scene_candidate::Error) -> SocketError {
        self.close();
        SocketError::Model(e.0)
    }
    #[cfg(test)]
    fn record(&self, event: Trace) {
        let mut trace = self.trace.lock().unwrap();
        // A bounded test audit, absent from normal builds; not a product limit.
        assert!(trace.len() < 8192, "test audit exhausted");
        trace.push(event);
        drop(trace);
        self.observed.notify_waiters();
    }
}

/// No Clone: caller may share Arc<Ingress>. The driver owns Shared, never Ingress.
pub struct Ingress {
    shared: Arc<Shared>,
}
impl Ingress {
    pub fn prepare(
        &self,
        meta: Meta,
        frames: Vec<Vec<u8>>,
        publication: Publication,
    ) -> Result<PendingScene> {
        let pending = self
            .shared
            .queue
            .prepare(meta, frames, publication)
            .map_err(|e| self.shared.model_error(e))?;
        Ok(PendingScene {
            pending: Some(pending),
            shared: self.shared.clone(),
        })
    }
    pub fn meter(&self) -> Meter {
        self.shared.queue.meter()
    }
    pub fn close(&self) {
        self.shared.close();
    }
}
impl Drop for Ingress {
    fn drop(&mut self) {
        self.shared.close();
    }
}

/// Admission is a method of the captured pending context, never a new/current one.
pub struct PendingScene {
    pending: Option<Pending>,
    shared: Arc<Shared>,
}
impl PendingScene {
    pub fn meta(&self) -> Result<Meta> {
        self.pending
            .as_ref()
            .ok_or(SocketError::Model("already admitted"))?
            .meta()
            .map_err(|e| SocketError::Model(e.0))
    }
    pub fn meter(&self) -> Meter {
        self.shared.queue.meter()
    }
    /// ONLY exact capacity-full is retryable. All other failures fence this context.
    pub fn try_admit(&mut self) -> Result<()> {
        let Some(pending) = self.pending.as_mut() else {
            self.shared.close();
            return Err(SocketError::Model("already admitted"));
        };
        match self.shared.queue.try_admit(pending) {
            Ok(()) => {
                // Core Pending transferred its owner to the FIFO; disarm wrapper Drop.
                drop(self.pending.take());
                self.shared.work.notify_one();
                Ok(())
            }
            Err(e) if e.0 == "full" => Err(SocketError::Full),
            Err(e) => Err(self.shared.model_error(e)),
        }
    }
    /// Owns the same Pending through waits/cancellation. No rebuilding/restamping.
    pub async fn wait_admit(mut self) -> Result<()> {
        loop {
            let mut notified = Box::pin(self.shared.progress.clone().notified_owned());
            let _ = notified.as_mut().enable();
            match self.try_admit() {
                Ok(()) => return Ok(()),
                Err(SocketError::Full) => notified.await,
                Err(e) => return Err(e),
            }
        }
    }
}
impl Drop for PendingScene {
    fn drop(&mut self) {
        if let Some(pending) = self.pending.take() {
            // Drop the untransferred core owner before signalling the closed state.
            drop(pending);
            self.shared.close();
        }
    }
}

/// An owned upgrade lease; dropping an unused/failed upgrade closes its queue.
pub struct Endpoint {
    shared: Option<Arc<Shared>>,
    io: SocketLimits,
}
/// Does not allocate product identities/defaults. No payload channel is introduced.
pub fn channel(
    generation: u64,
    epoch: u64,
    codec: Limits,
    queue: QueueLimits,
    io: SocketLimits,
) -> Result<(Ingress, Endpoint)> {
    let codec = codec.check().map_err(|_| SocketError::Configuration)?;
    let io = io.check(codec)?;
    let queue =
        Queue::new(generation, epoch, codec, queue).map_err(|_| SocketError::Configuration)?;
    let shared = Arc::new(Shared {
        queue,
        generation,
        work: Arc::new(Notify::new()),
        progress: Arc::new(Notify::new()),
        #[cfg(test)]
        trace: std::sync::Mutex::new(Vec::new()),
        #[cfg(test)]
        observed: Arc::new(Notify::new()),
        #[cfg(test)]
        before_complete: std::sync::Mutex::new(None),
    });
    Ok((
        Ingress {
            shared: shared.clone(),
        },
        Endpoint {
            shared: Some(shared),
            io,
        },
    ))
}
impl Endpoint {
    /// The only public socket constructor applies caps BEFORE WS message assembly.
    pub fn upgrade(self, upgrade: WebSocketUpgrade) -> Response {
        self.upgrade_with(upgrade, |socket| socket)
    }
    fn upgrade_with<S, F>(self, upgrade: WebSocketUpgrade, wrap: F) -> Response
    where
        S: SocketIo,
        F: FnOnce(WebSocket) -> S + Send + 'static,
    {
        let io = self.io;
        upgrade
            .read_buffer_size(io.read_buffer_bytes)
            .max_message_size(io.inbound_message_bytes)
            .max_frame_size(io.inbound_frame_bytes)
            .write_buffer_size(io.write_buffer_bytes)
            .max_write_buffer_size(io.max_write_buffer_bytes)
            .on_upgrade(move |socket| {
                // Construct the Drop owner NOW, not inside the unpolled async body.
                let driver = self.driver(wrap(socket));
                #[cfg(test)]
                let observed = driver.shared.clone();
                async move {
                    let _ = driver.await;
                    #[cfg(test)]
                    observed.record(Trace::DriverFinished);
                }
            })
    }
    fn driver<S: SocketIo>(mut self, socket: S) -> Pump<S> {
        let shared = self.shared.take().expect("owned upgrade lease");
        Pump::new(socket, shared, self.io)
    }
}
impl Drop for Endpoint {
    fn drop(&mut self) {
        if let Some(shared) = self.shared.take() {
            shared.close();
            #[cfg(test)]
            shared.record(Trace::UpgradeDropped);
        }
    }
}

trait SocketIo:
    Sink<Message, Error = axum::Error>
    + Stream<Item = std::result::Result<Message, axum::Error>>
    + FusedStream
    + Unpin
    + Send
    + 'static
{
}
impl<S> SocketIo for S where
    S: Sink<Message, Error = axum::Error>
        + Stream<Item = std::result::Result<Message, axum::Error>>
        + FusedStream
        + Unpin
        + Send
        + 'static
{
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RecordStage {
    Ready,
    Flushing,
    // A real successful flush token. Never poll that operation again.
    TerminalCheck,
}
struct Record {
    lease: WriteRecord,
    stage: RecordStage,
    started: bool,
    #[cfg(test)]
    scene: u64,
    #[cfg(test)]
    index: usize,
}
struct Active {
    writer: Option<Writer>,
    record: Option<Record>,
    deadline: Pin<Box<Sleep>>,
}
enum Step {
    Advance,
    Blocked,
    Empty,
}

/// Whole-connection owner, including on unpolled-future cancellation.
struct Pump<S> {
    socket: Option<S>,
    shared: Arc<Shared>,
    io: SocketLimits,
    active: Option<Active>,
    work_wait: Pin<Box<OwnedNotified>>,
    idle: Pin<Box<Sleep>>,
    ack_wait: Option<Pin<Box<Sleep>>>,
    control_flush: bool,
    stopped: bool,
}
fn deadline(duration: Duration) -> Result<Instant> {
    Instant::now()
        .checked_add(duration)
        .ok_or(SocketError::Configuration)
}
impl<S> Pump<S> {
    fn new(socket: S, shared: Arc<Shared>, io: SocketLimits) -> Self {
        // SocketLimits::check bounded the duration; construction is inside upgrade runtime.
        let idle_at = deadline(io.idle_timeout).unwrap_or_else(|_| Instant::now());
        Self {
            socket: Some(socket),
            work_wait: Box::pin(shared.work.clone().notified_owned()),
            shared,
            io,
            active: None,
            idle: Box::pin(tokio::time::sleep_until(idle_at)),
            ack_wait: None,
            control_flush: false,
            stopped: false,
        }
    }
    fn stop(&mut self) {
        if self.stopped {
            return;
        }
        self.stopped = true;
        self.shared.close();
        // The whole unsplit socket MUST die before record/writer credit is released.
        drop(self.socket.take());
        #[cfg(test)]
        self.shared.record(Trace::SocketDropped);
        if let Some(mut active) = self.active.take() {
            if let Some(record) = active.record.take() {
                drop(record);
                #[cfg(test)]
                self.shared.record(Trace::RecordReleased);
            }
            if let Some(writer) = active.writer.take() {
                drop(writer);
                #[cfg(test)]
                self.shared.record(Trace::WriterReleased);
            }
        }
        self.shared.progress.notify_waiters();
    }
    fn fail(&mut self, error: SocketError) -> Poll<Result<()>> {
        #[cfg(test)]
        self.shared.record(Trace::Terminal(error));
        self.stop();
        Poll::Ready(Err(error))
    }
    /// Always enable/register before rechecking queue state. Bound notification churn.
    fn arm_work(&mut self, cx: &mut Context<'_>) -> bool {
        for _ in 0..2 {
            let _ = self.work_wait.as_mut().enable();
            if self.work_wait.as_mut().poll(cx).is_pending() {
                return true;
            }
            self.work_wait = Box::pin(self.shared.work.clone().notified_owned());
        }
        cx.waker().wake_by_ref();
        false
    }
    fn poll_deadlines(&mut self, cx: &mut Context<'_>) -> Result<()> {
        if self.shared.queue.meter().closed {
            return Err(SocketError::Closed);
        }
        if self.idle.as_mut().poll(cx).is_ready() {
            return Err(SocketError::Timeout("idle"));
        }
        if self
            .active
            .as_mut()
            .is_some_and(|a| a.deadline.as_mut().poll(cx).is_ready())
        {
            return Err(SocketError::Timeout("scene"));
        }
        if self
            .ack_wait
            .as_mut()
            .is_some_and(|a| a.as_mut().poll(cx).is_ready())
        {
            return Err(SocketError::Timeout("ack"));
        }
        Ok(())
    }
    fn ack_timer(&mut self, progress: bool) -> Result<()> {
        let m = self.shared.queue.meter();
        if m.acked >= m.written {
            self.ack_wait = None;
        } else if self.ack_wait.is_none() || progress {
            self.ack_wait = Some(Box::pin(tokio::time::sleep_until(deadline(
                self.io.ack_timeout,
            )?)));
        }
        Ok(())
    }
}
impl<S> Drop for Pump<S> {
    fn drop(&mut self) {
        self.stop();
    }
}
impl<S: SocketIo> Pump<S> {
    /// true only after actual Stream Pending. Quota exhaustion cannot certify absence.
    fn drain(&mut self, cx: &mut Context<'_>, left: &mut usize) -> Result<bool> {
        if self.socket.as_ref().is_none_or(FusedStream::is_terminated) {
            return Err(SocketError::Closed);
        }
        while *left > 0 {
            let message =
                match Pin::new(self.socket.as_mut().ok_or(SocketError::Closed)?).poll_next(cx) {
                    Poll::Pending => {
                        if self.socket.as_ref().is_some_and(FusedStream::is_terminated) {
                            return Err(SocketError::Closed);
                        }
                        return Ok(true);
                    }
                    Poll::Ready(None) => return Err(SocketError::Closed),
                    Poll::Ready(Some(Err(error))) => {
                        drop(error); // transport errors never escape with owned payloads
                        return Err(SocketError::Transport);
                    }
                    Poll::Ready(Some(Ok(message))) => message,
                };
            *left -= 1;
            match message {
                Message::Binary(bytes) => {
                    let ack = decode_ack(&bytes).map_err(|_| SocketError::Malformed)?;
                    let old = self.shared.queue.meter().acked;
                    let accepted = self
                        .shared
                        .queue
                        .ack(self.shared.generation, ack)
                        .map_err(|e| SocketError::Model(e.0))?;
                    let progress = self.shared.queue.meter().acked > old;
                    self.ack_timer(progress)?; // duplicate/deferred ACK never renews deadline
                    self.shared.progress.notify_waiters();
                    #[cfg(test)]
                    self.shared.record(Trace::Ack {
                        scene: ack.scene,
                        deferred: !accepted,
                    });
                    #[cfg(not(test))]
                    let _ = accepted;
                }
                Message::Ping(_) => self.control_flush = true, // library queues the Pong
                Message::Pong(_) => {}
                Message::Close(_) => return Err(SocketError::Closed),
                Message::Text(_) => return Err(SocketError::Malformed),
            }
            // Valid liveness is separate from the non-renewing ACK-progress timer.
            self.idle.as_mut().reset(deadline(self.io.idle_timeout)?);
        }
        cx.waker().wake_by_ref();
        Ok(false)
    }
    fn step(&mut self, cx: &mut Context<'_>, reads: &mut usize) -> Result<Step> {
        if self.active.is_none() {
            let Some(writer) = self
                .shared
                .queue
                .begin_write()
                .map_err(|e| SocketError::Model(e.0))?
            else {
                return Ok(Step::Empty);
            };
            self.active = Some(Active {
                writer: Some(writer),
                record: None,
                deadline: Box::pin(tokio::time::sleep_until(deadline(self.io.scene_timeout)?)),
            });
            return Ok(Step::Advance);
        }
        if self.active.as_ref().is_some_and(|a| a.record.is_none()) {
            let next = self
                .active
                .as_mut()
                .and_then(|a| a.writer.as_mut())
                .ok_or(SocketError::Model("writer"))?
                .next_record()
                .map_err(|e| SocketError::Model(e.0))?;
            if let Some(lease) = next {
                #[cfg(test)]
                let scene = u64::from_le_bytes(
                    lease
                        .bytes()
                        .get(18..26)
                        .ok_or(SocketError::Model("record header"))?
                        .try_into()
                        .map_err(|_| SocketError::Model("record header"))?,
                );
                #[cfg(test)]
                let index = lease.index;
                self.active.as_mut().ok_or(SocketError::Closed)?.record = Some(Record {
                    lease,
                    stage: RecordStage::Ready,
                    started: false,
                    #[cfg(test)]
                    scene,
                    #[cfg(test)]
                    index,
                });
            } else {
                let mut active = self.active.take().ok_or(SocketError::Closed)?;
                drop(active.writer.take());
                #[cfg(test)]
                self.shared.record(Trace::WriterReleased);
                // ACK may have cleared retention while the last Writer still held credit.
                self.shared.progress.notify_waiters();
            }
            return Ok(Step::Advance);
        }
        let stage = self
            .active
            .as_ref()
            .and_then(|a| a.record.as_ref())
            .ok_or(SocketError::Model("record"))?
            .stage;
        match stage {
            RecordStage::Ready => {
                let record = self
                    .active
                    .as_mut()
                    .and_then(|a| a.record.as_mut())
                    .ok_or(SocketError::Model("record"))?;
                if !record.started {
                    // Conservative first real Sink-operation poll, not a syscall assertion.
                    record.lease.start().map_err(|e| SocketError::Model(e.0))?;
                    record.started = true;
                    #[cfg(test)]
                    self.shared.record(Trace::Started {
                        scene: record.scene,
                        record: record.index,
                    });
                }
                let socket = self.socket.as_mut().ok_or(SocketError::Closed)?;
                match Pin::new(&mut *socket).poll_ready(cx) {
                    Poll::Pending => return Ok(Step::Blocked),
                    Poll::Ready(Err(error)) => {
                        drop(error);
                        return Err(SocketError::Transport);
                    }
                    Poll::Ready(Ok(())) => {}
                }
                // Move the exact charged allocation; never bytes().to_vec(). The lease stays.
                let bytes = std::mem::take(&mut record.lease.bytes);
                if let Err(error) = Pin::new(socket).start_send(Message::Binary(bytes.into())) {
                    // WriteBufferFull may own the unsent Binary. Drop before guard credit.
                    drop(error);
                    return Err(SocketError::Transport);
                }
                record.stage = RecordStage::Flushing;
                Ok(Step::Advance)
            }
            RecordStage::Flushing => {
                match Pin::new(self.socket.as_mut().ok_or(SocketError::Closed)?).poll_flush(cx) {
                    Poll::Pending => return Ok(Step::Blocked),
                    Poll::Ready(Err(error)) => {
                        drop(error);
                        return Err(SocketError::Transport);
                    }
                    Poll::Ready(Ok(())) => {}
                }
                let record = self
                    .active
                    .as_mut()
                    .and_then(|a| a.record.as_mut())
                    .ok_or(SocketError::Model("record"))?;
                record.stage = RecordStage::TerminalCheck;
                #[cfg(test)]
                self.shared.record(Trace::Flushed {
                    scene: record.scene,
                    record: record.index,
                });
                self.control_flush = false;
                Ok(Step::Advance)
            }
            RecordStage::TerminalCheck => {
                // ConnectionClosed can map to flush Ok. No completion before actual read
                // Pending + active context; exhausted quota retains the real success token.
                if !self.drain(cx, reads)? {
                    return Ok(Step::Blocked);
                }
                self.poll_deadlines(cx)?;
                #[cfg(test)]
                {
                    let hook = self.shared.before_complete.lock().unwrap().take();
                    if let Some(hook) = hook {
                        hook(&self.shared);
                    }
                }
                let record = self
                    .active
                    .as_mut()
                    .and_then(|a| a.record.as_mut())
                    .ok_or(SocketError::Model("record"))?;
                let before = self.shared.queue.meter().acked;
                #[cfg(test)]
                let (scene, index) = (record.scene, record.index);
                record
                    .lease
                    .complete_borrowed()
                    .map_err(|e| SocketError::Model(e.0))?;
                // On Err the guard remains inside this Drop owner; stop() drops the
                // whole socket first. Only successful borrowed completion may take it.
                drop(
                    self.active
                        .as_mut()
                        .and_then(|a| a.record.take())
                        .ok_or(SocketError::Model("record"))?,
                );
                #[cfg(test)]
                self.shared.record(Trace::Completed {
                    scene,
                    record: index,
                });
                self.ack_timer(self.shared.queue.meter().acked > before)?;
                self.shared.progress.notify_waiters();
                Ok(Step::Advance)
            }
        }
    }
}
impl<S: SocketIo> Future for Pump<S> {
    type Output = Result<()>;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.get_mut();
        if this.stopped {
            return Poll::Ready(Err(SocketError::Closed));
        }
        let armed = this.arm_work(cx);
        if let Err(error) = this.poll_deadlines(cx) {
            return this.fail(error);
        }
        if !armed {
            return Poll::Pending;
        }
        let mut reads = this.io.read_quota;
        if let Err(error) = this.drain(cx, &mut reads) {
            return this.fail(error);
        }
        for _ in 0..this.io.write_quota {
            if let Err(error) = this.poll_deadlines(cx) {
                return this.fail(error);
            }
            match this.step(cx, &mut reads) {
                Err(error) => return this.fail(error),
                Ok(Step::Advance) => {}
                Ok(Step::Blocked) => return Poll::Pending,
                Ok(Step::Empty) => {
                    if this.control_flush {
                        let Some(socket) = this.socket.as_mut() else {
                            return this.fail(SocketError::Closed);
                        };
                        match Pin::new(socket).poll_flush(cx) {
                            Poll::Ready(Ok(())) => this.control_flush = false,
                            Poll::Ready(Err(error)) => {
                                drop(error);
                                return this.fail(SocketError::Transport);
                            }
                            Poll::Pending => {}
                        }
                    }
                    return Poll::Pending;
                }
            }
        }
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}

#[cfg(test)]
#[derive(Clone, Debug, PartialEq, Eq)]
enum Trace {
    Started { scene: u64, record: usize },
    Flushed { scene: u64, record: usize },
    Completed { scene: u64, record: usize },
    Ack { scene: u64, deferred: bool },
    SocketDropped,
    RecordReleased,
    WriterReleased,
    Terminal(SocketError),
    DriverFinished,
    UpgradeDropped,
}
#[cfg(test)]
mod tests;
