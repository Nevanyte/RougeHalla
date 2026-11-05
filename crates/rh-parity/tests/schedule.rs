//! C-TICK, executable: the Rust tick schedule (`rh_sim::schedule`) against the legacy record
//! (`parity/schedule/legacy_schedule.json`, format `rh-legacy-schedule/2`, captured from the real `createGameWorld`).
//!
//! * Conformance: the tables, projected under the production, capture and training gate sets, equal the record's
//!   `updateActive` phases, registration lists, action registrations and every hook chain (names, order, modes and which
//!   links a later `replace` dropped). A `Pending` row names a real backlog packet.
//! * Execution: with the `schedule-trace` feature, a match run through every slice fixture executes its ported rows in
//!   table order, tick by tick.
//! * Mutation: the same check functions reject a swapped row, a moved system, a dropped row, a reordered hook chain, a
//!   changed gate or mode, an invented packet and a table that is not the order the code ran in.

use rh_parity::*;
use rh_sim::schedule::{
    hook_chain, live, tables, ActionEntry, Entry, Gate, Gates, Hook, LinkEntry, Mode, Tables,
    TraceEntry,
};
use rh_sim::{validate, Phase};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

fn record() -> Value {
    let path = fixtures_dir().join("../schedule/legacy_schedule.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let v: Value = serde_json::from_str(&text).expect("the schedule record parses");
    assert_eq!(v["format"], "rh-legacy-schedule/2", "the record's format");
    v
}

const WORLDS: [(&str, Gates); 3] = [
    ("production", Gates::PRODUCTION),
    ("capture", Gates::CAPTURE),
    ("training", Gates::TRAINING),
];

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap_or_else(|| panic!("an array, got {v}"))
        .iter()
        .map(|s| s.as_str().expect("a string").to_string())
        .collect()
}

fn names(entries: &[&Entry]) -> Vec<String> {
    entries.iter().map(|e| e.legacy.to_string()).collect()
}

fn same(what: &str, got: &[String], want: &[String]) -> Result<(), String> {
    if got == want {
        return Ok(());
    }
    let at = got.iter().zip(want).position(|(a, b)| a != b);
    Err(format!(
        "{what}: the table and the record differ{}\n  table : {got:?}\n  record: {want:?}",
        match at {
            Some(i) => format!(" (first at position {i}: {} vs {})", got[i], want[i]),
            None => format!(" (lengths {} vs {})", got.len(), want.len()),
        }
    ))
}

// ---------------------------------------------------------------------------------------------------------------------
// The check functions (the mutation tests call these same functions)
// ---------------------------------------------------------------------------------------------------------------------

/// `updateActive`: the 23 phases, exactly, in order; with the gate legacy gives each (`if (training) ... else ...`).
fn check_phases(t: &Tables, rec: &Value) -> Result<(), String> {
    let got: Vec<String> = t.phases.iter().map(|e| e.legacy.to_string()).collect();
    same("updateActive phases", &got, &strings(&rec["updateActive"]))?;
    for e in &t.phases {
        let want = match e.legacy {
            "settle:training" => Gate::Training,
            "settle" => Gate::NotTraining,
            n if n.ends_with("(notTraining)") => Gate::NotTraining,
            _ => Gate::Always,
        };
        if e.gate != want {
            return Err(format!(
                "phase {} is gated {:?}, legacy gates it {want:?}",
                e.legacy, e.gate
            ));
        }
    }
    Ok(())
}

fn lists(t: &Tables) -> [(&'static str, &Vec<Entry>); 5] {
    [
        ("afterWeapons", &t.after_weapons),
        ("beforeDamage", &t.before_damage),
        ("systems", &t.systems),
        ("moveModifiers", &t.move_modifiers),
        ("modSources", &t.mod_sources),
    ]
}

/// The five registration lists of one world, in execution order.
fn check_lists(t: &Tables, rec: &Value, world: &str, g: &Gates) -> Result<(), String> {
    for (key, entries) in lists(t) {
        let want: Vec<String> = rec[world]["lists"][key]
            .as_array()
            .unwrap_or_else(|| panic!("{world} has no list {key}"))
            .iter()
            .map(|e| {
                format!(
                    "{}.{}",
                    e["module"].as_str().unwrap(),
                    e["fn"].as_str().unwrap()
                )
            })
            .collect();
        same(&format!("{world} {key}"), &names(&live(entries, g)), &want)?;
    }
    Ok(())
}

/// The action registrations of one world: kind -> the module that registered its handler.
fn check_actions(t: &Tables, rec: &Value, world: &str, g: &Gates) -> Result<(), String> {
    let got: BTreeMap<String, String> = t
        .actions
        .iter()
        .filter(|a: &&ActionEntry| a.gate.on(g))
        .map(|a| (a.name.to_string(), a.module.to_string()))
        .collect();
    let want: BTreeMap<String, String> = rec[world]["actions"]
        .as_object()
        .expect("actions")
        .iter()
        .map(|(k, v)| (k.clone(), v.as_str().unwrap().to_string()))
        .collect();
    if got != want {
        return Err(format!(
            "{world} actions differ\n  table : {got:?}\n  record: {want:?}"
        ));
    }
    Ok(())
}

fn mode_str(m: Mode) -> &'static str {
    match m {
        Mode::Default => "default",
        Mode::Append => "append",
        Mode::Wrap => "wrap",
        Mode::Replace => "replace",
    }
}

/// Every hook chain of one world: the links in install order with their mode, and which a later `replace` dropped.
fn check_hooks(t: &Tables, rec: &Value, world: &str, g: &Gates) -> Result<(), String> {
    let known: BTreeSet<&str> = t.hooks.iter().map(|(h, _)| h.key()).collect();
    for key in rec[world]["hooks"].as_object().expect("hooks").keys() {
        if !known.contains(key.as_str()) {
            return Err(format!(
                "{world}: the record has hook {key}, the table does not"
            ));
        }
    }
    for (hook, links) in &t.hooks {
        let got: Vec<String> = hook_chain(links, g)
            .iter()
            .map(|(l, dropped)| format!("{} {} dropped={dropped}", l.legacy, mode_str(l.mode)))
            .collect();
        let want: Vec<String> = match rec[world]["hooks"].get(hook.key()) {
            None => Vec::new(),
            Some(chain) => chain
                .as_array()
                .unwrap()
                .iter()
                .map(|l| {
                    format!(
                        "{}.{} {} dropped={}",
                        l["module"].as_str().unwrap(),
                        l["fn"].as_str().unwrap(),
                        l["mode"].as_str().unwrap(),
                        l.get("dropped").and_then(Value::as_bool).unwrap_or(false)
                    )
                })
                .collect(),
        };
        same(&format!("{world} hook {}", hook.key()), &got, &want)?;
    }
    Ok(())
}

/// The ids in the first column of docs/backlog/README.md's tables.
fn backlog_packets() -> BTreeSet<String> {
    let path = fixtures_dir().join("../../docs/backlog/README.md");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let ids: BTreeSet<String> = text
        .lines()
        .filter_map(|l| l.strip_prefix("| P-"))
        .filter_map(|l| l.split(" |").next())
        .map(|id| format!("P-{id}"))
        .collect();
    assert!(ids.len() > 60, "the backlog tables were not found: {ids:?}");
    ids
}

/// A pending row names a real backlog packet (and no ported row names one).
fn check_pending(t: &Tables, packets: &BTreeSet<String>) -> Result<(), String> {
    let mut all: Vec<(&str, Option<&str>)> = Vec::new();
    for e in t
        .phases
        .iter()
        .chain(lists(t).iter().flat_map(|(_, v)| v.iter()))
    {
        all.push((e.legacy, e.pending));
    }
    for a in &t.actions {
        all.push((a.name, a.pending));
    }
    for (_, links) in &t.hooks {
        for l in links {
            all.push((l.legacy, l.pending));
        }
    }
    for (name, pending) in all {
        if let Some(p) = pending {
            if !packets.contains(p) {
                return Err(format!(
                    "row {name} is pending on {p}, which is not a backlog packet"
                ));
            }
        }
    }
    Ok(())
}

fn check_all(t: &Tables, rec: &Value, packets: &BTreeSet<String>) -> Result<(), String> {
    check_phases(t, rec)?;
    for (world, g) in &WORLDS {
        check_lists(t, rec, world, g)?;
        check_actions(t, rec, world, g)?;
        check_hooks(t, rec, world, g)?;
    }
    check_pending(t, packets)
}

/// What a tick must run, from the table: the ported phases that are on under `g`, and after a `hooks:<list>` phase the
/// ported entries of that list.
fn expected_order(t: &Tables, g: &Gates) -> Vec<TraceEntry> {
    let mut out = Vec::new();
    for p in live(&t.phases, g) {
        if p.pending.is_some() {
            continue;
        }
        out.push(TraceEntry::Phase(p.legacy));
        if let Some(list) = p.legacy.strip_prefix("hooks:") {
            let (key, entries) = lists(t)
                .into_iter()
                .find(|(k, _)| *k == list)
                .unwrap_or_else(|| panic!("no list {list}"));
            for e in live(entries, g) {
                if e.pending.is_none() {
                    out.push(TraceEntry::Link(key, e.legacy));
                }
            }
        }
    }
    out
}

/// The executed rows of every active tick equal the table's order, an action handler runs only between the inputs and
/// the weapons, and a hook link runs only where its call site is.
fn check_trace(t: &Tables, ticks: &[Vec<TraceEntry>], gates: &Gates) -> Result<(), String> {
    let want = expected_order(t, gates);
    for (n, tick) in ticks.iter().enumerate() {
        let got: Vec<TraceEntry> = tick
            .iter()
            .copied()
            .filter(|e| matches!(e, TraceEntry::Phase(_) | TraceEntry::Link(..)))
            .collect();
        if got != want {
            return Err(format!(
                "active tick {n} ran its rows in another order than the table\n  ran  : {got:?}\n  table: {want:?}"
            ));
        }
        let mut phase = "";
        for e in tick {
            match e {
                TraceEntry::Phase(p) => phase = p,
                TraceEntry::Action(a) => {
                    if phase != "inputs:players(actionOrder)" {
                        return Err(format!("action {a} ran in phase {phase:?}"));
                    }
                }
                TraceEntry::Hook(h, l) => {
                    // Between steps (a leave) a hook runs before the tick's first phase.
                    let allowed = match *h {
                        "attackStarted" => phase == "weapons",
                        _ => matches!(phase, "" | "ledger:apply" | "settle"),
                    };
                    if !allowed {
                        return Err(format!("hook {h} link {l} ran in phase {phase:?}"));
                    }
                }
                TraceEntry::Link(..) => {}
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------------
// Conformance
// ---------------------------------------------------------------------------------------------------------------------

#[test]
fn the_tables_equal_the_legacy_record_in_all_three_worlds() {
    let rec = record();
    let t = tables();
    if let Err(e) = check_all(&t, &rec, &backlog_packets()) {
        panic!("{e}");
    }
}

#[test]
fn the_tables_cover_what_the_record_covers() {
    let rec = record();
    let t = tables();
    assert_eq!(t.phases.len(), 23, "legacy updateActive has 23 phases");
    assert_eq!(
        (
            t.after_weapons.len(),
            t.before_damage.len(),
            t.systems.len(),
            t.move_modifiers.len(),
            t.mod_sources.len()
        ),
        (3, 3, 24, 7, 6),
        "the production registration lists"
    );
    assert_eq!(t.hooks.len(), 19);
    // Every recorded hook, in every world, is a table hook.
    for (world, _) in &WORLDS {
        let keys = rec[world]["hooks"].as_object().unwrap().keys();
        for k in keys {
            assert!(Hook::ALL.iter().any(|h| h.key() == k), "{world}: hook {k}");
        }
    }
    // feed.flushAnnouncements is pinned at systems #6 in production: after fireRoam, factions.afterDamage,
    // factions.healOverTime, mobs.resetDummies and buffs.expireBoosts.
    let prod = names(&live(&t.systems, &Gates::PRODUCTION));
    assert_eq!(
        prod.iter().position(|n| n == "feed.flushAnnouncements"),
        Some(5)
    );
    assert_eq!(
        prod[..5],
        [
            "fireRoam.update",
            "factions.afterDamage",
            "factions.healOverTime",
            "mobs.resetDummies",
            "buffs.expireBoosts"
        ]
    );
}

#[test]
fn what_the_slice_has_ported_stays_ported() {
    // A packet flips rows from Pending to Ported; it never turns a ported row back. (Add to these lists, never remove.)
    let t = tables();
    let ported = |es: &[Entry]| -> Vec<&'static str> {
        es.iter()
            .filter(|e| e.pending.is_none())
            .map(|e| e.legacy)
            .collect()
    };
    for want in [
        "markTickStart",
        "ledger:openWithDeferred",
        "actionOrder",
        "inputs:players(actionOrder)",
        "abilities",
        "weapons",
        "hooks:afterWeapons",
        "movement:multipliers(moveModifiers)",
        "movement:walk",
        "movement:recordHistory",
        "melee",
        "hooks:beforeDamage",
        "ledger:apply",
        "hooks:systems",
        "settle",
    ] {
        assert!(ported(&t.phases).contains(&want), "phase {want} is ported");
    }
    assert!(ported(&t.systems).contains(&"feed.flushAnnouncements"));
    assert!(ported(&t.systems).contains(&"mods.updateMods"));
    assert!(ported(&t.mod_sources).contains(&"cardHooks.cardSource"));
    assert!(ported(&t.move_modifiers).contains(&"factions.frostMovementModifier"));
    assert!(t
        .hooks
        .iter()
        .find(|(h, _)| *h == Hook::Teleported)
        .unwrap()
        .1
        .iter()
        .any(|l| l.legacy == "factions.<arrow>" && l.pending == Some("P-FACTION-1")));
    assert!(t
        .hooks
        .iter()
        .find(|(h, _)| *h == Hook::AttackStarted)
        .unwrap()
        .1
        .iter()
        .any(|l| l.legacy == "factions.<arrow>" && l.pending.is_none()));
    for a in ["attack", "release", "swap", "pickup"] {
        assert!(
            t.actions.iter().any(|x| x.name == a && x.pending.is_none()),
            "action {a} is ported"
        );
    }
    let drop_body = &t
        .hooks
        .iter()
        .find(|(h, _)| *h == Hook::DropBody)
        .unwrap()
        .1;
    for l in ["world.dropBody", "loot.dropBody"] {
        assert!(
            drop_body
                .iter()
                .any(|x| x.legacy == l && x.pending.is_none()),
            "{l}"
        );
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Execution order
// ---------------------------------------------------------------------------------------------------------------------

/// Replays a fixture and returns the trace of every active step, plus the trace of what ran between steps (a leave).
struct Run {
    gates: Gates,
    active_ticks: Vec<Vec<TraceEntry>>,
    between: Vec<TraceEntry>,
}

fn run(fx: &Fixture) -> Run {
    let mut sim = build(fx);
    let _ = sim.schedule_trace();
    let mut out = Run {
        gates: if sim.config().faction_mode.engagement() {
            Gates::HOLY_FOUNDATION
        } else {
            Gates::CAPTURE
        },
        active_ticks: Vec::new(),
        between: Vec::new(),
    };
    let mut inputs = fx.inputs.iter().peekable();
    for t in &fx.ticks {
        while let Some(i) = inputs.peek() {
            if i.tick > t.tick {
                break;
            }
            let i = inputs.next().unwrap();
            if let Some(cmd) = raw_command_pub(i).and_then(|r| validate(r).ok()) {
                let _ = sim.submit_unbudgeted(pid(&i.player), cmd);
            }
        }
        let before = sim.phase();
        let _ = sim.step();
        let tick = sim.schedule_trace();
        if before == Phase::Active {
            out.active_ticks.push(tick);
        }
        apply_actions(&mut sim, fx, t.tick);
        out.between.extend(sim.schedule_trace());
    }
    out
}

fn all_runs() -> Vec<(String, Run)> {
    let fixtures = scenarios("slice");
    assert!(fixtures.len() >= 13);
    fixtures
        .iter()
        .map(|f| (f.scenario.clone(), run(f)))
        .collect()
}

#[test]
fn a_match_runs_its_ported_rows_in_table_order() {
    let t = tables();
    let runs = all_runs();
    let mut ticks = 0;
    let (mut actions, mut drops, mut hits, mut attacks) = (0, 0, 0, 0);
    for (name, r) in &runs {
        ticks += r.active_ticks.len();
        if let Err(e) = check_trace(&t, &r.active_ticks, &r.gates) {
            panic!("{name}: {e}");
        }
        for e in r.active_ticks.iter().flatten().chain(&r.between) {
            match e {
                TraceEntry::Action(_) => actions += 1,
                TraceEntry::Hook("dropBody", l) => {
                    // loot's replace link ran, the world's default it replaced did not.
                    assert_eq!(*l, "loot.dropBody", "{name}");
                    drops += 1;
                }
                TraceEntry::Hook("hitLanded", "cardHooks.onHitLanded") => hits += 1,
                TraceEntry::Hook("attackStarted", "abilities.onAttackStarted") => attacks += 1,
                TraceEntry::Hook("runEnded", "factions.flushDotFx") => {}
                TraceEntry::Hook("attackStarted", "factions.<arrow>") => {}
                TraceEntry::Hook(h, l) => panic!("{name}: hook {h} link {l} is not ported"),
                _ => {}
            }
        }
    }
    assert!(hits > 0, "landed hits ran the registered on-hit hook");
    assert!(
        attacks > 0,
        "weapon windups ran the registered bush exposure hook"
    );
    assert!(ticks > 100, "the fixtures ran {ticks} active ticks");
    assert!(actions > 0, "action handlers ran through the ACTIONS table");
    assert!(
        drops > 0,
        "a death fired the dropBody hook through the dispatcher"
    );
}

#[test]
fn a_death_fires_drop_body_inside_the_ledger_and_a_leave_between_steps() {
    let runs = all_runs();
    let (_, duel) = runs
        .iter()
        .find(|(n, _)| n == "fists_duel")
        .expect("fists_duel");
    let died_in_tick = duel
        .active_ticks
        .iter()
        .find(|t| t.contains(&TraceEntry::Hook("dropBody", "loot.dropBody")))
        .expect("a death in the duel");
    let at = |e: TraceEntry| died_in_tick.iter().position(|x| *x == e).unwrap();
    assert!(
        at(TraceEntry::Phase("ledger:apply")) < at(TraceEntry::Hook("dropBody", "loot.dropBody"))
            && at(TraceEntry::Hook("dropBody", "loot.dropBody"))
                < at(TraceEntry::Phase("hooks:systems")),
        "dropBody fires where legacy downPlayer calls it: inside the ledger pass"
    );
    let (_, leave) = runs
        .iter()
        .find(|(n, _)| n == "leave_mia")
        .expect("leave_mia");
    assert!(
        leave
            .between
            .contains(&TraceEntry::Hook("dropBody", "loot.dropBody")),
        "a leave in a run counts as a death (MIA) and fires dropBody between steps"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Mutations: the same checks must reject a schedule that is not the legacy one
// ---------------------------------------------------------------------------------------------------------------------

fn rejects(what: &str, mutated: &Tables) {
    let rec = record();
    assert!(
        check_all(mutated, &rec, &backlog_packets()).is_err(),
        "the conformance check accepted: {what}"
    );
}

#[test]
fn a_swapped_phase_row_is_rejected() {
    let mut t = tables();
    let a = t.phases.iter().position(|e| e.legacy == "weapons").unwrap();
    let b = t.phases.iter().position(|e| e.legacy == "melee").unwrap();
    t.phases.swap(a, b);
    rejects("weapons and melee swapped", &t);
    // Adjacent rows too, and the pair legacy comments warn about most (the ledger and the systems).
    for (x, y) in [
        ("markTickStart", "ledger:openWithDeferred"),
        ("ledger:apply", "hooks:systems"),
    ] {
        let mut t = tables();
        let a = t.phases.iter().position(|e| e.legacy == x).unwrap();
        let b = t.phases.iter().position(|e| e.legacy == y).unwrap();
        t.phases.swap(a, b);
        rejects(&format!("{x} and {y} swapped"), &t);
        assert!(check_phases(&t, &record()).is_err());
    }
}

#[test]
fn moving_flush_announcements_before_factions_after_damage_is_rejected() {
    let mut t = tables();
    let from = t
        .systems
        .iter()
        .position(|e| e.legacy == "feed.flushAnnouncements")
        .unwrap();
    let flush = t.systems.remove(from);
    let to = t
        .systems
        .iter()
        .position(|e| e.legacy == "factions.afterDamage")
        .unwrap();
    t.systems.insert(to, flush);
    rejects("flushAnnouncements before factions.afterDamage", &t);
    // The production world is where the order is visible (the capture world has no factions).
    let rec = record();
    assert!(check_lists(&t, &rec, "production", &Gates::PRODUCTION).is_err());
    assert!(check_lists(&t, &rec, "training", &Gates::TRAINING).is_err());
}

#[test]
fn a_dropped_row_is_rejected() {
    let rec = record();
    let packets = backlog_packets();
    let drop = |f: &dyn Fn(&mut Tables)| -> Tables {
        let mut t = tables();
        f(&mut t);
        t
    };
    let cases: Vec<(&str, Tables)> = vec![
        (
            "a phase",
            drop(&|t| drop_row(&mut t.phases, "markTickStart")),
        ),
        (
            "a system",
            drop(&|t| drop_row(&mut t.systems, "buffs.expireBoosts")),
        ),
        (
            "a move modifier",
            drop(&|t| drop_row(&mut t.move_modifiers, "terrainEffects.applyBog")),
        ),
        (
            "a mod source",
            drop(&|t| drop_row(&mut t.mod_sources, "cardHooks.cardSource")),
        ),
        (
            "an after-weapons entry",
            drop(&|t| drop_row(&mut t.after_weapons, "factions.afterWeapons")),
        ),
        (
            "an action",
            drop(&|t| t.actions.retain(|a| a.name != "swap")),
        ),
        (
            "a hook link",
            drop(&|t| chain_mut(t, Hook::RaidStarted).retain(|l| l.legacy != "regen.<arrow>")),
        ),
        (
            "a whole hook",
            drop(&|t| t.hooks.retain(|(h, _)| *h != Hook::Staggered)),
        ),
    ];
    for (what, t) in &cases {
        assert!(
            check_all(t, &rec, &packets).is_err(),
            "accepted: {what} dropped"
        );
    }
}

fn drop_row(rows: &mut Vec<Entry>, name: &str) {
    let n = rows.len();
    rows.retain(|e| e.legacy != name);
    assert_eq!(rows.len(), n - 1, "{name} is a row");
}

fn chain_mut(t: &mut Tables, hook: Hook) -> &mut Vec<LinkEntry> {
    &mut t.hooks.iter_mut().find(|(h, _)| *h == hook).unwrap().1
}

#[test]
fn a_changed_hook_chain_is_rejected() {
    type Mutation = (&'static str, Box<dyn Fn(&mut Tables)>);
    let cases: Vec<Mutation> = vec![
        (
            "two links of a chain swapped",
            Box::new(|t| {
                let c = chain_mut(t, Hook::Teleported);
                let a = c
                    .iter()
                    .position(|l| l.legacy == "chests.clearChests")
                    .unwrap();
                let b = c
                    .iter()
                    .position(|l| l.legacy == "mobLife.resetAllMobs")
                    .unwrap();
                c.swap(a, b);
            }),
        ),
        (
            "the replace link made an append (the default would run)",
            Box::new(|t| {
                for l in chain_mut(t, Hook::DropBody) {
                    if l.legacy == "loot.dropBody" {
                        l.mode = Mode::Append;
                    }
                }
            }),
        ),
        (
            "a quests link ungated",
            Box::new(|t| {
                for l in chain_mut(t, Hook::PlayerKilled) {
                    if l.legacy == "quests.onPlayerKilled" {
                        l.gate = Gate::Always;
                    }
                }
            }),
        ),
        (
            "a link of the wrong module",
            Box::new(|t| {
                for l in chain_mut(t, Hook::HitLanded) {
                    if l.legacy == "fireRoam.onHitLanded" {
                        l.legacy = "factions.onHitLanded";
                    }
                }
            }),
        ),
        (
            "a link the record does not have",
            Box::new(|t| {
                chain_mut(t, Hook::Blocked).push(LinkEntry {
                    legacy: "cardHooks.extra",
                    mode: Mode::Append,
                    gate: Gate::Always,
                    pending: Some("P-CARDS-1"),
                })
            }),
        ),
    ];
    for (what, f) in cases {
        let mut t = tables();
        f(&mut t);
        rejects(what, &t);
    }
}

#[test]
fn a_changed_gate_or_an_invented_packet_is_rejected() {
    let mut t = tables();
    t.systems
        .iter_mut()
        .find(|e| e.legacy == "quests.questSystem")
        .unwrap()
        .gate = Gate::Always;
    rejects("quests.questSystem ungated (training would run it)", &t);
    let mut t = tables();
    t.phases
        .iter_mut()
        .find(|e| e.legacy == "settle")
        .unwrap()
        .gate = Gate::Always;
    rejects("settle ungated", &t);
    let mut t = tables();
    t.systems
        .iter_mut()
        .find(|e| e.legacy == "mobAI.thinkMobs")
        .unwrap()
        .pending = Some("P-NOPE-9");
    rejects("a pending row naming no backlog packet", &t);
}

#[test]
fn an_execution_that_is_not_the_table_is_rejected() {
    // The trace is what the code did; a table in another order (swapped phases, a moved system, a dropped row) is not it.
    let runs = all_runs();
    let check = |t: &Tables| {
        runs.iter()
            .try_for_each(|(_, r)| check_trace(t, &r.active_ticks, &r.gates))
    };
    assert!(check(&tables()).is_ok());

    let mut t = tables();
    let a = t.phases.iter().position(|e| e.legacy == "weapons").unwrap();
    let b = t.phases.iter().position(|e| e.legacy == "melee").unwrap();
    t.phases.swap(a, b);
    assert!(check(&t).is_err(), "swapped phases");

    let mut t = tables();
    drop_row(&mut t.phases, "movement:recordHistory");
    assert!(check(&t).is_err(), "a dropped phase");

    // The systems list under the capture gates: move the one ported system to the front of the list. Its position is
    // visible in the trace only relative to other ported rows, so move the whole `hooks:systems` phase instead.
    let mut t = tables();
    let from = t
        .phases
        .iter()
        .position(|e| e.legacy == "hooks:systems")
        .unwrap();
    let row = t.phases.remove(from);
    let to = t
        .phases
        .iter()
        .position(|e| e.legacy == "ledger:apply")
        .unwrap();
    t.phases.insert(to, row);
    assert!(check(&t).is_err(), "systems before the ledger");
}

fn rs_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    for e in std::fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            rs_files(&p, out);
        } else if p.extension().is_some_and(|x| x == "rs") {
            out.push(p);
        }
    }
}

/// The text of a source file before its first `#[cfg(test)]` (the production code).
fn production_text(text: &str) -> &str {
    match text.find("#[cfg(test)]") {
        Some(at) => &text[..at],
        None => text,
    }
}

/// Every `module::function` the tables name (the phases' bodies, the systems and the action handlers).
fn scheduled_calls(schedule_src: &str) -> BTreeSet<String> {
    const MODS: [&str; 8] = [
        "credit", "inputs", "ledger", "loot", "melee", "movement", "settle", "weapons",
    ];
    let mut out = BTreeSet::new();
    for line in schedule_src.lines().filter(|l| !l.starts_with("use ")) {
        for m in MODS {
            let mut rest = line;
            while let Some(at) = rest.find(&format!("{m}::")) {
                let after = &rest[at + m.len() + 2..];
                // A function starts lowercase (`ledger::Entry` is a type: zero length, skipped).
                let end = after
                    .find(|c: char| !(c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'))
                    .unwrap_or(after.len());
                if end > 0 {
                    out.insert(format!("{m}::{}", &after[..end]));
                }
                rest = after;
            }
        }
    }
    out
}

/// Files of rh-sim's production code that call a scheduled function outside the schedule.
fn offenders(files: &[(String, String)], calls: &BTreeSet<String>) -> Vec<String> {
    let mut out = Vec::new();
    for (name, text) in files {
        if name == "schedule.rs" || name == "tests.rs" {
            continue;
        }
        for c in calls {
            if production_text(text).contains(&format!("{c}(")) {
                out.push(format!("{name}: {c}"));
            }
        }
    }
    out
}

#[test]
fn nothing_but_the_schedule_calls_a_system() {
    // ADR 0009: the tables are the only caller of a ported system, so the order they hold is the order that runs. The
    // trace test cannot see a system called from inside another phase's closure; this guard reads the source.
    let src_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../rh-sim/src");
    let mut paths = Vec::new();
    rs_files(&src_dir, &mut paths);
    let files: Vec<(String, String)> = paths
        .iter()
        .map(|p| {
            (
                p.file_name().unwrap().to_string_lossy().to_string(),
                std::fs::read_to_string(p).unwrap(),
            )
        })
        .collect();
    let schedule = &files.iter().find(|(n, _)| n == "schedule.rs").unwrap().1;
    let calls = scheduled_calls(production_text(schedule));
    for must in [
        "settle::settle",
        "ledger::apply",
        "credit::flush_announcements",
        "movement::walk",
        "weapons::on_attack",
    ] {
        assert!(calls.contains(must), "the scan sees {must}: {calls:?}");
    }
    let bad = offenders(&files, &calls);
    assert!(
        bad.is_empty(),
        "a system is called outside schedule.rs: {bad:?}"
    );
}

#[test]
fn the_call_guard_rejects_a_system_called_from_another_file() {
    let calls = scheduled_calls("ported(\"x\", Gate::Always, |cx| { settle::settle(cx); })");
    assert!(calls.contains("settle::settle"));
    let stray = vec![(
        "melee.rs".to_string(),
        "pub fn f(cx: &mut Cx) { settle::settle(cx); }".to_string(),
    )];
    assert_eq!(offenders(&stray, &calls), vec!["melee.rs: settle::settle"]);
    let in_tests = vec![(
        "melee.rs".to_string(),
        "fn ok() {}\n#[cfg(test)]\nmod t { fn f() { settle::settle(cx); } }".to_string(),
    )];
    assert!(offenders(&in_tests, &calls).is_empty(), "test code may");
}
