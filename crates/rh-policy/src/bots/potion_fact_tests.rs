//! P-BOT-POTION-FACT-1: accepted-owner potion-healing predicate proof (test only).
//!
//! The admitted source Brain runner consumes an owner healing boolean from the synced HUD timer
//! `healingUntil` (`packages/server/src/bots/brain/runner.ts:29-35`: `(me.healingUntil ?? 0) <= now`
//! gates a potion use). This module proves that the existing native producer's accepted owner
//! inventory `potions_healing > 0` represents the boolean `healingUntil > now` in the validated
//! non-Ended domain at exactly the accepted frame's `source_time`.
//!
//! The proof drives genuine native trajectories only: a declared starting fixture is accepted by
//! `Sim::restore` (stock and hp are declared, not earned gameplay), then every potion use, HOT,
//! overlap, expiry, down/leave cleanup and run end is produced by `validate` + `Sim::submit` and
//! ordinary `Sim::step` ticks. The owner is observed through a real `ItemObserver` preparation and
//! an actual `DeliverySession` prepare/commit; only the resultant opaque `AcceptedFrame14` is read.
//! Trusted serialized `healing_until`/HOT mirrors from the authoritative checkpoint are used in
//! assertions only, never as bot input or as a published frame fact. Missing inventory is kept
//! unavailable (never converted to `false`), and Ended frames are explicitly outside the domain:
//! the checkpoint validator deliberately permits retained HOT deadlines at or before `server_time`
//! once a run has ended, while live producers no longer update them.
//!
//! Deliberately not claimed: anything about a future runner implementation, adapter queue
//! acceptance versus later simulation refusal, a potion retry clock, absolute-deadline
//! reconstruction from the boolean, or public/wire activation. No production file, dependency,
//! protocol, fixture or shared status is touched by this module.

use crate::bots::delivered::Fact;
use crate::delivery::{AcceptedFrame14, DeliverySession, Frame14};
use rh_sim::constants::TICK_MS;
use rh_sim::potions::DEFINITION;
use rh_sim::{
    arenas::practice_arena, validate, Event, FactionId, ItemObserver, Observation, Phase,
    Placement, PlayerId, PublicCommand, RawCommand, Secrets, Sim, SimConfig, Vec2, WeaponId,
};
use serde_json::{json, Value};

const OWNER: PlayerId = PlayerId(1);

/// The source predicate input: healing is in progress exactly when the owner deadline is in the
/// future at the accepted source clock.
fn healing_in_progress(healing_until: f64, source_time: f64) -> bool {
    healing_until > source_time
}

fn placement(profile: &str, at: Vec2, hp: Option<f64>, weapon0: Option<WeaponId>) -> Placement {
    Placement {
        profile: profile.into(),
        faction: FactionId::Holy,
        bot: false,
        at,
        hp,
        weapon0,
        weapon1: None,
    }
}

/// An explicit accepted starting fixture: `Sim::reset_active` builds a real active run, the
/// checkpoint is serialized and its declared stock is set, and `Sim::restore` must accept it.
/// Declaring stock/hp is setup only; it is not an earned gameplay claim, and every potion use,
/// HOT, expiry, down and run end below is produced by the ordinary native paths.
fn baseline(placements: &[Placement], stock: u8, pvp_rules: bool) -> Sim {
    let setup = Sim::reset_active(
        SimConfig {
            consumables: true,
            pvp_rules,
            ..SimConfig::default()
        },
        practice_arena(),
        Secrets::from_seed(11),
        placements,
    );
    let mut checkpoint = serde_json::to_value(&setup).expect("baseline checkpoint serialization");
    checkpoint["world"]["players"][0]["potion_small"] = json!(stock);
    let restored =
        Sim::restore(checkpoint).expect("declared baseline checkpoint accepted by Sim::restore");
    assert_eq!(restored.tick(), setup.tick());
    assert_eq!(restored.phase(), Phase::Active);
    assert_f64_bits_eq(
        restored.server_time(),
        setup.server_time(),
        "baseline clock",
    );
    restored
}

/// The owner's actual accepted observation/delivery seat: real `ItemObserver` preparation plus a
/// real `DeliverySession` prepare/commit. The simulation is advanced only by `Sim::step` and
/// mutated only by validated command submission and the ordinary lifecycle API.
struct Seat {
    sim: Sim,
    observer: ItemObserver,
    session: DeliverySession,
    pending: Vec<Event>,
}

impl Seat {
    fn new(sim: Sim) -> Self {
        Self {
            sim,
            observer: ItemObserver::new(OWNER),
            session: DeliverySession::new(OWNER),
            pending: Vec::new(),
        }
    }

    fn accept(&mut self) -> AcceptedFrame14 {
        let mut observation = Observation::default();
        let offer = self
            .observer
            .prepare_into(&self.sim, &self.pending, &mut observation, None)
            .expect("actual owner ItemObserver preparation");
        let staged = self
            .session
            .prepare(
                &observation,
                offer.props_changed(),
                offer.rewards_changed(),
                &[],
            )
            .expect("actual checked delivery preparation");
        offer.commit();
        self.pending.clear();
        self.session.commit(staged)
    }

    fn step_quiet(&mut self) {
        self.pending.extend(self.sim.step());
    }

    fn step(&mut self) -> AcceptedFrame14 {
        self.step_quiet();
        self.accept()
    }

    fn submit_owner_use(&mut self) {
        let command = self
            .observer
            .resolve(&self.sim, PublicCommand::UseConsumable)
            .expect("public use-consumable command resolves");
        self.sim
            .submit(OWNER, command)
            .expect("real use-consumable submission accepted");
    }

    fn submit(&mut self, id: PlayerId, raw: RawCommand) {
        self.sim
            .submit(id, validate(raw).expect("validated native command"))
            .expect("real command submission accepted");
    }
}

fn step_until(seat: &mut Seat, source_time: f64) {
    while seat.sim.server_time() < source_time {
        seat.step_quiet();
    }
    assert_f64_bits_eq(
        seat.sim.server_time(),
        source_time,
        "exact accepted sample clock",
    );
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct TrustedHot {
    next: f64,
    left: u8,
}

#[derive(Clone, Debug)]
struct TrustedOwner {
    potion_small: u8,
    healing_until: f64,
    potions_healing: u8,
    status: String,
}

#[derive(Clone, Debug)]
struct TrustedSample {
    tick: u32,
    server_time: f64,
    phase: String,
    owner: Option<TrustedOwner>,
    hots: Vec<TrustedHot>,
}

/// The authoritative checkpoint's serialized mirror, read only to compare the accepted frame's
/// derived fact with the producer state at the same sample.
fn trusted(sim: &Sim) -> TrustedSample {
    let value: Value =
        serde_json::to_value(sim).expect("authoritative checkpoint serialization for assertions");
    let world = &value["world"];
    let tick = u32::try_from(
        world["tick"]
            .as_u64()
            .expect("serialized world tick is an integer"),
    )
    .expect("serialized tick fits u32");
    let server_time = world["server_time"]
        .as_f64()
        .expect("serialized world clock is a number");
    let phase = world["phase"]
        .as_str()
        .expect("serialized phase is a string")
        .to_string();
    let players = world["players"]
        .as_array()
        .expect("serialized players are a sequence");
    let owner = players
        .iter()
        .find(|player| player["core"]["id"].as_u64() == Some(u64::from(OWNER.0)))
        .map(|player| TrustedOwner {
            potion_small: u8::try_from(
                player["potion_small"]
                    .as_u64()
                    .expect("serialized potion stock"),
            )
            .expect("serialized potion stock fits u8"),
            healing_until: player["healing_until"]
                .as_f64()
                .expect("serialized healing deadline"),
            potions_healing: u8::try_from(
                player["potions_healing"]
                    .as_u64()
                    .expect("serialized HOT count mirror"),
            )
            .expect("serialized HOT count mirror fits u8"),
            status: player["status"]
                .as_str()
                .expect("serialized status is a string")
                .to_string(),
        });
    let hots = world["potion_healing"]
        .as_array()
        .expect("serialized potion healing rows are a sequence")
        .iter()
        .filter(|row| row["id"].as_u64() == Some(u64::from(OWNER.0)))
        .flat_map(|row| {
            row["hots"]
                .as_array()
                .expect("serialized HOT rows are a sequence")
                .iter()
                .map(|hot| TrustedHot {
                    next: hot["next"].as_f64().expect("serialized HOT next"),
                    left: u8::try_from(hot["left"].as_u64().expect("serialized HOT left"))
                        .expect("serialized HOT left fits u8"),
                })
        })
        .collect();
    TrustedSample {
        tick,
        server_time,
        phase,
        owner,
        hots,
    }
}

/// The accepted frame's owner inventory fact. `Unavailable` and a missing (`None`) inventory are
/// preserved as unavailable: they are never coerced to `0`, i.e. to "not healing".
fn accepted_owner_healing_count(frame: &Frame14) -> Result<u8, &'static str> {
    match frame.inventory() {
        Fact::Unavailable => Err("inventory unavailable"),
        Fact::Delivered(None) => Err("inventory missing"),
        Fact::Delivered(Some(inventory)) => Ok(inventory.potions_healing),
    }
}

fn phase_name(code: u8) -> &'static str {
    match code {
        0 => "Lobby",
        1 => "Active",
        2 => "Ended",
        _ => "Planning",
    }
}

/// Compare one accepted frame with the trusted mirror of the exact same sample. `Ok` carries the
/// derived source predicate (`potions_healing > 0`); `Err` is returned for an out-of-contract
/// domain (Ended, missing/unavailable inventory) or any mismatch. The comparator never returns an
/// expected answer used by gameplay: it only checks already-captured facts.
fn check_healing_fact(frame: &Frame14, sample: &TrustedSample) -> Result<bool, String> {
    if frame.phase() == 2 {
        return Err(
            "Ended frame: outside the validated non-Ended derived-predicate contract".into(),
        );
    }
    if frame.tick() != sample.tick {
        return Err(format!(
            "wrong sample pairing: frame tick {} vs trusted tick {}",
            frame.tick(),
            sample.tick
        ));
    }
    if frame.source_time().to_bits() != sample.server_time.to_bits() {
        return Err(format!(
            "wrong sample pairing: frame source_time {} vs trusted server_time {}",
            frame.source_time(),
            sample.server_time
        ));
    }
    if phase_name(frame.phase()) != sample.phase {
        return Err(format!(
            "phase mismatch: frame {} vs trusted {}",
            phase_name(frame.phase()),
            sample.phase
        ));
    }
    let count = usize::from(accepted_owner_healing_count(frame)?);
    let owner = sample
        .owner
        .as_ref()
        .ok_or("trusted owner row missing for an available inventory fact")?;
    if usize::from(owner.potions_healing) != count {
        return Err(format!(
            "wrong count: accepted inventory {} vs trusted mirror {}",
            count, owner.potions_healing
        ));
    }
    if count != sample.hots.len() {
        return Err(format!(
            "wrong count: accepted inventory {} vs trusted HOT rows {}",
            count,
            sample.hots.len()
        ));
    }
    let derived = count > 0;
    let source_predicate = healing_in_progress(owner.healing_until, frame.source_time());
    if derived != source_predicate {
        return Err(format!(
            "derived predicate mismatch at source_time {}: potions_healing > 0 = {derived}, \
             healing_until ({}) > now = {source_predicate}",
            frame.source_time(),
            owner.healing_until
        ));
    }
    match sample.hots.last() {
        None => {
            if owner.healing_until != 0.0 || owner.potions_healing != 0 {
                return Err(format!(
                    "no HOT rows but mirrors are set: count {}, deadline {}",
                    owner.potions_healing, owner.healing_until
                ));
            }
        }
        Some(last) => {
            if last.left == 0 {
                return Err("trusted HOT row has zero remaining ticks".into());
            }
            let deadline = last.next + f64::from(last.left - 1) * DEFINITION.step_ms;
            if owner.healing_until.to_bits() != deadline.to_bits() {
                return Err(format!(
                    "wrong admitted deadline: mirror {} vs last.next+(left-1)*step {}",
                    owner.healing_until, deadline
                ));
            }
            if sample
                .hots
                .iter()
                .any(|hot| hot.next <= frame.source_time())
            {
                return Err(format!(
                    "non-Ended HOT row is not after the accepted source_time {}",
                    frame.source_time()
                ));
            }
        }
    }
    Ok(derived)
}

fn check(seat: &Seat, frame: &AcceptedFrame14, label: &str) -> (TrustedSample, bool) {
    let sample = trusted(&seat.sim);
    match check_healing_fact(frame.frame(), &sample) {
        Ok(derived) => (sample, derived),
        Err(error) => panic!("{label}: {error}"),
    }
}

fn assert_f64_bits_eq(actual: f64, expected: f64, what: &str) {
    assert_eq!(
        actual.to_bits(),
        expected.to_bits(),
        "{what}: {actual} vs {expected}"
    );
}

fn owner_of(sample: &TrustedSample) -> &TrustedOwner {
    sample.owner.as_ref().expect("trusted owner row is present")
}

#[test]
fn accepted_use_overlap_final_expiry_and_mid_hot_restore_continuation() {
    let owner = placement("owner", Vec2::new(332.0, 320.0), Some(300.0), None);
    let other = placement("other", Vec2::new(900.0, 600.0), None, None);
    let mut seat = Seat::new(baseline(&[owner, other], 5, true));

    // 1. Fresh accepted owner: nothing is healing yet; the derived source predicate is false.
    let fresh = seat.accept();
    let (fresh_sample, fresh_derived) = check(&seat, &fresh, "fresh accepted owner");
    assert_eq!(fresh.frame().tick(), 1);
    assert_eq!(fresh_sample.phase, "Active");
    assert!(!fresh_derived);
    assert_eq!(owner_of(&fresh_sample).potion_small, 5);
    assert_eq!(owner_of(&fresh_sample).potions_healing, 0);
    assert_eq!(owner_of(&fresh_sample).healing_until, 0.0);

    // 2. Genuine first use through the public command door; the accepted frame turns true.
    seat.submit_owner_use();
    let use1 = seat.step();
    let (sample1, derived1) = check(&seat, &use1, "first accepted potion use");
    assert_eq!(use1.frame().tick(), 2);
    assert!(derived1);
    assert_eq!(accepted_owner_healing_count(use1.frame()), Ok(1));
    assert_eq!(owner_of(&sample1).potion_small, 4);
    assert_eq!(sample1.hots.len(), 1);
    let use1_at = use1.frame().source_time();
    assert_f64_bits_eq(
        owner_of(&sample1).healing_until,
        use1_at + DEFINITION.heal_ms,
        "first admitted deadline",
    );

    // Real second and third uses reach overlapping HOTs through normal acceptance. This does not
    // claim that the future source runner's no-heal gate would itself submit overlapping uses.
    seat.submit_owner_use();
    let use2 = seat.step();
    let (sample2, derived2) = check(&seat, &use2, "overlapping second use");
    assert_eq!(use2.frame().tick(), 3);
    assert!(derived2);
    assert_eq!(accepted_owner_healing_count(use2.frame()), Ok(2));
    assert_eq!(sample2.hots.len(), 2);
    let use2_at = use2.frame().source_time();
    assert_f64_bits_eq(
        owner_of(&sample2).healing_until,
        use2_at + DEFINITION.heal_ms,
        "second admitted deadline",
    );

    seat.submit_owner_use();
    let use3 = seat.step();
    let (sample3, derived3) = check(&seat, &use3, "overlapping third use");
    assert_eq!(use3.frame().tick(), 4);
    assert!(derived3);
    assert_eq!(accepted_owner_healing_count(use3.frame()), Ok(3));
    assert_eq!(sample3.hots.len(), 3);
    let use3_at = use3.frame().source_time();
    assert_f64_bits_eq(
        owner_of(&sample3).healing_until,
        use3_at + DEFINITION.heal_ms,
        "third admitted deadline",
    );
    for (index, hot) in sample3.hots.iter().enumerate() {
        let expiry = hot.next + f64::from(hot.left - 1) * DEFINITION.step_ms;
        assert_f64_bits_eq(
            expiry,
            [use1_at, use2_at, use3_at][index] + DEFINITION.heal_ms,
            "each overlapping HOT keeps its own admitted final expiry",
        );
    }
    assert_f64_bits_eq(
        owner_of(&sample3).healing_until,
        use3_at + DEFINITION.heal_ms,
        "the mirror deadline is the overlapping last HOT's final deadline",
    );

    // One actual mid-HOT accepted checkpoint: the checkpoint is serialized from the exact same
    // authoritative sample as the accepted frame, then has to pass `Sim::restore`, and the restored
    // run continues to the same absolute expiry clocks.
    let mid_at = use3_at + 6.0 * TICK_MS;
    step_until(&mut seat, mid_at);
    let mid = seat.accept();
    let (mid_sample, mid_derived) = check(&seat, &mid, "accepted mid-HOT sample");
    assert_eq!(mid.frame().tick(), 10);
    assert!(mid_derived);
    assert_eq!(accepted_owner_healing_count(mid.frame()), Ok(3));
    let mid_checkpoint = serde_json::to_value(&seat.sim).expect("mid-HOT checkpoint serialization");
    let restored =
        Sim::restore(mid_checkpoint).expect("mid-HOT checkpoint accepted by Sim::restore");
    assert_eq!(restored.tick(), mid.frame().tick());
    assert_eq!(restored.phase(), Phase::Active);
    assert_f64_bits_eq(
        restored.server_time(),
        mid.frame().source_time(),
        "restore keeps the accepted source clock",
    );
    let mut continuation = Seat::new(restored);
    let restored_mid = continuation.accept();
    let (restored_mid_sample, restored_mid_derived) = check(
        &continuation,
        &restored_mid,
        "restored mid-HOT continuation",
    );
    assert!(restored_mid_derived);
    assert_eq!(restored_mid.frame().tick(), mid.frame().tick());
    assert_f64_bits_eq(
        restored_mid.frame().source_time(),
        mid.frame().source_time(),
        "restored continuation samples the same source time",
    );
    assert_eq!(
        restored_mid.frame().inventory(),
        mid.frame().inventory(),
        "restored continuation keeps the accepted owner inventory fact"
    );
    assert_f64_bits_eq(
        owner_of(&restored_mid_sample).healing_until,
        owner_of(&mid_sample).healing_until,
        "restored continuation keeps the admitted HOT deadline",
    );

    // 3. Accepted samples at the first HOT's final expiry and at the overlapping last expiry.
    let first_end_at = use1_at + DEFINITION.heal_ms;
    step_until(&mut seat, first_end_at);
    let first_end = seat.accept();
    let (first_end_sample, first_end_derived) = check(&seat, &first_end, "first HOT final expiry");
    assert_eq!(first_end.frame().tick(), 102);
    assert!(
        first_end_derived,
        "later overlapping HOTs keep healing true when the first one ends"
    );
    assert_eq!(accepted_owner_healing_count(first_end.frame()), Ok(2));
    assert_eq!(sample3.hots.len(), 3);
    assert_f64_bits_eq(
        first_end.frame().source_time(),
        first_end_at,
        "first HOT final expiry sample",
    );
    assert_f64_bits_eq(
        owner_of(&first_end_sample).healing_until,
        use3_at + DEFINITION.heal_ms,
        "the last HOT still sets the mirror deadline",
    );

    let last_before_at = use2_at + DEFINITION.heal_ms;
    step_until(&mut seat, last_before_at);
    let second_end = seat.accept();
    let (second_end_sample, second_end_derived) =
        check(&seat, &second_end, "overlapping second HOT final expiry");
    assert_eq!(second_end.frame().tick(), 103);
    assert!(second_end_derived);
    assert_eq!(accepted_owner_healing_count(second_end.frame()), Ok(1));
    assert_f64_bits_eq(
        owner_of(&second_end_sample).healing_until,
        use3_at + DEFINITION.heal_ms,
        "only the last admitted HOT remains",
    );

    let last_end_at = use3_at + DEFINITION.heal_ms;
    step_until(&mut seat, last_end_at);
    let last_end = seat.accept();
    let (last_end_sample, last_end_derived) = check(&seat, &last_end, "last HOT final expiry");
    assert_eq!(last_end.frame().tick(), 104);
    assert!(
        !last_end_derived,
        "the last HOT expiring turns healing false"
    );
    assert_eq!(accepted_owner_healing_count(last_end.frame()), Ok(0));
    assert!(last_end_sample.hots.is_empty());
    assert_eq!(owner_of(&last_end_sample).potions_healing, 0);
    assert_eq!(owner_of(&last_end_sample).healing_until, 0.0);
    assert_f64_bits_eq(
        last_end.frame().source_time(),
        use3_at + DEFINITION.heal_ms,
        "exact last-HOT expiry sample",
    );

    // The restored continuation reaches the same absolute clocks and accepted facts.
    step_until(&mut continuation, first_end_at);
    let restored_first_end = continuation.accept();
    let (restored_first_end_sample, restored_first_end_derived) = check(
        &continuation,
        &restored_first_end,
        "restored first-HOT-expiry continuation",
    );
    assert!(restored_first_end_derived);
    assert_eq!(restored_first_end.frame().tick(), first_end.frame().tick());
    assert_eq!(
        restored_first_end.frame().inventory(),
        first_end.frame().inventory()
    );
    assert_f64_bits_eq(
        owner_of(&restored_first_end_sample).healing_until,
        owner_of(&first_end_sample).healing_until,
        "restored continuation keeps the surviving HOT deadline",
    );

    step_until(&mut continuation, last_before_at);
    let restored_second_end = continuation.accept();
    check(
        &continuation,
        &restored_second_end,
        "restored second-HOT-expiry continuation",
    );
    assert_eq!(
        restored_second_end.frame().inventory(),
        second_end.frame().inventory()
    );

    step_until(&mut continuation, last_end_at);
    let restored_last_end = continuation.accept();
    let (restored_last_end_sample, restored_last_end_derived) = check(
        &continuation,
        &restored_last_end,
        "restored final-expiry continuation",
    );
    assert!(!restored_last_end_derived);
    assert_eq!(
        restored_last_end.frame().inventory(),
        last_end.frame().inventory()
    );
    assert_eq!(
        accepted_owner_healing_count(restored_last_end.frame()),
        Ok(0)
    );
    assert_eq!(restored_last_end_sample.hots, last_end_sample.hots);
    assert_eq!(
        restored_last_end.frame().source_time().to_bits(),
        last_end.frame().source_time().to_bits(),
        "the restored continuation expires at the same accepted source_time"
    );
}

#[test]
fn real_non_ended_fighter_out_cleanup_clears_live_hot_mirrors_and_inventory() {
    let owner = placement("owner", Vec2::new(332.0, 320.0), Some(1.0), None);
    let attacker = placement(
        "attacker",
        Vec2::new(300.0, 320.0),
        None,
        Some(WeaponId::Sword),
    );
    let other = placement("other", Vec2::new(900.0, 600.0), None, None);
    let mut seat = Seat::new(baseline(&[owner, attacker, other], 1, false));

    seat.accept();
    seat.submit_owner_use();
    let healing = seat.step();
    let (healing_sample, healing_derived) = check(&seat, &healing, "healing before going out");
    assert_eq!(healing.frame().tick(), 2);
    assert!(healing_derived);
    assert_eq!(accepted_owner_healing_count(healing.frame()), Ok(1));
    let admitted_deadline = owner_of(&healing_sample).healing_until;
    assert!(admitted_deadline > healing.frame().source_time());

    // A real standing -> out transition: an adjacent seat's validated sword swing downs the owner.
    // The run is kept non-Ended (three started, two still stand), so this cleanup is distinct from
    // the explicit Ended exclusion below.
    seat.submit(PlayerId(2), RawCommand::Attack { a: 0.0, t: None });
    let out = seat.step();
    let (out_sample, out_derived) = check(&seat, &out, "non-Ended fighter-out cleanup");
    assert_eq!(out.frame().tick(), 3);
    assert!(!out_derived);
    assert_eq!(out.frame().phase(), 1, "the run is still Active, not Ended");
    assert_eq!(out_sample.phase, "Active");
    let gone = owner_of(&out_sample);
    assert_eq!(gone.status, "Dead");
    assert_eq!(accepted_owner_healing_count(out.frame()), Ok(0));
    assert_eq!(gone.potions_healing, 0);
    assert_eq!(gone.healing_until, 0.0);
    assert!(
        out_sample.hots.is_empty(),
        "the real fighterOut hook removed the live HOT row"
    );

    // The clear persists on the next accepted sample in the same non-Ended run.
    seat.step_quiet();
    let after = seat.accept();
    let (after_sample, after_derived) = check(&seat, &after, "post-cleanup sample");
    assert_eq!(after.frame().tick(), 4);
    assert!(!after_derived);
    assert_eq!(after.frame().phase(), 1);
    assert_eq!(after_sample.phase, "Active");
    assert_eq!(accepted_owner_healing_count(after.frame()), Ok(0));
    assert!(after_sample.hots.is_empty());
}

#[test]
fn ended_phase_elapses_the_hot_deadline_outside_the_predicate_contract_and_restores() {
    let owner = placement(
        "owner",
        Vec2::new(300.0, 320.0),
        Some(500.0),
        Some(WeaponId::Sword),
    );
    let victim = placement("victim", Vec2::new(332.0, 320.0), Some(1.0), None);
    let mut seat = Seat::new(baseline(&[owner, victim], 1, false));

    seat.accept();
    seat.submit_owner_use();
    let healing = seat.step();
    let (healing_sample, healing_derived) = check(&seat, &healing, "pre-end genuine HOT");
    assert_eq!(healing.frame().tick(), 2);
    assert!(healing_derived);
    let admitted_deadline = owner_of(&healing_sample).healing_until;
    assert!(admitted_deadline > healing.frame().source_time());

    // The owner's own validated swing ends the two-player run; the ended phase no longer runs the
    // HOT update system, so the already-admitted HOT row remains on the character.
    seat.submit(OWNER, RawCommand::Attack { a: 0.0, t: None });
    let ended = seat.step();
    assert_eq!(ended.frame().tick(), 3);
    assert_eq!(ended.frame().phase(), 2, "the accepted frame reports Ended");
    let ended_sample = trusted(&seat.sim);
    assert_eq!(ended_sample.phase, "Ended");
    assert_eq!(accepted_owner_healing_count(ended.frame()), Ok(1));
    assert_f64_bits_eq(
        owner_of(&ended_sample).healing_until,
        admitted_deadline,
        "Ended keeps the admitted deadline",
    );
    // Right after the end the equivalence still happens to hold; the contract still excludes Ended
    // explicitly, because the producer no longer advances the retained rows.
    assert!(admitted_deadline > ended.frame().source_time());
    let error = check_healing_fact(ended.frame(), &ended_sample)
        .expect_err("an Ended accepted frame is outside the derived-predicate contract");
    assert!(error.contains("Ended"), "unexpected refusal: {error}");

    // An ended child trajectory with an elapsed HOT deadline: the retained mirror is now in the
    // past while its count is still non-zero, which is exactly why the conversion must exclude Ended.
    step_until(&mut seat, admitted_deadline + TICK_MS);
    let elapsed = seat.accept();
    assert_eq!(elapsed.frame().tick(), 103);
    assert_eq!(elapsed.frame().phase(), 2);
    let elapsed_sample = trusted(&seat.sim);
    assert_eq!(accepted_owner_healing_count(elapsed.frame()), Ok(1));
    assert_eq!(owner_of(&elapsed_sample).potions_healing, 1);
    assert_f64_bits_eq(
        owner_of(&elapsed_sample).healing_until,
        admitted_deadline,
        "the retained Ended deadline is unchanged",
    );
    assert!(
        !healing_in_progress(
            owner_of(&elapsed_sample).healing_until,
            elapsed.frame().source_time()
        ),
        "the ended sample's retained deadline is already in the past"
    );
    let error = check_healing_fact(elapsed.frame(), &elapsed_sample)
        .expect_err("an elapsed Ended sample must remain outside the contract");
    assert!(error.contains("Ended"), "unexpected refusal: {error}");

    // The validator deliberately permits this genuine Ended checkpoint with elapsed HOTs; the
    // predicate work must not narrow restore admission to make its conversion easier.
    let ended_checkpoint = serde_json::to_value(&seat.sim).expect("Ended checkpoint serialization");
    let restored = Sim::restore(ended_checkpoint)
        .expect("genuine Ended checkpoint with an elapsed HOT still restores");
    assert_eq!(restored.phase(), Phase::Ended);
    assert_eq!(restored.tick(), elapsed.frame().tick());
    assert_f64_bits_eq(
        restored.server_time(),
        elapsed.frame().source_time(),
        "Ended restore keeps the source clock",
    );
    let restored_sample = trusted(&restored);
    assert_eq!(restored_sample.phase, "Ended");
    assert_eq!(accepted_owner_healing_count(elapsed.frame()), Ok(1));
    assert_eq!(restored_sample.hots.len(), 1);
    assert_f64_bits_eq(
        owner_of(&restored_sample).healing_until,
        admitted_deadline,
        "ended restore keeps the elapsed HOT mirror",
    );
}

#[test]
fn removed_owner_missing_inventory_stays_unavailable_and_mirrors_clear() {
    let owner = placement("owner", Vec2::new(332.0, 320.0), Some(300.0), None);
    let other_a = placement("other-a", Vec2::new(900.0, 600.0), None, None);
    let other_b = placement("other-b", Vec2::new(1000.0, 700.0), None, None);
    let mut seat = Seat::new(baseline(&[owner, other_a, other_b], 1, true));

    seat.accept();
    seat.submit_owner_use();
    let healing = seat.step();
    let (_, healing_derived) = check(&seat, &healing, "healing before departure");
    assert_eq!(healing.frame().tick(), 2);
    assert!(healing_derived);
    assert_eq!(accepted_owner_healing_count(healing.frame()), Ok(1));

    // A real permanent departure (active-run MIA) removes the owner from the match entirely; the
    // three-player run stays non-Ended. The accepted frame has no owner inventory row at all.
    seat.sim.remove_player(OWNER);
    seat.step_quiet();
    let missing = seat.accept();
    assert_eq!(missing.frame().tick(), 3);
    assert_eq!(missing.frame().phase(), 1, "run stays non-Ended");
    assert_eq!(
        missing.frame().inventory(),
        Fact::Delivered(None),
        "missing owner inventory is delivered as unavailable, not as an empty inventory"
    );
    assert_eq!(
        accepted_owner_healing_count(missing.frame()),
        Err("inventory missing")
    );
    let missing_sample = trusted(&seat.sim);
    assert!(missing_sample.owner.is_none());
    assert!(missing_sample.hots.is_empty());
    let error = check_healing_fact(missing.frame(), &missing_sample)
        .expect_err("missing inventory must be refused, not converted to false");
    assert!(error.contains("missing"), "unexpected refusal: {error}");
}

#[test]
fn comparator_controls_reject_wrong_count_deadline_and_sample_time_pairing() {
    let owner = placement("owner", Vec2::new(332.0, 320.0), Some(300.0), None);
    let other = placement("other", Vec2::new(900.0, 600.0), None, None);
    let mut seat = Seat::new(baseline(&[owner, other], 1, true));
    seat.accept();
    seat.submit_owner_use();
    let frame = seat.step();
    assert_eq!(frame.frame().tick(), 2);
    let sample = trusted(&seat.sim);
    assert!(check_healing_fact(frame.frame(), &sample).unwrap());

    // The controls below compare already-captured accepted facts; they never mutate gameplay state
    // and no expected answer is ever passed back into the simulation or the published frame.

    let mut wrong_count = sample.clone();
    wrong_count.hots.pop();
    assert!(
        check_healing_fact(frame.frame(), &wrong_count).is_err(),
        "a wrong accepted HOT count must be rejected"
    );

    let mut wrong_tick = sample.clone();
    wrong_tick.tick += 1;
    assert!(
        check_healing_fact(frame.frame(), &wrong_tick).is_err(),
        "a wrong tick pairing must be rejected"
    );

    let mut wrong_clock = sample.clone();
    wrong_clock.server_time += TICK_MS;
    assert!(
        check_healing_fact(frame.frame(), &wrong_clock).is_err(),
        "a wrong source-time pairing must be rejected"
    );

    let mut wrong_deadline = sample.clone();
    wrong_deadline
        .owner
        .as_mut()
        .expect("trusted owner")
        .healing_until += DEFINITION.step_ms;
    assert!(
        check_healing_fact(frame.frame(), &wrong_deadline).is_err(),
        "a wrong admitted deadline must be rejected"
    );

    // A real later accepted frame paired with the earlier sample is rejected; its own same-sample
    // mirror passes, so the rejection is the pairing and not a changed producer.
    step_until(&mut seat, frame.frame().source_time() + TICK_MS);
    let later = seat.accept();
    assert_eq!(later.frame().tick(), 3);
    assert!(
        check_healing_fact(later.frame(), &sample).is_err(),
        "a stale mirror paired with a later accepted frame must be rejected"
    );
    let later_sample = trusted(&seat.sim);
    assert!(check_healing_fact(later.frame(), &later_sample).unwrap());
}
