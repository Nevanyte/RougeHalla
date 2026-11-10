// Reuse the existing native/declared private scene-candidate source fixture verbatim.
use super::fixture as original;

use rh_protocol::scene_candidate::{encode_ack, Ack, Limits, Meta, PreparedScene, Receiver, View};
use rh_protocol::{ServerMsg, StateItem, WireOwnerCombat, WireOwnerLock};
use serde_json::{json, Value};
use std::sync::Arc;

fn limits_from_document(doc: &Value) -> Limits {
    let l = &doc["limits"];
    Limits {
        body_bytes: l["bodyBytes"].as_u64().unwrap() as usize,
        retained_body_bytes: l["retainedBodyBytes"].as_u64().unwrap() as usize,
        part_bytes: l["partBytes"].as_u64().unwrap() as usize,
        parts: l["parts"].as_u64().unwrap() as usize,
        frames: l["frames"].as_u64().unwrap() as usize,
        frame_bytes: l["frameBytes"].as_u64().unwrap() as usize,
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
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

fn source_case(doc: &Value, name: &str) -> (Meta, Vec<Vec<u8>>) {
    let c = doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == name)
        .unwrap_or_else(|| panic!("missing existing fixture case {name}"));
    let m = &c["meta"];
    let frames = c["inner14Hex"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| unhex(h.as_str().unwrap()))
        .collect();
    (
        Meta {
            epoch: m["epoch"].as_str().unwrap().parse().unwrap(),
            scene: m["scene"].as_str().unwrap().parse().unwrap(),
            tick: m["tick"].as_u64().unwrap() as u32,
            source_time: m["sourceTime"].as_f64().unwrap(),
            cue_from: m["cueFrom"].as_str().unwrap().parse().unwrap(),
            cue_through: m["cueThrough"].as_str().unwrap().parse().unwrap(),
        },
        frames,
    )
}

fn public_data(view: &View) -> Value {
    let messages = view
        .messages()
        .expect("Receiver accepted decodable public frames");
    let frames = messages
        .iter()
        .map(|message| match message {
            ServerMsg::Snapshot {
                tick,
                server_time,
                me,
                actors,
                owner_combat,
                training,
                ..
            } => {
                let combat = owner_combat.as_ref().map(|c| {
                    let (lock, target) = match c.lock {
                        WireOwnerLock::Clear => ("clear", None),
                        WireOwnerLock::Held { target: None } => ("held", None),
                        WireOwnerLock::Held { target: Some(id) } => ("held", Some(id.to_string())),
                    };
                    json!({
                        "lock": lock,
                        "targetId": target,
                        "drawStartedAt": c.draw_started_at,
                        "readyAt": c.ready_at,
                        "asMilliBits": format!("{:016x}", c.as_milli.to_bits()),
                        "windupMilliBits": format!("{:016x}", c.windup_milli.to_bits()),
                        "speedMilliBits": format!("{:016x}", c.speed_milli.to_bits()),
                    })
                });
                json!({
                    "kind": "snapshot",
                    "tick": tick,
                    "serverTimeBits": format!("{:016x}", server_time.to_bits()),
                    "selfId": me.as_ref().map(|s| s.id.to_string()),
                    "selfHpBits": me.as_ref().map(|s| format!("{:08x}", s.hp.to_bits())),
                    "actorIds": actors.iter().map(|a| a.id.to_string()).collect::<Vec<_>>(),
                    "training": training,
                    "ownerCombat": combat,
                })
            }
            ServerMsg::State { tick, items } => {
                let groups = items.iter().map(state_group).collect::<Vec<_>>();
                json!({ "kind": "state", "tick": tick, "groups": groups })
            }
            ServerMsg::Events { tick, events } => json!({
                "kind": "events", "tick": tick, "count": events.len(),
                "hex": hex(&message.try_encode().unwrap())
            }),
            ServerMsg::Fx { tick, fx } => json!({
                "kind": "fx",
                "tick": tick,
                "count": fx.len(),
                "kinds": fx.iter().map(fx_kind).collect::<Vec<_>>(),
                "hex": hex(&message.try_encode().unwrap())
            }),
            other => panic!("unexpected message in Full scene: {other:?}"),
        })
        .collect::<Vec<_>>();
    let cue_batches = frames
        .iter()
        .filter(|frame| matches!(frame["kind"].as_str(), Some("events" | "fx")))
        .cloned()
        .collect::<Vec<_>>();
    json!({
        "frames": frames,
        "cueOccurrences": view.meta().cue_through - view.meta().cue_from,
        "cueBatches": cue_batches
    })
}

fn state_group(item: &StateItem) -> Value {
    let key = item.key();
    match item {
        StateItem::Inventory(value) => {
            json!({"key":key,"group":"inventory","available":value.is_some()})
        }
        StateItem::Props(value) => {
            json!({"key":key,"group":"props","rows":value.rows.len(),"focus":value.focus.is_some()})
        }
        StateItem::Fields(value) => json!({"key":key,"group":"fields","rows":value.len()}),
        StateItem::RewardChests(value) => {
            json!({"key":key,"group":"rewardChests","rows":value.len()})
        }
        StateItem::Build(value) => json!({"key":key,"group":"build","available":value.is_some()}),
        StateItem::Camps(value) => json!({"key":key,"group":"camps","rows":value.len()}),
        StateItem::Projectiles(value) => {
            json!({"key":key,"group":"projectiles","rows":value.len()})
        }
        StateItem::Plan(value) => json!({"key":key,"group":"plan","available":value.is_some()}),
        StateItem::Arena(value) => json!({"key":key,"group":"arena","available":value.is_some()}),
        StateItem::Quests(value) => json!({
            "key":key,"group":"quests","available":value.is_some(),
            "rows":value.as_ref().map_or(0,|v|v.rows.len()),
            "roster":value.as_ref().map_or(0,|v|v.roster.len()),
            "objectives":value.as_ref().map_or(0,|v|v.objectives.len())
        }),
        StateItem::Roster(value) => json!({"key":key,"group":"roster","rows":value.len()}),
        StateItem::Trade(value) => json!({
            "key":key,"group":"trade","available":value.is_some(),
            "offers":value.as_ref().map_or(0,|v|v.offers.len()),
            "stats":value.as_ref().map_or(0,|v|v.stats.len()),
            "merchants":value.as_ref().map_or(0,|v|v.merchants.len())
        }),
    }
}

fn fx_kind(fx: &rh_protocol::WireFx) -> &'static str {
    match fx {
        rh_protocol::WireFx::Block { .. } => "block",
        rh_protocol::WireFx::Stagger { .. } => "stagger",
        rh_protocol::WireFx::Swing { .. } => "swing",
        rh_protocol::WireFx::Hit { .. } => "hit",
        rh_protocol::WireFx::Teleport => "teleport",
        rh_protocol::WireFx::WishStarted { .. } => "wishStarted",
        rh_protocol::WireFx::WishLanded { .. } => "wishLanded",
        rh_protocol::WireFx::WishEnded { .. } => "wishEnded",
        rh_protocol::WireFx::Windup { .. } => "windup",
        rh_protocol::WireFx::Cancel { .. } => "cancel",
        rh_protocol::WireFx::SigHit { .. } => "sigHit",
        rh_protocol::WireFx::Heal { .. } => "heal",
    }
}

fn scene_json(name: &str, meta: Meta, frames: &[Vec<u8>], p: &PreparedScene, view: &View) -> Value {
    let ack = encode_ack(Ack {
        epoch: meta.epoch,
        scene: meta.scene,
        cue_through: meta.cue_through,
    });
    json!({
        "name": name,
        "meta": {
            "epoch": meta.epoch.to_string(), "scene": meta.scene.to_string(),
            "tick": meta.tick, "sourceTimeBits": format!("{:016x}", meta.source_time.to_bits()),
            "sourceTime": meta.source_time,
            "cueFrom": meta.cue_from.to_string(), "cueThrough": meta.cue_through.to_string()
        },
        "inner14Hex": frames.iter().map(|f| hex(f)).collect::<Vec<_>>(),
        "bodyHex": hex(p.body()),
        "recordsHex": (0..p.record_count()).map(|i|hex(&p.record(i).unwrap())).collect::<Vec<_>>(),
        "framedBytes": p.framed_bytes(),
        "ackHex": hex(&ack),
        "publicData": public_data(view)
    })
}

fn push_scene(receiver: &mut Receiver, p: &PreparedScene) -> Arc<View> {
    for i in 0..p.record_count() {
        let committed = receiver.push(&p.record(i).expect("record index")).unwrap();
        assert_eq!(committed, i + 1 == p.record_count());
    }
    receiver.current().expect("accepted Full scene").clone()
}

fn body_from_frames(frames: &[Vec<u8>]) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&(frames.len() as u16).to_le_bytes());
    for frame in frames {
        body.extend_from_slice(&(frame.len() as u32).to_le_bytes());
        body.extend_from_slice(frame);
    }
    body
}

fn rebase_records(
    mut records: Vec<Vec<u8>>,
    scene: u64,
    cue_from: u64,
    cue_through: u64,
) -> Vec<Vec<u8>> {
    for record in &mut records {
        record[18..26].copy_from_slice(&scene.to_le_bytes());
        match record[9] {
            1 => {
                record[47..55].copy_from_slice(&cue_from.to_le_bytes());
                record[55..63].copy_from_slice(&cue_through.to_le_bytes());
            }
            3 => record[32..40].copy_from_slice(&cue_through.to_le_bytes()),
            _ => {}
        }
    }
    records
}

fn replay_negative(
    name: &str,
    records: Vec<Vec<u8>>,
    expected_reason: &str,
    limits: Limits,
    first: &PreparedScene,
    extra: Value,
) -> Value {
    let mut receiver = Receiver::new(first.meta().epoch, limits).unwrap();
    let held = push_scene(&mut receiver, first);
    let body = held.body().to_vec();
    let mut rejected_at = None;
    let mut reason = None;
    for (i, record) in records.iter().enumerate() {
        match receiver.push(record) {
            Ok(_) => {}
            Err(e) => {
                rejected_at = Some(i);
                reason = Some(e.0);
                break;
            }
        }
    }
    assert_eq!(reason, Some(expected_reason), "negative vector {name}");
    assert!(receiver.closed());
    assert!(Arc::ptr_eq(
        &held,
        receiver.current().expect("prior accepted view retained")
    ));
    assert_eq!(receiver.current().unwrap().body(), body.as_slice());
    let mut result = json!({
        "name": name,
        "afterScene": first.meta().scene.to_string(),
        "recordsHex": records.iter().map(|r|hex(r)).collect::<Vec<_>>(),
        "rejectAt": rejected_at.unwrap(),
        "reason": reason.unwrap(),
        "previousViewPreserved": true,
        "previousBodyHex": hex(&body),
        "closed": true
    });
    if let (Some(dst), Some(src)) = (result.as_object_mut(), extra.as_object()) {
        dst.extend(src.iter().map(|(k, v)| (k.clone(), v.clone())));
    }
    result
}

fn malformed_owner_frames(base: &[Vec<u8>]) -> Vec<Vec<u8>> {
    let snapshot = match ServerMsg::decode(&base[0]).unwrap() {
        ServerMsg::Snapshot {
            phase,
            ack_input,
            me,
            actors,
            training,
            ..
        } => {
            let target = actors.first().expect("native fixture has visible actor").id;
            let snap = ServerMsg::Snapshot {
                tick: 10,
                server_time: 500.,
                phase,
                ack_input,
                me,
                actors,
                training,
                owner_combat: Some(WireOwnerCombat {
                    lock: WireOwnerLock::Held {
                        target: Some(target),
                    },
                    draw_started_at: 0,
                    ready_at: 500,
                    as_milli: 1000.,
                    windup_milli: 50.,
                    speed_milli: 900.,
                }),
            };
            snap.try_encode().unwrap()
        }
        _ => panic!("native fixture frame 0 is not a Full Snapshot"),
    };
    let state = match ServerMsg::decode(&base[1]).unwrap() {
        ServerMsg::State { mut items, .. } => ServerMsg::State {
            tick: 10,
            items: std::mem::take(&mut items),
        }
        .try_encode()
        .unwrap(),
        _ => panic!("native fixture frame 1 is not State"),
    };
    vec![snapshot, state]
}

fn client14_document() -> Value {
    let base = original::document();
    let limits = limits_from_document(&base);
    let (first_meta, first_frames) = source_case(&base, "native-prepared-small");
    let first_p = PreparedScene::prepare(first_meta, &first_frames, limits).unwrap();

    let (mut second_meta, mut second_frames) = source_case(&base, "synthetic-spectator-clock");
    let gold: Value =
        serde_json::from_str(include_str!("../../../../../protocol/fixtures/v14.json")).unwrap();
    let fx_hex = gold["server"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["name"] == "fx")
        .expect("server.fx sample")["hex"]
        .as_str()
        .unwrap();
    let fx_frame = unhex(fx_hex);
    assert!(matches!(ServerMsg::decode(&fx_frame), Ok(ServerMsg::Fx { fx, .. }) if fx.len() == 2));
    second_frames.push(fx_frame.clone());
    second_frames.push(fx_frame);
    second_meta.epoch = first_meta.epoch;
    second_meta.scene = 2;
    second_meta.cue_from = first_meta.cue_through;
    second_meta.cue_through = second_meta.cue_from + 4;
    let second_p = PreparedScene::prepare(second_meta, &second_frames, limits).unwrap();

    let mut receiver = Receiver::new(first_meta.epoch, limits).unwrap();
    let first_view = push_scene(&mut receiver, &first_p);
    let second_view = push_scene(&mut receiver, &second_p);
    assert_eq!(second_view.meta(), second_meta);
    assert_eq!(
        second_view
            .messages()
            .unwrap()
            .iter()
            .filter_map(|m| match m {
                ServerMsg::Fx { fx, .. } => Some(fx.len()),
                _ => None,
            })
            .sum::<usize>(),
        4
    );

    let first_case_p = PreparedScene::prepare(first_meta, &first_frames, limits).unwrap();
    let second_case_p = PreparedScene::prepare(second_meta, &second_frames, limits).unwrap();
    let scenes = vec![
        scene_json(
            "scene1-native",
            first_meta,
            &first_frames,
            &first_case_p,
            &first_view,
        ),
        scene_json(
            "scene2-spectator-fx4",
            second_meta,
            &second_frames,
            &second_case_p,
            &second_view,
        ),
    ];

    let mut negatives = Vec::new();
    let mut bad_commit = (0..second_case_p.record_count())
        .map(|i| second_case_p.record(i).unwrap())
        .collect::<Vec<_>>();
    let last = bad_commit.last_mut().unwrap();
    last[32] ^= 1;
    negatives.push(replay_negative(
        "commit_tuple_mismatch",
        bad_commit,
        "commit",
        limits,
        &first_case_p,
        json!({}),
    ));

    let duplicate_begin = vec![
        second_case_p.record(0).unwrap(),
        second_case_p.record(0).unwrap(),
    ];
    negatives.push(replay_negative(
        "duplicate_begin",
        duplicate_begin,
        "duplicate begin",
        limits,
        &first_case_p,
        json!({}),
    ));

    assert!(
        second_case_p.record_count() >= 4,
        "scene has multiple bounded parts for reorder controls"
    );
    let reordered_part = vec![
        second_case_p.record(0).unwrap(),
        second_case_p.record(2).unwrap(),
    ];
    negatives.push(replay_negative(
        "reordered_part",
        reordered_part,
        "part",
        limits,
        &first_case_p,
        json!({}),
    ));

    let missing_part = vec![
        second_case_p.record(0).unwrap(),
        second_case_p
            .record(second_case_p.record_count() - 1)
            .unwrap(),
    ];
    negatives.push(replay_negative(
        "missing_part_before_commit",
        missing_part,
        "commit",
        limits,
        &first_case_p,
        json!({}),
    ));

    let mut stale_epoch = second_case_p.record(0).unwrap();
    stale_epoch[10..18].copy_from_slice(&(first_meta.epoch + 1).to_le_bytes());
    negatives.push(replay_negative(
        "stale_epoch_begin",
        vec![stale_epoch],
        "epoch",
        limits,
        &first_case_p,
        json!({}),
    ));

    let mut trailing_commit = second_case_p
        .record(second_case_p.record_count() - 1)
        .unwrap();
    trailing_commit.push(0);
    let mut trailing_sequence = (0..second_case_p.record_count() - 1)
        .map(|i| second_case_p.record(i).unwrap())
        .collect::<Vec<_>>();
    trailing_sequence.push(trailing_commit);
    negatives.push(replay_negative(
        "trailing_commit_bytes",
        trailing_sequence,
        "trailing",
        limits,
        &first_case_p,
        json!({}),
    ));

    let mut truncated_sequence = (0..second_case_p.record_count())
        .map(|i| second_case_p.record(i).unwrap())
        .collect::<Vec<_>>();
    truncated_sequence.last_mut().unwrap().pop();
    negatives.push(replay_negative(
        "truncated_commit_eof",
        truncated_sequence,
        "truncated",
        limits,
        &first_case_p,
        json!({}),
    ));

    let mut inner_overflow_body = Vec::from(2u16.to_le_bytes());
    inner_overflow_body.extend_from_slice(&u32::MAX.to_le_bytes());
    let inner_overflow_records = raw_records(&second_case_p, &inner_overflow_body, limits);
    negatives.push(replay_negative(
        "inner_frame_length_u32_max",
        inner_overflow_records,
        "frame size",
        limits,
        &first_case_p,
        json!({"declaredInnerLength":"4294967295"}),
    ));

    let mut missing_state = second_frames.clone();
    missing_state[1] = ServerMsg::Events {
        tick: second_meta.tick,
        events: vec![],
    }
    .try_encode()
    .unwrap();
    let missing_body = body_from_frames(&missing_state);
    let missing_records = raw_records(&second_case_p, &missing_body, limits);
    negatives.push(replay_negative(
        "missing_required_state_group",
        missing_records,
        "body role",
        limits,
        &first_case_p,
        json!({"missingIndex":1}),
    ));

    let mut owner_frames = malformed_owner_frames(&first_frames);
    let owner_meta = Meta {
        epoch: first_meta.epoch,
        scene: 2,
        tick: 10,
        source_time: 500.,
        cue_from: first_meta.cue_through,
        cue_through: first_meta.cue_through,
    };
    let owner_p = PreparedScene::prepare(owner_meta, &owner_frames, limits).unwrap();
    let owner_snapshot = &owner_frames[0];
    let mirror_offset = owner_snapshot.len() - 24;
    owner_frames[0][mirror_offset..mirror_offset + 8].copy_from_slice(&f64::NAN.to_le_bytes());
    let nan_records = raw_records(&owner_p, &body_from_frames(&owner_frames), limits);
    negatives.push(replay_negative(
        "ownercombat_nan_mirror",
        nan_records,
        "inner codec",
        limits,
        &first_case_p,
        json!({"innerFrame":0,"numericField":"asMilli"}),
    ));

    let mut ref_frames = malformed_owner_frames(&first_frames);
    let ref_template = PreparedScene::prepare(owner_meta, &ref_frames, limits).unwrap();
    let lock_target_offset = ref_frames[0].len() - 33;
    let old_target = ref_frames[0][lock_target_offset];
    assert!(
        old_target < 0x80,
        "fixture owner target uses a one-byte varint"
    );
    let bad_target = if old_target == 1 { 2 } else { 1 };
    ref_frames[0][lock_target_offset] = bad_target;
    let bad_ref_records = raw_records(&ref_template, &body_from_frames(&ref_frames), limits);
    negatives.push(replay_negative(
        "ownercombat_dangling_target",
        bad_ref_records,
        "inner codec",
        limits,
        &first_case_p,
        json!({"innerFrame":0,"field":"ownerCombat.lock.target"}),
    ));

    let bad_quest_case = &base["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["name"] == "synthetic-quest-prop-join")
        .unwrap();
    let bad_quest_records = bad_quest_case["badQuestRecordsHex"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| unhex(v.as_str().unwrap()))
        .collect::<Vec<_>>();
    let bad_quest_records = rebase_records(
        bad_quest_records,
        2,
        first_meta.cue_through,
        first_meta.cue_through,
    );
    negatives.push(replay_negative(
        "quest_props_dangling_ref",
        bad_quest_records,
        "inner codec",
        limits,
        &first_case_p,
        json!({"group":"Props+Quests"}),
    ));

    let mut over_length = (0..second_case_p.record_count())
        .map(|i| second_case_p.record(i).unwrap())
        .collect::<Vec<_>>();
    let claimed = limits.body_bytes + 1;
    let parts = claimed.div_ceil(limits.part_bytes);
    over_length[0][63..65].copy_from_slice(&(parts as u16).to_le_bytes());
    over_length[0][65..69].copy_from_slice(&(claimed as u32).to_le_bytes());
    negatives.push(replay_negative(
        "begin_length_over_limit",
        vec![over_length.remove(0)],
        "assembly size",
        limits,
        &first_case_p,
        json!({"claimedBodyBytes":claimed}),
    ));

    let mut tight = limits;
    let max_body = first_case_p.body().len().max(second_case_p.body().len());
    tight.body_bytes = max_body;
    tight.retained_body_bytes = max_body;
    tight.check().unwrap();
    let mut overflow_rx = Receiver::new(first_meta.epoch, tight).unwrap();
    let held = push_scene(&mut overflow_rx, &first_case_p);
    let old_body = held.body().to_vec();
    let begin = second_case_p.record(0).unwrap();
    let err = overflow_rx
        .push(&begin)
        .expect_err("second body exceeds retained budget");
    assert_eq!(err.0, "retained bodies");
    assert!(overflow_rx.closed());
    assert!(Arc::ptr_eq(&held, overflow_rx.current().unwrap()));
    assert_eq!(overflow_rx.current().unwrap().body(), old_body.as_slice());
    negatives.push(json!({
        "name":"retained_body_budget_exhausted", "afterScene":first_meta.scene.to_string(),
        "limitsOverride":{"bodyBytes":tight.body_bytes,"retainedBodyBytes":tight.retained_body_bytes,
            "partBytes":tight.part_bytes,"parts":tight.parts,"frames":tight.frames,"frameBytes":tight.frame_bytes},
        "recordsHex":[hex(&begin)],"rejectAt":0,"reason":err.0,
        "previousViewPreserved":true,"previousBodyHex":hex(&old_body),"closed":true
    }));

    json!({
        "schema":"rh-scene-candidate14-client-fixtures/1",
        "protocol":14,
        "scope":"isolated Rust Receiver client fixture; scene 1 is native-prepared, scene 2 is declared spectator plus two repeated existing server.fx records; not live WS, client transport integration, or capacity proof",
        "generation":"41", "epoch":first_meta.epoch.to_string(),
        "limits":base["limits"].clone(),
        "scenes":scenes,
        "negatives":negatives
    })
}

#[test]
fn client14_fixture_actual_receiver_acceptance_and_rejections() {
    let doc = client14_document();
    assert_eq!(doc["scenes"].as_array().unwrap().len(), 2);
    assert_eq!(doc["negatives"].as_array().unwrap().len(), 14);
    assert_eq!(doc["scenes"][1]["publicData"]["cueOccurrences"], 4);
    let generated = format!("{}\n", serde_json::to_string_pretty(&doc).unwrap());
    if let Ok(path) = std::env::var("RH_SCENE_CLIENT14_FIXTURE_OUT") {
        std::fs::write(path, generated).unwrap();
    } else {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../protocol/fixtures/scene-candidate/client14.json");
        let existing =
            std::fs::read_to_string(path).expect("generate client14 fixture before normal test");
        assert_eq!(
            existing, generated,
            "client14 fixture is generated by Rust and must be byte-stable"
        );
    }
}
