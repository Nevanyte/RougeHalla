use super::*;

fn reached(f: &Value) -> (Reflexes, Rng, RecordedPaths, Input) {
    let rows = case(f, "dodge-precedes-hold-and-juke-exact-public-hold-boundary")["rows"]
        .as_array()
        .unwrap();
    let mut paths = RecordedPaths::new(f, "open");
    let mut state = Reflexes::new(SCOPE, MethodKey("p0".into()));
    let mut rng = Rng::new(derive(0, 0));
    for row in &rows[..2] {
        paths.begin(&row["input"]["percept"]);
        state
            .check(
                Input::source(row).frame(),
                TierId::Hard,
                &mut paths,
                &mut rng,
            )
            .unwrap();
    }
    assert_eq!(state.dodges(), 1);
    assert_eq!(state.decided.len(), 2);
    assert!(state.decided.iter().any(|(_, yes)| !*yes));
    paths.calls.clear();
    (state, rng, paths, Input::source(&rows[2]))
}
fn refuses(
    state: &mut Reflexes,
    rng: &mut Rng,
    paths: &mut RecordedPaths,
    frame: Frame<'_>,
    why: Refusal,
) {
    let before = state.clone();
    let random = rng.clone();
    paths.calls.clear();
    assert_eq!(state.check(frame, TierId::Hard, paths, rng), Err(why));
    assert_eq!(*state, before, "refusal changed reached state");
    assert_eq!(*rng, random, "refusal drew RNG");
    assert!(paths.calls.is_empty(), "refusal called paths");
}

#[test]
fn missing_complete_facts_refuse_before_reached_state_rng_paths_then_retry() {
    let f = fixture();
    let (mut state, mut rng, mut paths, input) = reached(&f);
    for field in 0..8 {
        let mut frame = input.frame();
        match field {
            0 => frame.clocks = Fact::Unavailable,
            1 => frame.owner = Fact::Unavailable,
            2 => frame.projectiles = Fact::Unavailable,
            3 => frame.players = Fact::Unavailable,
            4 => frame.mobs = Fact::Unavailable,
            5 => frame.wand_windups = Fact::Unavailable,
            6 => frame.stimuli = Fact::Unavailable,
            7 => frame.player_feints = Fact::Unavailable,
            _ => unreachable!(),
        }
        refuses(
            &mut state,
            &mut rng,
            &mut paths,
            frame,
            Refusal::MissingFacts,
        );
    }
    for field in 0..4 {
        let mut bad = input.clone();
        match field {
            0 => bad.players[0].hand = Fact::Unavailable,
            1 => bad.players[0].faction = Fact::Unavailable,
            2 => bad.players[0].draw_started_at = Fact::Unavailable,
            3 => bad.projectiles[0].course = Fact::Unavailable,
            _ => unreachable!(),
        }
        refuses(
            &mut state,
            &mut rng,
            &mut paths,
            bad.frame(),
            Refusal::MissingFacts,
        );
    }
    let mut expected = state.clone();
    let mut expected_rng = rng.clone();
    let mut expected_paths = RecordedPaths::new(&f, "open");
    let want = expected
        .check(
            input.frame(),
            TierId::Hard,
            &mut expected_paths,
            &mut expected_rng,
        )
        .unwrap();
    assert_eq!(want.as_ref().map(|r| r.kind), Some(Kind::Dodge));
    let got = state
        .check(input.frame(), TierId::Hard, &mut paths, &mut rng)
        .unwrap();
    assert_eq!(got, want);
    assert_eq!(state, expected);
    assert_eq!(rng, expected_rng);
    assert_eq!(paths.calls, expected_paths.calls);
}

#[test]
fn nonfinite_and_late_unknown_facts_are_atomic_from_reached_state() {
    let f = fixture();
    let (mut state, mut rng, mut paths, input) = reached(&f);
    for field in 0..15 {
        let mut bad = input.clone();
        let nan = f64::NAN;
        match field {
            0 => bad.clocks.now = nan,
            1 => bad.clocks.view_time = f64::INFINITY,
            2 => bad.owner.at.x = nan,
            3 => bad.owner.at.y = f64::NEG_INFINITY,
            4 => bad.owner.speed_mult = nan,
            5 => bad.players[0].at.x = nan,
            6 => bad.players[0].at.y = f64::INFINITY,
            7 => bad.players[0].facing = nan,
            8 => bad.players[0].draw_started_at = Fact::Known(nan),
            9 => {
                let Fact::Known(ref mut c) = bad.projectiles[0].course else {
                    unreachable!()
                };
                c.origin.x = nan;
            }
            10 => {
                let Fact::Known(ref mut c) = bad.projectiles[0].course else {
                    unreachable!()
                };
                c.at.y = f64::INFINITY;
            }
            11 => {
                let Fact::Known(ref mut c) = bad.projectiles[0].course else {
                    unreachable!()
                };
                c.velocity.x = nan;
            }
            12 => {
                let Fact::Known(ref mut c) = bad.projectiles[0].course else {
                    unreachable!()
                };
                c.range = nan;
            }
            13 => bad.stimuli[0].at = nan,
            14 => bad.stimuli[0].value = Some(f64::INFINITY),
            _ => unreachable!(),
        }
        refuses(
            &mut state,
            &mut rng,
            &mut paths,
            bad.frame(),
            Refusal::InvalidFacts,
        );
    }
    let wand = Input::source(&case(&f, "wand-cue-positive-while-current-hand-is-sword")["rows"][0]);
    for field in 0..3 {
        let mut bad = wand.clone();
        match field {
            0 => bad.windups[0].at = f64::NAN,
            1 => bad.windups[0].duration_ms = f64::INFINITY,
            2 => bad.windups[0].aim = f64::NAN,
            _ => unreachable!(),
        }
        refuses(
            &mut state,
            &mut rng,
            &mut paths,
            bad.frame(),
            Refusal::InvalidFacts,
        );
    }
    // An earlier valid projectile would consume a decision/draw if preflight did not inspect the late unknown row.
    let mut late = input.clone();
    let mut unknown = late.projectiles[0].clone();
    unknown.key = MethodKey("late-unknown".into());
    unknown.course = Fact::Unavailable;
    late.projectiles.push(unknown);
    refuses(
        &mut state,
        &mut rng,
        &mut paths,
        late.frame(),
        Refusal::MissingFacts,
    );
    // Finite clocks whose derived lag/hold overflows also refuse before any state or RNG change.
    let mut overflow = input.clone();
    overflow.clocks = Clocks {
        now: f64::MAX,
        view_time: -f64::MAX,
    };
    refuses(
        &mut state,
        &mut rng,
        &mut paths,
        overflow.frame(),
        Refusal::InvalidFacts,
    );
    let mut overflow = input.clone();
    overflow.owner.at.x = f64::MAX;
    overflow.players[0].at.x = -f64::MAX;
    refuses(
        &mut state,
        &mut rng,
        &mut paths,
        overflow.frame(),
        Refusal::InvalidFacts,
    );
}

#[test]
fn session_epoch_owner_refusal_and_reset_clear_real_choices_hold_and_counters() {
    let f = fixture();
    let rows = case(
        &f,
        "dodge-precedes-hold-and-juke-exact-public-hold-boundary",
    )["rows"]
        .as_array()
        .unwrap();
    let mut state = Reflexes::new(SCOPE, MethodKey("p0".into()));
    let mut rng = Rng::new(derive(0, 0));
    let mut paths = RecordedPaths::new(&f, "open");
    for row in rows {
        state
            .check(
                Input::source(row).frame(),
                TierId::Hard,
                &mut paths,
                &mut rng,
            )
            .unwrap();
    }
    assert_eq!((state.dodges(), state.jukes()), (2, 1));
    assert!(state.hold_until() > 0.);
    assert!(state.decided.iter().any(|(_, yes)| !*yes));
    let first = Input::source(&rows[0]);
    for scope in [
        Scope {
            session: 8,
            epoch: 1,
        },
        Scope {
            session: 7,
            epoch: 2,
        },
    ] {
        let mut wrong = first.frame();
        wrong.scope = scope;
        refuses(&mut state, &mut rng, &mut paths, wrong, Refusal::WrongScope);
        let mut reset = state.clone();
        reset.reset(scope, first.owner.key.clone());
        assert_eq!(
            (
                reset.dodges(),
                reset.jukes(),
                reset.hold_until(),
                reset.decided.len()
            ),
            (0, 0, 0., 0)
        );
        let mut frame = first.frame();
        frame.scope = scope;
        let mut fresh_rng = Rng::new(derive(0, 0));
        assert_eq!(
            reset
                .check(frame, TierId::Hard, &mut paths, &mut fresh_rng)
                .unwrap()
                .unwrap()
                .kind,
            Kind::Dodge
        );
        assert_eq!(reset.dodges(), 1);
    }
    let mut foreign = first.clone();
    foreign.owner.key = MethodKey("other-owner".into());
    refuses(
        &mut state,
        &mut rng,
        &mut paths,
        foreign.frame(),
        Refusal::WrongOwner,
    );
    state.reset(SCOPE, foreign.owner.key.clone());
    assert_eq!(state.owner, foreign.owner.key);
    assert!(state.decided.is_empty());
    assert_eq!(
        (state.dodges(), state.jukes(), state.hold_until()),
        (0, 0, 0.)
    );
}

#[test]
fn source_string_keys_preserve_timestamp_spelling_and_shared_cross_kind_equality() {
    let actor = MethodKey("p1".into());
    for (time, want) in [
        (0., "p1@0"),
        (-0., "p1@0"),
        (1e21, "p1@1e+21"),
        (1e-7, "p1@1e-7"),
        (900.5, "p1@900.5"),
    ] {
        assert_eq!(shot_key(&actor, time), want);
    }
    let f = fixture();
    let mut state = Reflexes::new(SCOPE, MethodKey("p0".into()));
    let mut rng = Rng::new(derive(0, 0));
    let mut paths = RecordedPaths::new(&f, "open");
    let mut short =
        Input::source(&case(&f, "new-incoming-uses-reaction-lead-and-is-too-late")["rows"][0]);
    short.projectiles[0].key = MethodKey("p1@900".into());
    short.stimuli[0].subject = Some("p1@900".into());
    assert_eq!(
        state
            .check(short.frame(), TierId::Hard, &mut paths, &mut rng)
            .unwrap(),
        None
    );
    assert_eq!(state.decided[0], ("p1@900".to_owned(), false));
    let wand = Input::source(&case(&f, "wand-cue-positive-while-current-hand-is-sword")["rows"][0]);
    let before = rng.clone();
    assert_eq!(
        state
            .check(wand.frame(), TierId::Hard, &mut paths, &mut rng)
            .unwrap(),
        None
    );
    assert_eq!(rng, before, "shared source key was silently renamespaced");
}
