use super::*;
use crate::{drive_seats_with, scripted::Idle, Seat};
use rh_sim::{FactionId, Placement, Secrets, SightCache, Sim, SimConfig, Vec2};
fn scene(enemy: bool) -> Sim {
    let mut places = vec![Placement {
        profile: "owner".into(),
        faction: FactionId::Fire,
        bot: true,
        at: Vec2::new(400., 320.),
        hp: None,
        weapon0: None,
        weapon1: None,
    }];
    if enemy {
        places.push(Placement {
            profile: "other".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(440., 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        });
    }
    Sim::reset_active(
        SimConfig {
            quests: false,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(1),
        &places,
    )
}
fn bot(start: &MatchStart) -> HumanBot {
    let mut b = HumanBot::new(TierId::Normal, PersonaId::Hunter);
    b.reset(start);
    b
}
#[test]
fn real_seat_validates_submits_and_repeats_identically_without_fallback() {
    fn run() -> (Vec<(PlayerId, rh_sim::Command)>, crate::SeatStats, u64) {
        let mut sim = scene(true);
        let start = MatchStart::of(&sim, PlayerId(1), 7);
        let mut seats = [Seat::new(
            &start,
            Box::new(HumanBot::new(TierId::Normal, PersonaId::Hunter)),
            Box::new(Idle),
        )];
        seats[0].bind_fx(&sim).unwrap();
        let mut sight = SightCache::new();
        let mut sent = vec![];
        let mut events = vec![];
        for _ in 0..160 {
            drive_seats_with(&mut sim, &mut seats, &events, &mut sight, |id, c| {
                sent.push((id, c))
            });
            events = sim.step();
        }
        assert!(seats[0].fault.is_none());
        assert_eq!(seats[0].stats.fallback_decisions, 0);
        assert!(seats[0].stats.accepted > 0);
        assert!(!sent.is_empty());
        (sent, seats[0].stats.clone(), sim.state_hash())
    }
    assert_eq!(run(), run());
}
#[test]
fn same_observations_reset_cross_seat_and_hidden_rows_cannot_perturb_commands() {
    let mut sim = scene(true);
    let start = MatchStart::of(&sim, PlayerId(1), 17);
    let mut a = bot(&start);
    let mut b = bot(&start);
    let mut other = bot(&MatchStart {
        seed: 999,
        ..start.clone()
    });
    let mut old_hidden = None;
    for i in 0..60 {
        let obs = rh_sim::observe(&sim, PlayerId(1), &[]);
        let mut perturbed = obs.clone();
        if i < 30 {
            let actor = perturbed.visible.first_mut().unwrap();
            actor.effects |= crate::bots::wish::EFFECT_HIDDEN;
            actor.x += (i + 1) as f64 * 70.;
            actor.hp_frac = 0.;
            actor.bounty = u32::MAX;
            actor.weapon = Some(rh_sim::WeaponId::Wand);
            let mut clean = obs.clone();
            clean.visible.clear();
            let a_cmd = a.component_commands(&clean);
            let b_cmd = b.component_commands(&perturbed);
            assert_eq!(a_cmd, b_cmd);
            old_hidden = Some(perturbed.visible[0].clone());
        } else {
            assert_eq!(a.component_commands(&obs), b.component_commands(&obs));
        }
        let _ = other.component_commands(&obs);
        sim.step();
    }
    assert!(old_hidden.is_some());
    a.reset(&start);
    b.reset(&start);
    let obs = rh_sim::observe(&sim, PlayerId(1), &[]);
    assert_eq!(a.component_commands(&obs), b.component_commands(&obs));
    assert_eq!(a.memory.as_ref().unwrap().records().len(), 1);
    assert_eq!(
        a.paths.as_ref().unwrap().budget().left(),
        b.paths.as_ref().unwrap().budget().left()
    );
}
#[test]
fn live_roam_uses_world_executor_and_never_exceeds_path_budget() {
    let mut sim = scene(false);
    let start = MatchStart::of(&sim, PlayerId(1), 3);
    let mut b = bot(&start);
    let mut accepted = 0;
    for _ in 0..100 {
        let obs = rh_sim::observe(&sim, PlayerId(1), &[]);
        let searches = b.paths.as_ref().unwrap().stats().searches;
        let cmds = b.component_commands(&obs);
        assert!(
            b.paths.as_ref().unwrap().stats().searches - searches
                <= u64::from(crate::bots::paths::BOT_PATH_BUDGET_PER_TICK)
        );
        assert!(matches!(b.brain.goal, Goal::Roam { .. }));
        assert!(
            b.paths.as_ref().unwrap().budget().left()
                <= crate::bots::paths::BOT_PATH_BUDGET_PER_TICK
        );
        for c in cmds {
            // The real seat test covers binding resolution; roam contains only ordinary coordinates.
            let raw = match c {
                PublicCommand::Move { x, y, seq } => rh_sim::RawCommand::Move { x, y, seq },
                PublicCommand::Stop { seq } => rh_sim::RawCommand::Stop { seq },
                _ => panic!("world executor may only move/stop"),
            };
            if let Ok(command) = rh_sim::validate(raw) {
                if sim.submit(PlayerId(1), command).is_ok() {
                    accepted += 1;
                }
            }
        }
        sim.step();
    }
    assert!(accepted > 0);
    assert!(b.paths.as_ref().unwrap().stats().searches > 0);
}
#[test]
fn neutral_dummy_zombie_rows_never_become_enemy_or_regional_farm_goals() {
    let sim = scene(true);
    let start = MatchStart::of(&sim, PlayerId(1), 9);
    use rh_sim::observe::ActorKind;
    for kind in [ActorKind::Zombie, ActorKind::Dummy, ActorKind::QuestGiver] {
        let mut b = bot(&start);
        let mut obs = rh_sim::observe(&sim, PlayerId(1), &[]);
        let row = obs.visible.first_mut().unwrap();
        row.kind = kind;
        row.id = PlayerId(1 << 31);
        if kind == ActorKind::QuestGiver {
            row.faction = rh_sim::fighter::FighterAffiliation::Neutral;
            row.weapon = None;
        }
        b.component_commands(&obs);
        assert!(matches!(b.brain.goal, Goal::Roam { .. }));
        assert!(b.memory.as_ref().unwrap().records().is_empty());
        assert!(b.ids.is_empty());
    }
    // A contradictory neutral combat kind must not manufacture a threat or farming target either.
    for kind in [ActorKind::Player, ActorKind::Regional] {
        let mut b = bot(&start);
        let mut obs = rh_sim::observe(&sim, PlayerId(1), &[]);
        let row = obs.visible.first_mut().unwrap();
        row.kind = kind;
        row.faction = rh_sim::fighter::FighterAffiliation::Neutral;
        row.weapon = None;
        // Contradictory neutral combat actors are refused by the human codec, not silently
        // converted to Fire/Fists or filtered after advancing this brain.
        let session = crate::delivery::DeliverySession::new(PlayerId(1));
        assert!(session.prepare(&obs, true, true, &[]).is_err());
        assert!(b.decide(&obs).is_empty());
        assert!(matches!(b.brain.goal, Goal::Idle));
        assert!(b.memory.as_ref().unwrap().records().is_empty());
        assert!(b.ids.is_empty());
    }
}

#[test]
fn rejected_duplicate_scene_does_not_advance_the_live_brain_memory_or_random_streams() {
    let mut sim = scene(false);
    let start = MatchStart::of(&sim, PlayerId(1), 7);
    let mut b = bot(&start);
    let obs = rh_sim::observe(&sim, PlayerId(1), &[]);
    b.component_commands(&obs);
    let brain = b.brain.clone();
    let memory = b.memory.clone();
    let decide = b.decide.clone();
    let motor = b.motor.clone();
    let lapse = b.lapse.clone();
    assert!(b.component_commands(&obs).is_empty());
    assert_eq!(b.brain, brain);
    assert_eq!(b.memory, memory);
    assert_eq!(b.decide, decide);
    assert_eq!(b.motor, motor);
    assert_eq!(b.lapse, lapse);
    sim.step();
    let obs = rh_sim::observe(&sim, PlayerId(1), &[]);
    b.component_commands(&obs);
    assert!(b.memory.as_ref().unwrap().own_motion().unwrap().source_time > 0.);
}

#[test]
fn an_expired_cached_wish_goal_finishes_before_the_next_strategy_deadline() {
    let mut sim = scene(false);
    let start = MatchStart::of(&sim, PlayerId(1), 7);
    let mut b = bot(&start);
    b.brain
        .adopt(Goal::WishSlip, 0., b.tier_params(), &mut b.decide);
    let obs = rh_sim::observe(&sim, PlayerId(1), &[]);
    b.component_commands(&obs);
    assert_eq!(b.brain.status, GoalStatus::Done);
    sim.step();
    b.component_commands(&rh_sim::observe(&sim, PlayerId(1), &[]));
    assert!(matches!(b.brain.goal, Goal::Roam { .. }));
}

#[test]
fn raw_or_unavailable_owner_inputs_refuse_before_any_memory_brain_or_rng_advance() {
    let sim = scene(true);
    let start = MatchStart::of(&sim, PlayerId(1), 7);
    let mut b = bot(&start);
    let before = (
        b.memory.clone(),
        b.brain.clone(),
        b.decide.clone(),
        b.motor.clone(),
        b.lapse.clone(),
    );
    let obs = rh_sim::observe(&sim, PlayerId(1), &[]);
    assert_eq!(
        b.check_input(crate::InputPreview::NativeCompatibility(&obs)),
        Err(crate::InputRefusal::RequiresDelivered14)
    );
    assert!(
        b.decide(&obs).is_empty(),
        "legacy raw callback is not a live data shortcut"
    );
    for inventory_missing in [false, true] {
        let mut unavailable = obs.clone();
        let expected = if inventory_missing {
            unavailable.inventory = None;
            crate::InputRefusal::InventoryUnavailable
        } else {
            unavailable.owner_combat = None;
            crate::InputRefusal::OwnerCombatUnavailable
        };
        let frame = crate::delivery::test_support::frame(&unavailable);
        assert_eq!(
            b.check_input(crate::InputPreview::Delivered14(&frame)),
            Err(expected)
        );
        assert_eq!(
            (
                b.memory.clone(),
                b.brain.clone(),
                b.decide.clone(),
                b.motor.clone(),
                b.lapse.clone()
            ),
            before
        );
    }
}

#[test]
fn delivered_perception_keeps_source_absolute_ready_redacted_held_and_targetability_without_immunity(
) {
    let sim = scene(true);
    let mut obs = rh_sim::observe(&sim, PlayerId(1), &[]);
    let group = obs.owner_combat.as_mut().unwrap();
    group.lock = rh_sim::OwnerLockView::Held { target: None };
    group.ready_at = 4_294_967_200;
    group.draw_started_at = 4_294_967_190;
    group.as_milli = 1e303;
    obs.me.as_mut().unwrap().ready_in_ms = 0.;
    obs.visible[0].effects |= 128;
    let frame = crate::delivery::test_support::frame(&obs);
    assert!(matches!(
        frame.owner_immunity_until(),
        crate::bots::delivered::Fact::Unavailable
    ));
    let actor = frame.actors().next().unwrap();
    assert!(!actor.targetable());
    assert!(matches!(
        actor.immunity_until(),
        crate::bots::delivered::Fact::Unavailable
    ));
    let out = Perception::default().build(&frame, 1.).unwrap();
    assert_eq!(out.percept.self_view.ready_at, 4_294_967_200.);
    assert_ne!(out.percept.self_view.ready_at, frame.source_time());
    assert_eq!(
        out.percept.self_view.owner_lock,
        Some(crate::bots::types::OwnerLock::Held { target: None })
    );
    assert!(out.percept.self_view.attack_target.is_none());
    assert!(!out.percept.fighters[0].targetable);
    obs.owner_combat.as_mut().unwrap().lock = rh_sim::OwnerLockView::Clear;
    let cleared = crate::delivery::test_support::frame(&obs);
    let clear = Perception::default().build(&cleared, 1.).unwrap();
    assert_ne!(
        clear.percept.self_view.owner_lock,
        out.percept.self_view.owner_lock
    );
    assert_eq!(
        clear.percept.self_view.attack_target,
        out.percept.self_view.attack_target
    );
}

#[test]
fn an_entitled_noncombat_lock_keeps_its_reference_without_creating_a_target_candidate() {
    let sim = scene(true);
    let mut obs = rh_sim::observe(&sim, PlayerId(1), &[]);
    let alias = PlayerId(1 << 31);
    obs.visible[0].id = alias;
    obs.visible[0].kind = rh_sim::observe::ActorKind::Dummy;
    obs.owner_combat.as_mut().unwrap().lock = rh_sim::OwnerLockView::Held {
        target: Some(alias),
    };
    let frame = crate::delivery::test_support::frame(&obs);
    let view = Perception::default().build(&frame, 1.).unwrap();
    assert_eq!(
        view.percept.self_view.owner_lock,
        Some(crate::bots::types::OwnerLock::Held {
            target: Some(format!("n{}", alias.0))
        })
    );
    assert!(
        view.ids.is_empty() && view.percept.fighters.is_empty() && view.percept.mobs.is_empty()
    );
}

#[test]
fn a_cleared_owner_from_another_viewer_is_not_this_bots_owner_loss() {
    let sim = scene(false);
    let start = MatchStart::of(&sim, PlayerId(1), 7);
    let b = bot(&start);
    let obs = rh_sim::observe(&sim, PlayerId(1), &[]);
    let frame = crate::delivery::test_support::frame(&obs);
    let message = || rh_protocol::ServerMsg::Snapshot {
        tick: frame.tick(),
        server_time: frame.source_time(),
        phase: frame.phase(),
        ack_input: 0,
        me: None,
        owner_combat: None,
        actors: vec![],
        training: frame.training(),
    };
    let mut context = frame.context();
    context.viewer = PlayerRef::new(2).unwrap();
    let foreign = crate::delivery::Frame14::from_reconstructed(
        context,
        message(),
        frame.collections().clone(),
        vec![],
        vec![],
    )
    .unwrap();
    assert_eq!(
        b.check_input(crate::InputPreview::Delivered14(&foreign)),
        Err(crate::InputRefusal::InvalidOwner)
    );
    let own = crate::delivery::Frame14::from_reconstructed(
        frame.context(),
        message(),
        frame.collections().clone(),
        vec![],
        vec![],
    )
    .unwrap();
    assert_eq!(
        b.check_input(crate::InputPreview::Delivered14(&own)),
        Ok(())
    );
}
