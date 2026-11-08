//! Source `server/src/sim/quests.ts`: the quest lifecycle runtime — offers from the private quest stream, hidden reveals,
//! the accept action, kill/player/camp progress, collect-token and fetch-parcel pickups, carriers, automatic turn-ins,
//! expiry and the closed linger, the camp-clear supply recheck, and the close-all for teleports and the run's end.
//!
//! Deliberate native-shape choices for this slice (all recorded in `docs/evidence/stage2-quest-1/README.md`): giver
//! presence is quest-owned state (`npc_alive`) instead of a spellable mob actor body, quest items are hidden from the public
//! item observation (transported quests are coordinator-owned), and no toast/reveal events are emitted until the transport
//! packet owns them.
use super::catalog::{self, Kind};
use super::{placement, roster, rules};
use crate::constants::*;
use crate::events::Event;
use crate::input::ActionCmd;
use crate::math::Vec2;
use crate::state::{Container, ContainerKind, Player, PlayerId, World};
use crate::statics::MatchStatic;
use crate::systems::Cx;

/// A quest offer's lifecycle status (source `QuestState.status`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Status {
    #[default]
    Open,
    Done,
    Expired,
}

/// One quest offer: source `QuestState` plus the server's `QuestRuntime` fields the sim reads.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Offer {
    pub id: u32,
    /// Catalog row index (the definitions are registered content).
    pub def: u16,
    pub known: bool,
    /// The giver's spot (source `s.x`/`s.y`): accept range and line of sight read this.
    pub at: Vec2,
    pub tokens: Vec<Vec2>,
    pub parcel: Option<Vec2>,
    pub status: Status,
    /// Zero until first acceptance; then the offer's deadline (source `QuestState.expiresAt`).
    pub expires_at: f64,
    pub accepted: Vec<PlayerId>,
    pub progress: Vec<(PlayerId, u32)>,
    /// Tour zones seen per player (source `QuestRuntime.tours`, serialized as a zone bitmask).
    pub visits: Vec<(PlayerId, u8)>,
    pub carrier: Option<PlayerId>,
    pub last_carrier: Option<PlayerId>,
    /// Source `npcId !== "" && state.mobs.has(npcId)`: the giver stands (quest-owned presence, no actor body yet).
    pub npc_alive: bool,
    pub published: bool,
    pub publish_at: f64,
    pub finder: Option<PlayerId>,
    pub closed_at: f64,
    pub done_by: Option<PlayerId>,
    pub containers: Vec<u32>,
}

/// The run's quest runtime (source `QuestsRuntime`); absent until `spawnQuests` runs, like source `world.quests`.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Quests {
    /// The private quest stream (`rewardStream(questSaltFrom(rewardSalt))`), advanced only while spawning.
    pub stream: crate::private_rng::Sfc32,
    pub offers: Vec<Offer>,
    pub carried: Vec<(PlayerId, u32)>,
    /// A camp was cleared this phase: the kill offers are re-checked after the pass (source `recheck`).
    pub recheck: bool,
}

fn quests(w: &World) -> Option<&Quests> {
    w.quests.as_ref()
}
fn quests_mut(w: &mut World) -> Option<&mut Quests> {
    w.quests.as_mut()
}

/// The source `questSaltFrom`: the quest stream's four words from the reward salt under the "QUES" tag.
pub fn quest_salt(reward_salt: [u32; 4]) -> [u32; 4] {
    crate::private_rng::mixed_salt(reward_salt, 0x5155_4553)
}

fn tie_rank(k: &MatchStatic, w: &World, id: PlayerId) -> u32 {
    // Source tieRank: orderSalt ^ (tick * 0x9e3779b1), FNV over the player id string, then one mulberry32 draw.
    let label = format!("p{}", id.0);
    let mut h = k.secrets.order_salt ^ w.tick.wrapping_mul(0x9e37_79b1);
    for b in label.bytes() {
        h = (h ^ u32::from(b)).wrapping_mul(0x0100_0193);
    }
    crate::rng::Mulberry32::new(h).next_u32()
}

fn bump(offer: &mut Offer, id: PlayerId, by: u32) {
    let count = catalog::DEFINITION[offer.def as usize].count;
    let now = offer
        .progress
        .iter()
        .find(|(who, _)| *who == id)
        .map_or(0, |(_, n)| *n);
    if now >= count {
        return;
    }
    let next = now.saturating_add(by).min(count);
    match offer.progress.iter_mut().find(|(who, _)| *who == id) {
        Some((_, n)) => *n = next,
        None => offer.progress.push((id, next)),
    }
}

fn accepted(offer: &Offer, id: PlayerId) -> bool {
    offer.accepted.contains(&id)
}

fn is_ready(offer: &Offer, id: PlayerId) -> bool {
    if !accepted(offer, id) {
        return false;
    }
    if catalog::DEFINITION[offer.def as usize].kind == Kind::Fetch {
        return offer.carrier == Some(id);
    }
    offer
        .progress
        .iter()
        .find(|(who, _)| *who == id)
        .is_some_and(|(_, n)| *n >= catalog::DEFINITION[offer.def as usize].count)
}

fn add_quest_container(w: &mut World, at: Vec2, quest_id: u32) -> u32 {
    let id = w.next_entity_id();
    w.item_counter += 1;
    w.containers.push(Container {
        id,
        kind: ContainerKind::Quest,
        ready_at: 0.,
        target: None,
        at,
        opened: false,
        items: vec![crate::initial_world::Item {
            uid: w.item_counter,
            def: crate::initial_world::ItemDef::Quest(quest_id),
        }],
        stat_offer: false,
        born_tick: w.tick,
    });
    id
}

fn remove_containers(w: &mut World, containers: &[u32]) {
    if containers.is_empty() {
        return;
    }
    w.containers.retain(|c| !containers.contains(&c.id));
}

fn remove_giver(offer: &mut Offer) {
    offer.npc_alive = false;
}

fn retire(w: &mut World, oi: usize) {
    let containers = w.quests.as_ref().map(|q| q.offers[oi].containers.clone());
    let Some(containers) = containers else { return };
    if let Some(q) = w.quests.as_mut() {
        let offer = &mut q.offers[oi];
        if let Some(carrier) = offer.carrier.take() {
            q.carried.retain(|(who, _)| *who != carrier);
        }
        offer.closed_at = w.server_time;
        let expires = offer.expires_at;
        let closed = offer.closed_at;
        offer.expires_at = if expires > 0. {
            expires.min(closed)
        } else {
            closed
        };
        offer.containers.clear();
        remove_giver(offer);
    }
    remove_containers(w, &containers);
}

fn expire(w: &mut World, oi: usize) -> bool {
    let Some(o) = quests(w).map(|q| &q.offers[oi]) else {
        return false;
    };
    if o.status != Status::Open {
        return false;
    }
    retire(w, oi);
    let known = quests(w).map(|q| q.offers[oi].published).unwrap_or(false);
    if let Some(q) = quests_mut(w) {
        if known {
            q.offers[oi].status = Status::Expired;
            return true;
        }
        let id = q.offers[oi].id;
        q.offers.retain(|o| o.id != id);
    }
    false
}

fn publish(k: &MatchStatic, w: &mut World, oi: usize) {
    let Some(q) = quests_mut(w) else { return };
    if q.offers[oi].published {
        return;
    }
    q.offers[oi].published = true;
    if w.phase == crate::state::Phase::Active {
        place_published(k, w, oi);
    }
}

fn place_published(k: &MatchStatic, w: &mut World, oi: usize) {
    let Some(q) = quests(w) else { return };
    let offer = &q.offers[oi];
    if offer.npc_alive {
        return;
    }
    let def = &catalog::DEFINITION[offer.def as usize];
    let tokens = offer.tokens.clone();
    let parcel = offer.parcel;
    let id = offer.id;
    let _ = k;
    if let Some(q) = quests_mut(w) {
        q.offers[oi].npc_alive = true;
    }
    let mut added = Vec::new();
    match def.kind {
        Kind::Collect => {
            for at in tokens {
                added.push(add_quest_container(w, at, id));
            }
        }
        Kind::Fetch => {
            if let Some(at) = parcel {
                added.push(add_quest_container(w, at, id));
            }
        }
        Kind::Kill => {}
    }
    if let Some(q) = quests_mut(w) {
        q.offers[oi].containers = added;
    }
}

fn offer(k: &MatchStatic, w: &mut World, placement: &placement::Placement) {
    let id = w.next_entity_id();
    let known = placement.known;
    let offer = Offer {
        id,
        def: placement.def as u16,
        known,
        at: placement.at,
        tokens: placement.tokens.clone(),
        parcel: placement.parcel,
        status: Status::Open,
        expires_at: 0.,
        accepted: Vec::new(),
        progress: Vec::new(),
        visits: Vec::new(),
        carrier: None,
        last_carrier: None,
        npc_alive: false,
        published: false,
        publish_at: 0.,
        finder: None,
        closed_at: 0.,
        done_by: None,
        containers: Vec::new(),
    };
    let published = known;
    if let Some(q) = quests_mut(w) {
        q.offers.push(offer);
    }
    if published {
        publish(k, w, w.quests.as_ref().map_or(0, |q| q.offers.len() - 1));
    }
}

/// Source `spawnQuests`: planning start (or the first active tick without planning) builds the roster and every placement
/// from the private quest stream; a second call is a no-op.
pub(crate) fn spawn(k: &MatchStatic, w: &mut World) {
    if w.quests.is_some()
        || !crate::schedule::Gates::of(k).quests
        || crate::schedule::Gates::of(k).training
    {
        return;
    }
    let Some(layers) = k.arena.map.layers() else {
        return;
    };
    if layers.data().camps.is_empty() {
        return;
    }
    let salt = quest_salt(k.secrets.reward_salt);
    let mut stream = crate::private_rng::Sfc32::from_words(salt);
    let mut rng = || stream.next_f64();
    let roster = roster::select_quests(&mut rng);
    let placements = placement::place_quests(&k.arena.map, &roster, &mut rng);
    w.quests = Some(Quests {
        stream,
        offers: Vec::new(),
        carried: Vec::new(),
        recheck: false,
    });
    for placement in &placements {
        offer(k, w, placement);
    }
}

/// Source `install`'s `planningStarted` link.
pub(crate) fn on_planning_started(hx: &mut crate::hooks::Hx, _: &crate::hooks::HookArgs) {
    spawn(hx.k, hx.w);
}

/// Source `raidStarted`: spawn (no-op when planning already did) and place every published offer's giver and pieces.
pub(crate) fn on_raid_started(hx: &mut crate::hooks::Hx, _: &crate::hooks::HookArgs) {
    spawn(hx.k, hx.w);
    let n = quests(hx.w).map_or(0, |q| q.offers.len());
    for oi in 0..n {
        let published = quests(hx.w).is_some_and(|q| q.offers[oi].published);
        if published {
            place_published(hx.k, hx.w, oi);
        }
    }
}

/// Source takesPart: fill bots take no part in quests (no policy, no GV from their deaths).
fn standing_human(p: &Player) -> bool {
    p.standing() && !p.seat.bot
}

fn standing(w: &World, id: PlayerId) -> bool {
    w.player(id).is_some_and(standing_human)
}

/// Source takesPart for a fighter whose body state (alive/down/resolved) is proven by the caller.
fn takes_part(w: &World, id: PlayerId) -> bool {
    w.player(id).is_some_and(|p: &Player| !p.seat.bot)
}

fn gv_quest(k: &MatchStatic, w: &mut World, ev: &mut Vec<Event>, i: usize, gv: u16) {
    if crate::schedule::Gates::of(k).training {
        return;
    }
    let room = QUEST_GV_CAP.saturating_sub(w.players[i].credit.gv_parts.quest);
    let amount = u32::from(gv).min(room);
    if amount == 0 {
        return;
    }
    let p = &mut w.players[i];
    p.credit.gv_parts.quest = p.credit.gv_parts.quest.saturating_add(amount);
    p.credit.gv = p
        .credit
        .gv_parts
        .kills
        .saturating_add(p.credit.gv_parts.mobs)
        .saturating_add(p.credit.gv_parts.bounty)
        .saturating_add(p.credit.gv_parts.quest);
    let id = p.id;
    ev.push(Event::Gv {
        id,
        amount,
        reason: crate::results::GvReason::Quest,
    });
}

fn complete(k: &MatchStatic, w: &mut World, ev: &mut Vec<Event>, oi: usize, id: PlayerId) {
    let Some(def_index) = quests(w).map(|q| q.offers[oi].def as usize) else {
        return;
    };
    let def = &catalog::DEFINITION[def_index];
    let name = def.name;
    let _ = name;
    let Some(i) = w.idx(id) else { return };
    if !standing(w, id) {
        return;
    }
    retire(w, oi);
    if let Some(q) = quests_mut(w) {
        q.offers[oi].status = Status::Done;
        q.offers[oi].done_by = Some(id);
    }
    gv_quest(k, w, ev, i, def.reward_gv);
    let (stat, stacks) = rules::reward_stats(def);
    crate::modifiers::grant_mob_stat(k, w, id, stat, stacks);
}

fn close_all(k: &MatchStatic, w: &mut World, ev: &mut Vec<Event>) {
    let mut ids: Vec<u32> = quests(w)
        .map(|q| {
            q.offers
                .iter()
                .filter(|o| o.status == Status::Open)
                .map(|o| o.id)
                .collect()
        })
        .unwrap_or_default();
    ids.sort_unstable();
    while let Some(id) = ids.pop() {
        if let Some(oi) = quests(w).and_then(|q| q.offers.iter().position(|o| o.id == id)) {
            expire(w, oi);
        }
    }
    let _ = (k, ev);
}

pub(crate) fn on_teleported(hx: &mut crate::hooks::Hx, _: &crate::hooks::HookArgs) {
    close_all(hx.k, hx.w, hx.ev);
}

pub(crate) fn on_run_ended(hx: &mut crate::hooks::Hx, _: &crate::hooks::HookArgs) {
    close_all(hx.k, hx.w, hx.ev);
}

/// Source `onMobKilled`: kill offers progress for standing humans that accepted them.
pub(crate) fn on_mob_killed(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    let crate::hooks::HookArgs::MobKilled {
        killer,
        zone,
        elite,
        ..
    } = args
    else {
        return;
    };
    if hx.w.phase != crate::state::Phase::Active || !standing(hx.w, *killer) {
        return;
    }
    let zone_code = zone.code(); // 0-based faction code
    let Some(q) = quests(hx.w) else { return };
    let n = q.offers.len();
    for oi in 0..n {
        let offer = &hx.w.quests.as_ref().unwrap().offers[oi];
        let def = &catalog::DEFINITION[offer.def as usize];
        if !offer.published
            || offer.status != Status::Open
            || def.kind != Kind::Kill
            || def.players
            || !offer.accepted.contains(killer)
        {
            continue;
        }
        if def.elite && !*elite {
            continue;
        }
        if def.tour > 0 {
            let bit = 1u8 << zone_code;
            let q = hx.w.quests.as_mut().unwrap();
            let offer = &mut q.offers[oi];
            let entry = match offer.visits.iter_mut().find(|(who, _)| who == killer) {
                Some((_, seen)) => seen,
                None => {
                    offer.visits.push((*killer, 0));
                    &mut offer.visits.last_mut().unwrap().1
                }
            };
            *entry |= bit;
            let seen = entry.count_ones();
            let count = catalog::DEFINITION[offer.def as usize].count;
            let entry = offer.progress.iter_mut().find(|(who, _)| who == killer);
            let next = seen.min(count);
            match entry {
                Some((_, n)) => *n = next,
                None => offer.progress.push((*killer, next)),
            }
        } else if def.elite || def.region.is_none_or(|region| region.code() == zone_code) {
            let q = hx.w.quests.as_mut().unwrap();
            bump(&mut q.offers[oi], *killer, 1);
        }
    }
}

/// Source `onPlayerKilled`: the player-kill offer progresses on a died credited kill.
pub(crate) fn on_player_killed(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    let crate::hooks::HookArgs::PlayerKilled {
        by,
        victim,
        outcome,
    } = args
    else {
        return;
    };
    if *outcome != crate::results::Outcome::Died
        || hx.w.phase != crate::state::Phase::Active
        || by == victim
        || !standing(hx.w, *by)
        || !takes_part(hx.w, *victim)
    {
        return;
    }
    let Some(q) = quests(hx.w) else { return };
    let n = q.offers.len();
    for oi in 0..n {
        let offer = &hx.w.quests.as_ref().unwrap().offers[oi];
        let def = &catalog::DEFINITION[offer.def as usize];
        if offer.published
            && offer.status == Status::Open
            && def.kind == Kind::Kill
            && def.players
            && offer.accepted.contains(by)
        {
            let q = hx.w.quests.as_mut().unwrap();
            bump(&mut q.offers[oi], *by, 1);
        }
    }
}

/// Source `onCampCleared`: re-check the kill offers after the pass paid every kill.
pub(crate) fn on_camp_cleared(hx: &mut crate::hooks::Hx, _: &crate::hooks::HookArgs) {
    if let Some(q) = quests_mut(hx.w) {
        q.recheck = true;
    }
}

/// Source `dropBody` wrap: a dying carrier drops the parcel where they fall.
pub(crate) fn on_drop_body(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    let crate::hooks::HookArgs::DropBody { victim, .. } = args else {
        return;
    };
    let Some(q) = quests(hx.w) else { return };
    let Some((_, quest_id)) = q.carried.iter().find(|(who, _)| who == victim).copied() else {
        return;
    };
    let at = hx.w.player(*victim).map(|p| p.pos());
    if let Some(q) = quests_mut(hx.w) {
        q.carried.retain(|(who, _)| who != victim);
        if let Some(offer) = q.offers.iter_mut().find(|o| o.id == quest_id) {
            if offer.status == Status::Open {
                offer.carrier = None;
            }
        }
    }
    if let Some(at) = at {
        add_quest_container(hx.w, at, quest_id);
        if let Some(offer) =
            hx.w.quests
                .as_mut()
                .and_then(|q| q.offers.iter_mut().find(|o| o.id == quest_id))
        {
            let id = hx.w.containers.last().map(|c| c.id).unwrap_or(0);
            offer.containers.push(id);
        }
    }
}

fn accept_blocked(k: &MatchStatic, w: &World) -> bool {
    let g = crate::schedule::Gates::of(k);
    if !g.quests || w.phase != crate::state::Phase::Active {
        return true;
    }
    false
}

/// Source-ordered acceptance outcome. It contains no quest facts and may be used only after row entitlement filtering.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AcceptRefusal {
    Silent,
    Busy,
    Over,
    Far,
    Blocked,
    Already,
}

/// Shared authoritative check for the action and the owner's published eligibility fact.
pub(crate) fn accept_eligibility(
    k: &MatchStatic,
    w: &World,
    id: PlayerId,
    quest_id: Option<u32>,
) -> Result<usize, AcceptRefusal> {
    if accept_blocked(k, w) || !standing(w, id) {
        return Err(AcceptRefusal::Silent);
    }
    let player = w.player(id).ok_or(AcceptRefusal::Silent)?;
    if crate::status_runtime::action_blocked(&player.statuses, w.server_time) {
        return Err(AcceptRefusal::Busy);
    }
    let offers = quests(w).ok_or(AcceptRefusal::Silent)?;
    let oi = offers
        .offers
        .iter()
        .position(|o| {
            Some(o.id) == quest_id && o.published && o.status == Status::Open && o.npc_alive
        })
        .ok_or(AcceptRefusal::Over)?;
    let offer = &offers.offers[oi];
    let pos = player.pos();
    if crate::math::hypot(pos.x - offer.at.x, pos.y - offer.at.y) > QUEST_ACCEPT_RANGE {
        return Err(AcceptRefusal::Far);
    }
    let map = k.collision_map(w.rt.gates_locked);
    if !crate::geometry::has_line_of_sight(map, pos, offer.at, crate::map::MASK_SIGHT) {
        return Err(AcceptRefusal::Blocked);
    }
    if offer.accepted.contains(&id) {
        return Err(AcceptRefusal::Already);
    }
    Ok(oi)
}

/// Source `handleQuestAccept`, called from the ACTION table. Refusals are private (no toast transport yet).
pub(crate) fn handle_accept(cx: &mut Cx, ix: crate::fighter::FighterIx, cmd: &ActionCmd) {
    let ActionCmd::QuestAccept { quest_id } = *cmd else {
        return;
    };
    if !cx.w.is_player(ix) {
        return;
    }
    let id = cx.w.core(ix).id;
    let Ok(oi) = accept_eligibility(cx.k, cx.w, id, quest_id) else {
        return;
    };
    let offer = &cx.w.quests.as_ref().unwrap().offers[oi];
    let now = cx.w.server_time;
    let expires = catalog::DEFINITION[offer.def as usize].expires_at_sec;
    let q = cx.w.quests.as_mut().unwrap();
    if q.offers[oi].expires_at == 0. {
        q.offers[oi].expires_at = now + expires * 1000.;
    }
    q.offers[oi].accepted.push(id);
}

/// Source `onQuestPickup`: a quest item's pickup. Returns true when the quest system handled it (the item never becomes a
/// weapon/potion pickup). Called from the ordinary pickup path after range/LOS checks.
pub(crate) fn pickup(cx: &mut Cx, ix: crate::fighter::FighterIx, container_ix: usize) {
    let Some(container) = cx.w.containers.get(container_ix) else {
        return;
    };
    let Some(crate::initial_world::ItemDef::Quest(quest_id)) =
        container.items.first().map(|i| i.def)
    else {
        return;
    };
    let id = cx.w.core(ix).id;
    if !cx.w.is_player(ix) || !takes_part(cx.w, id) || cx.w.phase != crate::state::Phase::Active {
        return;
    }
    let Some(offer) = quests(cx.w).and_then(|q| {
        q.offers
            .iter()
            .position(|o| o.id == quest_id && o.published && o.status == Status::Open)
    }) else {
        return;
    };
    if !accepted(&cx.w.quests.as_ref().unwrap().offers[offer], id) {
        return;
    }
    let kind = catalog::DEFINITION[cx.w.quests.as_ref().unwrap().offers[offer].def as usize].kind;
    let container_at = cx.w.containers[container_ix].at;
    if kind == Kind::Fetch {
        let q = cx.w.quests.as_ref().unwrap();
        if q.carried.iter().any(|(who, _)| *who == id) {
            return;
        }
        if q.offers[offer].carrier.is_some() {
            return;
        }
        let stolen = q.offers[offer].last_carrier.is_some_and(|last| last != id);
        let _ = stolen;
        let q = cx.w.quests.as_mut().unwrap();
        q.offers[offer].carrier = Some(id);
        q.offers[offer].last_carrier = Some(id);
        q.carried.push((id, quest_id));
        q.offers[offer]
            .containers
            .retain(|cid| *cid != cx.w.containers[container_ix].id);
        let _ = container_at;
        cx.w.containers.remove(container_ix);
        return;
    }
    let count = catalog::DEFINITION[cx.w.quests.as_ref().unwrap().offers[offer].def as usize].count;
    let have = cx.w.quests.as_ref().unwrap().offers[offer]
        .progress
        .iter()
        .find(|(who, _)| *who == id)
        .map_or(0, |(_, n)| *n);
    if have >= count {
        return;
    }
    bump(&mut cx.w.quests.as_mut().unwrap().offers[offer], id, 1);
    let cid = cx.w.containers[container_ix].id;
    if let Some(q) = quests_mut(cx.w) {
        q.offers[offer].containers.retain(|x| *x != cid);
    }
    cx.w.containers.remove(container_ix);
}

/// Source `questSystem`: linger sweep, camp-clear recheck, expiry, hidden reveals with the head start, then automatic
/// turn-ins.
pub(crate) fn system(cx: &mut Cx) {
    let Cx { k, w, ev, .. } = cx;
    if w.phase != crate::state::Phase::Active {
        return;
    }
    let Some(rt) = quests(w) else { return };
    if rt.offers.is_empty() {
        return;
    }
    let now = w.server_time;
    // The closed linger.
    if let Some(q) = quests_mut(w) {
        q.offers
            .retain(|o| o.status == Status::Open || now - o.closed_at < CLOSED_QUEST_LINGER_MS);
    }
    // The camp-clear supply recheck.
    if quests(w).is_some_and(|q| q.recheck) {
        if let Some(q) = quests_mut(w) {
            q.recheck = false;
        }
        close_impossible(w, None);
    }
    // Expiry and hidden reveals.
    let n = quests(w).map_or(0, |q| q.offers.len());
    for oi in 0..n {
        let Some(offer) = quests(w).map(|q| &q.offers[oi]) else {
            break;
        };
        if offer.status != Status::Open {
            continue;
        }
        if offer.expires_at > 0. && now >= offer.expires_at {
            expire(w, oi);
            continue;
        }
        if offer.published {
            continue;
        }
        if offer.publish_at > 0. {
            if now >= offer.publish_at {
                publish(k, w, oi);
                close_impossible(w, Some(oi));
            }
            continue;
        }
        if w.rt.gates_locked {
            continue;
        }
        let at = offer.at;
        let mut finder: Option<PlayerId> = None;
        for p in &w.players {
            if !standing_human(p) {
                continue;
            }
            if crate::math::hypot(p.pos().x - at.x, p.pos().y - at.y) > QUEST_REVEAL_RADIUS {
                continue;
            }
            if finder.is_some_and(|f| tie_rank(k, w, p.id) > tie_rank(k, w, f)) {
                continue;
            }
            finder = Some(p.id);
        }
        let Some(finder) = finder else { continue };
        let now_ms = w.server_time;
        let head_start = QUEST_REVEAL_HEAD_START_MS;
        let q = quests_mut(w).unwrap();
        let offer = &mut q.offers[oi];
        offer.finder = Some(finder);
        offer.publish_at = now_ms + head_start;
        let _ = ev;
    }
    if w.rt.gates_locked {
        return;
    }
    // Automatic turn-ins.
    let n = quests(w).map_or(0, |q| q.offers.len());
    for oi in 0..n {
        let Some(offer) = quests(w).map(|q| &q.offers[oi]) else {
            break;
        };
        if !offer.published || offer.status != Status::Open {
            continue;
        }
        let at = offer.at;
        let mut best: Option<PlayerId> = None;
        for p in &w.players {
            if !standing_human(p) || !is_ready(offer, p.id) {
                continue;
            }
            if crate::math::hypot(p.pos().x - at.x, p.pos().y - at.y) > QUEST_TURN_IN_RANGE {
                continue;
            }
            let allowed = quests(w).map(|q| q.offers[oi].clone()).unwrap();
            let map = k.collision_map(w.rt.gates_locked);
            if !crate::geometry::has_line_of_sight(map, p.pos(), at, crate::map::MASK_SIGHT) {
                continue;
            }
            let _ = allowed;
            if best.is_some_and(|b| tie_rank(k, w, p.id) > tie_rank(k, w, b)) {
                continue;
            }
            best = Some(p.id);
        }
        if let Some(best) = best {
            complete(k, w, ev, oi, best);
        }
    }
}

fn close_impossible(w: &mut World, only: Option<usize>) {
    let Some(q) = quests(w) else { return };
    let mut zones = [0u32; 5];
    let mut elites = 0u32;
    for m in w.mobs.iter() {
        if m.status != crate::state::Status::Alive {
            continue;
        }
        if m.elite {
            elites += 1;
        }
        if let Some(def) = m
            .mob_type
            .and_then(|ty| crate::mob_catalog::mob_type_by_id(ty.as_str()))
        {
            zones[usize::from(def.zone.code())] += 1;
        }
    }
    let indices: Vec<usize> = match only {
        Some(oi) => vec![oi],
        None => (0..q.offers.len()).collect(),
    };
    let mut expired = Vec::new();
    for oi in indices {
        let Some(offer) = quests(w).map(|q| &q.offers[oi]) else {
            continue;
        };
        let def = &catalog::DEFINITION[offer.def as usize];
        if !offer.published || offer.status != Status::Open || def.kind != Kind::Kill || def.players
        {
            continue;
        }
        let mut anyone = false;
        let mut possible = false;
        for p in &w.players {
            if !standing_human(p) {
                continue;
            }
            anyone = true;
            let have = offer
                .progress
                .iter()
                .find(|(who, _)| *who == p.id)
                .map_or(0, |(_, n)| *n);
            let need = def.count.saturating_sub(have);
            if def.tour > 0 {
                let seen = offer
                    .visits
                    .iter()
                    .find(|(who, _)| *who == p.id)
                    .map_or(0, |(_, mask)| mask.count_ones());
                let fresh = zones
                    .iter()
                    .enumerate()
                    .filter(|(i, n)| **n > 0 && (seen & (1 << i)) == 0)
                    .count() as u32;
                possible |= fresh >= need;
            } else if def.elite {
                possible |= elites >= need;
            } else if let Some(region) = def.region {
                possible |= zones[usize::from(region.code())] >= need;
            } else {
                possible |= zones.iter().sum::<u32>() >= need;
            }
        }
        if !anyone {
            continue;
        }
        if !possible && expire(w, oi) {
            expired.push(oi);
        }
    }
    let _ = expired;
}

/// Checkpoint validation for the quest runtime and its containers.
pub(crate) fn validate(k: &MatchStatic, w: &World) -> Result<(), String> {
    let Some(q) = w.quests.as_ref() else {
        for c in &w.containers {
            if c.kind == ContainerKind::Quest {
                return Err("quest container without a quest runtime".into());
            }
        }
        return Ok(());
    };
    let _ = k;
    let mut ids = Vec::new();
    for o in &q.offers {
        if o.id == 0 || o.id > w.entity_counter || ids.contains(&o.id) {
            return Err("invalid quest id".into());
        }
        ids.push(o.id);
        if usize::from(o.def) >= catalog::DEFINITION.len() {
            return Err("invalid quest definition".into());
        }
        if !o.at.x.is_finite() || !o.at.y.is_finite() {
            return Err("invalid quest position".into());
        }
        if o.status != Status::Open && o.closed_at == 0. {
            return Err("closed quest without a close time".into());
        }
        for (who, n) in &o.progress {
            if usize::from(o.def) >= catalog::DEFINITION.len() {
                return Err("invalid quest progress".into());
            }
            if *n > catalog::DEFINITION[o.def as usize].count {
                return Err("quest progress beyond its objective".into());
            }
            if !o.accepted.contains(who) {
                return Err("progress without acceptance".into());
            }
        }
        for who in o
            .accepted
            .iter()
            .chain(o.carrier.iter())
            .chain(o.finder.iter())
        {
            if w.roster.name(*who).is_none() {
                return Err("quest acceptance names an unknown player".into());
            }
        }
        if o.done_by.is_some_and(|id| w.roster.name(id).is_none()) {
            return Err("quest completion names an unknown player".into());
        }
        if o.carrier.is_some_and(|c| !o.accepted.contains(&c)) {
            return Err("carrier without acceptance".into());
        }
    }
    for (who, quest) in &q.carried {
        if !q.offers.iter().any(|o| o.id == *quest) {
            return Err("carried quest is gone".into());
        }
        if !w.player(*who).is_some_and(|p| p.standing()) {
            return Err("carried quest by a non-standing player".into());
        }
    }
    let mut seen = Vec::new();
    for c in &w.containers {
        if c.kind != ContainerKind::Quest {
            continue;
        }
        let Some(crate::initial_world::ItemDef::Quest(quest)) = c.items.first().map(|i| i.def)
        else {
            return Err("quest container without its quest item".into());
        };
        if !q.offers.iter().any(|o| o.id == quest) {
            return Err("quest container for a gone offer".into());
        }
        if c.items.len() != 1 {
            return Err("quest container holds one item".into());
        }
        seen.push(c.id);
    }
    for o in &q.offers {
        for cid in &o.containers {
            if !seen.contains(cid) {
                return Err("offer lists a missing container".into());
            }
        }
    }
    Ok(())
}
