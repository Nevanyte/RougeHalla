//! Protocol v3 snapshot deltas through the real publish path and the real outbox (docs/adr/0010-snapshot-delta.md): over a whole
//! recorded match, for every viewer, what a client holds after applying the frames its connection's writer produced equals
//! the decoded Full frame of the same tick, whatever the writer skipped; a resumed connection starts Full; a resync is
//! answered with a Full frame; and a delta never names an actor the viewer was not told about (C-OBS).

use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_policy::scripted::Brawler;
use rh_protocol::{ServerMsg, SnapshotData, SnapshotTracker};
use rh_server::outbox::Outbox;
use rh_server::wire::Publisher;
use rh_sim::{FactionId, SimConfig};
use std::collections::BTreeSet;
use std::sync::Arc;

fn seed1_match(ticks: u32) -> Env {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/maps/seed1.map.json"
    );
    let arena = rh_headless::load_arena(path).expect("seed-1 map");
    let agents = (0..8)
        .map(|i| AgentSpec {
            profile: format!("b{i}"),
            faction: FactionId::ALL[i % 5],
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(Brawler::new(2)),
            },
        })
        .collect();
    Env::new(
        EnvConfig {
            arena,
            sim: SimConfig::default(),
            max_ticks: ticks,
            record: false,
        },
        agents,
        1,
    )
}

fn full_frame(s: &SnapshotData) -> Vec<u8> {
    let mut v = Vec::new();
    s.encode_full_into(&mut v);
    v
}

struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0 >> 33
    }
}

/// One viewer's connection as the room and the writer see it: an outbox, a client decoder, and what the client was told.
struct Viewer {
    out: Arc<Outbox>,
    client: SnapshotTracker,
    told: BTreeSet<u32>,
    last: Option<SnapshotData>,
}

impl Viewer {
    fn new() -> Self {
        Viewer {
            out: Arc::new(Outbox::default()),
            client: SnapshotTracker::new(),
            told: BTreeSet::new(),
            last: None,
        }
    }

    /// The writer wakes: drains the outbox, applies every frame as the client does, and checks the result against the Full
    /// frame of the snapshot the writer encoded (the latest pushed). Returns the frame kinds it saw (0x83 / 0x87).
    fn drain_and_check(&mut self, at: &str) -> Vec<u8> {
        let mut frames = Vec::new();
        self.out.drain_into(&mut frames);
        let mut kinds = Vec::new();
        for f in frames {
            match f[0] {
                0x83 | 0x87 => {
                    kinds.push(f[0]);
                    let want = ServerMsg::decode(&full_frame(self.last.as_ref().expect("pushed")))
                        .expect("the Full frame decodes");
                    if f[0] == 0x87 {
                        let ServerMsg::SnapshotDelta(d) = ServerMsg::decode(&f).unwrap() else {
                            panic!("a delta")
                        };
                        // C-OBS: a delta names only actors the Full frame of this tick lists, and a departed id only if the
                        // client was told about it (and is not listed now).
                        let ServerMsg::Snapshot { actors, .. } = &want else {
                            unreachable!()
                        };
                        let visible: BTreeSet<u32> = actors.iter().map(|a| a.id).collect();
                        assert!(d.changed.iter().all(|a| visible.contains(&a.q.id)), "{at}");
                        assert!(
                            d.departed
                                .iter()
                                .all(|id| self.told.contains(id) && !visible.contains(id)),
                            "{at}"
                        );
                    }
                    let got = self
                        .client
                        .decode(&f)
                        .unwrap_or_else(|e| panic!("{at}: {e}"));
                    assert_eq!(got, want, "{at}: the applied frames equal the Full frame");
                    if let ServerMsg::Snapshot { actors, .. } = &got {
                        self.told = actors.iter().map(|a| a.id).collect();
                    }
                }
                _ => {}
            }
        }
        kinds
    }
}

#[test]
fn applying_the_writers_frames_equals_the_full_frame_of_every_tick_for_every_viewer() {
    let ticks = 1500u32;
    let mut env = seed1_match(ticks);
    let ids: Vec<_> = env.sim.players().iter().map(|p| p.id).collect();
    let mut publisher = Publisher::default();
    let mut earlier = Vec::new();
    let mut viewers: Vec<Viewer> = ids.iter().map(|_| Viewer::new()).collect();
    let mut rng = Lcg(7);
    let (mut full, mut delta, mut pushed, mut written) = (0u32, 0u32, 0u32, 0u32);
    let (mut sent_bytes, mut full_bytes) = (0usize, 0usize);
    for t in 0..ticks {
        let progress = env.advance(&[]);
        let events = env.last_events().to_vec();
        for (id, v) in ids.iter().zip(viewers.iter_mut()) {
            let f = publisher.frames(&env.sim, *id, t, &events, &mut earlier, &events);
            let data = f.snapshot.expect("the observation encodes");
            v.last = Some(data.clone());
            pushed += 1;
            v.out.push_tick(f.important, f.fx, Some(data));
            // The writer of a slow connection wakes only now and then: the outbox keeps the latest snapshot and the skipped
            // ones are never encoded. Every fourth viewer-tick wakes, the rest skip (about 60%).
            if rng.next() % 5 < 2 {
                let before = v.out.counters();
                let kinds = v.drain_and_check(&format!("tick {t} viewer {}", id.0));
                let after = v.out.counters();
                for k in kinds {
                    written += 1;
                    if k == 0x83 {
                        full += 1;
                    } else {
                        delta += 1;
                    }
                }
                sent_bytes += (after.snapshot_bytes_sent - before.snapshot_bytes_sent) as usize;
                full_bytes += v.last.as_ref().map_or(0, SnapshotData::full_len);
            }
        }
        if progress.terminated {
            break;
        }
    }
    assert!(pushed > 8 * 1000, "{pushed}");
    assert!(
        written > 2000 && written * 2 < pushed,
        "{written} of {pushed}"
    );
    assert_eq!(
        full, 8,
        "one Full per connection (the first), nothing else needed one"
    );
    assert!(delta > 2000, "{delta}");
    assert!(
        sent_bytes * 2 < full_bytes,
        "deltas save more than half the snapshot bytes even when the writer skips: {sent_bytes} of {full_bytes}"
    );
    for v in &viewers {
        let c = v.out.counters();
        assert!(c.snapshots_skipped > 100, "{c:?}");
        assert_eq!(c.snapshots_full, 1);
    }
}

#[test]
fn a_resumed_connection_starts_with_a_full_snapshot_and_a_resync_makes_the_next_one_full() {
    let mut env = seed1_match(200);
    let id = env.sim.players()[0].id;
    let mut publisher = Publisher::default();
    let mut earlier = Vec::new();
    let mut v = Viewer::new();
    let step =
        |env: &mut Env, publisher: &mut Publisher, earlier: &mut Vec<_>, v: &mut Viewer, t: u32| {
            env.advance(&[]);
            let events = env.last_events().to_vec();
            let f = publisher.frames(&env.sim, id, t, &events, earlier, &events);
            let data = f.snapshot.expect("encodes");
            v.last = Some(data.clone());
            v.out.snapshot(data);
        };
    let mut kinds = Vec::new();
    for t in 0..10 {
        step(&mut env, &mut publisher, &mut earlier, &mut v, t);
        kinds.extend(v.drain_and_check("steady"));
    }
    assert_eq!(kinds[0], 0x83);
    assert!(kinds[1..].iter().all(|k| *k == 0x87), "{kinds:?}");

    // A resync request: exactly the next snapshot is Full, then deltas again.
    v.out.request_resync();
    step(&mut env, &mut publisher, &mut earlier, &mut v, 10);
    assert_eq!(v.drain_and_check("resync"), vec![0x83]);
    step(&mut env, &mut publisher, &mut earlier, &mut v, 11);
    assert_eq!(v.drain_and_check("after"), vec![0x87]);

    // The seat is resumed on a NEW connection (new outbox, new writer state, a client decoder reset by its Welcome): Full first,
    // although the old connection's base was a few ticks old.
    let mut resumed = Viewer::new();
    for t in 12..16 {
        env.advance(&[]);
        let events = env.last_events().to_vec();
        let f = publisher.frames(&env.sim, id, t, &events, &mut earlier, &events);
        let data = f.snapshot.expect("encodes");
        resumed.last = Some(data.clone());
        resumed.out.snapshot(data);
        let k = resumed.drain_and_check("resumed");
        if t == 12 {
            assert_eq!(k, vec![0x83], "a resumed connection ALWAYS gets Full first");
        } else {
            assert_eq!(k, vec![0x87]);
        }
    }
}

#[test]
fn a_connections_snapshot_state_is_bounded_and_a_skipped_snapshot_costs_the_writer_nothing() {
    let mut env = seed1_match(300);
    let id = env.sim.players()[0].id;
    let mut publisher = Publisher::default();
    let mut earlier = Vec::new();
    let out = Outbox::default();
    for t in 0..300u32 {
        env.advance(&[]);
        let events = env.last_events().to_vec();
        let f = publisher.frames(&env.sim, id, t, &events, &mut earlier, &events);
        out.snapshot(f.snapshot.expect("encodes"));
    }
    // 300 snapshots pushed, none drained: nothing was encoded, and the writer holds no snapshot state to speak of.
    let c = out.counters();
    assert_eq!(
        (c.snapshots_full, c.snapshots_delta, c.snapshot_bytes_sent),
        (0, 0, 0)
    );
    assert_eq!(c.snapshots_skipped, 299);
    let idle = out.snapshot_state_bytes();
    let mut frames = Vec::new();
    out.drain_into(&mut frames);
    assert_eq!(frames.len(), 1);
    let c = out.counters();
    assert_eq!(
        (c.snapshots_full, c.snapshots_delta),
        (1, 0),
        "the one snapshot drained is the first: Full"
    );
    assert!(out.snapshot_state_bytes() <= idle + 16 * 1024);
    assert!(
        out.snapshot_state_bytes() < 2 * rh_protocol::MAX_ACTORS * (16 + 16 + 4) + 2048,
        "bounded by MAX_ACTORS"
    );
}

/// The snapshot blocks cycle room -> outbox slot -> writer base -> spare -> room: over a run with a writer that drains every tick,
/// the room builds in a handful of distinct heap blocks (it allocated one per snapshot before), and the bytes still equal the
/// Full frame of every tick.
#[test]
fn snapshot_blocks_are_recycled_between_the_room_and_the_writer() {
    let mut env = seed1_match(400);
    let id = env.sim.players()[0].id;
    let mut publisher = Publisher::default();
    let mut earlier = Vec::new();
    let mut v = Viewer::new();
    let mut spare = None;
    let mut blocks = BTreeSet::new();
    for t in 0..400u32 {
        env.advance(&[]);
        let events = env.last_events().to_vec();
        let f = publisher.frames_in(
            spare.take(),
            &env.sim,
            id,
            t,
            &events,
            &mut earlier,
            &events,
        );
        let data = f.snapshot.expect("encodes");
        blocks.insert(&*data as *const _ as usize);
        v.last = Some(data.clone());
        spare = v.out.push_tick(f.important, f.fx, Some(data));
        v.drain_and_check("recycled");
    }
    assert!(
        blocks.len() <= 4,
        "{} distinct blocks over 400 snapshots",
        blocks.len()
    );
}
