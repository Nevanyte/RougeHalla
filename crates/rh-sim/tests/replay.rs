//! Replay files (docs/CONTRACTS.md C-DET): `rh-replay/2`, a typed refusal of any other format, and a decoded replay that is
//! complete (a malformed map is an `Err` while decoding, not a panic later).

use rh_sim::arenas::practice_arena;
use rh_sim::replay::{
    apply_input, run_replay, Recorder, Replay, ReplayError, ReplayInput, ReplayStart, REPLAY_FORMAT,
};
use rh_sim::{
    validate, Command, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, Vec2,
};

/// A command through the one door in (C-INPUT): these tests only use valid ones.
fn cmd(raw: RawCommand) -> Command {
    validate(raw).expect("a valid test command")
}

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
            for cmd in [
                cmd(RawCommand::Aim { a }),
                cmd(RawCommand::Attack { a, t: None }),
            ] {
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
fn an_edited_replay_cannot_inject_an_unvalidated_command() {
    let mut v = serde_json::to_value(recorded(5)).unwrap();
    let input = &mut v["ticks"][0]["inputs"][0];
    assert!(input["Command"]["cmd"]["Aim"].is_object(), "{input}");
    // An angle `validate` would have wrapped, written straight into the replay.
    input["Command"]["cmd"]["Aim"]["a"] = 50.0.into();
    assert!(serde_json::from_value::<Replay>(v).is_err());
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

#[test]
fn a_replay_names_its_build_and_a_file_without_the_new_keys_still_verifies() {
    let mut r = recorded(60);
    assert_eq!(r.build, rh_sim::replay::BUILD_ID);
    assert_eq!(r.match_id, None);
    r.match_id = Some("00000000-0000-4000-8000-000000000001".into());
    let back: Replay = serde_json::from_str(&serde_json::to_string(&r).unwrap()).unwrap();
    assert_eq!(back, r);

    // A replay recorded before `build` and `match_id` existed: same format tag, keys absent, still verifies.
    let mut v = serde_json::to_value(&r).unwrap();
    v.as_object_mut().unwrap().remove("build");
    v.as_object_mut().unwrap().remove("match_id");
    let old: Replay = serde_json::from_value(v).unwrap();
    assert_eq!((old.build.as_str(), old.match_id.as_deref()), ("", None));
    run_replay(&old).expect("an older replay without the keys verifies");

    // Content is still compared before anything runs.
    let mut other = r.clone();
    other.content_hash ^= 1;
    assert!(matches!(
        run_replay(&other),
        Err(ReplayError::ContentMismatch { .. })
    ));
}
