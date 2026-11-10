//! Projection of existing source Attack/launch/end fixtures; no new flight engine or capture corpus.
use rh_sim::{ItemObserver, Observation, PlayerId, ProjectileKind, ProjectileView, Sim, Vec2};
use std::collections::BTreeMap;
fn key(p: &ProjectileView) -> (u8, u16, u16, u16, Option<PlayerId>) {
    (
        match p.kind {
            ProjectileKind::Arrow => 0,
            ProjectileKind::Ball => 1,
        },
        p.x,
        p.y,
        p.facing,
        p.owner,
    )
}
fn q(v: f64) -> u16 {
    (f64::from(v as f32) * 8. + 0.5) as u16
}
#[test]
fn source_flight_records_project_without_ids_and_restore_identically() {
    let mut saw = [false; 3];
    for name in ["wand_duel", "shield_arrow_reflect"] {
        let fx = rh_parity::load(&rh_parity::fixtures_dir().join(format!("{name}.json")));
        let mut sim = rh_parity::build(&fx);
        let mut restored = None::<Sim>;
        let mut flights = BTreeMap::<String, serde_json::Value>::new();
        let mut a = ItemObserver::new(PlayerId(1));
        let mut b = ItemObserver::new(PlayerId(1));
        for t in &fx.ticks {
            for i in fx.inputs.iter().filter(|i| i.tick == t.tick) {
                let cmd = rh_sim::validate(rh_parity::raw_command_pub(i).unwrap()).unwrap();
                sim.submit(rh_parity::pid(&i.player), cmd).unwrap();
                if let Some(s) = &mut restored {
                    s.submit(rh_parity::pid(&i.player), cmd).unwrap();
                }
            }
            sim.step();
            rh_parity::apply_actions(&mut sim, &fx, t.tick);
            if let Some(s) = &mut restored {
                s.step();
                rh_parity::apply_actions(s, &fx, t.tick);
                assert_eq!(sim.state_hash(), s.state_hash());
            }
            for l in &t.launches {
                flights.insert(l["id"].as_str().unwrap().into(), l.clone());
            }
            for e in &t.events {
                if e["kind"] == "projEnd" {
                    flights.remove(e["id"].as_str().unwrap());
                }
            }
            let mut out = Observation::default();
            let hash = sim.state_hash();
            a.observe_into(&sim, &[], &mut out, None).unwrap();
            assert_eq!(hash, sim.state_hash(), "projection mutated authority");
            let mut expected = Vec::new();
            for l in flights.values() {
                // Source messages.ts and ProjectileView.update's straight-flight equation, evaluated
                // at the captured authoritative step time; reflected source launches retain residual time.
                let number = |k: &str| l[k].as_f64().unwrap();
                let dt = (t.server_time - number("t")) / 1000.;
                let x = number("x") + number("vx") * dt;
                let y = number("y") + number("vy") * dt;
                if !sim.can_see_point(PlayerId(1), Vec2::new(x, y)) {
                    continue;
                }
                let kind = if l["kind"] == "arrow" {
                    saw[0] = true;
                    ProjectileKind::Arrow
                } else {
                    saw[1] = true;
                    ProjectileKind::Ball
                };
                let owner = l["ownerId"]
                    .as_str()
                    .map(rh_parity::pid)
                    .filter(|id| *id == PlayerId(1) || out.visible.iter().any(|a| a.id == *id));
                if l.get("ownerId").is_none() {
                    saw[2] = true;
                }
                let angle = number("vy").atan2(number("vx")) as f32;
                let facing = ((f64::from(angle) / (std::f64::consts::TAU / 65536.)).round() as i64
                    & 65535) as u16;
                expected.push((
                    match kind {
                        ProjectileKind::Arrow => 0,
                        ProjectileKind::Ball => 1,
                    },
                    q(x),
                    q(y),
                    facing,
                    owner,
                ));
            }
            expected.sort_unstable();
            // Protocol 15 adds a viewer track and a straight-line anchor; the source facts are the current rows.
            let current = |rows: &[ProjectileView]| {
                let mut keys: Vec<_> = rows.iter().map(key).collect();
                keys.sort_unstable();
                keys
            };
            assert_eq!(current(&out.projectiles), expected, "{name} tick{}", t.tick);
            for p in &out.projectiles {
                // The anchor a client extrapolates lands on the source's straight-flight point (1/8 u codes).
                let (ax, ay) = p.anchor.at(f64::from(sim.tick()));
                let (dx, dy) = (ax - f64::from(p.x) / 8., ay - f64::from(p.y) / 8.);
                assert!(
                    (dx * dx + dy * dy).sqrt() <= rh_sim::projectile_view::TRACK_TOLERANCE + 0.125,
                    "{name} tick{} anchor drift",
                    t.tick
                );
            }
            if let Some(s) = &restored {
                let mut other = Observation::default();
                b.observe_into(s, &[], &mut other, None).unwrap();
                assert_eq!(current(&out.projectiles), current(&other.projectiles));
            }
            if restored.is_none() && !out.projectiles.is_empty() {
                restored = Some(Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap());
            }
        }
        assert!(restored.is_some());
    }
    assert!(saw.into_iter().all(|v| v));
}
