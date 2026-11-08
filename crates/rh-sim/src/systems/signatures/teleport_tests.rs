//! Actual-source teleport-reset comparison (`parity/faction/teleport-reset.json`, captured in the pinned Linux x64
//! Node 22.23.4 container by `tools/faction-fixtures/teleport-reset.ts`).
//!
//! The fixture's trusted setup is applied to a `Sim`, read back and compared (the `before` dump), the ported
//! `factions.<arrow>` link is fired through the one hook dispatcher exactly as `coliseum::teleport` fires it, and the
//! `after` dump is compared field by field. The source-only presentation/group fields are asserted from the capture's
//! own after-state (the port has no brand/markTax/group storage; protocol 5 omits those fields and the public
//! projection derives the tier from the surviving mark, ADR 0014). Both ordinary-heal probes are reproduced too: the
//! heal lockout clock survives the reset, the pending heal-over-time steps do not.
use crate::fighter::{Mark, Signature};
use crate::hooks::{fire, HookArgs, Hx};
use crate::{
    arenas::practice_arena, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2,
};
use serde_json::{json, Value};

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../../../parity/faction/teleport-reset.json"
    ))
    .expect("the captured teleport-reset fixture parses")
}

fn pid(name: &str) -> PlayerId {
    PlayerId(name[1..].parse::<u32>().expect("pN name") + 1)
}

fn name(id: PlayerId) -> String {
    format!("p{}", id.0 - 1)
}

fn option_name(v: &Value) -> Option<PlayerId> {
    v.as_str().map(pid)
}

fn signature_kind(s: &str) -> crate::factions::SignatureKind {
    crate::factions::SignatureKind::ALL
        .into_iter()
        .find(|k| k.as_str() == s)
        .expect("a captured signature kind")
}

fn card(name: &str) -> crate::cards::CardId {
    crate::cards::CardId::ALL
        .into_iter()
        .find(|c| c.as_str() == name)
        .expect("a captured card id")
}

/// Every JSON number as a binary64, so `400` and `400.0` compare equal (the capture writes JS numbers).
fn numbers(v: &mut Value) {
    match v {
        Value::Number(n) => *v = json!(n.as_f64().expect("finite captured number")),
        Value::Array(a) => a.iter_mut().for_each(numbers),
        Value::Object(o) => o.values_mut().for_each(numbers),
        _ => {}
    }
}

/// A captured dump without the source-only fields the port does not store (they are asserted separately).
fn expected_dump(v: &Value) -> Value {
    let mut out = v.clone();
    for player in out["players"].as_array_mut().expect("players") {
        let m = player.as_object_mut().expect("a player object");
        for key in [
            "markGroup",
            "markGroupSize",
            "brand",
            "markTier",
            "markBy",
            "markTax",
            "wireFrostMoveMult",
        ] {
            m.remove(key);
        }
    }
    numbers(&mut out);
    out
}

fn strip_positions(v: &mut Value) {
    for p in v["players"].as_array_mut().expect("players") {
        let m = p.as_object_mut().expect("player");
        m.remove("x");
        m.remove("y");
    }
}

fn dump(sim: &Sim) -> Value {
    let players: Vec<Value> = sim
        .w
        .players
        .iter()
        .map(|p| {
            let s = &p.signature;
            let m = &s.mark;
            let chillers: Vec<String> = (0..usize::from(s.chiller_count))
                .map(|i| name(s.chillers[i].expect("dense Frost sources")))
                .collect();
            let fired: Vec<&str> = p.card_fired.iter().map(|c| c.as_str()).collect();
            json!({
                "id": name(p.id),
                "target": s.target.map(name),
                "inReach": s.in_reach,
                "engaged": s.engaged,
                "reachAt": s.reach_at,
                "contactAt": s.contact_at,
                "combatAt": s.combat_at,
                "hpFrac": s.hp_frac,
                "tier": m.tier,
                "markHits": m.hits,
                "markProgress": m.progress,
                "markSwaps": m.swaps,
                "markDenied": m.denied,
                "farSince": m.far_since,
                "ampUntil": m.amp_until,
                "chill": s.chill,
                "chillers": chillers,
                "exposureStartedAt": s.exposure_started_at,
                "chillLastNearAt": s.last_near_at,
                "rangedChillUntil": s.ranged_chill_until,
                "frostMoveMult": s.frost_move_mult,
                "dotPausedUntil": s.dot_paused_until,
                "engagedOn": s.engaged_on.map(name),
                "apHits": s.ap_hits.len(),
                "bits": s.bits,
                "hp": p.vitals.hp,
                "readyAt": p.weapon.ready_at,
                "x": p.body.x,
                "y": p.body.y,
                "fired": fired,
                "hots": p.card_hots.len(),
            })
        })
        .collect();
    let mut out = json!({
        "players": players,
        "dotSince": sim.w.factions.dot_since,
        "dot": sim.w.factions.dot.iter().map(|b| json!({
            "victim": name(b.victim),
            "by": name(b.by),
            "sig": b.sig.as_str(),
            "weapon": b.weapon.map(crate::content::WeaponId::as_str),
            "amount": b.amount,
        })).collect::<Vec<_>>(),
    });
    numbers(&mut out);
    out
}

/// Applies the fixture's trusted setup to a fresh full-faction run.
fn build(case: &Value) -> Sim {
    let setup = &case["setup"];
    let placements: Vec<Placement> = setup["players"]
        .as_array()
        .expect("setup players")
        .iter()
        .map(|p| Placement {
            profile: p["id"].as_str().expect("player id").into(),
            faction: match p["faction"].as_str().expect("faction") {
                "sentenced" => FactionId::Sentenced,
                "holy" => FactionId::Holy,
                "frost" => FactionId::Frost,
                other => panic!("unexpected faction {other}"),
            },
            bot: false,
            at: Vec2::new(
                p["at"]["x"].as_f64().expect("x"),
                p["at"]["y"].as_f64().expect("y"),
            ),
            hp: Some(p["hp"].as_f64().expect("hp")),
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let mut sim = Sim::reset_active(
        SimConfig {
            faction_mode: crate::FactionMode::EngagementHolyPlagueFireFrostSentenced,
            ..Default::default()
        },
        practice_arena(),
        Secrets::from_seed(12),
        &placements,
    );
    sim.w.server_time = setup["serverTime"].as_f64().expect("server time");
    sim.w.tick = setup["tick"].as_u64().expect("tick") as u32;
    for p in setup["players"].as_array().expect("players") {
        let id = pid(p["id"].as_str().expect("player id"));
        let ix = sim.w.idx(id).expect("a placed player");
        let g = &p["sig"];
        let mut sig = Signature {
            target: option_name(&g["target"]),
            in_reach: g["inReach"].as_bool().expect("in reach"),
            engaged: g["engaged"].as_bool().expect("engaged"),
            reach_at: g["reachAt"].as_f64(),
            contact_at: g["contactAt"].as_f64(),
            combat_at: g["combatAt"].as_f64(),
            hp_frac: g["hpFrac"].as_f64().expect("hp fraction"),
            mark: Mark {
                tier: g["tier"].as_u64().expect("tier") as u8,
                hits: g["markHits"].as_u64().expect("mark hits"),
                progress: g["markProgress"].as_f64().expect("mark progress"),
                swaps: g["markSwaps"].as_u64().expect("mark swaps"),
                denied: g["markDenied"].as_bool().expect("mark denied"),
                far_since: g["farSince"].as_f64(),
                amp_until: g["ampUntil"].as_f64().expect("amplifier clock"),
            },
            chill: g["chill"].as_f64().expect("chill"),
            exposure_started_at: g["exposureStartedAt"].as_f64(),
            last_near_at: g["chillLastNearAt"].as_f64(),
            ranged_chill_until: g["rangedChillUntil"].as_f64(),
            frost_move_mult: g["frostMoveMult"].as_f64().expect("Frost move multiplier"),
            dot_paused_until: g["dotPausedUntil"].as_f64().expect("DoT pause clock"),
            engaged_on: option_name(&g["engagedOn"]),
            // The legacy synced `sig` bits are the port's stored bits; the reset clears only the mark-derived bit
            // (64) in the ported domain, exactly as the source clears taxed/suppressed/exec-blocked and keeps the rest.
            bits: p["wire"]["sig"].as_u64().expect("captured synced bits") as u8,
            ..Default::default()
        };
        for (i, source) in g["chillers"]
            .as_array()
            .expect("chillers")
            .iter()
            .enumerate()
        {
            sig.chillers[i] = Some(pid(source.as_str().expect("Frost source")));
            sig.chiller_count += 1;
        }
        let ap_hits = g["apHits"].as_u64().expect("AP hit count") as usize;
        if ap_hits > 0 {
            sig.ap_hits.note(
                option_name(&g["target"]).expect("AP hits need a target"),
                sim.w.server_time,
                ap_hits,
            );
        }
        let core = sim.w.core_mut(crate::fighter::FighterIx::of_slot(ix));
        core.signature = sig;
        core.vitals.hp = p["hp"].as_f64().expect("hp");
        core.weapon.ready_at = p["readyAt"].as_f64().expect("ready clock");
        sim.w.players[ix].card_fired = p["fired"]
            .as_array()
            .expect("fired keys")
            .iter()
            .map(|c| card(c.as_str().expect("card id")))
            .collect();
    }
    for d in setup["dot"].as_array().expect("dot buckets") {
        sim.w.factions.dot.push(crate::factions::DotBucket {
            victim: pid(d["victim"].as_str().expect("victim")),
            by: pid(d["by"].as_str().expect("source")),
            sig: signature_kind(d["sig"].as_str().expect("signature")),
            weapon: d["weapon"]
                .as_str()
                .map(|w| crate::content::WeaponId::parse(w).expect("a captured weapon")),
            amount: d["amount"].as_f64().expect("amount"),
        });
    }
    sim.w.factions.dot_since = setup["dotSince"].as_f64().expect("dot flush clock");
    if let Some(hot) = setup["hot"].as_object() {
        let ix = sim
            .w
            .idx(pid(hot["id"].as_str().expect("hot id")))
            .expect("a placed player");
        let mut ev = Vec::new();
        crate::systems::heal::start_over_time(
            &mut sim.w,
            &mut ev,
            ix,
            hot["amount"].as_f64().expect("hot amount"),
            hot["ms"].as_f64().expect("hot duration"),
            hot["ignoreLockout"].as_bool().expect("hot lockout flag"),
        );
    }
    sim
}

/// The link as `coliseum::teleport` fires it: through the one dispatcher, with the same typed arguments.
fn fire_teleported(sim: &mut Sim) -> Vec<crate::Event> {
    let mut ev = Vec::new();
    let mut hx = Hx {
        stats: crate::status_runtime::stats::Inputs::default(),
        fx: None,
        k: &sim.k,
        w: &mut sim.w,
        ev: &mut ev,
    };
    fire(&mut hx, HookArgs::Teleported);
    ev
}

fn source_wire_after(case: &Value) -> Result<(), String> {
    for (before, after) in case["before"]["players"]
        .as_array()
        .expect("before players")
        .iter()
        .zip(case["after"]["players"].as_array().expect("after players"))
    {
        for (key, want) in [
            ("brand", json!(0)),
            ("markTier", json!(0)),
            ("markBy", json!("")),
            ("markTax", json!(0)),
            ("wireFrostMoveMult", json!(1000)),
            ("markGroup", Value::Null),
            ("markGroupSize", json!(1)),
        ] {
            if after[key] != want {
                return Err(format!(
                    "{}: source {key} is {} after the teleport, want {want}",
                    after["id"], after[key]
                ));
            }
        }
        // resetAll keeps the non-mark bits of the synced `sig` (the capture's `bits`) and clears only
        // taxed/suppressed/exec-blocked (64 here).
        let want_bits = before["bits"].as_u64().expect("bits") & !64;
        if after["bits"] != json!(want_bits) {
            return Err(format!(
                "{}: synced bits after the teleport are {}, want {want_bits}",
                after["id"], after["bits"]
            ));
        }
    }
    Ok(())
}

fn check_case(case: &Value) -> Result<(), String> {
    let mut sim = build(case);
    let before = dump(&sim);
    let want_before = expected_dump(&case["before"]);
    if before != want_before {
        return Err(format!(
            "before dump differs: got {before} want {want_before}"
        ));
    }
    let emitted = fire_teleported(&mut sim);
    let after = dump(&sim);
    let mut want_after = expected_dump(&case["after"]);
    let skip_positions = case["positionsAfter"].as_str() == Some("teleport");
    if skip_positions {
        let mut got = after.clone();
        strip_positions(&mut got);
        strip_positions(&mut want_after);
        if got != want_after {
            return Err(format!(
                "after dump differs (teleported positions skipped): got {got} want {want_after}"
            ));
        }
    } else if after != want_after {
        return Err(format!("after dump differs: got {after} want {want_after}"));
    }
    let expected_events: Vec<&str> = case["emitted"]
        .as_array()
        .expect("emitted events")
        .iter()
        .map(|e| e.as_str().expect("event name"))
        .collect();
    let got_events: Vec<&str> = emitted
        .iter()
        .map(|e| match e {
            crate::Event::Teleported => "teleport",
            _ => "other",
        })
        .collect();
    // The capture records the whole producer call (it appends its own `fx` teleport event after the chain); the Rust
    // side fires the chain alone, so it must emit nothing (the source reset does not flush the dropped DoT buckets).
    if skip_positions {
        if expected_events != ["fx"] {
            return Err(format!(
                "the producer capture recorded {expected_events:?}, want [\"fx\"]"
            ));
        }
        if !got_events.is_empty() {
            return Err(format!("the link emitted {got_events:?}, want none"));
        }
    } else if !got_events.is_empty() || !expected_events.is_empty() {
        return Err(format!(
            "the hook emitted {got_events:?}, the capture emitted {expected_events:?}, want none"
        ));
    }
    source_wire_after(case)?;
    // The two ordinary-heal probes: the kept combatAt still refuses an ordinary heal inside 3 s, then allows it.
    let heal = &case["heal"];
    let target = sim
        .w
        .idx(pid(heal["id"].as_str().expect("heal target")))
        .expect("a placed player");
    let amount = heal["amount"].as_f64().expect("heal amount");
    let mut ev = Vec::new();
    let within = crate::systems::heal::apply(
        &mut sim.w,
        &mut ev,
        target,
        amount,
        crate::systems::heal::Kind::Ordinary,
    );
    sim.w.server_time += heal["advanceMs"].as_f64().expect("heal advance");
    let after_lockout = crate::systems::heal::apply(
        &mut sim.w,
        &mut ev,
        target,
        amount,
        crate::systems::heal::Kind::Ordinary,
    );
    let want_within = heal["withinLockout"].as_f64().expect("within-lockout heal");
    let want_after = heal["afterLockout"].as_f64().expect("after-lockout heal");
    if (within - want_within).abs() > f64::EPSILON {
        return Err(format!(
            "heal inside the lockout is {within}, want {want_within}"
        ));
    }
    if (after_lockout - want_after).abs() > f64::EPSILON {
        return Err(format!(
            "heal after the lockout is {after_lockout}, want {want_after}"
        ));
    }
    Ok(())
}

fn untiered_signature(sim: &mut Sim, id: PlayerId, target: PlayerId, now: f64) {
    let ix = sim.w.idx(id).expect("a placed player");
    let sig = &mut sim.w.players[ix].signature;
    sig.target = Some(target);
    sig.contact_at = Some(now);
    sig.combat_at = Some(now);
    sig.mark.tier = 3;
    sig.mark.hits = 3;
    sig.mark.progress = 3.;
    sig.bits = crate::constants::SIG_BURNING;
}

#[test]
fn actual_installed_source_teleport_reset_matches() {
    let fx = fixture();
    assert_eq!(fx["format"], "rh-faction-teleport-reset/1");
    assert_eq!(
        fx["kind"],
        "trusted private faction setup; actual installed teleported chain (or actual coliseum producer); not ordinary gameplay intake"
    );
    assert_eq!(fx["provenance"]["node"], "v22.23.4");
    assert_eq!(fx["provenance"]["platform"], "linux");
    assert_eq!(fx["provenance"]["arch"], "x64");
    let modules: Vec<&str> = fx["modules"]
        .as_array()
        .expect("module list")
        .iter()
        .map(|m| m.as_str().expect("module name"))
        .collect();
    let want = [
        "loot",
        "weapons",
        "targeting",
        "projectiles",
        "factions",
        "mobs",
        "buffs",
        "feed",
        "camps",
        "chests",
        "killAugments",
        "mobLife",
        "mobAI",
        "terrainEffects",
        "regen",
        "abilities",
        "quests",
        "vision",
        "campHeal",
        "traders",
        "cardHooks",
        "mods",
    ];
    assert_eq!(
        modules, want,
        "the explicit installer list is the captured one"
    );
    let cases = fx["cases"].as_array().expect("cases");
    assert_eq!(cases.len(), 3);
    let names: Vec<&str> = cases.iter().map(|c| c["name"].as_str().unwrap()).collect();
    assert_eq!(
        names,
        [
            "marked_chilled_locked",
            "clear_fighters",
            "producer_teleport"
        ]
    );
    for case in cases {
        check_case(case).unwrap_or_else(|e| panic!("{}: {e}", case["name"]));
    }
}

#[test]
fn the_mutation_guard_sees_a_changed_cleared_field() {
    let mut case = fixture()["cases"][0].clone();
    case["after"]["players"][0]["tier"] = json!(1);
    assert!(
        check_case(&case).is_err(),
        "a surviving mark tier is caught"
    );
    let mut case = fixture()["cases"][0].clone();
    case["after"]["dot"] = json!([{
        "victim": "p1",
        "by": "p0",
        "sig": "mark",
        "weapon": "fists",
        "amount": 12.5,
    }]);
    assert!(
        check_case(&case).is_err(),
        "a surviving DoT bucket is caught"
    );
    let mut case = fixture()["cases"][1].clone();
    case["heal"]["afterLockout"] = json!(0);
    assert!(
        check_case(&case).is_err(),
        "the kept heal lockout is caught"
    );
}

/// The ported producer call site: with a source lifecycle configured, the settle phase teleports and fires the same
/// dispatcher the link hangs off. A production run may not configure this combination yet (the world is the explicit
/// partial faction foundation, and its admission gate stays closed); the chain the producer reaches is ported and
/// compared against the pinned capture above.
#[test]
fn the_coliseum_producer_runs_the_reset_link() {
    let mut sim = Sim::new(
        SimConfig {
            faction_mode: crate::FactionMode::EngagementHolyPlagueFireFrostSentenced,
            min_players: 2,
            fill_seconds: 0.,
            ..Default::default()
        },
        practice_arena(),
        Secrets::from_seed(12),
    );
    sim.add_player("p0", Some(FactionId::Sentenced), false)
        .expect("join p0");
    sim.add_player("p1", Some(FactionId::Holy), false)
        .expect("join p1");
    sim.step();
    // Admitted worlds cannot combine the source lifecycle with faction modes yet; mutate the statics in this test only,
    // after admission, to reach the ported producer call site with the ported consumer chain installed.
    sim.k.config.lifecycle = crate::ArenaMode::Source(crate::ArenaRules {
        plan_seconds: 0.,
        ..Default::default()
    });
    let now = sim.w.server_time;
    untiered_signature(&mut sim, PlayerId(1), PlayerId(2), now);
    sim.w.players[1]
        .card_fired
        .push(crate::cards::CardId::SecondWind);
    sim.w.players[1].card_hots.push(crate::cards::Hot {
        next: now + 500.,
        left: 2,
        amount: 5.,
        ignore_lockout: true,
    });
    sim.w.factions.dot.push(crate::factions::DotBucket {
        victim: PlayerId(2),
        by: PlayerId(1),
        sig: crate::factions::SignatureKind::Mark,
        weapon: None,
        amount: 4.5,
    });
    sim.w.factions.dot_since = now;
    sim.w.rt.patience_ends_at = Some(now);
    let events = sim.step();
    assert!(
        events.contains(&crate::Event::Teleported),
        "the settle phase fired the source producer: {events:?}"
    );
    assert!(sim.w.rt.in_coliseum, "the producer locked the gates");
    let sig = &sim.w.players[0].signature;
    assert_eq!(sig.target, None, "the teleport forgot every target");
    assert_eq!(sig.mark.tier, 0, "the teleport ended every mark");
    assert_eq!(sig.chill, 1., "the teleport took off the chill");
    // The after-damage sync in this step rebuilt the synced bits before the settle-phase teleport, so the preset
    // SIG_BURNING is already gone: the preserved-bit behaviour is covered by the raw-hook capture case above.
    assert_eq!(sig.bits, 0, "the teleport leaves no synced bits behind");
    assert_eq!(
        sig.combat_at,
        Some(now),
        "the heal lockout clock keeps running"
    );
    assert!(
        sim.w.factions.dot.is_empty(),
        "pending DoT buckets are dropped"
    );
    assert_eq!(sim.w.factions.dot_since, sim.w.server_time);
    assert!(
        sim.w.players[1].card_hots.is_empty(),
        "pending heal-over-time steps are dropped"
    );
    assert_eq!(
        sim.w.players[1].card_fired,
        vec![crate::cards::CardId::SecondWind],
        "rearmTriggers forgets only a rearm-teleport row, and the shipped catalog has none"
    );
}
