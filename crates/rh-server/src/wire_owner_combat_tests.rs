//! Transport controls over the ordinary native prepared offer. These are not source captures.
use super::*;
use crate::outbox::{Outbox, IMPORTANT_CAP};
use rh_protocol::{RejectCode, WireOwnerCombat, WireOwnerLock};
use rh_sim::{
    FactionId, ItemObserver, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2, WeaponId,
};

fn native_scene() -> Sim {
    let map =
        serde_json::from_str(include_str!("../../rh-sim/tests/fixtures/mob-pve-map.json")).unwrap();
    let (w, h, tiles, layers) = rh_sim::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map,
    }
    .validate()
    .unwrap()
    .into_parts();
    let spawns = layers
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    Sim::reset_active(
        SimConfig {
            mob_mode: rh_sim::mob_runtime::MobMode::Pve,
            ..Default::default()
        },
        rh_sim::Arena {
            map: rh_sim::TileMap::new(w, h, tiles)
                .unwrap()
                .with_layers(layers)
                .unwrap(),
            spawns,
        },
        Secrets::from_seed(7),
        &[Placement {
            profile: "owner".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(80., 112.),
            hp: None,
            weapon0: Some(WeaponId::Wand),
            weapon1: None,
        }],
    )
}

#[test]
fn ordinary_native_target_uses_the_same_prepared_npc_reference_in_the_wire_group() {
    let mut sim = native_scene();
    let mut observer = ItemObserver::new(PlayerId(1));
    let mut publisher = Publisher::default();
    let (_, first) = publisher
        .frames_prepared(&mut observer, None, &sim, 0, &[], &mut vec![], &[])
        .unwrap();
    let target = publisher
        .observation()
        .visible
        .iter()
        .find(|a| a.kind != rh_sim::observe::ActorKind::Player)
        .expect("native visible NPC")
        .id;
    first.commit();
    let command = observer
        .resolve(&sim, rh_sim::PublicCommand::Target { actor: target })
        .unwrap();
    sim.submit(PlayerId(1), command).unwrap();
    let events = sim.step();
    let (frames, offer) = publisher
        .frames_prepared(&mut observer, None, &sim, 1, &events, &mut vec![], &events)
        .unwrap();
    assert!(frames.refused.is_none());
    let group = frames.snapshot.as_ref().unwrap().owner_combat().unwrap();
    let WireOwnerLock::Held {
        target: Some(current),
    } = group.lock
    else {
        panic!("the ordinary Target input must produce an entitled held lock");
    };
    assert!(publisher
        .observation()
        .visible
        .iter()
        .any(|a| a.id.0 == current));
    assert_eq!(
        group,
        wire_owner_combat(publisher.observation().owner_combat.unwrap())
    );
    assert!(
        matches!(frames.snapshot.unwrap().decoded(), ServerMsg::Snapshot {
        owner_combat: Some(value), actors, ..
    } if value == group && actors.iter().any(|a| a.id == current))
    );
    drop(offer);
}

#[test]
fn prepared_owner_group_survives_failed_encoding_and_reliable_enqueue_without_issuing_aliases() {
    // 0: an overlong reliable event refuses encoding,1: reliable capacity refusal,2: closed queue.
    for failure in 0..3 {
        let sim = native_scene();
        let mut observer = ItemObserver::new(PlayerId(1));
        let mut publisher = Publisher::default();
        let mut earlier = if failure == 0 {
            vec![SeenEvent::Toast {
                text: "x".repeat(256),
            }]
        } else {
            Vec::new()
        };
        let (frames, offer) = publisher
            .frames_prepared(&mut observer, None, &sim, 1, &[], &mut earlier, &[])
            .unwrap();
        let group = frames.snapshot.as_ref().unwrap().owner_combat().unwrap();
        let npc = publisher
            .observation()
            .visible
            .iter()
            .find(|a| a.kind != rh_sim::observe::ActorKind::Player)
            .expect("real native visible NPC")
            .id;
        assert_eq!(group.lock, WireOwnerLock::Clear);
        assert_eq!(
            group,
            wire_owner_combat(publisher.observation().owner_combat.unwrap()),
            "wire conversion preserves every source-normalized value"
        );
        let rejected = Outbox::default();
        if failure == 0 {
            assert!(frames.refused.is_some(), "actual reliable encoder refusal");
        } else {
            if failure == 1 {
                for _ in 0..IMPORTANT_CAP {
                    rejected.important(vec![0x99]);
                }
            } else {
                rejected.close(RejectCode::TooSlow);
            }
            let counts = rejected.counters();
            assert!(
                !rejected
                    .push_tick_with_state(
                        Some(
                            ServerMsg::State {
                                tick: 0,
                                items: vec![]
                            }
                            .encode()
                        ),
                        frames.important,
                        frames.fx,
                        Some(frames.snapshot.unwrap()),
                    )
                    .1
            );
            assert_eq!(rejected.counters(), counts);
        }
        drop(offer);
        assert_eq!(
            observer
                .resolve(&sim, rh_sim::PublicCommand::Target { actor: npc })
                .unwrap(),
            rh_sim::validate(rh_sim::RawCommand::MissingTarget).unwrap(),
            "a failed prepared snapshot never issues its NPC reference"
        );

        let (retry, offer) = publisher
            .frames_prepared(&mut observer, None, &sim, 2, &[], &mut vec![], &[])
            .unwrap();
        assert!(retry.refused.is_none());
        assert_eq!(retry.snapshot.as_ref().unwrap().owner_combat(), Some(group));
        assert!(publisher.observation().visible.iter().any(|a| a.id == npc));
        let accepted = Outbox::default();
        assert!(
            accepted
                .push_tick_with_state(
                    Some(
                        ServerMsg::State {
                            tick: 0,
                            items: vec![]
                        }
                        .encode()
                    ),
                    retry.important,
                    retry.fx,
                    Some(retry.snapshot.unwrap()),
                )
                .1
        );
        offer.commit();
        assert_ne!(
            observer
                .resolve(&sim, rh_sim::PublicCommand::Target { actor: npc })
                .unwrap(),
            rh_sim::validate(rh_sim::RawCommand::MissingTarget).unwrap(),
            "only accepted delivery commits the staged current alias"
        );
        let mut bytes = Vec::new();
        accepted.drain_into(&mut bytes);
        assert!(bytes.iter().any(|b| matches!(ServerMsg::decode(b).unwrap(),
            ServerMsg::Snapshot { owner_combat: Some(value), .. } if value == group)));
    }
}

#[test]
fn invalid_owner_group_refuses_before_publisher_memo_work() {
    let sim = native_scene();
    let mut observer = ItemObserver::new(PlayerId(1));
    let mut publisher = Publisher::default();
    observer
        .observe_into(&sim, &[], &mut publisher.obs, None)
        .unwrap();
    let valid = publisher.obs.owner_combat.unwrap();
    for bad in [
        WireOwnerCombat {
            as_milli: f64::INFINITY,
            ..wire_owner_combat(valid)
        },
        WireOwnerCombat {
            windup_milli: 50.5,
            ..wire_owner_combat(valid)
        },
        WireOwnerCombat {
            lock: WireOwnerLock::Held {
                target: Some(u32::MAX),
            },
            ..wire_owner_combat(valid)
        },
    ] {
        // Deliberately malformed public observation, not a reachable gameplay producer.
        publisher.obs.owner_combat = Some(rh_sim::OwnerCombatView {
            lock: match bad.lock {
                WireOwnerLock::Clear => rh_sim::OwnerLockView::Clear,
                WireOwnerLock::Held { target } => rh_sim::OwnerLockView::Held {
                    target: target.map(PlayerId),
                },
            },
            draw_started_at: bad.draw_started_at,
            ready_at: bad.ready_at,
            as_milli: bad.as_milli,
            windup_milli: bad.windup_milli,
            speed_milli: bad.speed_milli,
        });
        let frames = publisher.build_observation_frames(None, PlayerId(1), 0, &mut vec![], &[]);
        assert!(frames.snapshot.is_err());
        assert!(frames.refused.is_some());
        assert!(
            publisher.actors.slots.is_empty(),
            "refusal precedes memo mutation"
        );
    }
}
