//! The seven immutable Card source histories, replayed through the real native constructors, declared inputs and
//! ordinary fixed steps (P-CARD-BLEED-FEEDBACK-1).
//!
//! `parity/card-bleed-feedback/source.json` (`rh-card-bleed-source/2`, 7 cases / 390 ordinary steps / 410,111
//! bytes, SHA-256 `6b3625…36ed`) is read-only. The harness never installs an expected report row, never replays a
//! snapshot as damage, and never calls the flush helper directly: every contribution here comes from the actual
//! scheduled `cardHooks.afterDamage` producer, every flush from the actual periodic/run-end links, every reset from
//! the actual raidStarted hook. The declared arrays (`cardContributions`, `cardFx`) are comparison inputs only.
//!
//! Evidence captured per case:
//! * eligible *processed* landed DoT rows (the corrected `/2` freshness distinction: the ending pass is processed,
//!   an already-ended step's retained scratch is not) versus `cardContributions`;
//! * the trusted raw `CardBleedHit` rows versus `cardFx` (pair order, f64 bits/tags, cadence, run-end/reset);
//! * the per-step Card marker kinds versus the expected empty/populated periodic and run-end envelopes;
//! * the settled public projection carried through projector feeds for every seat and every ordinary step.

use super::*;
use crate::fx_report::FxTickReport;
use crate::map::TileMap;
use crate::observe::SeenEvent;
use crate::state::Sample;
use crate::{validate, Arena, FactionId, FactionMode, RawCommand, Secrets, Sim, SimConfig, Vec2};
use serde_json::Value as V;

const SOURCE_BYTES: usize = 410_111;
const SOURCE_CASES: usize = 7;
const SOURCE_ORDINARY_STEPS: usize = 390;

/// Room map of the capture rig: 40x24, walled border, no props, no camps and no spawn points.
fn room() -> Arena {
    let (w, h) = (40usize, 24usize);
    let mut rows = Vec::with_capacity(h);
    for y in 0..h {
        let mut r = String::with_capacity(w);
        for x in 0..w {
            r.push(if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                '#'
            } else {
                '.'
            });
        }
        rows.push(r);
    }
    // The source mapFromTiles room declares no spawn points; the source startRaid keeps every lobby position then.
    // Native source-lifecycle construction requires the coliseum fallback to have ordinary spawn points, and the
    // declared positions below override them on the same real raid-start step, so the rig declares walkable
    // interior points (only the spawn shuffle sees them; the source-observed positions are the declared ones).
    let spawns = [
        (112., 112.),
        (400., 112.),
        (800., 112.),
        (112., 400.),
        (800., 400.),
        (112., 624.),
        (400., 624.),
        (800., 624.),
    ]
    .iter()
    .map(|&(x, y)| Vec2::new(x, y))
    .collect();
    Arena {
        map: TileMap::from_rows(&rows).expect("card source room"),
        spawns,
    }
}

fn source() -> V {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/card-bleed-feedback/source.json"
    );
    let bytes = std::fs::read(path).expect("immutable card-bleed source corpus");
    assert_eq!(
        bytes.len(),
        SOURCE_BYTES,
        "source corpus byte count changed"
    );
    let doc: V = serde_json::from_slice(&bytes).expect("source json");
    assert_eq!(doc["format"], "rh-card-bleed-source/2");
    let cases = doc["cases"].as_array().expect("cases");
    assert_eq!(cases.len(), SOURCE_CASES);
    let ordinary: usize = cases
        .iter()
        .map(|case| case["ordinarySteps"].as_u64().unwrap() as usize)
        .sum();
    assert_eq!(ordinary, SOURCE_ORDINARY_STEPS);
    doc
}

/// One captured row's native facts (the comparison side of the source's trace).
/// One projected public Card row: (viewer, tick, time, victim, redacted source, amount).
type PublicCardRow = (
    crate::PlayerId,
    u32,
    f64,
    crate::PlayerId,
    Option<crate::PlayerId>,
    f64,
);

struct NativeRow {
    label: String,
    tick: u32,
    time: f64,
    active_pass: bool,
    landed: Vec<LandedHit>,
    events: Vec<Event>,
    markers: Vec<&'static str>,
    report_exists: bool,
    report_rows: usize,
    /// The completed tick's frozen viewer list and sight masks (players and sorted mobs): the actual settled
    /// entitlement authority the projection consumed. The public comparison derives its expectation from the
    /// source contribution rows plus these masks, never from the projector's emitted answers.
    viewers: Vec<crate::PlayerId>,
    seen: Vec<u8>,
    mob_seen: Vec<(crate::PlayerId, u8)>,
}

struct Harness {
    sim: Sim,
    rows: Vec<NativeRow>,
    players: Vec<crate::PlayerId>,
    /// (viewer, tick, time, actual Card-projection row): every row the Card marker emitted, per seat.
    pub_events: Vec<(crate::PlayerId, u32, f64, SeenEvent)>,
}

fn actor_id(players: &[crate::PlayerId], name: &str) -> crate::PlayerId {
    let index: usize = name
        .strip_prefix('p')
        .and_then(|n| n.parse().ok())
        .unwrap_or_else(|| panic!("unknown source actor {name}"));
    players[index]
}

fn command(input: &V) -> RawCommand {
    let payload = &input["payload"];
    match input["type"].as_str().expect("input type") {
        "attack" => RawCommand::Attack {
            a: payload["a"].as_f64().unwrap_or(0.),
            t: None,
        },
        "release" => RawCommand::Release {
            a: payload["a"].as_f64().unwrap_or(0.),
            t: None,
        },
        "target" => RawCommand::Target {
            id: crate::PlayerId(payload["id"].as_u64().unwrap_or(0) as u32 + 1),
        },
        other => panic!("the Card source corpus only declares attack/release/target, got {other}"),
    }
}

fn config_with_hitboxes(input: &V, hitboxes: crate::archetype::HitboxMode) -> SimConfig {
    let declared = &input["config"];
    let profile = input["profile"].as_str().unwrap_or("core");
    SimConfig {
        abilities: crate::abilities::Mode::Full,
        wish_lock_ms: declared["wishLockSeconds"].as_f64().unwrap_or(0.) * 1000.,
        lifecycle: crate::ArenaMode::Source(crate::ArenaRules {
            plan_seconds: declared["planSeconds"].as_f64().unwrap_or(0.),
            first_patience_seconds: declared["firstPatienceSeconds"].as_f64(),
            coliseum_schedule: None,
            patience_seconds: declared["patienceSeconds"].as_f64().unwrap_or(3600.),
            patience_min_seconds: declared["patienceMinSeconds"].as_f64().unwrap_or(3600.),
            sudden_death_seconds: declared["suddenDeathSeconds"].as_f64().unwrap_or(60.),
        }),
        hazards: crate::terrain::Mode::Off,
        initial_loot: false,
        // The capture's core/full installer lists have no consumables entry (wind producers).
        consumables: false,
        min_players: input["players"].as_array().unwrap().len(),
        lobby_seconds: 30.,
        fill_seconds: 0.,
        pvp_rules: declared["pvpRules"].as_bool().unwrap_or(false),
        weapon_specials: true,
        faction_mode: if profile == "full" {
            FactionMode::EngagementHolyPlagueFireFrostSentenced
        } else {
            FactionMode::Off
        },
        mob_mode: crate::mob_runtime::MobMode::Off,
        regen: false,
        quests: false,
        training: false,
        dummies: false,
        // Every capture installer list omits walkHint.
        walk_hints: Some(false),
        // The Card source captures are legacy-circle (parity) runs; only the Archetypes composition proof selects
        // the other mode, and it does so here, before the Sim is constructed.
        hitboxes,
        mob_spacing: Default::default(),
    }
}

fn construct_with_hitboxes(input: &V, hitboxes: crate::archetype::HitboxMode) -> Sim {
    let seed = input["mainSeed"].as_u64().unwrap_or(12) as u32;
    let mut random = crate::rng::Mulberry32::new(seed);
    let secrets = Secrets {
        order_salt: random.next_u32(),
        spawn_seed: seed,
        reward_salt: [1, 2, 3, 4],
    };
    let mut sim = Sim::try_new(config_with_hitboxes(input, hitboxes), room(), secrets)
        .expect("admitted source constructor");
    for (i, player) in input["players"].as_array().unwrap().iter().enumerate() {
        let faction = FactionId::parse(player["faction"].as_str().unwrap()).unwrap();
        sim.add_player(&format!("bleed-{i}"), Some(faction), false)
            .expect("source player join");
    }
    // The normal lobby/start transition is itself an ordinary source step.
    let events = sim.step();
    assert_eq!(sim.phase(), crate::Phase::Active, "lobby-to-raid step");
    assert!(
        events.iter().any(|e| matches!(e, Event::RaidStarted)),
        "the real startRaid producer ran"
    );
    let now = sim.server_time();
    let players: Vec<_> = sim.players().iter().map(|p| p.id).collect();
    // Declared bootstrap setup (positions/loadout/cards/hp): a setup declaration, never damage.
    for (i, declared) in input["players"].as_array().unwrap().iter().enumerate() {
        let Some(p) = sim.w.players.get_mut(players[i]) else {
            panic!("source player {i} missing")
        };
        let at = &declared["at"];
        let (x, y) = (at["x"].as_f64().unwrap(), at["y"].as_f64().unwrap());
        p.body.x = x;
        p.body.y = y;
        p.body.history.reset(Sample { t: now, x, y });
        p.motion.slip = None;
        if let Some(weapon) = declared["weapon"].as_str() {
            p.weapon.weapon0 = crate::content::WeaponId::parse(weapon);
        }
        if let Some(hp) = declared["hp"].as_f64() {
            p.vitals.hp = hp;
        }
    }
    for (i, declared) in input["players"].as_array().unwrap().iter().enumerate() {
        for card in declared["cards"].as_array().into_iter().flatten() {
            let card: crate::cards::CardId =
                serde_json::from_value(card.clone()).expect("declared source card id");
            assert!(
                crate::cards::grant(&sim.k, &mut sim.w, players[i], card),
                "declared valid card grant"
            );
        }
    }
    sim
}

fn markers(report: &FxTickReport) -> Vec<&'static str> {
    report
        .ops
        .iter()
        .filter_map(|op| match op {
            Op::CardSegment(_) => Some("segment"),
            Op::CardFlush(_) => Some("flush"),
            Op::CardReset(_) => Some("reset"),
            _ => None,
        })
        .collect()
}

impl Harness {
    fn capture_with(
        &mut self,
        label: &str,
        active_pass: bool,
        events: &[Event],
        markers: Vec<&'static str>,
    ) {
        let report = self.sim.fx_report();
        let (viewers, seen, mob_seen) = if report.complete {
            (
                report.viewers.clone(),
                report.seen.clone(),
                report.mob_seen.clone(),
            )
        } else {
            (Vec::new(), Vec::new(), Vec::new())
        };
        self.rows.push(NativeRow {
            label: label.to_string(),
            tick: self.sim.tick(),
            time: self.sim.server_time(),
            active_pass,
            landed: self.sim.s.landed.clone(),
            events: events.to_vec(),
            markers,
            report_exists: self.sim.w.card_bleed.exists(),
            report_rows: self.sim.w.card_bleed.rows.len(),
            viewers,
            seen,
            mob_seen,
        });
    }

    fn capture(&mut self, label: &str, active_pass: bool, events: &[Event]) {
        let markers = markers(self.sim.fx_report());
        self.capture_with(label, active_pass, events, markers);
    }
}

fn scratch_markers(ops: &[Op]) -> Vec<&'static str> {
    ops.iter()
        .filter_map(|op| match op {
            Op::CardSegment(_) => Some("segment"),
            Op::CardFlush(_) => Some("flush"),
            Op::CardReset(_) => Some("reset"),
            _ => None,
        })
        .collect()
}

fn run_case(case: &V) -> Harness {
    run_case_with_hitboxes(case, crate::archetype::HitboxMode::LegacyCircle)
}

fn run_case_with_hitboxes(case: &V, hitboxes: crate::archetype::HitboxMode) -> Harness {
    let input = &case["input"];
    let sim = construct_with_hitboxes(input, hitboxes);
    let players: Vec<_> = sim.players().iter().map(|p| p.id).collect();
    let mut harness = Harness {
        sim,
        rows: Vec::new(),
        players,
        pub_events: Vec::new(),
    };
    // One projector per seat: the settled public temporal path, fed every captured step.
    let mut projectors: Vec<crate::FxProjector> = harness
        .players
        .iter()
        .map(|&id| crate::FxProjector::attach(&harness.sim, id))
        .collect();
    let ordinary_after_step = |harness: &mut Harness,
                               projectors: &mut Vec<crate::FxProjector>,
                               label: &str,
                               active_pass: bool| {
        let events = harness.sim.step();
        for (viewer, projector) in projectors.iter_mut().enumerate() {
            projector
                .feed(harness.sim.fx_report())
                .expect("bounded Card source projection");
            let viewer = harness.players[viewer];
            // The transparent test observer of the actual Card path: every row the Card marker emitted in this
            // feed, before any ordinary filtered `Hit` fx mix in. No emitted row is dropped here.
            for seen in projector.card_outputs() {
                harness.pub_events.push((
                    viewer,
                    harness.sim.tick(),
                    harness.sim.server_time(),
                    seen.clone(),
                ));
            }
        }
        harness.capture(label, active_pass, &events);
    };
    for (ai, action) in input["actions"].as_array().unwrap().iter().enumerate() {
        match action["kind"].as_str().unwrap() {
            "step" => {
                let pre_active = harness.sim.phase() == crate::Phase::Active;
                for raw in action["inputs"].as_array().unwrap() {
                    let id = actor_id(&harness.players, raw["actor"].as_str().unwrap());
                    let cmd = validate(command(raw)).expect("declared valid source command");
                    harness.sim.submit(id, cmd).expect("accepted source input");
                }
                ordinary_after_step(
                    &mut harness,
                    &mut projectors,
                    &format!("action-{ai}"),
                    pre_active,
                );
            }
            "span" => {
                for n in 0..action["count"].as_u64().unwrap() {
                    let pre_active = harness.sim.phase() == crate::Phase::Active;
                    ordinary_after_step(
                        &mut harness,
                        &mut projectors,
                        &format!("action-{ai}-step-{}", n + 1),
                        pre_active,
                    );
                }
            }
            "setup" => {
                let id = actor_id(&harness.players, action["actor"].as_str().unwrap());
                let now = harness.sim.server_time();
                let Some(p) = harness.sim.w.players.get_mut(id) else {
                    panic!("declared setup actor missing")
                };
                if let Some(hp) = action["hp"].as_f64() {
                    p.vitals.hp = hp;
                }
                if let Some(at) = action.get("at") {
                    let (x, y) = (at["x"].as_f64().unwrap(), at["y"].as_f64().unwrap());
                    p.body.x = x;
                    p.body.y = y;
                    p.body.history.reset(Sample { t: now, x, y });
                }
            }
            "startRaid" => {
                // The real capture action: the actual source startRaid producer, not a helper flush.
                let placed: Vec<_> = harness
                    .players
                    .iter()
                    .enumerate()
                    .map(|(i, &id)| {
                        let at = &input["players"][i]["at"];
                        (
                            id,
                            Vec2::new(at["x"].as_f64().unwrap(), at["y"].as_f64().unwrap()),
                        )
                    })
                    .collect();
                let mut ev = Vec::new();
                {
                    let crate::sim::Sim { k, w, s, .. } = &mut harness.sim;
                    crate::systems::lobby::start_raid(k, w, s, &mut ev, &placed);
                }
                // The source producer emits outside the ordinary step here; its events wait for the next step.
                harness.sim.w.pending_events.extend(ev);
                let ops = harness.sim.s.fx.ops.clone();
                harness.capture_with(
                    &format!("action-{ai}-source-startRaid"),
                    false,
                    &[],
                    scratch_markers(&ops),
                );
            }
            other => panic!("unknown closed source action {other}"),
        }
    }
    harness
}

fn source_pair(value: &V) -> Option<crate::PlayerId> {
    let name = value.as_str()?;
    let index = name.strip_prefix('p')?.parse::<u32>().ok()?;
    Some(crate::PlayerId(index + 1))
}

fn expect_amount(actual: &CardBleedAmount, source: &V) -> bool {
    let finite = source
        .as_f64()
        .map(CardBleedAmount::from_landed)
        .unwrap_or_else(|| match source["$float"].as_str() {
            Some("Infinity") => CardBleedAmount::PositiveInfinity,
            Some("-Infinity") => panic!("the admitted Card algebra cannot produce -Infinity"),
            Some("NaN") => CardBleedAmount::NotANumber,
            _ => panic!("unexpected source number {source}"),
        });
    match (actual, finite) {
        (CardBleedAmount::Finite(a), CardBleedAmount::Finite(b)) => a.to_bits() == b.to_bits(),
        (a, b) => a == &b,
    }
}

/// Every eligible *processed* landed row, the `/2` freshness distinction applied exactly as the source capture
/// does: a row counts only when the step itself began active (and nonvoided). Retained scratch rows from an
/// already-ended step stay visible in `s.landed` but are never processed here.
fn processed_contributions(
    harness: &Harness,
) -> Vec<(u32, f64, crate::PlayerId, Option<crate::PlayerId>, f64)> {
    let mut out = Vec::new();
    for row in &harness.rows {
        if !row.active_pass {
            continue;
        }
        for hit in &row.landed {
            if hit.dot && hit.ability.is_none() && hit.sig.is_none() {
                out.push((row.tick, row.time, hit.victim, hit.by, hit.amount));
            }
        }
    }
    out
}

/// Does the completed tick's frozen settled sight let `viewer` see `id`? This reads only the actual sealed sight
/// masks the projection consumed (players then sorted mobs); it never reads an emitted Card row.
fn row_sees(row: &NativeRow, viewer: crate::PlayerId, id: crate::PlayerId) -> bool {
    let Some(mask) = row.viewers.iter().position(|&v| v == viewer) else {
        return false;
    };
    if let Some(j) = row.viewers.iter().position(|&v| v == id) {
        if row.seen.get(mask).is_some_and(|m| m & (1 << j) != 0) {
            return true;
        }
    }
    row.mob_seen
        .binary_search_by_key(&id, |(id, _)| *id)
        .is_ok_and(|j| row.mob_seen[j].1 & (1 << mask) != 0)
}

/// The frozen source contribution rows, grouped by the tick that processed them. These are the source oracle's
/// own producer facts (already compared row-for-row above), never the native projection's answers.
fn source_contributions(
    case: &V,
) -> std::collections::BTreeMap<u32, Vec<(crate::PlayerId, Option<crate::PlayerId>, f64)>> {
    let mut out: std::collections::BTreeMap<
        u32,
        Vec<(crate::PlayerId, Option<crate::PlayerId>, f64)>,
    > = std::collections::BTreeMap::new();
    for row in case["cardContributions"].as_array().unwrap() {
        out.entry(row["tick"].as_u64().unwrap() as u32)
            .or_default()
            .push((
                source_pair(&row["victim"]).unwrap(),
                source_pair(&row["by"]),
                row["amount"].as_f64().unwrap(),
            ));
    }
    out
}

/// The complete expected public Card stream per seat, derived **only** from the frozen source contribution rows
/// and the completed tick's actual frozen sight masks: entitlement, redaction before grouping, exact per-window
/// sums rounded once, emitted in stable public-key order at every Card marker. No emitted projector answer is an
/// input, so an extra, missing or wrong-valued public row cannot be filtered out by the expectation.
fn expected_public_stream(case: &V, harness: &Harness) -> Vec<PublicCardRow> {
    let contributions = source_contributions(case);
    let mut out = Vec::new();
    for &viewer in &harness.players {
        let mut buckets: std::collections::BTreeMap<
            (crate::PlayerId, Option<crate::PlayerId>),
            crate::fx_projector::exact::ExactSum,
        > = std::collections::BTreeMap::new();
        for row in &harness.rows {
            if let Some(tick_rows) = contributions.get(&row.tick) {
                for &(victim, by, amount) in tick_rows {
                    if !row_sees(row, viewer, victim) && by != Some(viewer) {
                        continue;
                    }
                    let redacted = by.filter(|&source| row_sees(row, viewer, source));
                    buckets
                        .entry((victim, redacted))
                        .or_default()
                        .add(amount)
                        .expect("source contribution is in the exact domain");
                }
            }
            for marker in &row.markers {
                match *marker {
                    "flush" => {
                        for ((victim, by), sum) in &buckets {
                            let amount = sum.rounded().expect("finite representable window total");
                            if amount > 0.0 {
                                out.push((viewer, row.tick, row.time, *victim, *by, amount));
                            }
                        }
                        buckets.clear();
                    }
                    "reset" => buckets.clear(),
                    _ => {}
                }
            }
        }
    }
    out
}

/// Every actual row the Card projection emitted, in feed/emission order, per seat. This is the transparent test
/// observer of the real Card path; nothing here is classified or filtered by the expectation.
fn actual_public_stream(harness: &Harness) -> Vec<PublicCardRow> {
    harness
        .pub_events
        .iter()
        .map(|(viewer, tick, time, event)| {
            let SeenEvent::Hit {
                victim,
                by,
                amount,
                passive,
                ..
            } = event
            else {
                panic!("the actual Card projection path emitted a non-Hit row: {event:?}");
            };
            assert!(!passive, "the Card projection is never passive");
            (*viewer, *tick, *time, *victim, *by, *amount)
        })
        .collect()
}

fn compare_public_stream(
    name: &str,
    case: &V,
    harness: &Harness,
    actual: &[PublicCardRow],
) -> Result<(), String> {
    let expected = expected_public_stream(case, harness);
    for &viewer in &harness.players {
        let want: Vec<_> = expected
            .iter()
            .filter(|row| row.0 == viewer)
            .cloned()
            .collect();
        let got: Vec<_> = actual
            .iter()
            .filter(|row| row.0 == viewer)
            .cloned()
            .collect();
        if got.len() != want.len() {
            return Err(format!(
                "{name}: viewer {} emitted {} Card public rows, expected exactly {}: actual {got:?} expected {want:?}",
                viewer.0,
                got.len(),
                want.len()
            ));
        }
        for (i, (g, w)) in got.iter().zip(&want).enumerate() {
            if g.1 != w.1
                || g.2 != w.2
                || g.3 != w.3
                || g.4 != w.4
                || g.5.to_bits() != w.5.to_bits()
            {
                return Err(format!(
                    "{name}: viewer {} Card public row {i} differs: actual {g:?} expected {w:?}",
                    viewer.0
                ));
            }
        }
    }
    let unexpected: Vec<_> = actual
        .iter()
        .filter(|row| !harness.players.contains(&row.0))
        .collect();
    if !unexpected.is_empty() {
        return Err(format!(
            "{name}: Card rows emitted for a non-seat viewer: {unexpected:?}"
        ));
    }
    Ok(())
}

/// A real wrong-valued extra Card row appended while every expected row is retained must fail the actual
/// comparator (the comparator classifies nothing by the expectation, so extras are visible).
#[test]
fn a_wrong_valued_extra_card_row_is_rejected_by_the_actual_public_comparator() {
    let doc = source();
    let case = doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["name"] == "first-use-clock-periodic-and-empty-interval")
        .unwrap();
    let harness = run_case(case);
    let mut actual = actual_public_stream(&harness);
    compare_public_stream("control", case, &harness, &actual).expect("the real stream matches");
    assert!(!actual.is_empty(), "the case emits real public Card rows");
    // Retain every expected row and append one extra wrong-valued row at the first marker.
    let mut extra = actual[0];
    extra.5 += 1.0;
    actual.push(extra);
    let error = compare_public_stream("mutant", case, &harness, &actual)
        .expect_err("an extra wrong-valued public Card row must be rejected");
    assert!(error.contains("emitted"), "{error}");
    assert!(error.contains("expected exactly"), "{error}");
    // Dropping a real row is caught as well.
    let mut missing = actual_public_stream(&harness);
    missing.pop();
    assert!(compare_public_stream("mutant", case, &harness, &missing).is_err());
}

#[test]
fn the_seven_immutable_source_histories_reproduce_trusted_rows_and_cadence() {
    let doc = source();
    let mut failures = Vec::new();
    for case in doc["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let harness = run_case(case);
        let expected: Vec<_> = case["cardContributions"]
            .as_array()
            .unwrap()
            .iter()
            .collect();
        let actual = processed_contributions(&harness);
        if expected.len() != actual.len() {
            failures.push(format!(
                "{name}: {} processed contributions != source {}",
                actual.len(),
                expected.len()
            ));
            continue;
        }
        let mut case_ok = true;
        for (i, (want, got)) in expected.iter().zip(&actual).enumerate() {
            let (tick, time, victim, by, amount) = got;
            let same = want["tick"].as_u64() == Some(u64::from(*tick))
                && want["time"].as_f64() == Some(*time)
                && source_pair(&want["victim"]) == Some(*victim)
                && source_pair(&want["by"]) == *by
                && want["amount"]
                    .as_f64()
                    .is_some_and(|v| v.to_bits() == amount.to_bits());
            if !same {
                failures.push(format!(
                    "{name}: contribution {i}: native tick/tick {tick}/{time} {victim:?}/{by:?} {amount:?} != source {} {} {} {} {}",
                    want["tick"], want["time"], want["victim"], want["by"], want["amount"]
                ));
                case_ok = false;
                break;
            }
        }
        if !case_ok {
            continue;
        }
        // Trusted raw rows versus the source's derived group FX: one typed pair row per source flush, in order.
        let mut trusted: Vec<(
            u32,
            f64,
            crate::PlayerId,
            Option<crate::PlayerId>,
            CardBleedAmount,
        )> = Vec::new();
        for row in &harness.rows {
            for event in &row.events {
                if let Event::CardBleedHit { victim, by, amount } = event {
                    trusted.push((row.tick, row.time, *victim, *by, *amount));
                }
            }
        }
        let expected_fx = case["cardFx"].as_array().unwrap();
        if trusted.len() != expected_fx.len() {
            failures.push(format!(
                "{name}: {} trusted rows != source {} cardFx rows",
                trusted.len(),
                expected_fx.len()
            ));
            continue;
        }
        for (i, (want, got)) in expected_fx.iter().zip(&trusted).enumerate() {
            let (tick, time, victim, by, amount) = got;
            let fx = &want["fx"];
            let same = want["tick"].as_u64() == Some(u64::from(*tick))
                && want["time"].as_f64() == Some(*time)
                && source_pair(&fx["id"]) == Some(*victim)
                && source_pair(&fx["by"]) == *by
                && fx["weapon"].is_null()
                && expect_amount(amount, &fx["amount"]);
            if !same {
                failures.push(format!(
                    "{name}: trusted row {i}: native tick {tick} time {time:?} {victim:?}/{by:?} {amount:?} != source tick {} id {} by {} amount {} time {}",
                    want["tick"], fx["id"], fx["by"], fx["amount"], want["time"]
                ));
                break;
            }
        }
        // The settled public projection is the separate admitted path: for every seat the emitted public Hits
        // must cover the source's global raw pairs (each pair is entitled to its own source) in stable public-key
        // order, with the window's **exact** total rounded once. The exact public total is deliberately separate
        // from the trusted source-ordered f64 fold compared above, so the expectation here is the correctly
        // rounded exact sum of the source contributions in each source flush window, not the sequential fold.
        let actual = actual_public_stream(&harness);
        if let Err(why) = compare_public_stream(name, case, &harness, &actual) {
            failures.push(why);
        }
        // The source's own `/2` retained-vs-processed fact: an ended step retains scratch but contributes and
        // emits nothing.
        if name == "run-ended-before-periodic-window" {
            let ending = harness
                .rows
                .iter()
                .find(|r| r.label == "action-3-step-1")
                .expect("ending active step");
            let ended = harness
                .rows
                .iter()
                .find(|r| r.label == "action-3-step-2")
                .expect("already-ended step");
            assert!(
                ending.active_pass && !ending.landed.is_empty(),
                "the ending active pass processed its real landed rows"
            );
            assert_eq!(ended.tick, ending.tick + 1);
            assert!(!ended.active_pass);
            assert!(
                !ended.landed.is_empty(),
                "an already-ended step retains the previous pass's scratch landed rows"
            );
            assert!(
                ended.markers.is_empty(),
                "retained scratch must never be reprocessed into a Card marker"
            );
        }
    }
    assert!(
        failures.is_empty(),
        "genuine native/source Card divergences:\n{}",
        failures.join("\n")
    );
}

#[test]
fn the_source_cases_reach_grouping_cadence_run_end_reset_teleport_and_exclusion() {
    let doc = source();
    let cases = doc["cases"].as_array().unwrap();
    let named = |name: &str| cases.iter().find(|c| c["name"] == name).unwrap();

    // Ordered repeated/distinct pairs: one row per raw pair and real repeats.
    let ordered = run_case(named("ordered-pairs-and-repeat-pair"));
    let contributions = processed_contributions(&ordered);
    assert!(contributions.len() >= 6, "ordered-pairs reaches real rows");
    let pairs: std::collections::BTreeSet<_> = contributions
        .iter()
        .map(|(_, _, v, b, _)| (*v, *b))
        .collect();
    assert!(
        pairs.len() >= 2,
        "ordered-pairs reaches multiple actual pairs"
    );
    assert!(pairs.len() < contributions.len(), "a pair really repeats");
    let flushes: Vec<_> = ordered
        .rows
        .iter()
        .filter(|r| r.markers.contains(&"flush"))
        .collect();
    assert!(!flushes.is_empty(), "the source flush markers are sealed");
    assert_eq!(
        contributions.len(),
        named("ordered-pairs-and-repeat-pair")["cardContributions"]
            .as_array()
            .unwrap()
            .len()
    );

    // First-use clock: the first flush lands exactly 500 ms after the first contribution, later intervals stay
    // 500 ms apart even when a window is empty.
    let periodic = run_case(named("first-use-clock-periodic-and-empty-interval"));
    let contributions = processed_contributions(&periodic);
    assert!(!contributions.is_empty());
    let first_contribution = contributions[0].1;
    let first_flush = periodic
        .rows
        .iter()
        .find(|r| r.markers.contains(&"flush"))
        .expect("periodic flush");
    assert_eq!(first_flush.time - first_contribution, 500.);
    let flush_times: Vec<_> = periodic
        .rows
        .iter()
        .filter(|r| r.markers.contains(&"flush"))
        .map(|r| r.time)
        .collect();
    assert!(flush_times.len() >= 3, "several real 500 ms intervals");
    for pair in flush_times.windows(2) {
        assert_eq!(
            pair[1] - pair[0],
            500.,
            "empty intervals keep the source cadence"
        );
    }
    // A populated periodic flush clears the rows; the interval clock keeps running with no report recreation.
    for row in &periodic.rows {
        if row.markers.contains(&"flush") {
            assert!(!row.events.is_empty() || row.report_rows == 0);
        }
    }

    // Natural run-end: an ordinary ending active step, then the runEnded link flushes the retained contribution
    // before the periodic boundary, and the already-ended step never reprocesses retained scratch.
    let ended = run_case(named("run-ended-before-periodic-window"));
    let ending = ended
        .rows
        .iter()
        .find(|r| r.label == "action-3-step-1")
        .unwrap();
    let already = ended
        .rows
        .iter()
        .find(|r| r.label == "action-3-step-2")
        .unwrap();
    assert!(ending.active_pass);
    assert!(
        ending.markers.contains(&"flush"),
        "the natural ending step flushes through the registered runEnded link"
    );
    let flush = ended
        .rows
        .iter()
        .find(|r| r.markers.contains(&"flush"))
        .unwrap();
    let first = processed_contributions(&ended)[0].1;
    assert!(
        flush.time - first < 500.,
        "early run-end precedes the periodic window"
    );
    assert!(!already.active_pass && already.markers.is_empty());
    assert!(
        !already.landed.is_empty(),
        "retained scratch is still visible"
    );
    assert_eq!(ended.sim.phase(), crate::Phase::Ended);

    // Raid-start reset: the real startRaid producer clears the partial report instead of flushing it.
    let reset = run_case(named("raid-start-clears-partial-report"));
    let before_reset = processed_contributions(&reset);
    assert!(
        !before_reset.is_empty(),
        "a partial report existed before the reset"
    );
    let start = reset
        .rows
        .iter()
        .find(|r| r.label.starts_with("action-2-source-startRaid"))
        .expect("real startRaid action row");
    assert!(!start.report_exists && start.report_rows == 0);
    assert!(
        !start.markers.is_empty(),
        "the reset marker is recorded by the real hook"
    );
    // The pre-reset contributions are discarded: no source feedback row was ever emitted for them.
    let trusted_rows: usize = reset
        .rows
        .iter()
        .map(|r| {
            r.events
                .iter()
                .filter(|e| matches!(e, Event::CardBleedHit { .. }))
                .count()
        })
        .sum();
    assert_eq!(
        trusted_rows,
        named("raid-start-clears-partial-report")["cardFx"]
            .as_array()
            .unwrap()
            .len()
    );

    // Teleport retention: the ordinary settle/teleport path does not flush or reset the report.
    let teleport = run_case(named("teleport-retains-partial-report"));
    let teleported = teleport
        .rows
        .iter()
        .find(|r| r.events.iter().any(|e| matches!(e, Event::Teleported)))
        .expect("the real teleport lifecycle ran");
    assert!(
        !teleported.markers.contains(&"reset"),
        "teleport must retain the Card report"
    );
    assert!(
        teleported.report_exists,
        "the partial report survives the teleport"
    );
    // The source flushes only at its own boundaries; teleport adds no feedback row.
    let teleport_rows: usize = teleport
        .rows
        .iter()
        .map(|r| {
            r.events
                .iter()
                .filter(|e| matches!(e, Event::CardBleedHit { .. }))
                .count()
        })
        .sum();
    assert_eq!(
        teleport_rows,
        named("teleport-retains-partial-report")["cardFx"]
            .as_array()
            .unwrap()
            .len()
    );

    // Fire burn/backlash coexist and are excluded: the mixed case reaches real signature landed rows but only
    // the card-shaped ones enter the Card report.
    let mixed = run_case(named("card-dot-excludes-fire-burn-and-backlash"));
    let mut reached_signature = false;
    for row in &mixed.rows {
        for hit in &row.landed {
            if hit.sig.is_some() && !hit.sig.unwrap().is_dot() {
                reached_signature = true;
            }
            if hit.sig.is_some() || hit.ability.is_some() {
                assert!(!hit.dot || hit.ability.is_none() && hit.sig.is_none());
            }
        }
    }
    assert!(
        reached_signature,
        "the mixed source case reaches actual Fire burn/backlash signature rows"
    );
    assert!(!processed_contributions(&mixed).is_empty());

    // The no-card control runs the same ordinary path and produces no Card row at all.
    let control = run_case(named("no-card-dot-control"));
    assert!(processed_contributions(&control).is_empty());
    assert!(
        control
            .rows
            .iter()
            .all(|r| !r.markers.contains(&"flush") && !r.markers.contains(&"segment")),
        "the no-card control creates no Card report/segment/marker"
    );
    assert!(control.rows.iter().all(|r| !r
        .events
        .iter()
        .any(|e| matches!(e, Event::CardBleedHit { .. }))));
    assert_eq!(
        named("no-card-dot-control")["cardContributions"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
}

/// Archetypes composition proof: the declared `first-use-clock-periodic-and-empty-interval` input (loadouts, setup,
/// ordinary commands and spans) drives the real scheduled landed Card DoT, periodic flush and `FxProjector` delivery
/// with Archetypes selected before construction. The case's `trace`/`cardContributions`/`cardFx`/`final` are not read:
/// this is a producer/projection integration assertion, not a legacy-number comparison.
#[test]
fn archetypes_first_use_case_delivers_a_real_public_card_hit_without_leaking_raw_reports() {
    let doc = source();
    let case = doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "first-use-clock-periodic-and-empty-interval")
        .expect("declared case");
    let harness = run_case_with_hitboxes(case, crate::archetype::HitboxMode::Archetypes);
    assert_eq!(
        harness.sim.config().hitboxes,
        crate::archetype::HitboxMode::Archetypes
    );

    // The ordinary Attack must land a real weapon hit on the victim in this mode, and the Card DoT must follow.
    let (p0, p1) = (harness.players[0], harness.players[1]);
    let weapon_hit = harness
        .rows
        .iter()
        .any(|r| r.landed.iter().any(|h| h.by == Some(p0) && !h.dot));
    assert!(
        weapon_hit,
        "the declared Attack lands a weapon hit under Archetypes"
    );
    let contributions = processed_contributions(&harness);
    assert!(
        !contributions.is_empty(),
        "the scheduled landed Card DoT produced processed contributions under Archetypes"
    );
    assert!(contributions
        .iter()
        .all(|(_, _, victim, by, _)| *victim == p1 && *by == Some(p0)));

    // The actual periodic flush produced trusted rows (server-side only) ...
    let trusted: Vec<_> = harness
        .rows
        .iter()
        .flat_map(|r| r.events.iter())
        .filter(|e| matches!(e, Event::CardBleedHit { .. }))
        .collect();
    assert!(
        !trusted.is_empty(),
        "a real periodic flush reached trusted rows"
    );

    // ... and a real eligible public Card Hit reached a viewer who the sealed sight masks say could see the victim.
    let public = actual_public_stream(&harness);
    assert!(!public.is_empty(), "a public Card Hit reached a viewer");
    let mut eligible_delivered = 0;
    for (viewer, tick, _time, victim, by, amount) in &public {
        assert_eq!(*victim, p1);
        assert_eq!(*by, Some(p0));
        assert!(amount.is_finite() && *amount > 0.);
        let row = harness
            .rows
            .iter()
            .find(|r| r.tick == *tick)
            .expect("row for the emitting tick");
        assert!(
            row_sees(row, *viewer, *victim),
            "public Card Hit only reaches a viewer whose sealed sight sees the victim"
        );
        eligible_delivered += 1;
    }
    assert!(eligible_delivered > 0);

    // No raw trusted report state is emitted to any viewer: every projected row is the public Hit shape, and the
    // per-tick report carries no raw CardBleedHit event in the viewer-facing `seen` streams.
    for (_, _, _, event) in &harness.pub_events {
        assert!(matches!(event, SeenEvent::Hit { passive: false, .. }));
    }
}
