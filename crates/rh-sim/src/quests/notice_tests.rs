//! Declared native controls are separate from actual captured source output comparisons.
use crate::{PlayerId, Sim};
fn place(s: &mut Sim, id: PlayerId, at: crate::Vec2) {
    let now = s.server_time();
    let p = s.w.players.get_mut(id).unwrap();
    p.body.x = at.x;
    p.body.y = at.y;
    p.body.facing = 0.;
    p.body.history.reset(crate::state::Sample {
        t: now,
        x: at.x,
        y: at.y,
    });
}
#[path = "notice_tests/source_public.rs"]
mod source_public;
#[test]
fn private_and_room_toasts_obey_visibility_without_label_identity() {
    let arena = super::live_tests::arena();
    let placements = arena
        .spawns
        .iter()
        .take(2)
        .map(|at| crate::Placement {
            profile: "same label".into(),
            faction: crate::FactionId::Holy,
            bot: false,
            at: *at,
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect::<Vec<_>>();
    let mut s = Sim::reset_active(
        crate::SimConfig {
            quests: true,
            pvp_rules: false,
            ..Default::default()
        },
        arena,
        crate::Secrets::from_seed(7),
        &placements,
    );
    let offer =
        s.w.quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find(|o| o.published)
            .unwrap()
            .clone();
    place(&mut s, PlayerId(1), offer.at);
    s.submit(
        PlayerId(1),
        crate::validate(crate::RawCommand::QuestAccept {
            quest_id: Some(offer.id),
        })
        .unwrap(),
    )
    .unwrap();
    let mut events = s.step();
    // Real quest hook producer, declared inline native control; source teleport event campaign is held separately.
    super::live::on_teleported(
        &mut crate::hooks::Hx {
            stats: Default::default(),
            k: &s.k,
            w: &mut s.w,
            ev: &mut events,
            fx: None,
        },
        &crate::hooks::HookArgs::Teleported,
    );
    let own = events
        .iter()
        .filter_map(|e| {
            if let crate::Event::Toast {
                to: Some(PlayerId(1)),
                text,
            } = e
            {
                Some(text.as_str())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    let public = events
        .iter()
        .filter_map(|e| {
            if let crate::Event::Toast { to: None, text } = e {
                Some(text.as_str())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    assert!(own.iter().any(|t| t.starts_with("Quest accepted: ")));
    assert_eq!(public.len(), 1);
    for id in [PlayerId(1), PlayerId(2)] {
        let view = crate::observe(&s, id, &events);
        let texts = view
            .events
            .iter()
            .filter_map(|e| {
                if let crate::SeenEvent::Toast { text } = e {
                    Some(text.as_str())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        assert_eq!(
            texts,
            if id == PlayerId(1) {
                own.iter().chain(public.iter()).copied().collect::<Vec<_>>()
            } else {
                public.clone()
            }
        );
    }
    assert!(events
        .iter()
        .filter(|e| matches!(e, crate::Event::Toast { .. }))
        .all(|e| e.class() == crate::events::Class::Important));
}

#[test]
fn missing_runtime_is_silent_even_for_a_stunned_human() {
    let mut s = Sim::new(
        crate::SimConfig {
            quests: true,
            min_players: 1,
            lobby_seconds: 0.,
            fill_seconds: 0.,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        crate::Secrets::from_seed(7),
    );
    s.add_player("quiet", Some(crate::FactionId::Holy), false)
        .unwrap();
    s.step();
    assert!(s.w.quests.is_none());
    assert!(crate::systems::status::operations::apply(
        &s.k,
        &mut s.w,
        &mut Vec::new(),
        PlayerId(1),
        crate::status_runtime::StatusApply {
            kind: crate::status_runtime::StatusKind::Stun,
            source: crate::status_runtime::StatusSource {
                id: None,
                name: std::sync::Arc::from(""),
                owner_id: None
            },
            ms: 1000.,
            ability: None,
            tag: None,
            value: None,
            add: None,
            data: None,
        },
        true
    )
    .is_some());
    s.submit(
        PlayerId(1),
        crate::validate(crate::RawCommand::QuestAccept { quest_id: None }).unwrap(),
    )
    .unwrap();
    assert!(s
        .step()
        .iter()
        .all(|e| !matches!(e, crate::Event::Toast { .. })));
}

#[test]
fn stale_closed_drop_has_no_new_parcel_or_announcement() {
    let mut s = super::live_tests::sim();
    let offer = s
        .w
        .quests
        .as_ref()
        .unwrap()
        .offers
        .iter()
        .find(|o| {
            o.published
                && super::catalog::DEFINITION[o.def as usize].kind == super::catalog::Kind::Fetch
        })
        .unwrap()
        .clone();
    place(&mut s, PlayerId(1), offer.at);
    s.submit(
        PlayerId(1),
        crate::validate(crate::RawCommand::QuestAccept {
            quest_id: Some(offer.id),
        })
        .unwrap(),
    )
    .unwrap();
    s.step();
    let cid = offer.containers[0];
    let at = s.w.containers.iter().find(|c| c.id == cid).unwrap().at;
    place(&mut s, PlayerId(1), at);
    s.submit(
        PlayerId(1),
        crate::validate(crate::RawCommand::Pickup { container_id: cid }).unwrap(),
    )
    .unwrap();
    s.step();
    assert_eq!(
        s.w.quests.as_ref().unwrap().carried,
        vec![(PlayerId(1), offer.id)]
    );
    // Declared noncanonical guard setup, not a source retirement: retain the stale carried-map link.
    s.w.quests
        .as_mut()
        .unwrap()
        .offers
        .iter_mut()
        .find(|o| o.id == offer.id)
        .unwrap()
        .status = super::live::Status::Expired;
    let counter = s.w.entity_counter;
    let mut events = Vec::new();
    super::live::on_drop_body(
        &mut crate::hooks::Hx {
            stats: Default::default(),
            k: &s.k,
            w: &mut s.w,
            ev: &mut events,
            fx: None,
        },
        &crate::hooks::HookArgs::DropBody {
            victim: PlayerId(1),
            between_ticks: false,
        },
    );
    assert_eq!(s.w.entity_counter, counter);
    assert!(s.w.quests.as_ref().unwrap().carried.is_empty());
    assert!(events.is_empty());
}
