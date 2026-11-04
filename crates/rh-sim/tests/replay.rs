//! Replay files (docs/CONTRACTS.md C-DET): `rh-replay/2`, a typed refusal of any other format, and a decoded replay that is
//! complete (a malformed map is an `Err` while decoding, not a panic later).

use rh_sim::arenas::practice_arena;
use rh_sim::replay::{
    apply_input, run_replay, Recorder, Replay, ReplayError, ReplayInput, ReplayStart, REPLAY_FORMAT,
};
use rh_sim::{Command, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

fn placements() -> Vec<Placement> {
    (0..4)
        .map(|i| Placement {
            profile: format!("r{i}"),
            faction: [FactionId::Holy, FactionId::Fire][i % 2],
            bot: false,
            at: Vec2::new(400.0 + 30.0 * i as f64, 420.0),
            hp: None,
        })
        .collect()
}

fn recorded(ticks: u32) -> Replay {
    let ps = placements();
    let config = SimConfig::default();
    let mut sim = Sim::reset_active(config.clone(), practice_arena(), Secrets::from_seed(4), &ps);
    let mut rec = Recorder::new(&sim, config, ReplayStart::Active { placements: ps });
    for t in 0..ticks {
        for i in 1..=4u32 {
            let a = t as f64 * 0.07 + i as f64;
            for cmd in [Command::Aim { a }, Command::Attack { a, t: None }] {
                let input = ReplayInput::Command {
                    player: PlayerId(i),
                    cmd,
                };
                apply_input(&mut sim, &input);
                rec.record(input);
            }
        }
        sim.step();
        rec.stepped(&sim);
    }
    rec.replay
}

#[test]
fn a_recorded_replay_is_tagged_roundtrips_complete_and_verifies() {
    let r = recorded(120);
    assert_eq!(r.format, REPLAY_FORMAT);
    assert_eq!(REPLAY_FORMAT, "rh-replay/2");
    let back: Replay = serde_json::from_str(&serde_json::to_string(&r).unwrap()).unwrap();
    assert_eq!(back, r, "equal right after decoding, with no rebuild call");
    let (sim, _) = run_replay(&back).expect("a decoded replay verifies");
    assert_eq!(sim.tick() as usize, r.hashes.len() + 1);
}

#[test]
fn another_replay_format_is_refused_before_anything_runs() {
    let r = recorded(10);
    for found in ["rh-replay/1", "rh-replay/3", "", "something else"] {
        let mut old = r.clone();
        old.format = found.into();
        assert_eq!(
            run_replay(&old).err(),
            Some(ReplayError::Format {
                found: found.into()
            })
        );
    }
    // The format is checked before the content hash and before any step is run.
    let mut both = r.clone();
    both.format = "rh-replay/1".into();
    both.content_hash ^= 1;
    both.hashes[0] ^= 1;
    assert!(matches!(run_replay(&both), Err(ReplayError::Format { .. })));
}

#[test]
fn a_tampered_step_hash_is_a_divergence() {
    let mut r = recorded(10);
    r.hashes[3] ^= 1;
    assert!(matches!(
        run_replay(&r),
        Err(ReplayError::Diverged { step: 3, .. })
    ));
}

#[test]
fn a_replay_with_a_malformed_map_is_an_error_not_a_panic() {
    let mut v = serde_json::to_value(recorded(5)).unwrap();
    // A map whose tile count does not match its size.
    v["arena"]["map"]["tiles"].as_array_mut().unwrap().pop();
    assert!(serde_json::from_value::<Replay>(v).is_err());
    // Zero-sized.
    let mut v = serde_json::to_value(recorded(5)).unwrap();
    v["arena"]["map"]["w"] = 0.into();
    assert!(serde_json::from_value::<Replay>(v).is_err());
    // Truncated text is an error at every cut.
    let text = serde_json::to_string(&recorded(5)).unwrap();
    for cut in (0..text.len()).step_by(text.len() / 64 + 1) {
        assert!(serde_json::from_str::<Replay>(&text[..cut]).is_err());
    }
}
