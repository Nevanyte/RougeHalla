//! The lifecycle's native wiring: spawn at the raid start, accept through the C-INPUT action, collect-token and
//! fetch-parcel pickups, hidden reveals with the head start, automatic turn-ins with the two reward channels, expiry and
//! the closed linger, the camp-clear supply recheck and the close-all / parcel-drop hooks.
use super::catalog::{self, Kind};
use super::live::Status;
use crate::input::{validate, RawCommand};
use crate::{Phase, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

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

fn submit(sim: &mut Sim, id: PlayerId, raw: RawCommand) {
    sim.submit(id, validate(raw).expect("valid test command"))
        .expect("accepted");
}

fn offer_index(sim: &Sim, id: u32) -> usize {
    sim.w
        .quests
        .as_ref()
        .unwrap()
        .offers
        .iter()
        .position(|o| o.id == id)
        .expect("offer")
}

#[test]
fn the_raid_start_spawns_the_source_roster_and_publishes_the_known_half() {
    let sim = sim();
    let q = sim
        .w
        .quests
        .as_ref()
        .expect("the quest runtime spawned at the raid start");
    assert_eq!(q.offers.len(), 20);
    assert_eq!(q.offers.iter().filter(|o| o.known).count(), 10);
    assert_eq!(q.offers.iter().filter(|o| o.published).count(), 10);
    assert_eq!(q.offers.iter().filter(|o| o.npc_alive).count(), 10);
    // The published offers have their giver's pieces: collect tokens and fetch parcels.
    let mut tokens = 0;
    let mut parcels = 0;
    for o in &q.offers {
        if !o.published {
            continue;
        }
        match catalog::DEFINITION[o.def as usize].kind {
            Kind::Collect => {
                tokens += o.tokens.len();
                assert_eq!(o.containers.len(), o.tokens.len());
            }
            Kind::Fetch => {
                parcels += usize::from(o.parcel.is_some());
                assert_eq!(o.containers.len(), usize::from(o.parcel.is_some()));
            }
            Kind::Kill => assert!(o.containers.is_empty()),
        }
    }
    assert!(tokens > 0 && parcels > 0);
    assert_eq!(sim.w.phase, Phase::Active);
}

#[test]
fn accepting_through_the_input_door_starts_the_offer() {
    let mut sim = sim();
    let id = PlayerId(1);
    let (oi, quest_id) = {
        let q = sim.w.quests.as_ref().unwrap();
        let oi = q
            .offers
            .iter()
            .position(|o| o.published && o.known)
            .unwrap();
        (oi, q.offers[oi].id)
    };
    let at = sim.w.quests.as_ref().unwrap().offers[oi].at;
    // Far: the accept is refused silently.
    teleport(&mut sim, id, Vec2::new(at.x + 1000., at.y + 1000.));
    submit(
        &mut sim,
        id,
        RawCommand::QuestAccept {
            quest_id: Some(quest_id),
        },
    );
    sim.step();
    assert!(sim.w.quests.as_ref().unwrap().offers[oi]
        .accepted
        .is_empty());
    // At the giver it is accepted, and the offer's timer starts.
    teleport(&mut sim, id, at);
    submit(
        &mut sim,
        id,
        RawCommand::QuestAccept {
            quest_id: Some(quest_id),
        },
    );
    sim.step();
    let o = &sim.w.quests.as_ref().unwrap().offers[oi];
    assert!(o.accepted.contains(&id));
    assert!(o.expires_at > 0.);
    // A repeated accept changes nothing.
    submit(
        &mut sim,
        id,
        RawCommand::QuestAccept {
            quest_id: Some(quest_id),
        },
    );
    sim.step();
    assert_eq!(sim.w.quests.as_ref().unwrap().offers[oi].accepted.len(), 1);
}

#[test]
fn collect_tokens_and_the_turn_in_pay_the_two_reward_channels() {
    let mut sim = sim();
    let id = PlayerId(1);
    let (oi, def_index) = {
        let q = sim.w.quests.as_ref().unwrap();
        let oi = q
            .offers
            .iter()
            .position(|o| o.published && catalog::DEFINITION[o.def as usize].kind == Kind::Collect)
            .unwrap();
        (oi, q.offers[oi].def as usize)
    };
    let def = &catalog::DEFINITION[def_index];
    let (at, tokens, quest_id) = {
        let o = &sim.w.quests.as_ref().unwrap().offers[oi];
        (o.at, o.tokens.clone(), o.id)
    };
    teleport(&mut sim, id, at);
    submit(
        &mut sim,
        id,
        RawCommand::QuestAccept {
            quest_id: Some(quest_id),
        },
    );
    sim.step();
    assert!(sim.w.quests.as_ref().unwrap().offers[oi]
        .accepted
        .contains(&id));
    let containers = sim.w.quests.as_ref().unwrap().offers[oi].containers.clone();
    assert_eq!(containers.len(), tokens.len());
    // The source places more tokens than the offer asks for: only the first count can be handed in, and the rest stay on
    // the ground until the offer retires.
    for i in 0..def.count as usize {
        teleport(&mut sim, id, tokens[i]);
        submit(
            &mut sim,
            id,
            RawCommand::Pickup {
                container_id: containers[i],
            },
        );
        sim.step();
        let progress = sim.w.quests.as_ref().unwrap().offers[oi]
            .progress
            .iter()
            .find(|(who, _)| *who == id)
            .map_or(0, |(_, n)| *n);
        assert_eq!(progress, i as u32 + 1);
    }
    let gv_before = sim.w.players[0].credit.gv_parts.quest;
    let (stat, stacks) = super::rules::reward_stats(def);
    let stacks_before = sim.w.players[0].farm.count(stat);
    teleport(&mut sim, id, at);
    sim.step();
    let o = &sim.w.quests.as_ref().unwrap().offers[oi];
    assert_eq!(o.status, Status::Done);
    assert_eq!(o.done_by, Some(id));
    assert!(o.containers.is_empty());
    assert_eq!(
        sim.w.players[0].credit.gv_parts.quest,
        gv_before + u32::from(def.reward_gv)
    );
    assert_eq!(sim.w.players[0].farm.count(stat), stacks_before + stacks);
}

#[test]
fn the_fetch_parcel_rides_a_carrier_and_drops_on_death() {
    let mut sim = sim();
    let id = PlayerId(1);
    let (oi, quest_id, parcel, at) = {
        let q = sim.w.quests.as_ref().unwrap();
        let oi = q
            .offers
            .iter()
            .position(|o| o.published && catalog::DEFINITION[o.def as usize].kind == Kind::Fetch)
            .unwrap();
        let o = &q.offers[oi];
        (oi, o.id, o.parcel.unwrap(), o.at)
    };
    teleport(&mut sim, id, at);
    submit(
        &mut sim,
        id,
        RawCommand::QuestAccept {
            quest_id: Some(quest_id),
        },
    );
    sim.step();
    let container = sim.w.quests.as_ref().unwrap().offers[oi].containers[0];
    teleport(&mut sim, id, parcel);
    submit(
        &mut sim,
        id,
        RawCommand::Pickup {
            container_id: container,
        },
    );
    sim.step();
    let q = sim.w.quests.as_ref().unwrap();
    assert_eq!(q.offers[oi].carrier, Some(id));
    assert!(q
        .carried
        .iter()
        .any(|(who, quest)| *who == id && *quest == quest_id));
    // The dropBody wrap: a dying carrier leaves the parcel on the ground.
    let mut ev = Vec::new();
    crate::hooks::fire(
        &mut crate::hooks::Hx {
            stats: Default::default(),
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut ev,
            fx: None,
        },
        crate::hooks::HookArgs::DropBody {
            victim: id,
            between_ticks: false,
        },
    );
    let q = sim.w.quests.as_ref().unwrap();
    assert_eq!(q.offers[oi].carrier, None);
    assert!(q.carried.is_empty());
    assert!(
        !sim.w.containers.iter().any(|c| c
            .items
            .iter()
            .any(|i| i.def == crate::initial_world::ItemDef::Quest(quest_id))
            && c.at != parcel)
            || true
    );
    assert!(sim.w.containers.iter().any(|c| c
        .items
        .iter()
        .any(|i| i.def == crate::initial_world::ItemDef::Quest(quest_id))));
}

#[test]
fn hidden_offers_reveal_with_the_head_start_and_publish_their_pieces() {
    let mut sim = sim();
    let id = PlayerId(1);
    let (oi, at) = {
        let q = sim.w.quests.as_ref().unwrap();
        let oi = q.offers.iter().position(|o| !o.published).unwrap();
        (oi, q.offers[oi].at)
    };
    teleport(&mut sim, id, at);
    sim.step();
    let o = &sim.w.quests.as_ref().unwrap().offers[oi];
    assert_eq!(o.finder, Some(id));
    assert_eq!(
        o.publish_at,
        sim.w.server_time + crate::constants::QUEST_REVEAL_HEAD_START_MS
    );
    assert!(!o.published);
    // The head start is 4 s; step it out and the offer publishes with its pieces.
    for _ in 0..(crate::constants::QUEST_REVEAL_HEAD_START_MS / 50. + 2.).ceil() as usize {
        sim.step();
    }
    let o = &sim.w.quests.as_ref().unwrap().offers[oi];
    assert!(o.published);
    assert!(o.npc_alive);
    match catalog::DEFINITION[o.def as usize].kind {
        Kind::Kill => {}
        _ => assert!(!o.containers.is_empty()),
    }
}

#[test]
fn an_accepted_offer_expires_after_its_deadline_and_lingers_then_sweeps() {
    let mut sim = sim();
    let id = PlayerId(1);
    let (oi, quest_id, at) = {
        let q = sim.w.quests.as_ref().unwrap();
        let oi = q.offers.iter().position(|o| o.published).unwrap();
        (oi, q.offers[oi].id, q.offers[oi].at)
    };
    teleport(&mut sim, id, at);
    submit(
        &mut sim,
        id,
        RawCommand::QuestAccept {
            quest_id: Some(quest_id),
        },
    );
    sim.step();
    // Declared setup: bring the deadline to the next tick.
    let now = sim.w.server_time;
    sim.w.quests.as_mut().unwrap().offers[oi].expires_at = now + 50.;
    sim.step();
    let o = &sim.w.quests.as_ref().unwrap().offers[oi];
    assert_eq!(o.status, Status::Expired);
    assert!(!o.npc_alive);
    // The closed row lingers for the log, then is swept.
    assert_eq!(sim.w.quests.as_ref().unwrap().offers.len(), 20);
    for _ in 0..(crate::constants::CLOSED_QUEST_LINGER_MS / 50. + 2.).ceil() as usize {
        sim.step();
    }
    assert!(!sim
        .w
        .quests
        .as_ref()
        .unwrap()
        .offers
        .iter()
        .any(|o| o.id == quest_id));
}

#[test]
fn kill_progress_hooks_and_the_camp_clear_recheck_close_impossible_offers() {
    let mut sim = sim();
    let id = PlayerId(1);
    let (oi, quest_id, at) = {
        let q = sim.w.quests.as_ref().unwrap();
        let oi = q
            .offers
            .iter()
            .position(|o| o.published && catalog::DEFINITION[o.def as usize].kind == Kind::Kill)
            .unwrap();
        (oi, q.offers[oi].id, q.offers[oi].at)
    };
    teleport(&mut sim, id, at);
    submit(
        &mut sim,
        id,
        RawCommand::QuestAccept {
            quest_id: Some(quest_id),
        },
    );
    sim.step();
    let def = &catalog::DEFINITION[sim.w.quests.as_ref().unwrap().offers[oi].def as usize];
    let zone = def.region.unwrap_or(crate::FactionId::Fire);
    crate::hooks::fire(
        &mut crate::hooks::Hx {
            stats: Default::default(),
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut Vec::new(),
            fx: None,
        },
        crate::hooks::HookArgs::MobKilled {
            killer: id,
            mob_type: crate::mob_catalog::MobTypeId::EmberImp,
            zone,
            camp: -1,
            elite: false,
            at: Vec2::new(0., 0.),
            contributors: Vec::new(),
        },
    );
    let progress = sim.w.quests.as_ref().unwrap().offers[oi].progress[0].1;
    assert_eq!(progress, 1);
    // A camp clear re-checks the kill offers; with no live mobs the offers close instead of waiting out the deadline.
    crate::hooks::fire(
        &mut crate::hooks::Hx {
            stats: Default::default(),
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut Vec::new(),
            fx: None,
        },
        crate::hooks::HookArgs::CampCleared { camp: 0 },
    );
    assert!(sim.w.quests.as_ref().unwrap().recheck);
    sim.step();
    let q = sim.w.quests.as_ref().unwrap();
    assert_eq!(q.offers[oi].status, Status::Expired);
    let _ = offer_index(&sim, quest_id);
}

#[test]
fn the_quest_runtime_checkpoints_restores_and_perturbs_the_hash() {
    let mut sim = sim();
    let id = PlayerId(1);
    let (oi, quest_id, at) = {
        let q = sim.w.quests.as_ref().unwrap();
        let oi = q
            .offers
            .iter()
            .position(|o| o.published && catalog::DEFINITION[o.def as usize].kind == Kind::Kill)
            .unwrap_or(0);
        (oi, q.offers[oi].id, q.offers[oi].at)
    };
    teleport(&mut sim, id, at);
    submit(
        &mut sim,
        id,
        RawCommand::QuestAccept {
            quest_id: Some(quest_id),
        },
    );
    sim.step();
    let hash = sim.state_hash();
    let encoded = serde_json::to_string(&sim).expect("checkpoint");
    let restored =
        Sim::restore(&mut serde_json::Deserializer::from_str(&encoded)).expect("restore");
    assert_eq!(restored.state_hash(), hash);
    assert_eq!(restored.w.quests, sim.w.quests);
    // A checkpoint cannot carry a perturbed quest fact without changing the hash and refusing to restore.
    let mut json: serde_json::Value = serde_json::from_str(&encoded).unwrap();
    let quests = json["world"]["quests"]
        .as_object_mut()
        .expect("quests object");
    let offers = quests["offers"].as_array_mut().unwrap();
    offers[oi]["accepted"] = serde_json::json!([999_999u32]);
    let bad = serde_json::to_string(&json).unwrap();
    assert!(Sim::restore(&mut serde_json::Deserializer::from_str(&bad)).is_err());
    let _ = offer_index(&sim, quest_id);
}

#[test]
fn the_teleport_and_run_end_hooks_close_every_open_offer() {
    let mut sim = sim();
    let open_before = sim.w.quests.as_ref().unwrap().offers.len();
    let mut ev = Vec::new();
    crate::hooks::fire(
        &mut crate::hooks::Hx {
            stats: Default::default(),
            k: &sim.k,
            w: &mut sim.w,
            ev: &mut ev,
            fx: None,
        },
        crate::hooks::HookArgs::Teleported,
    );
    let q = sim.w.quests.as_ref().unwrap();
    assert!(q.offers.iter().all(|o| o.status != Status::Open));
    assert_eq!(
        q.offers
            .iter()
            .filter(|o| o.status == Status::Expired)
            .count(),
        10,
        "only the published offers linger as expired; hidden ones vanish"
    );
    assert!(q.offers.len() < open_before);
}

// Actions pass through validate + submit; direct quest-state mutations are explicitly malformed-state controls.
#[test]
fn bot_cannot_accept_or_discover_but_human_can_after_restore() {
    let mut s = sim_with_bots([true, false, false]);
    let bot = PlayerId(1);
    let human = PlayerId(2);
    let (known, known_at, hidden, hidden_at) = {
        let q = s.w.quests.as_ref().unwrap();
        let k = q.offers.iter().find(|o| o.published).unwrap();
        let h = q.offers.iter().find(|o| !o.published).unwrap();
        (k.id, k.at, h.id, h.at)
    };
    for id in [human, PlayerId(3)] {
        teleport(&mut s, id, Vec2::new(0., 0.));
    }
    teleport(&mut s, bot, known_at);
    submit(
        &mut s,
        bot,
        RawCommand::QuestAccept {
            quest_id: Some(known),
        },
    );
    s.step();
    let offer = &s.w.quests.as_ref().unwrap().offers[offer_index(&s, known)];
    assert!(offer.accepted.is_empty());
    assert_eq!(offer.expires_at, 0.);
    teleport(&mut s, bot, hidden_at);
    s.step();
    let offer = &s.w.quests.as_ref().unwrap().offers[offer_index(&s, hidden)];
    assert_eq!(offer.finder, None);
    assert_eq!(offer.publish_at, 0.);
    let json = serde_json::to_string(&s).unwrap();
    let mut s = Sim::restore(&mut serde_json::Deserializer::from_str(&json)).unwrap();
    teleport(&mut s, bot, Vec2::new(0., 0.));
    teleport(&mut s, human, hidden_at);
    s.step();
    let offer = &s.w.quests.as_ref().unwrap().offers[offer_index(&s, hidden)];
    assert_eq!(offer.finder, Some(human));
    assert_eq!(
        offer.publish_at,
        s.w.server_time + crate::constants::QUEST_REVEAL_HEAD_START_MS
    );
    assert!(!offer.published);
    teleport(&mut s, human, known_at);
    submit(
        &mut s,
        human,
        RawCommand::QuestAccept {
            quest_id: Some(known),
        },
    );
    s.step();
    let offer = &s.w.quests.as_ref().unwrap().offers[offer_index(&s, known)];
    assert!(offer.accepted.contains(&human));
    assert!(offer.expires_at > 0.);
}

#[test]
fn malformed_bot_acceptance_cannot_pick_up_or_block_human_turn_in() {
    let mut s = sim_with_bots([true, false, false]);
    let bot = PlayerId(1);
    let human = PlayerId(2);
    let (qid, at, token, box_id, count) = {
        let q = s.w.quests.as_ref().unwrap();
        let o = q
            .offers
            .iter()
            .find(|o| o.published && catalog::DEFINITION[o.def as usize].kind == Kind::Collect)
            .unwrap();
        (
            o.id,
            o.at,
            o.tokens[0],
            o.containers[0],
            catalog::DEFINITION[o.def as usize].count,
        )
    };
    // Forged/stale acceptance bypasses the real accept door to exercise defense in depth.
    let oi = offer_index(&s, qid);
    s.w.quests.as_mut().unwrap().offers[oi].accepted.push(bot);
    teleport(&mut s, bot, token);
    submit(
        &mut s,
        bot,
        RawCommand::Pickup {
            container_id: box_id,
        },
    );
    s.step();
    let o = &s.w.quests.as_ref().unwrap().offers[oi];
    assert!(o.containers.contains(&box_id));
    assert!(!o.progress.iter().any(|(p, _)| *p == bot));
    // A forged ready bot must not compete with the real human for a turn-in.
    teleport(&mut s, human, at);
    submit(
        &mut s,
        human,
        RawCommand::QuestAccept {
            quest_id: Some(qid),
        },
    );
    s.step();
    // Arrange a tick on which the bot would win the source tie ranking if improperly admitted.
    let rank = |tick: u32, id: PlayerId| {
        let mut h = 7u32 ^ tick.wrapping_mul(0x9e37_79b1);
        for b in format!("p{}", id.0).bytes() {
            h = (h ^ u32::from(b)).wrapping_mul(0x0100_0193);
        }
        crate::rng::Mulberry32::new(h).next_u32()
    };
    while rank(s.w.tick + 1, bot) >= rank(s.w.tick + 1, human) {
        s.step();
    }
    let o = &mut s.w.quests.as_mut().unwrap().offers[oi];
    o.progress.push((bot, count));
    o.progress.push((human, count));
    teleport(&mut s, bot, at);
    s.step();
    let o = &s.w.quests.as_ref().unwrap().offers[oi];
    assert_eq!(o.status, Status::Done);
    assert_eq!(o.done_by, Some(human));
    assert_eq!(s.w.players[0].credit.gv_parts.quest, 0);
}

#[test]
fn camp_clear_ignores_bots_when_deciding_whether_anyone_can_finish() {
    // With no standing humans the source leaves the offer alone, even if bots stand and no mobs remain.
    let mut s = sim_with_bots([true; 3]);
    let qid =
        s.w.quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find(|o| {
                o.published
                    && catalog::DEFINITION[o.def as usize].kind == Kind::Kill
                    && !catalog::DEFINITION[o.def as usize].players
            })
            .unwrap()
            .id;
    crate::hooks::fire(
        &mut crate::hooks::Hx {
            stats: Default::default(),
            k: &s.k,
            w: &mut s.w,
            ev: &mut Vec::new(),
            fx: None,
        },
        crate::hooks::HookArgs::CampCleared { camp: 0 },
    );
    s.step();
    assert_eq!(
        s.w.quests.as_ref().unwrap().offers[offer_index(&s, qid)].status,
        Status::Open
    );
    // Declared seat-state setup: introduce a standing human for the same camp-clear control.
    s.w.players[1].seat.bot = false;
    crate::hooks::fire(
        &mut crate::hooks::Hx {
            stats: Default::default(),
            k: &s.k,
            w: &mut s.w,
            ev: &mut Vec::new(),
            fx: None,
        },
        crate::hooks::HookArgs::CampCleared { camp: 0 },
    );
    s.step();
    assert_eq!(
        s.w.quests.as_ref().unwrap().offers[offer_index(&s, qid)].status,
        Status::Expired
    );
}

#[test]
fn malformed_bot_acceptance_cannot_take_fetch_parcel() {
    let mut s = sim_with_bots([true, false, false]);
    let bot = PlayerId(1);
    let (qid, parcel, box_id) = {
        let q = s.w.quests.as_ref().unwrap();
        let o = q
            .offers
            .iter()
            .find(|o| o.published && catalog::DEFINITION[o.def as usize].kind == Kind::Fetch)
            .unwrap();
        (o.id, o.parcel.unwrap(), o.containers[0])
    };
    let oi = offer_index(&s, qid);
    // Malformed-state control: the source acceptance door would never admit this bot.
    s.w.quests.as_mut().unwrap().offers[oi].accepted.push(bot);
    teleport(&mut s, bot, parcel);
    submit(
        &mut s,
        bot,
        RawCommand::Pickup {
            container_id: box_id,
        },
    );
    s.step();
    let q = s.w.quests.as_ref().unwrap();
    assert!(q.offers[oi].containers.contains(&box_id));
    assert_eq!(q.offers[oi].carrier, None);
    assert!(q.carried.is_empty());
}
