//! Explicit small synthetic profile; one real native prepare plus declared v14 shape variants.
//! Not a legacy capture, native producer-capacity or live-browser proof.
use crate::{wire::Publisher, wire_state::CollectionPublisher};
use rh_protocol::{
    scene_candidate::{Limits, Meta, PreparedScene},
    ServerMsg, StateItem,
};
use rh_sim::{
    validate, Arena, FactionId, ItemObserver, RawCommand, Secrets, Sim, SimConfig, TileMap, Vec2,
};
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn native() -> Vec<Vec<u8>> {
    let rows = [
        "############",
        "#..........#",
        "#..........#",
        "#..........#",
        "#..........#",
        "#..........#",
        "############",
    ];
    let arena = Arena {
        map: TileMap::from_rows(&rows).unwrap(),
        spawns: vec![Vec2::new(112., 112.), Vec2::new(176., 112.)],
    };
    let mut sim = Sim::new(
        SimConfig {
            min_players: 2,
            lobby_seconds: 0.,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(1),
    );
    let viewer = sim
        .add_player("scene-owner", Some(FactionId::Fire), false)
        .unwrap();
    let rival = sim
        .add_player("scene-rival", Some(FactionId::Frost), false)
        .unwrap();
    sim.step();
    sim.submit(viewer, validate(RawCommand::Target { id: rival }).unwrap())
        .unwrap();
    let events = sim.step();
    let mut observer = ItemObserver::new(viewer);
    let mut publisher = Publisher::default();
    let mut carry = Vec::new();
    let (frames, offer) = publisher
        .frames_prepared(&mut observer, None, &sim, 0, &events, &mut carry, &events)
        .unwrap();
    assert!(frames.refused.is_none());
    let mut collections = CollectionPublisher::default();
    let state = collections
        .prepare(
            publisher.observation(),
            offer.props_changed(),
            offer.rewards_changed(),
            false,
        )
        .unwrap();
    let state_bytes = state.frame.as_ref().unwrap().clone();
    let (snapshot, kind) = rh_protocol::ConnEncoder::new().encode_frame(frames.snapshot.unwrap());
    assert_eq!(kind, rh_protocol::FrameKind::Full);
    let mut result = vec![snapshot, state_bytes];
    if let Some(e) = frames.important {
        result.push(e);
    }
    if let Some(f) = frames.fx {
        result.push(f);
    }
    state.commit(&mut collections);
    offer.commit();
    result
}
fn native_training() -> Vec<Vec<u8>> {
    let mut sim = Sim::new(
        SimConfig {
            training: true,
            dummies: true,
            min_players: 1,
            lobby_seconds: 0.,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(2),
    );
    let viewer = sim
        .add_player("training-owner", Some(FactionId::Fire), false)
        .unwrap();
    let first = sim.step();
    let mut observer = ItemObserver::new(viewer);
    let mut seen = rh_sim::Observation::default();
    observer
        .observe_into(&sim, &first, &mut seen, None)
        .unwrap();
    let target = seen
        .visible
        .iter()
        .find(|a| a.kind == rh_sim::observe::ActorKind::Dummy)
        .expect("visible real dummy")
        .id;
    let command = observer
        .resolve(&sim, rh_sim::PublicCommand::Target { actor: target })
        .unwrap();
    sim.submit(viewer, command).unwrap();
    let events = sim.step();
    let mut publisher = Publisher::default();
    let mut carry = Vec::new();
    let (frames, offer) = publisher
        .frames_prepared(&mut observer, None, &sim, 0, &events, &mut carry, &events)
        .unwrap();
    assert!(frames.refused.is_none());
    let mut collections = CollectionPublisher::default();
    let state = collections
        .prepare(
            publisher.observation(),
            offer.props_changed(),
            offer.rewards_changed(),
            false,
        )
        .unwrap();
    let state_bytes = state.frame.as_ref().unwrap().clone();
    let (snapshot, kind) = rh_protocol::ConnEncoder::new().encode_frame(frames.snapshot.unwrap());
    assert_eq!(kind, rh_protocol::FrameKind::Full);
    let mut result = vec![snapshot, state_bytes];
    if let Some(e) = frames.important {
        result.push(e);
    }
    if let Some(f) = frames.fx {
        result.push(f);
    }
    state.commit(&mut collections);
    offer.commit();
    result
}
fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}
fn raw_records(template: &PreparedScene, body: &[u8], limits: Limits) -> Vec<Vec<u8>> {
    let parts = body.len().div_ceil(limits.part_bytes);
    let mut begin = template.record(0).unwrap();
    begin[63..65].copy_from_slice(&(parts as u16).to_le_bytes());
    begin[65..69].copy_from_slice(&(body.len() as u32).to_le_bytes());
    let mut records = vec![begin];
    for (index, chunk) in body.chunks(limits.part_bytes).enumerate() {
        let mut part = template.record(1).unwrap()[..26].to_vec();
        part.extend_from_slice(&(index as u16).to_le_bytes());
        part.extend_from_slice(&(chunk.len() as u32).to_le_bytes());
        part.extend_from_slice(chunk);
        records.push(part);
    }
    let mut commit = template.record(template.record_count() - 1).unwrap();
    commit[26..28].copy_from_slice(&(parts as u16).to_le_bytes());
    commit[28..32].copy_from_slice(&(body.len() as u32).to_le_bytes());
    records.push(commit);
    records
}
pub fn document() -> serde_json::Value {
    let limits = Limits {
        body_bytes: 32768,
        retained_body_bytes: 65536,
        part_bytes: 47,
        parts: 1024,
        frames: 16,
        frame_bytes: 16384,
    };
    let original = native();
    let mut cases = Vec::new();
    for name in [
        "native-prepared-small",
        "native-training-currentref-rack",
        "synthetic-available-empty",
        "synthetic-redacted-owner-lock",
        "synthetic-quest-prop-join",
        "synthetic-arena-clock",
        "synthetic-spectator-clock",
        "synthetic-clear-mirror-range",
    ] {
        let mut frames = if name == "native-training-currentref-rack" {
            native_training()
        } else {
            original.clone()
        };
        if name == "synthetic-available-empty" {
            if let ServerMsg::State { tick, mut items } = ServerMsg::decode(&frames[1]).unwrap() {
                items[9] = StateItem::Quests(Some(Default::default()));
                items[10] = StateItem::Trade(Some(rh_protocol::WireTradeView {
                    trade_used: false,
                    offers: vec![],
                    stats: vec![],
                    barter_ready_at: None,
                    merchants: vec![],
                    barter_labels: Default::default(),
                }));
                frames[1] = ServerMsg::State { tick, items }.try_encode().unwrap();
            }
        }
        if name == "synthetic-redacted-owner-lock" {
            let mut m = ServerMsg::decode(&frames[0]).unwrap();
            if let ServerMsg::Snapshot {
                owner_combat: Some(c),
                ..
            } = &mut m
            {
                c.lock = rh_protocol::WireOwnerLock::Held { target: None };
            }
            frames[0] = m.try_encode().unwrap();
        }
        if name == "synthetic-quest-prop-join" {
            let gold: serde_json::Value =
                serde_json::from_str(include_str!("../../../../../protocol/fixtures/v14.json"))
                    .unwrap();
            let value = gold["server"]
                .as_array()
                .unwrap()
                .iter()
                .find(|v| v["name"] == "state_quests_available")
                .unwrap();
            let ServerMsg::State { items: patch, .. } =
                ServerMsg::decode(&unhex(value["hex"].as_str().unwrap())).unwrap()
            else {
                panic!("state")
            };
            let ServerMsg::State { tick, mut items } = ServerMsg::decode(&frames[1]).unwrap()
            else {
                panic!("state")
            };
            for item in patch {
                let index = (item.key() - 1) as usize;
                items[index] = item;
            }
            frames[1] = ServerMsg::State { tick, items }.try_encode().unwrap();
        }
        if name == "synthetic-arena-clock" {
            let ServerMsg::State { tick, mut items } = ServerMsg::decode(&frames[1]).unwrap()
            else {
                panic!("state")
            };
            items[8] = StateItem::Arena(Some(rh_protocol::WireArena {
                lobby_ends_at: 0.,
                plan_ends_at: 0.,
                raid_started_at: 0.,
                patience_ends_at: Some(0.),
                in_coliseum: false,
                gates_locked: false,
                sudden_death_at: 0.,
                started_with: 0,
            }));
            frames[1] = ServerMsg::State { tick, items }.try_encode().unwrap();
        }
        if name == "synthetic-spectator-clock" {
            frames[0] = ServerMsg::Snapshot {
                tick: 10,
                server_time: 500.,
                phase: 1,
                ack_input: 0,
                me: None,
                actors: vec![],
                owner_combat: None,
                training: false,
            }
            .try_encode()
            .unwrap();
            let ServerMsg::State { items, .. } = ServerMsg::decode(&frames[1]).unwrap() else {
                panic!("state")
            };
            frames[1] = ServerMsg::State { tick: 10, items }.try_encode().unwrap();
        }
        if name == "synthetic-clear-mirror-range" {
            let mut m = ServerMsg::decode(&frames[0]).unwrap();
            if let ServerMsg::Snapshot {
                owner_combat: Some(c),
                ..
            } = &mut m
            {
                c.lock = rh_protocol::WireOwnerLock::Clear;
                c.as_milli = f64::MAX;
                c.windup_milli = 50.;
                c.speed_milli = 9007199254740992.;
            }
            frames[0] = m.try_encode().unwrap();
        }
        let ServerMsg::Snapshot {
            tick, server_time, ..
        } = ServerMsg::decode(&frames[0]).unwrap()
        else {
            panic!("Full")
        };
        let occurrences: u64 = frames
            .iter()
            .skip(2)
            .map(|b| match ServerMsg::decode(b).unwrap() {
                ServerMsg::Events { events, .. } => events.len() as u64,
                ServerMsg::Fx { fx, .. } => fx.len() as u64,
                _ => panic!("batch"),
            })
            .sum();
        let meta = Meta {
            epoch: (1u64 << 53) + 7,
            scene: 1,
            tick,
            source_time: server_time,
            cue_from: 0,
            cue_through: occurrences,
        };
        let p = PreparedScene::prepare(meta, &frames, limits).unwrap();
        cases.push(serde_json::json!({"name":name,"meta":{"epoch":meta.epoch.to_string(),"scene":"1","tick":tick,"sourceTime":server_time,"cueFrom":"0","cueThrough":occurrences.to_string()},"inner14Hex":frames.iter().map(|b|hex(b)).collect::<Vec<_>>(),"bodyHex":hex(p.body()),"recordsHex":(0..p.record_count()).map(|i|hex(&p.record(i).unwrap())).collect::<Vec<_>>(),"framedBytes":p.framed_bytes()}));
        if name == "synthetic-spectator-clock" {
            let mut bad_snapshot = vec![0x83, 10, 0, 0x80, 0x80, 0x20];
            bad_snapshot.extend_from_slice(&500f64.to_le_bytes());
            bad_snapshot.push(0);
            assert!(ServerMsg::decode(&bad_snapshot).is_err());
            let mut bad_frames = frames.clone();
            bad_frames[0] = bad_snapshot;
            let mut body = Vec::new();
            body.extend_from_slice(&(bad_frames.len() as u16).to_le_bytes());
            for frame in &bad_frames {
                body.extend_from_slice(&(frame.len() as u32).to_le_bytes());
                body.extend_from_slice(frame);
            }
            cases.last_mut().unwrap()["badTimeRecordsHex"] =
                serde_json::json!(raw_records(&p, &body, limits)
                    .iter()
                    .map(|b| hex(b))
                    .collect::<Vec<_>>());
        }
        if name == "synthetic-arena-clock" {
            let marker = [9, 1, 0, 0, 0, 0, 0, 0, 0, 0];
            let hits: Vec<_> = p
                .body()
                .windows(marker.len())
                .enumerate()
                .filter_map(|(i, v)| (v == marker).then_some(i + 2))
                .collect();
            assert_eq!(hits.len(), 1);
            let mut records: Vec<_> = (0..p.record_count())
                .map(|i| p.record(i).unwrap())
                .collect();
            for (j, byte) in (-1f64).to_le_bytes().iter().enumerate() {
                let offset = hits[0] + j;
                records[1 + offset / limits.part_bytes][32 + offset % limits.part_bytes] = *byte;
            }
            cases.last_mut().unwrap()["badArenaRecordsHex"] =
                serde_json::json!(records.iter().map(|b| hex(b)).collect::<Vec<_>>());
        }
        if name == "synthetic-quest-prop-join" {
            let marker = [1, 0xe8, 3, 0xd0, 7, 7, 17, 0];
            let hits: Vec<_> = p
                .body()
                .windows(marker.len())
                .enumerate()
                .filter_map(|(i, v)| (v == marker).then_some(i + 6))
                .collect();
            assert_eq!(hits.len(), 1);
            let offset = hits[0];
            let mut records: Vec<_> = (0..p.record_count())
                .map(|i| p.record(i).unwrap())
                .collect();
            records[1 + offset / limits.part_bytes][32 + offset % limits.part_bytes] = 18;
            cases.last_mut().unwrap()["badQuestRecordsHex"] =
                serde_json::json!(records.iter().map(|b| hex(b)).collect::<Vec<_>>());
        }
    }
    serde_json::json!({"format":"rh-scene-candidate14-experiment/1","profile":"SYNTHETIC-small47-not-product-capacity","base":"986f44dfd9a61eb769700adc476fc8b9e9aa8011","protocol":14,"limits":{"bodyBytes":limits.body_bytes,"retainedBodyBytes":limits.retained_body_bytes,"partBytes":limits.part_bytes,"parts":limits.parts,"frames":limits.frames,"frameBytes":limits.frame_bytes},"cases":cases})
}
