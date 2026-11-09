//! Actual-source Overkill consumer: five pinned source cases exercise the real native ledger and compare the
//! observed pre/post vitals, hook order and Overkill arguments. The typed probe is feature-gated, read-only and outside
//! canonical state/hash/restore.
use crate::status_runtime::probe::{HookRecord, OverkillProbe};
use crate::{Arena, FactionId, PlayerId, RawCommand, Sim, SimConfig, WeaponId};
use serde_json::{json, Value as V};

fn corpus() -> V {
    serde_json::from_str(include_str!(
        "../../../../../parity/overkill-producer/source.json"
    ))
    .unwrap()
}

fn seed1_arena() -> Arena {
    let export: crate::mapdata::MapExport = serde_json::from_str(include_str!(
        "../../../../../tools/ability-fixtures/seed1-input.json"
    ))
    .unwrap();
    export.validate().unwrap().into_arena().unwrap()
}

fn config() -> SimConfig {
    SimConfig {
        training: false,
        dummies: false,
        min_players: 4,
        lobby_seconds: 30.,
        fill_seconds: 0.,
        pvp_rules: false,
        quests: false,
        initial_loot: true,
        consumables: true,
        regen: false,
        hazards: crate::terrain::Mode::Map,
        abilities: crate::abilities::Mode::Full,
        lifecycle: crate::ArenaMode::Source(crate::ArenaRules {
            plan_seconds: 0.,
            patience_seconds: 3600.,
            patience_min_seconds: 3600.,
            sudden_death_seconds: 3600.,
            ..Default::default()
        }),
        mob_mode: crate::mob_runtime::MobMode::Off,
        faction_mode: crate::statics::FactionMode::EngagementHolyPlagueFireFrostSentenced,
        ..Default::default()
    }
}

fn scene(case: &V) -> Sim {
    let input = &case["input"];
    let mut sim = Sim::try_new(config(), seed1_arena(), crate::Secrets::from_seed(12)).unwrap();
    for p in input["players"].as_array().unwrap() {
        let faction = FactionId::parse(p["faction"].as_str().unwrap()).unwrap();
        sim.add_player(p["name"].as_str().unwrap(), Some(faction), false)
            .unwrap();
    }
    sim.step();
    assert_eq!(sim.phase(), crate::Phase::Active);
    let start = &case["frames"][0]["world"]["players"];
    for (i, p) in start.as_array().unwrap().iter().enumerate() {
        let now = sim.w.server_time;
        let core = &mut sim.w.players[i].core;
        core.body.x = p["x"].as_f64().unwrap();
        core.body.y = p["y"].as_f64().unwrap();
        core.body.history.reset(crate::state::Sample {
            t: now,
            x: core.body.x,
            y: core.body.y,
        });
        core.vitals.hp = p["hp"].as_f64().unwrap();
        core.vitals.max_hp = p["maxHp"].as_f64().unwrap();
        core.vitals.barrier = p["barrier"].as_f64().unwrap();
    }
    #[cfg(feature = "trusted-status-probes")]
    {
        sim.w.trace.1.enabled = true;
    }
    sim
}

fn slot(label: &str) -> (usize, PlayerId) {
    let i = label[1..].parse::<usize>().unwrap();
    (i, PlayerId((i + 1) as u32))
}

fn source_id(label: &str) -> Option<PlayerId> {
    label
        .strip_prefix('p')
        .map(|n| PlayerId(n.parse::<u32>().unwrap() + 1))
}

fn typed_weapon(label: &str) -> Option<WeaponId> {
    if label.is_empty() {
        return None;
    }
    let mut chars = label.chars();
    let typed = chars.next().unwrap().to_uppercase().collect::<String>() + chars.as_str();
    Some(serde_json::from_value(json!(typed)).unwrap())
}

fn lower_debug<T: std::fmt::Debug>(value: &Option<T>) -> Option<String> {
    value.as_ref().map(|v| format!("{v:?}").to_lowercase())
}

fn approx(actual: f64, expected: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= 1e-6,
        "{label}: {actual} != source {expected}"
    );
}

fn apply_actions(sim: &mut Sim, actions: &[V]) {
    for a in actions {
        match a["kind"].as_str().unwrap() {
            "setHp" => {
                let (i, _) = slot(&format!("p{}", a["actor"].as_u64().unwrap()));
                sim.w.players[i].vitals.hp = a["hp"].as_f64().unwrap();
                if let Some(max) = a["maxHp"].as_f64() {
                    sim.w.players[i].vitals.max_hp = max;
                }
            }
            "weapon" => {
                let (i, _) = slot(&format!("p{}", a["actor"].as_u64().unwrap()));
                sim.w.players[i].weapon.weapon0 = typed_weapon(a["weapon"].as_str().unwrap());
                sim.w.players[i].weapon.weapon1 = None;
                sim.w.players[i].weapon.slot = 0;
            }
            "place" => {
                let (i, _) = slot(&format!("p{}", a["actor"].as_u64().unwrap()));
                let now = sim.w.server_time;
                let p = &mut sim.w.players[i].core;
                p.body.x = a["x"].as_f64().unwrap();
                p.body.y = a["y"].as_f64().unwrap();
                p.body.history.reset(crate::state::Sample {
                    t: now,
                    x: p.body.x,
                    y: p.body.y,
                });
                p.motion.slip = None;
            }
            "grantCard" => {
                let (_, id) = slot(&format!("p{}", a["actor"].as_u64().unwrap()));
                let card: crate::cards::CardId = serde_json::from_value(json!(a["card"])).unwrap();
                assert!(crate::cards::grant(&sim.k, &mut sim.w, id, card));
            }
            "heal" => {
                let (i, _) = slot(&format!("p{}", a["actor"].as_u64().unwrap()));
                let mut ev = Vec::new();
                let gained = crate::systems::heal::apply(
                    &mut sim.w,
                    &mut ev,
                    i,
                    a["amount"].as_f64().unwrap(),
                    crate::systems::heal::Kind::IgnoreLockout,
                );
                approx(
                    gained,
                    a["gained"].as_f64().unwrap(),
                    "declared source heal helper",
                );
            }
            "input" if a["type"] == "attack" => {
                let (i, id) = slot(&format!("p{}", a["actor"].as_u64().unwrap()));
                let target = a["payload"]["target"].as_str().unwrap();
                let (ti, _) = slot(target);
                let s = &sim.w.players[i];
                let t = &sim.w.players[ti];
                let angle = crate::math::atan2(t.body.y - s.body.y, t.body.x - s.body.x);
                let cmd = crate::validate(RawCommand::Attack { a: angle, t: None }).unwrap();
                sim.submit_unbudgeted(id, cmd)
                    .expect("ordinary attack command");
            }
            other => panic!("unsupported overkill fixture action {other}"),
        }
    }
}

fn expected_frame<'a>(case: &'a V, label: &str) -> &'a V {
    case["frames"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["label"] == label)
        .unwrap()
}

fn compare_players(label: &str, expected: &V, sim: &Sim) {
    let players = expected["world"]["players"].as_array().unwrap();
    assert_eq!(players.len(), sim.w.players.len(), "{label}: player count");
    for (i, e) in players.iter().enumerate() {
        let p = &sim.w.players[i];
        approx(
            p.vitals.hp,
            e["hp"].as_f64().unwrap(),
            &format!("{label}/p{i}/hp"),
        );
        approx(
            p.vitals.barrier,
            e["barrier"].as_f64().unwrap(),
            &format!("{label}/p{i}/barrier"),
        );
        approx(
            p.vitals.max_hp,
            e["maxHp"].as_f64().unwrap(),
            &format!("{label}/p{i}/maxHp"),
        );
        assert_eq!(
            format!("{:?}", p.status).to_lowercase(),
            e["status"].as_str().unwrap(),
            "{label}/p{i}/status"
        );
        assert_eq!(
            lower_debug(&p.weapon.weapon0),
            typed_weapon(e["weapon0"].as_str().unwrap())
                .as_ref()
                .map(|w| format!("{w:?}").to_lowercase()),
            "{label}/p{i}/weapon0"
        );
        approx(
            p.body.x,
            e["x"].as_f64().unwrap(),
            &format!("{label}/p{i}/x"),
        );
        approx(
            p.body.y,
            e["y"].as_f64().unwrap(),
            &format!("{label}/p{i}/y"),
        );
    }
}

fn compare_overkill(expected: &V, actual: &[OverkillProbe]) {
    let expected = expected["hooks"]["overkilled"].as_array().unwrap();
    assert_eq!(actual.len(), expected.len(), "Overkill hook count");
    for (want, got) in expected.iter().zip(actual) {
        assert_eq!(got.tick, want["tick"].as_u64().unwrap() as u32);
        approx(got.time, want["time"].as_f64().unwrap(), "overkilled/time");
        assert_eq!(
            Some(got.victim),
            source_id(want["victim"].as_str().unwrap())
        );
        approx(got.overkill, want["overkill"].as_f64().unwrap(), "overkill");
        approx(got.total, want["total"].as_f64().unwrap(), "total");
        let want_hits = want["hits"].as_array().unwrap();
        assert_eq!(got.hits.len(), want_hits.len(), "Overkill hit count");
        for (wh, gh) in want_hits.iter().zip(&got.hits) {
            assert_eq!(Some(gh.victim), source_id(wh["victim"].as_str().unwrap()));
            assert_eq!(gh.by, source_id(wh["by"].as_str().unwrap()));
            approx(gh.amount, wh["amount"].as_f64().unwrap(), "hit/amount");
            approx(gh.raw, wh["raw"].as_f64().unwrap(), "hit/raw");
            assert_eq!(
                lower_debug(&gh.weapon),
                Some(wh["weapon"].as_str().unwrap().to_owned())
            );
            assert_eq!(gh.arena, wh["arena"].as_bool().unwrap());
            assert_eq!(lower_debug(&gh.sig), wh["sig"].as_str().map(str::to_owned));
            assert_eq!(
                lower_debug(&gh.ability),
                wh["ability"].as_str().map(str::to_owned)
            );
        }
    }
}

fn compare_producer_order(expected: &V, sim: &Sim) {
    let want: Vec<_> = expected["hooks"]["hookOrder"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|h| {
            matches!(
                h["hook"].as_str().unwrap(),
                "hitLanded" | "overkilled" | "hurt" | "fighterOut" | "staggered"
            )
        })
        .map(|h| {
            (
                h["hook"].as_str().unwrap().to_owned(),
                h["tick"].as_u64().unwrap() as u32,
                h["time"].as_f64().unwrap(),
            )
        })
        .collect();
    let got: Vec<_> = sim
        .w
        .trace
        .1
        .invocations
        .iter()
        .filter(|i| {
            matches!(
                i.name,
                "hitLanded" | "overkilled" | "hurt" | "fighterOut" | "staggered"
            )
        })
        .map(|i| (i.name.to_owned(), i.tick, i.time))
        .collect();
    assert_eq!(got, want, "producer hook order");
}

fn compare_records(expected: &V, sim: &Sim) {
    let records = &sim.w.trace.1.records;
    let native_over: Vec<_> = records
        .iter()
        .filter(|r| matches!(r, HookRecord::HitLanded { .. }))
        .collect();
    let wanted_hits: Vec<_> = expected["hooks"]["hitLanded"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|h| h["hook"] == "hitLanded")
        .collect();
    assert_eq!(
        native_over.len(),
        wanted_hits.len(),
        "hitLanded record count"
    );
    for (want, got) in wanted_hits.iter().zip(native_over) {
        let HookRecord::HitLanded { hit, amount } = got else {
            unreachable!()
        };
        let e = &want["entry"];
        assert_eq!(hit.source.id, source_id(e["by"].as_str().unwrap()));
        assert_eq!(Some(hit.victim), source_id(e["victim"].as_str().unwrap()));
        approx(
            hit.packet.raw,
            e["raw"].as_f64().unwrap(),
            "hitLanded/entry raw",
        );
        approx(
            *amount,
            want["amount"].as_f64().unwrap(),
            "hitLanded/amount",
        );
        assert_eq!(
            lower_debug(&hit.weapon),
            Some(e["weapon"].as_str().unwrap().to_owned())
        );
        assert_eq!(hit.arena, e["arena"].as_bool().unwrap());
        assert_eq!(lower_debug(&hit.sig), e["sig"].as_str().map(str::to_owned));
        assert_eq!(
            lower_debug(&hit.ability),
            e["ability"].as_str().map(str::to_owned)
        );
    }
    let wanted_hurt = expected["hooks"]["hurt"].as_array().unwrap();
    let native_hurt: Vec<_> = records
        .iter()
        .filter_map(|r| match r {
            HookRecord::Hurt {
                actor,
                amount,
                before,
            } => Some((actor.id, *amount, *before)),
            _ => None,
        })
        .collect();
    assert_eq!(native_hurt.len(), wanted_hurt.len(), "hurt record count");
    for (want, got) in wanted_hurt.iter().zip(native_hurt) {
        assert_eq!(Some(got.0), source_id(want["actor"].as_str().unwrap()));
        approx(got.1, want["args"][0].as_f64().unwrap(), "hurt/amount");
        approx(got.2, want["args"][1].as_f64().unwrap(), "hurt/before");
    }
    let wanted_out = expected["hooks"]["fighterOut"].as_array().unwrap();
    let native_out: Vec<_> = records
        .iter()
        .filter_map(|r| match r {
            HookRecord::FighterOut { id, .. } => Some(*id),
            _ => None,
        })
        .collect();
    assert_eq!(native_out.len(), wanted_out.len(), "fighterOut count");
    for (want, got) in wanted_out.iter().zip(native_out) {
        assert_eq!(Some(got), source_id(want["actor"].as_str().unwrap()));
    }
    let wanted_stagger = expected["hooks"]["staggered"].as_array().unwrap();
    let native_stagger: Vec<_> = records
        .iter()
        .filter_map(|r| match r {
            HookRecord::Staggered { actor } => Some(*actor),
            _ => None,
        })
        .collect();
    assert_eq!(
        native_stagger.len(),
        wanted_stagger.len(),
        "staggered count"
    );
    for (want, got) in wanted_stagger.iter().zip(native_stagger) {
        assert_eq!(Some(got), source_id(want["actor"].as_str().unwrap()));
    }
}

#[test]
fn actual_source_overkill_arithmetic_filter_and_raw() {
    let c = corpus();
    for case in c["cases"].as_array().unwrap() {
        let input = &case["input"];
        let mut sim = scene(case);
        apply_actions(&mut sim, case["actions"].as_array().unwrap());
        compare_players("attack", expected_frame(case, "attack"), &sim);
        let after_tick = expected_frame(case, "after")["tick"].as_u64().unwrap() as u32;
        let mut over = Vec::new();
        while sim.tick() < after_tick {
            let mut ev = Vec::new();
            sim.w.trace.1.overkilled.clear();
            sim.step_into(&mut ev);
            over.append(&mut sim.w.trace.1.overkilled.clone());
        }
        let name = input["name"].as_str().unwrap();
        let after = expected_frame(case, "after");
        compare_players(name, after, &sim);
        compare_overkill(after, &over);
        compare_records(after, &sim);
        compare_producer_order(after, &sim);
        if input["name"] == "barrier-absorbs-no-hp-damage" {
            assert!(over.is_empty(), "no-hook negative");
            assert!(!sim
                .w
                .trace
                .1
                .invocations
                .iter()
                .any(|i| i.name == "overkilled"));
        }
    }
}

#[test]
fn typed_probe_is_disabled_by_default_and_noninterfering() {
    let c = corpus();
    let case = &c["cases"][0];
    let actions = case["actions"].as_array().unwrap();
    let after_tick = expected_frame(case, "after")["tick"].as_u64().unwrap() as u32;
    let mut enabled = scene(case);
    enabled.w.trace.1.enabled = true;
    apply_actions(&mut enabled, actions);
    let mut disabled = scene(case);
    disabled.w.trace.1.enabled = false;
    apply_actions(&mut disabled, actions);
    let mut saw_overkill = false;
    while enabled.tick() < after_tick {
        let mut ev = Vec::new();
        let mut ev2 = Vec::new();
        enabled.w.trace.1.overkilled.clear();
        disabled.w.trace.1.overkilled.clear();
        enabled.step_into(&mut ev);
        disabled.step_into(&mut ev2);
        assert_eq!(ev, ev2, "probe must not change emitted events");
        saw_overkill |= !enabled.w.trace.1.overkilled.is_empty();
        // The next step clears the per-step diagnostic vector; the disabled probe never records.
        assert!(disabled.w.trace.1.overkilled.is_empty());
        assert!(disabled.w.trace.1.records.is_empty());
        assert!(disabled.w.trace.1.invocations.is_empty());
    }
    assert_eq!(enabled.state_hash(), disabled.state_hash());
    assert!(saw_overkill, "enabled probe observed the real kill");
}

#[test]
fn overkill_predicate_boundary_unit_only() {
    // Pure native predicate behavior at the source 1e-9 threshold. Source producers did not reach this boundary; this is
    // a labelled unit check, not a captured-source equality claim.
    let eps = crate::constants::OVERKILL_EPS;
    for (excess, expected) in [
        (-eps, false),
        (0.0, false),
        (f64::from_bits(eps.to_bits() - 1), false),
        (eps, false),
        (f64::from_bits(eps.to_bits() + 1), true),
        (2.0 * eps, true),
    ] {
        assert_eq!(super::overkill_fires(excess), expected, "excess {excess:?}");
    }
    assert_eq!(super::overkill_excess(1e16, 1e16, 1.0), -1.0);
    assert!(super::overkill_fires(super::overkill_excess(
        1.0,
        0.0,
        1.0 - 2.0 * eps
    )));
    assert!(!super::overkill_fires(super::overkill_excess(
        1.0,
        eps,
        1.0 - eps
    )));
}
