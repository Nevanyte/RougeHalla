//! Bounded ownership/configuration controls over the sealed current14 fixture bytes.
//! Core writes/ACKs below are explicitly model inputs, never claims of socket delivery.

use super::*;
use futures_util::FutureExt;
use std::future::Future;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::task::{Wake, Waker};
use tokio::sync::futures::OwnedNotified;

const UNIT_GENERATION: u64 = 7001;

fn fixture_channel(slots: usize) -> (Ingress, Endpoint, Limits, Meta, Vec<Vec<u8>>) {
    let (codec, meta, frames) = source_case("native-prepared-small");
    let mut limits = queue_limits();
    limits.scenes = slots;
    let (ingress, endpoint) =
        channel(UNIT_GENERATION, meta.epoch, codec, limits, socket_limits()).unwrap();
    (ingress, endpoint, codec, meta, frames)
}

fn publication(sample: u64) -> Publication {
    Publication {
        alias_cursor: sample,
        sample_cursor: sample,
    }
}

fn successor(meta: Meta) -> Meta {
    Meta {
        scene: meta.scene + 1,
        cue_from: meta.cue_through,
        cue_through: meta.cue_through,
        ..meta
    }
}

type Notices = (Pin<Box<OwnedNotified>>, Pin<Box<OwnedNotified>>);

fn armed_notices(shared: &Shared) -> Notices {
    // Consume an admission's existing work permit before measuring a later wake.
    let _ = shared.work.notified().now_or_never();
    let _ = shared.progress.notified().now_or_never();
    let mut work = Box::pin(shared.work.clone().notified_owned());
    let mut progress = Box::pin(shared.progress.clone().notified_owned());
    let _ = work.as_mut().enable();
    let _ = progress.as_mut().enable();
    // Registration precedes every following closed/capacity check or mutation.
    (work, progress)
}

fn assert_notices_ready((work, progress): Notices) {
    assert!(
        work.now_or_never().is_some(),
        "work waiter was not signalled"
    );
    assert!(
        progress.now_or_never().is_some(),
        "progress waiter was not signalled"
    );
}

#[derive(Debug, PartialEq)]
struct StoredScene {
    meta: Meta,
    body: Vec<u8>,
    records: Vec<Vec<u8>>,
    publication: Publication,
}

fn stored_scene(shared: &Shared, id: u64) -> StoredScene {
    let state = shared.queue.0.lock().unwrap();
    let entry = state.entries.get(&id).expect("same retained entry");
    StoredScene {
        meta: entry.scene.meta(),
        body: entry.scene.body().to_vec(),
        records: (0..entry.scene.record_count())
            .map(|index| entry.scene.record(index).unwrap())
            .collect(),
        publication: entry.publication,
    }
}

#[derive(Default)]
struct WakeCounter(AtomicUsize);

impl Wake for WakeCounter {
    fn wake(self: Arc<Self>) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }

    fn wake_by_ref(self: &Arc<Self>) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

#[tokio::test]
async fn checked_configuration_precedes_endpoint_construction() {
    let (codec, meta, _) = source_case("native-prepared-small");
    let valid = socket_limits();
    let mut invalid = Vec::new();
    macro_rules! invalid_field {
        ($field:ident, $value:expr) => {{
            let mut value = valid;
            value.$field = $value;
            invalid.push((stringify!($field), value));
        }};
    }
    invalid_field!(read_buffer_bytes, 0);
    invalid_field!(read_buffer_bytes, usize::MAX);
    invalid_field!(inbound_frame_bytes, ACK_BYTES - 1);
    invalid_field!(inbound_message_bytes, valid.inbound_frame_bytes - 1);
    invalid_field!(inbound_message_bytes, usize::MAX);
    invalid_field!(max_write_buffer_bytes, valid.write_buffer_bytes);
    invalid_field!(
        max_write_buffer_bytes,
        valid.write_buffer_bytes + codec.frame_bytes
    );
    invalid_field!(write_buffer_bytes, usize::MAX);
    invalid_field!(read_quota, 0);
    invalid_field!(write_quota, 0);
    invalid_field!(scene_timeout, Duration::ZERO);
    invalid_field!(ack_timeout, Duration::ZERO);
    invalid_field!(idle_timeout, Duration::ZERO);
    invalid_field!(scene_timeout, Duration::MAX);
    invalid_field!(ack_timeout, Duration::MAX);
    invalid_field!(idle_timeout, Duration::MAX);
    for (field, limits) in invalid {
        assert!(
            matches!(
                channel(UNIT_GENERATION, meta.epoch, codec, queue_limits(), limits),
                Err(SocketError::Configuration)
            ),
            "invalid {field} must not produce an Endpoint"
        );
    }
    let mut minimum = valid;
    minimum.read_buffer_bytes = 1;
    minimum.inbound_frame_bytes = ACK_BYTES;
    minimum.inbound_message_bytes = ACK_BYTES;
    minimum.write_buffer_bytes = 0; // A zero flush threshold is permitted, not an unbounded cap.
    minimum.max_write_buffer_bytes = codec.frame_bytes + WS_HEADER + CONTROL_BYTES + WS_HEADER;
    minimum.read_quota = 1;
    minimum.write_quota = 1;
    let (ingress, endpoint) =
        channel(UNIT_GENERATION, meta.epoch, codec, queue_limits(), minimum).unwrap();
    assert_eq!(endpoint.io.inbound_message_bytes, ACK_BYTES);
    assert_eq!(endpoint.io.inbound_frame_bytes, ACK_BYTES);
    assert_eq!(endpoint.io.read_quota, 1);
    assert_eq!(endpoint.io.write_quota, 1);
    assert!(!ingress.meter().closed);
    // This proves checked Endpoint construction, not actual pre-assembly enforcement.
    // The real WebSocket oversized-message control belongs to the loopback tests.
    drop(endpoint);
    assert!(ingress.meter().closed);
}

#[tokio::test]
async fn admitted_pending_drop_is_disarmed_but_repeat_admission_is_terminal() {
    let (ingress, endpoint, _, meta, frames) = fixture_channel(1);
    let mut first = ingress
        .prepare(meta, frames.clone(), publication(1))
        .unwrap();
    first.try_admit().unwrap();
    let admitted = ingress.meter();
    drop(first);
    assert_eq!(
        ingress.meter(),
        admitted,
        "wrapper Drop must not close admitted FIFO"
    );

    let next_meta = successor(meta);
    let mut next = ingress.prepare(next_meta, frames, publication(2)).unwrap();
    assert_eq!(next.try_admit(), Err(SocketError::Full));
    drop(endpoint);
    assert!(ingress.meter().closed);
    drop(next);
    assert_eq!(ingress.meter().pending_bytes, 0);
    assert_eq!(ingress.meter().outstanding_bytes, 0);

    let (ingress, _endpoint, _, meta, frames) = fixture_channel(1);
    let mut pending = ingress.prepare(meta, frames, publication(1)).unwrap();
    pending.try_admit().unwrap();
    let notices = armed_notices(&ingress.shared);
    assert!(!ingress.meter().closed);
    assert_eq!(
        pending.try_admit(),
        Err(SocketError::Model("already admitted"))
    );
    assert!(ingress.meter().closed);
    assert_notices_ready(notices);
}

#[tokio::test]
async fn nonfull_prepare_and_publication_errors_close_and_wake() {
    let (ingress, _endpoint, _, meta, _) = fixture_channel(1);
    let notices = armed_notices(&ingress.shared);
    assert!(!ingress.meter().closed);
    assert!(matches!(
        ingress.prepare(meta, Vec::new(), publication(1)),
        Err(SocketError::Model("frames"))
    ));
    assert!(ingress.meter().closed);
    assert_notices_ready(notices);

    let (ingress, _endpoint, _, meta, frames) = fixture_channel(1);
    let mut out_of_order = ingress
        .prepare(successor(meta), frames, publication(1))
        .unwrap();
    let notices = armed_notices(&ingress.shared);
    assert!(!ingress.meter().closed);
    assert_eq!(
        out_of_order.try_admit(),
        Err(SocketError::Model("publication"))
    );
    assert!(ingress.meter().closed);
    assert_notices_ready(notices);
    assert!(
        ingress.meter().pending_bytes > 0,
        "owner still retains exact pending source"
    );
    drop(out_of_order);
    assert_eq!(ingress.meter().pending_bytes, 0);
}

#[tokio::test]
async fn pending_reservation_failure_is_terminal_without_discarding_existing_owner() {
    let (codec, meta, frames) = source_case("native-prepared-small");
    let mut limits = queue_limits();
    limits.pending_scenes = 1;
    let (ingress, _endpoint) =
        channel(UNIT_GENERATION, meta.epoch, codec, limits, socket_limits()).unwrap();
    let held = ingress
        .prepare(meta, frames.clone(), publication(1))
        .unwrap();
    let notices = armed_notices(&ingress.shared);
    assert!(!ingress.meter().closed);
    assert!(matches!(
        ingress.prepare(successor(meta), frames, publication(2)),
        Err(SocketError::Model("pending capacity"))
    ));
    assert!(ingress.meter().closed);
    assert_notices_ready(notices);
    assert_eq!(ingress.meter().pending_scenes, 1);
    assert!(ingress.meter().pending_bytes > 0);
    drop(held);
    assert_eq!(ingress.meter().pending_scenes, 0);
    assert_eq!(ingress.meter().pending_bytes, 0);
}

#[tokio::test]
async fn full_preserves_the_exact_pending_and_wait_admit_closes_without_lost_wake() {
    let (ingress, _endpoint, _, meta, frames) = fixture_channel(1);
    drop(admit(&ingress, meta, frames.clone(), 1));
    let mut pending = ingress
        .prepare(successor(meta), frames, publication(2))
        .unwrap();
    let core = pending.pending.as_ref().unwrap();
    let id = core.id;
    let generation = core.generation;
    let original = stored_scene(&ingress.shared, id);
    let before = pending.meter();
    let notices = armed_notices(&ingress.shared);
    assert_eq!(pending.try_admit(), Err(SocketError::Full));
    assert_eq!(pending.meter(), before);
    assert_eq!(pending.pending.as_ref().unwrap().id, id);
    assert_eq!(pending.pending.as_ref().unwrap().generation, generation);
    assert_eq!(pending.meta().unwrap(), original.meta);
    assert_eq!(stored_scene(&ingress.shared, id), original);
    assert!(notices.0.now_or_never().is_none());
    assert!(notices.1.now_or_never().is_none());

    let wakes = Arc::new(WakeCounter::default());
    let waker = Waker::from(wakes.clone());
    let mut cx = Context::from_waker(&waker);
    let mut waiting = Box::pin(pending.wait_admit());
    assert!(waiting.as_mut().poll(&mut cx).is_pending());
    wakes.0.store(0, Ordering::SeqCst);
    ingress.close();
    assert!(
        wakes.0.load(Ordering::SeqCst) > 0,
        "close must wake the registered waiter"
    );
    assert_eq!(
        waiting.as_mut().poll(&mut cx),
        Poll::Ready(Err(SocketError::Model("closed")))
    );
    drop(waiting);
    assert_eq!(ingress.meter().pending_bytes, 0);
    assert_eq!(ingress.meter().outstanding_bytes, 0);
}

#[tokio::test]
async fn cancelling_a_waiting_pending_closes_and_signals_its_captured_context() {
    for poll_first in [false, true] {
        let (ingress, _endpoint, _, meta, frames) = fixture_channel(1);
        drop(admit(&ingress, meta, frames.clone(), 1));
        let pending = ingress
            .prepare(successor(meta), frames, publication(2))
            .unwrap();
        let mut waiting = Box::pin(pending.wait_admit());
        if poll_first {
            let wakes = Arc::new(WakeCounter::default());
            let waker = Waker::from(wakes);
            let mut cx = Context::from_waker(&waker);
            assert!(waiting.as_mut().poll(&mut cx).is_pending());
        }
        let notices = armed_notices(&ingress.shared);
        assert!(!ingress.meter().closed);
        drop(waiting);
        assert!(ingress.meter().closed);
        assert_notices_ready(notices);
        assert_eq!(ingress.meter().pending_bytes, 0);
        assert_eq!(ingress.meter().outstanding_bytes, 0);
    }
}

#[tokio::test]
async fn wait_admit_checks_a_close_that_precedes_its_first_notification_registration() {
    let (ingress, _endpoint, _, meta, frames) = fixture_channel(1);
    drop(admit(&ingress, meta, frames.clone(), 1));
    let pending = ingress
        .prepare(successor(meta), frames, publication(2))
        .unwrap();
    let mut waiting = Box::pin(pending.wait_admit());
    ingress.close(); // notify_waiters does not retain a permit for this unpolled future.
    let wakes = Arc::new(WakeCounter::default());
    let waker = Waker::from(wakes);
    let mut cx = Context::from_waker(&waker);
    assert_eq!(
        waiting.as_mut().poll(&mut cx),
        Poll::Ready(Err(SocketError::Model("closed")))
    );
    drop(waiting);
    assert_eq!(ingress.meter().pending_bytes, 0);
}

#[tokio::test]
async fn model_only_writer_release_really_wakes_the_same_waiting_pending() {
    let (ingress, endpoint, _, meta, frames) = fixture_channel(1);
    drop(admit(&ingress, meta, frames.clone(), 1));
    let mut writer = ingress.shared.queue.begin_write().unwrap().unwrap();
    // Explicit existing-core model inputs: no socket write/flush claim in this unit control.
    while let Some(mut record) = writer.next_record().unwrap() {
        record.start().unwrap();
        record.complete().unwrap();
    }
    let pending = ingress
        .prepare(successor(meta), frames, publication(2))
        .unwrap();
    let id = pending.pending.as_ref().unwrap().id;
    let original = stored_scene(&ingress.shared, id);
    let mut pump = endpoint.driver(NeverPolledSocket);
    pump.active = Some(Active {
        writer: Some(writer),
        record: None,
        deadline: Box::pin(tokio::time::sleep(Duration::from_secs(2))),
    });
    let wakes = Arc::new(WakeCounter::default());
    let waker = Waker::from(wakes.clone());
    let mut cx = Context::from_waker(&waker);
    let mut waiting = Box::pin(pending.wait_admit());
    assert!(waiting.as_mut().poll(&mut cx).is_pending());
    wakes.0.store(0, Ordering::SeqCst);
    assert!(ingress
        .shared
        .queue
        .ack(
            UNIT_GENERATION,
            Ack {
                epoch: meta.epoch,
                scene: meta.scene,
                cue_through: meta.cue_through,
            },
        )
        .unwrap());
    assert_eq!(ingress.meter().acked, meta.scene);
    assert_eq!(
        ingress.meter().scenes,
        1,
        "Writer still owns the acknowledged scene"
    );
    assert!(ingress.meter().outstanding_bytes > 0);
    assert_eq!(
        wakes.0.load(Ordering::SeqCst),
        0,
        "raw core ACK is not a socket notification"
    );

    let mut reads = 1;
    assert!(matches!(pump.step(&mut cx, &mut reads), Ok(Step::Advance)));
    assert!(pump.active.is_none());
    assert!(
        wakes.0.load(Ordering::SeqCst) > 0,
        "actual driver Writer-drop path must notify"
    );
    assert_eq!(waiting.as_mut().poll(&mut cx), Poll::Ready(Ok(())));
    assert_eq!(stored_scene(&ingress.shared, id), original);
    assert_eq!(ingress.meter().published, meta.scene + 1);
    assert_eq!(ingress.meter().pending_scenes, 0);
    assert!(!ingress.meter().closed);
    drop(waiting);
    drop(pump);
    assert!(ingress.meter().closed);
    assert_eq!(ingress.meter().outstanding_bytes, 0);
}

#[tokio::test]
async fn final_producer_arc_drop_closes_even_while_driver_owns_shared() {
    let (ingress, endpoint, _, _, _) = fixture_channel(1);
    let producer = Arc::new(ingress);
    let last = producer.clone();
    let shared = producer.shared.clone();
    let pump = endpoint.driver(NeverPolledSocket);
    drop(producer);
    assert!(
        !shared.queue.meter().closed,
        "one producer Arc still exists"
    );
    let notices = armed_notices(&shared);
    drop(last);
    assert!(
        shared.queue.meter().closed,
        "driver Shared must not retain the producer"
    );
    assert_notices_ready(notices);
    assert!(pump.socket.is_some(), "driver has not run or been dropped");
    drop(pump);
    assert_eq!(shared.queue.meter().outstanding_bytes, 0);
}

#[tokio::test]
async fn unused_endpoint_drop_closes_and_wakes_without_socket_construction() {
    let (ingress, endpoint, _, _, _) = fixture_channel(1);
    let notices = armed_notices(&ingress.shared);
    assert!(!ingress.meter().closed);
    drop(endpoint);
    assert!(ingress.meter().closed);
    assert_notices_ready(notices);
    assert_eq!(ingress.meter().pending_scenes, 0);
    assert_eq!(ingress.meter().scenes, 0);
}
