//! INJECTED SocketIo controls over the actual Pump. No TCP, real flush or delivery proof.
//! Ready results below belong to a labelled fake Sink; timers use only paused Tokio time.
use super::*;
use std::{
    collections::VecDeque,
    future::Future,
    sync::atomic::{AtomicUsize, Ordering},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Fault {
    None,
    Ready,
    Send,
    Flush,
    PendingFlush,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Dropped {
    Error,
    Socket,
}
#[derive(Debug)]
struct DropSnapshot {
    kind: Dropped,
    meter: Meter,
    payload: usize,
}
type Drops = Arc<Mutex<Vec<DropSnapshot>>>;
type Input = Arc<Mutex<VecDeque<ServerMessage>>>;

fn payload(message: Option<&ServerMessage>) -> usize {
    match message {
        Some(ServerMessage::Binary(bytes)) => bytes.len(),
        _ => 0,
    }
}
struct OwnedError {
    message: Option<ServerMessage>,
    shared: Arc<Shared>,
    drops: Drops,
}
impl std::fmt::Display for OwnedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("injected owned sink error")
    }
}
impl std::fmt::Debug for OwnedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Display::fmt(self, f)
    }
}
impl std::error::Error for OwnedError {}
impl Drop for OwnedError {
    fn drop(&mut self) {
        let meter = self.shared.queue.meter();
        assert!(
            meter.scratch_bytes > 0 && meter.outstanding_bytes > 0,
            "owned error must die while the record and Writer remain charged"
        );
        self.drops.lock().unwrap().push(DropSnapshot {
            kind: Dropped::Error,
            meter,
            payload: payload(self.message.as_ref()),
        });
    }
}
struct Injected {
    shared: Arc<Shared>,
    drops: Drops,
    input: Input,
    fault: Fault,
    target: usize,
    index: usize,
    outgoing: Option<ServerMessage>,
    flushes: Arc<AtomicUsize>,
}
impl Injected {
    fn error(&self, message: Option<ServerMessage>) -> axum::Error {
        axum::Error::new(OwnedError {
            message,
            shared: self.shared.clone(),
            drops: self.drops.clone(),
        })
    }
}
impl Drop for Injected {
    fn drop(&mut self) {
        self.drops.lock().unwrap().push(DropSnapshot {
            kind: Dropped::Socket,
            meter: self.shared.queue.meter(),
            payload: payload(self.outgoing.as_ref()),
        });
    }
}
impl Stream for Injected {
    type Item = std::result::Result<ServerMessage, axum::Error>;
    fn poll_next(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let message = self.input.lock().unwrap().pop_front();
        match message {
            Some(message) => Poll::Ready(Some(Ok(message))),
            None => Poll::Pending,
        }
    }
}
impl FusedStream for Injected {
    fn is_terminated(&self) -> bool {
        false
    }
}
impl Sink<ServerMessage> for Injected {
    type Error = axum::Error;
    fn poll_ready(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<std::result::Result<(), Self::Error>> {
        if self.fault == Fault::Ready && self.index == self.target {
            Poll::Ready(Err(self.error(None)))
        } else {
            Poll::Ready(Ok(()))
        }
    }
    fn start_send(
        mut self: Pin<&mut Self>,
        message: ServerMessage,
    ) -> std::result::Result<(), Self::Error> {
        if self.fault == Fault::Send && self.index == self.target {
            return Err(self.error(Some(message))); // Own the actual moved record allocation.
        }
        assert!(self.outgoing.is_none());
        self.outgoing = Some(message);
        Ok(())
    }
    fn poll_flush(
        mut self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<std::result::Result<(), Self::Error>> {
        self.flushes.fetch_add(1, Ordering::SeqCst);
        if self.index == self.target {
            if self.fault == Fault::Flush {
                return Poll::Ready(Err(self.error(None)));
            }
            if self.fault == Fault::PendingFlush {
                return Poll::Pending;
            }
        }
        if self.outgoing.take().is_some() {
            self.index += 1;
        }
        Poll::Ready(Ok(())) // INJECTED eligibility, never an assertion about TCP flushing.
    }
    fn poll_close(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<std::result::Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }
}
fn rig(fault: Fault, target: usize) -> (Ingress, Pump<Injected>, Input, Drops) {
    let (_, meta, _) = source_case("native-prepared-small");
    let (ingress, endpoint) = test_channel(meta, queue_limits());
    let input = Arc::new(Mutex::new(VecDeque::new()));
    let drops = Arc::new(Mutex::new(Vec::new()));
    let socket = Injected {
        shared: ingress.shared.clone(),
        drops: drops.clone(),
        input: input.clone(),
        fault,
        target,
        index: 0,
        outgoing: None,
        flushes: Arc::new(AtomicUsize::new(0)),
    };
    (ingress, endpoint.driver(socket), input, drops)
}
fn poll_pump(pump: &mut Pump<Injected>) -> Poll<std::result::Result<(), SocketError>> {
    let waker = futures_util::task::noop_waker();
    Pin::new(pump).poll(&mut Context::from_waker(&waker))
}
fn assert_reclaimed(shared: &Shared) {
    let m = shared.queue.meter();
    assert!(m.closed);
    assert_eq!((m.scratch_bytes, m.outstanding_bytes, m.entries), (0, 0, 0));
}
fn assert_active_socket_dropped_first(drops: &Drops) {
    let drops = drops.lock().unwrap();
    let at_socket = drops.iter().find(|d| d.kind == Dropped::Socket).unwrap();
    assert!(at_socket.meter.closed);
    assert!(at_socket.meter.scratch_bytes > 0 && at_socket.meter.outstanding_bytes > 0);
}

#[tokio::test(start_paused = true)]
async fn injected_error_matrix_retains_leases_until_socket_and_owned_error_drop() {
    let (codec, meta, frames) = source_case("native-prepared-small");
    let records = scene_records(meta, &frames, codec);
    for fault in [Fault::Ready, Fault::Send, Fault::Flush] {
        for target in 0..records.len() {
            let (ingress, mut pump, _, drops) = rig(fault, target);
            drop(admit(&ingress, meta, frames.clone(), 1));
            let mut result = Poll::Pending;
            for _ in 0..records.len() * 8 {
                result = poll_pump(&mut pump);
                if result.is_ready() {
                    break;
                }
            }
            assert_eq!(
                result,
                Poll::Ready(Err(SocketError::Transport)),
                "{fault:?}/{target}"
            );
            assert_eq!(
                ingress.meter().written,
                0,
                "no failed COMMIT acquires credit"
            );
            assert_eq!(ingress.meter().acked, 0);
            assert_active_socket_dropped_first(&drops);
            let snapshots = drops.lock().unwrap();
            assert_eq!(snapshots.len(), 2);
            assert_eq!(
                (snapshots[0].kind, snapshots[1].kind),
                (Dropped::Error, Dropped::Socket)
            );
            assert!(!snapshots[0].meter.closed);
            assert_eq!(
                snapshots[0].payload,
                if fault == Fault::Send {
                    records[target].len()
                } else {
                    0
                }
            );
            assert_eq!(
                snapshots[1].payload,
                if fault == Fault::Flush {
                    records[target].len()
                } else {
                    0
                }
            );
            drop(snapshots);
            assert_reclaimed(&ingress.shared);
        }
    }
}

#[tokio::test(start_paused = true)]
async fn injected_pending_flush_obeys_one_fixed_scene_deadline_despite_control_progress() {
    let (_, meta, frames) = source_case("native-prepared-small");
    let (ingress, mut pump, input, drops) = rig(Fault::PendingFlush, 0);
    drop(admit(&ingress, meta, frames, 1));
    assert!(poll_pump(&mut pump).is_pending());
    let fixed = pump.active.as_ref().unwrap().deadline.deadline();
    tokio::time::advance(Duration::from_secs(1)).await;
    input
        .lock()
        .unwrap()
        .push_back(ServerMessage::Ping(Vec::new().into()));
    assert!(poll_pump(&mut pump).is_pending());
    assert_eq!(pump.active.as_ref().unwrap().deadline.deadline(), fixed);
    tokio::time::advance(Duration::from_secs(2)).await;
    assert_eq!(
        poll_pump(&mut pump),
        Poll::Ready(Err(SocketError::Timeout("scene")))
    );
    assert_eq!(ingress.meter().written, 0);
    assert_active_socket_dropped_first(&drops);
    assert_reclaimed(&ingress.shared);
}

fn model_written(ingress: &Ingress, meta: Meta, frames: Vec<Vec<u8>>, sample: u64) {
    drop(admit(ingress, meta, frames, sample));
    let mut writer = ingress.shared.queue.begin_write().unwrap().unwrap();
    // Existing core model transitions only; these do not attest socket I/O.
    while let Some(mut record) = writer.next_record().unwrap() {
        record.start().unwrap();
        record.complete().unwrap();
    }
}
#[tokio::test(start_paused = true)]
async fn injected_duplicate_ack_and_controls_never_renew_ack_deadline_invalid_ack_closes() {
    for invalid in [false, true] {
        let (_, meta, frames) = source_case("native-prepared-small");
        let (ingress, mut pump, input, _) = rig(Fault::None, 0);
        let first_ack = Ack {
            epoch: meta.epoch,
            scene: meta.scene,
            cue_through: meta.cue_through,
        };
        model_written(&ingress, meta, frames.clone(), 1);
        ingress
            .shared
            .queue
            .ack(ingress.shared.generation, first_ack)
            .unwrap();
        let second = Meta {
            scene: meta.scene + 1,
            ..meta
        };
        model_written(&ingress, second, frames, 2);
        pump.ack_timer(false).unwrap(); // Same timer seam used after completion, with model-only setup.
        let fixed = pump.ack_wait.as_ref().unwrap().deadline();
        tokio::time::advance(Duration::from_secs(1)).await;
        input.lock().unwrap().extend([
            ServerMessage::Binary(rh_protocol::scene_candidate::encode_ack(first_ack).into()),
            ServerMessage::Ping(Vec::new().into()),
            ServerMessage::Pong(Vec::new().into()),
        ]);
        assert!(poll_pump(&mut pump).is_pending());
        assert_eq!(pump.ack_wait.as_ref().unwrap().deadline(), fixed);
        assert_eq!(ingress.meter().acked, meta.scene);
        if invalid {
            input.lock().unwrap().push_back(ServerMessage::Binary(
                rh_protocol::scene_candidate::encode_ack(Ack {
                    cue_through: 1,
                    scene: second.scene,
                    ..first_ack
                })
                .into(),
            ));
            assert_eq!(
                poll_pump(&mut pump),
                Poll::Ready(Err(SocketError::Model("ack tuple")))
            );
        } else {
            tokio::time::advance(Duration::from_secs(2)).await;
            assert_eq!(
                poll_pump(&mut pump),
                Poll::Ready(Err(SocketError::Timeout("ack")))
            );
        }
        assert_eq!(pump.ack_wait.as_ref().unwrap().deadline(), fixed);
        assert_eq!(
            (ingress.meter().written, ingress.meter().acked),
            (second.scene, meta.scene)
        );
        assert_reclaimed(&ingress.shared);
    }
}

#[tokio::test(start_paused = true)]
async fn injected_success_token_waits_for_stream_pending_and_queued_close_wins() {
    let (codec, meta, frames) = source_case("native-prepared-small");
    let count = scene_records(meta, &frames, codec).len();
    for close in [false, true] {
        let (ingress, mut pump, input, drops) = rig(Fault::None, 0);
        drop(admit(&ingress, meta, frames.clone(), 1));
        let waker = futures_util::task::noop_waker();
        let mut cx = Context::from_waker(&waker);
        for _ in 0..count * 6 + 2 {
            if pump
                .active
                .as_ref()
                .and_then(|a| a.record.as_ref())
                .is_some_and(|r| r.index == count - 1 && r.stage == RecordStage::TerminalCheck)
            {
                break;
            }
            assert!(matches!(pump.step(&mut cx, &mut 8), Ok(Step::Advance)));
        }
        let record = pump.active.as_ref().unwrap().record.as_ref().unwrap();
        assert_eq!(record.index, count - 1);
        assert!(record.stage == RecordStage::TerminalCheck);
        let flushes = pump.socket.as_ref().unwrap().flushes.load(Ordering::SeqCst);
        input
            .lock()
            .unwrap()
            .push_back(ServerMessage::Ping(Vec::new().into()));
        if close {
            input.lock().unwrap().push_back(ServerMessage::Close(None));
        }
        assert!(matches!(pump.step(&mut cx, &mut 1), Ok(Step::Blocked)));
        assert_eq!(
            ingress.meter().written,
            0,
            "quota exhaustion is not Stream Pending"
        );
        assert_eq!(
            pump.socket.as_ref().unwrap().flushes.load(Ordering::SeqCst),
            flushes
        );
        if close {
            assert_eq!(poll_pump(&mut pump), Poll::Ready(Err(SocketError::Closed)));
            assert_eq!(ingress.meter().written, 0);
            assert_active_socket_dropped_first(&drops);
        } else {
            assert!(matches!(pump.step(&mut cx, &mut 1), Ok(Step::Advance)));
            assert_eq!(ingress.meter().written, meta.scene);
            assert_eq!(
                pump.socket.as_ref().unwrap().flushes.load(Ordering::SeqCst),
                flushes
            );
            pump.stop();
        }
        assert_reclaimed(&ingress.shared);
    }
}
