//! The training room's \`train\` console (legacy \`sim/training.ts\`: \`handleTrain\`, card/stat/camp/chest/clear, toasts).
//!
//! Every command is the source's: ids are catalog positions validated at the door (\`input::validate\`), counts are clamped
//! there, and the handlers below only do what the recorded training console does, including its caps, 300 ms spawn gaps,
//! placement bands and exact toast texts. It is a native training action: an arena world never has one (the submit door
//! refuses it), and the row only runs under \`Gate::Training\`.

use crate::cards::{CardId, CardKind, CardRow};
use crate::constants::{
    PLAYER_RADIUS, PRACTICE_CAMP_FIRST, PRACTICE_CAMP_LAST, TILE, TRAIN_CAMP_MAX_TILES,
    TRAIN_CAMP_MIN_TILES, TRAIN_CAMP_SIZE, TRAIN_CAMP_SPREAD_TILES, TRAIN_CAMP_TARGET_TILES,
    TRAIN_CHEST_MAX_TILES, TRAIN_CHEST_MIN_TILES, TRAIN_CHEST_TARGET_TILES, TRAIN_MAX_CHESTS,
    TRAIN_MAX_MOBS, TRAIN_MAX_MOBS_SPAWNED, TRAIN_SPAWN_GAP_MS,
};
use crate::events::Event;
use crate::fighter::FighterIx;
use crate::input::{ActionCmd, TrainCommand};
use crate::map::{tile_to_world_center, world_to_tile};
use crate::math::{atan2, hypot};
use crate::mob_catalog::{mob_type_by_id, MobTypeId};
use crate::pathfind::{self, Pathfinder};
use crate::reward_chests::{self, is_interactive, OptionId};
use crate::stat_fold::{EffectStat, FlatStat};
use crate::state::{PracticeRuntime, Status, World};
use crate::statics::MatchStatic;
use crate::systems::{mobs, Cx};
use crate::{PlayerId, Vec2};

/// The row's action handler (schedule \`ACTIONS\`): the training room's \`train\` action.
pub(crate) fn handle_train(cx: &mut Cx, ix: FighterIx, cmd: &ActionCmd) {
    let ActionCmd::Train(cmd) = cmd else {
        return;
    };
    let Cx { k, w, ev, .. } = cx;
    if !k.config.training || !w.is_player(ix) {
        return;
    }
    let p = &w.players[ix.slot()];
    if p.status != Status::Alive || p.down.is_some() {
        return;
    }
    match *cmd {
        TrainCommand::Card { id, count } => card(k, w, ev, ix, id, count),
        TrainCommand::Stat { id, count } => stat(k, w, ev, ix, id, count),
        TrainCommand::Camp { id } => camp(k, w, ev, ix, id),
        TrainCommand::Chest { options } => chest(k, w, ev, ix, &options),
        TrainCommand::Clear => clear(k, w, ev, ix),
    }
}

fn toast(ev: &mut Vec<Event>, to: PlayerId, text: String) {
    ev.push(Event::Toast { to, text });
}

/// A camp/chest may be dropped now: not within \`TRAIN_SPAWN_GAP_MS\` of the last one (legacy \`dropAllowed\`).
fn drop_allowed(w: &World, ev: &mut Vec<Event>, to: PlayerId, last: Option<f64>) -> bool {
    if last.is_none_or(|t| w.server_time - t >= TRAIN_SPAWN_GAP_MS) {
        return true;
    }
    toast(ev, to, "Slow down".into());
    false
}

/// A live, supported, interactive augment (legacy \`cardLive\` + \`isInteractiveAugment\`).
fn live_interactive(id: CardId) -> bool {
    id.definition().ready && is_interactive(id)
}

/// Legacy \`trainCard\`: set a card's copy count the way a chest pick does (build, rows re-folded, max hp following).
fn card(k: &MatchStatic, w: &mut World, ev: &mut Vec<Event>, ix: FighterIx, id: CardId, count: u8) {
    let def = id.definition();
    if !live_interactive(id) || def.kind != CardKind::Augment {
        return;
    }
    let pid = w.players[ix.slot()].core.id;
    let want = if def.unique { count.min(1) } else { count };
    if want > 0 && def.kind == CardKind::Conditional && w.players[ix.slot()].build.count(id) == 0 {
        let Some(base) = def.requires else {
            return;
        };
        let owns = w.players[ix.slot()]
            .build
            .cards()
            .any(|c| c.definition().base == Some(base));
        if !owns {
            toast(ev, pid, format!("{}: Needs {}", def.title, base.label()));
            return;
        }
    }
    let p = &mut w.players[ix.slot()];
    if want == 0 {
        p.build.set(id, 0);
        p.card_fired.retain(|c| *c != id);
    } else {
        p.build.set(id, want);
    }
    crate::modifiers::recompute(k, w, ix);
    let p = &mut w.players[ix.slot()];
    if want == 0 && !has_fortify(&p.build, p.core.vitals.faction) {
        p.card_tank_hp = 0.;
        p.card_prevented = 0.;
    }
    crate::modifiers::sync_max_hp(p);
    let note = if def.ready {
        ""
    } else {
        " (not live yet: no effect)"
    };
    let text = if want > 0 {
        let suffix = if def.unique {
            String::new()
        } else {
            format!(" x{want}")
        };
        format!("{}{suffix}: {}{note}", def.title, def.text)
    } else {
        format!("{} removed", def.title)
    };
    toast(ev, pid, text);
}

/// Tank Engine holds a max-health bonus while its card's fortify trigger is in the build.
fn has_fortify(build: &crate::cards::Build, faction: crate::FactionId) -> bool {
    build.cards().any(|id| {
        let (_, rows) = id.definition().selection(faction);
        rows.iter().any(|row| {
            matches!(
                row,
                CardRow::Trigger(t) if matches!(t.action, crate::cards::TriggerAction::Fortify { .. })
            )
        })
    })
}

/// Legacy \`mobStatText\`: the cumulative player-facing bonus for one type and stack count.
fn stat_text(id: MobTypeId, stacks: u64) -> String {
    let Some(reward) = crate::modifiers::farm::Farm::reward_of(id) else {
        return String::new();
    };
    let n = stacks as f64;
    match reward.stat {
        crate::modifiers::farm::RewardStat::Stat(stat) => {
            let label = match stat {
                EffectStat::Damage => "damage",
                EffectStat::MoveSpeed => "move speed",
                EffectStat::MaxHp => "max health",
                EffectStat::AttackSpeed => "attack speed",
                EffectStat::Lifesteal => "lifesteal",
                _ => "stat",
            };
            format!("+{}% {label}", one(reward.value * n * 100.))
        }
        crate::modifiers::farm::RewardStat::Flat(flat) => {
            let label = match flat {
                FlatStat::Ap => "Soul Offence",
                FlatStat::Armor => "Defense",
                FlatStat::Shield => "Soul Defense",
                FlatStat::Ad => "Offense",
            };
            format!("+{} {label}", one(reward.value * n))
        }
    }
}

/// Legacy `toLocaleString("en-US", {maximumFractionDigits: 2})`: grouped thousands, at most two decimals (trailing
/// zeros trimmed).
fn one(n: f64) -> String {
    let mut s = format!("{n:.2}");
    while s.ends_with('0') {
        s.pop();
    }
    if s.ends_with('.') {
        s.pop();
    }
    let (sign, digits) = match s.strip_prefix('-') {
        Some(rest) => ("-", rest),
        None => ("", s.as_str()),
    };
    let (int_part, frac) = match digits.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (digits, None),
    };
    let mut grouped = String::with_capacity(s.len() + int_part.len() / 3);
    for (i, ch) in int_part.chars().enumerate() {
        if i > 0 && (int_part.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(ch);
    }
    match frac {
        Some(frac) => format!("{sign}{grouped}.{frac}"),
        None => format!("{sign}{grouped}"),
    }
}

fn mob_name(id: MobTypeId) -> &'static str {
    mob_type_by_id(id.as_str()).map_or("", |d| d.name)
}

/// Legacy \`trainStat\`: set a normal type's stack count for console inspection.
fn stat(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    ix: FighterIx,
    id: MobTypeId,
    count: u64,
) {
    if crate::modifiers::farm::Farm::reward_of(id).is_none() {
        return;
    }
    let pid = w.players[ix.slot()].core.id;
    let want = count.min(crate::constants::TRAIN_MAX_MOB_STAT_COUNT as u64);
    let have = w.players[ix.slot()].farm.count(id);
    if want != have {
        w.players[ix.slot()].farm.set(id, want);
        crate::modifiers::recompute(k, w, ix);
        let p = &mut w.players[ix.slot()];
        crate::modifiers::sync_max_hp(p);
    }
    let actual = w.players[ix.slot()].farm.count(id);
    toast(
        ev,
        pid,
        format!("{}: {} total", mob_name(id), stat_text(id, actual)),
    );
}

/// One number per tile (legacy \`tileKey\`).
fn tile_key(at: Vec2) -> i64 {
    world_to_tile(at.y) * 65536 + world_to_tile(at.x)
}

/// The tiles a practice drop must not land on (legacy \`occupiedTiles\`: players, mobs and containers; not chests).
fn occupied_tiles(w: &World) -> Vec<i64> {
    let mut out = Vec::new();
    for p in w.players.iter() {
        out.push(tile_key(p.core.pos()));
    }
    for m in w.mobs.iter() {
        out.push(tile_key(m.core.pos()));
    }
    for c in &w.containers {
        out.push(tile_key(c.at));
    }
    // Reward chests are state containers in the source, so they occupy their tile for the next drop too.
    for c in &w.reward_chests {
        out.push(tile_key(c.at));
    }
    out
}

/// Free floor tile centres between \`min\` and \`max\` tiles from \`from\`, nearest \`target\` first (legacy \`floorTilesAround\`).
fn floor_tiles_around(
    map: &crate::TileMap,
    from: Vec2,
    min: f64,
    max: f64,
    target: f64,
    taken: &[i64],
) -> Vec<Vec2> {
    let mut out: Vec<(Vec2, f64)> = Vec::new();
    let tx0 = world_to_tile(from.x);
    let ty0 = world_to_tile(from.y);
    let reach = max.ceil() as i64;
    for ty in ty0 - reach..=ty0 + reach {
        for tx in tx0 - reach..=tx0 + reach {
            if tx < 0 || ty < 0 || tx >= i64::from(map.w) || ty >= i64::from(map.h) {
                continue;
            }
            let at = Vec2::new(tile_to_world_center(tx), tile_to_world_center(ty));
            let d = hypot(at.x - from.x, at.y - from.y) / TILE;
            if d < min || d > max {
                continue;
            }
            if taken.contains(&tile_key(at))
                || !crate::geometry::circle_clear(
                    map,
                    at,
                    PLAYER_RADIUS,
                    crate::constants::MASK_MOVE,
                )
            {
                continue;
            }
            out.push((at, (d - target).abs()));
        }
    }
    // Array.sort is stable: equal offsets keep the row-major scan order.
    out.sort_by(|a, b| a.1.total_cmp(&b.1));
    out.into_iter().map(|(at, _)| at).collect()
}

fn can_walk(map: &crate::TileMap, from: Vec2, at: Vec2) -> bool {
    !pathfind::plan_path(&mut Pathfinder::default(), map, from, at).is_empty()
}

/// Where a practice camp of \`count\` stands (legacy \`campSpots\`): a free seen-and-walkable centre near \`from\`, then the tiles
/// nearest it. Fewer spots when the floor is crowded; none when there is no centre.
fn camp_spots(map: &crate::TileMap, from: Vec2, taken: &mut Vec<i64>, count: usize) -> Vec<Vec2> {
    let ring = floor_tiles_around(
        map,
        from,
        TRAIN_CAMP_MIN_TILES,
        TRAIN_CAMP_MAX_TILES,
        TRAIN_CAMP_TARGET_TILES,
        taken,
    );
    let visible =
        |at: Vec2| crate::geometry::has_line_of_sight(map, from, at, crate::constants::MASK_SIGHT);
    let centre = ring
        .iter()
        .find(|t| visible(**t) && can_walk(map, from, **t))
        .or_else(|| ring.iter().find(|t| can_walk(map, from, **t)))
        .copied();
    let Some(centre) = centre else {
        return Vec::new();
    };
    if count <= 1 {
        return vec![centre];
    }
    taken.push(tile_key(centre));
    let mut spots = vec![centre];
    let rest = floor_tiles_around(map, centre, 1., TRAIN_CAMP_SPREAD_TILES, 1., taken);
    spots.extend(rest.into_iter().take(count - 1));
    spots
}

/// The practice camp ref for the next camp (legacy \`nextCampRef\`): the next free one of 101..=255, wrapping.
fn next_camp_ref(w: &World, run: PracticeRuntime) -> (u32, PracticeRuntime) {
    let mut used = Vec::new();
    for m in w.mobs.iter() {
        if m.camp >= PRACTICE_CAMP_FIRST {
            used.push(m.camp);
        }
    }
    let span = PRACTICE_CAMP_LAST - PRACTICE_CAMP_FIRST + 1;
    let mut run = run;
    for i in 0..span {
        let camp = PRACTICE_CAMP_FIRST + ((run.next_camp - PRACTICE_CAMP_FIRST + i) % span);
        if !used.contains(&camp) {
            run.next_camp = if camp + 1 > PRACTICE_CAMP_LAST {
                PRACTICE_CAMP_FIRST
            } else {
                camp + 1
            };
            return (camp, run);
        }
    }
    (PRACTICE_CAMP_FIRST, run)
}

/// Legacy \`trainCamp\`: a practice camp of the type (a lone elite for an elite type), near the player.
fn camp(k: &MatchStatic, w: &mut World, ev: &mut Vec<Event>, ix: FighterIx, id: MobTypeId) {
    let Some(ty) = mob_type_by_id(id.as_str()) else {
        return;
    };
    let pid = w.players[ix.slot()].core.id;
    let from = w.players[ix.slot()].core.pos();
    let Some(run) = w.practice else {
        return;
    };
    if !drop_allowed(w, ev, pid, run.last_camp_at) {
        return;
    }
    let size = if ty.elite { 1 } else { TRAIN_CAMP_SIZE };
    let alive = w
        .mobs
        .iter()
        .filter(|m| m.kind == crate::mob_runtime::MobKind::Practice && m.status == Status::Alive)
        .count() as u32;
    if alive + size > TRAIN_MAX_MOBS {
        toast(
            ev,
            pid,
            format!("At most {TRAIN_MAX_MOBS} practice mobs at once: clear some first"),
        );
        return;
    }
    if run.spawned + size > TRAIN_MAX_MOBS_SPAWNED {
        toast(
            ev,
            pid,
            "This practice room has spawned its share of mobs: leave and come back".into(),
        );
        return;
    }
    let map = k.collision_map(w.rt.gates_locked);
    let mut taken = occupied_tiles(w);
    let spots = camp_spots(map, from, &mut taken, size as usize);
    if spots.is_empty() {
        toast(ev, pid, "No free floor near you for a camp".into());
        return;
    }
    let (camp_ref, next) = next_camp_ref(w, run);
    for at in &spots {
        let facing = atan2(from.y - at.y, from.x - at.x);
        // placeMob writes `camp + 1` to MobState.camp; the console passes `ref - 1`, so the mob's camp is the ref itself.
        mobs::place_practice_mob(w, id, ty.elite, camp_ref, *at, facing);
    }
    if let Some(run) = w.practice.as_mut() {
        run.spawned += spots.len() as u32;
        run.last_camp_at = Some(w.server_time);
        run.next_camp = next.next_camp;
    }
    let elite = if ty.elite { " (elite)" } else { "" };
    toast(
        ev,
        pid,
        format!("Practice camp: {} x {}{elite}", spots.len(), ty.name),
    );
}

/// Legacy \`trainChest\`: a reward chest about two tiles away, in view, with the chosen options (or the normal roll for what
/// the player holds).
fn chest(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    ix: FighterIx,
    options: &[Option<CardId>; 3],
) {
    let pid = w.players[ix.slot()].core.id;
    let from = w.players[ix.slot()].core.pos();
    let Some(run) = w.practice else {
        return;
    };
    if !drop_allowed(w, ev, pid, run.last_chest_at) {
        return;
    }
    if w.reward_chests.len() >= TRAIN_MAX_CHESTS as usize {
        toast(
            ev,
            pid,
            format!(
                "At most {TRAIN_MAX_CHESTS} chests at once: wait for them to expire or clear them"
            ),
        );
        return;
    }
    let map = k.collision_map(w.rt.gates_locked);
    let taken = occupied_tiles(w);
    let at = floor_tiles_around(
        map,
        from,
        TRAIN_CHEST_MIN_TILES,
        TRAIN_CHEST_MAX_TILES,
        TRAIN_CHEST_TARGET_TILES,
        &taken,
    )
    .into_iter()
    .find(|t| crate::geometry::has_line_of_sight(map, from, *t, crate::constants::MASK_SIGHT));
    let Some(at) = at else {
        toast(ev, pid, "No free floor in view for a chest".into());
        return;
    };
    let chosen: Vec<CardId> = options
        .iter()
        .flatten()
        .copied()
        .filter(|id| live_interactive(*id))
        .collect();
    let ids: Vec<CardId> = if options.iter().all(|o| o.is_none()) {
        let build = w.players[ix.slot()].build;
        let pool = reward_chests::augment_pool(&[build]);
        let mut draw = || w.reward_rng.next_f64();
        reward_chests::roll_with(&mut draw, &pool, false, None)
    } else {
        chosen
    };
    if ids.is_empty() {
        toast(ev, pid, "No interactive augments to offer".into());
        return;
    }
    let options = std::array::from_fn(|i| ids.get(i).map(|id| OptionId::Card(*id)));
    reward_chests::insert(w, at, options, None);
    if let Some(run) = w.practice.as_mut() {
        run.last_chest_at = Some(w.server_time);
    }
    let names: Vec<String> = ids
        .iter()
        .map(|id| {
            let def = id.definition();
            let note = if def.ready { "" } else { " (not live yet)" };
            format!("{}{note}", def.title)
        })
        .collect();
    toast(ev, pid, format!("Chest: {}", names.join(", ")));
}

/// Legacy \`trainClear\`: removes every card, practice mob, chest and projectile the practice console placed, and what the
/// cards left in the player's memory; a cleared practice player is the one that joined.
fn clear(k: &MatchStatic, w: &mut World, ev: &mut Vec<Event>, ix: FighterIx) {
    let pid = w.players[ix.slot()].core.id;
    {
        let p = &mut w.players[ix.slot()];
        p.build = crate::cards::Build::default();
        p.farm.clear();
        crate::cards::runtime::reset_player(p);
        p.core.vitals.barrier = 0.;
        p.barrier_until = 0.;
        p.barrier_decays = false;
        p.card_tank_hp = 0.;
        p.card_prevented = 0.;
    }
    crate::modifiers::recompute(k, w, ix);
    let p = &mut w.players[ix.slot()];
    crate::modifiers::sync_max_hp(p);
    let gone: Vec<PlayerId> = w
        .mobs
        .iter()
        .filter(|m| m.kind == crate::mob_runtime::MobKind::Practice)
        .map(|m| m.core.id)
        .collect();
    for pr in &w.projectiles {
        if gone.contains(&pr.launch.owner) {
            ev.push(Event::ProjectileEnded {
                launch: pr.launch,
                at: pr.pos,
                reason: crate::state::ProjectileEnd::Cleared,
            });
        }
    }
    w.projectiles.retain(|pr| !gone.contains(&pr.launch.owner));
    for id in &gone {
        w.mobs.remove(*id);
    }
    w.reward_chests.clear();
    toast(ev, pid, "Cleared: cards, practice mobs and chests".into());
}
