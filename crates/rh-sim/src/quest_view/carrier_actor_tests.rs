//! P-WIRE17-MAP-2 oracle (C-OBS): a quest row's `carrier_actor` is the carrier's public actor id (the id its row in
//! `Observation::visible` carries after the actor-reference projection; a player's is its own `PlayerId`) exactly when
//! the carrier is the viewer or is among the viewer's delivered actors this tick, and `None` otherwise. Legacy draws the
//! carrier flag at the carrier's rendered position (`packages/client/src/render/QuestView.ts:68-76`), which includes the
//! local player and only actors the client renders (`RaidScene.ts:614`).
use super::*;
use crate::item_view::ItemObserver;
use crate::{Observation, Placement, Secrets, SimConfig};

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
            bot: false,
            at: *p,
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    Sim::reset_active(
        SimConfig {
            quests: true,
            pvp_rules: false,
            ..Default::default()
        },
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

/// Player 1 accepts the first published Fetch quest at its giver and picks its parcel up: player 1 carries it.
/// Returns the quest's definition id and the parcel point.
fn carried_by_player_1(s: &mut Sim) -> (&'static str, Vec2) {
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
                .expect("seed 1 publishes a Fetch quest");
        (o.id, o.at, o.parcel.unwrap(), o.containers[0], o.def)
    };
    teleport(s, PlayerId(1), at);
    s.submit(
        PlayerId(1),
        validate(RawCommand::QuestAccept {
            quest_id: Some(qid),
        })
        .unwrap(),
    )
    .unwrap();
    s.step();
    teleport(s, PlayerId(1), parcel);
    s.submit(
        PlayerId(1),
        validate(RawCommand::Pickup {
            container_id: container,
        })
        .unwrap(),
    )
    .unwrap();
    s.step();
    let offer =
        s.w.quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find(|o| o.id == qid)
            .unwrap();
    assert_eq!(
        offer.carrier,
        Some(PlayerId(1)),
        "player 1 carries the parcel"
    );
    (catalog::DEFINITION[def as usize].id, parcel)
}

/// A fresh observer's complete observation (the server's and a policy seat's path).
fn observe(s: &Sim, viewer: PlayerId) -> Observation {
    let mut obs = Observation::default();
    ItemObserver::new(viewer)
        .observe_into(s, &[], &mut obs, None)
        .expect("observes");
    obs
}

fn row<'a>(obs: &'a Observation, def: &str) -> &'a QuestRow {
    obs.quests
        .as_ref()
        .expect("a seated human viewer has quests")
        .rows
        .iter()
        .find(|r| r.def == def)
        .expect("the published row")
}

fn sees(obs: &Observation, id: PlayerId) -> bool {
    obs.visible.iter().any(|a| a.id == id)
}

/// C-OBS for every row of an observation: an actor id only with a carrier, and only the viewer's own id or a delivered
/// actor's.
fn assert_no_leak(obs: &Observation, viewer: PlayerId) {
    for r in obs.quests.iter().flat_map(|q| &q.rows) {
        if let Some(actor) = r.carrier_actor {
            assert!(r.carrier.is_some(), "an actor id without a carrier");
            assert!(
                actor == viewer || sees(obs, actor),
                "carrier actor {actor:?} is neither the viewer nor delivered"
            );
        }
    }
}

/// The spawn point farthest from `from`: a floor tile the viewer can stand on, out of sight of the carrier.
fn far_from(s: &Sim, from: Vec2) -> Vec2 {
    let d = |p: &Vec2| (p.x - from.x) * (p.x - from.x) + (p.y - from.y) * (p.y - from.y);
    *s.k.arena
        .spawns
        .iter()
        .max_by(|a, b| d(a).total_cmp(&d(b)))
        .unwrap()
}

#[test]
fn another_seat_gets_the_carriers_actor_id_only_while_it_sees_the_carrier() {
    let mut s = sim();
    let (def, parcel) = carried_by_player_1(&mut s);

    // Player 2 far away: the carrier is not delivered, so no actor id (the roster carrier is still named).
    let far = far_from(&s, parcel);
    teleport(&mut s, PlayerId(2), far);
    let hidden = observe(&s, PlayerId(2));
    assert!(
        !sees(&hidden, PlayerId(1)),
        "precondition: the carrier is out of sight"
    );
    assert!(
        row(&hidden, def).carrier.is_some(),
        "the row still names a carrier"
    );
    assert_eq!(row(&hidden, def).carrier_actor, None, "hidden carrier");
    assert_no_leak(&hidden, PlayerId(2));

    // Player 2 beside the carrier: the actor id is the one player 1's delivered actor row carries.
    teleport(&mut s, PlayerId(2), Vec2::new(parcel.x + 8.0, parcel.y));
    let seen = observe(&s, PlayerId(2));
    assert!(
        sees(&seen, PlayerId(1)),
        "precondition: the carrier is delivered"
    );
    assert_eq!(
        row(&seen, def).carrier_actor,
        Some(PlayerId(1)),
        "visible carrier"
    );
    assert_no_leak(&seen, PlayerId(2));
}

#[test]
fn the_carrier_sees_its_own_actor_id() {
    let mut s = sim();
    let (def, _) = carried_by_player_1(&mut s);
    let own = observe(&s, PlayerId(1));
    assert_eq!(
        row(&own, def).carrier_actor,
        Some(PlayerId(1)),
        "legacy flags the local player too (RaidScene renders the local player)"
    );
    assert_no_leak(&own, PlayerId(1));
}

#[test]
fn guard_no_carrier_no_actor_and_an_unseated_viewer_gets_no_quests() {
    let s = sim();
    for viewer in [PlayerId(1), PlayerId(2), PlayerId(3)] {
        let obs = observe(&s, viewer);
        for r in obs.quests.iter().flat_map(|q| &q.rows) {
            assert_eq!(
                (r.carrier, r.carrier_actor),
                (None, None),
                "nobody carries yet"
            );
        }
    }
    let mut s = s;
    carried_by_player_1(&mut s);
    let unseated = observe(&s, PlayerId(99));
    assert!(
        unseated.quests.is_none(),
        "an unseated viewer has no quest view"
    );
    assert!(unseated.visible.is_empty());
}

#[test]
fn guard_a_dead_viewer_gets_no_actor_id_it_is_not_delivered() {
    let mut s = sim();
    let (_, parcel) = carried_by_player_1(&mut s);
    teleport(&mut s, PlayerId(2), Vec2::new(parcel.x + 8.0, parcel.y));
    let i = s.w.idx(PlayerId(2)).unwrap();
    s.w.players[i].status = crate::sim::Status::Dead;
    let obs = observe(&s, PlayerId(2));
    assert_no_leak(&obs, PlayerId(2));
}
