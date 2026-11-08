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
    let arena = arena();
    let spawns = arena.spawns.clone();
    let placements: Vec<Placement> = spawns
        .iter()
        .take(3)
        .enumerate()
        .map(|(i, p)| Placement {
            profile: ["holy", "fire", "plague"][i].into(),
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
    let h = p.view.rows.iter().find(|r| r.def == def).unwrap().handle;
    assert!(p.view.objectives.is_empty());
    p.commit();
    teleport(&mut s, PlayerId(1), at);
    s.submit(PlayerId(1), owner.resolve_accept(&s, h)).unwrap();
    s.step();
    let p = owner.prepare(&s).unwrap();
    assert_eq!(
        p.view.objectives.iter().filter(|x| x.quest == h).count(),
        coords.len()
    );
    assert!(p.view.roster.iter().any(|r| r.label == "holy"));
    p.commit();
    let q = other.prepare(&s).unwrap();
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
