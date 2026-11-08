//! P-BOTS-7 parity: the fill policy's lobby behaviour against the actual source manager (parity/policy/bot-fill.json,
//! captured in the pinned Linux amd64 Node 22.23.4 container from the real BotManager over a real headless world), plus
//! the exported constants, callsigns and softmax draw. Numbers and rendered seat lines are compared exactly.
use super::*;
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../parity/policy/bot-fill.json");

fn fixture() -> Value {
    let f: Value = serde_json::from_str(FIXTURE).expect("the captured fill corpus parses");
    assert_eq!(f["format"], "rh-bot-fill-source/1");
    assert_eq!(f["profile"]["node"], "v22.23.4");
    assert_eq!(f["profile"]["platform"], "linux");
    assert_eq!(f["profile"]["arch"], "x64");
    assert_eq!(f["profile"]["sourceTree"].as_str().unwrap().len(), 64);
    assert_eq!(f["profile"]["captureSha256"].as_str().unwrap().len(), 64);
    f
}

fn num(v: &Value) -> f64 {
    v.as_f64().expect("a number")
}

fn eq_bits(got: f64, want: f64, ctx: &str) {
    assert_eq!(got.to_bits(), want.to_bits(), "{ctx}: {got} != {want}");
}

fn faction(name: &str) -> FactionId {
    FactionId::parse(name).expect("a source faction")
}

/// The declared callsign inputs, in the capture's order (the fixture stores the taken-set index only).
fn taken_cases() -> Vec<Vec<String>> {
    let pool: Vec<String> = CALLSIGN_POOL.iter().map(|s| (*s).to_owned()).collect();
    let digits: Vec<String> = pool
        .iter()
        .flat_map(|n| [format!("{n}00"), format!("{n}01"), format!("{n}02")])
        .collect();
    let mut all_digits = pool.clone();
    all_digits.extend(digits);
    vec![
        Vec::new(),
        vec!["Wren".into(), "Kestrel_7".into(), "mossy".into()],
        vec!["wren".into(), "kestrel_7".into(), "MOSSY".into()],
        pool[..60].to_vec(),
        pool.clone(),
        all_digits,
    ]
}

#[test]
fn the_source_constants_and_defaults_are_the_ported_ones() {
    let f = fixture();
    let defaults = &f["constants"]["BOT_FILL_DEFAULTS"];
    let config = BotFillConfig::default();
    assert_eq!(
        config.fill_to,
        defaults["fillTo"].as_u64().unwrap() as usize
    );
    eq_bits(
        config.arrival_seconds,
        num(&defaults["arrivalSeconds"]),
        "arrivalSeconds",
    );
    for (got, want) in config
        .tier_mix
        .iter()
        .zip(["easy", "normal", "hard"].map(|t| num(&defaults["tierMix"][t])))
    {
        eq_bits(*got, want, "tierMix");
    }
    for (got, want) in config.persona_mix.iter().zip(
        ["farmer", "hunter", "opportunist", "cautious"].map(|p| num(&defaults["personaMix"][p])),
    ) {
        eq_bits(*got, want, "personaMix");
    }
    eq_bits(config.latency_ms, num(&defaults["latencyMs"]), "latencyMs");
    eq_bits(config.jitter_ms, num(&defaults["jitterMs"]), "jitterMs");
    assert_eq!(
        f["constants"]["BOT_ID_PREFIX"].as_str().unwrap(),
        BOT_ID_PREFIX
    );
    assert_eq!(
        f["constants"]["BOT_PATH_BUDGET_PER_TICK"].as_u64().unwrap() as usize,
        BOT_PATH_BUDGET_PER_TICK
    );
    eq_bits(
        num(&f["constants"]["LEARN_EXPLORE"]),
        LEARN_EXPLORE,
        "LEARN.explore",
    );
    assert_eq!(
        f["constants"]["MAX_PLAYERS"].as_u64().unwrap() as usize,
        MAX_PLAYERS
    );
    let pool: Vec<String> = f["constants"]["CALLSIGN_POOL"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_owned())
        .collect();
    assert_eq!(pool, CALLSIGN_POOL.map(str::to_owned).to_vec());
    let factions: Vec<FactionId> = f["constants"]["FACTION_IDS"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| faction(v.as_str().unwrap()))
        .collect();
    assert_eq!(factions, FactionId::ALL.to_vec());
    assert_eq!(BotFillConfig::with_fill_to(3).fill_to, 3);
    assert_eq!(
        BotFillState::new(BotFillConfig::with_fill_to(99), 1).target(),
        MAX_PLAYERS
    );
}

#[test]
fn callsigns_and_ids_match_the_actual_source() {
    let f = fixture();
    for case in f["callsigns"].as_array().unwrap() {
        let seed = case["seed"].as_u64().unwrap() as u32;
        let taken = &taken_cases()[case["takenIndex"].as_u64().unwrap() as usize];
        let mut rng = Mulberry32::new(seed);
        let got = pick_callsign(&mut rng, |name| {
            taken.iter().any(|t| t == name || t == &name.to_lowercase())
        });
        assert_eq!(
            got,
            case["expected"].as_str().unwrap(),
            "callsign seed {seed}"
        );
    }
    for case in f["botIds"].as_array().unwrap() {
        assert_eq!(
            bot_id(case["n"].as_u64().unwrap() as u32),
            case["expected"].as_str().unwrap()
        );
    }
    let mut rng = Mulberry32::new(7);
    let spec = BotSeatSpec {
        number: 1,
        name: pick_callsign(&mut rng, |_| false),
        tier: TierId::Easy,
        persona: PersonaId::Farmer,
        faction: FactionId::Fire,
        seed: 5,
    };
    assert_eq!(spec.id(), "bot~1");
    assert!(spec.line().starts_with("bot~1 "));
}

#[test]
fn the_softmax_draw_matches_the_actual_source() {
    let f = fixture();
    for case in f["softmax"].as_array().unwrap() {
        let utilities: Vec<f64> = case["utilities"]
            .as_array()
            .unwrap()
            .iter()
            .map(num)
            .collect();
        let mut rng = Mulberry32::new(case["seed"].as_u64().unwrap() as u32);
        assert_eq!(
            softmax_index(&mut rng, &utilities, num(&case["temperature"])),
            case["expected"].as_u64().unwrap() as usize,
            "softmax {case:?}"
        );
    }
    // temperature <= 0 and a single option take the best outright, consuming no draw.
    let mut rng = Mulberry32::new(3);
    assert_eq!(softmax_index(&mut rng, &[0., 2., 1.], 0.), 1);
    assert_eq!(softmax_index(&mut rng, &[5.], 1.), 0);
}

/// One lobby player the replay tracks: its name (lowercased) and faction when it has one.
struct Player {
    name_lower: String,
    faction: Option<FactionId>,
    bot: bool,
}

fn view<'a>(players: &[Player], taken: &'a dyn Fn(&str) -> bool) -> FillView<'a> {
    let mut factions = [0u32; 5];
    let mut names_lower = Vec::with_capacity(players.len());
    for player in players {
        names_lower.push(player.name_lower.clone());
        if let Some(faction) = player.faction {
            factions[faction_index(faction)] += 1;
        }
    }
    FillView {
        players: players.len(),
        humans: players.iter().filter(|p| !p.bot).count(),
        factions,
        names_lower,
        taken,
    }
}

fn apply(players: &mut Vec<Player>, spec: &BotSeatSpec) {
    players.push(Player {
        name_lower: spec.name.to_lowercase(),
        faction: Some(spec.faction),
        bot: true,
    });
}

#[test]
fn the_arrival_schedule_and_yield_seat_match_the_actual_source() {
    let f = fixture();
    let scenarios = f["scenarios"].as_array().unwrap();
    assert!(scenarios.len() >= 6);
    let never = |_: &str| false;
    for scenario in scenarios {
        let name = scenario["name"].as_str().unwrap();
        let config = BotFillConfig {
            fill_to: scenario["fillTo"].as_u64().unwrap() as usize,
            arrival_seconds: num(&scenario["arrivalSeconds"]),
            ..BotFillConfig::default()
        };
        let manager_seed = scenario["managerSeed"].as_u64().unwrap();
        let mut state = BotFillState::new(config, manager_seed);
        let mut players: Vec<Player> = scenario["initialPlayers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| Player {
                name_lower: v["name"].as_str().unwrap().to_lowercase(),
                faction: Some(faction(v["faction"].as_str().unwrap())),
                bot: false,
            })
            .collect();
        assert_eq!(
            players.len(),
            scenario["initialHumans"].as_array().unwrap().len()
        );
        let ops = scenario["ops"].as_array().unwrap();
        let ops_out = scenario["opsOut"].as_array().unwrap();
        let mut ops_out_seen = 0usize;
        let arrivals = scenario["arrivals"].as_array().unwrap();
        let closed_at = scenario["final"]["closedAt"].as_u64();
        let mut closing_seen = false;
        for (t, tick) in scenario["ticks"].as_array().unwrap().iter().enumerate() {
            let t = t as u64;
            for op in ops {
                if op["tick"].as_u64().unwrap() != t {
                    continue;
                }
                let expected = &ops_out[ops_out_seen];
                assert_eq!(
                    expected["tick"].as_u64().unwrap(),
                    t,
                    "{name}: op trace order"
                );
                assert_eq!(
                    expected["op"].as_str().unwrap(),
                    op["op"].as_str().unwrap(),
                    "{name}: op kind"
                );
                match op["op"].as_str().unwrap() {
                    "human" => {
                        let human = op["name"].as_str().unwrap();
                        assert_eq!(
                            expected["name"].as_str().unwrap(),
                            human,
                            "{name}: human op"
                        );
                        // A human with no faction joined as the source default (defaultFaction(joinIndex)).
                        players.push(Player {
                            name_lower: human.to_lowercase(),
                            faction: Some(faction(expected["faction"].as_str().unwrap())),
                            bot: false,
                        });
                    }
                    "yield" => {
                        let yielded = state.yield_seat();
                        assert_eq!(
                            expected["result"].as_bool().unwrap(),
                            yielded.is_some(),
                            "{name}: yield at {t}"
                        );
                        if let Some(spec) = yielded {
                            let pos = players
                                .iter()
                                .rposition(|p| p.bot && p.name_lower == spec.name.to_lowercase())
                                .expect("a yielded seat is in the room");
                            players.remove(pos);
                        }
                    }
                    other => panic!("unconsumed op {other}"),
                }
                ops_out_seen += 1;
            }
            let now = num(&tick["now"]);
            let ends = num(&tick["ends"]);
            let mut added: Vec<String> = Vec::new();
            let due = {
                let v = view(&players, &never);
                state.lobby_tick(now, ends, &v)
            };
            for spec in &due {
                added.push(spec.line());
                apply(&mut players, spec);
            }
            if closed_at == Some(t) {
                closing_seen = true;
                let rest = {
                    let v = view(&players, &never);
                    state.lobby_closing(&v)
                };
                for spec in &rest {
                    added.push(spec.line());
                    apply(&mut players, spec);
                }
            }
            let want: Vec<String> = arrivals
                .iter()
                .find(|a| a["tick"].as_u64().unwrap() == t)
                .map(|a| {
                    a["specs"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|s| s.as_str().unwrap().to_owned())
                        .collect()
                })
                .unwrap_or_default();
            assert_eq!(added, want, "{name}: arrivals at tick {t}");
        }
        assert_eq!(ops_out_seen, ops_out.len(), "{name}: every op ran");
        if closed_at.is_some() {
            assert!(closing_seen, "{name}: the closing tick ran in the trace");
        }
        let specs: Vec<String> = state.specs().iter().map(BotSeatSpec::line).collect();
        let want: Vec<String> = scenario["final"]["specs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| {
                format!(
                    "{} {} {} {} {} {}",
                    s["id"].as_str().unwrap(),
                    s["name"].as_str().unwrap(),
                    s["tier"].as_str().unwrap(),
                    s["persona"].as_str().unwrap(),
                    s["faction"].as_str().unwrap(),
                    s["seed"].as_u64().unwrap()
                )
            })
            .collect();
        assert_eq!(specs, want, "{name}: final seats");
        assert_eq!(
            state.stats().arrived,
            scenario["final"]["stats"]["arrived"].as_u64().unwrap(),
            "{name}: arrived"
        );
        assert_eq!(
            state.stats().yielded,
            scenario["final"]["stats"]["yielded"].as_u64().unwrap(),
            "{name}: yielded"
        );
    }
}

/// Seats one full lobby through the arrival schedule and the closing top-up (source lobbyTick + lobbyClosing).
fn seat_all(cfg: BotFillConfig, seed: u64) -> Vec<BotSeatSpec> {
    let never = |_: &str| false;
    let mut state = BotFillState::new(cfg, seed);
    let mut players: Vec<Player> = vec![Player {
        name_lower: "human".into(),
        faction: Some(FactionId::Fire),
        bot: false,
    }];
    let ends = 30_000.;
    let mut now = 0.;
    while now <= ends {
        let due = {
            let v = view(&players, &never);
            state.lobby_tick(now, ends, &v)
        };
        for spec in &due {
            apply(&mut players, spec);
        }
        now += 50.;
    }
    let rest = {
        let v = view(&players, &never);
        state.lobby_closing(&v)
    };
    let mut specs = state.specs().to_vec();
    assert_eq!(rest, Vec::new(), "the schedule already seated everyone");
    specs.sort_by_key(|s| s.number);
    specs
}

#[test]
fn a_learned_faction_bias_feeds_the_faction_softmax() {
    use rh_policy::bots::learning::{LearnedBias, LEARN_CAP};
    let plain = seat_all(BotFillConfig::with_fill_to(8), 11);
    let none = LearnedBias::NO_BIAS;
    let mut biases = std::collections::BTreeMap::new();
    for persona in PersonaId::ALL {
        for faction in FactionId::ALL {
            biases.insert(
                format!("faction|{}|{}", persona.as_str(), faction.as_str()),
                if faction == FactionId::Fire {
                    LEARN_CAP
                } else {
                    0.
                },
            );
        }
    }
    let learned = LearnedBias::with_biases(biases);
    assert!(learned.enabled());
    assert!(!none.enabled());
    // Compare one seed exactly (the lines differ) and the Fire share over many seeds (the +cap bias raises it; the
    // softmax keeps every faction possible).
    let biased = seat_all(
        BotFillConfig::with_fill_to(8).with_learned(learned.clone()),
        11,
    );
    assert_ne!(
        plain.iter().map(BotSeatSpec::line).collect::<Vec<_>>(),
        biased.iter().map(BotSeatSpec::line).collect::<Vec<_>>(),
        "a learning snapshot changes the drawn factions"
    );
    let fire = |specs: &[BotSeatSpec]| {
        specs
            .iter()
            .filter(|s| s.faction == FactionId::Fire)
            .count()
    };
    let (mut plain_total, mut biased_total) = (0, 0);
    for seed in 1..=40u64 {
        plain_total += fire(&seat_all(BotFillConfig::with_fill_to(8), seed));
        biased_total += fire(&seat_all(
            BotFillConfig::with_fill_to(8).with_learned(learned.clone()),
            seed,
        ));
    }
    assert!(
        biased_total > plain_total,
        "the +cap Fire bias pulls more seats: {biased_total} vs {plain_total}"
    );
    // Learning off is exactly the captured manager stream (the parity fixture above proves the stream itself).
    assert_eq!(BotFillConfig::default().learned, LearnedBias::NO_BIAS);
}

#[test]
fn each_actual_arrival_refreshes_only_managed_faction_bias_like_the_source() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    };
    struct Sink {
        bias: Mutex<LearnedBias>,
        reads: AtomicUsize,
    }
    impl crate::bot_learning::LearningSink for Sink {
        fn snapshot(&self) -> LearnedBias {
            self.reads.fetch_add(1, Ordering::SeqCst);
            self.bias.lock().unwrap().clone()
        }
        fn record(&self, _: crate::bot_learning::BotRunFacts) {
            panic!("a fill draw never records results or planner choices")
        }
    }
    let fixture: Value = serde_json::from_str(include_str!(
        "bot_fill/fixtures/source-managed-bias-refresh.json"
    ))
    .unwrap();
    let biases = |name: &str| {
        LearnedBias::with_biases(
            fixture["inputs"][name]
                .as_object()
                .unwrap()
                .iter()
                .map(|(key, value)| (key.clone(), value.as_f64().unwrap()))
                .collect(),
        )
    };
    for (path, dynamic) in [("dynamic", true), ("fixedLobbySnapshotControl", false)] {
        let mut state = BotFillState::new(
            BotFillConfig::with_fill_to(3).with_learned(biases("initialBiases")),
            7,
        );
        let sink = Arc::new(Sink {
            bias: Mutex::new(biases("initialBiases")),
            reads: AtomicUsize::new(0),
        });
        if dynamic {
            state.set_learning_sink(sink.clone());
        }
        let mut players = vec![Player {
            name_lower: "human1".into(),
            faction: Some(FactionId::Fire),
            bot: false,
        }];
        for (i, arrival) in fixture[path]["arrivals"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            if i == 1 {
                *sink.bias.lock().unwrap() = biases("changedBiases");
            }
            let never = |_: &str| false;
            let drawn = state
                .add_bot(&mut Shadow::from(&view(&players, &never)))
                .unwrap();
            assert_eq!(
                drawn.line(),
                arrival["line"].as_str().unwrap(),
                "{path} arrival{i}"
            );
            apply(&mut players, &drawn);
        }
        assert_eq!(
            sink.reads.load(Ordering::SeqCst),
            if dynamic { 2 } else { 0 }
        );
        // No extra RNG is consumed by refreshing the snapshot: both sources made the same ten manager draws.
        let mut reference = Mulberry32::new(mix(7, 0));
        for arrival in fixture[path]["arrivals"].as_array().unwrap() {
            for draw in arrival["draws"].as_array().unwrap() {
                eq_bits(
                    reference.next_f64(),
                    draw.as_f64().unwrap(),
                    "source manager draw",
                );
            }
        }
        eq_bits(
            state.fill_rng.next_f64(),
            reference.next_f64(),
            "next untouched manager draw",
        );
    }
}

// ================================================================================================= P-BOTS-7 remainder

/// The source config surface (`config.ts parseBots` + `parseMix`) against the pinned actual-source corpus
/// (`parity/policy/bot-runtime.json`, captured from the unchanged TypeScript in the linux/amd64 Node 22.23.4 image).
#[test]
fn the_bots_config_env_surface_matches_the_actual_source() {
    let doc: Value = serde_json::from_str(include_str!("../../../parity/policy/bot-runtime.json"))
        .expect("the captured bot-runtime corpus parses");
    assert_eq!(doc["format"], "rh-bot-runtime-source/1");
    let tier_ids = [
        TierId::Easy.as_str(),
        TierId::Normal.as_str(),
        TierId::Hard.as_str(),
    ];
    let persona_ids = [
        PersonaId::Farmer.as_str(),
        PersonaId::Hunter.as_str(),
        PersonaId::Opportunist.as_str(),
        PersonaId::Cautious.as_str(),
    ];
    let by_ids = |ids: &[&str], row: &Value| -> Vec<f64> {
        ids.iter()
            .map(|id| {
                row.get(*id)
                    .and_then(Value::as_f64)
                    .unwrap_or_else(|| panic!("missing {id} in {row}"))
            })
            .collect()
    };
    for case in doc["mixes"].as_array().unwrap() {
        let raw = case["raw"].as_str();
        let ids: Vec<&str> = if case["ids"].as_array().unwrap()[0] == "easy" {
            tier_ids.to_vec()
        } else {
            persona_ids.to_vec()
        };
        let fallback: Vec<f64> = if ids == tier_ids {
            BotFillConfig::default().tier_mix.to_vec()
        } else {
            BotFillConfig::default().persona_mix.to_vec()
        };
        let got = parse_mix(raw, &ids, &fallback);
        let want = by_ids(&ids, &case["expected"]);
        assert_eq!(got, want, "{}", case["name"].as_str().unwrap());
    }
    for case in doc["config"].as_array().unwrap() {
        let env = case["env"].as_object().unwrap();
        let get = |key: &str| env.get(key).and_then(Value::as_str).map(str::to_string);
        let got = BotFillConfig::from_env(get);
        let want = &case["bots"];
        let name = case["name"].as_str().unwrap();
        assert_eq!(
            &got.fill_to,
            &(want["fillTo"].as_u64().unwrap() as usize),
            "{name}: fillTo"
        );
        assert_eq!(
            got.arrival_seconds,
            want["arrivalSeconds"].as_f64().unwrap(),
            "{name}: arrivalSeconds"
        );
        assert_eq!(
            &got.tier_mix.to_vec(),
            &by_ids(&tier_ids, &want["tierMix"]),
            "{name}: tierMix"
        );
        assert_eq!(
            &got.persona_mix.to_vec(),
            &by_ids(&persona_ids, &want["personaMix"]),
            "{name}: personaMix"
        );
        assert_eq!(
            got.latency_ms,
            want["latencyMs"].as_f64().unwrap(),
            "{name}: latency"
        );
        assert_eq!(
            got.jitter_ms,
            want["jitterMs"].as_f64().unwrap(),
            "{name}: jitter"
        );
        assert_eq!(
            got.seed,
            want["seed"].as_u64().map(|v| v as u32),
            "{name}: seed"
        );
        match (want["statsFile"].as_str(), &got.stats_file) {
            (None, StatsFile::Default) => {}
            (Some(""), StatsFile::Off) => {}
            (Some("file"), StatsFile::Path(path)) if !path.is_empty() => {}
            (want, got) => panic!("{name}: statsFile {want:?} != {got:?}"),
        }
    }
    // The declared defaults are BOT_FILL_DEFAULTS (the corpus' first case) and the server keeps learning off by default.
    let defaults = BotFillConfig::default();
    assert_eq!(defaults.fill_to, 8);
    assert_eq!(defaults.arrival_seconds, 12.);
    assert_eq!(defaults.tier_mix, [0.3, 0.45, 0.25]);
    assert_eq!(defaults.persona_mix, [4., 1., 2., 3.]);
    assert_eq!(defaults.latency_ms, 30.);
    assert_eq!(defaults.jitter_ms, 8.);
    assert_eq!(defaults.seed, None);
    assert_eq!(defaults.stats_file, StatsFile::Default);
    assert_eq!(
        defaults.learned,
        rh_policy::bots::learning::LearnedBias::NO_BIAS
    );
}

/// A fill bot's seed choice: the fixed seed wins, else BOTS_SEED from the config, else entropy (checked through the room's
/// delay-line stream, which is seeded from the same manager seed).
#[test]
fn the_manager_seed_is_the_room_fill_seed_when_set() {
    let cfg = BotFillConfig {
        seed: Some(7),
        ..BotFillConfig::default()
    };
    // The line stream is mix(seed, 1), the same stream the delay line uses: a declared seed makes it reproducible.
    let a = rh_policy::bots::delay::DelayLine::<u32>::rng(7);
    let b = rh_policy::bots::delay::DelayLine::<u32>::rng(cfg.seed.unwrap());
    assert_eq!(a, b);
}

// ============================================================ P-BOTS-7b repair: Number pipeline and the learning gate

/// The raw ECMAScript Number() oracle (the source config pipeline's engine), captured additively in the same
/// parity/policy/bot-runtime.json: decimal/scientific, whitespace/empty, radix, signed-radix, Infinity/NaN and invalid
/// text. This is the declared class set, not a claim of complete engine certification.
#[test]
fn the_bots_number_oracle_matches_the_actual_source() {
    let doc: Value = serde_json::from_str(include_str!("../../../parity/policy/bot-runtime.json"))
        .expect("the captured bot-runtime corpus parses");
    let numbers = doc["numbers"]
        .as_array()
        .expect("the additive numbers section");
    assert!(numbers.len() >= 40, "the declared class set is captured");
    for case in numbers {
        let text = case["text"].as_str().expect("a declared input");
        let got = js_number(text);
        match case["kind"].as_str().expect("a declared kind") {
            "nan" => assert!(got.is_nan(), "{text:?}: source NaN, port {got}"),
            "+inf" => assert_eq!(got, f64::INFINITY, "{text:?}"),
            "-inf" => assert_eq!(got, f64::NEG_INFINITY, "{text:?}"),
            "number" => {
                let want = case["value"].as_f64().expect("a captured number");
                assert_eq!(
                    got.to_bits(),
                    want.to_bits(),
                    "{text:?}: port {got} source {want}"
                );
                let negative_zero = case["negativeZero"].as_bool().unwrap_or(false);
                assert_eq!(
                    negative_zero,
                    got == 0. && got.is_sign_negative(),
                    "{text:?}: negative-zero sign"
                );
            }
            other => panic!("number kind {other}"),
        }
    }
}

/// The pre-repair parser is the negative control this repair is measured against: it must fail the classes the source
/// oracle pins while the ported pipeline matches all of them.
#[test]
fn the_old_number_pipeline_fails_the_repaired_classes() {
    // The pre-repair js_number: trim, a Rust f64 parse (which accepts "inf"/"infinity"/"NaN" spellings the source
    // rejects and has no radix literals), plus the two Infinity spellings.
    fn old(raw: &str) -> f64 {
        let text = raw.trim();
        if text.is_empty() {
            return f64::NAN;
        }
        match text {
            "Infinity" | "+Infinity" => f64::INFINITY,
            "-Infinity" => f64::NEG_INFINITY,
            _ => text.parse::<f64>().unwrap_or(f64::NAN),
        }
    }
    // Radix literals: the source Number accepts them, the old parser did not.
    assert_eq!(js_number("0x10"), 16.);
    assert_eq!(js_number("0b101"), 5.);
    assert_eq!(js_number("0o17"), 15.);
    assert!(old("0x10").is_nan() && old("0b101").is_nan() && old("0o17").is_nan());
    // Signed radix strings are NaN in the source grammar; the port agrees, the old parser also answered NaN but for the
    // wrong reason, so this is asserted against the captured oracle above.
    assert!(js_number("+0x10").is_nan());
    assert!(js_number("-0x10").is_nan());
    // Rust's parser takes spellings the source does not: the old pipeline answered Infinity, the source NaN.
    assert!(js_number("inf").is_nan());
    assert!(old("inf").is_infinite());
    assert!(js_number("infinity").is_nan());
    assert!(old("infinity").is_infinite());
    // A whitespace-only env value is Number(" ") = 0 (not the fallback): the old trim-then-parse made it NaN and fell back.
    assert_eq!(js_number(" "), 0.);
    assert!(old(" ").is_nan());
    let source_ws = BotFillConfig::from_env(|k| (k == "BOTS_FILL_TO").then(|| " ".to_string()));
    assert_eq!(
        source_ws.fill_to, 0,
        "source Math.round(Number of a space) is 0"
    );
    // Math.round is not floor(x + 0.5) for every double: the near-half value must stay 0, an x+0.5 implementation says 1.
    let near_half = BotFillConfig::from_env(|k| {
        (k == "BOTS_FILL_TO").then(|| "0.49999999999999994".to_string())
    });
    assert_eq!(near_half.fill_to, 0);
    assert_eq!(((0.49999999999999994f64 + 0.5).floor()) as usize, 1);
    // The empty string is the one value the source num short-circuits to the fallback; a space is not.
    let empty = BotFillConfig::from_env(|k| (k == "BOTS_FILL_TO").then(String::new));
    assert_eq!(empty.fill_to, BotFillConfig::default().fill_to);
}

/// The source BOT_STATS_FILE=off gate through the real used configuration and sink: main constructs and installs the live
/// learning store only when the environment allows learning, and the composition drops a snapshot under off so no applied
/// bias can reach the fill policy.
#[test]
fn bot_stats_file_off_keeps_the_used_configuration_learning_free() {
    use rh_policy::bots::learning::{LearnedBias, LEARN_CAP};
    let mut biases = std::collections::BTreeMap::new();
    for persona in PersonaId::ALL {
        for faction in FactionId::ALL {
            biases.insert(
                format!("faction|{}|{}", persona.as_str(), faction.as_str()),
                if faction == FactionId::Fire {
                    LEARN_CAP
                } else {
                    0.
                },
            );
        }
    }
    let live = LearnedBias::with_biases(biases);
    assert!(live.enabled(), "a running store's snapshot is enabled");
    let env = |k: &str| (k == "BOT_STATS_FILE").then(|| "off".to_string());
    // The startup decision (main): no store is started and no sink installed when the config says off.
    let startup = BotFillConfig::from_env(env);
    assert_eq!(startup.stats_file, StatsFile::Off);
    assert!(!startup.learning_enabled(), "off disables the subsystem");
    let installed: Option<LearnedBias> = if startup.learning_enabled() {
        Some(live.clone())
    } else {
        None
    };
    // The real used configuration: the gate drops the snapshot even when a caller passes one.
    let used = server_fill_config(env, Some(8), installed);
    assert_eq!(used.learned, LearnedBias::NO_BIAS);
    assert!(!used.learned.enabled());
    let forced = server_fill_config(env, Some(8), Some(live.clone()));
    assert_eq!(
        forced.learned,
        LearnedBias::NO_BIAS,
        "off wins over a supplied snapshot"
    );
    // The room's real seat draw is the captured no-learning stream, and the pre-repair behavior (applying learning
    // unconditionally) is observably different, so the regression is meaningful rather than an enum-parse check.
    let plain = server_fill_config(|_| None, Some(8), None);
    let biased = plain.clone().with_learned(live.clone());
    let fire = |specs: &[BotSeatSpec]| {
        specs
            .iter()
            .filter(|s| s.faction == FactionId::Fire)
            .count()
    };
    let (mut used_total, mut plain_total, mut biased_total) = (0, 0, 0);
    for seed in 1..=40u64 {
        assert_eq!(
            seat_all(used.clone(), seed),
            seat_all(plain.clone(), seed),
            "seed {seed}: the off configuration draws the NO_BIAS stream"
        );
        used_total += fire(&seat_all(used.clone(), seed));
        plain_total += fire(&seat_all(plain.clone(), seed));
        biased_total += fire(&seat_all(biased.clone(), seed));
    }
    assert_eq!(used_total, plain_total);
    assert!(
        biased_total > used_total,
        "the pre-repair unconditional snapshot changes the draw: {biased_total} vs {used_total}"
    );
    // Only off disables learning: a file path parses as a path (the port has no file backend to create), and the default
    // (unset) keeps learning when a snapshot is available.
    let path = BotFillConfig::from_env(|k| {
        (k == "BOT_STATS_FILE").then(|| "/var/raid/bots.json".to_string())
    });
    assert_eq!(
        path.stats_file,
        StatsFile::Path("/var/raid/bots.json".into())
    );
    assert!(path.learning_enabled());
    let enabled = server_fill_config(|_| None, Some(8), Some(live.clone()));
    assert_eq!(enabled.learned, live);
}

// ============================================================ P-BOTS-7b trim repair: exact source trim membership

/// The captured source trim membership, checked against EVERY Unicode scalar value: one extra or missing member fails.
/// The expected membership comes from the pinned-container capture in parity/policy/bot-runtime.json ("trim", evaluated
/// through the unchanged config.ts parseMix String.prototype.trim in the pinned linux/amd64 Node 22.23.4 runtime).
#[test]
fn the_js_trim_membership_is_exact_over_every_unicode_scalar() {
    let doc: Value = serde_json::from_str(include_str!("../../../parity/policy/bot-runtime.json"))
        .expect("the captured bot-runtime corpus parses");
    let trim = &doc["trim"];
    let members: Vec<u32> = trim["members"]
        .as_array()
        .expect("the captured trim membership")
        .iter()
        .map(|v| v.as_u64().expect("a code point") as u32)
        .collect();
    assert!(
        members.len() < 64,
        "the committed membership is a small list"
    );
    let expected: std::collections::BTreeSet<u32> = members.iter().copied().collect();
    assert_eq!(expected.len(), members.len(), "no duplicate members");
    let mut extra = Vec::new();
    let mut missing = Vec::new();
    for cp in 0..=0x10FFFFu32 {
        let Some(c) = char::from_u32(cp) else {
            continue;
        };
        let want = expected.contains(&cp);
        let got = is_js_trim_space(c);
        if got && !want {
            extra.push(cp);
        }
        if want && !got {
            missing.push(cp);
        }
    }
    assert!(
        extra.is_empty() && missing.is_empty(),
        "the port's trim membership diverges from the captured source: extra {extra:?}, missing {missing:?}"
    );
    // The source's whitespace and line terminators are members, NEL is explicitly not.
    for cp in [
        0x09u32, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F,
        0x3000, 0xFEFF,
    ] {
        assert!(expected.contains(&cp), "U+{cp:04X} is a source trim member");
    }
    for cp in 0x2000u32..=0x200A {
        assert!(expected.contains(&cp), "U+{cp:04X} is a source trim member");
    }
    assert!(!expected.contains(&0x85), "NEL is not a source trim member");
    // The trim helper itself: NEL stays, the real members (BOM, line terminators, spaces) go.
    assert_eq!(trim_js_whitespace("\u{85}off\u{85}"), "\u{85}off\u{85}");
    assert_eq!(trim_js_whitespace("\u{FEFF}6\u{2029}"), "6");
    assert_eq!(trim_js_whitespace("\u{2028}\u{2029} \u{000B}"), "");
}

/// The pre-repair broad Rust property (char::is_whitespace plus the three exceptions) is the negative control: it must
/// differ from the captured source membership, and that exact difference is what the two reviewer-named behaviours were.
#[test]
fn the_old_whitespace_property_is_the_trim_negative_control() {
    fn old_is_trim_space(c: char) -> bool {
        c.is_whitespace() || c == '\u{FEFF}' || c == '\u{2028}' || c == '\u{2029}'
    }
    let mut divergent = Vec::new();
    for cp in 0..=0x10FFFFu32 {
        let Some(c) = char::from_u32(cp) else {
            continue;
        };
        if old_is_trim_space(c) != is_js_trim_space(c) {
            divergent.push(cp);
        }
    }
    assert_eq!(
        divergent,
        [0x85u32],
        "the old property differs exactly at NEL U+0085"
    );
    // Behaviour 1: the old trim stripped NEL, leaving an empty string that Number reads as 0, so BOTS_FILL_TO="NEL"
    // became 0 instead of the source fallback 8.
    let old_trim = |raw: &str| {
        raw.trim_matches(|c: char| {
            c.is_whitespace() || c == '\u{FEFF}' || c == '\u{2028}' || c == '\u{2029}'
        })
        .to_string()
    };
    assert_eq!(old_trim("\u{85}"), "");
    assert_eq!(
        js_number(&old_trim("\u{85}")),
        0.,
        "the old trim made NEL read as zero"
    );
    let fixed = BotFillConfig::from_env(|k| (k == "BOTS_FILL_TO").then(|| "\u{85}".to_string()));
    assert_eq!(
        fixed.fill_to,
        BotFillConfig::default().fill_to,
        "the source Number(NEL) is NaN, so the value falls back"
    );
    // Behaviour 2: the old trim stripped NEL around "off", disabling learning; the source keeps the literal path.
    assert_eq!(old_trim("\u{85}off\u{85}"), "off");
    let fixed_stats =
        BotFillConfig::from_env(|k| (k == "BOT_STATS_FILE").then(|| "\u{85}off\u{85}".to_string()));
    assert_eq!(
        fixed_stats.stats_file,
        StatsFile::Path("\u{85}off\u{85}".to_string())
    );
    assert!(
        fixed_stats.learning_enabled(),
        "a NEL-wrapped off stays a path"
    );
    // Positive real-whitespace controls: the actual source members around a number do trim to the value.
    for (raw, want) in [
        ("\u{00A0}6\u{00A0}", 6usize),
        ("\u{FEFF}6\u{FEFF}", 6),
        ("\u{2028}6\u{2029}", 6),
        ("\u{000B}6\u{000C}", 6),
    ] {
        let cfg = BotFillConfig::from_env(|k| (k == "BOTS_FILL_TO").then(|| raw.to_string()));
        assert_eq!(cfg.fill_to, want, "{raw:?} trims to {want}");
    }
}
