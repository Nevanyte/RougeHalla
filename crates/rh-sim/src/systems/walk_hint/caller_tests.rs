// Source timing rows are method-probe inputs/results, not earned gameplay history.
// These glue controls install only declared input inventory/mirrors. Real accepted input
// then reaches authoritative targeting/weapons/stagger producers; no expected result is installed.
fn source_holy_wand_timing() -> Value {
    let doc: Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/policy/bot-fight/source.json"
    )))
    .unwrap();
    doc["timings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| {
            r["input"]["faction"] == "holy"
                && r["input"]["weapon"] == "wand"
                && r["input"]["asMult"].as_f64() == Some(2.)
                && r["input"]["windupMult"].as_f64() == Some(1.5)
        })
        .unwrap()
        .clone()
}

fn declared_timing_inputs(sim: &mut Sim, row: &Value) {
    let p = &mut sim.w.players[0];
    p.weapon.weapon0 = Some(crate::WeaponId::Wand);
    let mut input = serde_json::to_value(&p.modifiers).unwrap();
    input["wire"][0] = json!(row["input"]["asMult"].as_f64().unwrap() * 1000.);
    input["wire"][1] = json!(row["input"]["windupMult"].as_f64().unwrap() * 1000.);
    p.modifiers = serde_json::from_value(input).unwrap();
    assert_eq!(p.modifiers.mirrors().as_mult, 2.);
    assert_eq!(p.modifiers.mirrors().windup_mult, 1.5);
}

#[test]
fn captured_timing_drives_real_lock_aim_and_actual_weapon_start() {
    let row = source_holy_wand_timing();
    let mut sim = construct_with(Some(false), Some(0.), true);
    sim.step();
    sim.submit(
        PlayerId(2),
        validate(RawCommand::Move {
            x: 600.,
            y: 400.,
            seq: Some(1),
        })
        .unwrap(),
    )
    .unwrap();
    for _ in 0..3 {
        sim.step();
    }
    // Declared cached-mirror inputs belong to this exact next-tick caller boundary.
    declared_timing_inputs(&mut sim, &row);
    let next = sim.server_time() + TICK_MS;
    let from = sim.w.players[0].pos();
    let target = &sim.w.players[1];
    let to = target.pos();
    let vel = super::super::targeting::velocity(&target.core, next);
    let windup = row["result"]["windupMs"].as_f64().unwrap() / 1000.;
    let decide = |windup| {
        crate::combat_policy::decide(
            crate::combat_policy::Input {
                from,
                to,
                vel,
                los: true,
                weapon: crate::WeaponId::Wand,
                windup,
                lock: true,
                delay: 0.,
            },
            |_, _| true,
        )
    };
    let expected = decide(windup);
    // This is a regression control, not an independent source outcome: changing the
    // call site back to its base helper would yield a different actual aim.
    let base = crate::content::player_timings(
        crate::WeaponId::Wand,
        crate::content::attack_interval(
            &crate::content::paced(FactionId::Holy),
            crate::WeaponId::Wand,
            2.,
        ),
    );
    assert!((expected.aim - decide(base.windup).aim).abs() > 1e-6);
    assert!(expected.hold);
    sim.submit(
        PlayerId(1),
        validate(RawCommand::Target { id: PlayerId(2) }).unwrap(),
    )
    .unwrap();
    sim.step();
    let p = &sim.w.players[0];
    assert_eq!(p.weapon.targeting.target, Some(PlayerId(2)));
    assert!(
        (p.weapon.aim - expected.aim).abs() <= 1e-12,
        "actual lock caller must use source windup"
    );
    let action = p
        .weapon
        .action
        .expect("real accepted Target starts Wand windup");
    assert_eq!(
        action.lands_at,
        next + row["result"]["windupMs"].as_f64().unwrap()
    );
    assert_eq!(
        p.weapon.ready_at,
        next + row["result"]["intervalMs"].as_f64().unwrap()
    );
}

#[test]
fn actual_sword_stagger_pause_uses_captured_current_mirrors() {
    let row = source_holy_wand_timing();
    let mut sim = construct_profile(
        Some(false),
        Some(0.),
        true,
        crate::FactionMode::EngagementHolyPlagueFireFrostSentenced,
    );
    sim.step();
    declared_timing_inputs(&mut sim, &row);
    sim.w.players[1].weapon.weapon0 = Some(crate::WeaponId::Sword);
    let from = sim.w.players[1].pos();
    let to = sim.w.players[0].pos();
    let next = sim.server_time() + TICK_MS;
    sim.submit(
        PlayerId(2),
        validate(RawCommand::Attack {
            a: crate::math::atan2(to.y - from.y, to.x - from.x),
            t: None,
        })
        .unwrap(),
    )
    .unwrap();
    let events = sim.step();
    assert!(
        events.iter().any(|e| matches!(e, crate::Event::Hit {
        victim:PlayerId(1), by:Some(PlayerId(2)), amount, weapon:Some(crate::WeaponId::Sword), ..
    } if *amount > 0.)),
        "actual ordinary Sword hit reaches the declared victim"
    );
    let p = &sim.w.players[0];
    assert_eq!(
        p.weapon.stagger_immune_until,
        next + STAGGER_IMMUNITY_SECONDS * 1000.
    );
    assert_eq!(
        p.signature.dot_paused_until,
        next + row["result"]["windupMs"].as_f64().unwrap(),
        "actual staggerPause caller uses source AS/windup, not AS1 or base player timings"
    );
}
