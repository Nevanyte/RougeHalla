//! Declared public DTO controls are labelled separately from the real Sim/Seat paths.
//! These tests do not manufacture legacy source outcomes or activate full Brain.
use super::*;
use crate::delivery::DeliverySession;
use rh_sim::{FactionId, Observation, Placement, PlayerId, Secrets, Sim, SimConfig, WeaponId};

pub(super) fn scene(enemy_x: f64) -> Sim {
    Sim::reset_active(
        SimConfig {
            consumables: false,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(7),
        &[
            Placement {
                profile: "owner".into(),
                faction: FactionId::Fire,
                bot: true,
                at: Vec2::new(300., 272.),
                hp: None,
                weapon0: Some(WeaponId::Wand),
                weapon1: None,
            },
            Placement {
                profile: "other".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(enemy_x, 272.),
                hp: None,
                weapon0: Some(WeaponId::Bow),
                weapon1: None,
            },
        ],
    )
}

fn ring(capacity: usize) -> FairPerceptRing14 {
    FairPerceptRing14::new(
        Epoch(1),
        PlayerRef::new(1).unwrap(),
        TierId::Normal,
        capacity,
        8,
    )
    .unwrap()
}

fn accepted(session: &mut DeliverySession, obs: &Observation) -> AcceptedFrame14 {
    let prepared = session.prepare(obs, false, false, &[]).unwrap();
    session.commit(prepared)
}

/// Existing checked projection/codec/commit, with explicitly declared public DTO data.
/// The custom time, UI strings and toasts are codec/retention probes, not earned gameplay.
fn dto(tick: u32, time: f64) -> Observation {
    let sim = scene(440.);
    let mut observer = rh_sim::ItemObserver::new(PlayerId(1));
    let mut obs = Observation::default();
    observer
        .prepare_into(&sim, &[], &mut obs, None)
        .unwrap()
        .commit();
    obs.tick = tick;
    obs.server_time = time;
    obs.quests = Some(
        serde_json::from_value(serde_json::json!({
            "unknown_count": 3, "display_unknown_count": 2, "owner_roster": 2,
            "roster": [{"id":1,"label":"same"},{"id":2,"label":"same"}],
            "rows": [{"handle":1,"def":"cache","giver":{"x":100.125,"y":200.25},
                "name":"same","giver_label":"decorative same","brief":"opaque brief",
                "objective":"server objective","reward":"saved reward wording",
                "state":"Done","expires_at":999.5,
                "participants":[{"id":1,"accepted":true,"progress":4,"visited":0},
                    {"id":2,"accepted":true,"progress":3,"visited":0}],
                "carrier":null,"done_by":"same","can_accept":false,"owner_accepted":true,
                "owner_progress":3,"owner_visited":0,"owner_completed":false,"owner_ready":false}],
            "objectives": []
        }))
        .unwrap(),
    );
    obs.trade = Some(rh_sim::traders::TradeView {
        trade_used: true,
        stats: vec![(rh_sim::traders::Stat::Armor, -0.)],
        barter_ready_at: Some(1234.125),
        ..Default::default()
    });
    obs.events = vec![
        rh_sim::observe::SeenEvent::Toast {
            text: "first".into(),
        },
        rh_sim::observe::SeenEvent::Toast {
            text: "first".into(),
        },
        rh_sim::observe::SeenEvent::Toast {
            text: "last".into(),
        },
        rh_sim::observe::SeenEvent::Stagger { id: PlayerId(2) },
        rh_sim::observe::SeenEvent::Swing {
            by: PlayerId(1),
            weapon: WeaponId::Sword,
            x: 300.125,
            y: 272.,
            a: 0.25,
        },
    ];
    obs
}

fn retained_frames(ring: &FairPerceptRing14) -> Vec<Frame14> {
    ring.retained()
        .iter()
        .map(|p| p.decoded().clone())
        .collect()
}

fn assert_unchanged(
    ring: &FairPerceptRing14,
    frames: &[Frame14],
    memory: &Memory,
    last: Option<(SampleId, u32, f64)>,
    affinity: &Option<SessionId>,
) {
    assert_eq!(retained_frames(ring), frames);
    assert_eq!(ring.memory(), memory);
    assert_eq!(ring.last, last);
    assert_eq!(&ring.affinity, affinity);
}

#[test]
fn complete_owned_current14_sample_keeps_all_leaves_and_feeds_real_player_memory() {
    let mut obs = dto(7, 350.125);
    let mut session = DeliverySession::new(PlayerId(1));
    let first = accepted(&mut session, &obs);
    let expected = first.frame().clone();
    let mut ring = ring(4);
    let view = ring
        .accept(
            &first,
            &[
                Required14::OwnerPresent,
                Required14::InventoryPresent,
                Required14::OwnerCombat,
            ],
        )
        .unwrap();
    assert_eq!(
        view.decoded(),
        &expected,
        "every owner/actor/group/cue scalar survives"
    );
    assert_eq!(view.source_time().to_bits(), 350.125_f64.to_bits());
    let Fact::Delivered(Some(owner)) = view.owner() else {
        panic!("owner")
    };
    let Fact::Delivered(Some(expected_owner)) = expected.owner() else {
        panic!("owner")
    };
    assert_eq!(owner.display, expected_owner);
    assert_eq!(owner.inventory, expected.inventory());
    assert_eq!(owner.combat, expected.owner_combat());
    let Fact::Delivered(Some(inventory)) = owner.inventory else {
        panic!("inventory")
    };
    assert!(inventory.slots[1].is_none(), "available empty stays empty");
    let Fact::Delivered(combat) = owner.combat else {
        panic!("combat")
    };
    assert_eq!(
        combat.ready_at, 0,
        "actual past ready clock was not restamped to now"
    );
    assert_eq!(
        view.actors().map(|a| *a.wire()).collect::<Vec<_>>(),
        expected.actors().map(|a| *a.wire()).collect::<Vec<_>>()
    );
    let q = view.collections().quests().unwrap();
    assert_eq!(q.roster[0].label, q.roster[1].label);
    assert_ne!(q.roster[0].id, q.roster[1].id);
    assert_eq!(q.rows[0].brief, "opaque brief");
    assert_eq!(q.rows[0].objective, "server objective");
    assert_eq!(q.rows[0].reward, "saved reward wording");
    let trade = view.collections().trade().unwrap();
    assert!(trade.trade_used);
    assert_eq!(trade.stats[0].value.to_bits(), (-0.0_f64).to_bits());
    assert_eq!(trade.barter_ready_at, Some(1234.125));
    assert_eq!(
        view.events()[0].events.len(),
        3,
        "duplicates retain their occurrence order"
    );
    assert_eq!(view.events(), first.frame().events());
    assert_eq!(view.fx(), first.frame().fx());
    assert_eq!(view.fx()[0].tick, 7);
    assert_eq!(view.fx()[0].fx.len(), 2);
    assert!(matches!(
        view.fx()[0].fx[0],
        rh_protocol::WireFx::Stagger { id: 2 }
    ));
    assert_eq!(ring.memory().records().len(), 1);
    assert_eq!(ring.memory().records()[0].id, PlayerRef::new(2).unwrap());
    assert_eq!(ring.memory().records()[0].faction, FactionId::Holy);
    assert_eq!(ring.memory().records()[0].in_hand, Some(WeaponId::Bow));
    assert_eq!(
        ring.memory().own_motion().unwrap().source_time.to_bits(),
        350.125_f64.to_bits()
    );
    obs.quests.as_mut().unwrap().rows[0].brief.clear();
    obs.trade.as_mut().unwrap().stats.clear();
    obs.me.as_mut().unwrap().hp = 0.;
    assert_eq!(
        ring.latest().unwrap().decoded(),
        &expected,
        "source/caller mutation cannot alter retained data"
    );
}

#[test]
fn omitted_update_retention_present_empty_and_authoritative_clears_stay_distinct() {
    let mut session = DeliverySession::new(PlayerId(1));
    let mut ring = ring(8);
    let first = accepted(&mut session, &dto(1, 50.1));
    ring.accept(&first, &[]).unwrap();
    let second = accepted(&mut session, &dto(2, 100.1));
    ring.accept(&second, &[]).unwrap();
    assert_eq!(
        first.frame().collections(),
        second.frame().collections(),
        "same groups retained across omitted updates; group sample time is retained too"
    );
    let mut empty = dto(3, 150.1);
    empty.quests = Some(rh_sim::quest_view::QuestView::default());
    empty.trade = Some(rh_sim::traders::TradeView::default());
    let third = accepted(&mut session, &empty);
    ring.accept(&third, &[]).unwrap();
    assert!(ring
        .latest()
        .unwrap()
        .collections()
        .quests()
        .unwrap()
        .rows
        .is_empty());
    assert!(ring
        .latest()
        .unwrap()
        .collections()
        .trade()
        .unwrap()
        .offers
        .is_empty());
    let mut clear = dto(4, 200.1);
    clear.quests = None;
    clear.trade = None;
    clear.inventory = None;
    clear.owner_combat = None;
    let fourth = accepted(&mut session, &clear);
    let memory = ring.memory().clone();
    assert_eq!(
        ring.accept(&fourth, &[Required14::InventoryPresent]).err(),
        Some(Refusal14::Missing(Required14::InventoryPresent))
    );
    assert_eq!(ring.memory(), &memory);
    ring.accept(&fourth, &[]).unwrap();
    assert!(ring.latest().unwrap().collections().quests().is_none());
    assert!(ring.latest().unwrap().collections().trade().is_none());
    let Fact::Delivered(Some(owner)) = ring.latest().unwrap().owner() else {
        panic!("owner")
    };
    assert_eq!(owner.inventory, Fact::Delivered(None));
    assert_eq!(owner.combat, Fact::Unavailable);
    clear.tick = 5;
    clear.server_time = 250.1;
    clear.me = None;
    let fifth = accepted(&mut session, &clear);
    let memory = ring.memory().clone();
    ring.accept(&fifth, &[]).unwrap();
    assert!(matches!(
        ring.latest().unwrap().owner(),
        Fact::Delivered(None)
    ));
    assert_eq!(
        ring.memory(),
        &memory,
        "owner clear never manufactures an OwnerSight"
    );
}

#[test]
fn stale_cross_session_full_and_bad_projection_refuse_without_partial_commit() {
    let mut session = DeliverySession::new(PlayerId(1));
    let first = accepted(&mut session, &dto(1, 50.125));
    let second = accepted(&mut session, &dto(2, 100.125));
    let mut ring = ring(1);
    ring.accept(&first, &[]).unwrap();
    let frames = retained_frames(&ring);
    let memory = ring.memory().clone();
    let last = ring.last;
    let affinity = ring.affinity.clone();
    assert_eq!(ring.accept(&second, &[]).err(), Some(Refusal14::Capacity));
    assert_unchanged(&ring, &frames, &memory, last, &affinity);
    assert_eq!(ring.accept(&first, &[]).err(), Some(Refusal14::Sequence));
    let mut foreign = DeliverySession::new(PlayerId(1));
    let foreign = accepted(&mut foreign, &dto(1, 50.125));
    assert_eq!(
        first.frame(),
        foreign.frame(),
        "public data equality is not session affinity"
    );
    assert_eq!(ring.accept(&foreign, &[]).err(), Some(Refusal14::Session));
    // Declared invalid public preview only; this does not mint an accepted receipt.
    let mut backward = second.frame().clone();
    backward.source_time = first.frame().source_time();
    assert_eq!(ring.check_preview(&backward, &[]), Err(Refusal14::Clock));
    let mut bad = dto(3, 150.125);
    bad.me.as_mut().unwrap().hp = f64::NAN;
    assert!(session.prepare(&bad, true, true, &[]).is_err());
    assert_unchanged(&ring, &frames, &memory, last, &affinity);
    assert_eq!(ring.release_through(SampleId(999)), Err(Refusal14::Release));
    assert_unchanged(&ring, &frames, &memory, last, &affinity);
    ring.release_through(SampleId(1)).unwrap();
    assert!(ring.is_empty());
    assert_eq!(ring.accept(&first, &[]).err(), Some(Refusal14::Sequence));
    ring.accept(&second, &[]).unwrap();
    assert_eq!(ring.latest().unwrap().decoded(), second.frame());
    assert_eq!(ring.memory().own_motion().unwrap().source_time, 100.125);
}

#[test]
fn unpublished_requirements_and_memory_limit_refuse_atomically_from_reached_state() {
    let mut session = DeliverySession::new(PlayerId(1));
    let first = accepted(&mut session, &dto(1, 50.125));
    let second = accepted(&mut session, &dto(2, 100.125));
    let mut ring = ring(4);
    ring.accept(&first, &[]).unwrap();
    let frames = retained_frames(&ring);
    let memory = ring.memory().clone();
    let last = ring.last;
    let affinity = ring.affinity.clone();
    for family in [
        Unpublished14::OwnerImmunity,
        Unpublished14::RemoteImmunity,
        Unpublished14::RemoteBowDraw,
        Unpublished14::WandCueHistory,
        Unpublished14::FlightCourses,
        Unpublished14::NpcContinuity,
        Unpublished14::ItemContinuity,
        Unpublished14::InterpolatedWorld,
    ] {
        assert_eq!(
            ring.latest().unwrap().unavailable(family),
            Fact::Unavailable
        );
        let required = Required14::Unpublished(family);
        assert_eq!(
            ring.check_preview(second.frame(), &[required]),
            Err(Refusal14::Missing(required))
        );
        assert_eq!(
            ring.accept(&second, &[required]).err(),
            Some(Refusal14::Missing(required))
        );
        assert_unchanged(&ring, &frames, &memory, last, &affinity);
    }
    ring.accept(&second, &[]).unwrap();
    let mut limited =
        FairPerceptRing14::new(Epoch(1), PlayerRef::new(1).unwrap(), TierId::Normal, 4, 1).unwrap();
    limited.accept(&first, &[]).unwrap();
    let mut another = dto(3, 150.125);
    let mut player = another.visible[0].clone();
    player.id = PlayerId(3);
    another.visible.push(player);
    let third = accepted(&mut session, &another);
    let prior = limited.memory().clone();
    // First consume the actual contiguous second sample; then hit genuine Memory's limit.
    limited.accept(&second, &[]).unwrap();
    let before = retained_frames(&limited);
    let current = limited.memory().clone();
    assert_eq!(
        limited.accept(&third, &[]).err(),
        Some(Refusal14::Memory(super::super::memory_prefix::Error::Limit))
    );
    assert_eq!(retained_frames(&limited), before);
    assert_eq!(limited.memory(), &current);
    assert_eq!(prior.records().len(), 1);
}

#[test]
fn explicit_new_session_reset_is_atomic_and_old_receipts_cannot_rejoin() {
    let mut old = DeliverySession::new(PlayerId(1));
    let first = accepted(&mut old, &dto(1, 500.125));
    let second = accepted(&mut old, &dto(2, 550.125));
    let mut ring = ring(4);
    ring.accept(&first, &[]).unwrap();
    ring.accept(&second, &[]).unwrap();
    let mut fresh = DeliverySession::new(PlayerId(1));
    let new = accepted(&mut fresh, &dto(1, 0.1));
    let before = retained_frames(&ring);
    let memory = ring.memory().clone();
    assert_eq!(
        ring.reset_from(
            &new,
            &[Required14::Unpublished(Unpublished14::OwnerImmunity)]
        ),
        Err(Refusal14::Missing(Required14::Unpublished(
            Unpublished14::OwnerImmunity
        )))
    );
    assert_eq!(retained_frames(&ring), before);
    assert_eq!(ring.memory(), &memory);
    ring.reset_from(&new, &[]).unwrap();
    assert_eq!(ring.len(), 1);
    assert_eq!(
        ring.latest().unwrap().source_time().to_bits(),
        0.1_f64.to_bits()
    );
    assert_eq!(
        ring.memory().own_motion().unwrap().source_time.to_bits(),
        0.1_f64.to_bits()
    );
    let before = retained_frames(&ring);
    let memory = ring.memory().clone();
    assert_eq!(ring.accept(&second, &[]).err(), Some(Refusal14::Session));
    assert_eq!(ring.reset_from(&new, &[]), Err(Refusal14::Session));
    assert_eq!(retained_frames(&ring), before);
    assert_eq!(ring.memory(), &memory);
}

#[test]
fn real_hidden_world_pair_has_equal_public_samples_and_player_memory() {
    let a = scene(1400.);
    let b = scene(1440.);
    let oa = rh_sim::try_observe(&a, PlayerId(1), &[]).unwrap();
    let ob = rh_sim::try_observe(&b, PlayerId(1), &[]).unwrap();
    assert!(oa.visible.is_empty() && ob.visible.is_empty());
    let fa = accepted(&mut DeliverySession::new(PlayerId(1)), &oa);
    let fb = accepted(&mut DeliverySession::new(PlayerId(1)), &ob);
    let mut ra = ring(2);
    let mut rb = ring(2);
    ra.accept(&fa, &[]).unwrap();
    rb.accept(&fb, &[]).unwrap();
    assert_eq!(retained_frames(&ra), retained_frames(&rb));
    assert_eq!(ra.memory(), rb.memory());
    assert!(ra.memory().records().is_empty());
}

#[test]
fn declared_neutral_actor_keeps_unarmed_current_row_without_joining_player_memory() {
    // Codec-shaped neutral row, not a native giver birth or public continuity proof.
    let mut obs = dto(1, 50.125);
    let mut neutral = obs.visible[0].clone();
    neutral.id = PlayerId(1 << 31);
    neutral.kind = rh_sim::observe::ActorKind::QuestGiver;
    neutral.faction = rh_sim::fighter::FighterAffiliation::Neutral;
    neutral.weapon = None;
    neutral.mob_type = None;
    obs.visible.push(neutral);
    let mut session = DeliverySession::new(PlayerId(1));
    let first = accepted(&mut session, &obs);
    obs.tick = 2;
    obs.server_time = 100.125;
    let second = accepted(&mut session, &obs);
    let mut ring = ring(4);
    ring.accept(&first, &[]).unwrap();
    let actor = ring
        .latest()
        .unwrap()
        .actors()
        .find(|a| a.kind() == crate::delivery::ActorKind14::QuestGiver)
        .unwrap();
    assert_eq!(actor.faction(), None);
    assert_eq!(actor.weapon(), None);
    let old_ref = actor.npc().unwrap();
    ring.accept(&second, &[]).unwrap();
    let actor = ring
        .latest()
        .unwrap()
        .actors()
        .find(|a| a.kind() == crate::delivery::ActorKind14::QuestGiver)
        .unwrap();
    assert_ne!(
        old_ref,
        actor.npc().unwrap(),
        "current row does not establish cross-sample NPC identity"
    );
    assert_eq!(ring.memory().records().len(), 1);
    assert_eq!(ring.memory().records()[0].id, PlayerRef::new(2).unwrap());
}

mod connected;
