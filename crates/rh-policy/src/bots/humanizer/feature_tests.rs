//! Focused native tests for the hand's optional source feature gate: `humanizer.ts` `HumanizerConfig.features` and
//! `COMMAND_TYPE`, the B0 compatibility seam of `docs/coordination/BOT_BRAIN_COMPLETION.md`.
//!
//! These are semantic controls written from the unchanged source, not a captured-answer comparison: no expected output
//! is generated from a native answer here. The sealed direct-hand source supplement (six profiles / twelve real calls)
//! is compared in the `source` child module; the old absent-features hand overlap stays the admitted
//! `bot_core_humanizer_matches_source` fixture test (unchanged).

use super::{Context, Humanizer, HumanizerStats, Pending};
use crate::bots::clicks::BotMap;
use crate::bots::random::Rng;
use crate::bots::types::{
    BotWeapon, ChooseMsg, ClickMiss, CommandType, HudView, Intent, IntentBody, IntentChannel,
    IntentTiming, Percept, PlanMsg, RewardChestView, SelfView, TierId, TierParams, TimedCommand,
    COMMAND_TYPES,
};
use crate::bots::view::Features;
use rh_sim::Vec2;

/// The source fixture clock (`humanizer.test.ts` T0).
const T0: f64 = 100_000.;
/// The bot stands at the centre of a plain 64x64-tile map (2048x2048 u).
const ME_X: f64 = 1024.;
const ME_Y: f64 = 1024.;
/// The branch's core client message set (`test/bots/fixtures.ts` CORE_MESSAGES): it lists no cast/plan/choose.
const CORE_MESSAGES: [&str; 8] = [
    "move", "stop", "target", "aim", "attack", "release", "swap", "pickup",
];

// ---------------------------------------------------------------------------------------------------------------- inputs

fn tier() -> &'static TierParams {
    TierParams::by_id(TierId::Hard)
}

/// A plain all-walkable map; the scripted intents never depend on solidity.
fn open_map() -> BotMap {
    BotMap::new(64, 64, vec![0; 64 * 64])
}

/// An exact source feature set over the given message types; every other flag keeps its `detect_features` default.
fn features(message_types: &[&str]) -> Features {
    Features {
        message_types: message_types.iter().map(|t| t.to_string()).collect(),
        ..Features::default()
    }
}

/// The full hand command-type surface plus strings the hand never maps: source membership is arbitrary strings.
fn full_membership() -> Features {
    let mut message_types: Vec<&str> = COMMAND_TYPES.iter().map(|t| t.as_str()).collect();
    message_types.extend(["aim", "bogus"]);
    features(&message_types)
}

/// A live owner at the source fixture clock. An axe (non-wand) is in hand, so a lock conversion emits attack+release.
fn percept(now: f64) -> Percept {
    Percept {
        now,
        self_view: SelfView {
            id: "me".to_string(),
            x: ME_X,
            y: ME_Y,
            status: "alive".to_string(),
            hp: 100.,
            max_hp: 100.,
            weapons: [Some(BotWeapon::Axe), None],
            slot: 0,
            ready_at: 0.,
            ..SelfView::default()
        },
        hud: HudView {
            phase: "active".to_string(),
            ..HudView::default()
        },
        ..Percept::default()
    }
}

/// `percept` with the chest the scripted `choose` intent opens.
fn percept_with_chest(now: f64) -> Percept {
    let mut p = percept(now);
    p.extras.chests = Some(vec![RewardChestView {
        id: "chest".to_string(),
        x: ME_X + 150.,
        y: ME_Y,
        expires_at: 0.,
        options: Some(vec!["card-a".to_string()]),
    }]);
    p
}

fn intent(body: IntentBody) -> Intent {
    Intent {
        body,
        priority: 2,
        timing: IntentTiming::Step {},
        why: "test".to_string(),
    }
}

fn timed(body: IntentBody, due: f64) -> Intent {
    Intent {
        body,
        priority: 2,
        timing: IntentTiming::Timed { due },
        why: "test".to_string(),
    }
}

fn lock_intent(target: &str) -> Intent {
    intent(IntentBody::Lock {
        target: target.to_string(),
        at: Vec2::new(ME_X + 200., ME_Y),
    })
}

fn move_intent(to_x: f64) -> Intent {
    intent(IntentBody::Move {
        to: Vec2::new(to_x, ME_Y),
    })
}

fn stop_intent() -> Intent {
    intent(IntentBody::Stop {})
}

fn swap_intent(slot: u8) -> Intent {
    intent(IntentBody::Swap { slot })
}

fn cast_intent() -> Intent {
    intent(IntentBody::Cast {
        slot: "q".to_string(),
        x: ME_X + 100.,
        y: ME_Y,
        target: None,
        at: None,
        snap_radius: None,
    })
}

fn plan_intent() -> Intent {
    intent(IntentBody::Plan {
        msg: PlanMsg {
            spawn: Some(1),
            boon: None,
            ready: Some(true),
        },
    })
}

fn choose_intent() -> Intent {
    intent(IntentBody::Choose {
        msg: ChooseMsg {
            chest: "chest".to_string(),
            pick: 1,
            replace: None,
        },
    })
}

// ---------------------------------------------------------------------------------------------------------------- calls

fn submit(h: &mut Humanizer, intents: &[Intent], p: &Percept, motor: &mut Rng, lapse: &mut Rng) {
    let mut ctx = Context {
        p,
        engaged: false,
        motor,
        lapse,
    };
    h.submit(intents, &mut ctx);
}

fn release(h: &mut Humanizer, p: &Percept, motor: &mut Rng, lapse: &mut Rng) -> Vec<TimedCommand> {
    let mut ctx = Context {
        p,
        engaged: false,
        motor,
        lapse,
    };
    h.release(&mut ctx)
}

fn command_types(commands: &[TimedCommand]) -> Vec<CommandType> {
    commands.iter().map(|c| c.cmd.command_type()).collect()
}

/// A comparable snapshot of the private pending slots (the state a rejected offer must not touch).
type PendingRow = (Intent, u8, f64, String, f64, bool);

fn pending_rows(h: &Humanizer) -> Vec<Option<PendingRow>> {
    h.pending
        .iter()
        .map(|q| {
            q.as_ref().map(|q| {
                (
                    q.intent.clone(),
                    q.priority,
                    q.submitted_at,
                    q.key.clone(),
                    q.due,
                    q.independent,
                )
            })
        })
        .collect()
}

fn pending_order(h: &Humanizer) -> Option<&Pending> {
    h.pending[Humanizer::idx(IntentChannel::Order)].as_ref()
}

/// The hand as `new`/absent features builds it: no pending, clock, stats, miss or bucket state.
fn assert_hand_untouched(h: &Humanizer, tier: &TierParams) {
    assert_eq!(h.stats(), &HumanizerStats::default());
    assert!(h.pending.iter().all(Option::is_none));
    assert!(h.decision_due.is_empty());
    assert!(h.last_lock.is_none());
    assert!(h.last_react.is_none());
    assert!(h.last_sent.iter().all(Option::is_none));
    assert!(h.sent_times.is_empty());
    assert!(h.misses.is_empty());
    assert_eq!(h.tokens, tier.burst);
    assert_eq!(h.tokens_at, 0.);
    assert_eq!(h.last_send_at, f64::NEG_INFINITY);
}

/// One admitted hand frame: submit `intents` at the percept time, release 4 s later.
type FrameRun = (
    Vec<Vec<TimedCommand>>,
    Vec<Vec<ClickMiss>>,
    HumanizerStats,
    Rng,
    Rng,
);

fn old_hand_scenario(h: &mut Humanizer) -> FrameRun {
    let mut motor = Rng::new(11);
    let mut lapse = Rng::new(12);
    let mut released = Vec::new();
    let mut misses = Vec::new();
    let frames = [
        (percept(T0), vec![move_intent(ME_X + 100.)]),
        (percept(T0 + 10_000.), vec![lock_intent("foe")]),
        (percept(T0 + 20_000.), vec![stop_intent()]),
        (percept(T0 + 30_000.), vec![swap_intent(1)]),
        (percept(T0 + 40_000.), vec![cast_intent()]),
        (percept(T0 + 50_000.), vec![plan_intent()]),
        (percept_with_chest(T0 + 60_000.), vec![choose_intent()]),
    ];
    for (mut p, intents) in frames {
        submit(h, &intents, &p, &mut motor, &mut lapse);
        p.now += 4_000.;
        released.push(release(h, &p, &mut motor, &mut lapse));
        misses.push(h.drain_misses());
    }
    (released, misses, h.stats().clone(), motor, lapse)
}

// --------------------------------------------------------------------------------------------------------------- tests

/// Source: `features?` is optional; absent features retains the old hand exactly. A present full server membership
/// (the whole admitted command surface plus strings the hand never maps) is the same hand on that surface.
#[test]
fn absent_features_and_present_full_membership_keep_the_old_hand() {
    let tier = tier();
    let mut absent = Humanizer::new(tier, open_map());
    let mut full = Humanizer::with_features(tier, open_map(), &full_membership());

    let absent_run = old_hand_scenario(&mut absent);
    let full_run = old_hand_scenario(&mut full);
    assert_eq!(absent_run, full_run);

    // Sanity: the scripted frames really released the admitted command surface; the equality above is not vacuous.
    let types: Vec<CommandType> = absent_run
        .0
        .iter()
        .flat_map(|commands| commands.iter())
        .map(|c| c.cmd.command_type())
        .collect();
    assert_eq!(
        types,
        vec![
            CommandType::Move,
            CommandType::Attack,
            CommandType::Release,
            CommandType::Stop,
            CommandType::Swap,
            CommandType::Cast,
            CommandType::Plan,
            CommandType::Choose,
        ]
    );
    assert_ne!(absent_run.2, HumanizerStats::default());
}

/// Source: with a present but empty `messageTypes`, every offer is dropped at the start of offer, before
/// alreadyLocked/pending/repeat, the decision clock and every RNG draw. Nothing about the hand or either stream moves.
/// This is the semantic control for moving the check after the draw/state work: any placement after a decision-due
/// draw, a pending/supersede update, a spend or a miss changes one of the asserted values.
#[test]
fn empty_membership_rejects_every_offer_before_any_hand_state_or_draw() {
    let tier = tier();
    let mut h = Humanizer::with_features(tier, open_map(), &features(&[]));
    let mut motor = Rng::new(21);
    let mut lapse = Rng::new(22);
    let motor_before = motor.clone();
    let lapse_before = lapse.clone();
    let p = percept(T0);

    let offers = [
        lock_intent("foe"),
        move_intent(ME_X + 100.),
        stop_intent(),
        swap_intent(1),
        cast_intent(),
        plan_intent(),
        choose_intent(),
    ];
    submit(&mut h, &offers, &p, &mut motor, &mut lapse);
    assert_hand_untouched(&h, tier);
    assert_eq!(motor, motor_before);
    assert_eq!(lapse, lapse_before);

    // A later release has nothing pending and must stay equally inert.
    let mut later = p.clone();
    later.now = T0 + 10_000.;
    assert!(release(&mut h, &later, &mut motor, &mut lapse).is_empty());
    assert_hand_untouched(&h, tier);
    assert_eq!(motor, motor_before);
    assert_eq!(lapse, lapse_before);
    assert!(h.drain_misses().is_empty());
}

/// Source: the gate is by the intent's mapped `COMMAND_TYPE`. A lock maps to "target" even though a non-wand lock
/// conversion later emits an attack; membership is not inferred from the converted command.
#[test]
fn lock_is_gated_by_its_mapped_target_type_not_the_attack_conversion() {
    let tier = tier();
    let p = percept(T0);

    // "target" listed: the lock offer passes; the axe hand converts it into a physical attack plus its release.
    let mut target_only = Humanizer::with_features(tier, open_map(), &features(&["target"]));
    let mut motor = Rng::new(31);
    let mut lapse = Rng::new(32);
    submit(
        &mut target_only,
        &[lock_intent("foe")],
        &p,
        &mut motor,
        &mut lapse,
    );
    let mut later = p.clone();
    later.now = T0 + 4_000.;
    let released = release(&mut target_only, &later, &mut motor, &mut lapse);
    assert_eq!(
        command_types(&released),
        vec![CommandType::Attack, CommandType::Release]
    );
    assert_eq!(target_only.stats().target_clicks, 1);

    // "attack" listed but "target" absent: the same lock is dropped. A gate keyed on the later conversion would accept
    // it, so this is the target-versus-attack semantic control.
    let mut attack_only = Humanizer::with_features(tier, open_map(), &features(&["attack"]));
    let mut motor = Rng::new(33);
    let mut lapse = Rng::new(34);
    let motor_before = motor.clone();
    let lapse_before = lapse.clone();
    submit(
        &mut attack_only,
        &[lock_intent("foe")],
        &p,
        &mut motor,
        &mut lapse,
    );
    assert!(pending_rows(&attack_only).iter().all(Option::is_none));
    assert_eq!(attack_only.stats(), &HumanizerStats::default());
    assert_eq!(motor, motor_before);
    assert_eq!(lapse, lapse_before);
    let mut later = p.clone();
    later.now = T0 + 4_000.;
    assert!(release(&mut attack_only, &later, &mut motor, &mut lapse).is_empty());
    assert_eq!(attack_only.stats(), &HumanizerStats::default());
}

/// Source: partial membership is exact arbitrary-string membership of the intent's mapped command type (the source
/// test's core client set drops a cast while keeping a swap). Unknown/case-mismatched strings enable nothing.
#[test]
fn partial_membership_accepts_only_listed_command_types_and_preserves_arbitrary_strings() {
    let tier = tier();
    let p = percept(T0);
    let mut h = Humanizer::with_features(tier, open_map(), &features(&CORE_MESSAGES));
    let mut motor = Rng::new(41);
    let mut lapse = Rng::new(42);
    submit(
        &mut h,
        &[cast_intent(), swap_intent(1)],
        &p,
        &mut motor,
        &mut lapse,
    );
    let mut later = p.clone();
    later.now = T0 + 4_000.;
    let released = release(&mut h, &later, &mut motor, &mut lapse);
    assert_eq!(command_types(&released), vec![CommandType::Swap]);
    assert_eq!(h.stats().command(CommandType::Swap), 1);
    assert_eq!(h.stats().command(CommandType::Cast), 0);

    // Extending the exact set with "cast" admits the same cast offer.
    let extended: Vec<&str> = CORE_MESSAGES.iter().copied().chain(["cast"]).collect();
    let mut extended_h = Humanizer::with_features(tier, open_map(), &features(&extended));
    let mut motor = Rng::new(43);
    let mut lapse = Rng::new(44);
    submit(
        &mut extended_h,
        &[cast_intent()],
        &p,
        &mut motor,
        &mut lapse,
    );
    let mut later = p.clone();
    later.now = T0 + 4_000.;
    let released = release(&mut extended_h, &later, &mut motor, &mut lapse);
    assert_eq!(command_types(&released), vec![CommandType::Cast]);

    // Membership is not parsed or normalized: "Cast" (capital) and "bogus" list no cast command type.
    let mut strings =
        Humanizer::with_features(tier, open_map(), &features(&["swap", "Cast", "bogus", ""]));
    let mut motor = Rng::new(45);
    let mut lapse = Rng::new(46);
    submit(
        &mut strings,
        &[cast_intent(), swap_intent(1)],
        &p,
        &mut motor,
        &mut lapse,
    );
    let mut later = p.clone();
    later.now = T0 + 4_000.;
    let released = release(&mut strings, &later, &mut motor, &mut lapse);
    assert_eq!(command_types(&released), vec![CommandType::Swap]);
}

/// The gate runs before the decision clock and RNG: offering a rejected cast beside a supported swap must leave the
/// same pending state, stats and stream position as offering the swap alone. This is the no-draw/state semantic control
/// for moving the feature check after `new_decision_due`/offer bookkeeping.
#[test]
fn rejected_offers_do_not_draw_or_touch_hand_state() {
    let tier = tier();
    let p = percept(T0);
    let mut gated = Humanizer::with_features(tier, open_map(), &features(&["swap"]));
    let mut control = Humanizer::with_features(tier, open_map(), &features(&["swap"]));
    let mut gated_motor = Rng::new(51);
    let mut gated_lapse = Rng::new(52);
    let mut control_motor = Rng::new(51);
    let mut control_lapse = Rng::new(52);

    let mixed = [
        lock_intent("foe"),
        move_intent(ME_X + 100.),
        stop_intent(),
        cast_intent(),
        plan_intent(),
        choose_intent(),
        swap_intent(1),
    ];
    submit(&mut gated, &mixed, &p, &mut gated_motor, &mut gated_lapse);
    submit(
        &mut control,
        &[swap_intent(1)],
        &p,
        &mut control_motor,
        &mut control_lapse,
    );
    assert_eq!(gated.stats(), control.stats());
    assert_eq!(pending_rows(&gated), pending_rows(&control));
    assert_eq!(gated.decision_due, control.decision_due);
    assert_eq!(gated_motor, control_motor);
    assert_eq!(gated_lapse, control_lapse);

    let mut later = p.clone();
    later.now = T0 + 4_000.;
    let gated_released = release(&mut gated, &later, &mut gated_motor, &mut gated_lapse);
    let control_released = release(&mut control, &later, &mut control_motor, &mut control_lapse);
    assert_eq!(gated_released, control_released);
    assert_eq!(command_types(&gated_released), vec![CommandType::Swap]);
    assert_eq!(gated.stats(), control.stats());
    assert_eq!(gated_motor, control_motor);
    assert_eq!(gated_lapse, control_lapse);
}

/// The check is the first statement of offer: an unsupported intent offered while earlier accepted work is pending is
/// dropped without replacing, downgrading, clearing, superseding or re-timing that pending intent (the tested stop is a
/// same-order-channel replacement candidate), and that earlier work still goes out later.
#[test]
fn rejected_offer_preserves_earlier_accepted_pending_work() {
    let tier = tier();
    let mut h = Humanizer::with_features(tier, open_map(), &features(&["move"]));
    let mut motor = Rng::new(61);
    let mut lapse = Rng::new(62);
    let p = percept(T0);

    submit(
        &mut h,
        &[timed(
            IntentBody::Move {
                to: Vec2::new(ME_X + 100., ME_Y),
            },
            T0 + 5_000.,
        )],
        &p,
        &mut motor,
        &mut lapse,
    );
    assert!(pending_order(&h).is_some());
    let accepted_rows = pending_rows(&h);
    let accepted_due = h.decision_due.clone();
    let accepted_stats = h.stats().clone();
    let motor_before = motor.clone();
    let lapse_before = lapse.clone();

    // "stop" maps to "stop", which is not listed; it shares the stopped move's order channel, so a check placed after
    // the pending/repeat arbitration (or after the decision due) would rewrite or draw here.
    let mut later = p.clone();
    later.now = T0 + 10.;
    submit(&mut h, &[stop_intent()], &later, &mut motor, &mut lapse);
    assert_eq!(pending_rows(&h), accepted_rows);
    assert_eq!(h.decision_due, accepted_due);
    assert_eq!(h.stats(), &accepted_stats);
    assert!(h.last_lock.is_none());
    assert_eq!(motor, motor_before);
    assert_eq!(lapse, lapse_before);

    // The earlier accepted move still becomes exactly one click, and the rejected offer added no throttle/supersede.
    let mut release_at = p.clone();
    release_at.now = T0 + 10_000.;
    let released = release(&mut h, &release_at, &mut motor, &mut lapse);
    assert_eq!(command_types(&released), vec![CommandType::Move]);
    assert_eq!(h.stats().command(CommandType::Move), 1);
    assert_eq!(h.stats().superseded, 0);
    assert_eq!(h.stats().throttled, 0);
}

/// Native intake/comparison for the sealed direct hand source supplement (6 profiles / 12 real source calls). The
/// helper lives directly beneath this new test directory; the source corpus stays read-only.
#[path = "source.rs"]
mod source;
