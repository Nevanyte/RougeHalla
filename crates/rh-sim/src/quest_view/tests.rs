use super::*;
use crate::{Placement, Secrets, SimConfig};

fn arena() -> crate::Arena {
    use crate::mapgen::{coliseum, map_hash, pipeline};
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    let map = generator
        .generate_styled(
            1,
            Some(0),
            pipeline::Options {
                decor: false,
                ..Default::default()
            },
        )
        .expect("seed 1 attempt 0 generates");
    let hash = u32::from_str_radix(&map_hash::map_hash(&map), 16).unwrap();
    crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: hash,
        map,
    }
    .validate()
    .expect("admitted")
    .into_arena()
    .expect("arena")
}

fn sim() -> Sim {
    sim_with_bots([false; 3])
}

fn sim_with_bots(bots: [bool; 3]) -> Sim {
    sim_with_names(bots, ["holy", "fire", "plague"])
}

fn sim_with_names(bots: [bool; 3], names: [&str; 3]) -> Sim {
    let arena = arena();
    let spawns = arena.spawns.clone();
    let placements: Vec<Placement> = spawns
        .iter()
        .take(3)
        .enumerate()
        .map(|(i, p)| Placement {
            profile: names[i].into(),
            faction: [
                crate::FactionId::Holy,
                crate::FactionId::Fire,
                crate::FactionId::Plague,
            ][i],
            bot: bots[i],
            at: *p,
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let config = SimConfig {
        quests: true,
        pvp_rules: false,
        ..Default::default()
    };
    Sim::reset_active(
        config,
        arena,
        Secrets {
            order_salt: 7,
            spawn_seed: 0,
            reward_salt: [1, 2, 3, 4],
        },
        &placements,
    )
}

fn teleport(sim: &mut Sim, id: PlayerId, at: Vec2) {
    let i = sim.w.idx(id).expect("player");
    sim.w.players[i].body.x = at.x;
    sim.w.players[i].body.y = at.y;
}

#[test]
fn prepared_authority_is_committed_atomically_and_reconnect_revokes_it() {
    let mut s = sim();
    let mut observer = QuestObserver::new(PlayerId(1));
    let offer =
        s.w.quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find(|o| o.published)
            .unwrap();
    let (qid, at) = (offer.id, offer.at);
    let pending = observer.prepare(&s).unwrap();
    let handle = pending
        .view
        .rows
        .iter()
        .find(|r| r.def == catalog::DEFINITION[offer.def as usize].id)
        .unwrap()
        .handle;
    drop(pending);
    let miss = validate(RawCommand::QuestAccept { quest_id: None }).unwrap();
    assert_eq!(observer.resolve_accept(&s, handle), miss);
    let pending = observer.prepare(&s).unwrap();
    assert_eq!(
        pending
            .view
            .rows
            .iter()
            .find(|r| r.handle == handle)
            .unwrap()
            .state,
        RowState::Open
    );
    pending.commit();
    teleport(&mut s, PlayerId(1), at);
    let cmd = observer.resolve_accept(&s, handle);
    assert_ne!(cmd, miss);
    s.submit(PlayerId(1), cmd).unwrap();
    s.step();
    assert!(s
        .w
        .quests
        .as_ref()
        .unwrap()
        .offers
        .iter()
        .find(|o| o.id == qid)
        .unwrap()
        .accepted
        .contains(&PlayerId(1)));
    observer.reconnect();
    assert_eq!(observer.resolve_accept(&s, handle), miss);
    let next = observer.prepare(&s).unwrap();
    assert!(!next.view.rows.iter().any(|r| r.handle == handle));
}

#[test]
fn hidden_world_does_not_change_view_or_id_allocation() {
    let a = sim();
    let mut b = a.clone();
    let hidden =
        b.w.quests
            .as_mut()
            .unwrap()
            .offers
            .iter_mut()
            .find(|o| !o.published)
            .unwrap();
    hidden.at.x += 19.;
    hidden.tokens.reverse();
    hidden.accepted.push(PlayerId(3));
    let mut oa = QuestObserver::new(PlayerId(1));
    let mut ob = QuestObserver::new(PlayerId(1));
    let pa = oa.prepare(&a).unwrap();
    let pb = ob.prepare(&b).unwrap();
    assert_eq!(pa.view, pb.view);
    pa.commit();
    pb.commit();
    let qa = oa.prepare(&a).unwrap();
    let qb = ob.prepare(&b).unwrap();
    assert_eq!(qa.view, qb.view);
}

#[test]
fn finder_preview_restores_and_stays_nonactionable_until_public_delivery() {
    let mut s = sim();
    let (qid, at, def) = {
        let offer =
            s.w.quests
                .as_ref()
                .unwrap()
                .offers
                .iter()
                .find(|o| !o.published)
                .unwrap();
        (
            offer.id,
            offer.at,
            catalog::DEFINITION[offer.def as usize].id,
        )
    };
    teleport(&mut s, PlayerId(1), at);
    s.step();
    let serialized = serde_json::to_string(&s).unwrap();
    let mut s = Sim::restore(&mut serde_json::Deserializer::from_str(&serialized)).unwrap();
    let mut finder = QuestObserver::new(PlayerId(1));
    let mut other = QuestObserver::new(PlayerId(2));
    let preview = finder.prepare(&s).unwrap();
    let row = preview.view.rows.iter().find(|r| r.def == def).unwrap();
    let handle = row.handle;
    assert_eq!(row.state, RowState::Preview);
    assert!(!preview.view.objectives.iter().any(|o| o.quest == handle));
    preview.commit();
    assert!(!other
        .prepare(&s)
        .unwrap()
        .view
        .rows
        .iter()
        .any(|r| r.def == def));
    let miss = validate(RawCommand::QuestAccept { quest_id: None }).unwrap();
    assert_eq!(finder.resolve_accept(&s, handle), miss);
    for _ in 0..81 {
        s.step();
    }
    assert!(s
        .w
        .quests
        .as_ref()
        .unwrap()
        .offers
        .iter()
        .any(|o| o.id == qid && o.published));
    assert_eq!(
        finder.resolve_accept(&s, handle),
        miss,
        "preview delivery cannot grant a later public action"
    );
    let public = finder.prepare(&s).unwrap();
    assert_eq!(
        public
            .view
            .rows
            .iter()
            .find(|r| r.def == def)
            .unwrap()
            .handle,
        handle
    );
    public.commit();
    // Some kill offers immediately close as impossible; the committed row remains safely nonactionable in that case.
    let open =
        s.w.quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find(|o| o.id == qid)
            .unwrap()
            .status
            == Status::Open;
    assert_eq!(finder.resolve_accept(&s, handle) != miss, open);
}

#[test]
fn accepted_objectives_are_navigation_only_and_roster_is_lazy() {
    let mut s = sim();
    let (qid, at, def, coords) = {
        let o = s
            .w
            .quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find(|o| {
                o.published && catalog::DEFINITION[o.def as usize].kind == catalog::Kind::Collect
            })
            .unwrap();
        (
            o.id,
            o.at,
            catalog::DEFINITION[o.def as usize].id,
            o.tokens.clone(),
        )
    };
    let mut owner = QuestObserver::new(PlayerId(1));
    let mut other = QuestObserver::new(PlayerId(2));
    let p = owner.prepare(&s).unwrap();
    assert!(p.view.roster.is_empty());
    assert!(p.view.owner_roster.is_none());
    let h = p.view.rows.iter().find(|r| r.def == def).unwrap().handle;
    assert!(p.view.objectives.is_empty());
    p.commit();
    teleport(&mut s, PlayerId(1), at);
    s.submit(PlayerId(1), owner.resolve_accept(&s, h)).unwrap();
    s.step();
    let p = owner.prepare(&s).unwrap();
    assert!(p.view.owner_roster.is_some());
    assert_eq!(
        p.view.objectives.iter().filter(|x| x.quest == h).count(),
        coords.len()
    );
    assert!(p.view.roster.iter().any(|r| r.label == "holy"));
    p.commit();
    let q = other.prepare(&s).unwrap();
    assert!(q.view.owner_roster.is_none());
    assert!(q.view.objectives.is_empty());
    let row = q.view.rows.iter().find(|r| r.def == def).unwrap();
    assert_eq!(row.participants.len(), 1);
    assert!(q
        .view
        .roster
        .iter()
        .any(|r| r.id == row.participants[0].id && r.label == "holy"));
    assert!(s
        .w
        .quests
        .as_ref()
        .unwrap()
        .offers
        .iter()
        .find(|o| o.id == qid)
        .unwrap()
        .accepted
        .contains(&PlayerId(1)));
}

#[test]
fn collect_completion_and_foreign_fetch_carrier_remove_ground_navigation() {
    let mut s = sim();
    let (collect_id, collect_at, tokens, boxes, count) = {
        let o = s
            .w
            .quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find(|o| {
                o.published && catalog::DEFINITION[o.def as usize].kind == catalog::Kind::Collect
            })
            .unwrap();
        (
            o.id,
            o.at,
            o.tokens.clone(),
            o.containers.clone(),
            catalog::DEFINITION[o.def as usize].count,
        )
    };
    let mut viewer = QuestObserver::new(PlayerId(1));
    let prepared = viewer.prepare(&s).unwrap();
    let collect = prepared
        .view
        .rows
        .iter()
        .find(|r| r.giver == collect_at)
        .unwrap()
        .handle;
    prepared.commit();
    teleport(&mut s, PlayerId(1), collect_at);
    s.submit(PlayerId(1), viewer.resolve_accept(&s, collect))
        .unwrap();
    s.step();
    for n in 0..count as usize {
        teleport(&mut s, PlayerId(1), tokens[n]);
        s.submit(
            PlayerId(1),
            validate(RawCommand::Pickup {
                container_id: boxes[n],
            })
            .unwrap(),
        )
        .unwrap();
        s.step();
    }
    let offer =
        s.w.quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find(|o| o.id == collect_id)
            .unwrap();
    assert!(!offer.containers.is_empty(), "source places surplus tokens");
    let p = viewer.prepare(&s).unwrap();
    let row = p.view.rows.iter().find(|r| r.handle == collect).unwrap();
    assert!(row.owner_ready);
    assert_eq!(row.owner_progress, count);
    assert_eq!(row.owner_visited, 0);
    assert!(!row.owner_completed);
    assert!(!p.view.objectives.iter().any(|o| o.quest == collect));
    p.commit();

    let (fetch_id, fetch_at, parcel, box_id) = {
        let o =
            s.w.quests
                .as_ref()
                .unwrap()
                .offers
                .iter()
                .find(|o| {
                    o.published && catalog::DEFINITION[o.def as usize].kind == catalog::Kind::Fetch
                })
                .unwrap();
        (o.id, o.at, o.parcel.unwrap(), o.containers[0])
    };
    // Both humans accept using the validated source action door; player 2 then picks up the real parcel.
    for id in [PlayerId(1), PlayerId(2)] {
        teleport(&mut s, id, fetch_at);
        s.submit(
            id,
            validate(RawCommand::QuestAccept {
                quest_id: Some(fetch_id),
            })
            .unwrap(),
        )
        .unwrap();
        s.step();
    }
    teleport(&mut s, PlayerId(2), parcel);
    s.submit(
        PlayerId(2),
        validate(RawCommand::Pickup {
            container_id: box_id,
        })
        .unwrap(),
    )
    .unwrap();
    s.step();
    let p = viewer.prepare(&s).unwrap();
    let row = p.view.rows.iter().find(|r| r.giver == fetch_at).unwrap();
    assert!(row.carrier.is_some());
    assert!(!row.owner_ready);
    assert!(!p.view.objectives.iter().any(|o| o.quest == row.handle));
    assert!(p
        .view
        .roster
        .iter()
        .any(|entry| Some(entry.id) == row.carrier && entry.label == "fire"));
}

#[test]
fn exhaustion_and_failed_preparation_leave_existing_bindings_intact() {
    let mut s = sim();
    let mut observer = QuestObserver::new(PlayerId(1));
    let p = observer.prepare(&s).unwrap();
    let handle = p.view.rows[0].handle;
    p.commit();
    let valid = observer.resolve_accept(&s, handle);
    // Synthetic boundary control: a newly entitled identity cannot be allocated at the exhausted counter.
    observer.state.next_roster = u64::from(u32::MAX) + 1;
    let offer =
        s.w.quests
            .as_mut()
            .unwrap()
            .offers
            .iter_mut()
            .find(|o| o.published)
            .unwrap();
    offer.accepted.push(PlayerId(2));
    assert!(matches!(observer.prepare(&s), Err(Error::IdExhausted)));
    assert_eq!(observer.resolve_accept(&s, handle), valid);
    assert!(observer.state.roster.is_empty());
}

#[test]
fn bot_view_is_empty_and_a_retired_quest_handle_is_a_miss() {
    let mut s = sim_with_bots([true, false, false]);
    let mut bot = QuestObserver::new(PlayerId(1));
    assert_eq!(bot.prepare(&s).unwrap().view, QuestView::default());
    let mut human = QuestObserver::new(PlayerId(2));
    let p = human.prepare(&s).unwrap();
    let handle = p.view.rows[0].handle;
    p.commit();
    assert_ne!(
        human.resolve_accept(&s, handle),
        validate(RawCommand::QuestAccept { quest_id: None }).unwrap()
    );
    // Exercise the actual close-all hook, which retires offers during arena teleport.
    crate::hooks::fire(
        &mut crate::hooks::Hx {
            stats: Default::default(),
            k: &s.k,
            w: &mut s.w,
            ev: &mut Vec::new(),
            fx: None,
        },
        crate::hooks::HookArgs::Teleported,
    );
    assert_eq!(
        human.resolve_accept(&s, handle),
        validate(RawCommand::QuestAccept { quest_id: None }).unwrap()
    );
}

#[test]
fn labels_use_utf8_byte_bound_without_rewriting() {
    let label = "é".repeat(127);
    assert_eq!(checked_label(&label).unwrap(), label);
    assert_eq!(checked_label(&"é".repeat(128)), Err(Error::InvalidLabel));
    assert_eq!(
        checked_label("a\nb").unwrap(),
        "a\nb",
        "this seam does not invent ingress sanitization"
    );
}

#[test]
fn publication_between_preview_preparation_and_commit_never_grants_action() {
    let mut s = sim();
    let (id, at, def) = {
        let o =
            s.w.quests
                .as_ref()
                .unwrap()
                .offers
                .iter()
                .find(|o| {
                    !o.published && catalog::DEFINITION[o.def as usize].kind != catalog::Kind::Kill
                })
                .unwrap();
        (o.id, o.at, catalog::DEFINITION[o.def as usize].id)
    };
    teleport(&mut s, PlayerId(1), at);
    s.step();
    let mut observer = QuestObserver::new(PlayerId(1));
    let prepared = observer.prepare(&s).unwrap();
    let preview = prepared.view.rows.iter().find(|r| r.def == def).unwrap();
    assert_eq!(preview.state, RowState::Preview);
    let handle = preview.handle;
    // The guard retains only its own staged snapshot; the world may advance before delivery.
    for _ in 0..81 {
        s.step();
    }
    assert!(s
        .w
        .quests
        .as_ref()
        .unwrap()
        .offers
        .iter()
        .any(|o| o.id == id && o.published && o.status == Status::Open));
    prepared.commit();
    let miss = validate(RawCommand::QuestAccept { quest_id: None }).unwrap();
    assert_eq!(observer.resolve_accept(&s, handle), miss);
    let public = observer.prepare(&s).unwrap();
    assert_eq!(
        public
            .view
            .rows
            .iter()
            .find(|r| r.def == def)
            .unwrap()
            .handle,
        handle
    );
    public.commit();
    assert_ne!(observer.resolve_accept(&s, handle), miss);
}

#[test]
fn hidden_roster_and_exhaustion_do_not_change_projection_or_failure() {
    let mut a = sim();
    let mut b = a.clone();
    // Deliberately malformed hidden accepted state tests the filtering boundary, not a reachable bot/input path.
    b.w.quests
        .as_mut()
        .unwrap()
        .offers
        .iter_mut()
        .find(|o| !o.published)
        .unwrap()
        .accepted
        .push(PlayerId(3));
    let mut oa = QuestObserver::new(PlayerId(1));
    let mut ob = QuestObserver::new(PlayerId(1));
    oa.state.next_roster = u64::from(u32::MAX) + 1;
    ob.state.next_roster = u64::from(u32::MAX) + 1;
    let pa = oa.prepare(&a).unwrap();
    let pb = ob.prepare(&b).unwrap();
    assert_eq!(pa.view, pb.view);
    pa.commit();
    pb.commit();
    // Now a public participant requires allocation in both; both fail with no grant or partial binding.
    for s in [&mut a, &mut b] {
        s.w.quests
            .as_mut()
            .unwrap()
            .offers
            .iter_mut()
            .find(|o| o.published)
            .unwrap()
            .accepted
            .push(PlayerId(2));
    }
    assert!(matches!(oa.prepare(&a), Err(Error::IdExhausted)));
    assert!(matches!(ob.prepare(&b), Err(Error::IdExhausted)));
    assert!(oa.state.roster.is_empty());
    assert!(ob.state.roster.is_empty());
}

#[test]
fn adding_a_published_participant_preserves_the_existing_roster_identity() {
    let mut s = sim();
    let (quest_id, at) = {
        let o =
            s.w.quests
                .as_ref()
                .unwrap()
                .offers
                .iter()
                .find(|o| o.published)
                .unwrap();
        (o.id, o.at)
    };
    let mut observer = QuestObserver::new(PlayerId(3));
    teleport(&mut s, PlayerId(1), at);
    s.submit(
        PlayerId(1),
        validate(RawCommand::QuestAccept {
            quest_id: Some(quest_id),
        })
        .unwrap(),
    )
    .unwrap();
    s.step();
    let first = observer.prepare(&s).unwrap();
    let id = first
        .view
        .roster
        .iter()
        .find(|entry| entry.label == "holy")
        .unwrap()
        .id;
    first.commit();
    teleport(&mut s, PlayerId(2), at);
    s.submit(
        PlayerId(2),
        validate(RawCommand::QuestAccept {
            quest_id: Some(quest_id),
        })
        .unwrap(),
    )
    .unwrap();
    s.step();
    let second = observer.prepare(&s).unwrap();
    assert_eq!(
        second
            .view
            .roster
            .iter()
            .find(|entry| entry.label == "holy")
            .unwrap()
            .id,
        id
    );
    assert_ne!(
        second
            .view
            .roster
            .iter()
            .find(|entry| entry.label == "fire")
            .unwrap()
            .id,
        id
    );
    let row = second.view.rows.iter().find(|row| row.giver == at).unwrap();
    assert_eq!(row.participants.len(), 2);
}

#[test]
fn combined_observer_commits_quest_and_pickup_authority_together() {
    use crate::{ItemObserver, Observation, PublicCommand};
    let mut s = sim();
    let (qid, at, token, box_id, def) = {
        let o = s
            .w
            .quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find(|o| {
                o.published && catalog::DEFINITION[o.def as usize].kind == catalog::Kind::Collect
            })
            .unwrap();
        (
            o.id,
            o.at,
            o.tokens[0],
            o.containers[0],
            catalog::DEFINITION[o.def as usize].id,
        )
    };
    let mut observer = ItemObserver::new(PlayerId(1));
    let mut observation = Observation::default();
    let pending = observer
        .prepare_into(&s, &[], &mut observation, None)
        .unwrap();
    let handle = observation
        .quests
        .as_ref()
        .unwrap()
        .rows
        .iter()
        .find(|r| r.def == def)
        .unwrap()
        .handle;
    drop(pending);
    let miss = validate(RawCommand::QuestAccept { quest_id: None }).unwrap();
    assert_eq!(
        observer
            .resolve(&s, PublicCommand::QuestAccept { handle })
            .unwrap(),
        miss
    );
    observer
        .prepare_into(&s, &[], &mut observation, None)
        .unwrap()
        .commit();
    teleport(&mut s, PlayerId(1), at);
    let command = observer
        .resolve(&s, PublicCommand::QuestAccept { handle })
        .unwrap();
    s.submit(PlayerId(1), command).unwrap();
    s.step();
    teleport(&mut s, PlayerId(1), token);
    s.step();
    let pending = observer
        .prepare_into(&s, &[], &mut observation, None)
        .unwrap();
    let item = observation
        .props
        .iter()
        .find(|p| matches!(p.cue.kind, crate::PropKind::QuestItem { quest, .. } if quest == handle))
        .unwrap()
        .handle;
    assert!(observation
        .quests
        .as_ref()
        .unwrap()
        .objectives
        .iter()
        .any(|o| o.quest == handle));
    drop(pending);
    assert_eq!(
        observer
            .resolve(&s, PublicCommand::Pickup { handle: item })
            .unwrap(),
        validate(RawCommand::MissingPickup).unwrap()
    );
    observer
        .prepare_into(&s, &[], &mut observation, None)
        .unwrap()
        .commit();
    let command = observer
        .resolve(&s, PublicCommand::Pickup { handle: item })
        .unwrap();
    assert_ne!(command, validate(RawCommand::MissingPickup).unwrap());
    s.submit(PlayerId(1), command).unwrap();
    s.step();
    let offer =
        s.w.quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find(|o| o.id == qid)
            .unwrap();
    assert!(!offer.containers.contains(&box_id));
    assert_eq!(
        offer
            .progress
            .iter()
            .find(|(id, _)| *id == PlayerId(1))
            .unwrap()
            .1,
        1
    );
    assert_eq!(
        observer
            .resolve(&s, PublicCommand::Pickup { handle: item })
            .unwrap(),
        validate(RawCommand::MissingPickup).unwrap()
    );
}

#[test]
fn combined_preview_reports_both_unknown_counts_and_cannot_accept() {
    use crate::{ItemObserver, Observation, PublicCommand};
    let mut s = sim();
    let o =
        s.w.quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find(|o| !o.published)
            .unwrap();
    let at = o.at;
    let id = o.id;
    let def = catalog::DEFINITION[o.def as usize].id;
    // Declared setup isolates one finder preview; placement fidelity is covered by the pinned source corpus.
    for o in &mut s.w.quests.as_mut().unwrap().offers {
        if !o.published && o.id != id {
            o.at = Vec2::new(8000., 8000.);
        }
    }
    teleport(&mut s, PlayerId(1), at);
    s.step();
    let mut observer = ItemObserver::new(PlayerId(1));
    let mut observation = Observation::default();
    let pending = observer
        .prepare_into(&s, &[], &mut observation, None)
        .unwrap();
    let q = observation.quests.as_ref().unwrap();
    assert_eq!(q.unknown_count, 10);
    assert_eq!(q.display_unknown_count, 9);
    assert!(q.owner_roster.is_none());
    let preview = q.rows.iter().find(|r| r.def == def).unwrap();
    assert_eq!(preview.owner_progress, 0);
    assert_eq!(preview.owner_visited, 0);
    assert!(!preview.owner_completed);
    let handle = preview.handle;
    pending.commit();
    assert_eq!(
        observer
            .resolve(&s, PublicCommand::QuestAccept { handle })
            .unwrap(),
        validate(RawCommand::QuestAccept { quest_id: None }).unwrap()
    );
}

#[test]
fn navigation_never_grants_a_far_or_newborn_pickup_handle() {
    use crate::{ItemObserver, Observation};
    let mut s = sim();
    let (id, at, token, box_id) = {
        let o = s
            .w
            .quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find(|o| {
                o.published && catalog::DEFINITION[o.def as usize].kind == catalog::Kind::Collect
            })
            .unwrap();
        (o.id, o.at, o.tokens[0], o.containers[0])
    };
    teleport(&mut s, PlayerId(1), at);
    s.submit(
        PlayerId(1),
        validate(RawCommand::QuestAccept { quest_id: Some(id) }).unwrap(),
    )
    .unwrap();
    s.step();
    let mut observer = ItemObserver::new(PlayerId(1));
    let mut observation = Observation::default();
    let pending = observer
        .prepare_into(&s, &[], &mut observation, None)
        .unwrap();
    assert!(!observation.quests.as_ref().unwrap().objectives.is_empty());
    assert!(!observation
        .props
        .iter()
        .any(|p| matches!(p.cue.kind, crate::PropKind::QuestItem { .. })));
    pending.commit();
    // Declared birth-tick setup checks that a visible in-range fresh item has no actionable binding.
    teleport(&mut s, PlayerId(1), token);
    let c = s.w.containers.iter_mut().find(|c| c.id == box_id).unwrap();
    c.born_tick = s.w.tick;
    let pending = observer
        .prepare_into(&s, &[], &mut observation, None)
        .unwrap();
    assert!(!observation
        .props
        .iter()
        .any(|p| matches!(p.cue.kind, crate::PropKind::QuestItem { .. })));
    pending.commit();
    s.step();
    let pending = observer
        .prepare_into(&s, &[], &mut observation, None)
        .unwrap();
    let handle = observation
        .props
        .iter()
        .find(|p| matches!(p.cue.kind, crate::PropKind::QuestItem { .. }))
        .unwrap()
        .handle;
    pending.commit();
    // Declared stun setup tests that a previously delivered handle is rechecked against current action state.
    let now = s.server_time();
    s.w.players[0]
        .statuses
        .instances
        .push(crate::status_runtime::StatusInstance {
            kind: crate::status_runtime::StatusKind::Stun,
            source: crate::status_runtime::StatusSource {
                id: None,
                owner_id: None,
                name: "test".into(),
            },
            ability: None,
            tag: None,
            started_at: now,
            until: now + 500.,
            value: 1.,
            reveal_from: None,
            taken: None,
            data: Default::default(),
        });
    assert_eq!(
        observer
            .resolve(&s, crate::PublicCommand::Pickup { handle })
            .unwrap(),
        validate(RawCommand::MissingPickup).unwrap()
    );
    let pending = observer
        .prepare_into(&s, &[], &mut observation, None)
        .unwrap();
    assert!(!observation
        .props
        .iter()
        .any(|p| matches!(p.cue.kind, crate::PropKind::QuestItem { .. })));
    pending.commit();
}

#[test]
fn combined_bot_observer_never_receives_quest_rows_or_props() {
    use crate::{ItemObserver, Observation};
    let mut s = sim_with_bots([true, false, false]);
    let (quest_id, token) = {
        let o = s
            .w
            .quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find(|o| {
                o.published && catalog::DEFINITION[o.def as usize].kind == catalog::Kind::Collect
            })
            .unwrap();
        (o.id, o.tokens[0])
    };
    // Forged acceptance is a defense-in-depth control; bots cannot legally acquire it through the input door.
    s.w.quests
        .as_mut()
        .unwrap()
        .offers
        .iter_mut()
        .find(|o| o.id == quest_id)
        .unwrap()
        .accepted
        .push(PlayerId(1));
    teleport(&mut s, PlayerId(1), token);
    s.step();
    let mut observer = ItemObserver::new(PlayerId(1));
    let mut observation = Observation::default();
    observer
        .prepare_into(&s, &[], &mut observation, None)
        .unwrap()
        .commit();
    assert!(observation.quests.is_none());
    assert!(!observation
        .props
        .iter()
        .any(|p| matches!(p.cue.kind, crate::PropKind::QuestItem { .. })));
}

#[test]
fn published_accept_eligibility_tracks_authoritative_action_outcomes() {
    use crate::quests::live::{accept_eligibility, AcceptRefusal};
    use crate::{ItemObserver, Observation, PublicCommand};
    let mut s = sim();
    let (qid, at, def) = {
        let o =
            s.w.quests
                .as_ref()
                .unwrap()
                .offers
                .iter()
                .find(|o| o.published)
                .unwrap();
        (o.id, o.at, catalog::DEFINITION[o.def as usize].id)
    };
    let mut observer = ItemObserver::new(PlayerId(1));
    let mut observation = Observation::default();
    teleport(&mut s, PlayerId(1), Vec2::new(at.x + 1000., at.y + 1000.));
    let pending = observer
        .prepare_into(&s, &[], &mut observation, None)
        .unwrap();
    let row = observation
        .quests
        .as_ref()
        .unwrap()
        .rows
        .iter()
        .find(|r| r.def == def)
        .unwrap();
    assert!(!row.can_accept);
    let handle = row.handle;
    pending.commit();
    s.submit(
        PlayerId(1),
        observer
            .resolve(&s, PublicCommand::QuestAccept { handle })
            .unwrap(),
    )
    .unwrap();
    s.step();
    assert!(s
        .w
        .quests
        .as_ref()
        .unwrap()
        .offers
        .iter()
        .find(|o| o.id == qid)
        .unwrap()
        .accepted
        .is_empty());
    teleport(&mut s, PlayerId(1), at);
    // Declared status setup: source checks busy before offer lookup, even for a made-up ID.
    let now = s.server_time();
    s.w.players[0]
        .statuses
        .instances
        .push(crate::status_runtime::StatusInstance {
            kind: crate::status_runtime::StatusKind::Stun,
            source: crate::status_runtime::StatusSource {
                id: None,
                owner_id: None,
                name: "test".into(),
            },
            ability: None,
            tag: None,
            started_at: now,
            until: now + 500.,
            value: 1.,
            reveal_from: None,
            taken: None,
            data: Default::default(),
        });
    assert_eq!(
        accept_eligibility(&s.k, &s.w, PlayerId(1), Some(u32::MAX)),
        Err(AcceptRefusal::Busy)
    );
    let pending = observer
        .prepare_into(&s, &[], &mut observation, None)
        .unwrap();
    assert!(
        !observation
            .quests
            .as_ref()
            .unwrap()
            .rows
            .iter()
            .find(|r| r.def == def)
            .unwrap()
            .can_accept
    );
    pending.commit();
    s.submit(
        PlayerId(1),
        observer
            .resolve(&s, PublicCommand::QuestAccept { handle })
            .unwrap(),
    )
    .unwrap();
    s.step();
    assert!(s
        .w
        .quests
        .as_ref()
        .unwrap()
        .offers
        .iter()
        .find(|o| o.id == qid)
        .unwrap()
        .accepted
        .is_empty());
    s.w.players[0].statuses.instances.clear();
    let pending = observer
        .prepare_into(&s, &[], &mut observation, None)
        .unwrap();
    assert!(
        observation
            .quests
            .as_ref()
            .unwrap()
            .rows
            .iter()
            .find(|r| r.def == def)
            .unwrap()
            .can_accept
    );
    pending.commit();
    s.submit(
        PlayerId(1),
        observer
            .resolve(&s, PublicCommand::QuestAccept { handle })
            .unwrap(),
    )
    .unwrap();
    s.step();
    let pending = observer
        .prepare_into(&s, &[], &mut observation, None)
        .unwrap();
    let row = observation
        .quests
        .as_ref()
        .unwrap()
        .rows
        .iter()
        .find(|r| r.def == def)
        .unwrap();
    assert!(row.owner_accepted);
    assert!(!row.can_accept);
    assert_eq!(
        accept_eligibility(&s.k, &s.w, PlayerId(1), Some(qid)),
        Err(AcceptRefusal::Already)
    );
    pending.commit();
}

fn accept_at(sim: &mut Sim, player: PlayerId, quest: u32, at: Vec2) {
    // Declared position bootstrap, then the actual validated acceptance producer; no acceptance/progress is installed.
    teleport(sim, player, at);
    sim.submit(
        player,
        validate(RawCommand::QuestAccept {
            quest_id: Some(quest),
        })
        .unwrap(),
    )
    .unwrap();
    sim.step();
}

fn committed_view(observer: &mut QuestObserver, sim: &Sim) -> QuestView {
    let pending = observer.prepare(sim).unwrap();
    let view = pending.view.clone();
    pending.commit();
    view
}

fn assert_owner_is_delivered(view: &QuestView) {
    if let Some(owner) = view.owner_roster {
        assert_eq!(
            view.roster.iter().filter(|entry| entry.id == owner).count(),
            1
        );
    }
}

#[test]
fn duplicate_labels_do_not_confuse_owner_identity_or_fetch_completion() {
    // Duplicate labels are a declared sim-seat bootstrap, not a claim that the account service issues duplicate owners.
    let mut s = sim_with_names([false; 3], ["same", "same", "watcher"]);
    let (qid, at, parcel, container, def) = {
        let o =
            s.w.quests
                .as_ref()
                .unwrap()
                .offers
                .iter()
                .find(|o| {
                    o.published && catalog::DEFINITION[o.def as usize].kind == catalog::Kind::Fetch
                })
                .unwrap();
        (o.id, o.at, o.parcel.unwrap(), o.containers[0], o.def)
    };
    let key = catalog::DEFINITION[def as usize].id;
    let mut first = QuestObserver::new(PlayerId(1));
    let mut second = QuestObserver::new(PlayerId(2));
    assert!(committed_view(&mut first, &s).owner_roster.is_none());
    accept_at(&mut s, PlayerId(1), qid, at);
    accept_at(&mut s, PlayerId(2), qid, at);
    let a = committed_view(&mut first, &s);
    let b = committed_view(&mut second, &s);
    for view in [&a, &b] {
        assert_owner_is_delivered(view);
        assert_eq!(view.roster.len(), 2);
        assert!(view.roster.iter().all(|entry| entry.label == "same"));
        assert_ne!(view.roster[0].id, view.roster[1].id);
        let row = view.rows.iter().find(|row| row.def == key).unwrap();
        let owner = view.owner_roster.unwrap();
        assert!(row.participants.iter().any(|p| p.id == owner && p.accepted));
        assert!(row.owner_accepted);
        assert_eq!(row.owner_progress, 0);
        assert_eq!(row.owner_visited, 0);
        assert!(!row.owner_ready && !row.owner_completed);
    }
    // Each view is seat-scoped. In these fresh observers' identical allocations, the two owners resolve to distinct rows.
    assert_ne!(a.owner_roster, b.owner_roster);
    teleport(&mut s, PlayerId(1), parcel);
    s.submit(
        PlayerId(1),
        validate(RawCommand::Pickup {
            container_id: container,
        })
        .unwrap(),
    )
    .unwrap();
    s.step();
    let carrying = committed_view(&mut first, &s);
    let row = carrying.rows.iter().find(|row| row.def == key).unwrap();
    assert_eq!(row.carrier, carrying.owner_roster);
    assert!(row.owner_ready);
    assert_eq!(
        row.owner_progress, 0,
        "Fetch does not invent a count from its carrier"
    );
    assert!(!row.owner_completed);
    teleport(&mut s, PlayerId(1), at);
    s.step();
    let before = s.state_hash();
    let a = committed_view(&mut first, &s);
    let b = committed_view(&mut second, &s);
    assert_eq!(s.state_hash(), before, "projection does not mutate the sim");
    for (view, completed) in [(&a, true), (&b, false)] {
        assert_owner_is_delivered(view);
        let row = view.rows.iter().find(|row| row.def == key).unwrap();
        assert_eq!(row.state, RowState::Done);
        assert_eq!(row.done_by.as_deref(), Some("same"));
        assert_eq!(row.owner_completed, completed);
        assert!(row.owner_accepted, "completion preserves accepted history");
        assert_eq!(row.owner_progress, 0);
        assert_eq!(row.owner_visited, 0);
        assert!(row.carrier.is_none());
        assert!(!row.owner_ready);
    }
}

#[test]
fn collect_owner_count_survives_actual_turn_in_and_expiry() {
    let mut s = sim();
    let (qid, at, tokens, containers, count, key) = {
        let o = s
            .w
            .quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find(|o| {
                o.published && catalog::DEFINITION[o.def as usize].kind == catalog::Kind::Collect
            })
            .unwrap();
        let def = &catalog::DEFINITION[o.def as usize];
        (
            o.id,
            o.at,
            o.tokens.clone(),
            o.containers.clone(),
            def.count,
            def.id,
        )
    };
    let mut observer = QuestObserver::new(PlayerId(1));
    let before = committed_view(&mut observer, &s);
    let row = before.rows.iter().find(|row| row.def == key).unwrap();
    assert!(!row.owner_accepted && !row.owner_ready && !row.owner_completed);
    assert_eq!(row.owner_progress, 0);
    assert_eq!(row.owner_visited, 0);
    accept_at(&mut s, PlayerId(1), qid, at);
    let mut expired = None;
    for n in 0..count as usize {
        teleport(&mut s, PlayerId(1), tokens[n]);
        s.submit(
            PlayerId(1),
            validate(RawCommand::Pickup {
                container_id: containers[n],
            })
            .unwrap(),
        )
        .unwrap();
        s.step();
        let view = committed_view(&mut observer, &s);
        assert_owner_is_delivered(&view);
        let row = view.rows.iter().find(|row| row.def == key).unwrap();
        assert_eq!(row.owner_progress, n as u32 + 1);
        assert_eq!(row.owner_ready, n as u32 + 1 == count);
        assert_eq!(row.owner_visited, 0);
        assert!(!row.owner_completed);
        if n == 0 {
            expired = Some(s.clone());
        }
    }
    teleport(&mut s, PlayerId(1), at);
    s.step();
    let complete = committed_view(&mut observer, &s);
    let row = complete.rows.iter().find(|row| row.def == key).unwrap();
    assert_eq!(row.state, RowState::Done);
    assert!(row.owner_completed && row.owner_accepted);
    assert_eq!(row.owner_progress, count);
    assert!(!row.owner_ready);
    let mut expired = expired.unwrap();
    // Declared deadline-boundary setup, then the actual expiry producer. No closed state/outcome is installed.
    let deadline = expired.server_time() + crate::constants::TICK_MS;
    expired
        .w
        .quests
        .as_mut()
        .unwrap()
        .offers
        .iter_mut()
        .find(|o| o.id == qid)
        .unwrap()
        .expires_at = deadline;
    expired.step();
    let expired = committed_view(&mut QuestObserver::new(PlayerId(1)), &expired);
    assert_owner_is_delivered(&expired);
    let row = expired.rows.iter().find(|row| row.def == key).unwrap();
    assert_eq!(row.state, RowState::Expired);
    assert!(row.owner_accepted);
    assert_eq!(row.owner_progress, 1);
    assert_eq!(row.owner_visited, 0);
    assert!(!row.owner_ready && !row.owner_completed);
}

#[test]
fn tour_owner_mask_and_count_come_from_the_real_progress_hook() {
    let mut s = sim();
    let (qid, at, key) = {
        let o =
            s.w.quests
                .as_ref()
                .unwrap()
                .offers
                .iter()
                .find(|o| o.published && catalog::DEFINITION[o.def as usize].tour > 0)
                .expect("the declared seed has a published tour");
        (o.id, o.at, catalog::DEFINITION[o.def as usize].id)
    };
    accept_at(&mut s, PlayerId(1), qid, at);
    // Direct real hook invocation isolates projection of a producer's output; this is not an ordinary NPC-kill witness.
    for zone in [
        crate::FactionId::Fire,
        crate::FactionId::Fire,
        crate::FactionId::Holy,
    ] {
        crate::hooks::fire(
            &mut crate::hooks::Hx {
                stats: Default::default(),
                k: &s.k,
                w: &mut s.w,
                ev: &mut Vec::new(),
                fx: None,
            },
            crate::hooks::HookArgs::MobKilled {
                killer: PlayerId(1),
                mob_type: crate::mob_catalog::normal_types_of(zone).next().unwrap().id,
                zone,
                camp: -1,
                elite: false,
                at: Vec2::new(0., 0.),
                contributors: Vec::new(),
            },
        );
    }
    let view = committed_view(&mut QuestObserver::new(PlayerId(1)), &s);
    assert_owner_is_delivered(&view);
    let row = view.rows.iter().find(|row| row.def == key).unwrap();
    assert_eq!(row.owner_progress, 2);
    assert_eq!(
        row.owner_visited,
        (1 << crate::FactionId::Fire.code()) | (1 << crate::FactionId::Holy.code())
    );
    assert!(!row.owner_ready && !row.owner_completed);
    let me = row
        .participants
        .iter()
        .find(|p| Some(p.id) == view.owner_roster)
        .unwrap();
    assert_eq!(me.progress, row.owner_progress);
    assert_eq!(me.visited, row.owner_visited);
    // Declared deadline boundary as above: expiry changes live readiness, not the producer's recorded tour history.
    let deadline = s.server_time() + crate::constants::TICK_MS;
    s.w.quests
        .as_mut()
        .unwrap()
        .offers
        .iter_mut()
        .find(|o| o.id == qid)
        .unwrap()
        .expires_at = deadline;
    s.step();
    let expired = committed_view(&mut QuestObserver::new(PlayerId(1)), &s);
    let closed = expired.rows.iter().find(|row| row.def == key).unwrap();
    assert_eq!(closed.state, RowState::Expired);
    assert_eq!(closed.owner_progress, row.owner_progress);
    assert_eq!(closed.owner_visited, row.owner_visited);
    assert!(!closed.owner_ready && !closed.owner_completed);
}

#[test]
fn owner_roster_is_lazy_even_after_retained_history_or_exhaustion() {
    let mut s = sim();
    let (qid, at) = {
        let o =
            s.w.quests
                .as_ref()
                .unwrap()
                .offers
                .iter()
                .find(|o| o.published)
                .unwrap();
        (o.id, o.at)
    };
    let mut absent = QuestObserver::new(PlayerId(1));
    absent.state.next_roster = u64::from(u32::MAX) + 1;
    let p = absent.prepare(&s).unwrap();
    assert!(p.view.owner_roster.is_none() && p.view.roster.is_empty());
    p.commit();
    assert!(
        absent.state.roster.is_empty(),
        "own presence alone does not allocate an identity"
    );
    accept_at(&mut s, PlayerId(1), qid, at);
    let mut observer = QuestObserver::new(PlayerId(1));
    let pending = observer.prepare(&s).unwrap();
    let staged_owner = pending.view.owner_roster.unwrap();
    let staged_handle = pending
        .view
        .rows
        .iter()
        .find(|r| r.giver == at)
        .unwrap()
        .handle;
    assert_owner_is_delivered(&pending.view);
    drop(pending);
    assert!(observer.state.roster.is_empty());
    assert_eq!(observer.state.next_roster, 1);
    assert_eq!(
        observer.resolve_accept(&s, staged_handle),
        validate(RawCommand::QuestAccept { quest_id: None }).unwrap()
    );
    let committed = committed_view(&mut observer, &s);
    assert_eq!(committed.owner_roster, Some(staged_owner));
    observer.reconnect();
    let resumed = committed_view(&mut observer, &s);
    assert_owner_is_delivered(&resumed);
    assert!(resumed.owner_roster.unwrap().get() > staged_owner.get());
    let retained = observer.state.next_roster;
    // The real close-all hook and ordinary linger expiry remove every entitled row, without erasing observer history.
    crate::hooks::fire(
        &mut crate::hooks::Hx {
            stats: Default::default(),
            k: &s.k,
            w: &mut s.w,
            ev: &mut Vec::new(),
            fx: None,
        },
        crate::hooks::HookArgs::Teleported,
    );
    let until = s.server_time() + crate::constants::CLOSED_QUEST_LINGER_MS;
    while s.server_time() <= until {
        s.step();
    }
    assert!(observer.state.roster.contains_key(&PlayerId(1)));
    let empty = committed_view(&mut observer, &s);
    assert!(empty.owner_roster.is_none() && empty.roster.is_empty() && empty.rows.is_empty());
    assert_eq!(observer.state.next_roster, retained);
}

#[test]
fn hidden_owner_records_cannot_allocate_roster_or_leak_through_preview_facts() {
    let mut a = sim();
    let (id, at, key) = {
        let o =
            a.w.quests
                .as_ref()
                .unwrap()
                .offers
                .iter()
                .find(|o| !o.published)
                .unwrap();
        (o.id, o.at, catalog::DEFINITION[o.def as usize].id)
    };
    teleport(&mut a, PlayerId(1), at);
    a.step();
    let mut b = a.clone();
    let hidden =
        b.w.quests
            .as_mut()
            .unwrap()
            .offers
            .iter_mut()
            .find(|o| o.id == id)
            .unwrap();
    assert_eq!(hidden.finder, Some(PlayerId(1)));
    assert!(!hidden.published);
    // Deliberately malformed hidden records isolate the redaction boundary, not a reachable acceptance/progress path.
    hidden.accepted.push(PlayerId(1));
    hidden.progress.push((PlayerId(1), 7));
    hidden.visits.push((PlayerId(1), 0b1_1111));
    hidden.done_by = Some(PlayerId(1));
    let mut oa = QuestObserver::new(PlayerId(1));
    let mut ob = QuestObserver::new(PlayerId(1));
    oa.state.next_roster = u64::from(u32::MAX) + 1;
    ob.state.next_roster = u64::from(u32::MAX) + 1;
    let pa = oa.prepare(&a).unwrap();
    let pb = ob.prepare(&b).unwrap();
    assert_eq!(pa.view, pb.view);
    assert!(pb.view.owner_roster.is_none() && pb.view.roster.is_empty());
    let row = pb.view.rows.iter().find(|row| row.def == key).unwrap();
    assert_eq!(row.state, RowState::Preview);
    assert_eq!(row.owner_progress, 0);
    assert_eq!(row.owner_visited, 0);
    assert!(!row.owner_accepted && !row.owner_ready && !row.owner_completed);
    drop(pa);
    drop(pb);
    assert!(oa.state.roster.is_empty() && ob.state.roster.is_empty());
}
