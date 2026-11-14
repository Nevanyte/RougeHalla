//! P-BOT-BRAIN-THEMED-2 oracle: the Brain's hunt values a mob by the stat its camp pays.
//!
//! Legacy reference: the camp-buff patch `a7b5c4ce` (`origin/claude/adoring-edison-mxt8ab`, not in `packages/`).
//! `huntAdapter.ts:123-135` (patched) maps each camp id to its public buff (`extras.camps[].buff`, the normal type whose
//! stat the camp's kills pay when it is not the camp's own type's) and sets it as `MobLike.reward` on every remembered mob
//! of that camp (`m.campId`); `mobHunt.ts:464` (patched) weighs a candidate `m.kind === "elite" || !inp.typeWeight ? 1 :
//! inp.typeWeight(m.reward ?? m.type)`. `typeWeight` (`buildRoute.ts:127-131`) is the build's weight for the type's stat,
//! floored at `STAT_FLOOR`, and the floor for an unknown type.
//!
//! The seat reads only its own composed percept (C-OBS): `extras.camps[].reward` is the composer's HUD stat code of the
//! stat the camp pays (`observe.rs` `camp_hud_into`), for every camp, on theme or not. The legacy buff is present only
//! off theme, so a mob whose type the seat has not learned (a minimap dot: `type_ = None`) in an on-theme camp keeps the
//! floor, as legacy does. The reference here uses the world's ground truth (`Sim::camp_buffs`, legacy's
//! `CampState.buff`); the test also checks the percept carries enough to reproduce it.
//! Loose-proof standard (owner direction 2026-11-10): the numbers are the source formula on a real composed percept.
use super::adapters;
use super::compose14::{brain_map, test_support::seed1_arena, Composer14, Setup14, HUD_STATS};
use crate::bots::build_route::{
    reward_stat, type_weight, BuildGoal, FarmStat, BUILD_GOALS, STAT_FLOOR,
};
use crate::bots::mob_hunt::{HuntDecision, MOB_HUNT};
use crate::bots::temporal_percept::memory::MobMemory;
use crate::bots::temporal_percept::strategy::types::{CampDef, CampView, RouteCamp};
use crate::bots::temporal_percept::strategy::{
    hud_code_stat, hunt_mobs, hunt_type_weight, hunt_wanted, route_camp_value, HuntInput,
    HuntMobLike, HuntSelf, MobHunter,
};
use crate::delivery::DeliverySession;
use rh_sim::mob_catalog::{self, MobTypeId};
use rh_sim::mob_runtime::MobMode;
use rh_sim::{
    math, ArenaMode, CampBuffRule, FactionId, ItemObserver, Observation, Secrets, Sim, SimConfig,
    Vec2, WeaponId,
};

const SEED: u64 = 11;

/// The composer's HUD stat codes and the farm stat each one is (`observe.rs` `hud_stat` read backwards), kept here so
/// the weight tests do not depend on the table under test in (4).
const HUD_STAT: [(&str, FarmStat); 9] = [
    ("offense", FarmStat::Ad),
    ("soulOffense", FarmStat::Ap),
    ("damage", FarmStat::Damage),
    ("attackSpeed", FarmStat::AttackSpeed),
    ("lifeSteal", FarmStat::Lifesteal),
    ("health", FarmStat::MaxHp),
    ("defense", FarmStat::Armor),
    ("soulDefense", FarmStat::Shield),
    ("moveSpeed", FarmStat::MoveSpeed),
];

fn stat_of(code: &str) -> Option<FarmStat> {
    HUD_STAT.iter().find(|(c, _)| *c == code).map(|(_, s)| *s)
}

fn code_of(stat: FarmStat) -> &'static str {
    HUD_STAT
        .iter()
        .find(|(_, s)| *s == stat)
        .map(|(c, _)| *c)
        .expect("every farm stat has a HUD code")
}

fn builds() -> impl Iterator<Item = &'static BuildGoal> {
    BUILD_GOALS.iter().flatten()
}

/// mobHunt.ts `wanted` before `a7b5c4ce`: by the mob's type (the hunt today).
fn by_type(build: &BuildGoal, m: &MobMemory) -> f64 {
    if m.kind == "elite" {
        return 1.;
    }
    type_weight(build, m.type_.as_deref())
}

/// mobHunt.ts `wanted` after `a7b5c4ce`: `typeWeight(m.reward ?? m.type)`, `reward` the camp's buff (`None` on theme).
fn by_buff(build: &BuildGoal, m: &MobMemory, buff: Option<MobTypeId>) -> f64 {
    if m.kind == "elite" {
        return 1.;
    }
    match buff {
        Some(t) => type_weight(build, Some(t.as_str())),
        None => type_weight(build, m.type_.as_deref()),
    }
}

/// A remembered regional mob at a camp (memory.rs `fold_mobs`: `camp_id` from its home spot).
fn mob(
    id: &str,
    kind: &str,
    type_: Option<&str>,
    zone: FactionId,
    at: Vec2,
    camp: Option<&str>,
) -> MobMemory {
    MobMemory {
        id: id.into(),
        type_: type_.map(str::to_string),
        kind: kind.into(),
        faction: Some(zone),
        name: None,
        home: Some(at),
        camp_id: camp.map(str::to_string),
        pos: at,
        dot_at: 0.,
        seen_at: Some(0.),
        hp_frac: 1.,
        in_hand: Some(WeaponId::Sword),
        awake: false,
        returning: false,
        alive: true,
    }
}

/// One seat's composed camp views (the source-arena map, seed1, in its lobby, the given buff rule), the map's camp
/// definitions, and the world (its rosters and buffs are the ground truth the reference reads).
fn composed_camps(rule: CampBuffRule, seed: u64) -> (Sim, Vec<CampView>, Vec<CampDef>) {
    let arena = seed1_arena();
    let config = SimConfig {
        lifecycle: ArenaMode::Source(Default::default()),
        mob_mode: MobMode::Pve,
        initial_loot: true,
        consumables: true,
        min_players: 1,
        camp_buffs: rule,
        ..SimConfig::default()
    };
    let mut sim = Sim::try_new(config.clone(), arena.clone(), Secrets::from_seed(seed))
        .expect("seed1 Pve world");
    let me = sim
        .add_player("seat", Some(FactionId::Fire), true)
        .expect("seat");
    let features = crate::bots::brain_features(&config, &arena);
    let mut composer = Composer14::new(Setup14::public(&arena, features, 0.6));
    let mut session = DeliverySession::new(me);
    let mut observer = ItemObserver::new(me);
    let mut last = None;
    for _ in 0..6 {
        let mut obs = Observation::default();
        observer
            .prepare_into(&sim, &[], &mut obs, None)
            .expect("seat scene")
            .commit();
        let prepared = session
            .prepare(&obs, false, false, &[])
            .expect("representable scene");
        let frame = session.commit(prepared);
        last = Some(composer.compose(frame.frame()).expect("frame composes"));
        sim.step();
    }
    let composed = last.expect("composed");
    let percept = adapters::strategy_percept(&composed.percept).expect("strategy percept");
    let views = percept.extras.camps.expect("the camps feature is on");
    let defs = brain_map(&arena).strategy.camps;
    assert_eq!(views.len(), sim.camp_rosters().len(), "a view per camp");
    assert_eq!(
        defs.len(),
        sim.camp_rosters().len(),
        "a definition per camp"
    );
    for (j, v) in views.iter().enumerate() {
        assert_eq!(v.index, j, "views in camp order");
    }
    (sim, views, defs)
}

/// For every camp: a normal mob the seat has seen (typed), a normal mob it knows only as a minimap dot (`type_ = None`),
/// and the elite when the camp has one; each with the camp's map id, as memory gives it. Returns (camp index, mob).
fn camp_mobs(sim: &Sim, defs: &[CampDef]) -> Vec<(usize, MobMemory)> {
    let mut out = Vec::new();
    for (i, (roster, def)) in sim.camp_rosters().iter().zip(defs).enumerate() {
        let at = def
            .spots
            .first()
            .copied()
            .unwrap_or(Vec2::new(def.x, def.y));
        let ty = roster.mob_type.as_str();
        out.push((
            i,
            mob(
                &format!("n{i}"),
                "mob",
                Some(ty),
                def.zone,
                at,
                Some(&def.id),
            ),
        ));
        out.push((
            i,
            mob(&format!("d{i}"), "mob", None, def.zone, at, Some(&def.id)),
        ));
        if let Some(elite) = roster.elite {
            out.push((
                i,
                mob(
                    &format!("e{i}"),
                    "elite",
                    Some(elite.as_str()),
                    def.zone,
                    at,
                    Some(&def.id),
                ),
            ));
        }
    }
    out
}

fn mobs_only(mobs: &[(usize, MobMemory)]) -> Vec<(String, MobMemory)> {
    mobs.iter()
        .map(|(_, m)| (m.id.clone(), m.clone()))
        .collect()
}

/// The hunt's weight for each snapshot mob, for one build, through the engine's weight and the hunter's `wanted`.
fn hunt_weights(build: &BuildGoal, snapshot: &[(String, HuntMobLike)]) -> Vec<(String, f64)> {
    let weight = hunt_type_weight(build);
    snapshot
        .iter()
        .map(|(id, like)| (id.clone(), hunt_wanted(like, Some(&*weight))))
        .collect()
}

/// (1) Themed world: a normal mob is worth the stat its camp pays. Red before this packet, which weighs it by its type.
#[test]
fn themed_hunt_weighs_a_mob_by_the_stat_its_camp_pays() {
    let (sim, views, defs) = composed_camps(CampBuffRule::Themed, SEED);
    let buffs = sim.camp_buffs().to_vec();
    assert_eq!(
        buffs.len(),
        defs.len(),
        "a buff entry per camp under Themed"
    );
    let off_theme = buffs.iter().filter(|b| b.is_some()).count();
    eprintln!("{off_theme} of {} camps off theme", defs.len());
    assert!(
        off_theme * 10 >= defs.len() && off_theme * 2 <= defs.len(),
        "{off_theme} of {} camps off theme (the patch measured about 29%)",
        defs.len()
    );
    // The seat's percept carries enough to reproduce legacy's buff: an off-theme camp's code is the buff type's stat,
    // which differs from the camp type's own; an on-theme camp's code is its own type's stat.
    for (i, (roster, b)) in sim.camp_rosters().iter().zip(&buffs).enumerate() {
        let own = reward_stat(Some(roster.mob_type.as_str()));
        let code = stat_of(&views[i].reward);
        match b {
            Some(t) => {
                let paid = reward_stat(Some(t.as_str()));
                assert_eq!(code, paid, "camp {i}: the percept names the buff's stat");
                assert_ne!(
                    paid, own,
                    "camp {i}: a legacy buff pays a stat other than the camp type's own"
                );
            }
            None => assert_eq!(code, own, "camp {i}: on theme, the type's own stat"),
        }
    }
    let mobs = camp_mobs(&sim, &defs);
    let snapshot = hunt_mobs(&mobs_only(&mobs), Some(&views), &defs);
    let ids: Vec<&str> = snapshot.iter().map(|(id, _)| id.as_str()).collect();
    let want_ids: Vec<&str> = mobs.iter().map(|(_, m)| m.id.as_str()).collect();
    assert_eq!(
        ids, want_ids,
        "every remembered mob reaches the hunt, in memory order"
    );
    let mut moved = 0usize;
    for build in builds() {
        let got = hunt_weights(build, &snapshot);
        for ((i, m), (id, w)) in mobs.iter().zip(&got) {
            let want = by_buff(build, m, buffs[*i]);
            if want != by_type(build, m) {
                moved += 1;
            }
            assert_eq!(
                w.to_bits(),
                want.to_bits(),
                "mob {id} ({} {:?}) of camp {i} ({} paying {}), build {}: hunt weight {w}, the paid stat gives {want}",
                m.kind,
                m.type_,
                sim.camp_rosters()[*i].mob_type.as_str(),
                views[*i].reward,
                build.id
            );
        }
    }
    assert!(moved > 0, "some build weighs some mob differently");
}

/// (1, direction) a7b5c4ce `mobHunt.test.ts` "weighs a mob by what its kill pays": two mobs of one type, the buffed one
/// farther; the hunter picks the buffed one when its camp pays the build's stat, the nearer plain one when it does not.
/// Red before this packet (both weigh the floor, so the nearer wins).
#[test]
fn the_hunter_picks_the_mob_whose_camp_pays_the_builds_stat() {
    let build = &BUILD_GOALS[0][0];
    assert_eq!(build.id, "fire:A");
    assert_eq!(build.weight(FarmStat::Damage), 1.);
    // A normal type Fire A does not want (its weight is the floor), and its own stat's code.
    let ty = FactionId::ALL
        .iter()
        .flat_map(|z| mob_catalog::normal_types_of(*z))
        .find(|t| type_weight(build, Some(t.id.as_str())) == STAT_FLOOR)
        .expect("some normal type is worth the floor to Fire A");
    let own_code = code_of(reward_stat(Some(ty.id.as_str())).expect("normal type pays a stat"));
    let def = |id: &str, x: f64, y: f64| CampDef {
        id: id.into(),
        zone: ty.zone,
        x,
        y,
        r: 100.,
        spots: vec![Vec2::new(x, y)],
        elite_spot: -1.,
        chest: Vec2::new(x, y),
        area: 400.,
        radius: 300.,
    };
    let defs = vec![def("plain-camp", 100., 0.), def("buffed-camp", 0., 130.)];
    let view = |index: usize, reward: &str| CampView {
        index,
        type_: Some(ty.id.as_str().to_string()),
        reward: reward.into(),
        alive: 4,
        state: 0,
        respawn_at: None,
    };
    let mobs = vec![
        (
            "plain".to_string(),
            mob(
                "plain",
                "mob",
                Some(ty.id.as_str()),
                ty.zone,
                Vec2::new(100., 0.),
                Some("plain-camp"),
            ),
        ),
        (
            "buffed".to_string(),
            mob(
                "buffed",
                "mob",
                Some(ty.id.as_str()),
                ty.zone,
                Vec2::new(0., 130.),
                Some("buffed-camp"),
            ),
        ),
    ];
    let pick = |views: &[CampView]| -> Option<String> {
        let snapshot = hunt_mobs(&mobs, Some(views), &defs);
        let self_view = HuntSelf {
            faction: None,
            x: 0.,
            y: 0.,
            hp: 100.,
            max_hp: 100.,
            weapons: [Some(WeaponId::Sword), None],
            power: 0.,
            mob_kills: 0.,
            mob_stats: Vec::new(),
        };
        let players: Vec<Vec2> = Vec::new();
        let mut walk = |m: &HuntMobLike| Some(math::hypot(m.x, m.y));
        let weight = hunt_type_weight(build);
        let mut input = HuntInput {
            now: 1000.,
            self_: &self_view,
            player_distance: f64::INFINITY,
            players: &players,
            in_coliseum: false,
            mobs: &snapshot,
            walk: &mut walk,
            attacking: false,
            shot_by_player_at: f64::NEG_INFINITY,
            type_weight: Some(&*weight),
            elites_ready: Some(false),
        };
        match MobHunter::new(MOB_HUNT).decide(&mut input) {
            HuntDecision::Mob { id, .. } => Some(id),
            _ => None,
        }
    };
    // Both camps on theme: the nearer mob (green today too).
    let on_theme = vec![view(0, own_code), view(1, own_code)];
    assert_eq!(pick(&on_theme).as_deref(), Some("plain"));
    // The farther camp pays Damage, Fire A's top stat: its mob.
    let buffed = vec![view(0, own_code), view(1, "damage")];
    assert_eq!(
        pick(&buffed).as_deref(),
        Some("buffed"),
        "a {} whose camp pays damage is worth 1 to Fire A, the plain one {STAT_FLOOR}",
        ty.id.as_str()
    );
}

/// (2) A mob the percept gives no paid stat for keeps today's weight: no camp id, a camp id the map does not have, the
/// camps feature off, or a camp whose percept reward is not a stat code (the frozen corpus's `"known"`, `"weapon"`, a
/// legacy clear-reward kind, a mis-cased code). Green today; stays green.
#[test]
fn a_mob_without_a_paid_stat_in_the_percept_keeps_its_type_weight() {
    let zone = FactionId::Fire;
    let ty = mob_catalog::normal_types_of(zone)
        .next()
        .expect("a fire type");
    let def = CampDef {
        id: "camp-0".into(),
        zone,
        x: 0.,
        y: 0.,
        r: 100.,
        spots: vec![Vec2::new(0., 0.)],
        elite_spot: -1.,
        chest: Vec2::new(0., 0.),
        area: 400.,
        radius: 300.,
    };
    let defs = vec![def];
    let at = Vec2::new(10., 0.);
    let mobs: Vec<(String, MobMemory)> = [
        mob("typed-no-camp", "mob", Some(ty.id.as_str()), zone, at, None),
        mob("dot-no-camp", "mob", None, zone, at, None),
        mob(
            "typed-elsewhere",
            "mob",
            Some(ty.id.as_str()),
            zone,
            at,
            Some("nowhere"),
        ),
        mob(
            "typed",
            "mob",
            Some(ty.id.as_str()),
            zone,
            at,
            Some("camp-0"),
        ),
        mob("dot", "mob", None, zone, at, Some("camp-0")),
    ]
    .into_iter()
    .map(|m| (m.id.clone(), m))
    .collect();
    let mut cases: Vec<Option<Vec<CampView>>> = vec![None];
    for reward in [
        "", "?", "known", "weapon", "skills", "relic", "cursed", "Damage", "ad",
    ] {
        cases.push(Some(vec![CampView {
            index: 0,
            type_: Some(ty.id.as_str().to_string()),
            reward: reward.into(),
            alive: 4,
            state: 0,
            respawn_at: None,
        }]));
    }
    for views in &cases {
        let snapshot = hunt_mobs(&mobs, views.as_deref(), &defs);
        assert_eq!(snapshot.len(), mobs.len());
        for build in builds() {
            for ((_, m), (id, w)) in mobs.iter().zip(hunt_weights(build, &snapshot)) {
                assert_eq!(
                    w.to_bits(),
                    by_type(build, m).to_bits(),
                    "mob {id}, camps {:?}, build {}",
                    views.as_ref().map(|v| v[0].reward.clone()),
                    build.id
                );
            }
        }
    }
    // A camp whose code IS a stat code but no camp of that index on the map: nothing to match, today's weight.
    let stray = vec![CampView {
        index: 7,
        type_: Some(ty.id.as_str().to_string()),
        reward: "damage".into(),
        alive: 4,
        state: 0,
        respawn_at: None,
    }];
    let snapshot = hunt_mobs(&mobs, Some(&stray), &defs);
    for build in builds() {
        for ((_, m), (id, w)) in mobs.iter().zip(hunt_weights(build, &snapshot)) {
            assert_eq!(
                w.to_bits(),
                by_type(build, m).to_bits(),
                "mob {id}, stray view, build {}",
                build.id
            );
        }
    }
}

/// (2) Elites weigh 1 in the hunt whatever their camp pays (mobHunt.ts:464 `m.kind === "elite" ? 1`), and with no build
/// every mob weighs 1. Green today; stays green.
#[test]
fn elites_and_a_buildless_hunt_keep_weight_one_in_a_themed_world() {
    let (sim, views, defs) = composed_camps(CampBuffRule::Themed, SEED);
    let mobs = camp_mobs(&sim, &defs);
    let snapshot = hunt_mobs(&mobs_only(&mobs), Some(&views), &defs);
    let elites = mobs.iter().filter(|(_, m)| m.kind == "elite").count();
    assert!(elites > 0, "the map has elite camps");
    let buffed_elites = mobs
        .iter()
        .filter(|(i, m)| m.kind == "elite" && sim.camp_buffs()[*i].is_some())
        .count();
    eprintln!("{buffed_elites} of {elites} elites in an off-theme camp");
    for build in builds() {
        for ((_, m), (id, w)) in mobs.iter().zip(hunt_weights(build, &snapshot)) {
            if m.kind == "elite" {
                assert_eq!(w, 1., "elite {id}, build {}", build.id);
            }
        }
    }
    for (id, like) in &snapshot {
        assert_eq!(hunt_wanted(like, None), 1., "mob {id} with no build");
    }
}

/// (2) Unthemed (legacy) world: no camp has a buff, so every hunt weight is today's, bit for bit, for every build, the
/// minimap dots (`type_ = None`, the floor) included. Green today; stays green.
#[test]
fn unthemed_rewards_leave_every_hunt_weight_as_today() {
    let (sim, views, defs) = composed_camps(CampBuffRule::Legacy, SEED);
    assert!(sim.camp_buffs().is_empty(), "no buffs under Legacy");
    for (i, roster) in sim.camp_rosters().iter().enumerate() {
        assert_eq!(
            stat_of(&views[i].reward),
            reward_stat(Some(roster.mob_type.as_str())),
            "camp {i}: under Legacy the percept's reward is the type's own stat"
        );
    }
    let mobs = camp_mobs(&sim, &defs);
    let snapshot = hunt_mobs(&mobs_only(&mobs), Some(&views), &defs);
    assert_eq!(snapshot.len(), mobs.len());
    for build in builds() {
        for ((i, m), (id, w)) in mobs.iter().zip(hunt_weights(build, &snapshot)) {
            assert_eq!(
                w.to_bits(),
                by_type(build, m).to_bits(),
                "mob {id} ({} {:?}) of camp {i}, build {}",
                m.kind,
                m.type_,
                build.id
            );
        }
    }
}

/// (3) One stat-code table for the route and the hunt: it names a distinct stat for every code the composer can put in
/// a camp's reward (`compose14.rs` `HUD_STATS`), agrees with the real pipeline (under Legacy each camp's code is its
/// type's own stat), and the route values a camp by it. Red before this packet (the shared table is a stub).
#[test]
fn the_shared_stat_code_table_covers_every_hud_code() {
    let mut seen: Vec<FarmStat> = Vec::new();
    for code in HUD_STATS {
        let stat = hud_code_stat(code)
            .unwrap_or_else(|| panic!("HUD code {code:?} names no farm stat in the shared table"));
        assert!(
            !seen.contains(&stat),
            "HUD code {code:?}: {stat:?} named twice"
        );
        seen.push(stat);
    }
    for code in [
        "", "?", "known", "weapon", "skills", "relic", "cursed", "Damage", "ad",
    ] {
        assert_eq!(hud_code_stat(code), None, "{code:?} is not a stat code");
    }
    let (sim, views, _) = composed_camps(CampBuffRule::Legacy, SEED);
    for (i, roster) in sim.camp_rosters().iter().enumerate() {
        assert_eq!(
            hud_code_stat(&views[i].reward),
            reward_stat(Some(roster.mob_type.as_str())),
            "camp {i} ({}): code {:?}",
            roster.mob_type.as_str(),
            views[i].reward
        );
    }
    // The route reads the same table: a plain camp of four normals paying `code` is worth 4 x the stat's weight.
    for code in HUD_STATS {
        let stat = hud_code_stat(code).expect("checked above");
        let camp = RouteCamp {
            index: 0,
            id: "c0".into(),
            zone: FactionId::Fire,
            x: 0.,
            y: 0.,
            r: 100.,
            elite: false,
            spots: 4,
            mob_type: "flameCaller".into(),
            reward: code.into(),
            alive: 4,
            state: 0,
            respawn_at: 0.,
        };
        for build in builds() {
            assert_eq!(
                route_camp_value(build, &camp, false).to_bits(),
                (4. * build.weight(stat).max(STAT_FLOOR)).to_bits(),
                "code {code:?}, build {}",
                build.id
            );
        }
    }
}
