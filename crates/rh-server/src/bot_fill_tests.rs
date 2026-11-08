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
