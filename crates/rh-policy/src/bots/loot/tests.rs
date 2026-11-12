//! Native behaviour tests for the live loot/choice executor (world.ts actLoot, strategy.ts loot/settle, chests.ts).
//! The card choice and the walk decision are the parity-captured leaves; these pin the live glue around them.
use super::*;
use crate::bots::paths::PathBudget;
use crate::bots::types::{PersonaId, TierId};

const ME: Vec2 = Vec2 { x: 400., y: 320. };

fn paths() -> RoomPathService {
    RoomPathService::new(&rh_sim::arenas::practice_arena().map, PathBudget::default())
}

fn ground(key: &str, at: Vec2, w: BotWeapon, interactable: bool) -> PropRef {
    PropRef {
        key: key.into(),
        handle: rh_protocol::PickupHandle::new(41).unwrap(),
        kind: "ground",
        at,
        closed: true,
        contents: Contents::Weapon(w),
        interactable,
    }
}

fn chest(key: &str, at: Vec2, now: f64, options: Option<&[&str]>) -> ChestRef {
    ChestRef {
        key: key.into(),
        handle: rh_protocol::RewardChestHandle::new(9).unwrap(),
        at,
        // Ten seconds left of fifteen: well out of the birth hold.
        expires_at: now + 10_000.,
        life_ms: 15_000.,
        options: options.map(|o| o.iter().map(|s| (*s).to_owned()).collect()),
        taken_by: options.map_or_else(Vec::new, |o| vec![String::new(); o.len()]),
        picked: false,
    }
}

struct Scene {
    now: f64,
    at: Vec2,
    facts: LootFacts,
    fighters: Vec<FighterView>,
    mobs: Vec<MobView>,
    toasts: Vec<String>,
    weapons: [Option<BotWeapon>; 2],
    effects: u16,
    still_since: f64,
    engaged: bool,
}

impl Scene {
    fn new() -> Self {
        Self {
            now: 100_000.,
            at: ME,
            facts: LootFacts {
                raid_started_at: 0.,
                ..LootFacts::default()
            },
            fighters: vec![],
            mobs: vec![],
            toasts: vec![],
            weapons: [None, None],
            effects: 0,
            still_since: 0.,
            engaged: false,
        }
    }
    fn view(&self) -> View<'_> {
        View {
            now: self.now,
            at: self.at,
            alive: true,
            active: true,
            hp: 100.,
            max_hp: 100.,
            effects: self.effects,
            weapons: self.weapons,
            slot: 0,
            faction: Some(rh_sim::FactionId::Fire),
            self_key: "p1",
            fighters: &self.fighters,
            mobs: &self.mobs,
            facts: &self.facts,
            gates_locked: false,
            toasts: &self.toasts,
            still_since: self.still_since,
            engaged: self.engaged,
            persona: PersonaParams::by_id(PersonaId::Farmer),
            tier: TierParams::by_id(TierId::Normal),
        }
    }
}

fn enemy(at: Vec2) -> FighterView {
    FighterView {
        id: "p2".into(),
        x: at.x,
        y: at.y,
        status: "alive".into(),
        targetable: true,
        ..FighterView::default()
    }
}

fn kinds(out: &Output) -> Vec<&IntentBody> {
    out.intents.iter().map(|i| &i.body).collect()
}

#[test]
fn weaponless_bot_offers_a_detour_to_a_visible_ground_weapon_and_respects_the_source_gates() {
    let loot = Loot::new();
    let key = "c3840_2560_g0";
    let mut s = Scene::new();
    s.facts.props = vec![ground(key, Vec2::new(480., 320.), BotWeapon::Sword, false)];
    assert_eq!(
        loot.loot_goal(&s.view()),
        Some(Goal::Loot {
            container: key.into()
        })
    );
    // An enemy inside LOOT_ENEMY_NEAR, an awake mob inside LOOT_MOB_NEAR, or an engaged owner: no detour.
    s.fighters = vec![enemy(Vec2::new(500., 400.))];
    assert_eq!(loot.loot_goal(&s.view()), None);
    s.fighters.clear();
    s.mobs = vec![MobView {
        id: "n9".into(),
        x: 450.,
        y: 330.,
        vx: 60.,
        status: "alive".into(),
        ..MobView::default()
    }];
    assert_eq!(loot.loot_goal(&s.view()), None);
    s.mobs[0].vx = 0.; // asleep: not a fight on the doorstep
    assert!(loot.loot_goal(&s.view()).is_some());
    s.engaged = true;
    assert_eq!(loot.loot_goal(&s.view()), None);
    s.engaged = false;
    // Already carried, both hands full, out of LOOT_GROUND_RADIUS: nothing.
    s.weapons = [Some(BotWeapon::Sword), None];
    assert_eq!(loot.loot_goal(&s.view()), None);
    s.weapons = [Some(BotWeapon::Bow), Some(BotWeapon::Wand)];
    assert_eq!(loot.loot_goal(&s.view()), None);
    s.weapons = [None, None];
    s.facts.props[0].at = Vec2::new(400. + LOOT_GROUND_RADIUS + 1., 320.);
    assert_eq!(loot.loot_goal(&s.view()), None);
    // Someone else nearer to it gets there first.
    s.facts.props[0].at = Vec2::new(480., 320.);
    s.fighters = vec![enemy(Vec2::new(700., 320.))];
    s.facts.props[0].at = Vec2::new(650., 320.);
    assert_eq!(loot.loot_goal(&s.view()), None);
}

#[test]
fn act_loot_walks_settles_then_presses_f_within_the_retry_window() {
    let mut loot = Loot::new();
    let mut paths = paths();
    let key = "c3360_2560_g4";
    let mut s = Scene::new();
    // Out of reach: walk to it.
    s.facts.props = vec![ground(key, Vec2::new(500., 320.), BotWeapon::Axe, false)];
    let out = loot.act_loot(key, &s.view(), &mut paths);
    assert_eq!(out.status, Status::Running);
    assert_eq!(
        kinds(&out),
        vec![&IntentBody::Move {
            to: Vec2::new(500., 320.)
        }]
    );
    // In reach and focused, still moving: one stop, not re-sent inside STOP_RESEND_MS.
    s.now += 50.;
    s.facts.props = vec![ground(key, Vec2::new(420., 320.), BotWeapon::Axe, true)];
    s.still_since = s.now;
    let out = loot.act_loot(key, &s.view(), &mut paths);
    assert_eq!(kinds(&out), vec![&IntentBody::Stop {}]);
    s.now += 100.;
    assert!(loot.act_loot(key, &s.view(), &mut paths).intents.is_empty());
    // Stood still long enough: F, naming the public key; not again inside PICKUP_RETRY_MS.
    s.now += STILL_BEFORE_PICKUP_MS;
    let out = loot.act_loot(key, &s.view(), &mut paths);
    assert_eq!(
        kinds(&out),
        vec![&IntentBody::Pickup {
            container: key.into()
        }]
    );
    s.now += 100.;
    assert!(loot.act_loot(key, &s.view(), &mut paths).intents.is_empty());
    s.now += PICKUP_RETRY_MS;
    assert_eq!(
        kinds(&loot.act_loot(key, &s.view(), &mut paths)),
        vec![&IntentBody::Pickup {
            container: key.into()
        }]
    );
    // The weapon arrived in hand: done.
    s.now += 50.;
    s.weapons = [Some(BotWeapon::Axe), None];
    let out = loot.act_loot(key, &s.view(), &mut paths);
    assert_eq!((out.status, out.why), (Status::Done, "picked up"));
}

#[test]
fn act_loot_ends_on_refusal_toasts_gone_rows_and_enemies() {
    let mut paths = paths();
    let key = "c3360_2560_g4";
    let start = |loot: &mut Loot, s: &mut Scene, paths: &mut RoomPathService| {
        s.facts.props = vec![ground(key, Vec2::new(420., 320.), BotWeapon::Axe, true)];
        s.still_since = s.now - 1_000.;
        let out = loot.act_loot(key, &s.view(), paths);
        assert!(matches!(out.intents[0].body, IntentBody::Pickup { .. }));
    };
    // "Nothing there" answers the press: refused at once.
    let (mut loot, mut s) = (Loot::new(), Scene::new());
    start(&mut loot, &mut s, &mut paths);
    s.now += 50.;
    s.toasts = vec!["Nothing there".into()];
    let out = loot.act_loot(key, &s.view(), &mut paths);
    assert_eq!((out.status, out.why), (Status::Failed, "refused"));
    // Two "Too far away" answers: refused.
    let (mut loot, mut s) = (Loot::new(), Scene::new());
    start(&mut loot, &mut s, &mut paths);
    for _ in 0..2 {
        s.now += 450.;
        s.toasts = vec!["Too far away".into()];
        loot.act_loot(key, &s.view(), &mut paths);
    }
    assert_eq!(
        loot.act_loot(key, &s.view(), &mut paths).status,
        Status::Failed
    );
    // The row left the observation: gone (no remembered container on this seat).
    let (mut loot, mut s) = (Loot::new(), Scene::new());
    start(&mut loot, &mut s, &mut paths);
    s.now += 50.;
    s.facts.props.clear();
    let out = loot.act_loot(key, &s.view(), &mut paths);
    assert_eq!((out.status, out.why), (Status::Failed, "gone"));
    // An enemy walked up: the detour is dropped.
    let (mut loot, mut s) = (Loot::new(), Scene::new());
    start(&mut loot, &mut s, &mut paths);
    s.now += 50.;
    s.fighters = vec![enemy(Vec2::new(450., 330.))];
    let out = loot.act_loot(key, &s.view(), &mut paths);
    assert_eq!((out.status, out.why), (Status::Failed, "enemy near"));
}

#[test]
fn settle_skips_a_failed_or_overlong_loot_detour_and_briefly_excludes_finished_goals() {
    let mut loot = Loot::new();
    let key = "c3840_2560_g0";
    let goal = Goal::Loot {
        container: key.into(),
    };
    let mut s = Scene::new();
    s.facts.props = vec![ground(key, Vec2::new(480., 320.), BotWeapon::Sword, false)];
    loot.settle(&goal, Status::Running, s.now);
    loot.settle(&goal, Status::Failed, s.now + 10.);
    assert_eq!(loot.loot_goal(&s.view()), None);
    s.now += LOOT_SKIP_MS + 20.;
    loot.settle(&Goal::Idle, Status::Running, s.now);
    assert_eq!(loot.loot_goal(&s.view()), Some(goal.clone()));
    // Running past LOOT_BUDGET_MS is skipped too.
    loot.settle(&goal, Status::Running, s.now);
    loot.settle(&goal, Status::Running, s.now + LOOT_BUDGET_MS + 1.);
    assert_eq!(loot.loot_goal(&s.view()), None);
}

#[test]
fn chest_pick_takes_the_best_free_card_and_reasks_only_for_another_card() {
    let mut loot = Loot::new();
    let mut s = Scene::new();
    let options = ["ad1", "ap1", "armor1"];
    s.facts.chests = vec![chest("r1", Vec2::new(440., 320.), s.now, Some(&options))];
    loot.observe(&s.view());
    let expected = choose_option(
        &options.map(String::from),
        &[String::new(), String::new(), String::new()],
        &loot.choice_self(&s.view()),
    );
    assert!(expected >= 0, "a fresh Fire fists bot can use a base card");
    let pick = loot.pick_intent(&s.view()).expect("cards are readable");
    let IntentBody::Choose { msg } = &pick.body else {
        panic!("a pick is a choose")
    };
    assert_eq!((msg.chest.as_str(), i64::from(msg.pick)), ("r1", expected));
    assert_eq!(pick.priority, PRIORITY_COMBAT);
    // The same card is asked for again (the humanizer dedupes it), not counted as a new ask.
    s.now += 100.;
    assert_eq!(loot.pick_intent(&s.view()).unwrap().body, pick.body);
    // Someone took that card first: the next best free one.
    s.facts.chests[0].taken_by[expected as usize] = "?".into();
    let second = loot.pick_intent(&s.view()).unwrap();
    let IntentBody::Choose { msg: m2 } = &second.body else {
        panic!()
    };
    assert_ne!(i64::from(m2.pick), expected);
    assert!(s.facts.chests[0].taken_by[m2.pick as usize].is_empty());
    // A third different card is still an ask, a fourth is not (MAX_ASKS).
    s.facts.chests[0].taken_by[m2.pick as usize] = "?".into();
    let third = loot.pick_intent(&s.view()).unwrap();
    let IntentBody::Choose { msg: m3 } = &third.body else {
        panic!()
    };
    s.facts.chests[0].taken_by[m3.pick as usize] = "?".into();
    assert_eq!(loot.pick_intent(&s.view()), None, "max asks spent");
    // The ask window closes after ASK_WINDOW_MS whatever happens.
    let mut fresh = Loot::new();
    let mut s = Scene::new();
    s.facts.chests = vec![chest("r1", Vec2::new(440., 320.), s.now, Some(&options))];
    assert!(fresh.pick_intent(&s.view()).is_some());
    s.now += ASK_WINDOW_MS + 1.;
    s.facts.chests[0].expires_at = s.now + 5_000.;
    assert_eq!(fresh.pick_intent(&s.view()), None);
}

#[test]
fn no_pick_without_readable_cards_while_stunned_casting_or_in_the_birth_hold() {
    let mut loot = Loot::new();
    let mut s = Scene::new();
    s.facts.chests = vec![chest("r1", Vec2::new(440., 320.), s.now, None)];
    assert_eq!(loot.pick_intent(&s.view()), None, "panel closed");
    s.facts.chests = vec![chest("r1", Vec2::new(440., 320.), s.now, Some(&["ad1"]))];
    s.effects = crate::bots::wish::EFFECT_STUNNED;
    assert_eq!(loot.pick_intent(&s.view()), None);
    s.effects = crate::bots::wish::EFFECT_CASTING;
    assert_eq!(loot.pick_intent(&s.view()), None);
    s.effects = 0;
    // Born a tick ago: held (no ask is spent) until CHEST_HUNT.hold_ms of its own age.
    s.facts.chests[0].expires_at = s.now + 15_000. - 50.;
    assert_eq!(loot.pick_intent(&s.view()), None);
    assert!(loot.asks.is_empty());
    s.facts.chests[0].expires_at = s.now + 15_000. - CHEST_HUNT.hold_ms;
    assert!(loot.pick_intent(&s.view()).is_some());
    // Picked already or about to vanish: nothing.
    s.facts.chests[0].picked = true;
    assert_eq!(Loot::new().pick_intent(&s.view()), None);
    s.facts.chests[0].picked = false;
    s.facts.chests[0].expires_at = s.now + CHEST_HUNT.pick_margin_ms;
    assert_eq!(Loot::new().pick_intent(&s.view()), None);
}

#[test]
fn chest_goal_stays_for_the_pick_in_reach_and_walks_to_a_far_chest() {
    let mut loot = Loot::new();
    let mut paths = paths();
    let mut s = Scene::new();
    s.facts.chests = vec![chest("r1", Vec2::new(440., 320.), s.now, Some(&["ad1"]))];
    assert_eq!(
        loot.chest_goal(&s.view(), &mut paths),
        Some(Goal::Chest { chest: "r1".into() })
    );
    let out = loot.act_chest("r1", &s.view(), &mut paths);
    assert_eq!(out.status, Status::Running);
    assert!(matches!(out.intents[0].body, IntentBody::Choose { .. }));
    // A far chest (cards shut): the hunt walks to it, and act moves there.
    let mut loot = Loot::new();
    s.facts.chests = vec![chest("r2", Vec2::new(600., 320.), s.now, None)];
    assert_eq!(
        loot.chest_goal(&s.view(), &mut paths),
        Some(Goal::Chest { chest: "r2".into() })
    );
    let out = loot.act_chest("r2", &s.view(), &mut paths);
    assert_eq!(out.status, Status::Running);
    assert_eq!(
        kinds(&out),
        vec![&IntentBody::Move {
            to: Vec2::new(600., 320.)
        }]
    );
    // Gone from the observation: the goal is done (and briefly excluded by settle).
    s.facts.chests.clear();
    let out = loot.act_chest("r2", &s.view(), &mut paths);
    assert_eq!(out.status, Status::Done);
    // Not live (in the coliseum): no chest goal at all.
    s.facts.chests = vec![chest("r2", Vec2::new(600., 320.), s.now, None)];
    s.facts.in_coliseum = true;
    assert_eq!(Loot::new().chest_goal(&s.view(), &mut paths), None);
}

#[test]
fn observe_counts_the_bots_own_card_into_its_build_record_once() {
    let mut loot = Loot::new();
    let mut s = Scene::new();
    s.facts.chests = vec![chest(
        "r1",
        Vec2::new(440., 320.),
        s.now,
        Some(&["ad1", "ap1"]),
    )];
    s.facts.chests[0].taken_by = vec![String::new(), "p1".into()];
    loot.observe(&s.view());
    loot.observe(&s.view());
    assert_eq!(loot.build.count("ap1"), 1.);
    assert_eq!(loot.build.count("ad1"), 0.);
    // The panel closing drops the ask record (a later visit starts afresh).
    loot.asks.push((
        "r1".into(),
        Ask {
            first: 0.,
            option: 0,
            n: 1,
        },
    ));
    s.facts.chests[0].options = None;
    loot.observe(&s.view());
    assert!(loot.asks.is_empty());
}

#[test]
fn a_fight_at_a_readable_chest_takes_precedence_and_the_pick_rides_along() {
    let mut loot = Loot::new();
    let mut paths = paths();
    let mut s = Scene::new();
    s.facts.chests = vec![chest("r1", Vec2::new(440., 320.), s.now, Some(&["ad1"]))];
    // Inside the persona's threat range (Farmer 140 u): no chest goal, in reach or walking.
    s.fighters = vec![enemy(Vec2::new(480., 320.))];
    assert_eq!(loot.chest_goal(&s.view(), &mut paths), None);
    s.fighters.clear();
    s.engaged = true;
    assert_eq!(loot.chest_goal(&s.view(), &mut paths), None);
    // A chest goal already held when the fight starts is handed back at once, with the pick still sent.
    s.engaged = false;
    assert!(loot.chest_goal(&s.view(), &mut paths).is_some());
    s.fighters = vec![enemy(Vec2::new(480., 320.))];
    let out = loot.act_chest("r1", &s.view(), &mut paths);
    assert_eq!(out.status, Status::Done);
    assert!(matches!(
        out.intents[..],
        [Intent {
            body: IntentBody::Choose { .. },
            ..
        }]
    ));
    // Under any other goal (a fight) the module hook still offers the same pick.
    s.now += 100.;
    let pick = loot.intents(
        &Goal::Fight {
            target: "p2".into(),
        },
        &s.view(),
    );
    assert!(matches!(
        pick,
        Some(Intent {
            body: IntentBody::Choose { .. },
            ..
        })
    ));
}
